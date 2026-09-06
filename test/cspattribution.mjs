/**
 * When the browser refuses one of the page's OWN calls, does it name this extension?
 * Measured against the REAL extension, with a clean browser beside it.
 *
 *   node test/cspattribution.mjs             headless
 *   node test/cspattribution.mjs --headed    watch it
 *
 * test/stackleak.mjs already asks whether chrome-extension://<id>/... reaches a page
 * through `Error.prototype.stack`. This asks the same question about a second channel
 * that had no coverage at all, and which no amount of toString/stack masking can reach:
 * the browser's own CSP violation record. It is built from the real V8 stack, in C++,
 * after our JS has returned — a page reads it from a `securitypolicyviolation` listener,
 * and the site's `report-uri` receives a copy.
 *
 * The report that produced this suite:
 *
 *   This document requires 'TrustedScriptURL' assignment. The action has been blocked.
 *   https://www.youtube.com/watch?v=…
 *   mw/mw-workers.js:2193 (_wrapWorkerUrl)
 *
 * The page below carries youtube.com's real enforcement shape, read off the live response
 * headers on 2026-08-16:
 *   - `require-trusted-types-for 'script'`  — enforcing, not report-only;
 *   - NO `trusted-types` directive          — so any policy NAME may be created;
 *   - no blob: in script-src and no worker-src/child-src, which workers fall back to, so
 *     blob: workers are refused — this is what makes _wrapWorkerUrl a pure passthrough;
 *   - and, measured on the live watch page with the console: trustedTypes.defaultPolicy
 *     is null even fully loaded, so a plain string can never reach a script-URL sink.
 *
 * That last point is why this suite compares against a control instead of asserting a
 * fixed expectation. The block is the PAGE's, not ours, and it must stay: `new Worker(str)`
 * has to keep failing exactly where and how it fails in a clean browser. The defect was
 * never the failure — it was that our frame was on top of the stack when it happened, so
 * the browser named mw/mw-workers.js instead of the page. Asserting "no violation" would
 * be asserting the wrong fix; asserting "byte-identical to clean Chrome" is the real
 * contract, and it catches suppressing the violation just as surely as re-attributing it.
 *
 * The same run also pins the other half: a real TrustedScriptURL must still build a
 * working worker, in both browsers, because that is the path a TT-enforcing site actually
 * uses and breaking it would break the site.
 *
 * PART 2 is the opposite case, and it is here rather than in its own file because it is the
 * same question asked of the other answer: on an origin whose CSP does NOT refuse blob:
 * workers, the worker must actually get patched — window and worker must report the same
 * machine. It guards [FIX csp-header-read-as-one-policy] in background.js, where
 * 'strict-dynamic' was read as blocking and cost the worker patch on every site that uses
 * it. `test/background-fns.mjs` pins the parser's table; this pins that the browser agrees.
 *
 * The two parts run on DIFFERENT HOSTNAMES on purpose. `v.ui.wb` is per-origin
 * sessionStorage, but background.js records the CSP verdict per HOSTNAME — so two ports on
 * 127.0.0.1 share one entry, and the blob-refusing half would poison the other. Measured:
 * running them on one host reports the permissive origin as refusing blob: workers and its
 * worker leaking the host's machine, which is a rig artefact and looks exactly like a bug.
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

// youtube.com's shape, trimmed to the directives that decide the outcome.
const CSP = "script-src 'unsafe-eval' 'self' 'unsafe-inline';" +
            "require-trusted-types-for 'script';base-uri 'self';object-src 'none'";

const PAGE = `<!doctype html><meta charset=utf-8><title>csp attribution</title><body>
<script>
window.__viol = [];
document.addEventListener('securitypolicyviolation', function (e) {
  window.__viol.push({
    directive: e.effectiveDirective || e.violatedDirective,
    // The page cannot read the extension's id here — Chrome collapses the URL to the bare
    // scheme — but "an extension did this" is the whole signal, and it is enough.
    sourceFile: String(e.sourceFile || ''),
    line: e.lineNumber,
    sample: String(e.sample || '')
  });
});
window.__res = {};
// A plain string: refused on this document in every browser, because there is no default
// policy to convert it. The question is only who gets named.
try { new Worker('/w.js'); window.__res.plain = 'constructed'; }
catch (e) { window.__res.plain = e.name + ': ' + e.message; }
// A real TrustedScriptURL: the path a TT-enforcing site uses. Must still work.
window.__res.trusted = 'pending';
try {
  var p = trustedTypes.createPolicy('page-worker', { createScriptURL: function (s) { return s; } });
  var w = new Worker(p.createScriptURL('/w.js'));
  w.onmessage = function (ev) { window.__res.trusted = 'alive:' + ev.data.hc; };
  w.onerror = function () { window.__res.trusted = 'worker error'; };
} catch (e) { window.__res.trusted = e.name + ': ' + e.message; }
window.__res.hc = navigator.hardwareConcurrency;
<\/script>`;

const WORKER = 'self.postMessage({ hc: navigator.hardwareConcurrency });';

// PART 2's origin: a policy that permits blob: workers via 'strict-dynamic', so the wrapper
// must install and the worker must come back patched.
const CSP_PERMISSIVE = "script-src 'nonce-N' 'strict-dynamic' 'unsafe-inline';" +
                       "require-trusted-types-for 'script'";

const PAGE2 = `<!doctype html><meta charset=utf-8><body><script nonce="N">
window.__res = { hc: navigator.hardwareConcurrency, worker: 'pending' };
try {
  var p = trustedTypes.createPolicy('page-worker', { createScriptURL: function (s) { return s; } });
  var w = new Worker(p.createScriptURL('/w.js'));
  w.onmessage = function (ev) { window.__res.worker = ev.data.hc; };
  w.onerror = function (ev) { window.__res.worker = 'dead:' + JSON.stringify(ev.message); };
} catch (e) { window.__res.worker = e.name + ': ' + e.message; }
<\/script>`;

// PART 3: a document that forbids synchronous XHR. Not a CSP directive and not visible to
// the page at all — a Permissions-Policy violation exists only as a console record the
// browser writes from the real stack. Reported from stackoverflow.com, whose Cloudflare
// challenge builds a blob: worker:
//
//   Permissions policy violation: Synchronous requests are disabled by permissions policy.
//     mw-bundle.js (_wrapWorkerUrl)
//
// The wrapper read every worker's source with a blocking XHR to prepend its patch. The page
// below does the one thing that triggers it, and the worker must STILL come back patched —
// the fallback is importScripts, so 'no violation' must not be bought with 'no patch'.
const PAGE3 = `<!doctype html><meta charset=utf-8><body><script>
window.__res = { hc: navigator.hardwareConcurrency, worker: 'pending' };
(function () {
  var src = 'self.onmessage=function(){postMessage({hc:navigator.hardwareConcurrency})}';
  var w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  w.onmessage = function (ev) { window.__res.worker = ev.data.hc; };
  w.onerror = function () { window.__res.worker = 'dead'; };
  w.postMessage(1);
})();
</script>`;

// [FIX tt-policy-name-was-probed-by-trying-it] claude.ai's shape, read off the live
// response header: a `trusted-types` ALLOWLIST rather than youtube's absent directive. The
// difference decides everything — with no directive any policy name may be created and
// mw-workers wraps normally; with an allowlist our name is rejected, and the way the
// extension used to discover that was to CALL createPolicy, which REPORTS a violation
// naming mw-bundle.js before it throws. A try/catch cannot undo a report.
const CSP_TT_ALLOWLIST = "trusted-types Kssz2 default; require-trusted-types-for 'script'";
const PAGE4 = `<!doctype html><meta charset=utf-8><title>tt allowlist</title><body>
<script>
window.__viol = [];
document.addEventListener('securitypolicyviolation', function (e) {
  window.__viol.push({
    directive: e.effectiveDirective || e.violatedDirective,
    sourceFile: String(e.sourceFile || ''),
    line: e.lineNumber,
    sample: String(e.sample || '')
  });
});
window.__res = { hc: navigator.hardwareConcurrency, worker: 'pending' };
// The page's own worker, with a plain string — under require-trusted-types-for it throws,
// in a clean browser too. What matters is that it throws the SAME way with us.
try { new Worker('w.js'); window.__res.worker = 'ok'; }
catch (e) { window.__res.worker = 'threw ' + e.name; }
</script>`;

// [FIX importscripts-fallback-killed-turnstile] claude.ai's real header, and the shape that
// broke Cloudflare Turnstile: creating a blob worker is ALLOWED while importing a blob
// script is not. Two different permissions, and the wrapper used to assume one implied the
// other — it started, could not import what it was wrapping, and took the page's worker
// down with it. The page builds its worker source at runtime exactly as Turnstile does.
const CSP_WORKER_OK_SCRIPT_NO =
  "default-src 'none'; script-src 'nonce-abc' 'unsafe-eval'; " +
  "worker-src blob:; child-src blob:; connect-src 'self'";
const PAGE5 = `<!doctype html><meta charset=utf-8><title>turnstile shape</title><body>
<script nonce="abc">
window.__res = { hc: navigator.hardwareConcurrency, worker: 'pending' };
var src = 'self.onmessage=function(){postMessage({hc:navigator.hardwareConcurrency})}';
var u = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
try {
  var w = new Worker(u);
  w.onmessage = function (e) { window.__res.worker = e.data.hc; };
  w.onerror = function () { window.__res.worker = 'dead'; };
  w.postMessage(1);
} catch (e) { window.__res.worker = 'threw'; }
</script>`;

// One server, two hostnames — see the note in the header about per-hostname bookkeeping.
const server = createServer((q, r) => {
  const permissive = String(q.headers.host || '').startsWith('localhost');
  const csp = permissive ? CSP_PERMISSIVE : CSP;
  if (q.url.split('?')[0] === '/w.js') {
    r.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store',
                       'content-security-policy': csp }).end(WORKER);
    return;
  }
  if (q.url.split('?')[0] === '/loose') {
    // Same host as /ts, permissive policy. [FIX one-loose-response-erased-the-whole-origin]
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
                       'content-security-policy': "default-src 'self' blob: 'unsafe-inline'" })
     .end('<!doctype html><meta charset=utf-8><title>loose</title>ok');
    return;
  }
  if (q.url.split('?')[0] === '/ts') {
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
                       'content-security-policy': CSP_WORKER_OK_SCRIPT_NO }).end(PAGE5);
    return;
  }
  if (q.url.split('?')[0] === '/tt') {
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
                       'content-security-policy': CSP_TT_ALLOWLIST }).end(PAGE4);
    return;
  }
  if (q.url.split('?')[0] === '/pp') {
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
                       'permissions-policy': 'sync-xhr=()' }).end(PAGE3);
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
                     'content-security-policy': csp }).end(permissive ? PAGE2 : PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/** One browser, one measurement. `withExt` false is the control. */
