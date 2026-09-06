/**
 * DOES getHighEntropyValues ANSWER ONLY WHAT WAS ASKED?
 *
 *   node test/uachshape.mjs             headless
 *   node test/uachshape.mjs --headed    watch it
 *
 * `navigator.userAgentData.getHighEntropyValues(hints)` resolves with the low-entropy trio
 * (brands, mobile, platform) plus ONLY the hints the caller named. Our wrapper built every
 * field and then deleted exactly two of them when unrequested, so architecture, bitness,
 * model, platformVersion, wow64 and formFactors came back on every call — including
 * `getHighEntropyValues([])`. Measured, clean Chromium against this build on one machine:
 *
 *     getHighEntropyValues([])                 clean  3 keys      ours 11
 *     getHighEntropyValues(['platform'])       clean  3 keys      ours  9
 *     getHighEntropyValues(['architecture'])   clean  4 keys      ours  9
 *
 * A key nobody asked for is a deterministic tell: one call, no statistics, and the answer
 * has a shape no browser produces. Same class as [FIX invented-chrome-runtime] and the
 * own-property half of [FIX uad-shape-not-just-values] — which fixed the ORDER of these
 * keys and left their NUMBER alone, because the page that checked it
 * (dev-wvw.html) asks for all eight hints at once and therefore could never see it.
 *
 * WHY THE EXPECTED SET IS NOT WRITTEN DOWN HERE. It is read from a clean browser in the
 * same run. A literal list would have to be revised every time the platform adds a hint,
 * and the version that is wrong looks exactly like the version that is right — the same
 * trap [FIX temporal-and-newer-intl-ctors] documents for hand-listed API sets.
 *
 * The window and the worker are checked separately: mw-navigator.js and mw-workers.js keep
 * mirrored copies of this wrapper, and the comment in each says to change them together.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, bootSettled } from './harness.mjs';
const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

/** The hint lists that matter: the empty one, each hint alone, a pair, and all of them. */
const CASES = [
  [],
  ['platform'],
  ['architecture'],
  ['bitness'],
  ['model'],
  ['platformVersion'],
  ['uaFullVersion'],
  ['fullVersionList'],
  ['formFactors'],
  ['wow64'],
  ['platformVersion', 'model'],
  ['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64', 'formFactors'],
  // Not a hint at all. Chrome ignores unknown names rather than throwing or echoing them.
  ['notAHint']
];

const WORKER = `
self.onmessage = async (e) => {
  const out = {};
  for (const hints of e.data) {
    const key = JSON.stringify(hints);
    try {
      out[key] = Object.keys(await navigator.userAgentData.getHighEntropyValues(hints)).join(',');
    } catch (err) { out[key] = 'ERR ' + err.message; }
  }
  try { out.__cores = String(navigator.hardwareConcurrency); } catch (err) { out.__cores = 'ERR'; }
  postMessage(out);
};`;

const PAGE = '<!doctype html><html><body><p>uach</p></body></html>';
const server = createServer((q, r) => {
  if (q.url === '/w.js') {
    r.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(WORKER);
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

async function read(clean) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-uach-'));
  let browser = null;
  const ctx = clean
    ? await (browser = await chromium.launch({ ...BROWSER, headless: !headed })).newContext()
    : await chromium.launchPersistentContext(dir, {
      ...BROWSER, headless: !headed,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
  try {
    if (!clean) {
      try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch { /* up */ }
      await bootSettled(ctx);
    }
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    return await page.evaluate(async (cases) => {
      const win = {};
      for (const hints of cases) {
        const key = JSON.stringify(hints);
        try {
          win[key] = Object.keys(await navigator.userAgentData.getHighEntropyValues(hints)).join(',');
        } catch (e) { win[key] = 'ERR ' + e.message; }
      }
      win.__cores = String(navigator.hardwareConcurrency);
      const worker = await new Promise((resolve) => {
        try {
          const w = new Worker('/w.js');
          const t = setTimeout(() => resolve({ __err: 'timeout' }), 10000);
          w.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
          w.onerror = (e) => { clearTimeout(t); resolve({ __err: 'onerror ' + e.message }); };
          w.postMessage(cases);
        } catch (e) { resolve({ __err: String(e) }); }
      });
      return { win, worker };
    }, CASES);
  } finally {
    await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds the profile */ }
  }
}

const clean = await read(true);
const ours = await read(false);
server.close();

// The guard this suite would be worthless without: if the extension is not actually
// running, every shape below matches the clean browser trivially and the suite reports a
// green it did not earn. hardwareConcurrency is spoofed by every shipped profile, so a
// live extension MUST move it.
ok(ours.win.__cores !== clean.win.__cores,
  `the extension is actually active — cores ours ${ours.win.__cores} vs clean ${clean.win.__cores}` +
  (ours.win.__cores === clean.win.__cores ? ' (IDENTICAL: nothing was tested)' : ''));

console.log(`\ncores: clean ${clean.win.__cores} -> ours ${ours.win.__cores}\n`);
console.log('hints'.padEnd(74) + 'window   worker');

for (const hints of CASES) {
  const key = JSON.stringify(hints);
  const label = (key.length > 70 ? key.slice(0, 67) + '...' : key).padEnd(72);
  const winOk = clean.win[key] === ours.win[key];
  const workerOk = clean.worker[key] === ours.worker[key];
  console.log(`  ${label} ${winOk ? 'ok  ' : 'DIFF'}     ${workerOk ? 'ok' : 'DIFF'}`);
  if (!winOk) {
    console.log(`      window clean: ${clean.win[key]}`);
    console.log(`      window ours : ${ours.win[key]}`);
  }
  if (!workerOk) {
    console.log(`      worker clean: ${clean.worker[key]}`);
    console.log(`      worker ours : ${ours.worker[key]}`);
  }
  ok(winOk, `window getHighEntropyValues(${key}) returns the browser's key set`);
  ok(workerOk, `worker getHighEntropyValues(${key}) returns the browser's key set`);
}

// The two scopes must also agree with EACH OTHER, which is the invariant the mirrored
// copies exist for — a page reads the same probe twice and a split is what it looks for.
for (const hints of CASES) {
  const key = JSON.stringify(hints);
  ok(ours.win[key] === ours.worker[key],
    `window and worker agree on ${key} — window "${ours.win[key]}" worker "${ours.worker[key]}"`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
