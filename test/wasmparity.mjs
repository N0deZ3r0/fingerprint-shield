/**
 * protect.wasm IS THE ONE SHIPPED ARTIFACT NOTHING RE-DERIVES — SO PIN IT, AND PIN IT
 * AGAINST THE SHIPPED JS.
 *
 *   node test/wasmparity.mjs
 *
 * THE DEFECT THIS EXISTS FOR. protect.wasm (4,748 bytes) is generated from
 * protect_c.source and nothing in this tree rebuilds it, hashes it or reads its content:
 * `grep -rn 'emsdk\|emcc'` outside node_modules finds prose and nothing else — the build
 * example and the provenance block at protect_c.source:19-52, and the two notes at
 * background.js:1059 and :1121. tools/pack.mjs asserts the file EXISTS — background.js:892
 * names it and tools/pack.mjs:121-131 catches that literal — and that is the whole of the
 * automated statement about it.
 *
 * Two dev pages do compare the binary against JS, and both compare it against a formula
 * RETYPED INTO THE HTML: dev-wasm.html:16-28 and dev-textwidth-port.html:21-46. That
 * catches the wasm drifting away from the page and cannot catch mw/mw-canvas-audio.js or
 * mw/mw-workers.js drifting away from the wasm — which is the direction that matters,
 * because those two files are what a user actually runs when __w2 sends the canvas down
 * the JS path. And both pages run only under test/run.mjs, which .github/workflows/ci.yml
 * fires on workflow_dispatch, schedule and v* tags: .github/workflows/ci.yml:92 runs
 * `node test/all.mjs` with no --browser on every push, so on a push nothing looks at this
 * file at all.
 *
 * So this suite lifts the REAL loader out of background.js:965 the same way dev-wasm.html
 * does, instantiates the REAL bytes under plain WebAssembly.instantiate with nothing but a
 * `window` object, a CustomEvent class and a WebAssembly whose instantiate is watched, and
 * compares its output against the SHIPPED functions — mw/mw-canvas-audio.js:
 * 284/285/288/345/365/402/1338/1350 and mw/mw-workers.js:1064/1101/1441/1450, extracted
 * from those files, not copied here. Measured 2026-09-10: byte-identical canvas output on
 * seven geometries at three fills (the middle of the range and both clamp boundaries)
 * against both ports, an identical flat-region rollback on four reads of a four-quadrant
 * canvas, 0 mismatches over 378 (font x text x width) combinations, and every one of the
 * sixteen exports either called or read out of the instance's memory — in well under a
 * second with no browser.
 *
 * NOT covered, deliberately: that protect.wasm reaches dist/. tools/pack.mjs proves that
 * today only because background.js:892 spells the name out; if that literal or the
 * manifest shape changed, the extension would ship without the file, canvas would fall
 * back to JS everywhere, and every suite here would stay green — precisely BECAUSE the
 * two paths are byte-identical, which is what the sections below assert.
 */
import fs from 'fs';
import { createHash } from 'crypto';
import * as acorn from 'acorn';
import { harness, read, root } from './harness.mjs';

const t = harness();

/**
 * The drift record. Measured 2026-09-10 with `sha256sum protect.wasm` and
 * `stat -c%s protect.wasm`, and re-derived below from the same bytes the loader is handed.
 *
 * Changing these two constants is only correct AFTER a rebuild whose equivalence
 * assertions in this file all still pass. A rebuild is therefore a two-part change — new
 * bytes and a new constant — and the failure message says so, because the cheap way out of
 * a red pin is to delete it, and deleting it is deleting the only content statement this
 * repository makes about the artifact.
 *
 * Byte-for-byte reproducibility across emsdk versions is NOT claimed and must not be:
 * background.js:1058-1061 records a rebuild with the same emcc changing the import name,
 * and background.js:1120-1127 the init export changing, with the author unable to find the
 * flags that reproduced the original. The gate is the behaviour below; the hash is the
 * notice that the behaviour needs re-reading.
 */
const WASM_BYTES_EXPECTED = 4748;
const WASM_SHA256 = '16dd3c58667bca48a20c6a9da8b7fd63bca8c82cd3b210e42ae0f335dc9da2f7';

const SEED = 0x12345678;
const SEED2 = 0xDEADBEEF >>> 0;
const TZ = 'Europe/Tallinn', LANG = 'et-EE';

const wasmBuf = fs.readFileSync(root + '/protect.wasm');
/** An Array and not a typed array: executeScript arguments cross a JSON boundary, and
 *  background.js:894 builds exactly this shape before handing it in. */
const BYTES = Array.from(new Uint8Array(wasmBuf));

const ca = read('mw/mw-canvas-audio.js');
const wk = read('mw/mw-workers.js');
const bg = read('background.js');

/**
 * Pull a whole `function name(...) {...}` out of a source file by balancing braces.
 * Same shape as test/node-all.mjs:89-99 rather than a fresh one — the note above it there
 * records why the balanced form is the right one: the pattern it replaced ended at
 * whatever text happened to follow the function, so writing a comment underneath broke it,
 * and a test that fails because of a comment is a test measuring the wrong thing.
 */
const fnText = (s, name) => {
  const i = s.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const b = s.indexOf('{', i);
  let d = 0, j = b;
  for (; j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) break; }
  }
  return d === 0 ? s.slice(i, j + 1) : null;
};

/**
 * Every extraction is guarded by name, with the file and the line it was last seen at.
 * Without the guard the failure is `Cannot read properties of null` thrown from inside
 * `new Function`, which names neither the file nor the identifier that moved.
 *
 * The stand-in is an EMPTY function rather than a throwing one, and that is the whole
 * point of it: a throw aborts the process, `t.done()` never runs, and test/all.mjs sees no
 * verdict line at all — a suite that cannot say it failed. An empty stand-in lets the
 * comparison below run and report a difference, underneath the named failure that says
 * which file stopped defining what.
 */
const need = (src, name, where) => {
  const text = fnText(src, name);
  t.assert(!!text, `${where} still defines ${name} — the extraction below reads it out of ` +
    'the shipped file rather than keeping a copy, so a rename here is a suite that ' +
    'silently stops comparing anything');
  return text || `function ${name}() {}`;
};

/**
 * The same guard for a one-line DECLARATION rather than a function. Some of what the
 * extractions below need is not a function at all — `var MAX_FLAT_COLORS = 2;` is one
 * whole half of the flat-region rule section 3 compares — and a constant retyped into this
 * file would go on saying 2 after the shipped file said 3, which is the one failure the
 * comparison exists to catch.
 */
const decl = (src, re, where) => {
  const m = src.match(re);
  t.assert(!!m, `${where} still declares ${re.source} — the extraction below lifts that ` +
    'line out of the shipped file rather than restating it, because the value in it is ' +
    'part of what is being compared');
  return m ? m[0] : '';
};

/**
 * The other half of the same guard. An extracted function CALLS its neighbours by name —
 * _jsCanvasNoise calls _hashPixelPosition, _stw calls _hs — so a rename in mw/*.js leaves
 * the survivor referring to a name that is no longer there, and the ReferenceError lands
 * when the comparison runs, or while it is being built. Both are swallowed here
 * so that `t.done()` stays reachable — a suite that aborts prints no verdict line and
 * test/all.mjs reports it as having said nothing rather than as having failed. The swallow
 * is then itself asserted away at the end, so a build where nothing was renamed cannot
 * quietly come to depend on it.
 */
let threw = 0, firstThrow = '';
const safeFn = (make) => {
  let fn = null;
  return (...a) => {
    try {
      if (!fn) fn = make();
      return fn(...a);
    } catch (e) {
      threw++;
      if (!firstThrow) firstThrow = String((e && e.message) || e);
      fn = () => undefined;
      return undefined;
    }
  };
};

const MARKER = 'func: async function(wasmBytes, noiseSeedArg, tzArg, langArg) {';

/** The loader body, lifted out of background.js:965..1335 exactly as dev-wasm.html:39-49
 *  lifts it. Kept as text so section 2 can read it. */
