/**
 * DOES getHighEntropyValues ANSWER ONLY WHAT WAS ASKED?
 *
 *   node test/uachshape.mjs             headless
 *   node test/uachshape.mjs --headed    watch it
 *
 * `navigator.userAgentData.getHighEntropyValues(hints)` resolves with the low-entropy trio
 * (brands, mobile, platform) plus ONLY the hints the caller named. Our wrapper built every
 * field and then deleted exactly two of them when unrequested, so architecture, bitness,
 * model, platformVersion, wow64 and formFactors came back on every call — including
 * `getHighEntropyValues([])`. Measured, clean Chromium against this build on one machine:
 *
 *     getHighEntropyValues([])                 clean  3 keys      ours 11
 *     getHighEntropyValues(['platform'])       clean  3 keys      ours  9
 *     getHighEntropyValues(['architecture'])   clean  4 keys      ours  9
 *
 * A key nobody asked for is a deterministic tell: one call, no statistics, and the answer
 * has a shape no browser produces. Same class as [FIX invented-chrome-runtime] and the
 * own-property half of [FIX uad-shape-not-just-values] — which fixed the ORDER of these
 * keys and left their NUMBER alone, because the page that checked it
 * (dev-wvw.html) asks for all eight hints at once and therefore could never see it.
 *
 * WHY THE EXPECTED SET IS NOT WRITTEN DOWN HERE. It is read from a clean browser in the
 * same run. A literal list would have to be revised every time the platform adds a hint,
 * and the version that is wrong looks exactly like the version that is right — the same
 * trap [FIX temporal-and-newer-intl-ctors] documents for hand-listed API sets.
 *
 * The window and the worker are checked separately: mw-navigator.js and mw-workers.js keep
 * mirrored copies of this wrapper, and the comment in each says to change them together.
 *
 * THE SECOND QUESTION, ADDED LATER: WHICH HINT HEADERS ACTUALLY TRAVELLED. Everything above
 * is read out of the page, and a page cannot see the wire. The two halves of the answer are
 * decided in completely different places — the JS shape by mw-navigator.js, the headers by
 * the static rulesets and the per-origin DNR rules — so the suite that has a clean browser
 * beside ours already running is the cheapest place to compare them. The routes for it
 * ('/ch', '/ch-sub', '/crit') are new; '/' and '/w.js' answer exactly what they did.
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

/** The hint lists that matter: the empty one, each hint alone, a pair, and all of them. */
const CASES = [
  [],
  ['platform'],
  ['architecture'],
  ['bitness'],
  ['model'],
  ['platformVersion'],
  ['uaFullVersion'],
  ['fullVersionList'],
  ['formFactors'],
  ['wow64'],
  ['platformVersion', 'model'],
  ['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64', 'formFactors'],
  // Not a hint at all. Chrome ignores unknown names rather than throwing or echoing them.
  ['notAHint']
];

const WORKER = `
self.onmessage = async (e) => {
  const out = {};
  for (const hints of e.data) {
    const key = JSON.stringify(hints);
    try {
      out[key] = Object.keys(await navigator.userAgentData.getHighEntropyValues(hints)).join(',');
    } catch (err) { out[key] = 'ERR ' + err.message; }
  }
  try { out.__cores = String(navigator.hardwareConcurrency); } catch (err) { out.__cores = 'ERR'; }
  postMessage(out);
};`;

const PAGE = '<!doctype html><html><body><p>uach</p></body></html>';

/**
 * The five hints an origin has to ASK for. Chrome sends none of them unbidden, so a server
 * that says nothing — the '/' route above — can never see whether the extension's rules are
 * right; it only ever sees the same silence a clean browser produces.
 *
 * '/ch' answers Accept-CH and carries a subresource, so ONE navigation produces two
 * requests: the document, which is still un-opted-in and must carry nothing, and the
 * subresource, which is the first request the opt-in can reach. '/ch-sub' repeats the
 * header so a second visit cannot be a stale opt-in. '/crit' adds Critical-CH — see the
 * comment over the print at the bottom for why that one is printed rather than asserted.
 */
const CH_HINTS = ['sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-model', 'sec-ch-ua-wow64',
  'sec-ch-ua-platform-version'];
