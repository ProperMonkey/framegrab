'use strict';

/*
 * Configuration for the ship-movement screenshot monitor.
 *
 * Defaults target the view from the task:
 *   https://www.marinetraffic.com/en/ais/home/centerx:43.3/centery:12.8/zoom:9
 * i.e. Bab-el-Mandeb / southern Red Sea (Yemen / Djibouti / Eritrea), the
 * approach to the Suez route. Override any of these via environment vars.
 */

const path = require('path');
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

const CENTER_X = num(process.env.CENTER_X, 43.3); // longitude
const CENTER_Y = num(process.env.CENTER_Y, 12.8); // latitude
const ZOOM = num(process.env.ZOOM, 9);

module.exports = {
  mapUrl:
    process.env.MAP_URL ||
    `https://www.marinetraffic.com/en/ais/home/centerx:${CENTER_X}/centery:${CENTER_Y}/zoom:${ZOOM}`,

  // Where screenshots, diffs and the change log are written.
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),

  // Interval for --watch mode (minutes). Scheduled/cron runs ignore this.
  intervalMinutes: num(process.env.INTERVAL_MINUTES, 30),

  // Browser viewport.
  viewport: {
    width: num(process.env.VIEWPORT_WIDTH, 1600),
    height: num(process.env.VIEWPORT_HEIGHT, 1000),
  },

  // Fraction cropped off each edge before diffing, to drop UI chrome
  // (top bar, left panel, attribution) and compare only the open water in
  // the middle. 0.12 = trim 12% off every side.
  cropFraction: num(process.env.CROP_FRACTION, 0.12),

  // Seconds to let the WebGL map settle (markers stream in after load).
  settleSeconds: num(process.env.SETTLE_SECONDS, 12),

  // --- Anomaly detection --------------------------------------------------
  // Each run produces a "change score" = fraction of pixels that differ from
  // the previous shot. We keep a rolling baseline and flag a run when the
  // score deviates far from it in either direction:
  //   HIGH  -> lots of movement / markers vanishing  (possible diversion/exodus)
  //   LOW   -> the scene barely changed              (possible stalling)
  thresholds: {
    baselineRuns: num(process.env.BASELINE_RUNS, 8), // window size
    minBaseline: num(process.env.MIN_BASELINE, 3), // need this many first
    // Flag when score is this many std-devs from the baseline mean.
    sigma: num(process.env.SIGMA, 2.5),
    // Also flag on hard limits regardless of baseline.
    highAbsolute: num(process.env.HIGH_ABSOLUTE, 0.35), // >35% pixels changed
    lowAbsolute: num(process.env.LOW_ABSOLUTE, 0.01), // <1% pixels changed
    // Per-pixel color-distance threshold for pixelmatch (0..1).
    pixelThreshold: num(process.env.PIXEL_THRESHOLD, 0.15),
  },
};
