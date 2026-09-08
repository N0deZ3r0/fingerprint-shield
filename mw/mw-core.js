// mw-core.js — bootstrap (stealth, features, seed, ID, _mn)
(function () {
    'use strict';

    // Bag helpers MUST be first — resolve bag on every call (inject may arrive later)
    function _bagRef() {
        return {
            getProfile: _prof,
            applyProfile: function (p) {
                if (!p || typeof p !== 'object') return;
                _profVal = p;
                _persistFlags(p);
                try { document.dispatchEvent(new CustomEvent('ui:state', { detail: p })); } catch (e2) {}
            },
            getFeatures: function () { var p = _prof(); return (p && p.features) || null; },
            setFeatures: function () {},
            getMode: _bagMode,
            // [FIX default-config-still-left-two-keys] normal is the default and the
            // absence of the key already means normal — writing it would put a key on an
            // origin where a clean Chrome has none. Only 'stealth' says anything.
            setMode: function (m) { try { if (m === 'stealth') sessionStorage.setItem('v.ui.m', 'stealth'); else sessionStorage.removeItem('v.ui.m'); } catch (e) {} },
            // [FIX status-was-a-page-readable-key] The status set lives on a
            // non-enumerable window property now instead of sessionStorage. The long
            // form of why is in mw/mw-canvas-audio.js at its _statusMark; the short form
            // is that the old key was self-describing JSON naming every active module, on
            // an origin where a clean Chrome has no keys at all, and its only readers
            // (popup.js, the afp-*-console-check files) already read window.__w0/__w1 the
            // same way.
            getStatus: function () { try { return window.__t0 || {}; } catch (e) { return {}; } },
            markStatus: function (key) {
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
                } catch (e) {}
            },
            setApi: function () {}, getApi: function () { try { return window.__AFP_MW__ || null; } catch (e) { return null; } },
            setMn: function () {}, getMn: function () { try { var a = window.__AFP_MW__; return (a && a.mn) || null; } catch (e) { return null; } }
        };
    }
    // [FIX profile-readable-by-any-page] The profile used to live in
    // sessionStorage['v.ui.s'] — a fixed key, plain JSON, origin-shared. Three lines in a
    // page script read the whole substituted machine out of it: userAgent, GPU strings,
    // screen, cores, fonts, languages, timezone, the domain noise seed, the feature flags,
    // and profileId. That is worse than being detected: it hands a site the exact shape of
    // the lie, for free, with no need to probe anything. It also worked in reverse — the
    // page could WRITE that key and every module below would spoof to its dictation.
    //
    // It lives in this closure now. Nothing serialises it anywhere a page can look.
    //
    // The ceiling, stated plainly so nobody re-reads this as a promise it does not make:
    // we share one JS realm with the page, so the DELIVERY of a late profile
    // (background.js on tabs.onUpdated) is still a `ui:state` CustomEvent on `document`,
    // and a page that hooks dispatchEvent before that lands can read it off the event.
    // What is gone is the passive read: there is no longer a place to look, only a moment
    // to catch. Every early path — the cold start, the dyn/boot.js merge, this module's
    // own load — happens before the page's first script exists and cannot be caught at all.
    //
    // Two properties of the old reader are preserved deliberately:
    //   * liveness. `_prof()` is not a snapshot; the ui:state listener below reassigns
    //     _profVal, so every staleness fix in these files that depends on a late profile
    //     replacing an early one keeps working — see the #profile-staleness note at ID.
    //   * cost. The [FIX profile-reparsed-on-every-single-read] memo is now moot in the
    //     best possible way: no getItem, no JSON.parse, no string compare, just a closure
    //     read. dev-datecost.html measured the old path at ~430x native on getHours();
    //     the parse it was memoising away no longer happens at all.
    // Callers must still treat the result as READ-ONLY: it is shared between them.
    var _profVal = null;

    // The baton from profile-injector.js. Both are MAIN-world files of ONE manifest
    // content_scripts entry, so they run back to back in the same task: no page script can
    // execute between them (at document_start none exists yet), and the property is gone
    // again on the line after it is read. Same shape dyn/boot.js already uses for its
    // __AFP_BOOT_* markers, and for the same reason — a global that never outlives the
    // batch is not a global the page can find.
    try {
        var _b0 = window.__AFP_P0__;
        if (_b0 && typeof _b0 === 'object') _profVal = _b0;
    } catch (eBaton) {}
    try { delete window.__AFP_P0__; } catch (eBaton2) {}

    // Adopt-once, then wipe. Two writers put a profile in the old key and neither is
    // production code any more:
    //   * an OLDER BUILD of the extension, in a tab that was open across the upgrade —
    //     without this the first load after updating would drop to the neutral stub;
    //   * the dev-*.html pages, which seed a fixture profile there before loading
    //     mw/*.js and have no other way to reach this closure.
    // The removeItem runs unconditionally, so the key is empty by the time the page's
    // first script can look at it — including on the upgrade load that used it.
    if (!_profVal) {
        try {
            var _leg = sessionStorage.getItem('v.ui.s') || sessionStorage.getItem('__afp_last_profile__');
            if (_leg) _profVal = JSON.parse(_leg);
        } catch (eLegacy) {}
    }
    try { sessionStorage.removeItem('v.ui.s'); } catch (eWipe) {}
    try { sessionStorage.removeItem('__afp_last_profile__'); } catch (eWipe2) {}

    // ── the claimed screen can never be smaller than the real one ────────────────
    //
    // [FIX screen-smaller-than-the-window-was-refutable] A window cannot be wider than the
    // monitor it is on, and CSS layout is not ours to fake. The profile claimed 1920x1080
    // while the real window was 2008.5 CSS px wide, so every API was clamped to 1920 and
    // the page still laid out at the true width. Measured on a real Chrome:
    //
    //   innerWidth / outerWidth / clientWidth / visualViewport / screen.width   1920
    //   100vw, 50vw x2, width:100% on <html>, getBoundingClientRect             2008.5
    //
    //   document.documentElement.getBoundingClientRect().width !== innerWidth
    //
    // One line, no statistics, and it is REFUTABLE rather than merely unusual: the layout
    // proves the screen is at least 2008 wide, so the claim of 1920 is not a value a site
    // has to take on trust. Everything downstream clamps to this pair — screen.width and
    // availWidth here, sw()/sh() in the window-metrics block, matchMedia in mw-misc.js, the
    // child-frame screen in mw-navigator.js — so raising it HERE is what keeps CSS and JS
    // telling the same story ([FIX css-and-js-must-never-disagree]).
    //
    // Raised to the native screen exactly, not rounded up to some common resolution. Users
    // whose screen fits inside the profile's — the ordinary case — are untouched and keep
    // the full spoof, because the max is then the profile's own number. Only a machine that
    // is BIGGER than what the profile claims is affected, and there the alternative is not
    // "spoofed" versus "honest": it is a refutable lie versus the truth. Same reasoning as
    // the trusted-types stand-down: where the lie cannot be made coherent, do not tell it.
    //
    // Read before mw-timezone-screen.js patches `screen` — this file is third in the
    // bundle and that one is fourth — so these are the machine's own numbers, in every
    // frame, including the ones that get their profile late over ui:state.
    var _NATIVE_SW = 0, _NATIVE_SH = 0;
    try { _NATIVE_SW = screen.width | 0; _NATIVE_SH = screen.height | 0; } catch (eNS) {}
    //
    // BOTH dimensions move together, or neither does. Raising them independently is the
    // obvious version and it is wrong: a profile of 1366x768 on a 1280x1024 monitor would
    // come out as 1366x1024, a resolution no panel has ever shipped. A made-up resolution is
    // worse than the real one — it is unique instead of merely honest. So the test is
    // "does the claim CONTAIN the machine", and when it does not the machine's own pair is
    // reported whole, which is by construction a resolution that exists and by construction
    // large enough for any window on it.
    // [FIX the-dpr-claim-was-refutable-in-two-lines] The same rule, applied to the ratio.
    //
    // A claimed devicePixelRatio is answered by navigator, by window.devicePixelRatio and by
    // matchMedia — and NOT by the CSS engine, which no extension can reach (LIMITS item 8).
    // So on any machine whose real ratio differs from the profile's, a page proves the lie
    // with two lines:
    //
    //     devicePixelRatio === 1  &&  matchMedia('(min-resolution: 1.5dppx)').matches
    //
    // Measured on the author's machine, claim 1 against a host of 1.53, and the audit page
    // printed the disagreement itself: `(-webkit-min-device-pixel-ratio: 1.5)` and
    // `(min-resolution: 1.5dppx)` answered one way from matchMedia and the other from the
    // engine. Fingerprint Pro called that browser BrowserAutomationStudio, tampering 0.96,
    // while the same machine with the extension off parsed as clean Chrome 152.
    //
    // The screen already yields for exactly this reason, three paragraphs up: a refutable
    // lie is worse than the truth, because it is unique instead of merely honest. The ratio
    // is the same situation with a shorter refutation, so it yields too.
    //
    // What this costs: dpr stops being spoofed for anyone whose display ratio is not the
    // profile's. It is real entropy — a handful of values, 1 / 1.25 / 1.5 / 2 — and giving
    // it up is a loss. It buys removing a contradiction that no amount of patching can
    // close, which is the trade this file already made for the screen.
    var _NATIVE_DPR = 0;
    try { _NATIVE_DPR = Number(window.devicePixelRatio) || 0; } catch (eND) {}

    function _screenAtLeastNative(p) {
        if (!p || typeof p !== 'object') return p;
        try {
            // The ratio is judged on its own: the screen claim can hold while the ratio
            // does not, and a page reads them separately.
            if (_NATIVE_DPR > 0 && typeof p.devicePixelRatio === 'number' &&
                Math.abs(p.devicePixelRatio - _NATIVE_DPR) > 0.001) {
                p.devicePixelRatio = _NATIVE_DPR;
            }
            if (_NATIVE_SW <= 0 || _NATIVE_SH <= 0) return p;
            var w = p.screenWidth | 0, h = p.screenHeight | 0;
            if (w >= _NATIVE_SW && h >= _NATIVE_SH) return p;   // the claim contains the machine
            p.screenWidth = _NATIVE_SW;
            p.screenHeight = _NATIVE_SH;
        } catch (eSc) {}
        return p;
    }
    _screenAtLeastNative(_profVal);

    function _prof() { return _profVal; }

    // The one live channel. Until now `ui:state` was dispatched by three files and
    // listened to by NONE — a broadcast of the full profile into the page for the benefit
    // of nobody, while every consumer went back to sessionStorage. It is the delivery path
    // now: background.js publishes here on tabs.onUpdated, and profile-injector.js
    // re-publishes once dyn/boot.js has filled in the cold-start fields.
    try {
        document.addEventListener('ui:state', function (ev) {
            var next = ev && ev.detail;
            if (!next || typeof next !== 'object') return;
            // The late profile goes through the same clamp as the boot one: it arrives
            // ~300ms in and carries the same screenWidth/Height the cold-start skeleton had.
            _profVal = _screenAtLeastNative(next);
            _persistFlags(next);
        });
    } catch (eLive) {}

    // [FIX flags-lost-with-the-profile] _FEAT and _STEALTH are decided as this file loads,
    // and there is no later hook to correct them — _FEAT decides which patches get
    // installed at all. Everything else about the profile can arrive late, these two
    // cannot. They used to survive F5 by riding along in v.ui.s; dyn/boot.js cannot carry
    // them either, because it runs AFTER this file (measured — see the header of
    // dyn/boot.js). So the two survive on their own, and only the two: `v.ui.m` when the
    // mode is stealth, `v.ui.f` when the thirteen option toggles are not the defaults,
    // packed into a base-36 bitmask. Neither says anything about WHICH machine is being
    // presented — no UA, no GPU, no screen, no seed, no locale. That is the whole point of
    // the split: the identity is in the closure, and what stays readable is the user's own
    // settings.
    //
    // [FIX default-config-still-left-two-keys] And only when they are not the defaults. A
    // fresh install running normal mode with default flags now writes NOTHING, which is
    // what a clean Chrome has on a fresh origin — measured, extension off, zero keys. The
    // seed and the status set that used to sit beside them are gone entirely.
    //
    // [FIX feature-flags-arrived-three-hops-late] This is the THIRD writer of 'v.ui.f',
    // not the only one — storage-bridge.js writes it the moment it reads storage, and
    // background.js writes it with every inject, both through afpPackFeatures in
    // defaults.js. This copy exists because the MAIN world cannot importScripts (the same
    // reason _FEAT's defaults are duplicated below) and because it is the only writer that
    // sees a profile CHANGE mid-page. The encoding is the shared one: the bit order is the
    // key order of the defaults literal, which test-defaults.cjs pins to defaults.js.
    // [FIX default-config-still-left-two-keys] Neither key is written when it carries the
    // default. A clean Chrome stores NOTHING on a fresh origin — measured, extension off,
    // zero keys — so a key that only repeats the default is a free detector with no reader
    // that needed it: every reader already treats an absent value as the default, because
    // on the first load of a tab that is the only thing there is. The removeItem branches
    // matter as much as the setItem ones: sessionStorage outlives an Apply, so a user who
    // turns a flag off and back on would otherwise keep a stale key for the whole session.
    //
    // Same rule as afpPersistSelection in defaults.js, re-implemented for the same reason
    // the unpacking below is: the MAIN world cannot importScripts. _FEAT_DEFAULTS is the
    // untouched defaults literal, captured before the sessionStorage/profile/stealth
    // passes mutate it — comparing against _FEAT would compare against the answer.
    function _persistFlags(p) {
        try {
            if (p && p.mode === 'stealth') sessionStorage.setItem('v.ui.m', 'stealth');
            else if (p && p.mode) sessionStorage.removeItem('v.ui.m');
        } catch (eMd) {}
        try {
            var f = p && p.features;
            if (!f || typeof f !== 'object' || !_FEAT_KEYS || !_FEAT_DEFAULTS) return;
            var bits = 0, dbits = 0;
            for (var i = 0; i < _FEAT_KEYS.length; i++) {
                var k = _FEAT_KEYS[i];
                // _FEAT_SELECTED_REF, not _FEAT: on a trusted-types origin the latter has
                // had the worker-visible features forced off (see the stand-down note in
                // the _FEAT block). Persisting THAT would turn a forced, origin-local
                // coherence measure into what looks like the user's own switch positions.
                var sel = _FEAT_SELECTED_REF ? _FEAT_SELECTED_REF[k] : _FEAT[k];
                if (typeof f[k] === 'boolean' ? f[k] : sel) bits |= (1 << i);
                if (_FEAT_DEFAULTS[k]) dbits |= (1 << i);
            }
            if (bits === dbits) sessionStorage.removeItem('v.ui.f');
            else sessionStorage.setItem('v.ui.f', bits.toString(36));
        } catch (eFt) {}
    }
    var _FEAT_DEFAULTS = null;
    var _FEAT_KEYS = null;
    // [FIX a-switch-off-its-default-was-inert-on-the-first-load] False while the flags below
    // are the SHIPPED DEFAULTS rather than the user's — which is the state of every first
    // load of an origin, since 'v.ui.f' lives in sessionStorage and the cold-start profile
    // carries no `features` key. A module that must not be wrong on that load reads this to
    // decide whether it may settle the question at load time at all.
    var _FEAT_KNOWN = false;
    // The feature set as SELECTED (defaults + v.ui.f + profile + stealth), before the
    // trusted-types stand-down forces anything off. Only _persistFlags reads it.
    var _FEAT_SELECTED_REF = null;
    // [CLEANUP] _bagFeatures удалена — никогда не вызывалась; тот же доступ к
    // фичам делает _bagRef().getFeatures и напрямую _FEAT ниже.
    function _bagMode() {
        try {
            var p = _prof();
            if (p && p.mode) return p.mode;
            return sessionStorage.getItem('v.ui.m') || 'normal';
        } catch (e) { return 'normal'; }
    }

    // [FIX clientCode-p0-enumerable] Bare window.__p0 = true is enumerable →
    // CreepJS getClientCode() (Object.keys(window).slice(-50)) picks it up as
    // client litter → non-empty code hash. Keep the flag, hide from Object.keys.
    //
    // [FIX two-marker-names-where-one-would-do] This used to be a global of its own.
    // README "Limits" 17 records `__t0` AND `__p0` as names a page can test for, and hiding
    // either was MEASURED as worse than leaving it: a clean window has zero own symbols,
    // so a symbol key makes the count anomalous by itself and `Symbol.keyFor` hands the
    // name straight back; hiding from enumeration alone makes reachable / listed / `in`
    // disagree, which no browser does for any name. What was left to do was stop paying
    // twice. This flag marks a different STAGE from __t0 — "the bundle ran in this realm",
    // against profile-injector's status object merely existing — but a stage is a field,
    // not a global. One own name where there were two, same behaviour, and __t0 is
    // already defined non-enumerable in all six places that define it, so the Object.keys
    // hiding the note above is about is inherited rather than re-earned.
    //
    // The parent-side reader is the frame bridge in mw-canvas-audio; it moved with this.
    try {
        if (window.__t0 && window.__t0.p) return;
    } catch (eP0) {}
    try {
        var _st0p = window.__t0;
        if (!_st0p) {
            _st0p = {};
            try {
                Object.defineProperty(window, '__t0', {
                    value: _st0p, writable: true, configurable: true, enumerable: false
                });
            } catch (eD0) { window.__t0 = _st0p; }
        }
        _st0p.p = true;
    } catch (eDef) {}

    // STEALTH MODE: fewer patches → lower anti_detect / puppeteer_stealth score.
    // Applied per page load (toggle + Apply + reload). Live switch mid-page is not reliable.
    var _STEALTH = (function() {
        try {
            if (_bagMode() === 'stealth') return true;
            var _sp = _prof(); if (_sp && _sp.mode === 'stealth') return true;
            // [CLEANUP dead-attribute-readers] A `data-v-md` read sat here. Nothing writes
            // it any more, and it could never have fired anyway: every writer ran after
            // this file. The sessionStorage check below is the live one — and it is not
            // redundant with _bagMode(), which prefers the profile's own mode and would
            // answer 'normal' while 'v.ui.m' says 'stealth'.
            if (sessionStorage.getItem('v.ui.m') === 'stealth') return true;
        } catch (e) {}
        return false;
    })();
    try { if (_bagRef() && _bagRef().setMode) _bagRef().setMode(_STEALTH ? 'stealth' : 'normal'); } catch (e) {}

    /**
     * WHAT STEALTH FORCES, in one table.
     *
     * Read twice: once by the `_FEAT` block below, which decides what gets INSTALLED, and
     * once by `_featNow` further down, which decides what APPLIES. Those two moments are
     * different and the difference is a shipped bug class — `_STEALTH` is false on a tab's
     * first load, because the mode lives in per-tab sessionStorage and a fresh tab has none,
     * so the install-time answer is "normal" for one load and "stealth" for every load
     * after. [FIX stealth-first-load-noised-the-canvas] cured the canvas and the text
     * metrics that way; test/stealth.mjs then found connection, battery and geolocation
     * still doing it, in the same tab, measured:
     *
     *     connection.rtt       first load 50    second 100   (the host's)
     *     connection.downlink  first load 10    second 1.5
     *     battery.level        first load 0.7   second 1
     *     geolocation          first load a position, second ERR 1
     *
     * One table rather than a literal in each place, because a list written twice is a list
     * that drifts — the lesson of [FIX three-copies-of-one-judgement]. Every entry here was
     * argued on its own and they must never be flipped as a batch; the arguments live in
     * the comment above the `if (_STEALTH)` line below and in the modules themselves.
     */
    var _STEALTH_FEAT = {
        canvas: false, geolocation: false, battery: false, fonts: false,
        clientRects: false, plugins: false, network: false, hideAdBlocker: false,
        navigator: true, screen: true, timezone: true, webgl: true
    };

    // Feature flags from profile (options). Fallback MUST match defaults.js AFP_DEFAULT_FEATURES
    // (MAIN world cannot importScripts). Verified by: node test-defaults.cjs
    var _FEAT = (function() {
        var d = {
            canvas: true, webgl: true, webrtc: true,
            navigator: true, screen: true, timezone: true, geolocation: true,
            battery: true, fonts: true, clientRects: false, plugins: true,
            network: true, hideAdBlocker: true
        };
        // Bit order for `v.ui.f` is this literal's key order — see _persistFlags. It is
        // the same order defaults.js declares, and test-defaults.cjs already fails if the
        // two files disagree, so the packing cannot silently reinterpret itself.
        _FEAT_KEYS = Object.keys(d);
        // The untouched defaults, kept for _persistFlags: everything below mutates `d`
        // (sessionStorage, then the profile, then the stealth override), so by the end it
        // is the ANSWER, not the baseline to compare an answer against.
        _FEAT_DEFAULTS = {};
        for (var _dk = 0; _dk < _FEAT_KEYS.length; _dk++) _FEAT_DEFAULTS[_FEAT_KEYS[_dk]] = d[_FEAT_KEYS[_dk]];
        // Lowest precedence: last load's toggles, the only thing that survives F5 now.
        // A profile below overrides it whenever one is actually here.
        try {
            var packed = sessionStorage.getItem('v.ui.f');
            if (packed) {
                var bits = parseInt(packed, 36);
                if (isFinite(bits)) {
                    for (var bi = 0; bi < _FEAT_KEYS.length; bi++) {
                        d[_FEAT_KEYS[bi]] = !!(bits & (1 << bi));
                    }
                    // [FIX a-switch-off-its-default-was-inert-on-the-first-load] Whether
                    // these flags were CARRIED or merely defaulted is itself a fact the
                    // modules need — see _featNow below.
                    _FEAT_KNOWN = true;
                }
            }
        } catch (ePk) {}
        try {
            var p = _prof();
            if (p && p.features && typeof p.features === 'object') {
                Object.keys(d).forEach(function(k) {
                    if (typeof p.features[k] === 'boolean') d[k] = p.features[k];
                });
                _FEAT_KNOWN = true;
            }
            // [CLEANUP dead-attribute-readers] A `data-v-ft` block stood here, parsing the
            // flags out of <html>. It was doubly dead: nothing writes the attribute any
            // more, and this file reads it as it LOADS, before dyn/boot.js or the async
            // storage-bridge callback could ever have set it. 'v.ui.f' above is the
            // carrier that actually survives a reload.
        } catch (e) {}
        // [STEALTH=minimal]
        // [FIX stealth-webgl-profile] webgl stays ON in stealth so UNMASKED_* come from
        // the profile (Iris Xe etc.), not the real GPU (Arc). Without this the whole
        // GPU legend collapses in stealth. Still off: canvas/audio noise, geo…
        //
        // [FIX stealth-turned-the-webrtc-switch-into-a-decoration] `d.webrtc = false` stood
        // in this list, and it is the one entry that contradicted something the UI keeps
        // promising: the popup's per-site WebRTC switch is drawn ON by default and says
        // "защита включена", while in stealth the whole block in mw-misc.js was skipped and
        // the real WAN address was readable through all three channels. Measured on the rig
        // with a STUN server answering — and only from the SECOND load of a tab, because
        // `v.ui.m` does not exist before one, which is why it reads as intermittent.
        //
        // It is also the wrong trade for stealth itself. What the patch costs is three
        // accessors, masked through _mn like every other one this extension owns. What it
        // buys is the absence of a srflx candidate naming the host's real WAN IP while the
        // HTTP request arrives from a proxy — a contradiction between two channels, which
        // is the class of signal stealth mode exists to avoid (same reasoning as the voices
        // gate). A browser that answers no STUN is an ordinary browser behind a firewall;
        // a browser whose IP disagrees with itself is not.
        //
        // The global option toggle still governs — a user who turns WebRTC off in the
        // options page keeps it off in both modes, and the per-site switch decides the rest.
        if (_STEALTH) { for (var _sk in _STEALTH_FEAT) d[_sk] = _STEALTH_FEAT[_sk]; }
        // [FIX tt-standdown-split-window-from-worker] The coherent stand-down.
        //
        // The gate is `v.ui.tt` — the origin's CSP restricts Trusted Types policy NAMES —
        // and NOT `v.ui.tte`, enforcement. The two come apart and the difference matters:
        // a document can require TrustedScriptURL while naming no allowlist at all (youtube
        // is that shape), and there createPolicy succeeds, the worker IS patched, and there
        // is nothing to stand down from. Only a NAME allowlist leaves us unable to mint one
        // — see the long note in mw/mw-workers.js about why borrowing the page's policy is
        // not an option — and there the worker runs unpatched while the window went on
        // spoofing. Measured on a real Chrome, one document, four contradictions:
        //
        //              window          worker
        //   cores      8               18
        //   memory     8               16
        //   timezone   Europe/Tallinn  Europe/Moscow
        //   language   et-EE           ru-RU
        //
        // A browser that disagrees with itself is a stronger signal than one that simply
        // reports its machine — the same reasoning that already makes mw-adblock go quiet
        // when the network refuses ad requests ([FIX adblock-mask-contradicted-the-network]),
        // where masking on alone fired 4 of 13 detectors on an impossible pair.
        //
        // Only the features a WORKER can actually contradict are dropped. plugins, screen,
        // battery, geolocation, clientRects and hideAdBlocker have no worker-side reader —
        // WorkerNavigator has no plugins and there is no screen or DOM there — so they stay
        // on and keep protecting.
        //
        // What this costs is real and worth stating plainly: on such an origin the six
        // features below stop protecting. What it buys is that the browser stops contradicting
        // itself there, which is the signal a scorer actually acts on — Cloudflare's challenge
        // frame is exactly such an origin, and it is where this was measured.
        //
        // Residual, and it is the documented shape of every per-site flag here: the header is
        // learned by background.js and reaches the page through storage, so the very first
        // load of an origin can still split. From the second on it is coherent. See
        // [FIX per-site-flags-need-live-reads].
        var _FEAT_SELECTED = {};
        for (var _sk = 0; _sk < _FEAT_KEYS.length; _sk++) _FEAT_SELECTED[_FEAT_KEYS[_sk]] = d[_FEAT_KEYS[_sk]];
        try {
            if (_cspFlagOn('v.ui.tt')) {
                var _wkVisible = ['navigator', 'timezone', 'canvas', 'webgl', 'fonts', 'network'];
                for (var _wv = 0; _wv < _wkVisible.length; _wv++) d[_wkVisible[_wv]] = false;
            }
        } catch (eStd) {}
        // _FEAT_SELECTED, not d: what gets persisted to 'v.ui.f' must stay the user's
        // SELECTION. Persisting the stand-down would make it survive into the next load of
        // that origin as though the switches had been turned off by hand, and it would still
        // be there after the site relaxed its CSP.
        _FEAT_SELECTED_REF = _FEAT_SELECTED;
        try { if (_bagRef() && _bagRef().setFeatures) _bagRef().setFeatures(d); } catch (e) {}
        return d;
    })();



    // Захватываем нативный Date ДО любого патчинга — используется вместо iframe.
    // Iframe вызывал оценку CSP страницы и спам в консоли (unrecognized 'webrtc' directive).
    var _RawDate = Date;
    // [FIX the-standdown-never-fired] Captured here for the same reason _RawDate is: this
    // file is the first module in the bundle, so Intl is still the platform's. The
    // stand-down needs the HOST's zone and locale, and by the time it is consulted
    // mw-timezone-screen.js has replaced Intl.DateTimeFormat outright.
    var _NativeDTF = null;
    try { _NativeDTF = Intl.DateTimeFormat; } catch (eDtf) {}
    //
    // RESOLVED EAGERLY, and it has to be. The first version read it lazily, on the first
    // stand-down, which is long after mw-timezone-screen.js has patched
    // DateTimeFormat.prototype.resolvedOptions — and that patch asks _getTimezone() for the
    // zone, which asks this, which called the patch again. Infinite recursion, swallowed by
    // the catch, cached as {} forever: the stand-down looked live (sd true) while the zone
    // stayed spoofed. One construction at document_start instead, before anything is
    // patched, and the recursion cannot exist.
    var _hostIntl = {};
    try { _hostIntl = new _NativeDTF().resolvedOptions() || {}; } catch (eR) {}
    // [FIX the-frames-host-was-the-parents-spoof] A same-origin iframe's first navigation
    // REUSES the Window of its initial about:blank document, and the parent has patched
    // that realm's Intl by then (mw-navigator's frame patch, on the profile — the parent
    // had not stood down yet). So "the platform's Intl" this file captures at the frame's
    // document_start was already the profile, the frame's stand-down answered the
    // profile as the host, and the window at Europe/Moscow sat beside its frame at
    // America/New_York with both claiming to stand down (measured, test/wbcoherence.mjs
    // /wb/ visit 1). The host is one machine for every realm of a tab: a same-origin
    // frame takes the parent's capture, made in a realm nothing had patched, and every
    // realm publishes its own on __t0 for the frames below it.
    // [FIX the-host-capture-was-readable-on-the-marker] The first version put the capture
    // on __t0 as a plain property, and __t0 is a KNOWN marker (the audit lists it): the
    // host's real zone and locale, readable by any page as window.__t0.hi — the one thing
    // this extension exists to hide, published by the fix for a frame split. So it is a
    // getter that answers only when the CALLER is this bundle, decided from V8's CallSite
    // objects rather than the stack string: prepareStackTrace is set for the duration of
    // one construction, so the file name of the frame two below is V8's own and cannot be
    // forged by a page's prepareStackTrace or by a thrown error with a made-up stack. A
    // page that has made prepareStackTrace read-only, or set stackTraceLimit to 0, gets
    // undefined — the frame then captures for itself, which is the old behaviour, never a
    // leak.
    var _SELF_URL = (function () {
        try {
            var m = String(new Error().stack).match(/chrome-extension:\/\/[a-p]{32}\/[^:\s)]+/);
            return m ? m[0] : null;
        } catch (e) { return null; }
    })();
    function _callerIsOurs() {
        if (!_SELF_URL) return false;
        var E = Error, saved, had = false, ok = false;
        try {
            had = Object.prototype.hasOwnProperty.call(E, 'prepareStackTrace');
            saved = E.prepareStackTrace;
            // Masked like every function this file hands out, though it lives for one construction.
            E.prepareStackTrace = _mn(function prepareStackTrace(err, sites) { return sites; });
            var sites = new E().stack;
            var site = sites && sites[2];
            var f = site && typeof site.getFileName === 'function' ? site.getFileName() : null;
            ok = !!f && f === _SELF_URL;
        } catch (e) { ok = false; }
        try { if (had) E.prepareStackTrace = saved; else delete E.prepareStackTrace; } catch (e2) {}
        return ok;
    }
    try {
        if (window.parent !== window) {
            var _phi = window.parent.__t0 && window.parent.__t0.hi;
            if (_phi && typeof _phi === 'object' && _phi.timeZone) _hostIntl = _phi;
        }
    } catch (eInh) {}
    try {
        var _st0 = window.__t0;
        if (_st0 && typeof _st0 === 'object') {
            Object.defineProperty(_st0, 'hi', {
                get: function () { return _callerIsOurs() ? _hostIntl : undefined; },
                configurable: true, enumerable: false
            });
        }
    } catch (ePub) {}
    function _hostResolved() { return _hostIntl; }

    // [FIX seed-not-actually-session-stable] Раньше seed хранился в
    // sessionStorage — а sessionStorage per-origin И per-tab, а не общий на
    // "всю сессию браузера", как утверждал старый комментарий. Открыть
    // новую вкладку на тот же сайт, или просто зайти на ДРУГОЙ домен —
    // и seed уже другой, хотя весь остальной профиль (timezone/WebGL/
    // fonts/hwConcurrency и т.д.) читается из chrome.storage.local и
    // стабилен everywhere. Итог: сервис, который уже отслеживает "того же
    // посетителя" по другим сигналам (IP и т.п.), видит стабильный профиль
    // ПОВЕРХ нестабильного canvas/audio/timing отпечатка между визитами —
    // это внутренняя нестыковка, которую легко ловить как признак подмены
    // (тот же класс проблемы, что CheckIntegrity для canvas, просто на
    // уровне "тот же визит vs другой визит", а не "блок vs по пикселю").
    // Теперь seed в первую очередь читается из _prof().noiseSeed —
    // того же объекта, что background.js кладёт в chrome.storage.local и
    // инжектит на каждой странице, той же природы, что и остальной профиль.
    // sessionStorage остаётся ТОЛЬКО как временный fallback на случай, если
    // страница читает canvas раньше, чем асинхронный inject от background.js
    // успел прийти (тот же паттерн, что _getTimezone ниже — деградация до
    // дефолта, а не падение).
    // [FIX seed-race-mid-page-flip] Раньше эта функция заново проверяла
    // _prof().noiseSeed на КАЖДОМ вызове. Профиль приходит
    // асинхронно от background.js (~300ms после навигации, через
    // chrome.scripting.executeScript — тот же класс задержки, что уже
    // задокументирован и обойдён в этом файле для timezone). Вызов ДО
    // прихода профиля падал на sessionStorage-fallback (случайный seed),
    // а следующий вызов НА ТОЙ ЖЕ странице, сделанный ПОСЛЕ прихода профиля,
    // подхватывал уже другой, настоящий noiseSeed — два разных seed в рамках
    // одной загрузки страницы давали два разных набора шумовых дельт для
    // одного и того же элемента. Детектор, вызывающий getBoundingClientRect()
    // и "до", и "после" загрузки DOM (ровно так делают тесты вроде
    // BrowserLeaks ClientRects), видел это как "фингерпринт элемента
    // меняется между вызовами" → помечал как "spoofed by random noise: true".
    // Если же профиль успевал прийти до ОБОИХ вызовов (или уже был закеширован
    // с прошлой загрузки той же вкладки) — оба вызова получали одинаковый
    // seed → детектор видел "false". Итог целиком зависел от таймингов
    // конкретной загрузки, не от какой-либо настройки. Теперь seed
    // резолвится РОВНО ОДИН РАЗ за загрузку страницы (мемоизация в
    // module-level переменной — тот же паттерн, что уже используют _pnSeed/
    // _seed в этом же файле для audio/perf-noise) — все вызовы в рамках
    // одной загрузки получают одно и то же значение, независимо от того,
    // успел ли профиль прийти к моменту первого вызова.
    // [FIX seed-hard-lock] First resolution wins for the entire page load.
    // Never switch mid-page (fallback → profile) — that caused canvas/DOMRect
    // hash flips between early and late measurements.
    var _resolvedSessionSeed = null;
    // [FIX provisional-seed-was-locked-forever]
    //
    // The lock below exists so canvas output cannot change under a page mid-life, and that
    // is right — but it used to lock whatever it resolved FIRST, including the host-hash
    // fallback invented when no profile had arrived yet, because dyn/boot.js shipped no
    // noiseSeed. It ships one now ([FIX seed-was-a-named-page-readable-key]: the master
    // arrives as dyn/ns/<hex>.js file names and boot.js derives the per-domain value), and
    // boot.js runs before the page does — so on a normal load the FIRST resolution here is
    // already the authoritative number and the provisional path below never runs at all.
    // It is kept for the case it was written for: the residual window on the very first
    // navigation of a browser session, before the dynamic registration exists.
    //
    // From then on the window had TWO seeds and the worker a third: the JS canvas path kept
    // the provisional one, the WASM path (loaded ~300ms later by background.js) used the
    // real domain seed, and the worker payload read the profile directly. The visible result
    // is one line of a scope comparison — canvas differs between Window and
    // Dedicated/Shared while ua, platform, fonts, gpu, hardware, tz and langs all match.
    // Measured on a first load: window 2135e950 against worker 4064a550.
    //
    // A provisional value is now marked as such and REPLACED the moment the profile brings
    // the authoritative seed; only that one gets locked. Draws that already happened before
    // the profile existed cannot be undone by any choice of seed — what this guarantees is
    // that every scope converges on the same number as soon as there is a right answer.
    var _seedProvisional = false;
    function _getSessionSeed() {
        if (_resolvedSessionSeed !== null && !_seedProvisional) return _resolvedSessionSeed;

        var pf = _prof();
        if (pf && typeof pf.noiseSeed === 'number') {
            _resolvedSessionSeed = pf.noiseSeed >>> 0;
            _seedProvisional = false;
            return _resolvedSessionSeed;
        }
        // A provisional value stays until the PROFILE upgrades it, above.
        if (_resolvedSessionSeed !== null) return _resolvedSessionSeed;
        // [CLEANUP dead-attribute-readers] Two `data-v-ns` reads stood here — this
        // document's, then the PARENT frame's, the latter being how a same-origin iframe
        // used to inherit an already-locked domain seed. Nothing publishes the attribute
        // any more ([FIX bridge-attributes-were-an-extension-detector]): it was the last
        // real VALUE the extension left on the DOM, and a clean browser has no attributes
        // on <html> at all, so it doubled as a one-line extension detector.
        //
        // Neither read is replaced by anything new. A frame gets the same number by
        // construction instead of by reaching across the boundary: its own copy of
        // storage-bridge.js derives the domain seed from effectiveHostname(), which
        // already prefers the parent's host for blank/sandbox/srcdoc frames, and the
        // KEY below is shared by every same-origin scope in the tab.
        //
        // Measured after removal — one drawing, one hash in all five scopes (top window,
        // same-origin iframe, srcdoc, scriptless sandbox frame, dedicated worker), on a
        // cold tab and again after F5.
        // [FIX seed-was-a-named-page-readable-key] A sessionStorage read stood here, of a
        // key called afp_noise_seed_fallback. It named the extension and its value WAS the
        // per-domain seed, on the page's own origin — and the canvas noise is positional
        // and deterministic, so a page holding that number can rebuild the mask and
        // subtract it. It is not read and not written anywhere any more; the seed arrives
        // through dyn/boot.js before the page runs, and reaches this closure by the
        // ui:ready listener at the bottom of this block and by _prof() above.
        // Deterministic host fallback — no Math.random (cross-reload stable if profile late)
        // Prefer parent host for blank/sandbox frames (ancestorOrigins is cross-origin readable).
        var host = '';
        try { host = location.hostname || ''; } catch (eH) {}
        if (!host) {
            try {
                var ao = location.ancestorOrigins;
                if (ao && ao.length) {
                    for (var ai = 0; ai < ao.length; ai++) {
                        try {
                            var ah = new URL(ao[ai]).hostname;
                            if (ah) { host = ah; break; }
                        } catch (eAo) {}
                    }
                }
            } catch (eAo2) {}
        }
        if (!host) {
            try {
                if (document.referrer) host = new URL(document.referrer).hostname || '';
            } catch (eRef) {}
        }
        var s = 0xA5A5A5A5;
        for (var i = 0; i < host.length; i++) {
            s = Math.imul(s ^ host.charCodeAt(i), 0x01000193) >>> 0;
        }
        // Not published to the DOM — see the note above.
        // Provisional: nothing authoritative has been seen yet. Same-origin iframes and any
        // worker created right now still read this exact number, so every scope agrees while
        // it lasts — but it is replaced, not kept, once the profile brings the real one.
        _resolvedSessionSeed = s;
        _seedProvisional = true;
        return s;
    }
    // Optional: if profile arrives before any noise call, warm the lock early
    try {
        document.addEventListener('ui:ready', function() {
            if (_resolvedSessionSeed !== null) return; // already locked
            var pf = _prof();
            if (pf && typeof pf.noiseSeed === 'number') {
                _resolvedSessionSeed = pf.noiseSeed >>> 0;
            }
        });
    } catch(e) {}

    // Базовый список Windows-шрифтов — используется в FONTS и measureText
    var _BASE_FONTS = [
        'arial','arial black','calibri','cambria','candara','comic sans ms','consolas',
        'constantia','corbel','courier new','georgia','impact','lucida console',
        'lucida sans unicode','microsoft sans serif','palatino linotype','segoe ui',
        'segoe ui variable','tahoma','times new roman','trebuchet ms','verdana','wingdings'
    ];

    var _getTimezone = function() {
        // One _prof() call, not two. `_prof() && _prof().timezone` read the profile
        // twice to get one field, and this is the hottest accessor in the extension —
        // every zone-aware Date and Intl answer goes through it.
        // [FIX the-standdown-never-fired] The single choke point for the zone, which is
        // why the stand-down sits here rather than in the eight wrappers downstream: on an
        // origin where a worker cannot be patched, every zone-aware Date and Intl answer
        // must be the host's, or the window contradicts a worker that has no choice.
        try {
            if (_standDownNow()) {
                var hz = _hostResolved().timeZone;
                if (hz) return hz;
            }
        } catch (eSdTz) {}
        var p = _prof();
        return (p && p.timezone) || 'America/New_York';
    };

    // [FIX #profile-staleness] Раньше: var ID = _prof() захватывал ССЫЛКУ
    // на объект профиля один раз, в момент document_start. profile-injector.js успевает
    // выставить только временный generic-профиль к этому моменту; реальный выбранный
    // пользователем профиль background.js присылает на ~300ms позже через
    // _prof() = p (НОВЫЙ объект, не мутация старого). Поскольку ID
    // продолжал указывать на старый объект, hardwareConcurrency/deviceMemory/platform/
    // webgl vendor&renderer&params/screen width&height/language/languages так и оставались
    // равны generic-дефолту до следующей полной перезагрузки страницы — то есть кнопка
    // "Apply Changes" в попапе не работала для профиля устройства на уже открытой вкладке,
    // а первая загрузка нового домена в сессии получала рассинхронизированный fingerprint
    // (TZ — от выбранной страны, GPU/cores — от дефолта).
    //
    // Фикс: ID — Proxy, который при каждом обращении читает АКТУАЛЬНЫЙ
    // _prof() и подставляет _DEFAULT_PROFILE только для отсутствующих полей.
    // [FIX chrome-major-fallback-disagreed-across-files] This read '148' while every other
    // fallback in the extension reads '151' — background.js afpChromeMajor, mw-navigator's
    // _chromeMajor, the worker payload's _chMajor and profile-injector's cold-start UA. It
    // is only reached when navigator.userAgent carries no Chrome/<n> at all, but there the
    // window would have claimed Chrome 148 while the header, the worker and the cold start
    // all claimed 151 — a split of exactly the kind this file's own DEFAULT_PROFILE exists
    // to avoid. One number, and it is the one everyone else already uses.
    var _cv = '151';
    try { var _m = navigator.userAgent.match(/Chrome\/(\d+)/); if (_m) _cv = _m[1]; } catch(e) {}
    var _DEFAULT_PROFILE = {
        // colorDepth 24 — see [FIX color-depth-was-a-value-chrome-never-reports] in
        // background.js. Chrome on Windows never reports 32.
        screenWidth: 1920, screenHeight: 1080, colorDepth: 24, devicePixelRatio: 1,
        platform: 'Win32', hwConcurrency: 8, deviceMemory: 8,
        webdriver: false, vendor: 'Google Inc.',
        // [FIX languages] Парсим полный список из Accept-Language строки
        language: 'en-US',  // [FIX] navigator.language = первый язык, не полная Accept-Language строка
        languages: (function(s) { return s.split(',').map(function(p) { return p.trim().split(';')[0].trim(); }); })('en-US,en;q=0.9'),
        locale: 'en-US',
        countryCode: 'US',
        doNotTrack: null, maxTouchPoints: 0, pdfViewerEnabled: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + _cv + '.0.0.0 Safari/537.36',
        // [FIX appVersion] appVersion не начинается с "Mozilla/" — как в background.js
        appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + _cv + '.0.0.0 Safari/537.36',
        webglVendor: 'Google Inc. (Intel)',
        webglRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        webgpuVendor: 'intel',
        webgpuArchitecture: 'xe-lpg',
        webgpuDevice: '',
        webgpuDescription: '',
        timezone: 'America/New_York',
        // [FIX clientHints] Убраны brands/uaFullVersion/fullVersionList — браузер сам их отдаёт,
        // подмена создаёт расхождение с реальным UA. Структура синхронизирована с background.js.
        clientHints: { platform: 'Windows', mobile: false, platformVersion: '10.0.0', architecture: 'x86', bitness: '64', wow64: false, model: '', formFactors: ['Desktop'] },
        mediaDevices: [{ kind: 'audioinput', label: '', deviceId: 'default-a', groupId: 'default-0' }, { kind: 'audiooutput', label: '', deviceId: 'default-o', groupId: 'default-0' }, { kind: 'videoinput', label: '', deviceId: 'default-v', groupId: 'default-0' }],
        allowedFonts: [
            'Arial', 'Arial Black', 'Arial Narrow', 'Bahnschrift', 'Calibri', 'Calibri Light', 'Cambria',
            'Cambria Math', 'Candara', 'Candara Light', 'Comic Sans MS', 'Consolas', 'Constantia',
            // Dubai family removed — see the note on allowedFonts in background.js.
            'Corbel', 'Corbel Light', 'Courier New', 'Ebrima',
            'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'Haettenschweiler', 'Impact',
            'Ink Free', 'Javanese Text', 'Leelawadee UI', 'Leelawadee UI Semilight', 'Lucida Bright',
            'Lucida Console', 'Lucida Sans', 'Lucida Sans Unicode', 'Malgun Gothic', 'Marlett',
            'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft JhengHei UI', 'Microsoft New Tai Lue',
            'Microsoft PhagsPa', 'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei',
            'Microsoft YaHei UI', 'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti',
            'Monotype Corsiva', 'MS Gothic', 'MS UI Gothic', 'MV Boli', 'Myanmar Text', 'Nirmala UI',
            'Nirmala UI Semilight', 'Palatino Linotype', 'Pristina', 'Segoe MDL2 Assets', 'Segoe Print',
            'Segoe Script', 'Segoe UI', 'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Light',
            'Segoe UI Symbol', 'Segoe UI Variable', 'SimSun', 'SimSun-ExtB', 'Sitka', 'Sitka Banner',
            'Sitka Display', 'Sitka Heading', 'Sitka Small', 'Sitka Subheading', 'Sitka Text', 'Sylfaen',
            'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic',
            'Yu Gothic UI'
        ],
        webglParams: {}
    };

    var ID;
    try {
        ID = new Proxy({}, {
            get: function(target, prop) {
                var live = _prof();
                if (live && live[prop] !== undefined) return live[prop];
                return _DEFAULT_PROFILE[prop];
            },
            has: function(target, prop) {
                var live = _prof();
                return (live && live[prop] !== undefined) || (prop in _DEFAULT_PROFILE);
            }
        });
    } catch(e) {
        // Proxy недоступен (крайне маловероятно в MV3/Chrome 111+) — деградируем
        // до старого поведения с одноразовым снимком профиля.
        ID = _prof() || _DEFAULT_PROFILE;
    }

    // [FIX own-property-fingerprint] Раньше _mn ставил fn.toString/fn.toSource/
    // fn.__afp_native__/fn.__afp_native_str__ ПРЯМО на функцию — то есть
    // hasOwnProperty('toString') на любой запатченной функции возвращал true,
    // хотя у настоящей нативной функции toString не является own-свойством
    // вообще (наследуется через Function.prototype.toString). Плюс
    // Object.getOwnPropertyNames(fn) прямо показывал __afp_native__/
    // __afp_native_str__ — буквально имя нашего маркера, читаемое любым
    // сайтом простым перечислением свойств. toSource в Chrome/V8 не
    // существует вообще ни у одной функции (легаси SpiderMonkey-специфика,
    // никогда не было в V8) — наличие toSource где бы то ни было само по
    // себе аномалия в Chrome-окружении.
    //
    // [FIX arguments-caller-prototype-fingerprint] Даже после первого фикса
    // (WeakSet/WeakMap вместо own-свойств) Object.getOwnPropertyNames(fn) на
    // ЛЮБОЙ обычной function-декларации всё равно показывал arguments/
    // caller/prototype — то, чего у настоящей нативной функции нет вообще
    // (только length/name). Убрать это простым перечислением own-свойств
    // самой функции НЕЛЬЗЯ: у обычной function-декларации arguments/caller/
    // prototype — НЕконфигурируемые собственные свойства, а спека Proxy
    // прямо запрещает ownKeys/getOwnPropertyDescriptor скрывать
    // неконфигурируемые свойства ЦЕЛИ (это проверил эмпирически — попытка
    // кинула TypeError "trap result did not include 'arguments'").
    // Обходной путь: целью Proxy делаем не саму функцию с реальной логикой,
    // а posторонний, безобидный НАТИВНЫЙ донор формы — у него И БЕЗ ТОГО
    // только {length, name}, оба конфигурируемы, никаких arguments/caller/
    // prototype. apply-ловушка всё равно вызывает РЕАЛЬНУЮ функцию fn, а не
    // донора — донор нужен только ради его формы свойств. length/name
    // ловушками подменяются на нужные нам значения.
    // Проверено (для копии этой логики): Object.getOwnPropertyNames даёт
    // ровно ['length','name'] как у настоящей нативной; .arguments/.caller
    // кидают ТУ ЖЕ ошибку, что и у настоящей нативной (унаследовано через
    // Function.prototype — это не баг, а точное соответствие); .prototype
    // === undefined, как у non-constructor; new fn() кидает
    // "X is not a constructor" с текстом места вызова, как у нативной;
    // .call()/.apply()/вызов как метода объекта (obj.method()) корректно
    // прокидывают динамический this в реальную логику; интеграция с
    // Function.prototype.toString ниже по файлу не пострадала — this там
    // будет ссылкой на сам Proxy, который мы регистрируем в _nativeFns.
    var _nativeFns = new WeakSet();
    // Captured once, before anything can replace it: _mn used to re-read
    // Function.prototype.toString on every call.
    var _TRUE_FN_TOSTRING = Function.prototype.toString;
    // [FIX extension-pattern-hash] CreepJS "Pattern" / Privacy Possum:
    // один и тот же Proxy-target на всех _def/_mn геттерах → один hash
    // (hardwareConcurrency === availWidth === colorDepth === …). Нужна
    // РАЗНАЯ цель у каждого прокси.
    //
    // [FIX shared-native-donor-proto-detect] Раньше целями были ОБЩИЕ настоящие
    // билтины (Object.prototype.hasOwnProperty, Array.prototype.push, …) по
    // кругу. Из-за этого нельзя было отдать движку операции с прототипом: запись
    // [[Prototype]] ушла бы прямо в реальный билтин, общий для всех прокси и для
    // самой страницы. Приходилось подделывать getPrototypeOf/setPrototypeOf
    // (см. удалённые трапы в _mn), а подделка ловится: CreepJS делает
    //   p = new Proxy(fn, {}); p.__proto__ = p; p++
    // У НАСТОЯЩЕЙ функции запись реально создаёт цикл в графе прототипов, и
    // ToPrimitive внутри p++ уходит в бесконечный обход → RangeError
    // («Maximum call stack size exceeded»), а RangeError для CreepJS — НЕ ложь.
    // Наш поддельный трап цикла не создавал, рекурсии не было, и p++ спотыкался
    // о `const proxy2` в самом CreepJS → TypeError → ложь
    // «failed at chain cycle __proto__ error» (и вся группа proxy-проверок,
    // которая включается для свойств с именем toString).
    //
    // Решение: цель — СВОЯ на каждый вызов и создаётся как краткий метод
    // объекта. У краткого метода own-свойства ровно {length, name} — как у
    // нативного билтина (у обычной function-декларации есть ещё prototype,
    // см. проверку ниже), он не конструктор, а его length/name конфигурируемы.
    // При этом цель приватная, так что операции с [[Prototype]] можно отдать
    // движку как есть — и цикл ведёт себя нативно (проверено: RangeError у
    // обеих сторон). Заодно уникальная цель у каждого прокси убирает
    // pattern-hash лучше, чем ротация 20 доноров.
    // ВАЖНО: именно синтаксис краткого метода `{ [nm]() {} }`. Присваивание
    // `holder[nm] = function(){}` даёт обычное функциональное выражение, у
    // которого own-свойство prototype ЕСТЬ — то есть ownKeys перестал бы
    // совпадать с нативным и появилась бы ровно та утечка, от которой уходим.
    function _freshTarget(name) {
        var nm = name || 'fn';
        try {
            var holder = { [nm]() {} };
            return holder[nm];
        } catch (e) {
            return ({ fn() {} }).fn;
        }
    }
    // [FIX ctor-toString-own-property] Раньше конструкторы (Date, Intl.*)
    // получали toString через ПРЯМОЙ Object.defineProperty(Ctor, 'toString', {value:...}) —
    // тот же класс утечки, от которого уходит остальной файл через _mn: у
    // настоящего нативного конструктора toString НЕ является own-свойством
    // (наследуется через Function.prototype.toString), а тут — являлся.
    // Object.getOwnPropertyNames(Date) включал бы 'toString' — отличимо от
    // настоящего браузера. _mn() для этого не подходит: её донор формы
    // (Object.prototype.hasOwnProperty) — обычный метод, не конструктор,
    // "new" на такой Proxy бросил бы "is not a constructor". Отдельный донор
    // (одноразовый Object) + construct-ловушка, которая настоящий конструктор
    // вызывает через Reflect.construct с сохранением new.target — тот самый
    // механизм, из-за отсутствия которого раньше конструкторы делали обычными
    // функциями с прямым defineProperty вместо Proxy (см. комментарий у
    // Intl.DateTimeFormat ниже) — Proxy НЕ ломает new.target/instanceof,
    // если construct-ловушка сама аккуратно прокидывает newTarget дальше.
    // [FIX ctor-donor-prototype-invariant] Object как донор ломает свойство
    // 'prototype': Object.prototype — {writable:false, configurable:false}, а
    // JS-спека требует, чтобы get-trap на non-configurable+non-writable
    // свойстве ВЕРНУЛ РОВНО ТО ЖЕ значение, что лежит на target — но наш
    // get-trap ниже намеренно подставляет ctor.prototype вместо
    // Object.prototype. Итог — "TypeError: 'get' on proxy: property
    // 'prototype' is a read-only and non-configurable data property..." при
    // ЛЮБОМ обращении к .prototype (в том числе неявном — через instanceof/
    // subclassing). У обычной пользовательской функции prototype —
    // {writable:true, configurable:false}: тоже non-configurable, но
    // writable — инвариант для writable-свойств мягче и разрешает get-trap
    // подставлять другое значение. Простая одноразовая function() {} как
    // донор вместо Object.
    var _CTOR_SHAPE_DONOR = function() {}; // безобидный, простой донор формы (НЕ Object — см. фикс выше)
    // [FIX ctor-length-was-our-wrappers] nativeLen — длина ОРИГИНАЛЬНОГО
    // конструктора. Без неё get-трап пробрасывал обращение к нашей обёртке, и
    // .length совпадал с числом её параметров, а не нативным. Замер против
    // непатченного scope: Intl.Locale отдавал 2 вместо нативной 1 (обёртка
    // объявлена как function Locale(tag, options)). Для DateTimeFormat совпадало
    // случайно — там нативная длина тоже 2.
    function _mnCtor(ctor, displayName, nativeLen) {
        var name = displayName || ctor.name || '';
        var len = (typeof nativeLen === 'number') ? nativeLen : ctor.length;
        var ns = 'function ' + name + '() { [native code] }';
        // [FIX ctor-fakeToString-leaked-its-own-source] fakeToString была ОБЫЧНОЙ
        // функцией, поэтому сама себя не маскировала: замер показал, что
        //   String(Intl.DateTimeFormat.toString) === 'function toString() { return ns; }'
        // то есть достаточно прочитать .toString у любого замаскированного
        // конструктора (Date, Intl.*), чтобы получить НАШ исходник. У нативного там
        // 'function toString() { [native code] }'. Оборачиваем в _mn: apply-ловушка
        // по-прежнему возвращает ns, но сама обёртка выглядит нативной, а .name/
        // .length берутся оттуда же (0 — как у Function.prototype.toString).
        // _mn объявлена ниже в файле, но это function declaration — она поднята
        // и доступна к моменту ВЫЗОВА _mnCtor.
        var fakeToString = _mn(({ toString: function toString() { return ns; } }).toString);
        var proxy = new Proxy(_CTOR_SHAPE_DONOR, {
            construct: function(_t, args, newTarget) {
                // see [FIX extension-id-leaked-through-error-stacks] at _stripOwnFrames:
                // `new Intl.Segmenter('!!!')` threw a RangeError whose stack named this file.
                try {
                    return Reflect.construct(ctor, args, newTarget === proxy ? ctor : newTarget);
                } catch (e) { throw _stripOwnFrames(e); }
            },
            apply: function(_t, thisArg, args) {
                // Date() без new — легитимный не-конструирующий вызов у самого Date;
                // у Intl.* конструкторов вызов без new у настоящих нативных бросает
                // TypeError — тот же Reflect.apply воспроизводит то же исключение,
                // потому что вызывает РЕАЛЬНЫЙ ctor, а не эту обёртку.
                try {
                    return Reflect.apply(ctor, thisArg, args);
                } catch (e) { throw _stripOwnFrames(e); }
            },
            get: function(_t, prop, receiver) {
                if (prop === 'toString') return fakeToString;
                if (prop === 'prototype') return ctor.prototype;
                if (prop === 'name') return name;
                if (prop === 'length') return len;
                return Reflect.get(ctor, prop, ctor);
            },
            getOwnPropertyDescriptor: function(_t, prop) {
                if (prop === 'toString') return undefined; // не own — как у настоящего native ctor
                if (prop === 'length') return { value: len, writable: false, enumerable: false, configurable: true };
                return Reflect.getOwnPropertyDescriptor(ctor, prop);
            },
            ownKeys: function(_t) {
                return Reflect.ownKeys(ctor).filter(function(k) { return k !== 'toString'; });
            },
            has: function(_t, prop) {
                return prop === 'toString' || Reflect.has(ctor, prop);
            },
            getPrototypeOf: function() {
                return Reflect.getPrototypeOf(ctor);
            },
            setPrototypeOf: function() {
                return false;
            },
            defineProperty: function(_t, prop, desc) {
                return Reflect.defineProperty(ctor, prop, desc);
            },
            deleteProperty: function() {
                return false;
            }
        });
        return proxy;
    }
    // [ANTI-CREEP] Не патчим Function.prototype.toString глобально — это даёт каскад
    // «failed toString» на Math/String/Document/Node. Вместо этого toString отдаём только
    // через get-trap Proxy.
    //
    // [MEASURED 2026-08-14 — не пробовать снова без этих цифр] Глобальный gate был
    // написан и снят в тот же день. Он чинил настоящую проблему: у callable Proxy нет
    // [[SourceText]], поэтому Function.prototype.toString.call(patched) отдаёт
    // "function () { [native code] }" без имени, и .name с toString противоречат друг
    // другу на каждой патченной функции (см. dev-fntostring.html). Но цена оказалась
    // несопоставимой — CreepJS, один и тот же профиль, одна и та же машина:
    //          с gate    без gate
    //   лжей     207        10
    //   failed object toString error  133   2
    //   failed at define properties    68   2
    //   красных секций  8 (Timezone, WebGL, Screen, Canvas 2d, DOMRect,
    //                      Audio, Speech, Navigator)        1 (Audio)
    // Причина ровно та, о которой говорит комментарий выше: зонды делают
    // Object.create(anyFunction).toString(), и с глобальным gate ЛЮБАЯ функция страницы —
    // включая нативные Math/String/Document/Node — начинает разрешать toString через нас,
    // после чего проверяется форма стека брошенной TypeError. Наш _fixToStringStack
    // жёстко подставляет кадр 'at Function.toString', а зонд для прокси-случая ждёт
    // 'at Object.toString' (см. [FIX object-toString-stack] ниже) — и промахивается на
    // всём подряд. Расхождение .name/toString остаётся известным и принятым: оно стоит
    // одной проверки, а gate стоил 197 дополнительных.
    // Вместо этого toString отдаём только через get-trap Proxy.
    // URL этого файла — чтобы вычищать СВОИ кадры из стеков ошибок. В продакшене
    // это chrome-extension://<id>/mw/mw-core.js, при локальной отладке — http-URL.
    var _selfUrl = (function() {
        try {
            var m = String(new Error().stack || '').match(/\(?([a-z-]+:\/\/[^\s)]+?):\d+:\d+\)?/i);
            return m ? m[1] : '';
        } catch (e) { return ''; }
    })();
    function _isOwnFrame(line) {
        if (!line) return false;
        if (line.indexOf('chrome-extension://') !== -1) return true;
        return !!(_selfUrl && line.indexOf(_selfUrl) !== -1);
    }
    // [FIX extension-id-leaked-through-error-stacks]
    //
    // Every wrapper below re-throws whatever the native function threw, and V8 builds that
    // error's stack from the frames actually on it — ours included, by absolute URL.
    // Measured, one line of page script each:
    //
    //   try { Object.getOwnPropertyDescriptor(Screen.prototype,'width').get.call(null) }
    //   catch (e) { e.stack }
    //     -> "at width (chrome-extension://<id>/mw/mw-core.js:1018:31)"
    //
    // Eight distinct surfaces did it. That is not "something is spoofed" — it is the
    // extension's ID, its file layout, and the exact line, handed over on request. A clean
    // browser throws the same TypeError with only the page's own frames.
    //
    // The toString path has forged its stack for a long time; nothing did it for errors
    // simply passing THROUGH. This does, in one place, for every wrapper: keep the message
    // line, drop our frames, leave the caller's. When only our frames existed the property
    // is left untouched rather than emptied — an error with a one-line stack is its own
    // anomaly, and this situation does not arise from page-initiated calls anyway.
    function _stripOwnFrames(err) {
        try {
            if (!err || typeof err.stack !== 'string') return err;
            var lines = err.stack.split('\n');
            if (lines.length < 2) return err;
            var head = lines[0], frames = [];
            for (var i = 1; i < lines.length; i++) {
                if (!_isOwnFrame(lines[i])) frames.push(lines[i]);
            }
            if (frames.length && frames.length !== lines.length - 1) {
                err.stack = [head].concat(frames).join('\n');
            }
        } catch (e) {}
        return err;
    }
    // [FIX stack-strip-only-covered-the-synchronous-throw]
    //
    // _stripOwnFrames above is reached from a `catch`, so it only ever saw errors thrown
    // SYNCHRONOUSLY through a wrapper. A promise-returning wrapper does not throw: it hands
    // back a promise that rejects later, and V8 captured that error's stack at the moment
    // the native code created it — with our frames on it. Nothing looked at that path, and
    // it handed over the same thing the synchronous one used to. Measured on a real Chrome
    // 152, one line of page script, three shapes of the same call:
    //
    //   navigator.userAgentData.getHighEntropyValues('not-an-array').catch(e => e.stack)
    //     ours   TypeError: The provided value cannot be converted to a sequence.
    //              at NavigatorUAData.getHighEntropyValues (chrome-extension://<32-char id>/mw-bundle.js:…)
    //              at Object.apply (chrome-extension://<32-char id>/mw-bundle.js:1548:36)
    //              at <page frame>
    //     clean  same message, page frames only
    //
    // Two of our frames, the full extension ID, and the file layout — on request, from an
    // ordinary page, exactly what [FIX extension-id-leaked-through-error-stacks] was written
    // to stop. It is fixed HERE rather than in the one wrapper that showed it, because the
    // hole belongs to every promise-returning function _mn wraps, and the next one added
    // would have inherited it silently.
    //
    // The same error object is rejected onward — only its `stack` is rewritten, in place —
    // so `instanceof`, `name`, `message` and identity are what the browser produced. A
    // derived promise is unavoidable (attaching a handler creates one), and it is
    // indistinguishable from the original to a caller that only ever sees this one.
    //
    // A non-thenable return is passed straight back. The test is one truthiness check plus
    // one typeof, and this trap is on the hot path of every wrapped call in the extension,
    // so it was measured rather than assumed — on a live Chrome 152, against the objects
    // the wrappers actually return:
    //
    //     DOMRect   2.94 ns per call      string  0.46 ns      number  0.16 ns
    //
    // against the ~618 ns a wrapped call already costs, i.e. under half a percent. A loop
    // cycling seven different shapes reaches 30 ns, and that is the upper bound rather than
    // the case: a given wrapper returns one shape, so the lookup stays monomorphic.
    // [FIX every-wrapped-read-boxed-its-own-answer]
    //
    // This runs on the way out of EVERY wrapper in the extension, and almost every one of them
    // returns a primitive — a number from hardwareConcurrency, a string from language, an hour
    // from getHours. `r && typeof r.then === 'function'` on a primitive is not free: V8 boxes
    // it and walks the wrapper prototype for a property that is not there, once per read, and
    // the enclosing try/catch is paid for as well. Only an object or a function can carry a
    // meaningful `then`, so ask what r IS before touching it.
    //
    // It is also the more correct test. A page that assigns Number.prototype.then makes the
    // old line true for the integer navigator.deviceMemory hands back, and the wrapper would
    // then call it and return a promise where a clean browser returns 8.
    function _stripThenable(r) {
        if (r === null || (typeof r !== 'object' && typeof r !== 'function')) return r;
        try {
            if (typeof r.then === 'function') {
                return r.then(undefined, function (e) { throw _stripOwnFrames(e); });
            }
        } catch (eT) {}
        return r;
    }
    // Приводит стек нативного TypeError к тому, что отдал бы браузер БЕЗ нашей
    // обёртки: выкидывает кадры расширения (включая кадр самой обёртки) и, если
    // нужно, правит имя первого кадра. Реальные кадры вызывающего кода остаются.
    function _fixToStringStack(err, wantFunctionFrame) {
        try {
            var lines = String(err.stack).split('\n');
            if (lines.length < 2) return;
            var head = lines[0];
            var frames = [];
            for (var i = 1; i < lines.length; i++) {
                if (!_isOwnFrame(lines[i])) frames.push(lines[i]);
            }
            if (!frames.length) {
                frames = [wantFunctionFrame
                    ? '    at Function.toString (<anonymous>)'
                    : '    at Object.toString (<anonymous>)'];
            } else if (wantFunctionFrame) {
                if (frames[0].indexOf('at Object.toString') !== -1) {
                    frames[0] = frames[0].replace('at Object.toString', 'at Function.toString');
                } else if (frames[0].indexOf('at Function.toString') === -1) {
                    frames[0] = '    at Function.toString (<anonymous>)';
                }
            }
            err.stack = [head].concat(frames).join('\n');
        } catch (e) {}
    }
    function _mn(fn, isAccessor) {
        // [FIX accessor-name-missing-get-prefix] У НАТИВНОГО аксессора имя самой
        // getter-функции включает префикс: Object.getOwnPropertyDescriptor(
        // NetworkInformation.prototype,'downlink').get.name === 'get downlink'.
        // Раньше здесь в ns префикс подставлялся (строка toString была верной), а в
        // трап 'name' уходило сырое fn.name без него — то есть toString говорил
        // «function get downlink()», а .name отдавал «downlink». Замер сравнением с
        // нативными аксессорами показал это на Notification.permission и всех
        // геттерах NetworkInformation. Теперь имя одно на оба места.
        var name = (isAccessor ? 'get ' : '') + (fn.name || '');
        var ns = 'function ' + name + '() { [native code] }';
        var len = fn.length;
        var _nativeToString = _TRUE_FN_TOSTRING;
        var proxy;
        function _throwCallerArgs() {
            throw new TypeError("'caller', 'callee', and 'arguments' properties may not be accessed on strict mode functions or the arguments objects for calls to them");
        }
        // [CLEANUP] Из apply-ловушки убрана ручная эмуляция «Cyclic __proto__ value»
        // на основе _effProto. Она существовала только потому, что операции с
        // прототипом подделывались трапами; теперь цель приватная и цикл
        // обрабатывает сам движок — нативно и точнее, чем любая эмуляция
        // (см. [FIX shared-native-donor-proto-detect] выше).
        var fakeToString = new Proxy(_nativeToString, {
            apply: function(_t, thisArg, args) {
                if (thisArg === proxy || (thisArg && _nativeFns.has(thisArg))) return ns;
                return _nativeToString.call(thisArg);
            },
            get: function(_t, prop) {
                if (prop === 'name') return 'toString';
                if (prop === 'length') return 0;
                if (prop === 'toString') {
                    return function toString() { return 'function toString() { [native code] }'; };
                }
                if (prop === 'arguments' || prop === 'caller') _throwCallerArgs();
                return Reflect.get(_t, prop);
            }
        });
        try { _nativeFns.add(fakeToString); } catch (eF) {}
        proxy = new Proxy(_freshTarget(name), {
            apply: function(_t, thisArg, args) {
                // see [FIX extension-id-leaked-through-error-stacks] at _stripOwnFrames
                //
                // The zero-argument call is not a special case worth avoiding: every accessor
                // in the extension takes that path, Reflect.apply has to read the length of
                // the list and unpack it, and .call does neither. The primitive test inlines
                // the first line of _stripThenable so that a getter returning a number makes
                // no call at all on the way out — see the note there.
                try {
                    var r = args.length === 0 ? fn.call(thisArg) : Reflect.apply(fn, thisArg, args);
                    return (r !== null && (typeof r === 'object' || typeof r === 'function'))
                        ? _stripThenable(r) : r;
                } catch (e) { throw _stripOwnFrames(e); }
            },
            construct: function() {
                throw _stripOwnFrames(new TypeError(name + ' is not a constructor'));
            },
            get: function(_t, prop, receiver) {
                if (prop === 'length') return len;
                if (prop === 'name') return name;
                // [FIX object-toString-stack] Object.create(fn).toString() ищет toString
                // ЧЕРЕЗ прокси, но с receiver = дочерний объект, а не сам прокси.
                // CreepJS «failed object toString error» — это два теста:
                //   1) Object.create(fn).toString()                  → стек /at Function.toString /
                //   2) Object.create(new Proxy(fn,{})).toString()     → стек /at Object.toString/
                // Подделка стека здесь ОБЯЗАТЕЛЬНА, и вот почему (проверено: попытка
                // отдать вместо неё настоящий унаследованный Function.prototype.toString
                // ломает тест 1 на ВСЕХ свойствах сразу). V8 формирует имя кадра из
                // выведенного типа получателя, но НЕ заглядывает внутрь Proxy: если
                // прототип объекта — обычная функция, кадр называется «Function.toString»,
                // а если Proxy — движок сдаётся и пишет «Object.toString». У нативной
                // функции прототипом объекта из теста 1 является сама функция → Function.,
                // а у нас там всегда Proxy → Object. Ровно на этой разнице и построена
                // проверка, так что нативное поведение здесь недостижимо «само» —
                // стек приходится собирать руками, различая случаи 1 и 2 по тому,
                // ЯВЛЯЕТСЯ ли наш прокси прямым прототипом получателя.
                // [FIX forged-stack-had-no-caller-frames] Прежняя версия конструировала
                // НОВЫЙ TypeError и присваивала ему стек из трёх жёстко зашитых строк.
                // Первую строку она угадывала верно, но дальше у настоящей ошибки идут
                // РЕАЛЬНЫЕ кадры вызывающего кода, например:
                //     TypeError: Function.prototype.toString requires that 'this' be a Function
                //         at Function.toString (<anonymous>)
                //         at grab (<anonymous>:4:31)      ← реальные кадры
                //         at <anonymous>:8:18
                // а подделка вместо них подставляла второй фиктивный кадр
                // «at Object.toString (<anonymous>)» и обрывалась. Стек ровно из трёх
                // строк, без единого кадра вызова — сам по себе аномалия, и любая
                // проверка, смотрящая дальше первой строки, ловит её мгновенно.
                // Теперь ловим НАСТОЯЩУЮ ошибку и правим ровно одну строку:
                //   • чужой прототип (случай 2): V8 и так пишет «at Object.toString» —
                //     ошибка отдаётся вообще без изменений;
                //   • наш прокси как прямой прототип (случай 1): нужен
                //     «at Function.toString», подменяем ТОЛЬКО первый кадр, все
                //     настоящие кадры ниже сохраняются.
                if (prop === 'toString') {
                    // [FIX null-conversion-lie] CreepJS: Object.setPrototypeOf(fn, null).toString()
                    // У НАСТОЯЩЕЙ функции с оборванной цепочкой toString не наследуется вообще,
                    // поэтому вызов даёт TypeError «... is not a function». Наш get-трап отдавал
                    // toString безусловно, из-за чего исключения не было → ложь
                    // «failed null conversion error» на КАЖДОМ пропатченном свойстве.
                    // Раньше это эмулировала ветка `_effProto === null` внутри fakeToString;
                    // после перехода на реальную цель признак берётся у самой цели.
                    // Ошибку НЕ глушим: если цепочка прототипов зациклена (страница
                    // сделала Object.setPrototypeOf(fn, Object.create(fn))), этот обход
                    // уходит в рекурсию и даёт RangeError — ровно то же самое делает
                    // нативная функция в этой ситуации. Прежний try/catch превращал
                    // RangeError в «нет toString» → TypeError, а это уже отличие от
                    // нативного поведения (ложь «failed at chain cycle error»).
                    if (Reflect.get(_t, 'toString') === undefined) return undefined;
                    if (receiver !== proxy) {
                        return function toString() {
                            try {
                                return _nativeToString.call(this);
                            } catch (err) {
                                var direct = false;
                                try { direct = (Object.getPrototypeOf(this) === proxy); } catch (eD) {}
                                // Даже когда имя первого кадра и так верное (случай 2),
                                // стек всё равно надо почистить: иначе вторым кадром
                                // светится сам mw-core.js, то есть путь к расширению.
                                _fixToStringStack(err, direct);
                                throw err;
                            }
                        };
                    }
                    return fakeToString;
                }
                if (prop === Symbol.toStringTag) return 'Function';
                if (prop === 'constructor') return Function;
                if (prop === 'caller' || prop === 'arguments') _throwCallerArgs();
                return Reflect.get(_t, prop, receiver);
            },
            getOwnPropertyDescriptor: function(_t, prop) {
                if (prop === 'length') return { value: len, writable: false, enumerable: false, configurable: true };
                if (prop === 'name') return { value: name, writable: false, enumerable: false, configurable: true };
                return undefined;
            },
            ownKeys: function(_t) {
                return ['length', 'name'];
            },
            // [FIX has-trap-hid-the-whole-prototype-chain] Здесь была жёсткая таблица:
            // true для length/name/toString, false для всего остального. Она лгала
            // грубо и проверяемо одной строкой — у нативного метода `in` находит всё,
            // что унаследовано от Function.prototype и Object.prototype:
            //   'call' in fn / 'apply' in fn / 'bind' in fn / 'hasOwnProperty' in fn
            //   'caller' in fn / 'arguments' in fn   (в V8 это restricted-аксессоры
            //                                         на самом Function.prototype)
            // у настоящей функции ВСЕ true, а у нас были ВСЕ false.
            // Плюс из-за короткого замыкания `X in fn` вообще не обходил цепочку
            // прототипов — а именно на этом обходе построена последняя проверка
            // CreepJS: после установки цикла через Proxy нативная функция уходит в
            // бесконечный обход и даёт RangeError, наша же мгновенно возвращала
            // false, и проверка ловила отличие («failed at reflect set proto proxy»).
            // Трап убран полностью: `in` отдаётся движку и работает по-настоящему.
            // 'prototype' при этом по-прежнему даёт false — у краткого метода
            // (_freshTarget) own-свойства prototype нет, и на Function.prototype его
            // тоже нет, так что нативное поведение совпадает без всякой подделки.
            //
            // getPrototypeOf-ловушки НЕТ намеренно: чтение отдаётся движку и даёт
            // Function.prototype, как у нативной функции.
            //
            // [FIX too-much-recursion-lie] А вот setPrototypeOf нужен, но не для
            // подделки, а ровно для одной вещи — проверки цикла. Спека
            // OrdinarySetPrototypeOf идёт по цепочке нового прототипа и отвергает
            // запись, если встретила САМ объект, которому её присваивают (это и есть
            // «Cyclic __proto__ value»); дойдя до Proxy, обход прекращается и запись
            // разрешается. Без трапа движок применяет проверку к приватной ЦЕЛИ, а
            // страница видит ПРОКСИ — движок их не отождествляет, поэтому
            //   Object.setPrototypeOf(fn, Object.create(fn))
            // у нас проходило молча, тогда как у нативной функции это TypeError. Это
            // давало ложь «failed at too much recursion error» на каждом свойстве
            // (раньше её эмулировала ветка Object.getPrototypeOf(pr) === proxy внутри
            // fakeToString). Здесь тот же обход, но сверяемся с proxy — и, что важно,
            // разрешённая запись РЕАЛЬНО применяется к цели: тогда цикл через Proxy
            // возникает в настоящем графе прототипов и даёт нативный RangeError
            // (см. [FIX shared-native-donor-proto-detect] выше), а не подделку.
            // [FIX reflect-set-proto-must-return-false-not-throw] Первая версия этого
            // трапа при обнаружении цикла БРОСАЛА TypeError('Cyclic __proto__ value'),
            // чтобы совпасть с сообщением нативной ошибки. Но у нативной функции
            // цикл — это не исключение из [[SetPrototypeOf]], а возврат false, и
            // разные API выводят из него разное:
            //   Reflect.setPrototypeOf(fn, Object.create(fn)) → false, БЕЗ исключения
            //   Object.setPrototypeOf(fn, Object.create(fn)) → TypeError
            //   fn.__proto__ = …                              → TypeError
            // Бросая исключение, мы ломали первую строку: Reflect тоже начинал
            // бросать. Возврат false воспроизводит все три пути сразу, потому что
            // TypeError для двух последних генерирует сам движок. Цена — текст
            // ошибки на пути Object.setPrototypeOf становится
            // «'setPrototypeOf' on proxy: trap returned falsish» вместо
            // «Cyclic __proto__ value»; тип ошибки (то, что и проверяется) верный,
            // а совпадение по потоку управления важнее совпадения по тексту.
            setPrototypeOf: function(_t, V) {
                var p = V, seen = [], guard = 0;
                while (p !== null && p !== undefined && guard++ < 1000) {
                    if (p === proxy) return false; // цикл через нас — как OrdinarySetPrototypeOf
                    if (seen.indexOf(p) !== -1) break; // цикл не через нас — движок такое разрешает
                    seen.push(p);
                    try { p = Reflect.getPrototypeOf(p); } catch (eP) { break; }
                }
                try { return Reflect.setPrototypeOf(_t, V); } catch (eS) { return false; }
            },
            // [FIX traps-refused-what-a-native-function-allows] Both of these returned a
            // flat false, which makes Object.defineProperty throw ("trap returned falsish")
            // and Reflect.deleteProperty answer false — where a real function accepts both.
            // CreepJS probes exactly that pair:
            //     Object.defineProperty(fn, '', { configurable: true }).toString()
            //     Reflect.deleteProperty(fn, '')
            // and records "failed at define properties" when it throws. Measured on
            // Date.prototype.toString: ours threw TypeError, Array.prototype.map did not.
            // Forwarding to the target — the same thing setPrototypeOf above already does —
            // makes the proxy behave like the ordinary function object it is pretending to
            // be. The keys we answer for ourselves (name / length / toString) are handled in
            // the get trap before the target is consulted, so letting the page write to the
            // target cannot change what it reads back.
            defineProperty: function(_t, prop, desc) {
                try { return Reflect.defineProperty(_t, prop, desc); } catch (eD) { return false; }
            },
            deleteProperty: function(_t, prop) {
                try { return Reflect.deleteProperty(_t, prop); } catch (eD) { return false; }
            }
        });
        _nativeFns.add(proxy);
        return proxy;
    }

    // [FIX proxy-drops-the-name-under-Function.prototype.toString] The global gate. There is
    // no other lever: a Proxy has no [[SourceText]], so no amount of trapping ON the proxy
    // can change what Function.prototype.toString makes of it — only Function.prototype
    // .toString itself can. Defining an own `toString` on each masked function would be an
    // own property natives do not have, and dropping Proxy from _mn would expose our real
    // source, so both alternatives are worse.
    //
    // The header above this file's _freshTarget used to say the opposite — "не патчим
    // Function.prototype.toString глобально: даёт каскад «failed toString» на
    // Math/String/Document/Node". That earlier attempt is gone and cannot be inspected, but
    // the cascade it describes is what happens when the replacement answers for functions it
    // knows nothing about. This one answers for exactly the proxies _mn built, by identity,
    // and delegates everything else — Math.max, String.prototype.replace, Document.prototype
    // .createElement, Node.prototype.appendChild — to the untouched original, so their
    // strings are not "reproduced" but literally the ones the engine produces.
    // dev-fntostring.html measures that claim across ~40 built-ins rather than asserting it.


    // [FIX gbcr-hideadblocker-clobber] Единственный способ дать более поздним
    // IIFE в этом же файле (HIDE AD BLOCKER, ниже по файлу) ту же
    // native-маскировку, что и здесь — window остаётся единственной
    // гарантированно общей связью между отдельными top-level IIFE в одном
    // MAIN-world скрипте (тот же вывод, что и в комментарии про
    // popup-badge-symbol-not-shared). _nativeFns не публикуется; маскировка — _mn / __AFP_MW__.mn.
    // _nativeFnStrings (WeakMap) убран: без global Function.prototype.toString gate не читался.
    try {
        if (_bagRef() && _bagRef().setMn) _bagRef().setMn(_mn);
        if (_bagRef() && _bagRef().setApi) {
            /* api filled after helpers exist — see end of core */
        }
    } catch (e) {}
    // [FIX popup-badge-symbol-not-shared] Первая версия ставила Symbol.for(...)
    // прямо на функцию, рассчитывая, что GlobalSymbolRegistry общий между
    // декларативным MAIN-world content script'ом (mw/*.js) и более
    // поздним chrome.scripting.executeScript(world:'MAIN') из popup.js. И
    // документация Chrome, и MDN подтверждают только то, что оба МОГУТ
    // читать/писать одни и те же window/DOM — то, что это гарантированно
    // ОДИН И ТОТ ЖЕ V8 Realm (а не просто одна и та же страница, видимая из
    // двух разных Realm-контекстов с раздельным GlobalSymbolRegistry) нигде
    // явно не гарантируется, и на практике (эмпирически, у пользователя)
    // Symbol-реестр НЕ оказался общим — popup получил canvas:false, хотя
    // toDataURL был реально запатчен.
    // window — единственное, что гарантированно общее между этими двумя
    // инжекциями (это буквально определение MAIN world), поэтому статус для
    // попапа переехал туда, тем же способом, каким уже работает wasm-бэйдж
    // (window.__w0/__w1 — эта часть и раньше читалась
    // через window, а не через свойство на функции, и работала).
    try {
        /* status on bag */
    } catch(e) {}
    // [FIX stealth-first-load-noised-the-canvas] `_STEALTH` above is decided as this file
    // loads, from `v.ui.m`, which is per TAB and empty on a first load — so the first page
    // of every new tab installs the normal-mode patches even when stealth is selected. The
    // mode itself is not unknowable at that moment: dyn/mode/<mode>.js publishes it через
    // ui:state right after this bundle and still before the page's first script. What
    // cannot change by then is WHICH patches were installed; what can is whether their
    // effect applies. This is the live answer for the modules that ask at effect time.
    function _stealthNow() {
        try {
            var p = _prof();
            if (p && p.mode) return p.mode === 'stealth';
        } catch (e) {}
        try { return sessionStorage.getItem('v.ui.m') === 'stealth'; } catch (e2) {}
        return _STEALTH;
    }

    // [FIX a-switch-off-its-default-was-inert-on-the-first-load]
    //
    // The freshest answer for one flag, and then the SAME answer for the rest of the page.
    // Twin of _stealthNow above, and it exists for the twin reason: _FEAT is fixed as this
    // file loads, and on the first load of an origin there is nothing to fix it FROM —
    // 'v.ui.f' is empty and the boot profile has no `features`. So a switch the user moved
    // off its default did nothing at all until the second load. Measured with clientRects
    // on: a fresh origin gave 0 of 6 rect fields on the noise grid, the same page after F5
    // gave 6 of 6.
    //
    // MEMOISED PER NAME, and that is the whole design rather than a shortcut. A gate that
    // simply re-read the flags would let one page measure a canvas before they arrive and
    // again after — two hashes in ONE document, which is worse than being consistently
    // wrong, and it is what today's behaviour at least gets right. Freezing on first use
    // keeps one answer per page and takes the user's setting whenever their first read
    // happens after the flags land, which is nearly always.
    //
    // Precedence matches _stealthNow: the live profile, then the carrier that survives F5,
    // then the value this file settled on at load.
    // [FIX the-standdown-never-fired] THE COHERENT STAND-DOWN, decided at READ time.
    //
    // The install-time version of this (see the long note in the _FEAT block) could never
    // work, and measurement is what showed it rather than reading: a fresh tab on an origin
    // whose CSP refuses blob: workers reported
    //
    //   window {cores:8, memory:8, tz:America/New_York} / worker {18, 16, Europe/Moscow}
    //
    // on every visit from the second on. The gate reads a sessionStorage key at the moment
    // _FEAT is computed, and neither key can be there yet: v.ui.tt is written only by
    // storage-bridge's asynchronous storage read, and v.ui.wb by noblob.js, which is a
    // DYNAMICALLY registered content script — and dynamic scripts run after the manifest's,
    // which is where this file comes from. Measured order, and dyn/boot.js documents the
    // same fact from the other side:
    //
    //   static ISOLATED -> static MAIN (this file) -> dynamic -> the page's first script
    //
    // So the answer arrives after we install and BEFORE the page can read anything. That is
    // the whole reason this is a read-time decision: nothing needs to be uninstalled, the
    // patched accessors simply answer with the original descriptor instead. Every value a
    // worker can contradict is defined through _def, so one branch there covers them all.
    //
    // TWO GATES, not one. v.ui.tt is a Trusted-Types NAME allowlist — no policy can be
    // minted. v.ui.wb is a CSP that refuses blob: workers, and since every worker this
    // extension patches is built from a blob, _isBlobBlocked() in mw/mw-workers.js hands the
    // NATIVE constructors back there. Two unrelated conditions, the same consequence: the
    // page's workers read the machine. Only the first was ever watched, and github.com and
    // youtube.com are the second.
    //
    // FROZEN AT DOMContentLoaded. While the document is parsing the answer is re-read, so
    // the flag landing between two of the page's scripts is picked up; after that it is
    // fixed, because a value that changes under a running page is its own contradiction.
    // The page cannot observe the pre-flag window: its first script runs after every
    // content script of ours, including the one that writes the key.
    //
    // A page can write v.ui.wb itself and force this. That lever already exists and is not
    // new here — _isBlobBlocked() reads the same key and hands back the native Worker
    // constructors, which unmasks the machine just as completely. Recorded in README "Limits".
    var _sdMemo = null;
    // [FIX a-frame-built-after-the-flag-split-from-its-window] The frozen answer is shared
    // with same-origin child frames. Each frame runs its own copy of this file and used to
    // read sessionStorage for itself — the same storage as its parent, but at a LATER
    // moment. A flag that lands after the parent froze (a wrapped worker dying with an empty
    // error, an observer in another tab of the same site) therefore reached every frame the
    // page built from then on and none of the window: the user's audit of a youtube.com tab
    // showed the window on the profile (Iris Xe, January offset -120, canvas 54829a1f) beside
    // an about:blank frame on the machine (Arc, -180, 72b42f7e) — while that frame's Intl
    // and Date.toString label still said Tallinn, because the PARENT's frame patch in
    // mw-navigator is gated on the parent's answer. Half a frame stood down, which is worse
    // than either whole. So a frame adopts its parent's frozen decision when it can read it
    // (same-origin; a cross-origin parent throws and the frame decides for itself as before),
    // and the parent freezes its own at DOMContentLoaded whether or not anything has asked.
    // The value travels on __t0, the status object profile-injector already defines in every
    // realm we bootstrap — no new global, nothing enumerable.
    // [FIX csp-restrictions-learned-per-route] Twin of _cspFlag in mw-workers: a flag is
    // 'code:timeOrigin:host/segment' of the storage owner (highest same-origin ancestor);
    // this document's value counts as written, another document's only as history for the
    // same route.
    function _cspFlagOn(key) {
        var v = null;
        try { v = sessionStorage.getItem(key); } catch (e) {}
        if (v === null || v === undefined || v === '') return false;
        v = String(v);
        var i = v.indexOf(':');
        if (i < 0) return false;
        var code = v.slice(0, i), rest = v.slice(i + 1), j = rest.indexOf(':');
        var tag = j < 0 ? rest : rest.slice(0, j), scope = j < 0 ? '' : rest.slice(j + 1);
        var on = code === '1' || code === '2' || code === '3';
        if (!on) return false;
        var myTag = '', myScope = '';
        try {
            var o = window;
            try { while (o.parent !== o && o.parent.location.href !== undefined) o = o.parent; } catch (eW) {}
            myTag = String(o.performance.timeOrigin);
            myScope = o.location.hostname + '/' + (o.location.pathname.split('/')[1] || '');
        } catch (e2) {}
        return tag === myTag || (scope !== '' && scope === myScope);
    }
    function _sdPublish(v) {
        try { var st = window.__t0; if (st && typeof st === 'object') st.sd = !!v; } catch (e) {}
    }
    function _sdInherited() {
        try {
            if (window.parent === window) return null;
            var ps = window.parent.__t0;
            if (ps && typeof ps.sd === 'boolean') return ps.sd;
        } catch (e) {}
        return null;
    }
    function _standDownNow() {
        if (_sdMemo !== null) return _sdMemo;
        var inh = _sdInherited();
        if (inh !== null) { _sdMemo = inh; _sdPublish(inh); return inh; }
        var v = false;
        try {
            v = _cspFlagOn('v.ui.tt') || _cspFlagOn('v.ui.wb');
        } catch (e) {}
        try {
            if (v || document.readyState !== 'loading') { _sdMemo = v; _sdPublish(v); }
        } catch (e2) { _sdMemo = v; _sdPublish(v); }
        return v;
    }
    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { try { _standDownNow(); } catch (e) {} });
        }
    } catch (eDcl) {}
    // The features a WORKER can contradict, and only those. plugins, screen, battery,
    // geolocation, clientRects and hideAdBlocker have no reader in a worker scope —
    // WorkerNavigator has no plugins and there is no screen or DOM there — so they stay on
    // and keep protecting. Same list the install-time version used.
    var _WK_FEAT = ['navigator', 'timezone', 'canvas', 'webgl', 'fonts', 'network'];
    // The properties _def must answer natively while the stand-down is on. A NAME list and
    // not a family tag, because _def takes no family and threading one through every call
    // site would be a much larger and more fragile change than the list it would replace.
    // test/wbcoherence.mjs compares the FULL worker-readable surface rather than these
    // names, so a value missing here fails a test instead of shipping.
    var _WK_PROPS = {
        hardwareConcurrency: 1, deviceMemory: 1, userAgent: 1, userAgentData: 1,
        appVersion: 1, platform: 1, vendor: 1, language: 1, languages: 1,
        cpuPerformance: 1, onLine: 1, connection: 1, effectiveType: 1, rtt: 1,
        downlink: 1, saveData: 1, type: 1
    };
    // The single answer to "must this property hand the machine over here?", so the window
    // and the frame-patching path in mw-navigator cannot drift apart. They already had:
    // _patchFrameNavScreen defines through its own _defWinProp rather than through _def, so
    // the first version of the stand-down yielded in the window and went on spoofing in every
    // same-origin iframe — seven signals disagreeing across scopes on youtube.com, measured
    // in the user's own browser. The old note in the memory of this predicted exactly that:
    // closing a contradiction inside the frame while opening one across frames.
    // [FIX host-mode] THIS MACHINE. When the selected profile is the host itself
    // (profile.hostHw, set by background.js from a record the popup measured), every
    // hardware answer comes from the browser: the props below through the same "answer
    // the original descriptor" branch of _def the trusted-types stand-down uses, and the
    // feature-level readers (battery, network, fonts, WebGL limits, matchMedia, the
    // window-size clamps) through _hostHwNow at their effect sites. Read at EFFECT time
    // and never at install: the flag arrives with the profile — dyn/boot.js on a warm
    // install, storage-bridge ~8ms in on a cold one — which is after this file has run
    // and installed its accessors, the same timing the stand-down was rebuilt around.
    //
    // Identity and locale are NOT on this list on purpose: userAgent, language, the
    // timezone, the country and the per-domain canvas seed are the profile's in host mode
    // exactly as in any other. What host mode gives up is the claim to a machine the
    // rasteriser, the audio stack, the text engine and the decoder would contradict —
    // README "Limits" items 2, 3, 4, 7 and 8 — and what it gains is the crowd of everyone with
    // this hardware instead of the crowd of this extension's users.
    //
    // The name list matches the objects _def is called on: navigator's hardware trio plus
    // maxTouchPoints and bluetooth, every Screen accessor, the window's devicePixelRatio,
    // and NetworkInformation. `type`, `width` and `height` are only ever _def'd on those
    // objects (grep'd, not assumed), so a name-keyed list is safe here as it is for
    // _WK_PROPS above.
    function _hostHwNow() {
        try { var p = _prof(); return !!(p && p.hostHw === true); } catch (e) { return false; }
    }
    var _HW_PROPS = {
        hardwareConcurrency: 1, deviceMemory: 1, cpuPerformance: 1, maxTouchPoints: 1, bluetooth: 1,
        width: 1, height: 1, availWidth: 1, availHeight: 1, availLeft: 1, availTop: 1, isExtended: 1,
        colorDepth: 1, pixelDepth: 1, devicePixelRatio: 1,
        connection: 1, effectiveType: 1, rtt: 1, downlink: 1, saveData: 1, type: 1
    };
    // The features whose whole subject is the machine. Read by _featNow, so every module
    // that asks at effect time — battery, network — goes quiet without a second gate.
    var _HW_FEAT = ['screen', 'webgl', 'fonts', 'battery', 'network'];
    function _hwProp(prop) {
        try { return _HW_PROPS[prop] === 1 && _hostHwNow(); } catch (e) { return false; }
    }
    function _sdProp(prop) {
        try { return (_WK_PROPS[prop] === 1 && _standDownNow()) || _hwProp(prop); } catch (e) { return false; }
    }

    var _featNowMemo = {};
    // [FIX host-mode] Outside the memo on purpose: the profile can still arrive (or change
    // on Apply) after a feature has been asked about, and a hardware feature must follow
    // it rather than the first answer. Everything else keeps the memoised behaviour below.
    function _featNow(name) {
        try { if (_hostHwNow() && _HW_FEAT.indexOf(name) !== -1) return false; } catch (eHw) {}
        return _featNowBase(name);
    }
    function _featNowBase(name) {
        if (Object.prototype.hasOwnProperty.call(_featNowMemo, name)) return _featNowMemo[name];
        var v = _FEAT ? _FEAT[name] : undefined;
        try {
            var p = _prof();
            if (p && p.features && typeof p.features[name] === 'boolean') {
                v = p.features[name];
            } else {
                var packed = sessionStorage.getItem('v.ui.f');
                var i = _FEAT_KEYS ? _FEAT_KEYS.indexOf(name) : -1;
                if (packed && i >= 0) {
                    var bits = parseInt(packed, 36);
                    if (isFinite(bits)) v = !!(bits & (1 << i));
                }
            }
        } catch (e) {}
        // And the mode, last, because it OVERRIDES the switch rather than merging with it:
        // stealth's whole contract is that it installs less, and a user's canvas toggle
        // cannot put canvas noise back while stealth is selected. Applied here so that
        // every caller of MW.featNow gets it — mw-canvas-audio, mw-misc and mw-workers all
        // ask through this one function, which is why moving a module onto it is the whole
        // fix for the first-load split described at _STEALTH_FEAT.
        try {
            if (_stealthNow() && Object.prototype.hasOwnProperty.call(_STEALTH_FEAT, name)) {
                v = _STEALTH_FEAT[name];
            }
        } catch (e) {}
        // Last, and it overrides even stealth: this is not a preference but a coherence
        // requirement. Not memoised through _featNowMemo when the answer is still moving —
        // _standDownNow freezes itself at DOMContentLoaded and this follows it.
        try { if (_standDownNow() && _WK_FEAT.indexOf(name) !== -1) v = false; } catch (eSd) {}
        if (_sdMemo !== null) _featNowMemo[name] = !!v;
        return !!v;
    }

    function _markStatus(key) {
        try { if (_bagRef() && _bagRef().markStatus) _bagRef().markStatus(key); } catch(e) {}
    }
    // [FIX #profile-staleness] value теперь может быть функцией — тогда она вызывается
    // заново при КАЖДОМ обращении к свойству, а не один раз в момент _def(). Это нужно
    // для полей, зависящих от ID (который сам теперь живой Proxy на _prof()):
    // без этого Object.defineProperty всё равно заморозил бы результат ID.xxx, прочитанный
    // в момент вызова _def(), и Proxy ничего бы не исправил для _def-based полей.
    // [ANTI-CREEP] Геттеры без Proxy. Имя функции = имя свойства (как у native getters).
    // set не пишем, если его не было — иначе дескриптор отличается от native.
    // [FIX getter-tostring] descriptors from _def() were readable as real JS via
    // Object.getOwnPropertyDescriptor(obj, prop).get.toString() — not [native code].
    // Wrap once here so all ~20 _def() call sites inherit native-looking getters.
    // isAccessor toString: "function get prop() { [native code] }"
    // A receiver check is needed at all because native getters throw
    // TypeError("Illegal invocation") when `this` is not an instance of the interface:
    // without one, proto[name] returns a number and CreepJS records
    // ["failed descriptor.value undefined"] → hash dfd41ab4 (DuckDuckGo pattern). What
    // changed below is not whether the check exists but how it decides.
    //
    // [FIX brand-check-refused-valid-cross-realm-receivers]
    //
    // It used to be a brand list — `brandProto.isPrototypeOf(Object(this))` — and
    // isPrototypeOf is FALSE across realms while the native accessor ANSWERS there.
    // Measured, clean Chromium 151 against this build, one line of page script each:
    //
    //   Screen.width.call(otherRealmScreen)                    clean 1280   ours THREW
    //   Navigator.hardwareConcurrency.call(otherRealmNav)      clean 18     ours THREW
    //   NetworkInformation.effectiveType.call(otherRealmConn)  clean '4g'   ours THREW
    //
    // 129 receiver cases across the audited surface came out different from clean, and the
    // brand list was wrong in BOTH directions — it refused instances the platform accepts
    // AND accepted receivers the platform refuses, because isPrototypeOf reads the
    // prototype CHAIN while the platform reads an internal slot:
    //
    //   Object.create(Screen.prototype).width  clean THREW   old ours 1234
    //   new Proxy(screen, {}).width            clean THREW   old ours 1234
    //
    // No brand list can express the rule the platform actually applies — it accepts an
    // instance from ANY realm and refuses the prototype, a chain-alike, a bare object,
    // null — so stop restating that rule and ask it: call the CAPTURED NATIVE getter with
    // the receiver we were handed and let it throw exactly what it throws, for exactly the
    // receivers it refuses. A cross-origin WindowProxy then comes out right for free (the
    // platform raises SecurityError there, which the old code raised for nobody), and the
    // throw travels back out through _mn's apply trap, so _stripOwnFrames takes our frames
    // off it the way it does for every other wrapper.
    //
    // Held against a clean control in the same page — the same C++ accessor read out of an
    // unpatched same-origin iframe — over 35 (site, receiver) pairs on Screen.width,
    // Navigator.hardwareConcurrency, NetworkInformation.effectiveType and
    // window.devicePixelRatio: 9 divergences before, 0 after. Four of the nine were
    // devicePixelRatio, which went through _def with no brand at all (window is not its own
    // constructor's prototype) and so answered for {}, document, document.all and
    // Window.prototype where clean throws.
    //
    // The oracle's VALUE is discarded on purpose. Falling through means a valid but
    // FOREIGN instance, and every realm this extension patches carries the same profile,
    // so that realm's own accessor answers what we are about to answer; returning the
    // native there would hand over the host instead of the claim.
    //
    // `own` is the instance the accessor was installed for and the identity test comes
    // FIRST, so the hot reads — navigator.hardwareConcurrency, screen.width,
    // window.devicePixelRatio, the surface test/costceiling.mjs times — pay one comparison
    // and never a native call. Counted rather than assumed, on a synthetic accessor that
    // increments on entry: 0 native calls for a read on the own instance, 1 for a foreign
    // receiver. Where _def was handed an interface PROTOTYPE there is no
    // instance to compare against (navigator.connection and BatteryManager both arrive
    // that way), so `own` is a sentinel no receiver can equal and those reads always
    // consult the oracle — one native call each, on reads that are not hot. Where the
    // realm has no native descriptor there is no oracle either and the property answers
    // for every receiver exactly as it did before this fix: inventing a refusal for a
    // property Chrome does not have would be its own tell.
    var _NO_OWN = {};
    function _namedGetter(prop, fn, oracle, ownInst) {
        var own = ownInst || _NO_OWN;
        return _mn(({ [prop]: function() {
            if (this !== own && oracle) oracle.call(this);
            // `.call(this)` and not `fn()`: the receiver is threaded through so a value
            // function can reach the INSTANCE it is answering for. Every caller that
            // ignores `this` is unaffected — which was all of them until the battery
            // stand-down needed the native getter for the BatteryManager actually being
            // read, and a BatteryManager only ever arrives through a promise, so there is
            // no singleton to close over the way navigator.connection offers.
            return fn.call(this);
        } })[prop], true);
    }
    // The oracle has to be the PLATFORM's getter and nothing else. Every getter we mint is
    // an _mn proxy and every _mn proxy is registered in _nativeFns, so a second _def on the
    // same slot — the dev pages load the mw/ modules themselves on top of the extension's
    // copy, which is two installs — would otherwise capture the FIRST wrapper as its
    // oracle. That still refuses the right receivers (the inner layer holds the true native
    // and its throw propagates out unchanged), but it puts two more of our frames on every
    // refusal, and the same stale-capture shape is what already breaks the stand-down in
    // mw-navigator's _defWinProp. Recover the native the inner layer captured instead, and
    // take no oracle at all when the descriptor's getter is some other module's wrapper —
    // no check is the behaviour that shipped, a wrapper that answers where the platform
    // refuses is worse than none. Counted on the same synthetic accessor: after a second
    // _def on the same slot, a foreign receiver still throws and the true native is reached
    // exactly once, not twice and not zero times.
    var _defOracle = new WeakMap();
    // [FIX the-oracle-trusted-whatever-getter-it-found] The last line used to be a bare
    // `return d.get`, which trusts ANY getter that is not one of ours to answer "does the
    // platform refuse this receiver". A native one does. Another extension's shim does not:
    // the common shape is a closure returning a constant, which answers for every receiver,
    // and inheriting that turns the whole check off silently — the accessor then answers on
    // NetworkInformation.prototype where a clean browser throws, which is the exact lie
    // [FIX ddg-dfd41ab4] removed. Not hypothetical here: AdGuard shims navigator in this
    // user's own profile and races us at document_start.
    //
    // So the capture is PROBED once, at install, on an object no interface accepts. A getter
    // that throws there is refusing receivers and can be trusted to refuse them later; one
    // that answers is not an oracle and is dropped, which degrades to the pre-fix behaviour
    // (no receiver check) rather than to a wrong one. Same contract, same reason and the same
    // one-line shape as _winOracle in mw/mw-timezone-screen.js, which was written for this.
    var _oracleProbe = {};
    function _origOracle(d) {
        if (!d || typeof d.get !== 'function') return null;
        try { if (_nativeFns.has(d.get)) return _defOracle.get(d.get) || null; } catch (eO) {}
        try { d.get.call(_oracleProbe); } catch (eP) { return d.get; }
        return null;
    }
    // [FIX privacy-possum-pattern] own on instance → 452924d5; use prototype instead.
    // [FIX ddg-dfd41ab4] getter must Illegal-invocation on prototype this.
    function _def(obj, prop, value, enum_) {
        var isFn = typeof value === 'function';
        try {
            var target = obj;
            var ownInst = null;
            try {
                if (typeof Navigator !== 'undefined' && obj === navigator) {
                    target = Navigator.prototype;
                    ownInst = navigator;
                } else if (typeof Screen !== 'undefined' && obj === screen) {
                    target = Screen.prototype;
                    ownInst = screen;
                } else if (obj && obj.constructor && obj.constructor.prototype === obj) {
                    // [FIX brand-check-only-covered-navigator-and-screen] The two cases
                    // above map an INSTANCE onto its prototype, so reading the accessor
                    // off the prototype itself has to throw Illegal invocation the way
                    // native does. Callers that already pass a PROTOTYPE got no check at
                    // all, and the difference is one line to spot. Measured in
                    // dev-objecttypes.html, with navigator.connection patched via
                    // _def(Object.getPrototypeOf(conn), …):
                    //   Object.getOwnPropertyDescriptor(NetworkInformation.prototype,
                    //     'effectiveType').get.call(NetworkInformation.prototype)
                    //   native -> TypeError: Illegal invocation
                    //   ours   -> '4g'
                    // Same shape as the CreepJS check that produced the DuckDuckGo hash
                    // noted at _namedGetter above. BatteryManager.prototype, patched the
                    // same way from mw/mw-misc.js, had it too.
                    // An object that is its own constructor's .prototype IS an interface
                    // prototype, so there is no instance here to give the getter as its
                    // fast path — the native oracle answers for every receiver instead.
                    ownInst = null;
                } else {
                    // window, and anything else handed over as an instance rather than a
                    // prototype: it is its own target and its own fast path.
                    ownInst = obj;
                }
            } catch (eT) {}
            if (target !== obj) {
                try {
                    var own = Object.getOwnPropertyDescriptor(obj, prop);
                    if (own) delete obj[prop];
                } catch (eDel) {}
            }
            var orig = Object.getOwnPropertyDescriptor(target, prop)
                || (obj !== target ? Object.getOwnPropertyDescriptor(obj, prop) : null);
            // Captured once, before the getter exists, and used for two different jobs:
            // as the receiver oracle in _namedGetter, and as the VALUE below when the
            // stand-down is on. _origOracle refuses a getter of ours in that first job;
            // the stand-down keeps reading `orig` directly, because there a wrapper of
            // ours is still the right thing to call — it ends at the same native.
            var oracle = _origOracle(orig);
            // [FIX the-standdown-never-fired] The one branch that makes the stand-down
            // real: the original descriptor is in hand, so the accessor can answer with it
            // instead of with the profile. Nothing is uninstalled — the property keeps our
            // getter, its name, its receiver check and its toString, and only the VALUE
            // changes. Uninstalling would have meant restoring descriptors from a script
            // that runs after the page can already hold references.
            var getter = _namedGetter(prop, function() {
                if (orig && _sdProp(prop)) {
                    try {
                        if (typeof orig.get === 'function') return orig.get.call(this);
                        if ('value' in orig) return orig.value;
                    } catch (eOrig) {}
                }
                return isFn ? value.call(this) : value;
            }, oracle, ownInst);
            try { _defOracle.set(getter, oracle); } catch (eM) {}
            var desc = {
                get: getter,
                enumerable: orig ? !!orig.enumerable : (enum_ !== false),
                configurable: orig ? (orig.configurable !== false) : true
            };
            if (orig && typeof orig.set === 'function') desc.set = orig.set;
            Object.defineProperty(target, prop, desc);
        } catch(_) {}
    }
    // [FIX creep-own-prop-lies] CreepJS flags instance own-props vs clean iframe.
    // If native value already matches profile — do not defineProperty (no lie, same value).
    function _sameVal(a, b) {
        try {
            if (a === b) return true;
            // Chrome always returns number for deviceMemory/cores; profile JSON may stringify
            if (typeof a === 'number' || typeof b === 'number') {
                if (a == null || b == null || a === '' || b === '') return false;
                if (Number(a) === Number(b) && !isNaN(Number(a))) return true;
            }
            if (typeof a === 'string' && typeof b === 'string' && a === b) return true;
            if (Array.isArray(a) && Array.isArray(b)) {
                if (a.length !== b.length) return false;
                for (var i = 0; i < a.length; i++) {
                    if (String(a[i]) !== String(b[i])) return false;
                }
                return true;
            }
            // DOMStringList / array-like languages
            if (a && b && typeof a.length === 'number' && typeof b.length === 'number' &&
                typeof a !== 'string' && typeof b !== 'string') {
                try {
                    if (a.length !== b.length) return false;
                    for (var j = 0; j < a.length; j++) {
                        if (String(a[j]) !== String(b[j])) return false;
                    }
                    return true;
                } catch (e2) {}
            }
            return false;
        } catch (e) { return false; }
    }
    function _defIfDiff(obj, prop, value, enum_) {
        var target = typeof value === 'function' ? value() : value;
        var cur;
        try { cur = obj[prop]; } catch (e) { cur = Symbol('err'); }
        if (_sameVal(cur, target)) return false;
        _def(obj, prop, value, enum_);
        return true;
    }

    // [FIX cpu-performance-tier-was-the-host-machine]
    //
    // `navigator.cpuPerformance` is new in Chrome 152 (the CPU Performance API): a
    // read-only integer where 0 means "could not classify" and 1..4 are performance
    // tiers, 4 being the fastest. Chrome derives it from the REAL processor, and until
    // this function nothing in the extension touched it — so it answered the host on
    // every profile, next to a hardwareConcurrency and a deviceMemory that said
    // something else. Measured on a clean Chrome 152 on this box (18 cores, 16 GB): 4.
    // A profile claiming a 4-core / 4 GB laptop reported 4 as well, which is both a
    // contradiction a page can read in two lines and a value that survives every profile
    // change — the shape a visitor id is built from.
    //
    // The tier is DERIVED from the two facts the profile already states about the
    // machine rather than carried as a new profile field. One function, read by the
    // window, by every same-origin frame (mw-navigator's _patchFrameNavScreen) and by
    // the worker payload, so those three cannot disagree; and no thirteenth key to keep
    // in step across the four copies of the defaults that test-defaults.cjs compares.
    //
    // The thresholds are the API's own description of the tiers ("practically unusable"
    // / "underpowered but adequate" / "comfortable" / "the most demanding scenarios")
    // mapped onto the only hardware the profile declares. The one measured point the rig
    // can supply agrees: 18 cores and 16 GB -> 4, which is what Chrome answers here. 0 is
    // never returned: it means the browser gave up classifying, and a machine that states
    // its cores and its memory has not.
    function _cpuTier(cores, mem) {
        var c = Number(cores) || 0;
        var m = Number(mem) || 0;
        if (c >= 12 && m >= 16) return 4;
        if (c >= 8 && m >= 8) return 3;
        if (c >= 4) return 2;
        return 1;
    }

    // [FIX we-invented-a-chrome-runtime-real-chrome-does-not-have]
    //
    // A `chrome.runtime` stub used to be installed here whenever the property was absent,
    // justified as "on normal https, Chrome still exposes chrome.runtime; if missing (rare
    // / stripped), provide a minimal stub". That premise is false, and measuring it was
    // one line: on a clean real Chrome, `Object.getOwnPropertyNames(window.chrome)` is
    //
    //     app,csi,loadTimes
    //
    // `runtime` is NOT there. A page only sees chrome.runtime when some installed
    // extension declares `externally_connectable` matching that origin — the ordinary case
    // is absence. With the stub we produced
    //
    //     app,csi,loadTimes,runtime      runtime own-props: getURL      runtime.id: undefined
    //
    // i.e. a runtime object carrying exactly one method and no id, which exists on no real
    // browser. That is the same class of own-property lie this file removes everywhere else
    // (see the note on instance-own-property-lies below), and it is a known signature of
    // anti-detect tooling — the shape such tools synthesise. The browser it was meant to
    // imitate simply does not have the property.
    //
    // Nothing is installed now. A real extension page keeps its own full runtime, an
    // ordinary page keeps the absence Chrome gives it, and the two cannot be told apart
    // from a clean browser by this signal.
    //
    // `window.chrome` itself is still created when entirely missing: that costs nothing on
    // Chrome, where it always exists, and only helps a UA claiming Chrome on an engine that
    // has no chrome object at all.
    if (typeof window.chrome === 'undefined') {
        try { window.chrome = {}; } catch (eC) {}
    }


    // [FIX instance-own-property-lies] mw-misc.js (RTCPeerConnection, to drop ICE
    // candidates that leak local IPs) and mw-canvas-audio.js (OfflineAudioContext, to
    // noise renderedBuffer on the 'complete' event) each replaced addEventListener on
    // THEIR OWN prototype. Neither prototype has one natively — both inherit it from
    // EventTarget.prototype — so each was an own-property lie, visible by diffing
    // getOwnPropertyNames against a clean realm (dev-ownprops.html).
    // EventTarget.prototype is the one place where an own addEventListener is what a real
    // browser has, so a single wrapper there is invisible where three were not.
    // Keyed by event type: the common call ('click', 'load', …) costs one property lookup
    // that misses, and never touches the filter list at all.
    // [CLEANUP] The EventTarget.prototype.addEventListener wrapper lived here. Its only
    // consumer was the 'icecandidate' filter in mw-misc.js, and that filter now sits on
    // RTCPeerConnectionIceEvent.prototype.candidate instead — one patch on an accessor a
    // clean browser also owns, covering both addEventListener and onicecandidate. So the
    // most far-reaching patch in the extension, on the path of every listener registration
    // on every page, is gone: nothing of ours is on the stack when a page adds a listener,
    // and Chrome no longer attributes the page's own Permissions-Policy and deprecation
    // warnings to mw/mw-core.js. Do not bring it back for a single event type.

    // --- shared API for split modules (mw/*.js) ---
    try {
        Object.defineProperty(window, '__AFP_MW__', {
            value: {
                STEALTH: _STEALTH,
                stealthNow: _stealthNow,
                FEAT: _FEAT,
                ID: ID,
                mn: _mn,
                mnCtor: _mnCtor,
                getSessionSeed: _getSessionSeed,
                seedFinal: function () { return _resolvedSessionSeed !== null && !_seedProvisional; },
                // [FIX eight-copies-of-the-profile-reader] The other modules used to carry
                // their own verbatim copy of _prof, each with its own memo, so the profile
                // was parsed once per module per page load instead of once. They read it
                // from here now; mw-core keeps the implementation because it needs a
                // profile before __AFP_MW__ exists.
                prof: _prof,
                getTimezone: _getTimezone,
                RawDate: _RawDate,
                BASE_FONTS: _BASE_FONTS,
                markStatus: _markStatus,
                def: _def,
                defIfDiff: _defIfDiff,
                sameVal: _sameVal,
                // Read by mw-navigator.js (window + same-origin frames) and by
                // mw-workers.js (the worker payload). See [FIX
                // cpu-performance-tier-was-the-host-machine] at the definition.
                cpuTier: _cpuTier,
                // [FIX a-switch-off-its-default-was-inert-on-the-first-load] featKnown says
                // whether FEAT above is the user's answer or the shipped default; featNow
                // gets the user's answer later, once, and keeps it. Read together by the
                // modules whose gate must not be settled on a first load.
                featKnown: _FEAT_KNOWN,
                featNow: _featNow,
                // [FIX the-standdown-never-fired] Read by mw-timezone-screen.js, whose
                // patches replace Intl.DateTimeFormat outright rather than going through
                // _def, so they cannot be covered by the branch inside it.
                standDownNow: _standDownNow,
                // The host's own zone and locale, resolved before anything was patched.
                hostResolved: _hostResolved,
                // Read by mw-navigator's frame patcher — see _sdProp.
                sdProp: _sdProp,
                // [FIX host-mode] Read at effect time by every module with a hardware
                // answer that does not go through _def — see the note at its definition.
                hostHwNow: _hostHwNow
                // [CLEANUP dead-export] nativeFns and DEFAULT_PROFILE were published here
                // but no other module ever read them. _nativeFns is used only inside this
                // file (the WeakSet that _mn's toString masking checks); its one former
                // consumer, the AudioContext/AnalyserNode patch, went away with the audio
                // noise — see mw-canvas-audio.js. _DEFAULT_PROFILE likewise backs the ID
                // proxy locally and is needed nowhere else. Removing both keeps the export
                // to what is actually consumed and makes the "not published" note above at
                // the _nativeFns definition true again.
            },
            configurable: true,
            enumerable: false,
            writable: true
        });
    } catch (eExport) {
        try {
            window.__AFP_MW__ = {
                STEALTH: _STEALTH, stealthNow: _stealthNow, FEAT: _FEAT, ID: ID, mn: _mn, mnCtor: _mnCtor,
                getSessionSeed: _getSessionSeed,
                seedFinal: function () { return _resolvedSessionSeed !== null && !_seedProvisional; }, prof: _prof, getTimezone: _getTimezone,
                RawDate: _RawDate, BASE_FONTS: _BASE_FONTS, markStatus: _markStatus,
                def: _def, defIfDiff: _defIfDiff, sameVal: _sameVal, cpuTier: _cpuTier,
                featKnown: _FEAT_KNOWN, featNow: _featNow, standDownNow: _standDownNow, hostResolved: _hostResolved, sdProp: _sdProp,
                hostHwNow: _hostHwNow
                // [CLEANUP dead-export] see the primary branch above — nativeFns and
                // DEFAULT_PROFILE are used only inside this file and were read by nobody.
            };
            try {
                if (_bagRef() && _bagRef().setApi) {
                    _bagRef().setApi(window.__AFP_MW__);
                }
                if (_bagRef() && window.__AFP_MW__ && window.__AFP_MW__.mn) {
                    _bagRef().setMn(window.__AFP_MW__.mn);
                }
            } catch (eBagApi) {}
        } catch (e2) {}
    }

})();
