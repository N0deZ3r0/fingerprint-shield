/**
 * EVERYTHING A PAGE CAN READ, CLEAN AGAINST OURS.
 *
 *   node tools/probe-diff.mjs            the queue: differences nobody has judged
 *   node tools/probe-diff.mjs --all      every difference, accepted ones included
 *   node tools/probe-diff.mjs --stealth  measure STEALTH mode instead of normal
 *   node tools/probe-diff.mjs --headed   watch both browsers
 *
 * WHY THIS EXISTS, and why it is not any of the suites.
 *
 * Everything in test/ asks whether the extension CONTRADICTS itself — window against
 * worker, matchMedia against the CSS engine, one own-property list against a clean realm.
 * That is the right question for a spoof, and about four thousand assertions answer it.
 *
 * None of them ask the other question: what does this extension CHANGE, at all, that a
 * clean browser does not? A difference need not be a contradiction to be a signature. Three
 * that shipped, each individually defensible, none of them contradicting anything:
 *
 *   navigator.permissions.query({name:'geolocation'}).state
 *       clean 'prompt' on an origin never visited, ours 'granted' — one line of script,
 *       and it is deliberate (see mw/mw-misc.js), because 'prompt' beside a position
 *       delivered with no dialog is worse. Deliberate, and never counted.
 *   speechSynthesis.getVoices()
 *       reshaped to match the claimed locale, again deliberately.
 *   window.__t0 / window.__p0
 *       our own markers, non-enumerable, argued to cancel in the iframe diff CreepJS does.
 *
 * Each is written up where it lives. What did not exist is one place that adds them up, so
 * the answer to "how much of a signature is this build?" was a number nobody had.
 *
 * HOW IT STAYS USEFUL. Every difference is either on the ACCEPTED list below with a reason,
 * or it is in the queue and the exit code counts it. Accepting is cheap and explicit;
 * forgetting is not possible. A new difference — from our change or from a browser update —
 * arrives in the queue rather than in someone's fingerprint.
 *
 * THE CONTROL IS THE SAME BINARY. Both sides are the Chromium test/harness.mjs drives,
 * launched with the same arguments and the same kind of persistent profile; the only
 * difference is --load-extension. Anything else and the diff measures the launch.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, BROWSER } from '../test/harness.mjs';
import { EXPR } from './probe-collect.mjs';
import { settle } from './probe-settle.mjs';

const HEADED = process.argv.includes('--headed');
const SHOW_ALL = process.argv.includes('--all');
/**
 * The other configuration. Stealth forces _FEAT down to navigator/screen/timezone/webgl and
 * switches the rest off, so it changes strictly LESS than normal mode — which is its whole
 * purpose, and also why it is the half of the build nothing measured. An ACCEPTED matcher
 * that stops matching here is not an error: it describes a difference stealth does not make.
 * A difference in the QUEUE is, exactly as in normal mode.
 */
const STEALTH = process.argv.includes('--stealth');

/**
 * Differences that are the extension working, not the extension leaking. Each carries the
 * reason it is not a defect — a matcher without one is how a queue turns back into a diff.
 */
