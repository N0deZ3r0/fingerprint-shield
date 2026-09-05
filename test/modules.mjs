/**
 * Does each of the 13 popup switches do what its label says? Measured against the REAL
 * extension.
 *
 *   node test/modules.mjs             headless
 *   node test/modules.mjs --headed    watch it
 *
 * dev-perflag.html already turns each flag off one at a time, but it asks a STRUCTURAL
 * question — is this reference still patched — and a patched reference that returns the
 * host's answer passes it. This asks the semantic one, in two halves, because either half
 * alone can pass on a broken module:
 *
 *   1. the switch CONTROLS the signal — the value with the flag off differs from the value
 *      with it on, so the module is actually the thing producing it;
 *   2. and with it on the value is the SELECTED PROFILE's — not merely different from the
 *      host, which noise alone would satisfy.
 *
 * Expected values are read from the live popup/background tables, like test/coldstart.mjs,
 * so editing a table cannot leave this asserting yesterday's numbers.
 *
 * TIMING is the trap this suite would otherwise fall into, and coldstart's clientRects
 * scenario documents it: `v.ui.f` has three writers and lands ~8ms after the page's first
 * script, so a reload fired on `load` measures the PREVIOUS configuration. Every row below
 * waits for the exact packed flag value before reloading, and reports it as its own
 * assertion — a run that silently measured the wrong configuration is worse than a red one.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, read, loadBackground, loadPopup } from './harness.mjs';
const headed = process.argv.includes('--headed');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const { COUNTRY_DATA, GPU_DATA, afpPackFeatures, AFP_DEFAULT_FEATURES } =
  loadBackground(['COUNTRY_DATA', 'GPU_DATA', 'afpPackFeatures', 'AFP_DEFAULT_FEATURES']);
const { PROFILES } = loadPopup(['PROFILES']);

let passed = 0, failed = 0;
const notes = [];
const ok = (c, m) => { if (c) passed++; else { console.error('  FAIL:', m); failed++; } };
const note = (m) => notes.push(m);

const PROFILE_ID = 'laptop_mid', CC = 'US';
const P = PROFILES.find((x) => x.id === PROFILE_ID);
const C = COUNTRY_DATA[CC];
const ALL_ON = {
  canvas: true, webgl: true, webrtc: true, navigator: true, screen: true, timezone: true,
  geolocation: true, battery: true, fonts: true, clientRects: true, plugins: true,
  network: true, hideAdBlocker: true
};
const KEYS = Object.keys(ALL_ON);

// One page, every signal, so a single load yields a full row and the rows are comparable.
const PROBE = `<!doctype html><html><head><meta charset=utf-8><title>modules</title></head><body>
<!-- The bait must be HIDDEN for hideAdBlocker to have anything to do: the module makes a
     blocked element read as visible, so against an unblocked one it correctly does nothing
     and "on === off" would be the right answer to the wrong question. This stylesheet is
     what a filter list injects. -->
<style>#bait { display: none !important; }</style>
<div id="bait" class="ad-banner ads adsbox pub_300x250 sponsored" style="width:300px;height:250px">&nbsp;</div>
<div id="txt" style="font:16px/1.2 serif;display:inline-block">The quick brown fox jumps</div>
<script>
window.__probe = (async function () {
  var o = {};
  var H = function (s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

  // canvas — the two reads the label names
  try {
    var c = document.createElement('canvas'); c.width = 220; c.height = 60;
    var x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '14px Arial'; x.fillStyle = '#f60';
    x.fillRect(1, 1, 90, 24); x.fillStyle = '#069'; x.fillText('Cwm fjord 🎨', 2, 15);
    o.canvasDataURL = H(c.toDataURL());
    o.canvasImageData = H(Array.prototype.join.call(x.getImageData(0, 0, 40, 20).data, ''));
  } catch (e) { o.canvasDataURL = 'ERR'; }

  // webgl — vendor / renderer / params
  try {
    var gc = document.createElement('canvas');
    var gl = gc.getContext('webgl') || gc.getContext('experimental-webgl');
    var dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    o.glVendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null;
    o.glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
    o.glMaxTexture = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : null;
  } catch (e) { o.glRenderer = 'ERR'; }

  // navigator
  o.userAgent = navigator.userAgent;
  o.cores = navigator.hardwareConcurrency;
  o.memory = navigator.deviceMemory;
  o.languages = (navigator.languages || []).join(',');
  o.language = navigator.language;

  // screen
  o.screen = [screen.width, screen.height, screen.availWidth, screen.availHeight, screen.colorDepth].join('x');

  // timezone
  try {
    o.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    o.tzOffset = new Date(2026, 0, 15).getTimezoneOffset();
  } catch (e) { o.tz = 'ERR'; }

  // plugins / mimeTypes
  o.plugins = navigator.plugins.length + ':' + Array.prototype.map.call(navigator.plugins, function (p) { return p.name; }).join('|');
  o.mimeTypes = navigator.mimeTypes.length;

  // network
  try {
    var n = navigator.connection;
    o.connection = n ? [n.effectiveType, n.rtt, n.downlink, n.saveData].join('/') : 'absent';
  } catch (e) { o.connection = 'ERR'; }

  // clientRects — a text rect, where sub-pixel noise shows
  try {
    var r = document.getElementById('txt').getBoundingClientRect();
    o.rect = r.width.toFixed(6) + ',' + r.height.toFixed(6);
  } catch (e) { o.rect = 'ERR'; }

  // fonts — the module is an ALLOWLIST: a family the profile claims passes through, one it
  // does not is collapsed to the fallback, in canvas measureText AND in DOM layout so the
  // two cannot disagree (see the measured table at mw/mw-misc.js "DOM FONT ENUMERATION").
  //
  // Two lists, because using only the first is how this check silently passes: every common
  // Windows family is on the allowlist, so probing Arial/Tahoma/Georgia returns the host's
  // own widths with the flag on OR off, and "identical" then means "correct", not "dead".
  // The second list is families installed on a Windows host but outside a typical profile
  // claim — the two the module's own comment uses as its worked example are the first of
  // them — and those are where the collapse has to show.
  var ALLOWED_FONTS = ['Arial', 'Segoe UI', 'Tahoma', 'Georgia', 'Impact', 'Comic Sans MS',
    'Times New Roman', 'Verdana'];
  var EXOTIC_FONTS = ['Agency FB', 'MS Outlook', 'Bahnschrift', 'Gabriola', 'Ink Free',
    'Segoe Print', 'Segoe Script', 'MV Boli', 'Candara', 'Corbel', 'Sitka Text',
    'Franklin Gothic Medium', 'Nirmala UI', 'Malgun Gothic', 'Yu Gothic', 'Sylfaen'];
  function widths(list) {
    var span = document.createElement('span');
    span.style.cssText = 'position:absolute;left:-9999px;font-size:72px';
    span.textContent = 'mmmmmmmmmmlli';
    document.body.appendChild(span);
    var w = [];
    list.forEach(function (f) {
      span.style.fontFamily = "'" + f + "',monospace";
      w.push(Math.round(span.getBoundingClientRect().width * 100));
    });
    document.body.removeChild(span);
    return w.join(',');
  }
  try { o.fontAllowed = widths(ALLOWED_FONTS); } catch (e) { o.fontAllowed = 'ERR'; }
  try { o.fontExotic = widths(EXOTIC_FONTS); } catch (e) { o.fontExotic = 'ERR'; }
  // canvas measureText over the same list: it and layout must give the same verdict.
  function canvasWidths(list) {
    var fc = document.createElement('canvas').getContext('2d');
    return list.map(function (f) {
      fc.font = "72px '" + f + "',monospace";
      return Math.round(fc.measureText('mmmmmmmmmmlli').width * 100);
    }).join(',');
  }
  try { o.fontExoticCanvas = canvasWidths(EXOTIC_FONTS); } catch (e) { o.fontExoticCanvas = 'ERR'; }
  // The verdict a font-enumeration script actually computes, and it needs no second
  // configuration to read: a family renders at the FALLBACK width iff it is "absent". A
  // sentinel name that cannot exist anywhere gives that width on each surface, so "absent"
  // becomes a per-family boolean — and layout and canvas must produce the same one. This
  // is the shape of the disagreement mw/mw-misc.js documents (its worked example is Agency
  // FB reading as fallback in canvas and as itself in layout), measurable in ONE page.
  var SENTINEL = 'ZzQq No Such Family 9173';
  try {
    var fbLayout = widths([SENTINEL]);
    var fbCanvas = canvasWidths([SENTINEL]);
    var wl = widths(EXOTIC_FONTS).split(','), wc = canvasWidths(EXOTIC_FONTS).split(',');
    var disagree = [];
    for (var fi = 0; fi < EXOTIC_FONTS.length; fi++) {
      var absentLayout = (wl[fi] === fbLayout), absentCanvas = (wc[fi] === fbCanvas);
      if (absentLayout !== absentCanvas) {
        disagree.push(EXOTIC_FONTS[fi] + (absentCanvas ? ' (canvas absent, layout present)' : ' (layout absent, canvas present)'));
      }
    }
    o.fontDisagree = disagree.join('; ') || 'none';
    o.fontDisagreeCount = disagree.length;
    // Which of the probed families this HOST actually has, by NAME. A family the machine
    // does not own already renders at the sentinel width, so there is nothing for the
    // allowlist to collapse. Read off the CLEAN browser this is what says whether the check
    // is performable here at all — and it has to be per name rather than a count, because
    // only two of the sixteen are outside the profile claim and those two are the only ones
    // that can prove anything. See the caller.
    var have = [];
    for (var pi = 0; pi < EXOTIC_FONTS.length; pi++) if (wl[pi] !== fbLayout) have.push(EXOTIC_FONTS[pi]);
    o.fontsInstalled = have.join(',');
  } catch (e) { o.fontDisagree = 'ERR'; o.fontDisagreeCount = -1; o.fontsInstalled = 'ERR'; }

  // hideAdBlocker — the reads an ad-bait detector actually makes
  try {
    var b = document.getElementById('bait');
    var cs = getComputedStyle(b);
    o.bait = [b.offsetHeight, b.offsetWidth, b.clientHeight, !!b.offsetParent,
      cs.display, cs.visibility, cs.opacity, b.getBoundingClientRect().height].join('/');
  } catch (e) { o.bait = 'ERR'; }

  // battery
  try {
    if (navigator.getBattery) {
      var bt = await navigator.getBattery();
      o.battery = [bt.charging, bt.level, bt.chargingTime, bt.dischargingTime].join('/');
    } else o.battery = 'absent';
  } catch (e) { o.battery = 'ERR ' + e.name; }

  // webrtc — does any private/local IP reach the page?
  try {
    var pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('x');
    var cands = [];
    await new Promise(function (res) {
      var done = setTimeout(res, 2500);
      pc.onicecandidate = function (e) {
        if (!e.candidate) { clearTimeout(done); res(); return; }
        cands.push(e.candidate.candidate);
      };
      pc.createOffer().then(function (d) { return pc.setLocalDescription(d); }).catch(function () { clearTimeout(done); res(); });
    });
    pc.close();
    var ips = cands.join(' ').match(/\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b/g) || [];
    var mdns = /[0-9a-f-]{36}\\.local/i.test(cands.join(' '));
    o.rtcCandidates = cands.length;
    o.rtcIPs = ips.join(',') || (mdns ? 'mDNS-only' : 'none');
    o.rtcPrivate = ips.filter(function (ip) {
      return /^10\\./.test(ip) || /^192\\.168\\./.test(ip) || /^172\\.(1[6-9]|2\\d|3[01])\\./.test(ip);
    }).join(',') || 'none';
  } catch (e) { o.rtcIPs = 'ERR ' + e.name; }

  // geolocation
  try {
    o.geo = await new Promise(function (res) {
      if (!navigator.geolocation) return res('absent');
      var t = setTimeout(function () { res('timeout'); }, 4000);
      navigator.geolocation.getCurrentPosition(
        function (p) { clearTimeout(t); res('coords ' + p.coords.latitude.toFixed(3) + ',' + p.coords.longitude.toFixed(3)); },
        function (err) { clearTimeout(t); res('error ' + err.code); },
        { timeout: 3500 }
      );
    });
  } catch (e) { o.geo = 'ERR'; }

  return o;
})();
<\/script></body></html>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PROBE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// The same page in a browser with NO extension. Several signals here are only meaningful
// against it: whether canvas and layout already disagree about a font on this host, and
// whether the coordinates a page receives are ours at all.
const cleanBrowser = await chromium.launch({ ...BROWSER, headless: !headed });
const cleanCtx = await cleanBrowser.newContext();
await cleanCtx.grantPermissions(['geolocation'], { origin: `http://127.0.0.1:${port}` });
const cleanPage = await cleanCtx.newPage();
await cleanPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
const CLEAN = await cleanPage.evaluate(() => window.__probe);
await cleanBrowser.close();

const userDataDir = mkdtempSync(join(tmpdir(), 'afp-modules-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
await ctx.grantPermissions(['geolocation'], { origin: `http://127.0.0.1:${port}` });

const rows = {};
let NETBLOCK = null, LATEBLOCK = null;
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));

  /** One configuration → one full row of signals. */
  async function run(label, features) {
    await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
      afp_profile_id: P.id,
      afp_profile_data: { screenW: P.screenW, screenH: P.screenH, cores: P.cores, memory: P.memory, gpu: P.gpuKey, platform: P.platform },
      afp_country_code: CC,
      afp_resolved_timezone: C.tz,
      afp_resolved_locale: C.loc,
      afp_mode: 'normal',
      afp_features: features
    });
    await new Promise((r) => setTimeout(r, 900));
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    // See the TIMING note in the header: wait for THIS run's flags, never merely for the key.
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
    ok(arrived, `${label}: the flags reached the page before the reload (want v.ui.f=${want})`);
    await page.reload({ waitUntil: 'load' });
    const out = await page.evaluate(() => window.__probe);
    await page.close();
    return out;
  }

  rows.baseline = await run('all on', ALL_ON);
  for (const k of KEYS) {
    if (only.length && !only.some((f) => k.toLowerCase().includes(f.toLowerCase()))) continue;
    rows[k] = await run(`${k} off`, { ...ALL_ON, [k]: false });
  }
  // Every switch on, but the browser has seen an ad request refused — the state a user with
  // AdGuard is in. background.js writes this timestamp from ERR_BLOCKED_BY_CLIENT; writing it
  // directly is the same value by the same key, and it is the only half a headless rig can
  // produce (the real one needs a second extension doing the blocking).
  if (!only.length || only.some((f) => 'hideadblocker netblock'.includes(f.toLowerCase()))) {
    await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, { afp_netblock_seen: Date.now() });
    await new Promise((r) => setTimeout(r, 600));
    NETBLOCK = await run('netblock seen', ALL_ON);
    await sw.evaluate(async () => { await chrome.storage.local.remove('afp_netblock_seen'); });

    // Same fact, delivered LATE: load the page with no flag at all (so the module installs),
    // then set the flag from inside the page the way storage-bridge does ~8ms in, and only
    // then read the bait. This is the first-load-on-a-new-origin case.
    await new Promise((r) => setTimeout(r, 600));
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    LATEBLOCK = await p.evaluate(async () => {
      sessionStorage.setItem('v.ui.ab', '1');
      await new Promise((r) => setTimeout(r, 300));   // past the 200ms memo in _standDown
      const b = document.getElementById('bait'), cs = getComputedStyle(b);
      return { bait: [b.offsetHeight, b.offsetWidth, b.clientHeight, b.offsetParent !== null,
        cs.display, cs.visibility, cs.opacity, b.getBoundingClientRect().height].join('/') };
    });
    await p.close();
  }
} finally {
  await ctx.close();
  rmSync(userDataDir, { recursive: true, force: true });
  server.close();
}

