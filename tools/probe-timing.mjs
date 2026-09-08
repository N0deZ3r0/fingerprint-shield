// WHAT DOES A WRAPPER COST THAT AN ENGINE PATCH DOES NOT?
//
//   node tools/probe-timing.mjs
//   FPS_PATCHED=<path-to-chrome.exe> node tools/probe-timing.mjs
//
// tools/probe-mechanism.mjs read 149 SHAPES across the same three browsers and found 132
// identical, the rest claim or build version. Descriptor shape, getter name and length and
// toString, foreign-receiver behaviour, own-key sets, redefinability — the patched build and
// this extension are indistinguishable there. So the channel is not what the property LOOKS
// like. The one axis that walk cannot see is what the property COSTS.
//
// The reason to expect anything here: a native getter is a few machine instructions behind an
// inline cache. Ours is a JS closure the page's own JIT must call, and the inline cache at the
// call site cannot fold it. tools/probe-cost.mjs already measured 2-3x on simple properties and
// 24x on Date.prototype.getHours against this same browser. What was never measured is whether
// the patched build — which substitutes the same values and is graded clean — pays that too.
//
//   A  stock Chromium, clean                native values, no wrappers
//   B  the patched build, same claim        spoofed values, NO wrappers
//   C  stock Chromium + this extension      spoofed values, wrappers
//
// B is a different binary on a different major, so absolute nanoseconds do not compare across
// browsers. Every reading is therefore also expressed in UNITS: the cost of reading a plain
// JavaScript object property in that same page, measured in the same loop by the same timer.
// That unit is pure V8 with no platform object in it, so it divides out the build, the CPU and
// whatever else the machine was doing. A page can compute exactly this ratio, which is the
// point — it is not a diagnostic convenience, it is the thing a detector would read.
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
const CC = COUNTRY_DATA[SEL.cc];

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end('<!doctype html>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// [label, expression, kind] where kind says whether THIS extension wraps the property. The
// controls are not padding: without a native platform property read in the same page there is
// no way to tell a slow wrapper from a slow browser.
const TARGETS = [
  ['UNIT   plain object property', 'OBJ.x', 'unit'],
  ['       Math.sqrt', 'Math.sqrt(i)', 'ctl'],
  ['PLAT   navigator.onLine', 'navigator.onLine?1:0', 'plat'],
  ['ctl    navigator.cookieEnabled', 'navigator.cookieEnabled?1:0', 'ctl'],
  ['ctl    location.protocol', 'location.protocol.length', 'ctl'],
  ['ctl    document.hidden', 'document.hidden?1:0', 'ctl'],
  ['nav    navigator.language', 'navigator.language.length', 'ours'],
  ['nav    navigator.languages', 'navigator.languages.length', 'ours'],
  ['nav    navigator.userAgent', 'navigator.userAgent.length', 'ours'],
  ['nav    navigator.platform', 'navigator.platform.length', 'ours'],
  ['nav    navigator.vendor', 'navigator.vendor.length', 'ours'],
  ['nav    navigator.hardwareConcurrency', 'navigator.hardwareConcurrency', 'ours'],
  ['nav    navigator.deviceMemory', 'navigator.deviceMemory', 'ours'],
  ['nav    navigator.maxTouchPoints', 'navigator.maxTouchPoints', 'ours'],
  ['screen screen.width', 'screen.width', 'ours'],
  ['screen screen.availHeight', 'screen.availHeight', 'ours'],
  ['screen screen.colorDepth', 'screen.colorDepth', 'ours'],
  ['screen devicePixelRatio', 'devicePixelRatio', 'ours'],
  ['date   Date.prototype.getHours', 'D.getHours()', 'ours'],
  ['date   getHours, unhoistable', 'DD[i&3].getHours()', 'ours'],
  ['date   Date.prototype.getTimezoneOffset', 'D.getTimezoneOffset()', 'ours'],
  ['date   getTimezoneOffset, unhoistable', 'DD[i&3].getTimezoneOffset()', 'ours'],
  ['date   Date.now', 'Date.now()&1', 'ours'],
  ['intl   DateTimeFormat resolvedOptions', 'new Intl.DateTimeFormat().resolvedOptions().timeZone.length', 'ours'],
  ['canvas getImageData 1x1', 'CTX.getImageData(0,0,1,1).data[0]', 'ours'],
  ['ctl    performance.now', 'performance.now()&1', 'ctl']
];

const SPECS = JSON.stringify(TARGETS.map((t) => [t[0], t[1]]));

const READ = '(function () {\n' +
'  var OBJ = { x: 1 };\n' +
'  var D = new Date();\n' +
// A CONSTANT receiver lets TurboFan hoist a native Date call clean out of the loop, so the
// native side of that row measures nothing at all while ours, being a JS closure it cannot
// inline, is charged for every iteration. Rotating over four dates denies both sides the
// shortcut. Both rows stay in the table: the gap between them is itself the finding, since
// "this call can be optimised away and that one cannot" is exactly what a page would time.
'  var DD = [new Date(), new Date(Date.now() - 864e5), new Date(Date.now() - 1728e5), new Date(Date.now() - 2592e5)];\n' +
'  var CV = document.createElement("canvas"); CV.width = 40; CV.height = 40;\n' +
'  var CTX = CV.getContext("2d", { willReadFrequently: true });\n' +
'  CTX.fillStyle = "#4488cc"; CTX.fillRect(0, 0, 40, 40);\n' +
'  CTX.fillStyle = "#cc4422"; CTX.font = "13px sans-serif"; CTX.fillText("afp", 3, 20);\n' +
'  var SINK = 0;\n' +
// Grow the loop until it clears the timer's clamp, then take the FASTEST of several rounds.
// The minimum is the right estimator here: interference can only ever add time, so the floor
// is the closest thing to the cost with nothing else competing for the core.
'  function bench(f) {\n' +
'    var n = 20000;\n' +
'    for (;;) {\n' +
'      var t = performance.now(); SINK += f(n); var dt = performance.now() - t;\n' +
'      if (dt > 8 || n >= 8000000) break;\n' +
'      n = n * 4;\n' +
'    }\n' +
'    var best = Infinity;\n' +
'    for (var r = 0; r < 7; r++) {\n' +
'      var t2 = performance.now(); SINK += f(n); var d2 = performance.now() - t2;\n' +
'      if (d2 < best) best = d2;\n' +
'    }\n' +
'    return (best / n) * 1e6;\n' +
'  }\n' +
'  var specs = ' + SPECS + ';\n' +
'  var out = {};\n' +
'  var fns = specs.map(function (s) {\n' +
'    try { return new Function("n", "OBJ", "D", "CTX", "DD", "var s=0;for(var i=0;i<n;i++){s+=" + s[1] + ";}return s;"); }\n' +
'    catch (e) { return null; }\n' +
'  });\n' +
// Two passes, so a target measured first is not charged for a warm-up the later ones skipped.
'  specs.forEach(function (s, i) { if (fns[i]) { try { fns[i](3000, OBJ, D, CTX, DD); } catch (e) {} } });\n' +
// Three sweeps of the whole list, keeping each target's best, rather than seven rounds of one
// target before moving on. Seven consecutive rounds all sit inside the same few milliseconds,
// so whatever else the machine was doing then is charged to that ONE target and to nothing
// else. The first version measured that way and the controls proved it: navigator.onLine, the
// divisor, moved 1.5x between runs and dragged the entire column with it while the extension
// under test had only changed a Date getter. Interference can only add time, so the minimum
// across sweeps separated in time is the estimator that survives it.
'  for (var sweep = 0; sweep < 3; sweep++) {\n' +
'    specs.forEach(function (s, i) {\n' +
'      if (!fns[i]) { out[s[0]] = null; return; }\n' +
'      try {\n' +
'        var v = bench(function (n) { return fns[i](n, OBJ, D, CTX, DD); });\n' +
'        if (out[s[0]] == null || v < out[s[0]]) out[s[0]] = v;\n' +
'      } catch (e) { out[s[0]] = null; }\n' +
'    });\n' +
'  }\n' +
'  out.__sink = SINK;\n' +
'  return out;\n' +
'})()';

async function read(label, opts, withExt) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-time-'));
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
        afp_country_code: SEL.cc, afp_resolved_timezone: CC.tz,
        afp_resolved_locale: CC.loc, afp_mode: 'normal'
      });
      await new Promise((r) => setTimeout(r, 1500));
    }
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    if (withExt) await page.reload({ waitUntil: 'load' });
    const v = await page.evaluate(READ);
    delete v.__sink;
    process.stdout.write('  ' + label + ': ' + Object.keys(v).length + ' timings\n');
    return v;
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
  }
}

