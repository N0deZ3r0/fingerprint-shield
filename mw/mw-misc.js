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
    // [FIX a-switch-off-its-default-was-inert-on-the-first-load] see the clientRects gate
    // below, and _featNow in mw-core.js for what these two mean.
    var _featKnown = !!(MW && MW.featKnown);
    var _featNow = (MW && MW.featNow) ? MW.featNow : function (n) { return !!(_FEAT && _FEAT[n]); };
    // [FIX host-mode] matchMedia and the font allowlist ask this at effect time; battery
    // and the network go quiet through _featNow. See mw-core.
    var _hostHwNow = (MW && MW.hostHwNow) ? MW.hostHwNow : function () { return false; };
    // Same shape as _noiseOff in mw-canvas-audio.js, and for the same reason: _STEALTH is
    // settled as mw-core loads and is false on a tab's first load.
    function _stealthNow() {
        try { return !!(MW && MW.stealthNow && MW.stealthNow()); } catch (e) { return _STEALTH; }
    }

    // [FIX afp-own-marker-leak] Раньше «прототип уже пропатчен» помечалось как
    // proto._tzFixed = true ПРЯМО на FontFaceSet.prototype — перечислимое
    // own-свойство на нативном прототипе, которое видно странице через
    // Object.keys(FontFaceSet.prototype) и которого у чистого браузера нет
    // (плюс имя _tzFixed — рудимент от прежнего tz-patch.js). WeakSet даёт тот
    // же однократный guard, ничего не добавляя к самому объекту.
    var _fontProtoPatched = new WeakSet();

    // ===== PERMISSIONS =====
    // [FIX geo-perm-desync] Если модуль geolocation включён, для name=geolocation
    // отдаём 'granted': иначе сайт видит prompt + мгновенный success без всякого UI.
    //
    // [FIX permissions-query-replaced-implementation] Раньше query подменялась
    // ЦЕЛИКОМ и никогда не звала нативную — со двумя следствиями, замеренными
    // против чистого realm:
    //  1) ПРОГЛОЧЕННЫЕ НАТИВНЫЕ ОТКАЗЫ. Нативный query валидирует дескриптор и
    //     отклоняет промис, а мы резолвили всегда:
    //       query({name:'totally-bogus'}) → чистый REJECTED TypeError, мы RESOLVED
    //       query({}) / query() / query(null) / query('geolocation') → то же
    //       query({name:'push'}) без userVisibleOnly → чистый REJECTED DOMException
    //     То есть любое неподдерживаемое разрешение выглядело поддержанным — тот
    //     же класс, что проглоченный DOMException у fonts.check.
    //  2) НЕВЕРНЫЙ ТИП ОБЪЕКТА. Возвращался литерал, а не PermissionStatus:
    //     JSON.stringify у нативного даёт '{}' (все свойства на прототипе), у нас —
    //     '{"state":...}', и instanceof PermissionStatus не проходил. Тот же класс,
    //     что был у TextMetrics.
    // Теперь нативный query не трогаем вообще — вся валидация и тип объекта его.
    // Подменяется только геттер state на PermissionStatus.prototype, по тому же
    // приёму, что и для TextMetrics: имя разрешения берётся у самого объекта.
    // [FIX ungated-patch] Раньше секция управлялась только скрытым режимом (или
    // вообще ничем), из-за чего снятие галок в настройках её не отключало.
    // Переопределяется ТОЛЬКО состояние geolocation — значит флаг geolocation.
    if (!_FEAT.geolocation) { /* disabled in options */ } else
if (!_STEALTH)     (function() {
        try {
            if (typeof PermissionStatus === 'undefined' || !PermissionStatus.prototype) return;
            var _psProto = PermissionStatus.prototype;
            var _sd = Object.getOwnPropertyDescriptor(_psProto, 'state');
            if (!_sd || typeof _sd.get !== 'function') return;
            var _origState = _sd.get;
            // [FIX geolocation-ignored-permissions-policy] Two conditions were missing, and
            // both produced a pair no browser gives.
            //
            // 1. The Permissions-Policy. On a document served `geolocation=()`, or in the
            //    ordinary case of a cross-origin iframe embedded without
            //    allow="geolocation", the feature is off — a clean browser reports
            //    state 'denied' there. Claiming 'granted' beside
            //    document.featurePolicy.allowsFeature('geolocation') === false is a
            //    one-line contradiction, and it was measured against a clean browser on the
            //    same machine (see the note in mw/mw-geo.js, which now declines to patch
            //    such a document at all).
            // 2. A real refusal. When the USER has blocked location for this origin the
            //    native state is 'denied', and overriding that to 'granted' overrides the
            //    user rather than a fingerprinter. It also disabled the only check
            //    mw/mw-geo.js can make: that module asks navigator.permissions before
            //    answering, and while this getter lied for every state the answer was
            //    always 'granted' and the branch was dead.
            //
            // 'prompt' still reads as 'granted', which is the case this override exists
            // for — the page would otherwise see 'prompt' next to a position delivered with
            // no UI. Only a genuine refusal is passed through.
            var _geoPolicyAllows = (function () {
                try {
                    var fp = document.featurePolicy || document.permissionsPolicy;
                    if (fp && typeof fp.allowsFeature === 'function') return !!fp.allowsFeature('geolocation');
                } catch (e) {}
                return true;
            })();
            Object.defineProperty(_psProto, 'state', {
                get: _mn(function state() {
                    var real;
                    try { real = _origState.call(this); } catch (eR) { return _origState.call(this); }
                    try {
                        if (this.name === 'geolocation' && _FEAT && _FEAT.geolocation !== false &&
                            _geoPolicyAllows && real !== 'denied') {
                            return 'granted';
                        }
                    } catch (e) {}
                    return real;
                }, true),
                enumerable: _sd.enumerable,
                configurable: true
            });
        } catch(_) {}
    })();

    // ===== MEDIA DEVICES =====
    // [FIX anon-fn-name] Анонимная function не получает выведенное имя при
    // присваивании в свойство объекта, поэтому fn.name был '' — _mn строит
    // fake-toString из fn.name и отдавал 'function () { [native code] }'.
    // У НАСТОЯЩЕЙ нативной функции имя есть всегда, пустое имя само по себе
    // аномалия. Тот же класс бага, что уже задокументирован для toDataURL
    // в mw-canvas-audio.js.
    // [FIX ungated-patch] Раньше секция управлялась только скрытым режимом (или
    // вообще ничем), из-за чего снятие галок в настройках её не отключало.
    if (!_FEAT.navigator) { /* disabled in options */ } else
// [FIX enumerate-devices-swallowed-the-brand-check] The wrapper ended in
// `.catch(function () { return ID.mediaDevices || []; })`, which caught EVERY rejection —
// including the one the platform raises for a foreign receiver. Measured on a real Chrome
// 152 against a clean one, the same single line of page script:
//
//   MediaDevices.prototype.enumerateDevices.call({})
//     clean  REJECTED TypeError: Failed to execute 'enumerateDevices' on 'MediaDevices':
//            Illegal invocation
//     ours   RESOLVED with a device list
//
// That is the same trade [FIX ...] rejected at _wgParam in mw/mw-navigator.js, word for
// word: swallowing a brand-check failure and answering from the table turns a tampering
// probe into a POSITIVE result. A probe that gets an answer where the browser refuses to
// give one has learned more than any device list could have told it.
//
// The catch is gone rather than narrowed. A clean browser has no fallback here either — it
// rejects, and so do we now — and the rejection's frames are cleaned by _mn's apply trap,
// see [FIX stack-strip-only-covered-the-synchronous-throw] in mw/mw-core.js.
//
// Consequence worth naming: `mediaDevices` in the profile (background.js) is now read by
// nobody. It never reached the success path — that one maps the REAL list and blanks the
// labels — so the list was only ever a failure fallback. Substituting devices on the
// success path is NOT the fix for that: enumerateDevices without permission reports one
// entry per KIND present, and claiming a camera the machine does not have is refutable by
// one getUserMedia call.
if (!_STEALTH)     (function() { try { var md = navigator.mediaDevices; if (!md || !md.enumerateDevices) return; /* [FIX instance-own-property-lies] on the prototype, not the instance */ var mdProto = Object.getPrototypeOf(md); var orig = mdProto.enumerateDevices; Object.defineProperty(mdProto, 'enumerateDevices', { writable: true, configurable: true, enumerable: true, value: _mn(function enumerateDevices() { return orig.call(this).then(function(r) { return r.map(function(d) { return { deviceId: d.deviceId, kind: d.kind, label: '', groupId: d.groupId }; }); }); }) }); } catch(_) {} })();

    if (!_FEAT.fonts) { /* fonts skip */ } else
    // ===== FONTS =====