const ACCEPTED = [
  // --- the product: the machine and the locale the user selected ---
  [/^navigator\.(userAgent|appVersion|platform|hardwareConcurrency|deviceMemory|language|languages|vendor|maxTouchPoints|pdfViewerEnabled|doNotTrack)$/,
    'the machine and the locale ARE the profile — this is what the extension is for'],
  [/^uad\.(brands|mobile|platform|hev\.(architecture|bitness|model|uaFullVersion|fullVersionList|wow64|formFactors))$/,
    'client hints follow the same profile as the UA string'],
  [/^screen\./, 'the claimed panel, or the host panel where the window is wider than the claim'],
  [/^uad\.hev\.platformVersion$/,
    'the OS version is BUCKETED, and that is the point: the host reports its exact build ' +
    '(19.0.0 here), which is a per-machine value, while we answer 15.0.0 — the broad Win11 ' +
    'bucket. It follows the host FAMILY rather than pinning Win10: afpPlatformVersion reads ' +
    'the real major and maps >= 13 to Win11, which the service worker was measured doing ' +
    '(19 -> 15.0.0, cached). Judged, not assumed: the first run of this instrument put it in ' +
    'the queue, and answering it is what found the install window written up in ' +
    '[FIX ...] — see the note at the warm-up in read() below'],
  [/^window\.(inner|outer)(Width|Height)$/, 'clamped to the claimed screen — [FIX viewport-vs-layout]'],
  [/^window\.devicePixelRatio$/, 'part of the claimed panel'],
  [/^intl\./, 'the claimed locale'],
  [/^date\./, 'the claimed timezone, through every construction path'],
  [/^webgl\.(vendor|renderer|unmaskedVendor|unmaskedRenderer)$/, 'the claimed GPU'],
  [/^webgl\.param\./,
    'the claimed GPU\'s LIMITS, which travel with it — dyn/dev/<id>.js carries a measured ' +
    'ANGLE/D3D11 table per machine, because a renderer string naming an Iris Xe beside ' +
    'limits from the real driver is the contradiction [FIX cold-start-gl-limits] closed. ' +
    'This entry was missing for months and could not be noticed here: every machine this ' +
    'ran on had the same limits as the claim, so the rows were identical. The first CI run ' +
    'on a GPU-less Windows runner printed all three at once — clean 8192/8192/31 against ' +
    'ours 16384/16384/30 — which is the queue doing its job on a host the claim does not ' +
    'match. Note what is NOT here: webgl.extensions and webgl.precision stayed identical ' +
    'even there, because they are the host\'s and we do not touch them'],
  [/^webgpu\.(vendor|architecture|device|description)$/, 'the claimed GPU, same family as WebGL'],
  [/^media\.decode\.av1$/,
    'the claimed card\'s AV1 decoder: powerEfficient is downgraded to false for a card ' +
    'without one (only laptop_low\'s UHD 630 today) and never raised — ' +
    '[FIX decoder-answered-for-the-host-gpu]. Identical on every other row, so this ' +
    'matcher fires only when that row is selected'],
  [/^connection\./, 'substituted so a worker and a window cannot disagree about the network'],
  [/^battery\./, 'device state from the MASTER seed — same on every origin, unlike the canvas'],
  [/^plugins$|^mimeTypes$/, 'the five PDF entries a Windows Chrome reports'],

  // --- noise: the same shape, different numbers, on purpose ---
  [/^canvas\./, 'per-domain noise — the whole point of the canvas module'],
  [/^webglPixels$/, 'readback noise — [FIX two-machine-diff] measured a shaded readback as a carrier'],
  [/^fonts\.measureText$/,
    'TEXT METRIC NOISE, not the allowlist — the widths move by about 0.01px. A different ' +
    'mechanism from fonts.check below, and worth separating: one reason cannot cover both'],
  // Kept, but it has never matched and cannot: `document.fonts.check` is not an availability
  // oracle. It answers about FontFace loading state, and a clean browser returns true for a
  // family that cannot exist — measured, `check('12px "ZzQq No Such Family 9173"')` is true
  // with no extension in the path. So this key is identical on both sides by construction,
  // and the old reason here ("the extension can only SUBTRACT families the host has") was
  // describing the text metric, which is the entry above. Left in place so that a build
  // which somehow DOES make it differ lands in the queue rather than being waved through by
  // a matcher nobody rechecked.
  [/^fonts\.check$/,
    'never differs, and that is correct: a clean browser answers true even for a family ' +
    'that cannot exist, so there is nothing here to subtract. If this ever matches, ' +
    'something has started answering a question the platform does not answer'],

  // --- deliberate behaviour changes, each argued where it lives ---
  [/^permissions\.geolocation$/,
    "'granted' where clean says 'prompt'. The position is delivered with no dialog, so " +
    "'prompt' beside it is the contradiction — [FIX geo-perm-desync] in mw/mw-misc.js. " +
    'Worth re-reading now and then: it means any site can read a location without asking'],
  [/^geolocation\.position$/,
    'the claimed position, offset from the country centroid by the master seed. The rig ' +
    'cannot show the other half of this comparison — a headless clean browser has no ' +
    'location provider, so its side is an error rather than the host position'],
  [/^voices/, 'reshaped to match the claimed locale — [FIX speech-locale]; the default ' +
    "voice's language is what CreepJS folds into its Intl trust"],
  [/^media\.(dynamic-range|color-gamut|forced-colors|inverted-colors|monochrome|prefers-)/,
    'the desktop sRGB panel mw-misc forces matchMedia to describe'],
  [/^window\.own$/, 'our two markers, __t0 and __p0 — non-enumerable, and they cancel in the ' +
    'iframe diff CreepJS actually performs. Counted here so they are never forgotten'],
];