const B = rows.baseline;
const want = {
  cores: P.cores,
  memory: P.memory <= 2 ? 2 : P.memory <= 4 ? 4 : P.memory <= 8 ? 8 : P.memory <= 16 ? 16 : 32,
  screenW: P.screenW, screenH: P.screenH,
  tz: C.tz, loc: C.loc,
  gpuVendor: GPU_DATA[P.gpuKey].unmaskedVendor,
  gpuRenderer: GPU_DATA[P.gpuKey].unmaskedRenderer
};

console.log(`\nprofile ${P.id} / ${CC} — expecting ${want.cores} cores, ${want.screenW}x${want.screenH}, ${want.tz}, ${want.gpuRenderer}\n`);

/**
 * @param field  the signal the label promises to control
 * @param claim  what the popup says the module does
 */
/**
 * `unperformable` is an optional function returning a REASON string when this host cannot
 * carry the check out at all — not "it failed", but "there was nothing here to measure".
 *
 * It exists because the first CI run went red on `fonts` for a reason that had nothing to
 * do with the extension: the check needs a family OUTSIDE the profile claim to be installed
 * so it can watch that family collapse, and a Windows Server runner does not ship one. A
 * red build meaning "the runner has no Gabriola" is worse than no build, which is what the
 * browser job's own comment in ci.yml says.
 *
 * A skip is LOUD and counted, never silent. This project has thrown out three checks for
 * passing on a build known to be broken, and a skip that prints nothing is the same
 * mistake wearing a different hat: SKIP is printed in the results column where `ok` and
 * `FAIL` go, the reason is printed with it, and the count is asserted at the end of the
 * file so a suite quietly becoming all-skips cannot read as a pass.
 */
