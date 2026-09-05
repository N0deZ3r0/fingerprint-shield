/**
 * THE TIME AXIS. Everything a page can read, read EIGHT TIMES, and diffed against itself.
 *
 *   node tools/probe-time.mjs             the queue: values that move when nothing else does
 *   node tools/probe-time.mjs --all       every moving value, browser and accepted included
 *   node tools/probe-time.mjs --cold      no warm-up — the install window, on purpose
 *   node tools/probe-time.mjs --stealth  sweep stealth mode instead of normal
 *   node tools/probe-time.mjs --no-clean  skip the control (faster, and much weaker)
 *   node tools/probe-time.mjs --headed    watch it happen
 *
 * WHY THIS EXISTS. Almost every defect found in the week before it was written was a defect
 * of TIME, not of value:
 *
 *   platformVersion      10.0.0 for the first seconds of an install, 15.0.0 after
 *   feature switches     inert on the first load of an origin, live on the second
 *   outgoing headers     the host's own for three requests, then the profile's
 *   cold start           the first page after a restart got the previous machine's GPU
 *   canvas seed          a worker baked a provisional seed it could no longer correct
 *
 * One shape: a value that changes across a single page load, or between two loads, while
 * the profile behind it does not. A page that reads the same thing twice sees both answers,
 * and two answers from one visitor is worse than either answer alone.
 *
 * Every other instrument here is blind to it by construction. test/*.mjs asks whether two
 * SCOPES agree at one moment; tools/probe-diff.mjs asks whether two BROWSERS agree at one
 * moment, and deliberately warms the profile through five loads first so the install window
 * does not bury the steady state. Nobody sweeps the axis those two hold still.
 *
 * WHAT IT DOES. The collector from tools/probe-collect.mjs is pasted into the first inline
 * <script> in <head> — the earliest a page's own code can run — and fired at eight moments:
 *
 *   parse  dcl  load  t100  t500  t2000     one load, from document parse
 *   f5     f5end                            the same page after a reload
 *
 * A key whose eight readings are not all equal is a moving value.
 *
 * THE CONTROL, WHICH IS THE POINT. Moving is not the same as leaking. A clean browser moves
 * plenty on its own: voices arrive asynchronously, the network estimate updates, a
 * permission settles. So the identical sweep runs on a clean browser launched from the same
 * binary with the same arguments — the discipline tools/probe-diff.mjs already keeps — and
 * a key that moves on both sides is the browser's business, reported apart and not counted.
 * Only "moves for us, still for them" reaches the queue.
 *
 * The control cuts the other way too, and that half was not in the plan this was written
 * from. A value the browser UPDATES and we hold FROZEN is also a signature: a page that
 * reads navigator.connection.rtt twice a second and gets one number forever has learned
 * something. Those are printed under FROZEN — informational, not counted, because for most
 * of them being frozen is the product.
 *
 * THE NEGATIVE CONTROL, run before this file was committed. A sweep that reports nothing
 * proves nothing until it has been shown reporting something true. `--cold` drops the
 * warm-up, which puts the probe inside the install window that probe-diff documents and
 * warms away; the instrument is expected to name platformVersion there. If --cold is quiet,
 * this tool is broken, not the extension. Three checks were thrown out of this project for
 * passing on a build known to be broken; this one was made falsifiable first.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, BROWSER } from '../test/harness.mjs';
import { SOURCE } from './probe-collect.mjs';
import { settle } from './probe-settle.mjs';

const HEADED = process.argv.includes('--headed');
const SHOW_ALL = process.argv.includes('--all');
const COLD = process.argv.includes('--cold');
const NO_CLEAN = process.argv.includes('--no-clean');
/**
 * --stealth sweeps the OTHER configuration. Stealth forces _FEAT down to navigator, screen,
 * timezone and webgl and switches the rest off, so it is a second build with a fraction of
 * the first one's coverage — which is the whole complaint against it in the open-work list item 5.
 *
 * The time axis is where its bugs have actually been: the mode lives in sessionStorage per
 * tab, a first load has none, and so the first page of every new tab used to install the
 * NORMAL patches — two fingerprints for one site, the stable one being the host's own
 * ([FIX stealth-first-load-noised-the-canvas], pinned for the canvas alone by
 * test/canvasmode.mjs). This sweeps all 119 values on that axis rather than two.
 *
 * The clean side is unchanged and must be: the control answers "what does a browser with no
 * extension do over time", which has nothing to do with which mode we are in.
 */