if (!_STEALTH)     (function() {
        try {
            var sf = {};
            _BASE_FONTS.forEach(function(f) { sf[f] = true; });
            var pf = ID.allowedFonts || [];
            for (var i = 0; i < pf.length; i++) sf[pf[i].toLowerCase()] = true;

            // The `font` shorthand's leading size/weight/style run. One copy, used both to
            // find the family list for parseFamilies and to rebuild the value when the
            // inline-style filter below rewrites it.
            var _FONT_PREFIX = /^\s*(?:(?:normal|bold|italic|oblique|small-caps|[0-9]+(?:\.[0-9]+)?(?:px|em|rem|pt|%|vw|vh)|[0-9]+)\s+)+/;
            function parseFamilies(font) {
                if (!font) return [];
                var body = String(font).replace(_FONT_PREFIX, '');
                return body.split(',').map(function(s) {
                    return s.trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase();
                }).filter(Boolean);
            }

            // [FIX generic-family-lists-diverged] Three copies of "which family names are
            // CSS generics, not installed fonts" existed and no two agreed: this one had
            // fangsong but was missing ui-serif / ui-sans-serif / ui-monospace, while
            // mw-canvas-audio.js (_generics) and the worker shim (_gen in mw-workers.js)
            // had the ui-* trio but no fangsong. A generic that a list does not recognise
            // is treated as an unknown installed family and gets BLOCKED, so
            // document.fonts.load('12px ui-monospace') took the blocked path here while
            // measureText treated the very same string as a generic — two answers about
            // one family name, from one document. All three lists now carry the full
            // CSS Fonts 4 set; test/parity-static.mjs asserts they stay identical.
            var _sfG = { serif:1,'sans-serif':1,monospace:1,cursive:1,fantasy:1,
                'system-ui':1,'ui-serif':1,'ui-sans-serif':1,'ui-monospace':1,'ui-rounded':1,
                math:1,emoji:1,fangsong:1 };
            function isBlocked(fams) {
                // [FIX host-mode] The machine's fonts are the machine's.
                if (_hostHwNow()) return false;
                return fams.length > 0 && fams.some(function(f) { return !_sfG[f] && !sf[f]; });
            }

            // ===== DOM FONT ENUMERATION =====
            // [FIX dom-font-enumeration-contradicted-canvas] measureText below collapses a
            // family outside the allowlist to the fallback. DOM LAYOUT did not, so one page
            // got two answers to one question. Measured at 72px on the same string:
            //
            //                canvas (with extension)     DOM offsetWidth
            //   Arial          1059.74 (passes through)     1060
            //   Agency FB       870.90 = fallback            730   <- "absent", then "present"
            //   MS Outlook      870.90 = fallback            956
            //
            // amiunique.org enumerates fonts purely by layout — its scripts use offsetWidth /
            // offsetHeight / getBoundingClientRect and never touch measureText or
            // document.fonts — and listed all 167 installed families, identical with the
            // extension and without. A clean browser never disagrees with itself like that,
            // and that disagreement is far cheaper to detect than the font list is to collect.
            //
            // Filtering at the CSS layer was tried first and does not work: measured,
            // `fontFamily` is an OWN accessor of each style object, not a property of
            // CSSStyleDeclaration.prototype, so a prototype patch intercepts nothing and a
            // per-instance one would be the own-property lie this codebase keeps removing.
            // So the interception is on the READ instead — offsetWidth/offsetHeight do live
            // on HTMLElement.prototype, where a real browser has them.
            //
            // Fast path first: only elements whose OWN inline style names a font are
            // considered, which is one cheap property read and no getComputedStyle. That is
            // also how every font prober works — it creates a throwaway span and sets the
            // family on it — so the slow path runs for them and essentially never for a real
            // page's layout code.
            // The native iteration is captured HERE, before the document.fonts patches
            // further down replace entries/[Symbol.iterator] — those filter blocked
            // families out, so asking the patched set "is this a web font?" could only ever
            // answer no, and the exemption would never fire. Measured: the assertion for it
            // failed until this reference was taken from the untouched object.
            var _natFontsForEach = null;
            try { _natFontsForEach = document.fonts && document.fonts.forEach; } catch (eFF) {}
            function _isWebFont(fam) {
                try {
                    if (typeof _natFontsForEach !== 'function') return false;
                    var found = false;
                    _natFontsForEach.call(document.fonts, function (ff) {
                        if (found) return;
                        if (String(ff.family || '').replace(/^['"]|['"]$/g, '').toLowerCase() === fam) found = true;
                    });
                    return found;
                } catch (e) { return false; }
            }
            // The value with blocked families dropped, or null when nothing would change.
            // A family registered through @font-face is not local and must survive, or a
            // site's icon font turns into boxes.
            function _filteredFamily(value) {
                // [FIX host-mode] The machine's fonts are the machine's — the DOM path too,
                // or layout would collapse a family that canvas measures natively.
                if (_hostHwNow()) return null;
                var parts = String(value || '').split(',');
                var kept = [], dropped = false;
                for (var i = 0; i < parts.length; i++) {
                    var name = parts[i].trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase();
                    if (!name) continue;
                    if (_sfG[name] || sf[name] || _isWebFont(name)) kept.push(parts[i].trim());
                    else dropped = true;
                }
                if (!dropped) return null;
                return kept.length ? kept.join(', ') : 'sans-serif';
            }
            // Re-entrancy: the native read below happens while our substitution is in place,
            // and layout code inside it may read another element.
            var _fontMeasuring = false;
            // Swaps the element's own inline font-family for the filtered one, takes the
            // native measurement, and puts the declaration back exactly as it was — same
            // property, same priority, removed again if it was not there. The element is the
            // real one on purpose: a clone would inherit a different context and measure
            // differently, which is how this kind of patch usually introduces a new tell.
            function _readAsIfMissing(el, nativeRead) {
                if (_fontMeasuring) return null;
                var st, cur;
                try {
                    st = el.style;
                    if (!st) return null;
                    cur = st.getPropertyValue('font-family');
                } catch (e) { return null; }
                if (!cur) return null;
                var filtered = _filteredFamily(cur);
                if (filtered === null) return null;
                var prio = '';
                try { prio = st.getPropertyPriority('font-family'); } catch (e) {}
                _fontMeasuring = true;
                try {
                    st.setProperty('font-family', filtered, prio);
                    return { value: nativeRead() };
                } catch (e) {
                    return null;
                } finally {
                    try {
                        if (cur) st.setProperty('font-family', cur, prio);
                        else st.removeProperty('font-family');
                    } catch (e) {}
                    _fontMeasuring = false;
                }
            }
            try {
                ['offsetWidth', 'offsetHeight'].forEach(function (key) {
                    var d = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, key);
                    if (!d || typeof d.get !== 'function') return;
                    var nat = d.get;
                    var g = ({ [key]: function () {
                        var el = this;
                        var r = _readAsIfMissing(el, function () { return nat.call(el); });
                        return r ? r.value : nat.call(el);
                    } })[key];
                    Object.defineProperty(window.HTMLElement.prototype, key, {
                        get: _mn(g, true), set: d.set,
                        enumerable: d.enumerable, configurable: d.configurable
                    });
                });
                // The same question through the other API. Wrapped here rather than in the
                // clientRects section because this is the fonts flag, not that one; that
                // section wraps whatever it finds, so the two compose in either order.
                var _origGBCRFont = Element.prototype.getBoundingClientRect;
                Element.prototype.getBoundingClientRect = _mn(function getBoundingClientRect() {
                    var el = this;
                    var r = _readAsIfMissing(el, function () { return _origGBCRFont.call(el); });
                    return r ? r.value : _origGBCRFont.call(el);
                });
                var _origGCRFont = Element.prototype.getClientRects;
                if (typeof _origGCRFont === 'function') {
                    Element.prototype.getClientRects = _mn(function getClientRects() {
                        var el = this;
                        var r = _readAsIfMissing(el, function () { return _origGCRFont.call(el); });
                        return r ? r.value : _origGCRFont.call(el);
                    });
                }
            } catch (eDomFonts) {}


            // Патчим прямо на инстансе document.fonts — надёжнее чем прототип
            // (Chrome может блокировать модификацию FontFaceSet.prototype)
            var _inst = document.fonts;
            if (!_inst) return;

            var _origLoad  = _inst.load.bind(_inst);
            var _origCheck = _inst.check.bind(_inst);

            // [FIX fonts-check-swallowed-native-DOMException] Раньше обе функции
            // сначала звали parseFamilies и, если результат считался заблокированным,
            // возвращали false / пустой Promise, НЕ обращаясь к нативной реализации.
            // Проблема: нативный FontFaceSet.check бросает DOMException
            // («Could not resolve property value») на строке, которая не парсится как
            // CSS font shorthand, а parseFamilies на таком мусоре отдаёт его же
            // единственной «семьёй» — она, естественно, не generic и не в allowedFonts,
            // то есть мусор классифицировался как заблокированный шрифт, и мы отдавали
            // false ВМЕСТО исключения. Замер против чистого realm:
            //   check('!!!') / check('bold') / check(42)
            //   чистый браузер → THREW DOMException,  мы → OK false
            // То есть мы делали работающим то, что браузер не умеет — самый громкий
            // класс расхождения. Похоже, именно по этому исключению CreepJS и решает,
            // что поле недоступно (у него на чистом браузере font B = unsupported, а с
            // нами = Windows).
            // Теперь нативная реализация вызывается ПЕРВОЙ: неразбираемый ввод даёт
            // ровно нативное исключение, и только для корректно разобранного, но
            // заблокированного шрифта мы подменяем результат.
            // [FIX fontfaceset-load-arity] Declared as (font, text), so fn.length was 2
            // while the native FontFaceSet.prototype.load reports 1 — `text` is optional
            // per WebIDL, and .length counts only the parameters before the first
            // optional one. dev-vsnative.html compares every patched API against a
            // pristine iframe realm and this was the single mismatch it found. Exactly
            // the same defect already fixed for toDataURL, toBlob and getContext in
            // mw-canvas-audio.js; a default value fixes the arity without changing
            // behaviour, since passing undefined makes WebIDL apply the default anyway.
            var _loadFn = _mn(function load(font, text = undefined) {
                // _origCheck здесь — валидатор синтаксиса: на мусоре он бросит то же,
                // что бросил бы нативный load, и мы просто отдаём управление нативу.
                var fams;
                try { _origCheck(font, text); fams = parseFamilies(font); }
                catch (eSyntax) { return _origLoad(font, text); }
                return isBlocked(fams) ? Promise.resolve([]) : _origLoad(font, text);
            });
            // [FIX check-was-a-font-oracle] Здесь check подменялся так: нативный
            // результат, но false для семьи вне allowedFonts. Замер против чистого
            // realm (dev-fontcheck.html) показал, чего это стоит:
            //   document.fonts.check('12px "<family>"') в ЧИСТОМ Chrome отдаёт true
            //   ДЛЯ ЛЮБОЙ строки, которая парсится, — включая выдуманную
            //   'ZZZ Not A Font 12345'. То есть check() в Chrome не различает
            //   установленные и отсутствующие шрифты и как средство их перечисления
            //   бесполезен: 17 из 17 проб → true.
            // Наш вариант отдавал true/false и тем самым ДАВАЛ детектору рабочий
            // перечислитель шрифтов, которого нет ни в одном настоящем Chrome (12 из
            // 17 проб расходились). Это ровно класс «мы делаем работающим то, что
            // браузер не умеет» — и он объясняет замер CreepJS: поле font B на чистом
            // браузере и во ВСЕХ воркерах = unsupported, а у нас в окне = Windows,
            // потому что оракул возвращал true как раз на Segoe UI из allowedFonts —
            // шрифт, эксклюзивный для Windows. document.fonts существует только в
            // окне, поэтому воркеры оставались чистыми и хеш окна расходился с ними.
            // Блокировать через check нечего: перечислить шрифты им и так нельзя.
            // Оставляем нативный check. Блокировка шрифтов остаётся там, где она
            // реально работает, — measureText/fillText и load ниже.
            // _origCheck по-прежнему нужен _loadFn как валидатор синтаксиса.

            // 1. Инстанс — перекрывает прототип, работает даже если прототип sealed
            function setInst(name, fn) {
                try { Object.defineProperty(_inst, name, { value: fn, writable: true, configurable: true }); return true; } catch(e) {}
                try { _inst[name] = fn; return (_inst[name] === fn); } catch(e) {}
                return false;
            }
            // [CLEANUP] Результаты присваивались в loadSet/checkSet и никогда не
            // читались. Прототип-слой ниже применяется безусловно (он «дополнительный,
            // не обязательный»), то есть ветвления по успеху инстанс-патча и не было —
            // возвращаемое значение setInst нигде не влияло на поведение.
            // 2. Прототип как дополнительный слой (не обязательный)
            var proto = (typeof FontFaceSet !== 'undefined' && FontFaceSet.prototype)
                     || Object.getPrototypeOf(_inst);
            if (proto && !_fontProtoPatched.has(proto)) {
                try { Object.defineProperty(proto, 'load',  { value: _loadFn,  writable: true, configurable: true }); } catch(e) {}
            }

            // [FIX instance-own-property-lies] setInst put 'load' on document.fonts
            // itself. Native FontFaceSet instances have no own properties at all, and the
            // prototype layer below already covers every read, so the instance copy is
            // gone. Same for the iteration stubs further down.
            void setInst;


            // Итерация — блокируем перечисление через JS (CSS @font-face не затрагивается)
            var _emptyIter = function() { return { next: function() { return { done: true, value: undefined }; } }; };
            // [FIX anon-fn-name] Раньше все 5 заглушек были анонимными → fn.name '',
            // и _mn выдавал 'function () { [native code] }' на forEach/keys/values/
            // entries/[Symbol.iterator] у document.fonts. Имя берём вычисляемым
            // ключом объекта (единственный способ задать имя динамически).
            var _fsTarget = proto || _inst;
            // [FIX the-iteration-stubs-reported-no-parameters] The note above fixed the NAME
            // and stopped there. Native FontFaceSet.prototype.forEach reports .length 1 (the
            // callback is required, thisArg is not) and this stub reported 0 — measured, and
            // NOT in dev-vsnative.html's hand-written list, which checks size/check/load on
            // this very interface and never forEach. The arity is copied from whatever the
            // platform reports rather than written as a constant: keys/values/entries are 0
            // in both today, and a browser that changes one of them should not need an edit
            // here to stay matched.
            ['forEach','keys','values','entries'].forEach(function(m) {
                var stub = ({ [m]: function() { return m === 'forEach' ? undefined : _emptyIter(); } })[m];
                try {
                    var natFn = _fsTarget[m];
                    if (typeof natFn === 'function') {
                        Object.defineProperty(stub, 'length', { value: natFn.length, configurable: true });
                    }
                } catch (eLen) {}
                try { Object.defineProperty(_fsTarget, m, { value: _mn(stub), writable: true, configurable: true }); } catch(e) {}
            });
            // [Symbol.iterator] у setlike-интерфейсов — это тот же values()
            try { Object.defineProperty(_fsTarget, Symbol.iterator, { value: _mn(function values() { return _emptyIter(); }), writable: true, configurable: true }); } catch(e) {}
            try { Object.defineProperty(_fsTarget, 'size', { get: _mn(function size() { return 0; }, true), configurable: true }); } catch(e) {}

            if (proto) _fontProtoPatched.add(proto);
        } catch(e) {}
    })();

    // [FIX ungated-patch] matchMedia не имел условия вообще, хотя подменяет
    // разрешение/DPR/цветовой профиль дисплея — это флаг screen.
    if (!_FEAT.screen) { /* disabled in options */ } else
    // ===== MATCHMEDIA =====
    // Покрываем hardware-specific queries: color-gamut, dynamic-range, hover, pointer,
    // inverted-colors, forced-colors, update — раскрывают характеристики дисплея/оборудования.
    // Профиль: Win32 desktop, стандартный sRGB монитор без HDR, мышь, без touch.
// matchMedia всегда: иначе devicePixelRatio=1, а resolution остаётся ~1.5
    (function() {
        try {
            // [FIX matchmedia-returned-an-object-literal] window.matchMedia used to be
            // replaced wholesale, and for every query it recognised it returned a
            // hand-built literal (_fml) instead of a MediaQueryList. Measured against a
            // clean realm (dev-objecttypes.html):
            //   matchMedia('(hover: hover)') instanceof MediaQueryList   false  (native true)
            //   Object.getOwnPropertyNames(mql).length                   8      (native 0)
            //   JSON.stringify(mql)  {"matches":true,"media":"...","onchange":null}  (native {})
            //   Object.prototype.toString.call(mql)  [object Object]  (native [object MediaQueryList])
            //   mql instanceof EventTarget                              false  (native true)
            // That is the same defect already found and fixed for TextMetrics,
            // PermissionStatus, BatteryManager and PluginArray, just missed here — and it
            // announces tampering far louder than the display traits it was hiding.
            // The literal is gone. window.matchMedia is left NATIVE (which also drops an
            // own property from window that a clean browser does not have), and the
            // spoofing moves onto MediaQueryList.prototype.matches — the same
            // patch-the-prototype-accessor approach _def uses for navigator and screen.
            // Every object handed to the page is now a real MediaQueryList: right
            // prototype, no own properties, working addEventListener, and the substituted
            // answer still applied.
            // [FIX forced-colors-answered-false-to-every-value] and the _mqSupported table it
            // introduced are both GONE, along with the accessibility forcing they served - see
            // the Accessibility note in _decide below for why that forcing went.
            //
            // The lesson it carried is kept, because it is what makes _mqUsable below look the
            // way it does: a feature the PARSER knows is not a feature the ENGINE answers.
            // Chromium parses inverted-colors and then says false to every value, "none"
            // included, so a blanket "force the default" answered 01 where a clean browser
            // answers 00 - one impossible pair traded for a crowd signal.

            // [FIX video-dynamic-range-claimed-a-feature-the-engine-does-not-have]
            //
            // `.media !== 'not all'` above answers "does the PARSER know this feature", and
            // the inverted-colors note already records that this is not the same question as
            // "does the engine ANSWER it" — Chromium parses inverted-colors and then says
            // false to every value including 'none'. video-dynamic-range is the same shape,
            // and it was being forced unconditionally, so we answered true where the engine
            // answers false.
            //
            // Measured, clean Chromium vs this build, asking every feature twice — once
            // through a CSS @media rule and once through matchMedia:
            //
            //   clean   0 disagreements out of 54
            //   ours    (video-dynamic-range: standard)   css=false   matchMedia=true
            //
            // A real browser CANNOT disagree with itself here: @media and matchMedia are the
            // same engine answering the same question. So a divergence is not a wrong value,
            // it is a positive signature that something is patching the JS side — and it
            // needs no baseline knowledge to read, which makes it worse than the trait it
            // was hiding.
            //
            // The usable test is behavioural, not syntactic: a feature the engine really
            // supports answers true to exactly one of its values. Nothing is forced when it
            // answers false to all of them.
            //
            // This runs BEFORE the MediaQueryList.prototype.matches patch below is
            // installed, so these reads are the native ones.
            function _mqUsable(values) {
                try {
                    var trues = 0;
                    for (var i = 0; i < values.length; i++) {
                        if (window.matchMedia(values[i]).matches) trues++;
                    }
                    return trues === 1;
                } catch (e) { return false; }
            }
            var _vdrUsable = _mqUsable(['(video-dynamic-range: standard)', '(video-dynamic-range: high)']);
            var _drUsable = _mqUsable(['(dynamic-range: standard)', '(dynamic-range: high)']);

            // _decide returns true/false to force an answer, or undefined to let the real
            // media query stand.
            function _decide(ql) {

                // ── Display capability ──
                // [FIX color-gamut-was-forced-against-an-engine-we-cannot-reach]
                // color-gamut is NOT forced, deliberately. It used to answer srgb=true, p3=false
                // and rec2020=false unconditionally: the truth on an sRGB panel, and a
                // self-contradiction on any wider one.
                //
                // Measured with the panel emulated at ENGINE level (CDP
                // Emulation.setEmulatedMedia, so the CSS side moves with it), running
                // dev-mediaparity.html, the page that asks every feature twice:
                //
                //   panel      clean Chromium    this build, before
                //   sRGB       0 disagreements   0   <- why the suite was green on this rig
                //   P3         0 disagreements   1   (color-gamut: p3)     css=true mm=false
                //   rec2020    0 disagreements   2   + (color-gamut: rec2020)
                //
                // The force bought NOTHING even where it "worked". @media is answered by the
                // engine, an extension cannot reach the engine, and three lines of CSS plus
                // getComputedStyle read the real panel whether or not matchMedia is patched. So
                // on a wide-gamut display the old branch did not hide the gamut: it published
                // the gamut through CSS anyway AND added a contradiction, which reads as
                // "patched browser" with no baseline knowledge of the visitor.
                //
                // The only way to answer srgb on BOTH sides is to emulate the display in the
                // engine (chrome.debugger + Emulation.setEmulatedMedia). That paints a "being
                // debugged" infobar on every tab, so it is not available to a shipping extension.
                //
                // The panel colour space therefore stays visible. test/hostleak.mjs already names
                // it among the host carriers (css.gamut) - honestly now, where the force used to
                // make that readout look clean while CSS carried the value. test/mediadisplay.mjs
                // holds this by re-running the parity page on panels this machine does not have.
                // [FIX video-dynamic-range-was-caught-by-the-dynamic-range-branch] These two
                // must be tested in THIS order, and the second one must exclude the first.
                // 'video-dynamic-range' CONTAINS the substring 'dynamic-range', so the plain
                // branch matched both and answered first — the dedicated video branch that
                // used to sit below it was dead code from the day it was written, and the
                // plain branch was forcing a feature this engine does not answer at all.
                //
                // Both are now gated on the engine actually answering the feature. The test
                // is behavioural, not syntactic: a supported feature answers true to exactly
                // one of its values. See _mqUsable above for why `.media !== 'not all'` is
                // not enough — Chromium parses inverted-colors and then says false to every
                // value, and video-dynamic-range is the same shape here.
                //
                // Measured, every feature asked twice — once as a CSS @media rule, once
                // through matchMedia: clean Chromium disagrees with itself 0 times out of 54;
                // this build disagreed on (video-dynamic-range: standard), css=false against
                // matchMedia=true. @media and matchMedia are one engine answering one
                // question, so a divergence is not a wrong value — it is a signature, and it
                // reads without any baseline knowledge.
                if (ql.indexOf('video-dynamic-range') !== -1) {
                    if (!_vdrUsable) return undefined;
                    if (ql.indexOf('high') !== -1) return false;
                    if (ql.indexOf('standard') !== -1) return true;
                }
                if (ql.indexOf('dynamic-range') !== -1) {
                    if (!_drUsable) return undefined;
                    // Нет HDR: standard=yes, high=no
                    if (ql.indexOf('high') !== -1) return false;
                    if (ql.indexOf('standard') !== -1) return true;
                }

                // ── Accessibility ──
                // [FIX accessibility-prefs-were-forced-onto-the-user] NOTHING here is forced any
                // more. prefers-reduced-motion, prefers-contrast, forced-colors and
                // prefers-reduced-transparency all pass through to the engine.
                //
                // They used to be forced to the common answer on the cohort argument: a user who
                // has reduced-motion on sits in a small, identifying group, and the Fingerprint Pro
                // agent reads all four through matchMedia as its own probes. Two findings settled
                // it the other way.
                //
                // 1. It did not hide them. @media is answered by the engine, which no extension can
                //    reach, so three lines of CSS plus getComputedStyle read the real setting
                //    whatever matchMedia says. Measured with the preference emulated at ENGINE
                //    level (CDP Emulation.setEmulatedMedia), running dev-mediaparity.html:
                //
                //      user set reduced-motion   2 disagreements  css=true  matchMedia=false
                //      Windows High Contrast     2 disagreements
                //      prefers-contrast: more    2 disagreements
                //
                //    The cohort was never joined - only the contradiction was real, and it is the
                //    kind that reads with no baseline knowledge of the visitor.
                //
                // 2. The cost landed on the user rather than on the fingerprint. forced-colors:none
                //    tells a site to ignore the Windows High Contrast mode a low-vision user turned
                //    on, and a page can come out unreadable; reduced-motion: no-preference plays the
                //    animations somebody switched off because they make them ill. That harm is
                //    certain, while both fingerprinting outcomes are speculative - which is what
                //    decided it.
                //
                // inverted-colors was already left alone for a different reason worth keeping:
                // Chromium PARSES it and then answers false to every value, "none" included, so
                // forcing the default made us the only browser on the web answering 01 where a clean
                // one answers 00. Same trap, and see _mqUsable above - a feature the PARSER knows is
                // not a feature the ENGINE answers.
                //
                // This whole group is now byte-for-byte what a browser with no extension reports.
                // Held by test/mediadisplay.mjs, which re-runs the parity page with each of these
                // preferences emulated - conditions this machine does not have.
                // NOT forced, deliberately:
                //   prefers-color-scheme — one bit, and overriding it makes every site
                //     render in a theme the user did not choose. The cost is visible on
                //     every page; the gain is not worth it here.
                //   monochrome — a colour display reports 0 everywhere, so the native
                //     answer already IS the crowd answer (measured: identical to a clean
                //     browser). Forcing it would only add a way to be wrong.

                // ── Input: мышь есть, touch нет ──
                if (ql.indexOf('hover: none')    !== -1) return false;
                if (ql.indexOf('hover: hover')   !== -1) return true;
                if (ql.indexOf('any-hover: none')  !== -1) return false;
                if (ql.indexOf('any-hover: hover') !== -1) return true;
                if (ql.indexOf('pointer: coarse') !== -1) return false;
                if (ql.indexOf('pointer: fine')   !== -1) return true;
                if (ql.indexOf('pointer: none')   !== -1) return false;
                if (ql.indexOf('any-pointer: coarse') !== -1) return false;
                if (ql.indexOf('any-pointer: fine')   !== -1) return true;
                if (ql.indexOf('any-pointer: none')   !== -1) return false;

                // ── Screen update rate ──
                if (ql.indexOf('update: none') !== -1 || ql.indexOf('update: slow') !== -1) return false;
                if (ql.indexOf('update: fast') !== -1) return true;

                // ── Device / viewport dimensions из профиля ──
                var _SW = (ID && ID.screenWidth)  || 1920;
                var _SH = (ID && ID.screenHeight) || 1080;
                // min/max/exact device-width
                var mDw = ql.match(/(min-|max-)?device-width:\s*(\d+(?:\.\d+)?)px/);
                if (mDw) {
                    var n = parseFloat(mDw[2]), pref = mDw[1] || '';
                    if (pref === 'min-') return _SW >= n;
                    if (pref === 'max-') return _SW <= n;
                    return Math.abs(_SW - n) < 1;
                }
                var mDh = ql.match(/(min-|max-)?device-height:\s*(\d+(?:\.\d+)?)px/);
                if (mDh) {
                    var n2 = parseFloat(mDh[2]), pref2 = mDh[1] || '';
                    if (pref2 === 'min-') return _SH >= n2;
                    if (pref2 === 'max-') return _SH <= n2;
                    return Math.abs(_SH - n2) < 1;
                }
                // width/height (viewport) — ограничиваем профильным экраном
                var mVw = ql.match(/(min-|max-)?width:\s*(\d+(?:\.\d+)?)px/);
                if (mVw && ql.indexOf('device-') === -1) {
                    var vw = Math.min(_SW, (typeof window.innerWidth === 'number' && window.innerWidth > 0) ? window.innerWidth : _SW);
                    var nv = parseFloat(mVw[2]), pv = mVw[1] || '';
                    if (pv === 'min-') return vw >= nv;
                    if (pv === 'max-') return vw <= nv;
                    return Math.abs(vw - nv) < 1;
                }
                var mVh = ql.match(/(min-|max-)?height:\s*(\d+(?:\.\d+)?)px/);
                if (mVh && ql.indexOf('device-') === -1) {
                    var vh = Math.min(_SH, (typeof window.innerHeight === 'number' && window.innerHeight > 0) ? window.innerHeight : _SH);
                    var nh = parseFloat(mVh[2]), ph = mVh[1] || '';
                    if (ph === 'min-') return vh >= nh;
                    if (ph === 'max-') return vh <= nh;
                    return Math.abs(vh - nh) < 1;
                }

                // [FIX dpr-matchMedia] DPR из профиля (не реальный ~1.5)
                var _dpr = 1;
                try {
                    if (ID && ID.devicePixelRatio != null) _dpr = Number(ID.devicePixelRatio);
                    else if (_prof() && _prof().devicePixelRatio != null)
                        _dpr = Number(_prof().devicePixelRatio);
                } catch (e) {}
                if (!isFinite(_dpr) || _dpr <= 0) _dpr = 1;

                if (ql.indexOf('resolution') !== -1 || ql.indexOf('dppx') !== -1 ||
                    ql.indexOf('device-pixel-ratio') !== -1) {
                    var md = ql.match(/(min-|max-)?resolution:\s*([\d.]+)\s*dppx/);
                    if (md) {
                        var dv = parseFloat(md[2]), dp = md[1] || '';
                        if (dp === 'min-') return _dpr >= dv - 1e-6;
                        if (dp === 'max-') return _dpr <= dv + 1e-6;
                        return Math.abs(_dpr - dv) < 0.08;
                    }
                    var mi = ql.match(/(min-|max-)?resolution:\s*([\d.]+)\s*dpi/);
                    if (mi) {
                        var iv = parseFloat(mi[2]) / 96, ip = mi[1] || '';
                        if (ip === 'min-') return _dpr >= iv - 1e-6;
                        if (ip === 'max-') return _dpr <= iv + 1e-6;
                        return Math.abs(_dpr - iv) < 0.08;
                    }
                    // [FIX unprefixed-device-pixel-ratio-was-answered-at-all] The
                    // `-webkit-` was OPTIONAL here, and unprefixed device-pixel-ratio is not
                    // a media feature Blink has. So the query was answered from the profile
                    // while the CSS engine — which we cannot reach — treated it as unknown
                    // and never matched. Measured on this machine, one line apart:
                    //
                    //                                      clean Chrome 152      ours
                    //   (min-device-pixel-ratio: 1.5)      js false / css false  js TRUE / css false
                    //   (-webkit-min-device-pixel-ratio:)  js true  / css true   agrees
                    //
                    // A browser cannot disagree with itself here: @media and matchMedia are
                    // one engine answering one question, which is the whole subject of
                    // [FIX matchmedia-css-vs-js]. And this one is not the accepted
                    // profile-vs-real-window trade the prefixed query makes — clean Chrome
                    // says false on BOTH sides, so there was nothing to spoof, only a wrong
                    // answer to an invalid question.
                    //
                    // It survived because dev-mediaparity.html whitelists `.*device-pixel-
                    // ratio` as a known trade AND never actually asked one; both halves are
                    // fixed there.
                    var mw = ql.match(/-webkit-(min-|max-)?device-pixel-ratio:\s*([\d.]+)/);
                    if (mw) {
                        var wv = parseFloat(mw[2]), wp = mw[1] || '';
                        if (wp === 'min-') return _dpr >= wv - 1e-6;
                        if (wp === 'max-') return _dpr <= wv + 1e-6;
                        return Math.abs(_dpr - wv) < 0.08;
                    }
                }

                return undefined;
            }

            var _mqlProto = (typeof MediaQueryList !== 'undefined') && MediaQueryList.prototype;
            var _mDesc = _mqlProto && Object.getOwnPropertyDescriptor(_mqlProto, 'matches');
            if (_mDesc && typeof _mDesc.get === 'function') {
                var _origMatches = _mDesc.get;
                Object.defineProperty(_mqlProto, 'matches', {
                    get: _mn(function matches() {
                        // Call the native getter FIRST so a foreign receiver throws
                        // exactly the TypeError native throws, before we look at .media.
                        var real = _origMatches.call(this);
                        // [FIX host-mode] Every feature here describes the display or the
                        // input, i.e. the machine — and the CSS engine already answers for
                        // it, so this is also where the @media/matchMedia trade disappears.
                        if (_hostHwNow()) return real;
                        try {
                            var q = String(this.media || '');
                            if (!q) return real;
                            var forced = _decide(q.toLowerCase().replace(/\s+/g, ' ').trim());
                            if (forced !== undefined) return forced;
                        } catch (eD) {}
                        return real;
                    }, true),
                    enumerable: _mDesc.enumerable,
                    configurable: true
                });
            }
        } catch(_) {}
    })();


    // [ANTI-CREEP] Function.prototype.toString НЕ патчим.
    // Глобальный override даёт 1000+ false-positive lies на Math/String/Document/Node.
    // toString для наших функций отдаётся через get-trap в _mn (см. выше).

    if (!_FEAT.webrtc) { /* webrtc skip */ } else
    // ===== WEBRTC IP PROTECTION =====
    // Блокируем host-кандидаты с приватными IP и srflx (STUN) кандидаты с WAN IP.
    // relay (TURN) не блокируем — они через сервер-посредник, IP не раскрывают.
    // Per-site исключение: если popup отключил защиту для этого хоста — все три хука ниже
    // отдают нативный ответ нетронутым (нужно для видеозвонков/P2P игр на доверенных
    // сайтах). Флаг читается НА КАЖДЫЙ вызов, а не в момент установки патча — см.
    // [FIX per-site-switch-was-decided-before-the-flag-existed] ниже.
    (function() {
        try {
            var OrigRTC = window.RTCPeerConnection;
            if (!OrigRTC) return;
            // [FIX per-site-switch-was-decided-before-the-flag-existed] The exception used
            // to be read HERE, once, as `if (ID && ID.webrtcProtected === false) return;` —
            // and at that moment the answer is always undefined. This file runs at
            // document_start out of the manifest bundle; `webrtcProtected` is computed per
            // host in background.js injectProfile() and reaches the page through ui:state
            // ~100-300 ms later. So the switch decided nothing: the patch was installed on
            // every host, and turning it OFF in the popup changed nothing on any load,
            // reload included. Measured, one rig, STUN answering: with 127.0.0.1 in
            // afp_webrtc_exceptions the WAN address stayed hidden in all three channels.
            //
            // ID is a live Proxy over _prof() (see mw-core), so the flag only had to be
            // read LATER — at the moment a page actually asks for a candidate, an SDP or a
            // stats report, which is after the profile has arrived. Each of the three hooks
            // below now calls _rtcOn() and hands back the native answer untouched when the
            // switch is off, so the toggle takes effect on the CURRENT page as soon as
            // background.js re-injects — no reload needed.
            //
            // The cost, named: an excepted host no longer gets a pristine RTC surface, it
            // gets a patched-but-inert one. The exception exists so video calls and P2P
            // keep working, not to hide the extension, and every other accessor this
            // extension owns is present on every page anyway — masked through _mn the same
            // way these three are.
            //
            // [FIX the-per-site-flag-arrived-320ms-late] The profile is authoritative but
            // LATE — measured in a real browser at 315-327 ms, which is after a page can
            // have offered its first candidates. In that window this used to answer with
            // the default, so on an excepted host ONE connection came out half-filtered:
            //     ui:state 315ms wp=false   ->   event=0  sdp=1  stats=1
            // the candidate hidden at the event, the same address readable in the SDP.
            // window.__r0 is the same answer delivered at document_start by rtc-off.js,
            // which background.js registers for exactly the excepted hosts. It is only
            // consulted while the profile has not spoken: once wp is an actual boolean it
            // decides, so a switch flipped under an open page is not overruled by a marker
            // baked in at load.
            var _rtcOn = function () {
                try {
                    var v = ID ? ID.webrtcProtected : undefined;
                    if (v === false) return false;
                    if (v === true) return true;
                } catch (eOn) {}
                try { return !window.__r0; } catch (eM) {}
                return true;
            };
            var _isPrivateIP = function(ip) {
                return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.|::1$|fc00:|fd[0-9a-f]{2}:)/i.test(ip);
            };
            var _shouldBlock = function(c) {
                if (!c || !c.candidate) return false;
                var cand = c.candidate;
                // host кандидаты с приватными IP
                if (cand.indexOf(' host ') !== -1) {
                    var m = cand.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[0-9a-f:]{3,39})/gi);
                    return m ? m.some(_isPrivateIP) : false;
                }
                // srflx — WAN IP через STUN, раскрывает реальный адрес без HTTP
                if (cand.indexOf(' srflx ') !== -1) return true;
                return false;
            };
            // [FIX ael-wrapper-for-one-consumer] The filter used to sit on the LISTENER:
            // a wrapper on EventTarget.prototype.addEventListener (mw-core) swapped the
            // page's callback for one that dropped blocked candidates, plus a second patch
            // on the onicecandidate setter for the other way of subscribing. That wrapper
            // was this extension's most far-reaching patch — EVERY addEventListener on
            // every page went through it, for this one consumer — and it put our file on
            // the stack of the native call, so Chrome blamed us for the PAGE's own
            // warnings. Measured on a page with `Permissions-Policy: unload=()`:
            //     clean       "unload is not allowed in this document"  @ the page
            //     extension   the same warning                         @ mw/mw-core.js
            //
            // The candidate is hidden at the EVENT instead. RTCPeerConnectionIceEvent
            // .prototype owns its `candidate` accessor natively (measured), so redefining
            // it adds no own-property a clean realm lacks, and one patch covers BOTH
            // subscription styles — addEventListener and onicecandidate — where two were
            // needed before. The global wrapper is gone with it.
            //
            // Protection is unchanged: the page still never sees the address. What it sees
            // is `null`, which is the platform's own end-of-gathering signal and exactly
            // what a browser behind a firewall that answers no STUN produces — closer to a
            // real machine than a listener that silently never fires.
            try {
                var _ieProto = window.RTCPeerConnectionIceEvent && window.RTCPeerConnectionIceEvent.prototype;
                var _icD = _ieProto && Object.getOwnPropertyDescriptor(_ieProto, 'candidate');
                if (_icD && typeof _icD.get === 'function') {
                    var _origCand = _icD.get;
                    Object.defineProperty(_ieProto, 'candidate', {
                        get: _mn(function candidate() {
                            // Native first, so a foreign receiver throws what native throws.
                            var c = _origCand.call(this);
                            try { if (_rtcOn() && c && _shouldBlock(c)) return null; } catch (eB) {}
                            return c;
                        }, true),
                        set: _icD.set,
                        enumerable: _icD.enumerable,
                        configurable: _icD.configurable
                    });
                }
            } catch (eIce) {}

            // [FIX sdp-carried-the-candidate-the-event-filter-hid] Фильтр выше прячет адрес
            // В СОБЫТИИ. Но Chrome дописывает каждого собранного кандидата ещё и в локальное
            // описание, а `pc.localDescription.sdp` — обычная строка, читаемая страницей без
            // всяких подписок. То есть srflx-строка с настоящим WAN-адресом проходила мимо
            // фильтра, который секундой раньше отказался её показать.
            //
            // Замерено, ОДНО соединение, оба канала читаются рядом:
            //     onicecandidate    два mDNS host-кандидата, затем null   (srflx заблокирован)
            //     localDescription  те же два, ПЛЮС
            //                       a=candidate:... <WAN IP> ... typ srflx raddr 0.0.0.0
            // Здесь вырезаются те же строки и тем же _shouldBlock, так что два канала
            // наконец говорят одно и то же. Проверяется test/webrtc-sdp.mjs.
            //
            // Возвращается НАСТОЯЩИЙ RTCSessionDescription, а не объектный литерал:
            // `pc.localDescription instanceof RTCSessionDescription` на чистом браузере
            // true (замерено), и `{type, sdp}` был бы ровно тем однострочным признаком, про
            // который написано в [FIX matchmedia-returned-an-object-literal].
            //
            // Страница теряет здесь то же, что уже потеряла на событии: кандидата, которого
            // ей всё равно не собирались отдавать. Сайту, которому нужен P2P, служит
            // per-site исключение выше: при выключенном переключателе _rtcOn() ложно, и
            // геттер возвращает нативный localDescription, не заглянув в SDP.
            try {
                var _SD = window.RTCSessionDescription;
                // Вырезать a=candidate НЕДОСТАТОЧНО, и это тоже замерено. Адрес лежит в SDP
                // дважды: в строке кандидата и в строке соединения `c=`, куда Chrome кладёт
                // «кандидата по умолчанию» — то есть как раз srflx. После первой версии
                // фикса строк a=candidate с адресом не осталось, а `c=IN IP4 <WAN IP>`
                // стояла на месте, и тест поймал адрес в тексте SDP при нуле srflx-строк.
                // Порт из той же пары уезжает в `m=`.
                //
                // Чему их равнять, не выдумано: снят SDP чистого Chrome, которому не дали
                // ни одного STUN-сервера, — то самое состояние, которое мы изображаем.
                //     m=application 9 UDP/DTLS/SCTP webrtc-datachannel
                //     c=IN IP4 0.0.0.0
                // Порт 9 (discard) и 0.0.0.0 — это и есть нативная запись «предъявить
                // нечего», а не наша выдумка.
                //
                // Правится только та `c=`, которая называет вырезанный нами адрес. Если
                // кандидатом по умолчанию остался relay (TURN разрешён — см. выше) или
                // mDNS-host, строка принадлежит живому кандидату, и трогать её нельзя:
                // это сломало бы соединение и разошлось бы с тем, что в SDP реально есть.
                var _scrubSdp = function (sdp) {
                    if (typeof sdp !== 'string' || sdp.indexOf('a=candidate') === -1) return sdp;
                    var eol = sdp.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
                    var lines = sdp.split(/\r\n|\r|\n/);
                    var removed = {}, any = false, out = [];
                    for (var i = 0; i < lines.length; i++) {
                        var L = lines[i];
                        if (L.indexOf('a=candidate:') === 0 && _shouldBlock({ candidate: L })) {
                            any = true;
                            // a=candidate:<foundation> <cmp> <proto> <prio> <ADDRESS> <port> ...
                            var t = L.split(' ');
                            if (t.length > 4) removed[t[4]] = true;
                            continue;   // строка уходит целиком, пустой не остаётся
                        }
                        out.push(L);
                    }
                    if (!any) return sdp;
                    var lastM = -1;
                    for (var j = 0; j < out.length; j++) {
                        if (out[j].indexOf('m=') === 0) { lastM = j; continue; }
                        if (out[j].indexOf('c=') !== 0) continue;
                        var ct = out[j].split(' ');          // c=IN IP4 <address>
                        if (ct.length < 3 || !removed[ct[2]]) continue;
                        ct[2] = (ct[1] === 'IP6') ? '::' : '0.0.0.0';
                        out[j] = ct.join(' ');
                        if (lastM >= 0) {
                            var mt = out[lastM].split(' ');  // m=<media> <port> ...
                            if (mt.length >= 2) { mt[1] = '9'; out[lastM] = mt.join(' '); }
                        }
                    }
                    return out.join(eol);
                };
                // Три геттера, а не один: localDescription отдаёт pending или current, но
                // страница может спросить и каждый из них по отдельности — и после
                // завершения переговоров именно currentLocalDescription несёт тот же SDP.
                ['localDescription', 'currentLocalDescription', 'pendingLocalDescription']
                    .forEach(function (_name) {
                        try {
                            var _d = Object.getOwnPropertyDescriptor(OrigRTC.prototype, _name);
                            if (!_d || typeof _d.get !== 'function') return;
                            var _orig = _d.get;
                            var _get = function () {
                                // Нативный геттер первым — на чужом receiver TypeError
                                // должен быть ровно тот же, что у настоящего аксессора.
                                var desc = _orig.call(this);
                                try {
                                    if (!_rtcOn()) return desc;
                                    if (!desc || !desc.sdp) return desc;
                                    var cleaned = _scrubSdp(desc.sdp);
                                    if (cleaned === desc.sdp) return desc;
                                    if (typeof _SD !== 'function') return desc;
                                    return new _SD({ type: desc.type, sdp: cleaned });
                                } catch (eS) { return desc; }
                            };
                            // _mn строит нативную сигнатуру из fn.name; в цикле имя
                            // приходится проставлять вручную, иначе получится «get ».
                            try {
                                Object.defineProperty(_get, 'name', { value: _name, configurable: true });
                            } catch (eN) {}
                            Object.defineProperty(OrigRTC.prototype, _name, {
                                get: _mn(_get, true),
                                set: _d.set,
                                enumerable: _d.enumerable,
                                configurable: _d.configurable
                            });
                        } catch (eOne) {}
                    });
            } catch (eSdp) {}

            // [FIX getstats-was-the-third-copy-of-the-address] Тот же адрес лежит в третьем
            // месте: pc.getStats() отдаёт запись local-candidate с полем address. Замерено
            // на том же соединении, где событие уже вернуло null, а SDP уже вычищен:
            //     local-candidate srflx 203.0.113.7:60479        (address redacted)
            // Одного вызова достаточно, подписки не нужно — то есть канал не сложнее двух
            // предыдущих, и пока он открыт, закрытые каналы ничего не значат.
            //
            // Правка «на месте» здесь НЕ работает, и это измерено: `delete s.address`
            // возвращает true, но следующий forEach отдаёт новый объект с адресом на месте —
            // Chrome пересобирает записи на каждое чтение. Поэтому фильтруется сам отчёт.
            //
            // Прячется вся запись, а не только адрес. Это ровно та версия событий, которую
            // рассказывают два других канала: STUN не ответил, srflx-кандидата нет вовсе.
            // Кандидат с candidateType 'srflx' и пустым адресом противоречил бы ей —
            // «STUN ответил, но откуда, не видно», — а противоречие здесь дороже пропажи:
            // host-кандидат с address '' Chrome отдаёт сам (mDNS, замерено), а srflx без
            // адреса не отдаёт никогда.
            //
            // Отчёт заворачивается в Proxy: `rep instanceof RTCStatsReport` при этом
            // остаётся true (замерено — Proxy отдаёт прототип цели), тогда как любая
            // собственная Map или литерал этот instanceof роняют. Методы строятся ОДИН раз
            // на отчёт: у нативного `rep.forEach === rep.forEach`, и пересоздание их на
            // каждом обращении само по себе было бы признаком.
            //
            // Цена, названная честно: итераторы values()/keys()/entries() создаются через
            // Object.create от НАСТОЯЩЕГО прототипа итератора (взят с самого отчёта), но
            // next у них — собственное свойство, а не унаследованное. Это единственное
            // расхождение с нативной формой, и оно видно лишь тому, кто сравнивает
            // getOwnPropertyNames самого итератора. Не фильтровать их нельзя: тогда
            // [...rep] обходил бы фильтр одной строкой.
            //
            // ОСТАЁТСЯ ОТКРЫТЫМ и не чинится отсюда: сам STUN-запрос всё равно уходит, и
            // оператор STUN-сервера видит IP в источнике пакета. Закрыть это можно только
            // вырезав stun:-серверы из конфигурации RTCPeerConnection — это меняет работу
            // сети, а не только видимость из JS, поэтому вынесено в отдельное решение.
            try {
                var _origGetStats = OrigRTC.prototype.getStats;
                if (typeof _origGetStats === 'function') {
                    var _blockStat = function (s) {
                        try {
                            if (!s || s.type !== 'local-candidate') return false;
                            // relay (TURN) не трогаем — он и в событии разрешён.
                            if (s.candidateType === 'srflx' || s.candidateType === 'prflx') return true;
                            if (s.candidateType === 'host') {
                                var a = s.address || s.ip || '';
                                // mDNS-кандидат приходит с пустым адресом — прятать нечего.
                                return a ? _isPrivateIP(a) : false;
                            }
                        } catch (eB) {}
                        return false;
                    };
                    var _filterReport = function (rep) {
                        var hidden = [], visible = [];
                        try {
                            rep.forEach(function (s, id) {
                                if (_blockStat(s)) hidden.push(id); else visible.push(id);
                            });
                        } catch (eF) { return rep; }
                        // Прятать нечего — отдаём нативный отчёт нетронутым. Это обычный
                        // случай для любой страницы без STUN, и ей не достаётся никакой
                        // обёртки вообще.
                        if (!hidden.length) return rep;

                        var _itProto = null;
                        try { _itProto = Object.getPrototypeOf(rep.values()); } catch (eP) {}
                        var mkIter = function (pick) {
                            var i = 0;
                            var it = _itProto ? Object.create(_itProto) : {};
                            it.next = function next() {
                                if (i >= visible.length) return { value: undefined, done: true };
                                return { value: pick(visible[i++]), done: false };
                            };
                            return it;
                        };
                        var isHidden = function (id) {
                            for (var i = 0; i < hidden.length; i++) if (hidden[i] === id) return true;
                            return false;
                        };
                        var proxy;
                        var mGet = _mn(function get(id) {
                            return isHidden(String(id)) ? undefined : rep.get(id);
                        }, false);
                        var mHas = _mn(function has(id) {
                            return isHidden(String(id)) ? false : rep.has(id);
                        }, false);
                        var mForEach = _mn(function forEach(cb, thisArg) {
                            for (var i = 0; i < visible.length; i++) {
                                cb.call(thisArg, rep.get(visible[i]), visible[i], proxy);
                            }
                        }, false);
                        var mKeys = _mn(function keys() {
                            return mkIter(function (id) { return id; });
                        }, false);
                        var mValues = _mn(function values() {
                            return mkIter(function (id) { return rep.get(id); });
                        }, false);
                        // @@iterator и entries у maplike-интерфейса — одна и та же функция.
                        var mEntries = _mn(function entries() {
                            return mkIter(function (id) { return [id, rep.get(id)]; });
                        }, false);

                        proxy = new Proxy(rep, {
                            get: function (t, p) {
                                if (p === 'size') return visible.length;
                                if (p === 'get') return mGet;
                                if (p === 'has') return mHas;
                                if (p === 'forEach') return mForEach;
                                if (p === 'keys') return mKeys;
                                if (p === 'values') return mValues;
                                if (p === 'entries' || p === Symbol.iterator) return mEntries;
                                var v = Reflect.get(t, p);
                                // Метод, вызванный на прокси, иначе упал бы с Illegal
                                // invocation: внутренний слот живёт на цели.
                                return typeof v === 'function' ? v.bind(t) : v;
                            }
                        });
                        return proxy;
                    };
                    OrigRTC.prototype.getStats = _mn(function getStats() {
                        var pr = _origGetStats.apply(this, arguments);
                        // Switch off for this host: the native promise goes back as it
                        // came, identity included — no .then() chain of ours around it.
                        try { if (!_rtcOn()) return pr; } catch (eOff) {}
                        try {
                            return pr.then(function (rep) {
                                try { return _filterReport(rep); } catch (eR) { return rep; }
                            });
                        } catch (eT) { return pr; }
                    }, false);
                }
            } catch (eStats) {}

            // Маркер для popup badge — показывает что WebRTC IP патч активен.
            // См. FIX popup-badge-symbol-not-shared в начале файла.
            //
            // [FIX status-said-active-on-an-excepted-host] A plain `true` here would now be
            // wrong on every host the switch turned off: the patch IS installed there (see
            // _rtcOn above), it just answers natively — and the popup would count WebRTC
            // among the active modules while the page can read the address. The key is a
            // getter over the same live flag, read in the page's realm by the popup probe
            // at the moment it looks (popup.js checkProtectionsOnce reads `!!s.webrtc`).
            _markStatus('webrtc');
            try {
                var _st0 = window.__t0;
                if (_st0) {
                    Object.defineProperty(_st0, 'webrtc', {
                        get: function () { return _rtcOn(); },
                        configurable: true, enumerable: true
                    });
                }
            } catch (eSt) {}
        } catch(_) {}
    })();

    if (!_FEAT.plugins) { /* plugins skip */ } else
    // ===== PLUGINS + MIMETYPES =====
    // navigator.plugins.length === 0 — признак эмуляции/автоматизации.
    // Chrome на Windows всегда имеет 5 PDF плагинов.
    //
    // [КРИТИЧНЫЙ ФИКС] Старая реализация создавала plain object через
    // Object.create(null) — это давало navigator.plugins instanceof PluginArray === false
    // и ломало `for...of` (нет Symbol.iterator). Боты-детекторы (включая Google reCAPTCHA)
    // именно так проверяют — настоящий браузер ВСЕГДА проходит instanceof PluginArray.
    // Теперь создаём объект с правильной цепочкой прототипов через PluginArray.prototype.
