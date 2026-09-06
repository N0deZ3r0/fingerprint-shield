/**
 * THE PAGE TRIES TO TAKE THE MACHINE BACK.
 *
 *   node test/tamper.mjs             headless
 *   node test/tamper.mjs --headed    watch it
 *
 * Every other suite here reads the surface politely. This one attacks it: a page that
 * suspects it is being lied to has a short list of things to try, and each of them has two
 * possible failures rather than one.
 *
 *   THE LEAK      the attack works and the host machine comes back
 *   THE TELL      the attack fails DIFFERENTLY from how it fails in a clean browser
 *
 * The second is the one that gets missed, because nothing leaks and the value on screen
 * still looks right. It is what this file was written on the back of. Measured before the
 * fix, on a page that does nothing but build one iframe:
 *
 *   const f = <same-origin iframe, sandbox="allow-same-origin", no allow-scripts>
 *   Object.getOwnPropertyDescriptor(f.contentWindow.Navigator.prototype,
 *     'hardwareConcurrency').get.call(navigator)
 *
 *   clean browser   18
 *   ours            TypeError: Illegal invocation
 *
 * A page learns nothing about the machine there and everything about the extension. The
 * cause was the last `isPrototypeOf` brand check in the codebase: v2.5.11 replaced that rule
 * with the captured native everywhere it could see, and the parent-side frame patch in
 * mw-navigator is its own path past `_def`, so test/receivers.mjs — which sweeps within a
 * realm — could not reach it. A scriptless sandboxed frame is the one shape where our
 * scripts cannot run and the parent can still touch the globals, which is exactly what makes
 * it a pristine realm a page can borrow from.
 *
 * THE RULE IS SHAPE FROM CLEAN, VALUE FROM US. For every attack:
 *
 *   1. the answer must never be the host's;
 *   2. the attack must have the same EFFECT it has in a clean browser. Where a clean
 *      browser lets the page redefine navigator.hardwareConcurrency to 99, so do we — the
 *      page is lying to itself and stopping it would be the tell. Where a clean browser
 *      keeps its value, we keep ours.
 *   3. a refusal must be the same refusal: same error name, for the same receivers.
 *
 * AND THE ATTACKS THEMSELVES ARE CONTROLLED. An attack that does nothing in a clean browser
 * proves nothing about us, so each one is checked to have MOVED the clean browser first —
 * three of them are supposed to, and the file fails if they stop.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';

const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>tamper</title></head><body>
<script>
window.__run = new Promise(function (done) {
  var out = {};
  var R = function (k, f) { try { var v = f(); out[k] = (v === undefined ? 'undefined' : String(v)); }
                            catch (e) { out[k] = 'THREW:' + e.name; } };
  var cores = function () { return navigator.hardwareConcurrency; };

  // ── the baseline every row below is judged against ────────────────────────
  R('base.cores', cores);
  R('base.lang', function () { return navigator.language; });
  R('base.screenW', function () { return screen.width; });
  R('base.tz', function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; });

  // ── plain mutation, in the order a page would actually try it ─────────────
  R('assign', function () { navigator.hardwareConcurrency = 99; return cores(); });
  R('deleteOwn', function () { delete navigator.hardwareConcurrency; return cores(); });
  R('defineOnInstance', function () {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 99, configurable: true });
    return cores();
  });
  R('deleteAfterDefine', function () { delete navigator.hardwareConcurrency; return cores(); });
  R('defineOnProto', function () {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency',
      { get: function () { return 77; }, configurable: true });
    return cores();
  });
  // Everything after this point must not depend on hardwareConcurrency: the page has just
  // replaced it for itself and a clean browser lets it.
  R('freezeScreen', function () { try { Object.freeze(screen); } catch (e) {} return screen.width; });
  R('setProtoNull', function () { var n = navigator; Object.setPrototypeOf(n, null); return n.language; });

  // ── the pristine realm ────────────────────────────────────────────────────
  // A same-origin sandbox WITHOUT allow-scripts: our content scripts cannot run in it and
  // the parent can still reach its globals. That is a clean set of interface prototypes,
  // handed to the page by the platform.
  var f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-same-origin');
  f.srcdoc = '<!doctype html><body>x';
  f.style.display = 'none';
  f.onload = function () {
    var w = f.contentWindow;
    var D = function (ctor, p) { return Object.getOwnPropertyDescriptor(w[ctor].prototype, p); };
    R('frame.scriptsRan', function () { return !!w.__p0; });
    R('frame.navOnTop', function () { return D('Navigator', 'hardwareConcurrency').get.call(navigator); });
    R('frame.langOnTop', function () { return D('Navigator', 'language').get.call(navigator); });
    R('frame.screenOnTop', function () { return D('Screen', 'width').get.call(screen); });
    R('frame.ownNav', function () { return w.navigator.hardwareConcurrency; });
    R('frame.intl', function () { return new w.Intl.DateTimeFormat().resolvedOptions().timeZone; });
    // The numeric side of Date in that realm. It used to answer from the HOST while the
    // string side of the same object answered from the profile.
    R('frame.offJan', function () { return new w.Date(2026, 0, 15).getTimezoneOffset(); });
    R('frame.offJul', function () { return new w.Date(2026, 6, 15).getTimezoneOffset(); });
    R('frame.hours', function () { var d = new w.Date(1767225600000); return d.getHours() + ':' + d.getMinutes(); });
    R('frame.dateStr', function () { return new w.Date(2026, 0, 15).toString().replace(/^[^(]*/, ''); });
    R('frame.setHoursArity', function () { return w.Date.prototype.setHours.length; });
    R('top.offJan', function () { return new Date(2026, 0, 15).getTimezoneOffset(); });
    R('top.offJul', function () { return new Date(2026, 6, 15).getTimezoneOffset(); });
    R('top.hours', function () { var d = new Date(1767225600000); return d.getHours() + ':' + d.getMinutes(); });
    R('top.dateStr', function () { return new Date(2026, 0, 15).toString().replace(/^[^(]*/, ''); });
    // The refusals have to be the platform's, for the same receivers.
    R('frame.onPlainObject', function () { return D('Navigator', 'hardwareConcurrency').get.call({}); });
    R('frame.onPrototype', function () {
      return D('Navigator', 'hardwareConcurrency').get.call(w.Navigator.prototype);
    });
    R('frame.onNull', function () { return D('Navigator', 'hardwareConcurrency').get.call(null); });
    R('frame.onWrongType', function () { return D('Navigator', 'hardwareConcurrency').get.call(screen); });
    done(out);
  };
  document.body.appendChild(f);
  setTimeout(function () { done(out); }, 6000);
});
</` + `script></body></html>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

