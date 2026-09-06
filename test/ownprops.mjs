/**
 * OWN PROPERTIES, AGAINST A CLEAN BROWSER.
 *
 *   node test/ownprops.mjs             headless
 *   node test/ownprops.mjs --headed    watch it
 *
 * A patched object grows own properties the real object does not have, and enumerating them
 * costs a detector one line. CreepJS does exactly this for navigator and screen, which is
 * why `_def()` re-targets navigator/screen onto their prototypes and why the userAgentData
 * getter was moved off the instance.
 *
 * WHY THIS EXISTS BESIDE dev-ownprops.html. That page asks the same question and cannot
 * answer it. It diffs the top window against a same-origin IFRAME, and the extension's
 * content scripts declare all_frames + match_about_blank, so with the extension loaded the
 * "clean" side is patched too — while under test/run.mjs, which launches Chromium with NO
 * extension, BOTH sides are stock and every comparison is trivially equal. Either way it
 * reports 0 and cannot fail. It is the shape memory calls "a skip path printing FAILURES: 0
 * reads as a pass", and it is why the two findings below shipped:
 *
 *   navigator.connection      own ["effectiveType"]                clean []
 *   document.documentElement  own ["clientWidth","clientHeight"]   clean []
 *
 * Both were VALUES that looked right on an object whose SHAPE was impossible. The only
 * instrument that sees this is a second BROWSER, so that is what this launches.
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

const PAGE = '<!doctype html><html><body><p>own</p></body></html>';
const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/**
 * Read in the page. Objects are named by PATH and resolved there rather than passed in, so
 * one list serves both browsers and a missing interface degrades to a skip instead of a
 * throw. The prototypes are included beside their instances: moving a lie from an instance
 * to its prototype is the usual repair, and it is only a repair if the prototype's own set
 * did not change either.
 */
const PATHS = [
  'navigator', 'Navigator.prototype',
  'screen', 'Screen.prototype',
  'navigator.connection', 'NetworkInformation.prototype',
  'navigator.userAgentData', 'NavigatorUAData.prototype',
  'navigator.geolocation', 'Geolocation.prototype',
  'navigator.mediaDevices', 'MediaDevices.prototype',
  'navigator.serviceWorker', 'ServiceWorkerContainer.prototype',
  'navigator.gpu', 'GPU.prototype',
  'navigator.plugins', 'navigator.mimeTypes',
  'speechSynthesis', 'SpeechSynthesis.prototype',
  'document.fonts', 'FontFaceSet.prototype',
  'performance', 'Performance.prototype',
  // The DOM side. documentElement is the one that was wrong, and body plus a detached
  // element are here so that "no element has own properties" is checked as the rule it is
  // rather than as a fact about one node.
  'document.documentElement', 'document.body',
  'Element.prototype', 'Node.prototype', 'HTMLElement.prototype',
  'Date.prototype', 'Error.prototype', 'TextMetrics.prototype',
  'CanvasRenderingContext2D.prototype', 'HTMLCanvasElement.prototype',
  'MediaQueryList.prototype', 'PermissionStatus.prototype',
  'RTCPeerConnection.prototype', 'BatteryManager.prototype',
  'Intl.DateTimeFormat.prototype',
  // The fourth instance of the class this file exists for, found by the 2026-09-03 audit:
  // width/height were defined on the visualViewport INSTANCE (clean: no own properties,
  // both accessors on VisualViewport.prototype). Nothing here looked at the object.
  'visualViewport', 'VisualViewport.prototype'
];

const READ = (paths) => {
  const out = {};
  const resolve = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), window);
  for (const path of paths) {
    let v;
    try { v = resolve(path); } catch (e) { out[path] = 'ERR'; continue; }
    if (v === undefined || v === null) { out[path] = '(absent)'; continue; }
    try { out[path] = Object.getOwnPropertyNames(v).sort().join(','); } catch (e) { out[path] = 'ERR'; }
  }
  // A freshly created element, which no patch has any reason to have touched.
  try { out['(new div)'] = Object.getOwnPropertyNames(document.createElement('div')).sort().join(','); }
  catch (e) { out['(new div)'] = 'ERR'; }
  out.__cores = String(navigator.hardwareConcurrency);
  return out;
};

async function read(clean) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-own-'));
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
    return await page.evaluate(READ, PATHS);
  } finally {
    await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds it */ }
  }
}

const clean = await read(true);
const ours = await read(false);
server.close();

// Without this the whole file is a list of things that trivially match, which is exactly
// the failure dev-ownprops.html has.
ok(ours.__cores !== clean.__cores,
  `the extension is actually active — cores ours ${ours.__cores} vs clean ${clean.__cores}` +
  (ours.__cores === clean.__cores ? ' (IDENTICAL: nothing was tested)' : ''));

// window itself is excluded from the strict comparison: every page adds its own globals and
// the two realms here are not the same page twice. mw-core's non-enumerable __p0 / __t0 are
// documented exemptions in dev-ownprops.html and are invisible to Object.keys.
let diffs = 0;
for (const path of [...PATHS, '(new div)']) {
  if (clean[path] === undefined) continue;
  const same = clean[path] === ours[path];
  if (!same) {
    diffs++;
    console.error(`  ${path}`);
    console.error(`     clean: ${clean[path] || '(none)'}`);
    console.error(`     ours : ${ours[path] || '(none)'}`);
  }
  ok(same, `${path}: own property set matches a clean browser`);
}

console.log(`\n${PATHS.length + 1} objects compared, ${diffs} differ`);
console.log(`cores: clean ${clean.__cores} -> ours ${ours.__cores}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