if (!_STEALTH)     (function() {
        try {
            // [FIX less-detect] Real Chrome already has 5 PDF plugins — rewriting
            // PluginArray is a strong anti_detect signal. Only spoof if empty.
            try {
                if (navigator.plugins && navigator.plugins.length > 0) return;
            } catch (eSkip) {}
            // [ANTI-CREEP] instance, не prototype — см. NAVIGATOR выше
            var plugins = ID.plugins || [
                { name: 'PDF Viewer',              filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Chrome PDF Viewer',       filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Chromium PDF Viewer',     filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'WebKit built-in PDF',     filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
            ];
            var mimes = ID.mimeTypes || [
                { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
                { type: 'text/pdf',        description: 'Portable Document Format', suffixes: 'pdf' }
            ];

            // [FIX plugins-branch-shipped-unmasked-functions] Everything this IIFE hands
            // the page used to be a plain function expression, so Function.prototype
            // toString on navigator.plugins.item — or on [Symbol.iterator], item.item,
            // namedItem, refresh — printed this file's source instead of
            // "function item() { [native code] }". That is the leak every other patch in
            // mw/*.js goes through _mn to avoid; this branch only runs when
            // navigator.plugins is empty (real Chromium always ships the 5 PDF entries,
            // headless included), which is why it was never noticed.
            //
            // @@iterator is not masked but dropped: measured against stock Chromium,
            // PluginArray/MimeTypeArray/Plugin all inherit Symbol.iterator and it is
            // literally Array.prototype.values, which is generic and works on these
            // objects as they are — verified by spreading a hand-built object with an own
            // `length` and indices. So when the native interface exists there is nothing
            // to define: the object gets the real thing by inheritance, and
            // Object.getOwnPropertySymbols() stays empty, which is what a real
            // navigator.plugins returns. This fallback is for the case where the
            // interface is missing entirely and the prototype is Object.prototype.
            var HAS_PLUGIN_ARRAY = (typeof PluginArray !== 'undefined');
            var HAS_MIME_ARRAY = (typeof MimeTypeArray !== 'undefined');
            var HAS_PLUGIN = (typeof Plugin !== 'undefined');
            function makeIterable(o, len) {
                try {
                    Object.defineProperty(o, Symbol.iterator, {
                        // Native name/length for Array.prototype.values: "values", 0.
                        value: _mn(function values() {
                            var i = 0;
                            return { next: function() { return i < len ? { value: o[i++], done: false } : { value: undefined, done: true }; } };
                        }),
                        writable: true, enumerable: false, configurable: true
                    });
                } catch (e) {}
                return o;
            }

            // [FIX plugins-empty-mimes] Plugin.length was 0 → FP.com mimeTypes:[].
            // Real Chrome PDF plugins: length 2, [0]=application/pdf, [1]=text/pdf.
            // [FIX enabledPlugin-self-reference] Раньше параметр назывался
            // enabledPlugin, а геттер был ИМЕНОВАННЫМ function expression с тем же
            // именем: имя named function expression связывается в её собственной
            // области видимости и ЗАТЕНЯЕТ одноимённый параметр снаружи, поэтому
            // `return enabledPlugin` возвращал саму функцию-геттер, а не объект
            // Plugin. То есть navigator.mimeTypes[0].enabledPlugin отдавал
            // function вместо Plugin — грубое расхождение с настоящим Chrome
            // (где это Plugin, и `.name` у него 'PDF Viewer', а не пустая строка).
            // Параметр переименован в plugin — геттеру нужно сохранить имя
            // enabledPlugin ради toString, поэтому конфликт снимается именно так.
            // [FIX enabledPlugin-was-permanently-null] getPlugin is a FUNCTION resolved at
            // read time, and it replaces a two-phase wiring that could not work.
            // Previously the plugin object was passed by value, and navigator.mimeTypes
            // had to be built before any Plugin existed — so it was built with null and a
            // loop afterwards re-defined enabledPlugin on each entry to point at
            // plugins[0]. But this descriptor omitted `configurable`, which defaults to
            // FALSE, so that later Object.defineProperty threw TypeError on the very first
            // entry; the whole loop sat inside `try {} catch (eW) {}` and the throw was
            // swallowed. navigator.mimeTypes[0].enabledPlugin was therefore null forever,
            // where real Chrome returns a Plugin whose .name is 'PDF Viewer' (measured in
            // a clean realm, and caught by dev-runtime.html).
            // Resolving lazily removes the second phase entirely: the array can be built
            // before the plugin exists and still report it, so there is no re-definition
            // to fail and nothing left to swallow. configurable is set anyway — a native
            // MimeType's accessors live on MimeType.prototype and are configurable, and a
            // non-configurable own property here would be its own divergence.
            function makeMimeType(m, getPlugin) {
                var mimeProto = (typeof MimeType !== 'undefined') ? MimeType.prototype : Object.prototype;
                var item = Object.create(mimeProto);
                Object.defineProperties(item, {
                    type:          { value: m.type,        enumerable: true, configurable: true },
                    description:   { value: m.description, enumerable: true, configurable: true },
                    suffixes:      { value: m.suffixes,    enumerable: true, configurable: true },
                    enabledPlugin: {
                        get: _mn(function enabledPlugin() {
                            return (typeof getPlugin === 'function') ? getPlugin() : null;
                        }, true),
                        enumerable: true, configurable: true
                    }
                });
                return item;
            }

            function makePluginArray(arr) {
                var proto = HAS_PLUGIN_ARRAY ? PluginArray.prototype : Object.prototype;
                var o = Object.create(proto);
                arr.forEach(function(p, i) {
                    var pluginProto = HAS_PLUGIN ? Plugin.prototype : Object.prototype;
                    var item = Object.create(pluginProto);
                    var mimeList = (p.mimeTypes && p.mimeTypes.length) ? p.mimeTypes : mimes;
                    var mimeObjs = [];
                    for (var mi = 0; mi < mimeList.length; mi++) {
                        mimeObjs.push(makeMimeType(mimeList[mi], (function (pl) { return function () { return pl; }; })(item)));
                    }
                    Object.defineProperties(item, {
                        name:        { value: p.name,        enumerable: true },
                        filename:    { value: p.filename || 'internal-pdf-viewer', enumerable: true },
                        description: { value: p.description, enumerable: true },
                        length:      { value: mimeObjs.length, enumerable: true }
                    });
                    for (var mj = 0; mj < mimeObjs.length; mj++) {
                        item[mj] = mimeObjs[mj];
                    }
                    // Shadowing item/namedItem is unavoidable: the inherited native ones
                    // throw "Illegal invocation" on an object without the internal slots
                    // (measured). They must at least read as native — hence _mn, and hence
                    // the argument counts, which match Plugin.prototype (both length 1).
                    item.item = _mn(function item(idx) {
                        return mimeObjs[idx] || null;
                    });
                    item.namedItem = _mn(function namedItem(n) {
                        for (var k = 0; k < mimeObjs.length; k++) {
                            if (mimeObjs[k].type === n) return mimeObjs[k];
                        }
                        return null;
                    });
                    if (!HAS_PLUGIN) makeIterable(item, mimeObjs.length);
                    o[i] = item;
                    o[p.name] = item;
                });
                Object.defineProperty(o, 'length', { value: arr.length, enumerable: false });
                o.item = _mn(function item(i) { return o[i] || null; });
                o.namedItem = _mn(function namedItem(n) { return o[n] || null; });
                o.refresh = _mn(function refresh() {});
                if (!HAS_PLUGIN_ARRAY) {
                    makeIterable(o, arr.length);
                    // PluginArray.prototype already carries this tag, so defining it on the
                    // instance would only add an own symbol a real one does not have.
                    try { Object.defineProperty(o, Symbol.toStringTag, { value: 'PluginArray', configurable: true }); } catch(e) {}
                }
                return o;
            }

            function makeMimeArray(arr) {
                var proto = HAS_MIME_ARRAY ? MimeTypeArray.prototype : Object.prototype;
                var o = Object.create(proto);
                // enabledPlugin здесь ещё не известен — доводится ниже, после
                // makePluginArray (см. «Wire enabledPlugin on navigator.mimeTypes»).
                arr.forEach(function(m, i) {
                    // Lazy: pluginArr is assigned before any page can read this, so the
                    // getter finds it even though the array is built first.
                    var item = makeMimeType(m, function () {
                        return (pluginArr && pluginArr[0]) || null;
                    });
                    o[i] = item;
                    o[m.type] = item;
                });
                Object.defineProperty(o, 'length', { value: arr.length, enumerable: false });
                o.item = _mn(function item(i) { return o[i] || null; });
                o.namedItem = _mn(function namedItem(n) { return o[n] || null; });
                if (!HAS_MIME_ARRAY) {
                    makeIterable(o, arr.length);
                    try { Object.defineProperty(o, Symbol.toStringTag, { value: 'MimeTypeArray', configurable: true }); } catch(e) {}
                }
                return o;
            }

            var pluginArr = makePluginArray(plugins);
            _def(navigator, 'plugins', pluginArr);
            // Wire enabledPlugin on navigator.mimeTypes to plugins[0]
            // enabledPlugin resolves lazily now — see makeMimeType. The re-definition
            // loop that used to live here could never succeed and hid its own failure in
            // a bare catch; it is gone.
            var mimeArr = makeMimeArray(mimes);
            _def(navigator, 'mimeTypes', mimeArr);
        } catch(_) {}
    })();


    // ===== PERFORMANCE.NOW() — НЕ ПАТЧИМ (осознанно) =====
    // Здесь стоял джиттер на performance.now (WASM normalize_timing, иначе ±0.1ms
    // на JS). Он был вреден сразу по трём измеренным причинам:
    //
    //  1) НАРУШАЛ МОНОТОННОСТЬ. performance.now по спеке монотонно неубывающий.
    //     Джиттер добавлялся НЕЗАВИСИМО на каждый вызов, поэтому более поздний
    //     вызов легко получал меньшее значение, чем более ранний. Замер: из
    //     40 000 последовательных вызовов время шло НАЗАД 20 082 раза. Это не
    //     столько вопрос отпечатка, сколько поломка: на таком времени ломаются
    //     анимации, замеры длительности (t2 - t1 < 0) и любые библиотеки,
    //     полагающиеся на монотонность.
    //  2) ДАВАЛ НЕВОЗМОЖНОЕ РАЗРЕШЕНИЕ ТАЙМЕРА. Chrome сам квантует
    //     performance.now до 0.1 мс (замер нативного минимального шага:
    //     0.09999999776482582). Непрерывный джиттер меньше кванта разрушал
    //     сетку, и минимальный шаг становился ~0.002 мс — такого не даёт ни
    //     один реальный браузер, то есть патч сам себя выдавал.
    //  3) РАСХОДИЛСЯ С ВОРКЕРАМИ. В воркерах performance.now не патчился, там
    //     оставались нативные 0.1 мс — CreepJS сравнивает Window и Worker и
    //     видел 0.002 против 0.1.
    //
    // Собственный кламп Chrome в 0.1 мс и есть защита от таймингового
    // фингерпринтинга; добавлять шум ПОД квантом бессмысленно. Оставляем
    // нативное поведение: и монотонно, и совпадает с воркерами.
    //
    // Если понадобится именно шум, он обязан (а) сохранять монотонность
    // (например, джиттер, зависящий только от номера 0.1-мс бакета, а не от
    // вызова) и (б) оставаться на сетке 0.1 мс, иначе разрешение таймера снова
    // выдаст подмену.

    // ===== ERROR.STACK FILTER — REMOVED, IT NEVER RAN =====
    //
    // [FIX the-global-stack-filter-was-dead-code] A block stood here that meant to strip
    // `chrome-extension://` lines out of every error stack, gated on `!_STEALTH`. It was
    // guarded by
    //
    //     var _origSD = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
    //     if (_origSD && _origSD.get) { ...install the filter... }
    //
    // and in V8 that descriptor is **undefined**. `stack` is not on Error.prototype at all:
    // it is an own accessor installed on each error INSTANCE at construction. Measured, one
    // line in a clean browser and in this extension in both modes, all three identical:
    //
    //     Object.getOwnPropertyDescriptor(Error.prototype, 'stack')  -> undefined
    //     Object.getOwnPropertyNames(new Error('x'))                 -> ["stack","message"]
    //
    // So the condition was never true and the filter never installed — in either mode. The
    // `!_STEALTH` gate on it was doubly meaningless, and the block's real cost was that it
    // LOOKED like protection: two genuine leaks sat behind it for as long as it existed.
    //
    // Both are fixed where they are produced, which is the only place they can be fixed
    // once you know the prototype hook is unavailable:
    //   * mw/mw-workers.js — the hand-built Worker constructor proxy now routes a failed
    //     construction through _stripFrames, as every _mn-made wrapper already did;
    //   * mw/mw-geo.js — page callbacks are handed to setTimeout directly, so no frame of
    //     ours is on the stack while the page's own code builds an Error.
    //
    // Do not reinstate a global filter here without re-measuring that descriptor. Making
    // one actually work would mean patching Error construction per instance (or setting
    // Error.prepareStackTrace, which a page can read and which libraries legitimately own),
    // and test/stackleak.mjs now covers the leaks that motivated it — against a clean
    // browser, in both modes.

    // ===== WINDOW.NAME CLEANUP =====
    // window.name персистентен между навигациями — используется как cross-site tracking ID.
    // Очищаем при старте страницы. Не патчим setter — это ломает target="_blank" фреймы.
    //
    // [FIX window-name-broke-recaptcha] Очищалось В КАЖДОМ фрейме — и это ломало виджеты,
    // для которых имя фрейма является каналом связи. Измерено на
    // google.com/recaptcha/api2/demo: с расширением bframe оставался пустым (322 байта
    // против 12961) и страница падала с
    //   Uncaught TypeError: Cannot read properties of undefined (reading 'postMessage')
    //     at recaptcha__et.js CE.init
    // — анкор ищет challenge-фрейм по имени, получает undefined и падает. Галочка после
    // этого не ставится вообще. В stealth баг не воспроизводился (блок выключен), а
    // снятие любой отдельной галки в настройках не помогало: блок гейтится только
    // _STEALTH. Имя САБФРЕЙМА выставляет сам встраивающий документ в этой же загрузке —
    // это не межсайтовая персистентность, а рабочий канал, и стирать его нечего.
    //
    // Верхнее окно чистим по-прежнему: измерено на чистом Chrome 151, что window.name
    // переживает и same-origin, и cross-origin навигацию в той же вкладке, то есть
    // вектор жив и браузер сам его не закрывает. Окна с opener (popup, названный
    // открывшей страницей через window.open(url, 'name')) тоже пропускаем — там имя
    // задано в этой же сессии тем же пользователем, а не предыдущим сайтом.
if (!_STEALTH)     (function() {
        try {
            if (window.top !== window) return;
            if (window.opener) return;
            if (window.name) window.name = '';
        } catch(_) {}
    })();




    // ===== BATTERY (desktop profile consistency) =====
    if (!_FEAT.battery) { /* disabled in options */ } else
    // Реальная батарея ноутбука (15%, discharging) ломает desktop-профиль Win32.
    // На десктопе Chrome обычно: charging=true, level=1, dischargingTime=Infinity.
    // [FIX] getBattery toString не должен светить тело / _bat — иначе Navigator "deceptive".
    (function() {
        try {
            if (!navigator.getBattery) return;

            // [FIX device-state-was-per-domain] These four used to be computed here from
            // `ID.noiseSeed` — the PER-DOMAIN seed — so the same laptop reported 0.90 to
            // one origin and 0.93 to another at the same moment, and the formula was
            // written out a second time in mw/mw-navigator.js for child frames with no
            // parity assertion holding the two copies together. Both problems go away by
            // not deriving anything here: afpDeviceState in seed-lib.js resolves all four
            // from the MASTER seed, background.js and dyn/boot.js both run it, and the
            // answer arrives on the profile like deviceMemory or the ANGLE strings.
            //
            // `null` on the wire means Infinity — chrome.scripting.executeScript serialises
            // its arguments as JSON, which has no Infinity. The two _batTime readers below
            // are the only place that mapping is undone.
            var _BAT_FALLBACK = { level: 0.82, charging: true, chargingTime: 2620, dischargingTime: null };
            // level/charging are never legitimately null; chargingTime/dischargingTime are,
            // which is why those two go through _batTime instead.
            function _batField(name, fallback) {
                try {
                    var p = _prof();
                    if (p && p[name] !== undefined && p[name] !== null) return p[name];
                } catch (e) {}
                return fallback;
            }
            function _batLevel() { return _batField('batteryLevel', _BAT_FALLBACK.level); }
            function _batCharging() { return _batField('batteryCharging', _BAT_FALLBACK.charging); }
            function _batTime(name, fallback) {
                var v;
                try {
                    var p = _prof();
                    v = (p && Object.prototype.hasOwnProperty.call(p, name)) ? p[name] : fallback;
                } catch (e) { v = fallback; }
                return (v === null || v === undefined) ? Infinity : v;
            }
            function _batChargingTime() { return _batTime('batteryChargingTime', _BAT_FALLBACK.chargingTime); }
            function _batDischargingTime() { return _batTime('batteryDischargingTime', _BAT_FALLBACK.dischargingTime); }

            // [FIX stealth-first-load-kept-the-battery-spoof] The gate on this whole block
            // is `_FEAT.battery`, decided while this file loads — and in stealth `_FEAT`
            // says false only from a tab's SECOND load, because the mode lives in per-tab
            // sessionStorage and a fresh tab has none. So stealth reported the profile's
            // battery once per tab and the machine's own for every load after. Measured by
            // test/stealth.mjs, one tab: level 0.86 then 1, charging spoofed then real.
            //
            // Cured like the canvas and the network before it: install regardless, ask at
            // the moment the value is produced. `_featNow` is memoised per name in mw-core
            // and folds the mode in, so one page gets one answer however often it reads.
            //
            // The instance is the awkward part. `navigator.connection` is a singleton the
            // network fix could just close over; a BatteryManager only ever arrives through
            // a promise, so the native getter has to be called on whichever manager the
            // page is reading. `_def` now threads the receiver into its value function
            // (see _namedGetter in mw-core.js), so `this` here is that manager.
            //
            // The first attempt wrapped navigator.getBattery to remember the object it
            // resolved. That was worse than the bug: `_def` installs an ACCESSOR, and
            // getBattery is natively a data property on Navigator.prototype — a shape lie
            // of exactly the class test/ownprops.mjs exists to catch, introduced to fix a
            // timing defect. It also contradicted [FIX getBattery-returned-a-literal]
            // below, which is the note recording that this method was deliberately left
            // native. It stays native.
            var _batNat = {};
            if (typeof BatteryManager !== 'undefined' && BatteryManager.prototype) {
                try {
                    var bp = BatteryManager.prototype;
                    ['charging', 'chargingTime', 'dischargingTime', 'level'].forEach(function (k) {
                        try {
                            var d = Object.getOwnPropertyDescriptor(bp, k);
                            _batNat[k] = (d && d.get) || null;
                        } catch (e) { _batNat[k] = null; }
                    });
                    function _batOr(k, spoofed) {
                        return function () {
                            if (_featNow('battery')) return spoofed();
                            try { if (_batNat[k]) return _batNat[k].call(this); } catch (e) {}
                            return spoofed();
                        };
                    }
                    _def(bp, 'charging', _batOr('charging', _batCharging));
                    _def(bp, 'chargingTime', _batOr('chargingTime', _batChargingTime));
                    _def(bp, 'dischargingTime', _batOr('dischargingTime', _batDischargingTime));
                    _def(bp, 'level', _batOr('level', _batLevel));
                } catch(e) {}
            }

            // [FIX getBattery-returned-a-literal] Здесь getBattery подменялась целиком
            // и резолвила ЛИТЕРАЛОМ объекта с own-геттерами. Замер против чистого
            // realm: JSON.stringify(await navigator.getBattery()) у нативного даёт
            // '{}' (все свойства живут на BatteryManager.prototype), а у нас —
            // '{"charging":true,"chargingTime":2540,...}'. Плюс
            // instanceof BatteryManager не проходил. Тот же класс бага, что был у
            // TextMetrics и PermissionStatus.
            // Подмена при этом была ИЗБЫТОЧНОЙ: значения уже отдаются через патч
            // геттеров BatteryManager.prototype выше, а нативный getBattery возвращает
            // настоящий BatteryManager, к которому этот патч и применяется. Поэтому
            // просто оставляем нативный getBattery — значения те же, тип объекта
            // правильный, own-свойств нет.
            _markStatus('battery');
        } catch(_) {}
    })();

    // ===== ELEMENT.GETBOUNDINGCLIENTRECT + ELEMENT/RANGE.GETCLIENTRECTS =====
    // Рендеринг текста в DOM отличается по пикселям между ОС/шрифтами/GPU.
    // clientRects default false (options). When enabled: stable noise on GBCR+GCR.
    // [FIX a-switch-off-its-default-was-inert-on-the-first-load]
    //
    // The gate used to be `_FEAT.clientRects` alone, settled as mw-core loaded. On the first
    // load of an origin there is nothing to settle it FROM — 'v.ui.f' lives in
    // sessionStorage and the cold-start profile carries no `features` — so the SHIPPED
    // default won, and this flag ships OFF. A user who turned it on got nothing until the
    // second load. Measured in a real Chrome 152: a fresh origin reported 0 of 6 rect fields
    // on the noise grid, the same page after F5 reported 6 of 6.
    //
    // Install as before when the answer is KNOWN, and install regardless when it is not yet
    // knowable, deciding the effect at first use instead (_crEnabled below). That second
    // condition is the fix, and the first is what keeps its cost off the default
    // configuration. Measured, clean Chrome 152:
    //
    //     getBoundingClientRect   native 430.5 ns   through the wrapper 489 ns   (+13.6%)
    //     a DOMRect accessor      native  22.1 ns   with the WeakSet miss  23.1 ns
    //
    // A flag that ships OFF must not tax every page of every user who left it off, and it
    // does not: from the second load of an origin onward the answer is known and nothing is
    // installed. Only a first load pays, and only until the question is settled.
    //
    // The patch is NOT uninstalled when the answer turns out to be "off". That would save
    // those 58 ns and cost something worse: a page that snapshots
    // Element.prototype.getBoundingClientRect early — which anti-tamper code does — would
    // see the reference change under it, and a clean browser never does that.
    //
    // Stealth moved into the same decision. It was a second load-time gate here, and
    // _STEALTH is false on a tab's first load for exactly the same reason — see
    // [FIX stealth-first-load-splits-the-canvas], which fixed this shape for the canvas at
    // the effect sites rather than at the install.
    // Сайты создают <span> с разными шрифтами и сравнивают getBoundingClientRect()
    // И/ИЛИ getClientRects() (множественное число, отдельный метод, возвращает
    // DOMRectList). Добавляем субпиксельный детерминированный noise — обходит
    // font detection через DOM.
    // [FIX getclientrects-never-patched] Заголовок секции годами заявлял, что
    // покрыты оба метода, но реально патчился только getBoundingClientRect —
    // getClientRects (Element И Range) не патчился НИКОГДА. Найдено разбором
    // реального кода тестовой страницы webbrowsertools.com/clientrects-
    // fingerprint: она вызывает именно .getClientRects(), не
    // .getBoundingClientRect(). Значит весь предыдущий race-condition разбор
    // seed'а для ClientRects был про метод, который тест даже не использует —
    // true/false flip-flop, который казался нестабильностью защиты, был
    // просто настоящим layout shift'ом страницы (реклама/виджет комментариев
    // догружаются между "before onload" и самим onload) на СОВЕРШЕННО
    // непропатченных, родных значениях браузера.
    if ((!_FEAT.clientRects || _STEALTH) && _featKnown) { /* off, and we know it */ } else
    (function() {
        try {
            // Общая noise-функция — та же формула, что и у getBoundingClientRect,
            // для консистентности между двумя методами (один и тот же элемент
            // должен давать согласованные, а не по-разному зашумлённые значения
            // между .getBoundingClientRect() и .getClientRects()[0]).
            // [FIX domrect-equal-inputs-equal-noise] Ключ хэша раньше был ИМЕНЕМ
            // поля ('x', 'y', 'width', 'height') — одинаковое имя всегда давало
            // одинаковый шум, но РАЗНЫЕ имена давали разный шум даже когда
            // РЕАЛЬНЫЕ (незашумлённые) значения совпадали. Для элемента, у
            // которого real.x === real.y (например, квадрат, закреплённый в
            // начале координат — обычная тестовая форма у fingerprint-скриптов
            // вроде CreepJS), это ломало x===y после шума, хотя реальный
            // браузер такую совпадающую пару всегда сохраняет совпадающей.
            // Ключ хэша теперь — округлённое до миллипикселя ЗНАЧЕНИЕ: разные
            // входы по-прежнему шумятся независимо (разная строка → разный
            // хэш), но одинаковые входы теперь детерминированно дают
            // одинаковый шум, как и должно быть у величины, а не у ярлыка.
            // hash_str на WASM-стороне (substitute_text_metrics) уже принимает
            // произвольную строку — C/WASM менять не потребовалось.
            function _bcrNoiseKey(val) {
                return 'bcr_' + Math.round(val * 1000);
            }
            function _bcrNoise(val) {
                if (val === undefined || val === null) return val;
                // No WASM text-metrics here — amplitude was ~0.25 → CreepJS red.
                var key = _bcrNoiseKey(val);
                var seed = _getSessionSeed();
                for (var i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;
                seed = (seed * 1664525 + 1013904223) >>> 0;
                // [FIX domrect-identities-only-held-one-way] The noised value is snapped to
                // a multiple of 2^-12. Without that, only HALF of CreepJS's identity table
                // held: it recomputes every field from the others, both ways —
                //     width = right - left     BUT ALSO   right = left + width
                //     x     = right - width               left  = right - width
                // width is derived here as n(right) - n(x), so `right - left` repeats that
                // very subtraction and is exact; `left + width` is a different operation and
                // is only exact when the two are within a factor of two (Sterbenz). For a
                // long text run — a Range, x=10 and right=410 — it is not, and CreepJS
                // painted two digits of the range sums red while a clean browser showed
                // none. On a 2^-12 grid every one of these values needs ≤25 mantissa bits,
                // so every sum and difference among them is exact and the whole table holds
                // in both directions. The grid is finer than the ±0.001 noise (8 steps) and
                // coarser than the browser's own 1/64 LayoutUnit, which already sits on it.
                var noised = val + ((seed & 0xFF) / 255 - 0.5) * 0.002; // ±0.001px
                return Math.round(noised * 4096) / 4096;
            }
            // [FIX domrect-geometric-invariant-break] Раньше все 8 полей DOMRect
            // (x, y, top, left, right, bottom, width, height) шумились НЕЗАВИСИМО
            // друг от друга. Но top/left/right/bottom — не независимые измерения:
            // по спецификации DOMRectReadOnly они ВСЕГДА равны x, y, x+width,
            // y+height соответственно (тождество, верное и для повёрнутых /
            // трансформированных элементов — x/y/left/top всегда описывают один
            // и тот же bounding box). Независимый шум на все 8 полей ломал эти
            // тождества: x переставал быть равен left, right-left переставал
            // быть равен width — геометрически невозможный паттерн, который
            // детектируется НАДЁЖНЕЕ, чем полное отсутствие защиты. Фикс: шумим
            // только 4 настоящие степени свободы (x, y, width, height),
            // остальные 4 поля выводим из них — тождества выполняются точно.
            // [FIX float-subtraction-not-tautological] Деривация right=x+width
            // (сложение) математически верна, но при повторной проверке
            // (right-left)===width тест выполняет ВТОРУЮ, отдельную операцию
            // вычитания — а a+b-a не всегда бит-в-бит равно b в IEEE 754 double
            // (см. классический 0.1+0.2 !== 0.3). Замер на 200k случайных пар
            // подтвердил: это фундаментальное свойство арифметики, из-за
            // которого спецификационно верное right=x+width всё равно
            // проваливает строгий == почти в половине случаев НЕЗАВИСИМО от
            // какого-либо шума — то есть настоящий браузер тоже периодически
            // "не проходит" эту конкретную проверку. Но 0% отказов достижимо
            // тавтологически: если width — это буквально ТА ЖЕ переменная,
            // что тест получит из right-left (не результат отдельного
            // сложения), то повторное right-left в тесте — это повторный
            // расчёт той же операции над теми же числами, без дополнительного
            // округления. Поэтому шумим x/y/right/bottom напрямую, а
            // width/height выводим как right-left/bottom-top.
            // [FIX getclientrects-desync] The noise used to be applied by REPLACING the
            // object the method returned — `new DOMRect(...)` for getBoundingClientRect,
            // and nothing at all for getClientRects, which was left native because the
            // Proxy over DOMRectList that once wrapped it threw "Illegal invocation" on
            // real sites (claude.ai). The two methods therefore described the same element
            // differently. Measured on one <div>, clientRects ON:
            //     getBoundingClientRect  x=9.997146  width=400.0016
            //     getClientRects()[0]    x=9.997958  width=400        (native, untouched)
            // Any script that reads both — and a fingerprinting script has every reason to
            // — sees a geometry that cannot exist.
            //
            // Now: the methods hand back the browser's OWN objects, unwrapped, and only
            // note them in a WeakSet. The noise moved to the DOMRect accessors, which both
            // methods' results share. No Proxy and no substitute object, so the receiver
            // problem that killed the old attempt cannot come back; `instanceof DOMRect`,
            // `Object.prototype.toString` and DOMRectList stay exactly what they were.
            //
            // Two further properties fall out of this shape:
            //   - a rect the PAGE built itself (`new DOMRect(...)`, common in layout math)
            //     is not in the set and is returned untouched. The old method patch had it
            //     backwards: it corrupted the page's arithmetic and left the fingerprinting
            //     read alone.
            //   - only the field actually read is computed, and no object is constructed,
            //     so the per-call cost drops (measured before: 1162ns vs 618ns with the
            //     feature off, of which ~544ns was four noise calls plus `new DOMRect`).
            // [FIX known-rect-was-noised] The entropy in DOMRect fingerprinting comes from
            // TEXT: glyph rasterisation and font metrics differ per machine, and that lands
            // in the fractional part of a rect. Geometry that CSS states outright —
            // width:400px, a transform on a fixed box — lands on the device pixel grid and
            // is identical on every Blink browser, which is why CreepJS can pin it:
            //     if (devicePixelRatio === 1 && hashMini(knownDimensions) !== '9d9215cc')
            //         documentLie('Element.getClientRects', 'unknown rotate dimensions')
            // Noising that can only lose — the same trade the canvas solid fill and the
            // AudioContext noise both lost. So a rect whose four raw numbers all sit on the
            // pixel grid is left exactly as the browser reported it; a text-derived rect
            // (254.932602 for one <span>) does not, and is noised as before.
            var _gridCache = new WeakMap();
            function _onPixelGrid(v) {
                var dpr = 1;
                try { dpr = window.devicePixelRatio || 1; } catch (e) {}
                var s = v * dpr;
                return Math.abs(s - Math.round(s)) < 1e-6;
            }
            function _rectIsKnown(o, nat, rawRight, rawBottom) {
                var cached = _gridCache.get(o);
                if (cached !== undefined) return cached;
                var known = false;
                try {
                    known = _onPixelGrid(nat.x.get.call(o)) && _onPixelGrid(nat.y.get.call(o)) &&
                        _onPixelGrid(rawRight(o)) && _onPixelGrid(rawBottom(o));
                } catch (e) {}
                try { _gridCache.set(o, known); } catch (e) {}
                return known;
            }

            // The grid rule above catches geometry CSS states outright, but not all of it:
            // CreepJS's second pinned element is ROTATED, so its box is fractional and
            // still identical on every Blink machine. What actually varies between machines
            // is text — glyph advances and rasterisation — so the element is asked here,
            // where the method still knows which one it was called on: a subtree with no
            // text has no per-machine geometry to hide and is left alone.
            function _hasText(el) {
                try {
                    if (!el) return false;
                    if (el.nodeType === 3) return !!String(el.nodeValue || '').trim();
                    var t = el.textContent;
                    return !!(t && t.trim());
                } catch (e) { return true; }
            }
            var _noisedRects = new WeakSet();
            // [FIX a-switch-off-its-default-was-inert-on-the-first-load] The decision the
            // install above deferred, taken ONCE and then kept for the rest of the page.
            //
            // Freezing is the design, not a shortcut. A gate that re-read the flags on every
            // call would let one document measure a rect before they arrive and again after
            // and get two different answers — worse than being consistently wrong, which is
            // the one thing the old behaviour did get right. Frozen, the page gets a single
            // answer, and it is the USER'S answer whenever their first rect read happens
            // after the flags land — which is nearly always, since nothing here runs before
            // the page's own first script does.
            //
            // Nothing is marked when this is false, and the noise lives on the DOMRect
            // accessors keyed off that mark, so an installed-but-off patch hands back the
            // browser's own numbers byte for byte.
            var _crDecision = null;
            function _crEnabled() {
                if (_crDecision === null) {
                    try { _crDecision = !!_featNow('clientRects') && !_stealthNow(); }
                    catch (e) { _crDecision = false; }
                }
                return _crDecision;
            }
            function _markRect(r, el) {
                if (!_crEnabled()) return r;
                try { if (r && _hasText(el)) _noisedRects.add(r); } catch (e) {}
                return r;
            }
            function _markRectList(list, el) {
                if (!_crEnabled()) return list;
                try {
                    if (!_hasText(el)) return list;
                    for (var i = 0; i < list.length; i++) _noisedRects.add(list[i]);
                } catch (e) {}
                return list;
            }
            // The same two markers WITHOUT the _hasText gate, for OpaqueRange — see the
            // long note at the OpaqueRange patch below for why the gate cannot answer
            // there and why the rect needs no gate.
            function _markValueRect(r) {
                if (!_crEnabled()) return r;
                try { if (r) _noisedRects.add(r); } catch (e) {}
                return r;
            }
            function _markValueRectList(list) {
                if (!_crEnabled()) return list;
                try {
                    for (var i = 0; i < list.length; i++) _noisedRects.add(list[i]);
                } catch (e) {}
                return list;
            }

            // x/y/width/height are declared on BOTH DOMRect.prototype (read-write) and
            // DOMRectReadOnly.prototype; top/right/bottom/left only on the latter. Each
            // prototype is patched with the native getters captured from ITSELF, so a
            // DOMRect instance reads the same numbers whichever prototype answers.
            function _patchRectProto(proto) {
                if (!proto) return;
                var nat = {};
                ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left'].forEach(function (k) {
                    var d = Object.getOwnPropertyDescriptor(proto, k);
                    if (d && typeof d.get === 'function') nat[k] = d;
                });
                if (!nat.x || !nat.y) return;
                function rawRight(o) {
                    return nat.right ? nat.right.get.call(o) : nat.x.get.call(o) + nat.width.get.call(o);
                }
                function rawBottom(o) {
                    return nat.bottom ? nat.bottom.get.call(o) : nat.y.get.call(o) + nat.height.get.call(o);
                }
                // Only four degrees of freedom are noised — x, y, right, bottom — and
                // width/height are DERIVED as right-x / bottom-y, for the reason spelled
                // out above [FIX float-subtraction-not-tautological]: a test that checks
                // (right-left)===width then repeats the very same subtraction on the very
                // same doubles, so it holds bit for bit. x===left and y===top hold because
                // both read the identical expression.
                var reads = {
                    x: function (o) { return _bcrNoise(nat.x.get.call(o)); },
                    left: function (o) { return _bcrNoise(nat.x.get.call(o)); },
                    y: function (o) { return _bcrNoise(nat.y.get.call(o)); },
                    top: function (o) { return _bcrNoise(nat.y.get.call(o)); },
                    right: function (o) { return _bcrNoise(rawRight(o)); },
                    bottom: function (o) { return _bcrNoise(rawBottom(o)); },
                    width: function (o) { return _bcrNoise(rawRight(o)) - _bcrNoise(nat.x.get.call(o)); },
                    height: function (o) { return _bcrNoise(rawBottom(o)) - _bcrNoise(nat.y.get.call(o)); }
                };
                Object.keys(nat).forEach(function (k) {
                    var d = nat[k], natGet = d.get, read = reads[k];
                    // Named through a computed key so _mn reports "get x", which is what
                    // the native accessor's own .name is.
                    var g = ({ [k]: function () {
                        // The native getter runs first and on `this`, so reading the
                        // accessor off the prototype still throws Illegal invocation
                        // exactly as it did before.
                        var v = natGet.call(this);
                        if (!_noisedRects.has(this)) return v;
                        if (_rectIsKnown(this, nat, rawRight, rawBottom)) return v;
                        return read(this);
                    } })[k];
                    try {
                        Object.defineProperty(proto, k, {
                            get: _mn(g, true),
                            set: d.set,
                            enumerable: d.enumerable,
                            configurable: d.configurable
                        });
                    } catch (e) {}
                });
                // JSON.stringify(rect) goes through toJSON, which reads the internal slots
                // directly rather than the accessors — without this it would hand back the
                // real geometry next to the noised one.
                var jd = Object.getOwnPropertyDescriptor(proto, 'toJSON');
                if (jd && typeof jd.value === 'function') {
                    var origToJSON = jd.value;
                    try {
                        Object.defineProperty(proto, 'toJSON', {
                            value: _mn(function toJSON() {
                                if (!_noisedRects.has(this)) return origToJSON.call(this);
                                if (_rectIsKnown(this, nat, rawRight, rawBottom)) return origToJSON.call(this);
                                return {
                                    x: this.x, y: this.y, width: this.width, height: this.height,
                                    top: this.top, right: this.right, bottom: this.bottom, left: this.left
                                };
                            }),
                            writable: jd.writable, enumerable: jd.enumerable, configurable: jd.configurable
                        });
                    } catch (e) {}
                }
            }
            try { if (typeof DOMRectReadOnly !== 'undefined') _patchRectProto(DOMRectReadOnly.prototype); } catch (eRO) {}
            try { if (typeof DOMRect !== 'undefined') _patchRectProto(DOMRect.prototype); } catch (eR) {}

            var _origGBCR = Element.prototype.getBoundingClientRect;
            Element.prototype.getBoundingClientRect = _mn(function getBoundingClientRect() {
                return _markRect(_origGBCR.call(this), this);
            });
            var _origGCR = Element.prototype.getClientRects;
            if (typeof _origGCR === 'function') {
                Element.prototype.getClientRects = _mn(function getClientRects() {
                    return _markRectList(_origGCR.call(this), this);
                });
            }
            if (typeof Range !== 'undefined' && Range.prototype.getBoundingClientRect) {
                var _origRGBCR = Range.prototype.getBoundingClientRect;
                Range.prototype.getBoundingClientRect = _mn(function getBoundingClientRect() {
                    return _markRect(_origRGBCR.call(this), this.commonAncestorContainer);
                });
                var _origRGCR = Range.prototype.getClientRects;
                if (typeof _origRGCR === 'function') {
                    Range.prototype.getClientRects = _mn(function getClientRects() {
                        return _markRectList(_origRGCR.call(this), this.commonAncestorContainer);
                    });
                }
            }
            // [FIX opaque-range-rects-were-never-noised]
            //
            // Chrome 152 added OpaqueRange: a range over the VALUE of a form control,
            // handed out by HTMLInputElement.prototype.createValueRange(start, end) and
            // the HTMLTextAreaElement one beside it, carrying its own
            // getBoundingClientRect() and getClientRects(). It is neither an Element nor
            // a Range — the chain is OpaqueRange < AbstractRange — so neither patch above
            // reached it, and it measures precisely what this section exists to hide.
            // Measured on a clean Chrome 152, the same nineteen characters in one
            // <input>, width of the bounding rect:
            //
            //     16px serif             134.640625
            //     16px monospace         167.140625
            //     16px "Segoe UI"        143.343750
            //     16px "NoSuchFontXYZ"   134.640625   (falls back to serif)
            //
            // Per-font advances, and a font-presence oracle in the last line: a font the
            // machine does not have gives back the serif width exactly. That is the
            // getClientRects fingerprint of [FIX getclientrects-never-patched] again, in
            // a class that did not exist when these patches were written, and it arrived
            // with a browser update rather than with any change of ours.
            //
            // _hasText cannot answer for it, which is why the two markers above exist.
            // An OpaqueRange does not expose its node, and the text it spans is the
            // control's `value` — NOT its textContent, which is '' for an <input>
            // however much text the field holds. The usual gate would therefore read "no
            // text" and skip every one of these rects. It also does not need the gate: an
            // OpaqueRange only ever spans a form control's value, so it is text by
            // construction. _rectIsKnown still applies, so a rect whose four raw numbers
            // sit on the device pixel grid is still handed back untouched.
            //
            // Nothing here can run on the browsers the suite drives — Chromium 151 has no
            // OpaqueRange — and branded Chrome refuses --load-extension, so no rig on this
            // machine can execute this path. It is checked in the browser the user
            // actually runs, by afp-console-check.js, which skips the check where the
            // class is absent and says so rather than passing silently.
            if (typeof OpaqueRange !== 'undefined' && OpaqueRange.prototype &&
                typeof OpaqueRange.prototype.getBoundingClientRect === 'function') {
                var _origOGBCR = OpaqueRange.prototype.getBoundingClientRect;
                OpaqueRange.prototype.getBoundingClientRect = _mn(function getBoundingClientRect() {
                    return _markValueRect(_origOGBCR.call(this));
                });
                var _origOGCR = OpaqueRange.prototype.getClientRects;
                if (typeof _origOGCR === 'function') {
                    OpaqueRange.prototype.getClientRects = _mn(function getClientRects() {
                        return _markValueRectList(_origOGCR.call(this));
                    });
                }
            }
        } catch(_) {}
    })();


})();
