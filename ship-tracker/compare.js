'use strict';

const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

/* Read a PNG file into a pngjs object. */
function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

/*
 * Crop `frac` off every edge and return a new PNG of the central region.
 * Trims map UI chrome (top bar, left panel) so the diff reflects the water,
 * not the interface.
 */
function centerCrop(png, frac) {
  if (!frac) return png;
  const dx = Math.floor(png.width * frac);
  const dy = Math.floor(png.height * frac);
  const w = png.width - dx * 2;
  const h = png.height - dy * 2;
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, dx, dy, w, h, 0, 0);
  return out;
}

/*
 * Compare two screenshots and return a change report.
 *
 *   changeScore: fraction of compared pixels that differ (0..1)
 *   diffPixels:  raw count of differing pixels
 *   diffPath:    written heatmap PNG (red = changed), or null
 */
function compareShots(prevFile, currFile, { cropFraction, pixelThreshold, diffPath }) {
  let a = readPng(prevFile);
  let b = readPng(currFile);
  a = centerCrop(a, cropFraction);
  b = centerCrop(b, cropFraction);

  // Guard against viewport changes between runs; compare the overlap.
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const clip = (p) => {
    if (p.width === w && p.height === h) return p;
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(p, out, 0, 0, w, h, 0, 0);
    return out;
  };
  a = clip(a);
  b = clip(b);

  const diff = new PNG({ width: w, height: h });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, w, h, {
    threshold: pixelThreshold,
    includeAA: false,
  });

  if (diffPath) {
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
  }

  return {
    changeScore: diffPixels / (w * h),
    diffPixels,
    comparedPixels: w * h,
    diffPath: diffPath || null,
  };
}

module.exports = { compareShots };