const loaderBody = (() => {
  const at = bg.indexOf(MARKER);
  if (at < 0) return null;
  const open = bg.indexOf('{', at + MARKER.length - 1);
  let d = 0, end = -1;
  for (let i = open; i < bg.length; i++) {
    if (bg[i] === '{') d++;
    else if (bg[i] === '}') { d--; if (!d) { end = i + 1; break; } }
  }
  return end < 0 ? null : bg.slice(bg.indexOf('async function', at), end);
})();

/** The two host objects the body touches, and nothing else — verified by section 2. */
class FakeCustomEvent {
  constructor(type) { this.type = type; }
}
/** A FRESH window per load: background.js:970 short-circuits on window.__t0, so a reused
 *  object would make the second load report `cached` and measure the first one's wrapper. */
const mkWin = () => ({
  dispatchEvent(e) { this.__evt = e.type; return true; }
});
/**
 * A THIRD host object, and the only one that is not simply a stand-in: the real
 * WebAssembly, with `instantiate` wrapped so the instance the loader builds is reachable
 * afterwards. Nothing in the wrapper it returns exposes `memory` — background.js:1145-1210
 * hands back four closures and no heap — so `set_locale`, which writes two static buffers
 * and is read back by nothing in the binary, is unobservable without this. Section 14 is
 * the only reader; every other section works through the wrapper exactly as before.
 */
let lastInstance = null;
const spyWasm = new Proxy(WebAssembly, {
  get(target, p) {
    if (p === 'instantiate') {
      return async (...a) => {
        const r = await WebAssembly.instantiate(...a);
        lastInstance = r.instance || r;
        return r;
      };
    }
    const v = target[p];
    return typeof v === 'function' ? v.bind(target) : v;
  }
});
const newLoader = () => {
  lastInstance = null;
  return new Function('window', 'CustomEvent', 'WebAssembly', 'return (' + loaderBody + ')');
};

/** No ImageData in Node, and none needed: background.js:1153-1162 reads d.data, d.width and
 *  d.height and nothing else. Uint8ClampedArray and not Uint8Array — that is what a browser
 *  hands the wrapper, and the copy-back at background.js:1160 goes through its clamping. */
const mkImg = (w, h, [r, g, b]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return { width: w, height: h, data };
};
const firstDiff = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
};

// ---- 1) the loader still loads ----------------------------------------------
t.section('1) the loader still loads');
t.assert(!!loaderBody,
  `background.js:965 no longer carries the marker "${MARKER}" — the loader could not be ` +
  'extracted, and dev-wasm.html:41 and dev-textwidth-port.html:59 read it the same way');

const win = mkWin();
const W = await (async () => {
  if (!loaderBody) return null;
  const res = await newLoader()(win, FakeCustomEvent, spyWasm)(BYTES, SEED, TZ, LANG);
  t.assert(!!(res && res.success && !res.cached), `the extracted loader instantiates ` +
    `protect.wasm under plain WebAssembly.instantiate — got ${JSON.stringify(res)}`);
  return win.__w0 || null;
})();

t.assert(!!W, 'the loader defined window.__w0');
t.eq(win.__w1, true, 'the loader defined window.__w1 (the ready flag mw-canvas-audio takes)');
t.assert(!win.__w2, 'window.__w2 (the failure flag) is NOT set on the success path');
t.eq(win.__evt, 'ui:w', 'the loader dispatched the ui:w CustomEvent mw-canvas-audio listens for');
t.eq(W ? Object.keys(W).join(',') : '', 'addCanvasNoise,substituteTextWidth,substituteTextMetrics,setLocale',
  'the wrapper exposes exactly the four live methods, in order');
// The three that were taken OUT stay out. Each removal is a recorded decision with a
// measurement behind it, and a rebuild or a merge that quietly restores one would restore
// the defect with it — so they are asserted absent, exactly as dev-wasm.html:74-80 does.
t.eq(W && typeof W.normalizeTiming, 'undefined',
  'normalizeTiming is still gone from the wrapper ([CLEANUP] background.js:1198-1203 — the ' +
  'performance.now patch it fed broke monotonicity and Chrome\'s own 0.1ms clamp)');
t.eq(W && typeof W.getFakeShaderPrecision, 'undefined',
  'getFakeShaderPrecision is still gone from the wrapper ([CLEANUP+FIX] background.js:' +
  '1174-1183 — it read TWO i32 per pointer where the C writes one, and served the ' +
  'uninitialised second one: 1520 instead of 127)');
t.eq(W && typeof W.addAudioNoise, 'undefined',
  'addAudioNoise is still gone from the wrapper ([CLEANUP] background.js:1164-1173 — the ' +
  'AudioContext noise it fed was measurably louder than the fingerprint it hid)');

// ---- 2) the loader reads nothing from the page -------------------------------
t.section('2) the loader reads nothing from the page');
{
  // [FIX the-word-count-said-the-loader-still-read-the-page] The naive test — does the body
  // mention sessionStorage — is a false positive on a clean build. Four of the five words
  // below appear in this exact function's PROSE: [FIX wasm-fetch-was-visible-to-the-page]
  // and [FIX seed-was-a-named-page-readable-key] are the notes recording that the reads
  // were removed, and they name what was removed. Measured on today's body: 'sessionStorage',
  // 'v.ui.s', 'fetch' and 'document' each occur in comments and nowhere else; 'localStorage'
  // occurs nowhere at all. Strip comment lines first, then the question is answerable.
  //
  // [FIX the-comment-strip-hid-code-behind-a-block-comment] The strip was a line
  // filter over /^\s*(\/\/|\*|\/\*)/, and a line filter cannot tell a comment from a line
  // that merely BEGINS with one. Measured: the two lines of the removed sessionStorage read
  // put back into background.js with a `/**/ ` prefix on each left this file at 120 passed,
  // 0 failed; the identical two lines unprefixed failed 2. So the word list was working and
  // the strip was the hole — the page-readable-seed channel was five characters away from
  // invisible. acorn reports comment RANGES, which is the same reason
  // tools/gen-bundle.mjs:126-148 reaches for it, and its memo carries the four-line
  // counter-example that sinks a line filter outright. Each range is overwritten with
  // spaces rather than dropped, so code that shared a line with a comment is still there to
  // be searched, and a `//` inside a string or a regex is not a comment and is left alone.
  const strip = (src) => {
    // Parenthesised because the body is an anonymous function EXPRESSION and a Program
    // cannot begin with one; every offset then shifts by exactly that one character, and
    // the wrapper is searched as-is rather than sliced back out.
    const wrapped = '(' + src + ')';
    const out = wrapped.split('');
    acorn.parse(wrapped, {
      ecmaVersion: 2022, sourceType: 'script',
      onComment: (block, text, start, end) => {
        for (let i = start; i < end; i++) if (out[i] !== '\n') out[i] = ' ';
      }
    });
    return out.join('');
  };
  let code = '', parseErr = 'the loader body was not extracted';
  if (loaderBody) {
    // Swallowed for the reason safeFn's note gives: a throw here aborts the process, and a
    // suite that cannot reach t.done() reports nothing rather than reporting a failure.
    try { code = strip(loaderBody); parseErr = ''; }
    catch (e) { parseErr = String((e && e.message) || e); }
  }
  t.eq(parseErr, '',
    'the loader body parses, so its comment ranges are read rather than guessed at ' +
    `(${parseErr || 'parsed'})`);
  for (const word of ['sessionStorage', 'v.ui.s', 'fetch', 'localStorage', 'document']) {
    t.assert(!code.includes(word),
      `the injected loader body never touches ${word} outside a comment — it runs in the ` +
      "page's own MAIN world, so anything it reads there is a channel the page controls");
  }
  // This is the Node half of dev-wasm.html:239-252, and it is the stronger half: that page
  // writes v.ui.s and shows the seed did not change, which proves the loader ignores THAT
  // key on THAT path. This proves it never looks at any of them.
  //
  // The two guards under it are the strip's own: comments are blanked in place, so the
  // length no longer moves and cannot report an over-eager strip. Non-space characters can,
  // and a call that only ever appears in CODE proves the strip kept the half it must keep —
  // the failure the line filter had was in that direction, not this one.
  const bare = code.replace(/\s+/g, '');
  t.assert(bare.length > 4000,
    `the comment strip left ${bare.length} non-space characters of code to search ` +
    '(measured 2026-09-10: 4,108 of the body\'s 14,269) — if it left almost nothing, the ' +
    'loop above is asserting the absence of words from an empty string');
  t.assert(code.includes('asm.set_locale('),
    'and left the code intact: `asm.set_locale(` survives the strip, and that call appears ' +
    'nowhere in the prose above it (section 14 measures what it writes)');
}

