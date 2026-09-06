/**
 * THE NAME SURFACE, WINDOW AGAINST WORKER — clean browser against ours.
 *
 *   node tools/probe-scopes.mjs
 *   node tools/probe-scopes.mjs --headed
 *
 * test/wbcoherence.mjs compares the VALUES a window and a worker report. Nothing compares
 * the NAMES, and that is a different question with its own failure mode, paid for once
 * already:
 *
 *   `navigator.cpuPerformance` exists on Navigator and NOT on WorkerNavigator. The rig's
 *   Chromium has it in neither, so test/hostmode.mjs compared "n/a" with "n/a" and the key
 *   passed for two months without being exercised — and would have started failing on its
 *   own the day the rig's browser gained the property, with nothing wrong in the extension.
 *
 * The same shape catches the other direction too, which is the one that matters for a
 * fingerprint: a property this extension DEFINES in one scope and not the other is a
 * contradiction a page reads with one `new Worker()`, and a property it defines that the
 * browser does not have at all is a signature — that is exactly what
 * [FIX we-invented-a-chrome-runtime] was.
 *
 * THE CLEAN BROWSER IS THE AUTHORITY. A split that is already there with nothing loaded is
 * a platform fact and is listed as such; only a split that APPEARS or DISAPPEARS under the
 * extension is ours. Reporting raw splits would bury the four that matter under a hundred
 * that do not.
 *
 * Exit code is the number of splits the extension introduces or removes.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from '../test/harness.mjs';

const headed = process.argv.includes('--headed');

// Everything reachable from `navigator` in BOTH scopes, by name: own properties, the
// prototype's, and the prototype chain up to Object. Values are never read — a getter that
// throws or costs a GPU query is not this tool's business.
const COLLECT = `(function () {
  var out = { own: [], proto: [], sub: {} };
  try { out.own = Object.getOwnPropertyNames(navigator).sort(); } catch (e) {}
  try {
    var p = Object.getPrototypeOf(navigator), names = [];
    while (p && p !== Object.prototype) {
      names = names.concat(Object.getOwnPropertyNames(p));
      p = Object.getPrototypeOf(p);
    }
    out.proto = names.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
  } catch (e) {}
  // The objects hanging off navigator that both scopes have, and whose shape has bitten
  // this project before (connection was half-patched in workers; userAgentData's keys came
  // back unsorted and as own properties).
  ['connection', 'userAgentData', 'storage', 'permissions', 'locks', 'serviceWorker', 'mediaCapabilities', 'gpu'].forEach(function (k) {
    try {
      var v = navigator[k];
      if (!v || typeof v !== 'object') return;
      var own = Object.getOwnPropertyNames(v);
      var pr = [];
      try { pr = Object.getOwnPropertyNames(Object.getPrototypeOf(v)); } catch (e2) {}
      out.sub[k] = { own: own.sort(), proto: pr.sort() };
    } catch (e3) {}
  });
  // The global object's own names, and the two other objects every scope has. A window and
  // a worker differ here by hundreds of names, which is why only the diff OF the diffs is
  // reported: a split that is already there with nothing loaded is the platform's.
  try { out.globals = Object.getOwnPropertyNames(self).sort(); } catch (e) { out.globals = []; }
  ['performance', 'Intl'].forEach(function (k) {
    try {
      var v = self[k];
      if (!v || (typeof v !== 'object' && typeof v !== 'function')) return;
      var own = Object.getOwnPropertyNames(v);
      var pr = [];
      try { pr = Object.getOwnPropertyNames(Object.getPrototypeOf(v)); } catch (e2) {}
      out.sub[k] = { own: own.sort(), proto: pr.sort() };
    } catch (e3) {}
  });
  return out;
})()`;

const PAGE = '<!doctype html><meta charset=utf-8><title>scopes</title><body><script>' +
  'window.__win = ' + COLLECT + ';' +
  // The frame axis. A same-origin child and a srcdoc child are the two shapes several past
  // defects lived in, and both are patched by the same bundle as the parent, so any name
  // that differs between parent and child is ours by construction.
  // READ AFTER LOAD, not at append time. Read immediately, a srcdoc frame is still its
  // initial about:blank document — our bundle has not bootstrapped the realm that replaces
  // it — and the tool reported `__p0`/`__t0` as "window-only" against it, a split that is
  // purely the probe being early. An iframe has two realms in its life and this must measure
  // the second one, the same trap test/framerealm.mjs documents at length.
  'window.__frames = new Promise(function (res) {' +
  '  var out = {}, n = 0;' +
  '  var done = function () { if (++n >= 2) res(out); };' +
  '  function mk(key, srcdoc) {' +
  '    var f = document.createElement("iframe");' +
  '    f.style.display = "none";' +
  '    f.onload = function () {' +
  '      try { out[key] = f.contentWindow.eval(' + JSON.stringify(COLLECT) + '); }' +
  '      catch (e) { out[key] = { error: String(e && e.message) }; }' +
  '      done();' +
  '    };' +
  '    if (srcdoc) f.srcdoc = "<p>x";' +
  '    document.documentElement.appendChild(f);' +
  '  }' +
  '  mk("plain", false); mk("srcdoc", true);' +
  '  setTimeout(function () { res(out); }, 6000);' +
  '});' +
  'window.__worker = new Promise(function (res) {' +
  '  try {' +
  '    var src = "self.onmessage = function () { postMessage(" + ' + JSON.stringify(COLLECT) + ' + "); };";' +
  '    var w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));' +
  '    var t = setTimeout(function () { res({ error: "timeout" }); }, 8000);' +
  '    w.onmessage = function (e) { clearTimeout(t); res(e.data); };' +
  '    w.onerror = function (e) { clearTimeout(t); res({ error: String(e.message || "worker error") }); };' +
  '    w.postMessage(1);' +
  '  } catch (e) { res({ error: String(e && e.message) }); }' +
  '});' +
  '<\/script>';

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

async function read(ctx) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  const win = await page.evaluate(() => window.__win);
  const worker = await page.evaluate(() => window.__worker);
  const frames = await page.evaluate(() => window.__frames);
  await page.close();
  return { win, worker, frames };
}

const cleanBrowser = await chromium.launch({ ...BROWSER, headless: !headed });
const CLEAN = await read(await cleanBrowser.newContext());
await cleanBrowser.close();

const dir = mkdtempSync(join(tmpdir(), 'afp-scopes-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
let OURS;
try {
  ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  OURS = await read(ctx);
} finally {
  await ctx.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  server.close();
}

if (OURS.worker && OURS.worker.error) {
  console.error('the worker did not answer with the extension loaded: ' + OURS.worker.error);
  process.exit(2);
}
if (CLEAN.worker && CLEAN.worker.error) {
  console.error('the worker did not answer in the clean browser: ' + CLEAN.worker.error);
  process.exit(2);
}

/** Names in `a` and not in `b`. */
const only = (a, b) => (a || []).filter((n) => (b || []).indexOf(n) === -1);
const rows = [];
function compare(label, cw, ck, ow, ok_) {
  const cleanSplit = { win: only(cw, ck), wrk: only(ck, cw) };
  const oursSplit = { win: only(ow, ok_), wrk: only(ok_, ow) };
  for (const side of ['win', 'wrk']) {
    for (const n of oursSplit[side]) {
      if (cleanSplit[side].indexOf(n) === -1) rows.push({ label, side, name: n, kind: 'ADDED by us' });
    }
    for (const n of cleanSplit[side]) {
      if (oursSplit[side].indexOf(n) === -1) rows.push({ label, side, name: n, kind: 'REMOVED by us' });
    }
  }
  return { cleanSplit, oursSplit };
}

