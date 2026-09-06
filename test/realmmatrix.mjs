/**
 * EVERY SIGNAL × EVERY REALM, AGAINST A CLEAN BROWSER.
 *
 *   node test/realmmatrix.mjs             headless
 *   node test/realmmatrix.mjs --headed    watch it
 *   node test/realmmatrix.mjs --only=blob only the realms whose label contains "blob"
 *
 * The claim this extension makes is ONE machine, the same one everywhere. Two suites test
 * parts of that and neither tests the axis itself:
 *
 *   test/wbcoherence.mjs   the whole worker-readable surface, but THREE realms (window,
 *                          worker, iframe) and only on two CSP shapes
 *   test/framerealm.mjs    five frame SHAPES, but seven fields, no worker at all, no clean
 *                          control, and deliberately outside npm test
 *
 * So the realms nobody compares are exactly the ones that have gone wrong before, each
 * found separately and by accident rather than by a sweep:
 *
 *   data:/blob: frames   leaked the whole host including HeadlessChrome
 *   module workers       {type:'module'} bailed to the native constructor
 *   nested workers       a worker built inside a worker was never wrapped
 *   srcdoc               two earlier probes measured the wrong one of its two documents
 *
 * This file is the sweep. Thirteen realms, one signal set, and the same set read in a
 * SECOND browser with no extension loaded.
 *
 * THE RULE IS TWO-SIDED, and both sides are load-bearing:
 *
 *   1. In OURS every realm must equal the top window. A site reads two of them and the
 *      disagreement IS the fingerprint — that is the whole subject.
 *   2. In CLEAN every realm must equal the top window too. That is the CONTROL: it proves
 *      the harness actually reaches each realm and reads it correctly, so an inequality in
 *      (1) means a defect rather than a broken probe.
 *   3. Ours must DIFFER from clean on the top window. Without this, "every realm agrees"
 *      is satisfied by an extension that spoofs nothing at all — the same free pass
 *      test/workerpatchgate.mjs keeps a /ok/ route to close.
 *
 * A REALM THAT RETURNS NOTHING IS A FAILURE, NOT A SKIP. Two real audits were reported
 * green while a scope sat grey and unread, and one of those greys was hiding the
 * window-vs-worker split. Every realm below must produce a reading in the clean browser;
 * if it cannot, the harness is wrong and says so. A realm that reads in clean and not in
 * ours is a defect of ours and fails.
 *
 * NOT COVERED, DECLARED RATHER THAN SKIPPED: the service worker scope. MV3 offers no
 * interception there, it reads the real cores/timezone/locale/GPU, and that is recorded as
 * a known limit rather than pretended away. Adding it here would print one permanent red
 * that trains people to ignore the file.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';

const headed = process.argv.includes('--headed');
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

// ── the signal set ───────────────────────────────────────────────────────────
// Everything here must be readable in a WORKER as well as a document, because the point is
// to compare them against each other. Document-only signals (screen, devicePixelRatio) are
// collected separately and compared only across document realms — asserting them in a
// worker would fail for a reason that is not a defect.
const READ = `(function () {
  var o = {}, T = function (k, f) { try { var v = f(); o[k] = (v === undefined ? 'undefined' : String(v)); }
                                    catch (e) { o[k] = 'THREW:' + (e && e.name); } };
  var g = (typeof self !== 'undefined' ? self : this);
  var nav = g.navigator;
  T('cores', function () { return nav.hardwareConcurrency; });
  T('memory', function () { return nav.deviceMemory; });
  T('platform', function () { return nav.platform; });
  T('ua', function () { return nav.userAgent; });
  T('lang', function () { return nav.language; });
  T('langs', function () { return (nav.languages || []).join(','); });
  T('uadPlatform', function () { return nav.userAgentData ? nav.userAgentData.platform : 'no-uad'; });
  T('uadMobile', function () { return nav.userAgentData ? nav.userAgentData.mobile : 'no-uad'; });
  T('tz', function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; });
  T('locale', function () { return Intl.DateTimeFormat().resolvedOptions().locale; });
  // Both sides of the year: one offset can agree by accident, two cannot — a zone is
  // identified by its DST behaviour as much as by its winter offset.
  T('offJan', function () { return new Date(2026, 0, 15).getTimezoneOffset(); });
  T('offJul', function () { return new Date(2026, 6, 15).getTimezoneOffset(); });
  T('dateZone', function () { return (new Date(2026, 0, 15)).toString().replace(/^[^(]*/, ''); });
  // effectiveType ONLY. rtt and downlink are live estimates that Chrome re-rounds per realm
  // and per read — measured: the CLEAN browser disagreed with its own window on them in
  // eleven of thirteen realms, which makes them unusable as a coherence signal rather than
  // interesting. The bucketed field is the one a fingerprinter can rely on and so are we.
  T('conn', function () {
    var c = nav.connection;
    return c ? String(c.effectiveType) : 'no-connection';
  });
  // OffscreenCanvas exists in both scopes, which is what makes the canvas and WebGL rows
  // comparable across the axis at all. An opaque-origin frame may refuse a context; that
  // records as THREW and is compared like any other value.
  T('canvas', function () {
    var c = new OffscreenCanvas(120, 40), x = c.getContext('2d');
    if (!x) return 'no-2d';
    x.textBaseline = 'alphabetic'; x.font = '16px sans-serif';
    x.fillStyle = '#f60'; x.fillRect(2, 2, 80, 20);
    x.fillStyle = '#069'; x.fillText('Realm\\u2713 \\u0416', 4, 30);
    var d = x.getImageData(0, 0, 120, 40).data, h = 2166136261;
    for (var i = 0; i < d.length; i += 7) { h ^= d[i]; h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  });
  T('glVendor', function () {
    var c = new OffscreenCanvas(32, 32), gl = c.getContext('webgl');
    if (!gl) return 'no-webgl';
    var d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : 'no-ext';
  });
  T('glRenderer', function () {
    var c = new OffscreenCanvas(32, 32), gl = c.getContext('webgl');
    if (!gl) return 'no-webgl';
    var d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'no-ext';
  });
  return o;
})()`;

// Document realms carry these too. They are compared only against other DOCUMENT realms.
const READ_DOC = `(function () {
  var o = {}, T = function (k, f) { try { o[k] = String(f()); } catch (e) { o[k] = 'THREW:' + (e && e.name); } };
  T('screen', function () { return screen.width + 'x' + screen.height; });
  T('avail', function () { return screen.availWidth + 'x' + screen.availHeight; });
  T('dpr', function () { return devicePixelRatio; });
  T('depth', function () { return screen.colorDepth; });
  return o;
})()`;

const KEYS = ['cores', 'memory', 'platform', 'ua', 'lang', 'langs', 'uadPlatform', 'uadMobile',
  'tz', 'locale', 'offJan', 'offJul', 'dateZone', 'conn', 'canvas', 'glVendor', 'glRenderer'];
const DOC_KEYS = ['screen', 'avail', 'dpr', 'depth'];

// ── the page that builds every realm ─────────────────────────────────────────
// Each realm reports through postMessage, including the same-origin ones. Reading a
// same-origin frame's globals directly would work, but then two realms would be collected
// by two different mechanisms and a difference between them could be the mechanism rather
// than the realm. The two shapes that have NO document of their own to carry a script —
// `no src` and `src=about:blank` — are the exception, and they are labelled as such.
const CHILD_HTML = (label) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
try { parent.postMessage({ afpRealm: ${JSON.stringify(label)}, r: ${READ}, d: ${READ_DOC} }, '*'); }
catch (e) { try { parent.postMessage({ afpRealm: ${JSON.stringify(label)}, err: String(e && e.name) }, '*'); } catch (e2) {} }
</` + `script></body></html>`;

