/**
 * CSP restrictions learned per ROUTE, not per host — and the headers must follow.
 *
 *   node test/cspscope.mjs            headless
 *   node test/cspscope.mjs --headed   watch it
 *
 * The add-only host lists made a host that ever refused blob: workers refuse them on every
 * document for the life of the profile: the LOOSE route of a strict host stood down whole
 * (claude.ai's shape — strict on one route, loose on another). A per-document verdict
 * cannot fix that: it arrives after the page's first script (the open-work list 0e, measured). What
 * can is the one synchronous channel there is — content-script REGISTRATION by URL. Match
 * patterns carry paths, so the lists now hold `host/firstSegment` and noblob.js / tte.js
 * are registered for those paths only. The strict route gets its flag before its first
 * script; the loose route gets nothing, and reports the profile; both are decided the same
 * way on every load.
 *
 * The headers are the other half, and the reason this could not be done on the JS side
 * alone. The stand-down `allow` rules (1001/1002) exempted the whole HOST from header
 * spoofing — right when the whole host stood down, and a contradiction the moment one
 * route does not: the loose document would answer de-DE from JS and send en-US on the
 * wire. So the document request is exempted per ROUTE (a urlFilter with the path), and the
 * subresources per TAB (a session rule with tabIds, kept in step with which tabs currently
 * show a stood-down document) — DNR conditions have no path for an initiator, but they do
 * have the tab.
 *
 * One host, two routes. /strict/ refuses blob: workers; /loose/ sends no CSP. The profile
 * is Germany (de-DE), the rig's browser is en-US, so JS and the wire can each be read for
 * which side they took. /echo returns the accept-language of the request that fetched it
 * AND the one the DOCUMENT arrived with.
 *
 *   strict, fresh tab      JS en-US, document header en-US, fetch header en-US
 *   loose, fresh tab       JS de-DE, document header de-DE, fetch header de-DE, blob worker 8
 *   strict again           still stands down: the loose route erased nothing
 *   one tab, alternating   the same answers on every load, ten loads in a row
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, bootSettled } from './harness.mjs';

const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };
const eq = (a, b, m) => ok(a === b, `${m}\n      got      ${JSON.stringify(a)}\n      expected ${JSON.stringify(b)}`);

const docHeaders = new Map();   // path → accept-language the HTML request carried
const server = createServer((q, r) => {
  const u = (q.url || '/').split('?')[0];
  if (u === '/echo') {
    const ref = (() => { try { return new URL(q.headers.referer || '', 'http://x').pathname; } catch (e) { return ''; } })();
    r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ sub: q.headers['accept-language'] || '', doc: docHeaders.get(ref) || '' }));
    return;
  }
  docHeaders.set(u, q.headers['accept-language'] || '');
  if (u.startsWith('/strict/')) r.setHeader('Content-Security-Policy', "script-src 'self' 'unsafe-inline'; connect-src 'self'");
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    .end(`<!doctype html><meta charset="utf-8"><title>${u}</title><body>${u}`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = (p) => `http://127.0.0.1:${port}${p}`;

const READ = `(async function () {
  var out = { lang: navigator.language, hc: navigator.hardwareConcurrency };
  try { out.wb = String(sessionStorage.getItem('v.ui.wb')).split(':')[0]; } catch (e) { out.wb = 'n/a'; }
  try { var j = await (await fetch('/echo', { cache: 'no-store' })).json(); out.sub = j.sub; out.doc = j.doc; } catch (e) { out.sub = 'ERR'; out.doc = 'ERR'; }
  out.worker = await new Promise(function (res) {
    try {
      var w = new Worker(URL.createObjectURL(new Blob(['self.postMessage(navigator.hardwareConcurrency)'], { type: 'text/javascript' })));
      var t = setTimeout(function () { res('silent'); }, 3000);
      w.onmessage = function (ev) { clearTimeout(t); res(ev.data); };
      w.onerror = function (ev) { clearTimeout(t); res('error'); };
    } catch (e) { res('threw:' + e.name); }
  });
  return out;
})()`;

const dir = mkdtempSync(join(tmpdir(), 'afp-scope-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER,
  headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
const res = {};
const seq = [];
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(sw);
  // Germany: de-DE in JS and on the wire, against the rig's en-US.
  await sw.evaluate(() => chrome.storage.local.set({ afp_country_code: 'DE' }));
  await new Promise((r) => setTimeout(r, 2500));

  const visit = async (label, p, page = null) => {
    const own = !page;
    if (own) page = await ctx.newPage();
    await page.goto(url(p), { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 900));
    const got = await page.evaluate(READ);
    if (label) res[label] = got; else seq.push({ p, ...got });
    if (own) await page.close();
    return page;
  };
  // Warm both routes once: the first visit to a route is the documented residual.
  await visit('warmStrict', '/strict/a');
  await visit('warmLoose', '/loose/a');
  await new Promise((r) => setTimeout(r, 1500));
  await visit('strict', '/strict/b');
  await visit('loose', '/loose/b');
  await visit('strictAgain', '/strict/c');
  const tab = await ctx.newPage();
  for (let i = 0; i < 5; i++) {
    await visit(null, `/loose/t${i}`, tab);
    await visit(null, `/strict/t${i}`, tab);
  }
  await tab.close();
} finally {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
  server.close();
}

const show = (k, r) => console.log(`  ${k.padEnd(12)} wb=${JSON.stringify(r.wb)} js=${r.lang}/${r.hc}  doc=${JSON.stringify(r.doc)}  fetch=${JSON.stringify(r.sub)}  blob worker=${JSON.stringify(r.worker)}`);
for (const k of Object.keys(res)) show(k, res[k]);
for (const s of seq) show(s.p, s);
console.log('');

const native = res.strict.lang;
ok(native !== 'de-DE', `the strict document reads the machine's language (${native}), not the profile's`);
const nativeAl = res.strict.doc;
ok(!/^de/.test(nativeAl) && nativeAl !== '', `and arrived with the machine's accept-language (${JSON.stringify(nativeAl)})`);
eq(res.strict.sub, nativeAl, 'strict: its fetch carries the same machine header — JS and wire agree');
eq(res.strict.wb, '1', 'strict: flagged at document_start (noblob.js registered for this route)');

eq(res.loose.lang, 'de-DE', 'loose, same host: JS reports the profile');
eq(res.loose.hc, 8, 'loose: and the profile\'s cores');
ok(/^de-DE/.test(res.loose.doc), `loose: the document request carried the profile\'s accept-language (${JSON.stringify(res.loose.doc)})`);
ok(/^de-DE/.test(res.loose.sub), `loose: and so does its fetch (${JSON.stringify(res.loose.sub)}) — JS and wire agree`);
eq(res.loose.worker, 8, 'loose: a blob worker builds and reads the profile');
ok(res.loose.wb !== '1', `loose: not flagged (v.ui.wb=${JSON.stringify(res.loose.wb)})`);

eq(res.strictAgain.lang, native, 'strict after loose: still stands down — the loose route erased nothing');
eq(res.strictAgain.doc, nativeAl, 'strict after loose: document header still the machine\'s');

for (const s of seq) {
  const strict = s.p.startsWith('/strict/');
  const want = strict ? native : 'de-DE';
  eq(s.lang, want, `one tab, ${s.p}: JS language`);
  ok(strict ? s.doc === nativeAl : /^de-DE/.test(s.doc), `one tab, ${s.p}: document header (${JSON.stringify(s.doc)})`);
  ok(strict ? s.sub === nativeAl : /^de-DE/.test(s.sub), `one tab, ${s.p}: fetch header (${JSON.stringify(s.sub)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