// ---- 3) canvas noise == the shipped JS fallback ------------------------------
t.section('3) canvas noise == the shipped JS fallback');
/** mw/mw-canvas-audio.js:15 binds _getSessionSeed off MW; supplied as a parameter here so
 *  the two functions come out of the file untouched. */
const jsCanvasAt = (seed) => safeFn(() => new Function('_getSessionSeed',
  need(ca, '_hashPixelPosition', 'mw/mw-canvas-audio.js (was :345)') + '\n' +
  need(ca, '_jsCanvasNoise', 'mw/mw-canvas-audio.js (was :402)') + '\n' +
  'return _jsCanvasNoise;')(() => seed));
const jsCanvas = jsCanvasAt(SEED);
/** mw/mw-workers.js:1064 — the worker's own port, returning {n, rfe} at :1145. `n` is the
 *  noise, which the wasm has; `rfe` is the flat-region rollback, which it does not — the
 *  wasm is only ever handed pixels, never the canvas around them. Both halves come out of
 *  the file, because the invariant the section header claims is the two of them together:
 *  a user's Window and Worker canvas strings differ if EITHER half differs. */
const mkPixShim = () => new Function(
  need(wk, '_pixShim', 'mw/mw-workers.js (was :1064)') + '\nreturn _pixShim;')()({ v: SEED });
const workerPix = {
  n: safeFn(() => mkPixShim().n),
  rfe: safeFn(() => mkPixShim().rfe)
};

// The Window<->Worker invariant, which is the one that actually shows up on a user's screen:
// the worker never runs the wasm, it runs the JS port, and CreepJS compares the two canvas
// strings. dev-wasm.html:236 asserts it against a formula retyped into that page; here the
// wasm, the window's fallback and the worker's port are all three the shipped ones.
// Negative offsets and a far-off origin are in the grid because the whole point of
// [FIX position-dependent-noise] is that the hash is a function of ABSOLUTE position.
const GEOMETRIES = [[8, 8, 0, 0], [1, 1, 7, 3], [5, 7, 123, 4567], [16, 16, 0, 0],
  [3, 3, -2, -2], [4, 4, 0, 0], [1, 1, 0, 0]];
// [FIX one-fill-colour-never-reached-the-clamp] The grid used to run at [100,150,200]
// alone, where a -1..+2 delta lands nowhere near a boundary, so the three ports were
// compared only in the middle of the range. Measured: clipping BOTH JS ports at
// Math.max(5, Math.min(250, …)) instead of 0/255 left this section at 21 passed, 0 failed
// — the clamp, the one part of the formula section 5 says it treats "honestly", was the
// one part no comparison touched. The two boundary fills put every channel of every pixel
// against a limit: at 0 the -1 must be held at 0, at 255 the +1 and +2 must be held at 255.
const FILLS = [[100, 150, 200], [0, 0, 0], [255, 255, 255]];
for (const [w, h, ox, oy] of GEOMETRIES) {
  for (const fill of FILLS) {
    const at = `${w}x${h}@${ox},${oy} filled ${fill.join(',')}`;
    const a = mkImg(w, h, fill); if (W) W.addCanvasNoise(a, ox, oy);
    const b = mkImg(w, h, fill); jsCanvas(b, ox, oy);
    const c = mkImg(w, h, fill); workerPix.n(c.data, w, h, ox, oy);
    const dab = firstDiff(a.data, b.data), dac = firstDiff(a.data, c.data);
    t.assert(dab === -1,
      `${at}: protect.wasm add_canvas_noise == mw/mw-canvas-audio.js ` +
      `_jsCanvasNoise byte for byte` + (dab === -1 ? '' :
        ` — first difference at byte ${dab}: wasm ${a.data[dab]}, js ${b.data[dab]}`));
    t.assert(dac === -1,
      `${at}: protect.wasm add_canvas_noise == mw/mw-workers.js _pixShim.n ` +
      'byte for byte — this is the Window<->Worker canvas invariant CreepJS reads' +
      (dac === -1 ? '' : ` — first difference at byte ${dac}: wasm ${a.data[dac]}, worker ${c.data[dac]}`));
    let alpha = true;
    for (let i = 3; i < a.data.length; i += 4) if (a.data[i] !== 255) alpha = false;
    t.assert(alpha, `${at}: the alpha channel is untouched (protect_c.source:165)`);
  }
}

// [FIX the-rollback-half-of-the-invariant-was-never-compared] THE OTHER HALF OF THE SAME
// INVARIANT. The noise above is only step one of what a user's canvas goes through; step
// two is the flat-region rollback, and it lives in the two JS worlds and not in the wasm
// — mw/mw-canvas-audio.js:365 _restoreFlatRegionsExpanded and mw/mw-workers.js:1101 rfe,
// two HAND-PORTED copies of one rule, each carrying a comment
// saying they must stay identical ("Both must agree or a read that takes the expanded path
// and one that does not would disagree", "Must stay identical to the window's copy or
// Window and Worker diverge on any shape with a hard edge"). Nothing in the Node set
// compared them: this suite extracted _pixShim and threw its `rfe` away. Measured, with
// the noise comparison above left untouched and green: mw/mw-workers.js few()'s `n > 2`
// widened to `n > 3` — 120 passed, 0 failed; mw/mw-canvas-audio.js:284's MAX_FLAT_COLORS
// raised from 2 to 3 — 120 passed, 0 failed. Either one alone is
// [FIX solid-fill-canvas-was-noised] / [FIX worker-missing-flat-restore] coming back on
// one side, which is a Window<->Worker canvas split on any hard edge — exactly what
// dev-wvw.html measures, in the browser set that does not run on a push.
//
// The rule reads the ORIGINAL, un-noised neighbourhood, so the fixture is a canvas rather
// than a buffer: four flat quadrants, whose interiors hold one colour in the plus-shaped
// neighbourhood, whose straight edges hold two, and whose central cross holds three. Two
// is the shipped limit, so interiors and edges roll back and the cross keeps its noise —
// which is the only place a limit of 2 and a limit of 3 can be told apart.
{
  const QUAD = [[20, 30, 40], [200, 30, 40], [20, 200, 40], [20, 30, 200]];
  const canvasPixel = (x, y) => QUAD[(y < 5 ? 0 : 2) + (x < 5 ? 0 : 1)];
  const rectOf = (x, y, w, h) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        const c = canvasPixel(x + lx, y + ly), i = (ly * w + lx) * 4;
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
      }
    }
    return { width: w, height: h, data };
  };
  // MAX_FLAT_COLORS is HALF of the rule being compared, so it is lifted out of the file
  // rather than restated — a stand-in that outlives the thing it stands in for is the
  // suite exercising itself, the same argument the two preludes in section 7 make.
  const winRfe = safeFn(() => new Function(
    decl(ca, /var MAX_FLAT_COLORS = \d+;/, 'mw/mw-canvas-audio.js (was :284)') + '\n' +
    need(ca, 'rgbKey', 'mw/mw-canvas-audio.js (was :285)') + '\n' +
    need(ca, '_distinctAtMost', 'mw/mw-canvas-audio.js (was :288)') + '\n' +
    need(ca, '_restoreFlatRegionsExpanded', 'mw/mw-canvas-audio.js (was :365)') + '\n' +
    'return _restoreFlatRegionsExpanded;')());
  // The reads: the whole canvas, a rect straddling the cross, a right-hand slab, and a
  // single pixel — production clamps the expanded read to the canvas, so the 1px margin is
  // clamped here too and the corners get a genuinely truncated neighbourhood.
  const READS = [[0, 0, 10, 10], [3, 3, 4, 4], [4, 0, 6, 10], [4, 4, 1, 1]];
  for (const [x, y, w, h] of READS) {
    const ex0 = Math.max(0, x - 1), ey0 = Math.max(0, y - 1);
    const ex1 = Math.min(10, x + w + 1), ey1 = Math.min(10, y + h + 1);
    const expanded = rectOf(ex0, ey0, ex1 - ex0, ey1 - ey0);
    const clean = rectOf(x, y, w, h);

    const a = rectOf(x, y, w, h); jsCanvas(a, x, y);
    const noised = Uint8ClampedArray.from(a.data);
    winRfe(a, x, y, expanded, ex0, ey0);

    const b = rectOf(x, y, w, h); workerPix.n(b.data, w, h, x, y);
    workerPix.rfe(b, x, y, expanded, ex0, ey0);

    const d = firstDiff(a.data, b.data);
    t.assert(d === -1,
      `${w}x${h}@${x},${y}: mw/mw-canvas-audio.js _restoreFlatRegionsExpanded == ` +
      'mw/mw-workers.js _pixShim.rfe over the same noised pixels — the flat-region rule is ' +
      'hand-ported twice and both copies say they must stay identical' +
      (d === -1 ? '' : ` — first difference at byte ${d}: window ${a.data[d]}, worker ${b.data[d]}`));
    // Both directions of vacuity: a rollback that restored everything, or one that restored
    // nothing, would make the equality above true of two buffers that agree for the wrong
    // reason. The 4x4 straddling the cross is the only read where both are visible at once.
    if (w === 4) {
      t.assert(firstDiff(a.data, clean.data) !== -1,
        'the 4x4 read across the cross keeps noise somewhere after the rollback — the ' +
        'three-colour neighbourhoods on the cross are not flat and must not be restored');
      t.assert(firstDiff(a.data, noised) !== -1,
        'and rolls noise back somewhere — the one- and two-colour neighbourhoods either ' +
        'side of the cross are flat and must be restored');
    }
  }
}

