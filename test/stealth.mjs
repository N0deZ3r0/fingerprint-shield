/**
 * STEALTH MODE, PINNED GATE BY GATE.
 *
 *   node test/stealth.mjs             headless
 *   node test/stealth.mjs --headed    watch it
 *
 * WHY THIS EXISTS. Stealth is a second configuration of this extension — mw-core forces
 * `_FEAT` down to navigator / screen / timezone / webgl and switches the other nine
 * modules off — and until this file it had a fraction of normal mode's coverage. That is
 * the standing complaint in the open-work list item 5, and the reason the answer there was "finish it
 * or drop it" rather than "leave it": a half-measured configuration is where bugs live, and
 * two of stealth's have already shipped. The canvas one is worth restating, because it is
 * the shape this suite is built to catch:
 *
 *   the mode lives in sessionStorage per tab, a first load has none, so the FIRST page of
 *   every new tab installed the normal-mode patches — canvas 2322357496 on load one and
 *   1576997145 (the machine's real hash) on load two. Two fingerprints for one site, the
 *   stable one being the host's own.
 *
 * THREE BROWSERS, AND THE THIRD IS THE POINT. Asserting "stealth matches a clean browser
 * here" proves nothing on its own: it also passes if the module was off in BOTH modes, or
 * never worked at all. So every gate is checked twice —
 *
 *     stealth == clean     the gate is off in stealth, as designed
 *     normal  != clean     and it was doing something in the first place
 *
 * — and the pair is what makes the first line mean anything. The same two-sided shape the
 * MODE CHECK in tools/probe-diff.mjs uses, applied per module instead of to the run.
 *
 * The three runs share tools/probe-collect.mjs with those tools, so there is one list of
 * what a page can read rather than a fourth copy of it.
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT: which modules stealth ought to switch off. That is
 * a judgement, it is written where it is made (mw/mw-core.js), and every one of these gates
 * was argued separately — the voices gate was a contradiction, the keyboard one a crowd
 * argument, and the open-work list records that they must never be flipped as a batch. This file pins
 * what the build DOES so that a batch flip cannot happen quietly; it does not vote.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harness, root, BROWSER, bootSettled } from './harness.mjs';
import { EXPR } from '../tools/probe-collect.mjs';

const headed = process.argv.includes('--headed');
const { assert, eq, section, note, done } = harness();

// Which extension tree to load. Defaults to this one; FPS_EXT_ROOT points it at another,
// which is how a finding gets attributed rather than assumed — run this same suite against
// a pristine clone of the published HEAD and the split either predates the working tree or
// does not. Added the first time section 4 went red and the question "did I cause this?"
// had no cheap answer.
// Resolved, because a relative FPS_EXT_ROOT would be handed to --load-extension as-is and
// silently resolve against the browser's working directory rather than this one.
const EXT = process.env.FPS_EXT_ROOT ? path.resolve(process.env.FPS_EXT_ROOT) : root;
if (process.env.FPS_EXT_ROOT) console.log(`extension root: ${EXT} (FPS_EXT_ROOT)`);

// A worker reads the machine through a completely separate patch path — a payload the
// window prepends to the worker source — so window and worker agreeing is a real property
// rather than a tautology. It has to hold in BOTH modes: stealth doing less is fine,
// stealth doing less IN ONE SCOPE ONLY is the contradiction the whole project refuses.
const WORKER = `self.onmessage=function(){postMessage({
  cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory,
  platform: navigator.platform, ua: navigator.userAgent,
  tz: (function(){ try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e){ return '?'; } })(),
  lang: navigator.language });};`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>stealth</title></head>
<body>probe<script>
window.__name0 = window.name;
window.__worker = function () {
  return new Promise(function (res) {
    try {
      var b = new Blob([${JSON.stringify(WORKER)}], { type: 'text/javascript' });
      var w = new Worker(URL.createObjectURL(b));
      w.onmessage = function (e) { res(e.data); };
      w.onerror = function () { res({ error: 'worker failed' }); };
      w.postMessage(1);
      setTimeout(function () { res({ error: 'worker timed out' }); }, 5000);
    } catch (e) { res({ error: String(e && e.name) }); }
  });
};
</script></body></html>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const URL_ = `http://127.0.0.1:${port}/`;

/**
 * One browser, read the same way as the two probe tools read theirs — including their
 * warm-up, and for their reason: a profile made by mkdtemp is a FRESH INSTALL and for the
 * first seconds of one the extension is still assembling itself. Without the warm-up this
 * suite would measure the install window and blame stealth for it.
 *
 * `permissions` is deliberately NOT granted here, unlike in probe-diff. The
 * PermissionStatus patch is one of the gates under test, and a pre-granted geolocation
 * would make clean and patched agree for the wrong reason.
 */