const WORKER_BODY = `self.onmessage = function () { try { postMessage({ ok: 1, r: ${READ} }); }
                                                 catch (e) { postMessage({ ok: 0, err: String(e && e.name) }); } };`;

// A worker that builds ANOTHER worker and relays its answer. The nested constructor is a
// separate code path in mw-workers and was unpatched once.
const NESTED_BODY = `self.onmessage = function () {
  try {
    var src = ${JSON.stringify(WORKER_BODY)};
    var u = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    var w = new Worker(u);
    w.onmessage = function (e) { postMessage(e.data); };
    w.onerror = function (e) { postMessage({ ok: 0, err: 'inner:' + (e && e.message ? e.message : '(empty)') }); };
    w.postMessage(1);
  } catch (e) { postMessage({ ok: 0, err: 'outer:' + String(e && e.name) }); }
};`;

const SHARED_BODY = `self.onconnect = function (ev) {
  var p = ev.ports[0];
  p.onmessage = function () { try { p.postMessage({ ok: 1, r: ${READ} }); }
                              catch (e) { p.postMessage({ ok: 0, err: String(e && e.name) }); } };
  p.start();
};`;

const PAGE = (crossOrigin) => `<!doctype html><html><head><meta charset="utf-8"><title>realms</title></head>
<body>
<script>
window.__got = {};
addEventListener('message', function (e) {
  var d = e.data;
  if (d && d.afpRealm) window.__got[d.afpRealm] = d.err ? { err: d.err } : { r: d.r, d: d.d };
});

function frame(label, set) {
  return new Promise(function (res) {
    var f = document.createElement('iframe');
    f.style.display = 'none';
    document.body.appendChild(f);
    try { set(f); } catch (e) { window.__got[label] = { err: 'set:' + e.name }; return res(); }
    // The two shapes with no document of their own are read directly — they are same-origin
    // by construction and there is nothing to run a script in until we put one there.
    if (label === 'iframe no-src' || label === 'iframe about:blank') {
      setTimeout(function () {
        try {
          var w = f.contentWindow;
          window.__got[label] = { r: w.eval(${JSON.stringify(READ)}), d: w.eval(${JSON.stringify(READ_DOC)}) };
        } catch (e) { window.__got[label] = { err: 'read:' + e.name }; }
        res();
      }, 300);
      return;
    }
    setTimeout(res, 1200);
  });
}

function worker(label, make) {
  return new Promise(function (res) {
    var done = false, f = function (v) { if (!done) { done = true; window.__got[label] = v; res(); } };
    try {
      var w = make();
      var port = w.port || w;
      if (w.port) w.port.start();
      port.onmessage = function (e) { f(e.data && e.data.ok ? { r: e.data.r } : { err: (e.data && e.data.err) || 'no-ok' }); };
      (w.onerror !== undefined ? w : port).onerror = function (e) {
        f({ err: 'error:' + (e && e.message ? e.message : '(empty)') });
      };
      port.postMessage(1);
    } catch (e) { f({ err: 'threw:' + (e && e.name) }); }
    setTimeout(function () { f({ err: 'timeout' }); }, 8000);
  });
}

var WB = ${JSON.stringify(WORKER_BODY)};
var NB = ${JSON.stringify(NESTED_BODY)};
var SB = ${JSON.stringify(SHARED_BODY)};
var blobUrl = function (s) { return URL.createObjectURL(new Blob([s], { type: 'text/javascript' })); };

window.__run = (async function () {
  window.__got['window'] = { r: ${READ}, d: ${READ_DOC} };

  await frame('iframe same-origin', function (f) { f.src = '/child?l=' + encodeURIComponent('iframe same-origin'); });
  await frame('iframe cross-origin', function (f) { f.src = ${JSON.stringify(crossOrigin)} + '/child?l=' + encodeURIComponent('iframe cross-origin'); });
  await frame('iframe srcdoc', function (f) { f.srcdoc = ${JSON.stringify('')} + window.__childHtml('iframe srcdoc'); });
  await frame('iframe no-src', function () {});
  await frame('iframe about:blank', function (f) { f.src = 'about:blank'; });
  await frame('iframe blob:', function (f) {
    f.src = URL.createObjectURL(new Blob([window.__childHtml('iframe blob:')], { type: 'text/html' }));
  });
  await frame('iframe data:', function (f) {
    f.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(window.__childHtml('iframe data:'));
  });
  await frame('iframe sandbox', function (f) {
    f.setAttribute('sandbox', 'allow-scripts');
    f.srcdoc = window.__childHtml('iframe sandbox');
  });

  // The negative control. A document that redefines ONE property on itself before it
  // reports, through the same iframe machinery and the same postMessage transport as every
  // other realm — so a matrix that cannot see this cannot see anything.
  await frame('control self-broken', function (f) {
    var BREAK = 'try { Object.defineProperty(navigator, "hardwareConcurrency",' +
      ' { get: function () { return 3; }, configurable: true }); } catch (e) {} ';
    f.srcdoc = window.__childHtml('control self-broken')
      .replace('try { parent.postMessage', BREAK + 'try { parent.postMessage');
  });

  await worker('worker blob', function () { return new Worker(blobUrl(WB)); });
  await worker('worker same-origin', function () { return new Worker('/worker.js'); });
  await worker('worker module', function () { return new Worker(blobUrl(WB), { type: 'module' }); });
  await worker('worker nested', function () { return new Worker(blobUrl(NB)); });
  await worker('shared worker', function () { return new SharedWorker(blobUrl(SB)); });

  return window.__got;
})();
</` + `script></body></html>`;

