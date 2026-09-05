// ===== HIDE AD BLOCKER =====
(function() {
    'use strict';
    // [FIX eight-copies-of-the-profile-reader] _prof used to be copied verbatim into every
    // module, each with its OWN memo, so one page load parsed the profile once per module
    // instead of once. It lives in mw-core.js now (see _prof there for why it memoises on
    // the raw string rather than snapshotting).
    //
    // Captured at load time, the way the snapshots further down this file are: mw-core.js
    // is first in the manifest, and mw-cleanup.js deletes __AFP_MW__ before the page runs,
    // but a captured function reference outlives the deleted property. This module has no
    // `if (!MW) return;` guard on purpose, so it keeps working if the registry is missing —
    // with no profile to read, which every caller here already treats as "use the
    // defaults", exactly as it does for an empty sessionStorage.
    var _prof = (window.__AFP_MW__ && window.__AFP_MW__.prof) || function () { return null; };
    // [FIX feature-switch-read-from-a-profile-that-has-no-features] Same defect, same cause
    // as the one written up at the top of mw/mw-geo.js: the boot profile that exists at
    // document_start carries no `features` key at all, so this gate could never fire and the
    // Hide-AdBlock switch did nothing. The flags live on MW.FEAT, which is what every other
    // module reads; the profile stays as the fallback for the late (ui:state) path.
    var _FEAT = (window.__AFP_MW__ && window.__AFP_MW__.FEAT) || null;
    try {
        var feat = _FEAT || (_prof() && _prof().features) || {};
        try {
            var _pm = _prof();
            if ((_pm && _pm.mode === 'stealth') || sessionStorage.getItem('v.ui.m') === 'stealth') return;
        } catch (eSt) {}
        if (feat.hideAdBlocker === false) return;
        // [FIX adblock-mask-contradicted-the-network] Stand down when a real blocker is
        // refusing ad requests. Everything below claims a slot is rendered; if the network
        // layer is visibly refusing to fetch ads, that claim is not a lie the page can
        // believe — it is a pair of answers no browser produces, and a page reading both
        // learns more than if we had never spoken. Measured, thirteen detection techniques
        // on theguardian.com: clean browser 0 detect, AdGuard + this extension 4 detect, all
        // four network-side. The full table and why masking harder cannot fix it are in
        // background.js at afpNoteNetBlock.
        //
        // Set browser-wide (not per-origin) by storage-bridge.js from what background.js sees,
        // so it is already true on the first page of a site, and it expires by itself a week
        // after the last refused ad request — remove the blocker and this module comes back
        // with no other bookkeeping.
        // Two checks, not one, because the flag is per-ORIGIN sessionStorage while the fact it
        // carries is browser-wide. storage-bridge.js writes it ~8ms into a load, so on the
        // FIRST page of an origin this read is too early — measured on a live AdGuard install:
        //
        //   theguardian.com, 2nd load   47 bait, 47 read blocked, 0 visible   (stood down)
        //   edition.cnn.com, 1st load   27 bait,  0 read blocked, 27 visible  (still masking)
        //   edition.cnn.com, 2nd load   27 bait, 27 read blocked, 0 visible   (stood down)
        //
        // one masked load per new site, which is the visit a fingerprinter cares about most.
        // So the decision is ALSO taken again at read time (_standDown below): the patches go
        // in, and each one asks again when it is actually called. A page's detection code runs
        // after its own bundle has loaded — far later than 8ms — so by then the answer is in.
        // This early return is kept as the clean path for every load after the first, where
        // nothing gets installed at all.
        try { if (sessionStorage.getItem('v.ui.ab') === '1') return; } catch (eAb) {}
        if (window.__AFP_ADBLOCK_HIDE__) return;
        window.__AFP_ADBLOCK_HIDE__ = true;

        var BAIT = ['adbox','ad-box','adsbox','ad-banner','ad-container','google-ad','adsense',
            'adblock','ad-block','adblocker','ad-wrapper','sponsored','ad-slot','adslot'];
        // [FIX dom-clobbering-turned-a-read-into-a-throw] Reported from
        // github.com/<user>/<repo>/settings:
        //
        //   Uncaught TypeError: (el.id || "").toLowerCase is not a function
        //
        // `el.id` was not a string. HTMLFormElement's named getter is
        // [LegacyOverrideBuiltIns], so a <form> containing <input name="id"> answers its
        // own CONTROL for form.id — the classic DOM-clobbering shape, and GitHub's settings
        // form has it. The same goes for className, tagName and getAttribute itself, which
        // this function also touched: a control named getAttribute makes `el.getAttribute`
        // an <input>, truthy, and calling it throws.
        //
        // That is not a fingerprint leak, it is the extension breaking a site: isBait sits
        // in FRONT of getComputedStyle, getBoundingClientRect, getClientRects,
        // checkVisibility and the offset getters, so the page's own call got our TypeError
        // where a browser hands back a value. Three of those five threw on the fixture
        // (dev-adblockmask.html, the DOM-clobbering block).
        //
        // Attributes cannot be clobbered, and the reader is the prototype method captured
        // at document_start, so neither the page's markup nor a later replacement of
        // Element.prototype.getAttribute can reach it. A non-element throws inside _attr
        // and reads as "not bait", which is the right answer anyway.
        var _protoGetAttr = null, _protoHasAttr = null;
        try { _protoGetAttr = Element.prototype.getAttribute; } catch (eGA) {}
        try { _protoHasAttr = Element.prototype.hasAttribute; } catch (eHA) {}
        function _attr(el, name) {
            try {
                var v = _protoGetAttr.call(el, name);
                return typeof v === 'string' ? v : '';
            } catch (e) { return ''; }
        }
        function _hasAttr(el, name) {
            try { return _protoHasAttr.call(el, name) === true; } catch (e) { return false; }
        }
        function isBait(el) {
            try {
                if (!el) return false;
                var id = _attr(el, 'id').toLowerCase();
                var cls = _attr(el, 'class').toLowerCase();
                for (var i = 0; i < BAIT.length; i++) {
                    if (id.indexOf(BAIT[i]) !== -1 || cls.indexOf(BAIT[i]) !== -1) return true;
                }
                // Presence, not value: an empty data-ad still marks a slot, which is what
                // the getAttribute(...) !== null test here meant.
                return _hasAttr(el, 'data-ad') || _hasAttr(el, 'data-ad-slot');
            } catch (e) { return false; }
        }
        var _mnRef = (function() {
            try {
                var a = window.__AFP_MW__;
                if (a && typeof a.mn === 'function') return a.mn;
            } catch (e) {}
            return function(fn) { return fn; };
        })();
        // [FIX bound-method-identity] One wrapper per property name for the whole page,
        // not per style object: natively these methods live on
        // CSSStyleDeclaration.prototype, so getComputedStyle(a).getPropertyValue and
        // getComputedStyle(b).getPropertyValue are the SAME function. A per-instance
        // cache still failed that check (measured: identity_stable false). The wrapper
        // therefore takes its receiver from `this` and unwraps the proxy back to the real
        // declaration — a native method applied to the proxy would throw Illegal
        // invocation.
        var _fnCache = Object.create(null);
        var _proxyTarget = new WeakMap();

        // [FIX adblock-mask-contradicted-itself] ONE substitution table, used by every read
        // that can reach it. It used to live inline in the proxy's get trap and so applied
        // to `style.display` only, while `style.getPropertyValue('display')` — the same
        // property, on the same object — went to the native method and answered 'none'.
        // dev-adblockmask.html measured that as a LEAK, and it is worse than a leak: no real
        // browser disagrees with itself about one property of one element, so the
        // contradiction is a positive signature rather than a missing lie.
        // Re-asked at call time — see the note on the early return above. Memoised for a
        // fifth of a second so a page that reads geometry in a loop does not pay for a
        // sessionStorage hit each time; every consumer below is already behind an isBait
        // check, so this runs for ad slots and nothing else.
        var _sdAt = 0, _sd = false;
        function _standDown() {
            var t = Date.now();
            if (t - _sdAt < 200) return _sd;
            _sdAt = t;
            try { _sd = sessionStorage.getItem('v.ui.ab') === '1'; } catch (e) {}
            return _sd;
        }
        function _maskValue(prop, v) {
            if (prop === 'display' && v === 'none') return 'block';
            if (prop === 'visibility' && (v === 'hidden' || v === 'collapse')) return 'visible';
            if (prop === 'opacity' && parseFloat(v) === 0) return '1';
            return v;
        }
        // [FIX adblock-zero-check-vs-clientrects-noise] "Effectively zero", not "exactly
        // zero". mw-misc.js loads BEFORE this file and, when the clientRects feature is on,
        // patches the DOMRect accessors with ±0.001px noise. A blocked bait normally escapes
        // that noise — mw-misc leaves a rect untouched when all four raw numbers sit on the
        // pixel grid (_rectIsKnown) or the element has no text (_noisedRects) — but a bait
        // that DOES carry text and sits on a fractional x/y (sub-pixel layout, a scroll
        // offset, a transform) satisfies neither guard, so its width comes back as
        // 0 + ~±0.001 instead of a hard 0. A bare `=== 0` then misses it and the mask does
        // not fire. Half a pixel is the threshold because offset*/client* are integer-
        // rounded and a genuinely visible element is ≥1px, so nothing real lands in (−0.5,
        // 0.5) while every noised-zero does. Kept local rather than shared with mw-misc:
        // this file must not depend on that one's internals, which is the coupling the miss
        // came from in the first place.
        var _EPS = 0.5;
        function _nearZero(v) { return typeof v === 'number' && v > -_EPS && v < _EPS; }
        // The one rect a masked bait reports, shared by getBoundingClientRect and
        // getClientRects so those two cannot drift apart — the same desync that was fixed
        // for the clientRects noise and then reintroduced here by patching only the first.
        // width/height fall back to the bait size when the real read is effectively zero,
        // so a noised 0.001 becomes 300/250 rather than surviving as a tell.
        function _baitRect(el, r) {
            var w = _nearZero(r.width) ? 300 : (r.width || 300);
            var h = _nearZero(r.height) ? 250 : (r.height || 250);
            return new DOMRect(r.x || 0, r.y || 0, w, h);
        }

        var _gcs = window.getComputedStyle;
        // [FIX dom-clobbering-turned-a-read-into-a-throw] The native call is made first
        // and OUTSIDE the guard: a page that passes rubbish must get the browser's own
        // TypeError, unchanged. Everything after it is ours, and if ours throws the page
        // gets the value it would have had without this extension — see the fixture.
        window.getComputedStyle = _mnRef(function getComputedStyle(el, pseudo) {
            var style = _gcs.call(this, el, pseudo);
            try {
            if (!isBait(el) || _standDown()) return style;
            var _p = new Proxy(style, {
                get: function(t, prop) {
                    var v = Reflect.get(t, prop);
                    // [FIX bound-method-identity] Methods used to come back as v.bind(t),
                    // which breaks two things a detector reads for free on the very
                    // element we are lying about: .name gains a "bound " prefix
                    // ('bound getPropertyValue' instead of 'getPropertyValue' — the same
                    // trap fixed for supportedLocalesOf in mw-timezone-screen.js), and a
                    // fresh function is returned on EVERY access, so
                    // s.getPropertyValue !== s.getPropertyValue while a real
                    // CSSStyleDeclaration hands back the identical function each time.
                    // The wrapper keeps the property name, is masked like everything
                    // else, and is memoised per (target, prop) to preserve identity.
                    if (typeof v === 'function') {
                        if (!_fnCache[prop]) {
                            var named = ({ [prop]: function () {
                                // Resolved rather than defaulted: this wrapper is shared by
                                // every bait style (that is what keeps its identity stable),
                                // so it can be pulled off one and applied to another
                                // declaration by hand. Masking on `this` only when `this` is
                                // one of OUR proxies keeps that from lying about an element
                                // nothing is hiding.
                                var real = _proxyTarget.get(this);
                                var out = v.apply(real || this, arguments);
                                if (real && prop === 'getPropertyValue') {
                                    return _maskValue(String(arguments[0]).toLowerCase(), out);
                                }
                                return out;
                            } })[prop];
                            try { Object.defineProperty(named, 'length', { value: v.length, configurable: true }); } catch (eL) {}
                            _fnCache[prop] = _mnRef(named);
                        }
                        return _fnCache[prop];
                    }
                    // functions already returned above, so these are plain values
                    return _maskValue(prop, v);
                }
            });
            _proxyTarget.set(_p, style);
            return _p;
            } catch (eOurs) { return style; }
        });
        var _gbcr = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = _mnRef(function getBoundingClientRect() {
            var r = _gbcr.call(this);
            try {
                if (isBait(this) && (_nearZero(r.width) || _nearZero(r.height)) && !_standDown()) return _baitRect(this, r);
            } catch (eOurs) {}
            return r;
        });

        // [FIX adblock-mask-contradicted-itself] Everything below was left native, so the
        // module masked 5 of the 12 reads dev-adblockmask.html makes and the other 7 said
        // the element was blocked — including `offsetHeight === 0`, which is the single most
        // common ad-bait check there is. The gap alone would only mean "weak"; the pairing
        // is what made it harmful, because a page could read both halves and get an answer
        // no browser gives:
        //
        //     getComputedStyle(el).display          "block"   (masked)
        //     …    .getPropertyValue("display")     "none"    (native)
        //     el.getBoundingClientRect().height     250       (masked)
        //     el.getClientRects().length            0         (native)
        //     el.offsetHeight                       0         (native)
        //
        // "An ad blocker is present" is a cheap, common signal — tens of percent of users.
        // "This browser contradicts itself about one element" is rare and conclusive, so the
        // half-mask traded a crowd signal for a unique one.
        //
        // Each patch below calls the native FIRST, with `this`. That is deliberate twice
        // over: it yields the real value to decide on, and a wrong receiver throws the
        // native TypeError: Illegal invocation (measured) instead of silently answering, so
        // the brand check every other accessor in this codebase keeps is kept here too.
        // Nothing is substituted unless the element is bait AND the real value is the
        // blocked one, so an unblocked page reads exactly as it did before.
        //
        // Prototypes are measured, not assumed: offset* and offsetParent live on
        // HTMLElement.prototype, client*/getClientRects/checkVisibility on Element.prototype.
        function _maskAccessor(proto, name, isBlocked, subst) {
            try {
                if (!proto) return;
                var d = Object.getOwnPropertyDescriptor(proto, name);
                if (!d || typeof d.get !== 'function') return;
                var orig = d.get;
                // A computed key so the function carries the property's own name rather than
                // '' — see [FIX anon-getter-name] on the window globals above. It must be the
                // BARE name: _mn adds the "get " itself when the accessor flag is set, and a
                // getter defined as `get [name]()` is already called 'get clientWidth', which
                // the mask then renders as 'function get get clientWidth() { [native code] }'.
                // dev-vsnative.html compares every patched member against a pristine realm and
                // caught exactly that.
                var getter = ({ [name]: function () {
                    var v = orig.call(this);
                    try {
                        if (!isBlocked(v) || !isBait(this) || _standDown()) return v;
                        return subst(this, v);
                    } catch (eOurs) { return v; }
                } })[name];
                Object.defineProperty(proto, name, {
                    get: _mnRef(getter, true), set: d.set,
                    enumerable: d.enumerable, configurable: d.configurable
                });
            } catch (e) {}
        }
        // offset*/client* are integer-rounded by the browser and never carry the DOMRect
        // noise, so === 0 was already correct here; routed through _nearZero only so this
        // file has one definition of "blocked size" rather than two.
        var _isZero = _nearZero;
        if (typeof HTMLElement !== 'undefined') {
            _maskAccessor(HTMLElement.prototype, 'offsetHeight', _isZero, function () { return 250; });
            _maskAccessor(HTMLElement.prototype, 'offsetWidth', _isZero, function () { return 300; });
            // A displayed element's offsetParent is its nearest positioned ancestor, body
            // when there is none. Answering with body keeps `offsetParent.contains(el)` true,
            // which is the follow-up read once a detector has a non-null answer.
            _maskAccessor(HTMLElement.prototype, 'offsetParent',
                function (v) { return v === null; },
                function (el) {
                    var b = document.body;
                    return (b && b !== el && b.contains(el)) ? b : null;
                });
        }
        _maskAccessor(Element.prototype, 'clientHeight', _isZero, function () { return 250; });
        _maskAccessor(Element.prototype, 'clientWidth', _isZero, function () { return 300; });

        // getClientRects on a blocked element is an EMPTY DOMRectList, and DOMRectList is not
        // constructible — so the list has to be a proxy over the real empty one. Measured
        // against a genuinely non-empty list from a visible element, the proxy matches it on
        // every read: [object DOMRectList], instanceof, length, [0], item(0), Array.from,
        // spread, and `list.item === list.item`. The last two are the ones a naive proxy
        // fails — forwarding @@iterator to the empty target makes Array.from disagree with
        // length, and building the method fresh per access breaks identity the same way
        // [FIX bound-method-identity] did above.
        var _rectListFns = new WeakMap();
        function _fakeRectList(realList, rect) {
            var fns = Object.create(null);
            _rectListFns.set(realList, fns);
            function memo(key, make) {
                if (!fns[key]) { fns[key] = make(); }
                return fns[key];
            }
            return new Proxy(realList, {
                get: function (t, prop) {
                    if (prop === 'length') return 1;
                    if (prop === '0') return rect;
                    var v = Reflect.get(t, prop);
                    if (typeof v !== 'function') return v;
                    if (prop === 'item') {
                        return memo('item', function () {
                            return _mnRef(({ item: function item(i) { return i === 0 ? rect : null; } }).item);
                        });
                    }
                    if (prop === Symbol.iterator) {
                        return memo('@@iterator', function () {
                            return _mnRef(({ values: function values() { return [rect][Symbol.iterator](); } }).values);
                        });
                    }
                    return memo(String(prop), function () {
                        return _mnRef(({ [prop]: function () { return v.apply(t, arguments); } })[prop]);
                    });
                },
                has: function (t, prop) { return prop === '0' ? true : Reflect.has(t, prop); },
                ownKeys: function (t) {
                    return ['0'].concat(Reflect.ownKeys(t).filter(function (k) { return k !== '0'; }));
                },
                getOwnPropertyDescriptor: function (t, prop) {
                    if (prop === '0') return { value: rect, writable: false, enumerable: true, configurable: true };
                    if (prop === 'length') return { value: 1, writable: false, enumerable: false, configurable: true };
                    return Reflect.getOwnPropertyDescriptor(t, prop);
                }
            });
        }
        var _gcrList = Element.prototype.getClientRects;
        if (typeof _gcrList === 'function') {
            Element.prototype.getClientRects = _mnRef(function getClientRects() {
                var list = _gcrList.call(this);
                try {
                if (!isBait(this) || _standDown()) return list;
                // [FIX adblock-getclientrects-nonempty-collapsed] The old guard was
                // `list.length` — "a non-empty list means the element is not blocked, hand
                // it back". That holds for a display:none block, which yields an EMPTY list,
                // but not for a cosmetic filter that collapses the box in flow
                // (width:0!important;height:0!important) — a common filter-list technique.
                // There the list has one rect of size ~0, so the length check passed the
                // native (and, with clientRects on, noised) zero rect straight through,
                // while getBoundingClientRect on the SAME element was masked to 300x250.
                // One element, two answers — the self-contradiction this module exists to
                // avoid. Mask when the list is empty OR its first rect is effectively zero;
                // a genuinely visible bait has a real first rect and is left untouched.
                var blocked = !list || !list.length;
                if (!blocked) {
                    try { var r0 = list[0]; blocked = _nearZero(r0.width) || _nearZero(r0.height); } catch (e) {}
                }
                if (!blocked) return list;
                return _fakeRectList(list, _baitRect(this, _gbcr.call(this)));
                } catch (eOurs) { return list; }
            });
        }
        // checkVisibility() answers the question directly, so leaving it native handed back
        // the very boolean everything above exists to avoid.
        var _checkVis = Element.prototype.checkVisibility;
        if (typeof _checkVis === 'function') {
            Element.prototype.checkVisibility = _mnRef(function checkVisibility() {
                var v = _checkVis.apply(this, arguments);
                try {
                    if (v === false && isBait(this) && !_standDown()) return true;
                } catch (eOurs) {}
                return v;
            });
        }
        // [FIX seven-adblock-globals-a-clean-browser-does-not-have] REMOVED — do not put
        // these back. Seven accessors used to be defined on window here:
        //
        //     adblock  AdBlock  adBlock  uBlock  ublock  fuckAdBlock  blockAdBlock
        //
        // each a masked getter returning `undefined` and a masked setter that swallowed the
        // assignment. Two earlier fixes polished the masking of those accessors, which is
        // why they looked correct: the descriptors were right, the toString output was
        // right. The property should not have existed at all.
        //
        // 1. It bought nothing. A property that does NOT exist already reads as `undefined`
        //    — exactly what the getter returned. Every detector that asks `window.adblock`
        //    got the identical answer with or without this block.
        //
        // 2. It cost a signature. Measured, own-property names of window, this build
        //    against a clean Chromium on the same rig: clean 1237, ours 1246, and the
        //    difference is these seven plus __t0/__p0. A clean browser has NONE of them, so
        //    `'fuckAdBlock' in window` was true here and false everywhere else — one line,
        //    no baseline knowledge, and the name says what the extension is for. CreepJS
        //    already hashes this list: its own readout showed keys (1243) against (1236).
        //
        // 3. It broke the honest case. `fuckAdBlock` and `blockAdBlock` are the globals the
        //    SITE'S OWN anti-adblock library publishes when it loads. That library does
        //    `window.fuckAdBlock = new FuckAdBlock(...)`; our setter swallowed it and the
        //    getter kept answering undefined, so the site concluded its own script had been
        //    blocked and showed the wall — the exact outcome this module exists to prevent.
        //    Same shape as [FIX adblock-mask-contradicted-the-network]: the mask created the
        //    condition it was hiding.
        //
        // Everything else in this file masks a MEASUREMENT (geometry, computed style,
        // visibility) that a detector takes of bait it inserted itself. That is a different
        // thing from inventing globals, and it stays.
    } catch (e) {}
})();