async function read({ extension, stealth, bundledBuild }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'afp-stealth-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    // BROWSER is channel:chromium; the bundled build is the same launcher with no channel,
    // and it is a DIFFERENT browser — used here for the plugin rows only, never for a
    // comparison against the other three runs.
    ...(bundledBuild ? {} : BROWSER),
    headless: !headed,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: extension
      ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
      : [],
  });
  try {
    if (stealth) {
      const sw = ctx.serviceWorkers()[0]
        || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await bootSettled(ctx);
      await sw.evaluate(async () => { await chrome.storage.local.set({ afp_mode: 'stealth' }); });
      await new Promise((r) => setTimeout(r, 2000));
    }
    const page = await ctx.newPage();
    for (let i = 0; i < 4; i++) await page.goto(URL_ + '?warm=' + i, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });

    // WARM UNTIL SETTLED, not four times and hope. Four loads plus a reload is what
    // tools/probe-diff.mjs uses and what a developer machine needs; a Windows CI runner is
    // slower than that, and the fourth CI run caught this suite measuring inside the
    // install window with the signature that window has always had:
    //
    //   uad.hev.platformVersion  "10.0.0" -> "15.0.0"
    //   webgl.param.MAX_TEXTURE_SIZE  8192 -> 16384      (the host's, then the profile's)
    //
    // Those are a documented, accepted phenomenon — probe-diff warms it away on purpose —
    // and section 4 below asserts something else entirely: that a FRESH TAB does not split
    // once the install has settled. Measuring the former and reporting it as the latter is
    // how that section spent a run accusing the build of a defect it does not have.
    //
    // The signal is cheap and specific: the platform version stops being mw-navigator's
    // fallback literal, and the GL limit stops moving between two loads. Both were seen
    // moving on the runner, both are answered from the profile once it lands.
    if (extension) {
      const settle = () => page.evaluate(async () => {
        let pv = '?';
        try { pv = (await navigator.userAgentData.getHighEntropyValues(['platformVersion'])).platformVersion; } catch (e) {}
        let tex = 0;
        try {
          const gl = document.createElement('canvas').getContext('webgl');
          tex = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
          try { gl.getExtension('WEBGL_lose_context').loseContext(); } catch (e2) {}
        } catch (e) {}
        return pv + '/' + tex;
      });
      let prev = null;
      for (let i = 0; i < 30; i++) {
        const now = await settle();
        if (prev !== null && now === prev && !now.startsWith('10.0.0/')) break;
        prev = now;
        await page.reload({ waitUntil: 'load' });
      }
    }

    // Wait for the VALUE, not for a duration. The fixed 3s + 2s above is what a fast
    // machine needs; the first CI run on a Windows runner was slower than that and the
    // whole suite measured normal mode while reporting stealth defects. `v.ui.m` is the
    // carrier mw-core reads as it loads, so its presence on this origin is the mode being
    // live rather than merely written. Section 0 still checks the EFFECT — this only makes
    // the common case stop failing for the boring reason.
    if (stealth) {
      for (let i = 0; i < 20; i++) {
        const m = await page.evaluate(() => {
          try { return sessionStorage.getItem('v.ui.m'); } catch (e) { return null; }
        });
        if (m === 'stealth') break;
        await new Promise((r) => setTimeout(r, 500));
        await page.reload({ waitUntil: 'load' });
      }
    }

    // Load one of a FRESH tab, then load two of the same tab. This is the axis the canvas
    // bug lived on: v.ui.m does not exist on a tab's first load, so a build that decides
    // the mode once at install time answers as NORMAL there and as stealth afterwards.
    const tab = await ctx.newPage();
    await tab.goto(URL_ + '?first=1', { waitUntil: 'load' });
    const first = await tab.evaluate(EXPR);
    await tab.reload({ waitUntil: 'load' });
    const second = await tab.evaluate(EXPR);
    const worker = await tab.evaluate('window.__worker()');
    return { first, second, worker };
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  }
}