const STEALTH = process.argv.includes('--stealth');

const STAGES = ['parse', 'dcl', 'load', 't100', 't500', 't2000'];
const ALL_STAGES = [...STAGES, 'f5', 'f5end'];

/**
 * Values that move for us on purpose. Each needs the reason, exactly as in probe-diff:
 * a matcher without one turns the queue back into a diff.
 *
 * Deliberately short. Most of what a browser does over time is caught by the control
 * instead, and an entry here is a claim that OUR movement is intended — a much stronger
 * claim than "the browser does this too", and one that has to be argued rather than
 * observed.
 */
const ACCEPTED = [
  [/^window\.own$/,
    'our two markers, __t0 and __p0, are non-enumerable but still own names, so they are ' +
    'in this list the moment they are installed — plus this probe\'s own __ names, which ' +
    'are set before the first snapshot and so never move. A marker appearing between two ' +
    'stages is the injection landing, which is what it is for. Read the VALUES below when ' +
    'this shows up: a third name would not be ours'],
];
const accept = (key) => ACCEPTED.find(([m]) => (m instanceof RegExp ? m.test(key) : m === key));

/**
 * Values the RIG cannot hold a control for. Same idea as the RIG list in probe-diff, and
 * the same reason to keep it separate from ACCEPTED: "we judged this" and "the instrument
 * cannot see this" are different claims, and one must not shelter behind the other.
 */
const RIG = [
  [/^window\.outer(Width|Height)$/,
    'Playwright drives the page through Emulation.setDeviceMetricsOverride, and under it the ' +
    'NATIVE outerWidth/outerHeight are 0 — measured across fifteen loads of a clean browser, ' +
    'still 0 at the load event in fourteen of them, and 0 in all four launch shapes ' +
    '(headless/headed x emulated/real viewport). A user\'s browser reports its window here, ' +
    'so both the clean readings and the moment they change are the rig\'s, not a browser\'s. ' +
    'Kept in the sweep rather than dropped, because the zero is what exposed ' +
    '[FIX outer-was-the-screen-while-inner-was-the-window]: the getter answered the claimed ' +
    'SCREEN whenever the real geometry was unknown, so one instant of every load reported a ' +
    '1280x720 viewport inside a 1920x1040 window — 640px of horizontal browser chrome. What ' +
    'the rig cannot settle is how often a real browser hands that 0 over; what it did settle ' +
    'is what we said when it did'],
];
const rig = (key) => RIG.find(([m]) => (m instanceof RegExp ? m.test(key) : m === key));

/**
 * The document under test. The collector goes in the first inline script so that `parse`
 * is genuinely the first thing that runs in the page — the moment a real fingerprinting
 * script gets, and the moment every asynchronous path in the extension has already lost.
 *
 * Both halves are fired per stage. The sync half is true to the instant. The async half is
 * STARTED at the instant and answers when the browser answers, which is the same bargain a
 * page makes; the stage owns the question, not the reply.
 *
 * Every name this page adds to window is added BEFORE the first snapshot, so the probe's
 * own litter is constant across stages and cannot look like movement.
 */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>time</title>
