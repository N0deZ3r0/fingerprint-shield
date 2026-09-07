/**
 * A CLAIM THAT WAS NEVER MADE, AND A CLAIM MADE IN ONLY ONE SCOPE.
 *
 *   node test/btreadback.mjs             headless
 *   node test/btreadback.mjs --headed    watch it happen
 *
 * Two defects of 2026-09-05, both measured against clean Chromium 151, both with nothing
 * asserting them anywhere until now. They share a file because they share the only rig that
 * can see either: the extension loaded for real (--load-extension) with a clean browser of
 * the same binary beside it as the control.
 *
 * PART 1 — [FIX bluetooth-claim-deleted-the-api-and-never-fired], mw/mw-navigator.js.
 *
 * mw-navigator's desktop branch read `if (!_STEALTH && ID.hasBluetooth === false)` ONCE at
 * install, at document_start, against the injector's fallback skeleton — measured with
 * pc_gaming selected and the profile confirmed delivered (12 cores, 2560x1440 at the first
 * inline script), the injector at that same moment had `resolved bluetooth=null`, so
 * ID.hasBluetooth read TRUE and the branch never ran. Every neighbour is a live getter over
 * the profile and self-corrects; a boolean CONDITION cannot. Same shape as
 * [FIX dpr-was-gated-on-the-boot-profile] in mw/mw-timezone-screen.js.
 *
 * And the branch was the wrong thing to fire anyway. Forcing it on measured:
 *
 *     navigator.bluetooth                  undefined
 *     'bluetooth' in Navigator.prototype   true
 *     typeof Bluetooth                     "function"      <- the constructor STAYS
 *
 * No browser is shaped like that. Web Bluetooth's PRESENCE does not depend on an adapter —
 * measured on a clean browser, this rig:
 *
 *     'bluetooth' in Navigator.prototype    true
 *     navigator.bluetooth                   [object Bluetooth]
 *     navigator.bluetooth.getAvailability() -> true         (this host has an adapter)
 *
 * "No adapter" is getAvailability() resolving FALSE with the property present and normal.
 * So the suite asserts BOTH halves at once: a profile claiming no adapter must answer false
 * AND keep the whole surface a clean browser has. A guard that only checked getAvailability
 * would let the property removal come back.
 *
 * PART 2 — [FIX worker-readpixels-was-window-only], mw/mw-workers.js.
 *
 * tools/probe-values.mjs measured gl.readPixels noised in the window and untouched in both
 * worker scopes:
 *
 *     clean   window 508124549  |  dedicated 508124549  |  shared 508124549
 *     ours    window 3397168263 |  dedicated  508124549 |  shared  508124549
 *
 * A page reads two different rasterisation fingerprints one `new Worker()` apart. Same class
 * as [FIX connection-was-half-patched-in-workers], and it is worth noting WHICH value is the
 * carrier: the two-machine diff behind [FIX two-machine-diff-overturned-the-carriers] found a
 * flat clearColor readback IDENTICAL across two GPUs and the shaded 64x64 image DIFFERENT, so
 * this probe draws a SHADED quad. A flat readback would agree across scopes on a build where
 * nothing works at all — the mistake [FIX hostleak-probe-measured-the-wrong-webgl] records.
 *
 * THE SECOND HALF OF PART 2 IS AN OPEN DEFECT, NOT A GUARD ON A LANDED FIX. Both readback
 * implementations state, in their own comments, that a 1x1 read and the same pixel inside a
 * block must agree — "which is precisely what CheckIntegrity compares". They do not. Measured
 * here on the shaded quad with the worker port in place, all three scopes alike:
 *
 *     pixel (10,10)   1x1 read 243/42/42   inside a 64x64 read 244/42/43
 *     pixel (20,33)   1x1 read 214/82/133  inside a 64x64 read 216/81/133
 *
 * The size GATE is on the drawing buffer and is right; the ROLLBACK is not. Both scopes roll
 * their noise back against a SAME-RECT snapshot — _restoreFlatRegions(d, orig) in the window,
 * _PX.rfe against a copy of the requested rectangle in the worker — which decides "flat" from
 * the neighbours inside the returned buffer. A 1x1 buffer has no neighbours at all, so every
 * single-pixel read is unconditionally restored while the same pixel inside a block keeps its
 * noise. An 8x8 sub-block and the 64x64 block DO agree (216/81/133 both), which is why only a
 * 1x1 exposes it. The 2D path met exactly this and was fixed by reading the neighbours one
 * pixel wider off the surface itself — [FIX flatness-also-read-size-dependent],
 * _restoreFlatRegionsExpanded in mw/mw-canvas-audio.js. Porting that to both readback paths
 * (an expanded read through the CAPTURED native readPixels, clamped to the drawing buffer)
 * turns these assertions green with the three scopes still byte-identical — measured, 107
 * passed / 0 failed. Until that lands this suite is red on those rows, deliberately: the
 * invariant is stated in the code and a page can check it in two lines.
 *
 * WHY THE CLEAN BROWSER IS READ FOR BOTH PARTS AND NOT JUST ONE. Every expected value here is
 * a comparison, never a literal: "the same as clean" for the profile that claims an adapter,
 * "one value in all three scopes, as clean has one" for the readback. That is what keeps the
 * suite true on a host whose Bluetooth radio is absent, whose GPU is not this one, or whose
 * worker happens to get a different GL backend — and the clean row is also the vacuity guard,
 * since "all three scopes agree" is trivially true of a build that changes nothing.
 *
 * WHAT IT DOES NOT ANSWER: whether requestDevice behaves (it needs a user gesture and a
 * chooser), the service worker scope (README "Limits", item 5), and cross-origin frames —
 * test/wbcoherence.mjs and test/framerealm.mjs own that axis.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, harness, balanced, loadBackground, loadPopup, bootSettled } from './harness.mjs';
import { settle } from '../tools/probe-settle.mjs';

const headed = process.argv.includes('--headed');
const h = harness();

const { COUNTRY_DATA } = loadBackground(['COUNTRY_DATA']);
const { PROFILES } = loadPopup(['PROFILES']);

/**
 * The Bluetooth claim is read from dyn/dev/<id>.js — the record dyn/boot.js actually
 * publishes — rather than from a name that looks desktop-shaped. background.js derives the
 * flag from the profile id today; if that rule ever changes, this suite follows it instead
 * of asserting yesterday's mapping.
 */