async function measure(withExt, host = '127.0.0.1', path = '/', visitFirst = null) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'afp-cspattr-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    ...BROWSER,
    headless: !headed,
    args: withExt ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  try {
    if (withExt) {
      try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch (e) {}
      await bootSettled(ctx);   // onInstalled → initDefaults
    }
    const page = await ctx.newPage();
    // Permissions-Policy violations reach nobody but the console, so they are collected
    // here rather than by the in-page securitypolicyviolation listener.
    const consoleMsgs = [];
    page.on('console', (m) => consoleMsgs.push(m.text()));
    // Two loads on purpose. background.js learns "this origin refuses blob: workers" from
    // the response headers of the FIRST one; the second is the steady state a user is in on
    // youtube.com, and it is the state in which the wrapper knows up front that it can only
    // pass calls through. Measuring the first load only would miss it.
    await page.goto(`http://${host}:${port}${path}`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 1200));
    // Optional detour: other routes on the SAME host, visited between the two loads. Used to
    // prove a permissive sibling does not erase what a strict one recorded.
    for (const extra of (visitFirst || [])) {
      await page.goto(`http://${host}:${port}${extra}`, { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 900));
    }
    await page.goto(`http://${host}:${port}${path}`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 900));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 1500));     // let the trusted worker answer
    const out = await page.evaluate(() => ({
      viol: window.__viol || [], res: window.__res,
      blobBlockedFlag: (function () { try { return sessionStorage.getItem('v.ui.wb'); } catch (e) { return null; } })(),
      ttBlockedFlag: (function () { try { return sessionStorage.getItem('v.ui.tt'); } catch (e) { return null; } })(),
      workerCtor: String(window.Worker)
    }));
    // [FIX csp-console-count-was-read-before-it-settled] Console messages arrive over CDP
    // asynchronously and are not ordered against page.evaluate, so reading the array right
    // after the last load can miss one that is still in flight. The last row of this suite
    // compares the COUNT of CSP messages on the two sides, and on the first CI browser run
    // it reported "ours 1, clean 0" while the in-page violation records — which the page
    // collects synchronously — showed one on each. That is a capture race, not a finding,
    // and it flaked once in five runs.
    //
    // So the count is allowed to settle: two consecutive quiet windows before it is read.
    // Bounded, because a page that keeps talking should not hold the suite open.
    for (let quiet = 0, seen = -1, i = 0; quiet < 2 && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (consoleMsgs.length === seen) quiet++; else { quiet = 0; seen = consoleMsgs.length; }
    }
    out.console = consoleMsgs.slice();
    return out;
  } finally {
    await ctx.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

const clean = await measure(false);
const ours = await measure(true);
const permissive = await measure(true, 'localhost');
const ppClean = await measure(false, '127.0.0.1', '/pp');
const ppOurs = await measure(true, '127.0.0.1', '/pp');
// PART 4's pages, measured here with the others because the server is closed on the next
// line — a later measure() call would get ERR_CONNECTION_REFUSED.
const ttClean = await measure(false, '127.0.0.1', '/tt');
const ttOurs = await measure(true, '127.0.0.1', '/tt');
const tsClean = await measure(false, '127.0.0.1', '/ts');
const tsOurs = await measure(true, '127.0.0.1', '/ts');
// The same origin seen strict, then loose, then strict again — the shape claude.ai has and
// the reason the Turnstile fix did not take on the real site at first.
const stickyOurs = await measure(true, '127.0.0.1', '/ts', ['/loose', '/ts']);
server.close();

for (const [label, r] of [['clean', clean], ['ours', ours]]) {
  console.log(`\n=== ${label} === (hardwareConcurrency=${r.res.hc} v.ui.wb=${JSON.stringify(r.blobBlockedFlag)})`);
  console.log(`  new Worker(string)          ${r.res.plain}`);
  console.log(`  new Worker(TrustedScriptURL) ${r.res.trusted}`);
  for (const v of r.viol) console.log(`  violation  ${v.directive}  sourceFile=${v.sourceFile}  line=${v.line}`);
}

// The rig has to be real, or every assertion below is measuring a browser with no
// extension in it. 8 is the profile's hardwareConcurrency; the host's is whatever it is.
//
// [FIX the-standdown-never-fired] Asked of the PERMISSIVE origin, not of this one. The CSP
// above names no blob: in script-src and has no worker-src to fall back from, so this page
// refuses blob: workers — and there the window now yields, deliberately, because the
// page's own workers run native and would otherwise contradict it. Reading 8 here would
// mean the stand-down had stopped working. The permissive origin allows blob: workers via
// 'strict-dynamic', so it is the one that can still answer 'is the extension loaded'.
ok(permissive.res.hc === 8 && clean.res.hc !== 8,
  `the extension is patching the page (permissive=${permissive.res.hc}, clean=${clean.res.hc})`);

// And the yield itself, on the origin that cannot be patched: the window says what the
// machine says, which is what a clean browser says. test/wbcoherence.mjs is where this is
// measured across the whole surface and in a fresh tab; here it is one value, guarding the
// assertion above from being quietly satisfied by a build that spoofs nothing anywhere.
ok(ours.res.hc === clean.res.hc,
  `and it stands down where a worker cannot be patched (ours=${ours.res.hc}, clean=${clean.res.hc})`);
// And the origin has to have reached the state the bug lived in.
ok(/^1:/.test(String(ours.blobBlockedFlag)),
  `the origin was recognised as refusing blob: workers (v.ui.wb=${JSON.stringify(ours.blobBlockedFlag)})`);

// The finding itself.
const named = ours.viol.filter((v) => /chrome-extension/i.test(v.sourceFile));
ok(named.length === 0,
  'no CSP violation names chrome-extension' +
  (named.length ? ` — ${named.map((v) => v.sourceFile + ':' + v.line).join('; ')}` : ''));

// Suppressing the violation would pass the check above and still be wrong: the page's own
// failure has to reach the page's own listener, at the page's own line.
ok(ours.viol.length === clean.viol.length,
  `the page sees the same number of violations as in a clean browser ` +
  `(ours=${ours.viol.length}, clean=${clean.viol.length})`);
ok(clean.viol.length > 0 &&
   ours.viol.every((v, i) => clean.viol[i] && v.line === clean.viol[i].line &&
                             v.sourceFile === clean.viol[i].sourceFile),
  'each violation is attributed to the same file and line as in a clean browser');

// The half that must keep working.
ok(/^alive:/.test(ours.res.trusted),
  `a TrustedScriptURL still builds a live worker (${ours.res.trusted})`);
ok(ours.res.plain === clean.res.plain,
  `new Worker(string) fails identically to a clean browser (ours="${ours.res.plain}")`);

// ---- part 2: an origin that PERMITS blob: workers must get its worker patched ----------
console.log(`\n=== permissive origin ('strict-dynamic') === ` +
  `(v.ui.wb=${JSON.stringify(permissive.blobBlockedFlag)})`);
console.log(`  window hardwareConcurrency ${permissive.res.hc}`);
console.log(`  worker hardwareConcurrency ${permissive.res.worker}`);

ok(!/^[123]:/.test(String(permissive.blobBlockedFlag)),
  `a strict-dynamic CSP is not mistaken for one that refuses blob: workers ` +
  `(v.ui.wb=${JSON.stringify(permissive.blobBlockedFlag)})`);
// The whole point of patching a worker: no scope can answer with a different machine than
// the window. Reading 8 in the window and the host's count in the worker is the split a
// fingerprinter looks for, and it is what this origin used to produce.
ok(permissive.res.worker === permissive.res.hc,
  `window and worker report the same machine (window=${permissive.res.hc}, ` +
  `worker=${permissive.res.worker})`);

// ── PART 3: sync-xhr=() ────────────────────────────────────────────────────────
const syncViol = (r) => (r.console || []).filter((m) => /Synchronous requests are disabled|permissions policy/i.test(m));
console.log('');
console.log('=== sync-xhr=() === clean worker=' + ppClean.res.worker + ' ours worker=' + ppOurs.res.worker);
for (const m of syncViol(ppOurs)) console.log('  ours violation   ' + m.slice(0, 100));
for (const m of syncViol(ppClean)) console.log('  clean violation  ' + m.slice(0, 100));
ok(ppOurs.res.hc === 8 && ppClean.res.hc !== 8,
  `sync-xhr page: the extension is patching it (ours=${ppOurs.res.hc}, clean=${ppClean.res.hc})`);
ok(syncViol(ppOurs).length === syncViol(ppClean).length,
  `sync-xhr=(): the extension adds no permissions-policy violation ` +
  `(ours ${syncViol(ppOurs).length}, clean ${syncViol(ppClean).length})`);
ok(ppOurs.res.worker === 8,
  `sync-xhr=(): the blob worker is still patched without the blocking read (worker=${ppOurs.res.worker})`);

// ── PART 4: a trusted-types ALLOWLIST ──────────────────────────────────────────
// [FIX tt-policy-name-was-probed-by-trying-it] The difference from PART 1 is one directive:
// youtube omits `trusted-types`, so any policy name is allowed and createPolicy succeeds
// silently. claude.ai names an allowlist, and there the only way the extension had to find
// out was to try — which REPORTS before it throws:
//
//   Creating a TrustedTypePolicy named 'afp-blob-url' violates the following Content
//   Security policy directive: "trusted-types Kssz2 default".      at mw-bundle.js:10236
//
// It is answered from the response header now (background.js afpCspRestrictsTrustedTypes),
// and the policy is resolved lazily at first use rather than at document_start — the flag
// arrives ~8ms in, so deciding at load meant deciding before the answer existed. That
// ordering WAS the first, failed attempt at this fix (measured: v.ui.tt=1 and the violation
// on the same load), which is why measure() loads the page twice.
const ttNamed = (r) => (r.viol || []).filter((v) => /chrome-extension/i.test(v.sourceFile || ''));
console.log('');
console.log('=== trusted-types allowlist === clean worker=' + ttClean.res.worker +
  ' ours worker=' + ttOurs.res.worker + ' v.ui.tt=' + ttOurs.ttBlockedFlag);
for (const v of (ttOurs.viol || [])) console.log('  ours violation   ' + JSON.stringify(v).slice(0, 120));
for (const v of (ttClean.viol || [])) console.log('  clean violation  ' + JSON.stringify(v).slice(0, 120));

// [FIX tt-standdown-split-window-from-worker] This asserted the OPPOSITE until 2026-08-22 —
// that the window is patched here. It is not, and that is the fix rather than a regression.
// An allowlist that withholds every policy name we could mint leaves the worker unpatchable,
// and a window that spoofs beside an honest worker is a browser contradicting itself: 8 cores
// and Europe/Tallinn in one scope, 18 and Europe/Moscow in the other, one `new Worker()`
// apart. That pair is what Cloudflare Turnstile answered 600010 to. So the window stands
// down with the worker instead, and what this line pins is that the stand-down is TOTAL —
// a half-patched page would be the very split the change removes. The agreement itself is
// pinned in test/ttworker.mjs, which reads both scopes rather than one.
ok(ttOurs.res.hc === ttClean.res.hc,
  `trusted-types page: the window stands down with the worker (ours=${ttOurs.res.hc}, clean=${ttClean.res.hc})`);
ok(/^1:/.test(String(ttOurs.ttBlockedFlag)),
  `the restriction was learned from the header and reached the page (v.ui.tt=${ttOurs.ttBlockedFlag})`);
// The CONSOLE, not the page's securitypolicyviolation listener. Our createPolicy runs at
// document_start, before the page has installed that listener, so the page never sees the
// violation and an assertion over window.__viol passes while the console is full of it —
// verified by negative control. The console is also exactly where the user found it.
const ttPolicyMsgs = (r) => (r.console || []).filter((m) => /TrustedTypePolicy/i.test(m));
ok(ttPolicyMsgs(ttOurs).length === 0,
  'the extension never attempts a policy name the allowlist rejects' +
  (ttPolicyMsgs(ttOurs).length ? ` — ${ttPolicyMsgs(ttOurs)[0].slice(0, 110)}` : ''));
ok(ttPolicyMsgs(ttOurs).length === ttPolicyMsgs(ttClean).length,
  `and adds no createPolicy message a clean browser does not have ` +
  `(ours ${ttPolicyMsgs(ttOurs).length}, clean ${ttPolicyMsgs(ttClean).length})`);
ok(ttNamed(ttOurs).length === 0,
  'no page-visible violation names chrome-extension:// either' +
  (ttNamed(ttOurs).length ? ` — ${JSON.stringify(ttNamed(ttOurs)[0])}` : ''));
ok((ttOurs.viol || []).length === (ttClean.viol || []).length,
  `the page sees the same number of violations as in a clean browser ` +
  `(ours ${(ttOurs.viol || []).length}, clean ${(ttClean.viol || []).length})`);
ok(ttOurs.res.worker === ttClean.res.worker,
  `the page's own worker behaves as it does without us (ours ${ttOurs.res.worker}, ` +
  `clean ${ttClean.res.worker})`);

// ── PART 5: worker allowed, blob SCRIPT refused ────────────────────────────────
// [FIX importscripts-fallback-killed-turnstile] The reported failure, reduced. What the
// user saw on claude.ai:
//
//   Loading the script 'blob:https://claude.ai/...' violates ... script-src 'nonce-...'
//        _AFPIS @ blob:https://claude.ai/...:1400
//   [Cloudflare Turnstile] Failed to execute 'importScripts' on 'WorkerGlobalScope'
//   [Cloudflare Turnstile] Cannot find Widget cf-chl-widget-...
//
// The captcha never completed and printed nothing the user could act on. The assertion that
// matters is not "no violation" — it is that the page's OWN worker still runs, because the
// damage was to the site, not to us.
const tsCsp = (r) => (r.console || []).filter((m) => /Content Security Policy/i.test(m));
console.log('');
console.log('=== worker-src blob: with a nonce-only script-src === clean worker=' +
  tsClean.res.worker + ' ours worker=' + tsOurs.res.worker);
for (const m of tsCsp(tsOurs)) console.log('  ours violation   ' + m.slice(0, 100));

ok(tsClean.res.worker === tsClean.res.hc,
  `control: the page's worker runs without us (${tsClean.res.worker})`);
ok(tsOurs.res.worker !== 'dead' && tsOurs.res.worker !== 'pending' && tsOurs.res.worker !== 'threw',
  `the page's worker still runs with the extension (${tsOurs.res.worker}) — it used to die here`);
ok(tsCsp(tsOurs).length === tsCsp(tsClean).length,
  `and the extension adds no CSP violation (ours ${tsCsp(tsOurs).length}, clean ${tsCsp(tsClean).length})`);
// The cost, stated rather than hidden: the worker is NOT patched on such an origin, because
// there is no way to get patched code into it that the page's CSP will accept. Passing
// through is the honest outcome; breaking the site was not.
ok(String(tsOurs.res.worker) === String(tsClean.res.worker),
  `the worker is left unpatched rather than broken (ours ${tsOurs.res.worker}, ` +
  `clean ${tsClean.res.worker}) — the documented cost of this origin shape`);

// [FIX one-loose-response-erased-the-whole-origin] The four CSP lists are add-only. They
// used to toggle, so a single permissive document from the same host erased what a strict
// one had recorded — measured: ns=["127.0.0.1"] -> [] -> ["127.0.0.1"]. That is why the
// Turnstile fix worked in a one-route rig and not on claude.ai, which serves both shapes.
// A host wrongly IN the list costs an unpatched worker; wrongly OUT of it costs the site.
console.log('');
console.log('=== strict, then loose, then strict (same host) === worker=' + stickyOurs.res.worker);
ok(stickyOurs.res.worker !== 'dead' && stickyOurs.res.worker !== 'threw',
  `a permissive sibling route does not erase the restriction (worker=${stickyOurs.res.worker})`);
ok(String(stickyOurs.res.worker) === String(tsClean.res.worker),
  `and the page still behaves as it does without us (${stickyOurs.res.worker} vs ${tsClean.res.worker})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
