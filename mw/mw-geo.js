// ===== GEOLOCATION (options: features.geolocation) =====
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
    // [FIX feature-switch-read-from-a-profile-that-has-no-features] This module gated on
    // `_prof().features`, and at document_start there is no such thing: the boot profile is
    // assembled by the generated dyn/ files that registerBootScript selects — dev, cc, mode,
    // pv — and not one of them carries a `features` key. So `feat` was {}, `=== false` was
    // never true, and the switch did nothing at all. Measured against the real extension,
    // geolocation toggled off, permission granted:
    //
    //   JP  geolocation:true  -> coords 35.67,139.63     US  geolocation:true  -> 40.70,-74.03
    //   JP  geolocation:false -> coords 35.67,139.63     US  geolocation:false -> 40.70,-74.03
    //
    // while a clean Chromium under the same conditions answers `error 3 Timeout expired`, so
    // those coordinates were ours in every row. The country is right in all four, which is
    // what makes this specific: the profile IS readable, it simply never had the flags.
    //
    // `MW.FEAT` is where the flags actually live — every other module reads exactly that
    // (`var _FEAT = MW.FEAT`), mw-core decides it from the packed `v.ui.f` as it loads.
    // The profile is kept as a fallback: it gains a `features` key later, from ui:state, and
    // a build where the registry is missing should behave as it did before rather than
    // silently stop protecting.
    var _FEAT = (window.__AFP_MW__ && window.__AFP_MW__.FEAT) || null;
    try {
        var feat = _FEAT || (_prof() && _prof().features) || {};
        try {
            var _pm = _prof();
            if ((_pm && _pm.mode === 'stealth') || sessionStorage.getItem('v.ui.m') === 'stealth') return;
        } catch (eSt) {}
        if (feat.geolocation === false) return;
        if (!navigator.geolocation) return;
        if (window.__AFP_GEO__) return;

        // [FIX geolocation-ignored-permissions-policy] Do not patch a document that is not
        // allowed geolocation in the first place. Measured against a clean browser on the
        // same machine, one page served with `Permissions-Policy: geolocation=()`:
        //
        //     document.featurePolicy.allowsFeature('geolocation')   false      false
        //     getCurrentPosition                        error 1 "disabled by   SUCCESS,
        //                                               permissions policy"    Tallinn
        //
        // The patch below answers `success` after 20 ms unconditionally — it never looked
        // at the policy, and it never called `error` at all. So the extension handed out a
        // position the platform had already refused, and the page could read
        // allowsFeature() === false beside a resolved position, which no browser produces.
        //
        // The common shape is not this header: it is a cross-origin iframe embedded WITHOUT
        // allow="geolocation" — ads, widgets, embeds — where the same thing happened on
        // every page. Bailing out here leaves the native implementation in place, so the
        // refusal, its error code and its message are the browser's own rather than
        // something reconstructed. An engine without featurePolicy is treated as allowed,
        // which is what it was before this check existed.
        try {
            var _fp = document.featurePolicy || document.permissionsPolicy;
            if (_fp && typeof _fp.allowsFeature === 'function' &&
                !_fp.allowsFeature('geolocation')) return;
        } catch (eFp) {}

        window.__AFP_GEO__ = true;

        // Coarse coords from profile country centroid when available; else generic
                var COORDS = {
            // <generated:COORDS> from data/countries.json — do not edit; run: node tools/gen-tables.mjs
            AE: [25.2, 55.27],
            AR: [-34.6, -58.38],
            AT: [48.21, 16.37],
            AU: [-33.87, 151.21],
            BD: [23.81, 90.41],
            BE: [50.85, 4.35],
            BG: [42.7, 23.32],
            BR: [-23.55, -46.63],
            CA: [43.65, -79.38],
            CH: [47.38, 8.54],
            CL: [-33.45, -70.67],
            CN: [39.9, 116.41],
            CO: [4.71, -74.07],
            CY: [35.19, 33.38],
            CZ: [50.08, 14.44],
            DE: [52.52, 13.41],
            DK: [55.68, 12.57],
            EE: [59.44, 24.75],
            EG: [30.04, 31.24],
            ES: [40.42, -3.7],
            FI: [60.17, 24.94],
            FR: [48.86, 2.35],
            GB: [51.51, -0.13],
            GR: [37.98, 23.73],
            HK: [22.32, 114.17],
            HR: [45.81, 15.98],
            HU: [47.5, 19.04],
            ID: [-6.21, 106.85],
            IE: [53.35, -6.26],
            IL: [32.09, 34.78],
            IN: [28.61, 77.21],
            IQ: [33.31, 44.37],
            IR: [35.69, 51.39],
            IS: [64.15, -21.94],
            IT: [41.9, 12.5],
            JP: [35.68, 139.65],
            KE: [-1.29, 36.82],
            KR: [37.57, 126.98],
            LT: [54.69, 25.28],
            LU: [49.61, 6.13],
            LV: [56.95, 24.11],
            MA: [33.57, -7.59],
            MT: [35.9, 14.51],
            MX: [19.43, -99.13],
            MY: [3.14, 101.69],
            NG: [6.52, 3.38],
            NL: [52.37, 4.9],
            NO: [59.91, 10.75],
            NZ: [-36.85, 174.76],
            PE: [-12.05, -77.04],
            PH: [14.6, 120.98],
            PK: [24.86, 67],
            PL: [52.23, 21.01],
            PT: [38.72, -9.14],
            RO: [44.43, 26.1],
            RS: [44.79, 20.45],
            SA: [24.71, 46.68],
            SE: [59.33, 18.07],
            SG: [1.35, 103.82],
            SI: [46.06, 14.51],
            SK: [48.15, 17.11],
            TH: [13.76, 100.5],
            TR: [41.01, 28.98],
            TW: [25.03, 121.57],
            US: [40.71, -74.01],
            VN: [21.03, 105.85],
            ZA: [-26.2, 28.04],
            // </generated:COORDS>
        };
        function pick() {
            var cc = 'US';
            var p = null;
            try { p = _prof(); } catch (e0) {}
            try {
                if (p && p.countryCode) cc = String(p.countryCode).toUpperCase();
                else if (p && p.locale) cc = String(p.locale).split('-').pop().toUpperCase();
                else if (p && p.language) cc = String(p.language).split('-').pop().toUpperCase();
            } catch (e) {}
            var c = COORDS[cc] || COORDS.US;
            // [FIX device-state-was-per-domain] The offset and the accuracy used to be
            // derived HERE from `p.noiseSeed`, which is the PER-DOMAIN seed, so the same
            // device answered two origins with positions 1.2 km apart at the same moment
            // — measured, 59.4336,24.7439 against 59.4437,24.7243. A physical device has
            // one position. They come from the MASTER seed now, resolved once in
            // afpDeviceState (seed-lib.js) and delivered on the profile; see the note
            // there for why the grid was also coarsened from 1000 steps to 20.
            var jlat = 0, jlon = 0, acc = 65;
            try {
                if (p && typeof p.geoOffsetLat === 'number') jlat = p.geoOffsetLat;
                if (p && typeof p.geoOffsetLon === 'number') jlon = p.geoOffsetLon;
                if (p && typeof p.geoAccuracy === 'number') acc = p.geoAccuracy;
            } catch (e2) {}
            // Rounded to 6 decimals (~0.1 m) because adding two short decimals produces a
            // binary-float tail: 59.44 + -0.0095 serialises as 59.430499999999995, and a
            // coordinate carrying that tail advertises itself as ARITHMETIC rather than
            // something a location provider measured. Six places is ordinary precision for
            // real geolocation data and leaves the value itself unchanged.
            function _r6(v) { return Math.round(v * 1e6) / 1e6; }
            return {
                latitude: _r6(c[0] + jlat),
                longitude: _r6(c[1] + jlon),
                accuracy: acc,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null
            };
        }
        function makePos() {
            var c = pick();
            return {
                coords: c,
                timestamp: Date.now()
            };
        }
        var _clear = navigator.geolocation.clearWatch.bind(navigator.geolocation);
        var _watchTimers = Object.create(null);
        var _wid = 1;

        // [FIX geolocation-ignored-permissions-policy] The natives, captured before the
        // prototype is rewritten, for the case where the user has actually BLOCKED
        // geolocation on this origin. The patch used to answer with coordinates there too,
        // which overrides a decision the user made — a consent problem before it is a
        // fingerprinting one — and contradicts navigator.permissions, which reports the
        // real state for 'denied' (mw/mw-misc.js only claims 'granted' when the underlying
        // state is not a refusal; that gate is what makes the check below meaningful).
        //
        // Delegating rather than synthesising an error keeps the code, the message and the
        // timing the browser's own. The success path is still wrapped, so even if the
        // native somehow resolves, the page receives the profile's position and never the
        // device's. Nothing is delegated for 'prompt' or 'granted': those answer from the
        // profile as before, with no call into the platform's location service.
        var _origGet = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
        var _origWatch = navigator.geolocation.watchPosition.bind(navigator.geolocation);

        /** 'denied' / 'granted' / 'prompt' / '' when it cannot be read synchronously. */
        function _permThen(cb) {
            try {
                if (!navigator.permissions || !navigator.permissions.query) { cb(''); return; }
                var q = navigator.permissions.query({ name: 'geolocation' });
                if (!q || typeof q.then !== 'function') { cb(''); return; }
                q.then(function (st) { cb((st && st.state) || ''); }, function () { cb(''); });
            } catch (e) { cb(''); }
        }

        // [FIX geo-tostring-leak] All three methods were replaced with bare
        // functions.
        // Why it mattered: navigator.geolocation.getCurrentPosition.toString()
        // returned our real source, and the own properties were
        // {length,name,arguments,caller,prototype} instead of the native
        // {length,name}.
        // Now: masked through the same _mn every other module uses (see mw-core),
        // falling back to identity if the core somehow did not load — the same
        // approach as mw-adblock.js. .length is set to the native value: 1 for
        // getCurrentPosition (error/options are optional), 1 for watchPosition,
        // 1 for clearWatch.
        var _mnRef = (function() {
            try {
                var a = window.__AFP_MW__;
                if (a && typeof a.mn === 'function') return a.mn;
            } catch (e) {}
            return function(fn) { return fn; };
        })();

        // [FIX instance-own-property-lies] These went on the geolocation INSTANCE, which
        // natively has none — measured against stock Chromium: navigator.geolocation own
        // [] vs ours [getCurrentPosition, watchPosition, clearWatch]. Geolocation.prototype
        // is where the real ones live.
        var _geoProto = Object.getPrototypeOf(navigator.geolocation);
        function _geoDef(name, fn) {
            try {
                Object.defineProperty(_geoProto, name, {
                    value: fn, writable: true, configurable: true, enumerable: true
                });
            } catch (e) {}
        }
        _geoDef('getCurrentPosition', _mnRef(function getCurrentPosition(success, error = undefined, options = undefined) {
            _permThen(function (state) {
                if (state === 'denied') {
                    try {
                        _origGet(function () { try { setTimeout(success, 0, makePos()); } catch (e) {} }, error, options);
                    } catch (eD) {}
                    return;
                }
                // [FIX page-callbacks-ran-with-our-frame-on-the-stack] The callback is handed
                // to setTimeout DIRECTLY, with the position as a timer argument, instead of
                // being called from inside a closure of ours. It looks like a stylistic
                // change and it is not: whatever the page does in that callback runs on a
                // stack that includes every frame above it, so an Error the page constructs
                // there carried
                //
                //   at chrome-extension://<id>/mw-bundle.js:11223:51
                //
                // — measured, against a clean browser that shows only the page's own frames.
                // Sites build errors in geolocation callbacks routinely, so this leaked the
                // extension's ID on ordinary code, not on a probe. Scheduling `success`
                // itself leaves no frame of ours anywhere on that stack.
                //
                // The try/catch around the call is gone with the closure, and that is also
                // correct: a callback that throws now produces an uncaught error, which is
                // exactly what it does natively. Swallowing it was a second, quieter
                // difference from the platform.
                if (typeof success === 'function') {
                    setTimeout(success, 20, makePos());
                }
            });
        }));
        // [FIX watch-single-shot] Periodic updates, and clearWatch stops the timer.
        // watchPosition must return its id SYNCHRONOUSLY, so the permission read cannot gate
        // the return value the way it does above — it gates the callbacks instead. A watch
        // cleared before the read resolves must never fire, hence the _watchTimers check.
        _geoDef('watchPosition', _mnRef(function watchPosition(success, error = undefined, options = undefined) {
            var id = _wid++;
            _watchTimers[id] = 0;
            _permThen(function (state) {
                if (!Object.prototype.hasOwnProperty.call(_watchTimers, id)) return;
                if (state === 'denied') {
                    delete _watchTimers[id];
                    try {
                        _origWatch(function () { try { setTimeout(success, 0, makePos()); } catch (e) {} }, error, options);
                    } catch (eD) {}
                    return;
                }
                // Same reason as getCurrentPosition above: `success` is scheduled directly,
                // so no frame of ours is on the stack while the page's callback runs. The
                // repeat still recomputes the position each tick — our frame does that work
                // and then hands the callback to a fresh timer, which is what keeps the
                // value live without putting this file back into the page's stacks.
                if (typeof success === 'function') {
                    setTimeout(success, 20, makePos());
                    _watchTimers[id] = setInterval(function() {
                        try { setTimeout(success, 0, makePos()); } catch (e) {}
                    }, 15000);
                }
            });
            return id;
        }));
        // hasOwnProperty, not truthiness: a watch whose permission read has not resolved yet
        // holds the placeholder 0, and `if (_watchTimers[id])` would skip it — leaving the
        // pending callback free to start an interval for a watch the page had cleared.
        _geoDef('clearWatch', _mnRef(function clearWatch(id) {
            if (Object.prototype.hasOwnProperty.call(_watchTimers, id)) {
                try { if (_watchTimers[id]) clearInterval(_watchTimers[id]); } catch (e) {}
                delete _watchTimers[id];
            }
            try { _clear(id); } catch (e) {}
        }));
    } catch (e) {}
})();
