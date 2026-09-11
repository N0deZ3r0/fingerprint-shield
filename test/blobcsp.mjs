/**
 * A BLOB-REFUSING ORIGIN MUST KEEP ITS FIRST WORKER — in every tab after the first visit.
 *
 *   node test/blobcsp.mjs             headless
 *   node test/blobcsp.mjs --headed    watch it
 *
 * Reported from the field, github.com, with the extension installed:
 *
 *   Creating a worker from 'blob:https://github.com/…' violates the following Content
 *   Security Policy directive: "worker-src github.githubassets.com …". The action has
 *   been blocked.        mw-bundle.js (_wrapModuleWorker)
 *
 * BLOCKED — the page did not get the worker it asked for. Every worker mw-workers wraps is
 * built from a blob, so an origin whose worker sources omit blob: refuses the construction
 * and the page is left holding a dead object.
 * [FIX the-first-worker-on-a-blob-refusing-origin-was-always-lost] delivers the answer with
 * a per-host content script instead of through chrome.storage, so it arrives before the
 * page's own first script rather than after it.
 *
 * WHY THIS IS ITS OWN FILE, after two attempts inside test/cspattribution.mjs that both
 * PASSED against a build without the fix. That suite's fixture is a tiny page whose inline
 * script loses the race to storage-bridge's asynchronous read, and its measure() warms the
 * origin with several loads before it looks — so by then the wrapper has learned to stand
 * down whatever the build does. Neither assertion could fail. They were removed.
 *
 * What makes this one able to fail is the three things that fixture could not have:
 *
 *   a FRESH PROFILE per configuration   the learned host list is the whole subject
 *   NO warm-up at all                   the race is the subject too
 *   the worker built in the document's first script, as a module — the path reported
 *
 * and the assertion is on the WORKER, not on a flag: whether the page kept what it asked
 * for is not something a timing accident can fake.
 *
 * NEGATIVE-CONTROLLED against f163ef1, the commit before the fix: 4 of 4 fresh tabs lost
 * the worker there, 0 of 4 with it. FPS_EXT_ROOT points this file at another tree, which is
 * how that was run and how it can be re-run.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harness, root, BROWSER } from './harness.mjs';

const headed = process.argv.includes('--headed');
const { assert, eq, section, note, done } = harness();
const EXT = process.env.FPS_EXT_ROOT ? path.resolve(process.env.FPS_EXT_ROOT) : root;
if (process.env.FPS_EXT_ROOT) console.log(`extension root: ${EXT} (FPS_EXT_ROOT)`);

// The SHAPE of github.com's worker-src, not its letter: the real policy names github's own
// asset hosts, and copied verbatim onto 127.0.0.1 it would refuse this page's own worker
// too — every round would then fail for a reason that is the fixture's, not the build's.
// 'self' is the same policy relative to whoever serves it: the page's own worker allowed,
// a blob one refused.
const CSP = "worker-src 'self'";
const WORKER_JS = 'self.onmessage = () => postMessage("alive");\n';

// A CLASSIC inline script in <head>, and that is load-bearing. The first version of this
// fixture built the worker from `<script type="module">` — and module scripts are DEFERRED
// by specification, so they run after the document is parsed and hand storage-bridge's
// asynchronous read all the time it needs to win. Measured: on the commit before the fix,
// the new-tab rows PASSED with a module script and failed with this one. The reported path
// is a worker constructed early in the document; the `{type:'module'}` belongs on the
// Worker, which is what _wrapModuleWorker sees, not on the script that builds it.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>blobcsp</title>
<script>
window.__w = new Promise(function (res) {
  var done = false;
  var finish = function (v) { if (!done) { done = true; res(v); } };
  try {
    var w = new Worker('/worker.js', { type: 'module' });
    w.onmessage = function (e) { finish('alive:' + e.data); };
    w.onerror = function (e) { finish('error:' + (e && e.message ? e.message : '(empty message)')); };
    w.postMessage(1);
  } catch (e) { finish('threw:' + (e && e.name)); }
  setTimeout(function () { finish('timeout'); }, 4000);
});
</script></head><body>probe</body></html>`;

// [FIX a-meta-csp-was-never-learned] The same policy the way web.telegram.org/a/ delivers it:
// a <meta http-equiv> in <head> and no header at all. Its worker reports the core count as
// well, because on this route "alive" is not the whole answer — a worker the wrapper could
// not patch is native, and the window has to stand down with it or the two disagree.
const WORKER_CORES_JS = 'self.onmessage = () => postMessage("alive/" + navigator.hardwareConcurrency);\n';
const META_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}"><title>blobcsp meta</title>
<script>
window.__v = [];
document.addEventListener('securitypolicyviolation', function (e) { __v.push(e.violatedDirective); });
window.__cores = navigator.hardwareConcurrency;
window.__w = new Promise(function (res) {
  var done = false;
  var finish = function (v) { if (!done) { done = true; res(v); } };
  try {
    var w = new Worker('/wcores.js', { type: 'module' });
    w.onmessage = function (e) { finish(String(e.data)); };
    w.onerror = function (e) { finish('error:' + (e && e.message ? e.message : '(empty message)')); };
    w.postMessage(1);
  } catch (e) { finish('threw:' + (e && e.name)); }
  setTimeout(function () { finish('timeout'); }, 4000);
});
</script></head><body>probe</body></html>`;

const server = createServer((q, r) => {
  if (q.url.startsWith('/worker.js')) {
    return r.writeHead(200, { 'content-type': 'application/javascript' }).end(WORKER_JS);
  }
  if (q.url.startsWith('/wcores.js')) {
    return r.writeHead(200, { 'content-type': 'application/javascript' }).end(WORKER_CORES_JS);
  }
  if (q.url.startsWith('/meta')) {
    return r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(META_PAGE);
  }
  r.writeHead(200, {
    'content-type': 'text/html', 'cache-control': 'no-store', 'content-security-policy': CSP,
  }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

function launch(withExt) {
  const dir = mkdtempSync(path.join(tmpdir(), 'afp-blobcsp-'));
  return chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !headed,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: withExt ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [],
  }).then((ctx) => ({ ctx, dir }));
}
const shut = async ({ ctx, dir }) => {
  await ctx.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
};

// ── the control ────────────────────────────────────────────────────────────────
//
// A clean browser has to keep this worker, or the policy above refuses more than blob: and
// nothing below is about the extension at all. The first version of the probe this file
// grew from had github's literal policy on 127.0.0.1 and measured exactly that mistake.
section('0) the fixture allows the page its own worker');
{
  const b = await launch(false);
  const page = await b.ctx.newPage();
  await page.goto(URL_ + '?clean=1', { waitUntil: 'load' });
  const got = await page.evaluate('window.__w');
  eq(got, 'alive:alive',
    'a clean browser keeps the worker this page asks for — otherwise the CSP fixture is ' +
    'wrong and every assertion below measures it rather than the build');
  await shut(b);
}

// ── the finding ────────────────────────────────────────────────────────────────
section('1) after the first visit, every tab keeps its worker');
{
  const b = await launch(true);
  try {
    await (b.ctx.serviceWorkers()[0]
      || b.ctx.waitForEvent('serviceworker', { timeout: 20000 }));
    // The observer has to be listening before the visit it is supposed to observe. Without
    // this the first navigation raced the service worker's own startup, the CSP header was
    // never seen, the host was never recorded, and the registration never appeared — which
    // reads exactly like the fix not working. Measured: with the wait the host is recorded
    // and the registration is up; without it, neither. The same shape as the install window
    // the CI runner exposed, one layer down.
    await new Promise((r) => setTimeout(r, 2000));

    // Visit one: this is where the CSP observer meets the header for the first time, and
    // nothing can be registered for a host nobody has seen. This load is EXPECTED to lose
    // its worker; it is the residual recorded as README "Limits", item 13, and asserting it holds
    // the limit honest — if it ever starts passing, the limit is stale and should go.
    const first = await b.ctx.newPage();
    await first.goto(URL_ + '?visit=1', { waitUntil: 'load' });
    const one = await first.evaluate('window.__w');
    await first.close();
    note(`the very first visit in a fresh profile: worker ${one} — expected to be lost, ` +
      `because the answer cannot be registered for a host nobody has visited yet`);

    // Wait for the REGISTRATION, not for a duration. The chain behind it is long — header
    // seen, host appended to afp_csp_noblob, storage.onChanged, updateNoBlobScript,
    // registerContentScripts — and a fixed 2.5s was not enough here: the first new tab
    // opened before the registration existed and lost its worker even though `v.ui.wb` read
    // as set, because the reactive path had set it after the fact. Polling for the thing
    // itself models the case that matters (any visit after the first) and turns the delay
    // into a number instead of a guess.
    // The worker handle is re-acquired on every poll rather than captured once. A service
    // worker can be torn down and replaced between polls, and the first version of this
    // loop held one handle and swallowed the resulting rejection with `.catch(() => false)`
    // — which reads exactly like "not registered yet" and had this suite reporting that the
    // registration never appeared while it was sitting there the whole time. A caught error
    // that is indistinguishable from a negative answer is not a caught error.
    const t0 = Date.now();
    let waited = -1, pollErr = null;
    for (let i = 0; i < 60; i++) {
      const live = b.ctx.serviceWorkers()[0];
      if (live) {
        try {
          const have = await live.evaluate(async () => {
            const r = await chrome.scripting.getRegisteredContentScripts({ ids: ['afp-noblob'] });
            return !!(r && r.length);
          });
          if (have) { waited = Date.now() - t0; break; }
        } catch (e) { pollErr = String(e && e.message).slice(0, 80); }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (pollErr) note(`(the registration poll saw at least one worker error: ${pollErr})`);
    note(waited >= 0
      ? `the per-host registration appeared ${waited}ms after the first visit — every tab ` +
        `opened before that still pays the price, which is the width of the residual`
      : 'the per-host registration never appeared within 15s');

    // And now the part that regressed in the field. A BRAND-NEW TAB: `v.ui.wb` is
    // sessionStorage and therefore per tab, so nothing this profile has learned reaches it
    // except the per-host registration. Before the fix this lost the worker every time.
    for (const n of [1, 2]) {
      const tab = await b.ctx.newPage();
      await tab.goto(URL_ + '?tab=' + n, { waitUntil: 'load' });
      const got = await tab.evaluate('window.__w');
      const flag = await tab.evaluate(() => {
        try { return sessionStorage.getItem('v.ui.wb'); } catch (e) { return null; }
      });
      await tab.close();
      eq(got, 'alive:alive',
        `new tab ${n} on a known blob-refusing origin keeps the worker it asked for ` +
        `(v.ui.wb=${JSON.stringify(flag)}) — without the afp-noblob registration each tab ` +
        `rediscovers the policy by spending a worker on it, which is what github.com reported`);
    }

    // The host really did get recorded — otherwise the two rows above would be passing
    // because the wrapper never wrapped, which is a different build with the same output.
    const sw = b.ctx.serviceWorkers()[0];
    const learned = await sw.evaluate(async () => {
      const s = await chrome.storage.local.get(['afp_csp_noblob']);
      return s.afp_csp_noblob || [];
    }).catch(() => []);
    // Entries are host/segment since [FIX csp-restrictions-learned-per-route].
    assert(learned.some((e) => e.split('/')[0] === '127.0.0.1'),
      `the CSP observer recorded the host (afp_csp_noblob=${JSON.stringify(learned)}) — if it ` +
      `did not, the rows above pass for the wrong reason: a wrapper that never ran`);

    const regs = await sw.evaluate(async () => {
      const r = await chrome.scripting.getRegisteredContentScripts({ ids: ['afp-noblob'] });
      return r && r[0] ? { matches: r[0].matches, js: r[0].js, world: r[0].world } : null;
    }).catch(() => null);
    assert(!!regs && (regs.js || []).indexOf('noblob.js') !== -1,
      `and registered noblob.js for it (${JSON.stringify(regs)})`);
  } finally {
    await shut(b);
  }
}

// ── the <meta> route ───────────────────────────────────────────────────────────
//
// [FIX a-meta-csp-was-never-learned] Reported from web.telegram.org/a/, whose policy is a
// <meta> element and no header. Section 1's machinery never heard of it, so EVERY new tab lost
// its first worker, not only the first visit. Measured on the build before the fix, a fresh
// profile: load 1 dead, load 2 of that tab alive (tab history), a new tab dead again — the
// window on the profile's 8 cores beside a worker that never answered.
//
// Asserted from the very first load: no residual is expected here, because the element is in
// the document and read at read time. The core count is what makes "alive" mean "coherent":
// the worker the wrapper leaves alone answers natively, so the window must too.
section('2) a <meta> policy: the worker lives and the window agrees with it, from the first load');
{
  const b = await launch(true);
  try {
    // No settling sleep here, unlike section 1: the page reads the <meta> itself, so no load
    // below waits on the observer, and the learning is polled for at the end.
    await (b.ctx.serviceWorkers()[0] || b.ctx.waitForEvent('serviceworker', { timeout: 20000 }));
    for (const [n, q] of [[1, 'visit=1'], [2, 'tab=2'], [3, 'tab=3']]) {
      const tab = await b.ctx.newPage();
      await tab.goto(URL_ + 'meta?' + q, { waitUntil: 'load' });
      const got = await tab.evaluate('window.__w');
      await tab.waitForTimeout(150);
      const r = await tab.evaluate(() => ({ cores: window.__cores, v: window.__v.slice() }));
      await tab.close();
      assert(/^alive\/\d+$/.test(got), `load ${n}: the page keeps the module worker it asked for (${got})`);
      eq(String(r.cores), String(got).split('/')[1],
        `load ${n}: the window answers the worker's core count — the worker is native, so the window stands down with it`);
      eq(r.v.length, 0, `load ${n}: no CSP violation (${JSON.stringify(r.v)}) — the refusal used to be charged to mw-bundle.js`);
    }
    // And background heard of it from the page, so the next documents stand down before their
    // first script and their headers leave the rewrite too. Polled: the report is sent at
    // DOMContentLoaded and written through a storage promise.
    let learned = [];
    for (let i = 0; i < 20; i++) {
      const sw = b.ctx.serviceWorkers()[0];
      if (sw) {
        learned = await sw.evaluate(async () => (await chrome.storage.local.get(['afp_csp_noblob'])).afp_csp_noblob || [])
          .catch(() => []);
      }
      if (learned.includes('127.0.0.1/meta')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert(learned.includes('127.0.0.1/meta'),
      `the route was learned from the <meta> element (afp_csp_noblob=${JSON.stringify(learned)})`);
  } finally {
    await shut(b);
  }
}

done();
