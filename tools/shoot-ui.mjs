/**
 * THE SCREENSHOTS IN THE READMEs, TAKEN RATHER THAN COLLECTED.
 *
 *   node tools/shoot-ui.mjs <out-dir> [--lang=en-US] [--suffix=.ru]
 *
 * The two front pages are in two languages, and until now they shared one set of images —
 * Russian ones — so the English page showed a Russian popup. Each language needs its own
 * set, and a set has to be RETAKEN whenever the interface moves, which is the reason this
 * is a script and not a folder of files somebody once exported.
 *
 * Three views, the ones the READMEs actually place:
 *
 *   ui-popup     the popup at its own width, with a site as the active tab — without one
 *                the per-site card is swapped out for a note and the picture shows a state
 *                no user is ever in.
 *   ui-modules   the options page's module grid, cropped to the card. The rest of that
 *                page is per-site lists that are empty on a fresh profile and would
 *                photograph as a column of dashes.
 *   ui-whoami    the whole Who Am I page, which is the one that shows the invented machine.
 *
 * The extension is loaded for real: these are the actual surfaces with an actual profile
 * behind them, not a mock. deviceScaleFactor is 2 so the images survive being scaled down
 * to a README's column width.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from '../test/harness.mjs';

const out = process.argv[2];
if (!out || out.startsWith('--')) {
  console.error('usage: node tools/shoot-ui.mjs <out-dir> [--lang=en-US] [--suffix=.ru]');
  process.exit(2);
}
const lang = (process.argv.find((a) => a.startsWith('--lang=')) || '--lang=en-US').slice(7);
const suffix = (process.argv.find((a) => a.startsWith('--suffix=')) || '--suffix=').slice(9);
mkdirSync(out, { recursive: true });

// A real site has to be the active tab — see the note above.
const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    .end('<!doctype html><title>example</title><h1>a site</h1>'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const dir = mkdtempSync(join(tmpdir(), 'afp-shoot-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER,
  headless: true,
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, `--lang=${lang}`,
    '--force-device-scale-factor=2', '--hide-scrollbars']
});

try {
  const bg = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
    await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 3000));
  const id = new URL(bg.url()).host;

  // The exit-country check is switched off before anything is photographed. It is a real
  // feature and a real warning, but the warning is about THIS machine's VPN: the first shot
  // taken here read "Exit address: Estonia — does not match" across the front page, which
  // looks like a defect in the extension rather than like the check working. Clearing the
  // stored reading is not enough — with the check on, the popup asks again and the answer
  // comes back the same — so the switch goes off and the endpoint is blocked with it.
  await ctx.route('**/cdn-cgi/trace', (r) => r.abort());
  await bg.evaluate(async () => {
    await chrome.storage.local.set({ afp_geocheck: false });
    await chrome.storage.local.remove(['afp_exit_cc', 'afp_exit_at']);
  });

  const site = await ctx.newPage();
  await site.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

  const shot = async (name, url, prepare) => {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 400, height: 900 });
    await p.goto(`chrome-extension://${id}/${url}`, { waitUntil: 'load' });
    await site.bringToFront();
    await p.reload({ waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 2000));
    const target = prepare ? await prepare(p) : p;
    const file = join(out, `${name}${suffix}.png`);
    await target.screenshot({ path: file, ...(target === p ? { fullPage: true } : {}) });
    await p.close();
    console.log(`  ${file}`);
  };

  await shot('ui-popup', 'popup.html', async (p) => {
    // The popup renders at its own width; the viewport is set to the height it settles at
    // so the image is the window, not a window inside a taller page.
    const h = await p.evaluate(() => document.body.scrollHeight);
    await p.setViewportSize({ width: 400, height: h });
    await new Promise((r) => setTimeout(r, 300));
    return p;
  });

  await shot('ui-modules', 'options.html', async (p) => {
    await p.setViewportSize({ width: 900, height: 1000 });
    await new Promise((r) => setTimeout(r, 500));
    // The first card is the module grid — the rest of the page is per-site lists that are
    // empty on a fresh profile.
    return p.locator('section.card').first();
  });

  // The whole settings page, for the front page that places it whole rather than cropped —
  // its alt text names the per-site lists and the exit-country check, which the crop above
  // does not contain.
  await shot('ui-options', 'options.html', async (p) => {
    await p.setViewportSize({ width: 880, height: 1200 });
    await new Promise((r) => setTimeout(r, 600));
    return p;
  });

  await shot('ui-whoami', 'whoami.html', async (p) => {
    // A short viewport on purpose: the page's own min-height is 100vh, so a tall one leaves
    // a third of the image blank below the content — measured at 1400, which gave 700px of
    // nothing. fullPage then grows the shot back to the real content height.
    await p.setViewportSize({ width: 1100, height: 700 });
    await new Promise((r) => setTimeout(r, 1200));
    return p;
  });

  console.log(`done — ${lang}`);
} finally {
  await ctx.close();
  server.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
}