const ACCEPT_CH = CH_HINTS.join(', ');
const CH_PAGE = '<!doctype html><html><head><link rel="stylesheet" href="/ch-sub"></head><body><p>ch</p></body></html>';
const CRIT_PAGE = '<!doctype html><html><body><p>crit</p></body></html>';
/** One row per request to the three routes: { url, hints } — NAMES only, never values. */
const wire = [];
const server = createServer((q, r) => {
  if (q.url === '/w.js') {
    r.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(WORKER);
    return;
  }
  if (q.url === '/ch' || q.url === '/ch-sub' || q.url === '/crit') {
    wire.push({ url: q.url, hints: CH_HINTS.filter((h) => q.headers[h] !== undefined).sort() });
    const head = { 'cache-control': 'no-store', 'accept-ch': ACCEPT_CH };
    if (q.url === '/crit') head['critical-ch'] = ACCEPT_CH;
    head['content-type'] = q.url === '/ch-sub' ? 'text/css' : 'text/html';
    r.writeHead(200, head).end(q.url === '/ch' ? CH_PAGE : q.url === '/crit' ? CRIT_PAGE : 'p{}');
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

async function read(clean) {
  // Where THIS browser's rows begin. Both browsers write into one log, and slicing from a
  // mark taken before the launch is what keeps the clean run's rows out of ours.
  const mark = wire.length;
  const dir = mkdtempSync(join(tmpdir(), 'afp-uach-'));
  let browser = null;
  const ctx = clean
    ? await (browser = await chromium.launch({ ...BROWSER, headless: !headed })).newContext()
    : await chromium.launchPersistentContext(dir, {
      ...BROWSER, headless: !headed,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
  try {
    if (!clean) {
      try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch { /* up */ }
      await bootSettled(ctx);
    }
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    const shape = await page.evaluate(async (cases) => {
      const win = {};
      for (const hints of cases) {
        const key = JSON.stringify(hints);
        try {
          win[key] = Object.keys(await navigator.userAgentData.getHighEntropyValues(hints)).join(',');
        } catch (e) { win[key] = 'ERR ' + e.message; }
      }
      win.__cores = String(navigator.hardwareConcurrency);
      const worker = await new Promise((resolve) => {
        try {
          const w = new Worker('/w.js');
          const t = setTimeout(() => resolve({ __err: 'timeout' }), 10000);
          w.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
          w.onerror = (e) => { clearTimeout(t); resolve({ __err: 'onerror ' + e.message }); };
          w.postMessage(cases);
        } catch (e) { resolve({ __err: String(e) }); }
      });
      return { win, worker };
    }, CASES);
    // '/ch' twice with nothing in between: the first navigation is the one that teaches the
    // browser (and this build's observer) that the origin wants the five, the second is the
    // first navigation that CAN carry them — if the per-origin rule has landed by then.
    //
    // [FIX the-second-navigation-measured-the-runner] That second visit used to be asserted,
    // on the strength of six green runs out of six on the box it was written on. The v2.5.29
    // tag build then went red on it on the Windows runner two runs out of two — rows 3 and 4
    // both missing sec-ch-ua-platform-version and nothing else — while the Linux leg of the
    // same runs, and three runs here (Windows 11, Chromium 153), were green. The four arch
    // hints need no rule on a matching host and arrived; the fifth needs the one per-origin
    // rule, and response -> observer -> loadChOptIn -> getCachedProfile -> updateDynamicRules
    // had not finished by the time a two-core runner was done with the first page and asking
    // for the second. The row was measuring the machine, exactly as row 2 does.
    //
    // So the immediate visit stays and is PRINTED — it is still the one that shows the race —
    // and a third visit is made once the rule can be read back out of the worker. That one
    // cannot race, so a red on it says the rule is wrong rather than late, and it is what is
    // asserted. The defect this block was first written against, a 300ms coalesce on a host
    // nobody had seen, is caught where timing is deterministic: test/background-fns.mjs
    // counts the updateDynamicRules calls — one immediate write for a new host, one
    // coalesced write for a known one.
    const platformVersionRule = async (host, timeout = 10000) => {
      const t0 = Date.now();
      for (;;) {
        const sw = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
          ctx.serviceWorkers()[0];
        let there = false;
        try {
          there = !!sw && await sw.evaluate(async (h) => (await chrome.declarativeNetRequest.getDynamicRules())
            .some((r) => ((r.condition && r.condition.requestDomains) || []).includes(h) &&
              ((r.action && r.action.requestHeaders) || []).some((x) =>
                x.header === 'sec-ch-ua-platform-version' && x.operation === 'set')), host);
        } catch { /* the worker was asleep or restarting; ask again */ }
        if (there) return Date.now() - t0;
        if (Date.now() - t0 > timeout) return null;
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    const wirePage = await ctx.newPage();
    await wirePage.goto(`http://127.0.0.1:${port}/ch`, { waitUntil: 'load' });
    await wirePage.goto(`http://127.0.0.1:${port}/ch`, { waitUntil: 'load' });
    const ruleWaitMs = clean ? 0 : await platformVersionRule('127.0.0.1');
    await wirePage.goto(`http://127.0.0.1:${port}/ch`, { waitUntil: 'load' });
    // A host NEITHER browser has met: localhost and 127.0.0.1 are one machine and two
    // origins, to Chrome's client-hint opt-in and to DNR's requestDomains alike.
    await wirePage.goto(`http://localhost:${port}/crit`, { waitUntil: 'load' });
    await wirePage.close();
    return { ...shape, wire: wire.slice(mark), ruleWaitMs };
  } finally {
    await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds the profile */ }
  }
}

const clean = await read(true);
const ours = await read(false);
server.close();

// The guard this suite would be worthless without: if the extension is not actually
// running, every shape below matches the clean browser trivially and the suite reports a
// green it did not earn. hardwareConcurrency is spoofed by every shipped profile, so a
// live extension MUST move it.
ok(ours.win.__cores !== clean.win.__cores,
  `the extension is actually active — cores ours ${ours.win.__cores} vs clean ${clean.win.__cores}` +
  (ours.win.__cores === clean.win.__cores ? ' (IDENTICAL: nothing was tested)' : ''));

console.log(`\ncores: clean ${clean.win.__cores} -> ours ${ours.win.__cores}\n`);
console.log('hints'.padEnd(74) + 'window   worker');

for (const hints of CASES) {
  const key = JSON.stringify(hints);
  const label = (key.length > 70 ? key.slice(0, 67) + '...' : key).padEnd(72);
  const winOk = clean.win[key] === ours.win[key];
  const workerOk = clean.worker[key] === ours.worker[key];
  console.log(`  ${label} ${winOk ? 'ok  ' : 'DIFF'}     ${workerOk ? 'ok' : 'DIFF'}`);
  if (!winOk) {
    console.log(`      window clean: ${clean.win[key]}`);
    console.log(`      window ours : ${ours.win[key]}`);
  }
  if (!workerOk) {
    console.log(`      worker clean: ${clean.worker[key]}`);
    console.log(`      worker ours : ${ours.worker[key]}`);
  }
  ok(winOk, `window getHighEntropyValues(${key}) returns the browser's key set`);
  ok(workerOk, `worker getHighEntropyValues(${key}) returns the browser's key set`);
}

// The two scopes must also agree with EACH OTHER, which is the invariant the mirrored
// copies exist for — a page reads the same probe twice and a split is what it looks for.
for (const hints of CASES) {
  const key = JSON.stringify(hints);
  ok(ours.win[key] === ours.worker[key],
    `window and worker agree on ${key} — window "${ours.win[key]}" worker "${ours.worker[key]}"`);
}

// ===== the wire half: which hint NAMES travelled =====
// [FIX the-first-request-after-accept-ch-lost-its-hints] The observer that learns an
// origin's Accept-CH coalesced every observation behind a 300ms timer, so on an origin
// nobody had visited the rules landed after the page had already finished loading. Same
// probe, same rig, one brand-new origin answering Accept-CH for the five, server
// timestamps:
//
//     clean          /ch t+0ms (none)   /ch-sub t+12ms ALL FIVE   /ch t+21ms ALL FIVE
//     ours BEFORE    /ch t+0ms (none)   /ch-sub t+28ms (none)     /ch t+92ms (none)
//     ours AFTER     /ch t+0ms (none)   /ch-sub t+18ms ALL FIVE   /ch t+89ms ALL FIVE
//
// The middle column of the last row is the one that is not a promise: see the note on
// RACED below. The third column is, and it is what turned red before this change and green
// after it, six runs out of six.
//
// [FIX the-arch-strip-hid-a-value-the-host-already-matched] is the other half of the same
// row: four of those five are left fully native on a host that already answers them the
// way the profile claims (x86 / 64 / no model / not-wow64), so on such a host they are
// present on exactly the requests a clean browser puts them on, rather than on the ones a
// per-origin rule happened to reach.
//
// NAMES, NOT VALUES. The values are supposed to differ — ours are the profile's, the clean
// browser's are this machine's — and that asymmetry IS the extension working. The expected
// set of names is read from the clean browser in the same run for the reason the header of
// this file gives: a list written down here would have to be revised every time Chrome
// changes when it sends a hint, and the wrong version looks exactly like the right one.
const chRows = (r) => r.wire.filter((w) => w.url !== '/crit');
const sig = (w) => `${w.url} [${w.hints.join(' ')}]`;
const cleanCh = chRows(clean), oursCh = chRows(ours);

console.log('\nwire — which hint NAMES arrived, clean beside ours');
for (let i = 0; i < Math.max(cleanCh.length, oursCh.length); i++) {
  const row = (w) => (w ? sig(w) : '(no such request)');
  console.log(`  ${String(i + 1).padEnd(3)} clean ${row(cleanCh[i])}`);
  console.log(`      ours  ${row(oursCh[i])}`);
}

// The guard this half would be worthless without, and the same one the cores check above
// makes: if the clean browser sent no hint on any row, then every comparison below is two
// empty logs agreeing and the suite reports a green it did not earn.
ok(cleanCh.some((w) => w.hints.length),
  `the clean browser put hints on the wire at all — ${cleanCh.map(sig).join(' | ') || '(nothing was requested)'}` +
  (cleanCh.some((w) => w.hints.length) ? '' : ' (NOTHING WAS TESTED)'));
ok(cleanCh.length === oursCh.length,
  `both browsers made the same requests — clean ${cleanCh.length}, ours ${oursCh.length}`);
// THREE ROWS ARE PRINTED AND NOT ASSERTED, and which ones were decided by counting rather
// than by taste. Row 2 is the FIRST SUBRESOURCE of the first page on an origin that announced
// Accept-CH in the response to that same page: a stylesheet in the head, which the preload
// scanner requests within a few milliseconds. Winning it means the DNR write has to land
// inside that gap, and the write costs 1.5-2.9ms warm plus an unbounded service-worker
// wake. Measured on this box, six consecutive runs of this file: 5 green, 1 red — always
// this row, always the same missing name, sec-ch-ua-platform-version, which is the one of
// the five that still needs a per-origin rule rather than the host's own answer. Measured
// again with a probe whose subresource is an <img> in the body rather than a <link> in the
// head: 6 of 6 carried all five, at t+17 to t+24ms. So the row is not a defect that
// appears one run in six — it is a real race whose outcome depends on how early the page
// asks, and asserting it would be a red one run in six that says nothing about the build.
// Same class as the Critical-CH rows below, and recorded in README "Limits", item 23.
//
// Rows 3 and 4 are the immediate second visit: the same race one page later. The "six runs
// out of six" in the note above the wire table was this box; a two-core runner lost it two
// runs out of two — see [FIX the-second-navigation-measured-the-runner] where the visits are
// made. Rows 5 and 6 are the visit made once the rule could be read back from the worker.
// Those are asserted, and so is the rule having been written at all.
const RACED = new Set([1, 2, 3]);
ok(ours.ruleWaitMs !== null,
  'the per-origin sec-ch-ua-platform-version rule for 127.0.0.1 is written — ' +
  (ours.ruleWaitMs === null ? 'still absent 10s after the second visit'
    : `present ${ours.ruleWaitMs}ms after the second visit`));
for (let i = 0; i < cleanCh.length; i++) {
  const same = oursCh[i] && sig(oursCh[i]) === sig(cleanCh[i]);
  if (RACED.has(i)) {
    console.log(`  note  row ${i + 1} is ${i === 1 ? 'the preload-scanner race' : 'the immediate second visit'}` +
      `, printed not asserted: ${same ? 'won it this run' : 'lost it this run'}`);
    continue;
  }
  ok(same,
    `request ${i + 1} carries the same hint names as the clean browser — clean "${sig(cleanCh[i])}", ` +
    `ours "${oursCh[i] ? sig(oursCh[i]) : '(no such request)'}"`);
}

// WHY THE CRITICAL-CH ROWS ARE PRINTED AND NOT ASSERTED. Critical-CH makes Chrome throw the
// response away and reissue the request with the hints attached, and it does that from the
// network stack: measured here the retry arrives 4-7ms after the first response (clean
// t+113ms then t+117ms; ours t+170ms then t+177ms). MV3 has no blocking hook to sit in
// front of it — chrome.webRequest is observation only — so the DNR write this build now
// starts immediately is simply racing those 7ms. It usually loses: four of five on three
// of four consecutive runs on this box, everything but sec-ch-ua-platform-version, which
// is the one hint that needs a per-origin rule rather than the host's own answer; on the
// fourth run the write won and all five arrived. A coin toss is the one thing an assertion
// must never be — either direction would go red on someone's machine while saying nothing
// about the build. It is README "Limits", item 23; printed so a change in it is visible instead
// of silent.
console.log('\ncritical-ch on a host neither browser had seen (printed, not asserted — README "Limits", item 23)');
for (const [label, r] of [['clean', clean], ['ours ', ours]]) {
  const rows = r.wire.filter((w) => w.url === '/crit');
  console.log(`  ${label} ${rows.length ? rows.map((w) => `[${w.hints.join(' ') || '(none)'}]`).join(' then ') : '(no request)'}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
