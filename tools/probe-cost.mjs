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
const MEASURE = `(async () => {
  const S = ${SURFACES};
  const out = {};
  for (const name of Object.keys(S)) {
    const f = S[name];
    const rounds = [];
    for (let r = 0; r <= ${ROUNDS}; r++) {
      const t0 = performance.now();
      for (let i = 0; i < ${N}; i++) f();
      const t = performance.now() - t0;
      if (r > 0) rounds.push(t);             // round 0 is the warm-up
    }
    rounds.sort((a, b) => a - b);
    out[name] = rounds[Math.floor(rounds.length / 2)] * 1e6 / ${N};   // ns per call, median round
    await new Promise((res) => setTimeout(res, 0));
  }
  return out;
})()`;

async function read(withExtension) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fpscost-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !HEADED,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: withExtension ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  try {
    const page = await ctx.newPage();
    for (let i = 0; i < 3; i++) await page.goto(URL_ + '?warm=' + i, { waitUntil: 'load' });
    if (withExtension) await settle(page, URL_);
    else await page.goto(URL_, { waitUntil: 'load' });
    return await page.evaluate(MEASURE);
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  }
}

const clean = await read(false);
const ours = await read(true);
server.close();

const names = Object.keys(clean);
const w = Math.max(...names.map((n) => n.length));
console.log(`\nns per call, median of ${ROUNDS} rounds of ${N} reads (this machine; only the ratio travels)\n`);
console.log('   ' + 'surface'.padEnd(w) + '   clean       ours        ratio');
let worst = null;
for (const n of names) {
  const ratio = ours[n] / clean[n];
  if (!worst || ratio > worst.ratio) worst = { n, ratio };
  console.log('   ' + n.padEnd(w) + '   ' + clean[n].toFixed(1).padStart(8) + '    ' + ours[n].toFixed(1).padStart(8) + '    ' +
    (ratio >= 3 ? 'x' : ' ') + ratio.toFixed(1).padStart(6));
}
console.log(`\n   x marks a read that costs 3x or more with the extension loaded; the worst is ` +
  `${worst.n} at ${worst.ratio.toFixed(1)}x.`);
console.log('   A native getter is a few nanoseconds; a Proxy + closure is tens to hundreds. Whether a');
console.log('   detector can use that depends on its own noise floor, which no one here has measured —');
console.log('   this is the number to bring to that argument, not the argument.\n');