// ---- 4) noise is a pure function of absolute position ------------------------
t.section('4) noise is a pure function of absolute position');
{
  // dev-wasm.html:109-118 without a browser. [FIX position-dependent-noise]
  // (background.js:1146-1151) rebuilt add_canvas_noise with offset_x/offset_y precisely
  // because the same physical pixel used to get different noise depending on whether it was
  // read alone or inside a block — which is what fingerprintswitcher's CheckIntegrity looks
  // for, and it needs exactly two getImageData calls to find.
  const block = mkImg(16, 16, [100, 150, 200]); if (W) W.addCanvasNoise(block, 0, 0);
  for (const [px, py] of [[0, 0], [3, 5], [7, 7], [15, 15], [9, 2]]) {
    const one = mkImg(1, 1, [100, 150, 200]); if (W) W.addCanvasNoise(one, px, py);
    const bi = (py * 16 + px) * 4;
    const same = one.data[0] === block.data[bi] && one.data[1] === block.data[bi + 1] &&
      one.data[2] === block.data[bi + 2];
    t.assert(same,
      `pixel ${px},${py} read as 1x1 at that offset == the same pixel inside a 16x16 block ` +
      `at (0,0) — got ${one.data[0]},${one.data[1]},${one.data[2]} vs ` +
      `${block.data[bi]},${block.data[bi + 1]},${block.data[bi + 2]} (CheckIntegrity)`);
  }
}

// ---- 5) clamping, honestly ---------------------------------------------------
t.section('5) clamping, honestly');
{
  // dev-wasm.html:120-126 calls this "clamps to 0..255 at extremes" and then checks that a
  // Uint8ClampedArray holds values in 0..255, which is a property of the array type and
  // true of any build. Measured on this binary: the per-channel delta is (hh & 3) - 1 over
  // TWO bits, i.e. -1..+2 and not -1..+1, so a 16x16 filled with 0 yields exactly {0,1,2}
  // and one filled with 255 yields exactly {254,255}. That is falsifiable, and the wrap
  // check underneath it is what a missing clamp would actually look like: 255+1 arriving as
  // 0 in the low set, or 0-1 arriving as 255 in the high set.
  const distinct = (fill) => {
    const im = mkImg(16, 16, [fill, fill, fill]);
    if (W) W.addCanvasNoise(im, 0, 0);
    const s = new Set();
    for (let i = 0; i < im.data.length; i++) if (i % 4 !== 3) s.add(im.data[i]);
    return [...s].sort((a, b) => a - b);
  };
  const lo = distinct(0), hi = distinct(255);
  t.eq(lo.join(','), '0,1,2',
    'a 16x16 filled with 0 comes back holding exactly {0,1,2} — the delta is (hh & 3) - 1, ' +
    'which is -1..+2, and the -1 is clamped away at the floor');
  t.eq(hi.join(','), '254,255',
    'a 16x16 filled with 255 comes back holding exactly {254,255} — the +1 and +2 are both ' +
    'clamped away at the ceiling');
  t.assert(!lo.some((v) => v >= 254),
    'no value near 255 appears in the buffer filled with 0 — that would be a wrap, not a clamp');
  t.assert(!hi.some((v) => v <= 2),
    'no value near 0 appears in the buffer filled with 255 — that would be a wrap, not a clamp');
}

// ---- 6) heap growth is really exercised --------------------------------------
t.section('6) heap growth is really exercised');
{
  // dev-wasm.html:128-133 labels a 512x512 buffer "malloc + heap growth". Measured: initial
  // memory is 16,777,216 bytes and 512*512*4 is 1,048,576, so malloc returns ptr 526632 and
  // emscripten_notify_memory_growth is never called — the case exercises malloc and nothing
  // else. 2100*2100*4 is 17,640,000, which does not fit, and there the import fires exactly
  // once and memory ends at 18,219,008.
  //
  // What that buys is the assertion underneath: growth DETACHES the old ArrayBuffer, so
  // HEAPU8 is dead the moment malloc grows, and the copy at background.js:1158-1160 would
  // throw or write into nothing if updateMemoryViews (background.js:975-981, wired to the
  // import at background.js:1084-1086) had not rebuilt the views. Spot-checking pixels
  // after a 2100x2100 call is how that gets measured without reading the loader's internals.
  const small = mkImg(512, 512, [120, 120, 120]);
  if (W) W.addCanvasNoise(small, 0, 0);
  t.assert(!(small.data[0] === 120 && small.data[1] === 120 && small.data[2] === 120),
    '512x512 goes through malloc and comes back noised (the case dev-wasm.html:128-133 has)');

  const big = mkImg(2100, 2100, [120, 120, 120]);
  if (W) W.addCanvasNoise(big, 0, 0);
  const hash = (x, y, seed) => {
    let h = (seed ^ ((x + 1) * 0x27D4EB2F) ^ ((y + 1) * 0x85EBCA6B)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2545F491) >>> 0;
    return (h ^ (h >>> 13)) >>> 0;
  };
  for (const [x, y] of [[0, 0], [2099, 2099], [1000, 1500], [2048, 17]]) {
    const i = (y * 2100 + x) * 4, h = hash(x, y, SEED);
    const want = [120 + ((h & 3) - 1), 120 + ((h >>> 4 & 3) - 1), 120 + ((h >>> 8 & 3) - 1)];
    t.eq(`${big.data[i]},${big.data[i + 1]},${big.data[i + 2]}`, want.join(','),
      `pixel ${x},${y} of a 2100x2100 read (17.64 MB, past the 16 MB initial memory) is the ` +
      'value the formula gives — i.e. updateMemoryViews rebuilt HEAPU8 after the grow ' +
      'detached it, rather than the copy-back landing in a dead buffer');
  }
}

