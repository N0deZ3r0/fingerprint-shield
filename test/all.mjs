/**
 * Every check in one command.
 *
 *   npm test              lint + the Node suites (no browser, a few seconds)
 *   npm run test:browser  the Playwright dev-page suite on its own
 *   npm run test:all      both
 *
 * Each suite still runs standalone — `node test/tables.mjs` and friends work exactly
 * as before, and that is the way to read a failure. This runner exists so that the
 * whole set has one entry point and one exit code, instead of six commands to
 * remember and six places to forget one.
 *
 * Suites run in cheapest-first order so a syntax error surfaces in a second rather
 * than after a browser launch.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withBrowser = process.argv.includes('--browser');

const SUITES = [
  ['lint', ['node_modules/eslint/bin/eslint.js', '.']],
  ['defaults ↔ core', ['test-defaults.cjs']],
  ['static parity', ['test/parity-static.mjs']],
  ['node regressions', ['test/node-all.mjs']],
  ['timezones vs ICU', ['test/tz-icu.mjs']],
  ['country/profile tables', ['test/tables.mjs']],
  // Five rules that used to be a warning box in the popup, over a table no shipped row could
  // trigger. A coherence check on a const table is a build-time check; here it fails the
  // suite instead of reaching a user who cannot act on it. Node-only.
  ['profile coherence', ['test/profilecoherence.mjs']],
  ['background.js functions', ['test/background-fns.mjs']],
  // Static, and it belongs with the cheap set: it opens no browser, it only asks whether
  // the extension SHIPPABLE from this tree is complete. Every path the manifest names,
  // every path background.js names, every src/href in every shipped page, dyn/ whole, and
  // no top-level underscore — the last of which once made real Chrome refuse the whole
  // extension while every Playwright suite passed, because --load-extension skips that
  // validation. See tools/pack.mjs.
  ['extension package', ['tools/pack.mjs', '--check']]
];
if (withBrowser) SUITES.push(['dev pages (Chromium)', ['test/run.mjs']]);
// Loads the extension for real (--load-extension), so it belongs with the browser set
// rather than the Node ones; content-script timing is what it measures.
if (withBrowser) SUITES.push(['cold start (Chromium)', ['test/coldstart.mjs']]);
// Also --load-extension, and for the same reason as test/stackleak.mjs: both ask whether a
// page can see chrome-extension:// in something the browser wrote, which is unanswerable
// over plain http. This one launches a second, extension-free browser as its control.
if (withBrowser) SUITES.push(['error stacks (Chromium)', ['test/stackleak.mjs']]);
if (withBrowser) SUITES.push(['CSP attribution (Chromium)', ['test/cspattribution.mjs']]);
// The other class of defect: not "the page can tell" but "the page breaks". A <form> whose
// controls are named after element properties made isBait read an <input> and throw into the
// page's own getComputedStyle — reported from github.com. The fixture for it lives in
// dev-adblockmask.html and CANNOT FAIL there, because test/run.mjs launches a plain browser
// and there is no wrapper in front of anything. This runs it against the real extension, with
// a clean control and a live mask as the positive one.
if (withBrowser) SUITES.push(['page still works (Chromium)', ['test/pagework.mjs']]);
// The ACCESSOR half of pagework's part 4. Every accessor on Screen/Navigator/NavigatorUAData/
// NetworkInformation and window's nine [Global] geometry getters, called with twelve
// receivers — the prototype, a branded-but-slotless object, a proxy, {}, null, undefined,
// document.all, the wrong platform object and a same-origin iframe's instance — window and
// worker, against a clean browser. Only THROW-vs-ANSWER is compared; the own instance's value
// is the spoof and is printed, never asserted. The cross-realm column is what no brand check
// can express: isPrototypeOf is false across realms while the native accessor answers there,
// so `_namedGetter`'s check throws where clean returns, and the sites with no check at all
// answer where clean throws.
if (withBrowser) SUITES.push(['accessor receivers (Chromium)', ['test/receivers.mjs']]);
// Sibling axis: what a wrapped function LOOKS like (name/length/toString), enumerated
// rather than taken from a hand list — see the header there for the two it found.
if (withBrowser) SUITES.push(['function shape (Chromium)', ['test/fnshape.mjs']]);
// The two modes defined by a hand-written table in mw-core: host mode substitutes no
// hardware, stealth turns off what its flag table says. Both checked by enumeration, with
// the table read out of the source rather than retyped.
if (withBrowser) SUITES.push(['mode claims (Chromium)', ['test/modeclaims.mjs']]);
// A smoke alarm on what a patched read costs. Deliberately loose — the header measures four
// runs of one unchanged build to show why a plain ratio flakes here — so it catches a
// microsecond added to a hot path and nothing finer. tools/probe-textcost.mjs is what judges
// a real change.
if (withBrowser) SUITES.push(['cost budget (Chromium)', ['test/costceiling.mjs']]);
// Each of the 13 popup switches, on and off, against the real extension and a clean browser
// beside it. dev-perflag.html asks whether a reference is still patched; this asks whether
// the value is the profile's — a patched reference returning the host's answer passes that
// one and fails this one.
if (withBrowser) SUITES.push(['feature switches (Chromium)', ['test/modules.mjs']]);
// Battery and geolocation on TWO origins at once. They are device STATE, so they must be
// identical there, while canvas noise must still differ — and no single-origin suite can
// see the difference, because every value is individually plausible. That is how they were
// derived from the per-domain seed for so long. See [FIX device-state-was-per-domain].
if (withBrowser) SUITES.push(['device state (Chromium)', ['test/devicestate.mjs']]);
// Geolocation must stay refused where the platform refuses it — under a disabling
// Permissions-Policy, and in a cross-origin iframe embedded without allow="geolocation",
// which is how ads and widgets are framed. The patch used to answer `success` there
// regardless, which is a consent failure before it is a detection signal. Every row is
// compared against a clean browser, so "refuse everything" would fail it too.
if (withBrowser) SUITES.push(['geo permissions (Chromium)', ['test/geopolicy.mjs']]);
// Reads the whole observable surface under two maximally different profiles and lists what
// did NOT move — those values are the host's, and they are what a visitor id is built from.
// Mostly a readout; the one assertion guards the count from growing.
if (withBrowser) SUITES.push(['host leaks (Chromium)', ['test/hostleak.mjs']]);
// dev-mediaparity.html can only ask about the panel this machine has, and the rig is the
// desktop sRGB box mw-misc forces matchMedia to describe - so every forced answer was true
// here and the page was green with a live contradiction one wide-gamut laptop away. This
// re-runs it with the panel emulated in the ENGINE, and checks the emulation took first.
if (withBrowser) SUITES.push(['emulated displays (Chromium)', ['test/mediadisplay.mjs']]);
// Guards a REMOVED patch rather than a present one: the audio noise was measured as louder
// than the fingerprint it hid and taken out, and until now only a comment kept it out.
// Compares against a clean browser, so it carries to any rig or Chrome build.
if (withBrowser) SUITES.push(['audio untouched (Chromium)', ['test/audio.mjs']]);
// The per-site service-worker switch. A site's own worker reads the real machine and no MV3
// extension can patch that scope, so allow/deny is the only lever there is — this checks the
// lever: default allow, a blocked host refused in the browser's own shape before its first
// script, the worker it installed earlier already gone, and the next host untouched.
if (withBrowser) SUITES.push(['service worker switch (Chromium)', ['test/swswitch.mjs']]);
// Chrome caps a popup at 600px and scrolls past it. Nothing measured that until a new row
// pushed the resting height to 652, so this holds the height AND drives both per-site
// switches through the real popup script — a renamed element would otherwise leave the UI
// silently inert with every other suite green.
if (withBrowser) SUITES.push(['popup fits (Chromium)', ['test/popupfit.mjs']]);
// The other half of the same window: can it be USED without a mouse, and do its controls
// report their own state. Measured before this suite existed: 67 country rows and 7 machine
// rows, none of them reachable from a keyboard, and aria-checked null on all three switches.
if (withBrowser) SUITES.push(['popup keyboard (Chromium)', ['test/popupkeys.mjs']]);
// The invariant the stand-down exists for: the window may not claim more than the page's
// own workers can be made to claim. Three CSP shapes on three routes — refused, creatable
// but unpatchable, and patchable — plus the per-site rewrite on the shape that was
// reported broken from a real github.com tab.
if (withBrowser) SUITES.push(['worker patch gate (Chromium)', ['test/workerpatchgate.mjs']]);
// The realm axis itself: thirteen realms — window, six frame shapes, cross-origin, and five
// worker kinds — read with ONE signal set and compared against a second browser with no
// extension loaded. The clean run decides which fields are comparable in which realm, so the
// exclusions are measured rather than listed, and a frame that redefines a property on itself
// is carried as the negative control.
if (withBrowser) SUITES.push(['realm matrix (Chromium)', ['test/realmmatrix.mjs']]);
// The TIME axis, which had the best instrument in the repository and no verdict: every
// readable value at eight moments across a load and a reload, against a clean browser, with
// the queue asserted empty. Its negative control is a second, --cold sweep that MUST find
// the install window — a green warm run alone passes on a broken collector just as well.
if (withBrowser) SUITES.push(['time axis (Chromium)', ['test/timeaxis.mjs']]);
// The options page is the only place either per-site list can be READ or cleared, and an
// invisible list is what made the WebRTC switch look broken for weeks. Drives the real page:
// what it shows, what Clear does to storage AND to the document_start registration that
// mirrors it, and whether it follows a change made from the popup while it is open.
if (withBrowser) SUITES.push(['options lists (Chromium)', ['test/optionslists.mjs']]);
// The exit country: the one axis the extension cannot see about itself, since every other
// guarantee here is the browser measured against itself. Mostly hermetic — the reading is
// seeded, so what is tested is when a warning appears and, as much, when it must not.
if (withBrowser) SUITES.push(['exit country (Chromium)', ['test/exitcountry.mjs']]);
// The three scripts README.txt tells users to paste, judged by their VERDICT against the
// real extension — dev-consolechecks.html only proves they load and emit rows. That gap let
// four separate rots ship, each reporting FAIL on a correct build. It also watches the
// console, because one of them made the extension look like it was throwing WebGL errors.
if (withBrowser) SUITES.push(['self-checks pass (Chromium)', ['test/consolechecks.mjs']]);
// CreepJS's second litter collector: own window NAMES diffed against a fresh iframe, where
// non-enumerable hides nothing. It caught the WASM markers that an earlier fix had only
// made non-enumerable, so the pair is handed over and deleted now — and the control run is
// what tells "the extension adds nothing" apart from "the probe found nothing".
if (withBrowser) SUITES.push(['client litter (Chromium)', ['test/clientlitter.mjs']]);
// getHighEntropyValues, hint list by hint list, window AND worker, each against a clean
// browser. The wrapper answered hints nobody asked for — 11 keys where Chrome returns 3 —
// and nothing here could see it: dev-wvw.html asks for all eight at once, so a wrapper that
// returns all eight always is indistinguishable from a correct one, and coldstart reads a
// partial list but only checks one VALUE. The expected sets are read from the clean browser
// rather than written down, so a hint added to the platform cannot make this go stale.
if (withBrowser) SUITES.push(['UA-CH answer shape (Chromium)', ['test/uachshape.mjs']]);
// Window against Worker on a trusted-types origin. The wrapper used to stand down there and
// leave the worker reporting the REAL machine while the window reported the profile — four
// contradictions in one document, and the measured cause of Cloudflare Turnstile's 600010.
// Both answers are pinned: where the allowlist names `default` we install that policy and
// the worker is patched, where it does not the window goes quiet instead. Either way the two
// scopes agree, which is the only thing a site can check.
if (withBrowser) SUITES.push(['worker vs window on TT (Chromium)', ['test/ttworker.mjs']]);
// Stealth mode, gate by gate, against a clean browser AND against normal mode. It is a
// second configuration of this extension with — until this suite — a fraction of the first
// one's coverage, which is where its two shipped bugs came from. Three browsers, because
// "stealth matches a clean browser here" also passes when the module was broken in both;
// the run that proves the check is not vacuous is normal mode. It found connection, battery
// and geolocation still splitting a tab's first load from its second, the same defect the
// canvas had been fixed for.
if (withBrowser) SUITES.push(['stealth mode (Chromium)', ['test/stealth.mjs']]);
// A blob-refusing origin must keep the worker it asks for. Every worker this extension
// wraps is built from a blob, so a CSP that omits blob: from its worker sources refuses the
// construction and the page holds a dead object — reported from github.com. Its own file
// rather than a row in cspattribution because two assertions there PASSED against a build
// without the fix: that fixture is too small and too warm to lose the race the bug lives in.
if (withBrowser) SUITES.push(['blob-CSP origins (Chromium)', ['test/blobcsp.mjs']]);
if (withBrowser) SUITES.push(['worker-gap coherence (Chromium)', ['test/wbcoherence.mjs']]);
// "This machine": every hardware axis must read as a clean browser of the same binary, in
// the window, the worker and the iframe alike, while the identity stays the profile's and
// the opted-in hardware hints go out with the browser's own values. Three browsers: the
// third is a table row on the same rig, which has to MOVE every field the host row left
// alone — without it, an extension that did nothing would pass.
if (withBrowser) SUITES.push(['host mode (Chromium)', ['test/hostmode.mjs']]);
// The per-site CSP rewrite: a youtube.com-shaped origin (three CSP headers, a nonce, a
// blob-refusing allowlist, trusted types with a default policy that cannot mint URLs)
// stands down by default and reports the profile in the window, the worker and the
// iframe once the switch is on — while its nonce-authorised inline script still runs, a
// script from a foreign origin is still refused, and a bare-string worker still throws.
if (withBrowser) SUITES.push(['CSP rewrite switch (Chromium)', ['test/csprewrite.mjs']]);
// Own properties, against a second BROWSER. dev-ownprops.html asks the same question and
// cannot answer it: it diffs the window against a same-origin IFRAME, which our content
// scripts also patch, and under test/run.mjs neither side has the extension at all — so it
// reports 0 whatever happens. Three lies of this shape shipped behind it in one day
// (navigator.connection, document.documentElement, speechSynthesis), each a plausible VALUE
// on an object whose SHAPE no browser produces.
if (withBrowser) SUITES.push(['own properties (Chromium)', ['test/ownprops.mjs']]);
// The Date/Intl layer against Node launched IN the profile's zone — the one oracle that
// says "correct for the machine presented", which no self-consistency check can. It found
// the setters computing on the UTC day, pre-2000 M/D/YYYY dates collapsing to year 1113,
// an explicit timeZone option overridden and Intl.Locale gaining a region, all while every
// suite above was green. Window and worker, two profiles: a half-hour zone (Kolkata) shows
// arithmetic a whole-hour one hides.
if (withBrowser) SUITES.push(['date layer vs zone oracle (Chromium)', ['test/tz-oracle.mjs']]);
// The layout against the viewport APIs. A window cannot be wider than its monitor and CSS
// is not ours to fake, so clamping innerWidth/innerHeight to a claimed screen SMALLER than
// the real window produced a refutable lie: every API said 1920 while the page laid out at
// 2008.5, one line apart. mw-core now raises the claim to at least the native screen and
// innerHeight keeps its real value whenever the window fits.
if (withBrowser) SUITES.push(['viewport vs layout (Chromium)', ['test/viewport.mjs']]);
// Not a contradiction check like everything above it, and that is the point: it asks what
// this build CHANGES at all against a clean browser of the same binary, and every difference
// must be judged in its ACCEPTED list or it lands in the queue and turns this red. Three
// things that shipped were differences without being contradictions — the geolocation
// permission reading 'granted' where clean says 'prompt', the reshaped voice list, and our
// two window markers — each defensible, none of them counted anywhere until this existed.
if (withBrowser) SUITES.push(['clean vs ours (Chromium)', ['tools/probe-diff.mjs']]);
// The shipped audit page, driven the way a user drives it. It gets a suite on the day it
// lands rather than after the four rots the console-check scripts accumulated while nothing
// ran them. Judges the VERDICT, not merely that the page loads — and asserts the check COUNT
// has not shrunk, because "all 3 checks passed" reads exactly like "all 18 checks passed" to
// anything that only greps for green.
if (withBrowser) SUITES.push(['audit page (Chromium)', ['test/auditpage.mjs']]);
// A Trusted Types refusal at a worker sink, ours against clean. Where the wrapper keeps its
// proxy — the CSP rewrite on youtube.com — the page's own refused string used to reach the
// native constructor through our frame, and the browser charged the refusal to us; the
// user's chrome://extensions listed it twice in one evening. Where THIS document's headers
// said enforcing the wrapper now answers the call itself: same TypeError, same stack, the
// default policy consulted once with the same arguments, nothing on the sink. Two controls
// guard the two ways to get that wrong (accepting what the browser refuses, refusing what it
// accepts on a host that merely enforced before).
if (withBrowser) SUITES.push(['TT refusal shape (Chromium)', ['test/ttrefusal.mjs']]);
// CSP restrictions per ROUTE: one host, a strict route and a loose one, the profile de-DE
// against the rig's own language. The loose route keeps the profile in JS, on the document
// request and on its fetches; the strict one stands down on all three; ten alternating
// loads in one tab give the same answers every time. The header half is what a per-document
// verdict could never give (the open-work list 0e) and what a JS-only per-route list would have broken.
if (withBrowser) SUITES.push(['CSP per route (Chromium)', ['test/cspscope.mjs']]);
// CreepJS's OWN pages, ours against clean. Everything above asks whether this build
// contradicts itself; these two ask whether the values are what a browser's libraries would
// produce, which is the question that found the zone model applying 2026's DST rule to the
// year 1113 — reported by the user from a real Chrome while all 38 suites were green. The
// fixtures are upstream files, unmodified, and the verdict is a comparison: ours may add no
// marker a clean browser does not also get.
if (withBrowser) SUITES.push(['CreepJS pages (Chromium)', ['test/creepjs.mjs']]);
// getParameter with a pname the context refuses. Reported from hh.ru as an error of THIS
// extension; measured as the page's own warning, charged to us because Chrome names the
// innermost script frame. The suite exists to stop the tempting fix: answering null from a
// table instead of asking the driver would silence the console and, in the same line, make
// getError() say NO_ERROR where every real browser says INVALID_ENUM — a console line no
// script can read traded for a detector any script can run.
if (withBrowser) SUITES.push(['WebGL enum refusals (Chromium)', ['test/glenum.mjs']]);
// Two claims nothing asserted. The Bluetooth one was decided ONCE at install, against the
// injector's fallback skeleton, so it never fired — and its mechanism deleted
// navigator.bluetooth while leaving the global constructor standing, a browser that does not
// exist; the guard therefore pins the whole surface against clean, not just the answer.
// gl.readPixels was noised in the window and in neither worker, which a page reads with one
// `new Worker()`. Both need the extension loaded for real with a clean browser beside it, so
// neither fits a dev page. Its last rows are RED on purpose today — the readback rollback
// still decides flatness inside the returned buffer, so a 1x1 read and the same pixel inside
// a block disagree in all three scopes. See the header.
if (withBrowser) SUITES.push(['Bluetooth + GL readback (Chromium)', ['test/btreadback.mjs']]);

/**
 * The one-line-per-suite summary. Each suite states its own count in its own words, so
 * this looks for the shapes actually in use — and looks for them from the top, since
 * test/run.mjs prints a "not covered by this runner" list AFTER its verdict and a
 * last-line-wins scan picks up the tail of that list instead.
 */