// ── the fixture server ───────────────────────────────────────────────────────
let portA = 0, portB = 0;
const html = (body) => ({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
const handler = (q, r) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/worker.js') {
    return r.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' }).end(WORKER_BODY);
  }
  if (u.pathname === '/child') {
    const body = CHILD_HTML(u.searchParams.get('l') || 'child');
    return r.writeHead(200, html(body)).end(body);
  }
  // __childHtml is served to the page so srcdoc / blob: / data: all carry the SAME document
  // the served frames do; a difference between them then cannot be the markup.
  const body = PAGE(`http://localhost:${portB}`).replace('<script>',
    // The child document carries a literal </script>, and the HTML parser ends the PAGE's
    // script at the first one it meets — inside a string literal included. JSON does not
    // escape the slash, so it is escaped here: `<\/` is the same string to JS and invisible
    // to the parser. Without this the page died with "Invalid or unexpected token" and every
    // realm came back absent, which reads exactly like a total failure of the extension.
    `<script>window.__childHtml = function (l) { return ${JSON.stringify(CHILD_HTML('__L__')).replace(/<\//g, '<\\/')}.replace(/__L__/g, l); };`);
  r.writeHead(200, html(body)).end(body);
};
const serverA = createServer(handler);
const serverB = createServer(handler);
await new Promise((r) => serverA.listen(0, '127.0.0.1', r));
await new Promise((r) => serverB.listen(0, '127.0.0.1', r));
portA = serverA.address().port;
portB = serverB.address().port;
const BASE = `http://127.0.0.1:${portA}`;

