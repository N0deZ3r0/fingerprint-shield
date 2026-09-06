/**
 * WHAT A WRAPPED FUNCTION LOOKS LIKE, ENUMERATED RATHER THAN LISTED.
 *
 *   node test/fnshape.mjs             headless
 *   node test/fnshape.mjs --headed    watch it
 *   node test/fnshape.mjs --all       print every function, not just the differing ones
 *
 * `name`, `length` and `toString` are three numbers and a string that any page can read off
 * any function in one line, and every wrapper in this extension has to match the platform on
 * all three. dev-vsnative.html already asks that question — from a hand-written `CASES` array
 * of about eighty entries.
 *
 * A HAND LIST IS THE DEFECT THIS FILE EXISTS FOR, and it is not a theoretical objection. The
 * same shape had already cost this project twice: nine methods written out in
 * test/pagework.mjs part 4 left the whole ACCESSOR receiver surface unexamined until
 * test/receivers.mjs enumerated it and found 129 divergences, and [FIX temporal-and-newer-intl-ctors]
 * is a hand-listed API set going stale. Enumerating this axis on the build that introduced
 * this file found two more, neither of them in dev-vsnative.html's list:
 *
 *   window.getComputedStyle         length 1 -> 2   (`pseudo` is optional in the IDL)
 *   FontFaceSet.prototype.forEach   length 1 -> 0   (the stub declared no parameters)
 *
 * The second is the instructive one. Directly above that stub sits [FIX anon-fn-name], which
 * fixed the NAME and stopped; and dev-vsnative.html checks `size`, `check` and `load` on that
 * very interface while never checking `forEach`. A list cannot fail to contain what nobody
 * thought of, which is exactly when it looks correct.
 *
 * THE CLEAN BROWSER IS THE AUTHORITY. Nothing here is written down as an expected value: the
 * same enumeration runs in a clean browser of the same binary and in ours, and only a
 * DIFFERENCE is a failure. That also means an unpatched function costs nothing to include and
 * is already covered the day somebody wraps it.
 *
 * WINDOW AND WORKER, because a wrapper mirrored into the worker payload can drift from its
 * window twin — this repo has [FIX worker-uad-own-props-outlived-the-window-fix] and
 * [FIX connection-was-half-patched-in-workers] on record, and the Date layer split the two
 * scopes the day one half was fixed alone.
 *
 * WHAT IT DOES NOT ASK. Descriptor flags (writable/enumerable/configurable) and own property
 * names of the functions themselves: dev-vsnative.html compares descriptor SHAPE and stays
 * the instrument for that. This file is the arity/name/source axis only, and it is the one
 * that was being checked from a list.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';

const headed = process.argv.includes('--headed');
const showAll = process.argv.includes('--all');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('  FAIL:', m); failed++; } };

/**
 * The interfaces this extension touches, plus the ones next to them. Constructors AND their
 * prototypes: a wrapper can land on either, and `_mnCtor` exists because some land on the
 * constructor itself.
 */
const COLLECT = `(function () {
  var out = {};
  function shape(f) {
    try { return f.name + '|' + f.length + '|' + String(f); } catch (e) { return 'ERR'; }
  }
  function walk(label, obj) {
    if (!obj) return;
    var names;
    try { names = Object.getOwnPropertyNames(obj); } catch (e) { return; }
    names.forEach(function (n) {
      var d;
      try { d = Object.getOwnPropertyDescriptor(obj, n); } catch (e) { return; }
      if (!d) return;
      if (typeof d.value === 'function') out[label + '.' + n] = shape(d.value);
      if (typeof d.get === 'function') out[label + '.' + n + ' [get]'] = shape(d.get);
      if (typeof d.set === 'function') out[label + '.' + n + ' [set]'] = shape(d.set);
    });
  }
  var G = (typeof window !== 'undefined') ? window : self;
  var TARGETS = ['Navigator', 'WorkerNavigator', 'NavigatorUAData', 'NetworkInformation',
    'Screen', 'TextMetrics', 'HTMLCanvasElement', 'CanvasRenderingContext2D', 'OffscreenCanvas',
    'OffscreenCanvasRenderingContext2D', 'WebGLRenderingContext', 'WebGL2RenderingContext',
    'Element', 'HTMLElement', 'Document', 'Performance', 'Date', 'Error', 'Bluetooth',
    'MediaCapabilities', 'BatteryManager', 'Plugin', 'PluginArray', 'MimeType', 'MimeTypeArray',
    'MediaQueryList', 'VisualViewport', 'FontFaceSet', 'AudioContext', 'OfflineAudioContext',
    'AnalyserNode', 'DOMRect', 'DOMRectReadOnly', 'Worker', 'SharedWorker', 'Intl'];
  TARGETS.forEach(function (t) {
    var C; try { C = G[t]; } catch (e) { return; }
    if (!C) return;
    walk(t, C);
    try { if (C.prototype) walk(t + '.prototype', C.prototype); } catch (e) {}
  });
  ['DateTimeFormat', 'NumberFormat', 'Collator', 'RelativeTimeFormat', 'ListFormat',
   'PluralRules', 'Locale', 'Segmenter', 'DurationFormat'].forEach(function (n) {
    try {
      if (Intl[n]) { walk('Intl.' + n, Intl[n]); walk('Intl.' + n + '.prototype', Intl[n].prototype); }
    } catch (e) {}
  });
  // The global's own members this extension is known to touch. Named rather than enumerated
  // for the same reason test/receivers.mjs names the nine geometry accessors: a global has
  // hundreds of own properties and almost none of them are ours.
  ['devicePixelRatio', 'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'screenX',
   'screenY', 'screenLeft', 'screenTop', 'matchMedia', 'requestAnimationFrame',
   'getComputedStyle', 'fetch', 'setTimeout', 'Date', 'Worker', 'SharedWorker',
   'OffscreenCanvas', 'createImageBitmap'].forEach(function (n) {
    try {
      var d = Object.getOwnPropertyDescriptor(G, n);
      if (!d) return;
      if (typeof d.value === 'function') out['global.' + n] = shape(d.value);
      if (typeof d.get === 'function') out['global.' + n + ' [get]'] = shape(d.get);
    } catch (e) {}
  });
  return out;
})()`;