// ---- 7) text width == the shipped JS fallback --------------------------------
t.section('7) text width == the shipped JS fallback');
{
  // The two preludes below stand in for one production line each, both of which sit OUTSIDE
  // the extracted functions: mw/mw-canvas-audio.js:1337 declares `var _txtEnc = null;` above
  // _wasmHashStr, and mw/mw-workers.js:1440 declares `var _enc = new TextEncoder();` above
  // _hs. Without them the extraction throws ReferenceError. A stand-in that outlives the
  // thing it stands in for is a suite exercising itself, so both lines are asserted present
  // verbatim right here.
  t.assert(ca.includes('var _txtEnc = null;'),
    'mw/mw-canvas-audio.js still declares `var _txtEnc = null;` (was :1337) — the prelude ' +
    'below restates that line, and must not outlive it');
  t.assert(wk.includes('var _enc = new TextEncoder();'),
    'mw/mw-workers.js still declares `var _enc = new TextEncoder();` (was :1440) — same');

  // [FIX only-one-of-the-two-zero-guards-was-asserted] The comparison below is SPLIT at
  // real === 0 because the two worlds guard that case at different levels, and it named
  // the window's level in prose while asserting only the worker's. Measured: dropping the
  // window's guard — `var w = _substWidth(W, m.width, fontKey, text);` — left this file at
  // 120 passed, 0 failed, while dropping the worker's failed 1. That is
  // [FIX perturbed-exact-zeros] back on the window side alone: measureText('') at
  // 16px monospace would come out as -0.004274509803921569 in the window against an exact
  // 0 in the worker (measured at this seed on this binary), a Window<->Worker split of
  // exactly the class section 3 exists for. The line is pinned the same way the two
  // preludes above are, because the split below is only correct while it is there.
  t.assert(ca.includes('var w = (m.width === 0) ? 0 : _substWidth(W, m.width, fontKey, text);'),
    'mw/mw-canvas-audio.js still guards zero at the CALL SITE with `var w = (m.width === ' +
    '0) ? 0 : _substWidth(W, m.width, fontKey, text);` (was :1522) — the wasm perturbs an ' +
    'exact zero (asserted below) and mw/mw-workers.js:1451 guards it inside _stw, so ' +
    'without this line the window and the worker disagree on every empty string');

  const jsWidth = safeFn(() => new Function('_getSessionSeed', 'var _txtEnc = null;\n' +
    need(ca, '_wasmHashStr', 'mw/mw-canvas-audio.js (was :1338)') + '\n' +
    need(ca, '_jsFallbackWidth', 'mw/mw-canvas-audio.js (was :1350)') + '\n' +
    'return _jsFallbackWidth;')(() => SEED));
  const workerWidth = safeFn(() => new Function('_SDB', 'var _enc = new TextEncoder();\n' +
    need(wk, '_hs', 'mw/mw-workers.js (was :1441)') + '\n' +
    need(wk, '_stw', 'mw/mw-workers.js (was :1450)') + '\n' +
    'return _stw;')({ v: SEED }));

  // The same grid dev-textwidth-port.html:80-86 uses — empty strings, emoji, Cyrillic, CJK,
  // full-width Japanese in the font name and a 200-character run — because hash_str hashes
  // UTF-8 BYTES (protect_c.source:66-78) and charCodeAt-shaped ports drift exactly there.
  const FONTS = ['16px monospace', '72px "Segoe UI", monospace', '14px Arial',
    '12px "MS Gothic"', 'bold 16px/1.5 "Helvetica Neue", sans-serif', '',
    '16px "Ｍｓ ゴシック"'];
  const TEXTS = ['mwmwmwmwlli', 'mmmmmmmmmmlli', 'Handgloves', '', 'a',
    '😃 emoji', 'Привет', '日本語テキスト', 'x'.repeat(200)];
  const REALS = [0, 1, 123.3984375, 468, 647.75, 1e6];

  let n = 0, badJs = 0, badWk = 0, zeros = 0, badZero = 0;
  let firstJs = null, firstWk = null;
  for (const f of FONTS) for (const s of TEXTS) for (const r of REALS) {
    n++;
    const wasm = W ? W.substituteTextWidth(r, f, s) : NaN;
    const js = jsWidth(r, f, s);
    if (!Object.is(wasm, js)) { badJs++; if (!firstJs) firstJs = { f, s, r, wasm, js }; }
    // [FIX perturbed-exact-zeros] lives at two different LEVELS in the two worlds: the
    // worker puts the guard inside _stw (mw/mw-workers.js:1451, `if (real === 0) return 0;`)
    // and the window puts it at the call site (mw/mw-canvas-audio.js:1522,
    // `var w = (m.width === 0) ? 0 : _substWidth(...)`). So the wasm and _stw are compared
    // only where real !== 0; at real === 0 the wasm perturbs (measured: -0.00239… for
    // 16px monospace / 'a') and _stw returns 0, and both are correct. Comparing them
    // straight would fail 63 of the 378 cases and look exactly like a real split — the
    // wrong repair for which is deleting the guard mw/mw-workers.js:1451 exists for.
    if (r === 0) {
      zeros++;
      if (workerWidth(0, f, s) !== 0) badZero++;
    } else {
      const wkw = workerWidth(r, f, s);
      if (!Object.is(wkw, wasm)) { badWk++; if (!firstWk) firstWk = { f, s, r, wasm, wkw }; }
    }
  }
  t.eq(n, 378, 'the grid is 7 fonts x 9 texts x 6 native widths');
  t.eq(zeros, 63, 'of which 63 have real === 0, the cases the two worlds guard at different levels');
  t.assert(badJs === 0,
    `protect.wasm substitute_text_width == mw/mw-canvas-audio.js _jsFallbackWidth on all ` +
    `${n} combinations` + (firstJs ? ` — ${badJs} differ, first ${JSON.stringify(firstJs)}` : ''));
  t.assert(badWk === 0,
    `protect.wasm substitute_text_width == mw/mw-workers.js _stw on all ${n - zeros} ` +
    'combinations with a non-zero native width' +
    (firstWk ? ` — ${badWk} differ, first ${JSON.stringify(firstWk)}` : ''));
  t.assert(badZero === 0,
    `mw/mw-workers.js _stw returns an exact 0 for every one of the ${zeros} cases with ` +
    'real === 0 ([FIX perturbed-exact-zeros]: an exact zero in TextMetrics is a structural ' +
    `fact, not a measurement) — ${badZero} did not`);
  t.assert(W && W.substituteTextWidth(0, '16px monospace', 'a') !== 0,
    'and the wasm itself does NOT special-case zero — the guard is the caller\'s, which is ' +
    'why mw/mw-canvas-audio.js:1522 has to apply it before calling in');
}

// ---- 8) the raw exports still are what protect_c.source says -----------------
t.section('8) the raw exports still are what protect_c.source says');
/** A fresh instance with its own growth counter. Fresh per measurement: the allocator's
 *  state carries over, so the memory a grow lands on depends on what was malloc'd before. */