<script>
${SOURCE}
window.__snaps = {};
window.__pending = {};
window.__probeT0 = Date.now();
// What each stage COST, printed by the driver. A stage is only as sharp as the collector
// is cheap, and a reader who cannot see that a stage landed 450 ms late will read the
// timeline as finer than it is.
window.__when = {};
window.__stage = function (name) {
  window.__when[name] = Date.now() - window.__probeT0;
  try { window.__snaps[name] = collectSync(); }
  catch (e) { window.__snaps[name] = { 'PROBE.sync': 'THREW ' + e }; }
  try { window.__pending[name] = collectAsync().catch(function (e) { return { 'PROBE.async': 'THREW ' + e }; }); }
  catch (e) { window.__pending[name] = Promise.resolve({ 'PROBE.async': 'THREW ' + e }); }
};
window.__gather = function () {
  var names = Object.keys(window.__pending);
  return Promise.all(names.map(function (n) { return window.__pending[n]; })).then(function (vals) {
    var out = { __when: window.__when };
    names.forEach(function (n, i) { out[n] = Object.assign({}, window.__snaps[n], vals[i]); });
    return out;
  });
};
// Resolves when the LAST stage has actually fired, not at a wall-clock guess. The first
// version used setTimeout(2150) and lost t2000 entirely on a cold page: one collectSync
// costs about 450 ms before the caches are warm, the main thread is busy through it, and
// the 2000 ms stage landed at 2458 ms — after the gather that was supposed to include it.
window.__all = new Promise(function (res) { window.__lastStage = res; })
  .then(function () { return window.__gather(); });
window.__stage('parse');
document.addEventListener('DOMContentLoaded', function () { window.__stage('dcl'); });
window.addEventListener('load', function () { window.__stage('load'); });
setTimeout(function () { window.__stage('t100'); }, 100);
setTimeout(function () { window.__stage('t500'); }, 500);
setTimeout(function () { window.__stage('t2000'); window.__lastStage(); }, 2000);
</script>
</head><body>probe</body></html>`;

const server = createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const URL_ = `http://127.0.0.1:${port}/`;

/**
 * One sweep. Returns { stage -> { key -> value } } over all eight stages.
 *
 * The warm-up is probe-diff's, for probe-diff's reason and stated in its words: a profile
 * made by mkdtemp is a FRESH INSTALL, and for the first seconds of one the extension is
 * still assembling itself. Without it every run would be dominated by the install window,
 * which is already written up and already known. `--cold` drops it, and that is how this
 * instrument gets checked against a defect known to be there.
 */
async function sweep(withExtension) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fpstime-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !HEADED,
    // --disable-extensions must go for the extension side, so it goes for BOTH.
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: withExtension
      ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
      : [],
    permissions: ['geolocation'],
  });
  try {
    if (STEALTH && withExtension) {
      // Same handle every suite uses: the service worker's own storage. Waiting for the
      // worker first, because a persistent context that has just launched may not have one
      // yet, and setting the mode on nothing would sweep normal mode and report it as
      // stealth — a green run of the wrong build.
      const sw = ctx.serviceWorkers()[0]
        || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 3000));
      await sw.evaluate(async () => { await chrome.storage.local.set({ afp_mode: 'stealth' }); });
      await new Promise((r) => setTimeout(r, 2000));
    }
    const page = await ctx.newPage();
    if (!COLD) {
      for (let i = 0; i < 4; i++) await page.goto(URL_ + '?warm=' + i, { waitUntil: 'load' });
      await page.reload({ waitUntil: 'load' });
      // Then wait for the profile to have settled, for the reason written at
      // tools/probe-settle.mjs: five loads is what THIS machine needs, and the first CI
      // browser run measured a slower one still inside the install window afterwards. On
      // this instrument that would be worse than elsewhere — an unsettled install moves
      // values, which is exactly what this sweep reports.
      if (withExtension) {
        const st = await settle(page, URL_);
        if (!st.settled) console.log('   warning: the profile never settled; sweeping anyway');
        else if (st.loads) console.log(`   (${st.loads} extra load(s) to settle: ${st.value})`);
      }
    }
    await page.goto(URL_ + '?run=1', { waitUntil: 'load' });
    const first = await page.evaluate('window.__all');
    await page.reload({ waitUntil: 'load' });
    const second = await page.evaluate('window.__all');
    return {
      ...first,
      f5: second.parse,
      f5end: second.t2000,
      __when: { load1: first.__when, load2: second.__when },
    };
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  }
}

const ours = await sweep(true);
const clean = NO_CLEAN ? null : await sweep(false);
server.close();

