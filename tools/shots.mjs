/**
 * Screenshots for the README, taken from the extension actually running.
 *
 *   node tools/shots.mjs
 *
 * Loaded the same way the Playwright suites load it, so what is captured is the
 * real thing rather than a mock. Everything is shot at deviceScaleFactor 2 and
 * sized so the README can display it at half the pixel width — that is what
 * keeps the text sharp instead of resampled.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { chromium } from 'playwright';
import { root } from '../test/harness.mjs';

const OUT = path.join(root, 'docs');
fs.mkdirSync(OUT, { recursive: true });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fps-shots-'));
const ctx = await chromium.launchPersistentContext(dir, {
  channel: 'chromium',
  headless: false,
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const bg = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
    await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(bg.url()).host;
  console.log('extension id', id);

  const shoot = async (file, page, opts = {}) => {
    const target = opts.selector ? page.locator(opts.selector).first() : page;
    await target.screenshot({ path: path.join(OUT, file), ...(opts.fullPage ? { fullPage: true } : {}) });
    const { width, height } = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
    }));
    console.log(`  ${file}  page ${width}x${height}`);
  };

  // The popup, at the width Chrome actually gives it.
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 400, height: 600 });
  await popup.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load' });
  await sleep(2500);
  await shoot('ui-popup.png', popup, { fullPage: true });

  // Options: only the module grid. The whole page is four thousand pixels tall
  // and unreadable once a README scales it to its column width.
  const options = await ctx.newPage();
  await options.setViewportSize({ width: 980, height: 900 });
  await options.goto(`chrome-extension://${id}/options.html`, { waitUntil: 'load' });
  await sleep(2000);
  await shoot('ui-modules.png', options, { selector: '.card, section, .box' });

  // Who Am I: the invented machine, as a site reads it.
  const who = await ctx.newPage();
  await who.setViewportSize({ width: 1000, height: 1000 });
  await who.goto(`chrome-extension://${id}/whoami.html`, { waitUntil: 'load' });
  await sleep(6000);
  await shoot('ui-whoami.png', who, { fullPage: true });
} finally {
  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
