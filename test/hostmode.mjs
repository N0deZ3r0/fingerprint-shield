/**
 * HOST MODE — "this machine" reads as a clean browser on every hardware axis, as the
 * profile on every identity axis, and the same in all three scopes.
 *
 *   node test/hostmode.mjs             headless
 *   node test/hostmode.mjs --headed    watch it
 *
 * THREE BROWSERS, and the third is the point. "Host mode matches a clean browser" on its
 * own is satisfied by an extension that does nothing; the run that proves the check is
 * not vacuous is a TABLE ROW on the same rig, which must move every hardware field the
 * host row is required to leave alone. So:
 *
 *   clean       no extension                        the reference for hardware
 *   host        the extension, profile 'host'/DE    hardware == clean, identity == DE
 *   laptop_low  the extension, laptop_low/JP        hardware != clean (the control)
 *
 * WHAT COUNTS AS HARDWARE here is the list mw-core's _HW_PROPS / _HW_FEAT and the effect-site
 * gates cover: cores, memory, the CPU tier, touch points, the whole Screen interface, the
 * ratio, the window geometry, the network, the battery, the WebGL strings and limits, the
 * WebGPU identity, the decoder, the font allowlist, the matchMedia display family, and the
 * OS build in getHighEntropyValues. Identity is the user agent, the language and the zone.
 *
 * THE FONT ROW IS THE SUBTLE ONE. The allowlist can only subtract: a family outside it is
 * measured through the generic fallback, so its width COLLAPSES onto monospace. In host mode
 * nothing is subtracted, so 'Agency FB' measures as the clean browser measures it — to within
 * the ±0.01px text-metric noise that stays on, which is why that comparison is numeric with a
 * tolerance rather than a string. On a host without the family the two are equal by fallback
 * on every side and the control cannot see the collapse, so the control's font assertion is
 * conditional on the clean browser having detected the font.
 *
 * THE POPUP IS DRIVEN FOR REAL for the host row: selecting it and pressing Apply is what
 * measures the machine and writes the record, and a rig that wrote the record by hand would
 * pass against a popup that could not. The control row is written directly, as every other
 * suite does.
 *
 * HEADERS: the fixture opts in to the three hardware hints. In host mode they must go out
 * with the BROWSER's values — the same numbers the clean browser reports from JS — while
 * accept-language still carries the profile's country; in the control they must carry the
 * profile's. A silent hint in host mode is the failure the split static ruleset exists to
 * prevent.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harness, root, BROWSER, loadBackground, loadPopup } from './harness.mjs';

const headed = process.argv.includes('--headed');
const { assert, eq, section, note, done } = harness();
const { COUNTRY_DATA } = loadBackground(['COUNTRY_DATA']);
const { PROFILES } = loadPopup(['PROFILES']);

// One collector for every scope — the same design as test/wbcoherence.mjs. OffscreenCanvas
// is the bridge: the only 2D and WebGL surface a worker has.
const READ = `(function () {
  var o = {};
  var t = function (k, f) { try { o[k] = f(); } catch (e) { o[k] = 'THREW ' + e.name; } };
  t('cores', function () { return navigator.hardwareConcurrency; });
  t('memory', function () { return navigator.deviceMemory; });
  t('cpuTier', function () { return ('cpuPerformance' in navigator) ? navigator.cpuPerformance : 'n/a'; });
  // downlink is kept apart: natively it is a LIVE bandwidth estimate and two reads a
  // second apart differ (1.45 vs 1.5 between a window and its worker, measured on the first
  // run of this suite) — so it is compared with a tolerance across scopes and not at all
  // against another browser launched minutes earlier.
  // rtt as well: it is quantised to 25 ms and re-estimated, and it read 100 in host mode
  // against 150 in the clean browser once the full suite was loading the machine around
  // this run. Both live numbers are compared across scopes with a tolerance and never
  // against the other browser; effectiveType and saveData are the stable half.
  t('conn', function () {
    var c = navigator.connection;
    return c ? [c.effectiveType, c.saveData].join('/') : 'n/a';
  });
  t('rtt', function () { var c = navigator.connection; return c ? c.rtt : 'n/a'; });
  t('downlink', function () { var c = navigator.connection; return c ? c.downlink : 'n/a'; });
  t('ua', function () { return navigator.userAgent; });
  t('lang', function () { return navigator.language; });
  t('tz', function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; });
  t('gl', function () {
    var g = new OffscreenCanvas(32, 32).getContext('webgl');
    if (!g) return 'no-webgl';
    var dbg = g.getExtension('WEBGL_debug_renderer_info');
    return [dbg ? g.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '?',
      dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?',
      g.getParameter(g.MAX_TEXTURE_SIZE), g.getParameter(g.MAX_VERTEX_UNIFORM_VECTORS),
      g.getParameter(g.MAX_VARYING_VECTORS)].join(' | ');
  });
  t('canvas', function () {
    var c = new OffscreenCanvas(120, 40), x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '14px sans-serif';
    x.fillStyle = '#f60'; x.fillRect(1, 1, 62, 20);
    x.fillStyle = '#069'; x.fillText('afp host probe', 2, 15);
    var d = x.getImageData(0, 0, 120, 40).data, h = 5381;
    for (var i = 0; i < d.length; i += 7) h = ((h * 33) ^ d[i]) >>> 0;
    return h;
  });
  t('fontAgency', function () {
    var x = new OffscreenCanvas(8, 8).getContext('2d');
    x.font = '72px "Agency FB", monospace';
    return x.measureText('mmmmmmmmmmlli').width;
  });
  t('fontMono', function () {
    var x = new OffscreenCanvas(8, 8).getContext('2d');
    x.font = '72px monospace';
    return x.measureText('mmmmmmmmmmlli').width;
  });
  return o;
})()`;

// The window has more: the Screen interface, the ratio, the geometry, touch, the display
// media family, and the four asynchronous readers.
const READ_WINDOW = `(async function () {
  var o = ${READ};
  var t = function (k, f) { try { o[k] = f(); } catch (e) { o[k] = 'THREW ' + e.name; } };
  t('screen', function () { return [screen.width, screen.height, screen.availWidth, screen.availHeight, screen.colorDepth, screen.pixelDepth].join('x'); });
  t('dpr', function () { return window.devicePixelRatio; });
  t('geometry', function () { return [innerWidth, innerHeight, outerWidth, outerHeight, screenX, screenY].join('/'); });
  t('touch', function () { return navigator.maxTouchPoints; });
  t('mq', function () {
    return ['(device-width: ' + screen.width + 'px)', '(-webkit-min-device-pixel-ratio: 1.01)',
      '(min-resolution: 1.5dppx)', '(hover: hover)', '(pointer: fine)', '(dynamic-range: high)']
      .map(function (q) { return matchMedia(q).matches ? 1 : 0; }).join('');
  });
  try {
    var b = await navigator.getBattery();
    o.battery = b.level + '/' + b.charging;
  } catch (e) { o.battery = 'THREW ' + e.name; }
  try {
    var h = await navigator.userAgentData.getHighEntropyValues(['platformVersion']);
    o.platformVersion = h.platformVersion;
  } catch (e) { o.platformVersion = 'THREW ' + e.name; }
  try {
    var a = await navigator.gpu.requestAdapter();
    o.webgpu = a ? [a.info.vendor, a.info.architecture, a.info.device, a.info.description].join('|') : 'null';
  } catch (e) { o.webgpu = 'THREW ' + e.name; }
  try {
    var r = await navigator.mediaCapabilities.decodingInfo({ type: 'file',
      video: { contentType: 'video/mp4; codecs="av01.0.08M.08"', width: 1920, height: 1080, bitrate: 5000000, framerate: 30 } });
    o.av1 = [r.supported, r.smooth, r.powerEfficient].join('/');
  } catch (e) { o.av1 = 'THREW ' + e.name; }
  return o;
})()`;

const WORKER_JS = `self.onmessage = function () { postMessage(${READ}); };\n`;
const FRAME_HTML = `<!doctype html><meta charset="utf-8"><title>f</title><script>window.__r = ${READ};<` + `/script>`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>host</title>
<script>
window.__f = new Promise(function (res) {
  var fr = document.createElement('iframe');
  fr.style.display = 'none';
  fr.onload = function () { try { res(fr.contentWindow.__r || 'no-reading'); } catch (e) { res('threw:' + e.name); } };
  fr.src = '/frame.html';
  document.documentElement.appendChild(fr);
  setTimeout(function () { res('timeout'); }, 6000);
});
window.__w = new Promise(function (res) {
  var d = false, f = function (v) { if (!d) { d = true; res(v); } };
  try {
    var w = new Worker('/worker.js');
    w.onmessage = function (e) { f(e.data); };
    w.onerror = function (e) { f('error:' + (e && e.message ? e.message : '(empty)')); };
    w.postMessage(1);
  } catch (e) { f('threw:' + (e && e.name)); }
  setTimeout(function () { f('timeout'); }, 6000);
});
</script></head><body>host</body></html>`;

// The latest main-document request's hardware hints and language, per visit.
let lastReq = {};
const server = createServer((q, r) => {
  if (q.url.startsWith('/worker.js')) {
    return r.writeHead(200, { 'content-type': 'application/javascript' }).end(WORKER_JS);
  }
  if (q.url.startsWith('/frame.html')) {
    return r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(FRAME_HTML);
  }
  lastReq = {
    al: q.headers['accept-language'] || '',
    mem: q.headers['sec-ch-device-memory'] || '',
    dpr: q.headers['sec-ch-dpr'] || '',
    pv: q.headers['sec-ch-ua-platform-version'] || ''
  };
  r.writeHead(200, {
    'content-type': 'text/html', 'cache-control': 'no-store',
    // The three hardware hints, asked for the way a real site asks.
    'accept-ch': 'Sec-CH-UA-Platform-Version, Sec-CH-Device-Memory, Sec-CH-DPR'
  }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const LAUNCH = (dir, withExt) => chromium.launchPersistentContext(dir, {
  ...BROWSER,
  headless: !headed,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
  args: withExt ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
});

/** One fresh tab: window, worker, frame, and what the document asked with. */
async function visit(ctx, n) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?v=${n}`, { waitUntil: 'load' });
  const win = await p.evaluate(READ_WINDOW);
  const worker = await p.evaluate('window.__w');
  const frame = await p.evaluate('window.__f');
  await p.close();
  return { win, worker, frame, sent: Object.assign({}, lastReq) };
}

/** Reload until the opted-in hints arrive (they follow the first Accept-CH by a beat). */
async function visitWithHints(ctx, tag) {
  let last = null;
  for (let i = 1; i <= 8; i++) {
    last = await visit(ctx, `${tag}${i}`);
    if (last.sent.mem && last.sent.dpr && last.sent.pv) return last;
  }
  return last;
}

const HW_ALL_SCOPES = ['cores', 'memory', 'cpuTier', 'conn', 'gl'];
const HW_WINDOW = ['screen', 'dpr', 'geometry', 'touch', 'mq', 'battery', 'platformVersion', 'webgpu', 'av1'];
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= tol;

// ---- 1. the reference ---------------------------------------------------------
const cleanDir = mkdtempSync(path.join(tmpdir(), 'afp-host-clean-'));
let CLEAN;
{
  const ctx = await LAUNCH(cleanDir, false);
  try { CLEAN = await visitWithHints(ctx, 'c'); }
  finally { await ctx.close(); try { rmSync(cleanDir, { recursive: true, force: true }); } catch (e) { /* lock */ } }
}
section('0) the clean browser');
note(`cores ${CLEAN.win.cores}, memory ${CLEAN.win.memory}, screen ${CLEAN.win.screen}, dpr ${CLEAN.win.dpr}, ` +
  `platformVersion ${CLEAN.win.platformVersion}, av1 ${CLEAN.win.av1}`);
note(`gl ${String(CLEAN.win.gl).slice(0, 90)}`);
note(`hints sent: device-memory ${CLEAN.sent.mem || '(none)'}, dpr ${CLEAN.sent.dpr || '(none)'}, platform-version ${CLEAN.sent.pv || '(none)'}`);
const cleanSeesAgency = !near(CLEAN.win.fontAgency, CLEAN.win.fontMono, 0.5);
note(`Agency FB ${cleanSeesAgency ? 'is installed here (' + CLEAN.win.fontAgency + ' vs monospace ' + CLEAN.win.fontMono + ')' : 'is NOT installed here — the font collapse cannot be seen on this host'}`);

// ---- 2. the extension: host mode through the popup, then the control ----------
const dir = mkdtempSync(path.join(tmpdir(), 'afp-host-'));
const ctx = await LAUNCH(dir, true);
let HOST, CTRL, stored, registered;
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  const id = new URL(sw.url()).host;

  // The popup, driven as a user drives it: a site is the active tab, "Эта машина" is
  // selected, Apply is pressed.
  const site = await ctx.newPage();
  await site.goto(`${BASE}/?popup=1`, { waitUntil: 'load' });
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load' });
  await site.bringToFront();
  await popup.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1200));
  const picker = await popup.evaluate(() => {
    document.getElementById('profileBtn').click();
    const opts = [...document.querySelectorAll('#profileList .option')];
    const host = opts.find((o) => o.dataset.id === 'host');
    const before = document.getElementById('profileSpec').textContent;
    if (host) host.click();
    return {
      count: opts.length, hasHost: !!host,
      open: document.getElementById('profileSelect').classList.contains('open'),
      name: document.getElementById('profileName').textContent,
      spec: document.getElementById('profileSpec').textContent, before
    };
  });
  section('1) the popup offers the row and measures the machine');
  eq(picker.count, PROFILES.length, `the picker lists every profile (${picker.count})`);
  assert(picker.hasHost, 'and one of them is "this machine"');
  eq(picker.open, false, 'choosing a row closes the picker');
  eq(picker.name, 'Эта машина', `the button names the row (${picker.name})`);
  assert(/\d+×\d+ · \d+c · \d+GB/.test(picker.spec),
    `and its second line is the measurement, not a placeholder (${picker.spec})`);
  await popup.evaluate(async () => {
    // The country is set the same way, through the popup's own state.
    selectedCountryCode = 'DE';
    await handleApply();
  });
  await new Promise((r) => setTimeout(r, 1500));
  stored = await sw.evaluate(async () => {
    const st = await chrome.storage.local.get(['afp_profile_id', 'afp_profile_data', 'afp_profile_gl', 'afp_country_code']);
    const reg = await chrome.scripting.getRegisteredContentScripts({ ids: ['afp-boot'] });
    const rules = await chrome.declarativeNetRequest.getEnabledRulesets();
    return { st, js: (reg[0] && reg[0].js) || [], rulesets: rules };
  });
  eq(stored.st.afp_profile_id, 'host', 'Apply stored the host id');
  eq(stored.st.afp_profile_data && stored.st.afp_profile_data.host, true, 'and the record is flagged host: true');
  assert(stored.st.afp_profile_data && stored.st.afp_profile_data.cores === CLEAN.win.cores,
    `the record's cores are the machine's (${stored.st.afp_profile_data && stored.st.afp_profile_data.cores} vs ${CLEAN.win.cores})`);
  assert(stored.st.afp_profile_data && stored.st.afp_profile_data.gl && typeof stored.st.afp_profile_data.gl.glRenderer === 'string',
    'the record carries the GL strings the popup read off the GPU');
  eq(stored.st.afp_profile_gl && stored.st.afp_profile_gl.glRenderer, stored.st.afp_profile_data.gl.glRenderer,
    'afp_profile_gl was resolved from the measured record, not from a table');
  assert(stored.js.includes('dyn/dev/host.js'), `the cold start registers dyn/dev/host.js (${stored.js.filter((f) => f.startsWith('dyn/dev')).join(',')})`);
  eq(stored.rulesets.includes('ruleset_static_hw'), false,
    `the hardware-hint strip is OFF in host mode (enabled: ${stored.rulesets.join(',')})`);
  eq(stored.rulesets.includes('ruleset_static'), true, 'and the identity strip stays on');
  await popup.close();
  await site.close();

  // A moment for the dynamic rules and the boot registration, then fresh tabs.
  await new Promise((r) => setTimeout(r, 1500));
  HOST = await visitWithHints(ctx, 'h');

  section('2) host mode: the hardware is the clean browser\'s, in the window');
  for (const k of HW_ALL_SCOPES.concat(HW_WINDOW)) {
    eq(String(HOST.win[k]), String(CLEAN.win[k]), `window ${k} equals the clean browser`);
  }
  assert(near(HOST.win.fontAgency, CLEAN.win.fontAgency, 0.05),
    `window: 'Agency FB' measures as the clean browser measures it, within the text-metric noise ` +
    `(${HOST.win.fontAgency} vs ${CLEAN.win.fontAgency})`);

  section('3) host mode: the identity is still the profile\'s');
  eq(HOST.win.lang, COUNTRY_DATA.DE.loc, `navigator.language is the profile's (${HOST.win.lang})`);
  eq(HOST.win.tz, COUNTRY_DATA.DE.tz, `the zone is the profile's (${HOST.win.tz})`);
  assert(/Windows NT 10\.0; Win64; x64/.test(String(HOST.win.ua)), 'the user agent is the profile\'s Windows string');
  assert(String(HOST.win.canvas) !== String(CLEAN.win.canvas),
    `the canvas is still noised — the seed is not hardware (${HOST.win.canvas} vs clean ${CLEAN.win.canvas})`);
  eq(String(HOST.sent.al).split(',')[0], COUNTRY_DATA.DE.loc, `accept-language still leads with the profile's locale (${HOST.sent.al})`);

  section('4) host mode: every scope agrees');
  assert(HOST.worker && typeof HOST.worker === 'object', `the worker answered (${typeof HOST.worker === 'object' ? 'ok' : HOST.worker})`);
  assert(HOST.frame && typeof HOST.frame === 'object', `the iframe answered (${typeof HOST.frame === 'object' ? 'ok' : HOST.frame})`);
  if (HOST.worker && typeof HOST.worker === 'object') {
    for (const k of HW_ALL_SCOPES.concat(['lang', 'tz', 'ua'])) {
      eq(String(HOST.worker[k]), String(HOST.win[k]), `worker ${k} equals the window`);
    }
    assert(near(HOST.worker.fontAgency, HOST.win.fontAgency, 0.05),
      `worker 'Agency FB' equals the window within the noise (${HOST.worker.fontAgency} vs ${HOST.win.fontAgency})`);
    assert(near(HOST.worker.downlink, HOST.win.downlink, 1),
      `worker downlink is the same live estimate as the window's (${HOST.worker.downlink} vs ${HOST.win.downlink})`);
    assert(near(HOST.worker.rtt, HOST.win.rtt, 50),
      `worker rtt is the same live estimate as the window's (${HOST.worker.rtt} vs ${HOST.win.rtt})`);
    eq(String(HOST.worker.canvas), String(HOST.win.canvas), 'worker canvas hash equals the window (one seed)');
  }
  if (HOST.frame && typeof HOST.frame === 'object') {
    for (const k of HW_ALL_SCOPES.concat(['lang', 'tz', 'ua'])) {
      eq(String(HOST.frame[k]), String(HOST.win[k]), `iframe ${k} equals the window`);
    }
  }

  section('5) host mode: the hardware hints on the wire are the browser\'s own');
  assert(!!(HOST.sent.mem && HOST.sent.dpr && HOST.sent.pv),
    `the three opted-in hints went out (device-memory ${HOST.sent.mem || '(none)'}, dpr ${HOST.sent.dpr || '(none)'}, platform-version ${HOST.sent.pv || '(none)'})`);
  eq(HOST.sent.mem, String(CLEAN.win.memory), `sec-ch-device-memory is the machine's (${HOST.sent.mem})`);
  eq(HOST.sent.dpr, String(CLEAN.win.dpr), `sec-ch-dpr is the machine's (${HOST.sent.dpr})`);
  eq(HOST.sent.pv, `"${CLEAN.win.platformVersion}"`, `sec-ch-ua-platform-version is the machine's exact build (${HOST.sent.pv})`);
  if (CLEAN.sent.mem) {
    eq(HOST.sent.mem, CLEAN.sent.mem, 'and byte for byte what the clean browser sent');
  }

  // ---- the control: a table row on the same rig ------------------------------------
  const low = PROFILES.find((p) => p.id === 'laptop_low');
  await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
    afp_profile_id: low.id,
    afp_profile_data: { screenW: low.screenW, screenH: low.screenH, dpr: low.dpr, cores: low.cores,
      memory: low.memory, gpu: low.gpuKey, platform: low.platform },
    afp_country_code: 'JP', afp_resolved_timezone: COUNTRY_DATA.JP.tz,
    afp_resolved_locale: COUNTRY_DATA.JP.loc, afp_mode: 'normal'
  });
  await new Promise((r) => setTimeout(r, 2500));
  registered = await sw.evaluate(async () => {
    const reg = await chrome.scripting.getRegisteredContentScripts({ ids: ['afp-boot'] });
    const rules = await chrome.declarativeNetRequest.getEnabledRulesets();
    return { js: (reg[0] && reg[0].js) || [], rulesets: rules };
  });
  CTRL = await visitWithHints(ctx, 'l');
  // The control must have settled on the row before it can prove anything.
  for (let i = 0; i < 6 && String(CTRL.win.cores) !== String(low.cores); i++) CTRL = await visitWithHints(ctx, 'L' + i);

  section('6) the control: a table row on this rig moves what host mode left alone');
  assert(registered.js.includes('dyn/dev/laptop_low.js'), 'the cold start switched to the row\'s file');
  eq(registered.rulesets.includes('ruleset_static_hw'), true, 'the hardware-hint strip is back ON for a table row');
  eq(String(CTRL.win.cores), String(low.cores), `the row's cores are reported (${CTRL.win.cores})`);
  const moved = HW_ALL_SCOPES.concat(HW_WINDOW).filter((k) => String(CTRL.win[k]) !== String(CLEAN.win[k]));
  note(`moved against clean: ${moved.join(', ') || '(none)'}`);
  for (const k of ['cores', 'memory', 'gl', 'screen']) {
    assert(moved.includes(k), `${k} moves with a table row — so its equality above was the mode, not the rig`);
  }
  // The row's connection is a literal (4g/50/10); the host's rtt may happen to be 50, so
  // the literal downlink is the half that must move.
  eq(String(CTRL.win.downlink), '10', `the row's connection literal is reported (downlink ${CTRL.win.downlink})`);
  eq(String(CTRL.win.rtt), '50', `and so is its rtt (${CTRL.win.rtt})`);
  eq(CTRL.win.lang, COUNTRY_DATA.JP.loc, 'and the identity moved with the country');
  if (cleanSeesAgency) {
    assert(near(CTRL.win.fontAgency, CTRL.win.fontMono, 0.5),
      `the allowlist collapses 'Agency FB' onto monospace on a table row (${CTRL.win.fontAgency} vs ${CTRL.win.fontMono}) — so host mode's pass-through above was real`);
  } else {
    note('font collapse unprovable on this host (Agency FB absent) — see the header');
  }
  assert(!!(CTRL.sent.mem && CTRL.sent.dpr && CTRL.sent.pv),
    `the control sent the hints too (device-memory ${CTRL.sent.mem || '(none)'}, dpr ${CTRL.sent.dpr || '(none)'}, platform-version ${CTRL.sent.pv || '(none)'})`);
  eq(CTRL.sent.mem, String(low.memory), `and sec-ch-device-memory carries the row's memory (${CTRL.sent.mem})`);
  eq(CTRL.sent.pv, `"${CTRL.win.platformVersion}"`, `the OS bucket on the wire equals the one in JS (${CTRL.sent.pv})`);
  if (CTRL.worker && typeof CTRL.worker === 'object') {
    for (const k of HW_ALL_SCOPES) eq(String(CTRL.worker[k]), String(CTRL.win[k]), `control: worker ${k} equals the window`);
  }
} finally {
  await ctx.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  server.close();
}

done();