let skipped = 0;
function check(key, field, claim, extra, unperformable) {
  if (!rows[key]) return;
  const on = B[field], off = rows[key][field];
  const why = unperformable ? unperformable() : null;
  if (why) {
    skipped++;
    console.log(`SKIP ${key.padEnd(14)} ${claim}`);
    console.log(`       not performable on this host: ${why}`);
    return;
  }
  const controls = String(on) !== String(off);
  console.log(`${controls ? 'ok  ' : 'FAIL'} ${key.padEnd(14)} ${claim}`);
  console.log(`       on : ${String(on).slice(0, 96)}`);
  console.log(`       off: ${String(off).slice(0, 96)}`);
  ok(controls, `${key}: the switch controls ${field} (on and off are identical: ${String(on).slice(0, 60)})`);
  if (extra) extra(on, off);
}

check('canvas', 'canvasDataURL', 'toDataURL noise', () => {
  ok(String(B.canvasImageData) !== String(rows.canvas.canvasImageData),
    'canvas: getImageData is noised too, not only toDataURL');
});
check('webgl', 'glRenderer', 'UNMASKED vendor/renderer', () => {
  ok(B.glRenderer === want.gpuRenderer, `webgl: renderer is the profile's — got ${B.glRenderer}, want ${want.gpuRenderer}`);
  ok(B.glVendor === want.gpuVendor, `webgl: vendor is the profile's — got ${B.glVendor}, want ${want.gpuVendor}`);
});
check('navigator', 'cores', 'UA / cores / memory / langs', () => {
  ok(B.cores === want.cores, `navigator: hardwareConcurrency is the profile's — got ${B.cores}, want ${want.cores}`);
  ok(B.memory === want.memory, `navigator: deviceMemory is the profile's — got ${B.memory}, want ${want.memory}`);
  ok(B.language === want.loc, `navigator: language follows the country — got ${B.language}, want ${want.loc}`);
});
check('screen', 'screen', 'resolution and avail*', () => {
  ok(B.screen.startsWith(`${want.screenW}x${want.screenH}`),
    `screen: reports the profile's panel — got ${B.screen}, want ${want.screenW}x${want.screenH}…`);
});
check('timezone', 'tz', 'Date / Intl TZ', () => {
  ok(B.tz === want.tz, `timezone: Intl reports the country's zone — got ${B.tz}, want ${want.tz}`);
  ok(B.tzOffset !== rows.timezone.tzOffset, 'timezone: getTimezoneOffset moves with the flag, not just Intl');
});
check('network', 'connection', 'navigator.connection');
check('clientRects', 'rect', 'DOMRect noise');
check('fonts', 'fontExotic', 'font list (families outside the profile claim)', () => {
  ok(B.fontAllowed === rows.fonts.fontAllowed,
    'fonts: a family the profile DOES claim passes through untouched ' +
    `(on ${String(B.fontAllowed).slice(0, 40)} vs off ${String(rows.fonts.fontAllowed).slice(0, 40)})`);
  // The defect this pairing exists to catch: layout and canvas answering differently about
  // one family is cheaper to detect than the font list is to collect.
  const split = (s) => String(s).split(',');
  const movedLayout = split(B.fontExotic).filter((v, i) => v !== split(rows.fonts.fontExotic)[i]);
  const movedCanvas = split(B.fontExoticCanvas).filter((v, i) => v !== split(rows.fonts.fontExoticCanvas)[i]);
  note(`fonts: ${movedLayout.length} of ${split(B.fontExotic).length} probed families are ` +
    `collapsed to the fallback in layout, ${movedCanvas.length} in canvas measureText`);
  ok(movedLayout.length > 0, 'fonts: at least one family outside the claim is collapsed');
  // The contract, stated the way a detector reads it — see the SENTINEL note in the probe.
  // Compared against the clean browser, because the method itself must be shown not to
  // manufacture disagreement: whatever canvas and layout do differently without the
  // extension, they may keep doing with it.
  console.log(`       layout-vs-canvas disagreement — ours: ${B.fontDisagreeCount}, clean: ${CLEAN.fontDisagreeCount}`);
  if (B.fontDisagreeCount > CLEAN.fontDisagreeCount) {
    console.log(`       ${B.fontDisagree}`);
  }
  ok(B.fontDisagreeCount <= CLEAN.fontDisagreeCount,
    `fonts: no family is "absent" to canvas and "present" to layout beyond what a clean ` +
    `browser already does (ours ${B.fontDisagreeCount}, clean ${CLEAN.fontDisagreeCount}) — ` +
    `that contradiction is cheaper to detect than the font list is to collect: ${B.fontDisagree}`);
}, () => {
  // WHAT THIS CHECK ACTUALLY NEEDS, and the first attempt at this precondition got it
  // wrong. EXOTIC_FONTS is named for families "outside a typical profile claim" — but
  // fourteen of the sixteen are IN the claim: WIN_FONTS in profile-injector.js lists
  // Bahnschrift, Gabriola, Candara, Corbel, Franklin Gothic Medium and the rest, and the
  // module is an allowlist, so those are supposed to pass through untouched. Only
  // Agency FB and MS Outlook are genuinely outside it, and they are the only two that can
  // demonstrate anything.
  //
  // So the question is not "does this host have any of the sixteen" — the CI runner has
  // fourteen — it is "does this host have any of the ones NOT claimed". There the runner
  // has none: both render at the sentinel width. Nothing can collapse, and a first attempt
  // that counted all sixteen skipped nothing and stayed red.
  //
  // The two allowlists are read from the source rather than written out again, because a
  // third copy of a font list is exactly what test/parity-static.mjs already exists to
  // prevent between the two that are there.
  const allowed = new Set();
  const arrayAfter = (src, re) => {
    const i = src.search(re);
    if (i < 0) return [];
    const open = src.indexOf('[', i);
    const close = src.indexOf('];', open);
    if (open < 0 || close < 0) return [];
    try {
      return new Function('return ' + src.slice(open, close + 1).replace(/\/\/[^\n]*/g, ''))();
    } catch (e) { return []; }
  };
  for (const f of arrayAfter(read('profile-injector.js'), /var WIN_FONTS\s*=/)) allowed.add(String(f).toLowerCase());
  for (const f of arrayAfter(read('mw/mw-core.js'), /_BASE_FONTS\s*=/)) allowed.add(String(f).toLowerCase());
  if (allowed.size === 0) return null;   // could not read them: run the check rather than skip it

  const installed = String(CLEAN.fontsInstalled || '');
  if (installed === 'ERR') return 'the clean browser could not run the font probe at all';
  const usable = installed.split(',').filter((f) => f && !allowed.has(f.toLowerCase()));
  if (usable.length === 0) {
    return `this host has none of the probed families that the profile does NOT claim, so ` +
      `the allowlist has nothing to collapse and the switch cannot be observed. Installed ` +
      `here: ${installed || '(none)'} — all of them claimed. Outside the claim the probe ` +
      `knows about: Agency FB, MS Outlook, and a Windows Server SKU ships neither`;
  }
  return null;
});
check('battery', 'battery', 'getBattery()');
check('hideAdBlocker', 'bait', 'ad-bait masking (bait hidden by a filter list)');
check('geolocation', 'geo', 'geo spoof or block');

