/**
 * DOES A BLOB-REFUSING ORIGIN GET ITS FIRST WORKER?
 *
 *   node tools/probe-blobcsp.mjs            four fresh browsers
 *   node tools/probe-blobcsp.mjs 8 --headed
 *
 * Reported from the field, on github.com, first load of a session:
 *
 *   Creating a worker from 'blob:https://github.com/…' violates the following Content
 *   Security Policy directive: "worker-src github.githubassets.com …". The action has
 *   been blocked.        mw-bundle.js (_wrapModuleWorker)
 *
 * The action has been BLOCKED — so the page did not get its worker. That is the failure
 * [FIX csp-blob-worker-broke-whatsapp] set out to prevent, and the machinery for it is all
 * there: afpCspBlocksBlobWorkers parses the header correctly (checked against GitHub's
 * exact policy, which it calls blocked), the host is recorded in afp_csp_noblob, and
 * storage-bridge turns that into the `v.ui.wb` flag mw-workers reads before it wraps.
 *
 * WHAT IS NOT ESTABLISHED is whether that arrives in time. The flag crosses four
 * asynchronous hops — response header, chrome.storage.set, storage-bridge's read or its
 * onChanged, sessionStorage — while the page is free to construct a worker in its first
 * script. The comment in background.js asserts the service worker "sees the response
 * headers before the document is parsed, which is early enough". This measures it, because
 * a console line from a real site says otherwise.
 *
 * The page here carries GitHub's policy shape and builds a MODULE worker, which is the path
 * the report names. Each round is a fresh browser: whether the host is already in the
 * learned list is the whole question, so a second round in the same profile would answer a
 * different one — and all three columns are worth printing.
 *
 * WHY THIS IS A TOOL AND NOT A SUITE, which was tried twice and abandoned twice. An
 * assertion was added to test/cspattribution.mjs and PASSED against the published HEAD —
 * a build without the fix — in both of its forms:
 *
 *   reading v.ui.wb at parse time   that fixture is a tiny page, so storage-bridge's
 *                                   asynchronous read beats its inline script and the flag
 *                                   is already set even with nothing registered;
 *   reading the worker's outcome    same reason, plus measure() warms the origin with
 *                                   several loads before the fresh tab, so the wrapper has
 *                                   long since learned to stand down.
 *
 * Both were removed rather than kept. A check that passes on a build known to be broken is
 * the one thing this project throws checks out for, and three have gone that way already.
 * What makes THIS reproduce is what a suite there cannot cheaply have: a fresh profile per
 * round, no warm-up at all, and a module worker built in the document's first script.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, BROWSER } from '../test/harness.mjs';

const HEADED = process.argv.includes('--headed');
const ROUNDS = Number(process.argv.find((a) => /^\d+$/.test(a)) || 4);
const EXT = process.env.FPS_EXT_ROOT ? path.resolve(process.env.FPS_EXT_ROOT) : root;

// The SHAPE of github.com's worker-src, not its letter. The real policy lists github's own
// asset hosts and no blob:; copied verbatim onto 127.0.0.1 it would refuse this page's own
// worker too, and then every round fails for a reason that has nothing to do with the
// extension — which is exactly what the first version of this probe measured. 'self' is the
// same policy relative to the server serving it: the page's own worker is allowed, a blob
// one is not.
const GH_CSP = "worker-src 'self'";

const WORKER_JS = 'self.onmessage = () => postMessage("alive");\n';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>blobcsp</title></head>
<body>probe<script type="module">
// Built in the first script of the document, which is where a real page builds one and
// where the flag has had the least time to arrive.
window.__w = new Promise((res) => {
  let done = false;
  const finish = (v) => { if (!done) { done = true; res(v); } };
  try {
    const w = new Worker('/worker.js', { type: 'module' });
    w.onmessage = (e) => finish('alive:' + e.data);
    w.onerror = (e) => finish('error:' + (e && e.message ? e.message : '(empty message)'));
    w.postMessage(1);
  } catch (e) { finish('threw:' + (e && e.name)); }
  setTimeout(() => finish('timeout'), 4000);
});
</script></body></html>`;

const server = createServer((q, r) => {
  if (q.url.startsWith('/worker.js')) {
    return r.writeHead(200, { 'content-type': 'application/javascript' }).end(WORKER_JS);
  }
  r.writeHead(200, {
    'content-type': 'text/html',
    'cache-control': 'no-store',
    'content-security-policy': GH_CSP,
  }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

/**
 * THE CONTROL, and the first version of this probe went without one and paid for it: with
 * github's literal policy on 127.0.0.1 no worker of any kind could load, so the extension
 * was blamed for a fixture that refused everything. A clean browser has to get its worker
 * on this page, or the page is wrong and nothing measured through it means anything.
 */
{
  const dir = mkdtempSync(path.join(tmpdir(), 'afp-blobcsp-clean-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !HEADED,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: [],
  });
  const page = await ctx.newPage();
  await page.goto(URL_ + '?clean=1', { waitUntil: 'load' });
  const got = await page.evaluate('window.__w');
  console.log(`control, no extension: worker ${got}` +
    `${got === 'alive:alive' ? '   (so the page itself is fine)' : '   <- THE FIXTURE IS WRONG'}\n`);
  await ctx.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  if (got !== 'alive:alive') {
    console.log('A clean browser cannot build this worker either, so the policy above refuses');
    console.log('more than blob: and nothing below is about the extension. Fix the fixture.');
    server.close();
    process.exit(1);
  }
}

