/**
 * WHAT A PATCHED READ COSTS, against the same binary with nothing loaded.
 *
 *   node tools/probe-cost.mjs            clean vs ours, the table
 *   node tools/probe-cost.mjs --headed   watch both browsers
 *
 * WHY THIS EXISTS. Every other instrument here asks what a page READS. None asks how long
 * the read takes, and that is a channel of its own: an accessor that goes through a Proxy
 * and a closure costs more than a native getter, by a factor a page can measure in one
 * tight loop with performance.now(). CreepJS does not do this. Some commercial detectors
 * are said to — the numbers here are what they would see.
 *
 * It is a READOUT, not a verdict: there is no threshold a detector is known to use, and a
 * ratio that looks large on this machine may sit inside the jitter of another. So it prints
 * the ratio per surface and exits 0. What the table is for is the decision the memory
 * already records once for toString (a global gate took CreepJS from 7 lies to 207): before
 * anyone proposes to "make the getters faster", here is how much slower they are, and on
 * which reads.
 *
 * HOW IT MEASURES. Each surface is read N times in a loop inside the page, the loop timed
 * with performance.now(), repeated R rounds, and the MEDIAN round is taken — the minimum
 * would favour whichever side got the quieter core, the mean whichever got interrupted.
 * The same loop runs in the clean browser. Both sides are warmed with one unmeasured round
 * so JIT tiering is not the thing being compared. Absolute numbers are this machine's;
 * only the ratio travels.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, BROWSER } from '../test/harness.mjs';
import { settle } from './probe-settle.mjs';

const HEADED = process.argv.includes('--headed');

const server = createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    .end('<!doctype html><meta charset="utf-8"><title>cost</title><body>cost');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

// The surfaces, as a page would read them. Each is a function of no arguments; the loop
// calls it N times and discards the value. Names are what the table prints.
const SURFACES = `({
  'navigator.hardwareConcurrency': function () { return navigator.hardwareConcurrency; },
  'navigator.deviceMemory':        function () { return navigator.deviceMemory; },
  'navigator.userAgent':           function () { return navigator.userAgent; },
  'navigator.language':            function () { return navigator.language; },
  'navigator.platform':            function () { return navigator.platform; },
  'screen.width':                  function () { return screen.width; },
  'window.devicePixelRatio':       function () { return window.devicePixelRatio; },
  'window.innerWidth':             function () { return window.innerWidth; },
  'new Date().getTimezoneOffset':  function () { return new Date().getTimezoneOffset(); },
  'Date.prototype.getHours':       (function () { var d = new Date(); return function () { return d.getHours(); }; })(),
  'Intl.DateTimeFormat().resolvedOptions': function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; },
  'matchMedia(hover)':             function () { return matchMedia('(hover: hover)').matches; },
  'gl.getParameter(MAX_TEXTURE_SIZE)': (function () {
    var g = document.createElement('canvas').getContext('webgl');
    return function () { return g.getParameter(g.MAX_TEXTURE_SIZE); }; })(),
  'ctx.measureText':               (function () {
    var c = document.createElement('canvas').getContext('2d'); c.font = '14px Arial';
    return function () { return c.measureText('Cwm fjord').width; }; })(),
  'el.getBoundingClientRect':      (function () {
    var e = document.body; return function () { return e.getBoundingClientRect().width; }; })(),
  'fn.toString(getParameter)':     function () { return String(WebGLRenderingContext.prototype.getParameter); },
  'Object.getOwnPropertyDescriptor(Navigator.prototype, hardwareConcurrency).get': (function () {
    var g = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get;
    return function () { return g.call(navigator); }; })()
})`;

const N = 20000, ROUNDS = 9;

// [FIX the-two-sides-were-measured-minutes-apart] The two browsers used to be measured one
// after the other — every clean round first, then every patched round — so any drift between
// the two sessions (another suite finishing, a core parking, the fans catching up) landed
// entirely on one side and came back as a ratio. Measured while a real change was being
// judged: the same unchanged build gave measureText 1630, 1680, 1740 and 2050 ns across four
// runs while the CLEAN side wandered 300 to 820, and a genuine 1300 ns improvement was
// invisible inside that. Both browsers are open at once now and the rounds alternate, so
// drift hits both sides equally and cancels in the ratio.
//
// IN BLOCKS, and that is not a detail — the first version of this fix alternated SINGLE
// rounds and made the instrument worse, which the spread column below is what caught:
//
//     single-round alternation   measureText  6765 ns, spread ±10460, ratio 24.2x
//     blocks of 3                measureText  ~1400 ns, spread in the hundreds
//
// A page that has just sat idle while the other browser worked comes back cold — deoptimised
// and descheduled — so every round paid a re-warm and the variance swamped the bias being
// removed. Three consecutive rounds per visit keep each side warm while the blocks still
// interleave, which is the property that cancels slow drift.
//
// The block size was chosen by measuring, not by argument. Same machine, three orderings,
// worst-case spreads (measureText / getBoundingClientRect / resolvedOptions):
//
//     one round per visit     ±10460 / ±2345  / ±4425
//     three per visit         ±10990 / ±10250 / ±5425
//     all rounds in one visit ±16760 / ±17805 / ±44870
//
// so the original all-at-once ordering is the WORST of the three on the heavy surfaces, and
// single-round alternation wins on the cheap ones while losing on the expensive. Three is the
// compromise, and none of them is tight enough to judge a small change — which is what the
// spread column is for, and why probe-textcost.mjs exists.
//
// The surfaces are built once per page and kept on `window.__S`, because several of them
// close over a canvas or a GL context and rebuilding those per round would measure the
// rebuild.
const SETUP = `(() => { window.__S = ${SURFACES}; return Object.keys(window.__S).length; })()`;
const ONE_ROUND = `(() => {
  const S = window.__S, out = {};
  for (const name of Object.keys(S)) {
    const f = S[name];
    const t0 = performance.now();
    for (let i = 0; i < ${N}; i++) f();
    out[name] = (performance.now() - t0) * 1e6 / ${N};
  }
  return out;
})()`;

async function open_(withExtension) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fpscost-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !HEADED,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: withExtension ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  const page = await ctx.newPage();
  for (let i = 0; i < 3; i++) await page.goto(URL_ + '?warm=' + i, { waitUntil: 'load' });
  if (withExtension) await settle(page, URL_);
  else await page.goto(URL_, { waitUntil: 'load' });
  await page.evaluate(SETUP);
  return { ctx, page, dir };
}

const A = await open_(false);
const B = await open_(true);
const cleanRounds = {}, oursRounds = {};
try {
  const BLOCK = 3;
  for (let r = 0; r <= ROUNDS; r += BLOCK) {
    const take = async (h, into) => {
      for (let i = 0; i < BLOCK && r + i <= ROUNDS; i++) {
        const one = await h.page.evaluate(ONE_ROUND);
        if (r + i === 0) continue;         // round 0 is the warm-up, on both sides
        for (const k of Object.keys(one)) (into[k] = into[k] || []).push(one[k]);
      }
    };
    await take(A, cleanRounds);
    await take(B, oursRounds);
  }
} finally {
  for (const h of [A, B]) {
    await h.ctx.close();
    try { rmSync(h.dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  }
}
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
// The spread of the rounds IS the resolution of this instrument, so it is printed rather
// than hidden behind the median: a difference smaller than it is not a measurement.
const spread = (a) => Math.max(...a) - Math.min(...a);
const clean = {}, ours = {}, cleanSpread = {}, oursSpread = {};
for (const k of Object.keys(cleanRounds)) {
  clean[k] = med(cleanRounds[k]); cleanSpread[k] = spread(cleanRounds[k]);
  ours[k] = med(oursRounds[k]); oursSpread[k] = spread(oursRounds[k]);
}
server.close();

const names = Object.keys(clean);
const w = Math.max(...names.map((n) => n.length));
console.log(`\nns per call, median of ${ROUNDS} rounds of ${N} reads (this machine; only the ratio travels)\n`);
console.log('   ' + 'surface'.padEnd(w) + '   clean       ours        ratio    round spread (c/o)');
let worst = null;
for (const n of names) {
  // A clean side that measures 0 means the loop was optimised away there (a constant Date
  // and a getter with no side effect), so the ratio is not a number and printing Infinity
  // says less than saying so.
  const ratio = clean[n] >= 1 ? ours[n] / clean[n] : NaN;
  if (isFinite(ratio) && (!worst || ratio > worst.ratio)) worst = { n, ratio };
  console.log('   ' + n.padEnd(w) + '   ' + clean[n].toFixed(1).padStart(8) + '    ' + ours[n].toFixed(1).padStart(8) + '    ' +
    (ratio >= 3 ? 'x' : ' ') + (isFinite(ratio) ? ratio.toFixed(1) : 'n/a').padStart(6) + '    ' +
    ('±' + cleanSpread[n].toFixed(0)).padStart(7) + ' /' + ('±' + oursSpread[n].toFixed(0)).padStart(7));
}
console.log(`\n   x marks a read that costs 3x or more with the extension loaded; the worst is ` +
  `${worst.n} at ${worst.ratio.toFixed(1)}x.`);
console.log('   The last column is the spread of the rounds on each side — this instrument cannot');
console.log('   resolve a change smaller than it, and a ratio built from two numbers that wide is not');
console.log('   a measurement. For one surface in detail, tools/probe-textcost.mjs times the cases in');
console.log('   ONE page instead, which is the only way a sub-spread difference can be judged.');
console.log('   A native getter is a few nanoseconds; a Proxy + closure is tens to hundreds. Whether a');
console.log('   detector can use that depends on its own noise floor, which no one here has measured —');
console.log('   this is the number to bring to that argument, not the argument.\n');
