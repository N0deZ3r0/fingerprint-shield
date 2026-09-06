/**
 * THE RECEIVER IS PART OF AN ACCESSOR'S SIGNATURE.
 *
 *   node test/receivers.mjs             headless
 *   node test/receivers.mjs --headed    watch it
 *
 * test/pagework.mjs part 4 asks nine wrapped METHODS what they do with a foreign receiver —
 * `HTMLCanvasElement.prototype.toBlob.call({}, cb)` and friends — and compares the answer
 * with a clean browser. This started as the ACCESSOR half of the same idea, where the
 * extension had ~20 more call sites and no coverage at all.
 *
 * PART 5 IS THE METHOD HALF, and it is the systematic version of those nine names: the
 * methods are ENUMERATED off the prototypes rather than listed, so a tenth wrapper is covered
 * the day it is written. It landed reporting 72 divergences of its own — the note above part 5
 * lists them and what each turned out to be. Both halves now run by default; `--no-methods`
 * skips the second one.
 *
 * WHAT A GETTER OWES ITS CALLER. `Object.getOwnPropertyDescriptor(Screen.prototype,'width')
 * .get` is a function a page can pull off the prototype and call with anything. The platform's
 * answer to each receiver is a fixed, readable table, and CreepJS's `failsTypeError`/
 * `queryLies` walks prototypes doing exactly this. Measured in a CLEAN browser, and quoted
 * here because every assertion below is a comparison against it rather than against this list:
 *
 *   Screen.width.call(screen)                          -> 1280
 *   Screen.width.call(otherRealmScreen)                -> 1280      ANSWERS across realms
 *   Screen.width.call(Screen.prototype)                -> TypeError
 *   Screen.width.call({})                              -> TypeError
 *   Screen.width.call(null)                            -> TypeError
 *   NavigatorUAData.platform.call(otherRealmUad)       -> "Windows" ANSWERS across realms
 *   NavigatorUAData.platform.call(navigator)           -> TypeError
 *   NetworkInformation.effectiveType.call(otherRealmConn) -> "4g"   ANSWERS across realms
 *
 * and window's own [Global] accessors are a DIFFERENT table, which is why they are swept as
 * their own group rather than folded in with the interfaces:
 *
 *   innerWidth.call(window)            -> 1280
 *   innerWidth.call(otherRealmWindow)  -> 0     that window's value, not ours
 *   innerWidth.call(null)              -> the current window (sloppy-mode this coercion)
 *   innerWidth.call(Window.prototype)  -> TypeError
 *   innerWidth.call(document)          -> TypeError
 *
 * TWO WAYS TO BE WRONG, AND THE BUILD THIS WAS WRITTEN AGAINST HAD BOTH. `_namedGetter` in
 * mw/mw-core.js branded its getters with `brandProto.isPrototypeOf(Object(this))`, and
 * `isPrototypeOf` is FALSE across realms while the native accessor ANSWERS there — so the
 * check threw where the platform returns:
 *
 *   Screen.width.call(otherRealmScreen)                    clean 1280   ours THREW TypeError
 *   Navigator.hardwareConcurrency.call(otherRealmNav)      clean 18     ours THREW TypeError
 *   NetworkInformation.effectiveType.call(otherRealmConn)  clean "4g"   ours THREW TypeError
 *
 * while NavigatorUAData (window and worker), NetworkInformation in the worker, and all nine
 * window [Global] accessors carried no check at all and answered where the platform refuses —
 * in a build every other suite in this repo passes. The two directions are not symmetrical and
 * no single brand list expresses either: `Object.create(Screen.prototype)` and
 * `new Proxy(screen, {})` both satisfy `isPrototypeOf` and both make the native REFUSE, while a
 * cross-realm Screen fails `isPrototypeOf` and the native ANSWERS for it. The only oracle that
 * gets all four right is the native getter itself.
 *
 * THE CLEAN BROWSER IS THE AUTHORITY, and only about THROW-vs-ANSWER. The VALUE for the own
 * instance is deliberately different — that is the spoof, and asserting it equal would assert
 * the extension does nothing. So each case is reduced to a verdict: `throw TypeError` or
 * `answer number` / `answer string` / `answer object [object PluginArray]`. The number is
 * printed and never compared; the SHAPE is compared everywhere.
 *
 * THE PROPERTY LIST IS READ FROM THE CLEAN BROWSER, not written down here — every accessor on
 * Screen.prototype, Navigator.prototype, NavigatorUAData.prototype, NetworkInformation.
 * prototype and their worker equivalents, whether this extension patches it or not. A patched
 * one is what the suite is for; an unpatched one costs nothing and means the day somebody
 * patches it, it is already covered. A hand-listed set goes stale and the stale version looks
 * exactly like the correct one — the trap [FIX temporal-and-newer-intl-ctors] documents. The
 * one exception is window itself, where the [Global] accessors are own properties of a global
 * that has hundreds of them, so the nine geometry names are named.
 *
 * WHAT ONLY A SECOND BROWSER CAN ANSWER, and why no dev page can. Every dev fixture loads
 * `mw/mw-*.js` itself, so both sides of any in-page comparison are patched — the same reason
 * dev-ownprops.html reports 0 forever ([FIX own-props-need-a-second-browser]). And the
 * cross-realm case needs an iframe that is patched TOO: this suite does not ask whether the
 * child agrees with a clean browser, it asks whether the parent's getter, handed the child's
 * instance, agrees with what the CHILD ITSELF reports. That invariant holds in a clean browser
 * by construction, and part 4 asserts it in ours only where clean holds it.
 *
 * Part 4 is the guard for a fix that has not been written yet, and deliberately so. The design
 * panel that agreed the receiver rule split on one branch — "a DIFFERENT Window -> return
 * ORIG.call(this)" — because for devicePixelRatio, outerWidth/outerHeight and screenX/screenY
 * the delegated native is the HOST's number while the frame's own patched getter answers the
 * profile's, and one page can read both. Nothing in this repo could see that, so part 4 pins
 * it: the sized iframe is 300x200 under a claimed screen that is wider, so `innerWidth`'s
 * clamp gives the frame 300 while the top window's is the whole viewport, and a getter that
 * answers the top's value for the child's receiver fails on that line alone.
 *
 * TWO IFRAMES, sized and display:none, because the zero-size case inverts the clamp: a hidden
 * frame's real innerWidth is 0 and mw-timezone-screen's `if (v <= 0) return sw()` makes ours
 * bigger than native rather than smaller. Whatever a receiver rule does there, both frames
 * have to come out consistent, and one frame cannot show it.
 *
 * EACH DEFECT IS COUNTED ONCE. Part 2 only looks at cases where both browsers already agree
 * that they refuse, part 3 restates the cross-realm result as one line rather than re-asserting
 * cases part 1 has counted, and part 4 skips a receiver our getter refused — otherwise a single
 * missing brand check would be reported three times and the total would mean nothing.
 *
 * BASELINE OF THE ACCESSOR HALF, measured against the build this file was written for
 * (Chromium 151, headless, one machine) — every one of these is fixed, and the numbers are
 * kept so a later reader can tell a regression from the debt this landed with. Today the whole
 * file reports 24249 passed, 0 failed in about 14 seconds:
 *
 *   1995 passed, 229 failed   1278 receiver cases swept, 683 refusals compared word for word
 *     215  part 1, throw-vs-answer  (154 window, 61 worker)
 *          181 of them clean REFUSES and ours answers — no brand check, or a brand check that
 *              accepts Object.create(proto) and a Proxy, which have no internal slot
 *           34 of them clean ANSWERS and ours refuses — every one a cross-realm receiver
 *       0  part 2: where both refuse, both say "TypeError: Illegal invocation"
 *       1  part 3, the aggregate line for those 34
 *      13  part 4, the parent getter disagreeing with the child realm's own read
 *
 * The 13 are worth naming, because they are the ones no other instrument in this repo can see.
 * Measured, ours, both halves read one line apart in one page:
 *
 *   NavigatorUAData.brands.get.call(childUad)   array []        childUad.brands   the real list
 *   innerWidth.get.call(childWin)               1280            childWin.innerWidth      300
 *   innerHeight.get.call(childWin)               720            childWin.innerHeight     200
 *   screenX.get.call(hiddenChildWin)              10            hiddenChildWin.screenX     0
 *
 * and in the display:none child every one of outerWidth / outerHeight / screenX / screenY /
 * screenLeft / screenTop disagrees with what that child reports about itself.
 *
 * NEGATIVE CONTROL, run when this file was written, because a suite that reports 229 has to
 * show that the number is the extension and not the instrument. The second launch was changed
 * to a CLEAN browser as well and the whole sweep re-run — same twelve receivers, same two
 * iframes, same worker, same proxies:
 *
 *   clean vs clean   2437 passed, 2 failed
 *
 * and the two are the liveness guards in part 0, saying "cores ours 18 vs clean 18 (IDENTICAL:
 * nothing was tested)" exactly as they are meant to. Zero verdict mismatches, zero refusal-text
 * mismatches, zero cross-realm misses, zero part-4 disagreements. So none of the 229 comes from
 * the harness: not the Proxy, not document.all, not the child realms, not the worker.
 *
 * WHAT IS NOT HERE, because it is guarded elsewhere — do not duplicate it:
 *   own properties on the instances               test/ownprops.mjs
 *   the foreign-receiver answer of wrapped METHODS test/pagework.mjs part 4
 *   getter .toString() and .name                  test/parity-static.mjs, dev-objecttypes.html
 *   what a patched read COSTS                     test/costceiling.mjs
 *
 * NOT REACHABLE IN A WORKER: a second realm. A dedicated worker has no iframes and nothing
 * that carries a NavigatorUAData or a NetworkInformation across postMessage, so the two
 * cross-realm columns are `-` there and are asserted on nothing. Everything else — the
 * prototype, the branded-but-slotless object, the proxy, `{}`, null, undefined and the wrong
 * platform object — is swept in the worker exactly as in the window, because mw-workers.js
 * keeps its own copies of these getters (`_defIfShim`, `_defNP`, `_cdef`) and two of the three
 * have no brand check at all.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';

const headed = process.argv.includes('--headed');
// Part 5 (wrapped METHODS) runs by default; --no-methods skips it. See the note above it.
const METHODS = !process.argv.includes('--no-methods');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('  FAIL:', m); failed++; } };

/**
 * The receiver matrix. Order is fixed because it is also the column order of the glyph table,
 * and the second element is why the case is here at all.
 */
