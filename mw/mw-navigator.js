(function () {
    'use strict';
    var MW = window.__AFP_MW__;
    // [FIX eight-copies-of-the-profile-reader] _prof used to be copied verbatim into every
    // module, each with its OWN memo, so one page load parsed the profile once per module
    // instead of once. The reader now lives in mw-core.js and is taken from MW below.
    if (!MW) return;
    var _prof = MW.prof;
    // No `_STEALTH` here on purpose. The Bluetooth branch was its last reader in this file
    // and it went with [FIX bluetooth-claim-never-fired]; everything
    // that still asks about the mode asks `_featNow`, which folds it in and reads it LIVE
    // — install-time `_STEALTH` is false on a tab's first load and any gate built on it is
    // a first-load split, as the note at the connection block records.
    var _FEAT = MW.FEAT;
    var ID = MW.ID;
    var _mn = MW.mn;
    // [FIX frame-intl-unmasked] needed for the frame Intl.DateTimeFormat replacement —
    // see the _patchFrameNavScreen block below.
    var _mnCtor = MW.mnCtor;
    // [FIX status-was-a-page-readable-key] The module list used to be written into
    // sessionStorage['v.ui.t'] as self-describing JSON — {"canvas":true,"webgl":true,…} —
    // which any page could read from its first inline script, on an origin where a clean
    // Chrome has NO storage keys at all (measured: extension off, zero keys). It named
    // every protection that was running, for free, without probing anything.
    //
    // Its only readers are popup.js checkProtectionsOnce and the afp-*-console-check
    // files. That popup probe ALREADY runs through chrome.scripting with world: MAIN and
    // ALREADY reads the non-enumerable window.__w0/__w1 in the same call, so a
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
    var _markStatus = (MW && MW.markStatus) ? function (k) { try { MW.markStatus(k); } catch (e) { _statusMark(k); } } : _statusMark;
    var _def = MW.def;
    var _defIfDiff = MW.defIfDiff;
    // The live flag reader, memoised per name in mw-core and folding stealth in — see
    // _STEALTH_FEAT there. `_FEAT` is what this file was BUILT with; `_featNow` is what
    // applies, and on a tab's first load those differ.
    var _featNow = (MW && MW.featNow) ? MW.featNow : function (n) { return !!(_FEAT && _FEAT[n]); };
    // [FIX the-standdown-never-fired] See mw-core. On an origin where a worker cannot be
    // patched, its OffscreenCanvas reads the real card — so the window must too, or the two
    // WebGL strings disagree in the same document.
    var _standDownNow = (MW && MW.standDownNow) ? MW.standDownNow : function () { return false; };
    var _sdProp = (MW && MW.sdProp) ? MW.sdProp : function () { return false; };
    // [FIX host-mode] Read at effect time — see the note at its definition in mw-core.
    var _hostHwNow = (MW && MW.hostHwNow) ? MW.hostHwNow : function () { return false; };
    // [FIX cpu-performance-tier-was-the-host-machine] one tier function for the window
    // and for every frame patched below. mw-core.js owns it.
    var _cpuTier = MW.cpuTier;

    // [FIX afp-own-marker-leak] Раньше "уже пропатчено"-маркеры ставились ПРЯМО на
    // объекты: uad.__afpGHEV / __afpUAD / __afpBrandsSrc, ctx.__afpGlWrapped,
    // win.__afpFrameUAD. Две отдельные проблемы.
    //
    // 1) УТЕЧКА. На настоящих объектах (navigator.userAgentData, WebGL-контекст,
    //    window фрейма) маркер реально создаётся как ПЕРЕЧИСЛИМОЕ own-свойство:
    //    Object.keys(navigator.userAgentData) возвращал '__afpUAD','__afpBrandsSrc' —
    //    буквально имя нашего маркера с "afp" внутри, читаемое любым сайтом простым
    //    перечислением. Это ровно тот класс утечки, от которого уходит mw-core
    //    ([FIX own-property-fingerprint]), просто пропущенный в этих местах.
    //
    // 2) НЕРАБОТАЮЩИЙ GUARD (хуже утечки). На функциях, обёрнутых _mn, маркер
    //    поставить НЕЛЬЗЯ вообще: _mn возвращает Proxy, у которого defineProperty-
    //    ловушка возвращает false, а getOwnPropertyDescriptor отдаёт undefined для
    //    всего кроме length/name. Присваивание o.__afpGHEV = true в strict-режиме
    //    (а этот файл strict) бросает TypeError, который тут же глушился
    //    существующим try/catch — проверено эмпирически. Значит условие
    //    !uad.getHighEntropyValues.__afpGHEV было ВСЕГДА истинным, и _patchUAD,
    //    вызываемая из геттера navigator.userAgentData (то есть на КАЖДОЕ
    //    обращение к нему), каждый раз навешивала ЕЩЁ ОДНУ обёртку поверх
    //    предыдущей — неограниченный рост цепочки .then() и стека вызовов.
    //    Замер: 5 обращений → 5 вложенных обёрток; с WeakSet → ровно 1.
    //
    // WeakSet/WeakMap решают оба: работают и на Proxy, и на нативных объектах,
    // не создают own-свойств вообще и не держат объекты от сборки мусора.
    var _ghevPatched = new WeakSet();   // наши обёртки getHighEntropyValues
    // [FIX resolvedOptions-stomped-explicit-locale] frame DateTimeFormat instances whose
    // locale WE supplied — only those get the profile locale reported back. Same rule as
    // _intlOurs in mw/mw-timezone-screen.js.
    var _frameOurs = new WeakSet();
    // [FIX explicit-timezone-was-overridden] The zone's twin of _frameOurs — frame
    // DateTimeFormat instances whose timeZone WE supplied. Only those report the profile
    // zone back and get their zone name substituted; see mw/mw-timezone-screen.js.
    var _frameOurTz = new WeakSet();
    var _glWrapped = new WeakSet();     // WebGL-контексты с instance-патчем getParameter
    var _framesPatched = new WeakSet(); // window'ы фреймов, уже обработанные
    var _uadBrands = new WeakMap();     // uad → снимок нативных brands (plain)

    // ===== NAVIGATOR =====
    // [ANTI-CREEP] Патчим ИНСТАНС navigator, не Navigator.prototype.
    // CreepJS сравнивает prototype с iframe — prototype остаётся чистым.
    // Значения на instance перекрывают prototype при чтении navigator.xxx.
    if (!_FEAT.navigator) { /* disabled */ } else
    (function() {
        try {
            var nav = navigator;
            // Prefer _defIfDiff: matching native → no own-prop → fewer CreepJS Prototype lies
            // Force identity fields when profile has them. _defIfDiff is fine when native
            // already matches; on HeadlessChrome/Linux the native values never match a
            // Windows profile, so we always apply. Using _def (not only _defIfDiff)
            // also covers cases where a prior read cached the native string.
            if (ID.platform) _def(nav, 'platform', function() { return ID.platform; });
            if (ID.hwConcurrency) _def(nav, 'hardwareConcurrency', function() { return ID.hwConcurrency; });
            if (ID.deviceMemory) _def(nav, 'deviceMemory', function() { return ID.deviceMemory; });
            // [FIX cpu-performance-tier-was-the-host-machine] Chrome 152 added
            // navigator.cpuPerformance — an integer 1..4 (0 = unclassified) that the
            // browser computes from the REAL processor. Everything around it here was
            // already the profile's, so the tier sat beside hardwareConcurrency and
            // deviceMemory describing a different machine, and it did not move when the
            // profile did. Derived from those same two fields by MW.cpuTier so the
            // window, the frames and the worker payload cannot give three answers; see
            // the note at its definition in mw-core.js.
            //
            // Guarded on the property EXISTING. On Chrome 151 and older, and on every
            // Chromium build the suite runs against, Navigator.prototype has no
            // cpuPerformance, and adding one would be exactly the invention that
            // [FIX we-invented-a-chrome-runtime-real-chrome-does-not-have] removed — a
            // property no browser of that version has, which is louder than the value it
            // would hide. _def keeps the native descriptor's enumerable/configurable and
            // brands the getter, so the shape stays the one Chrome 152 ships.
            try {
                if (typeof Navigator !== 'undefined' && Navigator.prototype &&
                    'cpuPerformance' in Navigator.prototype && ID.hwConcurrency) {
                    _def(nav, 'cpuPerformance', function () {
                        return _cpuTier(ID.hwConcurrency, ID.deviceMemory);
                    });
                }
            } catch (eCpu) {}
            // CreepJS webDriverIsOn: only touch if webdriver===true
            try {
                if (nav.webdriver === true) {
                    _def(nav, 'webdriver', false);
                }
            } catch (e) {
                try { _def(nav, 'webdriver', false); } catch (e2) {}
            }
            if (ID.vendor) _def(nav, 'vendor', function() { return ID.vendor; });
            if (ID.language) _def(nav, 'language', function() { return ID.language; });
            if (ID.languages) _def(nav, 'languages', function() { return ID.languages; });
            if (ID.userAgent) {
                _def(nav, 'userAgent', function() { return ID.userAgent; });
                _def(nav, 'appVersion', function() { return ID.appVersion || ID.userAgent; });
            }
            _defIfDiff(nav, 'maxTouchPoints', function() { return ID.maxTouchPoints || 0; });
            // doNotTrack: only patch if profile sets a real value AND it differs from native.
            // Default profile uses null → leave native (usually null) → no Prototype lie, matches no DNT header.
            try {
                if (ID.doNotTrack != null && ID.doNotTrack !== undefined) {
                    var _dnt = String(ID.doNotTrack);
                    if (String(nav.doNotTrack) !== _dnt) {
                        _defIfDiff(nav, 'doNotTrack', function () { return _dnt; });
                    }
                }
            } catch (eDnt) {}
            // pdfViewerEnabled only if not already true
            _defIfDiff(nav, 'pdfViewerEnabled', true);
            // [FIX bluetooth-claim-never-fired] [FIX bluetooth-was-removed-not-unavailable]
            // Two tags because there were two defects and test/btreadback.mjs part 1 guards
            // both of them under those names. What stood here was
            //
            //     if (!_STEALTH && ID.hasBluetooth === false) _def(nav,'bluetooth',undefined,false);
            //
            // and it was wrong twice over, in a way where repairing either half alone leaves
            // the extension worse off than leaving both.
            //
            // 1) IT NEVER FIRED. The condition is evaluated ONCE, while this file installs at
            //    document_start, and at that instant `_prof()` is still profile-injector's
            //    FALLBACK SKELETON — its hardcoded laptop_mid defaults, where hasBluetooth is
            //    true. Read by the FIRST inline script in <head>, pc_gaming selected, after a
            //    full browser restart with the profile settled:
            //
            //      cores 12   screen 2560x1440              the machine IS delivered by then
            //      navigator.bluetooth [object Bluetooth]   but nothing was hidden
            //      injector at that moment: detail.profileId undefined, resolved
            //      profileId laptop_mid, resolved bluetooth null, BOOTDEV absent
            //
            //    Every neighbour above is a live getter over ID and self-corrects when the
            //    real profile lands; a boolean CONDITION cannot. Identical shape to
            //    [FIX dpr-was-gated-on-the-boot-profile] in mw/mw-timezone-screen.js, and
            //    the reason the decision below is taken inside the call instead.
            //
            // 2) THE MECHANISM WAS WRONG, so making it fire would only have started shipping
            //    a browser that does not exist. Measured with the branch forced on:
            //
            //      navigator.bluetooth                  undefined
            //      'bluetooth' in Navigator.prototype   true
            //      typeof Bluetooth                     "function"   the constructor STAYS
            //
            //    Web Bluetooth ships with the BROWSER; an adapter comes with the MACHINE.
            //    Deleting the property claims a build without the feature — rarer than a
            //    desktop without the hardware, and contradicted one line later by the global
            //    constructor left standing beside it.
            //
            // A real machine with no adapter says so through getAvailability. Measured on a
            // clean Chromium 151, this rig, over http://127.0.0.1 (trustworthy):
            //
            //   navigator.bluetooth  [object Bluetooth]   getOwnPropertyNames  []
            //   navigator.bluetooth.getAvailability()  ->  true      (this host HAS one)
            //
            // so that is the only thing patched, and only DOWNWARDS: a profile claiming no
            // adapter answers false, a profile claiming one never turns a native false into
            // true — requestDevice would open a chooser that finds nothing and say otherwise.
            //
            // THE RECEIVER RULE IS THE NATIVE'S OWN, because the native is called FIRST and
            // its answer is what gets transformed. Clean, same rig, every receiver through
            // Bluetooth.prototype.getAvailability.call(x):
            //
            //   own, cross-realm iframe             resolve true                    ANSWERS
            //   prototype, Object.create(proto), Proxy(own), {}, null, undefined,
            //   navigator                           REJECTED PROMISE, not a sync throw —
            //       TypeError: Failed to execute 'getAvailability' on 'Bluetooth': Illegal
            //       invocation
            //
            // `.then(onFulfilled)` passes a rejection straight through, so both halves stay
            // the platform's: the refusal AND the cross-realm answer, which isPrototypeOf
            // would have got backwards. No separate oracle probe, deliberately — an oracle is
            // only needed where a check is CONSTRUCTED, and calling this one at install would
            // mint a rejected promise on every page load for nothing.
            //
            // Reached through nav.bluetooth rather than the Bluetooth global, so the
            // [SecureContext] case needs no branch of its own: on a non-trustworthy origin
            // there is no interface at all — measured over http://<name mapped to loopback>,
            // typeof Bluetooth "undefined", navigator.bluetooth undefined, not in
            // Navigator.prototype — nothing to hide and nothing to contradict.
            //
            // Not gated on the mode any more. `!_STEALTH` was there because HIDING cost an
            // extra defineProperty on the navigator instance and stealth installs less; the
            // wrap sits on the prototype now and there is no own property to save. Every
            // other navigator claim (platform, cores, memory, UA) already applies in stealth
            // — `_STEALTH_FEAT.navigator` is true — and `_STEALTH` read at install is false
            // on a tab's FIRST load anyway, so the old gate was a first-load split by
            // construction. `_featNow` is the live reader that folds the mode in, the same
            // one the connection block below moved to for that reason. `_hostHwNow` is here
            // because mw-core lists `bluetooth` in _HW_PROPS and a prototype method does not
            // pass through _def's _sdProp, so the host-mode rule has to be restated at this
            // site. Bluetooth is not exposed to workers, so there is no second scope for a
            // stand-down to stay coherent with.
            //
            // AFTER, same rig, extension loaded, profile written through the service worker
            // and the dyn/ registration awaited — the top window, a 300x200 same-origin
            // iframe and a srcdoc frame, all three:
            //
            //   pc_gaming  ("bluetooth":false)   getAvailability() -> false   clean true
            //   laptop_mid (claims an adapter)   getAvailability() -> true    clean true
            //
            // with all nine receivers, the descriptor, the prototype's own keys, name,
            // length, toString and Object.getOwnPropertyNames(navigator.bluetooth) === []
            // identical to clean in both, no extension frame in any rejection's stack, and
            // 0 console errors. The laptop row is the negative control: without it a wrapper
            // that answers false for everyone reads exactly like this one.
            //
            // And the timing the first defect was about — the FIRST inline script in <head>
            // calling getAvailability() immediately, pc_gaming, on the very first page after
            // a browser restart as well as on a warm one:
            //
            //   clean   resolved true  after 2456ms      the platform asks the OS; it is slow
            //   ours    resolved false after 2147 / 2441 / 1942ms
            //
            // i.e. the claim is in place by the time the answer is produced, which is the
            // whole point of deciding inside the call. The ~2s native latency also swallows
            // the one extra microtask the transform costs, so the derived promise is not a
            // timing tell here the way it would be on a cheap call.
            try {
                var _bt = nav.bluetooth;
                var _btProto = _bt ? Object.getPrototypeOf(_bt) : null;
                var _oga = _btProto ? _btProto.getAvailability : null;
                if (typeof _oga === 'function') {
                    _btProto.getAvailability = _mn(function getAvailability() {
                        var r = _oga.apply(this, arguments);
                        var noAdapter = false;
                        try {
                            noAdapter = ID.hasBluetooth === false &&
                                _featNow('navigator') && !_hostHwNow();
                        } catch (eC) {}
                        // Untouched when the profile has nothing to say: the native promise
                        // is handed back as it came, without even a derived one.
                        if (!noAdapter || !r || typeof r.then !== 'function') return r;
                        return r.then(function () { return false; });
                    });
                }
            } catch (eBt) {}
        } catch(_) {}
    })();

    if (!_FEAT.webgl) { /* webgl skip */ } else
    // ===== WEBGL =====
    (function() {
        try {
            var _DEF_V = 'Google Inc. (Intel)';
            var _DEF_R = 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)';
            function _wgV() {
                try {
                    var p = _prof();
                    if (p && p.webglVendor) return p.webglVendor;
                } catch (e) {}
                return (ID && ID.webglVendor) || _DEF_V;
            }
            function _wgR() {
                try {
                    var p = _prof();
                    if (p && p.webglRenderer) return p.webglRenderer;
                } catch (e) {}
                return (ID && ID.webglRenderer) || _DEF_R;
            }
            // [FIX stealth-webgl-profile] Never force native UNMASKED in stealth —
            // profile vendor/renderer must apply in both modes or real Arc leaks.
            function _nativeUnmaskedOnly() { return false; }
            // [FIX answered-questions-the-real-context-refuses] The table used to be
            // consulted before the driver, so we answered whatever it held — including for
            // enums this context does not have. Measured against a real ANGLE/D3D11 context:
            //   getParameter(0x88FF)  WebGL1 native null (INVALID_ENUM), ours 32768
            //   getParameter(0x84FD)  WebGL1 native null,                ours 16
            //   getParameter(0x8B48)  native null in BOTH versions,      ours 4096
            // Half a dozen entries were WebGL2-only, and querying one of them on a WebGL1
            // context is a single line that no real browser answers. The same held for
            // UNMASKED_VENDOR/RENDERER before WEBGL_debug_renderer_info is enabled: native
            // returns null there, and we returned the profile string to anyone who asked.
            //
            // So the driver is asked first and its refusal is final: we substitute values,
            // never capabilities. This also means a stale or wrong table entry can no longer
            // invent a parameter — the worst it can do is change one the context really has.
            // Strip our own frames from an error the driver raised, so a page that triggers
            // one on purpose gets the engine's error with the engine's caller frames and no
            // mention of this extension. Same idea as _fixToStringStack in mw-core.
            function _wgStrip(err) {
                try {
                    var lines = String(err.stack || '').split('\n');
                    if (lines.length < 2) return err;
                    var kept = [lines[0]];
                    for (var i = 1; i < lines.length; i++) {
                        if (lines[i].indexOf('chrome-extension://') === -1) kept.push(lines[i]);
                    }
                    err.stack = kept.join('\n');
                } catch (e) {}
                return err;
            }
            function _wgParam(p, orig, ctx) {
                if (p === 0x1F00) return 'WebKit';
                if (p === 0x1F01) return 'WebKit WebGL';
                var native;
                // A brand-check failure — getParameter.call({}, …) — natively throws
                // "Illegal invocation". Swallowing it and answering from the table, as this
                // used to, turns a tampering probe into a positive result. Rethrow the real
                // error; only its frames are ours to remove.
                try { native = orig.call(ctx, p); } catch (e0) { throw _wgStrip(e0); }
                if (native === null || native === undefined) return native;
                // One branch for every substitution below it: the UNMASKED pair AND the
                // webglParams table. A worker's OffscreenCanvas answers from the driver,
                // and test/wbcoherence.mjs found this by reading the whole surface rather
                // than the four fields the split was first measured on.
                // [FIX host-mode] And the same branch when the machine IS the host: the
                // driver's own strings and limits, in every scope.
                if (_standDownNow() || _hostHwNow()) return native;
                if (p === 0x9245 || p === 0x9246) {
                    if (_nativeUnmaskedOnly()) return native;
                    return p === 0x9245 ? _wgV() : _wgR();
                }
                try {
                    var params = (_prof() && _prof().webglParams) || (ID && ID.webglParams);
                    if (params && Object.prototype.hasOwnProperty.call(params, p)) return params[p];
                } catch (e) {}
                return native;
            }
            // [FIX getParameter-not-mimicked] Раньше сюда ставили _gp1/_gp2 как
            // голые function-declarations через defineProperty — это давало
            // toString() = реальный исходник функции ("function _gp1(p) {...}")
            // и own-свойства {length,name,arguments,caller,prototype} вместо
            // {length,name}, как у настоящей нативной getParameter. Комментарий
            // "без _mn Proxy" был про apply-семантику this, а не про то, что
            // тут нельзя оборачивать вообще — _mn() как раз и обеспечивает
            // корректный динамический this через Reflect.apply(fn, thisArg, args)
            // в своей apply-ловушке (см. определение _mn выше), так что причина
            // избегать Proxy тут была неверной. Оборачиваем в _mn, сохраняя то
            // же имя 'getParameter', чтобы toString/shape совпадали с нативной.
            var g1 = WebGLRenderingContext.prototype;
            var _ogp = g1.getParameter;
            var _gp1 = _mn(function getParameter(p) {
                // [FIX the-wrappers-forwarded-arguments-the-page-never-passed] no argument must
                // throw "1 argument required", not return null for an undefined enum.
                if (arguments.length < 1) return _ogp.apply(this, arguments);
                return _wgParam(p, _ogp, this);
            });
            try {
                Object.defineProperty(g1, 'getParameter', {
                    value: _gp1, writable: true, configurable: true, enumerable: true
                });
            } catch (e) {
                g1.getParameter = _gp1;
            }
            _markStatus('webgl');
            if (typeof WebGL2RenderingContext !== 'undefined') {
                var g2 = WebGL2RenderingContext.prototype;
                var _ogp2 = g2.getParameter;
                var _gp2 = _mn(function getParameter(p) {
                    if (arguments.length < 1) return _ogp2.apply(this, arguments);
                    return _wgParam(p, _ogp2, this);
                });
                try {
                    Object.defineProperty(g2, 'getParameter', {
                        value: _gp2, writable: true, configurable: true, enumerable: true
                    });
                } catch (e2) {
                    g2.getParameter = _gp2;
                }
            }

            // Instance-level wrap: Chrome иногда отдаёт getParameter с контекста,
            // а prototype-override игнорируется. Патчим каждый GL-context при создании.
            function _wrapGLContext(ctx) {
                if (!ctx || _glWrapped.has(ctx)) return ctx;
                try {
                    // Берём нативный getParameter с прототипа до нашей обёртки
                    var proto = Object.getPrototypeOf(ctx);
                    var nativeGp = null;
                    try {
                        var d = Object.getOwnPropertyDescriptor(proto, 'getParameter');
                        // если уже наш патч — ищем глубже
                        nativeGp = _ogp || (d && d.value);
                    } catch (e) {}
                    if (!nativeGp) nativeGp = proto.getParameter;
                    // для WebGL2
                    if (typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext) {
                        nativeGp = _ogp2 || nativeGp;
                    }
                    var orig = function(p) { return Function.prototype.call.call(nativeGp, ctx, p); };
                    // [FIX getParameter-not-mimicked] Тот же баг, что и в
                    // prototype-патче выше: инлайновая function-expression
                    // ставилась прямая, без _mn, — та же утечка toString/shape.
                    Object.defineProperty(ctx, 'getParameter', {
                        value: _mn(function getParameter(p) {
                            return _wgParam(p, function(pp) { return orig(pp); }, ctx);
                        }),
                        writable: true,
                        configurable: true,
                        enumerable: true
                    });
                    _glWrapped.add(ctx);
                } catch (e) {}
                return ctx;
            }
            // [FIX double-getcontext-patch] Раньше здесь стоял _hookGetContext,
            // патчивший HTMLCanvasElement.prototype.getContext и
            // OffscreenCanvas.prototype.getContext голой function-expression
            // (без _mn — та же toString/shape утечка, от которой уходит весь
            // остальной файл). CANVAS-секция ниже перезаписывает ОБА этих
            // getContext ещё раз, уже правильно через _mn, и уже вызывает
            // window.__g0 сама — так что голый слой был чистым write-
            // then-immediately-overwrite: рабочим случайно (порядком секций),
            // но хрупким (переставь секции местами или убери CANVAS-патч —
            // и голая, детектируемая через toString версия останется
            // финальной). Убрано: экспортируется напрямую, CANVAS-секция вызывает
            // его сама после установки своего _mn-патча на getContext.
            // [FIX g0-deleted-before-it-was-ever-called] This used to be published as
            // window.__g0 (non-enumerable, but still a global). mw-cleanup.js listed
            // '__g0' among the keys it deletes, and mw-canvas-audio.js only ever looked
            // it up at getContext time — always after cleanup had run — so the lookup
            // failed on every call and the per-context wrap never executed. It travels on
            // __AFP_MW__ now, the channel every other cross-module value already uses:
            // mw-canvas-audio.js reads it at load (it is ordered after this file and
            // before mw-cleanup.js) and keeps it in a closure, so nothing has to survive
            // cleanup and the page never sees a global at all.
            try { if (MW) MW.wrapGL = _wrapGLContext; } catch (eExp) {}
        } catch(_) {}
    })();

    // [FIX ungated-patch] Раньше секция управлялась только скрытым режимом (или
    // вообще ничем), из-за чего снятие галок в настройках её не отключало.
    if (!_FEAT.navigator) { /* disabled in options */ } else
    // ===== CLIENT HINTS =====
    // [FIX platform-version-pinned-to-windows-10] This used to read "UA string = NT 10.0 →
    // platformVersion must be 10.0.0". Chrome on Windows 11 sends NT 10.0 in the UA string
    // too — it never writes NT 11.0 — so the rule did not follow, and pinning 10.0.0 on a
    // Windows 11 host contradicted the machine's own fonts. background.js now derives the
    // family from the host and puts it in the profile; every site here reads it from there,
    // so the window, the worker and the sec-ch-ua-platform-version header cannot drift
    // apart. See the long note in background.js for the measurements.
    (function() {
        try {
            if (!navigator.userAgentData) return;
            function _ch() {
                var c = (_prof() && _prof().clientHints) || (ID && ID.clientHints);
                // Used only when there is no profile at all — the last-resort shape, not a
                // pin. Windows 10 is the safe floor here: claiming 11 without a profile
                // would assert a family we have not been told anything about.
                return c || {
                    platform: 'Windows', mobile: false, platformVersion: '10.0.0', // fallback only
                    architecture: 'x86', bitness: '64', wow64: false, model: '',
                    formFactors: ['Desktop']
                };
            }
            // [FIX brands-not-available] FP.com → browser_details Chromium / N/A
            // when brands/fullVersionList are missing, non-plain, or stripped by Proxy.
            // Always return plain {brand,version}[] with Google Chrome + Chromium + GREASE.
            function _chromeMajor() {
                try {
                    var m = String((_prof() && _prof().userAgent) || navigator.userAgent || '')
                        .match(/Chrome\/(\d+)/);
                    if (m) return m[1];
                } catch (e) {}
                return '151';
            }
            function _plainBrands(src) {
                var out = [];
                if (!src || !src.length) return out;
                for (var i = 0; i < src.length; i++) {
                    try {
                        var b = src[i];
                        var brand = String((b && (b.brand || b.Brand)) || '');
                        var ver = String((b && (b.version || b.Version)) || '');
                        if (brand) out.push({ brand: brand, version: ver });
                    } catch (e1) {}
                }
                return out;
            }
            function _ensureChromeBrands(brands, major) {
                var list = _plainBrands(brands);
                // [FIX ua-ch-brand-added-to-three-sources-of-four] Nothing is INVENTED here
                // any more — no fabricated list when the browser has none, and no brand
                // appended when one is missing. Both did fire: on a Chromium build this
                // function added a "Google Chrome" brand that the browser does not have.
                //
                // The DNR rule set `sec-ch-ua` to a literal carrying the same brand, and
                // _ensureFullVersionList did it again for fullVersionList — but the
                // `sec-ch-ua-full-version-list` HEADER was deliberately left native. So
                // three of the four places a server can look claimed Google Chrome and the
                // fourth did not. Measured, same page, Accept-CH requested:
                //
                //   WITHOUT ext: header/JS brands/JS fvl all "Chromium only"  -> consistent
                //   WITH ext:    only the full-version-list header lacked the brand
                //
                // A real Fingerprint Pro event from a Chromium browser shows the matching
                // shape: browser_name "Chromium-Based Browser", version "Not Available".
                // On real Chrome the brand is native everywhere, so this is a no-op there —
                // which is why the mismatch went unnoticed.
                //
                // Passing the brands through cannot desync, and it also removes a latent
                // failure: the old code pinned the brand set at a moment Chrome is free to
                // change (GREASE order and the Not=A?Brand entry both have).
                if (!list.length) return list;
                // Version normalisation stays: the short brands list carries MAJORS, and
                // `major` is read from the browser's own UA, so on any real browser this
                // rewrites a value to itself.
                for (var j = 0; j < list.length; j++) {
                    var bn = list[j].brand.toLowerCase();
                    if (bn.indexOf('google chrome') !== -1 || bn === 'chromium') {
                        list[j].version = String(major);
                    }
                }
                return list;
            }
            function _ensureFullVersionList(fvl, major, uaFull) {
                var list = _plainBrands(fvl);
                var full = uaFull || (major + '.0.0.0');
                // [FIX ua-ch-brand-added-to-three-sources-of-four] This used to "always ship
                // GREASE + Google Chrome + Chromium", to stop FP.com reporting Chromium /
                // N/A from a partial fullVersionList. That reasoning was right about the
                // symptom and wrong about the cure: the JS half was corrected and the
                // `sec-ch-ua-full-version-list` HEADER was left native, so the two disagreed
                // and the mismatch is itself what a server reads as tampering. See the long
                // note in _ensureChromeBrands. Pass through instead — on real Chrome the
                // brands are already there and this was always a no-op.
                // Only normalisation is left: a brand carrying just the major gets the full
                // build. On a browser that already reports full versions this rewrites each
                // value to itself.
                for (var i = 0; i < list.length; i++) {
                    var n = (list[i].brand || '').toLowerCase();
                    if (n.indexOf('google chrome') !== -1 || n === 'chromium') {
                        if (!list[i].version || list[i].version === major) list[i].version = full;
                    }
                }
                return list;
            }
            // The high-entropy hint names, used ONLY on the fallback path in _forceUAD
            // where there is no native answer to mirror. Everywhere else the browser's own
            // key set decides, precisely so this list cannot go stale on a new hint.
            var _UAD_HIGH = ['architecture', 'bitness', 'formFactors', 'fullVersionList',
                'model', 'platformVersion', 'uaFullVersion', 'wow64'];
            function _forceUAD(r, hints) {
                var c = _ch();
                var list = hints || [];
                var src = r || {};
                var major = _chromeMajor();
                var brands = _ensureChromeBrands(src.brands, major);
                try {
                    if ((!brands || !brands.length) && navigator.userAgentData && navigator.userAgentData.brands) {
                        brands = _ensureChromeBrands(navigator.userAgentData.brands, major);
                    }
                } catch (eB) {}
                var uaFull = src.uaFullVersion || null;
                try {
                    if (!uaFull && src.fullVersionList && src.fullVersionList.length) {
                        for (var i = 0; i < src.fullVersionList.length; i++) {
                            var bb = src.fullVersionList[i];
                            if (bb && /chrome/i.test(String(bb.brand || ''))) {
                                uaFull = String(bb.version || '');
                                break;
                            }
                        }
                    }
                } catch (eF) {}
                if (!uaFull) uaFull = major + '.0.0.0';
                // Our VALUES, keyed by hint name. Which of these keys actually ships is
                // decided below, and that decision is NOT ours to make.
                var val = {
                    brands: brands,
                    fullVersionList: _ensureFullVersionList(src.fullVersionList, major, uaFull),
                    uaFullVersion: uaFull,
                    platform: c.platform || 'Windows',
                    platformVersion: c.platformVersion || '10.0.0',
                    architecture: c.architecture || 'x86',
                    bitness: c.bitness || '64',
                    wow64: c.wow64 !== undefined ? !!c.wow64 : false,
                    model: c.model || '',
                    mobile: false
                };
                if (c.formFactors) val.formFactors = c.formFactors;
                // [FIX host-mode] The OS build is the machine's: the exact native value
                // instead of the Win11 bucket, in step with the header, which the
                // hardware-hint strip leaves alone in this mode (afpSyncHwRuleset).
                if (_hostHwNow()) delete val.platformVersion;
                // [FIX uad-answered-hints-nobody-asked-for] The key SET is the browser's.
                //
                // This used to build every field and then delete exactly two of them
                // (uaFullVersion, fullVersionList) when unrequested — so architecture,
                // bitness, model, platformVersion, wow64 and formFactors came back on EVERY
                // call, including `getHighEntropyValues([])`. Real Chrome resolves with the
                // low-entropy trio plus ONLY the hints asked for. Measured on this machine,
                // clean Chromium against this build, same rig, same page:
                //
                //   getHighEntropyValues([])                clean 3 keys   ours 11
                //   getHighEntropyValues(['platform'])      clean 3 keys   ours  9
                //   getHighEntropyValues(['architecture'])  clean 4 keys   ours  9
                //
                // A caller gets back a key it never named — no statistics needed, one call
                // and the answer has a shape no browser produces. Same class as
                // [FIX invented-chrome-runtime] and the own-property half of
                // [FIX uad-shape-not-just-values], which fixed the ORDER of these keys and
                // left their number alone.
                //
                // The native call already applied the spec's hint filtering, so its own key
                // set IS the correct answer for this Chrome and these hints — including
                // hints added to the platform after this file was written, which a
                // hand-maintained list here would go stale on. We substitute values into
                // that set and add nothing to it. Native order is kept for the same reason:
                // it is what a real browser emits (measured alphabetical, but not assumed).
                var keys = Object.keys(src);
                if (!keys.length) {
                    // Only when the native call gave us nothing to mirror — then fall back
                    // to the spec's own rule, sorted, which is what Chrome emits.
                    keys = ['brands', 'mobile', 'platform'];
                    for (var hi = 0; hi < list.length; hi++) {
                        if (_UAD_HIGH.indexOf(list[hi]) !== -1 && keys.indexOf(list[hi]) === -1) keys.push(list[hi]);
                    }
                    keys.sort();
                }
                var ordered = {};
                keys.forEach(function (k) {
                    ordered[k] = Object.prototype.hasOwnProperty.call(val, k) ? val[k] : src[k];
                });
                return ordered;
            }
            // The native `brands` getter, captured before we replace it — the per-instance
            // snapshot must read the REAL list, and after the prototype patch the plain
            // property read would return our own synthesised one.
            var _uadNativeBrands = null;
            var _uadProtoDone = {};
            // [FIX accessors-answered-every-receiver] name -> the native getter we replaced,
            // kept as the RECEIVER ORACLE. brands/mobile/platform had no receiver check at
            // all, so they answered off anything. Measured, clean Chromium 151 against this
            // build:
            //   NavigatorUAData.platform.call(NavigatorUAData.prototype) clean THREW TypeError
            //   NavigatorUAData.platform.call(navigator)                 clean THREW TypeError
            // and ours returned "Windows" for both — a value where the platform refuses to
            // give one, which is one line to check and needs no statistics.
            //
            // No brand list can express the rule the platform actually follows, which is why
            // the oracle is the native getter and not `isPrototypeOf`: clean ANSWERS for a
            // CROSS-REALM NavigatorUAData (measured, `.call(otherRealmUad)` -> "Windows")
            // although instanceof and isPrototypeOf are both false there. So we hand the
            // receiver to the getter we took out: it throws for exactly the receivers it
            // refuses, and where it answers we return the profile — every realm this
            // extension patches claims the SAME profile, so that realm's own accessor would
            // give the same string, and returning the native value there is what would leak
            // the host.
            var _uadNative = {};
            // Membership, not identity, and the difference is load-bearing: measured in
            // headless Chromium 151 with nothing patched,
            //   navigator.userAgentData === navigator.userAgentData   ->  false
            // so `this === <the uad we patched>` would MISS on every ordinary read and put
            // the hot path through a native call. A WeakSet does not: the wrapped
            // `userAgentData` getter runs _patchUAD on whatever object it hands back, so a
            // freshly built instance is already in the set by the time its accessor runs.
            // Measured with a counter in the oracle: 5 reads each of platform/mobile/brands
            // -> 0 native calls, one foreign receiver -> exactly 1.
            var _uadOurs = new WeakSet();
            function _uadRecv(recv, name) {
                if (_uadOurs.has(recv)) return;
                var nat = _uadNative[name];
                // Nothing to ask means no oracle. Answer for every receiver rather than
                // invent a refusal this browser does not have.
                if (!nat) return;
                return nat.call(recv);
            }
            /**
             * Replace an accessor on NavigatorUAData.prototype, once, keeping the native
             * descriptor's flags. Nothing is written to the instance — that is the whole
             * point, see [FIX uad-own-property-lie].
             */
            function _defUadProto(uad, name, getter) {
                try {
                    if (_uadProtoDone[name]) return;
                    var proto = Object.getPrototypeOf(uad);
                    if (!proto) return;
                    var d = Object.getOwnPropertyDescriptor(proto, name);
                    if (!d || typeof d.get !== 'function') return;
                    if (name === 'brands' && !_uadNativeBrands) _uadNativeBrands = d.get;
                    if (!_uadNative[name]) _uadNative[name] = d.get;
                    Object.defineProperty(proto, name, {
                        get: _mn(getter, true),
                        set: d.set,
                        enumerable: d.enumerable,
                        configurable: d.configurable
                    });
                    _uadProtoDone[name] = true;
                } catch (e) {}
            }

            function _patchUAD(uad) {
                if (!uad) return uad;
                // [FIX accessors-answered-every-receiver] The oracle's fast path: every
                // NavigatorUAData that leaves the patched `userAgentData` getter passes
                // through here, so this is the set of instances our accessors may answer
                // for without asking the native one first.
                try { _uadOurs.add(uad); } catch (eOwn) {}
                // Re-entry safe: GHEV wrapper guarded by _ghevPatched (WeakSet), not an own marker.
                try {
                    // Снимок берём РОВНО ОДИН РАЗ и только с нативного brands: на
                    // повторном заходе uad.brands — уже наш геттер, и раньше в
                    // снимок попадал наш же синтезированный список вместо исходного.
                    // [FIX uad-own-property-lie] brands / mobile / platform used to be
                    // defined on the INSTANCE. A real NavigatorUAData has NO own properties
                    // at all — all three are accessors on the prototype — so
                    // `Object.getOwnPropertyNames(navigator.userAgentData)` answered
                    // `brands,mobile,platform` for us and `` for every real browser. One
                    // line to check, and exactly the own-property lie this file removes
                    // everywhere else (see the RTCPeerConnection and navigator.keyboard
                    // notes). It also survives stealth, where `navigator` stays on.
                    //
                    // Patched on the prototype instead, reusing the native descriptor's
                    // enumerable/configurable so the shape is unchanged, and keyed off
                    // `this` so a second NavigatorUAData would still get its own snapshot.
                    if (!_uadBrands.has(uad)) {
                        try {
                            var _nb = _uadNativeBrands ? _uadNativeBrands.call(uad) : uad.brands;
                            if (_nb && _nb.length) _uadBrands.set(uad, _plainBrands(_nb));
                        } catch (eSnap) {}
                    }
                    // _uadRecv first in each: the identity test is what keeps the ordinary
                    // read off the native path, and a refused receiver must be refused
                    // before we build an answer for it.
                    _defUadProto(uad, 'platform', function platform() {
                        _uadRecv(this, 'platform');
                        return 'Windows';
                    });
                    _defUadProto(uad, 'mobile', function mobile() {
                        _uadRecv(this, 'mobile');
                        return false;
                    });
                    _defUadProto(uad, 'brands', function brands() {
                        // The oracle's answer is not discarded here: a VALID but foreign
                        // NavigatorUAData has no snapshot in _uadBrands, and its own realm
                        // runs its native list through this same normaliser — so using it
                        // reproduces what that realm answers instead of the empty list
                        // _plainBrands(undefined) used to give.
                        var nat = _uadRecv(this, 'brands');
                        return _ensureChromeBrands(_uadBrands.get(this) || nat, _chromeMajor());
                    });
                } catch (e) {}
                // [FIX ghev-was-an-own-property-in-every-frame] getHighEntropyValues is
                // patched on the PROTOTYPE of whatever realm this uad belongs to, which
                // covers both call shapes at once — a plain `uad.getHighEntropyValues(...)`
                // resolves through it, and so does the
                // `NavigatorUAData.prototype.getHighEntropyValues.call(uad)` bypass that
                // CreepJS and FP use to step around an instance-level defineProperty.
                //
                // It used to be patched on the INSTANCE instead, and a real NavigatorUAData
                // has no own properties at all. In the TOP window that never showed, because
                // the prototype was patched a few lines after this function's first call. A
                // FRAME never got that far: the parent-side _patchFrameAll calls _patchUAD on
                // the child's uad while the child's prototype is untouched, so the instance
                // branch fired and left the own property behind. Measured by
                // tools/probe-scopes.mjs on the frame axis: `iframe / userAgentData own ->
                // getHighEntropyValues`, present in a same-origin iframe, absent in its
                // parent, absent everywhere clean — the same own-property lie
                // [FIX uad-own-property-lie] removed for brands/mobile/platform and
                // [FIX worker-uad-own-props-outlived-the-window-fix] removed in workers.
                //
                // [CLEANUP] The instance branch that followed this one is GONE, and so are
                // the two blocks after _patchUAD(navigator.userAgentData) that re-wrapped
                // getHighEntropyValues on Object.getPrototypeOf(navigator.userAgentData) and
                // on NavigatorUAData.prototype. All three were kept as belt-and-braces for
                // call shapes this block already covers, and all three were dead: the
                // prototype patch below runs first and puts its wrapper in _ghevPatched, so
                // every one of their guards is false by the time it is reached. Measured by
                // instrumenting the bundle and loading it — top window, same-origin iframe
                // and srcdoc frame each recorded ONLY this block:
                //   TOP    ["A:proto-inside-patchUAD"]
                //   PLAIN  ["A:proto-inside-patchUAD","A:proto-inside-patchUAD"]
                //   SRCDOC ["A:proto-inside-patchUAD","A:proto-inside-patchUAD"]
                try {
                    var _pp = Object.getPrototypeOf(uad);
                    if (_pp && typeof _pp.getHighEntropyValues === 'function' &&
                        !_ghevPatched.has(_pp.getHighEntropyValues)) {
                        var _po = _pp.getHighEntropyValues;
                        var _pw = _mn(function getHighEntropyValues(hints) {
                            var list = hints || [];
                            return _po.apply(this, arguments).then(function (r) { return _forceUAD(r, list); });
                        });
                        _ghevPatched.add(_pw);
                        try {
                            Object.defineProperty(_pp, 'getHighEntropyValues', {
                                value: _pw, configurable: true, writable: true
                            });
                        } catch (ePp) { try { _pp.getHighEntropyValues = _pw; } catch (ePp2) {} }
                    }
                } catch (ePr) {}
                // [CLEANUP] uad.__afpUAD = true убрано: значение только записывалось и
                // нигде не читалось (последний читатель исчез вместе с прежней логикой
                // "skip re-wrap"), но при этом создавало перечислимое own-свойство с
                // "afp" в имени прямо на navigator.userAgentData.
                return uad;
            }
            _patchUAD(navigator.userAgentData);
            // [CLEANUP] Two blocks stood here: one re-read
            // Object.getPrototypeOf(navigator.userAgentData) and wrapped
            // getHighEntropyValues again, the other did the same for
            // NavigatorUAData.prototype "if different from instance proto". Both were for
            // the `NavigatorUAData.prototype.getHighEntropyValues.call(uad, hints)` shape
            // that bypasses an instance-level defineProperty — and _patchUAD has patched the
            // prototype itself since v2.5.8, so that shape and `uad.ghev(...)` are both
            // covered there, for whatever realm the uad belongs to. Their guards read
            // _ghevPatched, which the surviving block fills, so neither could ever run;
            // see the measurement in _patchUAD.
            // Navigator.userAgentData getter — re-patch if browser recreates object
            try {
                var _navProto = Object.getPrototypeOf(navigator);
                var _uadDesc = Object.getOwnPropertyDescriptor(_navProto, 'userAgentData') ||
                    Object.getOwnPropertyDescriptor(navigator, 'userAgentData');
                if (_uadDesc && _uadDesc.get) {
                    var _origUADGet = _uadDesc.get;
                    // [FIX undefined-properties-lie] Раньше геттер ставился на САМ
                    // navigator, из-за чего у инстанса появлялось own-свойство
                    // userAgentData. Это ровно то, что проверяет CreepJS
                    // «failed undefined properties»: для screen/navigator он берёт
                    // Object.getOwnPropertyDescriptor(navigator, name) и считает
                    // ложью сам факт его существования — у чистого браузера такие
                    // свойства живут ТОЛЬКО на Navigator.prototype. Именно поэтому
                    // Navigator.userAgentData был единственным в отчёте с этой
                    // пометкой, а deviceMemory/language/languages — нет: их ставит
                    // _def, который для navigator/screen сам переносит на прототип.
                    // Здесь тот же перенос делается явно.
                    var _uadTarget = (typeof Navigator !== 'undefined' && _navProto === Navigator.prototype)
                        ? Navigator.prototype : _navProto;
                    try {
                        var _ownUad = Object.getOwnPropertyDescriptor(navigator, 'userAgentData');
                        if (_ownUad && _ownUad.configurable) delete navigator.userAgentData;
                    } catch (eDelUad) {}
                    Object.defineProperty(_uadTarget, 'userAgentData', {
                        // isAccessor=true: иначе toString отдавал
                        // "function userAgentData()" вместо нативной accessor-формы
                        // "function get userAgentData()" — замер поймал это как
                        // единственное расхождение по данному геттеру.
                        get: _mn(function userAgentData() {
                            return _patchUAD(_origUADGet.call(this));
                        }, true),
                        configurable: true,
                        enumerable: _uadDesc.enumerable
                    });
                }
            } catch (e7) {}
        } catch (_) {}
    })();

    // [FIX iframe-full-parity] Parent aligns same-origin iframe.contentWindow with
    // the live profile (hc/mem/lang/screen/TZ + UAD). all_frames inject is primary;
    // this is the safety net for about:blank / late iframe / inject races.
    // Do NOT redefine HTMLIFrameElement.contentWindow (CreepJS contentWindow lies).
    (function() {
        try {
            var _iframeElsHooked = new WeakSet();
            // Same value the CLIENT HINTS block above serves, read the same way — this IIFE
            // has its own scope, so it cannot borrow that block's _ch().
            function _framePv() {
                try {
                    var c = (_prof() && _prof().clientHints) || (ID && ID.clientHints);
                    if (c && c.platformVersion) return c.platformVersion;
                } catch (e) {}
                return '10.0.0';
            }
            function _forcePvResult(r) {
                if (!r || typeof r !== 'object') return r;
                // [FIX host-mode] The frame reports the same native build the window does.
                if (_hostHwNow()) return r;
                try {
                    var o = {};
                    for (var k in r) {
                        try { o[k] = r[k]; } catch (e) {}
                    }
                    o.platformVersion = _framePv();
                    o.platform = o.platform || 'Windows';
                    o.mobile = false;
                    return o;
                } catch (e2) {
                    try { r.platformVersion = _framePv(); } catch (e3) {}
                    return r;
                }
            }
            function _pv(key, fallback) {
                try {
                    var v = ID[key];
                    if (v !== undefined && v !== null) return v;
                } catch (e) {}
                return fallback;
            }
            // [CLEANUP] _same lived here — the "native already matches, do not patch"
            // comparison. It went dead when frame patching switched to installing live
            // getters unconditionally, for the reason stated just below; nothing called
            // it afterwards.
            // Always install live getters (read ID on each access). Skipping when
            // early native === early profile left frames stuck after injectProfile.
            // [FIX frame-getters-unmasked] The getter went in bare, so in every patched
            // frame Object.getOwnPropertyDescriptor(frame.navigator,'platform').get
            // stringified to OUR source instead of
            // 'function get platform() { [native code] }', and its .name was '' rather
            // than the property name. Reading a frame's descriptors costs a detector one
            // line, and the top window has been masking these all along — the frames were
            // the soft spot. The computed key is what gives the function its name, which
            // is what _mn builds the native-looking toString from.
            // [FIX frame-getters-landed-on-the-instance] These went onto the frame's
            // navigator/screen OBJECT, so every same-origin iframe ended up with own
            // properties that no real one has. Measured against stock Chromium with no
            // extensions (dev-ownprops.html):
            //   native fresh iframe : navigator own []          screen own []
            //   ours                : navigator own [platform, hardwareConcurrency,
            //                         deviceMemory, language, languages, webdriver,
            //                         maxTouchPoints, userAgent, appVersion]
            //                         screen own [width, height, availWidth, availHeight,
            //                         colorDepth, pixelDepth]
            // Fifteen own-property lies per frame — and the TOP window has none, because
            // _def() has re-targeted navigator/screen onto their prototypes since
            // [FIX privacy-possum-pattern] / [FIX undefined-properties-lie]. So the one
            // realm CreepJS compares against by design was the one giving it away.
            // Same treatment here: define on the frame's interface prototype, drop any own
            // copy an earlier pass left behind, and brand the getter so reading it off the
            // prototype throws Illegal invocation the way a native accessor does.
            // proto is omitted for genuinely own window properties — devicePixelRatio is
            // an own property of window in Chrome (verified: own true, on prototype false).
            function _defWinProp(obj, prop, getVal, proto) {
                if (!obj) return;
                // [FIX the-stand-down-stopped-at-the-window] Leave the frame's own value
                // alone for anything a worker can also read. Not a blanket bail out of this
                // function: screen, maxTouchPoints and webdriver have no worker-side reader,
                // are not stood down in the window either, and skipping them would trade a
                // cross-scope split for a cross-frame one on the screen instead.
                // [FIX the-frame-was-patched-before-the-flag] Decided at READ time, not at
                // patch time. This used to return here — leave the frame native — when the
                // parent stood down at the moment it BUILT the frame, and patch it with the
                // profile otherwise. On the learning visit of a blob-refusing route the flag
                // lands between the two: the parent built its frame on the profile, then
                // froze its own answer on the machine at DOMContentLoaded — a window at 18
                // cores beside its frame at 8 (measured, test/wbcoherence.mjs /wb/ visit 1).
                // The accessor is defined either way and asks the parent's predicate on every
                // read, answering the frame's ORIGINAL accessor wherever the parent stands
                // down for this property — the same shape _def gives the window itself.
                try {
                    var target = proto || obj;
                    var orig = Object.getOwnPropertyDescriptor(target, prop);
                    // [FIX the-frame-path-kept-the-brand-check] This was
                    // `brand.isPrototypeOf(Object(this))`, the rule v2.5.11 replaced
                    // everywhere else and did not reach here — the parent-side frame patch is
                    // its own path past _def, which is exactly why the sweep in
                    // test/receivers.mjs could not see it.
                    //
                    // isPrototypeOf is FALSE across realms while the native accessor ANSWERS
                    // there, so the frame's patched getter refused a receiver the platform
                    // accepts. Measured, and it is a two-line detector rather than a leak:
                    //
                    //   const f = <same-origin sandbox iframe, no allow-scripts>;
                    //   Object.getOwnPropertyDescriptor(f.contentWindow.Navigator.prototype,
                    //     'hardwareConcurrency').get.call(navigator);
                    //
                    //   clean browser   18
                    //   ours            TypeError: Illegal invocation
                    //
                    // A page learns nothing about the machine and everything about us. The
                    // native descriptor captured a line above is the oracle: it throws for
                    // exactly the receivers the platform throws for, and answers for the ones
                    // it accepts — including a cross-realm instance.
                    var ownInst = obj;
                    var oracle = null;
                    if (orig && typeof orig.get === 'function') {
                        // Probed once, the way mw-core's _origOracle does: a getter that
                        // answers for a bare object is a shim rather than the platform, and
                        // trusting it would install a check that never refuses anything.
                        try { orig.get.call({}); } catch (eProbe) { oracle = orig.get; }
                    }
                    var g = ({ [prop]: function () {
                        if (this !== ownInst && oracle) oracle.call(this);
                        if (_sdProp(prop)) {
                            if (orig && orig.get) return orig.get.call(this);
                            return orig ? orig.value : undefined;
                        }
                        return getVal();
                    } })[prop];
                    if (target !== obj) {
                        try {
                            if (Object.getOwnPropertyDescriptor(obj, prop)) delete obj[prop];
                        } catch (eDel) {}
                    }
                    Object.defineProperty(target, prop, {
                        get: _mn(g, true),
                        configurable: true,
                        enumerable: orig ? !!orig.enumerable : true
                    });
                } catch (e2) {}
            }
            function _patchFrameNavScreen(win) {
                try {
                    var nav = win.navigator;
                    // The frame's OWN interface prototypes — not this window's. Defining
                    // on our Navigator.prototype would patch the wrong realm entirely.
                    var navProto = null, scrProto = null;
                    try { navProto = win.Navigator && win.Navigator.prototype; } catch (eNp) {}
                    try { scrProto = win.Screen && win.Screen.prototype; } catch (eSp) {}
                    if (nav && _FEAT.navigator !== false) {
                        _defWinProp(nav, 'platform', function () { return _pv('platform', 'Win32'); }, navProto);
                        _defWinProp(nav, 'hardwareConcurrency', function () { return _pv('hwConcurrency', 8); }, navProto);
                        _defWinProp(nav, 'deviceMemory', function () { return _pv('deviceMemory', 8); }, navProto);
                        // [FIX cpu-performance-tier-was-the-host-machine] The frame gets
                        // the tier from the same MW.cpuTier and the same two profile
                        // fields as the top window two hundred lines up, so a page cannot
                        // read one machine in the document and another in its iframe —
                        // the split this whole function exists to close. `in` on the
                        // FRAME's own Navigator.prototype, because a frame can be a
                        // realm the property does not exist in at all.
                        try {
                            if (navProto && 'cpuPerformance' in navProto) {
                                _defWinProp(nav, 'cpuPerformance', function () {
                                    return _cpuTier(_pv('hwConcurrency', 8), _pv('deviceMemory', 8));
                                }, navProto);
                            }
                        } catch (eFCpu) {}
                        _defWinProp(nav, 'language', function () { return _pv('language', 'en-US'); }, navProto);
                        _defWinProp(nav, 'languages', function () {
                            var L = _pv('languages', ['en-US', 'en']);
                            return Array.isArray(L) ? L.slice() : L;
                        }, navProto);
                        // Always force false — WorkerNavigator/iframe often has undefined, not true.
                        // Detectors compare main false vs iframe undefined/18 cores.
                        try {
                            _defWinProp(nav, 'webdriver', function () { return false; }, navProto);
                        } catch (eWd) {}
                        try {
                            _defWinProp(nav, 'maxTouchPoints', function () {
                                var m = _pv('maxTouchPoints', 0);
                                return (typeof m === 'number') ? m : 0;
                            }, navProto);
                        } catch (eMt) {}
                        var ua = _pv('userAgent', null);
                        if (ua) {
                            _defWinProp(nav, 'userAgent', function () { return _pv('userAgent', ua); }, navProto);
                            _defWinProp(nav, 'appVersion', function () {
                                return _pv('appVersion', _pv('userAgent', ua));
                            }, navProto);
                        }
                    }
                    if (_FEAT.screen !== false) {
                        var scr = win.screen;
                        if (scr) {
                            _defWinProp(scr, 'width', function () { return _pv('screenWidth', 1920); }, scrProto);
                            _defWinProp(scr, 'height', function () { return _pv('screenHeight', 1080); }, scrProto);
                            _defWinProp(scr, 'availWidth', function () { return _pv('screenWidth', 1920); }, scrProto);
                            _defWinProp(scr, 'availHeight', function () {
                                var h = _pv('screenHeight', 1080);
                                return Math.round(h * 0.963 / 8) * 8;
                            }, scrProto);
                            // 24 — see [FIX color-depth-was-a-value-chrome-never-reports].
                            _defWinProp(scr, 'colorDepth', function () { return _pv('colorDepth', 24); }, scrProto);
                            _defWinProp(scr, 'pixelDepth', function () { return _pv('colorDepth', 24); }, scrProto);
                        }
                        try {
                            _defWinProp(win, 'devicePixelRatio', function () {
                                return _pv('devicePixelRatio', 1);
                            });
                        } catch (eDpr) {}
                    }
                    // [FIX the-stand-down-stopped-at-the-window] The zone and the locale
                    // are patched into the frame here rather than through _defWinProp, so
                    // the property-level skip above does not reach them — and they were
                    // three of the seven signals still disagreeing between the window and a
                    // same-origin iframe on youtube.com after the window learned to yield.
                    // The frame's OWN mw-timezone-screen already stands itself down through
                    // _getTimezone; all this has to do is stop overwriting that with the
                    // profile again.
                    if (_FEAT.timezone !== false && !_standDownNow()) {
                        try {
                            // [FIX frame-zone-label-table] This was an eight-entry map that
                            // returned the SUMMER label unconditionally and fell back to a
                            // bare city name ("Tallinn") for the other ~65 zones the
                            // country picker offers. So a same-origin frame reported
                            // "Eastern European Summer Time" in January while the top
                            // window reported "Eastern European Standard Time" for the
                            // same instant, and any zone outside the eight got a label no
                            // browser has ever printed. Both are one comparison away from
                            // being spotted, and CreepJS compares a frame against the top
                            // window by design.
                            // MW.zoneNameFor is the same per-date lookup the top window and
                            // the worker use, over the same ZONE_DATA table
                            // (mw/mw-timezone-screen.js, which loads before this file).
                            // [FIX frame-zone-name-was-english] zoneNameFor returns the
                            // ENGLISH table entry, which is what Date.prototype.toString
                            // needs and exactly what an Intl result must not contain: the
                            // frame printed "Eastern European Summer Time" inside an et-EE
                            // format while the top window printed "Ida-Euroopa suveaeg" —
                            // one value, two answers, and browserleaks.com/javascript shows
                            // the window and the frame side by side. The localised variant
                            // takes the formatter's own locale and style.
                            var _zoneLabel = function (when, locale, style) {
                                var tz = String(_pv('timezone', ''));
                                if (!tz) return '';
                                try {
                                    if (MW && typeof MW.zoneNameLocalized === 'function') {
                                        return MW.zoneNameLocalized(locale, style, when) || '';
                                    }
                                    if (MW && typeof MW.zoneNameFor === 'function') {
                                        return MW.zoneNameFor(tz, when) || '';
                                    }
                                } catch (eZl) {}
                                return '';
                            };
                            var IntlObj = win.Intl;
                            if (IntlObj && IntlObj.DateTimeFormat) {
                                var OrigDTF = IntlObj.DateTimeFormat;
                                var proto = OrigDTF.prototype;
                                if (!_ghevPatched.has(OrigDTF)) {
                                    // Force profile locale + TZ at construct so format() is not OS-ru/Moscow.
                                    // [FIX the-frames-intl-was-the-parents-snapshot] Decided at CALL time. A
                                    // same-origin frame's first navigation reuses the Window of its initial
                                    // about:blank, and this wrapper — installed there while the parent had
                                    // not stood down yet — survives into the real document; when the flag
                                    // then keeps the frame's own module from installing, this is the Intl
                                    // the frame's scripts get, and it answered the profile beside a Date
                                    // path on the machine (measured, test/wbcoherence.mjs /tt/: zone and
                                    // locale from the profile, offset from the host, in one reading). So
                                    // the profile is forced only while the parent does not stand down.
                                    var Ctor = function DateTimeFormat(loc, opts) {
                                        opts = opts ? Object.assign({}, opts) : {};
                                        var ourTz = false;
                                        try {
                                            // [FIX variant-4] Neutral US defaults — never fall back to Tallinn/et-EE
                                            // when profile fields are briefly missing during country switch.
                                            // [FIX explicit-timezone-was-overridden] and only when the page named none.
                                            if (!opts.timeZone && !_standDownNow()) { opts.timeZone = _pv('timezone', 'America/New_York'); ourTz = true; }
                                        } catch (eO) {}
                                        // ours = the page named no locale, or handed back our
                                        // own tag; anything else is echoed untouched by
                                        // resolvedOptions below.
                                        var ours = false;
                                        try {
                                            if ((loc === undefined || loc === null || loc === '') && !_standDownNow()) {
                                                loc = _pv('locale', _pv('language', 'en-US'));
                                                ours = true;
                                            } else if (loc === undefined || loc === null || loc === '') {
                                                ours = false;
                                            } else {
                                                var first = Array.isArray(loc) ? loc[0] : loc;
                                                var mine = _pv('locale', _pv('language', null));
                                                ours = !!mine && typeof first === 'string' &&
                                                    first.toLowerCase() === String(mine).toLowerCase();
                                            }
                                        } catch (eL) {}
                                        var inst = Reflect.construct(OrigDTF, [loc, opts], new.target || OrigDTF);
                                        if (ours) { try { _frameOurs.add(inst); } catch (eT) {} }
                                        if (ourTz) { try { _frameOurTz.add(inst); } catch (eT2) {} }
                                        return inst;
                                    };
                                    Ctor.prototype = proto;
                                    try {
                                        if (OrigDTF.supportedLocalesOf) Ctor.supportedLocalesOf = OrigDTF.supportedLocalesOf;
                                    } catch (eSlo) {}
                                    try {
                                        // [FIX frame-intl-unmasked] Ctor went in bare, so in any
                                        // patched frame String(Intl.DateTimeFormat) returned OUR
                                        // source and .name/.length were the wrapper's, while the
                                        // top window has gone through _mnCtor since
                                        // [FIX ctor-toString-own-property]. A detector reads a
                                        // frame's Intl with one property access — and CreepJS
                                        // compares against a fresh iframe realm by design, so the
                                        // one realm we hand it was the unmasked one.
                                        var _fCtor = _mnCtor ? _mnCtor(Ctor, 'DateTimeFormat', OrigDTF.length) : Ctor;
                                        IntlObj.DateTimeFormat = _fCtor;
                                        _ghevPatched.add(_fCtor);
                                        _ghevPatched.add(Ctor);
                                        _ghevPatched.add(OrigDTF);
                                    } catch (eC) {}
                                }
                                if (proto && typeof proto.resolvedOptions === 'function' && !_ghevPatched.has(proto.resolvedOptions)) {
                                    var ro = proto.resolvedOptions;
                                    // [FIX resolvedOptions-stomped-explicit-locale] Fourth copy of
                                    // the defect, this one in the frame path. r.locale was forced
                                    // for EVERY instance, so inside a frame
                                    // new Intl.DateTimeFormat('de') formatted as German —
                                    // .format() really returned "Januar" — while reporting the
                                    // profile locale. Measured here before the fix: format
                                    // "Januar", resolvedOptions().locale "et-EE", and the same
                                    // 'et-EE' came back for 'ja' and ['de'] too. The top window
                                    // substitutes only for instances whose locale IT supplied;
                                    // frames now follow the same rule, tracked by _frameOurs.
                                    // [FIX frame-intl-unmasked] wrapRo was also a bare function,
                                    // so String() on it leaked our source — the very thing
                                    // CreepJS's "failed toString" check looks for.
                                    var wrapRo = _mn(function resolvedOptions() {
                                        var r = ro.call(this);
                                        if (_standDownNow()) return r;
                                        // [FIX explicit-timezone-was-overridden] ours only.
                                        try { if (_frameOurTz.has(this)) r.timeZone = _pv('timezone', r.timeZone); } catch (eTz) {}
                                        try {
                                            if (_frameOurs.has(this)) {
                                                var loc2 = _pv('locale', _pv('language', null));
                                                if (loc2) r.locale = loc2;
                                            }
                                        } catch (eLc) {}
                                        return r;
                                    });
                                    try {
                                        Object.defineProperty(proto, 'resolvedOptions', {
                                            value: wrapRo, configurable: true, writable: true
                                        });
                                        _ghevPatched.add(wrapRo);
                                    } catch (eRo) {}
                                }
                                if (proto && typeof proto.formatToParts === 'function' && !_ghevPatched.has(proto.formatToParts)) {
                                    var ftp = proto.formatToParts;
                                    // [FIX frame-intl-unmasked] bare function → String() leaked
                                    // our source, same as wrapRo above.
                                    var wrapFtp = _mn(function formatToParts(date) {
                                        var p = ftp.call(this, date);
                                        if (_standDownNow()) return p;
                                        var _fro = null;
                                        try { _fro = this.resolvedOptions(); } catch (eFro) {}
                                        // [FIX explicit-timezone-was-overridden] A formatter the page
                                        // built for another zone keeps ICU's own name for it.
                                        if (!_frameOurTz.has(this) && _fro && _fro.timeZone &&
                                            _fro.timeZone !== String(_pv('timezone', ''))) return p;
                                        var zn = _zoneLabel(date, _fro && _fro.locale, _fro && _fro.timeZoneName);
                                        if (!zn) return p;
                                        return p.map(function (x) {
                                            return x.type === 'timeZoneName'
                                                ? Object.assign({}, x, { value: zn })
                                                : x;
                                        });
                                    });
                                    try {
                                        Object.defineProperty(proto, 'formatToParts', {
                                            value: wrapFtp, configurable: true, writable: true
                                        });
                                        _ghevPatched.add(wrapFtp);
                                    } catch (eFtp) {}
                                    try {
                                        var fmt = proto.format;
                                        // [FIX frame-intl-unmasked] as above — bare function, source leaked
                                        var wrapFmt = _mn(function format(date) {
                                            try {
                                                return this.formatToParts(date).map(function (x) { return x.value; }).join('');
                                            } catch (eF) {
                                                return fmt.call(this, date);
                                            }
                                        });
                                        Object.defineProperty(proto, 'format', {
                                            value: wrapFmt, configurable: true, writable: true
                                        });
                                    } catch (eFmt) {}
                                }
                            }
                        } catch (eIntl) {}
                        try {
                            var DP = win.Date && win.Date.prototype;
                            if (DP && typeof DP.toString === 'function' && !_ghevPatched.has(DP.toString)) {
                                var _origTS = DP.toString;
                                // [FIX frame-intl-unmasked] Date.prototype.toString in a frame —
                                // same bare-function leak.
                                var wrapTS = _mn(function toString() {
                                    var s = _origTS.call(this);
                                    // [FIX the-frames-intl-was-the-parents-snapshot] Same gate as the
                                    // DateTimeFormat wrapper above: the frame's own module may never
                                    // install, and this label must not name the profile beside it.
                                    if (_standDownNow()) return s;
                                    try {
                                        var tz = String(_pv('timezone', ''));
                                        if (!tz) return s;
                                        // [FIX frame-zone-label-table] second copy of the
                                        // same eight-entry summer-only map — see the note
                                        // on _zoneLabel above. It also special-cased
                                        // Europe/Moscow to bail out, which only mattered
                                        // because the map had no row for it; the shared
                                        // table does, so the exception is gone too.
                                        // `this` is the Date being stringified, so the
                                        // label follows that instant's DST state.
                                        // Date.prototype.toString localises the zone name exactly like Intl —
                                        // measured on a clean browser: ru host prints
                                        // "(Восточная Европа, летнее время)", et-EE prints
                                        // "(Ida-Euroopa suveaeg)". A frame left on the
                                        // English table therefore disagreed with an
                                        // unpatched one on the same page.
                                        var label = _zoneLabel(this, _pv('locale', _pv('language', null)), 'long');
                                        if (!label) return s;
                                        if (/\([^)]*\)\s*$/.test(s)) {
                                            s = s.replace(/\([^)]*\)\s*$/, '(' + label + ')');
                                        }
                                    } catch (eS) {}
                                    return s;
                                });
                                try {
                                    Object.defineProperty(DP, 'toString', {
                                        value: wrapTS, configurable: true, writable: true
                                    });
                                    _ghevPatched.add(wrapTS);
                                } catch (eTS) {}
                            }
                            // toLocaleString without loc must not freeze OS-ru digits/order
                            if (DP && typeof DP.toLocaleString === 'function' && !_ghevPatched.has(DP.toLocaleString)) {
                                var _otls = DP.toLocaleString;
                                // [FIX frame-intl-unmasked] same leak; also gets the native arity —
                                // both parameters are optional, so .length must be 0, not 2
                                // (see [FIX worker-tolocale-length] for the same fix in the worker).
                                var wrapTls = _mn(function toLocaleString(loc = undefined, opts = undefined) {
                                    try {
                                        if ((loc === undefined || loc === null || loc === '') && !_standDownNow()) {
                                            loc = _pv('locale', _pv('language', undefined));
                                        }
                                    } catch (e) {}
                                    return _otls.call(this, loc, opts);
                                });
                                try {
                                    Object.defineProperty(DP, 'toLocaleString', {
                                        value: wrapTls, configurable: true, writable: true
                                    });
                                    _ghevPatched.add(wrapTls);
                                } catch (eTls) {}
                            }
                            // [FIX the-frames-date-answered-in-numbers-from-the-host] The two
                            // wrappers above cover the STRING side of Date in a frame and
                            // nothing covered the numeric side, so one Date object contradicted
                            // itself. Measured in a same-origin sandbox WITHOUT allow-scripts —
                            // the one shape where our bundle cannot run and the parent can still
                            // reach the globals, which makes it a pristine realm a page can
                            // borrow:
                            //
                            //   new f.contentWindow.Date(2026, 0, 15).toString()
                            //        clean "(Москва, стандартное время)"   ours "(Eastern Standard Time)"
                            //   ...getTimezoneOffset()
                            //        clean -180                            ours -180   <- the HOST
                            //
                            // Zone and locale from the profile, offset from the host, in one
                            // reading — the exact shape the comment on the Intl wrapper above
                            // records as a defect and fixes for the stand-down case.
                            //
                            // DELEGATED rather than reimplemented. The parent's Date.prototype
                            // is already the whole tested layer (23 methods over ZONE_DATA), a
                            // Date carries its instant in an internal slot that crosses realms,
                            // and calling the parent's method with the frame's receiver gives the
                            // frame EXACTLY what the top window answers, by construction — which
                            // is the invariant, not an approximation of it. It follows the
                            // stand-down for free, because the parent's methods already do.
                            //
                            // toString and toLocaleString are left to the two wrappers above:
                            // they localise the zone label through the FORMATTER's locale, which
                            // the parent's copies cannot know about from here.
                            try {
                                var PDP = Date.prototype;
                                var NUM = ['getTimezoneOffset', 'getFullYear', 'getMonth', 'getDate',
                                    'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getYear',
                                    'setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes',
                                    'setSeconds', 'setMilliseconds', 'setYear',
                                    'toTimeString', 'toDateString', 'toLocaleDateString', 'toLocaleTimeString'];
                                for (var _di = 0; _di < NUM.length; _di++) {
                                    (function (k) {
                                        try {
                                            var mine = PDP[k], theirs = DP[k];
                                            if (typeof mine !== 'function' || typeof theirs !== 'function') return;
                                            if (mine === theirs || _ghevPatched.has(theirs)) return;
                                            var w = ({ [k]: function () {
                                                return mine.apply(this, arguments);
                                            } })[k];
                                            // Arity from the frame's own native: a wrapper that
                                            // declares no parameters reports length 0, and
                                            // Date.prototype.setHours is length 4.
                                            try { Object.defineProperty(w, 'length', { value: theirs.length, configurable: true }); } catch (eL) {}
                                            var wm = _mn(w);
                                            Object.defineProperty(DP, k, { value: wm, configurable: true, writable: true });
                                            _ghevPatched.add(wm);
                                        } catch (eK) {}
                                    })(NUM[_di]);
                                }
                            } catch (eND) {}
                        } catch (eDate) {}
                    }
                    // Speech voices (iframe often keeps full OS list while top is Kaia/et)
                    if (_FEAT.navigator !== false) {
                        try {
                            var ss = win.speechSynthesis;
                            if (ss && typeof ss.getVoices === 'function') {
                                var voices = _pv('speechVoices', null);
                                if (Array.isArray(voices) && voices.length && !_ghevPatched.has(ss)) {
                                    // [FIX frame-getvoices-unmasked] This one went in bare while every
                                    // other replacement in this block had already been routed through
                                    // _mn, so in any patched frame
                                    // String(speechSynthesis.getVoices) handed back our source and
                                    // Object.getOwnPropertyNames on it listed arguments/caller/
                                    // prototype instead of the native {length,name}. profile
                                    // .speechVoices is populated by background.buildProfile for every
                                    // locale, so this path is live on ordinary pages, not a dead
                                    // branch. Same masking as the frame Intl/Date wrappers above.
                                    var fake = _mn(function getVoices() {
                                        return voices.map(function (v) {
                                            return {
                                                name: v.name,
                                                lang: v.lang,
                                                voiceURI: v.name,
                                                localService: v.localService !== false,
                                                default: !!v.default
                                            };
                                        });
                                    });
                                    // [FIX speechsynthesis-getvoices-was-an-own-property] On
                                    // the frame's PROTOTYPE, not on its speechSynthesis
                                    // instance. Defining it on the instance gave that object
                                    // an own property no real one has —
                                    // Object.getOwnPropertyNames(speechSynthesis) is [] in a
                                    // clean browser — which is the same shape-vs-value
                                    // mistake as [FIX instance-own-property-lies]. There is
                                    // exactly one instance per realm, so the prototype
                                    // answers every call the instance patch did.
                                    try {
                                        var ssProtoF = win.SpeechSynthesis && win.SpeechSynthesis.prototype;
                                        var ssTarget = ssProtoF || ss;
                                        Object.defineProperty(ssTarget, 'getVoices', {
                                            value: fake, configurable: true, writable: true
                                        });
                                        _ghevPatched.add(ss);
                                    } catch (eV) {}
                                }
                            }
                        } catch (eSs) {}
                    }
                    // Battery parity with top (mw-misc formulas). Iframe often left on
                    // native desktop defaults level=1 / chargingTime=0 while top is laptop seed.
                    if (_FEAT.battery !== false) {
                        try {
                            var BM = win.BatteryManager;
                            if (BM && BM.prototype && !_ghevPatched.has(BM.prototype)) {
                                var bp = BM.prototype;
                                // [FIX device-state-was-per-domain] This was a second,
                                // hand-copied implementation of the formulas in
                                // mw/mw-misc.js, reading the PER-DOMAIN `noiseSeed` — so a
                                // frame could disagree with its own top document, and the
                                // two copies had no parity assertion holding them together
                                // (every other duplicated table here does). Both are gone:
                                // afpDeviceState in seed-lib.js derives all four from the
                                // MASTER seed, background.js and dyn/boot.js publish them,
                                // and this reads the finished values off the frame's own
                                // profile exactly as mw-misc does for the top document.
                                // `null` on the wire means Infinity — see the note there.
                                // NOT via _pv: that helper folds null into its fallback, and
                                // here null is a VALUE — it is how Infinity survives the
                                // JSON hop, and it is exactly what chargingTime carries
                                // while the battery is discharging. Read ID directly so
                                // "absent" and "explicitly infinite" stay distinguishable.
                                var _batTime = function (name, fallback) {
                                    var v;
                                    try { v = ID[name]; } catch (e) { v = undefined; }
                                    if (v === null) return Infinity;
                                    if (v === undefined) v = fallback;
                                    return (v === null || v === undefined) ? Infinity : v;
                                };
                                var _batLevel = function () { return _pv('batteryLevel', 0.82); };
                                var _batCharging = function () { return _pv('batteryCharging', true); };
                                var _batChargingTime = function () { return _batTime('batteryChargingTime', 2620); };
                                var _batDischargingTime = function () { return _batTime('batteryDischargingTime', null); };
                                try {
                                    // [FIX frame-getters-unmasked] Same bare-getter leak as
                                    // _defWinProp above: a BatteryManager's accessors stringified
                                    // to our source and reported .name ''. Named via computed key
                                    // so _mn can build 'function get level() { [native code] }'.
                                    var _batGet = function (name, fn) {
                                        var g = ({ [name]: function () { return fn(); } })[name];
                                        Object.defineProperty(bp, name, {
                                            get: _mn(g, true),
                                            configurable: true, enumerable: true
                                        });
                                    };
                                    _batGet('level', _batLevel);
                                    _batGet('charging', _batCharging);
                                    _batGet('chargingTime', _batChargingTime);
                                    _batGet('dischargingTime', _batDischargingTime);
                                    _ghevPatched.add(bp);
                                } catch (eBat) {}
                            }
                        } catch (eB) {}
                    }
                } catch (eNav) {}
            }
            function _patchFrameUAD(win) {
                if (!win) return;
                try {
                    var NP = win.NavigatorUAData && win.NavigatorUAData.prototype;
                    if (!NP || typeof NP.getHighEntropyValues !== 'function') return;
                    if (_ghevPatched.has(NP.getHighEntropyValues)) return;
                    var orig = NP.getHighEntropyValues;
                    var wrap = _mn(function getHighEntropyValues(hints) {
                        return orig.apply(this, arguments).then(_forcePvResult);
                    });
                    _ghevPatched.add(wrap);
                    try {
                        Object.defineProperty(NP, 'getHighEntropyValues', {
                            value: wrap, configurable: true, writable: true
                        });
                    } catch (eD) {
                        try { NP.getHighEntropyValues = wrap; } catch (eA) {}
                    }
                    try {
                        var uad = win.navigator && win.navigator.userAgentData;
                        if (uad && typeof uad.getHighEntropyValues === 'function' && !_ghevPatched.has(uad.getHighEntropyValues)) {
                            var o2 = uad.getHighEntropyValues.bind(uad);
                            var w2 = _mn(function getHighEntropyValues(hints) {
                                return o2(hints).then(_forcePvResult);
                            });
                            _ghevPatched.add(w2);
                            try {
                                Object.defineProperty(uad, 'getHighEntropyValues', {
                                    value: w2, configurable: true, writable: true
                                });
                            } catch (e3) {}
                        }
                    } catch (eU) {}
                } catch (eP) {}
            }
            function _patchFrameAll(win, force) {
                if (!win) return;
                try {
                    try { void win.navigator; } catch (eX) { return; }
                    if (!force && _framesPatched.has(win)) return;
                    _framesPatched.add(win);
                } catch (e) { return; }
                try { _patchFrameNavScreen(win); } catch (e1) {}
                try { _patchFrameUAD(win); } catch (e2) {}
            }
            function _hookIframeEl(el) {
                if (!el || !el.tagName || String(el.tagName).toLowerCase() !== 'iframe') return;
                var first = false;
                try {
                    if (!_iframeElsHooked.has(el)) {
                        _iframeElsHooked.add(el);
                        first = true;
                    }
                } catch (e) { return; }
                if (first) {
                    try {
                        el.addEventListener('load', function () {
                            // about:blank / srcdoc may replace contentWindow — force re-patch
                            try { _patchFrameAll(el.contentWindow, true); } catch (eL) {}
                        });
                    } catch (eA) {}
                }
                // Synchronous patch — detectors read cores immediately after appendChild
                try { _patchFrameAll(el.contentWindow, true); } catch (e0) {}
            }
            function _scanFrames() {
                try {
                    var list = document.querySelectorAll('iframe');
                    for (var i = 0; i < list.length; i++) {
                        try { _hookIframeEl(list[i]); } catch (e) {}
                    }
                } catch (e2) {}
                try {
                    for (var j = 0; j < window.frames.length; j++) {
                        try { _patchFrameAll(window.frames[j]); } catch (e3) {}
                    }
                } catch (e4) {}
            }
            // [FIX blamed-for-the-pages-own-console-errors] A frame has to be patched
            // before the page's NEXT LINE — an Akamai-style probe appends an iframe and
            // reads hardwareConcurrency immediately, and the MutationObserver below is a
            // microtask too late. That used to be done by wrapping
            // Node.prototype.{appendChild,insertBefore,replaceChild}.
            //
            // It worked, but it put this file on the stack of EVERY node insertion on the
            // page, and Chrome names the immediate caller when it refuses one. So pages
            // that probe for browser extensions by inserting <script src="chrome://…">
            // (deviceinfo.me does, ~20 times) printed twenty console errors pointing at
            // mw/mw-navigator.js — errors the page causes and would emit anyway. Measured
            // with and without the wrapper: the SAME errors, the same count, only the
            // attribution moved.
            //
            // contentWindow / contentDocument is the better trigger, because it is the
            // only way the page can reach into the frame at all: patch on first access and
            // the patch is always in place before anything can be read. Measured against
            // the real unpacked extension, four frame shapes, same-tick read:
            //                      appendChild hook   no hook   contentWindow hook
            //   about:blank        8                  8         8      (Chrome injects)
            //   srcdoc             8                  18 LEAK   8
            //   src= same-origin   8                  18 LEAK   8
            //   sandbox            8                  18 LEAK   8
            // Same coverage, and the chrome:// errors go back to being blamed on the page.
            // It also takes a wrapper off the hottest DOM API in the browser.
            //
            // The old "Do NOT redefine HTMLIFrameElement.contentWindow (CreepJS flag)"
            // note was about a BARE getter, which leaks its own source and reports name ''.
            // Routed through _mn it reports 'get contentWindow' with a native toString, and
            // contentWindow is natively an accessor ON THIS PROTOTYPE, so replacing it adds
            // no own property either — dev-ownprops.html and dev-vsnative.html both check
            // exactly that.
            var _iframeHooks = [_hookIframeEl];
            try { if (MW) MW.iframeHooks = _iframeHooks; } catch (eHk) {}
            function _fireIframeHooks(el) {
                for (var hi = 0; hi < _iframeHooks.length; hi++) {
                    try { _iframeHooks[hi](el); } catch (eH) {}
                }
            }
            try {
                // _hookIframeEl and the canvas bridge both read el.contentWindow, which is
                // this very getter — hence the re-entry latch rather than a per-element
                // guard: it has to hold across the whole nested call, not per frame.
                var _cwBusy = false;
                ['contentWindow', 'contentDocument'].forEach(function (prop) {
                    var d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, prop);
                    if (!d || typeof d.get !== 'function') return;
                    var og = d.get;
                    Object.defineProperty(HTMLIFrameElement.prototype, prop, {
                        get: _mn(({ [prop]: function () {
                            var v = og.call(this);
                            if (!_cwBusy) {
                                _cwBusy = true;
                                try {
                                    var w = (prop === 'contentWindow') ? v : (v && v.defaultView);
                                    if (w) _patchFrameAll(w, false);
                                    _fireIframeHooks(this);
                                } catch (eP) {} finally { _cwBusy = false; }
                            }
                            return v;
                        } })[prop], true),
                        set: d.set,
                        configurable: true,
                        enumerable: d.enumerable
                    });
                });
            } catch (eIns) {}
            try {
                var mo = new MutationObserver(function (muts) {
                    for (var i = 0; i < muts.length; i++) {
                        var nodes = muts[i].addedNodes;
                        if (!nodes) continue;
                        for (var j = 0; j < nodes.length; j++) {
                            var n = nodes[j];
                            try {
                                if (n && n.tagName && String(n.tagName).toLowerCase() === 'iframe') {
                                    _hookIframeEl(n);
                                } else if (n && n.querySelectorAll) {
                                    var sub = n.querySelectorAll('iframe');
                                    for (var k = 0; k < sub.length; k++) _hookIframeEl(sub[k]);
                                }
                            } catch (eN) {}
                        }
                    }
                    try { _scanFrames(); } catch (eS) {}
                });
                mo.observe(document.documentElement || document, { childList: true, subtree: true });
            } catch (eMO) {}
            try { _scanFrames(); } catch (eS) {}
            try {
                if (document.readyState === 'loading')
                    document.addEventListener('DOMContentLoaded', _scanFrames, true);
            } catch (eR) {}
            try {
                setInterval(function () { try { _scanFrames(); } catch (e) {} }, 1500);
            } catch (eInt) {}
        } catch (eAll) {}
    })();

    // ===== NAVIGATOR.CONNECTION =====
    // Десктопный Chrome на ethernet: effectiveType='4g', downlink=10, rtt=50, type='ethernet'.
    // [STEALTH] skip CONNECTION; also respect features.network
    // [FIX stealth-first-load-kept-the-network-substitution] The gate used to be
    // `if (!_STEALTH && _FEAT.network !== false)`, decided while this file loads — and
    // `_STEALTH` is false on a tab's FIRST load, because the mode lives in per-tab
    // sessionStorage and a fresh tab has none. So stealth installed the substitution once
    // per tab and then never again. Measured by test/stealth.mjs, one tab, stealth
    // selected:
    //
    //     connection.rtt       first load 50   second 100   (the host's)
    //     connection.downlink  first load 10   second 1.5
    //
    // Two networks for one visitor, a reload apart — the same shape as
    // [FIX stealth-first-load-noised-the-canvas] and cured the same way: install
    // regardless, and ask at the moment the value is produced. `_featNow` is memoised per
    // name in mw-core, so one page gets ONE answer however often it reads; and it folds
    // stealth in, so this single call covers both the user's switch and the mode.
    //
    // The native values are captured BEFORE the patch and handed back when the answer is
    // "off", which is what makes this a stand-down rather than a second set of invented
    // numbers. navigator.connection is a singleton, so the accessor can reach the instance
    // it needs without a `this` — the reason this module could be fixed this way and
    // BatteryManager, whose instance only arrives through a promise, could not.
    if (_FEAT.network !== false) (function() {
        try {
            var conn = navigator.connection;
            if (!conn) return;
            var proto = Object.getPrototypeOf(conn);
            var _natConn = {};
            ['effectiveType', 'downlink', 'rtt', 'saveData'].forEach(function (k) {
                try {
                    var d = Object.getOwnPropertyDescriptor(proto, k);
                    _natConn[k] = (d && d.get) || null;
                } catch (e) { _natConn[k] = null; }
            });
            function _connVal(k, spoofed) {
                return function () {
                    if (_featNow('network')) return spoofed;
                    try { if (_natConn[k]) return _natConn[k].call(conn); } catch (e) {}
                    return spoofed;
                };
            }
            _def(proto, 'effectiveType', _connVal('effectiveType', '4g'));
            _def(proto, 'downlink',      _connVal('downlink', 10));
            _def(proto, 'rtt',           _connVal('rtt', 50));
            _def(proto, 'saveData',      _connVal('saveData', false));
            // [FIX invented-connection-props] Здесь дополнительно выставлялись
            // type:'ethernet' и downlinkMax:Infinity. Обоих на десктопном Chrome НЕТ:
            // замер против чистого realm показал
            //   navigator.connection.type            → undefined  (мы отдавали 'ethernet')
            //   'downlinkMax' in NetworkInformation.prototype → false (мы СОЗДАВАЛИ свойство)
            // и в поле network у CreepJS чистый браузер даёт «4g,-1,null», а мы —
            // «4g,-1,ethernet». То есть это была не маскировка, а выдуманный признак:
            // type/downlinkMax реализованы только на Android. Оставляем как у натива —
            // отсутствующими (тот же принцип, что _defIfDiff: не лгать там, где
            // нативное поведение и так нормально).
            // onchange: getter null + no-op setter (без setter strict mode бросает при присвоении)
            // [FIX wrong-getter-name] Геттер назывался getLayoutMap (copy-paste из
            // секции NAVIGATOR.KEYBOARD): _mn строит fake-toString из fn.name, так что
            // Object.getOwnPropertyDescriptor(navigator.connection,'onchange').get
            //   .toString() отдавал 'function getLayoutMap() { [native code] }'
            // для свойства onchange — имя, не совпадающее со свойством, у нативного
            // аксессора невозможно и читается напрямую как признак подмены.
            // [FIX instance-own-property-lies] These three went on the connection
            // INSTANCE, which natively has no own properties at all — measured against
            // stock Chromium: navigator.connection own [] vs ours
            // [onchange, addEventListener, dispatchEvent]. onchange moves to
            // NetworkInformation.prototype, where the native accessor lives.
            // addEventListener/dispatchEvent are GONE rather than relocated: they existed
            // to suppress 'change' events, but effectiveType/downlink/rtt/saveData are
            // already substituted with constants by _def above, so a change event cannot
            // reveal anything — it would only fire and hand the page the same spoofed
            // values. They cost two own-property lies to buy nothing, and relocating them
            // is not an option either: natively they are inherited from
            // EventTarget.prototype, so an own copy anywhere below that is equally visible.
            // [FIX accessors-answered-every-receiver] The onchange getter below returned
            // null for ANY receiver, so measured against clean Chromium 151:
            //   NetworkInformation.prototype.onchange   clean THREW TypeError   ours null
            // Same rule as the four accessors above and as brands/mobile/platform: the
            // native getter we are about to replace IS the receiver oracle. A brand list
            // cannot stand in for it — clean ANSWERS for a cross-realm NetworkInformation
            // (measured, `NetworkInformation.effectiveType.call(otherRealmConn)` -> "4g")
            // where isPrototypeOf is false — and answering our null there is right, because
            // that realm's own copy of this patch returns null too.
            //
            // The SETTER shares the GETTER's oracle rather than calling the native setter,
            // because the getter is the side-effect-free half: delegating to the native
            // setter for a valid foreign receiver would actually install a handler there,
            // which no realm of ours does. That substitution is exact — measured on clean
            // Chromium 151, every refused receiver gets the same object out of both halves:
            //   E.get.call({}) / E.set.call({}, null)   both TypeError: Illegal invocation
            //   .call(null) and .call(NetworkInformation.prototype)   likewise, both halves
            // Guarding only the getter would leave one descriptor honest on read and lying on
            // write, the same one-descriptor mismatch [FIX bare-setter] below is about.
            var _natOnchange = null;
            try {
                var _dOc = Object.getOwnPropertyDescriptor(proto, 'onchange');
                if (_dOc && typeof _dOc.get === 'function') _natOnchange = _dOc.get;
            } catch (eOc) {}
            function _connRecv(recv) {
                // Identity is enough here where it was not enough for NavigatorUAData:
                // navigator.connection IS a singleton, the same fact the stand-down above
                // already relies on to reach the instance without a `this`. Measured with a
                // counter in the oracle: 5 ordinary reads -> 0 native calls.
                if (recv === conn) return;
                // No native descriptor means no oracle: answer for every receiver rather
                // than invent a refusal this browser does not have.
                if (_natOnchange) _natOnchange.call(recv);
            }
            try {
                // [FIX bare-setter] The setter was a plain function expression, so
                // Function.prototype.toString.call(desc.set) printed "function() {}" next to
                // a getter that read as native — a mismatch inside ONE descriptor, which is
                // cheaper to spot than either half alone. A native setter's own .name is
                // "set onchange" (not "onchange"), so the name is built in rather than
                // relying on _mn's accessor flag, which only knows how to prepend "get ".
                // Native setters take one argument; `function () {}` would report length 0.
                Object.defineProperty(proto, 'onchange', {
                    get: _mn(function onchange() {
                        _connRecv(this);
                        return null;
                    }, true),
                    set: _mn(({ 'set onchange': function (v) {
                        _connRecv(this);
                        return v;
                    } })['set onchange']),
                    configurable: true
                });
            } catch(e) {}
        } catch(_) {}
    })();


    // [FIX ungated-patch] Раньше секция управлялась только скрытым режимом (или
    // вообще ничем), из-за чего снятие галок в настройках её не отключало.
    if (!_FEAT.navigator) { /* disabled in options */ } else
    // ===== NAVIGATOR.KEYBOARD =====
    // getLayoutMap() возвращает Map с раскладкой клавиатуры — уникальный fingerprint.
    // Возвращаем стандартную US QWERTY раскладку независимо от реальной.
    //
    // [FIX stealth-leaked-the-real-keyboard-layout] This used to carry `if (!_STEALTH)`, so
    // stealth shipped the host's real layout: measured on a live Fingerprint Pro event,
    // `keyboard_layout_hash` was 691e3845… in stealth against the spoofed 9896f844… in
    // normal — the same value a clean browser reports, i.e. a per-machine identifier that
    // survived every other change.
    //
    // Unlike the speech voices next door, this is NOT a contradiction — a Russian layout
    // under an Estonian locale is ordinary, nobody cross-checks them, and no detector was
    // observed flagging it. The argument is narrower and it is about the cohort: one shared
    // US QWERTY across every user of the extension carries less entropy than each user's
    // own. Stealth trades patches for silence, and this patch buys more silence than it
    // costs — it answers a question the page asked, in the way most machines would.
    //
    // `navigator` still gates it, so unticking that in the options disables it as before.
    // [FIX the-layout-said-en-US-and-hashed-to-nothing-real] The hand-written map above was
    // the signature. Measured against a real Chrome on this machine:
    //
    //   real en-US map:  48 keys, includes IntlBackslash, has NO Space
    //   the map we shipped: 48 keys, has Space, no IntlBackslash
    //
    // So a page got a layout that CLASSIFIES as en-US and HASHES to a value no en-US
    // keyboard produces. Fingerprint Pro reported exactly that pair — keyboard_layout_name
    // "en-US" beside a keyboard_layout_hash that was ours — and called the browser
    // BrowserAutomationStudio, tampering 0.96, anti_detect_browser true. Bisected with the
    // thirteen option switches on a live event: everything off is clean (bot not_detected,
    // Chrome 152), WebGL alone is clean, NAVIGATOR ALONE reproduces the whole verdict.
    //
    // The key set is physical and belongs to the browser, not to the layout, so it is taken
    // from the native map and only the VALUES are made US. A user whose layout is already US
    // — which is what the machine above has — gets the native map back untouched, so there
    // is nothing to hash differently and no Map-versus-KeyboardLayoutMap difference either.
    (function() {
        try {
            if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) return;
            // Values only. The KEYS come from whatever the browser reports.
            var _usValues = {
                KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r', KeyT: 't', KeyY: 'y', KeyU: 'u',
                KeyI: 'i', KeyO: 'o', KeyP: 'p', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyF: 'f',
                KeyG: 'g', KeyH: 'h', KeyJ: 'j', KeyK: 'k', KeyL: 'l', KeyZ: 'z', KeyX: 'x',
                KeyC: 'c', KeyV: 'v', KeyB: 'b', KeyN: 'n', KeyM: 'm',
                Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5',
                Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0',
                Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
                Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
                Slash: '/', Backquote: '`'
            };
            var _natGLM = navigator.keyboard.getLayoutMap;
            var _fakeGLM = _mn(function getLayoutMap() {
                return _natGLM.call(navigator.keyboard).then(function (m) {
                    // Already a US layout? Hand the native object straight back. Replacing a
                    // correct map with an equal one can only lose — the object's own class
                    // included.
                    var differs = false;
                    m.forEach(function (v, k) {
                        if (Object.prototype.hasOwnProperty.call(_usValues, k) && _usValues[k] !== v) differs = true;
                    });
                    if (!differs) return m;
                    var out = new Map();
                    m.forEach(function (v, k) {
                        out.set(k, Object.prototype.hasOwnProperty.call(_usValues, k) ? _usValues[k] : v);
                    });
                    return out;
                });
            });
            try { Object.defineProperty(Object.getPrototypeOf(navigator.keyboard), 'getLayoutMap', { value: _fakeGLM, configurable: true }); } catch (e) {}
        } catch (_) {}
    })();



    // ===== WEBGPU adapter.info — согласован с WebGL-профилем =====
    // Probes: navigator.gpu.requestAdapter() → adapter.info
    // (vendor / architecture / device / description). Must match the GPU family of the
    // webgl UNMASKED_* strings (Intel↔intel, NVIDIA↔nvidia) — comparing those two is a
    // one-line cross-check, and a family split there is block-grade on its own.
    // Feature flag: same as webgl. Stealth: still apply (like UNMASKED_*).
    //
    // [FIX webgpu-info-patched-on-the-instance] Measured against stock Chrome: a real
    // GPUAdapterInfo has ZERO own properties. vendor / architecture / device /
    // description / isFallbackAdapter / subgroupMinSize / subgroupMaxSize are all get-only
    // accessors on GPUAdapterInfo.prototype — enumerable, configurable, each getter named
    // "get <field>". The old code defined them on the INSTANCE handed back by each
    // requestAdapter(), which made the patch louder than the thing it was hiding:
    //     Object.getOwnPropertyNames(adapter.info)
    //       clean -> []    ours -> ["vendor","architecture","device","description",…]
    //     JSON.stringify(adapter.info)
    //       clean -> "{}"  ours -> {"vendor":"intel","architecture":"xe-lpg",…}
    // One JSON.stringify separated a patched browser from a clean one, and the window and
    // the worker disagreed on the SHAPE of the object as well, since the worker was never
    // patched at all. This is the same class as the PermissionStatus and TextMetrics fixes
    // in mw/mw-misc.js — the platform returns an object whose data lives on its prototype,
    // and anything own-shaped is not that object. Patching the prototype leaves every
    // instance empty, exactly like native.
    //
    // [CLEANUP dead-webgpu-api] Two branches went with it. Both targeted API that Chrome
    // no longer ships, so neither could ever fire (measured — GPUAdapter.prototype is
    // features / limits / info / requestDevice / constructor):
    //     adapter.requestAdapterInfo()   removed from the platform; adapter.info is sync
    //     adapter.isFallbackAdapter      removed; it lives on GPUAdapterInfo.prototype
    //
    // Limits and features stay native, deliberately. adapter.limits and device.limits
    // share ONE GPUSupportedLimits prototype (measured), so patching the prototype would
    // flatten the natural adapter/device split — 16384 vs 8192 on the machine this was
    // written on — and patching the instance brings back the own-property lie above.
    // subgroupMinSize / subgroupMaxSize are left alone for the same reason: the values to
    // put there cannot be measured without the hardware being imitated, and an invented
    // number is a new mismatch rather than a closed one.
    if (!_FEAT.webgl) { /* gpu identity off */ } else
    (function () {
        try {
            if (typeof GPUAdapterInfo === 'undefined' || !GPUAdapterInfo.prototype) return;
            var _aiProto = GPUAdapterInfo.prototype;
            function _wgpuInfo() {
                try {
                    var p = _prof() || {};
                    var v = p.webgpuVendor, a = p.webgpuArchitecture;
                    if (!v) {
                        var wv = String(p.webglVendor || (ID && ID.webglVendor) || '').toLowerCase();
                        if (wv.indexOf('nvidia') !== -1) {
                            v = 'nvidia'; a = a || 'ampere';
                        } else if (wv.indexOf('amd') !== -1 || wv.indexOf('ati') !== -1) {
                            v = 'amd'; a = a || '';
                        } else {
                            v = 'intel'; a = a || 'xe-lpg';
                        }
                    }
                    return {
                        vendor: v || 'intel',
                        architecture: a != null ? a : '',
                        device: p.webgpuDevice != null ? p.webgpuDevice : '',
                        description: p.webgpuDescription != null ? p.webgpuDescription : ''
                    };
                } catch (e) {
                    return { vendor: 'intel', architecture: 'xe-lpg', device: '', description: '' };
                }
            }
            // Read at call time, not snapshotted: background.js can inject the profile
            // after this module runs, and every other reader here is late-binding too.
            function _defGet(key, read) {
                try {
                    var d = Object.getOwnPropertyDescriptor(_aiProto, key);
                    if (!d || typeof d.get !== 'function') return;
                    var nat = d.get;
                    Object.defineProperty(_aiProto, key, {
                        // Named so _mn reports "get vendor", which is what the native
                        // accessor's own .name is.
                        // [FIX host-mode] The adapter's own answer when the machine is the
                        // host — same read-time branch as _def and _wgParam.
                        get: _mn(({ [key]: function () {
                            if (_hostHwNow()) return nat.call(this);
                            return read(this);
                        } })[key], true),
                        set: undefined,
                        enumerable: d.enumerable,
                        configurable: d.configurable
                    });
                } catch (e) {}
            }
            _defGet('vendor', function () { return _wgpuInfo().vendor; });
            _defGet('architecture', function () { return _wgpuInfo().architecture; });
            _defGet('device', function () { return _wgpuInfo().device; });
            _defGet('description', function () { return _wgpuInfo().description; });

            // isFallbackAdapter: false, because the profile claims a real desktop GPU and a
            // real one never reports true — on a machine whose GPU is blocklisted, true is
            // the single loudest "this is a VM / bot" bit there is.
            //
            // [FIX requestAdapter-wrapper-put-this-file-in-the-page-console] There used to
            // be a wrapper on GPU.prototype.requestAdapter here whose ONLY job was to note
            // that a caller had passed forceFallbackAdapter:true, so that isFallbackAdapter
            // could stay honest for that one caller. It cost far more than it bought:
            // Chrome logs "The powerPreference option is currently ignored when calling
            // requestAdapter() on Windows" (crbug.com/369219127) for any site that passes
            // powerPreference — which is most WebGPU code — and because our wrapper was on
            // the stack when the native call ran, Chrome attributed that warning to
            // mw/mw-navigator.js. The extension named itself, with a file path, in the
            // console of every WebGPU site the user visited. Same class as the appendChild
            // hook that was replaced for exactly this reason.
            // What was given up is close to nothing: requestAdapter({forceFallbackAdapter:
            // true}) resolves to null on Windows (measured — Chrome exposes no fallback
            // adapter), so the honest branch had no adapter to be honest about. Reading the
            // constant off the prototype needs no wrapper and leaves no frame.
            _defGet('isFallbackAdapter', function () { return false; });
            try { _markStatus('webgpu'); } catch (eS) {}
        } catch (eAll) {}
    })();

    // ===== MEDIA CAPABILITIES — the decoder answers for the claimed card =====
    //
    // [FIX decoder-answered-for-the-host-gpu] navigator.mediaCapabilities.decodingInfo()
    // reports `powerEfficient`, which Chrome sets from whether a HARDWARE decoder exists
    // for that codec — i.e. from the real card. Measured on this host (Intel Arc), AV1
    // 1080p30: supported/smooth/powerEfficient = true/true/true, beside a profile claiming
    // "Intel(R) UHD Graphics 630", a Gen9.5 die with no AV1 decoder. A site that reads
    // both has the contradiction in two calls, and nothing here touched the API.
    //
    // What the answer looks like WITHOUT the decoder was measured rather than guessed —
    // the same Chromium with --disable-accelerated-video-decode: AV1 true/true/false. Only
    // powerEfficient moves; `supported` and `smooth` stay (software AV1 at 1080p is smooth
    // by Chrome's own account). So that is the one edit made, and only DOWNWARDS: a card
    // the profile says lacks the decoder answers false where the host said true. The
    // reverse — claiming a decoder the host does not have — is never done: a page can
    // play a clip and count dropped frames, and HEVC without hardware is `supported:
    // false` outright (measured), which no boolean can paper over. README "Limits", item 15.
    //
    // Rides the `webgl` flag with WebGPU above: the three describe ONE card. The worker
    // scope carries the same edit (mw-workers _mcShim) because WorkerNavigator exposes
    // mediaCapabilities too (measured).
    if (!_FEAT.webgl) { /* gpu identity off */ } else
    (function () {
        try {
            if (typeof MediaCapabilities === 'undefined' || !MediaCapabilities.prototype) return;
            var _mcp = MediaCapabilities.prototype;
            var _odi = _mcp.decodingInfo;
            if (typeof _odi !== 'function') return;
            function _isAv1(cfg) {
                try {
                    return /\bav01\b/i.test(String((cfg && cfg.video && cfg.video.contentType) || ''));
                } catch (e) { return false; }
            }
            _mcp.decodingInfo = _mn(function decodingInfo(configuration) {
                // Native first: it validates the dictionary and rejects exactly as a clean
                // browser does, and _mn takes our frames off that rejection.
                var r = _odi.apply(this, arguments);
                if (!_isAv1(configuration) || !r || typeof r.then !== 'function') return r;
                return r.then(function (res) {
                    try {
                        if (_hostHwNow() || _standDownNow()) return res;
                        var p = _prof();
                        var av1 = (p && typeof p.hwAv1Decode === 'boolean') ? p.hwAv1Decode : true;
                        if (av1 === false && res && res.powerEfficient === true) res.powerEfficient = false;
                    } catch (e) {}
                    return res;
                });
            });
        } catch (eAll) {}
    })();

    // ===== WEBGL SHADER PRECISION — НЕ ПАТЧИМ (осознанно) =====
    // Здесь стоял патч getShaderPrecisionFormat через WASM. Он был сломан сразу
    // в четырёх местах — замерено против нативных значений:
    //
    //  1) ЧТЕНИЕ ЗА ПРЕДЕЛАМИ ЗАПИСАННОГО. C-функция get_fake_shader_precision
    //     пишет по ОДНОМУ int в каждый из трёх указателей (*rangeMin = -127 и
    //     т.д.), а JS-обёртка читала по ДВА, считая, что там пара
    //     [vertex, fragment]. Второй элемент — непроинициализированная память
    //     кучи. Для FRAGMENT_SHADER (idx=1) наружу уходил мусор: замер дал
    //     rangeMin=rangeMax=precision=1520 вместо 127/127/23. Значение зависит
    //     от состояния аллокатора, то есть ещё и нестабильно между загрузками.
    //  2) НЕВЕРНЫЙ ЗНАК. Даже для VERTEX_SHADER отдавалось rangeMin = -127,
    //     тогда как нативное значение +127 (по спеке WebGL это log2 АБСОЛЮТНОЙ
    //     величины минимума, всегда положительное).
    //  3) precisionType ИГНОРИРОВАЛСЯ. Для *_INT нативное значение [31, 30, 0],
    //     а патч всегда отдавал float-тройку — расхождение ловится одной строкой.
    //  4) Возвращался ЛИТЕРАЛ объекта, а не WebGLShaderPrecisionFormat, из-за
    //     чего instanceof не проходил (тот же класс бага, что был у TextMetrics).
    //
    // Заголовок утверждал, что значения GPU-специфичны, но это неверно для
    // desktop: сама C-функция — три константы с комментарием «real WebGL params
    // come from JS profile», а нативные значения на ANGLE/D3D11 одинаковы у
    // Intel/NVIDIA/AMD, потому что задаются пределами float32/int32 в GLSL ES:
    //     float (low/medium/high) → rangeMin 127, rangeMax 127, precision 23
    //     int   (low/medium/high) → rangeMin  31, rangeMax  30, precision  0
    // Значит патч не скрывал ничего, а только портил данные. Оставляем нативные
    // значения — они и корректны, и совпадают с любым desktop-GPU, и это на два
    // патченных свойства меньше (WebGL + WebGL2).
    //
    // Если когда-нибудь понадобится НОРМАЛИЗОВАТЬ экзотический GPU, который
    // репортит нестандартные пределы, делать это надо по образцу _defIfDiff:
    // патчить ТОЛЬКО когда нативное значение отличается от таблицы выше, и
    // подменять числа на самом WebGLShaderPrecisionFormat (как сделано для
    // TextMetrics в mw-canvas-audio.js), а не возвращать литерал.

})();
