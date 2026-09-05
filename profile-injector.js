// profile-injector.js — document_start MAIN world bootstrap.
// Full profile arrives later from background.js; bridge delivers TZ+locale+seed (+ skeleton) ASAP.
//
// [IMPROVE variant-4] Goal: never show a deliberately wrong locale/timezone
// (the old et-EE / Europe/Tallinn bootstrap). Prefer any previously stored
// coherent profile. Only as last resort build a neutral US-centric stub that
// matches the extension's own DEFAULT_PROFILE + initDefaults country fallback.
// The full injectProfile from background still replaces everything ~100-300 ms
// later; the difference is that the temporary values are no longer "Estonian".
(function() {
    'use strict';
    // [CLEANUP] AFP_SYM (Symbol.for('js.runtime.bridge.v2')) объявлялся и никогда
    // не использовался; сам символ удаляется в mw/mw-cleanup.js.
    //
    // [FIX profile-readable-by-any-page] Профиль больше не пишется в
    // sessionStorage['v.ui.s'] — он живёт в замыкании mw/mw-core.js, см. подробности
    // там. Этот файл идёт ПЕРВЫМ в манифесте, то есть строит ранний профиль до того,
    // как mw-core вообще загрузился, и передаёт его эстафетой: непубличное
    // не-enumerable свойство, которое mw-core забирает и тут же удаляет. Между двумя
    // файлами одной content_scripts-записи скрипт страницы выполниться не может, так
    // что эстафета не видна никому.
    //
    // Дальше связь односторонняя и через событие: ui:ready от dyn/boot.js прилетает
    // уже ПОСЛЕ mw-core, поэтому доработанный профиль уходит обратно через ui:state,
    // который mw-core слушает. Свою копию (_cur) этот файл держит сам и обновляет по
    // тому же ui:state — иначе поздний inject от background.js остался бы им незамечен
    // и bridge-поля легли бы поверх устаревшего объекта.
    var _cur = null;
    var _batonDone = false;

    // [FIX cold-start-machine-remainder] Verbatim from buildProfile() in background.js —
    // the MAIN world cannot importScripts, which is the same reason mw-core.js keeps its
    // own copy of AFP_DEFAULT_FEATURES. test/parity-static.mjs compares both copies and
    // fails on any drift, so this is duplication with a guard, not duplication on trust.
    var WIN_FONTS = [
        'Arial', 'Arial Black', 'Arial Narrow', 'Bahnschrift', 'Calibri', 'Calibri Light', 'Cambria',
        'Cambria Math', 'Candara', 'Candara Light', 'Comic Sans MS', 'Consolas', 'Constantia',
        // Dubai family removed — see the note on allowedFonts in background.js. This copy
        // is kept in step by test/parity-static.mjs.
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
    ];
    var PDF_PLUGINS = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
    ];
    var PDF_MIME_TYPES = [
        { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
        { type: 'text/pdf', description: 'Portable Document Format', suffixes: 'pdf' }
    ];

    function seedStatusFromProfile(p) {
        try {
            var f = (p && p.features) || {};
            // [FIX status-was-a-page-readable-key] window.__t0, non-enumerable, instead
            // of sessionStorage['v.ui.t'] — see mw/mw-canvas-audio.js _statusMark.
            var st = window.__t0;
            if (!st) {
                st = {};
                try {
                    Object.defineProperty(window, '__t0', {
                        value: st, writable: true, configurable: true, enumerable: false
                    });
                } catch (eD) { window.__t0 = st; }
            }
            // [CLEANUP] 'audio' stood in this list. There is no `audio` feature flag any
            // more — it went with the AudioContext noise (see defaults.js) — so
            // f['audio'] was undefined, which is `!== false`, and st.audio was set to true
            // on every load. Nothing reads it: the popup checks canvas/webgl/tz/webrtc/
            // battery/wasm, and no module calls markStatus('audio'). The remaining five
            // names each have a real writer in mw/*.js.
            ['canvas','webgl','timezone','webrtc','battery'].forEach(function (k) {
                if (f[k] !== false) st[k === 'timezone' ? 'tz' : k] = true;
            });
        } catch (e) {}
    }
    function afpSetProfile(p) {
        if (!p || typeof p !== 'object') return;
        _cur = p;
        // Эстафета для mw-core — ТОЛЬКО на первый вызов.
        //
        // [FIX baton-was-republished-after-cleanup] Раньше она ставилась заново на каждый
        // afpSetProfile. Забрать её может лишь mw-core в момент своей загрузки, то есть
        // сразу после первого, синхронного вызова; все последующие (ui:ready от
        // storage-bridge и dyn/boot.js) происходят уже ПОСЛЕ mw-cleanup, который её
        // удалил, — и просто создавали свойство заново, теперь уже навсегда.
        //
        // Цена этого измерена на creepjs/tests/workers.html: getClientCode() начинается с
        // `if (/_$/.test(key)) return true` — имя, оканчивающееся на подчёркивание,
        // считается клиентским кодом БЕЗУСЛОВНО, мимо всех проверок на нативность. То есть
        // не-enumerable здесь не спасало: список строится ещё и из
        // Object.getOwnPropertyNames. Чистый браузер даёт пустой clientCode, мы давали
        // ровно один элемент — и CreepJS красит это как fail (`failsCode`).
        //
        // Поздние обновления профиля доезжают событием ui:state, у него для этого и
        // появился слушатель в mw-core.
        if (!_batonDone) {
            _batonDone = true;
            try {
                Object.defineProperty(window, '__AFP_P0__', {
                    value: p, writable: true, configurable: true, enumerable: false
                });
            } catch (eBaton) { try { window.__AFP_P0__ = p; } catch (eBaton2) {} }
        }
        try { seedStatusFromProfile(p); } catch (eSeed) {}
        try { sessionStorage.removeItem('__afp_last_profile__'); } catch (eRm) {}
        try { sessionStorage.removeItem('afp_mode'); sessionStorage.removeItem('afp_st'); } catch (eRm2) {}
        // Для mw-core, когда он уже загружен (ui:ready приходит позже него).
        try { document.dispatchEvent(new CustomEvent('ui:state', { detail: p })); } catch (e2) {}
    }
    function afpBag() {
        return {
            getProfile: function () { return _cur; },
            applyProfile: afpSetProfile
        };
    }
    // Поздний профиль от background.js — чтобы _cur не разъезжался с mw-core.
    try {
        document.addEventListener('ui:state', function (ev) {
            var next = ev && ev.detail;
            if (next && typeof next === 'object') _cur = next;
        });
    } catch (eLive) {}

    // [CLEANUP] Здесь были registrableDomain / deriveDomainSeed / domainizeSeed —
    // копии алгоритма per-domain seed из background.js. Ни одна не вызывалась:
    // domainizeSeed нигде не использовалась, а две остальные существовали только
    // ради неё. Seed приходит сюда УЖЕ доменным — и через data-v-ns от
    // storage-bridge.js (там toDomainSeed вызывается перед публикацией), и через
    // profile.noiseSeed от background.injectProfile. Повторное применение
    // deriveDomainSeed поверх уже доменного seed как раз и было бы багом,
    // поэтому восстанавливать эти копии не нужно.

    // [FIX languages-overwrite] Не пересобираем languages упрощённым списком, если
    // профиль уже несёт полный список (из background / прошлой inject), чей
    // primary совпадает с locale. Иначе Accept-Language header (полный) и
    // navigator.languages (урезанный) расходятся, а смена afp_mode затирала
    // fr-CA/fr у CA и т.п. Пересобираем только bootstrap / смену locale.
    // [FIX bootstrap-langs-listed-en-twice] The `else if (locale !== 'en-US')` branch that
    // stood at the end pushed 'en' a SECOND time for every en-XX locale: the first `if`
    // has already added the bare language by then, and for a bare 'en' the branch was the
    // one adding the duplicate. Measured: en-GB -> ['en-GB','en','en'], same for en-AU,
    // en-CA, en-IE, en-IN, en-SG, en-NZ, en-ZA, en-PH, en-KE, en-NG. No browser repeats a
    // tag in navigator.languages, so the list said "spoofed" on its own.
    //
    // It is reachable: storage-bridge.js dispatches ui:ready with `locale` but NO
    // `languages` array (unlike dyn/boot.js), so this function is what builds the list on
    // that path. When dyn/boot.js has already published the real list, applyBridge keeps
    // it — but dyn/boot.js does not run at all in the window after a browser restart
    // re-installs an unpacked extension and clears the dynamic registration (see the note
    // at registerBootScript in background.js), and there the duplicate reached the page
    // until the full profile landed.
    //
    // The first `if` already covers every correct case, so the branch is simply gone.
    function buildBootstrapLangs(locale) {
        var base = locale.split('-')[0];
        var langs = [locale];
        if (base && base !== locale) langs.push(base);
        if (base !== 'en') {
            langs.push('en-US');
            langs.push('en');
        }
        return langs;
    }

    function applyBridge(p, detail) {
        if (!p || !detail) return;
        if (detail.timezone) p.timezone = detail.timezone;
        if (typeof detail.noiseSeed === 'number' && isFinite(detail.noiseSeed)) {
            // bridge already domain-scoped
            p.noiseSeed = detail.noiseSeed >>> 0;
        }
        if (detail.locale) {
            p.language = detail.locale;
            p.locale = detail.locale;
            // [FIX missing-countryCode] et-EE → EE до прихода полного профиля
            try {
                var parts = String(detail.locale).split('-');
                if (parts.length >= 2) p.countryCode = parts[parts.length - 1].toUpperCase();
            } catch (eCc) {}
            var keepLangs = Array.isArray(p.languages) && p.languages.length > 0 &&
                p.languages[0] === detail.locale;
            if (!keepLangs) {
                p.languages = buildBootstrapLangs(detail.locale);
            }
        }
        // [FIX cold-start-machine] dyn/boot.js carries the real Accept-Language list and
        // the country it belongs to, so they no longer have to be guessed from the
        // locale by buildBootstrapLangs above. Applied after the locale block precisely
        // so it wins over that guess when the real list is available.
        if (Array.isArray(detail.languages) && detail.languages.length > 0) {
            p.languages = detail.languages.slice();
        }
        if (detail.countryCode) p.countryCode = String(detail.countryCode).toUpperCase();
        // [FIX cold-start-voices] Without this mw/mw-canvas-audio.js falls back to its
        // hardcoded en-US trio (default: Zira) until the full profile lands, and CreepJS
        // reads the voice list early enough to catch it — a de-DE locale with an en-US
        // default voice is what its voiceLangMismatch check is looking for.
        if (Array.isArray(detail.speechVoices) && detail.speechVoices.length > 0) {
            p.speechVoices = detail.speechVoices;
        }
        // [FIX cold-start-platform-version] The DNR rule already sends the host's real
        // bucket in sec-ch-ua-platform-version from the very first request, so leaving the
        // JS side on the '10.0.0' fallback below made the two layers disagree for the
        // length of the cold start — a Windows 10 claim under a Windows 11 header.
        if (detail.platformVersion) {
            if (!p.clientHints || typeof p.clientHints !== 'object') p.clientHints = {};
            p.clientHints.platformVersion = detail.platformVersion;
        }
        if (detail.mode === 'stealth' || detail.mode === 'normal') {
            p.mode = detail.mode;
        }
        if (detail.features && typeof detail.features === 'object') {
            p.features = detail.features;
        }
        // Hardware skeleton from last known profileData (variant-4)
        if (detail.profileData && typeof detail.profileData === 'object') {
            var pd = detail.profileData;
            if (pd.platform) p.platform = pd.platform;
            if (pd.cores) p.hwConcurrency = pd.cores;
            if (pd.memory) p.deviceMemory = pd.memory;
            if (pd.screenW) p.screenWidth = pd.screenW;
            if (pd.screenH) p.screenHeight = pd.screenH;
            if (pd.gpu) p.gpu = pd.gpu;
            // [FIX cold-start-machine] storage-bridge can only forward afp_profile_data,
            // whose `gpu` is a GPU_DATA *key* — the ISOLATED world has no table to
            // resolve it and nothing anywhere reads p.gpu. So on a cold tab the WebGL
            // strings stayed on the Iris Xe default no matter which machine was
            // selected. dyn/boot.js ships the resolved ANGLE strings; the rest of the
            // skeleton follows the same buildProfile() derivations.
            if (pd.glVendor) p.webglVendor = pd.glVendor;
            if (pd.glRenderer) p.webglRenderer = pd.glRenderer;
            if (typeof pd.dpr === 'number' && pd.dpr > 0) p.devicePixelRatio = pd.dpr;
            if (typeof pd.bluetooth === 'boolean') p.hasBluetooth = pd.bluetooth;
            // [FIX cold-start-gl-limits] Numeric GL limits and the WebGPU adapter info.
            // Until these travelled, UNMASKED_RENDERER named the spoofed card while every
            // getParameter number still came from the real driver — see tools/gen-dyn.mjs.
            if (pd.glParams && typeof pd.glParams === 'object') p.webglParams = pd.glParams;
            if (typeof pd.glMaxAniso === 'number') p.webglMaxAnisotropy = pd.glMaxAniso;
            if (pd.gpuVendor) p.webgpuVendor = pd.gpuVendor;
            if (typeof pd.gpuArch === 'string') p.webgpuArchitecture = pd.gpuArch;
            if (typeof pd.gpuDevice === 'string') p.webgpuDevice = pd.gpuDevice;
            if (typeof pd.gpuDesc === 'string') p.webgpuDescription = pd.gpuDesc;
            // [FIX host-mode] Set in BOTH directions: a record without the flag is a table
            // row, and a page that was host before the user switched must stop being it.
            p.hostHw = (pd.host === true);
            // [FIX decoder-answered-for-the-host-gpu] The claimed card's AV1 decoder.
            if (typeof pd.av1 === 'boolean') p.hwAv1Decode = pd.av1;
        }
        // [FIX device-state-was-per-domain] Battery + geolocation offset, resolved from the
        // MASTER seed by dyn/boot.js (see afpDeviceState in seed-lib.js). Copied field by
        // field like everything else here, so a partial object cannot blank out values the
        // full profile already delivered.
        if (detail.deviceState && typeof detail.deviceState === 'object') {
            var ds = detail.deviceState;
            if (typeof ds.batteryLevel === 'number') p.batteryLevel = ds.batteryLevel;
            if (typeof ds.batteryCharging === 'boolean') p.batteryCharging = ds.batteryCharging;
            if (ds.batteryChargingTime !== undefined) p.batteryChargingTime = ds.batteryChargingTime;
            if (ds.batteryDischargingTime !== undefined) p.batteryDischargingTime = ds.batteryDischargingTime;
            if (typeof ds.geoOffsetLat === 'number') p.geoOffsetLat = ds.geoOffsetLat;
            if (typeof ds.geoOffsetLon === 'number') p.geoOffsetLon = ds.geoOffsetLon;
            if (typeof ds.geoAccuracy === 'number') p.geoAccuracy = ds.geoAccuracy;
        }
        if (detail.profileId) p.profileId = detail.profileId;
        // Публикацию делает вызывающий: каждая из трёх точек входа ниже сразу за
        // applyBridge зовёт afpSetProfile(p) — раньше запись была и здесь, и там.
    }

    // [CLEANUP dead-attribute-readers] The five `data-v-*` reads that stood here, and the
    // attrDetail() snapshot built from them, are gone. Nothing writes an attribute to
    // <html> any more ([FIX bridge-attributes-were-an-extension-detector]), so every one
    // of them evaluated to null and attrDetail() returned an object of ten nulls. Both of
    // its call sites were therefore no-ops: applyBridge() guards every field individually,
    // and buildAndSetEarlyFromBridge() falls back per field. Verified by removal — the
    // node, dev-page and coldstart suites all still pass, and the cold start still runs on
    // the ui:ready detail, which is what actually carries the machine.

    try {
        document.addEventListener('ui:ready', function(ev) {
            try {
                if (!ev.detail) return;
                var _bp =(afpBag() && afpBag().getProfile && afpBag().getProfile()) || window.__AFP_PROFILE__;
                if (_bp) {
                    applyBridge(_bp, ev.detail);
                    afpSetProfile(_bp);
                } else {
                    // Cold start: build a better early profile from whatever the bridge gave us
                    buildAndSetEarlyFromBridge(ev.detail);
                }
            } catch (e) {}
        });
    } catch (e) {}

    // Уже есть полный профиль — только дотягиваем bridge-поля.
    //
    // [FIX profile-readable-by-any-page] Раньше веток было две: сначала bag (который
    // читал sessionStorage), потом ещё раз sessionStorage напрямую — один и тот же
    // источник, проверенный дважды с разными условиями (`timezone && hwConcurrency`
    // против `timezone || hwConcurrency`). Осталась одна.
    //
    // Единственный источник здесь — ключ старой сборки: вкладка, пережившая
    // обновление расширения, ещё держит там профиль. Забираем и стираем; дальше по
    // жизни вкладки писать туда уже некому. Он же покрывает dev-*.html, которые
    // кладут фикстуру в этот ключ до загрузки модулей.
    var existing = window.__AFP_PROFILE__ || null;
    try {
        if (!existing) {
            var legacy = sessionStorage.getItem('v.ui.s');
            if (legacy) existing = JSON.parse(legacy);
        }
    } catch (eLegacy) {}
    try { sessionStorage.removeItem('v.ui.s'); } catch (eWipe) {}

    if (existing && (existing.timezone || existing.hwConcurrency)) {
        // [FIX cold-start-machine] This path also covers F5 after the profile was
        // changed: the carried-over value is the PREVIOUS machine. The applyBridge() call
        // that stood here was fed attrDetail() — ten nulls — so it corrected nothing;
        // what actually re-machines this profile is the ui:ready listener above, which
        // fires from dyn/boot.js still ahead of the page's first script.
        afpSetProfile(existing);
        return;
    }

    // ── Cold-start path (variant-4) ──────────────────────────────────
    // No profile carried over. Build the least-wrong early profile we can
    // from bridge data + neutral defaults that match the rest of the
    // extension (US / laptop_mid). Never use Tallinn/et-EE.
    function buildAndSetEarlyFromBridge(detail) {
        detail = detail || {};
        var locale = detail.locale || 'en-US';
        var langs = buildBootstrapLangs(locale);
        var earlyCc = 'US';
        try {
            var locParts = String(locale).split('-');
            if (locParts.length >= 2) earlyCc = locParts[locParts.length - 1].toUpperCase();
        } catch (eCc2) {}

        var ua = navigator.userAgent;
        try {
            // [FIX ua-reduction] major.0.0.0 — как у реального Chrome ≥110
            var m = ua.match(/Chrome\/(\d+)/);
            var cv = m ? m[1] : '151';
            ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + cv + '.0.0.0 Safari/537.36';
        } catch (e) {}
        var av = ua.indexOf('Mozilla/') === 0 ? ua.slice(8) : ua;

        // Hardware defaults aligned with AFP_DEFAULT_PROFILE + laptop_mid. Reached only
        // when nothing published a skeleton — with dyn/boot.js registered, every field
        // below is overwritten by the real selection before the page's first script.
        var screenW = 1920, screenH = 1080, cores = 8, memory = 8, platform = 'Win32';
        var profileId = 'laptop_mid';
        var dpr = 1, bluetooth = null;
        var glVendor = 'Google Inc. (Intel)';
        var glRenderer = 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)';
        var glParams = {}, glMaxAniso = 16;
        var gpuVendor = 'intel', gpuArch = '', gpuDevice = '', gpuDesc = '';
        var hostHw = false, hwAv1 = true;
        if (detail.profileData && typeof detail.profileData === 'object') {
            var pd = detail.profileData;
            hostHw = (pd.host === true);
            if (typeof pd.av1 === 'boolean') hwAv1 = pd.av1;
            if (pd.screenW) screenW = pd.screenW;
            if (pd.screenH) screenH = pd.screenH;
            if (pd.cores) cores = pd.cores;
            if (pd.memory) memory = pd.memory;
            if (pd.platform) platform = pd.platform;
            if (typeof pd.dpr === 'number' && pd.dpr > 0) dpr = pd.dpr;
            if (typeof pd.bluetooth === 'boolean') bluetooth = pd.bluetooth;
            if (pd.glVendor) glVendor = pd.glVendor;
            if (pd.glRenderer) glRenderer = pd.glRenderer;
            if (pd.glParams && typeof pd.glParams === 'object') glParams = pd.glParams;
            if (typeof pd.glMaxAniso === 'number') glMaxAniso = pd.glMaxAniso;
            if (pd.gpuVendor) gpuVendor = pd.gpuVendor;
            if (typeof pd.gpuArch === 'string') gpuArch = pd.gpuArch;
            if (typeof pd.gpuDevice === 'string') gpuDevice = pd.gpuDevice;
            if (typeof pd.gpuDesc === 'string') gpuDesc = pd.gpuDesc;
        }
        if (detail.profileId) profileId = detail.profileId;
        if (Array.isArray(detail.languages) && detail.languages.length > 0) {
            langs = detail.languages.slice();
        }
        if (detail.countryCode) earlyCc = String(detail.countryCode).toUpperCase();

        var isDesktopStub = String(profileId).indexOf('pc_') === 0;

        var earlyProfile = {
            // Mark so later full inject knows this was a bootstrap
            bootstrap: true,
            // colorDepth 24 — see the note in background.js buildProfile.
            screenWidth: screenW, screenHeight: screenH, colorDepth: 24, devicePixelRatio: dpr,
            platform: platform, hwConcurrency: cores, deviceMemory: memory,
            webdriver: false, vendor: 'Google Inc.',
            language: locale, languages: langs, locale: locale,
            countryCode: earlyCc,
            doNotTrack: null, maxTouchPoints: 0, pdfViewerEnabled: true,
            // [FIX early-bluetooth] laptop_mid has Bluetooth. Desktop pc_* will
            // be corrected by injectProfile (~300ms) via hasBluetooth:false.
            hasBluetooth: (bluetooth === null) ? (String(profileId).indexOf('pc_') !== 0) : bluetooth,
            timezone: detail.timezone || 'America/New_York',
            userAgent: ua,
            appVersion: av,
            webglVendor: glVendor,
            webglRenderer: glRenderer,
            clientHints: {
                platform: 'Windows', mobile: false, platformVersion: '10.0.0',
                architecture: 'x86', bitness: '64', wow64: false, model: '',
                formFactors: ['Desktop']
            },
            mediaDevices: [
                { kind: 'audioinput', label: '', deviceId: 'default-a', groupId: 'default-0' },
                { kind: 'audiooutput', label: '', deviceId: 'default-o', groupId: 'default-0' },
                { kind: 'videoinput', label: '', deviceId: 'default-v', groupId: 'default-0' }
            ],
            // [FIX cold-start-machine-remainder] These four were `[]` / `{}` / absent, and
            // sessionStorage is what used to hide it: a reload found last load's full
            // profile and nobody noticed the skeleton was a skeleton. With the profile in
            // a closure there is no such carry-over, so every load is the cold one, and
            // whatever is missing here is missing until background.js injects ~300ms in.
            //
            // Unlike the machine fields above, none of these vary with the selection —
            // one Windows font list, one PDF-viewer plugin set, one connection shape for
            // every profile and every country — so they are written out here rather than
            // generated into dyn/. That also means they survive the one gap dyn/ has:
            // a browser restart re-installs an unpacked extension, which clears dynamic
            // registrations, and for that moment dyn/boot.js does not run at all.
            // test/parity-static.mjs fails if any of them drifts from buildProfile().
            allowedFonts: WIN_FONTS,
            plugins: PDF_PLUGINS,
            mimeTypes: PDF_MIME_TYPES,
            connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
            webglParams: glParams,
            webglMaxAnisotropy: glMaxAniso,
            webgpuVendor: gpuVendor,
            webgpuArchitecture: gpuArch,
            webgpuDevice: gpuDevice,
            webgpuDescription: gpuDesc,
            // [FIX host-mode] / [FIX decoder-answered-for-the-host-gpu] — see applyBridge.
            hostHw: hostHw,
            hwAv1Decode: hwAv1,
            mode: detail.mode || 'normal',
            profileId: profileId,
            // [FIX device-state-was-per-domain] Literals, for the one window where nothing
            // has published a device state yet: this file runs before dyn/boot.js and long
            // before the inject. They are laptop_mid-shaped and match what afpDeviceState
            // produces for a charging laptop, so the cold start is coherent on its own;
            // dyn/boot.js overwrites all seven with the install's real values, still ahead
            // of the page's first script. Nothing seed-derived can be computed here — this
            // file never sees the master. The desktop rule is the same one hasBluetooth
            // above uses, so a pc_* cold start does not show a laptop battery next to
            // "no Bluetooth adapter".
            batteryLevel: isDesktopStub ? 1 : 0.82,
            batteryCharging: true,
            batteryChargingTime: isDesktopStub ? 0 : 2620,
            batteryDischargingTime: null,
            geoOffsetLat: 0,
            geoOffsetLon: 0,
            geoAccuracy: 65
        };
        if (detail.features && typeof detail.features === 'object') {
            earlyProfile.features = detail.features;
        }
        if (Array.isArray(detail.speechVoices) && detail.speechVoices.length > 0) {
            earlyProfile.speechVoices = detail.speechVoices;
        }
        if (detail.platformVersion) {
            earlyProfile.clientHints.platformVersion = detail.platformVersion;
        }
        if (typeof detail.noiseSeed === 'number' && isFinite(detail.noiseSeed)) {
            earlyProfile.noiseSeed = detail.noiseSeed >>> 0;
        }
        // [FIX only-boot-js-could-send-the-device-state] This builder applied
        // platformVersion and noiseSeed out of the detail and silently dropped
        // deviceState, while applyBridge — the other consumer of the SAME detail — copies
        // all seven. So on the cold path the literals a few lines up stood even when the
        // producer had sent real values. Same guard-per-field shape as applyBridge, so a
        // partial object cannot blank out what is already there.
        if (detail.deviceState && typeof detail.deviceState === 'object') {
            var eds = detail.deviceState;
            if (typeof eds.batteryLevel === 'number') earlyProfile.batteryLevel = eds.batteryLevel;
            if (typeof eds.batteryCharging === 'boolean') earlyProfile.batteryCharging = eds.batteryCharging;
            if (eds.batteryChargingTime !== undefined) earlyProfile.batteryChargingTime = eds.batteryChargingTime;
            if (eds.batteryDischargingTime !== undefined) earlyProfile.batteryDischargingTime = eds.batteryDischargingTime;
            if (typeof eds.geoOffsetLat === 'number') earlyProfile.geoOffsetLat = eds.geoOffsetLat;
            if (typeof eds.geoOffsetLon === 'number') earlyProfile.geoOffsetLon = eds.geoOffsetLon;
            if (typeof eds.geoAccuracy === 'number') earlyProfile.geoAccuracy = eds.geoAccuracy;
        }
        afpSetProfile(earlyProfile);
    }

    // Nothing is published before we run: this file is the FIRST of the MAIN-world
    // manifest scripts, and dyn/boot.js — the only synchronous carrier of the selection —
    // is a dynamically registered script, so it runs after all of them (measured; see the
    // header of dyn/boot.js). So a neutral stub goes in now, early scripts never see a
    // half-built machine, and the ui:ready dyn/boot.js dispatches corrects it — still
    // ahead of the page's own scripts, which is what the async storage-bridge path could
    // not do. The argument used to be attrDetail(), which by then was ten nulls.
    buildAndSetEarlyFromBridge({});
})();