const freshInstance = () => {
  let grows = 0;
  const inst = new WebAssembly.Instance(new WebAssembly.Module(wasmBuf),
    { env: { emscripten_notify_memory_growth() { grows++; } } });
  inst.exports._initialize();
  return { asm: inst.exports, grows: () => grows };
};
const seedInstance = (asm, seed) => {
  const p = asm.malloc(4);
  new Int32Array(asm.memory.buffer)[p >> 2] = seed | 0;
  asm.seed_random(p, 1);
  asm.free(p);
};
{
  const mod = new WebAssembly.Module(wasmBuf);
  t.eq(JSON.stringify(WebAssembly.Module.imports(mod)),
    JSON.stringify([{ module: 'env', name: 'emscripten_notify_memory_growth', kind: 'function' }]),
    'protect.wasm imports exactly env.emscripten_notify_memory_growth — the STANDALONE_WASM ' +
    'shape described at background.js:1058-1068, not the emscripten_resize_heap build at ' +
    'background.js:1054-1057. background.js:1069-1094 keeps both import tables on purpose');
  // The wrapper's [CLEANUP] notes at background.js:1164-1173 and :1174-1183 promise that
  // add_audio_noise, normalize_timing and get_fake_shader_precision are still IN the binary
  // and that "пересборка не требуется". Nothing checked that; a rebuild that dropped them
  // would leave three true-sounding comments describing a file that no longer has them.
  const names = WebAssembly.Module.exports(mod).map((e) => e.name).sort();
  t.eq(names.join(','),
    '__indirect_function_table,_emscripten_stack_restore,_initialize,add_audio_noise,' +
    'add_canvas_noise,emscripten_stack_get_current,free,get_fake_shader_precision,malloc,' +
    'memory,normalize_timing,seed_random,set_locale,should_skip_canvas_noise,' +
    'substitute_text_metrics,substitute_text_width',
    'protect.wasm exports exactly the 16 names measured 2026-09-10, _initialize included ' +
    '(the rebuilt init name, background.js:1120-1127) — dropping should_skip_canvas_noise, ' +
    'which protect_c.source:175 invites, is a deliberate two-part change and moves this line');

  const { asm, grows } = freshInstance();
  t.eq(asm.memory.buffer.byteLength, 16777216,
    'initial linear memory is 16 MB — which is why the 512x512 case in section 6 grows nothing');
  seedInstance(asm, SEED);

  // protect_c.source:273-279 writes ONE i32 per pointer. The wrapper that used to call this
  // allocated 8 bytes each and read TWO, serving the uninitialised second word as the
  // FRAGMENT_SHADER precision (measured 1520 instead of 127 — [CLEANUP+FIX]
  // background.js:1174-1183). Both halves are pinned here: the value written, and the word
  // after it being left exactly as it was found.
  const SENTINEL = 0x5A5A5A5A | 0;
  const ptrs = [asm.malloc(8), asm.malloc(8), asm.malloc(8)];
  const i32 = new Int32Array(asm.memory.buffer);
  for (const p of ptrs) { i32[p >> 2] = SENTINEL; i32[(p >> 2) + 1] = SENTINEL; }
  asm.get_fake_shader_precision(ptrs[0], ptrs[1], ptrs[2]);
  t.eq([i32[ptrs[0] >> 2], i32[ptrs[1] >> 2], i32[ptrs[2] >> 2]].join(','), '-127,127,23',
    'get_fake_shader_precision writes -127 / 127 / 23 (protect_c.source:276-278)');
  t.eq(ptrs.every((p) => i32[(p >> 2) + 1] === SENTINEL), true,
    'and writes NOTHING into the word after each pointer — the word the removed wrapper ' +
    'read and handed to mw-navigator.js as a precision');
  for (const p of ptrs) asm.free(p);

  t.eq(grows(), 0, 'nothing so far has grown the heap');
  const big = asm.malloc(2100 * 2100 * 4);
  t.assert(big > 0, 'malloc(17,640,000) succeeds');
  t.eq(grows(), 1,
    'and notifies growth exactly once — 17.64 MB does not fit in the 16 MB initial memory');
  t.eq(asm.memory.buffer.byteLength, 18219008,
    'taking linear memory to 18,219,008 bytes (measured 2026-09-10 on a fresh instance; the ' +
    'number depends on allocator history, which is why this instance has none)');
  asm.free(big);

  const { asm: a2, grows: g2 } = freshInstance();
  const small = a2.malloc(512 * 512 * 4);
  t.assert(small > 0, 'malloc(1,048,576) succeeds');
  t.eq(g2(), 0,
    'and notifies NO growth — this is the measurement that makes dev-wasm.html:128-133 ' +
    '("512x512 buffer works (malloc + heap growth)") a mislabel: it exercises malloc alone');
  a2.free(small);
}

// ---- 9) the binary and the C have drifted, and here is where -----------------
t.section('9) the binary and the C have drifted, and here is where');
{
  // MEASURED 2026-09-10 against the shipped protect.wasm. protect_c.source:170-191 documents
  // should_skip_canvas_noise as a dead stub returning 0 unconditionally; the binary returns
  // 1 while unseeded, and after seed_random returns 1 for w <= 0 or h <= 0 and 0 otherwise.
  // mw/mw-canvas-audio.js:527 documents a THIRD behaviour — "C caches first (w,h) and
  // returns skip=1 once" — and the binary does not do that either (50x50 returns 0 on the
  // first call and on the second). Nothing CALLS the export: outside the C definition
  // itself (protect_c.source:171) and the -s EXPORTED_FUNCTIONS list in the build example
  // (protect_c.source:22, which is inside the header comment), every reference in the tree
  // is a comment — protect_c.source:14, mw/mw-canvas-audio.js:527, background.js:1163 — so
  // nothing is broken by any of this. What it means is that the .source is not a faithful
  // record of the artifact, which is the exact risk this suite exists for — so the artifact's
  // REAL behaviour is pinned here, and a rebuild that changes it becomes visible instead of
  // being absorbed by a comment nobody re-measures. protect_c.source:14-15 and :177-188 now say
  // the same thing.
  const { asm } = freshInstance();
  for (const [w, h] of [[0, 0], [1, 1], [50, 50], [100, 100], [33, 33], [-5, 7]]) {
    t.eq(asm.should_skip_canvas_noise(w, h), 1,
      `unseeded, should_skip_canvas_noise(${w}, ${h}) is 1 — protect_c.source:170-191 says ` +
      'the compiled body is `return 0` unconditionally, and it is not');
  }
  seedInstance(asm, SEED);
  for (const pass of ['first', 'second']) {
    for (const [w, h] of [[0, 0], [-5, 7], [0, 5], [5, 0]]) {
      t.eq(asm.should_skip_canvas_noise(w, h), 1,
        `seeded, should_skip_canvas_noise(${w}, ${h}) is 1 on the ${pass} call — a ` +
        'degenerate rectangle');
    }
    for (const [w, h] of [[1, 1], [32, 32], [33, 33], [50, 50], [99, 99], [200, 200]]) {
      t.eq(asm.should_skip_canvas_noise(w, h), 0,
        `seeded, should_skip_canvas_noise(${w}, ${h}) is 0 on the ${pass} call — and the ` +
        'same on both calls, so the (w,h) cache mw/mw-canvas-audio.js:527 warns about is ' +
        'not in this binary either');
    }
  }
}

// ---- 10) the artifact itself --------------------------------------------------
t.section('10) the artifact itself');
{
  const size = fs.statSync(root + '/protect.wasm').size;
  const sha = createHash('sha256').update(wasmBuf).digest('hex');
  const HOWTO = 'protect.wasm changed. That is not automatically wrong — but it is a ' +
    'rebuild, and a rebuild is a TWO-PART change: new bytes, then these constants, and only ' +
    'after every equivalence section above still passes against the new binary. Do not ' +
    'delete the pin to make this green; it is the only statement this repository makes ' +
    'about the CONTENT of the one artifact nothing here re-derives.';
  t.eq(size, WASM_BYTES_EXPECTED, `protect.wasm is ${WASM_BYTES_EXPECTED} bytes. ${HOWTO}`);
  t.eq(sha, WASM_SHA256, `protect.wasm sha256 is pinned. ${HOWTO}`);
}

// ---- 11) the marker is not orphaned -------------------------------------------
t.section('11) the marker is not orphaned');
{
  // dev-wasm.html:39 and dev-textwidth-port.html:57 each carry this string verbatim and
  // extract the loader with it. A reshape of background.js:965 makes dev-wasm.html:41 throw
  // and dev-textwidth-port.html:68 push a FAIL line — in a browser set that runs on
  // workflow_dispatch, schedule and tags only, i.e. not on the push that made the change.
  // These two lines make the same reshape red in `npm test` instead.
  for (const page of ['devpages/dev-wasm.html', 'devpages/dev-textwidth-port.html']) {
    t.assert(read(page).includes(MARKER),
      `${page} still greps background.js for the same loader marker this suite uses — if ` +
      'the signature at background.js:965 is reshaped, all three have to move together');
  }
}