/**
 * DID THE MODE ACTUALLY TAKE? A stealth run that quietly swept normal mode would print the
 * same "119 held still" as a real one, and a green result for a build nobody measured is the
 * exact failure this project has thrown out checks for three times.
 *
 * So the mode is verified by its EFFECT rather than by the flag being set. Stealth forces
 * `canvas` and `fonts` off, so with it on our canvas hash and our font metrics must equal
 * the clean browser's — they are the host's own, unnoised. In normal mode both differ. That
 * is a two-sided test: it fails if stealth did not engage AND it fails if stealth engaged
 * but stopped switching those modules off, which is the batch-flip the open-work list warns about.
 */
if (STEALTH && clean) {
  const same = (k) => ours.f5end[k] === clean.f5end[k];
  const canvasOff = same('canvas.2d');
  const fontsOff = same('fonts.measureText');
  console.log(`\n### MODE CHECK — is this really stealth?`);
  console.log(`   canvas.2d equals the clean browser   ${canvasOff ? 'yes' : 'NO'}`);
  console.log(`   fonts.measureText equals it too      ${fontsOff ? 'yes' : 'NO'}`);
  if (!canvasOff || !fontsOff) {
    console.log(`\n   STOP. Stealth switches canvas and fonts OFF, so both must read the`);
    console.log(`   host's own values. One of them does not, which means either the mode`);
    console.log(`   never engaged and this swept NORMAL mode, or those gates stopped`);
    console.log(`   firing. Either way the sweep below is about a build nobody selected.`);
    process.exitCode = 1;
  } else {
    console.log(`   both — so the sweep below really is the stealth configuration.`);
  }
}

/** Every key any stage produced. A key missing from a stage is itself a change. */
const keysOf = (s) => [...new Set(ALL_STAGES.flatMap((st) => Object.keys(s[st] || {})))].sort();
/** When each stage actually ran, ms from the first inline script. */
const offsets = (s, load) => STAGES.map((st) => `${st}=${s.__when[load][st] ?? '?'}ms`).join(' ');
const readings = (s, k) => ALL_STAGES.map((st) => (s[st] && k in s[st] ? s[st][k] : '(absent)'));
const moves = (s, k) => new Set(readings(s, k)).size > 1;

/**
 * WHERE a value changes, not what it changes to. Two browsers reading different numbers is
 * the product; two browsers changing them at different MOMENTS is not, and telling those
 * apart is the whole job of the control.
 *
 * This is the second version. The first asked only "does the clean browser move this key
 * too", and that let window.outerWidth through: both sides move it, so both were dismissed
 * — while the clean browser went 0 -> 1280 at DOMContentLoaded and stayed, and ours went
 * 1920 -> 1280 and never returned to 0 on the reload the way the clean one did. Same key,
 * same verdict, different behaviour, and the verdict was wrong. A control that only counts
 * movement cannot see the shape of it.
 */
const shape = (s, k) => {
  const v = readings(s, k);
  return ALL_STAGES.filter((_, i) => i > 0 && v[i] !== v[i - 1]).join(',');
};

const keys = keysOf(ours);
const movedOurs = keys.filter((k) => moves(ours, k));
const movedClean = clean ? new Set(keysOf(clean).filter((k) => moves(clean, k))) : new Set();
/** The browser's business only if it changes at the SAME moments on both sides. */
const sameShape = (k) => clean && movedClean.has(k) && shape(ours, k) === shape(clean, k);

const rigged = movedOurs.filter((k) => rig(k));
const browser = movedOurs.filter((k) => !rig(k) && sameShape(k));
const known = movedOurs.filter((k) => !rig(k) && !sameShape(k) && accept(k));
const queue = movedOurs.filter((k) => !rig(k) && !sameShape(k) && !accept(k));
const frozen = clean ? [...movedClean].filter((k) => !rig(k) && !moves(ours, k)).sort() : [];

const trim = (v) => { const s = String(v); return s.length > 60 ? s.slice(0, 57) + '...' : s; };