const RECEIVERS = [
  ['own', 'the instance itself — the only case whose VALUE is allowed to differ from clean'],
  ['own again', 'a second read of the same path: worker userAgentData is rebuilt per access'],
  ['prototype', 'the interface prototype — native refuses, it has no internal slot'],
  ['Object.create(proto)', 'inherits the brand and has no slot: isPrototypeOf says yes, native says no'],
  ['Proxy(own)', 'a transparent proxy of the instance'],
  ['{}', 'a plain object'],
  ['null', 'strict-mode call: [Global] accessors coerce it, interface accessors refuse it'],
  ['undefined', 'the same, and the pair that a `this == null` test would wrongly admit'],
  ['document.all', 'the [[IsHTMLDDA]] object: `== null` is TRUE, ToObject is not the global'],
  ['wrong type', 'a valid platform object of the wrong interface'],
  ['cross-realm', 'the same interface from a same-origin 300x200 iframe — the case that matters'],
  ['cross-realm hidden', 'the same, from a display:none iframe, where every clamp inverts']
];
const RECV_NAMES = RECEIVERS.map((r) => r[0]);

/**
 * `holder` is where the descriptor is read from, `proto` is the interface prototype used as a
 * receiver — the two are the same everywhere except window, whose [Global] accessors are own
 * properties of the global while `Window.prototype` is what a page would call them with.
 * `props` is supplied only where enumeration is not an option; everywhere else the clean
 * browser's accessor list is used.
 */
const WINDOW_SPEC = [
  { id: 'Screen.prototype', holder: 'Screen.prototype', proto: 'Screen.prototype', own: 'screen', wrong: 'navigator' },
  { id: 'Navigator.prototype', holder: 'Navigator.prototype', proto: 'Navigator.prototype', own: 'navigator', wrong: 'screen' },
  { id: 'NavigatorUAData.prototype', holder: 'NavigatorUAData.prototype', proto: 'NavigatorUAData.prototype', own: 'navigator.userAgentData', wrong: 'navigator' },
  { id: 'NetworkInformation.prototype', holder: 'NetworkInformation.prototype', proto: 'NetworkInformation.prototype', own: 'navigator.connection', wrong: 'navigator' },
  {
    id: 'window [Global]', holder: 'window', proto: 'Window.prototype', own: 'window', wrong: 'document',
    props: ['devicePixelRatio', 'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
      'screenX', 'screenY', 'screenLeft', 'screenTop'],
    // No method sweep on the global: its own names include alert/confirm/prompt, which block
    // the run, and hundreds of platform functions this extension never touches.
    methods: false
  },
  // ---- part 5 groups: prototypes whose METHODS this extension wraps --------------------
  // `ownMake` builds the instance because none of these can be named by a path from the
  // global — and it builds it in whichever realm is asking, so the two cross-realm columns
  // stay meaningful.
  { id: 'HTMLCanvasElement.prototype', holder: 'HTMLCanvasElement.prototype', proto: 'HTMLCanvasElement.prototype', ownMake: 'canvas', wrong: 'navigator' },
  { id: 'CanvasRenderingContext2D.prototype', holder: 'CanvasRenderingContext2D.prototype', proto: 'CanvasRenderingContext2D.prototype', ownMake: 'ctx2d', wrong: 'navigator' },
  { id: 'OffscreenCanvas.prototype', holder: 'OffscreenCanvas.prototype', proto: 'OffscreenCanvas.prototype', ownMake: 'offscreen', wrong: 'navigator' },
  { id: 'OffscreenCanvasRenderingContext2D.prototype', holder: 'OffscreenCanvasRenderingContext2D.prototype', proto: 'OffscreenCanvasRenderingContext2D.prototype', ownMake: 'offctx2d', wrong: 'navigator' },
  { id: 'WebGLRenderingContext.prototype', holder: 'WebGLRenderingContext.prototype', proto: 'WebGLRenderingContext.prototype', ownMake: 'gl', wrong: 'navigator' },
  { id: 'WebGL2RenderingContext.prototype', holder: 'WebGL2RenderingContext.prototype', proto: 'WebGL2RenderingContext.prototype', ownMake: 'gl2', wrong: 'navigator' },
  { id: 'Element.prototype', holder: 'Element.prototype', proto: 'Element.prototype', ownMake: 'div', wrong: 'navigator' },
  { id: 'Bluetooth.prototype', holder: 'Bluetooth.prototype', proto: 'Bluetooth.prototype', own: 'navigator.bluetooth', wrong: 'navigator' },
  { id: 'Intl.DateTimeFormat.prototype', holder: 'Intl.DateTimeFormat.prototype', proto: 'Intl.DateTimeFormat.prototype', ownMake: 'dtf', wrong: 'navigator' },
  { id: 'Date.prototype', holder: 'Date.prototype', proto: 'Date.prototype', ownMake: 'date', wrong: 'navigator' }
];

