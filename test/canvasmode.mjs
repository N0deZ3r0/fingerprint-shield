/**
 * DO THE TWO CANVAS NOISE PATHS AGREE?
 *
 *   node test/canvasmode.mjs             headless
 *   node test/canvasmode.mjs --headed    watch it
 *
 * mw-canvas-audio.js has two implementations of the same noise — a JS one
 * (`_jsCanvasNoise`) and a WASM one (the instance background.js hands over, which
 * mw-canvas-audio takes off window immediately — see [FIX wasm-markers-were-client-litter],
 * so availability is read from `__t0.wasm` here) — and
 * `_resolveCanvasMode()` picks between them ONCE per page load, on the first canvas read.
 * Which one wins is a race: WASM is injected by background.js a moment after first paint,
 * so a page that reads a canvas early locks to `js` and one that reads late locks to
 * `wasm`. The comment above the call says "same hash formula either way".
 *
 * If that is true, the race is harmless. If it is not, then the same profile on the same
 * origin returns a different canvas hash depending on when the page happened to look —
 * which is what test/fpro-surface.mjs measured across two loads, with a clean browser
 * stable across the same pair.
 *
 * The two modes are forced rather than raced: `_resolveCanvasMode` returns 'js'
 * immediately when `window.__w2` is set, and 'wasm' once `__t0.wasm` says the instance
 * arrived. Both pages draw the identical image, on one origin, under one profile, so the
 * seed is the same by construction and the ONLY difference is which code noised it.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, loadBackground, loadPopup } from './harness.mjs';
const headed = process.argv.includes('--headed');
const { COUNTRY_DATA, afpPackFeatures } = loadBackground(['COUNTRY_DATA', 'afpPackFeatures']);
const { PROFILES } = loadPopup(['PROFILES']);

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

const ALL_ON = {
  canvas: true, webgl: true, webrtc: true, navigator: true, screen: true, timezone: true,
  geolocation: true, battery: true, fonts: true, clientRects: true, plugins: true,
  network: true, hideAdBlocker: true
};
const SEL = { id: 'laptop_low', cc: 'JP' };

// One drawing, defined once, used by both pages. No emoji and no web font: this has to
// measure the noise, not whether a colour-emoji face had finished loading.
const DRAW = `
  var c = document.createElement('canvas'); c.width = 240; c.height = 60;
  var x = c.getContext('2d');
  x.textBaseline = 'top'; x.font = '14px Arial'; x.fillStyle = '#f60';
  x.fillRect(1, 1, 90, 24); x.fillStyle = '#069'; x.fillText('Cwm fjord bank', 2, 15);
  x.strokeStyle = '#3a5'; x.beginPath(); x.arc(120, 30, 20, 0, Math.PI * 1.5); x.stroke();
  var s = c.toDataURL(), h = 5381, i;
  for (i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);`;

// force=js  : set __w2 before anything reads a canvas, so the mode locks to the JS path.
// force=wasm: wait for the WASM export to exist, then read, so it locks to the WASM path.
const page = (mode) => `<!doctype html><html><head><meta charset=utf-8></head><body>
<script>
${mode === 'js' ? 'try { window.__w2 = 1; } catch (e) {}' : ''}
window.__probe = (async function () {
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var waited = 0;
  if (${mode === 'wasm' ? 'true' : 'false'}) {
    for (var i = 0; i < 300; i++) {
      try { if (window.__t0 && window.__t0.wasm) break; } catch (e) {}
      await wait(20); waited += 20;
    }
  }
  var hash = (function () { ${DRAW} })();
  var got = 'unknown';
  try { got = (window.__t0 && window.__t0.wasm) ? 'wasm-available' : 'wasm-absent'; } catch (e) {}
  return { hash: hash, waited: waited, wasm: got };
})();
<\/script></body></html>`;

const server = createServer((q, r) => {
  const mode = /mode=wasm/.test(q.url || '') ? 'wasm' : 'js';
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    .end(page(mode));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const userDataDir = mkdtempSync(join(tmpdir(), 'afp-canvasmode-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

const out = {};
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));

  const p = PROFILES.find((x) => x.id === SEL.id);
  const c = COUNTRY_DATA[SEL.cc];
  await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
    afp_profile_id: p.id,
    afp_profile_data: { screenW: p.screenW, screenH: p.screenH, cores: p.cores,
      memory: p.memory, gpu: p.gpuKey, platform: p.platform },
    afp_country_code: SEL.cc, afp_resolved_timezone: c.tz,
    afp_resolved_locale: c.loc, afp_mode: 'normal', afp_features: ALL_ON
  });
  await new Promise((r) => setTimeout(r, 900));

  async function read(mode, label) {
    const pg = await ctx.newPage();
    await pg.goto(`http://127.0.0.1:${port}/?mode=${mode}`, { waitUntil: 'load' });
    const want = afpPackFeatures(ALL_ON);
    await pg.waitForFunction((w) => sessionStorage.getItem('v.ui.f') === w, want, { timeout: 10000 })
      .catch(() => {});
    await pg.reload({ waitUntil: 'load' });
    const r = await pg.evaluate(() => window.__probe);
    await pg.close();
    out[label] = r;
    console.log(`  ${label.padEnd(10)} hash ${r.hash.padEnd(10)} (waited ${r.waited}ms, ${r.wasm})`);
    return r;
  }

  console.log('');
  // Each mode twice, so "the two modes differ" is not confused with "either mode is
  // unstable on its own".
  await read('js', 'js #1');
  await read('js', 'js #2');
  await read('wasm', 'wasm #1');
  await read('wasm', 'wasm #2');
} finally {
  await ctx.close();
  rmSync(userDataDir, { recursive: true, force: true });
  server.close();
}

console.log('');
ok(out['js #1'].hash === out['js #2'].hash,
  `the JS path is stable across loads (${out['js #1'].hash} vs ${out['js #2'].hash})`);
ok(out['wasm #1'].hash === out['wasm #2'].hash,
  `the WASM path is stable across loads (${out['wasm #1'].hash} vs ${out['wasm #2'].hash})`);
// The claim under test.
ok(out['js #1'].hash === out['wasm #1'].hash,
  `the JS and WASM paths produce the SAME canvas — otherwise the hash depends on whether ` +
  `WASM had landed when the page first looked (js ${out['js #1'].hash}, wasm ${out['wasm #1'].hash})`);

// ── PART 2: the first load of a tab, in stealth ────────────────────────────────
// [FIX stealth-first-load-noised-the-canvas] The same question on a different axis: does
// the hash depend on WHICH LOAD of a tab looked? Stealth switches the canvas and fonts
// modules off, but the mode lives in sessionStorage per tab and a first load has none, so
// the first page of every new tab installed the normal-mode patches. Measured before the
// fix, stealth, one origin:
//     canvas  first load 2322357496, second 1576997145 (the machine REAL canvas)
//     text    first 137.7911/143.9413/124.8180, second 137.7891/143.9453/124.8203
// Two fingerprints for one site, the stable one being the host own. The effect sites ask
// MW.stealthNow() now instead of deciding at install time.
{
  const PAGE2 = `<!doctype html><html><body><script>
window.__m = (function () {
  var c = document.createElement('canvas'); c.width = 200; c.height = 40;
  var x = c.getContext('2d'); x.textBaseline = 'top'; x.font = '14px Arial';
  x.fillStyle = '#f60'; x.fillRect(0, 0, 100, 20); x.fillStyle = '#069'; x.fillText('mode 42', 2, 15);
  var s = c.toDataURL(); var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  var t = document.createElement('canvas').getContext('2d');
  var w = [];
  ['16px serif', '16px sans-serif', '16px monospace'].forEach(function (f) { t.font = f; w.push(t.measureText('mmmmmmmmmmlli').width.toFixed(4)); });
  var mode = null;
  try { mode = sessionStorage.getItem('v.ui.m'); } catch (e) { mode = 'ERR'; }
  return { canvas: h, text: w.join('/'), mode: mode };
})();
</script></body></html>`;
  const srv = createServer((q, r) =>
    r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE2));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const p2 = srv.address().port;
  const dir2 = mkdtempSync(join(tmpdir(), 'afp-stealthfirst-'));
  const ctx2 = await chromium.launchPersistentContext(dir2, {
    ...BROWSER, headless: !headed,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  try {
    const sw2 = ctx2.serviceWorkers()[0] || await ctx2.waitForEvent('serviceworker', { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 3000));
    await sw2.evaluate(async () => { await chrome.storage.local.set({ afp_mode: 'stealth' }); });
    await new Promise((r) => setTimeout(r, 2000));
    const page2 = await ctx2.newPage();
    await page2.goto(`http://127.0.0.1:${p2}/`, { waitUntil: 'load' });
    const one = await page2.evaluate(() => window.__m);
    await page2.reload({ waitUntil: 'load' });
    const two = await page2.evaluate(() => window.__m);
    console.log('');
    console.log('stealth, one tab: first  canvas ' + one.canvas + ' text ' + one.text + ' (v.ui.m=' + one.mode + ')');
    console.log('                  second canvas ' + two.canvas + ' text ' + two.text + ' (v.ui.m=' + two.mode + ')');
    ok(two.mode === 'stealth', 'the second load really ran as stealth (v.ui.m=' + two.mode + ')');
    ok(one.canvas === two.canvas,
      'stealth: a tab first load hashes the canvas like every load after it (' + one.canvas + ' vs ' + two.canvas + ')');
    ok(one.text === two.text,
      'stealth: and reports the same text metrics (' + one.text + ' vs ' + two.text + ')');
  } finally {
    await ctx2.close();
    try { rmSync(dir2, { recursive: true, force: true }); } catch { /* windows */ }
    srv.close();
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