console.log('timing three browsers — this takes a couple of minutes');
const A = await read('A  stock, clean          ', { ...BROWSER, headless: true, args: [] }, false);
const B = await read('B  patched, same claim   ', {
  executablePath: PATCHED, headless: true,
  ignoreDefaultArgs: ['--disable-field-trial-config'],
  args: ['--fps-profile=' + SEL.id, '--fps-lang=' + CC.loc, '--fps-timezone=' + CC.tz]
}, false);
const Cc = await read('C  stock + this extension', {
  ...BROWSER, headless: true,
  args: ['--disable-extensions-except=' + root, '--load-extension=' + root]
}, true);
server.close();

// TWO units, because one is not enough and the first run proved it.
//
// The plain JS property divides out the CPU and V8, but NOT the speed of this binary's DOM
// bindings. Normalised that way the patched build looked 1.4-1.9x slow on properties NOBODY
// patches — location.protocol, navigator.cookieEnabled — which is just what a locally built
// Chromium costs against an official PGO one. Every reading is therefore ALSO divided by a
// platform property that neither browser substitutes, which is the unit that survives the
// comparison. The JS unit stays in the output because it is what says the two disagree.
// A timing that failed to run is recorded as null, and the first version of this script read
// those nulls straight into the report. One undefined name in the generated loop turned every
// single reading into null, and the run still printed three browsers and 26 timings each
// before dying on a formatting call. Say it out loud instead.
for (const [k, src] of [['A', A], ['B', B], ['C', Cc]]) {
  const dead = Object.keys(src).filter((n) => src[n] == null);
  if (dead.length) {
    console.error(`${k}: ${dead.length} of ${Object.keys(src).length} timings did not run — ${dead.slice(0, 3).join(' | ')}`);
    process.exit(1);
  }
}

