/**
 * What survives a COMPLETE profile change? Those values are the host's, and they are what a
 * visitor id can be built from.
 *
 *   node test/hostleak.mjs             headless
 *   node test/hostleak.mjs --headed    watch it
 *
 * The standing open question in this project is that a commercial visitor id did not move
 * across a full profile + IP + country change. Answering "why" is usually said to need a
 * second machine — but the first half does not. Swap the profile for a maximally different
 * one (other device, other screen, other core count, other GPU, other country, other locale)
 * and read the whole observable surface twice. Anything IDENTICAL in both runs cannot be
 * coming from the profile, because the profile is the only thing that changed.
 *
 * A third run, in a browser with no extension at all, splits the identical values into the
 * two kinds that matter — and the distinction is the entire point:
 *
 *   identical AND equal to the clean browser  -> the HOST's own value, passed through
 *                                                untouched. High entropy, differs per
 *                                                machine, links every profile this user
 *                                                ever wears. These are the carriers.
 *   identical but DIFFERENT from clean        -> a constant this extension emits. Shared by
 *                                                every user of the build, so it does not
 *                                                link anyone to themselves — but it is a
 *                                                tell that the build is present.
 *
 * The suite states counts and lists names; it deliberately asserts almost nothing, because
 * "how many host values leak" is a number to drive down over time, not a pass/fail line. The
 * one thing it does assert is that the rig really did change the profile — without that,
 * every field looks like a carrier and the whole readout is worthless.
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

// Two selections with nothing in common: device class, screen, cores, memory, GPU, country,
// timezone, locale. If a value is the profile's, it has to move between these two.
const A = { id: 'laptop_low', cc: 'JP' };
const B = { id: 'pc_gaming', cc: 'BR' };

const PROBE = `<!doctype html><html><head><meta charset=utf-8></head><body>
<span id="t" style="font:16px Arial">Cwm fjord bank glyphs vext quiz</span>
<script>
window.__probe = (async function () {
  var o = {};
  var H = function (s) { var h = 5381, i; s = String(s);
    for (i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
  var T = function (k, fn) { try { o[k] = fn(); } catch (e) { o[k] = 'ERR:' + e.name; } };

  // ---- things the profile is SUPPOSED to move (rig sanity) ----
  T('nav.userAgent',        function () { return navigator.userAgent; });
  T('nav.cores',            function () { return navigator.hardwareConcurrency; });
  T('nav.memory',           function () { return navigator.deviceMemory; });
  T('nav.language',         function () { return navigator.language; });
  T('nav.languages',        function () { return (navigator.languages || []).join(','); });
  T('nav.platform',         function () { return navigator.platform; });
  T('screen.size',          function () { return screen.width + 'x' + screen.height; });
  T('screen.avail',         function () { return screen.availWidth + 'x' + screen.availHeight; });
  T('screen.colorDepth',    function () { return screen.colorDepth; });
  T('screen.dpr',           function () { return devicePixelRatio; });
  T('intl.timeZone',        function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; });
  T('date.offset',          function () { return new Date(2026, 0, 15).getTimezoneOffset(); });
  T('gl.vendor',            function () { var g = document.createElement('canvas').getContext('webgl');
    var d = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(d.UNMASKED_VENDOR_WEBGL); });
  T('gl.renderer',          function () { var g = document.createElement('canvas').getContext('webgl');
    var d = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(d.UNMASKED_RENDERER_WEBGL); });

  // ---- the surface a fingerprinter reads, whether or not we touch it ----
  T('canvas.2d', function () {
    var c = document.createElement('canvas'); c.width = 240; c.height = 60;
    var x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '14px Arial'; x.fillStyle = '#f60';
    x.fillRect(1, 1, 90, 24); x.fillStyle = '#069'; x.fillText('Cwm fjord \\u{1F3A8}', 2, 15);
    return H(c.toDataURL());
  });
  // [CORRECTED] This was ONE probe called 'canvas.webgl', and it was a clearColor + flat
  // readback — which the two-machine measurement recorded in mw/mw-canvas-audio.js says is
  // IDENTICAL on an Intel Arc and an NVIDIA RTX 3060:
  //
  //   webglFlat        clearColor + 4x4 readback          IDENTICAL
  //   webglShaderDiag  8 single pixels off a shaded quad  IDENTICAL
  //   webglShader      the whole 64x64 shaded image       DIFFERS
  //
  // So the old probe reported a "carrier" that carries nothing, and it did so for a reason
  // that is by DESIGN: the readPixels noise restores flat regions, exactly because the flat
  // ones were measured to hold no entropy. The suite was grading the extension down for
  // obeying its own measurement. Same shape as the domrects default@* false positive.
  //
  // Both are kept, and only the shaded one counts. The flat one stays because it is the
  // control: it MUST come back equal to a clean browser (a 1x1 pick of a solid colour has
  // to read back exact or GPU object picking breaks), and if it ever stops being equal,
  // something started noising flat pixels.
  T('canvas.webglFlat', function () {
    var c = document.createElement('canvas'); c.width = 128; c.height = 128;
    var g = c.getContext('webgl');
    g.clearColor(0.2, 0.4, 0.6, 1); g.clear(g.COLOR_BUFFER_BIT);
    var px = new Uint8Array(4 * 64); g.readPixels(0, 0, 8, 8, g.RGBA, g.UNSIGNED_BYTE, px);
    return H(Array.prototype.join.call(px, ''));
  });
  // The fragment shader and the interpolators — where float precision actually shows, and
  // the one WebGL value two real machines disagreed about. Same shader as
  // tools/collect-metrics.html raster.webglShader, so the two readouts are comparable.
  // (No backticks in this block: it lives inside a template literal.)
  T('canvas.webglShaded', function () {
    var cc = document.createElement('canvas'); cc.width = 64; cc.height = 64;
    var g = cc.getContext('webgl');
    if (!g) return 'no-webgl';
    var vs = g.createShader(g.VERTEX_SHADER);
    g.shaderSource(vs, 'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.0,1.0);}');
    g.compileShader(vs);
    var fs = g.createShader(g.FRAGMENT_SHADER);
    g.shaderSource(fs, 'precision highp float;varying vec2 v;void main(){' +
      'float d=length(v);float a=sin(d*12.0)*0.5+0.5;' +
      'gl_FragColor=vec4(a,v.x*0.5+0.5,v.y*0.5+0.5,1.0);}');
    g.compileShader(fs);
    var pr = g.createProgram();
    g.attachShader(pr, vs); g.attachShader(pr, fs);
    g.linkProgram(pr); g.useProgram(pr);
    var b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), g.STATIC_DRAW);
    var loc = g.getAttribLocation(pr, 'p');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    var buf = new Uint8Array(64 * 64 * 4);
    g.readPixels(0, 0, 64, 64, g.RGBA, g.UNSIGNED_BYTE, buf);
    return H(Array.prototype.join.call(buf, ''));
  });
  T('gl.extensions', function () {
    var g = document.createElement('canvas').getContext('webgl');
    return H((g.getSupportedExtensions() || []).slice().sort().join(','));
  });
  T('gl.params', function () {
    var g = document.createElement('canvas').getContext('webgl'), out = [];
    ['MAX_TEXTURE_SIZE','MAX_RENDERBUFFER_SIZE','MAX_VIEWPORT_DIMS','MAX_VERTEX_ATTRIBS',
     'MAX_VARYING_VECTORS','MAX_TEXTURE_IMAGE_UNITS','MAX_VERTEX_UNIFORM_VECTORS',
     'MAX_FRAGMENT_UNIFORM_VECTORS','ALIASED_LINE_WIDTH_RANGE','ALIASED_POINT_SIZE_RANGE',
     'RED_BITS','DEPTH_BITS','STENCIL_BITS'].forEach(function (k) {
      try { out.push(k + '=' + g.getParameter(g[k])); } catch (e) { out.push(k + '=ERR'); }
    });
    return H(out.join('|'));
  });
  T('gl.shaderPrecision', function () {
    var g = document.createElement('canvas').getContext('webgl'), out = [];
    [g.VERTEX_SHADER, g.FRAGMENT_SHADER].forEach(function (s) {
      [g.LOW_FLOAT, g.MEDIUM_FLOAT, g.HIGH_FLOAT, g.LOW_INT, g.MEDIUM_INT, g.HIGH_INT].forEach(function (p) {
        var r = g.getShaderPrecisionFormat(s, p);
        out.push(r ? (r.rangeMin + ',' + r.rangeMax + ',' + r.precision) : 'null');
      });
    });
    return H(out.join('|'));
  });
  T('text.measure', function () {
    var x = document.createElement('canvas').getContext('2d'), out = [];
    ['12px Arial', '16px serif', '20px monospace', '14px "Times New Roman"'].forEach(function (f) {
      x.font = f;
      var m = x.measureText('Cwm fjord bank glyphs vext quiz');
      out.push([m.width, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent,
        m.fontBoundingBoxAscent, m.fontBoundingBoxDescent].join(','));
    });
    return H(out.join('|'));
  });
  T('text.layoutWidth', function () {
    return document.getElementById('t').getBoundingClientRect().width.toFixed(3);
  });
  // GENERIC families, at full float precision. This is the one carrier two real machines
  // confirmed (Intel Arc vs NVIDIA RTX 3060, both Windows, extension off):
  //     serif@48    447.94732666015625   vs   447.9375
  //     default@48  443.58660888671875   vs   443.578125
  //     emoji       179.2585906982422    vs   179.25
  // The font module is an allowlist over NAMED families, so it never reaches these — a
  // generic resolves to whatever the OS picked and is measured at the host's sub-pixel
  // precision. Rounding hides it, which is why nothing here rounds.
  T('text.generics', function () {
    var x = document.createElement('canvas').getContext('2d'), out = [];
    ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'].forEach(function (g) {
      [16, 48].forEach(function (px) {
        x.font = px + 'px ' + g;
        out.push(x.measureText('mmMwWLliI0fiflO&1').width);
      });
    });
    return out.join('|');
  });
  T('text.emoji', function () {
    var x = document.createElement('canvas').getContext('2d');
    x.font = '48px sans-serif';
    var m = x.measureText('\\u{1F600}\\u{1F469}\\u200D\\u{1F4BB}');
    return m.width + '/' + (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
  });
  T('audio.oscillator', await (async function () {
    // The classic AudioContext fingerprint. Returned as a thunk so T() stays synchronous.
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
  T('codecs.video', function () {
    var v = document.createElement('video'), out = [];
    ['video/mp4; codecs="avc1.42E01E"', 'video/webm; codecs="vp9"', 'video/webm; codecs="av01.0.05M.08"',
     'video/ogg; codecs="theora"', 'video/mp4; codecs="hvc1.1.6.L93.B0"'].forEach(function (t) {
      out.push(v.canPlayType(t) || 'no'); });
    return out.join('|');
  });
  T('codecs.audio', function () {
    var a = document.createElement('audio'), out = [];
    ['audio/mpeg', 'audio/ogg; codecs="vorbis"', 'audio/wav; codecs="1"', 'audio/aac',
     'audio/webm; codecs="opus"'].forEach(function (t) { out.push(a.canPlayType(t) || 'no'); });
    return out.join('|');
  });
  T('codecs.recorder', function () {
    if (!window.MediaRecorder) return 'absent';
    return ['video/webm;codecs=vp9', 'video/webm;codecs=h264', 'audio/webm;codecs=opus']
      .map(function (t) { return MediaRecorder.isTypeSupported(t) ? '1' : '0'; }).join('');
  });
  // The decoder and the WebRTC codec list are the CARD talking, not a table — measured on
  // an Intel Arc against the same Chromium with hardware decode/encode disabled: AV1
  // powerEfficient true -> false, HEVC supported true -> false, video/H265 present ->
  // absent. The extension edits exactly one of these (AV1 powerEfficient, downwards, for a
  // claimed card without the decoder), so av1 moves with the profile and the rest are the
  // host's. The quota is read because it USED to be 60% of the disk; on Chrome 148 it is
  // a 10 GiB constant, which is what a carrier that stopped carrying looks like here.
  T('media.decodeAv1', await (async function () {
    try {
      var r = await navigator.mediaCapabilities.decodingInfo({ type: 'file',
        video: { contentType: 'video/mp4; codecs="av01.0.08M.08"', width: 1920, height: 1080, bitrate: 5000000, framerate: 30 } });
      var v = [r.supported, r.smooth, r.powerEfficient].join('/');
      return function () { return v; };
    } catch (e) { return function () { return 'ERR'; }; }
  })());
  T('media.decodeHevc', await (async function () {
    try {
      var r = await navigator.mediaCapabilities.decodingInfo({ type: 'file',
        video: { contentType: 'video/mp4; codecs="hvc1.1.6.L93.B0"', width: 1920, height: 1080, bitrate: 5000000, framerate: 30 } });
      var v = [r.supported, r.smooth, r.powerEfficient].join('/');
      return function () { return v; };
    } catch (e) { return function () { return 'ERR'; }; }
  })());
  T('rtc.sendCodecs', function () {
    var s = {}; RTCRtpSender.getCapabilities('video').codecs.forEach(function (c) { s[c.mimeType] = 1; });
    return Object.keys(s).sort().join(',');
  });
  T('storage.quota', await (async function () {
    try { var q = (await navigator.storage.estimate()).quota; return function () { return q; }; }
    catch (e) { return function () { return 'ERR'; }; }
  })());
  T('voices', function () {
    var v = speechSynthesis.getVoices() || [];
    return v.length + ':' + H(v.map(function (x) { return x.name + '/' + x.lang; }).join(','));
  });
  T('fonts.exotic', function () {
    var span = document.createElement('span');
    span.style.cssText = 'position:absolute;left:-9999px;font-size:72px';
    span.textContent = 'mmmmmmmmmmlli';
    document.body.appendChild(span);
    var w = [];
    ['Agency FB', 'Bahnschrift', 'Gabriola', 'Ink Free', 'Candara', 'Corbel', 'Sylfaen',
     'MS Outlook', 'Segoe Print', 'Nirmala UI'].forEach(function (f) {
      span.style.fontFamily = "'" + f + "',monospace";
      w.push(Math.round(span.getBoundingClientRect().width * 100));
    });
    document.body.removeChild(span);
    return H(w.join(','));
  });
  T('plugins', function () {
    return navigator.plugins.length + ':' +
      Array.prototype.map.call(navigator.plugins, function (p) { return p.name; }).join('|');
  });
  T('mimeTypes', function () { return navigator.mimeTypes.length; });
  T('connection', function () {
    var n = navigator.connection;
    return n ? [n.effectiveType, n.rtt, n.downlink, n.saveData].join('/') : 'absent';
  });
  T('maxTouchPoints', function () { return navigator.maxTouchPoints; });
  T('intl.locales', function () {
    return [Intl.NumberFormat().resolvedOptions().locale,
      Intl.Collator().resolvedOptions().locale,
      Intl.DateTimeFormat().resolvedOptions().locale,
      (Intl.ListFormat ? new Intl.ListFormat().resolvedOptions().locale : '-'),
      (Intl.Segmenter ? new Intl.Segmenter().resolvedOptions().locale : '-')].join('|');
  });
  T('intl.calendarNumbering', function () {
    var r = Intl.DateTimeFormat().resolvedOptions();
    return r.calendar + '/' + r.numberingSystem + '/' + r.hourCycle;
  });
  T('perf.resolution', function () {
    var a = performance.now(), b = performance.now(), n = 0;
    while (b === a && n < 100000) { b = performance.now(); n++; }
    return String(b - a).slice(0, 8);
  });
  T('math', function () {
    return [Math.tan(-1e300), Math.sinh(1), Math.expm1(1), Math.pow(Math.PI, -100)].join('|');
  });
  T('errorShape', function () {
    try { null.x(); } catch (e) { return e.constructor.name + ':' + e.message; }
    return 'none';
  });

  // ---- display and input traits: added because nothing here measured them ----
  // These are the physical machine, not the browser build, and none of them goes through
  // any API this extension patches. A fingerprinter reads them in one line each.
  //
  //   screen.isExtended        does this box have a SECOND MONITOR — one bit, and a rare
  //                            one: most visitors are false, so true is a strong split.
  //   availLeft / availTop     where the taskbar is, and on a multi-monitor layout which
  //                            side the secondary display sits on. Non-zero is unusual.
  //   color-gamut              srgb / p3 / rec2020 — the PANEL's colour space.
  //   dynamic-range            standard / high — HDR capability of the panel.
  //   pointer / hover          the input devices attached.
  // The prefers-* set is the user's own settings rather than the hardware, but it is the
  // same kind of thing: read with one matchMedia and never moved by a profile change.
  T('screen.extended', function () {
    return (typeof screen.isExtended === 'boolean') ? String(screen.isExtended) : 'absent';
  });
  T('screen.availOffset', function () {
    return [screen.availLeft, screen.availTop].join('/');
  });
  T('screen.orientation', function () {
    var o = screen.orientation;
    return o ? (o.type + '/' + o.angle) : 'absent';
  });
  T('css.gamut', function () {
    return ['srgb', 'p3', 'rec2020'].filter(function (g) {
      return matchMedia('(color-gamut: ' + g + ')').matches;
    }).join(',') || 'none';
  });
  T('css.dynamicRange', function () {
    return ['standard', 'high'].filter(function (d) {
      return matchMedia('(dynamic-range: ' + d + ')').matches;
    }).join(',') || 'none';
  });
  T('css.pointer', function () {
    var q = ['(pointer: fine)', '(pointer: coarse)', '(pointer: none)',
      '(hover: hover)', '(hover: none)', '(any-pointer: fine)', '(any-pointer: coarse)',
      '(any-hover: hover)'];
    return q.map(function (s) { return matchMedia(s).matches ? '1' : '0'; }).join('');
  });
  T('css.prefers', function () {
    var q = ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)',
      '(prefers-contrast: more)', '(forced-colors: active)',
      '(prefers-reduced-transparency: reduce)', '(inverted-colors: inverted)',
      '(monochrome)', '(update: fast)'];
    return q.map(function (s) { return matchMedia(s).matches ? '1' : '0'; }).join('');
  });
  T('css.resolution', function () {
    // dppx buckets — a second, independent read of the device pixel ratio that does not
    // go through devicePixelRatio at all.
    var out = [];
    [1, 1.25, 1.5, 2, 3].forEach(function (r) {
      out.push(matchMedia('(resolution: ' + r + 'dppx)').matches ? '1' : '0');
    });
    return out.join('');
  });
  T('window.outer', function () {
    // outerWidth/Height minus innerWidth/Height is the chrome of the window: toolbar
    // height, scrollbar width, and on Windows the OS scaling.
    return [outerWidth - innerWidth, outerHeight - innerHeight].join('/');
  });
  T('webgpu.info', await (async function () {
    try {
      if (!navigator.gpu) return function () { return 'absent'; };
      var ad = await navigator.gpu.requestAdapter();
      if (!ad) return function () { return 'no-adapter'; };
      var i = ad.info || {};
      var v = [i.vendor, i.architecture, i.device, i.description].join('/');
      return function () { return v; };
    } catch (e) { return function () { return 'ERR'; }; }
  })());
  // [dropped] css.fontFamilies and storage.quota were here and measured nothing:
  // getComputedStyle().fontFamily echoes the generic name back rather than the resolved
  // face, and the quota probe returned a Promise that stringified to [object Object]. Both
  // showed up as "carriers" on every run — a probe that always reports a leak is noise in
  // exactly the list that has to stay readable.
  return o;
})();
<\/script></body></html>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PROBE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/** The clean control: no extension, so every value here is this machine's own. */
const cleanBrowser = await chromium.launch({ ...BROWSER, headless: !headed });
const cleanPage = await (await cleanBrowser.newContext()).newPage();
await cleanPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 700));
const CLEAN = await cleanPage.evaluate(() => window.__probe);
await cleanBrowser.close();