const clean = await read({ extension: false });
const normal = await read({ extension: true });
const stealth = await read({ extension: true, stealth: true });

/**
 * A FOURTH AND FIFTH BROWSER, on Playwright's BUNDLED build rather than channel:'chromium',
 * and only the plugin rows are read from them.
 *
 * The plugin spoof fires only on an EMPTY navigator.plugins — deliberately, because real
 * Chrome ships five PDF entries and rewriting a populated PluginArray is a strong
 * anti-detect signal ([FIX less-detect] in mw/mw-misc.js). channel:'chromium' HAS those five,
 * so on the browser the rest of this suite drives the gate is a no-op and "stealth leaves it
 * alone" was reporting UNPROVEN forever. Measured, same machine, one page each:
 *
 *   bundled              plugins 0   mimeTypes 0     <- the spoof fires
 *   channel:'chromium'   plugins 5   mimeTypes 2     <- it does not
 *
 * So the gate is provable, just not there. Two extra launches buy the two rows; everything
 * else still comes from the browser the rest of the suite uses, because a different build is
 * a different browser and only this one question is being asked of it.
 */
// Deliberately NOT the full collector: one load and three values. A settling check that
// costs as much as the measurement changes what it measures, and this one is asking a
// single question about a browser the rest of the suite does not use.
async function pluginProbe(withExt) {
  const dir = mkdtempSync(path.join(tmpdir(), 'afp-bundled-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: !headed,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: withExt ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [],
  });
  try {
    const p = await ctx.newPage();
    for (let i = 0; i < 5; i++) await p.goto(URL_ + '?bundled=' + i, { waitUntil: 'load' });
    return await p.evaluate(() => ({
      cores: navigator.hardwareConcurrency,
      plugins: [...navigator.plugins].map((x) => x.name).join('|'),
      mimeTypes: navigator.mimeTypes.length,
    }));
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  }
}
const bundled = { on: null, off: null, error: null };
try {
  bundled.off = await pluginProbe(false);
  bundled.on = await pluginProbe(true);
} catch (e) { bundled.error = String(e && e.message).slice(0, 120); }

server.close();

const C = clean.second, N = normal.second, S = stealth.second;

// ── 0) did stealth engage at all? ──────────────────────────────────────────────
//
// The same two-sided MODE CHECK tools/probe-diff.mjs and tools/probe-time.mjs make, and it
// belongs here more than there. Both tools got one and this suite did not, which the first
// CI run on a Windows runner made expensive: the mode did not take within the five seconds
// waited for above, and the result was FIVE failures reading like product defects —
// "stealth leaves canvas noise alone", "stealth still spoofs the memory size" — when the
// truth was that nothing had been put into stealth at all.
//
// So it is asked once, first, in the terms the mode is defined by: stealth forces canvas
// and fonts off, so with it engaged both must read exactly what a clean browser reads. If
// they do not, everything below is about normal mode and says so instead of accusing the
// build.
section('0) the mode under test really is stealth');
{
  const canvasOff = S['canvas.2d'] === C['canvas.2d'];
  const fontsOff = S['fonts.measureText'] === C['fonts.measureText'];
  const engaged = canvasOff && fontsOff;
  assert(engaged,
    'stealth engaged — canvas and text metrics read the host\'s own values ' +
    `(canvas ${canvasOff ? 'off' : 'STILL NOISED'}, fonts ${fontsOff ? 'off' : 'STILL NOISED'})`);
  if (!engaged) {
    note('every assertion below this line is now measuring NORMAL mode. Read them as ' +
      '"the mode never took", not as defects: the usual cause is the wait after writing ' +
      'afp_mode being too short for the machine, which is what happened on the first CI run.');
  }
}

