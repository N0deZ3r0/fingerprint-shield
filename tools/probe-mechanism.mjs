// WHAT DOES A WRAPPER SHOW THAT AN ENGINE PATCH DOES NOT?
//
//   node tools/probe-mechanism.mjs                     uses the path below
//   FPS_PATCHED=<path-to-chrome.exe> node tools/probe-mechanism.mjs
//
// Fingerprint Pro grades this extension `bot: bad` / `anti_detect_browser: true` and grades
// the patched-Chromium build clean while it claims THE SAME THINGS — et-EE, Europe/Tallinn,
// eight cores, an Iris Xe over a real Arc, a noised canvas. All four cells of the 2x2 are
// measured now:
//
//                     native values   spoofed values
//   no wrappers       clean           CLEAN   <- the patched build
//   wrappers          clean           BAD     <- this extension
//
// So the flag needs both, and what is detected is the FACT of substitution rather than any
// value. This asks the obvious next question by measurement instead of by hypothesis: with
// the same claim in both, what can a page see that differs?
//
// Three browsers, because two would not separate the claim from the mechanism:
//
//   A  stock Chromium, nothing loaded          native values, no wrappers
//   B  the patched build, same claim by switch spoofed values, NO wrappers
//   C  stock Chromium + this extension         spoofed values, wrappers
//
// B vs C is the pair. A is the control that says which rows are the claim (A differs from
// both) rather than the mechanism (A agrees with one of them).
//
// The value walk is the net. The descriptor section is the targeted half: a substituted
// value can be identical while the PROPERTY it arrives through is not — its descriptor
// shape, the getter's name and length, what it does with a foreign receiver, what its
// toString says. None of that shows up in a walk that only reads values.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, loadBackground, loadPopup, bootSettled } from '../test/harness.mjs';

const PATCHED = process.env.FPS_PATCHED ||
  'D:\\cr\\dist\\stage-153.0.8010.40-fps65\\chrome.exe';
if (!existsSync(PATCHED)) {
  console.error(`no patched build at ${PATCHED} — pass FPS_PATCHED=<path>`);
  process.exit(2);
}

const { COUNTRY_DATA } = loadBackground(['COUNTRY_DATA']);
const { PROFILES } = loadPopup(['PROFILES']);
const SEL = { id: 'laptop_mid', cc: 'EE' };
const C = COUNTRY_DATA[SEL.cc];

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end('<!doctype html>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// The properties this extension substitutes and the patched build substitutes too, so the
// only thing left to differ is HOW.
const READ = `(function () {
  var out = {};
  function put(k, fn) {
    try { var v = fn(); out[k] = (v === undefined) ? 'undefined' : String(v); }
    catch (e) { out[k] = 'THREW:' + (e && e.name) + ':' + String(e && e.message).slice(0, 60); }
  }

  var targets = [
    ['Navigator.prototype', typeof Navigator !== 'undefined' && Navigator.prototype, navigator,
      ['language', 'languages', 'hardwareConcurrency', 'deviceMemory', 'platform', 'userAgent', 'vendor']],
    ['Screen.prototype', typeof Screen !== 'undefined' && Screen.prototype, screen,
      ['width', 'height', 'availWidth', 'availHeight', 'colorDepth']]
  ];

  targets.forEach(function (t) {
    var label = t[0], proto = t[1], inst = t[2], names = t[3];
    if (!proto) return;
    names.forEach(function (n) {
      var p = label + '.' + n;
      var d;
      try { d = Object.getOwnPropertyDescriptor(proto, n); } catch (e) { out[p + ' desc'] = 'THREW'; return; }
      if (!d) { out[p + ' desc'] = 'absent'; return; }
      // The shape of the property itself.
      put(p + ' desc', function () {
        return 'get=' + (typeof d.get) + ' set=' + (typeof d.set) +
          ' enum=' + d.enumerable + ' conf=' + d.configurable + ' hasValue=' + ('value' in d);
      });
      if (typeof d.get !== 'function') return;
      put(p + ' getter.name', function () { return d.get.name; });
      put(p + ' getter.length', function () { return d.get.length; });
      put(p + ' getter.toString', function () { return String(d.get); });
      put(p + ' getter.ownKeys', function () { return Object.getOwnPropertyNames(d.get).sort().join(','); });
      put(p + ' getter.proto', function () { return Object.getPrototypeOf(d.get) === Function.prototype ? 'Function.prototype' : 'other'; });
      // The receiver oracle: what the platform does when asked through the wrong object.
      put(p + ' on prototype', function () { return d.get.call(proto); });
      put(p + ' on {}', function () { return d.get.call({}); });
      put(p + ' on null', function () { return d.get.call(null); });
      put(p + ' on instance', function () { return d.get.call(inst); });
      // And whether the value can be shadowed the way a native one can.
      put(p + ' redefinable', function () {
        var probe = Object.create(proto);
        Object.defineProperty(probe, n, { value: 'x', configurable: true });
        return probe[n];
      });
    });
  });

  // Whole-object shape, where an extra own property or a changed order would show.
  put('navigator ownKeys', function () { return Object.getOwnPropertyNames(navigator).join(','); });
  put('Navigator.prototype ownKeys length', function () { return Object.getOwnPropertyNames(Navigator.prototype).length; });
  put('screen ownKeys', function () { return Object.getOwnPropertyNames(screen).join(','); });
  put('Function.prototype.toString.toString', function () { return String(Function.prototype.toString); });
  put('Object.getOwnPropertyDescriptor.toString', function () { return String(Object.getOwnPropertyDescriptor); });

  // Canvas: the same question one layer down.
  put('toDataURL.toString', function () { return String(HTMLCanvasElement.prototype.toDataURL); });
  put('getImageData.toString', function () { return String(CanvasRenderingContext2D.prototype.getImageData); });
  put('getImageData.name', function () { return CanvasRenderingContext2D.prototype.getImageData.name; });
  put('getImageData.length', function () { return CanvasRenderingContext2D.prototype.getImageData.length; });
  put('getImageData on {}', function () { return CanvasRenderingContext2D.prototype.getImageData.call({}, 0, 0, 1, 1); });

  // The values themselves, so the report can say which rows are the CLAIM and which are not.
  put('value navigator.language', function () { return navigator.language; });
  put('value navigator.hardwareConcurrency', function () { return navigator.hardwareConcurrency; });
  put('value navigator.deviceMemory', function () { return navigator.deviceMemory; });
  put('value screen.width', function () { return screen.width; });
  put('value Intl locale', function () { return new Intl.DateTimeFormat().resolvedOptions().locale; });
  put('value Intl timeZone', function () { return new Intl.DateTimeFormat().resolvedOptions().timeZone; });
  put('value webgl renderer', function () {
    var c = document.createElement('canvas'), g = c.getContext('webgl');
    var e = g.getExtension('WEBGL_debug_renderer_info');
    return g.getParameter(e.UNMASKED_RENDERER_WEBGL);
  });
  return out;
})()`;

async function read(label, opts, withExt) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-mech-'));
  const ctx = await chromium.launchPersistentContext(dir, opts);
  try {
    if (withExt) {
      const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await bootSettled(sw);
      const p = PROFILES.find((x) => x.id === SEL.id);
      await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
        afp_profile_id: p.id,
        afp_profile_data: { screenW: p.screenW, screenH: p.screenH, cores: p.cores,
          memory: p.memory, gpu: p.gpuKey, platform: p.platform },
        afp_country_code: SEL.cc, afp_resolved_timezone: C.tz,
        afp_resolved_locale: C.loc, afp_mode: 'normal'
      });
      await new Promise((r) => setTimeout(r, 1500));
    }
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    if (withExt) await page.reload({ waitUntil: 'load' });
    const v = await page.evaluate(READ);
    console.log(`  ${label}: ${Object.keys(v).length} readings`);
    return v;
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
  }
}

