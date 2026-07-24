'use strict';

const path = require('path');
const fs = require('fs');

/*
 * Capture a full-view screenshot of the MarineTraffic map with Playwright.
 *
 * NOTE ON TERMS OF SERVICE: MarineTraffic's terms restrict automated access
 * and scraping. This module only takes an occasional visual screenshot (a
 * human-paced snapshot, not bulk data harvesting) and is intended for the
 * legitimate situational-awareness use described in the README. If you need
 * this at scale or commercially, use their official API or a licensed AIS
 * feed instead. Keep the interval reasonable (>= a few minutes).
 */

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (_) {
  chromium = null;
}

async function captureMap({ url, viewport, outPath, settleSeconds = 12 }) {
  if (!chromium) {
    throw new Error(
      'playwright is not installed. Run `npm install` inside ship-tracker/ ' +
        'and `npx playwright install chromium`.'
    );
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Honor an explicit browser binary if provided (e.g. a pre-installed
  // Chromium), otherwise use the one Playwright manages.
  const launchOpts = { headless: true };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  }
  const browser = await chromium.launch(launchOpts);
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Best-effort dismissal of the cookie/consent banner so it doesn't cover
    // the map. Selector text varies; try a few, ignore failures.
    const consentSelectors = [
      'button:has-text("Accept")',
      'button:has-text("I agree")',
      'button:has-text("Agree")',
      '#onetrust-accept-btn-handler',
    ];
    for (const sel of consentSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click({ timeout: 2000 });
          break;
        }
      } catch (_) {
        /* ignore */
      }
    }

    // The map is a WebGL canvas that streams vessel markers in after load.
    // There's no reliable "done" event, so give it a fixed settle period.
    await page.waitForTimeout(settleSeconds * 1000);

    await page.screenshot({ path: outPath, fullPage: false });
    return outPath;
  } finally {
    await browser.close();
  }
}

module.exports = { captureMap };
