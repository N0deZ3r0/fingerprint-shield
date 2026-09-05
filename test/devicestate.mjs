/**
 * Device STATE must not vary by site — and site NOISE must still vary by site.
 *
 *   node test/devicestate.mjs             headless
 *   node test/devicestate.mjs --headed    watch it
 *
 * [FIX device-state-was-per-domain] Battery charge and physical position were computed in
 * the page from `profile.noiseSeed`. injectProfile() replaces that field with
 * deriveDomainSeed(master, host), so they came out different on every origin. Measured on
 * the user's real Chrome, extension on, within the same minute:
 *
 *     example.com      battery 0.90   chargingTime 2700   geo 59.4336, 24.7439
 *     127.0.0.1:8901   battery 0.93   chargingTime 2730   geo 59.4437, 24.7243
 *
 * One machine cannot hold two charge levels or stand in two places 1.2 km apart. Any
 * tracker present on both origins — an ad network, an analytics SDK, a script served from
 * a shared CDN — reads a browser contradicting itself, which is a far better signal than
 * the low-entropy facts being hidden. It is the same trade [FIX
 * adblock-mask-contradicted-the-network] refused, arriving from a different direction.
 *
 * WHY THIS SUITE EXISTS SEPARATELY. test/modules.mjs already reads battery and geolocation,
 * but it uses ONE origin, and no single-origin test can see this: every value it reads is
 * individually plausible. The bug is only visible as a disagreement BETWEEN origins, so the
 * measurement has to be two origins at once.
 *
 * `localhost` and `127.0.0.1` are the two hosts. They are the same server and the same
 * loopback address, but registrableDomain() treats them as different registrable domains
 * (test/background-fns.mjs pins that), so they get different domain seeds — which is
 * exactly the axis the bug lived on.
 *
 * THE SECOND HALF IS THE POINT. Unifying too much would be its own bug: canvas noise is
 * SUPPOSED to differ per site, that is what stops two sites correlating a drawing. So this
 * asserts both directions — device state identical, canvas hash different — and a fix that
 * flattened everything would fail here rather than look like a success.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, loadBackground, loadPopup } from './harness.mjs';
const headed = process.argv.includes('--headed');
const { COUNTRY_DATA } = loadBackground(['COUNTRY_DATA']);
const { PROFILES } = loadPopup(['PROFILES']);

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('  FAIL:', m); failed++; } };

const PROFILE_ID = 'laptop_mid', CC = 'EE';
const P = PROFILES.find((x) => x.id === PROFILE_ID);
const C = COUNTRY_DATA[CC];

const PROBE = `<!doctype html><html><head><meta charset=utf-8><title>ds</title></head><body>
<script>
window.__probe = (async function () {
  var o = { host: location.hostname };
  try {
    var b = await navigator.getBattery();
    o.battery = [b.charging, b.level, b.chargingTime, b.dischargingTime].join('/');
  } catch (e) { o.battery = 'ERR ' + e.name; }
  o.geo = await new Promise(function (res) {
    if (!navigator.geolocation) return res('absent');
    var t = setTimeout(function () { res('timeout'); }, 4000);
    navigator.geolocation.getCurrentPosition(
      function (p) {
        clearTimeout(t);
        res([p.coords.latitude, p.coords.longitude, p.coords.accuracy].join('/'));
      },
      function (err) { clearTimeout(t); res('error ' + err.code); },
      { timeout: 3500 }
    );
  });
  // The control axis: per-domain noise must still be per-domain.
  try {
    var c = document.createElement('canvas'); c.width = 200; c.height = 50;
    var x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '14px Arial'; x.fillStyle = '#f60';
    x.fillRect(1, 1, 90, 24); x.fillStyle = '#069'; x.fillText('Cwm fjord', 2, 15);
    var s = c.toDataURL(), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    o.canvas = h.toString(36);
  } catch (e) { o.canvas = 'ERR'; }
  return o;
})();
<\/script></body></html>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PROBE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const userDataDir = mkdtempSync(join(tmpdir(), 'afp-devicestate-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...BROWSER, headless: !headed,
  // localhost must reach the 127.0.0.1 listener rather than ::1, or the second origin is
  // a Chrome error page — which reports the HOST's values and would read as a huge leak.
  // That is not hypothetical: it happened during the investigation that found this bug.
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`,
    '--host-resolver-rules=MAP localhost 127.0.0.1']
});

try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));

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

  for (const origin of ['127.0.0.1', 'localhost']) {
    await ctx.grantPermissions(['geolocation'], { origin: `http://${origin}:${port}` });
  }

  async function read(host) {
    const page = await ctx.newPage();
    await page.goto(`http://${host}:${port}/`, { waitUntil: 'load' });
    const r = await page.evaluate(() => window.__probe);
    await page.close();
    return r;
  }

  const A = await read('127.0.0.1');
  const B = await read('localhost');

  console.log('  host      battery                        geo                              canvas');
  for (const r of [A, B]) {
    console.log(`  ${String(r.host).padEnd(10)}${String(r.battery).padEnd(31)}${String(r.geo).padEnd(33)}${r.canvas}`);
  }
  console.log('');

  // The two origins really were two origins, and both were real pages.
  ok(A.host !== B.host, `two distinct hostnames were measured (${A.host}, ${B.host})`);
  ok(!String(A.battery).startsWith('ERR') && !String(B.battery).startsWith('ERR'),
    'getBattery resolved on both origins');
  ok(!/^(error|timeout|absent)/.test(String(A.geo)) && !/^(error|timeout|absent)/.test(String(B.geo)),
    `geolocation answered on both origins (${A.geo} / ${B.geo})`);

  // The fix.
  ok(A.battery === B.battery,
    `battery is the same device on both origins — charging/level/chargingTime/dischargingTime ` +
    `(${A.battery} vs ${B.battery})`);
  ok(A.geo === B.geo,
    `geolocation is one position on both origins — lat/lon/accuracy (${A.geo} vs ${B.geo})`);

  // The half that must NOT be unified.
  ok(A.canvas !== B.canvas,
    `canvas noise is still per-domain — the seed unification must not reach it ` +
    `(${A.canvas} vs ${B.canvas})`);

  // The position is the selected country's, not some other centroid: a value that is
  // merely CONSISTENT could still be consistently wrong.
  const lat = parseFloat(String(A.geo).split('/')[0]);
  const lon = parseFloat(String(A.geo).split('/')[1]);
  ok(Math.abs(lat - 59.44) < 0.02 && Math.abs(lon - 24.75) < 0.02,
    `the position is ${CC}'s centroid ±0.01° (got ${lat}, ${lon})`);

  // Accuracy has to be coherent with how coarse the position is; the offset grid is
  // ~111m x ~57m at these latitudes, so a 50-89m accuracy claim sits right beside it.
  const acc = parseFloat(String(A.geo).split('/')[2]);
  ok(acc >= 50 && acc <= 89, `accuracy ${acc}m is in the band afpDeviceState produces`);

  // laptop_mid is a laptop: it must not report a desktop's mains-powered battery.
  const level = parseFloat(String(A.battery).split('/')[1]);
  ok(level >= 0.62 && level <= 0.94, `${PROFILE_ID} reports a laptop charge level (${level})`);
} finally {
  await ctx.close();
  server.close();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
