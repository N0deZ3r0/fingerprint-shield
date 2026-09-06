/**
 * DOES THE PAGE STILL WORK — with the extension actually loaded.
 *
 *   node test/pagework.mjs             headless
 *   node test/pagework.mjs --headed    watch it
 *
 * WHY THIS EXISTS, and why the fixture that already covers it does not.
 *
 * Nearly every defect in this project is "the page can tell". One class is different: the
 * page cannot tell, it simply BREAKS — our wrapper throws where the browser would have
 * returned. It happened on github.com/<user>/<repo>/settings:
 *
 *     Uncaught TypeError: (el.id || "").toLowerCase is not a function
 *
 * `HTMLFormElement`'s named getter is [LegacyOverrideBuiltIns], so a <form> holding
 * <input name="id"> answers its own CONTROL for `form.id`. mw-adblock's isBait() read
 * `el.id` and called `.toLowerCase()` on an <input>, and isBait sits in FRONT of
 * getComputedStyle, getBoundingClientRect, getClientRects, checkVisibility and the offset
 * getters — so the throw landed in the page's own call. Three of those five threw.
 *
 * A fixture for it exists — the DOM-clobbering block of dev-adblockmask.html — and it prints
 * FAILURES: 0 against a build with the bug in it. That was MEASURED, twice, and the first
 * explanation for it was wrong; both are written here because the wrong one is the more
 * tempting.
 *
 *   WRONG: "test/run.mjs launches a plain browser, so there is no isBait in front of
 *   getComputedStyle and nothing can throw." dev-adblockmask.html LOADS `mw/mw-*.js` ITSELF
 *   — it carries its own MODULES list, as most of the dev pages do — so the wrappers are
 *   installed on that page whether an extension is loaded or not.
 *
 *   RIGHT: isBait swallows its own throw. Its body sits in a `try { … } catch { return
 *   false; }`, so a clobbered element reads as "not bait" and every one of the five reads
 *   RETURNS. The page asks only whether the reads return, so it is green either way. Checked
 *   by putting the defect back and running `node test/run.mjs adblockmask`: 2 checks passed.
 *
 * What the fixture never asks is whether the mask still WORKS on a clobbered element, and
 * that is the assertion that catches the regression — see part 3 and the negative control
 * below. The other reason to run it here is that this suite exercises the SHIPPED BUNDLE
 * through the real extension, while the dev page exercises the eleven source modules it
 * loads by hand.
 *
 * THE POSITIVE CONTROL IS THE POINT. "Nothing threw" is also true of a build where
 * mw-adblock never installed at all, so the run would be green for the wrong reason. Every
 * case below is therefore read twice — clean browser and ours — and the suite asserts BOTH
 * that the clobbered reads return AND that the mask is demonstrably alive on the same page:
 * a hidden bait element must read `display: none` / width 0 in the clean browser and
 * `display: block` / width 300 in ours. If the mask stops installing, that pair fails.
 *
 * NEGATIVE CONTROL, run when this file was written — the fix was undone in the source and
 * the suite re-run, twice:
 *
 *   isBait reading `el.id` / `el.className` again        13 passed, 2 failed, exit 1
 *   the same, plus isBait's own try/catch removed        13 passed, 2 failed, exit 1
 *
 * Both fail in part 3: the clobbered bait element stops being masked. Part 1 stays green in
 * both, and that is worth knowing rather than guessing at — the fix is two layers, and only
 * the first was undone here. The second is the `try` that wraps everything after the native
 * call in each of the five wrappers ("if ours throws the page gets the value it would have
 * had without this extension"), so with layer one broken the throw is swallowed and the
 * symptom is a silently dead feature, not an exception. Part 1 guards the day someone adds
 * a sixth wrapper without that guard; part 3 is what catches a regression in the reader.
 *
 * WHAT IS NOT HERE, because it is already guarded elsewhere — do not duplicate it:
 *   window.name kept for a subframe, cleared at the top   test/coldstart.mjs (part 6)
 *   sync-xhr=() and the blocking source read              test/cspattribution.mjs (part 3)
 *   blob workers under require-trusted-types-for          test/ttworker.mjs
 *   chrome-extension:// in a stack a page can read        test/stackleak.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';

const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('  FAIL:', m); failed++; } };

// Every element is built with setAttribute, never with `el.id = …` / `el.className = …`:
// on the clobbered forms those very properties are the <input>s, so a property assignment
// would shadow the accessor and quietly fail to set the attribute — the fixture would then
// not be bait and the suite would test nothing.
const PAGE = `<!doctype html><meta charset=utf-8><title>pagework</title><body>
<script>
window.__probe = (function () {
  var CLOB = '<input name="id"><input name="className"><input name="tagName">' +
             '<input name="getAttribute"><input name="checkVisibility">';
  function make(tag, attrs, clobbered) {
    var el = document.createElement(tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    if (clobbered) el.innerHTML = CLOB;
    document.body.appendChild(el);
    return el;
  }
  // 1. clobbered and ORDINARY: the mask must leave it exactly as the browser has it.
  var plain = make('form', { style: 'position:absolute;left:-9999px;top:-9999px;width:40px;height:20px' }, true);
  // 2. bait and hidden, not clobbered: the mask's own job, and this suite's positive control.
  var bait = make('div', { class: 'adsbox', style: 'display:none' }, false);
  // 3. both at once — the intersection that broke, and the one no other fixture reaches.
  var baitClob = make('form', { class: 'adsbox', style: 'display:none' }, true);

  // The five reads isBait sits in front of. checkVisibility is called through the prototype
  // on purpose: \`form.checkVisibility\` is itself one of the clobbered controls, so calling
  // it as a method would throw in a CLEAN browser too and prove nothing about us.
  function read(el) {
    var o = {}, T = function (k, fn) {
      try { var v = fn(); o[k] = (typeof v === 'number') ? Math.round(v) : v; }
      catch (e) { o[k] = 'THREW ' + e.name + ': ' + e.message; }
    };
    T('display', function () { return getComputedStyle(el).display; });
    T('rectWidth', function () { return el.getBoundingClientRect().width; });
    T('rects', function () { return el.getClientRects().length; });
    T('offsetHeight', function () { return el.offsetHeight; });
    T('checkVisibility', function () {
      return (typeof Element.prototype.checkVisibility === 'function')
        ? Element.prototype.checkVisibility.call(el) : null;
    });
    return o;
  }
  return { plain: read(plain), bait: read(bait), baitClob: read(baitClob) };
})();

// [FIX the-wrapper-answered-with-its-own-error-for-a-foreign-receiver] The error a wrapped
// method gives when it is called with a receiver of the wrong type. CreepJS's failsTypeError
// / queryLies walks prototypes doing exactly this and compares what comes back, and one of
// ours answered with an error naming a method the page never called:
//
//   HTMLCanvasElement.prototype.toBlob.call({}, cb)
//     clean  TypeError: Illegal invocation
//     ours   TypeError: Failed to execute 'drawImage' on 'CanvasRenderingContext2D': ...
//
// because the noising path ran before the native call and threw first.
//
// THIS PART IS NOW COVERED MORE BROADLY ELSEWHERE, AND IT STAYS ANYWAY. test/receivers.mjs
// part 5 asks the same question of every method it can ENUMERATE off the prototypes, over
// twelve receiver shapes rather than one, and it found 72 divergences these nine never could —
// so as coverage of the axis, the list below is redundant. What it still is, is a FIXTURE for
// five specific breakages this file is about (Turnstile, reCAPTCHA, DOM clobbering, sync-xhr,
// the blob service-worker script), asked in a page that has the ad-blocker mask live and the
// other parts' state around it. Deleting it would remove the only place those nine are asked
// in that context, to save a second of runtime. It is kept, and it is not the guard for the
// receiver rule — receivers.mjs is.
window.__foreign = (async function () {
  var out = {};
  var C = HTMLCanvasElement.prototype, X = CanvasRenderingContext2D.prototype;
  var cases = {
    'canvas.toDataURL': function () { return C.toDataURL.call({}); },
    'canvas.toBlob': function () { return C.toBlob.call({}, function () {}); },
    'canvas.getContext': function () { return C.getContext.call({}, '2d'); },
    'ctx.getImageData': function () { return X.getImageData.call({}, 0, 0, 1, 1); },
    'ctx.measureText': function () { return X.measureText.call({}, 'x'); },
    'ctx.fillText': function () { return X.fillText.call({}, 'x', 0, 0); },
    'el.getBoundingClientRect': function () { return Element.prototype.getBoundingClientRect.call({}); },
    'el.getClientRects': function () { return Element.prototype.getClientRects.call({}); },
    'offscreen.convertToBlob': function () { return OffscreenCanvas.prototype.convertToBlob.call({}); }
  };
  for (var k in cases) {
    var r;
    try {
      r = cases[k]();
      if (r && typeof r.then === 'function') {
        try { await r; out[k] = 'resolved'; }
        catch (e) { out[k] = 'reject ' + e.name + ': ' + String(e.message); }
      } else { out[k] = 'no error'; }
    } catch (e2) { out[k] = 'throw ' + e2.name + ': ' + String(e2.message); }
  }
  return out;
})();
<\/script>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;

async function readFrom(ctx) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  const out = await page.evaluate(() => window.__probe);
  const foreign = await page.evaluate(() => window.__foreign);
  await page.close();
  return { out, foreign };
}

const cleanBrowser = await chromium.launch({ ...BROWSER, headless: !headed });
const CLEAN_ALL = await readFrom(await cleanBrowser.newContext());
const CLEAN = CLEAN_ALL.out;
await cleanBrowser.close();

const dir = mkdtempSync(join(tmpdir(), 'afp-pagework-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
let OURS, OURS_ALL;
try {
  await ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2000));
  OURS_ALL = await readFrom(ctx);
  OURS = OURS_ALL.out;
} finally {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
  server.close();
}

const KEYS = ['display', 'rectWidth', 'rects', 'offsetHeight', 'checkVisibility'];
const CASES = [
  ['plain', 'clobbered <form>, not bait'],
  ['bait', 'bait <div>, display:none'],
  ['baitClob', 'clobbered <form>, bait, display:none']
];
for (const [k, label] of CASES) {
  console.log(`\n${label}`);
  for (const p of KEYS) {
    console.log('  ' + p.padEnd(16) + 'clean ' + String(CLEAN[k][p]).padEnd(26) + 'ours ' + OURS[k][p]);
  }
}

console.log('\n1) nothing throws — the defect this file is named for');
const threw = (o) => KEYS.filter((p) => String(o[p]).startsWith('THREW'));
for (const [k, label] of CASES) {
  ok(threw(CLEAN[k]).length === 0,
    `clean: ${label} — every read returns (${threw(CLEAN[k]).join(',') || 'all five'})`);
  ok(threw(OURS[k]).length === 0,
    `ours:  ${label} — every read returns${threw(OURS[k]).length ? ' — THREW: ' + threw(OURS[k]).join(', ') : ''}`);
}

console.log('\n2) the mask is alive — without this, part 1 is green on a build that installs nothing');
ok(CLEAN.bait.display === 'none' && OURS.bait.display === 'block',
  `hidden bait reads display:none clean and block with us (clean ${CLEAN.bait.display}, ours ${OURS.bait.display})`);
ok(CLEAN.bait.rectWidth === 0 && OURS.bait.rectWidth === 300,
  `and its width 0 clean, 300 with us (clean ${CLEAN.bait.rectWidth}, ours ${OURS.bait.rectWidth})`);

console.log('\n3) clobbering does not disable the mask, and does not extend it');
// The fix reads attributes through the prototype method captured at document_start, so a
// clobbered element is still classified. A fix that merely swallowed the throw would leave
// this element unmasked and still pass part 1.
ok(OURS.baitClob.display === 'block',
  `a clobbered bait element is still masked (${OURS.baitClob.display}) — attributes cannot be clobbered`);
ok(OURS.baitClob.rectWidth === 300,
  `and still gets the bait rect (${OURS.baitClob.rectWidth})`);
for (const p of KEYS) {
  ok(String(OURS.plain[p]) === String(CLEAN.plain[p]),
    `a clobbered NON-bait element is untouched: ${p} ${OURS.plain[p]} == ${CLEAN.plain[p]}`);
}

console.log('\n4) a foreign receiver gets the browser\'s own error, not one of ours');
for (const k of Object.keys(CLEAN_ALL.foreign || {})) {
  const c = String(CLEAN_ALL.foreign[k]), o = String((OURS_ALL.foreign || {})[k]);
  console.log('  ' + k.padEnd(26) + 'clean ' + c.slice(0, 52));
  if (c !== o) console.log('  ' + ''.padEnd(26) + 'OURS  ' + o.slice(0, 52));
  ok(c === o, `${k}: ours "${o.slice(0, 90)}" vs clean "${c.slice(0, 90)}"`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