// ── collect one browser ──────────────────────────────────────────────────────
async function collect(withExtension) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-realm-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !headed,
    ...(withExtension
      ? {
        ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
        args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
      }
      : {})
  });
  try {
    if (withExtension) {
      ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 2500));
    }
    const p = await ctx.newPage();
    // A page error is fatal to this file and silent without this: the builder page is one
    // big inline script, and a syntax error in it makes EVERY realm come back absent —
    // which reads exactly like a total failure of the extension. It happened twice while
    // this was being written (a literal </scr' + 'ipt> inside an embedded string, then a
    // quoting slip), so the errors are collected and asserted rather than printed.
    const pageErrors = [];
    p.on('pageerror', (e) => pageErrors.push(e.message));
    await p.goto(BASE + '/', { waitUntil: 'load' });
    const got = await p.evaluate(() => window.__run);
    return { got, pageErrors };
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
  }
}

const REALMS = [
  'window', 'iframe same-origin', 'iframe cross-origin', 'iframe srcdoc', 'iframe no-src',
  'iframe about:blank', 'iframe blob:', 'iframe data:', 'iframe sandbox',
  'worker blob', 'worker same-origin', 'worker module', 'worker nested', 'shared worker'
];
const DOC_REALMS = REALMS.filter((r) => r === 'window' || r.startsWith('iframe'));

// ── the one divergence this matrix finds, declared rather than skipped ───────
//
// [KNOWN third-party-frame-seed-is-its-own-host] A cross-origin iframe draws its canvas
// with a DIFFERENT noise seed from the top document, so the two hashes disagree where a
// clean browser gives one. Measured independently by this matrix and, before it, by
// tools/probe-framekey.mjs: the per-domain seed is keyed on the frame's OWN hostname
// (dyn/boot.js and storage-bridge.js both read location.hostname first), while
// background.js injectProfile keys the same thing on the TOP site.
//
// It is NOT a bug this suite may fix on its own initiative. The consequence runs the other
// way too — an embedded party gets the same noise on every site it sits on, which is the
// cross-site identifier the seed exists to prevent — and the fix is coupled to the
// Trusted-Types policy name, which is derived from the same seed and must stay keyed to the
// document's own host because a response header cannot vary by embedder. The decision taken
// on 2026-09-05 was to carry the finding to the browser project rather than change the
// extension.
//
// So it is pinned, not excused. The rule is a SUBSET rule in both directions:
//   * a divergence outside this table fails — the gap may not grow to another key or
//     another realm without saying so;
//   * a declared gap that has CLOSED is printed, so a fix is noticed instead of being
//     quietly protected by its own exception.
const DECLARED = {
  'iframe cross-origin': ['canvas']
};
const wanted = (r) => !onlyArg || r.toLowerCase().includes(onlyArg.toLowerCase());