/**
 * Differences the RIG produces, which a real browser would not. Reported separately rather
 * than accepted, because "the extension does this" and "Playwright does this" are different
 * claims, and lumping them means a real regression in one can hide behind the other.
 */
const RIG = [
  ['navigator.webdriver', 'Playwright sets webdriver=true on the clean side; a real clean ' +
    'browser answers false, which is what we answer, so on a real machine this row is identical'],
];
const rig = (key) => RIG.find(([m]) => (m instanceof RegExp ? m.test(key) : m === key));

const accept = (key) => ACCEPTED.find(([m]) => (m instanceof RegExp ? m.test(key) : m === key));

/**
 * The collector moved to tools/probe-collect.mjs when tools/probe-time.mjs needed the same
 * list of values. It is imported as SOURCE TEXT rather than as a function because that is
 * what survives the trip into a page, and because the two consumers disagree about when to
 * call its two halves — see the header over there. The values, and so the counts this tool
 * prints, did not move in the lift.
 */

// ---------------------------------------------------------------------------

const server = createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    .end('<!doctype html><meta charset="utf-8"><title>diff</title><body>probe');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const URL_ = `http://127.0.0.1:${port}/`;

async function read(withExtension) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fpsdiff-'));
  const args = withExtension
    ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    : [];
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !HEADED,
    // --disable-extensions must go for the extension side, so it goes for BOTH: the clean
    // run has to be launched the same way or the diff measures the launch.
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args,
    permissions: ['geolocation'],
  });
  try {
    if (STEALTH && withExtension) {
      const sw = ctx.serviceWorkers()[0]
        || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 3000));
      await sw.evaluate(async () => { await chrome.storage.local.set({ afp_mode: 'stealth' }); });
      await new Promise((r) => setTimeout(r, 2000));
    }
    const page = await ctx.newPage();
    // FOUR loads before measuring, and the number was arrived at the hard way. A profile
    // made by mkdtemp is a FRESH INSTALL, and for the first seconds of one this extension is
    // still assembling itself: the dynamic DNR rules are not registered, the cold-start dyn/
    // scripts are not registered, and the profile has not reached the page. Measured in
    // exactly that window, getHighEntropyValues answered platformVersion '10.0.0' — the
    // fallback literal in mw-navigator's _forceUAD — where the settled answer is '15.0.0',
    // and three outgoing requests carried the HOST's real sec-ch-ua-platform-version.
    //
    // That window is a real defect with its own write-up. It is not what this instrument is
    // for: reporting it every run would bury the steady-state differences under
    // install-window noise, which is how a queue stops being read. So the extension side is
    // warmed until it settles — and the clean side gets the same four loads, because the two
    // must be driven identically or the diff measures the driving.
    for (let i = 0; i < 4; i++) await page.goto(URL_ + '?warm=' + i, { waitUntil: 'load' });
    // And a reload on top: 'v.ui.f' and 'v.ui.m' do not exist on a tab's FIRST load, so a
    // first-load reading measures the defaults rather than the configuration — the subject
    // of [FIX a-switch-off-its-default-was-inert-on-the-first-load].
    await page.reload({ waitUntil: 'load' });
    // And then wait for the install to have SETTLED rather than trusting that five loads
    // were enough. They are on this machine; the first CI browser run showed they are not
    // on a slower one, where the platform version was still mw-navigator's fallback literal
    // and the GL limits were still the host's. test/stealth.mjs was fixed for that and these
    // two tools were left counting loads, which put the same trap under both — they are run
    // by hand on a fast machine, so it had simply never fired. See tools/probe-settle.mjs.
    if (withExtension) {
      const st = await settle(page, URL_);
      if (!st.settled) console.log('   warning: the profile never settled; reading anyway');
      else if (st.loads) console.log(`   (${st.loads} extra load(s) to settle: ${st.value})`);
    }
    return await page.evaluate(EXPR);
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  }
}

