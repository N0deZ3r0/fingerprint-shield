/**
 * A Trusted Types refusal at a worker sink, on an origin where the wrapper keeps its proxy,
 * measured against a clean browser of the same binary.
 *
 *   node test/ttrefusal.mjs            headless
 *   node test/ttrefusal.mjs --headed   watch it
 *
 * Reported 2026-09-03 from the user's Chrome — two youtube.com watch pages in one evening,
 * per-site CSP rewrite ON, filed under this extension's OWN errors on chrome://extensions:
 *
 *   This document requires 'TrustedScriptURL' assignment. The action has been blocked.
 *   mw-bundle.js:12037 (_wrapWorkerUrl)
 *
 * Everything about that refusal is the page's: a worker built from a bare string, a document
 * that requires a TrustedScriptURL, no default policy to convert it. But the string reached
 * the native constructor THROUGH our proxy, and the browser charges a refusal to the
 * innermost script frame on the stack — ours. test/cspattribution.mjs closed this once by
 * handing the constructors back wherever nothing can be wrapped; the CSP rewrite keeps them
 * installed on youtube.com on purpose, and the residual returned with them.
 *
 * A frame cannot take itself off a stack it is on, so the only way not to be named is not to
 * make the call. Where the document's OWN response headers said "enforcing" — a per-document
 * verdict from background.js, `v.ui.tte` = '2' — the wrapper now answers the way the browser
 * would: the same TypeError, the same message, the same stack minus our frames, the default
 * policy consulted exactly once with the same arguments, and the sink never touched. What a
 * page can no longer observe is the `securitypolicyviolation` record and the console line,
 * both of which said "an extension did this"; that is the documented trade, and this file
 * prints the record counts side by side instead of pretending they match.
 *
 * Four shapes of the same document, each with a different native message (measured on a
 * clean browser first, 2026-09-03):
 *   no default policy           "...'TrustedScriptURL' assignment."
 *   default without the member  "...and no 'default' policy for 'TrustedScriptURL' has been defined."
 *   default returning null      "...and the 'default' policy failed to execute."
 *   default that throws         the policy's own exception, no violation record, no console line
 * and two controls, for the two ways to get this wrong:
 *   /allowed  a default policy that ACCEPTS the string — the worker must be built AND patched;
 *             nothing may be refused that the browser accepts.
 *   /off      the same host with no Trusted Types at all, visited LAST: the host is on the
 *             add-only enforced list by then and tte.js writes '1' for it, and a bare-string
 *             worker must still build and come back patched, because this document's
 *             verdict ('0') outranks the host's history. A stale host entry refusing what
 *             the browser accepts would be a page breakage, not a residual.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';

const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };
const eq = (a, b, m) => ok(a === b, `${m}\n      got      ${JSON.stringify(a)}\n      expected ${JSON.stringify(b)}`);

const TT = "script-src 'self' blob: 'unsafe-inline'; require-trusted-types-for 'script'";
const DEFAULTS = {
  none: '',
  nomember: `<script>trustedTypes.createPolicy('default', { createHTML: function (s) { return s; } });</script>`,
  returnsnull: `<script>trustedTypes.createPolicy('default', { createScriptURL: function (s, t, sink) { (window.__seen = window.__seen || []).push([String(s), t, sink]); return null; } });</script>`,
  throws: `<script>trustedTypes.createPolicy('default', { createScriptURL: function (s) { throw new RangeError('policy says no: ' + s); } });</script>`,
  allowed: `<script>trustedTypes.createPolicy('default', { createScriptURL: function (s, t, sink) { (window.__seen = window.__seen || []).push([String(s), t, sink]); return s; } });</script>`,
  off: ''
};
const WORKER = 'self.postMessage({ hc: navigator.hardwareConcurrency });';

const server = createServer((q, r) => {
  const u = (q.url || '/').split('?')[0];
  if (u === '/w.js') { r.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(WORKER); return; }
  if (u === '/sw.js') { r.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end('// sw'); return; }
  const key = u.slice(1) in DEFAULTS ? u.slice(1) : 'none';
  if (key !== 'off') r.setHeader('Content-Security-Policy', TT);
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    .end(`<!doctype html><meta charset="utf-8"><title>${key}</title><body>${key}${DEFAULTS[key]}`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = (key) => `http://127.0.0.1:${port}/${key}`;

// The same script in both browsers, so every frame below the sink is byte-identical and a
// stack comparison is exact: a frame of ours left in, or an extra one, is a difference.
const PROBE = `(async function () {
  var out = { viol: [] };
  document.addEventListener('securitypolicyviolation', function (e) {
    out.viol.push({ dir: e.effectiveDirective, sample: String(e.sample || ''), src: String(e.sourceFile || ''), line: e.lineNumber });
  });
  var shape = function (e) { return { ok: false, name: e && e.name, message: String(e && e.message), stack: String(e && e.stack) }; };
  var trySync = function (k, f) { try { var r = f(); out[k] = { ok: true }; return r; } catch (e) { out[k] = shape(e); return null; } };
  var alive = function (k, w) {
    if (!w) return Promise.resolve();
    return new Promise(function (res) {
      var t = setTimeout(function () { out[k].worker = 'silent'; res(); }, 4000);
      w.onmessage = function (ev) { clearTimeout(t); out[k].worker = ev.data.hc; res(); };
      w.onerror = function (ev) { clearTimeout(t); out[k].worker = 'error:' + String(ev && ev.message); res(); };
    });
  };
  var w = trySync('worker', function () { return new Worker('/w.js'); });
  await alive('worker', w);
  var s = trySync('shared', function () { return new SharedWorker('/w.js'); });
  if (s) out.shared.worker = 'built';
  if (REGISTER) {
    var p = null;
    try { p = navigator.serviceWorker.register('/sw.js'); out.register = { ok: true, sync: true }; }
    catch (e) { out.register = shape(e); out.register.sync = true; }
    if (p) {
      try { await p; out.register = { ok: true, sync: false }; }
      catch (e) { out.register = shape(e); out.register.sync = false; }
    }
  }
  out.hc = navigator.hardwareConcurrency;
  out.seen = window.__seen || null;
  // A settled value carries the document's timeOrigin after a colon; the code is what matters.
  try { out.flag = String(sessionStorage.getItem('v.ui.tte')).split(':')[0]; } catch (e) { out.flag = 'n/a'; }
  await new Promise(function (r) { setTimeout(r, 400); });
  return out;
})()`;

async function launch(withExt) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-ttref-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !headed,
    args: withExt ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  if (withExt) {
    try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch (e) {}
    await new Promise((r) => setTimeout(r, 1500));   // onInstalled → initDefaults
  }
  return { ctx, dir };
}

async function measure(ctx, key) {
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto(url(key), { waitUntil: 'load' });
  // Steady state: the verdict and the storage read have both landed. The window before
  // them is the documented first-script residual and is not what this file measures.
  await new Promise((r) => setTimeout(r, 600));
  const out = await page.evaluate(PROBE.replace('REGISTER', key === 'allowed' || key === 'off' ? 'false' : 'true'));
  await new Promise((r) => setTimeout(r, 300));
  out.console = logs.slice();
  await page.close();
  return out;
}

const ROUTES = ['none', 'nomember', 'returnsnull', 'throws', 'allowed', 'off'];
const res = { clean: {}, ours: {} };
for (const withExt of [false, true]) {
  const { ctx, dir } = await launch(withExt);
  try {
    // One enforcing document first: the host lands on the enforced list and tte.js is
    // registered for it — a repeat visitor's state, and the state the /off control needs.
    const warm = await ctx.newPage();
    await warm.goto(url('none'), { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1500));
    await warm.close();
    for (const key of ROUTES) res[withExt ? 'ours' : 'clean'][key] = await measure(ctx, key);
  } finally {
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
server.close();

const ttLines = (r) => r.console.filter((m) => /TrustedScriptURL/.test(m)).length;
const short = (s) => String(s).replace(/\s+/g, ' ').slice(0, 120);
for (const key of ROUTES) {
  console.log(`\n=== /${key} ===`);
  for (const who of ['clean', 'ours']) {
    const r = res[who][key];
    console.log(`  ${who.padEnd(5)} hc=${r.hc} v.ui.tte=${JSON.stringify(r.flag)} violations=${r.viol.length} console(TT)=${ttLines(r)}` +
      (r.viol.length ? `  sourceFile=${JSON.stringify([...new Set(r.viol.map((v) => v.src))])}` : ''));
    for (const k of ['worker', 'shared', 'register']) {
      if (!r[k]) continue;
      console.log(`        ${k.padEnd(8)} ${r[k].ok ? 'ok' + (r[k].worker !== undefined ? ' worker=' + r[k].worker : '') : short(r[k].name + ': ' + r[k].message) + (k === 'register' ? (r[k].sync ? ' [thrown]' : ' [rejected]') : '')}`);
    }
  }
}
console.log('');

// The rig is real: 8 is the profile's core count, the host's is whatever it is.
ok(res.ours.off.hc === 8 && res.clean.off.hc !== 8, `the extension is loaded (ours=${res.ours.off.hc}, clean=${res.clean.off.hc})`);

for (const key of ['none', 'nomember', 'returnsnull', 'throws']) {
  const o = res.ours[key], c = res.clean[key];
  eq(o.flag, '2', `/${key}: this document's own headers were judged (v.ui.tte)`);
  for (const k of ['worker', 'shared', 'register']) {
    eq(o[k].ok, c[k].ok, `/${key} ${k}: refused in both`);
    eq(o[k].name, c[k].name, `/${key} ${k}: same error class`);
    eq(o[k].message, c[k].message, `/${key} ${k}: same message`);
    eq(o[k].stack, c[k].stack, `/${key} ${k}: same stack — the page's frames only`);
    if (k === 'register') eq(o[k].sync, c[k].sync, `/${key} register: refused the same way (thrown vs rejected)`);
  }
  eq(JSON.stringify(o.seen), JSON.stringify(c.seen), `/${key}: the default policy saw the same calls with the same arguments`);
  ok(!o.viol.some((v) => /chrome-extension/.test(v.src)), `/${key}: no violation record names an extension (${JSON.stringify(o.viol.map((v) => v.src))})`);
  eq(ttLines(o), 0, `/${key}: nothing in the page console about TrustedScriptURL — the browser's line names our file`);
  // The trade, stated: with the sink never called there is no violation record either.
  eq(o.viol.length, 0, `/${key}: no violation record at all — the refusal was answered without the sink (clean has ${c.viol.length})`);
}
{
  const o = res.ours.allowed, c = res.clean.allowed;
  eq(c.worker.ok, true, '/allowed (clean): a string the default policy converts is accepted');
  eq(o.worker.ok, true, '/allowed: accepted by us too — nothing is refused that the browser accepts');
  eq(o.worker.worker, 8, `/allowed: and the worker is PATCHED (worker=${o.worker.worker}, window=${o.hc})`);
  ok(typeof c.worker.worker === 'number' && c.worker.worker !== 8, `/allowed (clean): the worker reads the machine (${c.worker.worker})`);
  // Ours used to ask the default policy once more, for the blob it builds — the page's
  // policy saw a blob: URL it never asked for, with no sink arguments. [FIX
  // policy-name-was-a-signature] mints under a policy of our own where the document lets
  // it, so the site's default policy now sees exactly the calls the browser would make.
  const browserShaped = (seen) => (seen || []).filter((e) => e[1] === 'TrustedScriptURL');
  eq(JSON.stringify(browserShaped(o.seen)), JSON.stringify(c.seen), '/allowed: the default policy was consulted once per sink with the same arguments, in the same order');
  eq((o.seen || []).length - browserShaped(o.seen).length, 0, '/allowed: and never for our blob — the default policy sees only what the browser would show it');
  eq(o.viol.length, 0, '/allowed: nothing refused');
}
{
  const o = res.ours.off;
  eq(o.flag, '0', "/off: this document's verdict outranks the host's history (v.ui.tte)");
  eq(o.worker.ok, true, '/off: a bare-string worker on the enforced-list host still builds when THIS document does not enforce');
  eq(o.worker.worker, 8, `/off: and it is patched, not passed through (worker=${o.worker.worker})`);
  eq(o.viol.length, 0, '/off: no refusal');
  eq(ttLines(o), 0, '/off: no Trusted Types line in the console');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