// hideAdBlocker stands down when a network-level blocker is refusing ad requests
// ([FIX adblock-mask-contradicted-the-network]). The DOM mask claims a slot is rendered; if
// the network is visibly refusing to fetch ads, that pair is a state no browser produces, so
// the module has to go quiet rather than mask harder. Asserted here rather than in a live
// browser because ERR_BLOCKED_BY_CLIENT needs a second, blocking extension to produce — what
// is testable, and what actually decides the behaviour, is the flag-to-behaviour path.
if (rows.hideAdBlocker && NETBLOCK) {
  console.log(`ok   ${'netblock'.padEnd(14)} stands down when ad requests are refused`);
  console.log(`       masking on : ${B.bait}`);
  console.log(`       stood down : ${NETBLOCK.bait}`);
  console.log(`       control    : ${CLEAN.bait}`);
  // Standing down must land on the CLEAN browser's answer exactly — not "some other
  // answer". Anything else would be a third state, which is its own signature.
  ok(NETBLOCK.bait === CLEAN.bait,
    `netblock: with the flag set the bait reads exactly as in a clean browser ` +
    `(ours "${NETBLOCK.bait}", clean "${CLEAN.bait}")`);
  ok(NETBLOCK.bait !== B.bait,
    'netblock: and that is a real change from the masking behaviour');
  // The rest of the extension must be unaffected — this silences one module, not the shield.
  ok(NETBLOCK.hc === B.hc,
    `netblock: the rest of the profile is untouched (hardwareConcurrency ${NETBLOCK.hc})`);
}