function devRecord(id) {
  const src = readFileSync(join(root, 'dyn', 'dev', id + '.js'), 'utf8');
  return JSON.parse(balanced(src, /value:\s*\{/, '{', '}'));
}
const CLAIMS = PROFILES.map((p) => p.id)
  .filter((id) => { try { return typeof devRecord(id).bluetooth === 'boolean'; } catch (e) { return false; } })
  .map((id) => ({ id, record: devRecord(id) }));
const NO_ADAPTER = CLAIMS.find((c) => c.record.bluetooth === false);
const HAS_ADAPTER = CLAIMS.find((c) => c.record.bluetooth === true);
if (!NO_ADAPTER || !HAS_ADAPTER) {
  console.error('FAIL: dyn/dev carries no pair of profiles claiming a Bluetooth adapter and none');
  process.exit(1);
}

// ===== the two collectors, one text each, handed to every scope that reads them =====
// Stringified at the source for the same reason tools/probe-values.mjs does it: what crosses
// postMessage is flat text, and a getter that throws becomes a row rather than a lost read.

const READ_BT = `(function () {
  var o = {};
  var s = function (k, f) { try { o[k] = String(f()); } catch (e) { o[k] = 'THREW ' + e.name; } };
  // The property itself. undefined here is the regression this part exists to stop.
  s('bt.property', function () { return String(navigator.bluetooth); });
  s('bt.toString', function () { return Object.prototype.toString.call(navigator.bluetooth); });
  // The constructor must not contradict the property — the shape the removal produced.
  s('bt.typeofCtor', function () { return typeof Bluetooth; });
  s('bt.instanceof', function () { return navigator.bluetooth instanceof Bluetooth; });
  s('bt.protoIs', function () { return Object.getPrototypeOf(navigator.bluetooth) === Bluetooth.prototype; });
  s('bt.inProto', function () { return 'bluetooth' in Navigator.prototype; });
  // A member of a [Global]-adjacent interface belongs on the PROTOTYPE. Clean has no own
  // property here, and an own one is the shape [FIX uad-shape-not-just-values] was about.
  s('bt.ownProp', function () { return Object.prototype.hasOwnProperty.call(navigator, 'bluetooth'); });
  s('bt.identity', function () { return navigator.bluetooth === navigator.bluetooth; });
  s('bt.protoNames', function () { return Object.getOwnPropertyNames(Bluetooth.prototype).sort().join(','); });
  s('bt.gaLength', function () { return Bluetooth.prototype.getAvailability.length; });
  s('bt.gaSource', function () { return String(Bluetooth.prototype.getAvailability); });
  // The machine, so that a Bluetooth row can never be read as belonging to a profile that
  // had not landed yet — the exact confusion that made this defect look like something else.
  s('machine.cores', function () { return navigator.hardwareConcurrency; });
  s('machine.screen', function () { return screen.width + 'x' + screen.height; });
  return o;
})()`;

// Foreign receivers, run after load rather than at the first line: the rule landed in
// v2.5.11 and test/receivers.mjs enforces it generally, but neither covers this interface.
// instanceof is deliberately NOT used to decide anything here — it is false across realms
// while the native accessor answers, which is why the cross-realm row is its own reading.
const READ_BT_RECV = `(async function () {
  var o = {};
  var sync = function (k, f) { try { o[k] = 'RETURNED ' + String(f()); } catch (e) { o[k] = 'THREW ' + e.name; } };
  var settled = async function (k, f) {
    try { o[k] = 'RESOLVED ' + String(await f()); } catch (e) { o[k] = 'REJECTED ' + e.name; }
  };
  var d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'bluetooth');
  var fw = document.getElementById('f').contentWindow;
  sync('getter({})', function () { return d.get.call({}); });
  sync('getter(null)', function () { return d.get.call(null); });
  sync('getter(undefined)', function () { return d.get.call(undefined); });
  sync('getter(Navigator.prototype)', function () { return d.get.call(Navigator.prototype); });
  // A valid instance from another realm: the native ANSWERS, so a brand check that refuses
  // it is the failure the receiver rule names.
  sync('getter(frame navigator)', function () { return d.get.call(fw.navigator); });
  // getAvailability rejects ASYNCHRONOUSLY for a bad receiver — it returns a Promise and
  // never throws, measured on clean — so a wrapper that decides the answer without calling
  // the native at all shows up right here.
  await settled('getAvailability({})', function () { return Bluetooth.prototype.getAvailability.call({}); });
  await settled('getAvailability(null)', function () { return Bluetooth.prototype.getAvailability.call(null); });
  await settled('getAvailability(navigator)', function () { return Bluetooth.prototype.getAvailability.call(navigator); });
  await settled('getAvailability(Bluetooth.prototype)', function () { return Bluetooth.prototype.getAvailability.call(Bluetooth.prototype); });
  await settled('getAvailability(frame bluetooth)', function () { return Bluetooth.prototype.getAvailability.call(fw.navigator.bluetooth); });
  return o;
})()`;

// The shaded quad. Identical source in the window and in both workers, on an OffscreenCanvas
// in all three: a window measuring through a <canvas> would be comparing two code paths and
// calling the difference a scope split.
const SAMPLES = [[10, 10], [20, 33], [47, 5], [63, 63], [0, 0], [32, 32]];
const READ_GL = `(function () {
  var c, g;
  try { c = new OffscreenCanvas(64, 64); g = c.getContext('webgl', { preserveDrawingBuffer: true }); }
  catch (e) { return { err: 'ctx ' + e.name }; }
  if (!g) return { err: 'no-webgl' };
  var vs = g.createShader(g.VERTEX_SHADER);
  g.shaderSource(vs, 'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}');
  g.compileShader(vs);
  var fs = g.createShader(g.FRAGMENT_SHADER);
  g.shaderSource(fs, 'precision highp float;varying vec2 v;void main(){float a=sin(v.x*12.)*cos(v.y*9.);gl_FragColor=vec4(abs(a),v.x*.5+.5,v.y*.5+.5,1.);}');
  g.compileShader(fs);
  var pr = g.createProgram(); g.attachShader(pr, vs); g.attachShader(pr, fs);
  g.linkProgram(pr); g.useProgram(pr);
  var b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  var lp = g.getAttribLocation(pr, 'p'); g.enableVertexAttribArray(lp);
  g.vertexAttribPointer(lp, 2, g.FLOAT, false, 0, 0);
  g.viewport(0, 0, 64, 64); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  if (g.getError() !== 0) return { err: 'gl error before readback' };
  var px = new Uint8Array(64 * 64 * 4);
  g.readPixels(0, 0, 64, 64, g.RGBA, g.UNSIGNED_BYTE, px);
  var hh = 5381;
  for (var i = 0; i < px.length; i++) hh = ((hh * 33) ^ px[i]) >>> 0;
  var pts = ${JSON.stringify(SAMPLES)}, one = {}, block = {};
  for (var k = 0; k < pts.length; k++) {
    var p = pts[k], key = p[0] + ',' + p[1];
    var buf = new Uint8Array(4);
    // Read back to back on the same preserved drawing buffer, so nothing but the SIZE of the
    // request differs between the two readings of one pixel.
    g.readPixels(p[0], p[1], 1, 1, g.RGBA, g.UNSIGNED_BYTE, buf);
    one[key] = [buf[0], buf[1], buf[2]].join('/');
    var o = ((p[1] * 64) + p[0]) * 4;
    block[key] = [px[o], px[o + 1], px[o + 2]].join('/');
  }
  return { hash: String(hh >>> 0), one: one, block: block };
})()`;

const BT_PAGE = `<!doctype html><html><head><script>
window.__early = ${READ_BT};
// The CALL happens at the first inline script; only its answer arrives later. A read at the
// end of <body> would see the ~300ms injection instead and could not tell whether the boot
// path worked, which is the whole subject of test/coldstart.mjs.
window.__earlyAvail = (function () {
  try {
    return navigator.bluetooth.getAvailability()
      .then(function (v) { return 'RESOLVED ' + v; }, function (e) { return 'REJECTED ' + e.name; });
  } catch (e) { return Promise.resolve('THREW ' + e.name); }
})();
</script></head><body><iframe id="f"></iframe>bt</body></html>`;

const GL_PAGE = `<!doctype html><html><head><script>
window.__box = function (mk) {
  return new Promise(function (res) {
    var done = false, f = function (v) { if (!done) { done = true; res(v); } };
    try { mk(f); } catch (e) { f(JSON.stringify({ err: 'threw ' + e.name })); }
    setTimeout(function () { f(JSON.stringify({ err: 'timeout' })); }, 20000);
  });
};
window.__w = window.__box(function (f) {
  var w = new Worker('/glworker.js');
  w.onmessage = function (e) { f(e.data); };
  w.onerror = function (e) { f(JSON.stringify({ err: 'onerror ' + ((e && e.message) || '(empty)') })); };
  w.postMessage(1);
});
window.__s = window.__box(function (f) {
  var s = new SharedWorker('/glshared.js');
  s.port.onmessage = function (e) { f(e.data); };
  s.onerror = function () { f(JSON.stringify({ err: 'onerror' })); };
  s.port.start(); s.port.postMessage(1);
});
</script></head><body>gl</body></html>`;

const GL_WORKER = `self.onmessage = function () {
  var r; try { r = ${READ_GL}; } catch (e) { r = { err: String(e).slice(0, 60) }; }
  postMessage(JSON.stringify(r));
};`;
const GL_SHARED = `self.onconnect = function (ev) {
  var p = ev.ports[0];
  p.onmessage = function () {
    var r; try { r = ${READ_GL}; } catch (e) { r = { err: String(e).slice(0, 60) }; }
    p.postMessage(JSON.stringify(r));
  };
  p.start();
};`;

function serve() {
  return new Promise((ok) => {
    const s = createServer((req, res) => {
      const p = req.url.split('?')[0];
      const js = { 'content-type': 'application/javascript', 'cache-control': 'no-store' };
      const html = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
      if (p === '/glworker.js') return res.writeHead(200, js).end(GL_WORKER);
      if (p === '/glshared.js') return res.writeHead(200, js).end(GL_SHARED);
      if (p === '/gl') return res.writeHead(200, html).end(GL_PAGE);
      if (p === '/bare') return res.writeHead(200, html).end('<!doctype html><title>b</title>bare');
      return res.writeHead(200, html).end(BT_PAGE);
    });
    s.listen(0, '127.0.0.1', () => ok({ server: s, port: s.address().port }));
  });
}

/** What the popup writes when you pick this machine and this country — coldstart's helper. */
function selection(profileId, cc) {
  const p = PROFILES.find((x) => x.id === profileId);
  const c = COUNTRY_DATA[cc];
  if (!p) throw new Error(`no such profile in popup PROFILES: ${profileId}`);
  return {
    afp_profile_id: p.id,
    afp_profile_data: {
      screenW: p.screenW, screenH: p.screenH, cores: p.cores,
      memory: p.memory, gpu: p.gpuKey, platform: p.platform
    },
    afp_country_code: cc,
    afp_resolved_timezone: c.tz,
    afp_resolved_locale: c.loc,
    afp_mode: 'normal'
  };
}

const { server, port } = await serve();
const BASE = `http://127.0.0.1:${port}`;

async function open_(withExtension) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-btrb-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !headed,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: withExtension
      ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
      : []
  });
  let sw = null;
  if (withExtension) {
    sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/bare`, { waitUntil: 'load' });
    const s = await settle(p, `${BASE}/bare`);
    if (!s.settled) h.note(`the install had not settled after ${s.loads} loads (${s.value})`);
    await p.close();
  }
  return { ctx, dir, sw };
}

/**
 * Write the selection the way the popup does and let registerBootScript re-register — the
 * `apply` of test/coldstart.mjs. A probe that changes the profile and reads immediately is
 * measuring the PREVIOUS registration, which is how this defect spent an hour looking like
 * something else.
 */
async function apply(sw, storage) {
  await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, storage);
  await bootSettled(sw);
}

/** Reads the Bluetooth surface at the first inline script. `wantCores` polls the
 *  registration in rather than trusting a constant — see the note in coldstart on why a
 *  fixed wait around this handshake goes intermittent. */
async function readBt(ctx, wantCores) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/bt`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; wantCores != null && i < 10; i++) {
    const got = await page.evaluate(() => window.__early['machine.cores']);
    if (String(got) === String(wantCores)) break;
    await new Promise((r) => setTimeout(r, 400));
    await page.goto(`${BASE}/bt?again=${i}`, { waitUntil: 'domcontentloaded' });
  }
  const early = await page.evaluate(() => window.__early);
  early['bt.getAvailability'] = await page.evaluate(() => window.__earlyAvail);
  const recv = await page.evaluate(READ_BT_RECV);
  await page.close();
  return { early, recv };
}