// ---- 12) the fallback contract -------------------------------------------------
t.section('12) the fallback contract');
{
  // A page whose CSP omits 'wasm-unsafe-eval' is not a fault condition: the loader catches,
  // sets __w2, and mw/mw-canvas-audio.js _resolveCanvasMode takes the JS path. Section 3 is
  // what makes that safe — the page cannot tell which path ran, because the bytes are the
  // same. Eight garbage bytes reach the same catch as a refused instantiate.
  const bad = mkWin();
  const res = await newLoader()(bad, FakeCustomEvent, spyWasm)(
    [1, 2, 3, 4, 5, 6, 7, 8], SEED, TZ, LANG);
  t.assert(!!(res && res.error && !res.success),
    `an unusable module returns {error} rather than throwing — got ${JSON.stringify(res)}; ` +
    'background.js:1345 reads that value in the SERVICE WORKER, which is the whole of ' +
    '[FIX last-console-call-in-the-page-realm]');
  t.eq(bad.__w2, true,
    'and sets window.__w2 — the flag mw/mw-canvas-audio.js _resolveCanvasMode reads to lock ' +
    'the page onto the JS noise path');
  t.eq(bad.__w0, undefined, 'and leaves window.__w0 unset');
  t.eq(bad.__evt, undefined, 'and dispatches no ui:w');

  // The other early return: background.js:970. __t0.wasm is the status object
  // [FIX wasm-markers-were-client-litter] introduced because mw-canvas-audio TAKES __w0/__w1
  // off window as soon as they land, so their absence stopped meaning "not loaded".
  const cached = mkWin();
  cached.__t0 = { wasm: true };
  const res2 = await newLoader()(cached, FakeCustomEvent, spyWasm)(BYTES, SEED, TZ, LANG);
  t.eq(JSON.stringify(res2), JSON.stringify({ success: true, cached: true }),
    'a window whose __t0.wasm is already set short-circuits to {success, cached}');
  t.eq(cached.__w0, undefined, 'and instantiates nothing, so __w0 is left alone');
}

// ---- 13) the seed argument IS the seed ------------------------------------------
t.section('13) the seed argument IS the seed');
{
  // dev-wasm.html:204-224 carries a warning that must survive the move to Node, so it is
  // repeated: THE ASSERTION HERE IS INVERTED from what it used to be, deliberately. It used
  // to be that a different seed argument alone changed nothing, because the profile in the
  // page was authoritative and the argument was a fallback. There is no profile in the page
  // any more ([FIX profile-readable-by-any-page]); background.js derives this argument from
  // the same getCachedProfile() and the same deriveDomainSeed() that produce the
  // profile.noiseSeed the worker's JS port reads ([FIX seed-computed-twice]), so the
  // argument IS the seed and one computation is all there is. Do not "fix" this back.
  const w2 = mkWin();
  const res = await newLoader()(w2, FakeCustomEvent, spyWasm)(BYTES, SEED2, TZ, LANG);
  const W2 = w2.__w0;
  t.assert(!!(res && res.success && W2), `a second load at a different seed succeeds — ${JSON.stringify(res)}`);

  const at1 = mkImg(8, 8, [100, 150, 200]); if (W) W.addCanvasNoise(at1, 0, 0);
  const at2 = mkImg(8, 8, [100, 150, 200]); if (W2) W2.addCanvasNoise(at2, 0, 0);
  t.assert(firstDiff(at1.data, at2.data) !== -1,
    'the two seeds produce different noise — the argument reaches the hash at all');
  const js2 = mkImg(8, 8, [100, 150, 200]); jsCanvasAt(SEED2)(js2, 0, 0);
  t.eq(firstDiff(at2.data, js2.data), -1,
    'and at the new seed the wasm still equals mw/mw-canvas-audio.js byte for byte — the ' +
    'equality is a property of the formula, not of one lucky seed');
  const js1 = mkImg(8, 8, [100, 150, 200]); jsCanvas(js1, 0, 0);
  t.eq(firstDiff(at1.data, js1.data), -1, 'as it does at the first seed');
}

// ---- 14) the tz and lang arguments reach the binary --------------------------
t.section('14) the tz and lang arguments reach the binary');
{
  // [FIX two-of-the-loaders-four-arguments-reached-nothing] Section 13 proves noiseSeedArg
  // is the seed; wasmBytes is proved by every section above; tzArg and langArg were proved
  // by nothing. Measured: deleting the whole `if (tzArg) { wrapper.setLocale(...) }` block
  // from background.js:1276-1278 left this file at 120 passed, 0 failed.
  //
  // They are unobservable through the wrapper, and not by accident: set_locale writes
  // g_timezone and g_language (protect_c.source:261-271) and NOTHING else in the binary
  // reads either back. Measured on this binary — two instances seeded alike and given
  // Europe/Tallinn/et-EE against Pacific/Chatham/zz-ZZ produce a byte-identical 8x8
  // add_canvas_noise buffer and the same substitute_text_width, 467.991568627451. So the
  // only place the write is visible is the linear memory, which the four closures the
  // wrapper hands back do not expose; spyWasm above keeps the instance so it can be read.
  //
  // The pair used here is NOT the suite's TZ/LANG, and that is the point: 'Europe/Tallinn'
  // is the binary's own compiled-in default (protect_c.source:61), so asserting it after a
  // load would pass just as well on a loader that never called set_locale at all.
  const LOC_TZ = 'Pacific/Chatham', LOC_LANG = 'mi-NZ';
  // Measured 2026-09-10 by scanning a fresh instance's memory for the two default strings:
  // one occurrence each, 64 bytes apart, which is `static char g_timezone[64]` followed by
  // `static char g_language[64]`. The addresses are pinned rather than re-scanned so that
  // a rebuild moving the data segment is a named failure here and not a silent re-aim.
  const G_TZ = 1056, G_LANG = G_TZ + 64;
  const DEFAULT_TZ = 'Europe/Tallinn';
  const DEFAULT_LANG = 'et-EE,et;q=0.9,ru;q=0.8,en;q=0.7';
  const cstr = (mem, at, cap) => {
    const u8 = new Uint8Array(mem.buffer);
    let end = at;
    while (end < at + cap && u8[end]) end++;
    return Buffer.from(u8.slice(at, end)).toString('utf8');
  };

  // First that the two addresses are those two globals, on a bare instance the loader has
  // not touched — otherwise the readback below is a number pointing at whatever it likes.
  const { asm } = freshInstance();
  t.eq(cstr(asm.memory, G_TZ, 64), DEFAULT_TZ,
    `g_timezone is the 64 bytes at ${G_TZ}, holding the initialiser protect_c.source:61 ` +
    'gives it before anything calls set_locale');
  t.eq(cstr(asm.memory, G_LANG, 64), DEFAULT_LANG,
    `g_language is the 64 bytes at ${G_LANG}, holding the initialiser protect_c.source:62 ` +
    'gives it');
  const tzPtr = asm.malloc(64), langPtr = asm.malloc(64);
  new Uint8Array(asm.memory.buffer).set(Buffer.from(LOC_TZ + '\0'), tzPtr);
  new Uint8Array(asm.memory.buffer).set(Buffer.from(LOC_LANG + '\0'), langPtr);
  asm.set_locale(tzPtr, langPtr);
  asm.free(tzPtr); asm.free(langPtr);
  t.eq(cstr(asm.memory, G_TZ, 64), LOC_TZ,
    'and set_locale called directly writes its first argument there');
  t.eq(cstr(asm.memory, G_LANG, 64), LOC_LANG,
    'and its second argument into g_language — strncpy of protect_c.source:263-270, which ' +
    'is the whole of what this export does');

  // Now the loader, given the same pair as arguments, over the SAME two addresses.
  const wl = mkWin();
  const res = await newLoader()(wl, FakeCustomEvent, spyWasm)(BYTES, SEED, LOC_TZ, LOC_LANG);
  const mem = lastInstance && lastInstance.exports && lastInstance.exports.memory;
  t.assert(!!(res && res.success && mem),
    `a load at a distinct locale succeeds and its instance was captured — ${JSON.stringify(res)}`);
  t.eq(mem ? cstr(mem, G_TZ, 64) : '', LOC_TZ,
    'the loader passed tzArg through to set_locale — g_timezone in ITS instance holds the ' +
    'argument and not the compiled-in Europe/Tallinn');
  t.eq(mem ? cstr(mem, G_LANG, 64) : '', LOC_LANG,
    'and langArg the same way — g_language holds the argument and not the compiled-in ' +
    'et-EE,et;q=0.9,ru;q=0.8,en;q=0.7');
}