console.log('reading three browsers');
const A = await read('A  stock, clean          ', { ...BROWSER, headless: true, args: [] }, false);
const B = await read('B  patched, same claim   ', {
  executablePath: PATCHED, headless: true,
  ignoreDefaultArgs: ['--disable-field-trial-config'],
  args: [`--fps-profile=${SEL.id}`, `--fps-lang=${C.loc}`, `--fps-timezone=${C.tz}`]
}, false);
const Cc = await read('C  stock + this extension', {
  ...BROWSER, headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
}, true);
server.close();

const keys = [...new Set([...Object.keys(A), ...Object.keys(B), ...Object.keys(Cc)])].sort();
// 46 characters hid the only part of the user agent that differs — the version — and reported
// three identical-looking lines as a difference with nothing to see. Long enough for a UA now.
const cut = (v) => String(v).replace(/\s+/g, ' ').slice(0, 120);

// A row where B EQUALS A is not the patched build doing the same thing differently, it is the
// patched build not doing it at all: --fps-profile carries no memory claim, so deviceMemory
// came back as the host's 16 on both and was filed under "mechanism" beside real findings.
// Same for the browser version, which no switch controls. Split those out and say which.
const claim = [], mechanism = [], notClaimed = [], same = [];
for (const k of keys) {
  const a = A[k], b = B[k], c = Cc[k];
  if (b === c) { (a === b ? same : claim).push(k); continue; }
  (a === b ? notClaimed : mechanism).push(k);
}

console.log(`\n${keys.length} readings`);
console.log(`  same in all three            ${String(same.length).padStart(4)}`);
console.log(`  B and C agree, A differs     ${String(claim.length).padStart(4)}   the CLAIM — both substitute it, the same way`);
console.log(`  only C substitutes it        ${String(notClaimed.length).padStart(4)}   B equals A — the patched build never claimed this`);
console.log(`  B and C DIFFER               ${String(mechanism.length).padStart(4)}   the MECHANISM — this is the list`);

const show = (title, list) => {
  if (!list.length) return;
  console.log(`\n${title}`);
  for (const k of list) {
    console.log(`  ${k}`);
    console.log(`      A stock    ${cut(A[k])}`);
    console.log(`      B patched  ${cut(B[k])}`);
    console.log(`      C ours     ${cut(Cc[k])}`);
  }
};
show('WHERE THE PATCHED BUILD AND THIS EXTENSION DIFFER\n(A = a browser that substitutes nothing, for reference)', mechanism);
show('WHERE ONLY THIS EXTENSION SUBSTITUTES\n(a different claim, not a different mechanism — read before counting these)', notClaimed);

console.log(mechanism.length
  ? '\nEvery row in the first list is something a page can read that tells a wrapper from an\nengine patch. Discount any that is just the browser version — the builds differ by a major.'
  : '\nNothing here separates them — the channel is not in this surface.\nWhat does: tools/probe-timing.mjs. Same three browsers, cost instead of shape.');