async function readGl(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/gl`, { waitUntil: 'load' });
  const win = await page.evaluate(READ_GL);
  const worker = JSON.parse(await page.evaluate('window.__w'));
  const shared = JSON.parse(await page.evaluate('window.__s'));
  await page.close();
  return { window: win, 'dedicated worker': worker, 'shared worker': shared };
}

let clean, ours;
const A = await open_(false);
try {
  clean = { bt: await readBt(A.ctx, null), gl: await readGl(A.ctx) };
} finally {
  await A.ctx.close();
  try { rmSync(A.dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
}

const B = await open_(true);
try {
  ours = { bt: {}, gl: null };
  for (const c of [NO_ADAPTER, HAS_ADAPTER]) {
    await apply(B.sw, selection(c.id, 'DE'));
    ours.bt[c.id] = await readBt(B.ctx, c.record.cores);
  }
  // The readback carries no profile — the noise seed is per registrable domain — so it is
  // read once, under whichever selection part 1 left behind.
  ours.gl = await readGl(B.ctx);
} finally {
  await B.ctx.close();
  try { rmSync(B.dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
  server.close();
}

// ===== PART 1 =====
h.section('Bluetooth: present and unavailable, never absent');

// Everything about the SHAPE is compared to clean; the ANSWER is the one reading that is
// allowed to differ, and it has its own assertions below. Keeping it in this sweep would
// have made the suite demand that the claim never fires — which is the defect.
const BT_KEYS = Object.keys(clean.bt.early)
  .filter((k) => k.indexOf('bt.') === 0 && k !== 'bt.getAvailability');
// Two of the receiver rows are the ones the native ANSWERS for. A same-origin frame is
// patched like its opener, so its availability is the document's own answer, not the host's;
// what must match clean there is that the call was answered at all rather than refused.
const RECV_ANSWERS = ['getter(frame navigator)', 'getAvailability(frame bluetooth)'];
const RECV_REFUSALS = Object.keys(clean.bt.recv).filter((k) => RECV_ANSWERS.indexOf(k) === -1);
const short = (v) => { const s = String(v); return s.length > 46 ? s.slice(0, 45) + '…' : s; };
console.log(`  clean         ${clean.bt.early['bt.property']}  getAvailability() ${clean.bt.early['bt.getAvailability']}`);
for (const c of [NO_ADAPTER, HAS_ADAPTER]) {
  const e = ours.bt[c.id].early;
  console.log(`  ${c.id.padEnd(13)} ${e['bt.property']}  getAvailability() ${e['bt.getAvailability']}` +
    `  (claims ${c.record.bluetooth ? 'an adapter' : 'none'}, ${e['machine.cores']} cores ${e['machine.screen']})`);
}

for (const c of [NO_ADAPTER, HAS_ADAPTER]) {
  const { early, recv } = ours.bt[c.id];
  const tag = `${c.id} (claims ${c.record.bluetooth ? 'an adapter' : 'no adapter'})`;

  // The row belongs to the machine it says it does. Without this, every assertion below
  // could be about a profile that had not landed.
  h.eq(String(early['machine.cores']), String(c.record.cores), `${tag}: the profile is live at the first inline script (cores)`);
  h.eq(early['machine.screen'], `${c.record.screenW}x${c.record.screenH}`, `${tag}: and its screen`);

  // The property is THERE. This is the half a getAvailability-only check would miss.
  h.eq(early['bt.property'], '[object Bluetooth]', `${tag}: navigator.bluetooth is an object, not undefined`);
  h.eq(early['bt.typeofCtor'], 'function', `${tag}: the Bluetooth constructor exists`);
  h.eq(early['bt.instanceof'], 'true', `${tag}: navigator.bluetooth instanceof Bluetooth`);
  // Compared to clean rather than written out, so the assertion survives a platform that
  // adds a member or drops one.
  for (const k of BT_KEYS) {
    h.eq(early[k], clean.bt.early[k], `${tag}: ${k} matches a clean browser`);
  }
  // The receivers the platform REFUSES must be refused identically — a wrapper that decides
  // the answer without calling the native resolves here where clean rejects, and that is the
  // failure the receiver rule (v2.5.11) names.
  for (const k of RECV_REFUSALS) {
    h.eq(recv[k], clean.bt.recv[k], `${tag}: ${k} is refused as a clean browser refuses it`);
  }
  // The receivers it ANSWERS for must still be answered. Compared by KIND, because a
  // same-origin frame carries the same profile and so may legitimately answer false where
  // the host answers true — isPrototypeOf/instanceof would have got this row backwards.
  for (const k of RECV_ANSWERS) {
    h.eq(String(recv[k]).split(' ')[0], String(clean.bt.recv[k]).split(' ')[0],
      `${tag}: ${k} is answered, not refused (${recv[k]})`);
  }
  // One document, one answer: a fix that reached the top window and not its frames would
  // hand a page two readings of the same machine.
  h.eq(recv['getAvailability(frame bluetooth)'], early['bt.getAvailability'],
    `${tag}: a same-origin frame answers what the top window answers`);
  h.eq(recv['getter(frame navigator)'], clean.bt.recv['getter(frame navigator)'],
    `${tag}: the accessor still answers for a cross-realm navigator`);
}

// The claim itself. Compared against clean in BOTH directions: a profile with an adapter must
// be indistinguishable, one without must say so.
h.eq(ours.bt[HAS_ADAPTER.id].early['bt.getAvailability'], clean.bt.early['bt.getAvailability'],
  `${HAS_ADAPTER.id}: getAvailability() is exactly what a clean browser answers`);

if (clean.bt.early['bt.getAvailability'] === 'RESOLVED true') {
  h.eq(ours.bt[NO_ADAPTER.id].early['bt.getAvailability'], 'RESOLVED false',
    `${NO_ADAPTER.id}: getAvailability() resolves false`);
  // The vacuity guard: on a host that HAS a radio the two profiles must not answer alike,
  // which is what a build where the claim never fires does.
  h.assert(ours.bt[NO_ADAPTER.id].early['bt.getAvailability'] !== clean.bt.early['bt.getAvailability'],
    `${NO_ADAPTER.id}: the claim actually changed the answer (clean ${clean.bt.early['bt.getAvailability']})`);
} else {
  // Refusing a verdict is not a reason to withhold the reading — the numbers are printed
  // above either way. See the same rule in tools/probe-values.mjs.
  h.note(`this host answers ${clean.bt.early['bt.getAvailability']} with nothing loaded, so ` +
    '"claims no adapter" cannot be told from "claims one" here; the shape assertions still hold');
  h.eq(ours.bt[NO_ADAPTER.id].early['bt.getAvailability'], clean.bt.early['bt.getAvailability'],
    `${NO_ADAPTER.id}: getAvailability() is at least not MORE available than the host`);
}

// ===== PART 2 =====
h.section('gl.readPixels: one rasterisation, whatever scope asks');

const SCOPES = ['window', 'dedicated worker', 'shared worker'];
for (const [who, r] of [['clean', clean.gl], ['ours', ours.gl]]) {
  console.log('  ' + who.padEnd(7) + SCOPES.map((s) => `${s} ${short((r[s] && (r[s].hash || r[s].err)) || '?')}`).join('  |  '));
}

for (const who of ['clean', 'ours']) {
  const r = who === 'clean' ? clean.gl : ours.gl;
  for (const s of SCOPES) h.eq((r[s] || {}).err, undefined, `${who}: the ${s} read the framebuffer back`);
}
if (SCOPES.every((s) => clean.gl[s] && clean.gl[s].hash && ours.gl[s] && ours.gl[s].hash)) {
  // Clean first, and asserted rather than assumed: a rig where the PLATFORM splits the
  // readback between scopes cannot support any statement about ours, and must say so in its
  // own words instead of failing the row below.
  for (const s of SCOPES.slice(1)) {
    h.eq(clean.gl[s].hash, clean.gl.window.hash,
      `clean: the ${s} reads the same pixels as the window (${clean.gl[s].hash} vs ${clean.gl.window.hash})`);
  }
  for (const s of SCOPES.slice(1)) {
    h.eq(ours.gl[s].hash, ours.gl.window.hash,
      `ours: the ${s} reads the same pixels as the window (${ours.gl[s].hash} vs ${ours.gl.window.hash})`);
  }
  // Without this, "all three scopes agree" is also true of a build that noises nothing.
  h.assert(ours.gl.window.hash !== clean.gl.window.hash,
    `ours: the readback is actually perturbed (clean ${clean.gl.window.hash}, ours ${ours.gl.window.hash})`);

  // The invariant the window implementation states in its own comment. Asserted in every
  // scope and in BOTH browsers — clean is where it holds by construction, so a probe that
  // could not see the difference would fail there first.
  let moved = 0;
  for (const [who, r] of [['clean', clean.gl], ['ours', ours.gl]]) {
    for (const s of SCOPES) {
      for (const p of SAMPLES) {
        const key = p.join(',');
        h.eq(r[s].one[key], r[s].block[key],
          `${who}, ${s}: pixel (${key}) reads the same 1x1 as it does inside a 64x64 block`);
        if (who === 'ours' && r[s].block[key] !== clean.gl[s].block[key]) moved++;
      }
    }
  }
  // ...and the same vacuity guard one level down: a sample point that is identical to clean
  // in every scope would make the invariant above hold for the uninteresting reason.
  h.assert(moved > 0, 'ours: at least one sampled pixel differs from the clean browser');
}

h.done();
