/**
 * A COMPOUND MEDIA QUERY MUST MEAN WHAT THE CSS ENGINE SAYS IT MEANS.
 *
 *   node test/mediacompound.mjs             headless
 *   node test/mediacompound.mjs --headed    watch it
 *
 * [FIX a-compound-query-was-answered-from-one-word-inside-it] mw-misc's matchMedia patch
 * recognises a query by looking for feature names ANYWHERE in the string. That is right for
 * the single feature test it was written for and wrong for every query a responsive
 * framework actually writes. Measured at 1600x900, against the engine on the same page:
 *
 *     screen and (min-width:600px) and (max-width:899.95px)   js=true   css=false
 *     (min-resolution:1.5dppx) and (min-width:900px)          js=true   css=false
 *     not all and (min-width:900px)                           js=true   css=false
 *
 * The third is the one that shows what kind of answer it was. No browser says true to
 * `not all and …`; that was not a spoof with a cost, it was a parser reporting on syntax it
 * had not parsed.
 *
 * It was reported as a broken booking site, not as a fingerprint finding: on
 * georgian-airways.com the widget asks the first query to choose between its desktop
 * calendar and its dialog one, got true from matchMedia and false from the CSS that lays the
 * page out, and rendered BOTH. The dialog's container covers the viewport, so every click on
 * a date hit the overlay and the panel closed with nothing chosen — "the dates are there and
 * I cannot pick one". 266 day cells against a clean browser's 133.
 *
 * WHY THE EXISTING MEDIA SUITE DID NOT CATCH IT: dev-mediaparity.html asks every FEATURE
 * twice, one feature at a time, and every single-feature query agreed. The defect lives
 * entirely in the step where several of them are combined, which nothing asked for.
 *
 * THE CLEAN BROWSER IS THE CONTROL for every row. The assertion is "we answer what it
 * answers", not "we answer false": a future change that starts refusing too much fails here
 * too. And section 3 is the negative control for the fix itself — a query made only of
 * features this build DOES own must still be spoofed, or the fix would have passed by
 * switching the module off.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harness, root, BROWSER, langArgs, bootSettled } from './harness.mjs';

const headed = process.argv.includes('--headed');
const { assert, eq, section, note, done } = harness();
const VW = 1600, VH = 900;

// Shapes a real responsive framework writes. MUI's breakpoints are the first three; the
// rest are the syntax the patch must not pretend to understand.
const COMPOUND = [
  'screen and (min-width:600px) and (max-width:899.95px)',
  'screen and (min-width:900px) and (max-width:1199.95px)',
  'screen and (min-width:1200px)',
  'only screen and (max-width:899.95px)',
  'not all and (min-width:900px)',
  '(min-width:900px) and (hover:hover)',
  '(max-width:899.95px) and (pointer:coarse)',
  '(min-resolution:1.5dppx) and (min-width:900px)',
  '(min-width:600px) and (max-width:899.95px) and (orientation:landscape)',
  '(max-width:599.95px), (min-width:1536px)',
  'print and (min-width:900px)',
  '(hover:hover) and (pointer:fine) and (min-width:900px)'
];

// The single features the patch is actually about. Section 3 holds these to the clean
// browser's answers: the fix narrows WHICH queries the patch may answer, and it must not
// have changed what it answers for the ones it still owns.
//
// A divergence-based control was tried first and removed, because it would have asserted
// something untrue on this rig: measured across hover, any-hover, pointer, any-pointer,
// update, color-gamut, dynamic-range, forced-colors, inverted-colors, resolution,
// prefers-reduced-motion and orientation, this build currently answers every single-feature
// query exactly as the engine does. There is no live spoof here to protect, so a test
// claiming to protect one would be decoration.
const SINGLE = [
  '(hover:hover)', '(hover:none)', '(any-hover:hover)', '(pointer:fine)', '(pointer:coarse)',
  '(any-pointer:fine)', '(update:fast)', '(color-gamut:srgb)', '(color-gamut:p3)',
  '(dynamic-range:standard)', '(dynamic-range:high)', '(forced-colors:active)',
  '(inverted-colors:inverted)', '(min-resolution:1.5dppx)', '(-webkit-min-device-pixel-ratio:1.5)',
  '(prefers-reduced-motion:reduce)', '(orientation:landscape)'
];

const PAGE = `<!doctype html><meta charset="utf-8"><title>mediacompound</title><body><script>
window.ASK = function (list) {
  var out = {};
  for (var i = 0; i < list.length; i++) {
    var q = list[i];
    var id = 'p' + i;
    var st = document.createElement('style');
    st.textContent = '#' + id + '{--m:0}@media ' + q + '{#' + id + '{--m:1}}';
    var d = document.createElement('div');
    d.id = id;
    document.documentElement.appendChild(st);
    document.documentElement.appendChild(d);
    var css = getComputedStyle(d).getPropertyValue('--m').trim() === '1';
    st.remove(); d.remove();
    var js;
    try { js = window.matchMedia(q).matches; } catch (e) { js = 'THREW ' + e.name; }
    out[q] = { js: js, css: css };
  }
  return out;
};
<\/script>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;

async function ask(ctx, list) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: VW, height: VH });
  await p.goto(URL0, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 300));
  const out = await p.evaluate((l) => window.ASK(l), list);
  const meta = await p.evaluate(() => ({ w: innerWidth, h: innerHeight, scr: screen.width + 'x' + screen.height }));
  await p.close();
  return { out, meta };
}

const cleanBrowser = await chromium.launch({ ...BROWSER, headless: !headed });
const clean = await ask(await cleanBrowser.newContext(), COMPOUND.concat(SINGLE));
await cleanBrowser.close();

const dir = mkdtempSync(path.join(tmpdir(), 'afp-mediacompound-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, ...langArgs()]
});
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(sw);
  const ours = await ask(ctx, COMPOUND.concat(SINGLE));

  section('0) the control: a clean browser never contradicts itself');
  for (const q of COMPOUND) {
    const r = clean.out[q];
    eq(r.js, r.css, `clean: ${q} — matchMedia ${r.js}, CSS ${r.css}`);
  }
  note(`clean window ${clean.meta.w}x${clean.meta.h}, screen ${clean.meta.scr}`);

  section('1) and neither does this build, on a compound query');
  for (const q of COMPOUND) {
    const r = ours.out[q];
    eq(r.js, r.css,
      `${q} — matchMedia says ${r.js}, the CSS engine says ${r.css}. A query carrying a ` +
      'width this build does not spoof must be answered by the engine, whole, rather than ' +
      'from a feature name recognised somewhere inside it');
  }

  section('2) and it answers what the clean browser answers');
  for (const q of COMPOUND) {
    eq(ours.out[q].css, clean.out[q].css, `${q}: the engine agrees across the two browsers`);
    eq(ours.out[q].js, clean.out[q].js, `${q}: and so does matchMedia`);
  }
  note(`ours window ${ours.meta.w}x${ours.meta.h}, screen ${ours.meta.scr} — the screen is ` +
    'still spoofed, so this is not passing because the module stood down');

  section('3) the single features the patch still owns are untouched by the fix');
  for (const q of SINGLE) {
    eq(ours.out[q].js, clean.out[q].js,
      `${q}: matchMedia answers what a clean browser answers (${ours.out[q].js})`);
    eq(ours.out[q].js, ours.out[q].css,
      `${q}: and agrees with this page's own CSS engine`);
  }
  note('the fix narrows which queries the patch may answer, not what it answers for its own');
} finally {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
  server.close();
}
done();
