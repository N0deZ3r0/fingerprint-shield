/**
 * Do error stacks name this extension? Measured against the REAL extension.
 *
 *   node test/stackleak.mjs             headless
 *   node test/stackleak.mjs --headed    watch it
 *
 * Fixes exist purely to keep chrome-extension://<id>/... out of stacks a page can read —
 * [FIX extension-id-leaked-through-error-stacks] (mw-core's _stripOwnFrames, always on),
 * the Worker constructor proxy's _stripFrames, and the geolocation callbacks that are now
 * scheduled directly. They had no regression test, and the dev-page suite structurally
 * cannot provide one: every cleaner keys on the literal 'chrome-extension://', and a page
 * served over http has no such frame, so all of them are inert there. dev-stealthstack.html
 * measured exactly that and produced a rig artefact — identical numbers in both modes —
 * which is why this exists.
 *
 * [FIX the-global-stack-filter-was-dead-code] There used to be a THIRD cleaner, a global
 * Error.prototype.stack filter in mw/mw-misc.js gated on !_STEALTH. It never ran: in V8
 * `stack` is an own accessor on each error INSTANCE, so the descriptor it guarded on
 * (Error.prototype's) is undefined and the install was skipped every time. It is gone, and
 * the two leaks that had been hiding behind it — both found by widening the probe list
 * below, both naming the extension by ID and file — are fixed where they are produced. The
 * descriptor facts are asserted here so nobody rebuilds that block on the old assumption.
 *
 * Here the modules really are chrome-extension:// URLs, so the cleaners are live and the
 * question is answerable.
 *
 * TIMING, and it is the whole experiment: _STEALTH is decided as mw-core loads, from
 * sessionStorage['v.ui.m'], which is EMPTY on a tab's first load — so a fresh tab always
 * runs as 'normal' however storage is set. The page is therefore loaded, then RELOADED,
 * and only the second load is measured. Skipping that reads 'normal' twice and reports
 * stealth as fixed when it has not been tested at all.
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

/** Runs in the page's MAIN world, where the extension's patches live. */
async function probeStacks() {
  const PROBES = {
    'Screen.width getter, null this': () =>
      Object.getOwnPropertyDescriptor(Screen.prototype, 'width').get.call(null),
    'Navigator.userAgent getter, null this': () =>
      Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent').get.call(null),
    'Date.getTimezoneOffset, null this': () =>
      Date.prototype.getTimezoneOffset.call(null),
    'new Intl.DateTimeFormat("!!!")': () => { new Intl.DateTimeFormat('!!!'); },
    'Intl.DateTimeFormat.resolvedOptions, plain this': () =>
      Intl.DateTimeFormat.prototype.resolvedOptions.call({}),
    'matchMedia matches getter, plain this': () =>
      Object.getOwnPropertyDescriptor(MediaQueryList.prototype, 'matches').get.call({}),
    'getParameter brand check': () =>
      WebGLRenderingContext.prototype.getParameter.call({}, 0x1F00),
    'Function.prototype.toString on a patched getter': () => {
      const g = Object.getOwnPropertyDescriptor(Screen.prototype, 'width').get;
      Function.prototype.toString.call(Object.create(g));
    },
    // [FIX worker-ctor-errors-named-the-extension] The Worker constructor proxy is built by
    // hand rather than by _mn, so nothing stripped the stack of a failed construction and
    // `at _wrapWorkerUrl (chrome-extension://<id>/mw-bundle.js:…)` reached the page. Every
    // probe above goes through an _mn wrapper, which is why nine of them found nothing and
    // this found something the first time it was asked.
    'new Worker with an unreachable URL': () => { new Worker('http://example.invalid/x.js'); },
    'new SharedWorker with an unreachable URL': () => {
      if (typeof SharedWorker === 'undefined') throw new Error('no SharedWorker');
      new SharedWorker('http://example.invalid/x.js');
    }
  };
  const out = { mode: null, spoofed: null, results: {}, errShape: null };
  try { out.mode = sessionStorage.getItem('v.ui.m'); } catch (e) {}
  // [FIX the-global-stack-filter-was-dead-code] The premise the removed filter rested on.
  // Compared against a clean browser below rather than asserted as a constant, so this
  // tracks V8 rather than a belief about it — if a future V8 moves `stack` onto the
  // prototype, the clean run moves with it and the comparison still holds.
  try {
    const pd = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
    const e = new Error('shape');
    const od = Object.getOwnPropertyDescriptor(e, 'stack');
    out.errShape = {
      protoDescriptor: pd ? { get: typeof pd.get, set: typeof pd.set } : null,
      ownNames: Object.getOwnPropertyNames(e).sort().join(','),
      ownIsAccessor: !!(od && typeof od.get === 'function'),
      assignable: (function () { try { const x = new Error('a'); x.stack = 'CUSTOM'; return x.stack === 'CUSTOM'; } catch (err) { return 'THREW'; } })(),
      prepareStackTrace: typeof Error.prepareStackTrace,
      captureStackTrace: typeof Error.captureStackTrace
    };
  } catch (e) { out.errShape = { error: String(e && e.message) }; }
  // Proof the extension is actually patching this realm, so a clean run cannot be mistaken
  // for "no leaks" when it really means "no extension".
  try { out.spoofed = navigator.hardwareConcurrency; } catch (e) {}

  for (const [name, fn] of Object.entries(PROBES)) {
    let stack = null, threw = false;
    try { fn(); } catch (e) { threw = true; try { stack = String((e && e.stack) || ''); } catch (e2) {} }
    const frames = String(stack || '').split('\n')
      .filter((l) => l.indexOf('chrome-extension://') !== -1);
    out.results[name] = { threw, leaked: frames.length, first: frames[0] ? frames[0].trim().slice(0, 100) : null };
  }
  // [FIX stack-strip-only-covered-the-synchronous-throw] The class the loop above cannot
  // reach either, and the one that actually shipped: a promise-returning wrapper does not
  // THROW, so `catch` never sees it — the error arrives later, on the rejection, with the
  // stack V8 captured while our frames were on it. Everything above goes through _mn's
  // apply trap, which stripped only the synchronous path, so ten probes reported zero
  // leaks while one line of ordinary page script read the extension's ID:
  //
  //   navigator.userAgentData.getHighEntropyValues('not-an-array').catch(e => e.stack)
  //     -> at NavigatorUAData.getHighEntropyValues (chrome-extension://<id>/mw-bundle.js:…)
  //        at Object.apply (chrome-extension://<id>/mw-bundle.js:…)
  //
  // Measured on a real Chrome 152 with the extension loaded by hand, which is the only
  // place it could be measured. The serviceWorker probe further down is a rejected promise
  // too, but it is an error the extension CONSTRUCTS; these are native rejections passing
  // THROUGH, which is a different path and was the unguarded one.
  //
  // Every entry must reject for a reason the platform owns, so a clean browser rejects
  // identically and the comparison at the bottom of this file has something to compare.
  const ASYNC_PROBES = {
    'getHighEntropyValues, non-sequence argument': () =>
      navigator.userAgentData.getHighEntropyValues('not-an-array'),
    'getHighEntropyValues off the prototype, non-sequence': () =>
      NavigatorUAData.prototype.getHighEntropyValues.call(navigator.userAgentData, 42),
    'getHighEntropyValues brand check': () =>
      NavigatorUAData.prototype.getHighEntropyValues.call({}, []),
    'enumerateDevices brand check': () =>
      MediaDevices.prototype.enumerateDevices.call({}),
    'getBattery brand check': () =>
      Navigator.prototype.getBattery.call({}),
    'permissions.query, bogus name': () =>
      navigator.permissions.query({ name: 'totally-bogus' })
  };
  for (const [name, fn] of Object.entries(ASYNC_PROBES)) {
    let stack = null, threw = false, sync = false, pending = null;
    // Whether the failure arrives SYNCHRONOUSLY is itself a result. These are all
    // promise-returning operations, so the platform rejects and never throws; a wrapper
    // that throws instead has changed the shape of the failure, which a page sees without
    // reading a single stack frame.
    try { pending = fn(); } catch (e) {
      sync = true; threw = true;
      try { stack = String((e && e.stack) || ''); } catch (e2) {}
    }
    if (!sync) {
      try { await pending; } catch (e) {
        threw = true;
        try { stack = String((e && e.stack) || ''); } catch (e2) {}
      }
    }
    const frames = String(stack || '').split(String.fromCharCode(10))
      .filter((l) => l.indexOf('chrome-extension://') !== -1);
    out.results[name] = { threw, sync, leaked: frames.length,
      first: frames[0] ? frames[0].trim().slice(0, 100) : null };
  }

  // [FIX page-callbacks-ran-with-our-frame-on-the-stack] The class the synchronous probes
  // above cannot reach: not an error thrown THROUGH us, but one the PAGE builds inside a
  // callback WE invoke. Every frame above the callback is on that stack, so while
  // getCurrentPosition called `success` from a closure of ours, an ordinary site that
  // constructs an Error in its geolocation handler read
  // `at chrome-extension://<id>/mw-bundle.js:…` out of it. Sites do that routinely, so this
  // leaked on normal code rather than on a probe.
  //
  // Both entry points are measured. The permission is granted by the harness, so the
  // success path is the one exercised — which is the path that used to carry the frame.
  for (const [name, call] of [
    ['Error built inside a getCurrentPosition callback',
      (cb, err) => navigator.geolocation.getCurrentPosition(cb, err, { timeout: 3000 })],
    ['Error built inside a watchPosition callback',
      (cb, err) => navigator.geolocation.watchPosition(cb, err, { timeout: 3000 })]
  ]) {
    let frames = [], threw = false;
    try {
      await new Promise((resolve) => {
        let done = false;
        const finish = (e) => {
          if (done) return; done = true;
          threw = true;
          frames = String((e && e.stack) || '').split('\n')
            .filter((l) => l.indexOf('chrome-extension://') !== -1);
          resolve();
        };
        // The page's own callback builds the Error, exactly as a real site would.
        call(() => finish(new Error('from success callback')),
             () => finish(new Error('from error callback')));
        setTimeout(() => { if (!done) { done = true; resolve(); } }, 4000);
      });
    } catch (e) { /* nothing to record */ }
    out.results[name] = { threw, leaked: frames.length, first: frames[0] ? frames[0].trim().slice(0, 100) : null };
  }

  // [FIX the-service-worker-blob-path-could-never-work] The one leak the synchronous
  // probes above structurally cannot see: it arrives as a REJECTED PROMISE, from a
  // TypeError this extension constructs itself when it denies a service worker to a
  // fingerprinting script. Measured on abrahamjuliot.github.io before the fix — the page
  // read chrome-extension://<id>/mw-bundle.js straight out of e.stack.
  //
  // Both halves matter, so both are probed: the denial must not name us, and a NORMAL
  // site's service worker must still register — the wrapper used to try a blob copy that
  // Chrome rejects 100% of the time (blob: is not a supported SW script protocol), so
  // "it still works" is not something to assume here.
  try {
    await navigator.serviceWorker.register('/creepjs-sw.js');
    out.results['serviceWorker.register, fingerprinter script'] = { threw: false, leaked: 0, first: 'registered (expected a denial)' };
  } catch (e) {
    const frames = String((e && e.stack) || '').split(String.fromCharCode(10)).filter((l) => l.indexOf('chrome-extension://') !== -1);
    out.results['serviceWorker.register, fingerprinter script'] =
      { threw: true, leaked: frames.length, first: frames[0] ? frames[0].trim().slice(0, 100) : null,
        msg: String(e && e.message), errName: e && e.name, isDom: e instanceof DOMException,
        code: e && e.code, hasStack: 'stack' in Object(e) };
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    out.normalSwRegistered = !!reg;
    try { await reg.unregister(); } catch (eU) {}
  } catch (e) {
    out.normalSwRegistered = false;
    out.normalSwError = String(e && e.message);
  }
  return out;
}

