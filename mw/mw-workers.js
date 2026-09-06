// ===== WORKER PATCH =====
// ALWAYS on: main vs worker must match (cores/lang/memory/tz)
// Workers имеют свой WorkerNavigator — content scripts туда не попадают.
// Инжектируем согласованный профиль: TZ, langs, UA, platform, cores, memory, WebGL, canvas seed.
// Dedicated Worker + SharedWorker + ServiceWorker.register.
(function() {
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
    // [FIX worker-and-window-resolved-the-canvas-seed-separately] Captured at load, the way
    // _prof is, and for the same reason — mw-cleanup.js deletes the registry before the
    // page runs, but a captured reference outlives the deleted property. See _getSeed.
    var _winSeed = (window.__AFP_MW__ && window.__AFP_MW__.getSessionSeed) || null;
    var _winSeedFinal = (window.__AFP_MW__ && window.__AFP_MW__.seedFinal) || null;
    // [FIX feature-switch-read-from-a-profile-that-has-no-features] Both feature gates in
    // this file read `_prof().features`, and the profile that exists at document_start has
    // no such key — registerBootScript assembles it from the generated dyn/ dev+cc+mode+pv
    // files, none of which carries one. Written up in full at the top of mw/mw-geo.js, where
    // the same defect made a switch do nothing at all. Here both gates fail OPEN, so the
    // symptom is milder — the proxy installs when every flag it uses is off, and a worker
    // built before ui:state lands is patched regardless of the switches — but they are the
    // same dead gate. MW.FEAT is what every other module reads; the profile stays as the
    // fallback, since it does gain `features` later from ui:state.
    var _FEAT = (window.__AFP_MW__ && window.__AFP_MW__.FEAT) || null;
    // [FIX a-switch-off-its-default-was-inert-on-the-first-load] Captured at load like _prof
    // above, and for the same reason — mw-cleanup.js deletes the registry before the page
    // runs, but a captured reference outlives the deleted property. Read by _on below.
    var _MWAPI = window.__AFP_MW__ || null;
    // [FIX cpu-performance-tier-was-the-host-machine] Captured at load like _prof above,
    // and for the same reason. No local copy of the thresholds: a second copy is a second
    // thing to drift, and the whole point of the tier is that the window, the frames and
    // this payload answer with one number. With no registry there is no profile either,
    // so nothing is emitted and the worker keeps the browser's own answer.
    var _cpuTier = (window.__AFP_MW__ && window.__AFP_MW__.cpuTier) || null;
    // [FIX host-mode] Captured at load like the others; asked when the payload is BUILT,
    // which is when the page constructs a worker — long after the profile has landed.
    var _hostHwNow = (window.__AFP_MW__ && window.__AFP_MW__.hostHwNow) || function () { return false; };
    // [FIX worker-readpixels-was-window-only] Captured and asked at build time for the same
    // reason as _hostHwNow. `_stealthParityOnly` below cannot answer this one: it is read as
    // this file LOADS, and it is the wrong question anyway — stealth keeps `webgl` ON (the
    // GL strings must still match the window, or CreepJS's hasBadWebGL fires) while turning
    // the pixel noise OFF, which in the window is _noiseOff() asked per read. So the GL
    // readback shim needs the mode itself, not the feature flag.
    var _stealthNow = (window.__AFP_MW__ && window.__AFP_MW__.stealthNow) || function () { return false; };
    try {
        // [FIX stealth-worker-parity] Do not abort the whole worker patch in stealth.
        // Main still spoofs cores/lang/TZ; returning here left Worker native → anti_detect.
        // Stealth only suppresses heavy surface (canvas/webgl/fonts/geo); navigator+TZ stay on.
        var _stealthParityOnly = false;
        try {
            try {
                // [FIX profile-readable-by-any-page] Was a second, hand-rolled reader of
                // sessionStorage['v.ui.s'] — the last one outside mw-core. Same answer
                // from the shared closure reader captured above.
                var _sj = _prof();
                if (_sj && _sj.mode === 'stealth') _stealthParityOnly = true;
            } catch (e1) {}
            if (!_stealthParityOnly && sessionStorage.getItem('v.ui.m') === 'stealth') _stealthParityOnly = true;
        } catch (eSt) {}
        // [FIX worker-proxy-installed-with-nothing-to-do] Даже когда все флаги сняты и
        // внедряемый код пуст, Proxy над Worker/SharedWorker всё равно ставился —
        // то есть window.Worker перестаёт быть нативной ссылкой без всякой пользы.
        // Замер «все 14 галок сняты»: 29 из 30 патчей снимались, оставался ровно
        // Worker. Если ни один флаг, которым пользуется воркерный патч, не включён,
        // выходим до установки прокси и оставляем конструкторы нативными.
        // Stealth-parity-only still installs the proxy (navigator/timezone emitted below).
        try {
            var _wf = _FEAT || (_prof() && _prof().features) || {};
            var _anyOn = _stealthParityOnly || ['navigator', 'timezone', 'webgl', 'canvas', 'geolocation', 'fonts'].some(function(k) {
                return _wf[k] !== false;
            });
            if (!_anyOn) return;
        } catch (eF) {}
        var _blobBlocked = false;
        // [FIX csp-blocked-blob-worker-was-returned-dead] `new Worker(blobUrl)` does NOT
        // throw when the document's CSP forbids blob: — measured against a page served with
        // `script-src 'self' 'unsafe-inline'`: the constructor returns a live
        // [object Worker] and the failure arrives later as an `error` event whose message
        // is EMPTY. So the `catch (cspErr)` further down never ran, _blobBlocked was never
        // set, and the page was handed a dead worker — every time. On youtube.com that is
        // the player: six blocked workers in one page load, each logging a CSP violation
        // that names mw/mw-workers.js.
        //
        // The first worker on such an origin still cannot be saved: securitypolicyviolation
        // is not dispatched synchronously either (measured — it has not fired by the time
        // the constructor returns), so nothing is known until the object is already in the
        // page's hands. What this does is make it happen at most once — the answer is
        // remembered for the origin, and every later worker, on this load and the next,
        // goes straight to the native constructor.
        var _BLOB_BLOCKED_KEY = 'v.ui.wb';
        // Host history only, on purpose — see [MEASURED the-verdict-cannot-decide-identity]
        // in background.js: a per-document verdict for this flag was built and reverted the
        // same day, because it arrives after the page's first script and split the window
        // from the worker on two suites.
        try {
            if (_cspFlagOn(_BLOB_BLOCKED_KEY)) _blobBlocked = true;
        } catch (eBB) {}
        // [FIX csp-blob-worker-broke-whatsapp] Re-read at CONSTRUCTION time, not only at
        // load. background.js now recognises a CSP that forbids blob: workers from the
        // response headers — before the document is even parsed — and storage-bridge.js
        // writes this same key from that. Its storage read is async (~8 ms) and so lands
        // after this file has loaded, but long before a page builds its first worker, which
        // waits on its own bundle. Reading once at load threw that away and left the first
        // worker on such an origin to die: on web.whatsapp.com that worker IS the
        // application, and the site did not start.
        //
        // One sessionStorage read per `new Worker()` — workers are not built in hot loops,
        // and the in-memory flag short-circuits it once either source has said yes.
        function _isBlobBlocked() {
            if (_blobBlocked) return true;
            try {
                if (_cspFlagOn(_BLOB_BLOCKED_KEY)) {
                    _blobBlocked = true;
                    _unwrapWorkerCtors();
                    return true;
                }
            } catch (e) {}
            return false;
        }
        function _watchBlobWorker(w) {
            try {
                w.addEventListener('error', function (ev) {
                    // A CSP block reports no message; a worker script that merely threw
                    // does, and that must not disable wrapping for the whole session.
                    if (ev && ev.message) return;
                    _blobBlocked = true;
                    // '3': observed in this document — outranks the marker for it.
                    try {
                        var _o = _ownerWin();
                        sessionStorage.setItem(_BLOB_BLOCKED_KEY, '3:' + String(_o.performance.timeOrigin) + ':' +
                            _o.location.hostname + '/' + (_o.location.pathname.split('/')[1] || ''));
                    } catch (eS) {}
                    _unwrapWorkerCtors();
                });
            } catch (eW) {}
            return w;
        }

        // [FIX tt-violation-named-our-file] On an origin where the wrapper can never wrap —
        // blob: workers forbidden by CSP, or no way to mint a TrustedScriptURL — every branch
        // of _wrapWorkerUrl is a passthrough to the native constructor. The page gets exactly
        // the worker it asked for, so the proxy looks free. It is not: the sink call is now
        // made from OUR frame, and that is the frame the browser names when the document
        // refuses the value.
        //
        // Measured on a page carrying youtube.com's real response headers (require-trusted-
        // types-for 'script'; no `trusted-types` allowlist; no blob: in script-src, and no
        // worker-src/child-src, so workers fall back to it) — and, measured on the live watch
        // page, no default policy at all, even fully loaded. Same page, same call
        // `new Worker('/w.js')`, with the extension and without:
        //
        //   clean : blocked, securitypolicyviolation.sourceFile = the page,        line 23
        //   ours  : blocked, securitypolicyviolation.sourceFile = "chrome-extension", line 2193
        //
        // The block itself belongs to the page: a plain string cannot reach a script-URL sink
        // on such a document either way, and the same page's TrustedScriptURL call succeeds
        // identically in both runs. What changes is the attribution — and that is readable
        // from the page. One `new Worker(<string>)` in a try/catch plus a
        // securitypolicyviolation listener, and a site learns an extension has replaced its
        // Worker constructor. None of the toString masking in this file hides it, because the
        // browser builds that record from the real stack rather than from JS. On youtube.com
        // it is also POSTed to the site's own report-uri.
        //
        // So: hand the constructors back the moment there is nothing left to gain. The answer
        // is known at install time on every load after the first (_BLOB_BLOCKED_KEY is in
        // sessionStorage, and background.js writes it from the response headers before the
        // document is parsed), and mid-load on the first one.
        //
        // Residual, and it cannot be removed: when the answer only arrives mid-load, the call
        // that discovers it is already running inside our trap, so that ONE construction is
        // still attributed here. Restoring earlier is not possible — a frame cannot take
        // itself off a stack it is on — and re-dispatching would run from our frame too.
        // Every later call on the origin, and every call on every later load, is clean.
        var _wkNative = [];
        function _unwrapWorkerCtors() {
            if (!_wkNative.length) return;
            var list = _wkNative;
            _wkNative = [];
            for (var i = 0; i < list.length; i++) {
                try { list[i](); } catch (e) {}
            }
        }

        // [FIX already-patched-sentinel-never-matched] Both re-entry guards below (the
        // blob: branch and the same-origin branch of _wrapWorkerUrl) tested the fetched
        // worker source for the literal
        //     Object.defineProperty(navigator,"hardwareConcurrency"
        // to decide "this source already carries our patch, do not prepend it twice".
        // The emitted payload stopped containing that string when the navigator block was
        // rewritten to go through the _defIf helper ([FIX worker-patched-unconditionally]),
        // which emits `_defIf(navigator,"hardwareConcurrency",8);` instead and keeps the
        // defineProperty call inside _defIf's own body, spelled `Object.defineProperty(tg,p,`.
        // So the guard could never fire again: a source that already had the patch got a
        // second full copy prepended, and the canvas shim's noise was then applied twice
        // to the same pixels — a worker canvas hash that no longer matched the window's.
        // The marker is now one constant that is BOTH emitted into the payload and matched
        // against, so it cannot drift out of sync again. It is emitted unconditionally
        // (the _M block is not behind any feature flag), which the flag-derived markers
        // were not.
        var _PATCH_MARK = 'var _p1=1;';
        // [FIX importscripts-is-a-trusted-types-sink-too] `importScripts` is a
        // TrustedScriptURL sink exactly like the Worker constructor, and every payload this
        // file emits called it with a bare string. Measured inside a worker of a
        // `require-trusted-types-for 'script'` page that permits blob: workers:
        //
        //   Uncaught TypeError: Failed to execute 'importScripts' on 'WorkerGlobalScope':
        //   This document requires 'TrustedScriptURL' assignment.
        //
        // Enforcement is inherited by the worker scope — it is not a document-only feature —
        // and a worker CAN mint its own policy there, so this is fixable rather than fatal.
        //
        // Emitted as SOURCE TEXT rather than a shim function because its very first use is
        // importing the patch itself: at that moment nothing else this file emits exists in
        // that scope, so the wrapper has to carry itself. One definition, handed to
        // _nestShim as data so the in-worker copy cannot drift from the window's.
        var _IMP_SRC =
            'function _AFPIS(u){try{if(typeof trustedTypes!=="undefined"&&trustedTypes){' +
            'var p=trustedTypes.defaultPolicy;' +
            'if(!p){try{p=trustedTypes.createPolicy("afp-i"+Math.random().toString(36).slice(2),' +
            '{createScriptURL:function(s){return s;}});}catch(e){p=null;}}' +
            'var t=p&&p.createScriptURL(u);' +
            // A policy without createScriptURL hands back a string — the one value the scope
            // refuses. Same trap as FIX tt-wrap-fell-back-to-a-plain-string.
            'if(t&&typeof t!=="string")u=t;}}catch(e){}importScripts(u);}';
        /** Source text that imports `url` through a TrustedScriptURL where one is demanded. */
        function _impCall(url) { return _IMP_SRC + '_AFPIS(' + JSON.stringify(url) + ');'; }
        // [FIX worker-baked-a-provisional-seed] Key of the one message the window sends
        // into a worker it built. Deliberately not a nice round name: the page never sees
        // the message (see _seedShim), and nothing should make it worth guessing.
        var _SEED_MSG_KEY = '_p1s';
        // Workers built while the window's seed could still change. Held only until the
        // upgrade actually happens — mw-core hard-locks the seed once it is authoritative,
        // so after one correction there is nothing left to correct and the list is dropped
        // rather than kept alive for the life of the page.
        var _seedPending = [];
        var _seedSettled = false;
        function _trackSeed(w, kind, baked) {
            if (_seedSettled || !w || typeof baked !== 'number') return;
            try { _seedPending.push({ w: w, kind: kind, seed: baked >>> 0 }); } catch (e) {}
        }
        function _flushSeed() {
            if (_seedSettled || !_winSeed) return;
            var cur;
            try { cur = _winSeed(); } catch (e) { return; }
            if (typeof cur !== 'number' || !isFinite(cur)) return;
            cur = cur >>> 0;
            var moved = false;
            for (var i = 0; i < _seedPending.length; i++) {
                var rec = _seedPending[i];
                if (rec.seed === cur) continue;
                moved = true;
                try {
                    // DEDICATED WORKERS ONLY, on purpose. In a SharedWorker the message
                    // arrives on the connecting PORT, not on `self`, so _seedShim's
                    // listener would never see it — and the message would instead be
                    // delivered straight into the page's own onconnect protocol. Posting
                    // there would trade a canvas mismatch for a broken page, so a
                    // SharedWorker keeps its baked seed until the receiving half exists.
                    // Catching it needs a `connect` listener that attaches to the port
                    // WITHOUT calling start(), because starting it early would flush
                    // queued messages before the page installs its handler.
                    if (rec.kind !== 'SharedWorker' && rec.w.postMessage) {
                        var msg = { v: cur };
                        msg[_SEED_MSG_KEY] = true;
                        rec.w.postMessage(msg);
                        rec.seed = cur;
                    }
                } catch (e) {}
            }
            if (moved) {
                // The shared patch blob (nested workers importScripts it) baked the old
                // number too, and it is memoised for the page. Drop it so the next child
                // is built from the corrected seed.
                try { if (_pcBlobUrl) { URL.revokeObjectURL(_pcBlobUrl); } } catch (eR) {}
                _pcBlobUrl = null;
                _seedSettled = true;
                _seedPending = [];
            }
        }
        // The seed becomes authoritative when the profile carrying it lands, which is
        // exactly what these two events announce — the same pair mw-core listens to.
        try {
            document.addEventListener('ui:state', function () { try { _flushSeed(); } catch (e) {} });
            document.addEventListener('ui:ready', function () { try { _flushSeed(); } catch (e) {} });
        } catch (eEv) {}

        // [FIX base-fonts-lost-to-cleanup] Снимок делается ЗДЕСЬ, при загрузке
        // модуля: mw-workers.js стоит в manifest до mw-cleanup.js, поэтому
        // window.__AFP_MW__ ещё существует. Payload собирается позже — в момент
        // создания воркера страницей, когда __AFP_MW__ уже удалён.
        // Fallback повторяет _BASE_FONTS из mw-core.js и должен совпадать с ним.
        var _BASE_FONTS_SNAPSHOT = (function() {
            try {
                var a = window.__AFP_MW__;
                if (a && a.BASE_FONTS && a.BASE_FONTS.length) return a.BASE_FONTS.slice();
            } catch (e) {}
            return ['arial','arial black','calibri','cambria','candara','comic sans ms','consolas',
                'constantia','corbel','courier new','georgia','impact','lucida console',
                'lucida sans unicode','microsoft sans serif','palatino linotype','segoe ui',
                'segoe ui variable','tahoma','times new roman','trebuchet ms','verdana','wingdings'];
        })();

        function _P() { return _prof() || {}; }
        function _getHC()  { return _P().hwConcurrency || 8; }
        function _getDM()  { return _P().deviceMemory || 8; }
        function _getWGV() { return _P().webglVendor || 'Google Inc. (Intel)'; }
        function _getWGR() { return _P().webglRenderer || 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)'; }
        // Line-for-line mirror of _wgpuInfo in mw/mw-navigator.js, including the fallback
        // that derives the family from webglVendor when the profile predates the WebGPU
        // fields. The two scopes must land on the same vendor/architecture for the same
        // profile — that agreement IS the feature — so the derivation cannot differ.
        function _getWGPU() {
            var p = _P();
            var v = p.webgpuVendor, a = p.webgpuArchitecture;
            if (!v) {
                var wv = String(p.webglVendor || '').toLowerCase();
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
        }
        // Same source the window reads in mw-navigator._wgParam: the numeric-keyed
        // GL enum table background.js copies out of GPU_DATA[gpu].webglParams.
        function _getWGP() { var p = _P().webglParams; return (p && typeof p === 'object') ? p : {}; }
        function _getPlat(){ return _P().platform || 'Win32'; }
        function _getUA()  { return _P().userAgent || navigator.userAgent; }
        // [FIX worker-appversion-still-said-headless] WorkerNavigator implements NavigatorID,
        // so appVersion exists in a worker exactly as it does in the window — and it was the
        // one NavigatorID member the payload never set. Same derivation the window uses
        // (mw/mw-navigator.js: appVersion falls back to userAgent), and the same
        // Mozilla-prefix rule the profile builder applies.
        function _getAV() {
            var p = _P();
            if (p.appVersion) return p.appVersion;
            var u = _getUA();
            return u.indexOf('Mozilla/') === 0 ? u.slice(8) : u;
        }
        function _getLang(){ return _P().language || 'en-US'; }
        function _getLangs(){ return _P().languages || ['en-US','en']; }
        function _getTZ()  { return _P().timezone || 'America/New_York'; }
        // [FIX worker-and-window-resolved-the-canvas-seed-separately]
        //
        // The worker read the seed straight from the profile while the window's own JS
        // canvas path reads mw-core's _getSessionSeed(), which HARD-LOCKS the first value it
        // resolves. Those are not the same number whenever the lock happens before the
        // profile carries a noiseSeed — and it does: dyn/boot.js deliberately ships no seed
        // (it is per-domain, not derivable from the selection), so on a cold start the
        // window can lock the host-hash fallback while the worker, built later, embeds the
        // real domain seed that background.js injected.
        //
        // The symptom is exactly one line of a scope comparison: canvas differs between
        // Window and Dedicated/Shared while ua, platform, fonts, gpu, hardware, tz and langs
        // all match — everything else comes from the profile, and only the seed had two
        // sources. Reported from creepjs/tests/workers.html.
        //
        // Taking the window's locked value makes them one number by construction. The lock
        // itself stays: canvas output has to be stable for the life of the page, and a seed
        // that changes mid-page would split the same scope against itself.
        function _getSeed() {
            try {
                if (_winSeed) {
                    var s = _winSeed();
                    if (typeof s === 'number' && isFinite(s)) return s >>> 0;
                }
            } catch (e) {}
            return (typeof _P().noiseSeed === 'number') ? (_P().noiseSeed >>> 0) : 0xC0FFEE;
        }

        // [FIX dst-rules-were-guessed-from-the-tz-prefix] Was _TZ_OFF (offset only) plus a
        // separate _NO_DST set, with the rule itself re-derived here from the zone-id
        // prefix — a second, subtly different copy of the window's guesswork. Five zones
        // ended up disagreeing between the two scopes (Istanbul, Tehran, Cairo, Auckland,
        // Casablanca), which a page detects by reading getTimezoneOffset() in the window
        // and again in a Worker. This table now mirrors ZONE_DATA in
        // mw/mw-timezone-screen.js exactly: [stdOffset, ruleId, stdLabel, dstLabel].
        // test/tz-icu.mjs asserts the mirror field by field and checks both engines
        // against real ICU, so the two cannot drift apart again.
        var _TZ_ZONE = {
            'Europe/Tallinn': [-120, 1, 'Eastern European Standard Time', 'Eastern European Summer Time'],
            'Europe/Moscow': [-180, 0, 'Moscow Standard Time', 'Moscow Standard Time'],
            'Europe/Kiev': [-120, 1, 'Eastern European Standard Time', 'Eastern European Summer Time'],
            'Europe/Berlin': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Paris': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Rome': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Madrid': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Amsterdam': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Warsaw': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Stockholm': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Oslo': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Copenhagen': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Prague': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Vienna': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Zurich': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Budapest': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Brussels': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Luxembourg': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/London': [0, 1, 'Greenwich Mean Time', 'British Summer Time'],
            'Europe/Dublin': [0, 1, 'Greenwich Mean Time', 'Irish Summer Time'],
            'Europe/Lisbon': [0, 1, 'Western European Standard Time', 'Western European Summer Time'],
            'Europe/Helsinki': [-120, 1, 'Eastern European Standard Time', 'Eastern European Summer Time'],
            'Europe/Riga': [-120, 1, 'Eastern European Standard Time', 'Eastern European Summer Time'],
            'Europe/Vilnius': [-120, 1, 'Eastern European Standard Time', 'Eastern European Summer Time'],
            'Europe/Sofia': [-120, 1, 'Eastern European Standard Time', 'Eastern European Summer Time'],
            'Europe/Bucharest': [-120, 1, 'Eastern European Standard Time', 'Eastern European Summer Time'],
            'Europe/Athens': [-120, 1, 'Eastern European Standard Time', 'Eastern European Summer Time'],
            'Europe/Istanbul': [-180, 0, 'Turkey Standard Time', 'Turkey Standard Time'],
            'Europe/Belgrade': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Bratislava': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Ljubljana': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Zagreb': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Europe/Malta': [-60, 1, 'Central European Standard Time', 'Central European Summer Time'],
            'Atlantic/Reykjavik': [0, 0, 'Greenwich Mean Time', 'Greenwich Mean Time'],
            'America/New_York': [300, 2, 'Eastern Standard Time', 'Eastern Daylight Time'],
            'America/Toronto': [300, 2, 'Eastern Standard Time', 'Eastern Daylight Time'],
            'America/Chicago': [360, 2, 'Central Standard Time', 'Central Daylight Time'],
            'America/Denver': [420, 2, 'Mountain Standard Time', 'Mountain Daylight Time'],
            'America/Los_Angeles': [480, 2, 'Pacific Standard Time', 'Pacific Daylight Time'],
            'America/Mexico_City': [360, 0, 'Central Standard Time', 'Central Standard Time'],
            'America/Bogota': [300, 0, 'Colombia Standard Time', 'Colombia Standard Time'],
            'America/Lima': [300, 0, 'Peru Standard Time', 'Peru Standard Time'],
            'America/Santiago': [240, 5, 'Chile Standard Time', 'Chile Summer Time'],
            'America/Buenos_Aires': [180, 0, 'Argentina Standard Time', 'Argentina Standard Time'],
            'America/Sao_Paulo': [180, 0, 'Brasilia Standard Time', 'Brasilia Standard Time'],
            'Asia/Tokyo': [-540, 0, 'Japan Standard Time', 'Japan Standard Time'],
            'Asia/Shanghai': [-480, 0, 'China Standard Time', 'China Standard Time'],
            'Asia/Seoul': [-540, 0, 'Korea Standard Time', 'Korea Standard Time'],
            'Asia/Kolkata': [-330, 0, 'India Standard Time', 'India Standard Time'],
            'Asia/Singapore': [-480, 0, 'Singapore Standard Time', 'Singapore Standard Time'],
            'Asia/Hong_Kong': [-480, 0, 'Hong Kong Standard Time', 'Hong Kong Standard Time'],
            'Asia/Taipei': [-480, 0, 'Taipei Standard Time', 'Taipei Standard Time'],
            'Asia/Bangkok': [-420, 0, 'Indochina Time', 'Indochina Time'],
            'Asia/Ho_Chi_Minh': [-420, 0, 'Indochina Time', 'Indochina Time'],
            'Asia/Jakarta': [-420, 0, 'Western Indonesia Time', 'Western Indonesia Time'],
            'Asia/Kuala_Lumpur': [-480, 0, 'Malaysia Time', 'Malaysia Time'],
            'Asia/Manila': [-480, 0, 'Philippine Standard Time', 'Philippine Standard Time'],
            'Asia/Dubai': [-240, 0, 'Gulf Standard Time', 'Gulf Standard Time'],
            'Asia/Riyadh': [-180, 0, 'Arabia Standard Time', 'Arabia Standard Time'],
            'Asia/Tehran': [-210, 0, 'Iran Standard Time', 'Iran Standard Time'],
            'Asia/Karachi': [-300, 0, 'Pakistan Standard Time', 'Pakistan Standard Time'],
            'Asia/Dhaka': [-360, 0, 'Bangladesh Standard Time', 'Bangladesh Standard Time'],
            'Asia/Baghdad': [-180, 0, 'Arabia Standard Time', 'Arabia Standard Time'],
            'Australia/Sydney': [-600, 3, 'Australian Eastern Standard Time', 'Australian Eastern Daylight Time'],
            'Pacific/Auckland': [-720, 4, 'New Zealand Standard Time', 'New Zealand Daylight Time'],
            'Africa/Johannesburg': [-120, 0, 'South Africa Standard Time', 'South Africa Standard Time'],
            'Africa/Cairo': [-120, 6, 'Eastern European Standard Time', 'Eastern European Summer Time'],
            'Africa/Lagos': [-60, 0, 'West Africa Standard Time', 'West Africa Standard Time'],
            'Africa/Casablanca': [-60, 0, 'GMT+01:00', 'GMT+01:00'],
            'Africa/Nairobi': [-180, 0, 'East Africa Time', 'East Africa Time'],
            'Asia/Jerusalem': [-120, 7, 'Israel Standard Time', 'Israel Daylight Time'],
            'Asia/Nicosia': [-120, 1, 'Eastern European Standard Time', 'Eastern European Summer Time']
        };
        function _getZone() {
            return _TZ_ZONE[_getTZ()] || _TZ_ZONE['America/New_York'];
        }

        // [REFACTOR worker-shim-as-real-code] Stage 7 — the last four string blocks.
        // Same reasoning as every stage before it: assembled from concatenated literals
        // these were invisible to ESLint, and a syntax error in any of them silently left
        // every worker unpatched rather than throwing. dev-workerpayload.html compiles the
        // emitted script on every run, so a mistake here now fails a test instead of
        // quietly disabling the protection.

        // Early UA-CH lock, prototype only: navigator.userAgentData hands back a NEW
        // object on every read, so an instance patch is lost immediately — see
        // [FIX worker-uad-instance-patch-was-dead]. The full UA-CH shaping happens later
        // in _uachShim; this one just pins platformVersion before anything can ask.
        function _uadEarlyShim(_M, PV) {
            try {
                function _fpv(r) {
                    if (!r || typeof r !== 'object') return r;
                    var o = {};
                    try { for (var k in r) o[k] = r[k]; } catch (e) { o = Object.assign({}, r); }
                    // [FIX uad-answered-hints-nobody-asked-for] Substitute, never ADD. This
                    // used to assign platformVersion unconditionally, so a worker that asked
                    // for `[]` — or for any single other hint — got platformVersion back
                    // anyway, appended after the real keys where its position alone gave it
                    // away. It also survived the sibling fix in _uachShim below, because
                    // that one mirrors the key set of the call it wraps and THIS shim is
                    // what it wraps: the polluted set was faithfully copied forward. One
                    // stale-looking field among correct neighbours is a second producer,
                    // not a stale producer — the same shape as
                    // [FIX header-vs-js-platform-version-drift].
                    //
                    // Pinning the VALUE is still the job here, and it still happens on every
                    // call that actually asks. test/uachshape.mjs is the negative control:
                    // window and worker each compared against a clean browser, hint by hint.
                    if ('platformVersion' in o) o.platformVersion = PV || '10.0.0';
                    if ('platform' in o) o.platform = o.platform || 'Windows';
                    if ('mobile' in o) o.mobile = false;
                    return o;
                }
                if (typeof NavigatorUAData !== 'undefined' && NavigatorUAData.prototype &&
                    NavigatorUAData.prototype.getHighEntropyValues) {
                    var _np = NavigatorUAData.prototype.getHighEntropyValues;
                    NavigatorUAData.prototype.getHighEntropyValues = _M(function getHighEntropyValues(h) {
                        return _np.apply(this, arguments).then(_fpv);
                    });
                }
            } catch (e) {}
        }

        // [FIX worker-patched-unconditionally] Mirrors _defIfDiff in the window: do not
        // patch at all when the native value already equals the profile, and put the
        // getter on the PROTOTYPE that owns the property rather than on the instance.
        // Returns the function; the payload does `var _defIf=(<this>)(_M);`.
        function _defIfShim(_M) {
            return function _defIf(o, p, v) {
                var cur;
                try { cur = o[p]; } catch (e) {}
                var same = false;
                try {
                    if (cur === v) {
                        same = true;
                    } else if (cur && v && typeof cur !== 'string' && typeof v !== 'string' &&
                               typeof cur.length === 'number' && typeof v.length === 'number') {
                        same = (cur.length === v.length);
                        for (var i = 0; same && i < v.length; i++) {
                            if (String(cur[i]) !== String(v[i])) same = false;
                        }
                    }
                } catch (e) {}
                if (same) return false;
                try {
                    var d = null, q = o;
                    while (q && !d) {
                        d = Object.getOwnPropertyDescriptor(q, p);
                        if (!d) q = Object.getPrototypeOf(q);
                    }
                    var tg = (d && q && q !== o) ? q : o;
                    // [FIX worker-getters-had-no-brand-check] The window brands its getters
                    // (see _namedGetter / [FIX brand-check-only-covered-navigator-and-screen]
                    // in mw-core.js) and the worker did not, so reading the accessor off the
                    // PROTOTYPE returned the value where a real one raises "Illegal
                    // invocation". CreepJS reads exactly that — `proto[name]` on the
                    // interface prototype — and when no TypeError comes back and the result
                    // is not a function it records "failed descriptor.value undefined".
                    // Measured: the four properties the worker patches
                    // (hardwareConcurrency, deviceMemory, language, languages) were flagged,
                    // and platform/userAgent were not, purely because those two already
                    // matched the host and _defIf had left them native.
                    // [FIX the-worker-brand-check-passed-object-create] The check above used
                    // to be `brand.isPrototypeOf(Object(this))`, and a prototype-chain test
                    // is not what a platform accessor does. Two ordinary receivers walk
                    // straight through it while a clean browser refuses both, measured on
                    // six WorkerNavigator accessors (appVersion, deviceMemory,
                    // hardwareConcurrency, language, languages, userAgent), twelve cases:
                    //
                    //   Object.create(WorkerNavigator.prototype)   clean THREW  ours answered
                    //   new Proxy(navigator, {})                   clean THREW  ours answered
                    //
                    // Both have the right prototype and neither has the internal slots the
                    // native getter actually requires. The same fix as _namedGetter in
                    // mw/mw-core.js: stop describing the rule and ASK the platform. The
                    // native getter found on the chain is the oracle — it refuses exactly the
                    // receivers the browser refuses, including shapes nobody enumerated.
                    //
                    // Probed once here, for the reason _origOracle and _winOracle are probed:
                    // a capture that ANSWERS for a plain object is somebody's shim, not an
                    // oracle, and inheriting it would turn the check off while looking like
                    // it was on. No oracle means no check — the pre-fix behaviour — never a
                    // wrong one.
                    var oracle = null;
                    if (d && typeof d.get === 'function') {
                        try { d.get.call({}); } catch (eProbe) { oracle = d.get; }
                    }
                    Object.defineProperty(tg, p, {
                        get: _M(({ [p]: function () {
                            // The instance we patched for answers without touching the
                            // oracle: that is every real read, and it must stay free.
                            if (this !== o && oracle) oracle.call(this);
                            return v;
                        } })[p], true),
                        enumerable: d ? !!d.enumerable : true,
                        configurable: true
                    });
                    return true;
                } catch (e) { return false; }
            };
        }

        // [FIX decoder-answered-for-the-host-gpu] Line-for-line the window's edit (see
        // MEDIA CAPABILITIES in mw/mw-navigator.js): for AV1 only, powerEfficient true ->
        // false, because the claimed card has no AV1 decoder. Emitted only in that case,
        // so `_P().hwAv1Decode === false` is already known here and no profile is read.
        // The native promise is chained rather than replaced, and a rejection keeps the
        // engine's error with our frames removed — the same rule _webglShim applies.
        function _mcShim(_M) {
            try {
                if (typeof MediaCapabilities === 'undefined' || !MediaCapabilities.prototype) return;
                var mp = MediaCapabilities.prototype, o = mp.decodingInfo;
                if (typeof o !== 'function') return;
                function strip(err) {
                    try {
                        var ls = String(err.stack || '').split('\n');
                        if (ls.length < 2) return err;
                        var kept = [ls[0]];
                        for (var i = 1; i < ls.length; i++) {
                            if (ls[i].indexOf('chrome-extension://') === -1) kept.push(ls[i]);
                        }
                        err.stack = kept.join('\n');
                    } catch (e) {}
                    return err;
                }
                mp.decodingInfo = _M(function decodingInfo(configuration) {
                    var r = o.apply(this, arguments);
                    var av1 = false;
                    try { av1 = /\bav01\b/i.test(String((configuration && configuration.video && configuration.video.contentType) || '')); } catch (e) {}
                    if (!av1 || !r || typeof r.then !== 'function') return r;
                    return r.then(function (res) {
                        try { if (res && res.powerEfficient === true) res.powerEfficient = false; } catch (e) {}
                        return res;
                    }, function (e) { throw strip(e); });
                });
            } catch (e) {}
        }

        // [FIX permission-state-window-only] mw-misc.js reports 'granted' for geolocation
        // in the window, because a 'prompt'/'denied' state would contradict our own
        // getCurrentPosition, which does return coordinates. The worker had no such patch
        // and reported 'denied' on the same origin — a split any script can read.
        function _permShim(_M) {
            try {
                if (typeof PermissionStatus !== 'undefined' && PermissionStatus.prototype) {
                    var _psd = Object.getOwnPropertyDescriptor(PermissionStatus.prototype, 'state');
                    if (_psd && typeof _psd.get === 'function') {
                        var _pso = _psd.get;
                        Object.defineProperty(PermissionStatus.prototype, 'state', {
                            get: _M(function state() {
                                try { if (this.name === 'geolocation') return 'granted'; } catch (e) {}
                                return _pso.call(this);
                            }, true),
                            enumerable: _psd.enumerable,
                            configurable: true
                        });
                    }
                }
            } catch (e) {}
        }

        // [FIX worker-webgl-params-uncovered] Lookup order mirrors _wgParam in
        // mw/mw-navigator.js exactly: fixed strings, then the UNMASKED_* pair, then the
        // profile's numeric-keyed table out of GPU_DATA, then the real driver.
        function _webglShim(_wgp, wgv, wgr, _M) {
            // [FIX answered-questions-the-real-context-refuses] Mirror of _wgParam in
            // mw/mw-navigator.js — see the long note there. The driver is asked first and a
            // null answer is final, so the table can change a parameter's value but can
            // never invent one the context does not have (several entries are WebGL2-only,
            // and UNMASKED_* is null until WEBGL_debug_renderer_info is enabled).
            function strip(err) {
                try {
                    var ls = String(err.stack || '').split('\n');
                    if (ls.length < 2) return err;
                    var kept = [ls[0]];
                    for (var i = 1; i < ls.length; i++) {
                        if (ls[i].indexOf('chrome-extension://') === -1) kept.push(ls[i]);
                    }
                    err.stack = kept.join('\n');
                } catch (e) {}
                return err;
            }
            function make(orig) {
                return _M(function getParameter(p) {
                    // [FIX the-wrappers-forwarded-arguments-the-page-never-passed] getParameter()
                    // with no argument throws "1 argument required" natively; forwarding an
                    // undefined enum makes it return null instead. Measured against clean.
                    if (arguments.length < 1) return orig.apply(this, arguments);
                    if (p === 0x1F00) return 'WebKit';
                    if (p === 0x1F01) return 'WebKit WebGL';
                    var native;
                    // Brand-check failures must stay failures — see the window version.
                    try { native = orig.call(this, p); } catch (e0) { throw strip(e0); }
                    if (native === null || native === undefined) return native;
                    if (p === 0x9245) return wgv;
                    if (p === 0x9246) return wgr;
                    if (Object.prototype.hasOwnProperty.call(_wgp, p)) return _wgp[p];
                    return native;
                });
            }
            if (typeof WebGLRenderingContext !== 'undefined') {
                WebGLRenderingContext.prototype.getParameter =
                    make(WebGLRenderingContext.prototype.getParameter);
            }
            if (typeof WebGL2RenderingContext !== 'undefined') {
                WebGL2RenderingContext.prototype.getParameter =
                    make(WebGL2RenderingContext.prototype.getParameter);
            }
        }

        // [FIX worker-webgpu-reported-the-real-gpu] navigator.gpu EXISTS in a worker
        // (measured: WorkerNavigator.gpu resolves, requestAdapter returns an adapter,
        // GPUAdapterInfo and GPU are globals there). The window has been rewriting
        // adapter.info from the profile since this feature landed; the worker never was.
        // So the window claimed the profile's GPU family and a Worker beside it reported
        // the real card — the WebGPU twin of the WebGL split that [FIX
        // worker-webgl-params-uncovered] closed one shim above, and reachable with the
        // same three lines of page script.
        //
        // Deliberately identical to the window implementation in mw/mw-navigator.js,
        // including what it does NOT do:
        //   - patches GPUAdapterInfo.prototype, never the instance, so adapter.info keeps
        //     zero own properties and JSON.stringify(adapter.info) stays "{}" like native;
        //   - leaves limits, features and subgroup sizes native (adapter.limits and
        //     device.limits share one prototype — see the window comment);
        //   - no requestAdapterInfo / adapter.isFallbackAdapter branches: Chrome removed
        //     both, so they are dead code, not compatibility.
        // The two must agree field for field; test/parity-static.mjs asserts that.
        function _webgpuShim(inf, _M) {
            try {
                if (typeof GPUAdapterInfo === 'undefined' || !GPUAdapterInfo.prototype) return;
                var proto = GPUAdapterInfo.prototype;
                function defGet(key, read) {
                    try {
                        var d = Object.getOwnPropertyDescriptor(proto, key);
                        if (!d || typeof d.get !== 'function') return;
                        Object.defineProperty(proto, key, {
                            get: _M(({ [key]: function () { return read(this); } })[key], true),
                            set: undefined,
                            enumerable: d.enumerable,
                            configurable: d.configurable
                        });
                    } catch (e) {}
                }
                defGet('vendor', function () { return inf.vendor; });
                defGet('architecture', function () { return inf.architecture; });
                defGet('device', function () { return inf.device; });
                defGet('description', function () { return inf.description; });
                // [FIX requestAdapter-wrapper-put-this-file-in-the-page-console] GPU.prototype
                // .requestAdapter is left native here for the same reason as in the window —
                // see the long note in mw/mw-navigator.js. Wrapping it only served to observe
                // forceFallbackAdapter, and it put this extension on the stack of Chrome's
                // own powerPreference warning.
                defGet('isFallbackAdapter', function () { return false; });
            } catch (eAll) {}
        }

        // [REFACTOR worker-shim-as-real-code] Stage 6 — the mask itself, which was the
        // largest block still assembled from string literals: ~40 concatenated lines that
        // ESLint could not parse, could not check for undefined names, and could not warn
        // about. A syntax error in there throws nowhere visible — the whole injection sits
        // inside try{}catch{} — it just silently leaves EVERY worker unpatched with a
        // perfectly quiet console. dev-workerpayload.html now compiles the emitted script
        // so that failure is loud; this makes the source lintable as well.
        // Returns _M rather than declaring it: the generated code reads
        // `var _M=(<this function>)();`, so _nfs/_nts/_sfu/_ownf/_fixst/_tgtf stay inside
        // the closure instead of becoming variables of the injected IIFE.
        // Port of _mn from mw/mw-core.js — the long commentary there explains why each
        // trap is shaped this way; this is the same logic, not a simplification.
        function _maskShim() {
            var _nfs = new WeakSet();
            var _nts = Function.prototype.toString;
            var _sfu = (function () {
                try {
                    var m = String(new Error().stack || '').match(/\(?([a-z-]+:\/\/[^\s)]+?):\d+:\d+\)?/i);
                    return m ? m[1] : '';
                } catch (e) { return ''; }
            })();
            function _ownf(l) {
                if (!l) return false;
                if (l.indexOf('chrome-extension://') !== -1) return true;
                return !!(_sfu && l.indexOf(_sfu) !== -1);
            }
            function _fixst(err, wantFn) {
                try {
                    var ls = String(err.stack).split('\n');
                    if (ls.length < 2) return;
                    var head = ls[0], fr = [];
                    for (var i = 1; i < ls.length; i++) { if (!_ownf(ls[i])) fr.push(ls[i]); }
                    if (!fr.length) {
                        fr = [wantFn ? '    at Function.toString (<anonymous>)'
                                     : '    at Object.toString (<anonymous>)'];
                    } else if (wantFn) {
                        if (fr[0].indexOf('at Object.toString') !== -1) {
                            fr[0] = fr[0].replace('at Object.toString', 'at Function.toString');
                        } else if (fr[0].indexOf('at Function.toString') === -1) {
                            fr[0] = '    at Function.toString (<anonymous>)';
                        }
                    }
                    err.stack = [head].concat(fr).join('\n');
                } catch (e) {}
            }
            // shorthand method: own keys are exactly {length,name}, like a native builtin
            function _tgtf(nm) {
                try { var h = { [nm || 'fn']() {} }; return h[nm || 'fn']; }
                catch (e) { return ({ fn() {} }).fn; }
            }
            function _M(f, acc) {
                var nm = (acc ? 'get ' : '') + (f.name || '');
                var ns = 'function ' + nm + '() { [native code] }';
                var len = f.length;
                var px;
                function _thr() {
                    throw new TypeError("'caller', 'callee', and 'arguments' properties may not be accessed on strict mode functions or the arguments objects for calls to them");
                }
                var fts = new Proxy(_nts, {
                    apply: function (t, th, a) {
                        if (th === px || (th && _nfs.has(th))) return ns;
                        return _nts.call(th);
                    },
                    get: function (t, p) {
                        if (p === 'name') return 'toString';
                        if (p === 'length') return 0;
                        if (p === 'toString') {
                            return function toString() { return 'function toString() { [native code] }'; };
                        }
                        if (p === 'arguments' || p === 'caller') _thr();
                        return Reflect.get(t, p);
                    }
                });
                try { _nfs.add(fts); } catch (e) {}
                px = new Proxy(_tgtf(nm), {
                    apply: function (t, th, a) { return Reflect.apply(f, th, a); },
                    construct: function () { throw new TypeError(nm + ' is not a constructor'); },
                    get: function (t, p, rc) {
                        if (p === 'length') return len;
                        if (p === 'name') return nm;
                        if (p === 'toString') {
                            if (Reflect.get(t, 'toString') === undefined) return undefined;
                            if (rc !== px) {
                                return function toString() {
                                    try { return _nts.call(this); }
                                    catch (err) {
                                        var d = false;
                                        try { d = (Object.getPrototypeOf(this) === px); } catch (e2) {}
                                        _fixst(err, d);
                                        throw err;
                                    }
                                };
                            }
                            return fts;
                        }
                        if (p === Symbol.toStringTag) return 'Function';
                        if (p === 'constructor') return Function;
                        if (p === 'caller' || p === 'arguments') _thr();
                        return Reflect.get(t, p, rc);
                    },
                    getOwnPropertyDescriptor: function (t, p) {
                        if (p === 'length') return { value: len, writable: false, enumerable: false, configurable: true };
                        if (p === 'name') return { value: nm, writable: false, enumerable: false, configurable: true };
                        return undefined;
                    },
                    ownKeys: function () { return ['length', 'name']; },
                    setPrototypeOf: function (t, V) {
                        var p = V, seen = [], g = 0;
                        while (p !== null && p !== undefined && g++ < 1000) {
                            if (p === px) return false;
                            if (seen.indexOf(p) !== -1) break;
                            seen.push(p);
                            try { p = Reflect.getPrototypeOf(p); } catch (e) { break; }
                        }
                        try { return Reflect.setPrototypeOf(t, V); } catch (e) { return false; }
                    },
                    defineProperty: function () { return false; },
                    deleteProperty: function () { return false; }
                });
                _nfs.add(px);
                return px;
            }
            return _M;
        }

        // [REFACTOR worker-shim-as-real-code] Stage 1 of getting the injected worker
        // patch out of string literals. Everything _buildPatchCode() emits is real
        // JavaScript that runs in a worker, but as a string it is invisible to ESLint —
        // no no-undef, no no-unused-vars, no parse check — and the whole injection is
        // wrapped in try{}catch{}, so a syntax error does not throw anywhere visible: it
        // silently leaves every worker unpatched. That is the failure mode this refactor
        // removes.
        // A separate template file is not an option: both call sites run synchronously
        // inside the Worker/SharedWorker constructor override, so there is nothing to
        // await. Instead the block stays in this file as an ordinary function and is
        // serialised with Function.prototype.toString at emit time. It is linted like
        // any other code here, and it costs one .toString() per worker.
        // Everything the shim needs from the worker scope is an explicit PARAMETER, not
        // a free variable: _M lives in the generated script, not in this file, so taking
        // it as an argument is both what keeps ESLint honest and what documents the
        // contract. The emitted call passes the bare identifier `_M`, which resolves
        // lexically inside the generated IIFE where this text is placed.
        // Verified end to end by dev-worker-patch.html, which drives the real Worker
        // override rather than re-implementing the build.
        function _intlShim(L, _M) {
            try {
                // Port of _mnCtor from mw/mw-core.js: construct trap through
                // Reflect.construct preserving new.target, toString/name/length from the
                // ORIGINAL constructor, toString not an own property.
                function _MC(ctor, nm, len) {
                    var ns = 'function ' + nm + '() { [native code] }';
                    // [FIX ctor-fakeToString-leaked-its-own-source] a plain function does
                    // not mask itself and String(Ctor.toString) handed back our source.
                    var fts = _M(({ toString: function toString() { return ns; } }).toString);
                    var don = function () {};
                    var px = new Proxy(don, {
                        construct: function (_t, a, nt) { return Reflect.construct(ctor, a, nt === px ? ctor : nt); },
                        apply: function (_t, th, a) { return Reflect.apply(ctor, th, a); },
                        get: function (_t, p) {
                            if (p === 'toString') return fts;
                            if (p === 'prototype') return ctor.prototype;
                            if (p === 'name') return nm;
                            if (p === 'length') return len;
                            return Reflect.get(ctor, p, ctor);
                        },
                        getOwnPropertyDescriptor: function (_t, p) {
                            if (p === 'toString') return undefined;
                            if (p === 'length') return { value: len, writable: false, enumerable: false, configurable: true };
                            return Reflect.getOwnPropertyDescriptor(ctor, p);
                        },
                        ownKeys: function () { return Reflect.ownKeys(ctor).filter(function (k) { return k !== 'toString'; }); },
                        has: function (_t, p) { return p === 'toString' || Reflect.has(ctor, p); },
                        getPrototypeOf: function () { return Reflect.getPrototypeOf(ctor); },
                        setPrototypeOf: function () { return false; },
                        defineProperty: function (_t, p, d) { return Reflect.defineProperty(ctor, p, d); },
                        deleteProperty: function () { return false; }
                    });
                    return px;
                }
                // [FIX worker-tolocale-length] toLocaleString(loc,opts) reported .length 2
                // while the native has both parameters optional → 0. Defaults fix it.
                var _n = Number.prototype.toLocaleString;
                Number.prototype.toLocaleString = _M(function toLocaleString(loc = undefined, opts = undefined) {
                    if (loc == null || loc === '') loc = L;
                    return _n.call(this, loc, opts);
                });
                var _d = Date.prototype.toLocaleString;
                Date.prototype.toLocaleString = _M(function toLocaleString(loc = undefined, opts = undefined) {
                    if (loc == null || loc === '') loc = L;
                    return _d.call(this, loc, opts);
                });
                // [FIX resolvedOptions-stomped-explicit-locale] resolvedOptions forced
                // r.locale=L for EVERY instance, so new Intl.NumberFormat('de') formatted
                // as German while reporting the profile locale. The window substitutes
                // only for instances whose locale it supplied (no argument, or the page
                // handing our own tag back); the worker has to apply the same rule or the
                // two scopes disagree on one line of script. Full reasoning at
                // DateTimeFormat in mw/mw-timezone-screen.js.
                var _IW = new WeakSet();
                function _wrapIntl(name) {
                    try {
                        var O = Intl[name];
                        if (!O) return;
                        var ro = O.prototype.resolvedOptions;
                        var C = function (loc, opts) {
                            var f = Array.isArray(loc) ? loc[0] : loc;
                            var d = (loc == null || loc === '');
                            var own = d || (typeof f === 'string' && f.toLowerCase() === String(L).toLowerCase());
                            var i = Reflect.construct(O, [d ? L : loc, opts], C);
                            if (own) { try { _IW.add(i); } catch (e2) {} }
                            return i;
                        };
                        C.prototype = O.prototype;
                        // [FIX supportedLocalesOf-vanished] .bind(O) renamed the static to
                        // 'bound supportedLocalesOf' and flattened its toString; handed
                        // over directly, exactly as in the window.
                        if (O.supportedLocalesOf) C.supportedLocalesOf = O.supportedLocalesOf;
                        // [FIX worker-intl-ctors-were-raw] these went in as a bare
                        // function C: String(Intl.DateTimeFormat) leaked our source and
                        // .name was 'C'. _MC gives every one of them the native shape,
                        // with .length from the ORIGINAL (ListFormat 0, DisplayNames 2, …).
                        Intl[name] = _MC(C, name, O.length);
                        Intl[name].prototype = O.prototype;
                        O.prototype.resolvedOptions = _M(function resolvedOptions() {
                            // 'use strict' for the reason spelled out at _dateGuard: this
                            // payload is sloppy, so a null/undefined receiver would be coerced
                            // to the global before .call reaches the native, and V8 then reports
                            // #<DedicatedWorkerGlobalScope> and routes through UnwrapDateTimeFormat
                            // instead of naming the method and the receiver the caller passed.
                            'use strict';
                            var r = ro.call(this);
                            if (_IW.has(this)) r.locale = L;
                            return r;
                        });
                    } catch (e) {}
                }
                // [FIX worker-locale-entropy] CreepJS getLocale() constructs all seven and
                // collects resolvedOptions().locale; unpatched that is the real OS locale.
                // [FIX segmenter-and-durationformat-were-never-wrapped] The last two are
                // newer than the rest and were missing from this list, so they answered
                // with the real OS locale while their five siblings said the profile's —
                // see the twin note in mw/mw-timezone-screen.js for the measurement.
                // _wrapIntl already skips a name the engine does not have.
                ['Collator', 'DateTimeFormat', 'DisplayNames', 'ListFormat', 'NumberFormat',
                    'PluralRules', 'RelativeTimeFormat', 'Segmenter', 'DurationFormat'].forEach(_wrapIntl);
            } catch (e) {}
        }

        // [REFACTOR worker-shim-as-real-code] Stage 2 — canvas. Same mechanism and same
        // reasoning as _intlShim above: real, linted code here, serialised at emit time,
        // every worker-scope dependency taken as a parameter (SEED, _M).
        // [FIX worker-baked-a-provisional-seed]
        //
        // The window resolves the canvas seed lazily and may only have a PROVISIONAL
        // host-hash when a worker is built — dyn/boot.js ships the whole machine at
        // document_start but deliberately no noiseSeed, so a page that calls `new Worker()`
        // from its first inline script gets one. The window later upgrades to the real
        // per-domain seed; the worker could not, because the seed was a number literal in
        // a blob that already existed. Measured on a cold tab: cores, timezone and GPU all
        // matched while canvas read 26c6dfa4 in the worker against 66a69e32 in the window —
        // the one-line Window/Dedicated split CreepJS reports. It reproduced on every first
        // load of a new tab, since sessionStorage (which carries the seed across a reload)
        // is per-tab.
        //
        // So the seed lives in a one-field box the shims read at draw time, and this shim
        // listens for the window's correction. The listener is registered here, before the
        // worker's own script runs, so it is FIRST in the listener list — which is what
        // makes stopImmediatePropagation able to keep the page's onmessage from ever seeing
        // our message. A BroadcastChannel would have been simpler and needed no
        // interception, but it would itself be an extension detector: a page that knows the
        // channel name can listen on it, which is the same mistake as the data-v-*
        // attributes ([FIX bridge-attributes-were-an-extension-detector]).
        function _seedShim(_SDB, MARK) {
            try {
                self.addEventListener('message', function (ev) {
                    try {
                        var d = ev && ev.data;
                        if (d && typeof d === 'object' && d[MARK] === true &&
                            typeof d.v === 'number' && isFinite(d.v)) {
                            _SDB.v = d.v >>> 0;
                            // Ours alone: the page never sees this event. Every other
                            // message reaches its handlers untouched.
                            ev.stopImmediatePropagation();
                        }
                    } catch (e) {}
                });
            } catch (e) {}
        }
        // [FIX worker-readpixels-was-window-only] hp / n / rfe were locals of _canvasShim.
        // The WebGL readback ported below (_glPixelShim) needs exactly those three and is
        // emitted under a DIFFERENT flag — webgl, not canvas — so keeping a copy in each
        // shim would mean two definitions of one noise formula, and the two paths could
        // then drift apart without either scope noticing. This project has already paid
        // for a canvas seed with three sources; it is not paying for a fourth. One copy,
        // one box, both readers.
        //
        // SEED used to arrive as a number literal, frozen at the moment the worker was
        // built. It arrives as the shared _SD box now, read at draw time, so the update
        // _seedShim receives can still reach it.
        function _pixShim(_SDB) {
            function hp(x, y, s) {
                var h = (s ^ ((x + 1) * 0x27D4EB2F) ^ ((y + 1) * 0x85EBCA6B)) >>> 0;
                h = Math.imul(h ^ (h >>> 15), 0x2545F491) >>> 0;
                return (h ^ (h >>> 13)) >>> 0;
            }
            // [FIX size-gate-was-read-size-not-canvas-size] Same bug and same fix as
            // mw-canvas-audio._noiseImageData: the "trivial canvas" threshold was
            // compared against the READ size, so getImageData(x,y,1,1) always came
            // back clean while a block read of the same pixel came back noised. The
            // threshold is taken from the canvas itself (cw/ch) at the call site.
            function n(d, w, h, ox, oy) {
                ox = ox || 0; oy = oy || 0;
                // Read once per call, not per pixel: the box can only change between
                // reads, never inside one.
                var SEED = _SDB.v >>> 0;
                for (var ly = 0; ly < h; ly++) {
                    for (var lx = 0; lx < w; lx++) {
                        var i = (ly * w + lx) * 4;
                        var hh = hp(ox + lx, oy + ly, SEED);
                        d[i]     = Math.max(0, Math.min(255, d[i]     + ((hh & 3) - 1)));
                        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + ((hh >>> 4 & 3) - 1)));
                        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + ((hh >>> 8 & 3) - 1)));
                    }
                }
            }
            // [FIX worker-missing-flat-restore] The worker had no SECOND step, the one
            // the main thread does: rolling the noise back in flat regions
            // (_restoreFlatRegionsExpanded in mw-canvas-audio.js). Window and Worker
            // therefore diverged on any image with uniform areas — a single-colour
            // fill measured bd3170c5 against d1701ef4, a gradient ed0620b1 against
            // 86ea4923, while a SINGLE pixel matched perfectly, i.e. the noise formula
            // and seed already agreed and only this missing step differed.
            // Line-for-line port: neighbours are read with the REAL (un-noised)
            // getImageData, 1px wider than the requested region and clamped to the
            // canvas edges, so "flat or not" is decided the same way no matter how the
            // read is sliced.
            function rfe(d, ox, oy, ex, exX, exY) {
                var w = d.width, h = d.height, da = d.data, ew = ex.width, eh = ex.height, ed = ex.data;
                function at(ax, ay) {
                    var lx = ax - exX, ly = ay - exY;
                    if (lx < 0 || ly < 0 || lx >= ew || ly >= eh) return null;
                    var i = (ly * ew + lx) * 4;
                    return [ed[i], ed[i + 1], ed[i + 2], ed[i + 3]];
                }
                // [FIX solid-fill-canvas-was-noised] Port of the main thread's
                // at-most-two-colours rule (MAX_FLAT_COLORS in mw-canvas-audio.js):
                // one colour is a flat interior, two is a hard edge between two flat
                // fills, and neither carries per-machine entropy. Must stay identical
                // to the window's copy or Window and Worker diverge on any shape with
                // a hard edge — which is exactly what dev-wvw.html measures.
                function kk(c) { return ((c[0] << 16) | (c[1] << 8) | c[2]) >>> 0; }
                function few(cols) {
                    var n = 0, seen = [];
                    for (var k = 0; k < cols.length; k++) {
                        var v = cols[k], known = false;
                        for (var j = 0; j < n; j++) { if (seen[j] === v) { known = true; break; } }
                        if (known) continue;
                        seen[n++] = v;
                        if (n > 2) return false;
                    }
                    return true;
                }
                for (var ly = 0; ly < h; ly++) {
                    for (var lx = 0; lx < w; lx++) {
                        var ax = ox + lx, ay = oy + ly, c = at(ax, ay);
                        if (!c) continue;
                        var cols = [kk(c)], nb;
                        nb = at(ax - 1, ay); if (nb) cols.push(kk(nb));
                        nb = at(ax + 1, ay); if (nb) cols.push(kk(nb));
                        nb = at(ax, ay - 1); if (nb) cols.push(kk(nb));
                        nb = at(ax, ay + 1); if (nb) cols.push(kk(nb));
                        if (few(cols)) {
                            var i = (ly * w + lx) * 4;
                            da[i] = c[0]; da[i + 1] = c[1]; da[i + 2] = c[2]; da[i + 3] = c[3];
                        }
                    }
                }
            }
            // hp is deliberately not exported: its only caller is n, and a second entry
            // point to the hash is a second way for the two paths to disagree.
            return { n: n, rfe: rfe };
        }
        function _canvasShim(_M, _PX) {
            try {
                // The noise and the flat-region rollback come from _pixShim above — one
                // copy shared with the WebGL readback — under the names the rest of this
                // shim already used.
                var n = _PX.n, rfe = _PX.rfe;
                // [FIX worker-canvas-backend-mismatch] — withdrawn. willReadFrequently:true
                // used to be forced here to follow the main thread, which forced it always,
                // so the window always rasterised on CPU while the worker did not by
                // default and the source pixels diverged (measured then: window ed0620b1,
                // worker 4316c7ff, worker with the flag ed0620b1 again). The cause was the
                // forcing in the window, not a scope difference: on a clean browser
                // (dev-backendmatrix.html) window and worker give one hash per setting
                // (default 3195a6e9 in both, wrf:true daf73994 in both). The flag is gone
                // from both sides — parity holds on its own and two observable traits
                // disappear (see [FIX forced-willReadFrequently]).
                // [DEAD] A _2doc WeakSet and an OffscreenCanvas.getContext wrapper feeding
                // it lived here. Its only reader was the convertToBlob branch that read the
                // source canvas directly; that branch is gone (see
                // [FIX scope-asymmetric-source-read] below), which left a wrapper that
                // wrapped the native call and did nothing.
                if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
                    var g = OffscreenCanvasRenderingContext2D.prototype.getImageData;
                    OffscreenCanvasRenderingContext2D.prototype.getImageData = _M(function getImageData(x, y, w, h) {
                        var r = g.apply(this, arguments);
                        try {
                            var c = this.canvas, cw = (c && c.width) || r.width, chh = (c && c.height) || r.height;
                            // the same "trivial canvas" gate, on the size of the CANVAS, not the read
                            if (!(cw <= 32 && chh <= 32)) {
                                var ox = x | 0, oy = y | 0;
                                // [FIX worker-lost-flat-restore-when-the-expanded-read-failed]
                                // The pre-noise snapshot is taken FIRST so the flat-region
                                // rollback can still happen if the neighbour read throws.
                                // The window has always had that fallback
                                // (_restoreFlatRegions(d, orig) in mw-canvas-audio.js); the
                                // worker had none, so a read whose expanded rectangle came
                                // out empty — anything fully outside the canvas bounds, where
                                // getImageData raises IndexSizeError — kept its noise in flat
                                // areas while the window rolled it back. That is a
                                // Window↔Worker canvas split in exactly the conditions this
                                // shim exists to keep aligned.
                                var pre0 = { width: r.width, height: r.height, data: r.data.slice() };
                                n(r.data, r.width, r.height, ox, oy);
                                var exX = Math.max(0, ox - 1), exY = Math.max(0, oy - 1);
                                var exX2 = Math.min(cw, ox + r.width + 1), exY2 = Math.min(chh, oy + r.height + 1);
                                var ex = null;
                                try {
                                    if (exX2 > exX && exY2 > exY) {
                                        ex = g.call(this, exX, exY, exX2 - exX, exY2 - exY);
                                    }
                                } catch (eEx) { ex = null; }
                                if (ex) rfe(r, ox, oy, ex, exX, exY);
                                else rfe(r, ox, oy, pre0, ox, oy);
                            }
                        } catch (e) {}
                        return r;
                    });
                }
                // [FIX worker-convertToBlob-unnoised] The hole that kept the worker's canvas
                // hash from moving under any edit: the noise is applied ON READ
                // (getImageData), and convertToBlob was not patched in the worker at all —
                // it encoded the ORIGINAL, clean canvas. Measured on one scene:
                // getImageData matched window and worker byte for byte (3fbde1bd) while the
                // PNG did not — 108963 B in the window against 78056 B in the worker, the
                // worker's smaller precisely because it carried no noise to hurt deflate.
                // convertToBlob was handing out the REAL canvas fingerprint.
                // Same technique as mw-canvas-audio.js on the main thread: noise a
                // TEMPORARY copy and never mutate the original, which in a worker may still
                // be drawn on afterwards.
                if (typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas.prototype &&
                    OffscreenCanvas.prototype.convertToBlob && typeof g === 'function') {
                    var _octb = OffscreenCanvas.prototype.convertToBlob;
                    // [FIX convertToBlob-answered-for-a-canvas-the-platform-refuses] — the
                    // worker half; the reasoning is written out at the window copy in
                    // mw/mw-canvas-audio.js. Short version: the noising works on a COPY, and a
                    // copy always has a context, so a source the platform refuses to convert
                    // got converted anyway —
                    //   clean  rejects InvalidStateError: "OffscreenCanvas" has no rendering context.
                    //   ours   resolves a Blob
                    // and no cheap probe for "has a context" exists (drawImage of a
                    // context-less OffscreenCanvas does not throw; getContext creates one;
                    // transferToImageBitmap destroys the bitmap).
                    //
                    // The window can answer for free because it already wraps getContext for
                    // other reasons. This scope did not, so the wrapper below exists only to
                    // record — it forwards everything, including the argument count, and is
                    // masked like every other. The alternative was gating on the native for
                    // EVERY call, which doubles the encode on the legitimate path; a worker
                    // exporting images is exactly where that would be felt.
                    var _ocWithContext = new WeakSet();
                    var _oGetCtx = OffscreenCanvas.prototype.getContext;
                    if (typeof _oGetCtx === 'function') {
                        OffscreenCanvas.prototype.getContext = _M(function getContext(contextId, options = undefined) {
                            var c = _oGetCtx.apply(this, arguments);
                            try { if (c) _ocWithContext.add(this); } catch (eW) {}
                            return c;
                        });
                    }
                    OffscreenCanvas.prototype.convertToBlob = _M(function convertToBlob(opts = undefined) {
                        var target = this;
                        var _gate = null;
                        try { if (!_ocWithContext.has(this)) _gate = _octb.apply(this, arguments); } catch (eG) {}
                        try {
                            var w = this.width, h = this.height;
                            if (w > 0 && h > 0 && !(w <= 32 && h <= 32)) {
                                // [FIX copy-backend-asymmetric] The temporary copy in the
                                // WINDOW is created with willReadFrequently:true
                                // (mw-canvas-audio.js, same convertToBlob and
                                // _renderNoisedCopy) — the flag appeared there so Chrome
                                // would not print a perf warning on our own reads. Here it
                                // was missing and the worker's copy stayed on the default
                                // backend. The flag switches Skia between GPU and software,
                                // so drawImage in the two worlds wrote into copies on
                                // DIFFERENT backends; on cards where those two paths do not
                                // produce identical bytes, the noise landed on different
                                // source pixels and CreepJS's canvas row diverged between
                                // Window and Worker while every other row matched. That is
                                // why the divergence survived every edit to the read path:
                                // none of them touched this spot.
                                // The copy is unreachable by the page, so the flag exposes
                                // no observable trait here — unlike forcing it on the page's
                                // canvases (see [FIX forced-willReadFrequently]).
                                var copy = new OffscreenCanvas(w, h);
                                var cc = copy.getContext('2d', { willReadFrequently: true });
                                if (cc) {
                                    var d;
                                    // [FIX scope-asymmetric-source-read] There used to be a
                                    // branch here: if THIS canvas already had a 2d context,
                                    // read the original directly, else copy via drawImage.
                                    // The window lost the same branch
                                    // ([FIX readback-warning-named-our-file] in
                                    // mw-canvas-audio.js), leaving only the copy path. That
                                    // made it asymmetric: the window encoded a scene from
                                    // the copy while the worker encoded it from the
                                    // original. If drawImage and a direct read differ by
                                    // even a byte on a given card, CreepJS's canvas row
                                    // splits between Window and Worker — which is what a
                                    // user hit (window d524d8b2, both workers 8d3f614b)
                                    // while on the dev machine both paths agree and it never
                                    // reproduced. The branch is gone: both worlds read the
                                    // copy, one single path.
                                    cc.drawImage(this, 0, 0);
                                    d = g.call(cc, 0, 0, w, h);
                                    // the pre-noise snapshot doubles as the buffer of "real"
                                    // neighbours: the read is full size, so it IS the
                                    // expanded region (exX=exY=0)
                                    var pre = { width: d.width, height: d.height, data: d.data.slice() };
                                    n(d.data, d.width, d.height, 0, 0);
                                    rfe(d, 0, 0, pre, 0, 0);
                                    cc.putImageData(d, 0, 0);
                                    target = copy;
                                }
                            }
                        } catch (e) {}
                        // Gate first, its rejection verbatim; its blob discarded for ours.
                        if (_gate && typeof _gate.then === 'function') {
                            var _t = target, _o = opts;
                            return _gate.then(function () { return _octb.call(_t, _o); });
                        }
                        return _octb.call(target, opts);
                    });
                }
            } catch (e) {}
        }

        // [FIX worker-readpixels-was-window-only] gl.readPixels was noised in the window
        // and NOTHING did it here, so a page read two different rasterisation fingerprints
        // one `new Worker()` apart. Measured by tools/probe-values.mjs on an ordinary http
        // origin, 64x64 shaded quad, clean Chromium against this build:
        //
        //     clean   window 508124549  |  dedicated 508124549  |  shared 508124549
        //     ours    window 4177413246 |  dedicated 508124549  |  shared 508124549
        //
        // A clean browser gives ONE value in all three scopes; we changed one of them.
        // Same class as [FIX connection-was-half-patched-in-workers], and the same answer:
        // port the window, rule for rule, rather than write a second implementation.
        //
        // The rules below are mw-canvas-audio's _noiseReadback, not a summary of it — the
        // reasons are all written up there, next to the two-machine measurement that says
        // GPU rasterisation is one of the 2 carriers out of 175 fields:
        //   - RGBA + UNSIGNED_BYTE only, and no dstOffset: float and integer readbacks are
        //     GPU compute results, not pictures;
        //   - the "trivial surface" gate is on the DRAWING BUFFER, never on this read — a
        //     per-read gate answers differently for a 1x1 than for the same pixel inside a
        //     block, which is precisely what CheckIntegrity compares;
        //   - the hash takes ABSOLUTE framebuffer coordinates (x+lx, y+ly), never the
        //     call's offset or size — the invariant that makes those two reads agree;
        //   - flat regions are rolled back, and the pre-noise snapshot is taken BEFORE the
        //     noise so the rollback survives a failure — this file learned that one the
        //     hard way, see [FIX worker-lost-flat-restore-when-the-expanded-read-failed].
        // The rollback is _pixShim's rfe against a same-rect snapshot, which is what the
        // window's _restoreFlatRegions(d, orig) is: at() returns null outside the snapshot
        // exactly where the window skips a neighbour at the buffer edge. There is no
        // expanded neighbour read here for the same reason the window has none — the only
        // way to widen a readback is a second GL call, and that would move the driver's
        // error flag the page is entitled to read.
        function _glPixelShim(_PX, _M) {
            try {
                var RGBA = 0x1908, UNSIGNED_BYTE = 0x1401;
                function noise(gl, x, y, w, h, format, type, pixels, dstOffset, readRaw) {
                    if (format !== RGBA || type !== UNSIGNED_BYTE) return;
                    if (dstOffset) return;
                    if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) return;
                    x = x | 0; y = y | 0; w = w | 0; h = h | 0;
                    if (w <= 0 || h <= 0 || pixels.length < w * h * 4) return;
                    try {
                        if ((gl.drawingBufferWidth | 0) <= 32 && (gl.drawingBufferHeight | 0) <= 32) return;
                    } catch (eD) { return; }
                    var orig = pixels.slice(0, w * h * 4);
                    _PX.n(pixels, w, h, x, y);
                    // [FIX the-readback-noise-was-strippable-one-pixel-at-a-time] The
                    // expanded neighbour read, ported from mw/mw-canvas-audio.js together
                    // with the defect it fixes. Judging flatness on the RECTANGLE THAT WAS
                    // READ makes every 1x1 readback trivially flat, so its noise was rolled
                    // straight back off and the raw GPU output came back one pixel at a
                    // time — in all three scopes, since this file mirrored the window's rule
                    // faithfully. The header note above this shim said there is no expanded
                    // read here "for the same reason the window has none"; the window has
                    // one now, and the reason it gave — a second GL call moving the driver's
                    // error flag — turned out to be real and is handled the same way, by
                    // pinning PACK_ALIGNMENT for the duration of our read (measured: with
                    // alignment 8 and an odd width a tightly packed buffer raises
                    // INVALID_OPERATION where clean raises nothing).
                    var d = { width: w, height: h, data: pixels };
                    var done = false, PACK_ALIGNMENT = 0x0D05, packSaved = null;
                    try {
                        var dbW = gl.drawingBufferWidth | 0, dbH = gl.drawingBufferHeight | 0;
                        var exX = x > 0 ? x - 1 : 0, exY = y > 0 ? y - 1 : 0;
                        var exX2 = (x + w + 1) < dbW ? (x + w + 1) : dbW;
                        var exY2 = (y + h + 1) < dbH ? (y + h + 1) : dbH;
                        var exW = exX2 - exX, exH = exY2 - exY;
                        if (readRaw && exW > 0 && exH > 0) {
                            try {
                                var pa = gl.getParameter(PACK_ALIGNMENT);
                                if (pa === 1 || pa === 2 || pa === 8) {
                                    gl.pixelStorei(PACK_ALIGNMENT, 4);
                                    packSaved = pa;
                                }
                            } catch (ePa) {}
                            var exBuf = new Uint8Array(exW * exH * 4);
                            readRaw(exX, exY, exW, exH, format, type, exBuf);
                            _PX.rfe(d, x, y, { width: exW, height: exH, data: exBuf }, exX, exY);
                            done = true;
                        }
                    } catch (eEx) {}
                    if (packSaved !== null) { try { gl.pixelStorei(PACK_ALIGNMENT, packSaved); } catch (eR) {} }
                    if (!done) _PX.rfe(d, x, y, { width: w, height: h, data: orig }, x, y);
                }
                function patch(proto) {
                    if (!proto || typeof proto.readPixels !== 'function') return;
                    var origRP = proto.readPixels;
                    // Seven declared parameters because that is what the native method
                    // reports for .length; WebGL2's dstOffset overload does not widen it,
                    // so that argument is read off `arguments`. The native call goes FIRST,
                    // so a foreign receiver fails exactly as it would unpatched and there is
                    // nothing to noise when it does.
                    proto.readPixels = _M(function readPixels(x, y, width, height, format, type, pixels) {
                        var r = origRP.apply(this, arguments);
                        var self = this;
                        // Through the NATIVE method, bound to this context: routing the
                        // neighbourhood read through the wrapper would noise the very pixels
                        // the flatness test has to judge raw, and would recurse.
                        var readRaw = function (rx, ry, rw, rh, rf, rt, buf) {
                            return origRP.call(self, rx, ry, rw, rh, rf, rt, buf);
                        };
                        try { noise(this, x, y, width, height, format, type, pixels, arguments[7], readRaw); } catch (e) {}
                        return r;
                    });
                }
                // Both prototypes, the way _webglShim patches getParameter on both: a
                // worker reaches WebGL through OffscreenCanvas.getContext and may ask for
                // either version.
                if (typeof WebGLRenderingContext !== 'undefined') patch(WebGLRenderingContext.prototype);
                if (typeof WebGL2RenderingContext !== 'undefined') patch(WebGL2RenderingContext.prototype);
            } catch (e) {}
        }

        // [REFACTOR worker-shim-as-real-code] Stage 3 — fonts. Same mechanism as
        // _intlShim / _canvasShim. _allow arrives as a plain object (the allowlist the
        // builder assembles from _BASE_FONTS + profile.allowedFonts), _M from the
        // generated scope.
        // [FIX worker-baked-a-provisional-seed] The seed is the shared _SD box, not a
        // literal — see _canvasShim.
        function _fontShim(_SDB, _allow, _M) {
            try {
                // [FIX generic-family-lists-diverged] see the note on _sfG in mw/mw-misc.js —
                // this copy was missing fangsong. Full CSS Fonts 4 generic set, identical
                // in all three scopes.
                var _gen = {
                    'serif': 1, 'sans-serif': 1, 'monospace': 1, 'cursive': 1, 'fantasy': 1,
                    'system-ui': 1, 'ui-serif': 1, 'ui-sans-serif': 1, 'ui-monospace': 1,
                    'ui-rounded': 1, 'math': 1, 'emoji': 1, 'fangsong': 1
                };
                var _enc = new TextEncoder();
                function _hs(b, s) {
                    var h = b >>> 0, a = _enc.encode(s == null ? '' : String(s));
                    for (var i = 0; i < a.length; i++) { h = (h ^ a[i]) >>> 0; h = Math.imul(h, 0x01000193) >>> 0; }
                    h = (h ^ (h >>> 16)) >>> 0;
                    h = Math.imul(h, 0x85EBCA6B) >>> 0;
                    return (h ^ (h >>> 13)) >>> 0;
                }
                // an exact zero is passed through untouched — see
                // [FIX perturbed-exact-zeros] in mw-canvas-audio.js
                function _stw(real, font, text) {
                    if (real === 0) return 0;
                    var h = _hs(_hs(_SDB.v >>> 0, font), text);
                    return real + ((h & 0xFF) / 255 - 0.5) * 0.02;
                }
                // [DEAD] _stm (the substitute_text_metrics port) lived here. It became
                // unreachable when TextMetrics substitution was narrowed to `width` only —
                // see [FIX integer-metrics-turned-into-floats] in mw-canvas-audio.js. The
                // window dropped its counterpart at the same time, so both worlds stay
                // symmetric.
                // CSS font shorthand parsing — the same regex as _families in the window,
                // line-height-after-slash included ("16px/1.5 Arial").
                function _fam(f) {
                    var m = String(f).match(/[\d.]+(?:px|em|rem|pt|%|vw|vh)(?:\/(?:normal|[\d.]+(?:%|em|px)?))?\s+([\s\S]+)$/i);
                    if (!m) return [];
                    return m[1].split(',').map(function (s) { return s.trim().replace(/[\x22\x27]/g, '').toLowerCase(); });
                }
                function _lastg(fs) {
                    for (var i = fs.length - 1; i >= 0; i--) { if (_gen[fs[i]]) return fs[i]; }
                    return 'monospace';
                }
                function _size(f) {
                    var m = String(f).match(/^([\s\S]*?[\d.]+(?:px|em|rem|pt|%|vw|vh))/i);
                    return m ? m[1] : '16px';
                }
                // [FIX host-mode] No allowlist (null) blocks nothing.
                function _blk(fs) { return !!_allow && fs.some(function (f) { return !_gen[f] && !_allow[f]; }); }
                var _oMT = null, _tc = null;
                function _tmp() {
                    if (!_tc) { try { _tc = new OffscreenCanvas(1, 1).getContext('2d'); } catch (e) {} }
                    return _tc;
                }
                // TextMetrics: as in the window — the PROTOTYPE ACCESSORS are replaced and
                // measureText returns the REAL object, with the substituted values in a
                // WeakMap. That keeps instanceof true, own properties absent, and Illegal
                // invocation on a foreign this.
                var _tmS = new WeakMap(), _tmN = [];
                var _tmOk = (function () {
                    try {
                        if (typeof TextMetrics === 'undefined' || !TextMetrics.prototype) return false;
                        var p = TextMetrics.prototype;
                        Object.getOwnPropertyNames(p).forEach(function (n) {
                            if (n === 'constructor') return;
                            var d = Object.getOwnPropertyDescriptor(p, n);
                            if (!d || typeof d.get !== 'function') return;
                            var og = d.get;
                            _tmN.push(n);
                            var g = ({ [n]: function () {
                                try {
                                    var s = _tmS.get(this);
                                    if (s && Object.prototype.hasOwnProperty.call(s, n)) return s[n];
                                } catch (e) {}
                                return og.call(this);
                            } })[n];
                            try { Object.defineProperty(p, n, { get: _M(g, true), enumerable: d.enumerable, configurable: true }); } catch (e) {}
                        });
                        return _tmN.length > 0;
                    } catch (e) { return false; }
                })();
                // the noise key is the NORMALISED font string — see
                // [FIX noise-undid-the-normalisation] in mw-canvas-audio.js
                function _mt(ctx, text) {
                    var font = ctx.font || '', fs = _fam(font), m, fk = font;
                    if (_blk(fs)) {
                        var tc = _tmp();
                        if (tc) { var nf = _size(font) + ' ' + _lastg(fs); tc.font = nf; m = _oMT.call(tc, text); fk = nf; }
                        else { m = _oMT.call(ctx, text); }
                    } else { m = _oMT.call(ctx, text); }
                    var w = _stw(m.width, fk, text);
                    // [DIFFERS FROM THE WINDOW] the window has a 9-field literal fallback
                    // for this case. There is none here on purpose: a literal breaks
                    // instanceof TextMetrics, and _tmOk is true in the worker (same
                    // interface as the window). Should it ever be false, handing back the
                    // native object beats handing back an object of the wrong type.
                    // ONLY width is substituted — bounding-box metrics are integers in
                    // Chrome and ±0.001 noise would make them fractional, which is checked
                    // verbatim (see [FIX integer-metrics-turned-into-floats]).
                    if (_tmOk) { var sub = { width: w }; try { _tmS.set(m, sub); } catch (e) {} }
                    return m;
                }
                // fillText/strokeText: swap ctx.font for the duration of the call and put
                // it back in finally, so a later read of ctx.font from the worker's own
                // code sees the original requested value.
                function _draw(orig, ctx, text, x, y, mw) {
                    var font = ctx.font || '', fs = _fam(font);
                    if (!_blk(fs)) return (mw !== undefined) ? orig.call(ctx, text, x, y, mw) : orig.call(ctx, text, x, y);
                    var sv = ctx.font;
                    ctx.font = _size(font) + ' ' + _lastg(fs);
                    try { return (mw !== undefined) ? orig.call(ctx, text, x, y, mw) : orig.call(ctx, text, x, y); }
                    finally { ctx.font = sv; }
                }
                if (typeof OffscreenCanvasRenderingContext2D !== 'undefined' && OffscreenCanvasRenderingContext2D.prototype) {
                    var OP = OffscreenCanvasRenderingContext2D.prototype;
                    _oMT = OP.measureText;
                    if (_oMT) OP.measureText = _M(function measureText(text) {
                        // [FIX the-wrappers-forwarded-arguments-the-page-never-passed] mirror of
                        // the window guard in mw/mw-canvas-audio.js; the note lives there.
                        if (arguments.length < 1) return _oMT.apply(this, arguments);
                        return _mt(this, text);
                    });
                    var _oF = OP.fillText;
                    if (_oF) OP.fillText = _M(function fillText(text, x, y, maxWidth = undefined) {
                        if (arguments.length < 3) return _oF.apply(this, arguments);
                        return _draw(_oF, this, text, x, y, maxWidth);
                    });
                    var _oS = OP.strokeText;
                    if (_oS) OP.strokeText = _M(function strokeText(text, x, y, maxWidth = undefined) {
                        if (arguments.length < 3) return _oS.apply(this, arguments);
                        return _draw(_oS, this, text, x, y, maxWidth);
                    });
                }
            } catch (e) {}
        }

        // [REFACTOR worker-shim-as-real-code] Stage 4 — UA-CH. Same mechanism as the
        // shims above.
        // _pb/_ecb/_efvl are hoisted to the top of the shim, which the string version did
        // NOT do: it declared them inside `if (NP.getHighEntropyValues)` while the
        // userAgentData getter above already referenced them. That only worked through
        // Annex B block-function semantics in sloppy mode — the binding is var-scoped and
        // gets assigned when the block runs, which happens before any getter access. As
        // real code ESLint flagged it as no-undef immediately, and it is genuinely
        // fragile: adding 'use strict' anywhere upstream would scope those declarations
        // to the block and silently break the brands substitution. The only behaviour
        // this changes is an edge case that cannot occur — NavigatorUAData without
        // getHighEntropyValues — where brands would now be substituted instead of
        // throwing into a catch.
        // [FIX host-mode] HW: the machine is the host — platformVersion stays the native
        // value and the connection block is skipped, in step with the window.
        function _uachShim(MAJ, PLAT, PV, ARCH, BIT, _M, HW) {
            try {
                function _pb(s) {
                    var o = [];
                    if (!s || !s.length) return o;
                    for (var i = 0; i < s.length; i++) {
                        try {
                            var b = s[i];
                            var br = String((b && (b.brand || b.Brand)) || ''), v = String((b && (b.version || b.Version)) || '');
                            if (br) o.push({ brand: br, version: v });
                        } catch (e) {}
                    }
                    return o;
                }
                // [FIX ua-ch-brand-added-to-three-sources-of-four] Line-for-line mirror of
                // mw-navigator's _ensureChromeBrands, and it has to stay one: changing only
                // the window split this scope against it, which dev-wvw.html caught as a
                // Window↔Worker high-entropy mismatch. Nothing is appended or fabricated
                // here any more either — see the long note in mw/mw-navigator.js.
                function _ecb(bs, maj) {
                    var l = _pb(bs);
                    if (!l.length) return l;
                    for (var j = 0; j < l.length; j++) {
                        var bn = l[j].brand.toLowerCase();
                        if (bn.indexOf('google chrome') !== -1 || bn === 'chromium') l[j].version = String(maj);
                    }
                    return l;
                }
                // Mirror of _ensureFullVersionList — same rule as _ecb above.
                function _efvl(fv, maj, full) {
                    var l = _pb(fv);
                    full = full || (maj + '.0.0.0');
                    for (var i = 0; i < l.length; i++) {
                        var n = (l[i].brand || '').toLowerCase();
                        if (n.indexOf('google chrome') !== -1 || n === 'chromium') {
                            if (!l[i].version || l[i].version === maj) l[i].version = full;
                        }
                    }
                    return l;
                }
                // userAgentData — everything on the PROTOTYPE: the instance is rebuilt on
                // every access, see [FIX worker-uad-instance-patch-was-dead].
                var _bsrc = new WeakMap();
                var NP = (typeof NavigatorUAData !== 'undefined') && NavigatorUAData.prototype;
                // [FIX worker-uad-sync-getters-on-prototype] platform/mobile/brands used to
                // be replaced on NavigatorUAData.prototype. The main thread replaces them
                // on the INSTANCE and wraps the navigator.userAgentData getter so the
                // substitution is applied to each new object. Because of that difference
                // the signature of NavigatorUAData.prototype.brands was ours in the worker
                // and native in the window. Below is the window's approach: wrap the
                // userAgentData getter on WorkerNavigator.prototype and patch what it
                // returned; the prototype stays untouched (except getHighEntropyValues,
                // which the window also patches on the prototype).
                if (NP) {
                    // [FIX worker-uad-own-props-outlived-the-window-fix] These three were
                    // defined on the INSTANCE here, and the comment above says that was the
                    // window's approach. It WAS, and the window has since moved:
                    // [FIX uad-own-property-lie] in mw-navigator.js put them back on the
                    // prototype, because a real NavigatorUAData has NO own properties at all
                    // and `Object.getOwnPropertyNames(navigator.userAgentData)` answered
                    // `brands,mobile,platform` for us and `` for every browser. The window
                    // half was fixed; the worker half was not, so the same one-line tell
                    // stayed readable inside every worker for anyone who looked there
                    // instead of at the window.
                    //
                    // Found by tools/probe-scopes.mjs, which diffs the NAME surface of
                    // window against worker in a clean browser and in ours, and reports only
                    // the splits the extension itself introduces. These three were the whole
                    // report: three own properties, worker-only, added by us.
                    //
                    // Same shape as the window's _defUadProto: patch the prototype, keep the
                    // native descriptor's set/enumerable/configurable so nothing else about
                    // the shape moves, and key the brands snapshot off `this` so a second
                    // NavigatorUAData still gets its own.
                    //
                    // [FIX worker-uad-prototype-answered-any-receiver] These three had no
                    // receiver check at all, so the accessor answered for anything it was
                    // called with. Measured against a clean browser:
                    //   NavigatorUAData.platform.call(uad)                  -> "Windows"
                    //   NavigatorUAData.platform.call(otherRealmUad)        -> "Windows"
                    //   NavigatorUAData.platform.call(NavigatorUAData.prototype) -> THREW TypeError
                    //   NavigatorUAData.platform.call(navigator)            -> THREW TypeError
                    // Ours answered the profile for all four — the last two are the
                    // divergence — and `brands` was worse than the other two: its native
                    // call sat inside `catch (eB) { nb = []; }`, so the platform's own
                    // refusal came back as an empty list where clean throws.
                    //
                    // No brand list can express that split. A cross-realm NavigatorUAData
                    // is ANSWERED for while `instanceof` and `isPrototypeOf` are both false
                    // for it, and `Object.create(NavigatorUAData.prototype)` is the mirror:
                    // the brand check says yes, the internal slot is not there. So the
                    // CAPTURED NATIVE GETTER is the oracle: call it first and let the
                    // platform decide. It throws exactly what it throws, for exactly the
                    // receivers it refuses. Falling through means a valid but possibly
                    // foreign instance, and there we still answer the profile — every realm
                    // this extension patches carries the SAME profile, so returning the
                    // native there would leak the host instead.
                    //
                    // No identity fast path here, unlike the connection block below: the
                    // instance is rebuilt on every access (see the note above), so there is
                    // no stable OWN to compare against and every read pays one native call.
                    // These are not hot reads — test/costceiling.mjs times measureText,
                    // getBoundingClientRect and hardwareConcurrency, none of them this.
                    // The oracle's return value is handed to the getter rather than fetched
                    // a second time, which is why the separate _npBrandsGet capture is gone.
                    try {
                        var _defNP = function (name, getter) {
                            var d = Object.getOwnPropertyDescriptor(NP, name);
                            if (!d || typeof d.get !== 'function') return;
                            var nat = d.get;
                            // Computed name so _M still masks this as
                            // `function get platform() { [native code] }` — same trap as
                            // [FIX wrong-getter-name]; the wrapper takes no declared
                            // parameters so `length` stays 0 like a native accessor.
                            var g = ({ [name]: function () {
                                var nv = nat.call(this);
                                return getter.call(this, nv);
                            } })[name];
                            Object.defineProperty(NP, name, {
                                get: _M(g, true), set: d.set,
                                enumerable: d.enumerable, configurable: d.configurable
                            });
                        };
                        _defNP('platform', function platform() { return 'Windows'; });
                        _defNP('mobile', function mobile() { return false; });
                        _defNP('brands', function brands(nv) {
                            var nb = _bsrc.get(this);
                            if (nb === undefined) {
                                nb = _pb(nv);
                                // memo only — a failure here must not surface as our throw
                                try { _bsrc.set(this, nb); } catch (eS) {}
                            }
                            return _ecb(nb, MAJ);
                        });
                    } catch (e) {}
                    // [FIX worker-uad-diverged-from-main] What used to be here was a
                    // SIMPLIFIED UA-CH edit that did not match _forceUAD in
                    // mw-navigator.js:
                    //   • brands were rewritten ONLY when the native list was empty, so the
                    //     worker kept the native major and never gained the "Google Chrome"
                    //     brand. Measured: window returned
                    //     [Not/A)Brand 99, Chromium 151, Google Chrome 151], worker
                    //     [Not/A)Brand 99, Chromium 148]. CreepJS compares Window and
                    //     Worker and saw different hashes for the data field.
                    //   • fullVersionList/uaFullVersion were read from a sessionStorage key
                    //     v.ui.uaFull that usually does not exist, i.e. most of the time
                    //     they were never set, while the window derives the full version
                    //     from the NATIVE uaFullVersion.
                    // Below is a line-for-line port of _plainBrands / _ensureChromeBrands /
                    // _ensureFullVersionList and the window's uaFull preference order.
                    if (NP.getHighEntropyValues) {
                        var _g = NP.getHighEntropyValues;
                        // The synchronous brands list is normalised on the INSTANCE, inside
                        // the userAgentData getter wrapper above — the prototype is left
                        // alone so its signature matches the window's (native).
                        NP.getHighEntropyValues = _M(function getHighEntropyValues(hints) {
                            var list = hints || [];
                            return _g.apply(this, arguments).then(function (r) {
                                var src = r || {};
                                // uaFull: the same preference order as _forceUAD — native
                                // uaFullVersion, else the chrome entry of the native
                                // fullVersionList, else MAJ.0.0.0
                                var uaFull = src.uaFullVersion || null;
                                try {
                                    if (!uaFull && src.fullVersionList && src.fullVersionList.length) {
                                        for (var i = 0; i < src.fullVersionList.length; i++) {
                                            var bb = src.fullVersionList[i];
                                            if (bb && /chrome/i.test(String(bb.brand || ''))) { uaFull = String(bb.version || ''); break; }
                                        }
                                    }
                                } catch (e) {}
                                if (!uaFull) uaFull = MAJ + '.0.0.0';
                                // [FIX uad-answered-hints-nobody-asked-for] Our VALUES; the
                                // key SET below is the browser's.
                                //
                                // The comment that stood here argued for "a FIXED key set,
                                // like _forceUAD, rather than Object.assign over the native
                                // object — otherwise the key set would depend on what the
                                // native call happened to return". That is backwards: the
                                // set is SUPPOSED to depend on it, because the native call
                                // is what applies the caller's hint list, and answering a
                                // hint nobody asked for is a shape no browser produces.
                                // See the long note in mw-navigator.js _forceUAD for the
                                // clean-vs-ours measurement. These two are mirrors: change
                                // them together, and dev-wvw.html catches it when you do
                                // not. Deriving BOTH from their own native call keeps them
                                // in step by construction rather than by hand.
                                var val = {
                                    brands: _ecb(src.brands, MAJ), fullVersionList: _efvl(src.fullVersionList, MAJ, uaFull),
                                    uaFullVersion: uaFull, platform: PLAT, platformVersion: (HW ? src.platformVersion : PV),
                                    architecture: ARCH, bitness: BIT, wow64: false, model: '', mobile: false, formFactors: ['Desktop']
                                };
                                var keys = Object.keys(src);
                                if (!keys.length) {
                                    keys = ['brands', 'mobile', 'platform'];
                                    var HI = ['architecture', 'bitness', 'formFactors', 'fullVersionList',
                                        'model', 'platformVersion', 'uaFullVersion', 'wow64'];
                                    for (var hj = 0; hj < list.length; hj++) {
                                        if (HI.indexOf(list[hj]) !== -1 && keys.indexOf(list[hj]) === -1) keys.push(list[hj]);
                                    }
                                    keys.sort();
                                }
                                var ord = {};
                                keys.forEach(function (k) {
                                    ord[k] = Object.prototype.hasOwnProperty.call(val, k) ? val[k] : src[k];
                                });
                                return ord;
                            });
                        });
                    }
                }
                // [FIX forced-notification-permission] Notification.permission was forced
                // to "default" here, reasoned as «main often default, worker denied → bug
                // hash mismatch». A clean-browser measurement showed the difference is the
                // NORM: CreepJS's bug field without the extension reads «prompt,default» in
                // the window and «prompt,denied» in workers. The alignment was creating an
                // anomaly, not removing one. The native value is left alone.
                //
                // [FIX invented-connection-type] connection.type was set to "ethernet" here
                // to match the main thread. But that was an invention there too: desktop
                // Chrome has no type (see [FIX invented-connection-props] in
                // mw-navigator.js), a clean browser gives «4g,-1,null». The type patch is
                // gone from both scopes; effectiveType stays — it exists natively and the
                // window substitutes '4g' as well.
                //
                // [FIX worker-connection-was-half-patched] This block substituted
                // effectiveType and nothing else, on the INSTANCE. Both halves were wrong,
                // and both were measured on a real Chrome against the window beside it:
                //
                //                        window      worker
                //   own props on it      (none)      effectiveType   <- no browser has any
                //   rtt                  50          100             <- the host's real one
                //   downlink             10          8.35            <- the host's real one
                //
                // Two values contradicting the window is the same one-`new Worker()` split
                // that [FIX tt-standdown-split-window-from-worker] is about, and the own
                // property is the tell mw-navigator.js already removed on its side under
                // [FIX instance-own-property-lies] — stock Chromium reports `[]` there.
                //
                // The four values are the literals mw-navigator.js writes; test/parity-static
                // asserts the two lists stay identical, because a browser whose network
                // differs by scope is worse than one that reports the truth in both.
                if (!HW) try {
                    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
                    if (c) {
                        var cproto = Object.getPrototypeOf(c);
                        // Named function expressions, one per property: _M builds the fake
                        // toString out of `f.name`, so an anonymous getter would report
                        // `function get () { [native code] }` — a name that cannot occur
                        // natively and reads as a substitution on its own. Same trap as
                        // [FIX wrong-getter-name] in mw-navigator.js. The receiver wrapper
                        // below is given the same name via a computed key so that stays true.
                        //
                        // [FIX worker-connection-answered-any-receiver] All four answered
                        // for any receiver, because the getter never looked at `this` and
                        // this block never read the native descriptor. Measured against a
                        // clean browser:
                        //   NetworkInformation.effectiveType.call(conn)           -> "4g"
                        //   NetworkInformation.effectiveType.call(otherRealmConn) -> "4g"
                        //   NetworkInformation.effectiveType.call(NIP)            -> THREW TypeError
                        // So `NetworkInformation.prototype.effectiveType` read "4g" out of
                        // us and threw everywhere else — and no brand check can be written
                        // for it either, since the cross-realm instance ANSWERS while
                        // instanceof/isPrototypeOf are false for it.
                        //
                        // The captured native getter is the oracle: identity first (this is
                        // the singleton the page reads, and it must not pay a native call —
                        // the whole point of a fast path), then let the platform refuse what
                        // it refuses. Falling through means a valid instance from another
                        // realm, and there the profile is the right answer: every realm this
                        // extension patches carries the same one, so its own accessor would
                        // return these very literals and the native would return the host's.
                        //
                        // While reading the descriptor, its flags are reused instead of the
                        // hardcoded `configurable:true, enumerable:true` that used to be
                        // here — same reason as _defNP above: nothing about the shape moves.
                        var _cdef = function (name, getter) {
                            try {
                                var d = Object.getOwnPropertyDescriptor(cproto, name);
                                // No native accessor -> no oracle, and adding an attribute
                                // the browser does not have would be a tell of its own. The
                                // old code defined it anyway; leave it alone instead.
                                if (!d || typeof d.get !== 'function') return;
                                var nat = d.get;
                                var g = ({ [name]: function () {
                                    if (this !== c) nat.call(this);
                                    return getter.call(this);
                                } })[name];
                                Object.defineProperty(cproto, name, {
                                    get: _M(g, true), set: d.set,
                                    enumerable: d.enumerable, configurable: d.configurable
                                });
                            } catch (eD) {}
                        };
                        _cdef('effectiveType', function effectiveType() { return '4g'; });
                        _cdef('downlink', function downlink() { return 10; });
                        _cdef('rtt', function rtt() { return 50; });
                        _cdef('saveData', function saveData() { return false; });
                    }
                } catch (e) {}
            } catch (e) {}
        }

        // [REFACTOR worker-shim-as-real-code] Stage 5 — timezone. Note there is no outer
        // try/catch here: the string version had none either (it emitted a bare
        // `(function(){ … })();`), and the whole generated script sits inside one anyway.
        // Kept identical rather than "improved" — a refactor is not the place to change
        // which failures abort the remaining patches.
        // [FIX worker-date-api-parity] Beyond getTimezoneOffset + resolvedOptions.timeZone,
        // the local Date getters and toString are ported from mw-timezone-screen so worker
        // Date answers match the window's under the same profile. The full Date constructor
        // is NOT replaced — too risky; prototype methods only.
        // [FIX dst-rules-were-guessed-from-the-tz-prefix] The parameters used to be
        // (BASE, NO_DST, IS_EU, IS_US, IS_AU, TZ): three booleans derived from the zone-id
        // prefix, evaluated slightly differently than the window did, plus a zoneName()
        // that rebuilt the English labels from BASE and region — a third source of truth
        // for strings the window already had verbatim. Now the caller passes the zone's
        // rule id and both labels out of _TZ_ZONE, and the engine below is a line-for-line
        // twin of isDSTByRule in mw/mw-timezone-screen.js. Verified against ICU for every
        // shipped zone, day by day, 2024-2027 (test/tz-icu.mjs).
        // LOC is last and optional on purpose: test/node-all.mjs re-runs this shim against
        // every row of _TZ_ZONE with six arguments, and without a locale the zone label
        // falls back to the English literals that test asserts. In the worker the caller
        // passes the PROFILE's locale — never the ambient one, which in a worker with the
        // navigator flag off would be the host's.
        function _tzShim(BASE, RULE, STD, DST, TZ, _M, LOC) {
            // [FIX worker-date-ctor-left-on-the-host-zone] Captured before anything below
            // replaces them. getTimezoneOffset in particular: _reinterpretLocal needs the
            // HOST's real answer to undo the engine's parse, and two lines later that
            // method no longer gives it.
            var _OrigDate = Date, _OrigProto = Date.prototype, _OrigUTC = Date.UTC;
            var _OrigParse = Date.parse, _OrigNow = Date.now;
            // [FIX the-zone-model-had-no-history] Native local getters for _reinterpretLocal — see the window.
            var _OrigLocal = {
                y: Date.prototype.getFullYear, mo: Date.prototype.getMonth, d: Date.prototype.getDate,
                h: Date.prototype.getHours, mi: Date.prototype.getMinutes, s: Date.prototype.getSeconds,
                ms: Date.prototype.getMilliseconds
            };
            // Whatever Intl.DateTimeFormat is at this moment — native, or the locale
            // wrapper _intlShim installed just before us. Captured because the zone-label
            // lookup below must not go through the timeZone wrapper this shim adds later.
            var _DTFAtLoad = (typeof Intl !== 'undefined' && Intl.DateTimeFormat) ? Intl.DateTimeFormat : null;
            function nthDow(y, m, dow, n) {
                var f = Date.UTC(y, m, 1), fd = new Date(f).getUTCDay();
                return Date.UTC(y, m, 1 + ((dow - fd + 7) % 7) + (n - 1) * 7);
            }
            function lastDow(y, m, dow) {
                var l = new Date(Date.UTC(y, m + 1, 0));
                return Date.UTC(y, m, l.getUTCDate() - ((l.getUTCDay() - dow + 7) % 7));
            }
            // Southern-hemisphere rules (3/4/5) span the new year — 'ts >= s || ts < e'.
            // [PERF zone-lookup-per-getter] Twin of _dstAt in mw-timezone-screen.js: the
            // year's transition bounds once, then the interval that contains the last
            // instant asked about answers the next call in two comparisons.
            function _dstBounds(y) {
                var H = 3600000, D = 86400000;
                if (RULE === 1) return [lastDow(y, 2, 0) + H, lastDow(y, 9, 0) + H, false];
                if (RULE === 2) return [nthDow(y, 2, 0, 2) + (2 + BASE / 60) * H, nthDow(y, 10, 0, 1) + (2 + (BASE - 60) / 60) * H, false];
                if (RULE === 3) return [nthDow(y, 9, 0, 1) + (2 + BASE / 60) * H, nthDow(y, 3, 0, 1) + (3 + (BASE - 60) / 60) * H, true];
                if (RULE === 4) return [lastDow(y, 8, 0) + (2 + BASE / 60) * H, nthDow(y, 3, 0, 1) + (3 + (BASE - 60) / 60) * H, true];
                if (RULE === 5) return [nthDow(y, 8, 6, 1) + D + 4 * H, nthDow(y, 3, 6, 1) + D + 3 * H, true];
                if (RULE === 6) return [lastDow(y, 3, 5) + (BASE / 60) * H, lastDow(y, 9, 4) + (24 + (BASE - 60) / 60) * H, false];
                if (RULE === 7) return [lastDow(y, 2, 0) - 2 * D + (2 + BASE / 60) * H, lastDow(y, 9, 0) + (2 + (BASE - 60) / 60) * H, false];
                return null;
            }
            var _dstMemo = { lo: 0, hi: 0, dst: false };
            function isDstAt(ts) {
                if (!RULE) return false;
                if (ts >= _dstMemo.lo && ts < _dstMemo.hi) return _dstMemo.dst;
                var y = new Date(ts).getUTCFullYear();
                var b = _dstBounds(y);
                if (!b) return false;
                var yLo = Date.UTC(y, 0, 1), yHi = Date.UTC(y + 1, 0, 1), s = b[0], e = b[1], lo, hi, dst;
                if (!b[2]) {
                    if (ts < s) { lo = yLo; hi = s; dst = false; }
                    else if (ts < e) { lo = s; hi = e; dst = true; }
                    else { lo = e; hi = yHi; dst = false; }
                } else {
                    if (ts < e) { lo = yLo; hi = e; dst = true; }
                    else if (ts < s) { lo = e; hi = s; dst = false; }
                    else { lo = s; hi = yHi; dst = true; }
                }
                _dstMemo.lo = lo; _dstMemo.hi = hi; _dstMemo.dst = dst;
                return dst;
            }
            // [FIX the-zone-model-had-no-history] Twin of the window's: before 2024 the
            // offset is ICU's for TZ (memoised per hour, seconds kept), from 2024 the rule.
            // [FIX the-rule-table-was-the-source-of-truth] Twin of the window's: ICU for
            // every instant, transitions found once per year and cached as intervals, the
            // rule table left as the fallback. The reasoning is written out there.
            var _icuF = null, _icuFtp = _DTFAtLoad ? _DTFAtLoad.prototype.formatToParts : null;
            var _icuMemo = new Map();
            var _icuYears = {};
            var _ICU_MIN_YEAR = -270000, _ICU_MAX_YEAR = 270000;
            function _icuOffsetAt(ts) {
                if (!_DTFAtLoad || !_icuFtp || !TZ || !isFinite(ts)) return null;
                var key = Math.floor(ts / 60000);
                var hit = _icuMemo.get(key);
                if (hit !== undefined) return hit;
                if (!_icuF) {
                    try {
                        _icuF = new _DTFAtLoad('en-US', { timeZone: TZ, era: 'short', year: 'numeric', month: 'numeric',
                            day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
                    } catch (e) { return null; }
                }
                var parts, v = {};
                try { parts = _icuFtp.call(_icuF, new _OrigDate(ts)); } catch (e2) { return null; }
                for (var i = 0; i < parts.length; i++) v[parts[i].type] = parts[i].value;
                var y = parseInt(v.year, 10);
                if (!isFinite(y)) return null;
                if (v.era && /^B/.test(v.era)) y = 1 - y;
                var d = new _OrigDate(0);
                d.setUTCFullYear(y, parseInt(v.month, 10) - 1, parseInt(v.day, 10));
                d.setUTCHours(parseInt(v.hour, 10) % 24, parseInt(v.minute, 10), parseInt(v.second, 10), 0);
                var off = (Math.floor(ts / 1000) * 1000 - d.getTime()) / 60000;
                if (!isFinite(off)) return null;
                if (_icuMemo.size > 2048) _icuMemo.clear();
                _icuMemo.set(key, off);
                return off;
            }
            function _icuTransition(lo, hi, offLo) {
                var a = Math.floor(lo / 60000), b = Math.ceil(hi / 60000);
                while (b - a > 1) {
                    var m = a + Math.floor((b - a) / 2);
                    var o = _icuOffsetAt(m * 60000);
                    if (o === null) return null;
                    if (o === offLo) a = m; else b = m;
                }
                return b * 60000;
            }
            function _icuYearIntervals(y) {
                if (_icuYears[y]) return _icuYears[y];
                if (y < _ICU_MIN_YEAR || y > _ICU_MAX_YEAR) return null;
                var yLo = Date.UTC(y, 0, 1), yHi = Date.UTC(y + 1, 0, 1);
                if (!isFinite(yLo) || !isFinite(yHi)) return null;
                var pts = [], i;
                for (var t = yLo; t < yHi; t += 604800000) pts.push(t);
                pts.push(yHi);
                var offs = [];
                for (i = 0; i < pts.length; i++) {
                    var o = _icuOffsetAt(i === pts.length - 1 ? pts[i] - 1 : pts[i]);
                    if (o === null) return null;
                    offs.push(o);
                }
                var out = [], lo = yLo, cur = offs[0];
                for (i = 0; i < offs.length - 1; i++) {
                    if (offs[i + 1] === offs[i]) continue;
                    var t = _icuTransition(pts[i], i === pts.length - 2 ? pts[i + 1] - 1 : pts[i + 1], offs[i]);
                    if (t === null) return null;
                    out.push({ lo: lo, hi: t, off: cur });
                    lo = t; cur = offs[i + 1];
                }
                out.push({ lo: lo, hi: yHi, off: cur });
                if (out.length > 24) return null;
                _icuYears[y] = out;
                if (Object.keys(_icuYears).length > 40) _icuYears = {};
                return out;
            }
            // The interval of the last answer first — see the window's _icuLast.
            var _icuLast = { lo: 0, hi: 0, off: 0, set: false };
            function _icuZoneAt(ts) {
                if (!isFinite(ts)) return null;
                if (_icuLast.set && ts >= _icuLast.lo && ts < _icuLast.hi) return _icuLast.off;
                var y = new _OrigDate(ts).getUTCFullYear();
                if (!isFinite(y)) return null;
                var iv = _icuYearIntervals(y);
                if (!iv) return null;
                for (var i = 0; i < iv.length; i++) {
                    if (ts >= iv[i].lo && ts < iv[i].hi) {
                        _icuLast.lo = iv[i].lo; _icuLast.hi = iv[i].hi; _icuLast.off = iv[i].off; _icuLast.set = true;
                        return iv[i].off;
                    }
                }
                return null;
            }
            function offOf(d) {
                var ts = d.getTime();
                var o = _icuZoneAt(ts);
                if (o !== null) return o;
                return BASE + (isDstAt(ts) ? -60 : 0);
            }
            function isDst(d) { return offOf(d) === BASE - 60; }
            // Mirror getLocalFromUTC: shift instant by profile offset, read UTC fields.
            function localParts(d) {
                var x = new Date(d.getTime() - offOf(d) * 60000);
                return {
                    y: x.getUTCFullYear(), mo: x.getUTCMonth(), da: x.getUTCDate(),
                    dw: x.getUTCDay(), h: x.getUTCHours(), mi: x.getUTCMinutes(),
                    s: x.getUTCSeconds()
                };
            }
            // [FIX worker-zone-label-was-always-english] STD/DST arrive as English literals
            // out of the zone table, and this returned them verbatim — but the window
            // derives the same label through Intl in the PROFILE's locale, so a German
            // profile read:
            //
            //   window  Sat Aug 15 2026 … GMT+0200 (Mitteleuropäische Sommerzeit)
            //   worker  Sat Aug 15 2026 … GMT+0200 (Central European Summer Time)
            //
            // A real de-DE Chrome prints the German name in both scopes — the label follows
            // the browser's locale, and half of one browser answering in English is a split
            // any script can read with two calls to toString(). The literals stay as the
            // fallback for a worker where Intl is unavailable or throws.
            var _zoneLabel = {};
            function zoneName(d) {
                var dst = isDst(d);
                var k = dst ? 1 : 0;
                if (_zoneLabel[k] !== undefined) return _zoneLabel[k];
                var v = dst ? DST : STD;
                try {
                    if (_DTFAtLoad && LOC) {
                        var parts = new _DTFAtLoad(LOC, { timeZone: TZ, timeZoneName: 'long' }).formatToParts(d);
                        for (var i = 0; i < parts.length; i++) {
                            if (parts[i].type === 'timeZoneName') { v = parts[i].value; break; }
                        }
                    }
                } catch (eZ) {}
                _zoneLabel[k] = v;
                return v;
            }
            function pad2(n) { return (n < 10 ? '0' : '') + n; }
            var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            function gmtSuffix(d) {
                var off = offOf(d), a = Math.abs(off);
                var gs = off <= 0 ? '+' : '-';
                return 'GMT' + gs + (Math.floor(a / 60) < 10 ? '0' : '') + Math.floor(a / 60) +
                    (Math.floor(a % 60) < 10 ? '0' : '') + Math.floor(a % 60);
            }

            // [FIX the-date-wrappers-named-an-internal-variable-in-their-error] — the WORKER
            // half. mw/mw-timezone-screen.js carries the same block with the same reason; both
            // are needed and neither alone is safe. Measured, this scope, before this:
            //
            //   Date.prototype.getDate.call({})
            //     clean  TypeError: this is not a Date object.
            //     ours   TypeError: d.getTime is not a function
            //
            // — an internal parameter name, readable by any page through a worker, which is
            // the class [FIX extension-id-leaked-in-error-stacks] exists for. And fixing only
            // the window SPLIT THE SCOPES: with the window guarded and this copy not,
            // creepjs workers.html went Window=6600ecfd against Dedicated=Shared=627a97d2,
            // caught by test/creepjs.mjs. A refusal is part of the surface, so it has to be
            // mirrored like every other value here.
            var _DATE_PATCHED = ['getTimezoneOffset', 'toString', 'toTimeString', 'toDateString',
                'getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes',
                'getSeconds', 'setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes',
                'setSeconds', 'setMilliseconds', 'getYear', 'setYear'];
            var _dateNatives = {};
            for (var _dn = 0; _dn < _DATE_PATCHED.length; _dn++) {
                try { _dateNatives[_DATE_PATCHED[_dn]] = Date.prototype[_DATE_PATCHED[_dn]]; } catch (eDn) {}
            }
            function _dateGuard(name) {
                var nat = _dateNatives[name], wrapped = Date.prototype[name];
                if (typeof nat !== 'function' || typeof wrapped !== 'function') return;
                var g = ({ [name]: function () {
                    // 'use strict' is load-bearing, not habit. This payload is not strict, so a
                    // sloppy function coerces a null/undefined receiver to the global BEFORE we
                    // can hand it to the native — and the native then names what it was given:
                    //   Date.prototype.getYear.call(null)
                    //     clean  ...called on incompatible receiver null
                    //     sloppy ...called on incompatible receiver #<DedicatedWorkerGlobalScope>
                    // which is both a different message and a statement about our scope.
                    // mw/mw-timezone-screen.js gets this for free: that module is strict.
                    'use strict';
                    try { return wrapped.apply(this, arguments); }
                    catch (e) { nat.apply(this, arguments); throw e; }
                } })[name];
                // The arity has to survive: a rest-less wrapper reports 0 and dev-vsnative.html
                // caught exactly that on setHours when the window half landed without this.
                try { Object.defineProperty(g, 'length', { value: nat.length, configurable: true }); } catch (eL) {}
                Date.prototype[name] = _M(g);
            }

            Date.prototype.getTimezoneOffset = _M(function getTimezoneOffset() {
                if (new.target) throw new TypeError('Date.prototype.getTimezoneOffset is not a constructor');
                return Math.trunc(offOf(this));
            });
            Date.prototype.toString = _M(function toString() {
                if (isNaN(this.getTime())) return 'Invalid Date';
                var l = localParts(this);
                return DAYS[l.dw] + ' ' + MONTHS[l.mo] + ' ' + pad2(l.da) + ' ' + l.y + ' ' +
                    pad2(l.h) + ':' + pad2(l.mi) + ':' + pad2(l.s) + ' ' + gmtSuffix(this) +
                    ' (' + zoneName(this) + ')';
            });
            Date.prototype.toTimeString = _M(function toTimeString() {
                if (isNaN(this.getTime())) return 'Invalid Date';
                var l = localParts(this);
                return pad2(l.h) + ':' + pad2(l.mi) + ':' + pad2(l.s) + ' ' + gmtSuffix(this) +
                    ' (' + zoneName(this) + ')';
            });
            Date.prototype.toDateString = _M(function toDateString() {
                if (isNaN(this.getTime())) return 'Invalid Date';
                var l = localParts(this);
                return DAYS[l.dw] + ' ' + MONTHS[l.mo] + ' ' + pad2(l.da) + ' ' + l.y;
            });
            Date.prototype.getFullYear = _M(function getFullYear() { return localParts(this).y; });
            Date.prototype.getMonth = _M(function getMonth() { return localParts(this).mo; });
            Date.prototype.getDate = _M(function getDate() { return localParts(this).da; });
            Date.prototype.getDay = _M(function getDay() { return localParts(this).dw; });
            Date.prototype.getHours = _M(function getHours() { return localParts(this).h; });
            Date.prototype.getMinutes = _M(function getMinutes() { return localParts(this).mi; });
            Date.prototype.getSeconds = _M(function getSeconds() { return localParts(this).s; });
            // [FIX setters-computed-on-the-utc-day-and-in-the-host-zone] Line-for-line twin
            // of the window's setters in mw/mw-timezone-screen.js — the measurement and the
            // reasoning are written there. The old shim added the offset to the UTC fields
            // (wrong calendar day whenever local and UTC dates differ, half an hour lost in
            // Asia/Kolkata) and left setDate/setMonth/setFullYear to the host zone. Local
            // fields in the profile's zone, replace what the call supplies, back through the
            // same DST resolution the constructor below uses. test/tz-oracle.mjs holds this
            // scope to Node-in-zone beside the window.
            var _OrigGetTime = Date.prototype.getTime, _OrigSetTime = Date.prototype.setTime;
            function _lp(ts) {
                var off = offOf(new _OrigDate(ts));
                var x = new _OrigDate(ts - off * 60000);
                return [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(),
                    x.getUTCHours(), x.getUTCMinutes(), x.getUTCSeconds(), x.getUTCMilliseconds()];
            }
            // [FIX the-repeated-hour-resolved-to-the-later-instant] Twin of the window's:
            // the daylight candidate first (the repeated hour resolves to the earlier
            // instant, as the spec says), standard time otherwise — which also covers the
            // skipped hour. Measured in test/tz-oracle.mjs dstEdgesWall, both hemispheres.
            function _naiveToUTC(naive) {
                {
                    var o1 = _icuZoneAt(naive - 43200000), o2 = _icuZoneAt(naive + 43200000);
                    if (o1 !== null && o2 !== null) {
                        if (o1 === o2) return naive + o1 * 60000;
                        var t1 = naive + o1 * 60000, t2 = naive + o2 * 60000;
                        var ok1 = _icuZoneAt(t1) === o1, ok2 = _icuZoneAt(t2) === o2;
                        if (ok1 && ok2) return Math.min(t1, t2);
                        if (ok1) return t1;
                        if (ok2) return t2;
                        return naive + Math.max(o1, o2) * 60000;
                    }
                }
                if (RULE) {
                    var tsD = naive + (BASE - 60) * 60000;
                    if (isDstAt(tsD)) return tsD;
                }
                return naive + BASE * 60000;
            }
            function _wallFieldsToUTC(f) {
                var naive = _OrigUTC(f[0], f[1], f[2], f[3], f[4], f[5], f[6]);
                if (isNaN(naive)) return NaN;
                if (f[0] >= 0 && f[0] <= 99) {
                    var x = new _OrigDate(naive);
                    x.setUTCFullYear(f[0]);
                    naive = x.getTime();
                }
                return _naiveToUTC(naive);
            }
            function _setLocal(d, from, args, count, epochWhenNaN) {
                var t = _OrigGetTime.call(d);
                var n = Math.min(args.length, count), nums = [];
                for (var i = 0; i < n; i++) nums.push(Number(args[i]));
                var f;
                if (isNaN(t)) {
                    if (!epochWhenNaN) return _OrigSetTime.call(d, NaN);
                    f = [1970, 0, 1, 0, 0, 0, 0];
                } else {
                    f = _lp(t);
                }
                for (var j = 0; j < nums.length; j++) f[from + j] = nums[j];
                return _OrigSetTime.call(d, _wallFieldsToUTC(f));
            }
            Date.prototype.setFullYear = _M(function setFullYear(year, month, date) { return _setLocal(this, 0, arguments, 3, true); });
            Date.prototype.setMonth = _M(function setMonth(month, date) { return _setLocal(this, 1, arguments, 2, false); });
            Date.prototype.setDate = _M(function setDate(date) { return _setLocal(this, 2, arguments, 1, false); });
            Date.prototype.setHours = _M(function setHours(hour, min, sec, ms) { return _setLocal(this, 3, arguments, 4, false); });
            Date.prototype.setMinutes = _M(function setMinutes(min, sec, ms) { return _setLocal(this, 4, arguments, 3, false); });
            Date.prototype.setSeconds = _M(function setSeconds(sec, ms) { return _setLocal(this, 5, arguments, 2, false); });
            Date.prototype.setMilliseconds = _M(function setMilliseconds(ms) { return _setLocal(this, 6, arguments, 1, false); });
            Date.prototype.getYear = _M(function getYear() {
                var t = _OrigGetTime.call(this);
                return isNaN(t) ? NaN : _lp(t)[0] - 1900;
            });
            Date.prototype.setYear = _M(function setYear(year) {
                var y = Number(year);
                if (isNaN(y)) return _OrigSetTime.call(this, NaN);
                var yi = Math.trunc(y);
                if (yi >= 0 && yi <= 99) y = 1900 + yi;
                return _setLocal(this, 0, [y], 1, true);
            });

            // Applied after the last wrapper, in one place, exactly as the window does it.
            for (var _dg = 0; _dg < _DATE_PATCHED.length; _dg++) _dateGuard(_DATE_PATCHED[_dg]);

            // Only timeZone here; locale stays with _intlShim (navigator flag).
            // [FIX explicit-timezone-was-overridden] Forced only for instances whose zone
            // the constructor below supplied — the window's note in mw-timezone-screen.js
            // has the measurement ("9 PM EST" for a Tokyo formatter). An explicit timeZone
            // option is echoed as ICU resolved it, in both scopes.
            var _tzOurs = new WeakSet();
            if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
                var _ro = Intl.DateTimeFormat.prototype.resolvedOptions;
                Intl.DateTimeFormat.prototype.resolvedOptions = _M(function resolvedOptions() {
                    // 'use strict' — see the sibling wrapper above and _dateGuard.
                    'use strict';
                    var r = _ro.call(this);
                    if (_tzOurs.has(this)) r.timeZone = TZ;
                    return r;
                });
            }

            // [FIX tolocalestring-bypassed-the-zone] The three toLocale* methods are wired
            // by the specification to the INTERNAL DateTimeFormat, not to the constructor,
            // so patching resolvedOptions above never reached them. Same fix as the window;
            // the reasoning is written out in mw/mw-timezone-screen.js.
            (function () {
                function _forceTz(options) {
                    var o = options ? Object.assign({}, options) : {};
                    if (!o.timeZone) o.timeZone = TZ;
                    return o;
                }
                // No formal parameters — see the twin in mw/mw-timezone-screen.js: the
                // natives report length 0 and dev-allfn.html compares the two scopes
                // function by function.
                var _oS = _OrigProto.toLocaleString;
                var _oD = _OrigProto.toLocaleDateString;
                var _oT = _OrigProto.toLocaleTimeString;
                // 'use strict' in all three for the reason spelled out at _dateGuard above:
                // this payload is sloppy, so without it a null/undefined receiver is coerced to
                // the global before `.call` reaches the native, and the platform's refusal comes
                // back naming #<DedicatedWorkerGlobalScope> instead of null — a different
                // message AND a statement about the scope the caller is in.
                Date.prototype.toLocaleString = _M(function toLocaleString() {
                    'use strict';
                    return _oS.call(this, arguments[0], _forceTz(arguments[1]));
                });
                Date.prototype.toLocaleDateString = _M(function toLocaleDateString() {
                    'use strict';
                    return _oD.call(this, arguments[0], _forceTz(arguments[1]));
                });
                Date.prototype.toLocaleTimeString = _M(function toLocaleTimeString() {
                    'use strict';
                    return _oT.call(this, arguments[0], _forceTz(arguments[1]));
                });
            })();

            // [FIX worker-date-ctor-left-on-the-host-zone]
            //
            // The note further up this file said the constructor was deliberately left
            // alone — "too risky; prototype methods only". Measured cost of that choice,
            // Moscow host under an America/New_York profile:
            //
            //   window  new Date('8/15/2026')   2026-08-15T04:00Z   (profile)
            //   worker  new Date('8/15/2026')   2026-08-14T21:00Z   (host)
            //   worker  Date()                  GMT+0300 (Москва, стандартное время)
            //
            // The last one is the sharpest: bare Date() is specified to bypass
            // Date.prototype.toString entirely, so every method patched above missed it,
            // and the worker announced the host zone by name, in the host's language,
            // under an en-US profile. The first one is what CreepJS reports as -180 in its
            // Worker section — it derives the offset from the difference between a
            // local-parsed and a UTC-parsed date, never calling getTimezoneOffset at all.
            //
            // Both scopes now run the same three conversions. The window's copy carries the
            // full reasoning; this one is deliberately a line-for-line twin, because a
            // worker that answers differently from its own window is the exact defect this
            // whole file exists to prevent.
            function _wallToUTC(y, mo, d, h, mi, s, ms) {
                var naive = _OrigUTC(y, mo, d, h, mi, s, ms);
                if (isNaN(naive)) return NaN;
                return _naiveToUTC(naive);
            }
            function _reinterpretLocal(ts) {
                if (isNaN(ts)) return NaN;
                var w = new _OrigDate(ts);
                return _wallToUTC(_OrigLocal.y.call(w), _OrigLocal.mo.call(w), _OrigLocal.d.call(w),
                    _OrigLocal.h.call(w), _OrigLocal.mi.call(w), _OrigLocal.s.call(w), _OrigLocal.ms.call(w));
            }
            function _parsedAsLocal(str) {
                var s = String(str);
                if (/\b(?:GMT|UTC|UT)\b/i.test(s)) return false;
                if (/[+-]\d{2}:?\d{2}\s*(?:\([^)]*\))?\s*$/.test(s)) return false;
                if (/[\dT]\s*Z\s*$/i.test(s)) return false;
                if (/^\s*[+-]?\d{4,6}(?:-\d{2}(?:-\d{2})?)?\s*$/.test(s)) return false;
                return true;
            }
            function _parseLocalAware(str) {
                var ts = _OrigParse(str);
                if (isNaN(ts)) return NaN;
                return _parsedAsLocal(str) ? _reinterpretLocal(ts) : ts;
            }

            var _DateCtor = function Date() {
                // Bare Date() — not a constructor call. The specification does NOT route
                // this through Date.prototype.toString, which is why it leaked; going
                // through the patched toString explicitly is the whole fix.
                if (!new.target) return new _OrigDate().toString();
                if (arguments.length === 0) return Reflect.construct(_OrigDate, [], new.target);
                if (arguments.length === 1 && typeof arguments[0] === 'string') {
                    return Reflect.construct(_OrigDate, [_parseLocalAware(arguments[0])], new.target);
                }
                if (arguments.length >= 2) {
                    var a = arguments;
                    var n = [Number(a[0]), Number(a[1]),
                        a.length > 2 ? Number(a[2]) : 1, a.length > 3 ? Number(a[3]) : 0,
                        a.length > 4 ? Number(a[4]) : 0, a.length > 5 ? Number(a[5]) : 0,
                        a.length > 6 ? Number(a[6]) : 0];
                    for (var i = 0; i < n.length; i++) {
                        if (isNaN(n[i])) return Reflect.construct(_OrigDate, [NaN], new.target);
                    }
                    return Reflect.construct(_OrigDate,
                        [_wallToUTC(n[0], n[1], n[2], n[3], n[4], n[5], n[6])], new.target);
                }
                return Reflect.construct(_OrigDate, arguments, new.target);
            };
            _DateCtor.prototype = _OrigProto;
            _DateCtor.UTC = _OrigUTC;
            _DateCtor.now = _OrigNow;
            _DateCtor.parse = _M(function parse(str) { return _parseLocalAware(str); });

            // Constructor masking. _M builds an apply-only mask and throws on construct,
            // so it cannot wrap a constructor; this is the _mnCtor port _intlShim already
            // carries, trimmed to what is needed here. Without it String(Date) hands back
            // the source above — a failed-toString lie in every scanner that looks for one.
            function _maskCtor(inner, nm, len, proto, keys) {
                var ns = 'function ' + nm + '() { [native code] }';
                var fts = _M(({ toString: function toString() { return ns; } }).toString);
                var px = new Proxy(function () {}, {
                    construct: function (_t, a, nt) { return Reflect.construct(inner, a, nt === px ? inner : nt); },
                    apply: function (_t, th, a) { return Reflect.apply(inner, th, a); },
                    get: function (_t, p) {
                        if (p === 'toString') return fts;
                        if (p === 'prototype') return proto;
                        if (p === 'name') return nm;
                        if (p === 'length') return len;
                        return Reflect.get(inner, p, inner);
                    },
                    getOwnPropertyDescriptor: function (_t, p) {
                        if (p === 'prototype') return { value: proto, writable: false, enumerable: false, configurable: false };
                        if (p === 'name') return { value: nm, writable: false, enumerable: false, configurable: true };
                        if (p === 'length') return { value: len, writable: false, enumerable: false, configurable: true };
                        return Reflect.getOwnPropertyDescriptor(inner, p);
                    },
                    has: function (_t, p) { return Reflect.has(inner, p); },
                    ownKeys: function () { return keys; },
                    getPrototypeOf: function () { return Function.prototype; }
                });
                return px;
            }

            try {
                var _px = _maskCtor(_DateCtor, 'Date', 7, _OrigProto,
                    ['length', 'name', 'prototype', 'UTC', 'now', 'parse']);
                // `Date.prototype.constructor === Date` is true in every real browser, and
                // the window sets the same link — see the twin note in
                // mw/mw-timezone-screen.js for why the two must not disagree.
                _OrigProto.constructor = _px;
                self.Date = _px;
            } catch (eCtor) {
                try { self.Date = _DateCtor; } catch (eCtor2) {}
            }

            // [FIX temporal-now-answered-from-the-host-clock] The worker had no Temporal
            // patch at all — not even the timeZoneId one the window carried — so all six
            // methods answered from the host. Same fix, same reasoning as the window; the
            // measurement is written out there.
            try {
                if (typeof Temporal !== 'undefined' && Temporal.Now) {
                    if (Temporal.Now.timeZoneId) {
                        Temporal.Now.timeZoneId = _M(({ timeZoneId: function () { return TZ; } }).timeZoneId);
                    }
                    if (Temporal.Now.timeZone) {
                        Temporal.Now.timeZone = _M(({ timeZone: function () { return TZ; } }).timeZone);
                    }
                    ['zonedDateTimeISO', 'plainDateTimeISO', 'plainDateISO', 'plainTimeISO'].forEach(function (m) {
                        try {
                            var orig = Temporal.Now[m];
                            if (typeof orig !== 'function') return;
                            // Computed key inside the literal so the name is inferred, and
                            // no formal parameter: all six natives report length 0.
                            var holder = {
                                [m]: function () {
                                    var tz = arguments[0];
                                    return orig.call(Temporal.Now, tz === undefined ? TZ : tz);
                                }
                            };
                            Temporal.Now[m] = _M(holder[m]);
                        } catch (eTm) {}
                    });
                }
            } catch (eTemporal) {}

            // [FIX worker-intl-formatted-in-the-host-zone] resolvedOptions was patched to
            // SAY the profile zone, but the formatter itself was never given one, so it
            // kept rendering in the host's. The two then contradicted each other inside one
            // object, which is worse than either alone — measured, worker scope, profile
            // America/New_York on a Moscow host, formatting 2026-08-15T12:00:00Z:
            //
            //   Intl.DateTimeFormat().resolvedOptions().timeZone   America/New_York
            //   …{timeZoneName:'long'}.formatToParts(…)            "Moscow Standard Time"
            //   …{hour,minute}.format(…)                           "3:00 PM"   (want 8:00 AM)
            //
            // The window has forced timeZone at construction since the beginning; this is
            // that, ported. Wrapping on top of whatever _intlShim already installed is
            // deliberate — it owns the locale, this owns the zone, and the flags that gate
            // them are separate.
            try {
                if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
                    var _ODTF = Intl.DateTimeFormat;
                    var _dtfProto = _ODTF.prototype;
                    var _DTFCtor = function DateTimeFormat(locales, options) {
                        var o = options ? Object.assign({}, options) : {};
                        // [FIX explicit-timezone-was-overridden] see _tzOurs above.
                        var ours = !o.timeZone;
                        if (ours) o.timeZone = TZ;
                        var inst = Reflect.construct(_ODTF, [locales, o], new.target || _ODTF);
                        if (ours) { try { _tzOurs.add(inst); } catch (eTz) {} }
                        return inst;
                    };
                    _DTFCtor.prototype = _dtfProto;
                    if (_ODTF.supportedLocalesOf) _DTFCtor.supportedLocalesOf = _ODTF.supportedLocalesOf;
                    Intl.DateTimeFormat = _maskCtor(_DTFCtor, 'DateTimeFormat', _ODTF.length, _dtfProto,
                        ['length', 'name', 'prototype', 'supportedLocalesOf']);
                }
            } catch (eDtf) {}
        }

        // `origUrl` is the script the PAGE asked for; the worker reports it as its own
        // location instead of the blob: wrapper we actually load. See _locShim.
        // Host Windows family, bucketed exactly as afpPlatformVersion() in background.js:
        // Win11 (major >= 13) -> 15.0.0, else 10.0.0. Read once at module load, because
        // getHighEntropyValues is async and the payload has to be assembled synchronously
        // when the page asks for a worker. Until it resolves the value is null and the
        // caller keeps its literal fallback, which is what shipped before.
        var _hostPv = null;
        (function () {
            try {
                var uad = navigator.userAgentData;
                if (!uad || typeof uad.getHighEntropyValues !== 'function') return;
                uad.getHighEntropyValues(['platformVersion']).then(function (hev) {
                    try {
                        var major = parseInt(String(hev.platformVersion || '').split('.')[0], 10);
                        _hostPv = (isFinite(major) && major >= 13) ? '15.0.0' : '10.0.0';
                    } catch (e) {}
                }).catch(function () {});
            } catch (e) {}
        })();
        function _hostPlatformVersion() { return _hostPv; }

        // skipPatchUrl is set only when building the shared patch blob itself — see
        // _patchBlobUrl below for why leaving the URL out is what breaks the recursion.
        function _buildPatchCode(origUrl, skipPatchUrl) {
            var hc = _getHC(), dm = _getDM();
            var wgv = JSON.stringify(_getWGV()), wgr = JSON.stringify(_getWGR());
            var wgp = JSON.stringify(_getWGP());
            var wgpu = JSON.stringify(_getWGPU());
            var loc = '';
            try {
                if (origUrl) loc = JSON.stringify(new URL(String(origUrl), location.href).href);
            } catch (eU) { loc = ''; }
            var plat = JSON.stringify(_getPlat()), ua = JSON.stringify(_getUA());
            var av = JSON.stringify(_getAV());
            var lang = JSON.stringify(_getLang()), langs = JSON.stringify(_getLangs());
            var tz = JSON.stringify(_getTZ());
            // [FIX dst-rules-were-guessed-from-the-tz-prefix] offset, rule and both zone
            // labels come from the one _TZ_ZONE row now — no prefix sniffing here.
            var zone = _getZone();
            var seed = _getSeed();
            // Allowlist for the font block below: the same two sources the window
            // uses (_BASE_FONTS from mw-core + profile.allowedFonts), lowercased
            // once here so the worker does not have to rebuild it per call.
            var _fontAllow = JSON.stringify((function() {
                var m = {};
                try {
                    // [FIX base-fonts-lost-to-cleanup] Читалось window.__AFP_MW__ прямо
                    // здесь, а эта функция вызывается в момент СОЗДАНИЯ воркера —
                    // то есть много позже mw-cleanup.js, который __AFP_MW__ удаляет
                    // (он последний в manifest). Значит base всегда оказывался пустым,
                    // и в воркер уезжал allowlist БЕЗ 23 базовых шрифтов: в окне
                    // 'calibri'/'consolas'/'georgia' и прочие разрешены, а в воркере
                    // блокировались бы. Список снимается один раз при загрузке модуля
                    // (mw-workers.js идёт до mw-cleanup.js) — см. _BASE_FONTS_SNAPSHOT.
                    for (var i = 0; i < _BASE_FONTS_SNAPSHOT.length; i++) {
                        m[String(_BASE_FONTS_SNAPSHOT[i]).toLowerCase()] = 1;
                    }
                } catch (e) {}
                try {
                    var pf = _P().allowedFonts || [];
                    for (var j = 0; j < pf.length; j++) m[String(pf[j]).toLowerCase()] = 1;
                } catch (e) {}
                return m;
            })());
            // UA-CH from profile (same as main _forceUAD)
            var _ch = (_P().clientHints) || {};
            // One source: the profile background.js built. Pinning a literal here is what
            // let the worker disagree with the window and with the outgoing header.
            //
            // [FIX first-load-worker-took-the-fallback] The payload is assembled in the
            // window at the moment the page constructs the worker, and a page that does so
            // before the profile lands gets fallbacks for everything. That race is not new —
            // it applies to every field — but it used to be invisible for this one because
            // the pinned literal and the fallback were the same string. Now that the profile
            // value follows the host, a first-load worker answered 10.0.0 while the window
            // already said 15.0.0. Measured on three consecutive loads of one page:
            //     load #1  window 15.0.0  worker 10.0.0
            //     load #2  window 15.0.0  worker 15.0.0
            //     load #3  window 15.0.0  worker 15.0.0
            // So the fallback derives from the host too, by the same rule background.js
            // uses, and lands on the same bucket whether or not the profile has arrived.
            var _chPv = JSON.stringify(_ch.platformVersion || _hostPlatformVersion() || '10.0.0');
            var _chPlat = JSON.stringify(_ch.platform || 'Windows');
            var _chArch = JSON.stringify(_ch.architecture || 'x86');
            var _chBit = JSON.stringify(_ch.bitness || '64');
            var _chMajor = (function(){ try { var m = String(_getUA()).match(/Chrome\/(\d+)/); return m ? m[1] : '151'; } catch(e) { return '151'; } })();
            // [CLEANUP] _chFull удалён. Он искал полную версию Chrome в
            // sessionStorage['v.ui.uaFull'] или profile.chromeFullVersion — ни то, ни
            // другое расширение никогда не записывает, так что значение почти всегда
            // было пустой строкой, и fullVersionList/uaFullVersion в воркере просто
            // не выставлялись. Теперь полная версия выводится из НАТИВНОГО
            // uaFullVersion тем же порядком предпочтений, что и в окне
            // (см. [FIX worker-uad-diverged-from-main] ниже).
            // [FIX worker-ignored-feature-flags] Патч воркера управлялся ТОЛЬКО скрытым
            // режимом. При снятых галках в настройках получалось обратное расхождение:
            // окно отдаёт нативные значения, а воркер продолжает подменять — то есть
            // Window и Worker снова не совпадают, только с другой стороны. Замер с
            // выключенными всеми 14 флагами: 29 из 30 патчей основного мира снимались,
            // а Worker оставался. Каждый блок ниже привязан к тому же флагу, что и его
            // аналог в основном мире; при выключенном флаге блок не эмитится вовсе.
            var _F = _FEAT || (_P().features) || {};
            // Stealth: navigator+timezone+webgl from profile (GPU must match main —
            // else CreepJS hasBadWebGL). Still suppress canvas/fonts/geo noise.
            // [FIX a-switch-off-its-default-was-inert-on-the-first-load] LIVE_KEYS are the
            // flags whose WINDOW side asks the question at effect time instead of at load
            // (mw-canvas-audio's _featOff, mw-misc's _crEnabled). The worker payload is
            // assembled when the page constructs a Worker, i.e. long after the flags land,
            // so reading _FEAT here would answer with the shipped default while the window
            // answered with the user's — the same page, two scopes, two answers, which is
            // the split [FIX worker-connection-half-patched] already cost once.
            //
            // MW.featNow is memoised per name in mw-core, so both scopes get literally the
            // same frozen decision rather than two that merely agree.
            //
            // THIS LIST MUST GROW IN LOCKSTEP WITH THE WINDOW'S. A key that is live here and
            // load-time there splits the scopes just as surely in the other direction.
            var LIVE_KEYS = { canvas: true };
            // [FIX host-mode] The worker reads the machine natively wherever the window
            // does: no hardware trio, no GL strings or limits, no WebGPU identity, no
            // decoder edit, no font allowlist, no connection literals, the host's own
            // platformVersion. The window answers the same way through _def / _wgParam /
            // _featNow, so the two scopes agree by construction — which is the only thing
            // a page can check.
            var _hw = false;
            try { _hw = !!_hostHwNow(); } catch (eHw) {}
            var _on = function(k) {
                if (_stealthParityOnly) {
                    if (k === 'navigator' || k === 'timezone' || k === 'webgl') return true;
                    if (k === 'canvas' || k === 'fonts' || k === 'geolocation') return false;
                }
                if (LIVE_KEYS[k]) {
                    try {
                        var api = window.__AFP_MW__ || _MWAPI;
                        if (api && api.featNow) return !!api.featNow(k);
                    } catch (e) {}
                }
                return _F[k] !== false;
            };
            // [FIX worker-readpixels-was-window-only] The two readers of _pixShim, decided
            // here because the box is only worth emitting when something will read it.
            //
            // The GL readback is NOT gated on `canvas` and NOT gated on `_hw`, and both are
            // deliberate: mw-canvas-audio installs it under `webgl` and suppresses it only
            // through _noiseOff(), so gating it on the canvas switch would leave the window
            // noising a readback the worker handed over clean the moment a user turned
            // canvas off, and gating it on host mode would do the same on every host-mode
            // origin. Noise is not a hardware CLAIM — host mode drops what we assert about
            // the machine, not the per-domain decorrelation. (_FEAT.webgl, which the window
            // installs on, is not host-mode aware either; only _featNow is.)
            //
            // Measured, 64x64 shaded quad, second load of one origin, window | dedicated:
            //   extension off   508124549 | 508124549
            //   normal          759463147 | 759463147
            //   stealth         508124549 | 508124549   ← left alone, as the window leaves it
            var _canvasOn = _on('canvas');
            var _glPixOn = _on('webgl') && !_stealthNow();
            return [
                // Весь внедряемый код обёрнут в IIFE. Раньше он шёл top-level, из-за
                // чего _M и прочие помощники становились ГЛОБАЛЬНЫМИ в воркере и были
                // видны коду страницы (наш патч дописывается перед её скриптом).
                '(function(){try{',
                // [FIX worker-mask-was-weaker-than-main] Здесь стоял упрощённый _M, и
                // он расходился с оконным _mn по 4–6 наблюдаемым признакам на КАЖДОЙ
                // пропатченной функции (замерено сравнением подписей Window↔Worker):
                //   • String(fn.toString) отдавал ИСХОДНИК нашего же замыкания:
                //     function(){return"function "+n+"() { [native code] }";}
                //     — прямое раскрытие, и ровно это проверяет CreepJS (failed toString);
                //   • fn.toString.name был "" вместо "toString";
                //   • Object.create(fn).toString() не бросал (failed object toString error);
                //   • Object.setPrototypeOf(fn,null).toString() не бросал
                //     (failed null conversion error);
                //   • геттеры маскировались как "function platform()" вместо
                //     accessor-формы "function get platform()";
                //   • не было ловушек construct / caller / arguments / setPrototypeOf.
                // Ниже — порт исправленного _mn из mw/mw-core.js: приватная цель как
                // краткий метод (own-ключи ровно length,name, без prototype), настоящий
                // стек с правкой одного кадра и вычисткой кадров расширения, проверка
                // цикла прототипов с возвратом false, отсутствие has-ловушки.
                _PATCH_MARK + 'var _M=(' + _maskShim.toString() + ')();',
                // Constructor mask. _M is apply-only and throws on construct, so anything
                // that REPLACES a constructor in worker scope needs this instead — see
                // _nestShim below. Emitted once next to _M for the same reason _M is.
                'var _MC=(' + _mcShim.toString() + ')(_M);',
                // [FIX worker-baked-a-provisional-seed] The seed box and its receiver, next
                // to _M for the same reason _M is here: everything below is emitted into
                // one IIFE, so _SD is a plain local — nothing new on `self`, nothing the
                // page can enumerate. See _seedShim.
                'var _SD={v:' + seed + '};',
                '(' + _seedShim.toString() + ')(_SD,' + JSON.stringify(_SEED_MSG_KEY) + ');',
                // [FIX worker-readpixels-was-window-only] The pixel noise and the
                // flat-region rollback, emitted once for both readers below — see _pixShim.
                // Ahead of them in the array because they take it as an argument.
                (_canvasOn || _glPixOn) ? ('var _PX=(' + _pixShim.toString() + ')(_SD);') : '',
                // EARLY UAD lock — ТОЛЬКО прототип.
                // [FIX worker-uad-instance-patch-was-dead] Здесь дополнительно
                // патчился ИНСТАНС (var uad=navigator.userAgentData; uad.getHigh…=…),
                // и это не работало вообще: замерено, что navigator.userAgentData
                // возвращает НОВЫЙ объект на КАЖДОЕ обращение
                // (navigator.userAgentData === navigator.userAgentData → false),
                // а у инстанса нет своего getHighEntropyValues — он берётся с
                // прототипа. То есть патч ложился на одноразовый объект и тут же
                // терялся. В основном потоке это обойдено патчем самого геттера
                // Navigator.prototype.userAgentData (см. mw-navigator.js,
                // «re-patch if browser recreates object»); здесь проще и надёжнее
                // патчить прототип, который переживает пересоздание инстанса.
                '(' + _uadEarlyShim.toString() + ')(_M,' + _chPv + ');',
                // [FIX worker-patched-unconditionally] Раньше каждое из шести свойств
                // подменялось БЕЗУСЛОВНО и прямо на ИНСТАНСЕ navigator. В основном
                // потоке это делает _defIfDiff, который (а) не патчит вовсе, если
                // нативное значение уже совпадает с профилем, и (б) кладёт геттер на
                // ПРОТОТИП, а не на инстанс. Из-за расхождения, например, platform и
                // userAgent в окне оставались НАТИВНЫМИ (реальный platform и так
                // "Win32"), а в воркере оборачивались — и подпись геттера отличалась
                // (name "platform" против нативного "get platform"). _defIf ниже —
                // тот же принцип: не лгать там, где натив и так совпадает.
                'var _defIf=(' + _defIfShim.toString() + ')(_M);',
                (_on('navigator') && !_hw) ? ('_defIf(navigator,"hardwareConcurrency",'+hc+');') : '',
                (_on('navigator') && !_hw) ? ('_defIf(navigator,"deviceMemory",'+dm+');') : '',
                // navigator.cpuPerformance is WINDOW-ONLY in Chrome 152 — measured on a
                // clean Chrome 152: `'cpuPerformance' in WorkerNavigator.prototype` is
                // false and reading it inside a dedicated worker gives undefined. So this
                // line does nothing today, and it is emitted anyway: the day Chrome
                // exposes the tier to workers, a payload that does not carry it leaves the
                // worker reporting the real machine beside a window reporting the profile
                // — the split [FIX worker-connection-half-patched] already cost once. The
                // `in` guard is what keeps it inert until then: without it _defIf would
                // CREATE the property and invent an API this scope does not have.
                (_on('navigator') && _cpuTier && !_hw) ? ('if("cpuPerformance" in navigator)_defIf(navigator,"cpuPerformance",'+_cpuTier(hc,dm)+');') : '',
                (_on('navigator')) ? ('_defIf(navigator,"platform",'+plat+');') : '',
                (_on('navigator')) ? ('_defIf(navigator,"userAgent",'+ua+');') : '',
                // [FIX worker-appversion-still-said-headless] Measured on the CreepJS
                // worker-scope page: navigator.userAgent was spoofed here while appVersion
                // still read "...HeadlessChrome/151.0.0.0...". Two faults in one omission —
                // the headless build named outright, and a window/worker split that CreepJS
                // folds into its `ua` hash, which is what made the Window scope hash differ
                // from Dedicated and Shared when a clean browser has all three identical.
                (_on('navigator')) ? ('_defIf(navigator,"appVersion",'+av+');') : '',
                (_on('navigator')) ? ('_defIf(navigator,"language",'+lang+');') : '',
                (_on('navigator')) ? ('_defIf(navigator,"languages",'+langs+');') : '',
                // [FIX clientCode-webdriver-hash] Do NOT force webdriver=false in workers.
                // CreepJS getClientCode → ["webdriver"] → hashMini → code:04b45acb and
                // Window≠Worker scope hash. Clean Chrome leaves WorkerNavigator.webdriver
                // as-is (often undefined); main only forces false when webdriver===true.
                // Prefer code:unknown + matching scope hashes over false↔undefined parity.
                // toLocaleString + Intl.* default locale = profile. The body is a real
                // function in this file — see [REFACTOR worker-shim-as-real-code] and
                // _intlShim above. `_M` below is not this file's variable: it is emitted
                // verbatim and resolves inside the generated worker IIFE.
                (_on('navigator')) ? ('(' + _intlShim.toString() + ')(' + lang + ',_M);') : '',
                // [FIX worker-ua-ch-win11] UA-CH + Notification + connection aligned with main
                // Body is a real function in this file — see _uachShim above.
                (_on('navigator')) ? ('(' + _uachShim.toString() + ')(' + JSON.stringify(String(_chMajor)) + ',' +
                    _chPlat + ',' + _chPv + ',' + _chArch + ',' + _chBit + ',_M,' + (_hw ? 'true' : 'false') + ');') : '',
                // Body is a real function in this file — see _tzShim above.
                (_on('timezone')) ? ('(' + _tzShim.toString() + ')(' + zone[0] + ',' + zone[1] + ',' +
                    JSON.stringify(zone[2]) + ',' + JSON.stringify(zone[3]) + ',' + tz + ',_M,' + lang + ');') : '',
                // [FIX permission-state-window-only] mw-misc.js подменяет геттер
                // PermissionStatus.prototype.state, отдавая "granted" для geolocation —
                // иначе состояние "prompt"/"denied" противоречило бы нашему же
                // getCurrentPosition, который координаты ВОЗВРАЩАЕТ. В воркере патча не
                // было вовсе, а navigator.permissions там работает: замер показал
                // окно "granted" против воркера "denied" на одном и том же origin.
                // Сравнить два scope может любой скрипт, так что расхождение —
                // ровно тот же класс дефекта, что чинили для UA-CH и timezone.
                (_on('geolocation')) ? ('(' + _permShim.toString() + ')(_M);') : '',
                // [FIX worker-webgl-params-uncovered] The worker knew exactly four GL
                // enums — VENDOR, RENDERER and the two UNMASKED_* — and passed
                // everything else through to the native driver. The window does one
                // more thing (mw-navigator._wgParam): before falling back to native it
                // consults profile.webglParams, the numeric-keyed table background.js
                // copies out of GPU_DATA — MAX_TEXTURE_SIZE, MAX_VARYING_VECTORS,
                // MAX_VERTEX_ATTRIBS, the RED/GREEN/BLUE/DEPTH bit depths and ~20 more.
                // So the two scopes answered the same question differently: the window
                // claimed the profile's GPU limits while the worker reported the real
                // card's. UNMASKED_RENDERER already matched (that is what hasBadWebGL
                // compares), which is exactly why this stayed hidden — the mismatch sits
                // one query deeper, and MAX_VARYING_VECTORS alone separates Iris Xe (31)
                // from UHD 630 (30) in the very table we ship.
                // The lookup order below mirrors _wgParam exactly: fixed strings first,
                // then unmasked, then the profile table, then native.
                (_on('webgl') && !_hw) ? ('(' + _webglShim.toString() + ')(' + wgp + ',' + wgv + ',' + wgr + ',_M);') : '',
                // WebGPU identity rides the same flag as WebGL on purpose: they describe
                // one GPU, and a build where the worker spoofs UNMASKED_* but reports the
                // real WebGPU vendor is a worse tell than doing neither.
                (_on('webgl') && !_hw) ? ('(' + _webgpuShim.toString() + ')(' + wgpu + ',_M);') : '',
                // [FIX decoder-answered-for-the-host-gpu] Same card, same one-flag edit as
                // the window (mw-navigator, MEDIA CAPABILITIES) — emitted only for a
                // claimed card without an AV1 decoder, so every other profile leaves the
                // API native in both scopes.
                (_on('webgl') && !_hw && _P().hwAv1Decode === false) ? ('(' + _mcShim.toString() + ')(_M);') : '',
                // Not behind a feature flag: this does not fake anything, it restores the
                // location the page's own script would have had if we had not re-wrapped it.
                loc ? ('(' + _locShim.toString() + ')(' + loc + ',_M);') : '',
                // [FIX worker-fonts-window-only] Нормализация шрифтов жила только в
                // основном мире (mw-canvas-audio.js): measureText/fillText/strokeText
                // подменялись у CanvasRenderingContext2D И у
                // OffscreenCanvasRenderingContext2D, но ТОЛЬКО в окне. В воркере тот же
                // OffscreenCanvasRenderingContext2D оставался нативным, поэтому один и
                // тот же шрифт мерился по-разному в двух scope. Замер
                // (dev-fontscope.html): MS Gothic 620.05 в окне против 468 в воркере,
                // Sylfaen и Marlett — так же, 3 из 22 проб.
                // Пока это не ломало хеш CreepJS только по совпадению: его font A
                // пробует ровно 'Segoe UI' и 'Helvetica Neue', а Segoe UI есть в
                // allowedFonts, значит обнаруживался в обоих scope одинаково. Стоило
                // убрать Segoe UI из списка — и font A разъезжался.
                // Ниже — построчный порт оконной реализации. Ширина берётся не из
                // JS-fallback (у него другая формула, без учёта font), а из порта
                // ИМЕННО WASM-функции substitute_text_width, потому что окно считает
                // через WASM: h=seed, h=hash_str(h,font), h=hash_str(h,text),
                // real+((h&0xFF)/255-0.5)*0.02. Порт сверен с настоящим WASM на 378
                // комбинациях (dev-textwidth-port.html) — совпадение побитовое, включая
                // emoji, кириллицу и CJK: hash_str хеширует UTF-8 БАЙТЫ, не UTF-16.
                // Body is a real function in this file — see _fontShim above.
                // [FIX host-mode] `null` for the allowlist: every family the machine has
                // passes, the text-metric noise stays — see _blk in the shim.
                (_on('fonts')) ? ('(' + _fontShim.toString() + ')(_SD,' + (_hw ? 'null' : _fontAllow) + ',_M);') : '',
                // [FIX worker-canvas-parity] Same positional hash as main _jsCanvasNoise
                // (not sequential LCG) → Window vs Worker canvas hash align on JS path.
                // Body is a real function in this file — see _canvasShim above.
                // `_M` is emitted verbatim and resolves inside the generated worker IIFE.
                _canvasOn ? ('(' + _canvasShim.toString() + ')(_M,_PX);') : '',
                // [FIX worker-readpixels-was-window-only] The WebGL half of the same
                // pixels — the one path the canvas shim above never covered. Body is a
                // real function in this file: see _glPixelShim, where the measurement and
                // the ported rules are.
                _glPixOn ? ('(' + _glPixelShim.toString() + ')(_PX,_M);') : '',
                // [FIX nested-workers-were-never-reached] Last, so a failure here cannot
                // cost the patches above. The URL is omitted when this very text is what
                // goes INTO the shared blob (skipPatchUrl) — otherwise _patchBlobUrl would
                // call back into _buildPatchCode forever. Children set the global
                // themselves before importScripts, so the blob's own copy needs nothing
                // baked in and the same text serves every depth.
                skipPatchUrl ? '' : ('self.__AFP_PATCH_URL=' + JSON.stringify(_patchBlobUrl() || '') + ';'),
                '(' + _nestShim.toString() + ')(_M,_MC,' + _nestShimArgs() + ');',
                '}catch(e){}})();'
            ].join('');
        }

        // The patch text as ONE blob per page, created on first use. Everything a child
        // worker needs is in here; what it does NOT have is a patch URL of its own, which
        // is what stops the recursion.
        var _pcBlobUrl = null;
        function _patchBlobUrl() {
            if (_pcBlobUrl !== null) return _pcBlobUrl;
            _pcBlobUrl = '';
            try {
                var core = _buildPatchCode(location.href, true);
                _pcBlobUrl = URL.createObjectURL(new Blob([core], { type: 'application/javascript' }));
            } catch (e) { _pcBlobUrl = ''; }
            return _pcBlobUrl;
        }

        // [FIX trusted-types-blob-url] Сайты со строгим CSP
        // (require-trusted-types-for 'script' — YouTube в их числе) требуют,
        // чтобы scriptURL, передаваемый в Worker/SharedWorker/
        // serviceWorker.register(), был объектом TrustedScriptURL, а не
        // голой строкой blob: URL. Присвоение голой строки в такой контекст
        // браузер БЛОКИРУЕТ на уровне enforcement — консоль показывает
        // "This document requires 'TrustedScriptURL' assignment. The action
        // has been blocked." Worker/SharedWorker и раньше имели частичную
        // защиту (синхронный try/catch вокруг Reflect.construct — блокировка
        // там бросает исключение, которое catch ловит и делает fallback).
        // Но navigator.serviceWorker.register() — АСИНХРОННЫЙ: Trusted Types
        // нарушение там не гарантированно всплывает как reject Promise,
        // который поймал бы .catch() — браузер может просто залогировать
        // блокировку в консоль, не резолвя и не реджектя Promise предсказуемо,
        // оставляя регистрацию в неясном состоянии. Единая функция создаёт
        // (один раз, кешируя) TrustedTypePolicy и оборачивает blob-URL строку
        // в настоящий TrustedScriptURL ДО передачи в любой из трёх API — это
        // официально поддерживаемый способ (см. примеры в MDN для Worker()/
        // ServiceWorkerContainer.register()), а не полагание на перехват
        // исключения постфактум. Если trustedTypes недоступен (большинство
        // сайтов) — возвращает голую строку как раньше, без изменений
        // поведения. Если сайт использует CSP-директиву `trusted-types` со
        // своим allowlist (не включающим наше имя политики) — createPolicy
        // сам бросит исключение, что тоже безопасно ловится, и вызывающий
        // код так же откатывается на оригинальный (не-blob) URL, как и раньше.
                // [FIX worker-csp-tt] Сайты вроде claude.ai: trusted-types allowlist
        // ("vOmE5 default") + worker-src blob:. createPolicy('afp-blob-url')
        // логирует CSP error и затем fallback на https URL ломает worker-src.
        // Стратегия: пробуем default/afp; если TT есть и политики нет —
        // НЕ оборачиваем (passthrough), без blob и без лишних CSP-ошибок.
        // [FIX worker-csp-tt-v2] no createPolicy
        // [FIX tt-detected-only-in-meta] The scan below used to read only
        // <meta http-equiv="Content-Security-Policy"> elements. A CSP delivered as an
        // HTTP HEADER is invisible to that scan — and header delivery is the common
        // case (github.io among them). On such a page _ttSkipBlobWrap stayed false, we
        // handed a plain string blob: URL to the Worker constructor, and enforcement
        // blocked it with "This document requires 'TrustedScriptURL' assignment."
        // Now: ask the Trusted Types API itself instead of guessing from markup.
        //   - a default policy exists -> use it, the URL becomes a real TrustedScriptURL;
        //   - otherwise try to create our own named policy. If the page's trusted-types
        //     allowlist admits it, workers keep getting patched;
        //   - if createPolicy throws, the allowlist rejects us: skip wrapping entirely
        //     (passthrough), which costs the worker patch on that page but keeps the
        //     page working and produces no per-Worker violation.
        // The meta scan is kept as a cheap pre-check so pages that declare it inline
        // never reach createPolicy at all.
        // [FIX tt-watcher-ran-before-mnref-existed] Defined HERE, at the top of the file's
        // work, rather than three hundred lines down where it used to sit. _ttWatchPolicies
        // installs its createPolicy wrapper at module load and masks it through this helper;
        // with the old placement `_mnRef` was still an unassigned `var` at that moment, so
        // the call threw, the try/catch swallowed it, and the wrapper was silently never
        // installed — no policy could be borrowed and every trusted-types origin fell through
        // to the stand-down. Nothing else changes: mw-core publishes __AFP_MW__.mn before
        // this file runs, so the lookup is as valid here as it was there.
        var _mnRef = (function() {
            try {
                var a = window.__AFP_MW__;
                if (a && typeof a.mn === 'function') return a.mn;
            } catch (e) {}
            return function(fn) { return fn; };
        })();

        var _ttSkipBlobWrap = false;
        var _ttPolicy = null;
        try {
            if (typeof trustedTypes !== 'undefined' && trustedTypes) {
                // [FIX tt-policy-name-was-probed-by-trying-it] Asked BEFORE any createPolicy
                // call, because calling it is what emits the violation. A rejected
                // createPolicy reports
                //
                //   Creating a TrustedTypePolicy named 'afp-blob-url' violates the following
                //   Content Security policy directive: "trusted-types Kssz2 default".
                //        at mw-bundle.js:10236
                //
                // and the report is built in C++ from the real stack before the exception is
                // thrown, so the try/catch below caught the throw and left the console entry
                // naming this extension on every load. Measured on claude.ai.
                //
                // The header is invisible to JS, so background.js reads it and records the
                // host; storage-bridge.js turns that into this flag. The meta scan below
                // stays as the cheap synchronous pre-check for pages that declare it inline.
                try {
                    if (_cspFlagOn('v.ui.tt')) _ttSkipBlobWrap = true;
                } catch (eTtF) {}
                var metas = _ttSkipBlobWrap ? [] :
                    document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
                for (var mi = 0; mi < metas.length; mi++) {
                    var mc = String(metas[mi].getAttribute('content') || '').toLowerCase();
                    if (mc.indexOf('require-trusted-types-for') !== -1 || mc.indexOf('trusted-types') !== -1) {
                        _ttSkipBlobWrap = true; break;
                    }
                }
                // NOTHING is created here. This block runs at document_start and the flag
                // above is written by storage-bridge.js ~8ms later, from its async
                // chrome.storage read — so resolving the policy now means resolving it
                // before the answer exists, which is exactly how the violation survived the
                // first attempt at this fix (measured: v.ui.tt=1 AND the violation, on the
                // same load). It is deferred to _ttEnsurePolicy below, called from _ttWrap
                // when a worker is actually being constructed — far later than 8ms, and the
                // same live-read pattern _isBlobBlocked already uses.
            }
        } catch (eTt) {}

        /**
         * Resolve the Trusted Types policy, once, at first use.
         *
         * Re-reads the flag first: on the load where an origin is seen for the first time,
         * background.js has the header before the document is parsed, but the value only
         * reaches this scope through storage-bridge's async callback. Asking here rather
         * than at load is what makes the difference between knowing and guessing.
         */
        var _ttOwnTried = false;
        // [FIX tt-standdown-split-window-from-worker] The page's own default-policy rules,
        // adopted if it asks for `default` after we have already installed one. See
        // _ttInstallDefaultPolicy.
        /**
         * BORROWING THE PAGE'S POLICY: TRIED, MEASURED, REVERTED.
         *
         * [FIX tt-standdown-split-window-from-worker] The stand-down below leaves a worker
         * unpatched, and the obvious repair is to borrow the Trusted Types policy the page
         * creates for itself — on a document that enforces trusted types it cannot build a
         * worker without one, so a usable policy always exists by the time there is a worker
         * worth patching. It was implemented, it passed test/ttworker.mjs and
         * test/cspattribution.mjs, and it BROKE CLOUDFLARE TURNSTILE on the real site:
         *
         *   before   challenge frame rendered its checkbox, then scored 600010
         *   borrow   challenge document fetched (200) and NOTHING rendered at all
         *
         * The reason is the part the rig could not show. Standing down had also been keeping
         * our worker wrapper away from Turnstile's OWN worker; borrowing let it in for the
         * first time, the wrapper rebuilt that worker, and the widget died before it drew
         * anything. What breaks inside it is not observable from here — the frame is
         * cross-origin, so its console is unreachable — and a change that trades a captcha
         * that FAILS for a captcha that does not APPEAR is a worse product either way.
         *
         * So the coherent stand-down is the answer, not a fallback: where we cannot patch a
         * worker we stop spoofing what a worker can see, and touch nothing else in the page.
         * Do not re-attempt borrowing without a way to read that frame.
         */
        /**
         * Would the browser itself refuse this worker URL?
         *
         * [FIX tt-wrapper-laundered-the-pages-plain-string] Handed `new Worker('/w.js')` the
         * wrapper does not forward that string: it fetches the source, wraps it, and builds
         * the worker from a blob of ours minted through our own policy. On a document that
         * requires TrustedScriptURL that launders a value the browser was supposed to reject
         * — measured against a clean browser on the same page:
         *
         *   clean   worker threw TypeError, 1 violation reported
         *   ours    worker ok,              0 violations
         *
         * Two failures in one: the site's own broken call starts working, and the difference
         * is a one-line detector (assign a bare string under your own CSP, see if it throws).
         * So where enforcement is on we only touch a URL the page ALREADY made trusted —
         * which is what a site under such a CSP passes, Turnstile included. Anything else
         * goes to the native constructor and is refused there, by the browser, with the
         * page's own stack.
         *
         * `trustedTypes` exists in every Chrome document whatever the CSP says, so the
         * enforcement flag cannot be inferred from its presence; it comes from the response
         * header through background.js. Unset — an origin never seen before — reads as "not
         * enforcing", which is the same first-load residual every per-site flag here has.
         */
        function _ttWouldRefuse(url) {
            try {
                // '1': the host has enforced before (tte.js, storage-bridge). '2:<tag>': THIS
                // document's headers enforce. '0:<tag>': they do not, whatever the host did.
                // A settled value tagged for another document is history — see _tteFlag.
                var f = _tteFlag();
                if (f !== '1' && f !== '2') return false;
            } catch (eE) { return false; }
            try {
                if (typeof trustedTypes !== 'undefined' && trustedTypes &&
                    typeof trustedTypes.isScriptURL === 'function' && trustedTypes.isScriptURL(url)) {
                    return false;   // the page minted it: the browser would accept it
                }
            } catch (eI) {}
            return true;
        }

        // [FIX a-refusal-we-passed-through-was-charged-to-us]
        //
        // Reported 2026-09-03 from the user's Chrome, twice in one evening on youtube.com
        // watch pages with the per-site CSP rewrite ON, filed under this extension's own
        // errors on chrome://extensions:
        //
        //   This document requires 'TrustedScriptURL' assignment. The action has been blocked.
        //   mw-bundle.js:12037 (_wrapWorkerUrl)
        //
        // The line was the passthrough in _wrapWorkerUrl: a string this document must
        // refuse, handed to the native constructor so that the BROWSER refuses it. It did,
        // and charged the refusal to the innermost script frame on the stack — the trap this
        // proxy runs the call through. [FIX tt-violation-named-our-file] closed this once by
        // not installing the proxy where nothing could be wrapped; the rewrite keeps it
        // installed on youtube.com on purpose, and the residual came back with it: once per
        // bare-string worker the page builds, in the page's console and on the extension's
        // error list.
        //
        // A frame cannot leave a stack it is on, so the only way not to be named is not to
        // make the call. Measured on a clean browser (test/ttrefusal.mjs), the refusal is
        // fully determined by things readable without touching a sink:
        //
        //   no default policy           TypeError "...'TrustedScriptURL' assignment."
        //   default without the member  "...and no 'default' policy for 'TrustedScriptURL' has been defined."
        //   default returning null      "...and the 'default' policy failed to execute."
        //   default that throws         the policy's own exception, unchanged, no violation
        //
        // and the default policy is consulted exactly once, with (value, 'TrustedScriptURL',
        // '<sink name>'), the way the browser consults it — a value it converts is accepted
        // and wrapped like any TrustedScriptURL the page minted. `message` carries the sink
        // prefix and the first line of `stack` does not, which is how the native one is built.
        //
        // What is no longer produced: the browser's securitypolicyviolation record and its
        // console line, both of which said "an extension did this". That is the trade, and
        // it is made only where THIS document's own response headers said enforcing —
        // v.ui.tte '2', a per-document verdict from background.js — never from the add-only
        // host list ('1'): a host that enforced once and stopped would otherwise have its
        // workers refused by us where the browser accepts them (test/ttrefusal.mjs /off).
        // Where only the host flag is known the call still passes through and is still
        // charged to us; that window is the one before the verdict lands, milliseconds
        // after document_start.
        // The settled values of v.ui.tte carry the DOCUMENT they were decided for —
        // performance.timeOrigin, which every world of one document reads alike — because
        // sessionStorage outlives the document and this bundle can read a previous
        // document's verdict before the bridge has replaced it. Another document's '2' is
        // history ('1'); another document's '0' is nothing.
        // [FIX csp-restrictions-learned-per-route] Every per-site flag is
        // 'code:timeOrigin:host/segment' — the storage OWNER's timeOrigin (the highest
        // same-origin ancestor: frames share the tab's sessionStorage and must read the
        // top's value as their own) and the owner's route. This document's value is taken
        // as written; another document's counts only as history ('1') for the SAME route,
        // which is what keeps a repeat load of youtube.com's watch route from installing
        // the proxies (the marker arrives after this file) while a loose route after a
        // strict one in the same tab starts clean — the bare '1' that used to be left
        // behind stood it down (measured, test/cspscope.mjs).
        function _ownerWin() {
            var owner = window;
            try { while (owner.parent !== owner && owner.parent.location.href !== undefined) owner = owner.parent; } catch (e) {}
            return owner;
        }
        function _cspFlag(key) {
            var v = null;
            try { v = sessionStorage.getItem(key); } catch (e) {}
            if (v === null || v === undefined || v === '') return null;
            v = String(v);
            var i = v.indexOf(':');
            if (i < 0) return null;
            var code = v.slice(0, i), rest = v.slice(i + 1), j = rest.indexOf(':');
            var tag = j < 0 ? rest : rest.slice(0, j), scope = j < 0 ? '' : rest.slice(j + 1);
            var myTag = '', myScope = '';
            try {
                var o = _ownerWin();
                myTag = String(o.performance.timeOrigin);
                myScope = o.location.hostname + '/' + (o.location.pathname.split('/')[1] || '');
            } catch (e2) {
                try { myTag = String(performance.timeOrigin); } catch (e3) {}
            }
            if (tag === myTag) return code;
            if (scope && scope === myScope && (code === '1' || code === '2' || code === '3')) return '1';
            return null;
        }
        function _cspFlagOn(key) { var c = _cspFlag(key); return c === '1' || c === '2' || c === '3'; }
        function _tteFlag() { return _cspFlag('v.ui.tte'); }
        function _ttVerified() {
            try { return _tteFlag() === '2'; } catch (e) { return false; }
        }
        var _TT_NO_MEMBER = /did not specify a 'createScriptURL' member/;
        // Stack DEPTH parity, not only content. An error created while our frames are on
        // the stack — the page's default policy throwing, or the TypeError built below —
        // is captured under Error.stackTraceLimit (10), and once our frames are stripped
        // it is short by exactly that many of the PAGE's deepest frames; measured in
        // test/ttrefusal.mjs on a throwing policy, 8 frames clean against 7 ours. So the
        // limit is raised by the number of our frames for the duration of the call and
        // restored on the way out. The count is measured, not assumed: the construct trap
        // and the register wrapper put different numbers of frames underneath.
        var _OrigError = Error;
        function _ownFrameCount() {
            var old = _OrigError.stackTraceLimit;
            try { _OrigError.stackTraceLimit = 200; } catch (e) { return 0; }
            var n = 0;
            try {
                var lines = String(new _OrigError().stack).split(String.fromCharCode(10));
                for (var i = 1; i < lines.length; i++) if (lines[i].indexOf('chrome-extension://') !== -1) n++;
            } catch (e2) {}
            try { _OrigError.stackTraceLimit = old; } catch (e3) {}
            return n;
        }
        function _withRoomForOurFrames(fn) {
            var old, raised = false, n = _ownFrameCount();
            try {
                old = _OrigError.stackTraceLimit;
                if (n > 0 && typeof old === 'number' && isFinite(old)) { _OrigError.stackTraceLimit = old + n; raised = true; }
            } catch (e) {}
            try { return fn(); } finally { if (raised) { try { _OrigError.stackTraceLimit = old; } catch (e2) {} } }
        }
        function _ttRefusal(url, what, sink) {
            if (!_ttVerified()) return null;
            return _withRoomForOurFrames(function () { return _ttRefusalInner(url, what, sink); });
        }
        function _ttRefusalInner(url, what, sink) {
            var dp = null;
            try { dp = trustedTypes.defaultPolicy; } catch (eD) { return null; }
            var tail = '.';
            if (dp) {
                var made = null;
                try {
                    made = dp.createScriptURL(String(url), 'TrustedScriptURL', sink);
                } catch (eP) {
                    if (!(eP instanceof TypeError) || !_TT_NO_MEMBER.test(String(eP && eP.message))) {
                        // The policy's own exception: the browser rethrows it untouched.
                        return { error: _stripFrames(eP) };
                    }
                    tail = " and no 'default' policy for 'TrustedScriptURL' has been defined.";
                }
                if (tail === '.') {
                    // A policy method never returns null: a callback that returned null or
                    // undefined comes back as an EMPTY TrustedScriptURL, which is the value
                    // the browser's default-policy path refuses as "failed to execute".
                    var isTrusted = false;
                    try { isTrusted = trustedTypes.isScriptURL(made); } catch (eI) {}
                    if (!isTrusted) return null;
                    if (String(made) !== '') return { trusted: made };
                    tail = " and the 'default' policy failed to execute.";
                }
            }
            var text = "This document requires 'TrustedScriptURL' assignment" + tail;
            var err = new TypeError(text);
            try { err.message = 'Failed to ' + what + ': ' + text; } catch (eM) {}
            return { error: _stripFrames(err) };
        }
        function _ctorName(C) {
            try { return C && C.name === 'SharedWorker' ? 'SharedWorker' : 'Worker'; } catch (e) { return 'Worker'; }
        }

        // [FIX policy-name-was-a-signature] Copy of afpTtPolicyName in seed-lib.js, byte for
        // byte (test/parity-static.mjs): the name background.js writes into a rewritten
        // allowlist has to be the one created here, on the same domain seed.
        function afpTtPolicyName(domainSeed) {
            if (typeof domainSeed !== 'number' || !isFinite(domainSeed)) return null;
            var mix = function (x) {
                x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
                x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
                return (x ^ (x >>> 16)) >>> 0;
            };
            var s = domainSeed >>> 0, a = mix(s ^ 0x5bd1e995), b = mix(s ^ 0x1b873593);
            var L = 'abcdefghijklmnopqrstuvwxyz', D = L + '0123456789';
            var out = L.charAt(a % 26);
            a = Math.floor(a / 26);
            for (var i = 0; i < 3; i++) { out += D.charAt(a % 36); a = Math.floor(a / 36); }
            for (var j = 0; j < 4; j++) { out += D.charAt(b % 36); b = Math.floor(b / 36); }
            return out;
        }

        var _ttNameMemo = null;
        function _ttPolicyName() {
            if (_ttNameMemo) return _ttNameMemo;
            var fin = true;
            try { if (_winSeedFinal) fin = !!_winSeedFinal(); } catch (e) { fin = false; }
            var s = _getSeed();
            if (fin && s !== 0xC0FFEE) { _ttNameMemo = afpTtPolicyName(s); return _ttNameMemo; }
            // The seed is still provisional (a cold start): a name for this document alone,
            // not memoised. On an origin with no allowlist it is as good as any; on a
            // rewritten allowlist (rare, and cold) it is refused and that ONE construction
            // reports — the documented cost, beside the fixed name that reported nothing
            // and named the extension everywhere.
            var r = 'p', D = 'abcdefghijklmnopqrstuvwxyz0123456789';
            for (var i = 0; i < 7; i++) r += D.charAt(Math.floor(Math.random() * 36));
            return r;
        }
        function _ttEnsurePolicy() {
            // [FIX tt-standdown-split-window-from-worker] Only SUCCESS is cached. The page
            // may create the policy we borrow at any point — often just before the worker it
            // needs it for — so a first attempt that found nothing must not settle the
            // question for the rest of the load. `_ttOwnTried` keeps the unrestricted branch
            // below from re-running createPolicy after it has failed once.
            if (_ttPolicy) return;
            var restricted = _ttSkipBlobWrap;
            try {
                if (_cspFlagOn('v.ui.tt')) restricted = true;
            } catch (eF) {}
            // [FIX policy-name-was-a-signature] A policy of our own FIRST, wherever the
            // document lets any name be created (no `trusted-types` allowlist — youtube.com's
            // shape). The page's default policy is the SITE's function and sees every value
            // handed to it: test/ttrefusal.mjs measured ours in its callback — a blob: URL
            // with no sink arguments, which nothing native produces. A policy created here
            // is consulted by nobody and, where no allowlist exists, reports nothing. The
            // order used to be the reverse, with the default policy first because "it is
            // already there"; that was true and beside the point.
            if (!restricted && !_ttOwnTried) {
                var nm = _ttPolicyName();
                if (nm) {
                    _ttOwnTried = true;
                    try {
                        _ttPolicy = trustedTypes.createPolicy(nm, { createScriptURL: function (s) { return s; } });
                        _ttSkipBlobWrap = false;
                        return;
                    } catch (ePol) {}
                }
            }
            // An existing default policy is usable whatever the allowlist says: it is
            // already there, so nothing is created and nothing can be violated.
            try {
                if (trustedTypes.defaultPolicy) {
                    _ttPolicy = trustedTypes.defaultPolicy;
                    _ttSkipBlobWrap = false;
                    return;
                }
            } catch (eD) {}
            if (restricted || _ttOwnTried) {
                // [FIX tt-standdown-split-window-from-worker] The page's own policy, caught
                // on its way past by _ttWatchPolicies. Nothing of ours is created here —
                // or ours was refused after all (a meta allowlist the scan did not read).
                _ttSkipBlobWrap = true;
                return;
            }
            _ttSkipBlobWrap = false;
        }
        // Turns a blob: URL into whatever the document will accept: a TrustedScriptURL
        // where Trusted Types is enforced, the plain string everywhere else.
        // [FIX tt-wrap-fell-back-to-a-plain-string] On failure this returned the raw
        // string, which is exactly the value the document refuses — the caller then
        // handed it to Worker()/register() and the action was blocked. A page can have
        // a default policy that does not implement createScriptURL at all (YouTube is
        // one), so "a policy exists" does not mean "we can mint a TrustedScriptURL".
        // Now: null means "no trusted value available"; every caller must then leave
        // the original URL alone rather than substituting a blob.
        function _ttWrap(u) {
            // Every blob this file hands to a worker constructor passes through here, which
            // makes it the one place that can record them — see _isOurBlob for why the
            // re-entry check can no longer read a blob back to look for the marker.
            _rememberBlob(u);
            if (typeof trustedTypes === 'undefined' || !trustedTypes) return u;
            _ttEnsurePolicy();
            if (!_ttPolicy) return null;
            var t = _ttMint(_ttPolicy, u);
            if (t) return t;
            // [FIX default-policy-that-cannot-mint-blocked-every-worker] youtube.com: a
            // `default` policy exists, so _ttEnsurePolicy borrows it — and it has no
            // createScriptURL, so every mint fails and every worker on the site goes to the
            // native constructor. That was fine while its CSP refused blob: workers anyway
            // (the site stood down whole); with the per-site CSP rewrite in background.js
            // that header admits our workers, and this was the remaining reason none was
            // patched. The site's CSP carries no `trusted-types` allowlist (that is what
            // `v.ui.tt` records), so creating a policy of our own is permitted and reports
            // nothing — the same "last resort" branch _ttEnsurePolicy already takes on an
            // origin with no default policy at all. Only the URLs the page ALREADY passed
            // as TrustedScriptURL reach here (_ttWouldRefuse), so nothing is laundered.
            if (_ttOwnTried || _ttSkipBlobWrap) return null;
            try { if (_cspFlagOn('v.ui.tt')) return null; } catch (eF) {}
            var nmOwn = _ttPolicyName();
            if (!nmOwn) return null;
            _ttOwnTried = true;
            try {
                var own = trustedTypes.createPolicy(nmOwn, {
                    createScriptURL: function (s) { return s; }
                });
                t = _ttMint(own, u);
                if (t) { _ttPolicy = own; return t; }
            } catch (ePol) {}
            return null;
        }
        /** A TrustedScriptURL for `u` from `policy`, or null when it cannot mint one for us. */
        function _ttMint(policy, u) {
            try {
                var t = policy.createScriptURL(u);
                if (t === undefined || t === null || typeof t === 'string') return null;
                // [FIX borrowed-policy-may-rewrite-the-url] A borrowed policy belongs to the
                // SITE, and a site's createScriptURL is not obliged to be a pass-through: it
                // may sanitise, rewrite to its own CDN, or return a placeholder. Ours is the
                // one case where the output has to be the input — we are minting a handle for
                // a blob we just built — so anything else means the policy is not usable for
                // this and the caller must fall back rather than construct a worker pointing
                // somewhere we did not choose.
                if (String(t) !== String(u)) return null;
                return t;
            } catch (e) { return null; }
        }
        // [CLEANUP] Здесь были _isProtectedWorkerHost (allowlist captcha-хостов) и
        // _syncGetText (синхронный XHR-хелпер) — ни одна из двух функций нигде не
        // вызывалась. Синхронное чтение вернулось как _syncGet выше — но уже одной
        // функцией, а не тремя инлайнами: их и надо было чинить по одному, когда
        // выяснилось, что на `sync-xhr=()` каждый из них печатает нарушение с нашим
        // именем в трассировке.
        // [FIX module-workers-were-handed-straight-through] `new Worker(url, {type:'module'})`
        // used to go to the native constructor untouched, and a module worker is a full
        // scope: measured against the classic worker in the same page, profile
        // America/New_York on a Moscow host —
        //
        //   classic   America/New_York   240    8 cores   en-US   Iris Xe   headless:false
        //   module    Europe/Moscow     -180   18 cores   ru-RU   Arc       headless:TRUE
        //
        // Two lines of script and the whole extension is bypassed, headless flag included.
        // Bundlers emit `{type:'module'}` workers by default now, so this is not an exotic
        // path — it is the modern default.
        //
        // The classic wrapper cannot be reused as-is for two reasons:
        //   * `importScripts` does not exist in a module worker;
        //   * a static `import` declaration is HOISTED — `patchCode; import "x";` evaluates
        //     x FIRST, which would defeat the entire point. Dynamic `import()` is evaluated
        //     in order, and top-level await is allowed in a module worker, so the patch runs
        //     and only then the page's own module loads.
        //
        // Importing by URL rather than inlining the source is also deliberate: a module's
        // relative specifiers resolve against ITS OWN url, so inlining into a blob would
        // break every `import './x.js'` inside it.
        //
        // Cross-origin module workers are left alone, matching the classic path's policy of
        // not touching captcha/CDN infrastructure. That is the documented residual here.
        function _wrapModuleWorker(url, opts, OrigCtor) {
            if (_ttSkipBlobWrap || _isBlobBlocked()) return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
            // [FIX tt-wrapper-laundered-the-pages-plain-string] Let the browser refuse what
            // it would refuse without us.
            if (_ttWouldRefuse(url)) return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
            var blobUrl = null;
            try {
                var href = url instanceof URL ? url.href : String(url);
                var absUrl = new URL(href, location.href).href;
                if (href.indexOf('blob:') !== 0 && new URL(absUrl).origin !== location.origin) {
                    return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                }
                // Re-entry guard: a blob whose source already carries the marker is one of
                // ours, and wrapping it twice would install every patch a second time.
                if (href.indexOf('blob:') === 0) {
                    if (_isOurBlob(href)) return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                    var srcM = _syncGet(href);
                    if (srcM && srcM.indexOf(_PATCH_MARK) !== -1) {
                        return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                    }
                }
                var body = _buildPatchCode(absUrl) + '\n' + _MODULE_MSG_QUEUE_HEAD +
                    '\n' + 'await import(' + JSON.stringify(absUrl) + ');' + '\n' +
                    _MODULE_MSG_QUEUE_TAIL + '\n';
                blobUrl = URL.createObjectURL(new Blob([body], { type: 'application/javascript' }));
                var trusted = _ttWrap(blobUrl);
                // see FIX tt-wrap-fell-back-to-a-plain-string on the classic path
                if (!trusted) {
                    try { URL.revokeObjectURL(blobUrl); } catch (e) {}
                    _ttSkipBlobWrap = true;
                    _unwrapWorkerCtors();
                    return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                }
                var wm = Reflect.construct(OrigCtor, [trusted, opts], OrigCtor);
                setTimeout(function () { try { URL.revokeObjectURL(blobUrl); } catch (e) {} }, 8000);
                return _watchBlobWorker(wm);
            } catch (e) {
                try { if (blobUrl) URL.revokeObjectURL(blobUrl); } catch (e2) {}
                return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
            }
        }

        // [FIX module-worker-dropped-the-first-message] `await import()` is what lets the
        // patch run before the page's module (see the note above), and it costs one turn of
        // the event loop. A message posted in the same tick as `new Worker(url, {type:
        // 'module'})` — which is how most code uses a worker — is then delivered while the
        // page's module has not registered a handler yet, and a message event with no
        // listener is DROPPED, not queued. Measured against a clean browser, same page:
        //
        //     clean       postMessage right after new Worker  -> reply
        //     extension   the same                            -> NO REPLY within 3s
        //     extension   the same message sent 700 ms later  -> reply
        //
        // So the worker was fine and the first message was gone: silent, timing-dependent
        // breakage of any bundler-built app, and nothing about it points back at us.
        //
        // The wrapper therefore holds the messages itself: a capture listener queues
        // whatever arrives while the import is in flight and re-dispatches it afterwards,
        // in order. Everything here is module-scoped — nothing is added to `self`, so the
        // child sees no global it would not see natively.
        var _MODULE_MSG_QUEUE_HEAD =
            'const __afpQ=[];const __afpG=(e)=>{__afpQ.push(e)};' +
            'self.addEventListener("message",__afpG,true);';
        var _MODULE_MSG_QUEUE_TAIL =
            'self.removeEventListener("message",__afpG,true);' +
            'for(const e of __afpQ){try{self.dispatchEvent(new MessageEvent("message",' +
            '{data:e.data,origin:e.origin,lastEventId:e.lastEventId,ports:e.ports}))}catch(_){}}' +
            '__afpQ.length=0;'

        // [FIX sync-xhr-violated-a-permissions-policy] Every worker this wrapper touches
        // used to be read with a SYNCHRONOUS XHR, so the patch could be prepended to the
        // real source. On a document that sends `Permissions-Policy: sync-xhr=()` the
        // browser refuses the call and prints a violation naming US — reported from
        // stackoverflow.com, where Cloudflare's challenge script builds a blob: worker:
        //
        //   Permissions policy violation: Synchronous requests are disabled by permissions policy.
        //     mw-bundle.js (_wrapWorkerUrl)
        //     .../challenge-platform/... (uk)
        //
        // The report is built by the browser from the real stack — the same channel as the
        // Trusted-Types reports in [FIX csp-reports-are-a-second-stack-channel] — so no JS
        // masking reaches it, and a try/catch does not prevent it either: the violation is
        // printed when the call is REFUSED, not when it throws. The only fix is not to make
        // the call. The policy is asked first, once, and when it says no the wrapper takes
        // the importScripts path it already had for unreadable sources.
        var _syncXhrOk = null;
        function _syncXhrAllowed() {
            if (_syncXhrOk !== null) return _syncXhrOk;
            _syncXhrOk = true;
            try {
                var fp = document.featurePolicy || document.permissionsPolicy;
                if (fp && typeof fp.allowsFeature === 'function') _syncXhrOk = !!fp.allowsFeature('sync-xhr');
            } catch (e) {}
            return _syncXhrOk;
        }
        /** The one place a synchronous read happens. Returns null when it cannot or must not. */
        // [FIX importscripts-fallback-killed-turnstile] Origins whose CSP refuses a blob:
        // fetch, learned from the response header in background.js. Asking anyway is not
        // free: the refusal is a CSP violation naming this file, twice per worker, and it
        // cannot be caught — the same un-catchable report as the Trusted Types probe.
        // Read live rather than at load, because the flag arrives ~8ms in and a worker is
        // built far later; the lesson from that fix applies here unchanged.
        function _blobReadBlocked() {
            try { return _cspFlagOn('v.ui.nc'); } catch (e) { return false; }
        }
        /**
         * May a worker on this origin importScripts a blob: URL?
         *
         * NOT the same question as whether a blob worker may be CREATED — worker-src grants
         * the first, the script directive the second, and claude.ai grants one and refuses
         * the other. Conflating them is what stranded the wrapper and killed Turnstile.
         */
        function _blobScriptBlocked() {
            try { return _cspFlagOn('v.ui.ns'); } catch (e) { return false; }
        }
        function _syncGet(u) {
            if (!_syncXhrAllowed()) return null;
            if (String(u).indexOf('blob:') === 0 && _blobReadBlocked()) return null;
            try {
                var x = new XMLHttpRequest();
                x.open('GET', u, false);
                x.send();
                if (x.status === 0 || (x.status >= 200 && x.status < 300)) return x.responseText;
            } catch (e) {}
            return null;
        }
        // Re-entry detection without reading anything: the marker check below exists to stop
        // us wrapping our own blob twice, and we know which blobs are ours because we made
        // them. Without this the check would simply vanish on a sync-xhr=() document.
        var _ourBlobs = (function () { try { return new Set(); } catch (e) { return null; } })();
        function _rememberBlob(u) { try { if (_ourBlobs) _ourBlobs.add(String(u)); } catch (e) {} }
        function _isOurBlob(u) { try { return !!(_ourBlobs && _ourBlobs.has(String(u))); } catch (e) { return false; } }

        function _wrapWorkerUrl(url, opts, OrigCtor) {
            if (_ttSkipBlobWrap) return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
            // [FIX tt-wrapper-laundered-the-pages-plain-string] Before anything is read or
            // rebuilt: a URL this document would reject must stay rejected, by the browser.
            if (_ttWouldRefuse(url)) {
                // [FIX a-refusal-we-passed-through-was-charged-to-us] Answered here, without
                // the sink, where this document's own headers said enforcing — _ttRefusal.
                var rf = _ttRefusal(url, "construct '" + _ctorName(OrigCtor) + "'", _ctorName(OrigCtor) + ' constructor');
                if (!rf) return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                if (rf.error) throw rf.error;
                url = rf.trusted;
            }
            if (!url) return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
            if (opts && opts.type === 'module') return _wrapModuleWorker(url, opts, OrigCtor);
            if (_isBlobBlocked()) return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
            try {
                var href = url instanceof URL ? url.href : String(url);
                var pc = _buildPatchCode(href);
                var blobUrl, trustedBlobUrl, w;

                // blob: workers (CreepJS etc.) — sync read + prepend patch
                // [FIX] previously blob: was skipped → main≠worker navigator
                if (href.indexOf('blob:') === 0) {
                    // [FIX] empty blob XHR used to skip patch → worker platformVersion 19.0.0
                    if (_isOurBlob(href)) {
                        return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                    }
                    var src = _syncGet(href);
                    if (src && src.indexOf(_PATCH_MARK) !== -1) {
                        return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                    }
                    // [FIX importscripts-fallback-killed-turnstile] If the source could not
                    // be read, PASS THROUGH — do not build a patched worker whose only way to
                    // reach the original is importScripts of a blob: URL.
                    //
                    // That fallback bets on the page's CSP admitting blob: for SCRIPTS, and
                    // worker-src admitting it is a different permission. claude.ai:
                    //
                    //     worker-src blob:                        <- our worker IS created
                    //     script-src 'nonce-...' 'unsafe-eval' https://challenges.cloudflare.com
                    //
                    // so the wrapper started and then could not import what it was wrapping:
                    //
                    //     Loading the script 'blob:https://claude.ai/...' violates ... script-src
                    //          _AFPIS @ blob:https://claude.ai/...:1400
                    //     [Cloudflare Turnstile] Failed to execute 'importScripts' ...
                    //     [Cloudflare Turnstile] Cannot find Widget cf-chl-widget-...
                    //
                    // The captcha never completed and printed no error the user could act on.
                    // A wrapper that cannot load the original does not merely fail to patch,
                    // it DESTROYS the page's worker — strictly worse than not wrapping.
                    // afpPolicyBlocksBlobWorkers cannot catch this: it answers "may a blob
                    // worker be created", and here the honest answer is yes.
                    // An empty read has TWO causes needing opposite answers, which is
                    // what the first version of this fix got wrong — it passed through on
                    // both, and test/cspattribution.mjs caught it: the sync-xhr=() page
                    // stopped patching its worker (18 cores instead of 8) although
                    // importScripts was working there perfectly well.
                    //   * the READ was refused (sync-xhr=(), or connect-src) while the page
                    //     still admits blob: scripts -> importScripts is the right fallback;
                    //   * the page refuses blob: SCRIPTS -> the fallback cannot work, and
                    //     building it strands the wrapper and kills the page's worker.
                    var blobParts;
                    if (src == null || src === '') {
                        if (_blobScriptBlocked()) {
                            return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                        }
                        blobParts = pc + '\n' + _impCall(href);
                    } else {
                        blobParts = pc + '\n' + src;
                    }
                    blobUrl = URL.createObjectURL(new Blob([blobParts], { type: 'application/javascript' }));
                    trustedBlobUrl = _ttWrap(blobUrl);
                    // null means the document will not accept a blob URL from us —
                    // see FIX tt-wrap-fell-back-to-a-plain-string. Leave the original
                    // URL alone: the worker goes unpatched on this page, but nothing
                    // is blocked.
                    if (!trustedBlobUrl) {
                        try { URL.revokeObjectURL(blobUrl); } catch (e) {}
                        _ttSkipBlobWrap = true;
                        _unwrapWorkerCtors();
                        return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                    }

                    try {
                        w = Reflect.construct(OrigCtor, [trustedBlobUrl, opts], OrigCtor);
                        setTimeout(function() { try { URL.revokeObjectURL(blobUrl); } catch(e) {} }, 8000);
                        return _watchBlobWorker(w);
                    } catch (cspErr) {
                        try { URL.revokeObjectURL(blobUrl); } catch(e) {}
                        try {
                            // Reuses the payload decided above rather than rebuilding one:
                            // whichever of inline-source or importScripts was correct for
                            // this page is still correct on the retry, and rebuilding it
                            // here is how the two copies drifted apart before.
                            var blobUrl2 = URL.createObjectURL(new Blob(
                                [blobParts],
                                { type: 'application/javascript' }
                            ));
                            // [FIX tt-wrap-skipped-on-the-importscripts-retry] Every other blob
                            // hand-off in this file goes through _ttWrap; this retry passed the
                            // raw string, which is precisely the value a Trusted-Types document
                            // refuses — the same defect as FIX tt-wrap-fell-back-to-a-plain-string,
                            // left behind in the one branch that builds its blob a second time.
                            var trustedBlobUrl2 = _ttWrap(blobUrl2);
                            if (!trustedBlobUrl2) {
                                try { URL.revokeObjectURL(blobUrl2); } catch(e) {}
                                _ttSkipBlobWrap = true;
                                _unwrapWorkerCtors();
                                return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                            }
                            w = Reflect.construct(OrigCtor, [trustedBlobUrl2, opts], OrigCtor);
                            setTimeout(function() { try { URL.revokeObjectURL(blobUrl2); } catch(e) {} }, 8000);
                            return _watchBlobWorker(w);
                        } catch (e2) {
                            return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                        }
                    }
                }

                var absUrl = new URL(href, location.href).href;
                // Cross-origin (cdn-cgi / Turnstile) — do not wrap
                if (new URL(absUrl).origin !== location.origin) {
                    return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                }

                // [FIX hasBadWebGL-worker-xhr] CreepJS hasBadWebGL = main UNMASKED_RENDERER
                // !== worker.webglRenderer. importScripts(absUrl) inside a blob worker is
                // unreliable (opaque failures, SW scope, some CSP). Sync XHR + prepend the
                // full source (same technique as blob: workers above) so the WebGL
                // getParameter patch actually runs in Dedicated/Shared workers.
                var srcSame = _syncGet(absUrl);
                if (srcSame == null || srcSame === '') {
                    // fallback: importScripts (may still work on some hosts)
                    blobUrl = URL.createObjectURL(new Blob(
                        [pc + '\n' + _impCall(absUrl)],
                        { type: 'application/javascript' }
                    ));
                } else {
                    if (srcSame.indexOf(_PATCH_MARK) !== -1) {
                        return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                    }
                    blobUrl = URL.createObjectURL(new Blob(
                        [pc + '\n' + srcSame],
                        { type: 'application/javascript' }
                    ));
                }
                trustedBlobUrl = _ttWrap(blobUrl);
                // see FIX tt-wrap-fell-back-to-a-plain-string
                if (!trustedBlobUrl) {
                    try { URL.revokeObjectURL(blobUrl); } catch (e) {}
                    _ttSkipBlobWrap = true;
                    _unwrapWorkerCtors();
                    return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                }

                try {
                    w = Reflect.construct(OrigCtor, [trustedBlobUrl, opts], OrigCtor);
                    setTimeout(function() { try { URL.revokeObjectURL(blobUrl); } catch(e) {} }, 8000);
                    return _watchBlobWorker(w);
                } catch (cspErr) {
                    _blobBlocked = true;
                    _unwrapWorkerCtors();
                    try { URL.revokeObjectURL(blobUrl); } catch(e) {}
                    return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
                }
            } catch (e) {
                return Reflect.construct(OrigCtor, [url, opts], OrigCtor);
            }
        }




        // [FIX worker-ctor-tostring-lost-the-name] Здесь стояло голое
        // new Proxy(нативный ctor, {construct}) с обоснованием «цель настоящая,
        // значит toString корректен» (см. старый комментарий у register ниже).
        // Обоснование неверно: Function.prototype.toString на ПРОКСИ отдаёт не
        // строку цели, а родовую форму движка — V8 даёт
        //   "function () { [native code] }"   — без имени,
        // тогда как .name у прокси по-прежнему "Worker". Замер против чистого
        // realm (dev-clientcode.html):
        //   чистый : name="Worker"  toString="function Worker() { [native code] }"
        //   наш    : name="Worker"  toString="function () { [native code] }"
        // Именно на этом расхождении срабатывает getClientCode() у CreepJS: его
        // isEngine() сверяет ''+fn с "function "+fn.name+"() { [native code] }",
        // не находит совпадения и заносит имя в clientCode. Пустой clientCode
        // печатается как «code: unknown» (так у чистого браузера и во всех
        // воркерных scope), непустой — как хеш. С этими двумя конструкторами
        // хеш воспроизводится ровно тот, что видит пользователь: d0ed86ca.
        // Лечится тем же приёмом, что _mnCtor в mw-core: собственный toString,
        // сам замаскированный через _mn. Цель прокси остаётся нативным
        // конструктором, поэтому name/length/prototype и instanceof — родные.
        // [FIX blob-wrap-renamed-the-worker] Everything this file does to a worker starts by
        // fetching the page's script, prepending the patch and handing back a blob: URL. That
        // is invisible from the outside — but not from INSIDE the worker, where
        // self.location stops describing the script the page asked for:
        //     page:   new Worker('/assets/w.js')
        //     clean:  self.location.href     https://site/assets/w.js   pathname /assets/w.js
        //     ours:   self.location.href     blob:https://site/<uuid>   pathname /<uuid>
        // The page knows which URL it passed, so one postMessage back is enough to catch it;
        // it needs no reference browser and no knowledge of what we patch. CreepJS spells the
        // same check as a path whitelist for its own worker:
        //     locationPathNameLie = !href || !pathname ||
        //         !/^\/(docs|creepjs|public)|\/creep.js$/.test(pathname) ||
        //         !new RegExp(`${pathname}$`).test(href)
        // and that single boolean is what turned its whole Worker panel red while every value
        // inside it was already correct.
        //
        // The original URL is resolved here, in the window, and baked into the payload; the
        // worker re-parses it with its own URL so every component comes out natively rather
        // than being reconstructed by hand. Only what JS reads changes — the engine resolves
        // relative fetches against the real base either way, so nothing about loading moves.
        // Returns the constructor-mask builder, emitted into the worker as `_MC`.
        // Same shape as _mnCtor in mw/mw-core.js, trimmed to what a replaced constructor
        // needs: a construct trap that preserves new.target, an apply trap, and native
        // toString/name/length. Without it, String(Worker) inside a worker hands back our
        // source while the window's Worker is masked — dev-allfn.html compares exactly that
        // pair and would go red.
        function _mcShim(_M) {
            return function _maskCtor(inner, nm, len, proto) {
                var ns = 'function ' + nm + '() { [native code] }';
                var fts = _M(({ toString: function toString() { return ns; } }).toString);
                var px = new Proxy(function () {}, {
                    construct: function (_t, a, nt) { return Reflect.construct(inner, a, nt === px ? inner : nt); },
                    apply: function (_t, th, a) { return Reflect.apply(inner, th, a); },
                    get: function (_t, p) {
                        if (p === 'toString') return fts;
                        if (p === 'prototype') return proto;
                        if (p === 'name') return nm;
                        if (p === 'length') return len;
                        return Reflect.get(inner, p, inner);
                    },
                    getOwnPropertyDescriptor: function (_t, p) {
                        if (p === 'prototype') return { value: proto, writable: false, enumerable: false, configurable: false };
                        if (p === 'name') return { value: nm, writable: false, enumerable: false, configurable: true };
                        if (p === 'length') return { value: len, writable: false, enumerable: false, configurable: true };
                        return Reflect.getOwnPropertyDescriptor(inner, p);
                    },
                    has: function (_t, p) { return Reflect.has(inner, p); },
                    ownKeys: function () { return ['length', 'name', 'prototype']; },
                    getPrototypeOf: function () { return Function.prototype; }
                });
                return px;
            };
        }

        // [FIX nested-workers-were-never-reached] A patched worker did not wrap its OWN
        // Worker constructor, so a worker that spawns a worker handed the child a native
        // scope. Measured, three levels in one page, profile America/New_York on a Moscow
        // host:
        //
        //   page      America/New_York   240    8 cores   en-US   Iris Xe   headless:false
        //   worker    America/New_York   240    8 cores   en-US   Iris Xe   headless:false
        //   CHILD     Europe/Moscow     -180   18 cores   ru-RU   Arc       headless:TRUE
        //
        // Same full bypass as data: frames and module workers, reachable from a page in two
        // lines. Worker pools built on a coordinator worker are an ordinary pattern.
        //
        // The patch text is NOT embedded a second time — that would double every payload.
        // It lives in ONE blob per page and the child gets its URL through a global that the
        // preamble sets before importScripts, which is why grandchildren work too: each
        // level sets it again for the next. Verified in a bare browser first — a blob worker
        // CAN importScripts another blob URL, a nested worker can do it as well, and sync
        // XHR works inside a worker to read the child's source.
        /** Serialised tail of the _nestShim invocation, kept out of the payload array. */
        function _nestShimArgs() {
            return JSON.stringify(_PATCH_MARK) + ',' + JSON.stringify(_IMP_SRC) + ',' +
                JSON.stringify(_MODULE_MSG_QUEUE_HEAD) + ',' + JSON.stringify(_MODULE_MSG_QUEUE_TAIL);
        }

        function _nestShim(_M, _MC, MARK, IMP, QHEAD, QTAIL) {
            try {
                function wrapCtor(Ctor, nm) {
                    if (typeof Ctor !== 'function') return;
                    var inner = function (url, opts) {
                        var patch = null;
                        try { patch = self.__AFP_PATCH_URL || null; } catch (e0) {}
                        if (!patch || !url) return Reflect.construct(Ctor, [url, opts], Ctor);
                        var bu = null;
                        try {
                            var href = (url && url.href) ? String(url.href) : String(url);
                            var abs = new URL(href, self.location.href).href;
                            // Same policy as the page-side wrapper: leave cross-origin alone.
                            if (href.indexOf('blob:') !== 0 && new URL(abs).origin !== self.location.origin) {
                                return Reflect.construct(Ctor, [url, opts], Ctor);
                            }
                            var src = null;
                            try {
                                var x = new XMLHttpRequest();
                                x.open('GET', abs, false);
                                x.send();
                                if (x.status === 0 || (x.status >= 200 && x.status < 300)) src = x.responseText;
                            } catch (e1) {}
                            if (src && src.indexOf(MARK) !== -1) return Reflect.construct(Ctor, [url, opts], Ctor);
                            var head = 'self.__AFP_PATCH_URL=' + JSON.stringify(patch) + ';' +
                                'self.__AFP_CHILD_LOC=' + JSON.stringify(abs) + ';';
                            var body;
                            if (opts && opts.type === 'module') {
                                // import(), never a static import: a static one is hoisted
                                // and would evaluate the child before the patch. Dynamic
                                // import() takes a module specifier, not a TrustedScriptURL
                                // sink, so it needs no wrapping — unlike importScripts below.
                                // Same drop as the page-side path — see
                                // [FIX module-worker-dropped-the-first-message]. The queue
                                // text is handed in from the window with the rest of the
                                // wrapper source, so there is one definition of it.
                                body = head + 'await import(' + JSON.stringify(patch) + ');' +
                                    QHEAD + 'await import(' + JSON.stringify(abs) + ');' + QTAIL;
                            } else {
                                // IMP is the wrapper's SOURCE, handed in from the window so
                                // there is one definition rather than a copy here that can
                                // drift — see [FIX importscripts-is-a-trusted-types-sink-too].
                                // It has to be inline text: this import IS the patch, so
                                // nothing the patch defines exists yet in the child.
                                body = head + IMP + '_AFPIS(' + JSON.stringify(patch) + ');' +
                                    ((src != null && src !== '') ? src
                                        : ('_AFPIS(' + JSON.stringify(abs) + ');'));
                            }
                            bu = URL.createObjectURL(new Blob([body], { type: 'application/javascript' }));
                            // [FIX nested-worker-handed-a-raw-blob-url] Every hand-off on the
                            // window side goes through _ttWrap; this one, inside the worker,
                            // passed the bare string. Trusted Types is NOT a document-only
                            // thing — measured in a worker of a `require-trusted-types-for
                            // 'script'` page that permits blob: workers:
                            //
                            //   typeof trustedTypes        'object'   (enforcement inherited)
                            //   trustedTypes.defaultPolicy  null
                            //   new Worker(<raw blob url>)  TypeError: This document requires
                            //                               'TrustedScriptURL' assignment.
                            //   createPolicy(...)           created    <- so this is fixable here
                            //
                            // The throw was caught by the catch below and fell back to the
                            // native constructor, which is precisely the bypass
                            // [FIX nested-workers-were-never-reached] exists to close: the
                            // grandchild ran unpatched and answered with the host's machine.
                            // Reopened only on Trusted-Types origins, which is why the
                            // measured three-level table in that fix still looked correct.
                            var _bu = bu;
                            try {
                                if (typeof trustedTypes !== 'undefined' && trustedTypes) {
                                    var _wp = trustedTypes.defaultPolicy;
                                    if (!_wp) {
                                        try { _wp = trustedTypes.createPolicy('afp-nested-worker', {
                                            createScriptURL: function (s) { return s; } }); } catch (ePol) { _wp = null; }
                                    }
                                    var _t = _wp && _wp.createScriptURL(bu);
                                    // A policy that does not implement createScriptURL hands
                                    // back a string, which is the one value the scope refuses —
                                    // same trap as FIX tt-wrap-fell-back-to-a-plain-string.
                                    _bu = (_t && typeof _t !== 'string') ? _t : bu;
                                }
                            } catch (eTt) { _bu = bu; }
                            var w = Reflect.construct(Ctor, [_bu, opts], Ctor);
                            setTimeout(function () { try { URL.revokeObjectURL(bu); } catch (e2) {} }, 8000);
                            return w;
                        } catch (e) {
                            try { if (bu) URL.revokeObjectURL(bu); } catch (e3) {}
                            return Reflect.construct(Ctor, [url, opts], Ctor);
                        }
                    };
                    inner.prototype = Ctor.prototype;
                    try { self[nm] = _MC(inner, nm, Ctor.length, Ctor.prototype); }
                    catch (e4) { try { self[nm] = inner; } catch (e5) {} }
                }
                wrapCtor(self.Worker, 'Worker');
                wrapCtor(self.SharedWorker, 'SharedWorker');
            } catch (e) {}
        }

        function _locShim(abs, _M) {
            try {
                // A child worker is created from a blob by _nestShim, so the URL baked into
                // the shared patch blob is the wrong one for it. The child's preamble sets
                // this global, and it wins here; read once and removed so a grandchild
                // cannot inherit its parent's location.
                try {
                    if (self.__AFP_CHILD_LOC) { abs = self.__AFP_CHILD_LOC; delete self.__AFP_CHILD_LOC; }
                } catch (eCL) {}
                if (typeof WorkerLocation === 'undefined' || !WorkerLocation.prototype) return;
                var u = new URL(abs);
                var proto = WorkerLocation.prototype;
                var FIELDS = ['href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'];
                FIELDS.forEach(function (k) {
                    try {
                        var d = Object.getOwnPropertyDescriptor(proto, k);
                        if (!d || typeof d.get !== 'function') return;
                        var val = u[k];
                        Object.defineProperty(proto, k, {
                            // Branded like every other accessor we install: reading it off the
                            // prototype has to raise Illegal invocation the way native does —
                            // see [FIX worker-getters-had-no-brand-check].
                            get: _M(({ [k]: function () {
                                if (this == null || !proto.isPrototypeOf(Object(this))) {
                                    throw new TypeError('Illegal invocation');
                                }
                                return val;
                            } })[k], true),
                            set: undefined,
                            enumerable: d.enumerable,
                            configurable: d.configurable
                        });
                    } catch (eF) {}
                });
                try {
                    var td = Object.getOwnPropertyDescriptor(proto, 'toString');
                    if (td && typeof td.value === 'function') {
                        Object.defineProperty(proto, 'toString', {
                            value: _M(function toString() {
                                if (this == null || !proto.isPrototypeOf(Object(this))) {
                                    throw new TypeError('Illegal invocation');
                                }
                                return u.href;
                            }),
                            writable: td.writable, enumerable: td.enumerable, configurable: td.configurable
                        });
                    }
                } catch (eT) {}
            } catch (eAll) {}
        }

        function _wkCtorProxy(OrigCtor, name) {
            var ns = 'function ' + name + '() { [native code] }';
            var fakeToString = _mnRef(({ toString: function toString() { return ns; } }).toString);
            return new Proxy(OrigCtor, {
                construct: function(target, args) {
                    // [FIX worker-ctor-errors-named-the-extension] `new Worker(<bad url>)`
                    // throws from inside _wrapWorkerUrl, and this proxy is hand-built rather
                    // than produced by _mn — so unlike every wrapper mw-core makes, nothing
                    // was cleaning the stack and our frame rode out to the page by name:
                    //
                    //   at _wrapWorkerUrl (chrome-extension://<id>/mw-bundle.js:10511:32)
                    //
                    // Measured against a clean browser on the same machine, which throws the
                    // same error with only the page's own frames. That is the extension's ID
                    // and its file layout handed over for the price of one bad URL, and it
                    // happens in BOTH modes — this file has no stealth gate at all.
                    //
                    // _stripFrames below is the local twin of mw-core's _stripOwnFrames and
                    // already exists in this file for exactly this purpose; it simply was
                    // never applied on the construction path.
                    var w;
                    try {
                        w = _wrapWorkerUrl(args[0], args[1], target);
                    } catch (eCtor) { throw _stripFrames(eCtor); }
                    // [FIX worker-baked-a-provisional-seed] One place instead of the eight
                    // return paths inside _wrapWorkerUrl. The seed the payload was built
                    // with is whatever the window could answer just now; if that turns out
                    // to have been provisional, _flushSeed corrects this worker.
                    try { _trackSeed(w, name, _getSeed()); } catch (e) {}
                    return w;
                },
                get: function(t, p) {
                    if (p === 'toString') return fakeToString;
                    return Reflect.get(t, p, t);
                }
            });
        }

        // Installing at all is conditional — see [FIX tt-violation-named-our-file]. On an
        // origin already known to forbid blob: workers, or where no TrustedScriptURL can be
        // minted, every path through _wrapWorkerUrl is a passthrough, so the only thing the
        // proxy would contribute is our own file in the stack of the page's own failures.
        // On youtube.com background.js has recorded the answer from the response headers
        // before the document is parsed, so this is the steady state there: nothing installed,
        // window.Worker stays the untouched native constructor.
        var _wkWrapWorthIt = !_ttSkipBlobWrap && !_isBlobBlocked();
        var _wkProxiesInstalled = false;

        function _wkInstallCtorProxies() {
            if (_wkProxiesInstalled) return;
            _wkProxiesInstalled = true;
            if (typeof Worker !== 'undefined') {
                var _wOrigCtor = Worker;
                var _wProxy = _wkCtorProxy(_wOrigCtor, 'Worker');
                try {
                    Object.defineProperty(window, 'Worker', { value: _wProxy, configurable: true, writable: true });
                    _wkNative.push(function () {
                        Object.defineProperty(window, 'Worker', { value: _wOrigCtor, configurable: true, writable: true });
                    });
                } catch(e) {}
            }
            if (typeof SharedWorker !== 'undefined') {
                var _sOrigCtor = SharedWorker;
                var _sProxy = _wkCtorProxy(_sOrigCtor, 'SharedWorker');
                try {
                    Object.defineProperty(window, 'SharedWorker', { value: _sProxy, configurable: true, writable: true });
                    _wkNative.push(function () {
                        Object.defineProperty(window, 'SharedWorker', { value: _sOrigCtor, configurable: true, writable: true });
                    });
                } catch(e) {}
            }
        }

        // [FIX tt-passthrough-put-our-frame-on-the-violation] WHEN the proxy goes in, on an
        // origin that requires TrustedScriptURL.
        //
        // A refused `new Worker('<string>')` reports a CSP violation, and the report is built
        // in C++ from the live JS stack — so whoever CALLS the constructor is named in it.
        // With the proxy installed at document_start the page's own refused call ran through
        // our passthrough, and the violation stopped naming the page:
        //
        //   clean   sourceFile=http://…/tt              line 15
        //   ours    sourceFile=chrome-extension         line 10778
        //
        // which is the un-maskable second stack channel of
        // [FIX csp-reports-are-a-second-stack-channel], now pointing straight at the build.
        // So on such an origin nothing is installed until the page creates the policy we
        // intend to borrow. That is early enough by construction — the page cannot build a
        // worker there without one — and until then `window.Worker` is the untouched native
        // constructor, so its refusals carry the page's stack and only the page's.
        if (_wkWrapWorthIt) _wkInstallCtorProxies();

        // [FIX sw-register-tostring-leak] register подменялся ГОЛОЙ функцией, без
        // native-маскировки: navigator.serviceWorker.register.toString() отдавал
        // реальный исходник обёртки, а own-свойства были {length,name,arguments,
        // caller,prototype} вместо нативных {length,name} — то самое, от чего весь
        // остальной код уходит через _mn (см. mw-core).

        /**
         * Drop this extension's frames from an error we constructed, keeping the caller's.
         * Same rule as _stripOwnFrames in mw-core (which is not exported): an error that
         * would be left with NO frames is returned untouched, because a one-line stack is
         * an anomaly of its own.
         */
        function _stripFrames(err) {
            try {
                if (!err || typeof err.stack !== 'string') return err;
                var lines = err.stack.split(String.fromCharCode(10));
                if (lines.length < 2) return err;
                var keep = [];
                for (var i = 1; i < lines.length; i++) {
                    if (lines[i].indexOf('chrome-extension://') === -1) keep.push(lines[i]);
                }
                if (keep.length && keep.length !== lines.length - 1) {
                    err.stack = [lines[0]].concat(keep).join(String.fromCharCode(10));
                }
            } catch (e) {}
            return err;
        }

        // Same condition, and for the same reason, as the two constructors above: when the
        // wrapper can only pass the call through, register()'s own sink call would still be
        // made from this file.
        if (_wkWrapWorthIt && navigator.serviceWorker && navigator.serviceWorker.register) {
            // [FIX instance-own-property-lies] Assigning to navigator.serviceWorker left
            // an own 'register' on an object that natively has none.
            var _swProto = Object.getPrototypeOf(navigator.serviceWorker);
            var _swReg = _swProto.register;
            var _swSelf = navigator.serviceWorker;
            var _swRegDesc = Object.getOwnPropertyDescriptor(_swProto, 'register');
            var _origReg = function (u, o) { return _swReg.call(_swSelf, u, o); };
            _wkNative.push(function () {
                Object.defineProperty(_swProto, 'register', _swRegDesc);
            });
            Object.defineProperty(_swProto, 'register', {
              writable: true, configurable: true, enumerable: true,
              value: _mnRef(function register(scriptURL, options = undefined) {
                try {
                    if (options && options.type === 'module') return _origReg(scriptURL, options);
                    if (_ttSkipBlobWrap || _isBlobBlocked()) return _origReg(scriptURL, options);
                    if (_ttWouldRefuse(scriptURL)) {
                        // [FIX a-refusal-we-passed-through-was-charged-to-us] Same answer as
                        // the constructors; register() rejects where they throw.
                        var rf = _ttRefusal(scriptURL, "execute 'register' on 'ServiceWorkerContainer'", 'ServiceWorkerContainer register');
                        if (!rf) return _origReg(scriptURL, options);
                        if (rf.error) return Promise.reject(rf.error);
                        scriptURL = rf.trusted;
                    }
                    var href = scriptURL instanceof URL ? scriptURL.href : String(scriptURL);
                    var absUrl = new URL(href, location.href).href;
                    if (new URL(absUrl).origin !== location.origin) return _origReg(scriptURL, options);
                    // [CLEANUP] дублирующая проверка _blobBlocked убрана — она уже сделана строкой выше
                    if (String(href).indexOf('blob:') === 0) return _origReg(scriptURL, options);
                    // [FIX the-service-worker-blob-path-could-never-work] What stood here
                    // fetched the SW source with a SYNCHRONOUS XHR on every registration,
                    // built a patched blob, wrapped it in Trusted Types and registered THAT,
                    // so a fingerprinter's service worker would report the profile's GPU
                    // instead of the real one. Chrome does not allow it and never did —
                    // measured on a clean browser, no extension:
                    //
                    //   register('/sw.js')      OK
                    //   register('/missing.js') TypeError ... A bad HTTP response code (404)
                    //   register(blob:...)      TypeError: Failed to register a ServiceWorker:
                    //                           The URL protocol of the script ('blob:...')
                    //                           is not supported.
                    //
                    // So the blob branch rejected 100% of the time. Every site paid a blocking
                    // XHR for it, normal sites then registered natively one round trip late,
                    // and fingerprinting scripts got the hand-written rejection below — whose
                    // stack named chrome-extension://<id>/mw-bundle.js, readable by the page
                    // in three lines. Measured on abrahamjuliot.github.io: e.stack carried the
                    // extension id. The dead branch is gone; the DENIAL it existed to justify
                    // stays, because an unpatched service worker would report the real GPU and
                    // timezone to exactly the scripts that compare scopes.
                    // [FIX service-worker-scope-is-unreachable] Two reasons to refuse, one
                    // refusal. The name check below catches the obvious probes; the switch
                    // is the user's own decision for this host, and it arrives two ways —
                    // window.__s0 from sw-off.js at document_start (so a page that registers
                    // in its first script is covered) and the profile flag for anything
                    // later. The site's already-installed worker is unregistered by that
                    // same file: refusing new registrations would leave the old one running.
                    var _swBlockedHere = (function () {
                        try { if (window.__s0) return true; } catch (eS) {}
                        try { var p = _prof(); return !!(p && p.swBlocked); } catch (eS2) { return false; }
                    })();
                    var _isFpSw = _swBlockedHere ||
                        /creep\.js|creepjs|fingerprint|fp\.js|worker_service/i.test(absUrl);
                    if (!_isFpSw) return _origReg(scriptURL, options);
                    // The refusal is shaped like a state the browser really has, measured on
                    // this rig with site data blocked (Preferences: cookies = 2):
                    //
                    //   DOMException NotSupportedError, code 9, NO stack property at all,
                    //   no own properties, [object DOMException]
                    //   "Failed to register a ServiceWorker for scope ('X') with script ('Y'):
                    //    The user denied permission to use Service Worker."
                    //
                    // A DOMException built here compares identical on every one of those —
                    // constructor, name, code, instanceof DOMException AND Error, toStringTag,
                    // and the missing stack. That last point is why this replaced the earlier
                    // 404 TypeError: a TypeError carries a stack, and ours began with
                    // chrome-extension://<id>/mw-bundle.js. Here the platform gives the error
                    // no stack to leak, instead of us editing one afterwards.
                    //
                    // The reason is chosen for what it does NOT invite: a 404 claim about a
                    // script the page is currently EXECUTING (creepjs registers creep.js
                    // itself) is refuted by one fetch. "The user denied permission" is a
                    // whole-origin state and needs a second, differently-named registration to
                    // contradict. It can still be contradicted that way — the denial matches on
                    // the script NAME — and making it origin-wide instead would break the
                    // site's own service worker, which is not a trade worth making.
                    var _scope;
                    try {
                        _scope = (options && options.scope)
                            ? new URL(options.scope, location.href).href
                            : absUrl.replace(/[^/]*$/, '');
                    } catch (eSc) { _scope = location.href; }
                    var _swErr;
                    try {
                        _swErr = new DOMException(
                            "Failed to register a ServiceWorker for scope ('" + _scope + "') with script ('" +
                            absUrl + "'): The user denied permission to use Service Worker.", 'NotSupportedError');
                    } catch (eDe) {
                        _swErr = new TypeError("Failed to register a ServiceWorker for scope ('" + _scope +
                            "') with script ('" + absUrl + "'): The user denied permission to use Service Worker.");
                    }
                    // A DOMException has no stack, so this does nothing to it — it stays for the
                    // TypeError fallback above, which does.
                    try { _stripFrames(_swErr); } catch (eSt) {}
                    return Promise.reject(_swErr);
                } catch (e) {
                    return _origReg(scriptURL, options);
                }
              })
            });
        }
    } catch(_) {}
})();