const WORKER_SPEC = [
  { id: 'WorkerNavigator.prototype', holder: 'WorkerNavigator.prototype', proto: 'WorkerNavigator.prototype', own: 'navigator', wrong: 'self' },
  { id: 'NavigatorUAData.prototype', holder: 'NavigatorUAData.prototype', proto: 'NavigatorUAData.prototype', own: 'navigator.userAgentData', wrong: 'navigator' },
  { id: 'NetworkInformation.prototype', holder: 'NetworkInformation.prototype', proto: 'NetworkInformation.prototype', own: 'navigator.connection', wrong: 'navigator' },
  // The worker half of part 5. A worker has no document, so the canvas/element factories are
  // absent here by construction and their groups record `(n/a)` rather than a false pass;
  // OffscreenCanvas is how a worker reaches a raster surface at all.
  { id: 'OffscreenCanvas.prototype', holder: 'OffscreenCanvas.prototype', proto: 'OffscreenCanvas.prototype', ownMake: 'offscreen', wrong: 'navigator' },
  { id: 'OffscreenCanvasRenderingContext2D.prototype', holder: 'OffscreenCanvasRenderingContext2D.prototype', proto: 'OffscreenCanvasRenderingContext2D.prototype', ownMake: 'offctx2d', wrong: 'navigator' },
  { id: 'WebGLRenderingContext.prototype', holder: 'WebGLRenderingContext.prototype', proto: 'WebGLRenderingContext.prototype', ownMake: 'offgl', wrong: 'navigator' },
  { id: 'Intl.DateTimeFormat.prototype', holder: 'Intl.DateTimeFormat.prototype', proto: 'Intl.DateTimeFormat.prototype', ownMake: 'dtf', wrong: 'navigator' },
  { id: 'Date.prototype', holder: 'Date.prototype', proto: 'Date.prototype', ownMake: 'date', wrong: 'navigator' }
];

/**
 * ONE implementation for both scopes. It is stringified into the worker source below and
 * evaluated as an expression in the page, so it must close over nothing: mw-navigator.js and
 * mw-workers.js keep mirrored copies of these getters and the whole point is to ask them the
 * same questions with the same code. `opts.frameUrl` is what turns the two cross-realm columns
 * on; a worker passes none and gets `-` there.
 */
