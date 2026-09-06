/**
 * WHAT A TEXT MEASUREMENT COSTS, split by whether the memo can answer it.
 *
 *   node tools/probe-textcost.mjs
 *
 * tools/probe-cost.mjs reads every patched surface once and cannot resolve this one: it
 * launches two browsers per run, and between runs the same unchanged build measured 1630,
 * 1680, 1740 and 2050 ns for measureText while the CLEAN side wandered 300 to 820. A change
 * worth 1300 ns is invisible inside that. Here both browsers are still used -- the ratio is
 * the only thing that travels between machines -- but the two cases that matter are timed in
 * ONE page, back to back, over seven interleaved rounds, so the noise applies equally to both.
 *
 * THE THREE CASES, and why each is a different question:
 *
 *   repeated text        one font, one string, over and over. What a page laying out the
 *                        same runs does, and the case both memos answer.
 *   unique text          a different string every call. The memo misses on the width, hits
 *                        on the font classification, and the NATIVE call is ~8x dearer
 *                        because the browser's own glyph cache misses too -- which is why
 *                        the ratio there looks harmless and the absolute overhead does not.
 *   font not allowed     the normalising branch: measured on the scratch context under the
 *                        generic fallback ([FIX noise-undid-the-normalisation]).
 *
 * MEASURED when the two memos went in ([FIX the-font-classification-was-recomputed-on-every-call],
 * [FIX the-width-substitution-was-recomputed-for-every-repeat-measurement]) -- same machine,
 * same harness, the call sites reverted by hand for the "before" column:
 *
 *     case                   clean    before     after
 *     repeated text          450 ns   2815 (6.3x)  1510 (3.2x)
 *     unique text           3900 ns   6855 (1.8x)  5530 (1.4x)
 *     font not allowed       440 ns   2930 (6.8x)  1585 (3.5x)
 *
 * It is a READOUT, not a verdict, for the reason probe-cost.mjs states at length: no
 * detector's threshold is known. Exits 0.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from '../test/harness.mjs';

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
   .end('<!doctype html><title>t</title>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const LOOP = () => {
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    x.font = '16px Arial';
    const N = 20000, R = 7;
    const same = [], uniq = [], blocked = [];
    const run = (fn) => { const t = performance.now(); fn(); return (performance.now() - t) * 1e6 / N; };
    // warm both paths so JIT tiering is not what is being compared
    for (let i = 0; i < N; i++) x.measureText('Cwm fjord bank');
    for (let i = 0; i < N; i++) x.measureText('u' + i);
    for (let r = 0; r < R; r++) {
      same.push(run(() => { for (let i = 0; i < N; i++) x.measureText('Cwm fjord bank'); }));
      uniq.push(run(() => { for (let i = 0; i < N; i++) x.measureText('q' + r + '_' + i); }));
      // a font outside the allowlist: the blocked branch, which also normalises
      x.font = '16px Pristina';
      blocked.push(run(() => { for (let i = 0; i < N; i++) x.measureText('Cwm fjord bank'); }));
      x.font = '16px Arial';
    }
    const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
    return { same: med(same), uniq: med(uniq), blocked: med(blocked) };
};

async function read(ctx) {
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1200));
  const out = await page.evaluate(LOOP);
  await page.close();
  return out;
}

const clean = await chromium.launch({ ...BROWSER, headless: true });
const CLEAN = await read(await clean.newContext());
await clean.close();

const dir = mkdtempSync(join(tmpdir(), 'afp-memo-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
let OURS;
try {
  await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  OURS = await read(ctx);
} finally {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
  server.close();
}
const f = (n) => n.toFixed(0).padStart(7) + ' ns';
const row = (k, label) => console.log('  ' + label.padEnd(30) + f(CLEAN[k]) + f(OURS[k]) +
  '   ' + (OURS[k] / CLEAN[k]).toFixed(1) + 'x');
console.log('\n  measureText, ns per call (median of 7 rounds of 20000)\n');
console.log('  ' + 'case'.padEnd(30) + '  clean'.padEnd(10) + '   ours'.padEnd(10) + '  ratio');
row('same', 'repeated text (memo hits)');
row('uniq', 'unique text   (memo misses)');
row('blocked', 'repeated, font not allowed');