const SW_JS = 'self.addEventListener("install", function () {});';
const server = createServer((q, r) => {
  const u = (q.url || '/').split('?')[0];
  // Real JS for both service-worker paths: served as text/html Chrome would refuse them
  // for its own reasons and the probe would measure the MIME type, not the wrapper.
  if (u === '/sw.js' || u === '/creepjs-sw.js') {
    r.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(SW_JS);
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
   .end('<!doctype html><title>stack</title><body>ok');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// The same probes with NO extension. Without it "0 leaks" cannot be told apart from "the
// probe throws nothing here", and the Error-shape rows have nothing to be compared against
// — which is precisely how a filter guarding on a descriptor that does not exist survived.
const cleanDir = mkdtempSync(join(tmpdir(), 'afp-stack-clean-'));
const cleanCtx = await chromium.launchPersistentContext(cleanDir, {
  ...BROWSER, headless: !headed
});
let CLEAN;
try {
  await cleanCtx.grantPermissions(['geolocation'], { origin: `http://127.0.0.1:${port}` });
  const p = await cleanCtx.newPage();
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await p.reload({ waitUntil: 'domcontentloaded' });
  CLEAN = await p.evaluate(probeStacks);
} finally {
  await cleanCtx.close();
  try { rmSync(cleanDir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
}

const userDataDir = mkdtempSync(join(tmpdir(), 'afp-stack-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...BROWSER,
  headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

const report = {};
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(sw);   // onInstalled → initDefaults
  await ctx.grantPermissions(['geolocation'], { origin: `http://127.0.0.1:${port}` });

  for (const mode of ['normal', 'stealth']) {
    await sw.evaluate(async (m) => { await chrome.storage.local.set({ afp_mode: m }); }, mode);
    await new Promise((r) => setTimeout(r, 800));  // storage.onChanged → registerBootScript

    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    // The second load is the measured one — see the TIMING note in the header.
    await page.reload({ waitUntil: 'domcontentloaded' });
    report[mode] = await page.evaluate(probeStacks);
    await page.close();
  }
} finally {
  await ctx.close();
  server.close();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
}

for (const [label, r] of [['clean', CLEAN], ['normal', report.normal], ['stealth', report.stealth]]) {
  console.log(`\n=== ${label} === (v.ui.m=${r.mode} hardwareConcurrency=${r.spoofed})`);
  for (const [name, v] of Object.entries(r.results)) {
    console.log(`  ${v.leaked ? 'LEAK' : (v.threw ? 'ok  ' : '--  ')} ${name.padEnd(52)}` +
      (v.first || (v.threw ? 'no extension frame' : 'did not throw')));
  }
}
console.log('\n  Error.stack shape   clean: ' + JSON.stringify(CLEAN.errShape));
console.log('                      ours : ' + JSON.stringify(report.normal.errShape));

// [FIX the-global-stack-filter-was-dead-code] The premise the removed filter rested on, and
// the reason it could never have worked. Asserted against the clean browser so this tracks
// the engine instead of a belief about it.
ok(CLEAN.errShape.protoDescriptor === null,
  'V8 puts no `stack` on Error.prototype — the descriptor the old filter guarded on is undefined');
ok(CLEAN.errShape.ownIsAccessor === true && /(^|,)stack(,|$)/.test(CLEAN.errShape.ownNames),
  `\`stack\` is an own accessor on each instance (own props: ${CLEAN.errShape.ownNames})`);
for (const mode of ['normal', 'stealth']) {
  const a = report[mode].errShape, b = CLEAN.errShape;
  ok(JSON.stringify(a) === JSON.stringify(b),
    `${mode}: the Error stack surface is byte-identical to a clean browser — ` +
    `no accessor of ours on Error.prototype, assignment still works, ` +
    `prepareStackTrace still ${b.prepareStackTrace} (ours ${JSON.stringify(a)})`);
}

// The rig has to be real, or every "no leak" below is meaningless.
ok(report.normal.spoofed === 8 || report.stealth.spoofed === 8,
  `the extension is patching the page (hardwareConcurrency ${report.normal.spoofed})`);
// And stealth has to have actually been stealth on the measured load.
ok(report.stealth.mode === 'stealth',
  `the measured stealth load really ran as stealth (v.ui.m=${report.stealth.mode})`);

for (const mode of ['normal', 'stealth']) {
  ok(report[mode].normalSwRegistered === true,
    `${mode}: a normal site's service worker still registers (${report[mode].normalSwError || 'ok'})`);
  const swRes = report[mode].results['serviceWorker.register, fingerprinter script'] || {};
  const swMsg = swRes.msg || '';
  // Shape, not just text. Measured on this rig with site data blocked: a real refusal is a
  // DOMException named NotSupportedError, code 9, with NO stack property — and an error with
  // no stack is one that cannot name the extension no matter what happens upstream.
  ok(swRes.errName === 'NotSupportedError' && swRes.isDom === true && swRes.code === 9,
    `${mode}: the denial is a DOMException/NotSupportedError like the browser's own ` +
    `(${swRes.errName}, code ${swRes.code}, DOMException=${swRes.isDom})`);
  ok(swRes.hasStack === false,
    `${mode}: the denial carries no stack, as the native one does not (hasStack=${swRes.hasStack})`);
  ok(/The user denied permission to use Service Worker\.$/.test(swMsg),
    `${mode}: and the reason is the whole-origin one, not a claim one fetch refutes`);
  ok(/^Failed to register a ServiceWorker for scope \('.+'\) with script \('.+'\): /.test(swMsg),
    `${mode}: the denial is shaped like Chrome's own message — ${swMsg.slice(0, 60)}`);
  const leaking = Object.entries(report[mode].results).filter(([, v]) => v.leaked);
  ok(leaking.length === 0,
    `${mode}: no error stack names chrome-extension://` +
    (leaking.length ? ` — ${leaking.map(([n, v]) => n + ' [' + v.first + ']').join('; ')}` : ''));

  // A probe that never threw proves nothing, and both of the leaks found here came from
  // probes nobody had written. Pin that each new one actually produced an error to inspect,
  // in the same shape the clean browser produces — otherwise "no leak" can silently become
  // "no measurement", which is the failure mode dev-stealthstack.html already fell into.
  for (const name of ['new Worker with an unreachable URL',
    'Error built inside a getCurrentPosition callback']) {
    const mine = report[mode].results[name] || {};
    const clean = CLEAN.results[name] || {};
    ok(mine.threw === true,
      `${mode}: "${name}" produced an error to inspect (clean also threw: ${clean.threw})`);
  }

  // [FIX stack-strip-only-covered-the-synchronous-throw] Same rule for the rejected-promise
  // probes, and one assertion more. A rejection that never happened is not evidence, and
  // the SHAPE of the failure is checked against the clean browser rather than written down:
  // these are promise-returning operations, so the platform rejects and never throws, and a
  // wrapper that threw instead would be visible without reading a stack at all.
  for (const name of ['getHighEntropyValues, non-sequence argument',
    'getHighEntropyValues off the prototype, non-sequence',
    'getHighEntropyValues brand check',
    'enumerateDevices brand check',
    'getBattery brand check',
    'permissions.query, bogus name']) {
    const mine = report[mode].results[name] || {};
    const clean = CLEAN.results[name] || {};
    ok(clean.threw === true,
      `"${name}" fails in a CLEAN browser too, so it is a real comparison`);
    ok(mine.threw === true,
      `${mode}: "${name}" still fails with the extension (clean: ${clean.threw})`);
    ok(mine.sync === clean.sync,
      `${mode}: "${name}" fails the same WAY as clean — ` +
      `rejection, not a synchronous throw (ours sync=${mine.sync}, clean sync=${clean.sync})`);
  }
}

// Geolocation is patched only outside stealth, so the callback probe is only a real test of
// the fix in normal mode. Saying so here keeps the stealth row from reading as coverage it
// is not — the same trap the header describes for http-served pages.
ok(CLEAN.results['Error built inside a getCurrentPosition callback'].threw === true,
  'the geolocation callback probe fires in a clean browser too, so it is a real comparison');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