const JSUNIT = TARGETS[0][0];
const PLATUNIT = TARGETS.find((t) => t[2] === 'plat')[0];
const jsu = { A: A[JSUNIT], B: B[JSUNIT], C: Cc[JSUNIT] };
const plat = { A: A[PLATUNIT], B: B[PLATUNIT], C: Cc[PLATUNIT] };

console.log('\nunit costs, absolute');
console.log('  plain JS property   A ' + jsu.A.toFixed(2) + 'ns   B ' + jsu.B.toFixed(2) + 'ns   C ' + jsu.C.toFixed(2) + 'ns');
console.log('  ' + PLATUNIT.trim() + '   A ' + plat.A.toFixed(1) + 'ns   B ' + plat.B.toFixed(1) + 'ns   C ' + plat.C.toFixed(1) + 'ns');
console.log('  the second is the divisor below: a property NEITHER browser substitutes,');
console.log('  so it carries this binary\'s DOM-binding speed and cancels it out.\n');

const u = (v, k) => (v == null || plat[k] == null ? null : v / plat[k]);
const pad = (s2, n) => String(s2).padEnd(n);
const num = (v) => (v == null ? '      -' : v.toFixed(2).padStart(8));

console.log(pad('cost in units of ' + PLATUNIT.trim(), 42) + 'A stock'.padStart(8) +
  'B patch'.padStart(8) + 'C ours'.padStart(8) + '    C/A     B/A');