const WORKER_SRC = `self.onmessage = function () { postMessage(${COLLECT}); };\n`;
const PAGE = '<!doctype html><meta charset=utf-8><title>fnshape</title><body>fnshape<script>' +
  'window.__win = ' + COLLECT + ';' +
  'window.__wrk = new Promise(function (res) {' +
  '  try {' +
  '    var w = new Worker("/w.js");' +
  '    var t = setTimeout(function () { res({ __err: "timeout" }); }, 20000);' +
  '    w.onmessage = function (e) { clearTimeout(t); res(e.data); };' +
  '    w.onerror = function (e) { clearTimeout(t); res({ __err: String(e.message || "(empty)") }); };' +
  '    w.postMessage(1);' +
  '  } catch (e) { res({ __err: String(e) }); }' +
  '});<' + '/script>';

const server = createServer((q, r) => {
  if ((q.url || '').indexOf('/w.js') === 0) {
    r.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(WORKER_SRC);
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

async function read(clean) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-fnshape-'));
  let browser = null;
  const ctx = clean
    ? await (browser = await chromium.launch({ ...BROWSER, headless: !headed })).newContext()
    : await chromium.launchPersistentContext(dir, {
      ...BROWSER, headless: !headed,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
  try {
    if (!clean) {
      try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch { /* already up */ }
      await new Promise((r) => setTimeout(r, 2500));
    }
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load' });
    const win = await page.evaluate(() => window.__win);
    const wrk = await page.evaluate(() => window.__wrk);
    await page.close();
    return { win, wrk };
  } finally {
    await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds the profile */ }
  }
}

const CLEAN = await read(true);
const OURS = await read(false);
server.close();

// The extension has to be running, or every comparison below is two clean browsers — the same
// liveness guard test/receivers.mjs opens with, and for the same reason.
const liveness = [];
for (const scope of ['win', 'wrk']) {
  const c = CLEAN[scope] || {}, o = OURS[scope] || {};
  for (const k of Object.keys(c)) if (c[k] !== o[k]) liveness.push(`${scope} ${k}`);
}
ok(!(CLEAN.wrk && CLEAN.wrk.__err), `the clean worker answered (${(CLEAN.wrk || {}).__err || 'ok'})`);
ok(!(OURS.wrk && OURS.wrk.__err), `our worker answered (${(OURS.wrk || {}).__err || 'ok'})`);
ok(Object.keys(CLEAN.win || {}).length > 500,
  `the window collector reached the surfaces (${Object.keys(CLEAN.win || {}).length} functions)`);

let swept = 0;
for (const scope of ['win', 'wrk']) {
  const c = CLEAN[scope] || {}, o = OURS[scope] || {};
  const rows = [];
  for (const k of Object.keys(c)) {
    if (k === '__err') continue;
    swept++;
    if (!(k in o)) { rows.push([k, 'present in clean', 'MISSING with the extension']); continue; }
    if (c[k] === o[k]) { if (showAll) console.log('   ' + scope + ' · ' + k); continue; }
    const cp = String(c[k]).split('|'), op = String(o[k]).split('|');
    const what = [];
    if (cp[0] !== op[0]) what.push(`name "${cp[0]}" -> "${op[0]}"`);
    if (cp[1] !== op[1]) what.push(`length ${cp[1]} -> ${op[1]}`);
    if (cp.slice(2).join('|') !== op.slice(2).join('|')) {
      what.push(`toString "${cp.slice(2).join('|').slice(0, 60)}" -> "${op.slice(2).join('|').slice(0, 60)}"`);
    }
    rows.push([k, '', what.join('; ')]);
  }
  const extra = Object.keys(o).filter((k) => k !== '__err' && !(k in c));
  console.log(`\n=== ${scope === 'win' ? 'window' : 'worker'} — ${Object.keys(c).length} functions, ` +
    `${rows.length} differing from clean`);
  for (const [k, note, what] of rows) console.log('  ' + k.padEnd(52) + (note || what));
  if (extra.length) console.log(`    ours has functions clean does not: ${extra.join(', ')}`);
  for (const [k, note, what] of rows) {
    ok(false, `${scope} · ${k}: ${note || what}`);
  }
  // A function ours has and clean does not is the [FIX we-invented-a-chrome-runtime] shape.
  ok(extra.length === 0, `${scope}: no function exists here that a clean browser does not have` +
    (extra.length ? ` — ${extra.join(', ')}` : ''));
}

console.log(`\n${swept} functions compared against a clean browser of the same binary`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