try {
  console.log('collecting the clean browser…');
  const cleanRun = await collect(false);
  const clean = cleanRun.got;
  console.log('collecting ours…\n');
  const oursRun = await collect(true);
  const ours = oursRun.got;
  for (const [label, run] of [['clean', cleanRun], ['ours', oursRun]]) {
    ok(run.pageErrors.length === 0,
      `the ${label} builder page threw nothing (${run.pageErrors.join(' | ') || 'none'}) — an` +
      ' error there empties every realm at once and looks like a defect of the extension');
  }

  const cell = (set, realm, key) => {
    const e = set[realm];
    if (!e) return '(absent)';
    if (e.err) return 'ERR ' + e.err;
    const src = DOC_KEYS.includes(key) ? e.d : e.r;
    return src && src[key] !== undefined ? String(src[key]) : '(missing)';
  };
  const alive = (set, realm) => !!(set[realm] && !set[realm].err && set[realm].r);

  // ── 1) the control: every realm READS, in a browser with nothing loaded ─────
  console.log('== 1) the clean browser reaches every realm');
  for (const realm of REALMS.filter(wanted)) {
    const e = clean[realm];
    const why = !e ? 'never reported' : e.err ? e.err : '';
    console.log(`   ${realm.padEnd(20)} ${alive(clean, realm) ? 'read' : 'NO READING — ' + why}`);
    ok(alive(clean, realm),
      `the harness reaches "${realm}" in a clean browser (${why || 'ok'}) — a realm that ` +
      'cannot be read is a free pass, not a skip');
  }

  // ── 2) the control decides what is comparable, per realm ───────────────────
  //
  // The first run of this file asserted "clean agrees with its own window everywhere" and
  // produced eleven reds — every one of them a fact about the PLATFORM, not about us:
  //
  //   connection.rtt/downlink   live estimates, re-rounded per realm (now dropped entirely)
  //   screen / avail            a cross-origin or sandboxed frame reports 800x600
  //   deviceMemory, uadPlatform, uadMobile   absent in a data: frame — opaque origin, so
  //                                          not a secure context, and these are gated on it
  //
  // Writing those down as a hand list of exceptions is the mistake this project keeps
  // finding in its own instruments: a list goes stale and then excuses a real defect. So
  // the CLEAN RUN derives the exclusion instead. A key the clean browser does not keep
  // equal between a realm and its window is not comparable in that realm, whatever the
  // reason, and it is printed rather than assumed.
  //
  // The bound below is what stops the mechanism from swallowing everything: if a future
  // Chrome made half the surface realm-dependent, the exclusion would quietly hollow the
  // matrix out, so the number of excluded keys is itself asserted.
  console.log('== 2) what the CLEAN browser itself does not keep equal (excluded, not assumed)');
  const skip = {};
  for (const realm of REALMS) {
    skip[realm] = new Set();
    if (realm === 'window' || !alive(clean, realm)) continue;
    const keys = DOC_REALMS.includes(realm) ? KEYS.concat(DOC_KEYS) : KEYS;
    for (const k of keys) {
      if (cell(clean, realm, k) !== cell(clean, 'window', k)) skip[realm].add(k);
    }
    if (skip[realm].size) {
      console.log(`   ${realm.padEnd(20)} ${[...skip[realm]].map((k) =>
        `${k} (${cell(clean, realm, k)} vs ${cell(clean, 'window', k)})`).join(', ')}`);
    }
  }
  const worst = Math.max(0, ...REALMS.map((r) => skip[r].size));
  ok(worst <= 5,
    `the clean browser keeps most of the surface realm-independent (worst realm excludes ` +
    `${worst} of ${KEYS.length + DOC_KEYS.length}) — a larger number would mean this matrix ` +
    'is excusing itself rather than measuring');

  // ── 3) something is actually being spoofed ─────────────────────────────────
  console.log('\n== 3) ours differs from clean in the top window');
  const moved = KEYS.filter((k) => cell(ours, 'window', k) !== cell(clean, 'window', k));
  console.log(`   ${moved.length} of ${KEYS.length} signals moved: ${moved.join(', ') || '(none)'}`);
  ok(moved.length >= 8,
    `the extension is actually presenting another machine (${moved.length} signals moved) — ` +
    'without this, "every realm agrees" is satisfied by spoofing nothing');

  // ── 4) THE MATRIX ──────────────────────────────────────────────────────────
  console.log('\n== 4) every realm against the window, with the extension loaded');
  const rows = [];
  for (const realm of REALMS.filter(wanted)) {
    if (realm === 'window') continue;
    if (!alive(ours, realm)) {
      const why = ours[realm] ? ours[realm].err : 'never reported';
      // A realm the clean browser could read and ours cannot is a defect of ours: the page
      // asked for something it is entitled to and did not get it.
      ok(!alive(clean, realm),
        `"${realm}" reads under the extension too (${why}) — it reads in a clean browser`);
      rows.push(`   ${realm.padEnd(20)} NO READING — ${why}`);
      continue;
    }
    const keys = (DOC_REALMS.includes(realm) ? KEYS.concat(DOC_KEYS) : KEYS)
      .filter((k) => !skip[realm].has(k));
    const off = keys.filter((k) => cell(ours, realm, k) !== cell(ours, 'window', k));
    const declared = DECLARED[realm] || [];
    const unexpected = off.filter((k) => declared.indexOf(k) === -1);
    const closed = declared.filter((k) => off.indexOf(k) === -1);
    rows.push(`   ${realm.padEnd(20)} ${off.length ? off.length + ' DIVERGE: ' + off.join(', ')
      : 'agrees on all ' + keys.length}${skip[realm].size ? ' (' + skip[realm].size + ' not comparable)' : ''}` +
      (declared.length ? ` [declared: ${declared.join(', ')}]` : ''));
    ok(unexpected.length === 0,
      `"${realm}" agrees with the window except where declared` +
      (unexpected.length ? ` — ${unexpected.map((k) => `${k}: realm ${cell(ours, realm, k)} vs window ${cell(ours, 'window', k)}`).join(' | ')}` : ''));
    // Good news must not hide behind its own exception.
    closed.forEach((k) => console.log(`   NOTE  the declared gap "${realm}/${k}" has CLOSED — drop it from DECLARED`));
  }
  rows.forEach((r) => console.log(r));

  // ── 5) and the machine each realm claims is the CLAIMED one ────────────────
  // Agreement alone is satisfied by every realm standing down together. On an ordinary
  // origin nothing should stand down, so each realm must also differ from the host.
  console.log('\n== 5) and no realm is quietly answering the host');
  for (const realm of REALMS.filter(wanted)) {
    if (!alive(ours, realm)) continue;
    const keys = KEYS.filter((k) => !skip[realm].has(k));
    const moved2 = keys.filter((k) => cell(ours, realm, k) !== cell(clean, realm, k)).length;
    ok(moved2 >= 8,
      `"${realm}" presents the invented machine rather than the host (${moved2} of ${keys.length} comparable signals differ from clean)`);
  }

  // ── 6) negative control: a realm that really does disagree ─────────────────
  //
  // Everything above is an equality that a broken harness satisfies by reading the same
  // thing thirteen times, or by reading nothing and comparing two absences. So one extra
  // realm is built whose document redefines a single property on itself before it reports —
  // exactly what a page can do to its own frame — and the matrix has to flag it, on that
  // key and no other.
  //
  // It goes through the whole path, not a helper: the same iframe machinery, the same
  // postMessage transport, the same comparison. A synthetic object mutated in Node would
  // have tested the last of those three and let the other two fail silently.
  console.log('\n== 6) negative control: a frame that redefines one property on itself');
  const ctl = ours['control self-broken'];
  if (!ctl || ctl.err || !ctl.r) {
    ok(false, `the control realm reported (${ctl ? ctl.err : 'never reported'}) — without it ` +
      'the thirteen agreements above are not evidence of anything');
  } else {
    const off = KEYS.filter((k) => String(ctl.r[k]) !== cell(ours, 'window', k));
    console.log(`   flagged: ${off.join(', ') || '(nothing — THE MATRIX IS BLIND)'}`);
    ok(off.length === 1 && off[0] === 'cores',
      `the matrix sees the planted disagreement and only it (flagged: ${off.join(', ') || 'nothing'})`);
    ok(String(ctl.r.cores) === '3',
      `and the planted value is the one that arrived (${ctl.r.cores})`);
  }

  console.log('\n== the service worker scope is NOT in this matrix');
  console.log('   MV3 offers no interception there: an allowed service worker reads the real');
  console.log('   cores, timezone, locale and GPU. That is a known limit, declared here rather');
  console.log('   than skipped quietly, and the per-site switch that blocks one is the answer.');
} finally {
  serverA.close();
  serverB.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