let firstBad = 0, laterBad = 0, newTabBad = 0;
for (let n = 1; n <= ROUNDS; n++) {
  const dir = mkdtempSync(path.join(tmpdir(), 'afp-blobcsp-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !HEADED,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0]
      || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    const learned = () => sw.evaluate(async () => {
      const s = await chrome.storage.local.get(['afp_csp_noblob']);
      return (s.afp_csp_noblob || []).join(',') || '(empty)';
    }).catch(() => '(unreadable)');

    const page = await ctx.newPage();
    const blocked = [];
    page.on('console', (m) => {
      const t = m.text();
      if (/violates the following Content Security Policy/i.test(t)) blocked.push('csp');
    });

    await page.goto(URL_ + '?load=1', { waitUntil: 'load' });
    const one = await page.evaluate('window.__w');
    const learnedAfterOne = await learned();
    const flagOne = await page.evaluate(() => {
      try { return sessionStorage.getItem('v.ui.wb'); } catch (e) { return 'ERR'; }
    });

    await page.reload({ waitUntil: 'load' });
    const two = await page.evaluate('window.__w');
    // A THIRD reading, in a brand-new TAB. v.ui.wb is sessionStorage, which is per tab, so
    // the reactive flag that saved load 2 does nothing here — only a per-host registered
    // script can. This is the column that says whether the fix is real.
    const tab2 = await ctx.newPage();
    await tab2.goto(URL_ + '?tab=2', { waitUntil: 'load' });
    const three = await tab2.evaluate('window.__w');
    await tab2.close();
    const flagTwo = await page.evaluate(() => {
      try { return sessionStorage.getItem('v.ui.wb'); } catch (e) { return 'ERR'; }
    });

    const bad1 = one !== 'alive:alive';
    const bad2 = two !== 'alive:alive';
    const bad3 = three !== 'alive:alive';
    if (bad3) newTabBad++;
    if (bad1) firstBad++;
    if (bad2) laterBad++;
    console.log(`round ${n}:`);
    console.log(`   load 1   worker ${one}   v.ui.wb=${JSON.stringify(flagOne)}`);
    console.log(`   load 2   worker ${two}   v.ui.wb=${JSON.stringify(flagTwo)}`);
    console.log(`   NEW TAB  worker ${three}`);
    console.log(`   learned after load 1: ${learnedAfterOne}` +
      `${blocked.length ? `   CSP violations logged: ${blocked.length}` : ''}`);
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  }
}
server.close();

console.log(`\nfirst load of a fresh profile: ${firstBad} of ${ROUNDS} lost the worker`);
console.log(`second load of the same tab  : ${laterBad} of ${ROUNDS} lost the worker`);
console.log(`a brand-new tab on that host : ${newTabBad} of ${ROUNDS} lost the worker`);
// The three columns answer three different questions, and only the third moved when
// [FIX the-first-worker-on-a-blob-refusing-origin-was-always-lost] landed. Paired against a
// pristine clone of the published HEAD through FPS_EXT_ROOT, four rounds each:
//
//                        HEAD    fixed
//   first load           4/4     4/4     unchanged, and cannot change — see below
//   second load          0/4     0/4     the reactive flag was always enough here
//   a brand-new TAB      4/4     0/4     the registered per-host script
//
// The new-tab column is the one that mattered in practice: v.ui.wb is sessionStorage, so it
// is per TAB, and before the fix every new tab on a blob-refusing site lost its worker again.
if (newTabBad) {
  console.log('\nA new tab still loses it, so the per-host script is not reaching this origin.');
  console.log('Check that background.js registered afp-noblob for the host, and that the CSP');
  console.log('observer recorded it — the registration is built from afp_csp_noblob.');
} else if (firstBad) {
  console.log('\nOnly the FIRST load of a fresh profile loses it, which is the residual this');
  console.log('cannot close: nothing can be registered for a host nobody has visited yet. One');
  console.log('page load per host per profile, against one per tab before. README "Limits" carries it.');
}
process.exitCode = firstBad + laterBad + newTabBad;
