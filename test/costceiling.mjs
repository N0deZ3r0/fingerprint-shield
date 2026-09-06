/**
 * A PATCHED READ MUST NOT GET DRAMATICALLY DEARER WITHOUT ANYONE NOTICING.
 *
 *   node test/costceiling.mjs             headless
 *   node test/costceiling.mjs --headed    watch it
 *
 * Two cost defects landed in one day, both found by hand and both nearly missed:
 *
 *   measureText   the font string was re-parsed and the width re-hashed on every call —
 *                 6.3x the native call, and tools/probe-cost.mjs could not resolve the fix
 *                 because it launches two browsers per run and the noise between runs was
 *                 larger than the change
 *   isBait        fourteen bait names as fourteen indexOf calls against the id and fourteen
 *                 against the class, on every element a page measures, in front of five
 *                 APIs — ~600 ns of every getBoundingClientRect
 *
 * Nothing stopped either from being written, and nothing would stop the next one. This is
 * that guard.
 *
 * IT IS A SMOKE ALARM, NOT A THERMOMETER, and the threshold was set by measuring rather than
 * by taste. A plain ratio was tried first and does not survive this rig. Four runs of the
 * SAME unchanged build, minutes apart:
 *
 *     ctx.measureText                5.5x   5.2x   4.8x   2.9x
 *     el.getBoundingClientRect       3.1x   3.2x   3.9x   1.7x
 *     navigator.hardwareConcurrency  3.0x   4.0x   6.1x   2.1x
 *
 * — the third run breached a 6x ceiling with nothing changed. The cheap read is what breaks
 * it: hardwareConcurrency costs ~80 ns clean, so a 200 ns wobble is 2.5x of it, and a ratio
 * with a denominator that small measures the machine's mood.
 *
 * So the rule is `ours <= clean * 4 + 3000 ns` — a multiple for the dear reads and a flat
 * allowance that absorbs the noise on the cheap ones. What that buys, stated plainly so that
 * nobody trusts it further than it goes:
 *
 *   CATCHES   an order-of-magnitude blowup: a synchronous storage read in a getter, a regex
 *             compiled per call, an accessor that starts walking a list — anything that adds
 *             microseconds to a hot path
 *   MISSES    the two defects that motivated it. measureText before its fix was 2815 ns
 *             against 450 clean, and the budget there is 4800 — this file would have passed
 *             it without a murmur.
 *
 * That second line is why it is not called a guard. A change of that size has to be judged by
 * tools/probe-textcost.mjs — one page, both cases, the "before" column taken by reverting the
 * call sites by hand — and no assertion on a rig this noisy can stand in for it.
 *
 * HOW IT AVOIDS BEING FLAKY. Both sides are timed by the same loop in the same shape, and
 * the MINIMUM round is taken on each side rather than the median: interference only ever
 * makes a round slower, so the fastest round of each side is the cleanest estimate of what
 * the call costs, and the ratio of two minima is far steadier than the ratio of two medians.
 * The absolute numbers are this machine's; the ratio is printed for the reader and the
 * budget is what is asserted.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';

const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('  FAIL:', m); failed++; } };

// ours <= clean * MULT + FLOOR ns. See the header for why it is not a plain ratio.
const MULT = 4, FLOOR = 3000;
const SURFACES = ['ctx.measureText', 'el.getBoundingClientRect', 'navigator.hardwareConcurrency'];

const LOOP = () => {
  const N = 20000, R = 7;
  const c = document.createElement('canvas').getContext('2d');
  c.font = '16px Arial';
  const el = document.createElement('div');
  el.className = 'row';
  el.style.cssText = 'width:40px;height:20px';
  document.body.appendChild(el);
  const S = {
    'ctx.measureText': () => c.measureText('Cwm fjord bank').width,
    'el.getBoundingClientRect': () => el.getBoundingClientRect().width,
    'navigator.hardwareConcurrency': () => navigator.hardwareConcurrency
  };
  const out = {};
  for (const name of Object.keys(S)) {
    const f = S[name];
    for (let i = 0; i < N; i++) f();          // warm
    const rounds = [];
    for (let r = 0; r < R; r++) {
      const t = performance.now();
      for (let i = 0; i < N; i++) f();
      rounds.push((performance.now() - t) * 1e6 / N);
    }
    out[name] = Math.min(...rounds);
  }
  return out;
};

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
   .end('<!doctype html><meta charset=utf-8><title>cost</title><body>x'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

async function read(ctx) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 800));
  const out = await page.evaluate(LOOP);
  await page.close();
  return out;
}

const cleanBrowser = await chromium.launch({ ...BROWSER, headless: !headed });
const CLEAN = await read(await cleanBrowser.newContext());
await cleanBrowser.close();

const dir = mkdtempSync(join(tmpdir(), 'afp-costceiling-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
let OURS;
try {
  ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2000));
  OURS = await read(ctx);
} finally {
  await ctx.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  server.close();
}

console.log('\nns per call, fastest of 7 rounds of 20000 (this machine; the budget is what is asserted)\n');
for (const name of SURFACES) {
  const c = CLEAN[name], o = OURS[name];
  const budget = c * MULT + FLOOR;
  const ratio = c >= 1 ? o / c : NaN;
  console.log('  ' + name.padEnd(32) + String(Math.round(c)).padStart(6) + ' ->' +
    String(Math.round(o)).padStart(7) + '   ' + (isFinite(ratio) ? ratio.toFixed(1) + 'x' : 'n/a') +
    '   budget ' + Math.round(budget) + ' ns');
  ok(o <= budget,
    `${name}: ${Math.round(o)} ns against a budget of ${Math.round(budget)} ` +
    `(clean ${Math.round(c)} ns x ${MULT} + ${FLOOR})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