// ── 1) the gates stealth switches OFF ──────────────────────────────────────────
//
// Each line is two assertions: stealth reads what a clean browser reads, AND normal mode
// does not — so the first line cannot pass by the module being broken in both.
section('1) modules stealth switches off');
// `permissions.geolocation` is NOT in this list although the patch behind it is a gate.
// The probe mutates it: the collector calls getCurrentPosition, headless has no location
// provider, and the auto-denial is PERSISTED — so a clean browser reads 'prompt' on a tab's
// first load and 'denied' on its second, from the measurement itself. A key whose value the
// instrument changes cannot be compared across browsers OR across loads, and pretending
// otherwise would have this suite reporting its own footprint as a defect.
const OFF = [
  ['canvas.2d', 'canvas noise', 'mw-core _FEAT.canvas=false'],
  ['fonts.measureText', 'text metric noise', 'mw-canvas-audio measureText gate'],
  // `fonts.check` WAS here and is not a gate at all, which took a measurement to establish
  // rather than another UNPROVEN note. document.fonts.check is not an availability oracle:
  // it answers about FontFace loading state, and a CLEAN browser returns true for a family
  // that cannot exist —
  //
  //   clean:  check('12px "ZzQq No Such Family 9173"')  ->  true
  //
  // so answering true is CORRECT and this key can never differ between any two builds on
  // any host. It had been reporting "UNPROVEN, needs a browser where the gate fires"; no
  // browser will. The allowlist's observable is the text metric, which is measured: on this
  // host Agency FB reads 458.26 clean and 561.70 patched, collapsed to the fallback.
  // tools/probe-diff.mjs never listed this key as differing either, in any run.
  // `plugins` and `mimeTypes` are checked below on the bundled build instead: the spoof only
  // fires on an EMPTY list, and channel:'chromium' — the browser the rest of this suite
  // drives — already has five PDF entries, so the gate is a no-op here and no amount of
  // rerunning would make it otherwise. See section 1c.
  ['battery.level', 'the battery spoof', 'mw-core _FEAT.battery=false'],
];
let unproven = 0;
for (const [key, what, where] of OFF) {
  eq(S[key], C[key], `stealth leaves ${what} alone — ${key} reads the host's own value`);
  // The second half of the pair, and where it CANNOT be had, that is said rather than
  // failed. Two of these gates are no-ops on this rig for reasons that are the rig's:
  // Playwright's chromium already ships the five PDF plugins, so the plugin spoof (which
  // only fires on an EMPTY list, by design) never runs; and the font allowlist can only
  // SUBTRACT families the host has, which a headless Windows container mostly does not.
  // A gate that does nothing in normal mode here is unmeasurable, not broken — but the
  // line above it then proves nothing either, and the count is printed for that reason.
  if (N[key] === C[key]) {
    unproven++;
    note(`UNPROVEN on this rig: normal mode does not change ${key} either (${where}), ` +
      `so "stealth leaves it alone" is not evidence. Needs a browser where the gate fires`);
  } else {
    assert(true, `and the check is not vacuous: normal mode DOES change ${key}`);
  }
}
// The budget is asserted once, after section 2, over BOTH kinds of unmeasurable — see there.

// The network gate is checked against the SPOOF CONSTANTS rather than against the clean
// browser, and that is not a shortcut. navigator.connection.rtt is a live estimate the
// browser keeps re-measuring: the clean run read 100 and the stealth run 150 on the same
// machine, minutes apart, both of them the host's honest answer. Comparing two live
// measurements taken in two browser instances is not a test of anything, and the first
// version of this line failed on exactly that.
//
// What IS fixed is what mw-navigator substitutes: effectiveType '4g', downlink 10, rtt 50.
// So the question becomes "is the page being told those three", which has one right answer
// per mode and no dependence on what the network is doing.
section('1b) the network substitution, against the values it substitutes');
{
  const spoofed = (r) => r['connection.rtt'] === '50' && r['connection.downlink'] === '10';
  assert(spoofed(N), `normal mode hands over the substituted network ` +
    `(rtt ${N['connection.rtt']}, downlink ${N['connection.downlink']})`);
  assert(!spoofed(S), `stealth does not — it reports the host's own live estimate ` +
    `(rtt ${S['connection.rtt']}, downlink ${S['connection.downlink']})`);
  assert(!spoofed(C), `and a clean browser does not either, so the pattern really is ours ` +
    `(rtt ${C['connection.rtt']}, downlink ${C['connection.downlink']})`);
}