const NL = String.fromCharCode(10);
/**
 * One axis: the window against some other scope of the same page, in both browsers. Every
 * surface the collector gathered is compared, and `rows` only ever gains what the extension
 * itself introduces or removes.
 */
function axis(name, cleanOther, oursOther) {
  if (!cleanOther || cleanOther.error || !oursOther || oursOther.error) {
    console.log('  ' + name + ': not read (' +
      ((cleanOther && cleanOther.error) || (oursOther && oursOther.error) || 'missing') + ')');
    return null;
  }
  const tag = (l) => name + ' / ' + l;
  const top = compare(tag('navigator own'), CLEAN.win.own, cleanOther.own, OURS.win.own, oursOther.own);
  const proto = compare(tag('navigator proto'), CLEAN.win.proto, cleanOther.proto, OURS.win.proto, oursOther.proto);
  compare(tag('globals'), CLEAN.win.globals, cleanOther.globals, OURS.win.globals, oursOther.globals);
  for (const k of Object.keys(CLEAN.win.sub || {})) {
    const cw = CLEAN.win.sub[k], ck = (cleanOther.sub || {})[k];
    const ow = (OURS.win.sub || {})[k], ok2 = (oursOther.sub || {})[k];
    if (!cw || !ck || !ow || !ok2) continue;
    compare(tag(k + ' own'), cw.own, ck.own, ow.own, ok2.own);
    compare(tag(k + ' proto'), cw.proto, ck.proto, ow.proto, ok2.proto);
  }
  return { top, proto };
}

console.log(NL + 'AXES READ' + NL);
const worker = axis('worker', CLEAN.worker, OURS.worker);
axis('iframe', CLEAN.frames && CLEAN.frames.plain, OURS.frames && OURS.frames.plain);
axis('srcdoc', CLEAN.frames && CLEAN.frames.srcdoc, OURS.frames && OURS.frames.srcdoc);
console.log('  window vs worker, window vs same-origin iframe, window vs srcdoc frame');

console.log(NL + 'PLATFORM SPLITS, window against worker (present with nothing loaded)' + NL);
const show = (t, a) => { if (a && a.length) console.log('  ' + t.padEnd(22) + a.join(', ')); };
if (worker) {
  show('window only, own', worker.top.cleanSplit.win);
  show('worker only, own', worker.top.cleanSplit.wrk);
  show('window only, proto', worker.proto.cleanSplit.win);
  show('worker only, proto', worker.proto.cleanSplit.wrk);
}

console.log(NL + 'SPLITS THIS EXTENSION INTRODUCES OR REMOVES' + NL);
if (!rows.length) console.log('  (none — every name difference between scopes is the browser\'s own)');
for (const r of rows) {
  console.log(`  ${r.kind.padEnd(14)} ${r.label.padEnd(34)} ${r.side === 'win' ? 'window-only' : 'other-scope-only'}  ${r.name}`);
}
console.log(NL + `${rows.length} split(s) attributable to the extension.` + NL);
process.exit(rows.length);
