/**
 * THE FINGERPRINT PRO READ LIST, CLASSIFIED.
 *
 *   node test/fpro-surface.mjs             headless
 *   node test/fpro-surface.mjs --headed    watch it
 *
 * Standalone diagnostic; deliberately NOT in test/all.mjs.
 *
 * Every probe below was taken from the Fingerprint Pro agent itself (v4, pulled from
 * fingerprint.com/demo, 194KB minified, beautified to ~9.9k lines). The Pro agent does not
 * keep the open-source source names — `fontPreferences`, `osCpu`, `colorGamut` and friends
 * are absent as strings — so its collectors cannot be listed by name. What cannot be
 * mangled is the Web API property names it reads, and that is what this file mirrors: the
 * navigator keys it touches, the exact 11 matchMedia queries it runs, its font list, its
 * WebGL calls, its audio path, its automation checks.
 *
 * Classification is test/hostleak.mjs's, because it is the only one that answers the
 * question the demo raises. Two maximally different profiles plus a clean browser:
 *
 *   moves between profiles                     -> CLOSED. The agent sees the profile.
 *   identical across profiles, equal to clean   -> NOT CLOSED. The host's own value, passed
 *                                                 through. Links every profile this user
 *                                                 wears, which is exactly what a visitor id
 *                                                 is built from.
 *   identical across profiles, differs from clean -> a constant this build emits. Shared by
 *                                                 every user of the build, so it links
 *                                                 nobody to themselves — but it is a tell.
 *
 * The third bucket is not automatically a defect and the second is not automatically fatal:
 * `oscpu`/`cpuClass`/`openDatabase` are Firefox/IE-only and read to check the browser is
 * what it claims, so "identical and equal to clean" is the CORRECT answer for them. The
 * readout names every key so each can be judged rather than counted.
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
const A = { id: 'laptop_low', cc: 'JP' };
const B = { id: 'pc_gaming', cc: 'BR' };

const PROBE = `<!doctype html><html><head><meta charset=utf-8></head><body>
<script>
window.__probe = (async function () {
  var o = {};
  var H = function (s) { var h = 5381, i; s = String(s);
    for (i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
  var T = function (k, fn) { try { var v = fn(); o[k] = (v === undefined) ? 'undefined' : v; }
    catch (e) { o[k] = 'ERR:' + e.name; } };

  // ---------- navigator.*, exactly the 18 keys the agent reads ----------
  T('nav.appVersion',        function () { return navigator.appVersion; });
  T('nav.cpuClass',          function () { return navigator.cpuClass; });
  T('nav.deviceMemory',      function () { return navigator.deviceMemory; });
  T('nav.hardwareConcurrency', function () { return navigator.hardwareConcurrency; });
  T('nav.language',          function () { return navigator.language; });
  T('nav.languages',         function () { return (navigator.languages || []).join(','); });
  T('nav.mimeTypes',         function () { return navigator.mimeTypes.length + ':' +
    Array.prototype.map.call(navigator.mimeTypes, function (m) { return m.type; }).join('|'); });
  T('nav.onLine',            function () { return navigator.onLine; });
  T('nav.oscpu',             function () { return navigator.oscpu; });
  T('nav.pdfViewerEnabled',  function () { return navigator.pdfViewerEnabled; });
  T('nav.platform',          function () { return navigator.platform; });
  T('nav.plugins',           function () { return navigator.plugins.length + ':' +
    Array.prototype.map.call(navigator.plugins, function (p) { return p.name; }).join('|'); });
  T('nav.productSub',        function () { return navigator.productSub; });
  T('nav.userAgent',         function () { return navigator.userAgent; });
  T('nav.vendor',            function () { return navigator.vendor; });
  T('nav.connection',        function () { var c = navigator.connection;
    return c ? [c.effectiveType, c.rtt, c.downlink, c.saveData].join('/') : 'absent'; });
  T('nav.maxTouchPoints',    function () { return navigator.maxTouchPoints; });
  T('screen.colorDepth',     function () { return screen.colorDepth; });
  T('doc.cookieEnabled',     function () { return navigator.cookieEnabled; });

  var uad = navigator.userAgentData;
  o['uad.brands'] = 'absent'; o['uad.platform'] = 'absent'; o['uad.high'] = 'absent';
  if (uad) {
    try { o['uad.brands'] = (uad.brands || []).map(function (b) { return b.brand + ' ' + b.version; }).join('|'); } catch (e) {}
    try { o['uad.platform'] = uad.platform + '/' + uad.mobile; } catch (e) {}
    try {
      var h = await uad.getHighEntropyValues(['architecture', 'bitness', 'model',
        'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64']);
      o['uad.high'] = JSON.stringify(h);
    } catch (e) { o['uad.high'] = 'ERR:' + e.name; }
  }

  // ---------- the exact 11 matchMedia probes, expanded over their values ----------
  var MQ = {
    'mq.colorGamut':        ['srgb', 'p3', 'rec2020'].map(function (v) { return '(color-gamut: ' + v + ')'; }),
    'mq.dynamicRange':      ['standard', 'high'].map(function (v) { return '(dynamic-range: ' + v + ')'; }),
    'mq.forcedColors':      ['active', 'none'].map(function (v) { return '(forced-colors: ' + v + ')'; }),
    'mq.invertedColors':    ['inverted', 'none'].map(function (v) { return '(inverted-colors: ' + v + ')'; }),
    'mq.prefersColorScheme':['light', 'dark'].map(function (v) { return '(prefers-color-scheme: ' + v + ')'; }),
    'mq.prefersContrast':   ['no-preference', 'high', 'more', 'low', 'less', 'forced']
      .map(function (v) { return '(prefers-contrast: ' + v + ')'; }),
    'mq.reducedMotion':     ['reduce', 'no-preference'].map(function (v) { return '(prefers-reduced-motion: ' + v + ')'; }),
    'mq.reducedTransparency':['reduce', 'no-preference'].map(function (v) { return '(prefers-reduced-transparency: ' + v + ')'; }),
    'mq.monochrome':        ['(min-monochrome: 0)', '(max-monochrome: 0)', '(max-monochrome: 8)'],
    'mq.dpr':               ['(min-resolution: 192dpi)', '(-webkit-min-device-pixel-ratio: 2)', '(min-device-pixel-ratio: 2)']
  };
  Object.keys(MQ).forEach(function (k) {
    T(k, function () {
      return MQ[k].map(function (q) { return matchMedia(q).matches ? '1' : '0'; }).join('');
    });
  });

  // ---------- WebGL: the calls the agent makes ----------
  function gl() { return document.createElement('canvas').getContext('webgl'); }
  T('gl.vendorRenderer', function () { var g = gl();
    return g.getParameter(g.VENDOR) + ' | ' + g.getParameter(g.RENDERER); });
  T('gl.unmasked', function () { var g = gl(), d = g.getExtension('WEBGL_debug_renderer_info');
    return g.getParameter(d.UNMASKED_VENDOR_WEBGL) + ' | ' + g.getParameter(d.UNMASKED_RENDERER_WEBGL); });
  T('gl.version', function () { var g = gl();
    return g.getParameter(g.VERSION) + ' | ' + g.getParameter(g.SHADING_LANGUAGE_VERSION); });
  T('gl.extensions', function () { var g = gl();
    return H((g.getSupportedExtensions() || []).slice().sort().join(',')); });
  T('gl.contextAttributes', function () { var g = gl();
    return JSON.stringify(g.getContextAttributes()); });
  T('gl.shaderPrecision', function () {
    var g = gl(), out = [];
    [g.VERTEX_SHADER, g.FRAGMENT_SHADER].forEach(function (s) {
      [g.LOW_FLOAT, g.MEDIUM_FLOAT, g.HIGH_FLOAT, g.LOW_INT, g.MEDIUM_INT, g.HIGH_INT].forEach(function (p) {
        var r = g.getShaderPrecisionFormat(s, p);
        out.push(r ? (r.rangeMin + ',' + r.rangeMax + ',' + r.precision) : 'null');
      });
    });
    return H(out.join('|'));
  });
  // The agent compiles and draws, not just reads strings — this is the rasteriser talking.
  T('gl.render', function () {
    var c = document.createElement('canvas'); c.width = 64; c.height = 64;
    var g = c.getContext('webgl');
    var vs = g.createShader(g.VERTEX_SHADER);
    g.shaderSource(vs, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}');
    g.compileShader(vs);
    var fs = g.createShader(g.FRAGMENT_SHADER);
    g.shaderSource(fs, 'precision mediump float;void main(){gl_FragColor=vec4(gl_FragCoord.x/64.0,gl_FragCoord.y/64.0,0.5,1.0);}');
    g.compileShader(fs);
    var pr = g.createProgram(); g.attachShader(pr, vs); g.attachShader(pr, fs);
    g.linkProgram(pr); g.useProgram(pr);
    var b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), g.STATIC_DRAW);
    var loc = g.getAttribLocation(pr, 'p');
    g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    var px = new Uint8Array(64 * 64 * 4);
    g.readPixels(0, 0, 64, 64, g.RGBA, g.UNSIGNED_BYTE, px);
    return H(Array.prototype.join.call(px, ''));
  });

  // ---------- audio ----------
  T('audio.oscillator', await (async function () {
    try {
      var Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      var ctx = new Ctx(1, 44100, 44100);
      var osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 10000;
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12;
      comp.attack.value = 0; comp.release.value = 0.25;
      osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
      var buf = await ctx.startRendering();
      var d = buf.getChannelData(0), sum = 0;
      for (var i = 4500; i < 5000; i++) sum += Math.abs(d[i]);
      var v = sum.toFixed(8);
      return function () { return v; };
    } catch (e) { return function () { return 'ERR'; }; }
  })());
  // baseLatency is a hardware/driver number the open-source library does not read but the
  // Pro agent does. Nothing in mw/ mentions it.
  T('audio.baseLatency', await (async function () {
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      var c = new C();
      var v = c.baseLatency + '/' + c.sampleRate + '/' + (c.outputLatency || 0);
      try { c.close(); } catch (e) {}
      return function () { return v; };
    } catch (e) { return function () { return 'ERR'; }; }
  })());

  // ---------- canvas ----------
  T('canvas.text', function () {
    var c = document.createElement('canvas'); c.width = 240; c.height = 60;
    var x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '14px Arial'; x.fillStyle = '#f60';
    x.fillRect(1, 1, 90, 24); x.fillStyle = '#069'; x.fillText('Cwm fjord \\u{1F3A8}', 2, 15);
    return H(c.toDataURL());
  });
  T('canvas.winding', function () {
    var x = document.createElement('canvas').getContext('2d');
    x.rect(0, 0, 10, 10); x.rect(2, 2, 6, 6);
    return x.isPointInPath(5, 5, 'evenodd') ? 'yes' : 'no';
  });

  // ---------- fonts: the exact families named in the agent ----------
  var FONTS = ['Agency FB', 'Arial Unicode MS', 'Calibri', 'Century', 'Century Gothic',
    'Franklin Gothic', 'Futura Bk BT', 'Futura Md BT', 'Helvetica Neue', 'Lucida Bright',
    'Lucida Sans', 'MS Mincho', 'MS Outlook', 'MS Reference Specialty', 'MS UI Gothic',
    'Meiryo UI', 'Menlo', 'Microsoft Uighur', 'Segoe UI Light', 'Times New Roman'];
  // Measured twice, rounded and raw, and the pair is the point. The DOM rect noise is
  // small; rounding to 1/100 px is enough to swallow it on some runs and not others, which
  // made this row flip between CLOSED and OUR CONSTANTS between runs of an unchanged
  // build. That is not probe noise to be tidied away — a fingerprinter that rounds is a
  // fingerprinter our DOM noise does not reach, so if the rounded row sits still while
  // the raw row moves, the noise is real but ineffective against exactly the scripts
  // that quantise. (No backticks in this comment: it lives inside a template literal.)
  T('fonts.widths', function () {
    var span = document.createElement('span');
    span.style.cssText = 'position:absolute;left:-9999px;font-size:48px';
    span.textContent = 'mmmmmmmmmmlli';
    document.body.appendChild(span);
    var w = FONTS.map(function (f) {
      span.style.fontFamily = "'" + f + "',monospace";
      return Math.round(span.getBoundingClientRect().width * 100);
    });
    document.body.removeChild(span);
    return H(w.join(','));
  });
  // The DOM path Fingerprint Pro actually reads for fontPreferences, plus the two faces
  // monospace can resolve to on Windows, measured by name. Printing all three makes the
  // verdict readable without another run: monoDom equal to monoConsolas means the
  // chrome.fontSettings pin took effect, equal to monoCourier means it did not.
  T('fonts.monoDom', function () {
    var s = document.createElement('span');
    s.textContent = 'mmMwWLliI0fiflO&1';
    s.style.cssText = 'position:absolute;left:-9999px;font-size:48px;white-space:nowrap;font-family:monospace';
    document.body.appendChild(s);
    var v = s.getBoundingClientRect().width;
    document.body.removeChild(s);
    return v;
  });
  T('fonts.monoRef', function () {
    var s = document.createElement('span');
    s.textContent = 'mmMwWLliI0fiflO&1';
    s.style.cssText = 'position:absolute;left:-9999px;font-size:48px;white-space:nowrap';
    document.body.appendChild(s);
    var out = [];
    ['Consolas', 'Courier New'].forEach(function (f) {
      s.style.fontFamily = "'" + f + "'";
      out.push(f + '=' + s.getBoundingClientRect().width);
    });
    document.body.removeChild(s);
    return out.join(' ');
  });
  T('fonts.widthsRaw', function () {
    var span = document.createElement('span');
    span.style.cssText = 'position:absolute;left:-9999px;font-size:48px';
    span.textContent = 'mmmmmmmmmmlli';
    document.body.appendChild(span);
    var w = FONTS.map(function (f) {
      span.style.fontFamily = "'" + f + "',monospace";
      return span.getBoundingClientRect().width;
    });
    document.body.removeChild(span);
    return H(w.join(','));
  });
  // Generic families at full precision — the known carrier, kept so this readout shows it
  // in the same table as everything else.
  T('fonts.generics', function () {
    var x = document.createElement('canvas').getContext('2d'), out = [];
    ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'].forEach(function (g) {
      x.font = '48px ' + g;
      out.push(x.measureText('mmMwWLliI0fiflO&1').width);
    });
    return out.join('|');
  });

  // ---------- storage / browser-kind checks ----------
  T('store.presence', function () {
    return [!!window.localStorage, !!window.sessionStorage, !!window.indexedDB,
      !!window.openDatabase, !!window.caches].map(function (b) { return b ? '1' : '0'; }).join('');
  });
  T('api.presence', function () {
    return ['xr', 'hid', 'usb', 'serial', 'bluetooth', 'credentials', 'mediaDevices',
      'storage', 'permissions', 'geolocation'].map(function (k) {
      return (k in navigator) ? '1' : '0'; }).join('');
  });
  T('worker.presence', function () {
    return [!!window.Worker, !!window.SharedWorker, !!(navigator.serviceWorker)]
      .map(function (b) { return b ? '1' : '0'; }).join('');
  });

  // ---------- intl / time ----------
  T('intl.timeZone', function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; });
  T('intl.offset',   function () { return new Date(2026, 0, 15).getTimezoneOffset(); });
  T('intl.locale',   function () { return Intl.DateTimeFormat().resolvedOptions().locale; });

  // ---------- speech ----------
  T('voices', function () {
    var v = speechSynthesis.getVoices() || [];
    return v.length + ':' + H(v.map(function (x) { return x.name + '/' + x.lang; }).join(','));
  });

  // ---------- automation names the agent looks for on window ----------
  // Presence is the wrong test: "webdriver" in navigator is true in EVERY modern Chrome,
  // the property just reads false when nobody is driving. Only a truthy VALUE is a tell.
  T('automation', function () {
    var names = ['_phantom', 'callPhantom', '__nightmare', 'domAutomation',
      '__driver_evaluate', '__lastWatirAlert', '_Selenium_IDE_Recorder', 'awesomium',
      'cdc_asdjflasutopfhvcZLmcfl_'];
    var hits = names.filter(function (n) {
      try { return !!window[n]; } catch (e) { return false; }
    });
    try { if (navigator.webdriver === true) hits.push('navigator.webdriver=true'); } catch (e) {}
    return hits.length ? hits.join(',') : 'none';
  });

  return o;
})();
<\/script></body></html>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PROBE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const cleanBrowser = await chromium.launch({ ...BROWSER, headless: !headed });
const cleanPage = await (await cleanBrowser.newContext()).newPage();
await cleanPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 900));
const CLEAN = await cleanPage.evaluate(() => window.__probe);
// The negative control for the stability check below. Chrome's own font cache warms up
// between the first and second load of a page, and canvas text rendering depends on it, so
// "this value moved between two loads" is NOT evidence of our noise until a clean browser
// has been asked the same question the same way.
await cleanPage.reload({ waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 900));
const CLEAN2 = await cleanPage.evaluate(() => window.__probe);
await cleanBrowser.close();

const userDataDir = mkdtempSync(join(tmpdir(), 'afp-fpro-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

let RA, RB, RA2;
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(sw);

  async function run(sel) {
    const p = PROFILES.find((x) => x.id === sel.id);
    const c = COUNTRY_DATA[sel.cc];
    if (!p) throw new Error('no such profile: ' + sel.id);
    if (!c) throw new Error('no such country: ' + sel.cc);
    await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
      afp_profile_id: p.id,
      afp_profile_data: { screenW: p.screenW, screenH: p.screenH, cores: p.cores,
        memory: p.memory, gpu: p.gpuKey, platform: p.platform },
      afp_country_code: sel.cc, afp_resolved_timezone: c.tz,
      afp_resolved_locale: c.loc, afp_mode: 'normal', afp_features: ALL_ON
    });
    await new Promise((r) => setTimeout(r, 900));
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    const want = afpPackFeatures(ALL_ON);
    const arrived = await page
      .waitForFunction((w) => sessionStorage.getItem('v.ui.f') === w, want, { timeout: 10000 })
      .then(() => true).catch(() => false);
    ok(arrived, `${sel.id}/${sel.cc}: the flags reached the page before the reload`);
    await page.reload({ waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 900));
    const out = await page.evaluate(() => window.__probe);
    await page.close();
    return out;
  }

  RA = await run(A);
  // Profile A a second time, and it MUST come before B. Writing afp_profile_id /
  // afp_profile_data is what background.js:1487 watches to mint a fresh noise seed —
  // deliberately, so that two different profiles cannot share a canvas hash. So a
  // stability check that reads A, switches to B, then comes back to A is measuring its own
  // profile switch: three writes, three seeds. Ordered A, A, B, the only thing left that
  // can move a value between the first two reads is genuine per-load randomness.
  RA2 = await run(A);
  RB = await run(B);
} finally {
  await ctx.close();
  rmSync(userDataDir, { recursive: true, force: true });
  server.close();
}

const moved = ['nav.hardwareConcurrency', 'intl.timeZone', 'gl.unmasked', 'nav.language']
  .filter((k) => String(RA[k]) !== String(RB[k]));
ok(moved.length === 4, `the profile really changed between runs — moved: ${moved.join(', ')}`);

const keys = Object.keys(RA);
const same = keys.filter((k) => String(RA[k]) === String(RB[k]));
const notClosed = same.filter((k) => String(RA[k]) === String(CLEAN[k]));
const ourConstants = same.filter((k) => String(RA[k]) !== String(CLEAN[k]));

console.log(`\nprofile A ${A.id}/${A.cc}  ->  ${RA['nav.hardwareConcurrency']} cores, ${RA['intl.timeZone']}`);
console.log(`profile B ${B.id}/${B.cc}  ->  ${RB['nav.hardwareConcurrency']} cores, ${RB['intl.timeZone']}`);
console.log(`\n${keys.length} of the agent's reads probed; ${keys.length - same.length} move with the profile, ${same.length} do not.`);

console.log(`\n### NOT CLOSED — identical across profiles AND equal to a clean browser (${notClosed.length})`);
console.log(`Judge each: for oscpu / cpuClass / openDatabase-style keys this is the correct answer.`);
for (const k of notClosed) console.log(`   ${k.padEnd(24)} ${String(RA[k]).slice(0, 68)}`);

console.log(`\n### OUR CONSTANTS — identical across profiles, different from clean (${ourConstants.length})`);
for (const k of ourConstants) console.log(`   ${k.padEnd(24)} ours ${String(RA[k]).slice(0, 30)}   clean ${String(CLEAN[k]).slice(0, 30)}`);

console.log(`\n### CLOSED — moves with the profile (${keys.length - same.length})`);
console.log('   ' + keys.filter((k) => !same.includes(k)).join(', '));

// Printed as values, not as a bucket. The DOM rect noise is seeded per profile, so the
// monospace rows move between profiles for a reason that has nothing to do with which face
// the generic resolved to — the classification above cannot answer that and the numbers can.
//
// READ THIS BEFORE CONCLUDING THE PIN IS BROKEN: this suite runs headless, and headless
// Chromium ignores the chrome.fontSettings preference for RENDERING while still reporting
// it as applied. So `ours` matching Courier New here is expected and means nothing. The
// pin is verified in test/fontpin.mjs --headed, where the same build resolves monospace to
// Consolas (448.64 against Courier New's 489.69).
console.log(`\nmonospace generic — ours  ${RA['fonts.monoDom']}   [${RA['fonts.monoRef']}]`);
console.log(`                    clean ${CLEAN['fonts.monoDom']}   [${CLEAN['fonts.monoRef']}]`);

// A hit here is not entropy, it is a straight bot verdict. Asserted against the CLEAN
// browser rather than against 'none': this rig drives Chromium through CDP, so
// navigator.webdriver is genuinely true in both browsers and that is the rig, not the
// build. What must hold is that the extension does not ADD a tell the clean browser lacks.
console.log(`\nautomation globals — ours: ${RA['automation']}   clean: ${CLEAN['automation']}`);
ok(RA['automation'] === 'none',
  `no automation global is truthy under the extension (got ${RA['automation']}; the clean control shows ${CLEAN['automation']} because this rig drives Chromium over CDP — hiding it is the extension working)`);

// Same profile, twice. Not "does it differ from another profile" but "does it differ from
// ITSELF" — a value that fails this is per-session randomness wearing a profile's name.
const unstable = keys.filter((k) => String(RA[k]) !== String(RA2[k]));
const cleanUnstable = keys.filter((k) => String(CLEAN[k]) !== String(CLEAN2[k]));
const oursOnly = unstable.filter((k) => !cleanUnstable.includes(k));
console.log(`\n### UNSTABLE — same profile, two loads, different answer (${unstable.length})`);
for (const k of unstable) {
  const alsoClean = cleanUnstable.includes(k) ? '  [clean browser too — not ours]' : '  [stable in clean — OURS]';
  console.log(`   ${k.padEnd(24)} run1 ${String(RA[k]).slice(0, 24)}   run2 ${String(RA2[k]).slice(0, 24)}${alsoClean}`);
}
if (cleanUnstable.length) {
  console.log(`   (the clean control is itself unstable on: ${cleanUnstable.join(', ')})`);
}
ok(oursOnly.length === 0,
  `nothing is unstable under the extension that is stable in a clean browser (ours only: ${oursOnly.join(', ') || 'none'})`);

// The one thing in this readout that is not a leak but a CONTRADICTION: a media feature
// where we answer false to every value, which no real browser can do.
const mqPairs = [
  ['mq.forcedColors', ['(forced-colors: active)', '(forced-colors: none)']],
  ['mq.prefersColorScheme', ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']],
  ['mq.reducedMotion', ['(prefers-reduced-motion: reduce)', '(prefers-reduced-motion: no-preference)']]
];
for (const [k, qs] of mqPairs) {
  const ours = String(RA[k]), clean = String(CLEAN[k]);
  const exclusive = (s) => s.split('').filter((c) => c === '1').length === 1;
  ok(exclusive(ours) === exclusive(clean),
    `${k}: exactly one of ${qs.join(' / ')} answers true, as in a clean browser (ours ${ours}, clean ${clean})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
