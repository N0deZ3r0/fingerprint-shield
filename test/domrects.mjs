/**
 * DOES THE DOM RECT NOISE HIDE ANYTHING, OR DOES IT CREATE SOMETHING?
 *
 *   node test/domrects.mjs             headless
 *   node test/domrects.mjs --headed    watch it
 *
 * Standalone, not in test/all.mjs.
 *
 * `clientRects` is the one feature that defaults to FALSE (defaults.js), so the DOM path —
 * a span measured with getBoundingClientRect, which is exactly how Fingerprint Pro reads
 * fontPreferences — ships unnoised. Every other suite here drives the extension with
 * ALL_ON, so the shipped default has never actually been measured.
 *
 * The question is not "is the noise strong enough". It is whether the noise should exist at
 * all, and that turns on one fact this project can now check: two Windows machines, same
 * browser, extension off, at dpr 1 agreed on EVERY generic font metric to the last digit
 * (tools/diff-metrics.mjs — 175 fields, 11 differ, none of them these). A value that is
 * already identical everywhere carries no entropy to hide. Perturbing it cannot make a user
 * harder to recognise; it can only move them off the value everyone else reports.
 *
 * That is the same trade the AudioContext noise lost (unique 5000/5000 samples against a
 * natural 4736) and the same one the flat-red-rect canvas noise lost. So this suite asks
 * all three questions at once:
 *
 *   1. does a clean browser here match the OTHER machine's recorded values?
 *        -> if yes, the un-noised surface is already cross-machine identical
 *   2. does the extension AT ITS DEFAULTS match a clean browser?
 *        -> if yes, the shipped default is the safe one
 *   3. does clientRects:true move us OFF that shared value?
 *        -> if yes, enabling it makes the user unique rather than anonymous
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, loadBackground, loadPopup } from './harness.mjs';
const headed = process.argv.includes('--headed');
const { COUNTRY_DATA, afpPackFeatures, afpCloneFeatures, AFP_DEFAULT_FEATURES } =
  loadBackground(['COUNTRY_DATA', 'afpPackFeatures', 'afpCloneFeatures', 'AFP_DEFAULT_FEATURES']);
const { PROFILES } = loadPopup(['PROFILES']);

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

const SEL = { id: 'laptop_low', cc: 'JP' };

// Recorded from the second machine (NVIDIA RTX 3060, 8 cores, Windows, Edge 151,
// extension OFF, devicePixelRatio 1) with tools/collect-metrics.html. Hardcoded on purpose:
// the whole argument rests on these being the values a DIFFERENT machine reports, so they
// have to be pinned here rather than re-derived from whatever this box happens to say.
//
// `mono` is deliberately absent. It is the one generic the two machines disagreed about
// (Courier New vs Consolas) and it is now pinned via chrome.fontSettings — which headless
// Chromium stores but does not render with, so it would fail here for a reason that has
// nothing to do with rect noise. It is covered by test/fontpin.mjs --headed.
const OTHER_MACHINE = {
  'default@48': 443.578125,
  'serif@48': 447.9375,
  'sans@48': 432.03125,
  'system@48': 443.578125,
  'cursive@48': 474.984375,
  'fantasy@48': 389.984375,
  'default@16': 147.859375,
  'serif@16': 149.3125,
  'sans@16': 144.015625
};

// `default@*` stays in the table and in the defaults/clientRects assertions, but is
// EXCLUDED from the cross-machine one. The fixture numbers were recorded through
// tools/collect-metrics.html, whose own stylesheet sets `body { font: 14px/1.6
// -apple-system, Segoe UI, Arial, sans-serif }` — the no-font-family preset inherits it,
// so the recorded 443.578125 is the PAGE's Segoe UI (note it equals the fixture's
// system@48, and the machine-B dump's `default.resolved` names that exact stack). The
// probe page below carries no author CSS, so `default` here resolves to the browser's
// real standard font (Times New Roman, = serif@48). Comparing the two measures the
// collect-page's CSS, not the machine. Same shape as the `mono` exclusion above; proven
// 2026-08-17 against the machine-B dump, and collect-metrics.html measures with
// font-family:initial on the host since probeVersion 6 so future fixtures won't carry it.
const CROSS_MACHINE_SKIP = new Set(['default@48', 'default@16']);

const PAGE = `<!doctype html><html><head><meta charset=utf-8></head><body>
<script>
// The fontPreferences presets, measured through DOM layout at FULL precision — no
// rounding, because rounding is what hid this the last time it was looked at.
window.__probe = (function () {
  var presets = {
    'default': {}, 'serif': { fontFamily: 'serif' }, 'sans': { fontFamily: 'sans-serif' },
    'system': { fontFamily: 'system-ui' }, 'cursive': { fontFamily: 'cursive' },
    'fantasy': { fontFamily: 'fantasy' }
  };
  var host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
  document.body.appendChild(host);
  var out = {};
  [48, 16].forEach(function (size) {
    Object.keys(presets).forEach(function (name) {
      var s = document.createElement('span');
      s.textContent = 'mmMwWLliI0fiflO&1';
      s.style.cssText = 'font-size:' + size + 'px;font-style:normal;font-weight:normal;' +
                        'letter-spacing:normal;white-space:nowrap;line-height:normal';
      var p = presets[name];
      Object.keys(p).forEach(function (k) { s.style[k] = p[k]; });
      host.appendChild(s);
      out[name + '@' + size] = s.getBoundingClientRect().width;
    });
  });
  host.remove();
  out.dpr = devicePixelRatio;
  return out;
})();
<\/script></body></html>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// TWO clean controls, one per comparison, because each comparison is only valid inside a
// single browser. The extension runs on Chromium here, so the defaults/clientRects columns
// are compared against Chromium; the recorded reference was collected in Edge, so the
// cross-machine column is compared against Edge. Mixing them once already produced a false
// failure on `default@*` — the generic with no font-family named, which resolves to
// whatever that BROWSER picked as its standard face (a serif in Chromium, Segoe UI in
// Edge) and says nothing about the machine.
async function collectClean(channel) {
  const b = await chromium.launch({ channel, headless: !headed });
  const pg = await (await b.newContext()).newPage();
  await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 700));
  const out = await pg.evaluate(() => window.__probe);
  await b.close();
  return out;
}
const CLEAN = await collectClean('chromium');
let CLEAN_EDGE = null;
try { CLEAN_EDGE = await collectClean('msedge'); }
catch (e) { console.log('  (no Edge on this box — the cross-machine check is skipped)'); }

const userDataDir = mkdtempSync(join(tmpdir(), 'afp-domrects-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

let DEF, CR;
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  const p = PROFILES.find((x) => x.id === SEL.id);
  const c = COUNTRY_DATA[SEL.cc];

  async function run(features, label) {
    await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
      afp_profile_id: p.id,
      afp_profile_data: { screenW: p.screenW, screenH: p.screenH, cores: p.cores,
        memory: p.memory, gpu: p.gpuKey, platform: p.platform },
      afp_country_code: SEL.cc, afp_resolved_timezone: c.tz,
      afp_resolved_locale: c.loc, afp_mode: 'normal', afp_features: features
    });
    await new Promise((r) => setTimeout(r, 900));
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    const want = afpPackFeatures(features);
    const arrived = await page
      // [FIX default-config-still-left-two-keys] The key is written only when the flags
      // are NOT the defaults, and removed otherwise — a clean Chrome stores nothing on a
      // fresh origin, so a key repeating the default was a free detector. A default run
      // must therefore wait for the key to be ABSENT. Waiting for a value there hung for
      // the full timeout and reported the FLAGS as late, which names the wrong thing:
      // the writer had correctly declined to write them.
      .waitForFunction(([w, absent]) => sessionStorage.getItem('v.ui.f') === (absent ? null : w),
        [want, want === afpPackFeatures(AFP_DEFAULT_FEATURES)], { timeout: 10000 })
      .then(() => true).catch(() => false);
    ok(arrived, `${label}: the flags reached the page before the reload`);
    await page.reload({ waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 700));
    const out = await page.evaluate(() => window.__probe);
    await page.close();
    return out;
  }

  const defaults = afpCloneFeatures();
  ok(defaults.clientRects === false, 'clientRects really is off in the shipped defaults');
  DEF = await run(defaults, 'defaults');
  CR = await run(Object.assign(afpCloneFeatures(), { clientRects: true }), 'clientRects:true');
} finally {
  await ctx.close();
  rmSync(userDataDir, { recursive: true, force: true });
  server.close();
}

const KEYS = Object.keys(OTHER_MACHINE);
const eq = (a, b) => KEYS.filter((k) => String(a[k]) !== String(b[k]));

console.log(`\n  dpr — clean ${CLEAN.dpr}   defaults ${DEF.dpr}   clientRects:true ${CR.dpr}\n`);
console.log(`  ${'key'.padEnd(13)} ${'other machine'.padEnd(20)} ${'clean Edge here'.padEnd(20)} ${'clean Chromium'.padEnd(20)} ${'defaults'.padEnd(20)} clientRects:true`);
for (const k of KEYS) {
  const flag = String(CR[k]) !== String(CLEAN[k]) ? ' *' : '  ';
  console.log(`${flag} ${k.padEnd(13)} ${String(OTHER_MACHINE[k]).padEnd(20)} ` +
    `${String(CLEAN_EDGE ? CLEAN_EDGE[k] : '-').padEnd(20)} ${String(CLEAN[k]).padEnd(20)} ` +
    `${String(DEF[k]).padEnd(20)} ${CR[k]}`);
}

// 1. Is the un-noised surface already the same on two different machines? Compared in the
// browser the reference was recorded in, never across browsers.
console.log('');
if (CLEAN_EDGE) {
  const vsOther = eq(CLEAN_EDGE, OTHER_MACHINE).filter((k) => !CROSS_MACHINE_SKIP.has(k));
  ok(vsOther.length === 0,
    `a clean Edge here reports the SAME generic font metrics as the other machine's Edge — ` +
    `so there is no per-machine entropy in them to hide (differing: ${vsOther.join(', ') || 'none'})`);
}

// 2. Does the shipped default leave that shared value alone?
const defVsClean = eq(DEF, CLEAN);
ok(defVsClean.length === 0,
  `at its DEFAULTS the extension reports exactly the clean value, i.e. the same number every ` +
  `other machine reports (differing: ${defVsClean.join(', ') || 'none'})`);

// 3. And does turning clientRects on move the user off it?
const crVsClean = eq(CR, CLEAN);
console.log(`\n  clientRects:true moves ${crVsClean.length} of ${KEYS.length} metrics off the value ` +
  `every clean machine reports.`);
if (crVsClean.length) {
  console.log('  Those are values no other browser on the web produces — the noise is not hiding');
  console.log('  entropy here, it is minting it. Same trade the AudioContext noise lost.');
}
// Stated as a readout rather than a pass/fail line: whether that is acceptable is a product
// decision about what clientRects is FOR (it also covers element geometry, not just text),
// and this suite deliberately does not pretend to make it.
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