// The LATE case, which is the one a real browser is in on the first page of a new site:
// `v.ui.ab` is per-origin sessionStorage, so on a fresh origin it lands ~8ms after
// document_start — after the module has already decided to install. Measured on a live
// AdGuard install before this was handled: cnn.com first load masked all 27 slots while the
// network was visibly refusing ads, and only the second load stood down. The module therefore
// asks again at READ time, and a page's own detection code runs long after 8ms.
if (LATEBLOCK) {
  console.log(`ok   ${'netblock-late'.padEnd(14)} flag arriving after document_start still wins`);
  console.log(`       late flag  : ${LATEBLOCK.bait}`);
  console.log(`       control    : ${CLEAN.bait}`);
  ok(LATEBLOCK.bait === CLEAN.bait,
    `netblock-late: a flag set after the patches were installed still yields the clean ` +
    `browser's reading (ours "${LATEBLOCK.bait}", clean "${CLEAN.bait}")`);
}

// plugins: the switch is expected to be a NO-OP on the observable list, and that is not a
// defect — every Chrome install ships the same five PDF entries, so a profile that emits
// them faithfully is indistinguishable from the host by construction. What must hold is
// that the list IS the canonical five; a shorter or longer one is the tell.
if (rows.plugins) {
  const names = B.plugins.split(':').slice(1).join(':');
  const CANON = 'PDF Viewer|Chrome PDF Viewer|Chromium PDF Viewer|Microsoft Edge PDF Viewer|WebKit built-in PDF';
  console.log(`ok   ${'plugins'.padEnd(14)} navigator.plugins / mimeTypes (no-op by design)`);
  console.log(`       on : ${B.plugins.slice(0, 96)}`);
  ok(names === CANON, `plugins: the canonical five are reported — got ${names}`);
  ok(B.mimeTypes === 2, `plugins: two PDF mimeTypes, as Chrome ships — got ${B.mimeTypes}`);
  if (B.plugins === rows.plugins.plugins) {
    note('plugins: on and off are identical, which is correct — the spoofed list and the ' +
      'host list are the same five entries, so this rig cannot separate them');
  }
}