async function go(withExtension) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-tamper-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: !headed,
    ...(withExtension
      ? {
        ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
        args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
      }
      : {})
  });
  try {
    if (withExtension) {
      ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 2500));
    }
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    return { got: await p.evaluate(() => window.__run), errors };
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
  }
}

try {
  const cleanRun = await go(false);
  const oursRun = await go(true);
  const clean = cleanRun.got, ours = oursRun.got;
  for (const [label, run] of [['clean', cleanRun], ['ours', oursRun]]) {
    ok(run.errors.length === 0, `the ${label} page threw nothing (${run.errors.join(' | ') || 'none'})`);
  }

  const KEYS = Object.keys(ours);
  console.log('attack'.padEnd(20) + 'clean'.padEnd(24) + 'ours');
  for (const k of KEYS) console.log(k.padEnd(20) + String(clean[k]).padEnd(24) + String(ours[k]));

  // ── 1) the attacks are real ────────────────────────────────────────────────
  // An attack a clean browser shrugs off proves nothing when we shrug it off too.
  console.log('\n== 1) the attacks move a clean browser (without this the rest is theatre)');
  ok(clean.defineOnInstance === '99', `defineProperty on the instance works in clean (${clean.defineOnInstance})`);
  ok(clean.defineOnProto === '77', `defineProperty on the prototype works in clean (${clean.defineOnProto})`);
  ok(clean['frame.navOnTop'] === clean['base.cores'],
    `the pristine realm's getter answers for the top navigator in clean (${clean['frame.navOnTop']})`);
  ok(clean['frame.scriptsRan'] === 'false',
    'and nothing of ours could have run in that frame anyway — it has no allow-scripts');

  // ── 2) nothing hands the host back ─────────────────────────────────────────
  console.log('\n== 2) no attack returns the host machine');
  const host = { cores: clean['base.cores'], lang: clean['base.lang'], screenW: clean['base.screenW'], tz: clean['base.tz'] };
  console.log(`   host: ${host.cores} cores, ${host.lang}, ${host.screenW}px, ${host.tz}`);
  ok(ours['base.cores'] !== host.cores, `the machine is presented at all (${ours['base.cores']} vs ${host.cores})`);
  // [FIX the-not-the-host-check-collided-on-a-us-english-runner] "the answer is not the
  // host's" says nothing about a field where the profile and the machine legitimately AGREE.
  // On this author's machine the host is ru-RU and the check passed; on the CI runner the
  // host is en-US, the profile claims en-US, and the assertion failed while nothing was
  // wrong. Same shape as the realm matrix's glVendor, which does not move because host and
  // profile are both Intel.
  //
  // So the comparable set is DERIVED: a field is only worth this assertion where the two
  // differ in the top window to begin with, and the size of that set is asserted so the
  // derivation cannot quietly empty it.
  const differs = { cores: ours['base.cores'] !== host.cores, lang: ours['base.lang'] !== host.lang,
    screenW: ours['base.screenW'] !== host.screenW, tz: ours['base.tz'] !== host.tz };
  const moved = Object.values(differs).filter(Boolean).length;
  console.log('   fields where the profile differs from this machine at all: ' +
    Object.keys(differs).filter((k) => differs[k]).join(', '));
  ok(moved >= 2,
    `the profile differs from this machine on enough fields to test with (${moved} of 4)`);
  for (const [k, h, axis] of [['frame.navOnTop', host.cores, 'cores'], ['frame.ownNav', host.cores, 'cores'],
    ['frame.langOnTop', host.lang, 'lang'], ['frame.screenOnTop', host.screenW, 'screenW'],
    ['frame.intl', host.tz, 'tz'], ['setProtoNull', host.lang, 'lang']]) {
    if (!differs[axis]) continue;
    ok(ours[k] !== h, `${k} does not hand back the host (${ours[k]}, host ${h})`);
  }

  // ── 3) and it fails the way a clean browser fails ──────────────────────────
  // [FIX the-frame-path-kept-the-brand-check] This is the section the file exists for. The
  // pristine realm's getter used to throw for us and answer for clean — no leak, and a
  // perfect detector.
  console.log('\n== 3) every attack has the same SHAPE it has in a clean browser');
  const shape = (v) => (String(v).startsWith('THREW:') ? String(v) : 'answered');
  for (const k of KEYS) {
    if (k.startsWith('base.')) continue;
    ok(shape(clean[k]) === shape(ours[k]),
      `${k}: clean ${shape(clean[k])} and ours ${shape(ours[k])} — a different refusal is a ` +
      `tell even when nothing leaks (clean ${clean[k]}, ours ${ours[k]})`);
  }
  // ── 4) the pristine realm's Date answers in the same numbers as the window ─
  // [FIX the-frames-date-answered-in-numbers-from-the-host] The string side of Date in that
  // frame was patched and the numeric side was not, so ONE object contradicted itself: the
  // label said Eastern Standard Time while getTimezoneOffset said -180. A site does not even
  // need the top window to see that.
  console.log('\n== 4) and the Date in that realm agrees with the window, in numbers too');
  for (const k of ['offJan', 'offJul', 'hours', 'dateStr']) {
    ok(ours['frame.' + k] === ours['top.' + k],
      `the frame's Date ${k} is the window's (${ours['frame.' + k]} vs ${ours['top.' + k]})`);
  }
  ok(ours['frame.offJan'] !== clean['frame.offJan'],
    `and not the host's (${ours['frame.offJan']}, host ${clean['frame.offJan']})`);
  ok(ours['frame.setHoursArity'] === clean['frame.setHoursArity'],
    `setHours keeps its arity through the delegation ` +
    `(${ours['frame.setHoursArity']} vs ${clean['frame.setHoursArity']})`);

  // Where the page overrode the value for itself, it must have got ITS value, not ours.
  ok(ours.defineOnInstance === '99' && ours.defineOnProto === '77',
    `a page that redefines the property for itself sees its own number, as in clean ` +
    `(${ours.defineOnInstance}, ${ours.defineOnProto})`);
  // And the profile must survive the page undoing its own override.
  ok(ours.deleteAfterDefine === ours['base.cores'],
    `deleting the page's own override restores the claim, not the host ` +
    `(${ours.deleteAfterDefine} vs base ${ours['base.cores']})`);
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