const clean = await read(false);
const ours = await read(true);
server.close();

// Same two-sided mode check tools/probe-time.mjs makes, and for the same reason: a
// --stealth run that quietly measured normal mode would print a perfectly ordinary report,
// and "the suite ran the wrong build and went green" is a mistake this project has paid for
// more than once. Stealth switches canvas and fonts OFF, so with it engaged those two must
// read the host's own values and be IDENTICAL to the clean side.
if (STEALTH) {
  const canvasOff = clean['canvas.2d'] === ours['canvas.2d'];
  const fontsOff = clean['fonts.measureText'] === ours['fonts.measureText'];
  console.log(`\n### MODE CHECK — canvas off ${canvasOff ? 'yes' : 'NO'}, fonts off ${fontsOff ? 'yes' : 'NO'}`);
  if (!canvasOff || !fontsOff) {
    console.log('   STOP — either stealth never engaged and this is a NORMAL-mode report,');
    console.log('   or those two gates stopped firing. Do not read the diff below as stealth.');
    process.exitCode = 1;
  }
}

const keys = [...new Set([...Object.keys(clean), ...Object.keys(ours)])].sort();
const diffs = keys.filter((k) => clean[k] !== ours[k]);
const rigged = diffs.filter((k) => rig(k));
const known = diffs.filter((k) => !rig(k) && accept(k));
const queue = diffs.filter((k) => !rig(k) && !accept(k));

const trim = (v) => { const s = String(v === undefined ? '(absent)' : v); return s.length > 62 ? s.slice(0, 59) + '...' : s; };

console.log(`\n${keys.length} values read, ${keys.length - diffs.length} identical, ${diffs.length} different\n`);

if (SHOW_ALL && known.length) {
  console.log(`### ACCEPTED (${known.length}) — the extension working`);
  for (const k of known) {
    console.log(`   ${k}`);
    console.log(`      clean ${trim(clean[k])}`);
    console.log(`      ours  ${trim(ours[k])}`);
    console.log(`      why   ${accept(k)[1]}`);
  }
  console.log('');
} else if (known.length) {
  console.log(`${known.length} accepted difference(s) hidden — --all shows them with their reasons\n`);
}

if (rigged.length) {
  console.log(`### RIG (${rigged.length}) — Playwright, not the extension`);
  for (const k of rigged) {
    console.log(`   ${k}  clean ${trim(clean[k])} / ours ${trim(ours[k])}`);
    console.log(`      ${rig(k)[1]}`);
  }
  console.log('');
}

console.log(`### QUEUE (${queue.length}) — differences nobody has judged`);
for (const k of queue) {
  console.log(`   ${k}`);
  console.log(`      clean ${trim(clean[k])}`);
  console.log(`      ours  ${trim(ours[k])}`);
}

console.log(`\n=== ${queue.length} unjudged difference(s) ===`);
process.exitCode = queue.length;