/** Only the transitions: eight identical lines hide the one that is different. */
function timeline(s, k, indent = '      ') {
  const vals = readings(s, k);
  const lines = [];
  let held = null, from = null;
  for (let i = 0; i < vals.length; i++) {
    if (i === 0 || vals[i] !== held) {
      if (i) lines.push([from === ALL_STAGES[i - 1] ? from : `${from}..${ALL_STAGES[i - 1]}`, held]);
      held = vals[i]; from = ALL_STAGES[i];
    }
  }
  lines.push([from === ALL_STAGES[ALL_STAGES.length - 1] ? from : `${from}..${ALL_STAGES[ALL_STAGES.length - 1]}`, held]);
  const w = Math.max(...lines.map(([a]) => a.length));
  return lines.map(([a, v]) => `${indent}${a.padEnd(w)}  ${trim(v)}`).join('\n');
}

console.log(`\n${keys.length} values read at each of ${ALL_STAGES.length} moments` +
  `${COLD ? ', NO WARM-UP (install window included on purpose)' : ''}` +
  `${STEALTH ? ', STEALTH MODE' : ''}`);
console.log(`   ${ALL_STAGES.join('  ')}`);
console.log(`${keys.length - movedOurs.length} held still, ${movedOurs.length} moved` +
  `${clean ? `; the clean browser moved ${movedClean.size}` : '; NO CONTROL — --no-clean was passed'}`);
// The resolution of the instrument, measured rather than claimed. One collectSync costs
// about 450 ms on a cold page and about 15 ms once the font cache, the shader compiler and
// the GL context are warm — so on a cold run `dcl` is not DOMContentLoaded, it is
// DOMContentLoaded plus one collection, and two stages 20 ms apart cannot be told apart.
console.log(`   when, load 1  ${offsets(ours, 'load1')}`);
console.log(`   when, load 2  ${offsets(ours, 'load2')}   (f5 = its parse, f5end = its t2000)\n`);

if (!clean) {
  console.log('Without the clean sweep every value the BROWSER varies on its own — voices, the');
  console.log('network estimate, a settling permission — is in the queue below. Read it as a');
  console.log('list of things to check by hand, not as a list of defects.\n');
}

if (browser.length) {
  if (SHOW_ALL) {
    console.log(`### BROWSER (${browser.length}) — moves on the clean side too`);
    for (const k of browser) {
      console.log(`   ${k}`);
      console.log(timeline(ours, k));
      console.log(`      clean:`);
      console.log(timeline(clean, k, '        '));
    }
    console.log('');
  } else {
    console.log(`${browser.length} value(s) move on the clean browser too — not ours; --all shows them\n`);
  }
}

if (rigged.length) {
  console.log(`### RIG (${rigged.length}) — Playwright, not the extension`);
  for (const k of rigged) {
    console.log(`   ${k}`);
    console.log(timeline(ours, k));
    console.log(`      ${rig(k)[1]}`);
  }
  console.log('');
}

if (known.length) {
  console.log(`### ACCEPTED (${known.length}) — moves for us, and it is meant to`);
  for (const k of known) {
    console.log(`   ${k}`);
    console.log(timeline(ours, k));
    console.log(`      why   ${accept(k)[1]}`);
  }
  console.log('');
}

if (frozen.length) {
  console.log(`### FROZEN (${frozen.length}) — the browser moves these, we hold them still`);
  console.log(`   Informational. For most of them that IS the product; it is here because a`);
  console.log(`   value a real browser updates and this one never does is also something a page`);
  console.log(`   can measure by reading it twice.`);
  for (const k of frozen) {
    console.log(`   ${k}  ours ${trim(readings(ours, k)[0])}`);
    console.log(timeline(clean, k, '        clean '));
  }
  console.log('');
}

console.log(`### QUEUE (${queue.length}) — values that move for us and not for a clean browser`);
for (const k of queue) {
  console.log(`   ${k}`);
  console.log(timeline(ours, k));
}

console.log(`\n=== ${queue.length} unjudged moving value(s) ===`);
process.exitCode = queue.length;
