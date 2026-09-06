(function () {
    'use strict';
    var MW = window.__AFP_MW__;
    // [FIX eight-copies-of-the-profile-reader] _prof used to be copied verbatim into every
    // module, each with its OWN memo, so one page load parsed the profile once per module
    // instead of once. The reader now lives in mw-core.js and is taken from MW below.
    if (!MW) return;
    var _prof = MW.prof;
    var _STEALTH = MW.STEALTH;
    var _FEAT = MW.FEAT;
    var ID = MW.ID;
    var _mn = MW.mn;
    // [FIX host-mode] The font allowlist asks this at effect time. See mw-core.
    var _hostHwNow = (MW && MW.hostHwNow) ? MW.hostHwNow : function () { return false; };
    var _getSessionSeed = MW.getSessionSeed;
    var _BASE_FONTS = MW.BASE_FONTS;
    // [FIX status-was-a-page-readable-key] The module list used to be written into
    // sessionStorage['v.ui.t'] as self-describing JSON — {"canvas":true,"webgl":true,…} —
    // which any page could read from its first inline script, on an origin where a clean
    // Chrome has NO storage keys at all (measured: extension off, zero keys). It named
    // every protection that was running, for free, without probing anything.
    //
    // Its only readers are popup.js checkProtectionsOnce and the afp-*-console-check
    // files. That popup probe ALREADY runs through chrome.scripting with world: MAIN and
    // ALREADY reads the non-enumerable window.__t0 in the same call, so a
    // non-enumerable window property reaches exactly the same reader and nobody else.
    // Same shape and the same reason as __w0 / __p0 — see [FIX clientCode-w0-enumerable].
    function _statusMark(key) {
        try {
            var st = window.__t0;
            if (!st) {
                st = {};
                try {
                    Object.defineProperty(window, '__t0', {
                        value: st, writable: true, configurable: true, enumerable: false
                    });
                } catch (eD) { window.__t0 = st; }
            }
            st[key] = true;
        } catch (e1) {}
    }
    // [FIX stealth-first-load-noised-the-canvas] Stealth turns the canvas and fonts
    // modules off, but the mode is unknown while this file installs its patches: it lives
    // in sessionStorage per TAB and a first load has none, so the first page of every new
    // tab installs the normal-mode patches. The MODE is knowable by the time a page draws —
    // dyn/mode/<mode>.js publishes it right after this bundle and before the page's first
    // script — so what the patches must not do is decide at install time. Measured, one
    // origin, stealth selected:
    //     canvas  first load 2322357496, every load after 1576997145 (the host's REAL one)
    //     text    first load 137.7911/143.9413/124.8180, after 137.7891/143.9453/124.8203
    // Two fingerprints for one site, and the stable one was the machine's own. Both effect
    // sites ask here instead, so the first load agrees with the rest.
    //
    // Defined at module scope on purpose: the canvas noise and the text-metric substitution
    // live in two different IIFEs, and the first version of this fix put it inside one of
    // them — measureText then threw a ReferenceError on every call, in BOTH modes.
    // [FIX wasm-markers-were-client-litter] background.js hands the WASM instance over as
    // window.__w0 / __w1. They were made non-enumerable once, to escape CreepJS's
    // getClientCode — but its OTHER collector, getClientLitter, diffs
    // Object.getOwnPropertyNames(window) against a FRESH IFRAME, where enumerability means
    // nothing. Measured on abrahamjuliot.github.io with this build: the litter list was
    // ["0", "__w0", "__w1"] — "0" is the probe's own iframe, the other two were ours, on
    // every page, and they are hashed into the `code` value the page prints.
    //
    // Everything else we put on window (__p0, __t0, __r0, __s0) cancels in that diff,
    // because our content scripts run in the iframe too. The WASM pair cannot: it is
    // injected into the top frame only. So it is TAKEN instead of left lying — copied into
    // this closure and deleted from window the moment it arrives. The window property
    // exists between background.js setting it and the next event-loop turn, and nothing
    // outside this file reads it any more: the popup and background both ask __t0 now.
    var _W = null;
    function _wasm() {
        if (_W) return _W;
        try {
            var w = window.__w0;
            if (w) {
                _W = w;
                _markStatus('wasm');
                try { delete window.__w0; } catch (eD0) { try { window.__w0 = undefined; } catch (e) {} }
                try { delete window.__w1; } catch (eD1) { try { window.__w1 = undefined; } catch (e) {} }
            }
        } catch (eW) {}
        return _W;
    }
    try { window.addEventListener('ui:w', function () { _wasm(); }); } catch (eL) {}

    function _noiseOff() {
        try { return !!(MW && MW.stealthNow && MW.stealthNow()); } catch (e) { return false; }
    }
    // [FIX a-switch-off-its-default-was-inert-on-the-first-load] The feature twin of
    // _noiseOff, and it exists for the same reason that one does: _FEAT is settled as
    // mw-core loads, and on the first load of an origin there is nothing to settle it FROM,
    // so the SHIPPED defaults win. Every flag but clientRects ships ON — so a user who
    // turned canvas OFF still got noise on the first load of each origin and clean pixels on
    // every load after. Measured on the rig, same origin, canvas switched off: hash
    // 1368782022 on the first load and 3849956615 on the second. Two hashes for one site is
    // worse than either answer alone.
    //
    // Frozen per name, for the reason spelled out at _featNow in mw-core.js: a gate that
    // re-read the flags would let one document produce both hashes.
    //
    // ONLY 'canvas' is asked here today, and the install gate above is untouched — on the
    // first load the default is ON so the patch is installed anyway, and from the second
    // load the flag is known and the old gate already does the right thing. webgl and fonts
    // are deliberately NOT converted with it: `webgl` also drives the UNMASKED_* strings in
    // mw-navigator.js, and honouring it here alone would leave a page claiming Iris Xe while
    // handing back the host GPU's own readback pixels — a split, not a fix. Whatever is
    // added here must be added to _on in mw/mw-workers.js in the same commit, or the window
    // and the worker answer differently on the same page.
    var _featOffMemo = {};
    function _featOff(name) {
        if (!Object.prototype.hasOwnProperty.call(_featOffMemo, name)) {
            var off;
            try {
                off = (MW && MW.featNow) ? !MW.featNow(name) : !(_FEAT && _FEAT[name] !== false);
            } catch (e) { off = false; }
            _featOffMemo[name] = !!off;
        }
        return _featOffMemo[name];
    }
    var _markStatus = (MW && MW.markStatus) ? function (k) { try { MW.markStatus(k); } catch (e) { _statusMark(k); } } : _statusMark;
    // _nativeFns was read here only by the AudioContext and AnalyserNode patches, which
    // are gone — see the "AUDIO — НЕ ПАТЧИМ" note below.
    // [FIX g0-deleted-before-it-was-ever-called] The two getContext wrappers below used to
    // reach for window.__g0 (mw-navigator's per-context WebGL getParameter wrap) at CALL
    // time — i.e. whenever the page asks for a context, long after document_start. But
    // mw-cleanup.js, which runs last in the manifest, has '__g0' in its delete list, so by
    // the time any page could call getContext the global was already gone: the
    // `typeof window.__g0 === 'function'` guard silently failed every single time and the
    // instance-level wrap never ran once. Only the prototype patch was ever in effect —
    // exactly the case mw-navigator's comment says the instance wrap exists to cover
    // ("Chrome иногда отдаёт getParameter с контекста, а prototype-override игнорируется").
    // Captured here at module load instead: mw-canvas-audio.js runs after mw-navigator.js
    // and before mw-cleanup.js, so the reference is live, survives the cleanup, and needs
    // no page-visible global at all.
    var _wrapGL = (typeof MW.wrapGL === 'function') ? MW.wrapGL : null;
    // ===== CANVAS =====
    if (!_FEAT.canvas) { /* disabled in options */ } else
    (function() {
        // [FIX forced-willReadFrequently] Every 2d context silently got
        // willReadFrequently:true appended here — first to silence a Chrome perf
        // warning, later to keep rasterisation backends aligned.
        // Why it mattered: the flag switches Skia from GPU to software, and that is
        // observable two ways at once.
        //   1) getContextAttributes() reports willReadFrequently:true on a context the
        //      page passed no options for — a detector only has to ask;
        //   2) the same drawing on a default context and on a flagged one produces
        //      DIFFERENT bytes in a real browser, and identical bytes with us. That is
        //      what CreepJS prints as its paint (GPU) / paint (CPU) pair, and ours
        //      collapsed into one value.
        // Measured on a clean browser (dev-backendmatrix.html): default 3195a6e9,
        // wrf:true daf73994 — different; and window and worker agree WITH EACH OTHER
        // for each setting taken separately (3195a6e9/3195a6e9 and daf73994/daf73994).
        // So the window/worker parity the forcing was meant to buy exists without it.
        // The original reason is gone too: the getImageData vs toDataURL/convertToBlob
        // mismatch was not fixed by the backend but by the later
        // [FIX getImageData-vs-encoded-mismatch] — both paths read the ORIGINAL
        // directly and putImageData writes exact bytes into the temp copy, so the
        // copy's backend cannot affect the result.
        // Now: the page's options are passed through untouched.
        // [FIX getImageData-vs-encoded-mismatch] Track which canvases the page itself
        // has already given a 2d context (used below in _renderNoisedCopy). We never
        // call getContext('2d') first on a canvas that has no context yet: that would
        // pin the context type before the page does — for example if the page still
        // intended getContext('webgl') later, our 2d call would have blocked it.
        // A canvas joins the set ONLY when the native call actually returned a 2d
        // context.
        try {
            var _origGetContext = HTMLCanvasElement.prototype.getContext;
            // [FIX anon-fn-name-length] This was an anonymous function(type, opts), so
            // fn.name was '' and _mn produced 'function () { [native code] }' — a native
            // function always has a name. fn.length was 2 instead of the native 1
            // (options is optional per WebIDL, and .length counts only the parameters
            // BEFORE the first one with a default).
            // Now: a named function expression with a defaulted parameter fixes name,
            // length and toString at once. Same bug and same fix as toDataURL below.
            HTMLCanvasElement.prototype.getContext = _mn(function getContext(type, opts = undefined) {
                // [FIX the-wrappers-forwarded-arguments-the-page-never-passed] Declared
                // parameters mean `arguments.length` is always the declared count, so the
                // native was handed undefined where the page passed NOTHING and complained
                // about the TYPE where it should complain about the COUNT. Measured, clean
                // against ours: canvas.getContext() -> clean throws "1 argument required",
                // ours returned null; measureText() -> clean throws, ours answered a
                // TextMetrics. Too few arguments is the platform's business, not ours.
                if (arguments.length < 1) return _origGetContext.apply(this, arguments);
                var ctx = _origGetContext.call(this, type, opts);
                try {
                    var tt = type ? String(type).toLowerCase() : '';
                    if (ctx && tt.indexOf('webgl') !== -1 && _wrapGL) {
                        _wrapGL(ctx);
                    }
                } catch (e) {}
                return ctx;
            });
        } catch(_) {}

        // [FIX convertToBlob-backend-mismatch / integrity-hash-mismatch] — withdrawn.
        // willReadFrequently was forced on OffscreenCanvas too, so that the temp copy
        // in convertToBlob rendered on the same backend as the copy in
        // _renderNoisedCopy: both went through drawImage back then, and different
        // backends fed different SOURCE pixels into the noise.
        // Neither copy uses drawImage on the 2d path any more —
        // [FIX getImageData-vs-encoded-mismatch] made them read the ORIGINAL directly,
        // and putImageData writes exact bytes into the temp copy. The copy's backend
        // cannot affect the result, so the reason to force the flag is gone. For why
        // forcing it is NOT allowed, see [FIX forced-willReadFrequently] above.
        try {
            if (typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas.prototype && OffscreenCanvas.prototype.getContext) {
                // Canvases our getContext handed a context to. Read by convertToBlob below,
                // where "does this canvas have a rendering context" is the whole question and
                // every direct way to ask it either creates one or destroys the bitmap.
                var _ocWithContext = new WeakSet();
                var _origOffscreenGetContext = OffscreenCanvas.prototype.getContext;
                // [FIX anon-fn-name-length] see HTMLCanvasElement.getContext above
                OffscreenCanvas.prototype.getContext = _mn(function getContext(type, opts = undefined) {
                    if (arguments.length < 1) return _origOffscreenGetContext.apply(this, arguments);
                    var ctx = _origOffscreenGetContext.call(this, type, opts);
                    // Remembered for convertToBlob below — see the note there. Recorded on the
                    // way OUT, so only a context the platform actually handed over counts.
                    try { if (ctx) _ocWithContext.add(this); } catch (eW) {}
                    try {
                        var tt = type ? String(type).toLowerCase() : '';
                        if (ctx && tt.indexOf('webgl') !== -1 && _wrapGL) {
                            _wrapGL(ctx);
                        }
                    } catch (e) {}
                    return ctx;
                });
            }
        } catch(_) {}

        // [FIX double-getImageData-noise / integrity-hash-mismatch] _renderNoisedCopy
        // used to read the copied canvas through
        // "CanvasRenderingContext2D.prototype.getImageData.call(copyCtx, ...)" —
        // a live prototype lookup. The problem was evaluation order: that expression
        // resolves when _renderNoisedCopy is CALLED, not when it is DEFINED — by which
        // time the prototype's getImageData, replaced a few lines below, is ALREADY our
        // noising version.
        // Why it mattered: toDataURL/toBlob noised the pixels TWICE — once inside that
        // live call and again on the next line via _noiseImageData(d) — while a direct
        // getImageData() and OffscreenCanvas.convertToBlob() (which keeps its own saved
        // origOGID) noised once. In a detector that shows up as toDataURL and toBlob
        // agreeing with each other and both disagreeing with convertToBlob, for the
        // same drawing: different pixels, different PNG bytes, different hashes.
        // Now: the TRUE native getImageData is captured ONCE, before any patch is
        // installed, and every path uses that saved reference — no prototype lookups
        // after patching.
        var origGID = CanvasRenderingContext2D.prototype.getImageData;

        // [FIX background-test] Positional noise — both WASM add_canvas_noise and the
        // JS fallback below — depends only on coordinates, channel and seed, never on
        // the pixel's actual colour. Over a flat fill (fillRect in one colour) that
        // leaves a non-trivial spread between neighbouring pixels, whereas a REAL
        // browser keeps a flat fill byte-identical everywhere: rasterising a solid fill
        // produces no variation away from the edges.
        // Why it mattered: the canvas background test looks for exactly that
        // unevenness. It does not disguise the device — it announces the tampering.
        // Now: a snapshot is taken BEFORE the noise, and afterwards each pixel is
        // compared with its 4 neighbours IN THE ORIGINAL. If all four match exactly the
        // pixel sits inside a flat region and is rolled back to its original value.
        // Around text, gradients and edges the neighbours almost always differ by at
        // least one, so the noise stays — and that is precisely where the genuine
        // cross-device antialiasing variation lives, which is what we want to mask.
        // [FIX solid-fill-canvas-was-noised] A pixel is left alone when its plus-shaped
        // neighbourhood (itself and the four orthogonal neighbours) holds at most TWO
        // distinct colours. One colour is a flat interior — that was the old rule. Two is
        // a HARD EDGE between two flat fills, and a hard edge is as free of per-machine
        // entropy as the interior: every browser on every GPU puts the boundary of
        // fillRect on exactly the same pixel. That is what let
        // webbrowsertools.com/canvas-fingerprint hardcode the hash of one red rectangle
        //     ctx.fillStyle = 'rgb(255,0,0)'; ctx.fillRect(4, 4, 248, 16)
        // and read any difference as proof of a spoofer. Measured: 3 runs, "spoofed by
        // persistent noise" true every time with the extension, false without — the noise
        // hid nothing there and announced itself instead, the same trade the AudioContext
        // noise lost (see the AUDIO section below).
        //
        // Anti-aliased text and gradients — where the real entropy lives — put three or
        // more shades in that neighbourhood and are still noised, which the same page
        // confirms: its text canvas keeps a hash different from a clean browser's.
        //
        // The count is taken from the ORIGINAL, un-noised pixels, so like the rule it
        // replaces it depends only on canvas content, never on how a read was sliced —
        // the CheckIntegrity invariant (1x1 read == block read) holds.
        var MAX_FLAT_COLORS = 2;
        function rgbKey(c) {
            return ((c[0] << 16) | (c[1] << 8) | c[2]) >>> 0;
        }
        function _distinctAtMost(cols, limit) {
            var n = 0, seen = [];
            for (var k = 0; k < cols.length; k++) {
                var c = cols[k];
                if (c === null) continue;
                var known = false;
                for (var j = 0; j < n; j++) {
                    if (seen[j] === c) { known = true; break; }
                }
                if (known) continue;
                seen[n++] = c;
                if (n > limit) return false;
            }
            return true;
        }

        function _restoreFlatRegions(d, orig) {
            var w = d.width, h = d.height, data = d.data, rowBytes = w * 4;
            function key(o) {
                return ((orig[o] << 16) | (orig[o + 1] << 8) | orig[o + 2]) >>> 0;
            }
            for (var y = 0; y < h; y++) {
                var rowOff = y * rowBytes;
                for (var x = 0; x < w; x++) {
                    var i = rowOff + x * 4;
                    var cols = [key(i)];
                    if (x > 0) cols.push(key(i - 4));
                    if (x < w - 1) cols.push(key(i + 4));
                    if (y > 0) cols.push(key(i - rowBytes));
                    if (y < h - 1) cols.push(key(i + rowBytes));
                    if (!_distinctAtMost(cols, MAX_FLAT_COLORS)) continue;
                    data[i] = orig[i]; data[i+1] = orig[i+1]; data[i+2] = orig[i+2]; data[i+3] = orig[i+3];
                }
            }
        }

        // [FIX position-dependent-noise / CheckIntegrity] The real cause of both the
        // old background bug and the new one: the noise seed was a function of the
        // READ WIDTH/HEIGHT (d.width/d.height — how many pixels THIS particular call
        // asked for), not of the pixel's absolute position on the canvas. So the same
        // physical pixel got DIFFERENT noise depending on whether it was read as part
        // of a 5x5 block or by a separate 1x1 call — which is exactly what
        // fingerprintswitcher's CheckIntegrity catches: it reads a region with ONE
        // getImageData(x,y,w,h), then reads THE SAME pixels with a swarm of
        // getImageData(i,j,1,1) calls, and compares them byte for byte. For a real
        // browser (static bitmap, reading does not mutate it) those always agree; with
        // seed(w,h) instead of seed(x,y) they almost never did.
        // Fix: the seed is a pure function of the pixel's ABSOLUTE canvas coordinates
        // (offsetX+localX, offsetY+localY) and the session seed — never of the sizes
        // or the offset of a particular call. The same pixel now always gets the same
        // delta, however it is read.
        // offsetX/offsetY are the x,y the page passed to getImageData(x,y,w,h) (0,0
        // for toDataURL/toBlob/convertToBlob — those always read from the start of the
        // whole canvas). The JS path below is defined as a pure function of ABSOLUTE
        // coordinates and serves as the fallback when WASM is unavailable or failed to
        // load. The WASM path itself (add_canvas_noise) is offset-aware too — see
        // [FIX wasm-rebuilt-position-aware] below, where it is called.
        function _hashPixelPosition(absX, absY, seed) {
            var h = (seed ^ ((absX + 1) * 0x27D4EB2F) ^ ((absY + 1) * 0x85EBCA6B)) >>> 0;
            h = Math.imul(h ^ (h >>> 15), 0x2545F491) >>> 0;
            h = (h ^ (h >>> 13)) >>> 0;
            return h;
        }
        // [FIX flatness-also-read-size-dependent] _restoreFlatRegions (above) compares
        // a pixel with its neighbours ONLY inside the CURRENT buffer. For a block read
        // (5x5) that is fine — every neighbour is in that same buffer. But for a single
        // getImageData(px,py,1,1) read there are no neighbours in a 1x1 buffer at all:
        // all four checks are silently skipped, so the pixel is unconditionally treated
        // as "flat" and rolled back to its original, EVEN when it really is part of a
        // non-uniform region (text/shape/shadow). The same physical pixel read as part
        // of a block might NOT have counted as flat (its real neighbours inside the
        // block disproved it) — again a discrepancy CheckIntegrity catches, just from a
        // different angle than the positional noise.
        // Fix: additionally read the REAL neighbours straight off the canvas (with the
        // raw getImageData, 1px wider than the requested region on every side, clamped
        // to the canvas bounds) — then "flat or not" is decided identically no matter
        // how the read happens to be sliced.
        function _restoreFlatRegionsExpanded(d, offsetX, offsetY, expanded, exOffsetX, exOffsetY) {
            var w = d.width, h = d.height, data = d.data;
            var exW = expanded.width, exH = expanded.height, exData = expanded.data;
            function rawAt(absX, absY) {
                var lx = absX - exOffsetX, ly = absY - exOffsetY;
                if (lx < 0 || ly < 0 || lx >= exW || ly >= exH) return null;
                var i = (ly * exW + lx) * 4;
                return [exData[i], exData[i+1], exData[i+2], exData[i+3]];
            }
            for (var ly = 0; ly < h; ly++) {
                for (var lx = 0; lx < w; lx++) {
                    var absX = offsetX + lx, absY = offsetY + ly;
                    var center = rawAt(absX, absY);
                    if (!center) continue;
                    // Same plus-shaped, at-most-two-colours rule as _restoreFlatRegions —
                    // see the note there. Both must agree or a read that takes the
                    // expanded path and one that does not would disagree on the same pixel.
                    var cols = [rgbKey(center)];
                    var nb = rawAt(absX - 1, absY); if (nb) cols.push(rgbKey(nb));
                    nb = rawAt(absX + 1, absY); if (nb) cols.push(rgbKey(nb));
                    nb = rawAt(absX, absY - 1); if (nb) cols.push(rgbKey(nb));
                    nb = rawAt(absX, absY + 1); if (nb) cols.push(rgbKey(nb));
                    if (_distinctAtMost(cols, MAX_FLAT_COLORS)) {
                        var i = (ly * w + lx) * 4;
                        data[i] = center[0]; data[i+1] = center[1]; data[i+2] = center[2]; data[i+3] = center[3];
                    }
                }
            }
        }
        // ctx/rawGID — the source 2d context and its native (un-noised) getImageData;
        // passed only where the region can be SMALLER than the whole canvas (a direct
        // getImageData(x,y,w,h) from the page). Paths that already read the canvas
        // whole from (0,0) (_renderNoisedCopy, convertToBlob) do not pass ctx/rawGID —
        // there the local buffer IS the entire canvas already, so an expanded read
        // would be pointless.
        // Page-level lock: first successful path (wasm|js) wins for this load.
        var _canvasNoiseMode = null; // null | 'wasm' | 'js'
        function _jsCanvasNoise(d, offsetX, offsetY) {
            var w = d.width, h = d.height;
            for (var ly = 0; ly < h; ly++) {
                for (var lx = 0; lx < w; lx++) {
                    var absX = offsetX + lx, absY = offsetY + ly;
                    var i = (ly * w + lx) * 4;
                    var hh = _hashPixelPosition(absX, absY, _getSessionSeed());
                    d.data[i]   = Math.max(0, Math.min(255, d.data[i]   + ((hh & 3) - 1)));
                    d.data[i+1] = Math.max(0, Math.min(255, d.data[i+1] + ((hh >>> 4 & 3) - 1)));
                    d.data[i+2] = Math.max(0, Math.min(255, d.data[i+2] + ((hh >>> 8 & 3) - 1)));
                }
            }
        }
        // [FIX afp-global-leak] Every branch here used to also write
        // window._afpCanvasMode = 'wasm'|'js' — an enumerable global with "afp" in its
        // name, visible to any script on the page (unlike the deliberately faceless
        // __w0/__w1/__g0, it names the extension outright). And the value was NEVER
        // read back: the mode lives in the _canvasNoiseMode closure variable, and that
        // is what this function returns. A pure leak with not one consumer — removed
        // entirely.
        function _resolveCanvasMode() {
            if (_canvasNoiseMode) return _canvasNoiseMode;
            try {
                if (window.__w2) {
                    _canvasNoiseMode = 'js';
                    return _canvasNoiseMode;
                }
            } catch (e0) {}
            // [FIX fifty-millisecond-busy-spin-on-the-first-canvas-read] A synchronous
            // `while (Date.now() - t0 < 50)` stood here, waiting for the WASM module to
            // appear. It could not do anything but wait: background.js injects the loader
            // on tabs.onUpdated 'complete' + 50ms, so ANY canvas read before the load event
            // — which is when fingerprinting code runs — burned the full 50ms and then
            // locked 'js' anyway.
            //
            // It bought nothing. The two paths compute the SAME numbers: _jsCanvasNoise
            // above and add_canvas_noise in protect_c.source are the same positional hash,
            // the same ±1 per channel, from the same seed — the C file states that in its
            // header and repeats the JS formula line for line. So the spin was not choosing
            // between a right answer and a wrong one, it was choosing which implementation
            // produced an identical result.
            //
            // What it cost was visible. getImageData is a sub-millisecond call in a clean
            // browser; blocking the main thread for 50ms inside one is an anomaly any
            // script timing its own fingerprint collection can see, and it is 50ms of jank
            // on every canvas-using page.
            //
            // The mode still locks for the page, as it always did — a page that reads early
            // stays on the JS path even after __w0 appears. That is the same outcome the
            // spin produced (it timed out and locked 'js'), reached 50ms sooner, and the
            // output is byte-identical either way.
            var W = _wasm();
            _canvasNoiseMode = (W && W.addCanvasNoise) ? 'wasm' : 'js';
            return _canvasNoiseMode;
        }
        // [FIX readback-warning-from-expanded-read] The expanded neighbour read (see
        // _restoreFlatRegionsExpanded below) used to be a SECOND native getImageData on
        // the PAGE'S canvas — one per call the page itself made. Chrome warns from the
        // second readback of a given context onward, so a single getImageData from the
        // page was enough to put "Canvas2D: Multiple readback operations..." in devtools
        // with a stack pointing at this file.
        // The neighbours now come from our own scratch canvas: drawImage reproduces the
        // source byte for byte (dev-drawimagelossless.html — 12 combinations, 0
        // differing bytes), and the scratch is created with willReadFrequently, so any
        // number of reads of IT produce no warning. There is one scratch for the whole
        // lifetime of the page and it only grows — no per-call allocation. The page
        // cannot reach it: no reference, no getContextAttributes.
        var _exScratch = null, _exScratchCtx = null;
        // Copies the source canvas onto our scratch and reads the requested rect from
        // there, so the page's own context is never read back by us. Returns null if
        // the scratch is unavailable, in which case callers fall back to a direct read.
        function _readViaScratch(ctx, x, y, w, h) {
            var src = ctx && ctx.canvas;
            if (!src) return null;
            var cw = src.width, ch = src.height;
            if (!(cw > 0 && ch > 0)) return null;
            if (!_exScratch) {
                _exScratch = document.createElement('canvas');
                _exScratchCtx = _exScratch.getContext('2d', { willReadFrequently: true });
            }
            if (!_exScratchCtx) return null;
            if (_exScratch.width < cw || _exScratch.height < ch) {
                // assigning width/height blanks the canvas, so only ever grow
                _exScratch.width = Math.max(_exScratch.width, cw);
                _exScratch.height = Math.max(_exScratch.height, ch);
            }
            // Clear the WHOLE scratch, not just the area the source covers. A read may
            // legitimately extend past the canvas edge, where the native call returns
            // transparent black; if stale pixels from a previous, larger source were
            // still sitting there we would hand back those instead. With a full clear
            // the scratch matches the source 1:1 inside its bounds and is transparent
            // black outside, exactly like the real thing.
            _exScratchCtx.clearRect(0, 0, _exScratch.width, _exScratch.height);
            _exScratchCtx.drawImage(src, 0, 0);
            return origGID.call(_exScratchCtx, x, y, w, h);
        }
        function _expandedRead(ctx, exX, exY, exW, exH) {
            return _readViaScratch(ctx, exX, exY, exW, exH);
        }
        function _noiseImageData(d, offsetX, offsetY, ctx, rawGID) {
            if (_noiseOff() || _featOff('canvas')) return;
            offsetX = offsetX || 0;
            offsetY = offsetY || 0;
            var w = d.width, h = d.height;
            // [FIX size-gate-was-read-size-not-canvas-size] The "trivial canvas"
            // threshold was compared against d.width/d.height — that is, the size of
            // THIS PARTICULAR READ, not of the canvas. Because of that,
            // getImageData(x, y, 1, 1) on a large canvas always satisfied
            // 1<=32 && 1<=32 and returned a CLEAN pixel, while the same pixel read as
            // part of a 100x100 block got noise. That is exactly the "block vs
            // pixel-by-pixel" discrepancy CheckIntegrity looks for, and the very thing
            // the positional (rather than size-dependent) noise above in this file was
            // built to prevent — the gate undid all of that work.
            // The threshold now comes from the canvas's own dimensions whenever they
            // are known (a direct getImageData from the page passes ctx); the paths
            // that read the canvas whole (_renderNoisedCopy / convertToBlob) pass no
            // ctx, and there d.width/d.height ARE the canvas dimensions.
            var gateW = w, gateH = h;
            try {
                if (ctx && ctx.canvas && ctx.canvas.width > 0 && ctx.canvas.height > 0) {
                    gateW = ctx.canvas.width;
                    gateH = ctx.canvas.height;
                }
            } catch (eGate) {}
            if (gateW <= 32 && gateH <= 32) return; // trivial canvases (icons and such) — left completely alone
            // Do NOT call WASM shouldSkipCanvasNoise: C caches first (w,h) and
            // returns skip=1 once → first read clean, second noised (CheckIntegrity).
            var orig = d.data.slice();
            // Mode lock + WASM first, JS fallback (same hash formula either way).
            var mode = _resolveCanvasMode();
            if (mode === 'wasm') {
                try {
                    _wasm().addCanvasNoise(d, offsetX, offsetY);
                } catch (eW) {
                    _canvasNoiseMode = 'js';
                    _jsCanvasNoise(d, offsetX, offsetY);
                }
            } else {
                _jsCanvasNoise(d, offsetX, offsetY);
            }
            if (ctx && rawGID && ctx.canvas) {
                try {
                    var canvasW = ctx.canvas.width, canvasH = ctx.canvas.height;
                    var exX = Math.max(0, offsetX - 1), exY = Math.max(0, offsetY - 1);
                    var exX2 = Math.min(canvasW, offsetX + w + 1), exY2 = Math.min(canvasH, offsetY + h + 1);
                    var expanded = _expandedRead(ctx, exX, exY, exX2 - exX, exY2 - exY);
                    if (!expanded) throw new Error('no scratch');
                    _restoreFlatRegionsExpanded(d, offsetX, offsetY, expanded, exX, exY);
                    return;
                } catch(e) { /* fall through to the local method below */ }
            }
            _restoreFlatRegions(d, orig);
        }

        // [FIX toDataURL-toBlob-unnoised] toDataURL/toBlob used to merely cache the
        // result of the NATIVE call (with no pixel modification) — all canvas noise was
        // applied inside getImageData and nowhere else. So any fingerprinting script
        // that read the canvas through toDataURL/toBlob directly (without going via
        // getImageData) got clean, un-noised data. Found with an anti-fingerprinting
        // detector: toDataURL and toBlob produced a hash identical to each other (both
        // native) but different from getImageData's (the only genuinely noised path).
        //
        // [FIX visible-canvas-mutation] The first version wrote the noise back into the
        // SAME canvas via putImageData — if the canvas is displayed on the page (not
        // just an offscreen export buffer) the user would see the noise "bleed" into
        // the real picture (critical for canvases used in games or precision drawing).
        // Now the noise is applied to a temporary off-screen copy of the canvas
        // (createElement + drawImage) and the original is left untouched —
        // toDataURL/toBlob run on the copy and return a noised result, while the
        // visible canvas stays clean.
        /**
         * [FIX the-wrapper-answered-with-its-own-error-for-a-foreign-receiver]
         *
         * `toDataURL` and `toBlob` called `_renderNoisedCopy(this)` unguarded, so a call with
         * a receiver that is not a canvas — `HTMLCanvasElement.prototype.toBlob.call({}, cb)`
         * — never reached the native method at all: `copyCtx.drawImage(this, 0, 0)` threw
         * first, and the page got OUR internal error. Measured, clean against ours:
         *
         *   clean   TypeError: Illegal invocation
         *   ours    TypeError: Failed to execute 'drawImage' on 'CanvasRenderingContext2D':
         *           The provided value is not of type '(CSSImageValue or HTMLCanvasElement …)'
         *
         * A different message, script-readable in one line, naming a method the page never
         * called. And it is read by exactly the probe that turned it up: CreepJS's
         * `failsTypeError` / `queryLies` walks prototypes calling each method with a foreign
         * receiver and compares what comes back — reported from the live site.
         *
         * So the whole noising path is guarded and falls back to the ORIGINAL receiver, which
         * is what OffscreenCanvas.convertToBlob's wrapper right below has always done (its
         * body sits in a try/catch and it hands `target = this` to the native call on any
         * failure — which is why convertToBlob measured IDENTICAL to clean while these two
         * did not).
         *
         * Returning the original canvas is not a hole. For a real canvas the only way this
         * path throws is a state the native call refuses as well — a tainted canvas throws
         * SecurityError on the read whichever object it is handed — and for a receiver that is
         * not a canvas the native call must throw Illegal invocation, which is the point.
         */
        function _noisedOrSelf(canvas) {
            try { return _renderNoisedCopy(canvas); } catch (e) { return canvas; }
        }
        function _renderNoisedCopy(canvas) {
            var w = canvas.width, h = canvas.height;
            if (w <= 0 || h <= 0) return canvas;
            var copy = document.createElement('canvas');
            copy.width = w;
            copy.height = h;
            // [FIX warning-on-our-own-scratch-canvas] willReadFrequently is set HERE
            // on purpose: we create this canvas, the page cannot see it and cannot call
            // getContextAttributes on it, so it exposes no observable trait (unlike
            // forcing the flag on the page's canvases — see
            // [FIX forced-willReadFrequently]). We read this copy immediately after
            // writing it, which is exactly the case the flag exists for, and without it
            // Chrome prints a perf warning for OUR reads. As a bonus the copy gets the
            // same backend it had back when the flag was forced on everything.
            var copyCtx = copy.getContext('2d', { willReadFrequently: true });
            if (!copyCtx) return canvas;
            // [FIX readback-warning-named-our-file] For a canvas where the page had
            // already created a 2d context, the ORIGINAL used to be read:
            //   origGID.call(canvas.getContext('2d'), 0, 0, w, h)
            // The rationale ([FIX getImageData-vs-encoded-mismatch]) was that drawImage
            // is a separate compositing pass and may hand back slightly different
            // pixels than a direct read. Measurement disproved it: that discrepancy
            // existed only while we were forcing willReadFrequently, i.e. while the
            // copy and the original sat on DIFFERENT rasterisation backends. With the
            // forcing removed ([FIX forced-willReadFrequently]), drawImage onto a fresh
            // canvas reproduces the source EXACTLY — 0 differing bytes across every
            // backend combination and every scene, including partial alpha, a gradient
            // with a shadow, and a fully cleared canvas (dev-drawimagelossless.html).
            // The direct read cost a lot: every toDataURL/toBlob read the PAGE'S canvas,
            // and from the second read on Chrome printed
            // "Canvas2D: Multiple readback operations..." in devtools with a stack
            // pointing at this file. A fresh canvas read exactly once never triggers
            // that warning — so we only ever read the copy.
            // This also retired the _2dCanvases branch: getContext is no longer called
            // on the original at all, so we cannot accidentally fix the context type
            // before the page does. drawImage accepts any source — 2d, webgl,
            // bitmaprenderer, or one with no context yet — and does not touch it.
            copyCtx.drawImage(canvas, 0, 0);
            var d = origGID.call(copyCtx, 0, 0, w, h);
            _noiseImageData(d, 0, 0);
            copyCtx.putImageData(d, 0, 0);
            return copy;
        }

        // [FIX stale-cache-across-redraw] There used to be a TTL cache here
        // (var TTL = 2000, cache = new WeakMap()) keyed ONLY on the canvas element —
        // with no regard for whether its contents had changed since the entry was
        // stored. If a page reuses ONE canvas for SEVERAL sub-tests in a row (a common
        // pattern — draw geometry, read toDataURL, clear, draw text, read toDataURL
        // again) and the second call lands inside the first one's 2-second window, the
        // cache returned the OLD result from the first drawing: two DIFFERENT images
        // yielding the SAME hash. In a real browser such a collision is essentially
        // impossible — it is about the most unambiguous, easiest-to-catch tampering
        // signal there is.
        // The cache bought nothing in correctness terms: _noiseImageData is already
        // fully deterministic (the same content + dimensions + seed always produce the
        // same noised result), so calling toDataURL() again on a canvas that GENUINELY
        // had not changed would return the identical result without any cache — the
        // cache only saved recomputation, at the price of this vulnerability. Removed
        // entirely; every call recomputes.
        var origTD = HTMLCanvasElement.prototype.toDataURL;
        // [FIX toDataURL-length-name-mismatch] The real toDataURL(optional type,
        // optional quality) has BOTH parameters optional per WebIDL, so the native
        // function reports .length === 0 (in JS .length counts only the parameters
        // BEFORE the first one with a default value — since even the first parameter is
        // optional, the count is zero). function(f, q) {...} with no defaults reported
        // .length === 2 — a trivially checkable divergence from native.
        // On top of that, an anonymous function assigned to an object property (not a
        // variable declaration, not an object literal) does NOT get an inferred name
        // per spec (ES6 NamedEvaluation does not cover that kind of assignment) — .name
        // was '' instead of 'toDataURL'. That broke _mn as well: its fake toString is
        // built from fn.name, so it returned 'function () { [native code] }' with no
        // name instead of 'function toDataURL() { [native code] }'. A named function
        // expression with default parameters fixes .length, .name and toString in one
        // change.
        HTMLCanvasElement.prototype.toDataURL = _mn(function toDataURL(f = undefined, q = undefined) {
            var noised = _noisedOrSelf(this);
            return origTD.call(noised, f, q);
        });
        // The durable mark the parent frame-bridge looks for is __p0 from mw-core, not a
        // DOM attribute — see the note at the frame guard below.
        _markStatus('canvas');
        var origTB = HTMLCanvasElement.prototype.toBlob;
        // [FIX anon-fn-name-length] The same bug that was fixed for toDataURL above but
        // lingered here: an anonymous function → .name '' and .length 3 instead of the
        // native 1 (type/quality are optional).
        if (origTB) HTMLCanvasElement.prototype.toBlob = _mn(function toBlob(cb, f = undefined, q = undefined) {
            if (arguments.length < 1) return origTB.apply(this, arguments);
            var noised = _noisedOrSelf(this);
            origTB.call(noised, cb, f, q);
        });
        // [FIX readback-warning-on-the-page-context] This read the page's own context:
        //   var d = origGID.call(this, x, y, w, h)
        // Chrome counts readbacks per context and warns from the second one on a
        // context created without willReadFrequently. A page that reads twice — CreepJS
        // does, once for its lie check and once for its low-entropy check — therefore
        // produced "Canvas2D: Multiple readback operations..." in devtools, with our
        // file named at the top of the stack because our wrapper is the outermost frame.
        // Measured: with the extension and without it the count was the same (1 vs 1),
        // so we were not adding reads — but the page's own reads still surfaced under
        // our name, and the message cannot be filtered by its origin.
        // Now: the pixels come from our scratch copy, which carries willReadFrequently
        // and is invisible to the page, so the page's context is never read back at all
        // and its counter stays at zero. drawImage reproduces the source byte for byte
        // (dev-drawimagelossless.html: 12 backend combinations, 0 differing bytes).
        // The direct read stays as a fallback for the case where no scratch is available.
        CanvasRenderingContext2D.prototype.getImageData = _mn(function getImageData(x, y, w, h) {
            if (arguments.length < 4) return origGID.apply(this, arguments);
            var d = _readViaScratch(this, x, y, w, h) || origGID.call(this, x, y, w, h);
            _noiseImageData(d, x, y, this, origGID);
            return d;
        });

        // [FIX offscreencanvas-unnoised] OffscreenCanvas is a separate API with its own
        // prototypes (OffscreenCanvas, OffscreenCanvasRenderingContext2D) that do not
        // inherit from HTMLCanvasElement/CanvasRenderingContext2D. The patches above did
        // not cover it at all — convertToBlob() returned a fully native, un-noised
        // result (confirmed by the detector: a third, separate hash, different from both
        // the toDataURL and toBlob paths). It is used in Web Workers and, on the main
        // thread, via canvas.transferControlToOffscreen().
        try {
            if (typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas.prototype) {
                var OC = OffscreenCanvas.prototype;
                if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
                    var OCtx = OffscreenCanvasRenderingContext2D.prototype;
                    var origOGID = OCtx.getImageData;
                    if (origOGID) {
                        // Same scratch read as the HTMLCanvas path above, for the same
                        // reason — see FIX readback-warning-on-the-page-context.
                        OCtx.getImageData = _mn(function getImageData(x, y, w, h) {
                            if (arguments.length < 4) return origOGID.apply(this, arguments);
                            var d = _readViaScratch(this, x, y, w, h) || origOGID.call(this, x, y, w, h);
                            _noiseImageData(d, x, y, this, origOGID);
                            return d;
                        });
                    }
                }
                var origCTB = OC.convertToBlob;
                if (origCTB) {
                    // [FIX anon-fn-name-length] .name '' and .length 1 instead of the native 0
                    OC.convertToBlob = _mn(function convertToBlob(opts = undefined) {
                        var target = this;
                        // [FIX convertToBlob-answered-for-a-canvas-the-platform-refuses]
                        //
                        // The noising below works on a COPY, and a copy always has a context —
                        // so a source the platform will not convert was converted anyway.
                        // Measured, clean against ours, on `new OffscreenCanvas(64,64)` that was
                        // never given a context:
                        //
                        //   clean  rejects InvalidStateError:
                        //          "OffscreenCanvas" has no rendering context.
                        //   ours   resolves a Blob
                        //
                        // Not a message difference — a canvas the platform calls unusable
                        // became usable, and any page can ask. The cheap tell does not exist:
                        // `drawImage` of a context-less OffscreenCanvas does NOT throw
                        // (measured), and every other probe for "has a context" either creates
                        // one (getContext) or destroys the bitmap (transferToImageBitmap).
                        //
                        // So the platform is asked, but only when we have no reason to think it
                        // will say yes: our own getContext wrapper records the canvases it hands
                        // a context to, and for those the fast path is unchanged. For a canvas
                        // we never saw get one, the native call on the SOURCE is the gate — it
                        // rejects immediately and without encoding in the case this is about,
                        // and in the rare case it resolves (a context obtained somewhere we do
                        // not reach) it costs one extra encode and the noised copy still wins.
                        var _gate = null;
                        try { if (!_ocWithContext.has(this)) _gate = origCTB.apply(this, arguments); } catch (eG) {}
                        try {
                            if (this.width > 0 && this.height > 0) {
                                // [FIX visible-canvas-mutation] Same logic as for
                                // HTMLCanvasElement.toDataURL/toBlob above — we do not
                                // mutate the original via putImageData (an
                                // OffscreenCanvas can also be a rendering source in a
                                // Worker context, where reading the same canvas again
                                // after convertToBlob() expects the original data);
                                // we noise a temporary copy instead.
                                var copy = new OffscreenCanvas(this.width, this.height);
                                // our temporary copy, unreachable by the page —
                                // see [FIX warning-on-our-own-scratch-canvas]
                                var copyCtx = copy.getContext('2d', { willReadFrequently: true });
                                if (copyCtx) {
                                    // Read the copy only — the same switch as in
                                    // _renderNoisedCopy, see
                                    // [FIX readback-warning-named-our-file].
                                    copyCtx.drawImage(this, 0, 0);
                                    var d = OCtx && origOGID
                                        ? origOGID.call(copyCtx, 0, 0, this.width, this.height)
                                        : copyCtx.getImageData(0, 0, this.width, this.height);
                                    _noiseImageData(d, 0, 0);
                                    copyCtx.putImageData(d, 0, 0);
                                    target = copy;
                                }
                            }
                        } catch(e) {}
                        // The gate's verdict comes first and its rejection is returned verbatim;
                        // its blob is discarded, because ours is the noised one.
                        if (_gate && typeof _gate.then === 'function') {
                            var _t = target, _o = opts;
                            return _gate.then(function () { return origCTB.call(_t, _o); });
                        }
                        return origCTB.call(target, opts);
                    });
                }
            }
        } catch(_) {}

        // [FIX sandbox-iframe-canvas-parity]
        // SannySoft (and similar) use:
        //   <iframe sandbox="allow-same-origin"></iframe>
        //   iframe.contentDocument.createElement('canvas')...
        // allow-same-origin WITHOUT allow-scripts: our content scripts never run
        // inside the frame, so CanvasRenderingContext2D in that realm stays native
        // → different hash than the noised main window.
        // Parent CAN access contentDocument (same-origin). Patch the frame's
        // prototypes from here so toDataURL/getImageData use the same noise seed.
        (function _installFrameCanvasBridge() {
            var _patchedFrames = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;
            // Only scriptless sandboxes need parent-side patching. Normal iframes
            // already get content scripts (all_frames) — bridging those caused
            // double-noise (Canvas5 hash drifted after sandbox was fixed).
            function _isScriptlessSandbox(iframe) {
                try {
                    if (!iframe || iframe.tagName !== 'IFRAME') return false;
                    if (!iframe.hasAttribute('sandbox')) return false;
                    var tokens = String(iframe.getAttribute('sandbox') || '')
                        .toLowerCase().split(/\s+/).filter(Boolean);
                    // empty sandbox="" still blocks scripts
                    if (tokens.indexOf('allow-scripts') !== -1) return false;
                    return true;
                } catch (e) { return false; }
            }
            function _patchFrameCanvas(win) {
                if (!win || win === window) return;
                try {
                    if (_patchedFrames) {
                        if (_patchedFrames.has(win)) return;
                        _patchedFrames.add(win);
                    }
                } catch (e0) { return; }
                try {
                    // [FIX bridge-attributes-were-an-extension-detector] This used to read a
                    // data-v-cv attribute the frame set on its own <html>. It was the LAST
                    // custom attribute the extension left on the DOM, and a clean browser
                    // has none at all — one attribute is as good a detector as seven.
                    //
                    // The question it answers is "did our code already run in this frame?",
                    // and __p0 answers it just as durably: mw-core defines it
                    // non-enumerable on every window it bootstraps and mw-cleanup, unlike
                    // for __AFP_MW__, deliberately does not remove it. Same-origin, so the
                    // parent can read it; invisible to Object.keys, and measured not to
                    // register in CreepJS's clientCode (its value is a boolean and the name
                    // has no trailing underscore — see the getClientCode note there).
                    try { if (win.__p0) return; } catch (eP0) {}
                    try { if (win.__AFP_MW__) return; } catch (eMw) {}
                    var HCEP = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
                    var C2DP = win.CanvasRenderingContext2D && win.CanvasRenderingContext2D.prototype;
                    if (!HCEP || !C2DP) return;
                    var fOrigTD = HCEP.toDataURL;
                    var fOrigTB = HCEP.toBlob;
                    var fOrigGID = C2DP.getImageData;
                    if (typeof fOrigTD === 'function') {
                        HCEP.toDataURL = _mn(function toDataURL(f = undefined, q = undefined) {
                            var noised = _noisedOrSelf(this);
                            return fOrigTD.call(noised, f, q);
                        });
                    }
                    if (typeof fOrigTB === 'function') {
                        HCEP.toBlob = _mn(function toBlob(cb, f = undefined, q = undefined) {
                            if (arguments.length < 1) return fOrigTB.apply(this, arguments);
                            var noised = _noisedOrSelf(this);
                            fOrigTB.call(noised, cb, f, q);
                        });
                    }
                    if (typeof fOrigGID === 'function') {
                        C2DP.getImageData = _mn(function getImageData(x, y, w, h) {
                            if (arguments.length < 4) return fOrigGID.apply(this, arguments);
                            var d = _readViaScratch(this, x, y, w, h) || fOrigGID.call(this, x, y, w, h);
                            _noiseImageData(d, x, y, this, fOrigGID);
                            return d;
                        });
                    }
                    // The frame is recorded in _patchedFrames above; nothing is written to
                    // its DOM.
                } catch (ePatch) {}
            }
            function _scanFrames() {
                try {
                    var list = document.querySelectorAll('iframe');
                    for (var i = 0; i < list.length; i++) {
                        try {
                            if (!_isScriptlessSandbox(list[i])) continue;
                            var w = list[i].contentWindow;
                            if (w) _patchFrameCanvas(w);
                        } catch (e1) {}
                    }
                } catch (e2) {}
            }
            // [FIX creepjs-iframe-contentWindow-lies] Do NOT redefine
            // HTMLIFrameElement.contentWindow / contentDocument getters.
            // Bare desc.get = function(){...} without native toString / descriptor
            // shape → CreepJS Prototype: 9 lies × 2 props = 18 lies (was 0).
            // Same policy as mw-navigator.js iframe section.
            // Sync path for SannySoft-style same-tick read: a scriptless sandbox frame
            // must be bridged before the detector's next line, so waiting for the
            // MutationObserver below is not enough.
            // [FIX insert-hook-was-installed-twice] This used to wrap
            // Node.prototype.{appendChild,insertBefore,replaceChild} a second time, on top
            // of the identical wrapper in mw-navigator.js. Both then ran their own
            // querySelectorAll('iframe') over every inserted subtree, so the cost landed
            // twice on the hottest DOM path there is — measured at 3.40us per insert of a
            // small tree, 5.5x native (dev-insertcost.html). Two wrappers also meant two
            // of our frames on the stack of every insertion, which is what puts this
            // extension's name on console errors the PAGE causes.
            // mw-navigator.js loads first and now owns the single wrapper, publishing
            // MW.iframeHooks; this file just registers what it wants done per iframe.
            // If the registry is somehow absent the sync path is skipped rather than
            // rebuilt — the observer, DOMContentLoaded, load and timed rescans below still
            // cover every frame, just not within the same tick.
            try {
                if (MW && MW.iframeHooks && typeof MW.iframeHooks.push === 'function') {
                    MW.iframeHooks.push(function (el) {
                        if (!_isScriptlessSandbox(el)) return;
                        try {
                            var w = el.contentWindow;
                            if (w) _patchFrameCanvas(w);
                        } catch (eCw) {}
                    });
                }
            } catch (eIns) {}
            _scanFrames();
            try {
                if (typeof MutationObserver !== 'undefined') {
                    var mo = new MutationObserver(function() { _scanFrames(); });
                    mo.observe(document.documentElement, { childList: true, subtree: true });
                }
            } catch (eMo) {}
            try {
                document.addEventListener('DOMContentLoaded', _scanFrames, true);
                window.addEventListener('load', _scanFrames, true);
            } catch (eEv) {}
            try { setTimeout(_scanFrames, 0); setTimeout(_scanFrames, 50); setTimeout(_scanFrames, 250); } catch (eT) {}
        })();

        // ===== WebGL readPixels — the one pixel path nothing here covered =====
        // toDataURL/toBlob on a WebGL canvas already go through _renderNoisedCopy, but
        // readPixels hands the framebuffer straight to the page and was untouched.
        //
        // Two machines, SAME browser (Edge 151), Intel Arc vs NVIDIA RTX 3060, extension
        // off — tools/collect-metrics.html v5 diffed by tools/diff-metrics.mjs:
        //   webglFlat        clearColor + 4x4 readback           IDENTICAL
        //   webglShaderDiag  8 single pixels off a shaded quad   IDENTICAL
        //   webglShader      the whole 64x64 image               b2d57cd1 / d4305829  DIFFERS
        //
        // So GPU rasterisation IS a per-machine carrier — 2 of 175 fields, and this is one
        // of them. The other half of that measurement decides the design: the entropy is
        // in the detailed image, NOT in flat pixels. That makes the flat-region restore
        // below free rather than a compatibility concession — it gives up nothing that
        // carried entropy. A 1x1 pick of a solid colour still reads back exact, so GPU
        // object picking keeps working, which was the reason this was left open before.
        if (_FEAT.webgl !== false) (function _installReadPixelsNoise() {
            var RGBA = 0x1908, UNSIGNED_BYTE = 0x1401;
            function _clamp8(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }
            function _noiseReadback(gl, x, y, w, h, format, type, pixels, dstOffset, readRaw) {
                // Same reason as _noiseImageData: the mode may only become known after the
                // patch is in place, and a WebGL readback is part of the same picture.
                if (_noiseOff()) return;
                // Float and integer readbacks are GPU compute results, not pictures —
                // perturbing them corrupts real work and hides nothing a fingerprinter reads.
                if (format !== RGBA || type !== UNSIGNED_BYTE) return;
                if (dstOffset) return;
                if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) return;
                x = x | 0; y = y | 0; w = w | 0; h = h | 0;
                if (w <= 0 || h <= 0 || pixels.length < w * h * 4) return;
                // The same "trivial surface" gate as the 2D path, and for the same reason
                // it is keyed on the DRAWING BUFFER rather than on this read: a per-read
                // gate answers differently for a 1x1 than for the same pixel inside a
                // block, which is exactly what CheckIntegrity compares.
                try {
                    if ((gl.drawingBufferWidth | 0) <= 32 && (gl.drawingBufferHeight | 0) <= 32) return;
                } catch (eD) { return; }
                var seed = _getSessionSeed();
                var orig = pixels.slice(0, w * h * 4);
                for (var ly = 0; ly < h; ly++) {
                    for (var lx = 0; lx < w; lx++) {
                        // Absolute framebuffer coordinates — never this call's size or
                        // offset. Same invariant the 2D noise is built on.
                        var hh = _hashPixelPosition(x + lx, y + ly, seed);
                        var i = (ly * w + lx) * 4;
                        pixels[i]     = _clamp8(pixels[i]     + ((hh & 3) - 1));
                        pixels[i + 1] = _clamp8(pixels[i + 1] + ((hh >>> 4 & 3) - 1));
                        pixels[i + 2] = _clamp8(pixels[i + 2] + ((hh >>> 8 & 3) - 1));
                    }
                }
                // [FIX the-readback-noise-was-strippable-one-pixel-at-a-time]
                //
                // This used to be `_restoreFlatRegions({data: pixels, width: w, height: h}, orig)`
                // — flatness judged on THE RECTANGLE THAT WAS READ. A 1x1 read is one pixel
                // with no neighbours inside itself, so it is trivially flat, so every
                // single-pixel readback had its noise rolled straight back off. Measured on
                // a shaded 64x64 quad, this build against clean, five pixels:
                //
                //     pixel     clean        block read    1x1 read
                //     10,10     243/42/42    244/43/42     243/42/42
                //     20,33     214/82/133   215/82/133    214/82/133
                //     41,7      86/165/30    87/164/31     86/165/30
                //
                // Two defects in one line. The readback noise was STRIPPABLE — read the
                // framebuffer pixel by pixel and the raw GPU output comes back, which is the
                // whole of what this wrapper exists to hide. And the same pixel answered two
                // different values depending on the size of the read, which is a
                // contradiction a detector confirms in two calls; [FIX canvas-noise-skips-hard-edges]
                // records the same invariant for the 2D path and says a per-read gate breaks it.
                //
                // The 2D path solved this long ago and the helper is already here: judge
                // flatness on the SURROUNDING framebuffer, not on the read. One extra native
                // readback of the rectangle grown by a pixel on each side, clamped to the
                // drawing buffer. It is guarded and falls back to the old per-read rule,
                // exactly as the getImageData path does — the pre-noise snapshot is taken
                // above, before any of this, so a fallback still has something to restore
                // from ([FIX worker-lost-flat-restore-when-the-expanded-read-failed]).
                var d = { data: pixels, width: w, height: h };
                var done = false;
                var PACK_ALIGNMENT = 0x0D05, packSaved = null;
                try {
                    var dbW = gl.drawingBufferWidth | 0, dbH = gl.drawingBufferHeight | 0;
                    var exX = x > 0 ? x - 1 : 0, exY = y > 0 ? y - 1 : 0;
                    var exX2 = (x + w + 1) < dbW ? (x + w + 1) : dbW;
                    var exY2 = (y + h + 1) < dbH ? (y + h + 1) : dbH;
                    var exW = exX2 - exX, exH = exY2 - exY;
                    if (readRaw && exW > 0 && exH > 0) {
                        // [FIX the-neighbour-read-set-an-error-the-page-could-see] The
                        // expanded read allocates a TIGHTLY packed buffer, and the driver
                        // sizes a readback by PACK_ALIGNMENT. A page that has set alignment
                        // 8 and asks for an odd width makes our buffer one row short, and
                        // the read raises INVALID_OPERATION — an error the page then finds
                        // in getError() and a clean browser never produced. Measured, this
                        // sequence, clean against ours before this guard:
                        //
                        //   pixelStorei(PACK_ALIGNMENT, 8); readPixels(5,5,3,3,RGBA,UBYTE)
                        //     clean  getError() 0
                        //     ours   getError() 1282
                        //
                        // Skipping the expanded read when alignment is awkward would hand a
                        // detector the switch that turns the noise off — set alignment 8 and
                        // read pixel by pixel. So the alignment is pinned to 4 for the
                        // duration of OUR read and put back exactly as it was; pixelStorei
                        // with a legal value raises nothing, and the page cannot observe the
                        // window between the two calls because this is all synchronous.
                        try {
                            var pa = gl.getParameter(PACK_ALIGNMENT);
                            if (pa === 1 || pa === 2 || pa === 8) {
                                gl.pixelStorei(PACK_ALIGNMENT, 4);
                                packSaved = pa;
                            }
                        } catch (ePa) {}
                        var exBuf = new Uint8Array(exW * exH * 4);
                        readRaw(exX, exY, exW, exH, format, type, exBuf);
                        _restoreFlatRegionsExpanded(d, x, y,
                            { data: exBuf, width: exW, height: exH }, exX, exY);
                        done = true;
                    }
                } catch (eEx) { /* a lost context, a framebuffer that refuses */ }
                if (packSaved !== null) { try { gl.pixelStorei(PACK_ALIGNMENT, packSaved); } catch (eR) {} }
                if (!done) _restoreFlatRegions(d, orig);
            }
            function _patch(proto) {
                if (!proto || typeof proto.readPixels !== 'function') return;
                var origRP = proto.readPixels;
                // Seven declared parameters because that is what the native method reports
                // for .length. WebGL2's extra dstOffset overload does not widen it, so that
                // argument is taken off `arguments` rather than added to the signature —
                // a wrapper whose .length disagrees with native is a one-line detection.
                proto.readPixels = _mn(function readPixels(x, y, width, height, format, type, pixels) {
                    var r = origRP.apply(this, arguments);
                    var self = this;
                    // The neighbourhood read goes through the NATIVE method, bound to this
                    // context: routing it through the wrapper would noise the very pixels
                    // the flatness test is supposed to judge raw, and would recurse.
                    var readRaw = function (rx, ry, rw, rh, rf, rt, buf) {
                        return origRP.call(self, rx, ry, rw, rh, rf, rt, buf);
                    };
                    try { _noiseReadback(this, x, y, width, height, format, type, pixels, arguments[7], readRaw); } catch (e) {}
                    return r;
                });
            }
            try { _patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype); } catch (e1) {}
            try { _patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype); } catch (e2) {}
        })();
    })();

    // ===== AUDIO — НЕ ПАТЧИМ (осознанно, замерено) =====
    // Здесь стояли две секции: шум на renderedBuffer у OfflineAudioContext.startRendering
    // (плюс путь через событие 'complete') и джиттер на AnalyserNode.getFloat*/getByte*.
    // Обе удалены вместе с флагом `audio`, потому что шум по аудио выдавал больше, чем
    // скрывал. Замерено на CreepJS, одна машина, один профиль:
    //
    //                        с шумом                    без шума
    //   sum        124.04030525171402 (нет в KnownAudio)  124.04347527516074 (есть)
    //   gain       -20.538288116455078 (настоящий)        -20.538288116455078
    //   unique     5000 из 5000                           4736 из 5000
    //   lies       1 (sample noise detected)               0
    //   секций     Audio красная                           ни одной
    //
    // Три независимых признака, каждый ловится одной строкой и ни один не требует
    // знания того, что именно мы патчим:
    //   1) sum не входит в KnownAudio — таблица опубликована в самом creep.js;
    //   2) unique = 5000/5000: шум делает РАЗНЫМИ все сэмплы, у настоящей машины 4736;
    //   3) gain мы не трогали, он настоящий и известный, а сумма для этого gain
    //      невозможна — не «редкое значение», а само-противоречие. Тот же класс, что
    //      MAX_TEXTURE_SIZE 32768 под строкой Direct3D11 (см. background.js).
    //
    // Что потеряно: пер-доменная развязка по аудио. Она защищала от угрозы, которой нет —
    // связать по значению можно только если оно уникально, а нативная сумма у Blink/Windows
    // приходится на ~14 известных значений и делится с миллионами машин. Шум, наоборот,
    // делал отпечаток УНИКАЛЬНЕЕ (5000/5000), просто по-разному на каждом домене.
    //
    // Если однажды понадобится вернуться: правильный ход — не шуметь, а ПРИБИВАТЬ sum к
    // значению из KnownAudio[gain]; случайность здесь всегда проигрывает.
    //
    // dev-audio-akamai.html и dev-audio-consistency.html измеряли ИМЕННО этот шум и
    // теперь описывают то, чего нет. Они не входят в CHECKS; перечислены в NOT_COVERED
    // раннера, чтобы их не приняли за действующую проверку.

    // ===== AudioContext.baseLatency — ПРИБИВАЕМ, НЕ ШУМИМ =====
    // Найдено при разборе агента Fingerprint Pro v4: он читает baseLatency, чего открытая
    // библиотека не делает, и в mw/ этого слова не было вовсе.
    //
    // Это не сумма сэмплов, а размер аппаратного буфера, делённый на частоту дискретизации
    // — свойство звуковой карты и её драйвера, а не расчёта. Оно переживает смену профиля
    // и одинаково во всех вкладках, то есть ведёт себя как носитель хоста.
    //
    // Поэтому здесь применён ровно тот ход, который секция выше называет правильным и
    // который был упущен, когда аудио пытались шумить: не случайность, а привязка к
    // значению толпы. Chrome на Windows через WASAPI в shared mode практически всегда
    // отдаёт ~10 мс буфер, так что 0.01 — это не выдумка, а самое населённое значение.
    //
    // Оно ещё и остаётся согласованным с ЛЮБОЙ частотой: 0.01 с — это 480 кадров на
    // 48000 Гц и 441 на 44100, оба целые. Так что sampleRate трогать не нужно (и не
    // следует: приложения считают по нему длины буферов, и ложь там слышна).
    if (_FEAT.navigator !== false) (function () {
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC || !AC.prototype) return;
            var d = Object.getOwnPropertyDescriptor(AC.prototype, 'baseLatency');
            if (!d || typeof d.get !== 'function') return;   // не поддерживается — не выдумываем
            Object.defineProperty(AC.prototype, 'baseLatency', {
                get: _mn(function baseLatency() {
                    // Нативный геттер вызывается ПЕРВЫМ, чтобы на чужом receiver
                    // TypeError был ровно тот же, что у настоящего аксессора.
                    d.get.call(this);
                    return 0.01;
                }, true),
                set: d.set,
                enumerable: d.enumerable,
                configurable: true
            });
        } catch (eBL) {}
    })();

    // ===== CANVAS MEASURETEXT + FONT NORMALIZATION =====
    // Two layers of protection:
    // 1. Font normalization: if the font names a family outside allowedFonts, measure
    //    through the generic fallback instead (sans-serif/serif/monospace).
    //    That blocks canvas-based font detection: "Arial, sans-serif" → "sans-serif".
    // 2. WASM/JS noise on top of the normalized value.
