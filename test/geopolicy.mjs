/**
 * Geolocation must stay refused where the platform refuses it.
 *
 *   node test/geopolicy.mjs             headless
 *   node test/geopolicy.mjs --headed    watch it
 *
 * [FIX geolocation-ignored-permissions-policy] mw/mw-geo.js replaced getCurrentPosition
 * with a function that called `success` after 20 ms unconditionally. It never read the
 * Permissions-Policy, never read the permission state, and never called `error` at all —
 * the parameter was accepted and dropped. mw/mw-misc.js meanwhile forced
 * PermissionStatus.state to 'granted' for geolocation in every case. Measured against a
 * clean browser on the same machine, one page served `Permissions-Policy: geolocation=()`:
 *
 *                                              clean            extension
 *     featurePolicy.allowsFeature('geolocation')  false            false
 *     permissions.query(...).state                denied           granted
 *     getCurrentPosition                          error 1          SUCCESS, Tallinn
 *
 * Two things wrong at once. It is a detection signal — a resolved position beside
 * allowsFeature() === false is a pair no browser produces — and, before that, a consent
 * failure: the extension handed out a position the platform had already refused.
 *
 * THE SHAPE THAT MATTERS IS NOT THE HEADER. It is a cross-origin iframe embedded without
 * allow="geolocation", which is how ads, widgets and embeds are normally framed. Both are
 * covered below, because the header is the easy one to write and the iframe is the one
 * that actually happens.
 *
 * The clean browser is the control for every row: the assertion is "we behave as it does",
 * not "we return some error", so a future change that starts refusing too much fails here
 * too. On the unrestricted page the two are SUPPOSED to differ — that is the module doing
 * its job — and the coordinates are checked against the selected country there.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, loadBackground, loadPopup, bootSettled } from './harness.mjs';
const headed = process.argv.includes('--headed');
const { COUNTRY_DATA } = loadBackground(['COUNTRY_DATA']);
const { PROFILES } = loadPopup(['PROFILES']);

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('  FAIL:', m); failed++; } };

const PROFILE_ID = 'laptop_mid', CC = 'EE';
const P = PROFILES.find((x) => x.id === PROFILE_ID);
const C = COUNTRY_DATA[CC];

const PROBE = `<script>
window.__probe = (async function () {
  var o = {};
  try {
    var fp = document.featurePolicy || document.permissionsPolicy;
    o.allowed = (fp && typeof fp.allowsFeature === 'function') ? fp.allowsFeature('geolocation') : 'n/a';
  } catch (e) { o.allowed = 'ERR'; }
  try { o.state = (await navigator.permissions.query({ name: 'geolocation' })).state; }
  catch (e) { o.state = 'ERR'; }
  o.geo = await new Promise(function (res) {
    if (!navigator.geolocation) return res('absent');
    var t = setTimeout(function () { res('timeout'); }, 4000);
    navigator.geolocation.getCurrentPosition(
      function (p) { clearTimeout(t); res('coords ' + p.coords.latitude.toFixed(4) + ',' + p.coords.longitude.toFixed(4)); },
      function (err) { clearTimeout(t); res('error ' + err.code); },
      { timeout: 3500 }
    );
  });
  return o;
})();
<\/script>`;

// /pp  — the feature switched off for the document itself.
// /free — nothing restricted.
// /host — embeds /free in an iframe with NO allow attribute. The frame must be CROSS-ORIGIN
//         to reproduce what an ad or widget frame is: geolocation's default allowlist is
//         `self`, so a SAME-ORIGIN child inherits the feature and the case never arises.
//         `localhost` and `127.0.0.1` are the same listener and different origins, which is
//         why the resolver rule below exists.
let PORT = 0;
const server = createServer((q, r) => {
  const h = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (q.url.startsWith('/pp')) h['permissions-policy'] = 'geolocation=()';
  r.writeHead(200, h);
  if (q.url.startsWith('/host')) {
    r.end(`<!doctype html><meta charset=utf-8><title>host</title>
      <iframe id="f" src="http://localhost:${PORT}/free"></iframe>`);
    return;
  }
  r.end(`<!doctype html><meta charset=utf-8><title>p</title>${PROBE}`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
PORT = port;
const url = (p) => `http://127.0.0.1:${port}${p}`;
// Without this, `localhost` resolves to ::1, the listener is not there, and the frame is a
// Chrome error page — which answers with the HOST's values and reads as a spoofing failure
// rather than a broken probe. That exact mistake cost an hour during this investigation.
const RESOLVER = '--host-resolver-rules=MAP localhost 127.0.0.1';

async function readFrom(ctx, path_) {
  const page = await ctx.newPage();
  await page.goto(url(path_), { waitUntil: 'load' });
  const r = await page.evaluate(() => window.__probe);
  await page.close();
  return r;
}

async function readFromFrame(ctx) {
  const page = await ctx.newPage();
  await page.goto(url('/host'), { waitUntil: 'load' });
  const frame = page.frames().find((f) => f !== page.mainFrame());
  const r = frame ? await frame.evaluate(() => window.__probe) : null;
  await page.close();
  return r;
}

// ── control: no extension ────────────────────────────────────────────────────
const cleanBrowser = await chromium.launch({
  ...BROWSER, headless: !headed, args: [RESOLVER]
});
const cleanCtx = await cleanBrowser.newContext();
for (const o of [`http://127.0.0.1:${port}`, `http://localhost:${port}`]) {
  await cleanCtx.grantPermissions(['geolocation'], { origin: o });
}
const CLEAN_PP = await readFrom(cleanCtx, '/pp');
const CLEAN_FREE = await readFrom(cleanCtx, '/free');
const CLEAN_FRAME = await readFromFrame(cleanCtx);
await cleanBrowser.close();

// ── the extension ────────────────────────────────────────────────────────────
const userDataDir = mkdtempSync(join(tmpdir(), 'afp-geopolicy-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, RESOLVER]
});

let PP, FREE, FRAME;
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(sw);
  await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
    afp_profile_id: P.id,
    afp_profile_data: {
      screenW: P.screenW, screenH: P.screenH, cores: P.cores,
      memory: P.memory, gpu: P.gpuKey, platform: P.platform
    },
    afp_country_code: CC,
    afp_resolved_timezone: C.tz,
    afp_resolved_locale: C.loc,
    afp_mode: 'normal'
  });
  await new Promise((r) => setTimeout(r, 1200));
  for (const o of [`http://127.0.0.1:${port}`, `http://localhost:${port}`]) {
    await ctx.grantPermissions(['geolocation'], { origin: o });
  }

  PP = await readFrom(ctx, '/pp');
  FREE = await readFrom(ctx, '/free');
  FRAME = await readFromFrame(ctx);
} finally {
  await ctx.close();
  server.close();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
}

const row = (label, a, b) =>
  console.log(`  ${label.padEnd(26)}${String(a).padEnd(26)}${b}`);
console.log('  scenario                  clean                     extension');
row('Permissions-Policy off', `${CLEAN_PP.allowed}/${CLEAN_PP.state}/${CLEAN_PP.geo}`, `${PP.allowed}/${PP.state}/${PP.geo}`);
row('iframe, no allow=', CLEAN_FRAME ? `${CLEAN_FRAME.allowed}/${CLEAN_FRAME.state}/${CLEAN_FRAME.geo}` : 'no frame',
  FRAME ? `${FRAME.allowed}/${FRAME.state}/${FRAME.geo}` : 'no frame');
row('unrestricted', `${CLEAN_FREE.allowed}/${CLEAN_FREE.state}/${CLEAN_FREE.geo}`, `${FREE.allowed}/${FREE.state}/${FREE.geo}`);
console.log('');

// The control has to actually exercise the case, or every assertion below is vacuous.
ok(CLEAN_PP.allowed === false, 'control: the policy really does disable the feature');
ok(String(CLEAN_PP.geo).startsWith('error'),
  `control: a clean browser refuses the position there (${CLEAN_PP.geo})`);

// 1) Permissions-Policy: geolocation=()
ok(PP.allowed === false, 'policy page: allowsFeature is false with the extension too');
ok(String(PP.geo).startsWith('error'),
  `policy page: no position is handed out (${PP.geo}) — was "coords …" before the fix`);
ok(PP.geo === CLEAN_PP.geo,
  `policy page: same refusal as the clean browser, code and all (${PP.geo} vs ${CLEAN_PP.geo})`);
// Compared against clean rather than asserted absolutely: what permissions.query reports
// under a disabling policy is not the same on every Chrome. The real Chrome this was found
// on answered 'denied' there, headless Chromium here answers 'granted' even in the control.
// So the honest assertion is that we say whatever the browser underneath says — which is
// exactly what the fix restored, by only overriding a state that is not a refusal.
ok(PP.state === CLEAN_PP.state,
  `policy page: same permission state as clean (${PP.state} vs ${CLEAN_PP.state})`);

// 2) the shape that actually occurs: a frame embedded without allow="geolocation"
if (CLEAN_FRAME && FRAME) {
  ok(CLEAN_FRAME.allowed === false, 'control: an iframe without allow= has the feature off');
  ok(String(FRAME.geo).startsWith('error'),
    `iframe without allow=: no position is handed out (${FRAME.geo})`);
  ok(FRAME.geo === CLEAN_FRAME.geo,
    `iframe without allow=: same refusal as clean (${FRAME.geo} vs ${CLEAN_FRAME.geo})`);
  ok(FRAME.state === CLEAN_FRAME.state,
    `iframe without allow=: same permission state as clean (${FRAME.state} vs ${CLEAN_FRAME.state})`);
} else {
  ok(false, 'the iframe scenario produced no frame to read');
}

// 3) and where the platform allows it, the module must still do its job — otherwise the
//    fix above could be "refuse everything", which would pass every assertion so far.
ok(FREE.allowed !== false, 'unrestricted page: the feature is available');
ok(String(FREE.geo).startsWith('coords'),
  `unrestricted page: the position is still spoofed (${FREE.geo})`);
ok(FREE.geo !== CLEAN_FREE.geo,
  `unrestricted page: and it is not the clean browser's answer (${FREE.geo} vs ${CLEAN_FREE.geo})`);
{
  const m = /coords ([-\d.]+),([-\d.]+)/.exec(String(FREE.geo));
  ok(!!m && Math.abs(parseFloat(m[1]) - 59.44) < 0.02 && Math.abs(parseFloat(m[2]) - 24.75) < 0.02,
    `unrestricted page: the position is ${CC}'s (${FREE.geo})`);
  ok(FREE.state === 'granted',
    `unrestricted page: permissions.query agrees the position was granted (${FREE.state})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