// WebRTC's contract is not "the value changed" but "no private IP reaches the page".
if (rows.webrtc) {
  console.log(`ok   ${'webrtc'.padEnd(14)} local IP hiding`);
  console.log(`       on : candidates=${B.rtcCandidates} ips=${B.rtcIPs} private=${B.rtcPrivate}`);
  console.log(`       off: candidates=${rows.webrtc.rtcCandidates} ips=${rows.webrtc.rtcIPs} private=${rows.webrtc.rtcPrivate}`);
  ok(B.rtcPrivate === 'none', `webrtc: no private IP reaches the page with the flag on — got ${B.rtcPrivate}`);
  if (rows.webrtc.rtcPrivate === 'none') {
    note(`webrtc: the control leaks nothing either (candidates=${rows.webrtc.rtcCandidates}, ips=${rows.webrtc.rtcIPs}) ` +
      `— headless Chromium gathers only mDNS candidates here, so this rig CANNOT prove the ` +
      `module is what hides them. Needs a rig with a real LAN interface; not covered.`);
  }
}

if (notes.length) { console.log('\nnotes:'); for (const n of notes) console.log('  ' + n); }
// A skip is only tolerable while it stays rare and named. If this suite ever comes up
// mostly skipped it is reporting "nothing was measurable" in the same green ink as
// "everything held", which is the failure mode a skip path always has — so the count is
// itself asserted. One is the fonts check on a host with the wrong font set; more than two
// means the rig has drifted far enough that the run is not evidence any more.
ok(skipped <= 2,
  `at most two checks are unperformable on this host (${skipped}) — beyond that the suite ` +
  `is reporting what it could not measure, not what it verified`);
console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped as unperformable` : ''}`);
process.exit(failed ? 1 : 0);