const userDataDir = mkdtempSync(join(tmpdir(), 'afp-hostleak-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

let RA, RB;
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
    await new Promise((r) => setTimeout(r, 700));
    const out = await page.evaluate(() => window.__probe);
    await page.close();
    return out;
  }

  RA = await run(A);
  RB = await run(B);
} finally {
  await ctx.close();
  rmSync(userDataDir, { recursive: true, force: true });
  server.close();
}

// The rig has to have actually swapped machines, or every field is trivially "identical".
const moved = ['nav.cores', 'screen.size', 'intl.timeZone', 'gl.renderer', 'nav.language']
  .filter((k) => String(RA[k]) !== String(RB[k]));
ok(moved.length === 5,
  `the profile really changed between the two runs — moved: ${moved.join(', ')}`);

const keys = Object.keys(RA);
const same = keys.filter((k) => String(RA[k]) === String(RB[k]));
const hostCarriers = same.filter((k) => String(RA[k]) === String(CLEAN[k]));
const ourConstants = same.filter((k) => String(RA[k]) !== String(CLEAN[k]));

console.log(`\nprofile A  ${A.id}/${A.cc}   ->  ${RA['nav.cores']} cores, ${RA['screen.size']}, ${RA['intl.timeZone']}`);
console.log(`profile B  ${B.id}/${B.cc}   ->  ${RB['nav.cores']} cores, ${RB['screen.size']}, ${RB['intl.timeZone']}`);
console.log(`\n${keys.length} signals read; ${keys.length - same.length} moved with the profile, ${same.length} did not.\n`);

