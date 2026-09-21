/**
 * AN IFRAME MUST COST THE SAME THE THOUSANDTH TIME THE PAGE MUTATES AS THE FIRST.
 *
 *   node test/framescan.mjs             headless
 *   node test/framescan.mjs --headed    watch it
 *
 * Reported as "the YouTube page hangs and does not come back". youtube.com keeps a handful
 * of hidden same-origin iframes and never stops mutating its DOM, and the parent-side frame
 * patch runs for every iframe on every mutation batch (plus a 1.5 s timer). Two things were
 * wrong with that, and the second one is what made it a hang rather than a slowdown:
 *
 *   1. [FIX frame-getters-were-wrapped-again-on-every-scan] _defWinProp installed a new
 *      getter on TOP of the one it found, seventeen properties per frame per scan. Each
 *      layer became the next one's `orig` and `oracle`, and the oracle probe walks every
 *      layer already there — so patch number N cost O(N) and the tab got slower for as long
 *      as it lived. Measured, overhead on top of a clean browser, one hidden iframe:
 *
 *          batches    50    100   200   400
 *          overhead   0.35  1.0   3.3   14 s         (six iframes, 150 batches: 15 s vs 1.4 s)
 *
 *   2. [FIX two-full-document-scans-per-mutation-batch] mw-navigator.js and
 *      mw-canvas-audio.js each ran document.querySelectorAll('iframe') over the WHOLE
 *      document per batch. Small beside (1), but linear in the size of the page, twice.
 *
 * TWO CHECKS, because one of them is structural and the other is a smoke alarm:
 *
 *   STRUCTURE  the getter this extension installs on a frame's Navigator.prototype is the
 *              SAME function object after a burst of mutation batches as before it. Before
 *              the fix every scan replaced it, so this is false by construction — no clock
 *              involved, nothing to flake. The frame must still answer the profile.
 *   COST       the same churn with six frames costs at most 3x a clean browser plus a flat
 *              second. Unfixed this build was 11x. The loose bound is the same argument
 *              test/costceiling.mjs makes: a wall-clock assertion on this rig catches an
 *              order-of-magnitude blowup and nothing finer.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harness, root, BROWSER, langArgs, bootSettled } from './harness.mjs';

const headed = process.argv.includes('--headed');
const { assert, eq, section, note, done } = harness();

const PAGE = `<!doctype html><meta charset="utf-8"><title>framescan</title><body><div id="app"></div><script>
window.T = {
  frames: function (n) {
    var app = document.getElementById('app');
    window.__f = [];
    for (var i = 0; i < n; i++) {
      var f = document.createElement('iframe'); f.style.display = 'none';
      app.appendChild(f); window.__f.push(f);
    }
    // a page that already has some weight, the way every real one does
    for (var j = 0; j < 8000; j++) { var d = document.createElement('div'); d.innerHTML = '<span>a</span><span>b</span>'; app.appendChild(d); }
  },
  churn: function (batches) {
    return new Promise(function (res) {
      var app = document.getElementById('app'), t0 = performance.now(), b = 0;
      (function step() {
        if (b++ >= batches) return res(performance.now() - t0);
        var frag = document.createDocumentFragment();
        for (var i = 0; i < 40; i++) { var e = document.createElement('div'); for (var k = 0; k < 12; k++) e.appendChild(document.createElement('span')); frag.appendChild(e); }
        app.appendChild(frag);
        setTimeout(step, 0);
      })();
    });
  },
  getters: function () {
    return window.__f.map(function (f) {
      var np = f.contentWindow.Navigator.prototype;
      return Object.getOwnPropertyDescriptor(np, 'hardwareConcurrency').get;
    });
  }
};
<\/script>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;

const BATCHES = 150, FRAMES = 6;
async function run(ctx, structural) {
  const p = await ctx.newPage();
  await p.goto(URL0, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  await p.evaluate((n) => T.frames(n), FRAMES);
  let out = { ms: 0 };
  if (structural) {
    // the frames are hooked synchronously when the page first reaches into them
    await p.evaluate(() => { window.__g0 = T.getters(); });
    await new Promise((r) => setTimeout(r, 300));
  }
  out.ms = await p.evaluate((b) => T.churn(b), BATCHES);
  if (structural) {
    out.same = await p.evaluate(() => {
      const before = window.__g0, after = T.getters();
      return before.map((g, i) => g === after[i]);
    });
    out.cores = await p.evaluate(() => ({
      win: navigator.hardwareConcurrency,
      frames: window.__f.map((f) => f.contentWindow.navigator.hardwareConcurrency)
    }));
  }
  await p.close();
  return out;
}

const cleanBrowser = await chromium.launch({ ...BROWSER, headless: !headed });
const clean = await run(await cleanBrowser.newContext(), false);
await cleanBrowser.close();

const dir = mkdtempSync(path.join(tmpdir(), 'afp-framescan-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, ...langArgs()]
});
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(sw);
  const ours = await run(ctx, true);

  section('structure: the frame getter is not replaced by a scan');
  eq(ours.same.length, FRAMES, `all ${FRAMES} frames were read`);
  ours.same.forEach((s, i) => assert(s,
    `frame ${i}: Navigator.prototype.hardwareConcurrency getter is the same function object after ` +
    `${BATCHES} mutation batches — a scan that re-wraps it stacks one more layer per pass`));
  assert(ours.cores.frames.every((c) => c === ours.cores.win),
    `and every frame still answers what the window does (${ours.cores.win}; frames ${ours.cores.frames.join(',')})`);

  section('cost: six hidden frames under sustained mutation');
  const budget = clean.ms * 3 + 1000;
  note(`clean ${clean.ms.toFixed(0)} ms, ours ${ours.ms.toFixed(0)} ms, budget ${budget.toFixed(0)} ms`);
  assert(ours.ms <= budget,
    `${BATCHES} batches over a page with ${FRAMES} iframes take ${ours.ms.toFixed(0)} ms against ` +
    `${clean.ms.toFixed(0)} ms clean — over ${budget.toFixed(0)}. Unfixed this was ~11x.`);
} finally {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
  server.close();
}
done();
