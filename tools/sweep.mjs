/**
 * One page, every realm, both builds: the cross-checks that no single dev page owns.
 *
 *   node tools/sweep/sweep-server.cjs     serve it (port 8732), then
 *   node tools/sweep.mjs                  with the extension
 *   node tools/sweep.mjs --clean          the control, no extension
 *
 * WHY IT EXISTS. It found a bug the whole suite missed: `new Worker(url, {type:'module'})`
 * followed by an immediate postMessage got NO reply, because the module wrapper's
 * `await import()` let the message be delivered before the page's module registered a
 * handler. Every existing worker check posted its message and waited, which is the same
 * shape — but the dev page's worker was classic, so nothing exercised the module path's
 * timing. The check now lives in dev-worker-patch.html; this file is how it was found.
 *
 * ALWAYS run --clean too. Three of the first four "failures" here were the checks being
 * wrong, not the extension: WorkerNavigator has no `webdriver` at all, so comparing it
 * across scopes reds a clean browser just as hard.
 */
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root as ROOT } from '../test/harness.mjs';
const URL_ = process.env.PAGE || 'http://127.0.0.1:8732/';
const clean = process.argv.includes('--clean');
const dir = mkdtempSync(join(tmpdir(), 'afp-sweep-'));
let ctx, browser = null;
if (clean) {
  browser = await chromium.launch({ ...BROWSER, headless: true });
  ctx = await browser.newContext();
} else {
  ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: true,
    args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT]
  });
  try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch { /* up */ }
  await new Promise((r) => setTimeout(r, 3000));
}
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await p.goto(URL_, { waitUntil: 'load' });
// Twice: client hints are not sent until the browser has seen Accept-CH, and the canvas
// journal needs a previous load to compare against. A one-load sweep can only print those.
await p.waitForFunction(() => document.getElementById('out').textContent !== 'running...', null, { timeout: 60000 });
await p.reload({ waitUntil: 'load' });
await p.waitForFunction(() => document.getElementById('out').textContent !== 'running...', null, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
console.log(await p.evaluate(() => document.getElementById('out').textContent));
await ctx.close();
if (browser) await browser.close();
try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