// ── 1c) the plugin gate, on a browser where it can fire ────────────────────────
//
// It cannot fire on the browser above. The spoof only rewrites navigator.plugins when the
// list is EMPTY — deliberately, because real Chrome ships five PDF entries and rewriting a
// populated PluginArray is a strong anti-detect signal ([FIX less-detect]) — and
// channel:'chromium' has those five. So this row spent its life reporting UNPROVEN.
//
// Playwright's BUNDLED build reports zero, measured on this machine one page each:
// bundled 0 plugins / 0 mimeTypes, channel:'chromium' 5 / 2. Same question, a browser that
// can answer it.
section('1c) the plugin gate, and why no browser here can prove it');
if (bundled.error) {
  note(`the bundled build could not be launched (${bundled.error})`);
} else {
  // First: does the extension even load there? It does not, measured — and that is the
  // finding. --load-extension has been refused by branded Chrome since 136, and Playwright's
  // bundled Chromium is newer than the channel build, so it refuses it too:
  //
  //   bundled, clean       cores 18   plugins 0      the host's own core count
  //   bundled, --load-extension  cores 18   plugins 0      IDENTICAL — nothing was patched
  //
  // So the one browser on this machine with an empty plugin list is the one that will not
  // run the extension, and the one that runs it already has five PDF entries, which is
  // exactly the case the spoof declines to touch. The gate is not "unproven on this rig" —
  // it is unprovable on any browser this rig can drive, and saying which is worth the two
  // extra launches it costs.
  const patched = bundled.on.cores !== bundled.off.cores;
  if (!patched) {
    note(`the plugin gate cannot be proved by anything here. The bundled build has an empty ` +
      `plugin list (clean plugins=${JSON.stringify(bundled.off.plugins)}) which is the only ` +
      `case the spoof acts on — but it does not load the extension at all ` +
      `(cores ${bundled.off.cores} clean vs ${bundled.on.cores} with --load-extension, ` +
      `identical). channel:'chromium' loads it and already has the five PDF entries the ` +
      `spoof declines to touch. Needs a browser that both loads extensions and ships none`);
  } else {
    assert(bundled.on.plugins !== bundled.off.plugins,
      `the bundled build loads the extension now, so the plugin spoof must act on its empty ` +
      `list (clean ${JSON.stringify(bundled.off.plugins)}, ours ` +
      `${JSON.stringify(bundled.on.plugins)}) — if this fails the gate is broken, not merely ` +
      `unmeasurable`);
  }
}

// ── 2) the four stealth keeps ON ───────────────────────────────────────────────
//
// The mirror image, and the half that says stealth is still doing its job. Same two-sided
// shape: it must differ from a clean browser, and it must agree with normal mode — a value
// that differed from BOTH would mean stealth invented a third machine.
section('2) modules stealth keeps on');
const ON = [
  ['navigator.hardwareConcurrency', 'the core count'],
  ['navigator.deviceMemory', 'the memory size'],
  ['navigator.userAgent', 'the user agent'],
  ['screen.width', 'the screen width'],
  ['screen.height', 'the screen height'],
  ['intl.timeZone', 'the timezone'],
  ['date.offsetJan', 'the UTC offset'],
  ['webgl.unmaskedRenderer', 'the GPU string'],
];
// Symmetric with the UNPROVEN handling in section 1, and for the mirror-image reason. There
// the gate was a no-op because the host had nothing for it to change; here the SPOOF is
// invisible because the host already answers what the profile claims. The first CI run met
// exactly that: a Windows runner reports deviceMemory 8 and laptop_mid claims 8, so
// "stealth still spoofs the memory size" failed on a build that was spoofing it correctly.
//
// A value that agrees with the host is not evidence either way, and saying so is the only
// honest reading. The pair `S === N` still runs in every case, because "stealth answers what
// normal answers" holds whatever the host happens to be.
for (const [key, what] of ON) {
  if (S[key] === C[key]) {
    unproven++;
    note(`UNPROVEN on this rig: the host already answers what the profile claims for ` +
      `${key} (${S[key]}), so this machine cannot show ${what} being spoofed at all. ` +
      `Not a defect and not evidence — it needs a host that differs from the claim`);
  } else {
    assert(true, `stealth still spoofs ${what} (${key}: ${S[key]})`);
  }
  eq(S[key], N[key], `and answers exactly what normal mode answers for ${key}`);
}
assert(unproven <= 5,
  `at most five of the ${OFF.length + ON.length} module checks are unmeasurable on this ` +
  `host (${unproven}) — past that the suite is mostly reporting what it could not see`);