console.log(`HOST CARRIERS — identical across profiles AND equal to a clean browser (${hostCarriers.length}).`);
console.log('These are this machine\'s own values, passed through untouched. They are what links');
console.log('one user across every profile they wear:');
for (const k of hostCarriers) console.log(`   ${k.padEnd(22)} ${String(RA[k]).slice(0, 74)}`);

console.log(`\nOUR CONSTANTS — identical across profiles but NOT the clean value (${ourConstants.length}).`);
console.log('Shared by every user of this build, so they do not link a user to themselves —');
console.log('but they are a tell that the build is present:');
for (const k of ourConstants) console.log(`   ${k.padEnd(22)} ours ${String(RA[k]).slice(0, 34)}  clean ${String(CLEAN[k]).slice(0, 30)}`);

// Not every carrier above is worth the same. Most are shared by every Windows Chrome on
// earth — platform "Win32", colorDepth 24, the codec table, the plugin list — and carry no
// entropy to link anyone with. These are the ones that are known to vary per MACHINE, so
// these are the ones a visitor id can actually be built from. Named individually rather than
// counted, so that closing one is visible here and adding one cannot hide in a total.
// [CORRECTED against a second real machine] This list was first written from one machine and
// was wrong about most of it. Two Windows boxes, extension off, same probe
// (tools/collect-metrics.html) — an Intel Arc and an NVIDIA RTX 3060 — agreed EXACTLY on:
//
//   audio (124.04347528 both)        webgl.extensions (35, same list, same hash)
//   webgl.shaderPrecisions           webgl.maxAnisotropy
//   every webgl limit but one        math values and hash
//   all 40 named fontWidths
//
// ANGLE over D3D11 normalises the GL surface, so "the GPU's own extension list" is not the
// GPU's at all — it is ANGLE's, and it is the same on both vendors. Guessing which values
// carry entropy from a single machine produced three confident wrong answers; only the pair
// settled it. Nothing goes on this list now without two machines disagreeing about it.
const DISCRIMINATING = [
  // 443.58660888671875 vs 443.578125 at 48px, and the same shape at every generic family
  // and on emoji. The font allowlist covers NAMED families and never reaches these.
  'text.generics',
  'text.emoji',
  // 4096 vs 4095 — the single GL limit that moved, and it is not in dyn/dev/*.js at all.
  'gl.params',
  // GPU rasterisation, the one WebGL value two real machines disagreed about (Intel Arc vs
  // NVIDIA RTX 3060, b2d57cd1 / d4305829 on the whole 64x64 shaded image). The FLAT readback
  // beside it was identical on both and is deliberately NOT here: it carries no entropy, and
  // the readPixels noise restores flat regions on purpose. Listing the flat probe — which is
  // what this line used to do — graded the extension down for obeying that measurement.
  'canvas.webglShaded'
];
const leaking = DISCRIMINATING.filter((k) => hostCarriers.indexOf(k) !== -1);
console.log(`\nOf those, the ones known to differ per machine — the actual carriers: ${leaking.length} of ${DISCRIMINATING.length}`);
for (const k of leaking) console.log(`   ${k}`);

// A baseline, not a target: this suite exists to drive the number DOWN, and the assertion is
// only here so that a change which adds a new host value to the readout turns something red
// instead of scrolling past. Lower it whenever one is closed.
// Lowered 1 -> 0 when the last one closed. The 1 it used to allow was 'canvas.webgl', a
// clearColor + flat readback that the two-machine measurement says carries nothing — the
// suite was grading the extension down for restoring flat regions on purpose. Replaced by
// 'canvas.webglShaded', the 64x64 shaded quad those two machines actually disagreed about,
// and that one comes back noised: 0 of 4.
//
// Negative-controlled, because a probe that reports zero is worthless until it has been
// seen to report one: with `if (false)` in front of _installReadPixelsNoise in
// mw/mw-canvas-audio.js this run reports `canvas.webglShaded` as a carrier, 1 of 4.
const BASELINE = 0;
ok(leaking.length <= BASELINE,
  `no NEW per-machine value leaks (${leaking.length} of ${DISCRIMINATING.length}, baseline ${BASELINE}): ${leaking.join(', ')}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
