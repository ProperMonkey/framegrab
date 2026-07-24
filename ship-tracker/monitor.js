#!/usr/bin/env node
'use strict';

/*
 * Ship-movement screenshot monitor.
 *
 * One run =  take a screenshot of the MarineTraffic view  ->  diff it against
 * the previous screenshot  ->  append a change score to a log  ->  raise an
 * alert if the change is anomalous (unusually high = movement/diversion, or
 * unusually low = stalling).
 *
 * Modes:
 *   node monitor.js            run once and exit   (for cron / scheduled tasks)
 *   node monitor.js --watch    loop every INTERVAL_MINUTES  (long-running)
 *
 * State (previous screenshot + baseline history) lives in DATA_DIR, so cron
 * runs just need that directory to persist between invocations.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { captureMap } = require('./screenshot');
const { compareShots } = require('./compare');

const SHOTS_DIR = path.join(config.dataDir, 'shots');
const DIFFS_DIR = path.join(config.dataDir, 'diffs');
const LOG_CSV = path.join(config.dataDir, 'changes.csv');
const STATE_JSON = path.join(config.dataDir, 'state.json');

function ensureDirs() {
  for (const d of [config.dataDir, SHOTS_DIR, DIFFS_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_JSON, 'utf8'));
  } catch (_) {
    return { lastShot: null, history: [] }; // history = recent change scores
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_JSON, JSON.stringify(state, null, 2));
}

function appendLog(row) {
  const header = 'timestamp,shot,change_score,diff_pixels,status,note\n';
  if (!fs.existsSync(LOG_CSV)) fs.writeFileSync(LOG_CSV, header);
  const line =
    [row.timestamp, row.shot, row.changeScore, row.diffPixels, row.status, `"${row.note}"`].join(
      ','
    ) + '\n';
  fs.appendFileSync(LOG_CSV, line);
}

function stats(arr) {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance), n };
}

/*
 * Decide whether a change score is anomalous versus the rolling baseline.
 * Returns { status, note } where status is OK | HIGH | LOW | BASELINE.
 */
function classify(score, history, t) {
  if (history.length < t.minBaseline) {
    return { status: 'BASELINE', note: `building baseline (${history.length}/${t.minBaseline})` };
  }
  const base = history.slice(-t.baselineRuns);
  const { mean } = stats(base);
  // Floor the std so a very quiet, near-constant baseline doesn't flag every
  // tiny wobble as anomalous.
  const std = Math.max(stats(base).std, 0.2 * mean, 1e-4);
  const statHi = mean + t.sigma * std;
  const statLo = mean - t.sigma * std;

  // Flag if EITHER the statistical bar OR the hard absolute bar is crossed.
  if (score >= statHi || score >= t.highAbsolute) {
    return {
      status: 'HIGH',
      note:
        `score ${score.toFixed(4)} vs baseline mean ${mean.toFixed(4)} ` +
        `(stat threshold ${statHi.toFixed(4)}, hard ${t.highAbsolute}) — ` +
        `large shift: heavy movement or vessels leaving the area`,
    };
  }
  if (score <= statLo || score <= t.lowAbsolute) {
    return {
      status: 'LOW',
      note:
        `score ${score.toFixed(4)} vs baseline mean ${mean.toFixed(4)} ` +
        `(stat threshold ${statLo.toFixed(4)}, hard ${t.lowAbsolute}) — ` +
        `scene barely changed: possible stalling / vessels holding position`,
    };
  }
  return { status: 'OK', note: `score ${score.toFixed(4)} within baseline (mean ${mean.toFixed(4)})` };
}

async function runOnce() {
  ensureDirs();
  const state = loadState();
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const shotPath = path.join(SHOTS_DIR, `shot-${stamp}.png`);

  console.log(`[${now.toISOString()}] capturing ${config.mapUrl}`);
  await captureMap({
    url: config.mapUrl,
    viewport: config.viewport,
    settleSeconds: config.settleSeconds,
    outPath: shotPath,
  });
  console.log(`  saved ${path.relative(process.cwd(), shotPath)}`);

  let result = { changeScore: null, diffPixels: null, status: 'FIRST', note: 'first screenshot, nothing to compare yet' };

  if (state.lastShot && fs.existsSync(state.lastShot)) {
    const diffPath = path.join(DIFFS_DIR, `diff-${stamp}.png`);
    const cmp = compareShots(state.lastShot, shotPath, {
      cropFraction: config.cropFraction,
      pixelThreshold: config.thresholds.pixelThreshold,
      diffPath,
    });
    const verdict = classify(cmp.changeScore, state.history, config.thresholds);
    result = { ...cmp, ...verdict };

    state.history.push(cmp.changeScore);
    if (state.history.length > config.thresholds.baselineRuns * 3) {
      state.history = state.history.slice(-config.thresholds.baselineRuns * 3);
    }

    const flag = verdict.status === 'HIGH' || verdict.status === 'LOW';
    const banner = flag ? '  🚨 ALERT' : '  ✓';
    console.log(`${banner} [${verdict.status}] ${verdict.note}`);
    console.log(`  diff heatmap: ${path.relative(process.cwd(), diffPath)}`);

    // Emit to GitHub Actions job summary when running in CI.
    if (process.env.GITHUB_STEP_SUMMARY) {
      const md =
        `### Ship monitor — ${now.toISOString()}\n\n` +
        `- **Status:** ${flag ? '🚨 ' : ''}${verdict.status}\n` +
        `- **Change score:** ${cmp.changeScore.toFixed(4)} (${cmp.diffPixels} px)\n` +
        `- ${verdict.note}\n`;
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    }
  } else {
    console.log('  first run — no previous screenshot to compare.');
  }

  appendLog({
    timestamp: now.toISOString(),
    shot: path.basename(shotPath),
    changeScore: result.changeScore ?? '',
    diffPixels: result.diffPixels ?? '',
    status: result.status,
    note: result.note,
  });

  state.lastShot = shotPath;
  saveState(state);

  return result;
}

async function watch() {
  const ms = config.intervalMinutes * 60 * 1000;
  console.log(`watch mode: every ${config.intervalMinutes} min. Ctrl-C to stop.`);
  // Run immediately, then on the interval.
  const tick = async () => {
    try {
      await runOnce();
    } catch (err) {
      console.error('run failed:', err.message);
    }
  };
  await tick();
  setInterval(tick, ms);
}

if (require.main === module) {
  const watchMode = process.argv.includes('--watch');
  (watchMode ? watch() : runOnce()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runOnce, classify };
