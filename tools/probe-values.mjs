/**
 * THE SAME VALUE, READ FROM FOUR SCOPES OF ONE ORDINARY PAGE — clean browser against ours.
 *
 *   node tools/probe-values.mjs
 *   node tools/probe-values.mjs --headed
 *
 * tools/probe-scopes.mjs asks whether a NAME exists in the window and not in the worker; its
 * header says values are never read, and this is the other half of that question. A property
 * both scopes have, answering DIFFERENTLY in each, is a contradiction a page reads with one
 * `new Worker()` — and this project has paid for it:
 *
 *   navigator.connection    window 4g/50/10      worker 4g/100/8.35
 *
 * [FIX connection-was-half-patched-in-workers]. It was found by sweeping window against
 * worker on an ORDINARY page — not on a stand-down origin, not on a dev fixture — which is
 * the axis this tool is, made permanent.
 *
 * WHAT ALREADY COVERS PART OF IT, and what each one leaves (checked, not assumed):
 *
 *   test/wbcoherence.mjs   window vs dedicated worker vs same-origin iframe, 13 hand-picked
 *                          keys. Its SUBJECT is the two stand-down origin shapes (/wb/,
 *                          /tt/); the /plain/ row is that suite's control. No shared worker.
 *   test/fps-core.mjs      window vs dedicated vs shared, on four values (cores, memory, tz,
 *                          offset), the accept-language set, and the canvas.
 *   test/modules.mjs       reads navigator.connection in the WINDOW only — the exact value
 *                          the defect above split on.
 *   tools/probe-scopes.mjs names, never values.
 *
 * None of them can simply grow a key list, and that is the structural reason this file is
 * separate rather than four more assertions in one of them: they all assert EQUALITY between
 * scopes with the extension loaded, while a browser splits some of these BY ITSELF
 * (maxTouchPoints and pdfViewerEnabled are on Navigator and not on WorkerNavigator; a worker
 * may get a different GL backend). Any key added to those suites has to be one that happens
 * to agree, so the interesting half of the surface can never go in.
 *
 * THE CLEAN BROWSER IS THE AUTHORITY. A split that is already there with nothing loaded is a
 * platform fact and is listed as such; only a split that APPEARS or DISAPPEARS under the
 * extension is ours. That is what lets the collector read everything a worker can reach
 * instead of the subset that happens to match, and it is the same rule tools/probe-scopes.mjs
 * applies to names.
 *
 * BOTH BROWSERS ARE LAUNCHED THE SAME WAY, persistent profile included. probe-scopes takes
 * its clean reading from a non-persistent context, which is free for names and is not free
 * here: storage.estimate() and permissions.query() answer from profile state, so a
 * persistent-vs-temporary difference would come back as a divergence with nothing wrong. The
 * two launches differ by the two --load-extension arguments and by nothing else.
 *
 * VALUES THAT MOVE ON THEIR OWN CANNOT SUPPORT A VERDICT, so the window is read twice per
 * browser, on two loads of the same origin, and any key that answers differently across them
 * is left out of the exit code. Without that control a value that jitters would be
 * indistinguishable from a scope the extension forgot: on the first run of this tool,
 * navigator.connection's rtt and downlink moved between two loads of the CLEAN browser, which
 * is why those four fields are read one by one — effectiveType and saveData stay judged while
 * the two estimates stand down. A key that stands down still has every reading it took
 * printed — two window loads and three scopes, in both browsers — because refusing a verdict
 * is not a reason to withhold the numbers.
 *
 * WHAT IT DOES NOT ANSWER:
 *   - whether the agreed value is the SELECTED PROFILE's. Four scopes that all report the
 *     host are coherent, and pass here; test/modules.mjs and test/coldstart.mjs judge the
 *     value itself.
 *   - the NAME surface — a property present in one scope and absent in the other shows up
 *     here only as coarse "undefined vs 8", and the own-property shape that came with the
 *     connection defect is not visible at all. tools/probe-scopes.mjs is that instrument.
 *   - the site's own service worker. It reads the real machine and MV3 offers no
 *     interception (README "Limits", item 5), so reading it would print the same permanent row on
 *     every run and teach the reader to ignore the exit code.
 *   - cross-origin frames, sandboxed frames, and the stand-down origin shapes —
 *     test/wbcoherence.mjs and test/framerealm.mjs.
 *   - what a read COSTS — tools/probe-cost.mjs.
 *   - more than one machine and one profile: this is a coherence instrument, not a crowd one.
 *
 * THE KEY LIST GREW (2026-09-06), and each addition has a reason:
 *   gl.readPixels.1x1   the 1x1-vs-block invariant. A per-read flatness gate rolls all noise
 *                       off a single-pixel read, which made the readback noise strippable
 *                       pixel by pixel until it was fixed; asked in every scope because that
 *                       is the kind of defect that comes back in one scope only.
 *   intl.Segmenter and the other newer constructors — [FIX temporal-and-newer-intl-ctors] is
 *                       on record for these answering the HOST locale while the older ones
 *                       were patched, which is what a hand-listed API set does over time.
 *   control.arith, control.digest   values that MUST NOT differ between scopes in any
 *                       browser: a pure computation and a SHA-256 of a fixed string. Without
 *                       one of these the report cannot tell "no split" from "measuring
 *                       nothing", and a collector that silently threw would read as a pass.
 *                       They must also stay out of the "what the extension changes" list —
 *                       if either ever appears there, the tool is measuring itself.
 *
 * Exit code is the number of divergences from the clean browser attributable to the extension.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, BROWSER } from '../test/harness.mjs';
import { settle } from './probe-settle.mjs';

const headed = process.argv.includes('--headed');

// ONE collector, handed to all four scopes as source text — the same design as
// test/wbcoherence.mjs and tools/probe-collect.mjs, and for the same reason: two readers of
// the same surface drift, and a drifted pair reports the drift as a finding.
//
// Every value is stringified at the source, so what crosses postMessage is flat text and a
// getter that throws becomes 'THREW TypeError' rather than a lost row. OffscreenCanvas is
// used in the window as well as in the workers: a window that measured through a <canvas>
// would be comparing two different code paths and calling the difference a scope split.
const READ = `(async function () {
  var o = {};
  var t = function (k, f) { try { o[k] = String(f()); } catch (e) { o[k] = 'THREW ' + e.name; } };
  var ta = async function (k, f) { try { o[k] = String(await f()); } catch (e) { o[k] = 'THREW ' + e.name; } };
  var N = navigator;

  // maxTouchPoints and pdfViewerEnabled are Navigator-only in the platform and spoofed by
  // this extension — the pair where defining one on WorkerNavigator would be a signature of
  // the same shape as [FIX we-invented-a-chrome-runtime].
  ['hardwareConcurrency','deviceMemory','platform','userAgent','appVersion','appName',
   'appCodeName','product','vendor','vendorSub','productSub','language','onLine','webdriver',
   'doNotTrack','globalPrivacyControl','maxTouchPoints','pdfViewerEnabled'].forEach(function (k) {
     t('nav.' + k, function () { return N[k]; }); });
  t('nav.languages', function () { return (N.languages || []).join(','); });

  // Not sorted, deliberately: the high-entropy keys coming back in a different ORDER was
  // itself a defect ([FIX userAgentData-shape-not-just-values]), and sorting here would hide
  // a scope that answers in a different order.
  t('uad.brands', function () { return JSON.stringify(N.userAgentData && N.userAgentData.brands); });
  t('uad.mobile', function () { return N.userAgentData && N.userAgentData.mobile; });
  t('uad.platform', function () { return N.userAgentData && N.userAgentData.platform; });
  await ta('uad.hev', function () {
    return N.userAgentData.getHighEntropyValues(['architecture','bitness','model','platformVersion',
      'uaFullVersion','fullVersionList','wow64','formFactors'])
      .then(function (v) { return JSON.stringify(v); });
  });

  // The whole Intl constructor family rather than DateTimeFormat alone: ICU resolves the
  // locale per SERVICE, so one patched constructor beside eight unpatched ones is a split a
  // single reading cannot see.
  ['DateTimeFormat','NumberFormat','Collator','PluralRules','RelativeTimeFormat','ListFormat',
   'DisplayNames','Segmenter','DurationFormat'].forEach(function (c) {
    t('intl.' + c, function () {
      var C = Intl[c]; if (!C) return 'absent';
      var i = (c === 'DisplayNames') ? new C(undefined, { type: 'region' }) : new C();
      var r = i.resolvedOptions();
      return [r.locale, r.timeZone || '', r.numberingSystem || '', r.calendar || ''].join('|');
    });
  });
  t('intl.zones', function () { return Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone').length : 'n/a'; });
  t('num.toLocaleString', function () { return (1234567.891).toLocaleString(); });

  // Five ways the clock answers, because [FIX date-value-construction-leaked-the-host-tz] was
  // five separate leaks and getTimezoneOffset was right through all of them.
  t('date.off.jan', function () { return new Date(2021, 0, 1).getTimezoneOffset(); });
  t('date.off.jul', function () { return new Date(2021, 6, 1).getTimezoneOffset(); });
  t('date.toString', function () { return new Date(1700000000000).toString(); });
  t('date.toLocaleString', function () { return new Date(1700000000000).toLocaleString(); });
  t('date.toTimeString', function () { return new Date(1700000000000).toTimeString(); });
  t('temporal.zone', function () { return (typeof Temporal !== 'undefined') ? Temporal.Now.timeZoneId() : 'absent'; });

  // Field by field, not one joined string: rtt and downlink are network ESTIMATES and move on
  // their own (measured — see the not-judged section of the report), and joining them to
  // effectiveType would drag the stable half out of the verdict with them. effectiveType is
  // the half a scope split shows up in first.
  ['effectiveType', 'rtt', 'downlink', 'saveData'].forEach(function (k) {
    t('conn.' + k, function () { var c = N.connection; return c ? c[k] : 'n/a'; });
  });
  t('secureContext', function () { return self.isSecureContext; });
  await ta('perm.geolocation', function () { return N.permissions.query({ name: 'geolocation' }).then(function (p) { return p.state; }); });
  await ta('perm.notifications', function () { return N.permissions.query({ name: 'notifications' }).then(function (p) { return p.state; }); });
  await ta('storage.quota', function () { return N.storage.estimate().then(function (e) { return e.quota; }); });
  var mc = function (k, type) {
    return ta('media.' + k, function () {
      return N.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType: type,
        width: 1920, height: 1080, bitrate: 2000000, framerate: 30 } })
        .then(function (r) { return [r.supported, r.smooth, r.powerEfficient].join('/'); });
    });
  };
  await mc('av1', 'video/mp4; codecs="av01.0.05M.08"');
  await mc('hevc', 'video/mp4; codecs="hvc1.1.6.L93.90"');

  // WebGL split across four keys rather than one long line, so a divergence names the half it
  // is in instead of scrolling off the report.
  var glCtx = function () { try { return new OffscreenCanvas(256, 256).getContext('webgl'); } catch (e) { return null; } };
  t('gl.strings', function () {
    var g = glCtx(); if (!g) return 'no-webgl';
    var d = g.getExtension('WEBGL_debug_renderer_info');
    var P = [g.getParameter(g.VENDOR), g.getParameter(g.RENDERER), g.getParameter(g.VERSION),
      g.getParameter(g.SHADING_LANGUAGE_VERSION)];
    if (d) { P.push(g.getParameter(d.UNMASKED_VENDOR_WEBGL)); P.push(g.getParameter(d.UNMASKED_RENDERER_WEBGL)); }
    return P.join(' | ');
  });
  t('gl.params', function () {
    var g = glCtx(); if (!g) return 'no-webgl';
    return [g.MAX_TEXTURE_SIZE, g.MAX_VARYING_VECTORS, g.MAX_VERTEX_ATTRIBS, g.MAX_RENDERBUFFER_SIZE,
      g.MAX_CUBE_MAP_TEXTURE_SIZE, g.MAX_FRAGMENT_UNIFORM_VECTORS, g.MAX_VERTEX_UNIFORM_VECTORS,
      g.MAX_TEXTURE_IMAGE_UNITS, g.RED_BITS, g.GREEN_BITS, g.DEPTH_BITS, g.STENCIL_BITS]
      .map(function (k) { return String(g.getParameter(k)); })
      .concat('vpd:' + g.getParameter(g.MAX_VIEWPORT_DIMS).join('x'),
        'alwr:' + g.getParameter(g.ALIASED_LINE_WIDTH_RANGE).join(',')).join('/');
  });
  t('gl.ext', function () {
    var g = glCtx(); if (!g) return 'no-webgl';
    var sp = g.getShaderPrecisionFormat(g.FRAGMENT_SHADER, g.HIGH_FLOAT);
    return (g.getSupportedExtensions() || []).length + ' ext, prec ' +
      [sp.rangeMin, sp.rangeMax, sp.precision].join(',');
  });
  // A SHADED quad, not a flat one: [FIX hostleak-probe-measured-the-wrong-webgl] measured
  // that a flat readback carries nothing, so a probe reading a solid colour would agree
  // across scopes on a build where nothing works.
  t('gl.readPixels', function () {
    var c, g;
    try { c = new OffscreenCanvas(64, 64); g = c.getContext('webgl', { preserveDrawingBuffer: true }); }
    catch (e) { return 'no-webgl'; }
    if (!g) return 'no-webgl';
    var vs = g.createShader(g.VERTEX_SHADER);
    g.shaderSource(vs, 'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}');
    g.compileShader(vs);
    var fs = g.createShader(g.FRAGMENT_SHADER);
    g.shaderSource(fs, 'precision highp float;varying vec2 v;void main(){float a=sin(v.x*12.)*cos(v.y*9.);gl_FragColor=vec4(abs(a),v.x*.5+.5,v.y*.5+.5,1.);}');
    g.compileShader(fs);
    var pr = g.createProgram(); g.attachShader(pr, vs); g.attachShader(pr, fs); g.linkProgram(pr); g.useProgram(pr);
    var b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    var lp = g.getAttribLocation(pr, 'p'); g.enableVertexAttribArray(lp);
    g.vertexAttribPointer(lp, 2, g.FLOAT, false, 0, 0);
    g.viewport(0, 0, 64, 64); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    var px = new Uint8Array(64 * 64 * 4); g.readPixels(0, 0, 64, 64, g.RGBA, g.UNSIGNED_BYTE, px);
    var h = 5381; for (var i = 0; i < px.length; i++) h = ((h * 33) ^ px[i]) >>> 0; return h;
  });

  await ta('webgpu', function () {
    if (!N.gpu) return Promise.resolve('absent');
    return N.gpu.requestAdapter().then(function (a) {
      if (!a) return 'no-adapter';
      var L = a.limits, ks = [];
      for (var k in L) ks.push(k + '=' + L[k]);
      ks.sort();
      return [a.info ? [a.info.vendor, a.info.architecture, a.info.device, a.info.description].join(',') : 'no-info',
        Array.from(a.features).sort().join(','), ks.length, ks.join(';').length].join(' | ');
    });
  });

  t('canvas2d', function () {
    var c = new OffscreenCanvas(220, 60), x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '16px "Segoe UI"'; x.fillStyle = '#f60'; x.fillRect(1, 1, 62, 20);
    x.fillStyle = '#069'; x.fillText('afp values probe', 2, 15);
    var d = x.getImageData(0, 0, 220, 60).data, h = 5381;
    for (var i = 0; i < d.length; i += 5) h = ((h * 33) ^ d[i]) >>> 0; return h;
  });
  t('text.widths', function () {
    var x = new OffscreenCanvas(10, 10).getContext('2d'), out = [];
    ['16px "Segoe UI"', '16px "MS Gothic"', '16px "Sylfaen"', '16px monospace',
     '16px "Nonexistent Family"', '16px "Marlett"', '16px Arial'].forEach(function (f) {
      x.font = f; out.push(x.measureText('mmmMMMwwwWWW').width.toFixed(4));
    });
    return out.join(',');
  });
  t('text.metrics', function () {
    var x = new OffscreenCanvas(10, 10).getContext('2d'); x.font = '16px Arial';
    var m = x.measureText('HgW');
    return [m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent,
      m.actualBoundingBoxDescent, m.fontBoundingBoxAscent, m.fontBoundingBoxDescent,
      m.alphabeticBaseline, m.emHeightAscent].map(function (v) { return String(v); }).join(',');
  });

  // ---- the 1x1-vs-block invariant, as a KEY rather than a separate suite ----------------
  // A per-read gate rolls all noise off a single-pixel read and leaves it on a block, and the
  // same pixel then answers two different values one call apart. That shipped in the WebGL
  // readback path and was strippable pixel by pixel until [FIX the-readback-noise-was-
  // strippable-one-pixel-at-a-time]. It is asked here because this tool asks every scope, and
  // the defect it guards against is exactly the kind that can come back in one scope only.
  t('gl.readPixels.1x1', function () {
    var c = new OffscreenCanvas(64, 64);
    var g = c.getContext('webgl', { preserveDrawingBuffer: true });
    if (!g) return 'no-webgl';
    var vs = g.createShader(g.VERTEX_SHADER);
    g.shaderSource(vs, 'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.0,1.0);}');
    g.compileShader(vs);
    var fs = g.createShader(g.FRAGMENT_SHADER);
    g.shaderSource(fs, 'precision highp float;varying vec2 v;void main(){float a=sin(v.x*12.0)*cos(v.y*9.0);gl_FragColor=vec4(abs(a),v.x*0.5+0.5,v.y*0.5+0.5,1.0);}');
    g.compileShader(fs);
    var pr = g.createProgram(); g.attachShader(pr, vs); g.attachShader(pr, fs);
    g.linkProgram(pr); g.useProgram(pr);
    var b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    var lp = g.getAttribLocation(pr, 'p'); g.enableVertexAttribArray(lp);
    g.vertexAttribPointer(lp, 2, g.FLOAT, false, 0, 0);
    g.viewport(0, 0, 64, 64); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    var block = new Uint8Array(64 * 64 * 4);
    g.readPixels(0, 0, 64, 64, g.RGBA, g.UNSIGNED_BYTE, block);
    var one = new Uint8Array(4), out = [];
    [[10, 10], [20, 33], [41, 7], [55, 55]].forEach(function (p) {
      g.readPixels(p[0], p[1], 1, 1, g.RGBA, g.UNSIGNED_BYTE, one);
      var i = (p[1] * 64 + p[0]) * 4;
      out.push((block[i] === one[0] && block[i + 1] === one[1] && block[i + 2] === one[2]) ? 'same' : 'DIFFER');
    });
    return out.join(',');
  });

  // ---- the newer Intl constructors, which a hand-listed set kept missing ----------------
  // [FIX temporal-and-newer-intl-ctors] is on record for exactly this: Segmenter and
  // DurationFormat answered the HOST locale while the older constructors were patched.
  ['Segmenter', 'DurationFormat', 'ListFormat', 'PluralRules', 'RelativeTimeFormat'].forEach(function (n) {
    t('intl.' + n, function () {
      if (typeof Intl === 'undefined' || !Intl[n]) return 'absent';
      return new Intl[n]().resolvedOptions().locale;
    });
  });

  // ---- controls: values that MUST NOT differ between scopes, in any browser --------------
  // Without one of these the report cannot tell "no split" from "measuring nothing". A pure
  // computation and a digest have no per-scope input at all, so a difference here means the
  // collector itself broke, not the extension.
  t('control.arith', function () {
    var h = 2166136261;
    for (var i = 0; i < 5000; i++) { h ^= i; h = Math.imul(h, 16777619) >>> 0; }
    return String(h) + '|' + Math.sqrt(2).toFixed(15) + '|' + (0.1 + 0.2);
  });
  await ta('control.digest', function () {
    if (!self.crypto || !self.crypto.subtle) return Promise.resolve('no-subtle');
    var data = new TextEncoder().encode('fingerprint-shield probe-values control');
    return self.crypto.subtle.digest('SHA-256', data).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('').slice(0, 32);
    });
  });
  return o;
})()`;

const WORKER_JS = `self.onmessage = function () { Promise.resolve(${READ}).then(function (v) { postMessage(v); }); };\n`;
const SHARED_JS = `self.onconnect = function (e) {
  var p = e.ports[0];
  p.onmessage = function () { Promise.resolve(${READ}).then(function (v) { p.postMessage(v); }); };
  p.start();
};\n`;

// The frame PUBLISHES its reading rather than being eval'd from the parent, so the reading is
// the frame's own realm doing the work. Its src is a real HTTP document, not srcdoc: an
// iframe has two realms in its life, and probe-scopes documents at length what reading the
// first one reports.
const FRAME_JS = `<!doctype html><meta charset="utf-8"><title>f</title>`
  + `<script>window.__r = ${READ};<` + `/script>`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>values</title><script>
function __box(mk) {
  return new Promise(function (res) {
    var done = false, f = function (v) { if (!done) { done = true; res(v); } };
    try { mk(f); } catch (e) { f('threw:' + e.name); }
    setTimeout(function () { f('timeout'); }, 15000);
  });
}
window.__w = __box(function (f) {
  var w = new Worker('/worker.js');
  w.onmessage = function (e) { f(e.data); };
  w.onerror = function (e) { f('error:' + (e && e.message ? e.message : '(empty)')); };
  w.postMessage(1);
});
window.__s = __box(function (f) {
  var s = new SharedWorker('/shared.js');
  s.port.onmessage = function (e) { f(e.data); };
  s.onerror = function (e) { f('error:' + (e && e.message ? e.message : '(empty)')); };
  s.port.start(); s.port.postMessage(1);
});
window.__f = __box(function (f) {
  var fr = document.createElement('iframe');
  fr.style.display = 'none';
  fr.onload = function () {
    try { Promise.resolve(fr.contentWindow.__r || 'no-reading').then(f); } catch (e) { f('threw:' + e.name); }
  };
  fr.src = '/frame';
  document.documentElement.appendChild(fr);
});
</script></head><body>values</body></html>`;

// Same origin, no workers: the second window reading is only there to find values that move
// on their own, and connecting to the shared worker again would measure the FIRST page's
// worker, which is not what the control is asking.
const BARE = '<!doctype html><meta charset="utf-8"><title>values</title><body>values';

const server = createServer((q, r) => {
  const p = q.url.split('?')[0];
  const js = { 'content-type': 'application/javascript', 'cache-control': 'no-store' };
  const html = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (p === '/worker.js') return r.writeHead(200, js).end(WORKER_JS);
  if (p === '/shared.js') return r.writeHead(200, js).end(SHARED_JS);
  if (p === '/frame') return r.writeHead(200, html).end(FRAME_JS);
  if (p === '/bare') return r.writeHead(200, html).end(BARE);
  r.writeHead(200, html).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

async function open_(withExtension) {
  const dir = mkdtempSync(path.join(tmpdir(), 'afp-values-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !headed,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: withExtension ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  if (withExtension) {
    await (ctx.serviceWorkers()[0] || ctx.waitForEvent('serviceworker', { timeout: 20000 }));
    // The shared wait rather than a counted number of loads — tools/probe-settle.mjs records
    // what measuring inside the install window looked like on a CI runner.
    const p = await ctx.newPage();
    await p.goto(BASE + '/bare', { waitUntil: 'load' });
    const s = await settle(p, BASE + '/bare');
    if (!s.settled) console.log(`  note: the profile had not settled after ${s.loads} loads (${s.value})`);
    await p.close();
  }
  return { ctx, dir };
}

async function readAll(ctx) {
  const page = await ctx.newPage();
  await page.goto(BASE + '/page', { waitUntil: 'load' });
  const win = await page.evaluate(READ);
  const worker = await page.evaluate('window.__w');
  const shared = await page.evaluate('window.__s');
  const frame = await page.evaluate('window.__f');
  await page.close();
  const page2 = await ctx.newPage();
  await page2.goto(BASE + '/bare?again=1', { waitUntil: 'load' });
  const win2 = await page2.evaluate(READ);
  await page2.close();
  return { win, win2, worker, shared, frame };
}

let CLEAN, OURS;
const A = await open_(false);
try { CLEAN = await readAll(A.ctx); } finally {
  await A.ctx.close();
  try { rmSync(A.dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
}
const B = await open_(true);
try { OURS = await readAll(B.ctx); } finally {
  await B.ctx.close();
  try { rmSync(B.dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  server.close();
}

const NL = String.fromCharCode(10);
const S = (v) => String(v);
const cut = (v, n) => { const s = S(v); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const keys = Object.keys(CLEAN.win);
const SCOPES = [['worker', 'dedicated worker'], ['shared', 'shared worker'], ['frame', 'same-origin iframe']];

// A key that answered differently on two loads of the same origin, in either browser. It
// cannot support a scope verdict in either direction, so it is named and stood down rather
// than counted — a jittering hash and a scope the extension forgot look identical otherwise.
const unstable = [];
for (const k of keys) {
  if (S(CLEAN.win[k]) !== S(CLEAN.win2[k]) || S(OURS.win[k]) !== S(OURS.win2[k])) unstable.push(k);
}

const rows = [];
const platform = {};
const unread = [];
for (const [scope, label] of SCOPES) {
  const c = CLEAN[scope], o = OURS[scope];
  const cOk = c && typeof c === 'object', oOk = o && typeof o === 'object';
  if (!cOk || !oOk) {
    // A scope the clean browser reads and ours does not is the extension removing a whole
    // execution context — the shape [FIX captcha-the-wrapper-killed-turnstile] had — so it
    // is one row, not a skipped axis.
    if (cOk && !oOk) rows.push({ scope: label, key: '(the whole scope)', kind: 'LOST by us', c: 'answered', o: S(o) });
    else if (!cOk && oOk) rows.push({ scope: label, key: '(the whole scope)', kind: 'GAINED by us', c: S(c), o: 'answered' });
    else unread.push(`${label}: neither browser read it (clean ${S(c)}, ours ${S(o)})`);
    continue;
  }
  for (const k of keys) {
    // A key that would not reproduce between two loads of the SAME browser cannot support
    // any statement about scopes, including a statement about the platform. This `continue`
    // used to sit BELOW the push on the next line, so a value that jittered between the
    // clean window read and the clean worker read — conn.downlink was measured doing exactly
    // that, 1.5 then 1.7 — could be printed under "PLATFORM SPLITS, present with nothing
    // loaded". Given [FIX connection-was-half-patched-in-workers], a report claiming the
    // BROWSER splits navigator.connection between window and worker is the most misleading
    // line this tool could emit, so the stand-down comes first.
    if (unstable.indexOf(k) !== -1) continue;
    const cAgree = S(CLEAN.win[k]) === S(c[k]);
    const oAgree = S(OURS.win[k]) === S(o[k]);
    if (!cAgree) (platform[label] = platform[label] || []).push(k);
    if (cAgree !== oAgree) {
      rows.push({
        scope: label, key: k, kind: cAgree ? 'SPLIT added' : 'SPLIT removed',
        c: `window ${cut(CLEAN.win[k], 70)}  |  ${cut(c[k], 70)}`,
        o: `window ${cut(OURS.win[k], 70)}  |  ${cut(o[k], 70)}`
      });
      continue;
    }
    // THE BLIND SPOT OF THE RULE ABOVE. `cAgree === oAgree` skips the row, and for a key the
    // PLATFORM already splits that discards the only question worth asking: both sides split,
    // so the shapes match, and a scope we simply failed to reach looks identical to one we
    // reached correctly. The tool would then be sensitive to a missed scope only where clean
    // happens to agree across scopes — sensitivity varying by key, with nothing saying so.
    //
    // The direct question instead: did the extension change this value in the window while
    // leaving this scope BYTE-IDENTICAL to a clean browser? That is what "the patch did not
    // reach here" looks like, and it does not care whether the platform splits.
    //
    // Guarded on both sides having a real reading: a key that is 'n/a', 'absent' or 'THREW'
    // in this scope for BOTH browsers is unreadable there by construction (screen.* in a
    // worker), and flagging it would be reporting the platform's own shape as our miss.
    const unread_ = (v) => /^(n\/a|absent|undefined|null|THREW\b)/.test(S(v));
    if (S(CLEAN.win[k]) !== S(OURS.win[k]) && S(c[k]) === S(o[k]) && !unread_(c[k])) {
      rows.push({
        scope: label, key: k, kind: 'SCOPE not reached',
        c: `window ${cut(CLEAN.win[k], 70)}  |  ${cut(c[k], 70)}`,
        o: `window ${cut(OURS.win[k], 70)}  |  ${cut(o[k], 70)}`
      });
    }
  }
}

console.log(NL + 'AXES READ' + NL);
console.log('  window vs dedicated worker, window vs shared worker, window vs same-origin iframe');
console.log(`  ${keys.length} values per scope, on an ordinary http origin with no CSP`);
for (const u of unread) console.log('  ' + u);

const touched = keys.filter((k) => S(CLEAN.win[k]) !== S(OURS.win[k]));
console.log(NL + 'WHAT THE EXTENSION CHANGES IN THE WINDOW (context — a value it does not touch' + NL +
  'cannot split because of it; whether the new value is the PROFILE\'s is not asked here)' + NL);
console.log('  changed: ' + (touched.join(', ') || '(nothing — check the extension actually loaded)'));

console.log(NL + 'NOT JUDGED — answered differently on two loads of the same origin, so a split' + NL +
  'between scopes cannot be told from the value moving between two reads' + NL);
if (!unstable.length) console.log('  (none — every value was reproducible in both browsers)');
// The readings are PRINTED rather than dropped. Standing a key down from the exit code is a
// refusal to give a verdict, not a reason to withhold the numbers — no data read as agreement
// is the failure tools/check-all.mjs's summariser was rewritten to stop making.
for (const k of unstable) {
  console.log('  ' + k);
  for (const [who, r] of [['clean', CLEAN], ['ours', OURS]]) {
    console.log(`      ${who.padEnd(6)}  two loads ${cut(r.win[k], 34)} then ${cut(r.win2[k], 34)}` +
      SCOPES.map(([s, label]) => `  |  ${label.split(' ')[0]} ` +
        (r[s] && typeof r[s] === 'object' ? cut(r[s][k], 34) : '(scope not read)')).join(''));
  }
}

console.log(NL + 'PLATFORM SPLITS, present with nothing loaded' + NL);
if (!Object.keys(platform).length) console.log('  (none)');
for (const label of Object.keys(platform)) {
  console.log('  ' + (label + ':').padEnd(20) + platform[label].join(', '));
}

console.log(NL + 'SPLITS THIS EXTENSION INTRODUCES OR REMOVES' + NL);
if (!rows.length) console.log('  (none — every value difference between scopes is the browser\'s own)');
for (const r of rows) {
  console.log(`  ${r.kind.padEnd(14)} ${r.scope.padEnd(19)} ${r.key}`);
  console.log(`      clean   ${r.c}`);
  console.log(`      ours    ${r.o}`);
}
console.log(NL + `${rows.length} divergence(s) attributable to the extension.` + NL);
process.exit(rows.length);
