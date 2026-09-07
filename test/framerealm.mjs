/**
 * WHICH SURFACES REACH A CHILD REALM — per frame shape, read in the realm that is
 * actually measured.
 *
 *   node test/framerealm.mjs             headless
 *   node test/framerealm.mjs --headed    watch it
 *
 * Standalone diagnostic; deliberately NOT in test/all.mjs. It answers one question that
 * two earlier attempts got wrong by measuring the wrong realm:
 *
 *   FingerprintJS measures fontPreferences inside an iframe it creates with `srcdoc`
 *   (src/utils/dom.ts `withIframe`: `if (initialHtml && 'srcdoc' in iframe) iframe.srcdoc
 *   = initialHtml`, and font_preferences.ts passes initialHtml). An iframe has TWO realms
 *   in its life: the initial empty about:blank document created at append time, and the
 *   document that replaces it when srcdoc commits. Probing on first `contentWindow`
 *   access reads the FIRST one. The library measures in the SECOND one.
 *
 * So every shape below is snapshotted three times — initial document, committed document,
 * and after load with a body (what the library actually acts on) — and the three are
 * printed side by side. A difference between columns 1 and 3 is the whole story.
 *
 * `__t0.p` is the marker for "did mw-core bootstrap this realm": mw-core.js sets it
 * non-enumerable on every window it bootstraps and mw-cleanup deliberately leaves it, so
 * nothing has to be added to the shipped files to read this.
 *
 * NOTE ON THE OBSERVER EFFECT: reading `iframe.contentWindow` is itself the trigger for
 * mw-navigator's parent-side `_patchFrameAll` (it hooks that very getter). This probe
 * therefore cannot see the un-poked state — but neither can a fingerprinter, because
 * `withIframe` reads `iframe.contentWindow.document.readyState` too. The measurement is
 * faithful to what the library gets; it is not a measurement of "no hook".
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, loadBackground, loadPopup, bootSettled } from './harness.mjs';
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
// Chosen so cores and timezone cannot be confused with this machine's own.
const SEL = { id: 'laptop_low', cc: 'JP' };

const PAGE = `<!doctype html><html><head><meta charset=utf-8></head><body>
<script>
// Read one realm. Everything is taken from the frame's OWN globals — using the parent's
// Intl or the parent's document.createElement would measure the parent and look like a
// pass no matter what the frame does.
function snap(w) {
  var o = {}, T = function (k, fn) { try { o[k] = fn(); } catch (e) { o[k] = 'ERR:' + e.name; } };
  if (!w) return { dead: true };
  // [FIX two-marker-names-where-one-would-do] The bootstrap flag is a FIELD of __t0 now,
  // not a global of its own: the window carried two names a page could test for and now
  // carries one. Read through the new place, so this suite fails if the move regresses.
  T('p0',    function () { return !!(w.__t0 && w.__t0.p); });
  T('mw',    function () { return !!w.__AFP_MW__; });
  T('cores', function () { return w.navigator.hardwareConcurrency; });
  T('tz',    function () { return w.Intl.DateTimeFormat().resolvedOptions().timeZone; });
  T('off',   function () { return new (w.Date)(2026, 0, 15).getTimezoneOffset(); });
  T('scr',   function () { return w.screen.width + 'x' + w.screen.height; });
  // fontPreferences' own 'default' preset: no font-family at all, only whiteSpace. This is
  // the row that carries the host's default face, and the row a gate keyed on "the element
  // names a font" can never see.
  T('fontDefault', function () {
    var d = w.document; if (!d || !d.body) return 'nobody';
    var s = d.createElement('span');
    s.textContent = 'mmMwWLliI0fiflO&1';
    s.style.fontSize = '48px'; s.style.whiteSpace = 'nowrap';
    s.style.position = 'absolute'; s.style.left = '-9999px';
    d.body.appendChild(s);
    var v = s.getBoundingClientRect().width;
    d.body.removeChild(s);
    return v;
  });
  T('fontSerif', function () {
    var d = w.document; if (!d || !d.body) return 'nobody';
    var s = d.createElement('span');
    s.textContent = 'mmMwWLliI0fiflO&1';
    s.style.fontSize = '48px'; s.style.whiteSpace = 'nowrap';
    s.style.fontFamily = 'serif';
    s.style.position = 'absolute'; s.style.left = '-9999px';
    d.body.appendChild(s);
    var v = s.getBoundingClientRect().width;
    d.body.removeChild(s);
    return v;
  });
  T('canvas', function () {
    var d = w.document; if (!d) return 'nodoc';
    var c = d.createElement('canvas'); c.width = 200; c.height = 50;
    var x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '14px Arial'; x.fillStyle = '#f60';
    x.fillRect(1, 1, 90, 24); x.fillStyle = '#069'; x.fillText('Cwm fjord', 2, 15);
    var s = c.toDataURL(), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  });
  return o;
}

var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

// One shape, three snapshots. \`build\` gets the bare iframe and sets whatever makes this
// shape what it is, BEFORE it is appended.
async function shape(name, build) {
  var out = { name: name };
  var ifr = document.createElement('iframe');
  // withIframe's own styling, kept because layout affects text measurement.
  ifr.style.setProperty('display', 'block', 'important');
  ifr.style.position = 'absolute'; ifr.style.top = '0'; ifr.style.left = '0';
  ifr.style.visibility = 'hidden';
  build(ifr);
  document.body.appendChild(ifr);

  // (1) the initial empty document, read the way the earlier probe read it
  var d0 = null;
  try { d0 = ifr.contentDocument; } catch (e) {}
  out.initial = snap(ifr.contentWindow);

  // (2) the document that REPLACES it. Identity change is the signal; a shape that never
  // navigates (no src, no srcdoc) simply keeps the same one, and that is a result too.
  var swapped = false;
  for (var i = 0; i < 200; i++) {
    var dN = null;
    try { dN = ifr.contentDocument; } catch (e2) {}
    if (dN && dN !== d0) { swapped = true; break; }
    await wait(10);
  }
  out.swapped = swapped;
  out.committed = snap(ifr.contentWindow);

  // (3) what the library acts on: readyState complete AND a body present, which is exactly
  // withIframe's two wait conditions.
  for (var j = 0; j < 200; j++) {
    var w = null;
    try { w = ifr.contentWindow; } catch (e3) {}
    if (w && w.document && w.document.readyState === 'complete' && w.document.body) break;
    await wait(10);
  }
  out.measured = snap(ifr.contentWindow);

  if (ifr.parentNode) ifr.parentNode.removeChild(ifr);
  return out;
}

window.__run = (async function () {
  var FPJS_HTML = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>';
  var res = [];
  // The shape FingerprintJS actually uses for fontPreferences.
  res.push(await shape('srcdoc (fpjs)', function (f) { f.srcdoc = FPJS_HTML; }));
  // withIframe's fallback when srcdoc is unavailable.
  res.push(await shape('src=about:blank', function (f) { f.src = 'about:blank'; }));
  // Never navigated: the initial empty document is the only realm there is.
  res.push(await shape('no src', function () {}));
  res.push(await shape('src=same-origin', function (f) { f.src = '/child.html'; }));
  // The one shape the canvas bridge in mw-canvas-audio.js deliberately covers.
  res.push(await shape('sandbox (scriptless)', function (f) {
    f.setAttribute('sandbox', 'allow-same-origin');
    f.srcdoc = FPJS_HTML;
  }));
  return { top: snap(window), frames: res };
})();
<\/script></body></html>`;

const CHILD = '<!doctype html><html><head><meta charset=utf-8></head><body>child</body></html>';

const server = createServer((q, r) => {
  const body = q.url && q.url.startsWith('/child') ? CHILD : PAGE;
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const userDataDir = mkdtempSync(join(tmpdir(), 'afp-framerealm-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

let R;
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(sw);

  const p = PROFILES.find((x) => x.id === SEL.id);
  const c = COUNTRY_DATA[SEL.cc];
  if (!p) throw new Error('no such profile: ' + SEL.id);
  if (!c) throw new Error('no such country: ' + SEL.cc);
  await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
    afp_profile_id: p.id,
    afp_profile_data: { screenW: p.screenW, screenH: p.screenH, cores: p.cores,
      memory: p.memory, gpu: p.gpuKey, platform: p.platform },
    afp_country_code: SEL.cc, afp_resolved_timezone: c.tz,
    afp_resolved_locale: c.loc, afp_mode: 'normal', afp_features: ALL_ON
  });
  await new Promise((r) => setTimeout(r, 900));

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('  pageerror:', e.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  const want = afpPackFeatures(ALL_ON);
  const arrived = await page
    .waitForFunction((w) => sessionStorage.getItem('v.ui.f') === w, want, { timeout: 10000 })
    .then(() => true).catch(() => false);
  ok(arrived, 'the flags reached the page before the reload');
  await page.reload({ waitUntil: 'load' });
  R = await page.evaluate(() => window.__run);
} finally {
  await ctx.close();
  rmSync(userDataDir, { recursive: true, force: true });
  server.close();
}

// The rig has to have spoofed the TOP frame, or every child column is trivially "wrong"
// for a reason that has nothing to do with frames.
const T = R.top;
console.log(`\ntop frame   p0=${T.p0}  cores=${T.cores}  tz=${T.tz}  fontDefault=${T.fontDefault}`);
ok(T.p0 === true, 'the top frame is bootstrapped (__t0.p)');
ok(String(T.cores) === String(PROFILES.find((x) => x.id === SEL.id).cores),
  `the top frame reports the profile's cores (got ${T.cores})`);

const KEYS = ['p0', 'cores', 'tz', 'fontDefault', 'canvas'];
for (const f of R.frames) {
  console.log(`\n=== ${f.name}${f.swapped ? '' : '   (realm never swapped)'} ===`);
  console.log(`    ${'key'.padEnd(13)} ${'initial'.padEnd(24)} ${'committed'.padEnd(24)} measured`);
  for (const k of KEYS) {
    const a = String(f.initial[k]), b = String(f.committed[k]), c2 = String(f.measured[k]);
    const flag = (a === c2) ? '  ' : ' *';
    console.log(`${flag}  ${k.padEnd(13)} ${a.padEnd(24)} ${b.padEnd(24)} ${c2}`);
  }
}

// The claim under test, stated as assertions so it cannot be read off a wall of numbers.
// Each is about the MEASURED realm — the one the library acts on, never the initial one.
//
// A scriptless sandbox is the one shape where `p0` is expected to stay false: the frame
// forbids scripts, so no content script can run there by definition and the parent-side
// bridges are the only cover it will ever have. Asserting p0 there would be asserting that
// the browser breaks its own sandbox. What still has to hold is the OBSERVABLE surface —
// a child that answers differently from its parent is a contradiction whether or not our
// code was allowed to run in it.
console.log('');
const SCRIPTLESS = 'sandbox (scriptless)';
for (const f of R.frames) {
  const m = f.measured;
  if (f.name !== SCRIPTLESS) {
    ok(m.p0 === true, `${f.name}: mw-core bootstrapped the measured realm (__t0.p)`);
  }
  ok(String(m.cores) === String(T.cores),
    `${f.name}: measured realm agrees with the top frame on cores (${m.cores} vs ${T.cores})`);
  ok(String(m.tz) === String(T.tz),
    `${f.name}: measured realm agrees with the top frame on timezone (${m.tz} vs ${T.tz})`);
  ok(String(m.canvas) === String(T.canvas),
    `${f.name}: measured realm agrees with the top frame on the canvas hash`);
}

// Text metrics, kept apart from the loop because this is the one that is currently WRONG
// and a known-failing assertion buried in a loop reads as noise. The parent-side frame
// patcher in mw-navigator.js covers navigator, screen, UAD, voices, battery and Intl/Date;
// the canvas bridge in mw-canvas-audio.js covers scriptless sandboxes. Nothing covers text
// measurement, so a scriptless sandbox lays text out with the font module absent and its
// width disagrees with the parent's.
console.log('');
const fontMismatch = R.frames.filter((f) => String(f.measured.fontDefault) !== String(T.fontDefault));
for (const f of fontMismatch) {
  console.log(`  text metrics differ from top in "${f.name}": ${f.measured.fontDefault} vs ${T.fontDefault}`);
}
const KNOWN_FONT_GAP = [SCRIPTLESS];
const unexpected = fontMismatch.map((f) => f.name).filter((n) => KNOWN_FONT_GAP.indexOf(n) === -1);
ok(unexpected.length === 0,
  `no frame shape outside the known gap disagrees on text metrics: ${unexpected.join(', ') || 'none'}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