const SWEEP = async function sweep(spec, opts) {
  var G = (typeof window !== 'undefined') ? window : self;
  var out = { scope: (typeof window !== 'undefined') ? 'window' : 'worker', groups: {}, meta: {} };

  function resolve(path, base) {
    if (!path) return undefined;
    var parts = String(path).split('.'), o = base;
    for (var i = 0; i < parts.length; i++) {
      if (o === null || o === undefined) return undefined;
      try { o = o[parts[i]]; } catch (e) { return undefined; }
    }
    return o;
  }

  // The comparable half: what KIND of thing came back, never how big it is.
  function kindOf(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    var t = typeof v;
    if (t !== 'object' && t !== 'function') return t;
    if (Array.isArray(v)) return 'array';
    var tag = '?';
    try { tag = Object.prototype.toString.call(v); } catch (e) {}
    return t + ' ' + tag;
  }
  // The printed half, and the one part 4 compares WITHIN a browser rather than across.
  function showOf(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    var t = typeof v;
    if (t === 'string') return 'string ' + JSON.stringify(v);
    if (t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') return t + ' ' + String(v);
    if (Array.isArray(v)) { try { return 'array ' + JSON.stringify(v); } catch (e) { return 'array (unserialisable)'; } }
    return kindOf(v);
  }
  function caught(e) {
    var n = 'Error', m = '';
    try { n = (e && e.name) || 'Error'; m = String(e && e.message); } catch (e2) {}
    return { verdict: 'throw ' + n, detail: n + ': ' + m };
  }
  function runCase(get, box) {
    var v;
    try { v = get.call(box.v); } catch (e) { return caught(e); }
    return { verdict: 'answer ' + kindOf(v), detail: showOf(v) };
  }
  function readProp(o, prop) {
    var v;
    try { v = o[prop]; } catch (e) { return caught(e); }
    return { verdict: 'answer ' + kindOf(v), detail: showOf(v) };
  }
  function accessorsOf(holder) {
    var names = [];
    try {
      Object.getOwnPropertyNames(holder).forEach(function (n) {
        var d = null;
        try { d = Object.getOwnPropertyDescriptor(holder, n); } catch (e) { return; }
        if (d && typeof d.get === 'function') names.push(n);
      });
    } catch (e) {}
    return names.sort();
  }

  // ---- part 5: the METHOD half of the same question --------------------------------------
  //
  // Enumerated, not hand-listed, for the reason the accessor half is: a list written out by
  // hand goes stale the day somebody wraps one more, and that is exactly how 129 accessor
  // divergences sat unlooked-at while nine methods had spot checks in test/pagework.mjs.
  //
  // CALLED WITH NO ARGUMENTS on purpose. A WebIDL operation validates its `this` before it
  // validates its arguments, so a foreign receiver still produces the platform's refusal; and
  // on the OWN receiver a missing-argument TypeError is produced by clean and by us alike, so
  // the comparison — which is of SHAPES, never of values — still holds. Passing plausible
  // arguments would mean inventing them for a hundred methods.
  var DESTRUCTIVE = {
    // Would tear down the thing being measured, or block on the user.
    //
    // requestDevice is NOT here, though it opens a chooser when it is called properly: every
    // call in this sweep passes ZERO arguments, and the argument check runs before anything
    // is shown — measured, it throws "1 argument required, but only 0 present." and no chooser
    // appears. Excluding it out of caution left the one Web Bluetooth method a page can reach
    // unchecked, which is the opposite of what a denylist is for.
    close: 1, terminate: 1, abort: 1, disconnect: 1, remove: 1, destroy: 1, releaseLock: 1,
    requestPermission: 1, requestFullscreen: 1, requestMIDIAccess: 1,
    getUserMedia: 1, webkitGetUserMedia: 1, share: 1, registerProtocolHandler: 1,
    unregisterProtocolHandler: 1, vibrate: 1, suspend: 1, resume: 1, start: 1, stop: 1,
    reload: 1, replace: 1, assign: 1, blur: 1, focus: 1, print: 1, open: 1,
    // Constructors-as-methods and iteration protocol: not receiver checks in any useful sense.
    constructor: 1
  };
  function methodsOf(holder) {
    var names = [];
    try {
      Object.getOwnPropertyNames(holder).forEach(function (n) {
        if (DESTRUCTIVE[n]) return;
        var d = null;
        try { d = Object.getOwnPropertyDescriptor(holder, n); } catch (e) { return; }
        if (d && typeof d.value === 'function') names.push(n);
      });
    } catch (e) {}
    return names.sort();
  }
  // ---- part 6: the SETTER half ------------------------------------------------------------
  //
  // Parts 1 and 5 ask `d.get` and `d.value`. `d.set` is the third thing a descriptor can hold
  // and nothing asked it — the design panel that agreed the receiver rule named it as a risk
  // and gave a case (NetworkInformation.prototype's `onchange` setter answering where the
  // platform refuses). It does not reproduce, and this part is why anyone can know that
  // without measuring again.
  //
  // `null` is the value written everywhere: it is legal for every event-handler setter and
  // harmless for the rest, and the question is the RECEIVER, never the value.
  var SET_DESTRUCTIVE = /^(location|href|opener|name|src|srcdoc|innerHTML|outerHTML|cookie|domain)$/;
  function settersOf(holder) {
    var names = [];
    try {
      Object.getOwnPropertyNames(holder).forEach(function (n) {
        // Assigning these navigates or tears the document down. The first run of this sweep
        // hung on window.location, which is a navigation and not a receiver test at all.
        if (SET_DESTRUCTIVE.test(n)) return;
        var d = null;
        try { d = Object.getOwnPropertyDescriptor(holder, n); } catch (e) { return; }
        if (d && typeof d.set === 'function') names.push(n);
      });
    } catch (e) {}
    return names.sort();
  }
  function runSetCase(set, box) {
    try { set.call(box.v, null); } catch (e) { return caught(e); }
    return { verdict: 'accepted', detail: 'accepted' };
  }

  // A method may answer, throw, or hand back a promise that settles either way. All three are
  // shapes the platform picks and we must not change — [FIX the-wrapper-answered-with-its-own-
  // error-for-a-foreign-receiver] was exactly a wrapper turning one into another.
  async function runMethodCase(fn, box) {
    var v;
    try { v = fn.call(box.v); } catch (e) { return caught(e); }
    if (v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function') {
      try { var r = await v; return { verdict: 'resolve ' + kindOf(r), detail: showOf(r) }; }
      catch (e2) { var c = caught(e2); return { verdict: 'reject ' + c.verdict.slice(6), detail: c.detail }; }
    }
    return { verdict: 'answer ' + kindOf(v), detail: showOf(v) };
  }

  // Builds one receiver box. The null/undefined test is STRICT on purpose: `document.all ==
  // null` is true — the [[IsHTMLDDA]] quirk this suite has a whole column for — and a loose
  // test here would silently drop the one receiver written to catch a loose test elsewhere.
  function fill(boxes, rec, name, make, why) {
    var v;
    try { v = make(); } catch (e) { boxes[name] = null; rec.skipped[name] = String((e && e.message) || e); return; }
    if (v === null || v === undefined) { boxes[name] = null; rec.skipped[name] = why; return; }
    boxes[name] = { v: v };
  }

  function mkFrame(url, hidden) {
    return new Promise(function (res) {
      var done = false;
      function finish(w) { if (!done) { done = true; res(w || null); } }
      try {
        var f = document.createElement('iframe');
        // setAttribute rather than f.style, and 300x200 rather than "big": the width has to be
        // SMALLER than any claimed screen so that innerWidth's clamp gives the frame a
        // different number from the top window. A full-size frame would make part 4 pass by
        // coincidence.
        f.setAttribute('style', hidden ? 'display:none' : 'width:300px;height:200px;border:0');
        f.addEventListener('load', function () { try { finish(f.contentWindow); } catch (e) { finish(null); } });
        f.addEventListener('error', function () { finish(null); });
        setTimeout(function () { finish(null); }, 10000);
        f.setAttribute('src', url);
        document.body.appendChild(f);
      } catch (e) { finish(null); }
    });
  }

  // Instances that cannot be named by a path from the global. Each takes the REALM to build
  // in, so the cross-realm columns get a child-realm instance rather than the parent's — the
  // whole point of those two columns.
  var FACTORIES = {
    canvas: function (W) { var c = W.document.createElement('canvas'); c.width = 64; c.height = 64; return c; },
    ctx2d: function (W) { return FACTORIES.canvas(W).getContext('2d'); },
    offscreen: function (W) { return new W.OffscreenCanvas(64, 64); },
    offctx2d: function (W) { return new W.OffscreenCanvas(64, 64).getContext('2d'); },
    gl: function (W) { return FACTORIES.canvas(W).getContext('webgl'); },
    gl2: function (W) { return FACTORIES.canvas(W).getContext('webgl2'); },
    offgl: function (W) { return new W.OffscreenCanvas(64, 64).getContext('webgl'); },
    div: function (W) { return W.document.createElement('div'); },
    dtf: function (W) { return new W.Intl.DateTimeFormat(); },
    date: function (W) { return new W.Date(0); }
  };
  function instanceOf(g, W) {
    if (!W) return undefined;
    if (g.ownMake) { try { return FACTORIES[g.ownMake](W); } catch (e) { return undefined; } }
    return resolve(g.own, W);
  }
  // Every factory group builds FOUR live instances — own, own again, and one per child realm —
  // and several of them are GPU-backed. Ten groups of that is enough to take the renderer down:
  // measured, each of CanvasRenderingContext2D.prototype and OffscreenCanvasRenderingContext2D.
  // prototype passes alone (1633 and 2829 assertions) and the two together crash the target.
  // So a group hands its instances back when it is done: a zeroed canvas frees its backing
  // store, and WEBGL_lose_context is the only way to return a context before GC feels like it.
  function release(v) {
    try {
      if (!v || typeof v !== 'object') return;
      if (typeof WebGLRenderingContext !== 'undefined' && v instanceof WebGLRenderingContext ||
          typeof WebGL2RenderingContext !== 'undefined' && v instanceof WebGL2RenderingContext) {
        var ext = v.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        if (v.canvas) { v.canvas.width = 0; v.canvas.height = 0; }
        return;
      }
      if (v.canvas) { v.canvas.width = 0; v.canvas.height = 0; return; }
      if (typeof v.width === 'number' && typeof v.height === 'number') { v.width = 0; v.height = 0; }
    } catch (e) {}
  }

  var frames = { sized: null, hidden: null };
  if (opts.frameUrl && typeof document !== 'undefined') {
    frames.sized = await mkFrame(opts.frameUrl, false);
    frames.hidden = await mkFrame(opts.frameUrl, true);
  }

  for (var gi = 0; gi < spec.length; gi++) {
    var g = spec[gi];
    var holder = resolve(g.holder, G);
    var rec = {
      present: !!holder, enumerated: [], props: [], absent: [],
      cases: {}, crossOwn: {}, crossOwnHidden: {}, ownIdentity: null, skipped: {},
      methods: [], mcases: {}, setters: [], scases: {}
    };
    out.groups[g.id] = rec;
    if (!holder) continue;
    rec.enumerated = accessorsOf(holder);

    var own = instanceOf(g, G);
    var own2 = instanceOf(g, G);
    rec.ownIdentity = (own === own2);

    // A box is `{ v: receiver }` or null. null means "this receiver does not exist here" and
    // is recorded as `(n/a)` rather than silently falling through to `undefined`, which is
    // itself one of the cases and would make a missing receiver indistinguishable from the
    // case that is deliberately undefined.
    var boxes = {};
    var xOwn = frames.sized ? instanceOf(g, frames.sized) : undefined;
    var xOwnH = frames.hidden ? instanceOf(g, frames.hidden) : undefined;
    var noRealm = 'no second realm in this scope';
    fill(boxes, rec, 'own', function () { return own; }, 'the instance does not exist in this scope');
    fill(boxes, rec, 'own again', function () { return own2; }, 'the instance does not exist in this scope');
    fill(boxes, rec, 'prototype', function () { return resolve(g.proto, G); }, 'no interface prototype here');
    fill(boxes, rec, 'Object.create(proto)', function () {
      var p = resolve(g.proto, G);
      return (p && typeof p === 'object') ? Object.create(p) : undefined;
    }, 'no prototype to derive from');
    fill(boxes, rec, 'Proxy(own)', function () {
      return (own && (typeof own === 'object' || typeof own === 'function')) ? new Proxy(own, {}) : undefined;
    }, 'the instance is not an object');
    fill(boxes, rec, '{}', function () { return {}; }, '');
    // Set directly: these two ARE the receiver, so the null/undefined test in fill() would
    // throw them away as "not applicable".
    boxes['null'] = { v: null };
    boxes['undefined'] = { v: undefined };
    fill(boxes, rec, 'document.all', function () {
      return (typeof document !== 'undefined') ? document.all : undefined;
    }, 'no document in a worker');
    fill(boxes, rec, 'wrong type', function () { return resolve(g.wrong, G); }, 'no wrong-type object here');
    fill(boxes, rec, 'cross-realm', function () { return xOwn; },
      frames.sized ? 'the interface is absent in the child realm' : noRealm);
    fill(boxes, rec, 'cross-realm hidden', function () { return xOwnH; },
      frames.hidden ? 'the interface is absent in the child realm' : noRealm);

    var props = g.props || rec.enumerated;
    for (var pi = 0; pi < props.length; pi++) {
      var prop = props[pi];
      var d = null;
      try { d = Object.getOwnPropertyDescriptor(holder, prop); } catch (e) {}
      if (!d || typeof d.get !== 'function') { rec.absent.push(prop); continue; }
      rec.props.push(prop);
      var get = d.get;
      for (var ri = 0; ri < opts.receivers.length; ri++) {
        var rn = opts.receivers[ri];
        var b = boxes[rn];
        rec.cases[prop + '|' + rn] = b ? runCase(get, b) : { verdict: '(n/a)', detail: '(n/a)' };
      }
      // Part 4's other half: what the CHILD realm answers when it reads the property the
      // ordinary way. Compared against `cross-realm` above, inside one browser.
      if (xOwn !== null && xOwn !== undefined) rec.crossOwn[prop] = readProp(xOwn, prop);
      if (xOwnH !== null && xOwnH !== undefined) rec.crossOwnHidden[prop] = readProp(xOwnH, prop);
    }

    // ---- the method half, same receivers, same holder ----
    if (g.methods !== false && opts.methods) {
      var mnames = methodsOf(holder);
      for (var mi = 0; mi < mnames.length; mi++) {
        var mname = mnames[mi];
        var md = null;
        try { md = Object.getOwnPropertyDescriptor(holder, mname); } catch (e) {}
        if (!md || typeof md.value !== 'function') continue;
        rec.methods.push(mname);
        for (var mri = 0; mri < opts.receivers.length; mri++) {
          var mrn = opts.receivers[mri];
          var mb = boxes[mrn];
          rec.mcases[mname + '|' + mrn] = mb
            ? await runMethodCase(md.value, mb)
            : { verdict: '(n/a)', detail: '(n/a)' };
        }
      }
    }

    // ---- the setter half, same receivers, same holder ----
    var snames = settersOf(holder);
    for (var si = 0; si < snames.length; si++) {
      var sname = snames[si];
      var sd = null;
      try { sd = Object.getOwnPropertyDescriptor(holder, sname); } catch (e) {}
      if (!sd || typeof sd.set !== 'function') continue;
      rec.setters.push(sname);
      for (var sri = 0; sri < opts.receivers.length; sri++) {
        var srn = opts.receivers[sri];
        var sb = boxes[srn];
        rec.scases[sname + '|' + srn] = sb ? runSetCase(sd.set, sb) : { verdict: '(n/a)', detail: '(n/a)' };
      }
    }

    // Hand the group's instances back before the next one builds its own — see release().
    // Only what this group MADE: a group that named an existing object (navigator.connection,
    // screen) must not have it destroyed underneath the groups that follow.
    if (g.ownMake) { release(own); release(own2); release(xOwn); release(xOwnH); }
  }

  try { out.meta.cores = String(navigator.hardwareConcurrency); } catch (e) { out.meta.cores = 'ERR'; }
  out.meta.frames = { sized: !!frames.sized, hidden: !!frames.hidden };
  return out;
};

const PAGE = '<!doctype html><meta charset=utf-8><title>receivers</title><body>receivers';
const FRAME = '<!doctype html><meta charset=utf-8><title>receivers frame</title><body>frame';
const WORKER_SRC = `self.onmessage = async function (e) {
  var out;
  try { out = await (${SWEEP.toString()})(e.data.spec, e.data.opts); }
  catch (err) { out = { __err: String((err && err.stack) || err) }; }
  postMessage(out);
};`;

const server = createServer((q, r) => {
  if (q.url === '/w.js') {
    r.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(WORKER_SRC);
    return;
  }
  const body = q.url.indexOf('/frame.html') === 0 ? FRAME : PAGE;
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

/**
 * `winSpec`/`workerSpec` are passed in rather than read from the module constants so that the
 * second run can be handed the CLEAN browser's property lists: the clean browser is the
 * authority on what accessors exist, and asking ours about a list it enumerated itself would
 * hide a property it added or removed.
 */
async function read(clean, winSpec, workerSpec) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-receivers-'));
  let browser = null;
  const ctx = clean
    ? await (browser = await chromium.launch({ ...BROWSER, headless: !headed })).newContext()
    : await chromium.launchPersistentContext(dir, {
      ...BROWSER, headless: !headed,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
  try {
    if (!clean) {
      try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch { /* already up */ }
      await new Promise((r) => setTimeout(r, 2500));
    }
    const winOpts = { receivers: RECV_NAMES, frameUrl: '/frame.html', methods: METHODS };
    // ONE PAGE PER GROUP, not one page for the spec. Each factory group builds four live
    // instances — own, own again, and one per child realm — and several are GPU-backed; ten
    // groups of that in a single document takes the renderer down. Measured: the 2D-context
    // groups pass alone (1633 and 2829 assertions) and crash together, and releasing the
    // instances at the end of each group was NOT enough. A page per group bounds the cost
    // structurally instead of tuning the suite to sit just under a limit nobody has measured,
    // and it costs a navigation per group.
    //
    // The results are merged rather than concatenated because everything downstream indexes
    // groups by id, and each page contributes exactly the ids it swept.
    const win = { scope: 'window', groups: {}, meta: {} };
    for (const g of winSpec) {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'load' });
      const part = await page.evaluate(
        `(${SWEEP.toString()})(${JSON.stringify([g])}, ${JSON.stringify(winOpts)})`);
      Object.assign(win.groups, part.groups);
      win.meta = part.meta;
      await page.close();
    }
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load' });
    const worker = await page.evaluate(({ spec, opts }) => new Promise((resolve) => {
      try {
        const w = new Worker('/w.js');
        const t = setTimeout(() => resolve({ __err: 'timeout' }), 25000);
        w.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
        w.onerror = (e) => { clearTimeout(t); resolve({ __err: 'onerror ' + e.message }); };
        w.postMessage({ spec, opts });
      } catch (e) { resolve({ __err: String(e) }); }
    }), { spec: workerSpec, opts: { receivers: RECV_NAMES, methods: METHODS } });
    return { win, worker };
  } finally {
    await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds the profile */ }
  }
}

// --only=<substring> restricts the sweep to matching group ids. Not a feature for the suite's
// own run — it is how a group that crashes the renderer gets bisected without guessing.
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
if (ONLY) {
  // `=id` is exact. Substring alone cannot separate CanvasRenderingContext2D.prototype from
  // OffscreenCanvasRenderingContext2D.prototype — the second CONTAINS the first — and a
  // bisect that cannot name one group at a time reports the wrong culprit.
  const keep = (s) => (ONLY[0] === '='
    ? s.filter((g) => g.id === ONLY.slice(1))
    : s.filter((g) => g.id.toLowerCase().includes(ONLY.toLowerCase())));
  WINDOW_SPEC.splice(0, WINDOW_SPEC.length, ...keep([...WINDOW_SPEC]));
  WORKER_SPEC.splice(0, WORKER_SPEC.length, ...keep([...WORKER_SPEC]));
  console.log(`(--only=${ONLY}: ${WINDOW_SPEC.length} window group(s), ${WORKER_SPEC.length} worker group(s))`);
}

const CLEAN = await read(true, WINDOW_SPEC, WORKER_SPEC);
// Ours sweeps the CLEAN browser's list, so a name we removed shows up as missing rather than
// silently dropping out of the comparison. The same reason applies to methods.
const withProps = (spec, scope) => spec.map((g) => {
  const seen = (scope.groups || {})[g.id];
  return seen && seen.props && seen.props.length ? { ...g, props: seen.props } : g;
});
const OURS = await read(false, withProps(WINDOW_SPEC, CLEAN.win), withProps(WORKER_SPEC, CLEAN.worker));
server.close();

/* ---------------------------------------------------------------- 0) is anything live -- */

console.log('\n0) the extension is running, and the realms this suite needs exist');
// A worker that never answered would leave every worker group "absent in the clean browser"
// and skipped, which reads exactly like a pass — the shape memory calls "a skip path printing
// FAILURES: 0".
ok(!CLEAN.worker.__err, `clean: the worker sweep ran (${CLEAN.worker.__err || 'ok'})`);
ok(!OURS.worker.__err, `ours: the worker sweep ran (${OURS.worker.__err || 'ok'})`);
ok(OURS.win.meta.cores !== CLEAN.win.meta.cores,
  `window: the extension is active — cores ours ${OURS.win.meta.cores} vs clean ${CLEAN.win.meta.cores}` +
  (OURS.win.meta.cores === CLEAN.win.meta.cores ? ' (IDENTICAL: nothing was tested)' : ''));
ok((OURS.worker.meta || {}).cores !== (CLEAN.worker.meta || {}).cores,
  `worker: the extension is active — cores ours ${(OURS.worker.meta || {}).cores} vs clean ${(CLEAN.worker.meta || {}).cores}`);
for (const side of [['clean', CLEAN], ['ours', OURS]]) {
  const f = side[1].win.meta.frames || {};
  ok(f.sized && f.hidden, `${side[0]}: both child realms loaded (sized ${!!f.sized}, hidden ${!!f.hidden}) — without them the cross-realm columns test nothing`);
}

console.log('\nreceiver columns, in table order:');
RECEIVERS.forEach(([name, why], i) => console.log(`  ${String(i + 1).padStart(2)}  ${name.padEnd(22)} ${why}`));
console.log('  cells: . matches clean   X differs   - receiver not applicable   ? no such accessor');

/* ------------------------------------------------------- the comparison, scope by scope -- */

const SCOPES = [['window', CLEAN.win, OURS.win, WINDOW_SPEC], ['worker', CLEAN.worker, OURS.worker, WORKER_SPEC]];
const xrealmMisses = [];
let sweptCases = 0, movedValues = 0;

console.log('\n1) throw-vs-answer, and the KIND of the answer, against a clean browser');
for (const [scope, cleanScope, oursScope, spec] of SCOPES) {
  for (const g of spec) {
    const c = (cleanScope.groups || {})[g.id], o = (oursScope.groups || {})[g.id];
    if (!c || !c.present) { console.log(`\n=== ${scope} · ${g.id} — absent in the clean browser, skipped`); continue; }
    ok(o && o.present, `${scope} · ${g.id}: the interface exists with the extension loaded too`);
    if (!o || !o.present) continue;

    console.log(`\n=== ${scope} · ${g.id}   ${c.props.length} accessors` +
      (c.ownIdentity === false ? '   (the instance is REBUILT on every read)' : ''));
    if (c.absent.length) console.log(`    not accessors here: ${c.absent.join(', ')}`);
    // Why a column is `-`. A receiver that quietly stopped being built would otherwise look
    // like a receiver both browsers agree about.
    const skipped = Object.keys(c.skipped || {});
    if (skipped.length) console.log(`    receivers not applicable: ${skipped.map((k) => `${k} (${c.skipped[k] || 'n/a'})`).join(', ')}`);
    const extra = o.enumerated.filter((n) => c.enumerated.indexOf(n) === -1);
    const gone = c.enumerated.filter((n) => o.enumerated.indexOf(n) === -1);
    if (extra.length) console.log(`    note: ours has accessors clean does not — ${extra.join(', ')}`);
    if (gone.length) console.log(`    note: clean has accessors ours does not — ${gone.join(', ')}`);

    for (const prop of c.props) {
      const oursHas = o.props.indexOf(prop) !== -1;
      let row = '';
      for (const rn of RECV_NAMES) {
        const cc = c.cases[prop + '|' + rn], oc = o.cases[prop + '|' + rn];
        if (!oursHas || !cc || !oc) { row += '?'; continue; }
        if (cc.verdict === '(n/a)' && oc.verdict === '(n/a)') { row += '-'; continue; }
        row += (cc.verdict === oc.verdict) ? '.' : 'X';
      }
      const own = c.cases[prop + '|own'], ownO = oursHas ? o.cases[prop + '|own'] : null;
      const moved = ownO && own && own.detail !== ownO.detail;
      if (moved) movedValues++;
      console.log('  ' + (moved ? '*' : ' ') + prop.padEnd(30) + row + '   ' +
        (own ? own.detail.slice(0, 34) : '') + (moved ? '  ->  ' + ownO.detail.slice(0, 34) : ''));

      ok(oursHas, `${scope} · ${g.id}.${prop}: still an accessor with the extension loaded`);
      if (!oursHas) continue;
      for (const rn of RECV_NAMES) {
        const cc = c.cases[prop + '|' + rn], oc = o.cases[prop + '|' + rn];
        if (!cc || !oc) continue;
        if (cc.verdict === '(n/a)' && oc.verdict === '(n/a)') continue;
        sweptCases++;
        ok(cc.verdict === oc.verdict,
          `${scope} · ${g.id}.${prop} with receiver ${rn}: clean "${cc.verdict}" (${cc.detail.slice(0, 40)}) ` +
          `ours "${oc.verdict}" (${oc.detail.slice(0, 40)})`);
        if ((rn === 'cross-realm' || rn === 'cross-realm hidden') &&
            cc.verdict.indexOf('answer') === 0 && oc.verdict.indexOf('answer') !== 0) {
          xrealmMisses.push(`${scope} · ${g.id}.${prop} [${rn}] clean ${cc.verdict} ours ${oc.verdict}`);
        }
      }
    }
  }
}
console.log(`\n  ${sweptCases} receiver cases swept; * marks the ${movedValues} accessors whose own-instance value moved`);

/* --------------------------------------------------------------- 2) the error text ------- */

// Only where the two already agree that it throws — a case that disagrees about THAT is
// already counted above, and counting it twice would make the total unreadable. What is left
// is the question CreepJS actually asks: two browsers both refuse, do they refuse alike.
console.log('\n2) where both refuse, the refusal reads the same');
let textChecked = 0;
for (const [scope, cleanScope, oursScope, spec] of SCOPES) {
  for (const g of spec) {
    const c = (cleanScope.groups || {})[g.id], o = (oursScope.groups || {})[g.id];
    if (!c || !c.present || !o || !o.present) continue;
    for (const prop of c.props) {
      for (const rn of RECV_NAMES) {
        const cc = c.cases[prop + '|' + rn], oc = o.cases[prop + '|' + rn];
        if (!cc || !oc || cc.verdict !== oc.verdict || cc.verdict.indexOf('throw') !== 0) continue;
        textChecked++;
        ok(cc.detail === oc.detail,
          `${scope} · ${g.id}.${prop} with receiver ${rn}: clean "${cc.detail}" ours "${oc.detail}"`);
      }
    }
  }
}
console.log(`  ${textChecked} refusals compared word for word`);

/* ------------------------------------------------- 3) the cross-realm case, restated ----- */

// One assertion rather than one per case: every failure here is already counted in part 1, and
// this is here to say plainly which of them are THE case — a foreign instance of the right
// interface, which the platform answers for and both a brand list and an identity test refuse.
console.log('\n3) a cross-realm instance of the right interface must ANSWER');
console.log(`  ${xrealmMisses.length} of the cross-realm cases clean answers are refused by ours`);
for (const m of xrealmMisses.slice(0, 40)) console.log('    ' + m);
if (xrealmMisses.length > 40) console.log(`    ... and ${xrealmMisses.length - 40} more`);
ok(xrealmMisses.length === 0,
  `${xrealmMisses.length} cross-realm cases throw where a clean browser answers (see the list above)`);

/* ----------------------------- 4) the parent's getter vs the child's own read ------------ */

// The invariant a delegating fix can break without breaking part 1: in a clean browser the
// descriptor getter called with a child realm's receiver gives exactly what that child reports
// for itself, and both sides of this comparison live in the SAME browser, so the profile's
// numbers never enter it. Asserted only where clean holds it — the clean browser is the
// authority for the invariant too, not just for the verdicts.
console.log('\n4) the parent getter, handed a child realm, agrees with what the child reports');
let inv = 0, invHeld = 0;
for (const [label, recvKey, ownKey] of [['sized', 'cross-realm', 'crossOwn'], ['hidden', 'cross-realm hidden', 'crossOwnHidden']]) {
  for (const g of WINDOW_SPEC) {
    const c = (CLEAN.win.groups || {})[g.id], o = (OURS.win.groups || {})[g.id];
    if (!c || !c.present || !o || !o.present) continue;
    for (const prop of c.props) {
      const cCall = c.cases[prop + '|' + recvKey], cOwn = (c[ownKey] || {})[prop];
      const oCall = o.cases[prop + '|' + recvKey], oOwn = (o[ownKey] || {})[prop];
      if (!cCall || !cOwn || !oCall || !oOwn) continue;
      if (cCall.detail !== cOwn.detail) continue;   // clean does not hold it here; nothing to assert
      // A getter that REFUSED the child's receiver disagrees with the child trivially, and
      // part 1 has already counted that refusal. Same rule as part 2: each defect is counted
      // once, so the total stays a number somebody can reason about.
      if (oCall.verdict.indexOf('throw') === 0) continue;
      invHeld++;
      const same = oCall.detail === oOwn.detail;
      if (!same) inv++;
      ok(same, `${g.id}.${prop} (${label} frame): getter.call(child) gave "${oCall.detail}" ` +
        `while the child itself reports "${oOwn.detail}" — clean agrees with itself here`);
    }
  }
}
console.log(`  ${invHeld} cases where a clean browser's parent-getter and child-read agree; ${inv} where ours do not`);

/* ------------------------------------------------- 5) the same question, for METHODS ----- */

// Until this part existed, the method half of "what does a foreign receiver get" was nine
// names hand-written in test/pagework.mjs part 4. The accessor half, swept properly, turned up
// 129 divergences nobody had looked for — including two shapes (Object.create(proto) and
// new Proxy(own,{})) that no hand-written probe in this repo had ever tried. This is the same
// sweep, enumerated rather than listed, over the prototypes whose methods get wrapped.
//
// Methods are called with NO ARGUMENTS: WebIDL checks `this` before it checks arguments, so a
// foreign receiver still produces the platform's refusal, and on the own instance a
// missing-argument TypeError comes back from clean and from us alike. The comparison is of
// SHAPES — throw vs return vs resolve vs reject, and the error name — never of values.
// LANDED RED AND WAS CLOSED. It ran behind --methods for exactly one day, because on the
// build that introduced it, it reported 72 real divergences. Every one is fixed now and the
// part runs by default; `--no-methods` skips it. What it found, so a later reader can tell
// what this part is worth:
//
//   Date.prototype.getDate.call({})   clean "this is not a Date object."
//                                     ours  "utcDate.getTime is not a function"
//     — a wrapper naming an internal variable to any page. 241 cases, three separate causes:
//       the refusal has to come from the method's OWN native (V8 names the method), the guard
//       must keep the native's .length, and the worker payload is SLOPPY so a null receiver
//       was coerced to the global before it reached the native. Fixing only the window half
//       split window from worker, which test/creepjs.mjs caught.
//   canvas.getContext()  clean throws "1 argument required", ours returned null
//   canvas.toBlob()      clean "1 argument required", ours "parameter 1 is not of type Function"
//     — and the same for measureText/fillText/strokeText/getImageData/getParameter: a declared
//       parameter makes `arguments.length` the DECLARED count, so the native was handed
//       undefined where the page passed nothing and answered about the TYPE, or answered at
//       all. Guarded now by forwarding to the native when the count is short.
//   OffscreenCanvas.convertToBlob()  clean rejects InvalidStateError, ours resolved a Blob
//     — not a message: the noising works on a COPY, and a copy always has a context, so a
//       canvas the platform calls unusable became usable.
//
// The full sweep also crashed the renderer, and that was structural rather than a defect in
// any group: each factory group builds four live instances across three realms, several
// GPU-backed. read() now gives each GROUP its own page, which bounds it by construction.
if (!METHODS) {
  console.log('\n5) wrapped METHODS — skipped by --no-methods');
}
if (METHODS) {
console.log('\n5) the same question, asked of wrapped METHODS');
let mSwept = 0, mChecked = 0, mTextChecked = 0;
for (const [scope, cleanScope, oursScope, spec] of SCOPES) {
  for (const g of spec) {
    const c = (cleanScope.groups || {})[g.id], o = (oursScope.groups || {})[g.id];
    if (!c || !c.present || !c.methods || !c.methods.length) continue;
    if (!o || !o.present) continue;
    // A group whose instance could not be built here answers `(n/a)` everywhere; say so once
    // rather than printing a wall of dashes, and never let it look like a pass.
    const built = c.cases || {};
    const ownBox = c.mcases[c.methods[0] + '|own'];
    const haveOwn = ownBox && ownBox.verdict !== '(n/a)';
    console.log(`\n=== ${scope} · ${g.id}   ${c.methods.length} methods` +
      (haveOwn ? '' : '   (no instance in this scope — receiver columns only)') +
      (built ? '' : ''));
    const mGone = c.methods.filter((n) => o.methods.indexOf(n) === -1);
    const mExtra = o.methods.filter((n) => c.methods.indexOf(n) === -1);
    if (mGone.length) console.log(`    note: clean has methods ours does not — ${mGone.join(', ')}`);
    if (mExtra.length) console.log(`    note: ours has methods clean does not — ${mExtra.join(', ')}`);

    for (const m of c.methods) {
      const oursHas = o.methods.indexOf(m) !== -1;
      let row = '';
      for (const rn of RECV_NAMES) {
        const cc = c.mcases[m + '|' + rn], oc = oursHas ? o.mcases[m + '|' + rn] : null;
        if (!oursHas || !cc || !oc) { row += '?'; continue; }
        if (cc.verdict === '(n/a)' && oc.verdict === '(n/a)') { row += '-'; continue; }
        row += (cc.verdict === oc.verdict) ? '.' : 'X';
      }
      if (/[X?]/.test(row) || process.argv.includes('--all')) {
        console.log('   ' + m.padEnd(30) + row);
      }
      ok(oursHas, `${scope} · ${g.id}.${m}: still a method with the extension loaded`);
      if (!oursHas) continue;
      for (const rn of RECV_NAMES) {
        const cc = c.mcases[m + '|' + rn], oc = o.mcases[m + '|' + rn];
        if (!cc || !oc) continue;
        if (cc.verdict === '(n/a)' && oc.verdict === '(n/a)') continue;
        mSwept++;
        // The own instance is the one receiver whose ANSWER may legitimately differ — that is
        // the spoof. Its refusal-vs-answer shape still has to match.
        const shapeOnly = (rn === 'own' || rn === 'own again');
        const cv = shapeOnly ? cc.verdict.split(' ')[0] : cc.verdict;
        const ov = shapeOnly ? oc.verdict.split(' ')[0] : oc.verdict;
        mChecked++;
        ok(cv === ov,
          `${scope} · ${g.id}.${m}() with receiver ${rn}: clean "${cc.verdict}" (${cc.detail.slice(0, 40)}) ` +
          `ours "${oc.verdict}" (${oc.detail.slice(0, 40)})`);
        // Where both refuse, the refusal must READ the same — this is the half that
        // [FIX the-wrapper-answered-with-its-own-error-for-a-foreign-receiver] was about:
        // the shapes matched, the message named a method the page never called.
        if (cv === ov && /^(throw|reject)/.test(cc.verdict) && !shapeOnly) {
          mTextChecked++;
          ok(cc.detail === oc.detail,
            `${scope} · ${g.id}.${m}() [${rn}] refuses with the platform's own words\n` +
            `      clean ${cc.detail}\n      ours  ${oc.detail}`);
        }
      }
    }
  }
}
console.log(`\n  ${mSwept} method receiver cases swept, ${mChecked} compared, ` +
  `${mTextChecked} refusals compared word for word` +
  (process.argv.includes('--all') ? '' : '   (only rows with a difference are printed; --all for every row)'));
}

/* -------------------------------------------------- 6) and again, for SETTERS ------------ */

// The third thing a descriptor can hold. Parts 1 and 5 ask `d.get` and `d.value`; nothing
// asked `d.set` until this part, and the design panel that agreed the receiver rule had named
// it as a risk with a specific case — NetworkInformation.prototype's `onchange` setter
// answering where the platform refuses. It does not reproduce: 0 divergences on the build
// this landed against. That is worth a part rather than a note, because the next setter
// somebody wraps would otherwise be as unlooked-at as the methods were.
console.log('\n6) and again, for SETTERS');
let sSwept = 0, sChecked = 0;
for (const [scope, cleanScope, oursScope, spec] of SCOPES) {
  for (const g of spec) {
    const c = (cleanScope.groups || {})[g.id], o = (oursScope.groups || {})[g.id];
    if (!c || !c.present || !c.setters || !c.setters.length) continue;
    if (!o || !o.present) continue;
    const gone = c.setters.filter((n) => o.setters.indexOf(n) === -1);
    const extra = o.setters.filter((n) => c.setters.indexOf(n) === -1);
    let rows = 0;
    for (const s of c.setters) {
      const oursHas = o.setters.indexOf(s) !== -1;
      let row = '';
      for (const rn of RECV_NAMES) {
        const cc = c.scases[s + '|' + rn], oc = oursHas ? o.scases[s + '|' + rn] : null;
        if (!oursHas || !cc || !oc) { row += '?'; continue; }
        if (cc.verdict === '(n/a)' && oc.verdict === '(n/a)') { row += '-'; continue; }
        row += (cc.verdict === oc.verdict) ? '.' : 'X';
      }
      if (/[X?]/.test(row)) { console.log('   ' + s.padEnd(30) + row); rows++; }
      ok(oursHas, `${scope} · ${g.id}.${s}: still a setter with the extension loaded`);
      if (!oursHas) continue;
      for (const rn of RECV_NAMES) {
        const cc = c.scases[s + '|' + rn], oc = o.scases[s + '|' + rn];
        if (!cc || !oc) continue;
        if (cc.verdict === '(n/a)' && oc.verdict === '(n/a)') continue;
        sSwept++; sChecked++;
        ok(cc.verdict === oc.verdict,
          `${scope} · ${g.id}.${s} = null with receiver ${rn}: clean "${cc.verdict}" ` +
          `(${cc.detail.slice(0, 50)}) ours "${oc.verdict}" (${oc.detail.slice(0, 50)})`);
      }
    }
    if (gone.length || extra.length || rows) {
      console.log(`\n=== ${scope} · ${g.id}   ${c.setters.length} setters`);
      if (gone.length) console.log(`    note: clean has setters ours does not — ${gone.join(', ')}`);
      if (extra.length) console.log(`    note: ours has setters clean does not — ${extra.join(', ')}`);
    }
  }
}
console.log(`  ${sSwept} setter receiver cases swept, ${sChecked} compared` +
  '   (only rows with a difference are printed)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