const VERDICT_SHAPES = [
  /^all \d+ (?:suites|checks) passed$/i,
  /^\d+ of \d+ checks FAILED$/i,
  /^\d+ passed, \d+ failed$/i,
  /^All static parity assertions passed\.$/,
  /^OK /
];
function verdict(out) {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const shape of VERDICT_SHAPES) {
    const hit = lines.filter((l) => shape.test(l)).pop();
    if (hit) return hit;
  }
  return lines[lines.length - 1] || '';
}

const results = [];
let failed = 0;

for (const [name, argv] of SUITES) {
  // Only when a human is watching: piped into a file or another process, a \r does not
  // erase anything and every result line ends up with the progress line glued in front.
  if (process.stdout.isTTY) process.stdout.write(`…   ${name}\r`);
  const started = Date.now();
  const r = spawnSync(process.execPath, argv, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(name.length + 4) + '\r');
  results.push({ name, ok, secs, line: ok ? verdict(out) : '' });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(24)} ${secs.padStart(5)}s  ${ok ? verdict(out) : ''}`);
  if (!ok) {
    failed++;
    // A failing suite prints in full: this runner is not where a failure gets diagnosed,
    // it just has to not hide anything.
    console.log('\n' + '-'.repeat(70));
    console.log(out.trimEnd() || `(no output, exit code ${r.status})`);
    console.log('-'.repeat(70) + '\n');
  }
}

console.log('');
if (failed) {
  console.log(`${failed} of ${results.length} suites failed: ${results.filter((r) => !r.ok).map((r) => r.name).join(', ')}`);
} else {
  console.log(`all ${results.length} suites passed`);
  if (!withBrowser) console.log('the Chromium dev-page suite was not run — `npm run test:browser`');
}
process.exit(failed ? 1 : 0);
