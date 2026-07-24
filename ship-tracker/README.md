# ship-tracker

Periodically screenshots a MarineTraffic map view and compares each shot to the
previous one, so you can spot **major shifts in ship movement** in the
Bab-el-Mandeb / southern Red Sea area (default view centered on
`centerx:43.3 / centery:12.8 / zoom:9`).

It answers, at a glance, the two things you care about:

- **Diversion / exodus** → the picture changes *much more* than usual (vessels
  streaming out or rerouting). Flagged as `HIGH`.
- **Stalling** → the picture changes *much less* than usual (vessels holding
  position). Flagged as `LOW`.

Each run writes a **change score** (fraction of the map that differs from the
last shot) to `data/changes.csv`, saves the screenshot and a red diff heatmap,
and prints an alert when the score falls outside the rolling baseline.

## How it works

1. **Screenshot** — Playwright loads the exact URL and captures the map.
2. **Crop** — trims UI chrome off the edges so the diff reflects the water.
3. **Diff** — `pixelmatch` counts changed pixels vs. the previous shot.
4. **Classify** — compares the score to a rolling baseline (mean ± σ, plus hard
   floor/ceiling) and flags `HIGH`, `LOW`, or `OK`.

## Run it

```bash
cd ship-tracker
npm install               # installs Playwright + Chromium
node monitor.js           # one capture + compare (good for cron / tasks)
npm run watch             # loop every INTERVAL_MINUTES (default 30)
```

Outputs land in `ship-tracker/data/`:

```
data/shots/shot-<ts>.png   the screenshots
data/diffs/diff-<ts>.png   red = pixels that changed vs. previous shot
data/changes.csv           timestamp, score, status, note  (open in a spreadsheet)
data/state.json            last shot + baseline history
```

## Run it on a schedule (no machine of your own)

A GitHub Actions workflow (`.github/workflows/ship-tracker.yml`) runs the
monitor every 30 minutes, carries the previous screenshot between runs via the
Actions cache, uploads each shot + diff as an artifact, and writes the verdict
to the run's job summary. Enable it under the repo's **Actions** tab (or trigger
it manually with **Run workflow**). Scheduled runs can be delayed by GitHub under
load; for tighter timing run `npm run watch` on any always-on box.

## Tuning

All via env vars (see `config.js`): `MAP_URL`, `INTERVAL_MINUTES`,
`CROP_FRACTION`, `SIGMA`, `HIGH_ABSOLUTE`, `LOW_ABSOLUTE`,
`PIXEL_THRESHOLD`, `SETTLE_SECONDS`. Point it at a different chokepoint by
setting `MAP_URL` (or `CENTER_X` / `CENTER_Y` / `ZOOM`).

## Honest limitations

- A pixel diff measures *how much the picture changed*, not *why*. It's a good
  early-warning tripwire but it can't tell a tanker from a fishing boat, or
  panning/zoom drift from real movement — keep the view URL fixed.
- MarineTraffic's terms restrict automated access. This tool takes an occasional
  human-paced screenshot for situational awareness, not bulk harvesting. Keep the
  interval reasonable. For anything at scale or commercial, use their official API
  or a licensed AIS feed — that also gives you structured data (vessel type,
  speed, navigational status) that would let you distinguish *tanker* stalling
  from general traffic, which screenshots can't.
```