// ---- 15) the four exports the wrapper no longer calls ------------------------
t.section('15) the four exports the wrapper no longer calls');
{
  // [FIX four-exports-were-pinned-by-name-and-called-by-nothing] Section 8 pins all
  // sixteen export NAMES; four of them had no body pinned anywhere — add_audio_noise,
  // normalize_timing, substitute_text_metrics and set_locale (that last one is section 14
  // above). Section 10's HOWTO tells the next person that re-pinning the hash is correct
  // "only after every equivalence section above still passes against the new binary", and
  // a rebuild that changed any of these four would have passed every one of them: nothing
  // called them. get_fake_shader_precision is the counter-example done right in section 8,
  // and this is the same treatment for the rest.
  //
  // substituteTextMetrics is still ON the wrapper (background.js:1191-1197, and section 1
  // asserts it in the key list) and is called by nothing in mw/*.js today; the other three
  // are [CLEANUP]-ed off the wrapper with their exports deliberately left in the binary
  // ("пересборка не требуется", background.js:1164-1173, :1174-1183 and
  // :1198-1203). Left in the binary and unmeasured is how a comment about a file stops
  // being true of the file.
  const NOISE_SEED_UNSET = 'unseeded, it returns its input untouched — every one of these ' +
    'guards on g_seeded (protect_c.source:58) and the loader seeds before it calls anything';

  // -- normalize_timing --------------------------------------------------------
  {
    const { asm } = freshInstance();
    t.eq(asm.normalize_timing(1234.5678), 1234.5678, `normalize_timing: ${NOISE_SEED_UNSET}`);
    seedInstance(asm, SEED);
    t.eq(asm.normalize_timing(1234.5678), 1234.58426194458,
      'seeded, normalize_timing(1234.5678) is 1234.58426194458 — the +-0.025ms jitter ' +
      'protect_c.source:246-257 describes, measured 2026-09-10 at seed 0x12345678');
    t.eq(asm.normalize_timing(-5), 0.00247802734375,
      'a negative input is floored at 0 BEFORE the jitter, so it comes back at ' +
      '0.00247802734375 and not below zero (protect_c.source:248)');
    t.eq(asm.normalize_timing(1e9), 4294967.021416473,
      'and anything past 4,294,967 ms is capped there before the jitter, so 1e9 comes ' +
      'back as 4294967.021416473 — the same answer the cap itself gives, ' +
      `${asm.normalize_timing(4294967)} (protect_c.source:249)`);
  }

  // -- substitute_text_metrics -------------------------------------------------
  {
    const { asm } = freshInstance();
    const alloc = (str) => {
      const b = Buffer.from(str + '\0', 'utf8'), p = asm.malloc(b.length);
      new Uint8Array(asm.memory.buffer).set(b, p);
      return p;
    };
    const metric = (prop, real) => {
      const p = alloc(prop);
      try { return asm.substitute_text_metrics(p, real); } finally { asm.free(p); }
    };
    t.eq(metric('width', 468), 468, `substitute_text_metrics: ${NOISE_SEED_UNSET}`);
    seedInstance(asm, SEED);
    t.eq(metric('width', 468), 468.0009058823529,
      "seeded, substitute_text_metrics('width', 468) is 468.0009058823529 — the +-0.001 " +
      'amplitude protect_c.source:205-212 keeps deliberately tiny, measured 2026-09-10 at ' +
      'seed 0x12345678');
    t.eq(metric('actualBoundingBoxLeft', 468), 467.9991725490196,
      "and it is a function of the PROPERTY NAME: 'actualBoundingBoxLeft' at the same 468 " +
      'is 467.9991725490196, so two metrics of one TextMetrics do not move together');
    t.eq(asm.substitute_text_metrics(0, 468), 467.99929803921566,
      'a NULL prop hashes the literal "m" (protect_c.source:208) rather than the empty ' +
      `string, which gives a different answer: ${metric('', 468)} for the empty string`);
  }

  // -- add_audio_noise ---------------------------------------------------------
  {
    // The one export whose REMOVAL from the wrapper is itself a measurement — [CLEANUP]
    // background.js:1164-1173 records that the noise it fed was louder than the
    // fingerprint it hid. It is still in the binary, so what it does is still a fact about
    // the shipped artifact.
    const SAMPLES = [0, 0.5, -0.5, 1, -1, 0.25];
    const run = (level, seeded) => {
      const { asm } = freshInstance();
      if (seeded) seedInstance(asm, SEED);
      const p = asm.malloc(SAMPLES.length * 4);
      new Float32Array(asm.memory.buffer, p, SAMPLES.length).set(SAMPLES);
      asm.add_audio_noise(p, SAMPLES.length, level);
      const out = Array.from(new Float32Array(asm.memory.buffer, p, SAMPLES.length));
      asm.free(p);
      return out;
    };
    t.eq(run(0.003, false).join(','), SAMPLES.join(','),
      `add_audio_noise: ${NOISE_SEED_UNSET}`);
    t.eq(run(0.003, true).join(','),
      '0.00086914625717327,0.5013536214828491,-0.49935635924339294,0.9993127584457397,' +
      '-0.9993086457252502,0.2504484951496124',
      'seeded at level 0.003, add_audio_noise walks the same LCG the JS offline path does ' +
      '(protect_c.source:223-241) — six samples measured 2026-09-10 at seed 0x12345678');
    t.eq(run(0, true)[0], 0.00008691462426213548,
      'level 0 falls back to the 0.0003 default, which is the 0.003 delta divided by ten ' +
      '(protect_c.source:228)');
    t.eq(run(1, true).join(','), run(0.01, true).join(','),
      'and any level above 0.01 is clamped to it — level 1 and level 0.01 give the same ' +
      'six samples (protect_c.source:229)');
    // The saturation, which is the half a delta test cannot see: without the clamp an
    // all-ones buffer at level 0.01 would come back above 1.0 wherever the delta is
    // positive, and eleven of these sixteen deltas are.
    const { asm } = freshInstance();
    seedInstance(asm, SEED);
    const N = 16, p = asm.malloc(N * 4);
    new Float32Array(asm.memory.buffer, p, N).fill(1);
    asm.add_audio_noise(p, N, 0.01);
    const ones = Array.from(new Float32Array(asm.memory.buffer, p, N));
    asm.free(p);
    t.eq(ones.filter((v) => v === 1).length, 11,
      'a 16-sample buffer of 1.0 at level 0.01 comes back with exactly 11 samples still at ' +
      '1.0 — the positive deltas are held at the ceiling (protect_c.source:237) rather ' +
      `than pushed past it; the largest value present is ${Math.max(...ones)}`);
    t.assert(!ones.some((v) => v > 1),
      'and nothing in it exceeds 1.0, which is what a missing clamp would look like');
  }
}

t.eq(threw, 0,
  'no function extracted out of mw/*.js threw while being compared — one that does is a ' +
  'rename reported above whose neighbour still calls the old name, and the comparison it ' +
  `was in did not happen. First: ${firstThrow || 'none'}`);

t.done();