// ── 3) the invariants that hold in BOTH modes ──────────────────────────────────
//
// Doing less is allowed. Doing less in one scope than in another is not — that is the
// contradiction class every other suite in test/ exists to refuse, and stealth had no
// suite asking it.
section('3) invariants stealth may not break');
{
  const w = stealth.worker;
  assert(!w.error, `the stealth worker answered (${w.error || 'ok'})`);
  if (!w.error) {
    eq(String(w.cores), S['navigator.hardwareConcurrency'], 'worker and window agree on cores');
    eq(String(w.memory), S['navigator.deviceMemory'], 'worker and window agree on memory');
    eq(String(w.platform), S['navigator.platform'], 'worker and window agree on platform');
    eq(String(w.ua), S['navigator.userAgent'], 'worker and window agree on the user agent');
    eq(String(w.tz), S['intl.timeZone'], 'worker and window agree on the timezone');
    eq(String(w.lang), S['navigator.language'], 'worker and window agree on the language');
  }
  eq(S['stack.namesExtension'], 'no', 'no error stack names the extension in stealth either');
  assert(Number(S['screen.width']) >= Number(S['window.innerWidth']),
    `the claimed screen is not narrower than the window ` +
    `(screen ${S['screen.width']}, inner ${S['window.innerWidth']})`);
  eq(S['descriptor.hardwareConcurrency'], C['descriptor.hardwareConcurrency'],
    'the property descriptor still has a clean browser\'s shape');
}

// ── 4) the first load of a tab is the same machine as the second ───────────────
//
// [FIX stealth-first-load-noised-the-canvas]. The mode is decided from sessionStorage, and
// a fresh tab has none — so this is the axis where stealth answered as normal mode once and
// as stealth forever after. Pinned for the canvas alone by test/canvasmode.mjs; here it is
// asked of every value the collector reads, in all three configurations, because nothing
// says the canvas was the only one.
section('4) a tab\'s first load and its second are one machine');
//
// THE SEED SPLIT THAT USED TO BE EXCUSED HERE IS FIXED, so this is a hard assertion again.
// It read: canvas, WebGL readback, text metrics and battery all moving together between a
// fresh tab's two loads, which looked like the noise seed changing. It was not the seed —
// storage and the registration that spells it never moved, and the canvas was identical.
// What moved was battery.level, to 0.82, a LITERAL in profile-injector.js: only dyn/boot.js
// ever sent the device state, and when it did not run the bridge still delivered the machine
// and the seed, so everything looked right while the literal stood for the whole load.
// [FIX only-boot-js-could-send-the-device-state] gives it a second producer. Measured with
// tools/probe-seed.mjs, two paired batches on one machine with the order reversed between
// them: published HEAD 4 of 20 and 3 of 20, this tree 0 of 20 and 0 of 20.
//
// The concession that stood here — treating a move of those four values as a note rather
// than a failure — is gone with it. Leaving it would mean the suite accepting the very
// defect that was just closed.
for (const [name, run] of [['clean', clean], ['normal', normal], ['stealth', stealth]]) {
  const keys = Object.keys(run.second).filter((k) =>
    // The rig cannot hold these still — see the RIG list in tools/probe-time.mjs: under
    // Playwright's device-metrics emulation the native outer sizes are 0 and arrive late.
    !/^window\.outer(Width|Height)$/.test(k) &&
    // And these two the PROBE moves: the collector's getCurrentPosition is auto-denied on a
    // rig with no location provider, and the denial persists — so the first load leaves a
    // permission state the second load reads back. Measured on the CLEAN browser, which
    // has no extension in the path at all: prompt -> denied. Comparing an instrument's own
    // side effect across loads measures the instrument.
    !/^permissions\./.test(k) && k !== 'geolocation.position');
  const moved = keys.filter((k) => run.first[k] !== run.second[k]);
  eq(moved.length, 0,
    `${name}: nothing a page can read changes between a tab's first load and its second` +
    (moved.length ? ` — ${moved.map((k) => `${k} ${run.first[k]} -> ${run.second[k]}`).join('; ')}` : ''));
}

note(`clean/normal/stealth read ${Object.keys(C).length} values each`);
done();
