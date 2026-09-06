/**
 * THE PER-SITE CSP REWRITE — youtube.com's shape, on a local origin.
 *
 *   node test/csprewrite.mjs             headless
 *   node test/csprewrite.mjs --headed    watch it
 *
 * youtube.com sends three Content-Security-Policy headers (curl'd 2026-09-03, quoted in
 * test/background-fns.mjs): a static script-src allowlist with neither blob: nor a
 * worker-src, `require-trusted-types-for 'script'`, and a nonce policy with
 * 'strict-dynamic'. The first refuses every worker this extension builds, so the wrapper
 * hands back the native constructors and the window stands down to agree with the page's
 * own workers — README "Limits", item 6, and what the user's audit of a YouTube tab showed: 18
 * cores, ru-RU, Europe/Moscow, the real GPU.
 *
 * The switch rewrites that header through declarativeNetRequest. This suite serves the
 * same three headers from a local origin, with the same kind of trusted-types setup a page
 * like YouTube has — a `default` policy that cannot mint script URLs, and a named policy
 * it builds its own workers with — and checks four things in order:
 *
 *   1. default: the origin stands down whole (window == worker == the host);
 *   2. switch on, fresh tab: window == worker == iframe == the PROFILE;
 *   3. the site still works and is still protected where the rewrite promised: its
 *      nonce-authorised inline script ran, a script from a foreign origin is still refused
 *      by the allowlist, and a worker built from a bare string still throws under trusted
 *      types (the TT header was kept);
 *   4. switch off: the site is learned as restricted again and stands down again.
 *
 * Fresh tabs throughout, for the reason test/wbcoherence.mjs gives: the flags live in
 * sessionStorage, and a reused tab would carry the previous visit's answer.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harness, root, BROWSER, uiMessages, langArgs } from './harness.mjs';

const headed = process.argv.includes('--headed');
const { assert, eq, section, note, done } = harness();

const READ = `(function () {
  var o = {};
  var t = function (k, f) { try { o[k] = f(); } catch (e) { o[k] = 'THREW ' + e.name; } };
  t('cores', function () { return navigator.hardwareConcurrency; });
  t('memory', function () { return navigator.deviceMemory; });
  t('lang', function () { return navigator.language; });
  t('tz', function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; });
  t('gl', function () {
    var g = new OffscreenCanvas(32, 32).getContext('webgl');
    if (!g) return 'no-webgl';
    var dbg = g.getExtension('WEBGL_debug_renderer_info');
    return dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?';
  });
  return o;
})()`;
const WORKER_JS = `self.onmessage = function () { postMessage(${READ}); };\n`;
const FRAME_HTML = `<!doctype html><meta charset="utf-8"><title>f</title><script>window.__r = ${READ};<` + `/script>`;

// The page: a default policy WITHOUT createScriptURL (YouTube's shape), a named policy it
// builds its worker with, a nonce'd inline script, a foreign-origin script, and a
// bare-string worker attempt. Everything is inline and nonce'd, as the site's own code is.
const pageFor = (nonce, crossOrigin) => `<!doctype html><html><head><meta charset="utf-8"><title>csp</title>
<script nonce="${nonce}">
window.__inline = 1;
try { trustedTypes.createPolicy('default', { createHTML: function (s) { return s; } }); } catch (e) {}
var pol = null;
try { pol = trustedTypes.createPolicy('page', { createScriptURL: function (s) { return s; } }); } catch (e) {}
window.__plain = (function () { try { new Worker('/worker.js'); return 'accepted'; } catch (e) { return e.name; } })();
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
    var w = new Worker(pol ? pol.createScriptURL('/worker.js') : '/worker.js');
    w.onmessage = function (e) { f(e.data); };
    w.onerror = function (e) { f('error:' + (e && e.message ? e.message : '(empty)')); };
    w.postMessage(1);
  } catch (e) { f('threw:' + (e && e.name)); }
  setTimeout(function () { f('timeout'); }, 6000);
});
</script>
<script src="${crossOrigin}/cross.js"></script>
</head><body>csp</body></html>`;

// youtube.com's three headers, with the fixture's own hosts in the allowlist.
const cspFor = (nonce, self) => [
  `script-src 'unsafe-eval' 'self' 'unsafe-inline' https://www.google.com https://*.youtube.com ${self};report-uri /csp-allowlist`,
  `require-trusted-types-for 'script'`,
  `base-uri 'self';object-src 'none';script-src 'report-sample' 'nonce-${nonce}' 'unsafe-inline' 'strict-dynamic' https: http: 'unsafe-eval';report-uri /csp-strict`
];

let port = 0;
const server = createServer((q, r) => {
  const u = (q.url || '/').split('?')[0];
  if (u === '/worker.js') return r.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' }).end(WORKER_JS);
  if (u === '/cross.js') return r.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' }).end('window.__cross = 1;');
  if (u.startsWith('/csp-')) return r.writeHead(204).end();
  const nonce = randomBytes(12).toString('base64');
  const self = `http://127.0.0.1:${port}`;
  const h = { 'content-type': 'text/html', 'cache-control': 'no-store' };
  // Three separate headers, exactly as the real site sends them.
  r.setHeader('Content-Security-Policy', cspFor(nonce, self));
  if (u === '/frame.html') return r.writeHead(200, h).end(FRAME_HTML);
  r.writeHead(200, h).end(pageFor(nonce, `http://localhost:${port}`));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

const dir = mkdtempSync(path.join(tmpdir(), 'afp-csprw-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER,
  headless: !headed,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, ...langArgs()]
});

const KEYS = ['cores', 'memory', 'lang', 'tz', 'gl'];
async function visit(n) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?v=${n}`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 400));
  const out = await p.evaluate(async () => ({
    worker: await window.__w, frame: await window.__f,
    inline: window.__inline, cross: window.__cross, plain: window.__plain
  }));
  out.win = await p.evaluate(READ);
  await p.close();
  return out;
}

try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  const id = new URL(sw.url()).host;
  const hostCores = await sw.evaluate(() => navigator.hardwareConcurrency);

  section('1) by default the origin stands down whole');
  // Visit 1 learns the header and loses its worker (README "Limits", item 13); visit 2 is the
  // steady state. The control: the window must have stood down TO the worker's answer.
  await visit(1);
  await new Promise((r) => setTimeout(r, 1500));
  const before = await visit(2);
  assert(before.worker && typeof before.worker === 'object', `the page's own worker runs (${typeof before.worker === 'object' ? 'ok' : before.worker})`);
  if (before.worker && typeof before.worker === 'object') {
    eq(String(before.worker.cores), String(hostCores), `the unpatchable worker reads the machine (${before.worker.cores} cores)`);
    for (const k of KEYS) eq(String(before.win[k]), String(before.worker[k]), `and the window agrees with it on ${k}`);
  }
  eq(before.inline, 1, 'the nonce-authorised inline script ran (fixture sanity)');
  eq(before.plain, 'TypeError', `a bare-string worker is refused by trusted types (${before.plain})`);
  eq(before.cross, undefined, 'a script from a foreign origin is refused by the allowlist');
  const lists0 = await sw.evaluate(() => chrome.storage.local.get(['afp_csp_noblob', 'afp_csp_tte']));
  // Entries are host/segment since [FIX csp-restrictions-learned-per-route].
  const ofHost = (l) => (l || []).some((e) => e.split('/')[0] === '127.0.0.1');
  assert(ofHost(lists0.afp_csp_noblob), `the host was learned as refusing blob: workers (${JSON.stringify(lists0.afp_csp_noblob)})`);

  section('2) the switch, through the popup, with the site as the active tab');
  const site = await ctx.newPage();
  await site.goto(`${BASE}/?popup=1`, { waitUntil: 'load' });
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load' });
  await site.bringToFront();
  await popup.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1200));
  const st0 = await popup.evaluate(() => ({
    on: document.getElementById('cspToggle').classList.contains('on'),
    needed: !document.getElementById('cspLabel').classList.contains('off'),
    warn: document.getElementById('cspLabel').classList.contains('warn')
  }));
  eq(st0.on, false, 'the switch starts OFF');
  eq(st0.needed, true, 'and is not dimmed: this site needs it');
  eq(st0.warn, false, 'and is not amber while off');
  await popup.evaluate(async () => { await window.handleCspToggle(); });
  // The status bar clears itself after 2.5 s; read it early, then let the rules settle.
  await new Promise((r) => setTimeout(r, 800));
  const st1 = await popup.evaluate(() => ({
    on: document.getElementById('cspToggle').classList.contains('on'),
    warn: document.getElementById('cspLabel').classList.contains('warn'),
    status: document.getElementById('statusBar').textContent
  }));
  await new Promise((r) => setTimeout(r, 1700));
  eq(st1.on, true, 'the switch is ON');
  eq(st1.warn, true, 'and amber, because the site is off its default');
  assert(st1.status.includes(
    uiMessages(await popup.evaluate(() => chrome.i18n.getUILanguage()))('popupCspRewritten')),
    `the status says the header was learned and rewritten (${st1.status})`);
  const stored = await sw.evaluate(async () => {
    const st = await chrome.storage.local.get(['afp_csp_rewrite', 'afp_csp_noblob', 'afp_csp_tte', 'afp_csp_tt']);
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return { st, csp: rules.filter((r) => r.id >= 1200 && r.id < 1300).map((r) => ({ id: r.id, hosts: r.condition.requestDomains, value: r.action.responseHeaders[0].value })) };
  });
  const rw = stored.st.afp_csp_rewrite && stored.st.afp_csp_rewrite['127.0.0.1'];
  assert(typeof rw === 'string' && rw.length > 0, 'the rewritten header value is stored for the host');
  note(`rewritten: ${String(rw).slice(0, 160)}…`);
  assert(/worker-src [^,;]*blob:/.test(rw), 'it carries a worker-src that admits blob:');
  assert(!/'nonce-/.test(rw), 'and no nonce');
  assert(/require-trusted-types-for 'script'/.test(rw), 'and the trusted-types header is kept');
  eq(stored.csp.length, 1, 'one dynamic rule was built');
  eq(stored.csp[0] && stored.csp[0].hosts.join(), '127.0.0.1', 'scoped to the host');
  assert(!ofHost(stored.st.afp_csp_noblob), 'the host was forgotten by the blob-refusing list');
  await popup.close();
  await site.close();

  section('3) fresh tab: the profile, in every scope — and the site still works');
  await new Promise((r) => setTimeout(r, 1000));
  const after = await visit(3);
  assert(after.worker && typeof after.worker === 'object', `the worker runs under the rewritten header (${typeof after.worker === 'object' ? 'ok' : after.worker})`);
  eq(String(after.win.cores), '8', `the window reports the profile (${after.win.cores} cores)`);
  if (after.worker && typeof after.worker === 'object') {
    for (const k of KEYS) eq(String(after.worker[k]), String(after.win[k]), `worker ${k} equals the window`);
    assert(String(after.worker.cores) !== String(hostCores), `and it is not the machine's (${after.worker.cores} vs ${hostCores})`);
  }
  if (after.frame && typeof after.frame === 'object') {
    for (const k of KEYS) eq(String(after.frame[k]), String(after.win[k]), `iframe ${k} equals the window`);
  } else assert(false, `the iframe answered (${after.frame})`);
  eq(after.inline, 1, "the site's nonce-authorised inline script still runs");
  eq(after.cross, undefined, 'a script from a foreign origin is STILL refused — the allowlist policy survived');
  eq(after.plain, 'TypeError', `a bare-string worker is STILL refused — trusted types survived (${after.plain})`);

  section('3b) a freshly woken worker must not un-learn the switch');
  // [FIX the-csp-observer-judged-from-a-cache-that-had-not-loaded] afpNoteCsp reads the
  // rewrite map synchronously, and on the event that WAKES the service worker the map is
  // still null — startup only reaches loadCspRewrite after several awaited round trips.
  // The observer then judged the host from the SITE's header (webRequest sees the original,
  // measured: nonce present, no worker-src), re-added it to the blob-refusing list, and the
  // next updateNoBlobScript registered noblob.js for it: every later tab stood down while
  // the popup showed the switch ON. Measured before the fix on this fixture: the cold visit
  // read 18 cores in the window beside 8 in its worker, then 18/18 on every tab after.
  // Playwright keeps the worker alive (devtools attached), so the cold state is produced
  // directly rather than by waiting for an idle termination.
  await sw.evaluate(() => { _cspRewrite = null; });
  const cold = await visit(30);
  await new Promise((r) => setTimeout(r, 1500));
  const relearned = await sw.evaluate(async () => {
    const st = await chrome.storage.local.get(['afp_csp_noblob', 'afp_csp_tt', 'afp_csp_tte']);
    const regs = await chrome.scripting.getRegisteredContentScripts({ ids: ['afp-noblob'] });
    return { noblob: st.afp_csp_noblob || [], tt: st.afp_csp_tt || [], tte: st.afp_csp_tte || [], matches: regs.length ? regs[0].matches : [] };
  });
  assert(!ofHost(relearned.noblob), `the host is NOT back on the blob-refusing list (${JSON.stringify(relearned.noblob)})`);
  assert(!ofHost(relearned.tt), `nor on the trusted-types allowlist one (${JSON.stringify(relearned.tt)})`);
  assert(ofHost(relearned.tte), 'while trusted-types ENFORCEMENT is still learned — it survives the rewrite');
  assert(!relearned.matches.some((m) => m.includes('127.0.0.1')), `and noblob.js is not registered for it (${JSON.stringify(relearned.matches)})`);
  eq(String(cold.win.cores), '8', `the visit that woke the cache still reports the profile in the window (${cold.win.cores})`);
  const warmAgain = await visit(31);
  eq(String(warmAgain.win.cores), '8', `and so does the next fresh tab (${warmAgain.win.cores})`);
  if (warmAgain.worker && typeof warmAgain.worker === 'object') {
    eq(String(warmAgain.worker.cores), String(warmAgain.win.cores), 'with its worker agreeing');
  } else assert(false, `the worker answered after the cold visit (${warmAgain.worker})`);

  section('4) the switch off: learned as restricted again, stands down again');
  const site2 = await ctx.newPage();
  await site2.goto(`${BASE}/?popup=2`, { waitUntil: 'load' });
  const popup2 = await ctx.newPage();
  await popup2.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load' });
  await site2.bringToFront();
  await popup2.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1200));
  await popup2.evaluate(async () => { await window.handleCspToggle(); });
  await new Promise((r) => setTimeout(r, 2500));
  const off = await sw.evaluate(async () => {
    const st = await chrome.storage.local.get(['afp_csp_rewrite']);
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return { keys: Object.keys(st.afp_csp_rewrite || {}), csp: rules.filter((r) => r.id >= 1200 && r.id < 1300).length };
  });
  eq(off.keys.length, 0, 'the host is off the list');
  eq(off.csp, 0, 'and its rule is gone');
  await popup2.close();
  await site2.close();
  await visit(4);
  await new Promise((r) => setTimeout(r, 1500));
  const again = await visit(5);
  if (again.worker && typeof again.worker === 'object') {
    eq(String(again.worker.cores), String(hostCores), `the worker reads the machine again (${again.worker.cores})`);
    for (const k of KEYS) eq(String(again.win[k]), String(again.worker[k]), `and the window stands down with it on ${k}`);
  } else assert(false, `the worker answered after the switch went off (${again.worker})`);
} finally {
  await ctx.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  server.close();
}

done();