const flagged = [];
for (const [name, , kind] of TARGETS) {
  const ua = u(A[name], 'A'), ub = u(B[name], 'B'), uc = u(Cc[name], 'C');
  const ra = ua && uc ? uc / ua : null;
  const rb = ua && ub ? ub / ua : null;
  // Interesting only when OURS is slow and the PATCHED BUILD IS NOT. Both slow is the browser.
  const odd = ra != null && rb != null && ra > 1.5 && ra / rb > 1.8;
  if (odd) flagged.push([name, ra, rb]);
  console.log(pad(name, 42) + num(ua) + num(ub) + num(uc) +
    (ra == null ? '       -' : ('  ' + (ra.toFixed(1) + 'x').padStart(6))) +
    (rb == null ? '       -' : ('  ' + (rb.toFixed(1) + 'x').padStart(6))) + (odd ? '  <<' : ''));
}

// THE PART THAT NEEDS NO REFERENCE BROWSER.
//
// Everything above compares three browsers, which a detector cannot do. This does not. Read
// natively, these properties cost DIFFERENT amounts, because each is a different amount of
// binding work — deviceMemory is a cached integer, platform builds a string. Read through one
// JS closure they all cost the same, because the closure call is the whole cost and it does
// not care which property it stands in front of. So the spread collapses, and a page can see
// that in its own window with nothing to compare against.
// This asks how many of them land on the SAME cost, which needs no divisor at all — a ratio
// between two readings in one column cancels it — and so is the one number here that a page
// could compute about itself. Read natively they scatter, because each is a different amount
// of binding work: deviceMemory hands back a cached integer, platform builds a string. Read
// through one JS closure the closure call IS the cost and it does not care which property it
// stands in front of, so they pile up on one value.
const SPREAD = TARGETS.filter((t) => t[2] === 'ours' && /^(nav|screen)/.test(t[0])).map((t) => t[0]);
const TOL = 1.10;
function cluster(src) {
  const v = SPREAD.map((n) => src[n]).filter((x) => x != null && x > 0).sort((a, b) => a - b);
  let best = { n: 0, lo: 0, hi: 0 };
  for (let i = 0; i < v.length; i++) {
    let j = i;
    while (j + 1 < v.length && v[j + 1] / v[i] <= TOL) j++;
    if (j - i + 1 > best.n) best = { n: j - i + 1, lo: v[i], hi: v[j] };
  }
  return { best, total: v.length };
}
console.log('\nHOW MANY OF THE ' + SPREAD.length + ' navigator/screen properties COST THE SAME');
console.log('largest group within ' + Math.round((TOL - 1) * 100) + '% of each other, in that browser alone —');
console.log('no second browser, no divisor, nothing a page could not compute about itself\n');
let piled = null;
for (const [k, label, src] of [['A', 'A stock  ', A], ['B', 'B patched', B], ['C', 'C ours   ', Cc]]) {
  const { best, total } = cluster(src);
  if (k === 'C') piled = best.n;
  console.log('  ' + label + '   ' + String(best.n).padStart(2) + ' of ' + total +
    ' on one cost' + (best.n >= 6 ? '   <- piled up' : ''));
}

console.log('');
if (!flagged.length) {
  console.log('no property costs this extension measurably more than it costs the patched build.');
  console.log('timing is not the channel either.');
} else {
  console.log(flagged.length + ' properties cost more through the wrapper than through the engine patch:');
  for (const [n, r, rb] of flagged) {
    console.log('  ' + pad(n, 42) + 'ours ' + r.toFixed(1) + 'x native, patched build ' + rb.toFixed(1) + 'x');
  }
  console.log('\nA page can measure every one of these in a few milliseconds, with no permission,');
  console.log('and the spread test above needs no second browser at all.');
  if (piled != null && piled >= 6) {
    console.log(piled + ' of the ' + SPREAD.length + ' cost the same through this extension, which is the');
    console.log('cheapest thing here for a page to read and the hardest for a wrapper to hide.');
  }
}