// [FIX ungated-patch] The section was governed by stealth mode ONLY, yet font blocking
    // is exactly what it does — it belongs under the fonts flag. A measurement with all
    // 14 checkboxes OFF showed the normalization still running: 'MS Gothic' disappeared
    // from the list of detected fonts and the widths shifted (468 → 514.62). In other
    // words the settings page promised control it did not deliver.
    if (!_FEAT.fonts) { /* disabled in options */ } else
if (!_STEALTH)     (function() {
        try {
            var _origMT = CanvasRenderingContext2D.prototype.measureText;
            // [FIX generic-family-lists-diverged] see the note on _sfG in mw/mw-misc.js —
            // this copy was missing fangsong. Full CSS Fonts 4 generic set, identical in
            // all three scopes.
            var _generics = { 'serif':1,'sans-serif':1,'monospace':1,'cursive':1,'fantasy':1,
                'system-ui':1,'ui-serif':1,'ui-sans-serif':1,'ui-monospace':1,'ui-rounded':1,
                'math':1,'emoji':1,'fangsong':1 };

            // allowedFonts cache: rebuilt whenever the profile changes.
            // [FIX allowlist-cache-never-hit] The cache key was the allowedFonts ARRAY
            // itself, compared by identity against the previous one. But _prof() parses
            // sessionStorage afresh on every call, so it hands back a brand-new array each
            // time and `pf !== _allowRef` was true on every single call: the ~100-entry
            // allowlist was rebuilt, and the whole profile JSON re-parsed, for every family
            // of every measureText/fillText/strokeText. On a page that lays out text in a
            // canvas that is thousands of rebuilds. Worse, _prof() was called TWICE per
            // invocation (`_prof() && _prof().allowedFonts`), so the profile — which
            // carries the ~80-name font list — was JSON.parsed twice just to reach one
            // field. The cache is now keyed on the joined list, which is a value and so
            // actually compares equal across parses, and the profile is read once.
            var _allowCache = null, _allowRef = null;
            function _allowed(name) {
                // [FIX host-mode] Every family the machine has passes; the width noise
                // below still applies, as it does to every allowed family.
                if (_hostHwNow()) return true;
                var p = _prof();
                var pf = p && p.allowedFonts;
                // Identity comparison is correct now that _prof() memoises on the raw
                // string: an unchanged profile hands back the SAME array object so this
                // hits, while a genuinely new profile parses into a new array and misses.
                // Before that memo it missed on EVERY call - a fresh parse per call meant
                // a fresh array per call - so this cache never served a single hit and the
                // ~100-entry allowlist was rebuilt for every family of every measureText,
                // fillText and strokeText.
                if (pf !== _allowRef || !_allowCache) {
                    _allowCache = {};
                    _BASE_FONTS.forEach(function(f) { _allowCache[f] = 1; });
                    if (pf) for (var i = 0; i < pf.length; i++) _allowCache[String(pf[i]).toLowerCase()] = 1;
                    _allowRef = pf;
                }
                return !!_allowCache[name];
            }

            // Parse the CSS font shorthand → an array of lowercased family names
            // [FIX line-height-slash] The regex used to require a space immediately
            // after the size (Npx ), which does not match the CSS syntax that carries a
            // line-height after a slash (e.g. "16px/1.5 Arial" or
            // "14px/normal sans-serif") — in those cases _families() quietly returned []
            // and the font normalization never kicked in. An optional group
            // (?:\/(?:normal|[\d.]+(?:%|em|px)?))? was added between size and family.
            function _families(fontStr) {
                var m = fontStr.match(/[\d.]+(?:px|em|rem|pt|%|vw|vh)(?:\/(?:normal|[\d.]+(?:%|em|px)?))?\s+([\s\S]+)$/i);
                if (!m) return [];
                return m[1].split(',').map(function(s) { return s.trim().replace(/['"]/g,'').toLowerCase(); });
            }
            // Last generic in the stack — or monospace if there is none (the standard font-detection baseline)
            function _lastGeneric(fams) {
                for (var i = fams.length - 1; i >= 0; i--) { if (_generics[fams[i]]) return fams[i]; }
                return 'monospace';
            }
            // Extract the size part (bold 16px → "bold 16px")
            function _sizePrefix(fontStr) {
                var m = fontStr.match(/^([\s\S]*?[\d.]+(?:px|em|rem|pt|%|vw|vh))/i);
                return m ? m[1] : '16px';
            }

            // [FIX the-font-classification-was-recomputed-on-every-call]
            //
            // Every measureText, fillText and strokeText ran the same three steps over the
            // same font string: two regexes to split the CSS shorthand into families, a
            // lookup of each family in the allowlist, and — for a blocked font — a third
            // regex to build the normalized string. A page laying out text calls these
            // thousands of times with ONE font; a font probe calls them thousands of times
            // with a handful. tools/probe-cost.mjs measured measureText at 5.1x the native
            // call, and this is the part of that ratio which is pure repetition.
            //
            // The answer depends on exactly two things, and the memo is tagged with both
            // rather than timed out or cleared on a guess: the allowlist ARRAY — it arrives
            // with the profile, ~300ms after the page's first script, so entries filled
            // before it lands answer for the wrong list — and host mode, where every family
            // passes. _prof() memoises on the raw string, so an unchanged profile hands back
            // the SAME array object and the identity test hits; a new profile parses into a
            // new array and misses. That is the trick _allowed() above already relies on,
            // used here for the same reason.
            var _fiMap = null, _fiRef = 0, _FI_CAP = 512;
            function _fontInfo(fontStr) {
                var ref = _hostHwNow() ? 'H' : ((_prof() && _prof().allowedFonts) || 0);
                if (!_fiMap || _fiRef !== ref) { _fiMap = new Map(); _fiRef = ref; }
                var hit = _fiMap.get(fontStr);
                if (hit) return hit;
                var fams = _families(fontStr);
                var blocked = fams.some(function (f) { return !_generics[f] && !_allowed(f); });
                // The normalized string belongs to the same answer — it is what the width is
                // hashed under ([FIX noise-undid-the-normalisation]) — so it is resolved here
                // rather than rebuilt at each call site.
                var info = {
                    blocked: blocked,
                    norm: blocked ? (_sizePrefix(fontStr) + ' ' + _lastGeneric(fams)) : ''
                };
                // A page that measures endlessly many distinct font strings must not grow
                // this without bound. The whole map goes rather than an LRU: eviction
                // bookkeeping would cost more per hit than the parse it saves, and the next
                // few calls simply re-parse.
                if (_fiMap.size >= _FI_CAP) _fiMap.clear();
                _fiMap.set(fontStr, info);
                return info;
            }

            // Scratch canvas for the normalized measurements (one for the whole page lifetime)
            var _tc = null;
            function _tmpCtx() {
                if (!_tc) try { _tc = document.createElement('canvas').getContext('2d'); } catch(e) {}
                return _tc;
            }
            // [FIX blocked-font-measured-on-the-wrong-context-type] The scratch context has
            // to be the SAME interface as the caller's. A regular canvas and an
            // OffscreenCanvas do not measure identically — verified on a clean browser,
            // 16px monospace, 'mwmwmwmwlli': 105.617 against 96.766. So measuring a blocked
            // font on the regular scratch and handing that back to an OffscreenCanvas caller
            // returned 105.62 where that context's own generic is 96.77, and the block
            // undid itself: CreepJS compares each family against the generic measured on
            // the SAME context, saw a difference, and counted the blocked font as detected.
            // That is what made the window report font A "Other" while the worker — whose
            // scratch is an OffscreenCanvas because it has no document — reported "Windows".
            var _toc = null;
            function _tmpOffCtx() {
                if (!_toc) try { _toc = new OffscreenCanvas(32, 32).getContext('2d'); } catch (e) {}
                return _toc;
            }
            function _scratchFor(ctx) {
                try {
                    if (typeof OffscreenCanvasRenderingContext2D !== 'undefined' &&
                        ctx instanceof OffscreenCanvasRenderingContext2D) {
                        return { ctx: _tmpOffCtx(), off: true };
                    }
                } catch (e) {}
                return { ctx: _tmpCtx(), off: false };
            }

            // [FIX fallback-had-its-own-formula] The JS fallback computed the width with
            // a formula of its own: the seed came from the first 16 characters of the
            // TEXT only, the font was not considered at all, and it used an LCG instead
            // of FNV. So when WASM failed to come up, the window produced DIFFERENT
            // widths than when it did — and, more importantly, different ones than the
            // worker, into which the WASM formula was ported one for one (see
            // [FIX worker-fonts-window-only] in mw-workers.js). Measured on a page
            // without WASM: window 672.47 against worker 672.46, and likewise for 11 of
            // 22 fonts.
            // What follows is the same port of substitute_text_width /
            // substitute_text_metrics from protect_c.source, checked against the real
            // WASM over 378 combinations (dev-textwidth-port.html) with bit-for-bit
            // agreement. The WASM path and the WASM-less path now yield ONE value, and
            // it is the same one the worker produces.
            // hash_str hashes UTF-8 BYTES (emscripten hands it a const char*), hence
            // TextEncoder rather than charCodeAt: otherwise emoji/Cyrillic/CJK drift.
            var _txtEnc = null;
            function _wasmHashStr(base, str) {
                if (!_txtEnc) { try { _txtEnc = new TextEncoder(); } catch (e) {} }
                var h = base >>> 0;
                var a = _txtEnc ? _txtEnc.encode(str == null ? '' : String(str)) : [];
                for (var i = 0; i < a.length; i++) {
                    h = (h ^ a[i]) >>> 0;
                    h = Math.imul(h, 0x01000193) >>> 0;
                }
                h = (h ^ (h >>> 16)) >>> 0;
                h = Math.imul(h, 0x85EBCA6B) >>> 0;
                return (h ^ (h >>> 13)) >>> 0;
            }
            function _jsFallbackWidth(real, font, text) {
                var h = _wasmHashStr(_wasmHashStr(_getSessionSeed() >>> 0, font), text);
                return real + ((h & 0xFF) / 255 - 0.5) * 0.02;
            }
            /**
             * [FIX the-width-substitution-was-recomputed-for-every-repeat-measurement]
             *
             * The substituted width is a pure function of (seed, normalized font, text,
             * native width) — the hash above, or the same hash inside the WASM export, which
             * has to encode both strings into linear memory to see them. Pages do not measure
             * a string once: a layout pass measures the same runs over and over, and a font
             * probe measures ONE string against a hundred families. Every one of those
             * repeats paid for the hash again.
             *
             * The native measurement is deliberately NOT memoised, only its substitution.
             * Width depends on context state this wrapper does not read — letterSpacing,
             * wordSpacing, direction, fontKerning, textRendering — so a cache keyed on
             * (font, text) alone would hand a page the wrong metrics and break its layout,
             * which is a far worse defect than the cost being removed. The native width goes
             * INTO the key instead: whatever the context state made it, the substitution for
             * that exact number is what comes back.
             *
             * Tagged with the seed for the same reason _fontInfo is tagged with the
             * allowlist: a seed resolved before the profile arrives is provisional and gets
             * replaced by the authoritative one ([FIX provisional-seed-was-locked-forever]),
             * and serving a width hashed under the old number after that is exactly the
             * early-vs-late split this file has been bitten by twice.
             */
            var _swMap = null, _swSeed = -1, _SW_CAP = 4096;
            function _substWidth(W, real, fontKey, text) {
                var sd = _getSessionSeed() >>> 0;
                if (!_swMap || _swSeed !== sd) { _swMap = new Map(); _swSeed = sd; }
                var key = fontKey + '\u0000' + real + '\u0000' + text;
                var hit = _swMap.get(key);
                if (hit !== undefined) return hit;
                var w = (W && W.substituteTextWidth)
                    ? W.substituteTextWidth(real, fontKey, text)
                    : _jsFallbackWidth(real, fontKey, text);
                // Bounded the same way and for the same reason as _fiMap above.
                if (_swMap.size >= _SW_CAP) _swMap.clear();
                _swMap.set(key, w);
                return w;
            }
            // [DEAD] _jsFallbackMetric and _metric lived here. Both became unreachable
            // when TextMetrics substitution was narrowed to `width` only
            // (see FIX integer-metrics-turned-into-floats below): every non-width
            // metric is now passed through native, so nothing ever asked for a
            // substituted metric. The WASM export substitute_text_metrics is left in
            // place — it is part of the compiled binary — but nothing calls it.
            // [FIX perturbed-exact-zeros] An exact zero in TextMetrics is a structural
            // fact, not a measurement, and must be passed through untouched:
            //   - alphabeticBaseline is 0 BY DEFINITION under the default textBaseline
            //     (the distance from the baseline to itself);
            //   - actualBoundingBoxDescent is 0 for a string with no descenders
            //     ("mwmwmwmwlli");
            //   - actualBoundingBoxLeft is 0 when there is no left overhang;
            //   - width is 0 for the empty string.
            // Measured against a pristine realm (dev-textmetrics.html): we returned
            // 0.00033333333333333327, -0.000003921568627450967 and
            // -0.0008274509803921569 respectively. "Is zero still zero" costs a
            // detector one line and catches us unconditionally, while a zero carries
            // no entropy to hide in the first place.
            // The zero guard now lives in the width path above; the per-metric
            // substitution it used to guard is gone entirely.

            // [FIX measuretext-not-a-textmetrics] measureText used to return an object
            // LITERAL instead of a TextMetrics. Three divergences from a real browser,
            // each checkable in one line:
            //   1) ctx.measureText('x') instanceof TextMetrics === false;
            //   2) Object.getOwnPropertyNames(m) returned 9 metric names, whereas a
            //      native TextMetrics has NO own properties at all — every metric is an
            //      accessor on TextMetrics.prototype;
            //   3) hangingBaseline / alphabeticBaseline / ideographicBaseline were
            //      missing — the native object has them and returns numbers, while the
            //      literal returned undefined.
            // Simply swapping the literal for Object.create(TextMetrics.prototype) will
            // not do: any property we did NOT override would reach the native accessor
            // with a foreign this and throw "Illegal invocation" — worse than before.
            // So the accessors on TextMetrics.prototype are themselves replaced (once
            // each, via _mn with isAccessor), and measureText returns a REAL native
            // object with the substituted values stashed in a WeakMap.
            // Result: instanceof is right, there are no own properties, the descriptors
            // sit exactly where a clean browser keeps them, and any TextMetrics we did
            // not touch (from an unpatched path, say) transparently reports its native
            // values.
            var _tmSubst = new WeakMap();
            var _TM_NAMES = [];
            var _tmProtoOk = (function() {
                try {
                    if (typeof TextMetrics === 'undefined' || !TextMetrics.prototype) return false;
                    var proto = TextMetrics.prototype;
                    Object.getOwnPropertyNames(proto).forEach(function(name) {
                        if (name === 'constructor') return;
                        var d = Object.getOwnPropertyDescriptor(proto, name);
                        if (!d || typeof d.get !== 'function') return;
                        var origGet = d.get;
                        _TM_NAMES.push(name);
                        var g = ({ [name]: function() {
                            try {
                                var s = _tmSubst.get(this);
                                if (s && Object.prototype.hasOwnProperty.call(s, name)) return s[name];
                            } catch (eG) {}
                            // not our object → the native value, and the native
                            // Illegal invocation exception for a foreign this
                            return origGet.call(this);
                        } })[name];
                        try {
                            Object.defineProperty(proto, name, {
                                get: _mn(g, true),
                                enumerable: d.enumerable,
                                configurable: true
                            });
                        } catch (eD) {}
                    });
                    return _TM_NAMES.length > 0;
                } catch (e) { return false; }
            })();

            // Shared implementation for CanvasRenderingContext2D and
            // OffscreenCanvasRenderingContext2D: origFn is the native measureText of
            // THAT SPECIFIC interface (calling another one's would throw Illegal
            // invocation).
            function _measureText(ctx, text, origFn) {
                // [FIX stealth-first-load-noised-the-canvas] Same story as the canvas
                // noise, and measured the same way: in stealth the fonts module is off from
                // the second load on, so text metrics are native — but a new tab's FIRST
                // load still substituted widths, and the difference is visible at the
                // precision FingerprintJS reads. One origin, stealth:
                //   first load  137.7911 / 143.9413 / 124.8180
                //   second load 137.7891 / 143.9453 / 124.8203
                // The metric is asked for at effect time now, so the first load agrees with
                // every load after it.
                if (_noiseOff()) return origFn.call(ctx, text);
                var W = _wasm();
                var font = ctx.font || '';
                var m;

                // Normalization: fonts outside allowedFonts → the generic fallback
                var fi = _fontInfo(font);
                var blocked = fi.blocked;
                // [FIX noise-undid-the-normalisation] The key for the width substitution
                // must be the NORMALIZED font string, not the requested one. The noise
                // is hashed over (seed, font, text); if, after normalizing to a generic,
                // we hashed over the REQUESTED font, the measurement of a blocked font
                // would stop matching the measurement of the generic itself — the noise
                // would hand back precisely the difference the normalization removed,
                // and the blocked font becomes "detectable" again.
                // Measured with the same method CreepJS uses for font A (7 metrics,
                // baseline 16px monospace): on a CLEAN browser on Windows only
                // [Segoe UI] is detected (Helvetica Neue is not installed), while we had
                // BOTH detected → an Other label instead of Windows. With the normalized
                // key a blocked font measures byte for byte like its generic — exactly
                // as on a browser where the font is absent.
                var fontKey = font;
                if (blocked) {
                    // [FIX blocked-font-measured-on-the-wrong-context-type] The scratch is
                    // picked to match the caller's interface, and the native measureText of
                    // THAT interface is the one invoked on it — calling the other one's
                    // throws Illegal invocation. See _scratchFor for the measurement that
                    // made this necessary.
                    var s = _scratchFor(ctx);
                    var tc = s.ctx;
                    if (tc) {
                        var normFont = fi.norm;
                        tc.font = normFont;
                        m = s.off ? origFn.call(tc, text) : _origMT.call(tc, text);
                        fontKey = normFont;
                    } else { m = origFn.call(ctx, text); }
                } else { m = origFn.call(ctx, text); }

                // leave zero alone — see [FIX perturbed-exact-zeros]: the native width of
                // the empty string is exactly 0, a non-zero width there is impossible
                var w = (m.width === 0) ? 0 : _substWidth(W, m.width, fontKey, text);

                // [FIX integer-metrics-turned-into-floats] EVERY numeric field of
                // TextMetrics used to be noised here. In Chrome the bounding-box metrics
                // are integers (measured: fontBoundingBoxAscent 9, Descent 2,
                // actualBoundingBox* integral across every probe), and a ±0.001
                // substitution turned them fractional: 9 → 9.000733333333333.
                // CreepJS checks exactly this, verbatim (src/canvas/index.ts,
                // getTextMetricsFloatLie): it takes measureText('') and, if any one of
                // the six — actualBoundingBox{Ascent,Descent,Left,Right} and
                // fontBoundingBox{Ascent,Descent} — is non-integral, it records
                // documentLie('CanvasRenderingContext2D.measureText',
                // 'metric noise detected') and paints the Canvas section with the
                // rejected class.
                // width is EXCLUDED from that check deliberately by its authors (in
                // their code the line `// width: w,` is commented out) — in Chrome it is
                // legitimately fractional (73.9375, 89.291015625).
                // So only width is substituted. Rounding noise on the rest would be
                // pointless (±0.001 rounds back to the same integer), and the font
                // protection does not come from it anyway but from the normalization: a
                // blocked font already has its metrics taken from the generic fallback.
                if (_tmProtoOk) {
                    var subst = { width: w };
                    try { _tmSubst.set(m, subst); return m; } catch (eS) {}
                }
                // Fallback (TextMetrics unavailable / the prototype would not budge):
                // a literal with the same fields. The metrics are native, only width is
                // substituted — see [FIX integer-metrics-turned-into-floats] above.
                // [FIX fallback-literal-was-missing-the-baselines] The note above lists
                // "hangingBaseline / alphabeticBaseline / ideographicBaseline were
                // missing — the native object has them and returns numbers, while the
                // literal returned undefined" as one of the three reasons the literal was
                // wrong, and then the replacement literal left out those very three. It
                // only runs when the TextMetrics prototype could not be patched, so it was
                // never the common path, but a fallback that reproduces the defect it
                // documents is worse than no fallback. Copied from the native object like
                // every other field here.
                return {
                    width:                    w,
                    actualBoundingBoxLeft:    m.actualBoundingBoxLeft,
                    actualBoundingBoxRight:   m.actualBoundingBoxRight,
                    actualBoundingBoxAscent:  m.actualBoundingBoxAscent,
                    actualBoundingBoxDescent: m.actualBoundingBoxDescent,
                    fontBoundingBoxAscent:    m.fontBoundingBoxAscent,
                    fontBoundingBoxDescent:   m.fontBoundingBoxDescent,
                    emHeightAscent:           m.emHeightAscent,
                    emHeightDescent:          m.emHeightDescent,
                    hangingBaseline:          m.hangingBaseline,
                    alphabeticBaseline:       m.alphabeticBaseline,
                    ideographicBaseline:      m.ideographicBaseline
                };
            }

            CanvasRenderingContext2D.prototype.measureText = _mn(function measureText(text) {
                if (arguments.length < 1) return _origMT.apply(this, arguments);
                return _measureText(this, text, _origMT);
            });

            // [FIX fillText-strokeText-unpatched] measureText normalizes the WIDTH for
            // fonts outside allowedFonts, but the DRAWING itself (fillText/strokeText)
            // was not touched at all — the real glyphs of a blocked font were painted
            // onto the canvas unchanged. Any probe that draws text and reads the PIXELS
            // (rather than only calling measureText) saw the genuinely installed font no
            // matter what measureText returned — the canvas noise
            // (getImageData/toDataURL/...) is of course applied to those pixels as
            // usual, but the FONT itself was real. Same generic-fallback substitution
            // trick as in measureText: swap ctx.font for the duration of the call and
            // restore it immediately after (in finally), so that a later read of
            // ctx.font from the page sees the original requested value, as it should.
            function _drawWithNormalizedFont(origFn, ctx, text, x, y, maxWidth) {
                var font = ctx.font || '';
                var fi = _fontInfo(font);
                if (!fi.blocked) {
                    return (maxWidth !== undefined) ? origFn.call(ctx, text, x, y, maxWidth) : origFn.call(ctx, text, x, y);
                }
                var savedFont = ctx.font;
                ctx.font = fi.norm;
                try {
                    return (maxWidth !== undefined) ? origFn.call(ctx, text, x, y, maxWidth) : origFn.call(ctx, text, x, y);
                } finally {
                    ctx.font = savedFont;
                }
            }
            var _origFillText = CanvasRenderingContext2D.prototype.fillText;
            if (_origFillText) {
                CanvasRenderingContext2D.prototype.fillText = _mn(function fillText(text, x, y, maxWidth = undefined) {
                    if (arguments.length < 3) return _origFillText.apply(this, arguments);
                    return _drawWithNormalizedFont(_origFillText, this, text, x, y, maxWidth);
                });
            }
            var _origStrokeText = CanvasRenderingContext2D.prototype.strokeText;
            if (_origStrokeText) {
                CanvasRenderingContext2D.prototype.strokeText = _mn(function strokeText(text, x, y, maxWidth = undefined) {
                    if (arguments.length < 3) return _origStrokeText.apply(this, arguments);
                    return _drawWithNormalizedFont(_origStrokeText, this, text, x, y, maxWidth);
                });
            }

            // [FIX offscreen-text-unpatched] OffscreenCanvasRenderingContext2D is a
            // separate interface that does not inherit from CanvasRenderingContext2D
            // (the same gap that makes its getImageData and convertToBlob need their own
            // patches above). Its measureText/fillText/strokeText were not touched at
            // all: on one and the same page canvas.getContext('2d').measureText(s).width
            // returned the substituted value while
            // new OffscreenCanvas(..).getContext('2d').measureText(s).width returned the
            // real one, and a blocked font was drawn there for real. A discrepancy
            // between two 2D contexts of the same document is detectable by a trivial
            // comparison, so both now go through the same _measureText /
            // _drawWithNormalizedFont.
            try {
                if (typeof OffscreenCanvasRenderingContext2D !== 'undefined' &&
                    OffscreenCanvasRenderingContext2D.prototype) {
                    var OP = OffscreenCanvasRenderingContext2D.prototype;
                    var _oMT = OP.measureText;
                    if (_oMT) {
                        OP.measureText = _mn(function measureText(text) {
                            if (arguments.length < 1) return _oMT.apply(this, arguments);
                            return _measureText(this, text, _oMT);
                        });
                    }
                    var _oFill = OP.fillText;
                    if (_oFill) {
                        OP.fillText = _mn(function fillText(text, x, y, maxWidth = undefined) {
                            if (arguments.length < 3) return _oFill.apply(this, arguments);
                            return _drawWithNormalizedFont(_oFill, this, text, x, y, maxWidth);
                        });
                    }
                    var _oStroke = OP.strokeText;
                    if (_oStroke) {
                        OP.strokeText = _mn(function strokeText(text, x, y, maxWidth = undefined) {
                            if (arguments.length < 3) return _oStroke.apply(this, arguments);
                            return _drawWithNormalizedFont(_oStroke, this, text, x, y, maxWidth);
                        });
                    }
                }
            } catch (eOT) {}

        } catch(_) {}
    })();
    // Problems with the old version:
    // 1. fakeVoices were plain objects, not SpeechSynthesisVoice instances (detectable
    //    with instanceof)
    // 2. speaking/pending/paused were not patched — the real state leaked
    // 3. 6 voices including Online — untypical for a plain Windows without a subscription
    // [STEALTH] skip SPEECH
    // [FIX speech-locale] Take ID.speechVoices from the profile (locale-aware in
    // background.buildProfile); the hardcoded en-US is only a fallback.
    // [FIX ungated-patch] This used to be governed by stealth mode alone — unticking the
    // boxes in the settings did not disable the section. speechVoices come from the
    // navigator profile.
    // [FIX stealth-kept-the-locale-but-not-the-voices] This used to carry `if (!_STEALTH)`
    // as well — stealth skipped the voice list entirely, to keep the patch count down.
    //
    // But stealth does NOT stop spoofing the locale: `navigator` and `timezone` both stay on
    // there by design, so the page still claims et-EE while speechSynthesis went on
    // returning the host's real voices. CreepJS's speech test compares the DEFAULT voice's
    // language against `Intl.DateTimeFormat().resolvedOptions().locale` and sets
    // LowerEntropy.TIME_ZONE when they disagree — which paints BOTH the Timezone and Intl
    // hashes red. Measured, stealth, second load of the tab:
    //
    //   Intl locale    et-EE
    //   default voice  Microsoft Irina - Russian (Russia) [ru-RU]
    //   -> Timezone + Intl both bold-fail, totalLies 0
    //
    // One fewer patch bought a contradiction the page announces on every load, which is the
    // trade this codebase keeps refusing — see the AudioContext noise and the font-vs-canvas
    // split. The `navigator` flag still governs it, so unticking that in the options
    // disables the section as it always did.
    //
    // Worth knowing when testing: _STEALTH is decided as mw-core loads, from
    // sessionStorage['v.ui.m'], which is empty on a FRESH tab — so the first load of a tab
    // runs as 'normal' and patches the voices anyway. A probe that does not reload measures
    // the wrong mode and reports this as fixed when it is not.
    if (!_FEAT.navigator) { /* disabled in options */ } else
    (function() {
        try {
            if (!window.speechSynthesis) return;
            var ss = window.speechSynthesis;
            var ssProto = Object.getPrototypeOf(ss);
            var _voiceProto = (window.SpeechSynthesisVoice && window.SpeechSynthesisVoice.prototype) || null;
            function _voiceDefs() {
                var fromProfile = null;
                try {
                    var src = (_prof() && _prof().speechVoices) || ID.speechVoices;
                    if (Array.isArray(src) && src.length) fromProfile = src;
                } catch (e) {}
                if (fromProfile) {
                    return fromProfile.map(function(v) {
                        return {
                            name: v.name || 'Microsoft Zira - English (United States)',
                            lang: v.lang || 'en-US',
                            local: v.localService !== false,
                            def: !!v.default
                        };
                    });
                }
                return [
                    { name: 'Microsoft David - English (United States)', lang: 'en-US', local: true,  def: false },
                    { name: 'Microsoft Mark - English (United States)',  lang: 'en-US', local: true,  def: false },
                    { name: 'Microsoft Zira - English (United States)',  lang: 'en-US', local: true,  def: true  }
                ];
            }
            function _buildVoices() {
                return _voiceDefs().map(function(v) {
                    var obj = _voiceProto ? Object.create(_voiceProto) : {};
                    // [FIX anon-getter-name] The name/lang/voiceURI/default getters were
                    // anonymous → fn.name '' → _mn returned 'function () { [native code] }'
                    // when the descriptor's .get.toString() was read. The name is set via a
                    // computed object key — for 'default' that is also the only way:
                    // `function default(){}` is invalid syntax (reserved word).
                    ['name','lang','voiceURI'].forEach(function(p) {
                        var g = ({ [p]: function() { return v[p === 'voiceURI' ? 'name' : p]; } })[p];
                        Object.defineProperty(obj, p, {
                            get: _mn(g, true),
                            enumerable: true, configurable: true
                        });
                    });
                    Object.defineProperty(obj, 'localService', { get: _mn(function localService() { return v.local; }, true), enumerable: true, configurable: true });
                    Object.defineProperty(obj, 'default',      { get: _mn(({ 'default': function() { return v.def; } })['default'], true), enumerable: true, configurable: true });
                    return obj;
                });
            }
            var _fakeGV = _mn(function getVoices() { return _buildVoices(); });
            try { Object.defineProperty(ssProto, 'getVoices', { value: _fakeGV, writable: true, configurable: true }); } catch(e) {}
            // [FIX speechsynthesis-getvoices-was-an-own-property] The instance was patched
            // here too, right after the prototype. It bought nothing — the prototype patch
            // already answers every call on the only instance there is — and it cost the
            // one thing this file is careful about everywhere else:
            //
            //   Object.getOwnPropertyNames(speechSynthesis)
            //     clean  []
            //     ours   ["getVoices"]
            //
            // measured against clean Chromium on the same machine. Third instance of that
            // class in one day, after navigator.connection and document.documentElement,
            // which is why test/ownprops.mjs now compares every one of these objects against
            // a second BROWSER rather than against an iframe that shares our content scripts.
            // [ANTI-CREEP] speaking/pending/paused are deliberately NOT patched.
            [0, 50, 100, 200, 500].forEach(function(d) {
                setTimeout(function() { try { ss.dispatchEvent(new Event('voiceschanged')); } catch(e) {} }, d);
            });
        } catch(_) {}
    })();



    // ===== WASM LOCALE SYNC =====
    // Once WASM has loaded, sync its internal g_timezone/g_language with the real
    // profile. By default WASM starts out on 'Europe/Tallinn'.
    (function() {
        // [FIX sync-race] ui:w is a one-shot event. background.js loads WASM
        // (DELAY_LOAD_WASM=50ms) before the profile (DELAY_INJECT_PROFILE=300ms), so at
        // the moment the event fires the profile may not be ready yet — and then the
        // sync silently does not happen and never gets another chance (the event has
        // already gone off). The delays are spread apart deliberately for the audio test
        // (see the comment on DELAY_LOAD_WASM in background.js), so the cure is not a
        // different delay order but a short poll here: try a few more times over ~1s
        // until the profile shows up.
        var _syncAttempts = 0;
        var _syncDone = false;
        function _syncLocale() {
            var W = _wasm();
            var P = _prof();
            var ok = false;
            if (W && W.setLocale && P && P.timezone) {
                try { W.setLocale(P.timezone, P.language || ''); ok = true; } catch(e) {}
            }
            if (ok) { _syncDone = true; return; }
            // The profile has not arrived yet — retry at short intervals.
            if (_syncAttempts++ < 10) setTimeout(_syncLocale, 100);
        }
        // WASM is ready already — sync right away
        if (_wasm()) { _syncLocale(); }
        // Otherwise wait for the event (and poll afterwards too, just in case)
        window.addEventListener('ui:w', function() {
            if (!_syncDone) _syncLocale();
        });
    })();

})();
