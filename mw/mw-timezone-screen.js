(function () {
    'use strict';
    var MW = window.__AFP_MW__;
    // [FIX eight-copies-of-the-profile-reader] _prof used to be copied verbatim into every
    // module, each with its OWN memo, so one page load parsed the profile once per module
    // instead of once. The reader now lives in mw-core.js and is taken from MW below.
    if (!MW) return;
    var _prof = MW.prof;
    // [CLEANUP] _STEALTH became unused when [FIX stealth-window-screen-parity] dropped
    // the `if (!_STEALTH)` guard from the window-size masking below — that clamp has to
    // run in stealth too, or screen lies while the viewport does not. Nothing else in
    // this file gates on stealth, so the binding is gone; the reasoning stays at the
    // MASK WINDOW SIZE section.
    var _FEAT = MW.FEAT;
    var ID = MW.ID;
    var _mn = MW.mn;
    var _mnCtor = MW.mnCtor;
    var _getTimezone = MW.getTimezone;
    // [FIX the-standdown-never-fired] The zone follows _getTimezone, which stands itself
    // down in mw-core; the LOCALE is a second value with its own source, and a worker's
    // Intl reports the host's — bare `ru` where the window said en-US.
    var _standDownNow = (MW && MW.standDownNow) ? MW.standDownNow : function () { return false; };
    // [FIX host-mode] The screen accessors go native through _def; the window-size clamps
    // below do not go through _def, so they ask this directly. See mw-core.
    var _hostHwNow = (MW && MW.hostHwNow) ? MW.hostHwNow : function () { return false; };
    var _hostResolved = (MW && MW.hostResolved) ? MW.hostResolved : function () { return {}; };
    // [FIX intl-locale-contradicted-navigator-language] Read LIVE, not at install: the
    // Intl locale has to follow whatever navigator.language ends up being, and that is
    // decided by a checkbox the user can move after this file has loaded. See _dtfLocale.
    var _featNow = (MW && MW.featNow) ? MW.featNow : function () { return true; };
    var _RawDate = MW.RawDate;
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
    var _sameVal = MW.sameVal;
    // ===== TIMEZONE =====
    if (!_FEAT.timezone) { /* disabled in options */ } else
    (function() {
        try {
            // [FIX #tz-staleness] Раньше forcedTimezone был обычной var, вычисленной
            // ОДИН РАЗ здесь через _getTimezone() в момент document_start — тот же
            // класс проблемы, что уже описан в комментарии [FIX #profile-staleness]
            // выше про ID (профиль устройства), но фикс тогда применили только к ID
            // (через Proxy), а про forcedTimezone забыли. profile-injector.js в этот
            // момент либо ещё не получил реальный профиль от background.js (тот
            // приходит асинхронно через executeScript, на ~сотни ms позже), либо
            // подставляет профиль ПРЕДЫДУЩЕГО сайта из sessionStorage — и это
            // значение потом навсегда замыкается во всех Intl/Date патчах ниже,
            // даже когда _prof() обновляется через ~300ms. Итог:
            // таймзона правильная только если background.js успел выиграть гонку
            // до этой точки — на новой вкладке/домене обычно проигрывает.
            // Фикс: forcedTimezone теперь функция, вызываемая заново в каждом
            // месте использования (как ID уже делает через Proxy для остального
            // профиля), а не одноразовый снимок var.
            var forcedTimezone = function() { return _getTimezone(); };
            
            var ZONE_DATA = {
                'Europe/Tallinn': { base: -120, r: 1, std: 'Eastern European Standard Time', dst: 'Eastern European Summer Time' },
                'Europe/Moscow': { base: -180, r: 0, std: 'Moscow Standard Time', dst: 'Moscow Standard Time' },
                'Europe/Kiev': { base: -120, r: 1, std: 'Eastern European Standard Time', dst: 'Eastern European Summer Time' },
                'Europe/Berlin': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Paris': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Rome': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Madrid': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Amsterdam': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Warsaw': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Stockholm': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Oslo': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Copenhagen': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Prague': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Vienna': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Zurich': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Budapest': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Brussels': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Luxembourg': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/London': { base: 0, r: 1, std: 'Greenwich Mean Time', dst: 'British Summer Time' },
                'Europe/Dublin': { base: 0, r: 1, std: 'Greenwich Mean Time', dst: 'Irish Summer Time' },
                'Europe/Lisbon': { base: 0, r: 1, std: 'Western European Standard Time', dst: 'Western European Summer Time' },
                'Europe/Helsinki': { base: -120, r: 1, std: 'Eastern European Standard Time', dst: 'Eastern European Summer Time' },
                'Europe/Riga': { base: -120, r: 1, std: 'Eastern European Standard Time', dst: 'Eastern European Summer Time' },
                'Europe/Vilnius': { base: -120, r: 1, std: 'Eastern European Standard Time', dst: 'Eastern European Summer Time' },
                'Europe/Sofia': { base: -120, r: 1, std: 'Eastern European Standard Time', dst: 'Eastern European Summer Time' },
                'Europe/Bucharest': { base: -120, r: 1, std: 'Eastern European Standard Time', dst: 'Eastern European Summer Time' },
                'Europe/Athens': { base: -120, r: 1, std: 'Eastern European Standard Time', dst: 'Eastern European Summer Time' },
                'Europe/Istanbul': { base: -180, r: 0, std: 'Turkey Standard Time', dst: 'Turkey Standard Time' },
                'Europe/Belgrade': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Bratislava': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Ljubljana': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Zagreb': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Europe/Malta': { base: -60, r: 1, std: 'Central European Standard Time', dst: 'Central European Summer Time' },
                'Atlantic/Reykjavik': { base: 0, r: 0, std: 'Greenwich Mean Time', dst: 'Greenwich Mean Time' },
                'America/New_York': { base: 300, r: 2, std: 'Eastern Standard Time', dst: 'Eastern Daylight Time' },
                'America/Toronto': { base: 300, r: 2, std: 'Eastern Standard Time', dst: 'Eastern Daylight Time' },
                'America/Chicago': { base: 360, r: 2, std: 'Central Standard Time', dst: 'Central Daylight Time' },
                'America/Denver': { base: 420, r: 2, std: 'Mountain Standard Time', dst: 'Mountain Daylight Time' },
                'America/Los_Angeles': { base: 480, r: 2, std: 'Pacific Standard Time', dst: 'Pacific Daylight Time' },
                'America/Mexico_City': { base: 360, r: 0, std: 'Central Standard Time', dst: 'Central Standard Time' },
                'America/Bogota': { base: 300, r: 0, std: 'Colombia Standard Time', dst: 'Colombia Standard Time' },
                'America/Lima': { base: 300, r: 0, std: 'Peru Standard Time', dst: 'Peru Standard Time' },
                'America/Santiago': { base: 240, r: 5, std: 'Chile Standard Time', dst: 'Chile Summer Time' },
                'America/Buenos_Aires': { base: 180, r: 0, std: 'Argentina Standard Time', dst: 'Argentina Standard Time' },
                'America/Sao_Paulo': { base: 180, r: 0, std: 'Brasilia Standard Time', dst: 'Brasilia Standard Time' },
                'Asia/Tokyo': { base: -540, r: 0, std: 'Japan Standard Time', dst: 'Japan Standard Time' },
                'Asia/Shanghai': { base: -480, r: 0, std: 'China Standard Time', dst: 'China Standard Time' },
                'Asia/Seoul': { base: -540, r: 0, std: 'Korea Standard Time', dst: 'Korea Standard Time' },
                'Asia/Kolkata': { base: -330, r: 0, std: 'India Standard Time', dst: 'India Standard Time' },
                'Asia/Singapore': { base: -480, r: 0, std: 'Singapore Standard Time', dst: 'Singapore Standard Time' },
                'Asia/Hong_Kong': { base: -480, r: 0, std: 'Hong Kong Standard Time', dst: 'Hong Kong Standard Time' },
                'Asia/Taipei': { base: -480, r: 0, std: 'Taipei Standard Time', dst: 'Taipei Standard Time' },
                'Asia/Bangkok': { base: -420, r: 0, std: 'Indochina Time', dst: 'Indochina Time' },
                'Asia/Ho_Chi_Minh': { base: -420, r: 0, std: 'Indochina Time', dst: 'Indochina Time' },
                'Asia/Jakarta': { base: -420, r: 0, std: 'Western Indonesia Time', dst: 'Western Indonesia Time' },
                'Asia/Kuala_Lumpur': { base: -480, r: 0, std: 'Malaysia Time', dst: 'Malaysia Time' },
                'Asia/Manila': { base: -480, r: 0, std: 'Philippine Standard Time', dst: 'Philippine Standard Time' },
                'Asia/Dubai': { base: -240, r: 0, std: 'Gulf Standard Time', dst: 'Gulf Standard Time' },
                'Asia/Riyadh': { base: -180, r: 0, std: 'Arabia Standard Time', dst: 'Arabia Standard Time' },
                'Asia/Tehran': { base: -210, r: 0, std: 'Iran Standard Time', dst: 'Iran Standard Time' },
                'Asia/Karachi': { base: -300, r: 0, std: 'Pakistan Standard Time', dst: 'Pakistan Standard Time' },
                'Asia/Dhaka': { base: -360, r: 0, std: 'Bangladesh Standard Time', dst: 'Bangladesh Standard Time' },
                'Asia/Baghdad': { base: -180, r: 0, std: 'Arabia Standard Time', dst: 'Arabia Standard Time' },
                'Australia/Sydney': { base: -600, r: 3, std: 'Australian Eastern Standard Time', dst: 'Australian Eastern Daylight Time' },
                'Pacific/Auckland': { base: -720, r: 4, std: 'New Zealand Standard Time', dst: 'New Zealand Daylight Time' },
                'Africa/Johannesburg': { base: -120, r: 0, std: 'South Africa Standard Time', dst: 'South Africa Standard Time' },
                'Africa/Cairo': { base: -120, r: 6, std: 'Eastern European Standard Time', dst: 'Eastern European Summer Time' },
                'Africa/Lagos': { base: -60, r: 0, std: 'West Africa Standard Time', dst: 'West Africa Standard Time' },
                'Africa/Casablanca': { base: -60, r: 0, std: 'GMT+01:00', dst: 'GMT+01:00' },
                'Africa/Nairobi': { base: -180, r: 0, std: 'East Africa Time', dst: 'East Africa Time' },
                'Asia/Jerusalem': { base: -120, r: 7, std: 'Israel Standard Time', dst: 'Israel Daylight Time' },
                'Asia/Nicosia': { base: -120, r: 1, std: 'Eastern European Standard Time', dst: 'Eastern European Summer Time' }
            };
            
            // [FIX dst-rules-were-guessed-from-the-tz-prefix] DST used to be decided by
            // sniffing the zone id: anything under Europe/ got the EU rule, anything under
            // America/ the US rule, Australia/ and Pacific/Auckland a month range, and every
            // remaining zone whose std/dst labels happened to differ got a generic "northern
            // summer" range. A hand-kept noDSTZones list was the only escape hatch, and it was
            // incomplete.
            // Measured against real ICU on the 15th of every month of 2026, for the 67 zones
            // the country picker can actually select (test/tz-icu.mjs):
            //   Europe/Istanbul      7/12 months wrong — Turkey dropped DST in 2016
            //   Asia/Tehran          7/12 wrong        — Iran dropped DST in 2022
            //   America/Mexico_City  8/12 wrong        — Mexico dropped DST in 2022
            //   America/Santiago     9/12 wrong        — southern hemisphere, DST inverted
            //   Africa/Casablanca    3/12 wrong        — base said UTC+0, Morocco is UTC+1
            //   Africa/Cairo 1/12, Australia/Sydney 1/12, Pacific/Auckland 1/12
            // Worse than any wrong value: FIVE of those disagreed with the worker's own copy
            // of this logic (_tzShim in mw/mw-workers.js), which sniffed the prefix slightly
            // differently. A page reading new Date().getTimezoneOffset() in the window and
            // again inside a Worker got two different numbers — the cheapest tampering signal
            // there is, and the one this file exists to prevent.
            // Now: every zone carries an explicit rule id 'r' in ZONE_DATA above, and BOTH
            // scopes run the same engine over it. Verified against ICU day by day, 2024-2027,
            // for every shipped zone.
            //   0 none   1 EU   2 US/Canada   3 Australia
            //   4 New Zealand   5 Chile   6 Egypt   7 Israel
            // KNOWN LIMIT: Africa/Casablanca is modelled as permanent UTC+1. Morocco is
            // legally UTC+1 all year but suspends it for Ramadan, which moves ~11 days a year
            // on the lunar calendar; reproducing that needs a Hijri calendar in both scopes.
            // The approximation is right ~330 days a year and, crucially, is identical in the
            // window and the worker. test/tz-icu.mjs asserts this exemption by name so it
            // cannot rot silently.

            // nth (1-based) weekday 'dow' of month m, as a UTC midnight timestamp
            function nthDowUTC(y, m, dow, n) {
                var first = OrigDateUTC(y, m, 1);
                var fd = new OrigDate(first).getUTCDay();
                return OrigDateUTC(y, m, 1 + ((dow - fd + 7) % 7) + (n - 1) * 7);
            }
            // last weekday 'dow' of month m, as a UTC midnight timestamp
            function lastDowUTC(y, m, dow) {
                var last = new OrigDate(OrigDateUTC(y, m + 1, 0));
                return OrigDateUTC(y, m, last.getUTCDate() - ((last.getUTCDay() - dow + 7) % 7));
            }

            // [FIX #tz-staleness] zoneData used to be a var computed once from a frozen
            // forcedTimezone — same bug, same fix: a function, not a snapshot.
            function getZoneData() {
                return ZONE_DATA[_getTimezone()] || ZONE_DATA['America/New_York'];
            }

            // base is the STANDARD offset in this file's convention (positive = west of UTC),
            // ts a UTC instant. Southern-hemisphere rules (3/4/5) span the new year, hence
            // 'ts >= start || ts < end' rather than '&&'.
            function isDSTByRule(rule, base, ts) {
                if (!rule) return false;
                var H = 3600000;
                var y = new OrigDate(ts).getUTCFullYear();
                if (rule === 1) {   // EU: last Sun Mar 01:00 UTC -> last Sun Oct 01:00 UTC
                    return ts >= lastDowUTC(y, 2, 0) + H && ts < lastDowUTC(y, 9, 0) + H;
                }
                if (rule === 2) {   // US/Canada: 2nd Sun Mar 02:00 std -> 1st Sun Nov 02:00 dst
                    return ts >= nthDowUTC(y, 2, 0, 2) + (2 + base / 60) * H &&
                           ts <  nthDowUTC(y, 10, 0, 1) + (2 + (base - 60) / 60) * H;
                }
                if (rule === 3) {   // Australia: 1st Sun Oct 02:00 std -> 1st Sun Apr 03:00 dst
                    return ts >= nthDowUTC(y, 9, 0, 1) + (2 + base / 60) * H ||
                           ts <  nthDowUTC(y, 3, 0, 1) + (3 + (base - 60) / 60) * H;
                }
                if (rule === 4) {   // New Zealand: last Sun Sep 02:00 std -> 1st Sun Apr 03:00 dst
                    return ts >= lastDowUTC(y, 8, 0) + (2 + base / 60) * H ||
                           ts <  nthDowUTC(y, 3, 0, 1) + (3 + (base - 60) / 60) * H;
                }
                if (rule === 5) {   // Chile: the day AFTER the first Saturday — NOT simply the
                                    // first Sunday; they differ whenever the 1st is a Sunday
                                    // (Sep 2024: real transition Sep 8, first Sunday was Sep 1)
                    return ts >= nthDowUTC(y, 8, 6, 1) + 86400000 + 4 * H ||
                           ts <  nthDowUTC(y, 3, 6, 1) + 86400000 + 3 * H;
                }
                if (rule === 6) {   // Egypt: last Fri Apr 00:00 std -> last Thu Oct 24:00 dst
                    return ts >= lastDowUTC(y, 3, 5) + (base / 60) * H &&
                           ts <  lastDowUTC(y, 9, 4) + (24 + (base - 60) / 60) * H;
                }
                if (rule === 7) {   // Israel: Fri before last Sun Mar 02:00 -> last Sun Oct 02:00
                    return ts >= lastDowUTC(y, 2, 0) - 2 * 86400000 + (2 + base / 60) * H &&
                           ts <  lastDowUTC(y, 9, 0) + (2 + (base - 60) / 60) * H;
                }
                return false;
            }

            var OrigDate = _RawDate, OrigDateProto = OrigDate.prototype, OrigDateUTC = OrigDate.UTC, OrigDateParse = OrigDate.parse, OrigDateNow = OrigDate.now;
            // Captured BEFORE the patch below replaces it — _reinterpretLocal needs the
            // HOST's real offset to undo the native parser's work, which is precisely the
            // thing every other line in this file exists to hide.
            // (getTimezoneOffset itself is no longer captured: _reinterpretLocal reads the native local getters.)
            // [FIX the-zone-model-had-no-history] The host's local FIELDS, native, for
            // _reinterpretLocal: undoing the native parser with getTimezoneOffset() lost
            // the seconds of an LMT host — Moscow's +02:30:17 left 17 s in every pre-1880
            // date the page parsed (measured against Node in the zone, 1113).
            var OrigLocal = {
                y: OrigDateProto.getFullYear, mo: OrigDateProto.getMonth, d: OrigDateProto.getDate,
                h: OrigDateProto.getHours, mi: OrigDateProto.getMinutes, s: OrigDateProto.getSeconds,
                ms: OrigDateProto.getMilliseconds
            };
            
            // [FIX redundant-zone-lookups-in-the-hot-path] Resolves the zone row and the
            // DST decision for one instant in a SINGLE profile read. The Date methods used
            // to call getZoneData() and isDSTForDate() separately — and isDSTForDate calls
            // getZoneData() itself — so getHours() resolved the profile four times over and
            // toString() eight, each one a sessionStorage read plus a compare of the whole
            // profile string. Measured in dev-datecost.html.
            // [PERF zone-lookup-per-getter] tools/probe-cost.mjs, 2026-09-03: Date.prototype
            // .getHours cost 66x native (5 → 330 ns) and getTimezoneOffset 7x, because every
            // local getter resolved the zone's DST rule from scratch — the year, two
            // transition Sundays, several Date allocations — and getLocalFromUTC then built
            // a 7-closure object to read one field of. A rule has three intervals a year in
            // which the answer is constant; the one containing the last instant asked about
            // is kept, and the next call inside it is two comparisons. The bounds come from
            // the same formulas isDSTByRule holds, which stays as the reference the oracle
            // suites compare against (test/tz-oracle.mjs, the ICU table suite). Measured
            // after: see CHANGELOG-AUDIT v2.5.3.
            var _dstMemo = { zd: null, lo: 0, hi: 0, dst: false };
            function _dstBounds(rule, base, y) {
                var H = 3600000, D = 86400000;
                if (rule === 1) return [lastDowUTC(y, 2, 0) + H, lastDowUTC(y, 9, 0) + H, false];
                if (rule === 2) return [nthDowUTC(y, 2, 0, 2) + (2 + base / 60) * H, nthDowUTC(y, 10, 0, 1) + (2 + (base - 60) / 60) * H, false];
                if (rule === 3) return [nthDowUTC(y, 9, 0, 1) + (2 + base / 60) * H, nthDowUTC(y, 3, 0, 1) + (3 + (base - 60) / 60) * H, true];
                if (rule === 4) return [lastDowUTC(y, 8, 0) + (2 + base / 60) * H, nthDowUTC(y, 3, 0, 1) + (3 + (base - 60) / 60) * H, true];
                if (rule === 5) return [nthDowUTC(y, 8, 6, 1) + D + 4 * H, nthDowUTC(y, 3, 6, 1) + D + 3 * H, true];
                if (rule === 6) return [lastDowUTC(y, 3, 5) + (base / 60) * H, lastDowUTC(y, 9, 4) + (24 + (base - 60) / 60) * H, false];
                if (rule === 7) return [lastDowUTC(y, 2, 0) - 2 * D + (2 + base / 60) * H, lastDowUTC(y, 9, 0) + (2 + (base - 60) / 60) * H, false];
                return null;
            }
            function _dstAt(zd, ts) {
                if (!zd.r) return false;
                if (_dstMemo.zd === zd && ts >= _dstMemo.lo && ts < _dstMemo.hi) return _dstMemo.dst;
                var y = new OrigDate(ts).getUTCFullYear();
                var b = _dstBounds(zd.r, zd.base, y);
                if (!b) return false;
                var yLo = OrigDateUTC(y, 0, 1), yHi = OrigDateUTC(y + 1, 0, 1), s = b[0], e = b[1], lo, hi, dst;
                if (!b[2]) {            // northern: [yLo,s) off, [s,e) on, [e,yHi) off
                    if (ts < s) { lo = yLo; hi = s; dst = false; }
                    else if (ts < e) { lo = s; hi = e; dst = true; }
                    else { lo = e; hi = yHi; dst = false; }
                } else {                // southern: [yLo,e) on, [e,s) off, [s,yHi) on
                    if (ts < e) { lo = yLo; hi = e; dst = true; }
                    else if (ts < s) { lo = e; hi = s; dst = false; }
                    else { lo = s; hi = yHi; dst = true; }
                }
                _dstMemo.zd = zd; _dstMemo.lo = lo; _dstMemo.hi = hi; _dstMemo.dst = dst;
                return dst;
            }
            // [FIX the-zone-model-had-no-history] The rule table knows one standard offset
            // and one DST rule per zone — the CURRENT ones — and applied them to every year
            // there is: 1113 in Europe/Tallinn came out as UTC+3 (the summer rule), where
            // ICU, and so every clean browser, has LMT +01:39:00. CreepJS's timezone test
            // builds exactly that instant (+new Date('7/1/1113')) and looks the epoch up in
            // a table of every zone's 1113 offset: ours matched no city and the location was
            // called fake. It had passed before today only because an M/D/YYYY string used
            // to reach the native parser in the HOST's zone, which happened to be the
            // profile's — a coincidence, and a host-zone leak for anyone else. So: before
            // 2024-01-01, the first day test/tz-icu.mjs verifies the rule model on, the
            // offset comes from ICU itself, for the zone in force (the profile's, or the
            // host's on a stand-down), through the DateTimeFormat captured before anything
            // was patched — memoised per hour, since offsets change at transitions and
            // nowhere else, and with the seconds LMT carries (V8 answers -150.28333 for
            // Moscow's +02:30:17 as well). From 2024 on the rule model answers, in two
            // comparisons.
            // [FIX the-rule-table-was-the-source-of-truth] ICU answers for EVERY instant now,
            // not only before 2024. The hand-written table knew one standard offset and one DST
            // rule per zone — right for the years it was written in, wrong for history (the
            // 1113 report), and one tzdata update away from being wrong for the future too:
            // Egypt, Chile, Iran and Mexico have all changed rules since this project began,
            // and nothing here would have noticed. ICU ships with the browser and is what
            // every other page on the machine agrees with.
            //
            // The cost is paid once per zone and YEAR, not per read. Offsets change only at
            // transitions, so the year's transitions are FOUND — a sample every seven days, then
            // a binary search to the minute wherever two neighbours differ — and the intervals
            // between them are cached. A year with no transition costs 53 ICU reads, one with two
            // costs about 90; every read afterwards is two comparisons (_icuLast), or a scan of a
            // handful of intervals when it lands in another one. Morocco's Ramadan break falls
            // out of the same search without being special-cased.
            //
            // The bound: two transitions inside ONE seven-day gap would be invisible — the offset
            // dips and returns, and both ends of the gap read the same. tzdata records no period
            // that short; the shortest here is Morocco's break, five weeks. Month-wide samples
            // were the first version and would not have held that.
            //
            // The memo _icuOffsetAt keeps is keyed per MINUTE, and only the search reads it: an
            // hour-wide key made every probe inside one hour give the same answer, so a
            // transition at :30 could not be located — Tehran's 20:30Z and Kolkata's 17:30Z both
            // came out an hour off (test/tz-icu.mjs section 4, before this).
            //
            // The rule table stays as the fallback for a realm where the captured formatter
            // is gone, and test/tz-icu.mjs still holds it to ICU across every zone and four
            // years — so the path that answers when ICU cannot is not left unverified.
            var _icuFmt = {};
            var _icuMemo = new Map();
            var _icuYears = {};       // tz -> { year -> [{lo, hi, off}, …] }
            var _ICU_MIN_YEAR = -270000, _ICU_MAX_YEAR = 270000;
            function _icuOffsetAt(tz, ts) {
                if (!OrigDTF || !_ftp || !tz || !isFinite(ts)) return null;
                var key = tz + '|' + Math.floor(ts / 60000);
                var hit = _icuMemo.get(key);
                if (hit !== undefined) return hit;
                var f = _icuFmt[tz];
                if (!f) {
                    try {
                        f = new OrigDTF('en-US', { timeZone: tz, era: 'short', year: 'numeric', month: 'numeric',
                            day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
                    } catch (e) { return null; }
                    _icuFmt[tz] = f;
                }
                var parts, v = {};
                try { parts = _ftp.call(f, new OrigDate(ts)); } catch (e2) { return null; }
                for (var i = 0; i < parts.length; i++) v[parts[i].type] = parts[i].value;
                var y = parseInt(v.year, 10);
                if (!isFinite(y)) return null;
                if (v.era && /^B/.test(v.era)) y = 1 - y;
                var d = new OrigDate(0);
                d.setUTCFullYear(y, parseInt(v.month, 10) - 1, parseInt(v.day, 10));
                d.setUTCHours(parseInt(v.hour, 10) % 24, parseInt(v.minute, 10), parseInt(v.second, 10), 0);
                var off = (Math.floor(ts / 1000) * 1000 - d.getTime()) / 60000;
                if (!isFinite(off)) return null;
                if (_icuMemo.size > 2048) _icuMemo.clear();
                _icuMemo.set(key, off);
                return off;
            }
            /** The instant a transition happens, to the minute, between two offsets. */
            function _icuTransition(tz, lo, hi, offLo) {
                // In whole minutes: tzdata puts transitions on a minute, and a search in
                // milliseconds only ever wastes probes on instants that cannot be one.
                var a = Math.floor(lo / 60000), b = Math.ceil(hi / 60000);
                while (b - a > 1) {
                    var m = a + Math.floor((b - a) / 2);
                    var o = _icuOffsetAt(tz, m * 60000);
                    if (o === null) return null;
                    if (o === offLo) a = m; else b = m;
                }
                return b * 60000;
            }
            /** Every constant-offset interval of one UTC year, from ICU. */
            function _icuYearIntervals(tz, y) {
                var byYear = _icuYears[tz] || (_icuYears[tz] = {});
                if (byYear[y]) return byYear[y];
                if (y < _ICU_MIN_YEAR || y > _ICU_MAX_YEAR) return null;
                var yLo = OrigDateUTC(y, 0, 1), yHi = OrigDateUTC(y + 1, 0, 1);
                if (!isFinite(yLo) || !isFinite(yHi)) return null;
                var pts = [], i;
                for (var t = yLo; t < yHi; t += 604800000) pts.push(t);
                pts.push(yHi);
                var offs = [];
                for (i = 0; i < pts.length; i++) {
                    var at = i === pts.length - 1 ? pts[i] - 1 : pts[i];
                    var o = _icuOffsetAt(tz, at);
                    if (o === null) return null;
                    offs.push(o);
                }
                var out = [], lo = yLo, cur = offs[0];
                for (i = 0; i < offs.length - 1; i++) {
                    if (offs[i + 1] === offs[i]) continue;
                    var t = _icuTransition(tz, pts[i], i === pts.length - 2 ? pts[i + 1] - 1 : pts[i + 1], offs[i]);
                    if (t === null) return null;
                    out.push({ lo: lo, hi: t, off: cur });
                    lo = t; cur = offs[i + 1];
                }
                out.push({ lo: lo, hi: yHi, off: cur });
                // A year is at most a handful of intervals; a search gone wrong would be a
                // memory leak rather than a wrong answer, so it is bounded here.
                if (out.length > 24) return null;
                byYear[y] = out;
                if (Object.keys(byYear).length > 40) _icuYears[tz] = {};
                return out;
            }
            /** ICU's offset for this zone at this instant, in minutes west of UTC. */
            // The interval of the LAST answer, checked first: two comparisons for every read
            // that lands where the previous one did, which is what a page reading a clock
            // does. Without it each read allocated a Date for its year and scanned the
            // year's intervals — measured at 105 ns against 65 for the rule memo it
            // replaced, and 70 with this (tools/probe-cost.mjs).
            var _icuLast = { tz: null, lo: 0, hi: 0, off: 0 };
            function _icuZoneAt(tz, ts) {
                if (!tz || !isFinite(ts)) return null;
                if (tz === _icuLast.tz && ts >= _icuLast.lo && ts < _icuLast.hi) return _icuLast.off;
                var y = new OrigDate(ts).getUTCFullYear();
                if (!isFinite(y)) return null;
                var iv = _icuYearIntervals(tz, y);
                if (!iv) return null;
                for (var i = 0; i < iv.length; i++) {
                    if (ts >= iv[i].lo && ts < iv[i].hi) {
                        _icuLast.tz = tz; _icuLast.lo = iv[i].lo; _icuLast.hi = iv[i].hi; _icuLast.off = iv[i].off;
                        return iv[i].off;
                    }
                }
                return null;
            }
            // [FIX the-date-wrappers-named-an-internal-variable-in-their-error]
            //
            // Every local getter below routes through zoneAt / getLocalFromUTC, and both read
            // the instant as `utcDate.getTime()`. On a receiver that is not a Date that is a
            // plain JS TypeError about OUR variable, and the page reads it in one line:
            //
            //   Date.prototype.getDate.call({})
            //     clean  TypeError: this is not a Date object.
            //     ours   TypeError: utcDate.getTime is not a function
            //
            // Measured by the method half of test/receivers.mjs. It is the accessor lesson of
            // v2.5.11 again — do not describe the refusal, ask the platform — plus something
            // worse than a wrong message: the name of an internal is an extension signature,
            // the class [FIX extension-id-leaked-in-error-stacks] exists for.
            //
            // The capture is the native `getTime`, taken before anything here is installed and
            // never patched by this file (nothing touches the getUTC*/getTime family, which is
            // exactly why getLocalFromUTC can build a plain Date and read its UTC fields).
            // Calling it with the caller's receiver reproduces the platform's own error, for
            // exactly the receivers the platform refuses, cross-realm Dates included.
            var _natGetTime = OrigDateProto.getTime;
            function _instantOf(d) { return _natGetTime.call(d); }

            // …but getTime's message is getTime's. V8 names the METHOD and the receiver:
            //
            //   Date.prototype.getYear.call({})
            //     clean  TypeError: Method Date.prototype.getYear called on incompatible receiver #<Object>
            //     via getTime  TypeError: this is not a Date object.
            //
            // so every wrapper has to answer with ITS OWN native's refusal. _dateGuard does
            // that without putting a second native call on the hot path: the ordinary read is
            // the try branch and costs nothing, and only a receiver that made our own body
            // throw pays for the platform's verdict. If the native unexpectedly does NOT
            // refuse, our original error is rethrown rather than swallowed — a silent
            // difference would be worse than either message.
            // Captured here, where every one of them is still the platform's — the wrappers
            // below this point are what replace them.
            var _DATE_PATCHED = ['getTimezoneOffset', 'toLocaleString', 'toLocaleDateString',
                'toLocaleTimeString', 'toString', 'toTimeString', 'toDateString', 'getFullYear',
                'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds',
                'setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes', 'setSeconds',
                'setMilliseconds', 'getYear', 'setYear'];
            var _dateNatives = {};
            for (var _dn = 0; _dn < _DATE_PATCHED.length; _dn++) {
                try { _dateNatives[_DATE_PATCHED[_dn]] = OrigDateProto[_DATE_PATCHED[_dn]]; } catch (eDn) {}
            }
            function _dateGuard(name) {
                var nat = _dateNatives[name], wrapped = OrigDateProto[name];
                if (typeof nat !== 'function' || typeof wrapped !== 'function') return;
                var g = ({ [name]: function () {
                    try { return wrapped.apply(this, arguments); }
                    catch (e) { nat.apply(this, arguments); throw e; }
                } })[name];
                // A rest-less wrapper reports .length 0, and the wrapper it replaces reported
                // the native's arity — dev-vsnative.html and dev-allfn.html caught exactly that
                // on setHours the first time this landed. Same class as [FIX anon-fn-name-length].
                try { Object.defineProperty(g, 'length', { value: nat.length, configurable: true }); } catch (eL) {}
                OrigDateProto[name] = _mn(g);
            }
            // The record form, for the callers that want the zone NAME as well as the offset.
            // It resolves the offset through the same _offAt the hot getters use rather than
            // repeating the fallback arithmetic: `off === zd.base - 60` is what the ICU branch
            // already tested, and it is exactly equivalent on the rule branch, where off is
            // base - 60 when and only when _dstAt said so.
            function zoneAt(utcDate) {
                var ts = _instantOf(utcDate), tz = _getTimezone();
                var zd = ZONE_DATA[tz] || ZONE_DATA['America/New_York'];
                var off = _offAt(tz, ts);
                return { zd: zd, dst: off === zd.base - 60, off: off };
            }
            // [FIX the-hot-getters-paid-for-a-record-they-threw-away]
            //
            // Eight local getters — getHours, getDate, getDay and the rest — want ONE number,
            // the offset, and every one of them went through zoneAt(), which builds a record:
            //
            //   getZoneData()            _getTimezone() + a ZONE_DATA lookup, for a field
            //                            (.zd) only the fallback and the string methods read
            //   _instantOf(utcDate)      then getLocalFromUTC calls it a second time
            //   _icuZoneAt(_getTimezone(), ts)   _getTimezone() AGAIN
            //   { zd: …, dst: …, off: … }        an object allocated to be read once
            //
            // so a getHours() cost two calls into the profile, two reads of the instant, a
            // table lookup and two allocations, to return an hour. Measured against a stock
            // browser by tools/probe-timing.mjs, in units of a platform property NEITHER
            // browser substitutes (navigator.onLine), this getter ran 87x native while the
            // patched-Chromium build that claims the same zone ran at 0.7x — it changes the
            // zone ICU resolves and leaves the intrinsic alone, so it pays nothing at all.
            // That gap is readable from any page with no permission and no reference browser:
            // a native getHours can be hoisted out of a loop and a JS one cannot.
            //
            // The record is still built where it is genuinely wanted (toString and friends
            // need .zd and .dst for the zone NAME), so zoneAt stays exactly as it was and
            // this is the numeric door beside it. _icuZoneAt already holds the interval that
            // contains the last instant asked about, so the steady-state cost here is one
            // profile read and three comparisons.
            function _offAt(tz, ts) {
                var o = _icuZoneAt(tz, ts);
                if (o !== null) return o;
                var zd = ZONE_DATA[tz] || ZONE_DATA['America/New_York'];
                return zd.base + (_dstAt(zd, ts) ? -60 : 0);
            }
            function getLocalFromUTC(utcDate) {
                // [FIX #1] Вычисляем offset динамически для конкретной даты —
                // статичный currentOffset неверен для дат в другом DST-периоде.
                // The shifted instant as a plain Date: its UTC getters are the local fields,
                // and they are native — nothing here patches getUTC*.
                //
                // _instantOf first, so a receiver the platform refuses throws the platform's
                // own error before anything here touches the profile — the order zoneAt had.
                var ts = _instantOf(utcDate);
                return new OrigDate(ts - _offAt(_getTimezone(), ts) * 60000);
            }
            

            // [FIX date-value-construction-used-the-host-zone]
            //
            // getTimezoneOffset(), toString() and every local getter answered from the
            // profile, but the VALUE side — the epoch a Date is built from — did not. Only
            // two string shapes were special-cased in the constructor below; numeric
            // arguments and every other local-time string went straight to the engine,
            // which interprets them in the HOST zone. Measured on a Moscow host under an
            // America/New_York profile:
            //
            //   Date.UTC(y,6,15) - new Date(y,6,15)                    180   (host UTC+3)
            //   Date.parse(iso + 'Z') - Date.parse(iso)                180
            //   new Date(y,6,15).getTimezoneOffset()                   240   (profile)
            //
            // Two lines of arithmetic hand a page the real zone. Worse, the answers
            // contradict each other inside one object — the offset says New York while the
            // instant it is attached to says Moscow — and a self-contradiction is a
            // stronger signal than either value alone. deviceinfo.me and the worker branch
            // of CreepJS both read the arithmetic, not the getter.
            //
            // Wall clock -> UTC. The offset depends on the instant and the instant depends
            // on the offset, so it resolves twice: guess with the standard offset, then
            // re-read the offset at the candidate instant and redo it if the guess landed
            // on the other side of a transition. The one hour DST skips and the one it
            // repeats stay ambiguous — the engine picks a side there too, and no choice is
            // more "correct" than the other.
            // `naive` is the wall clock read as if it were UTC; the result is the instant.
            // Shared by the constructor (_wallToUTC) and the setters (_wallFieldsToUTC).
            // [FIX the-repeated-hour-resolved-to-the-later-instant] The order is the spec's
            // (ECMA-262, UTC(t)): a wall clock in the REPEATED hour of a fall-back is the
            // earlier instant, the one still on daylight time; a wall clock in the SKIPPED
            // hour of a spring-forward uses the offset from before the transition, standard
            // time. The old resolver guessed standard time first and re-checked, so in the
            // repeated hour it landed on the later instant — measured against Node in the
            // zone, one second either side of both edges of both hemispheres
            // (test/tz-oracle.mjs dstEdgesWall): 01:59:59 on 2026-11-01 in New York came
            // back an hour late, 02:00:00 on 2026-04-05 in Sydney likewise. The daylight
            // candidate first, kept only if the rule agrees it is daylight time there.
            function _naiveToUTC(naive) {
                var zd = getZoneData();
                {
                    // [FIX the-zone-model-had-no-history] Through ICU: the offsets twelve
                    // hours either side of the wall clock are the two the instant can carry;
                    // a candidate holds when the offset at the instant it names is its own.
                    // Both hold in a repeated hour (the earlier wins, as the spec says),
                    // neither in a skipped one (the offset from before the transition).
                    var tz = _getTimezone();
                    var o1 = _icuZoneAt(tz, naive - 43200000), o2 = _icuZoneAt(tz, naive + 43200000);
                    if (o1 !== null && o2 !== null) {
                        if (o1 === o2) return naive + o1 * 60000;
                        var t1 = naive + o1 * 60000, t2 = naive + o2 * 60000;
                        var ok1 = _icuZoneAt(tz, t1) === o1, ok2 = _icuZoneAt(tz, t2) === o2;
                        if (ok1 && ok2) return Math.min(t1, t2);
                        if (ok1) return t1;
                        if (ok2) return t2;
                        return naive + Math.max(o1, o2) * 60000;
                    }
                }
                if (zd.r) {
                    var tsD = naive + (zd.base - 60) * 60000;
                    if (_dstAt(zd, tsD)) return tsD;
                }
                return naive + zd.base * 60000;
            }
            function _wallToUTC(y, mo, d, h, mi, s, ms) {
                var naive = OrigDateUTC(y, mo, d, h, mi, s, ms);
                if (isNaN(naive)) return NaN;
                return _naiveToUTC(naive);
            }

            // A string the engine parsed as LOCAL time carries the host offset in its
            // result. Strip that offset back off to recover the wall-clock fields the
            // string actually spelled, then re-apply the profile's offset to those.
            // Cheaper and far safer than writing a second date parser: the engine still
            // does all the parsing, including every legacy shape it accepts.
            function _reinterpretLocal(ts) {
                if (isNaN(ts)) return NaN;
                // The wall clock the native parser meant, read back through the native
                // local getters: exact to the millisecond whatever the host's offset was.
                var w = new OrigDate(ts);
                return _wallToUTC(OrigLocal.y.call(w), OrigLocal.mo.call(w), OrigLocal.d.call(w),
                    OrigLocal.h.call(w), OrigLocal.mi.call(w), OrigLocal.s.call(w), OrigLocal.ms.call(w));
            }

            // Which strings the engine treats as local. Anything naming an offset is an
            // absolute instant and must be left alone, and a bare ISO date (YYYY-MM-DD) is
            // UTC by specification — reinterpreting either would move a correct value.
            function _parsedAsLocal(str) {
                var s = String(str);
                if (/\b(?:GMT|UTC|UT)\b/i.test(s)) return false;
                if (/[+-]\d{2}:?\d{2}\s*(?:\([^)]*\))?\s*$/.test(s)) return false;
                if (/[\dT]\s*Z\s*$/i.test(s)) return false;
                if (/^\s*[+-]?\d{4,6}(?:-\d{2}(?:-\d{2})?)?\s*$/.test(s)) return false;
                return true;
            }

            // One implementation behind both `new Date(str)` and `Date.parse(str)`; they
            // disagreeing with each other would be its own tell.
            function _parseLocalAware(str) {
                var ts = OrigDateParse(str);
                if (isNaN(ts)) return NaN;
                return _parsedAsLocal(str) ? _reinterpretLocal(ts) : ts;
            }

            // forcedZoneName зависит от isDST "прямо сейчас" (не для конкретной даты) —
            // используется только в Intl.DateTimeFormat.formatToParts ниже. Раньше был
            // снимком; теперь функция, читающая живую таймзону и живой zoneData при
            // каждом вызове formatToParts, а DST-статус берёт из isDSTForDate(new Date())
            // для консистентности с тем, что видит getTimezoneOffset()/toString() прямо сейчас.
            // [FIX zone-label-used-now-instead-of-the-formatted-date] This ignored its
            // caller's date entirely and asked isDSTForDate(new Date()) — the DST state
            // RIGHT NOW. formatToParts is the one place it is used, and that call always
            // has a specific instant to format, so in August
            //   new Intl.DateTimeFormat('en-US', {timeZone:'Europe/Tallinn',
            //                                     timeZoneName:'long'})
            //     .formatToParts(new Date('2026-01-15T12:00:00Z'))
            // returned "Eastern European Summer Time" for a JANUARY date (measured in
            // dev-dtf-format.html: native says "Eastern European Standard Time").
            // Two things fall out of that, both cheap to detect: the label contradicts
            // Date.prototype.toString() for the very same instant — that one has always
            // used isDSTForDate(this) correctly, a few lines below — and it contradicts
            // the worker, whose zoneName(d) is likewise per-date. The label now comes from
            // the instant being formatted, exactly like every other zone-aware answer in
            // this file.
            // 'when' is what Intl hands format/formatToParts: undefined means now, and
            // anything else is a Date or a number (ECMA-402 coerces via ToNumber, so a
            // Date's valueOf gives the same instant).
            function getForcedZoneName(when) {
                var zd = getZoneData();
                var t = (when === undefined) ? OrigDateNow() : Number(when);
                if (!isFinite(t)) t = OrigDateNow();
                return isDSTByRule(zd.r, zd.base, t) ? zd.dst : zd.std;
            }
            // [FIX zone-name-was-always-english] The table above holds the ENGLISH names,
            // and they were substituted into BOTH Intl results and Date.prototype.toString.
            // Measured on a clean browser, timeZone forced to Europe/Tallinn, and the two
            // APIs agree with each other in every case — the name follows the LOCALE:
            //     host ru  → (Восточная Европа, летнее время)
            //     et-EE    → (Ida-Euroopa suveaeg)
            //     en-US    → (Eastern European Summer Time)
            // So the English label is only ever right for an English profile. It printed a
            // localised date next to an English zone:
            //     laupäev, 15. august 2026, kell 14:27:52 Eastern European Summer Time
            // where a real et-EE browser writes "Ida-Euroopa suveaeg", and a clean ru
            // browser writes "Москва, стандартное время" — measured both ways. The mixed
            // string is a contradiction inside ONE value, no second scope needed to spot it.
            // The substitution itself still earns its place: it guarantees the name belongs
            // to the FORCED zone rather than to whatever the underlying formatter used. So
            // the name is asked of ICU for the formatter's own locale and the forced zone —
            // same guarantee, correct language. The English table stays as the fallback,
            // and as the source for toString.
            // Memoised: Date.prototype.toString goes through here on EVERY call, and
            // building an Intl formatter per call is exactly the kind of cost dev-datecost
            // .html exists to catch (it measures these methods against native — see the
            // note on the profile memo in mw-core.js). The answer only depends on the
            // locale, the style, the forced zone and whether that instant is in DST, so one
            // formatter per distinct combination is enough; a page formatting a thousand
            // dates builds at most two.
            var _znCache = Object.create(null);
            // dev-datecost.html also counts PROFILE READS per call, not just microseconds:
            // toString goes through here every time, and asking for the locale and the zone
            // separately took it from 2 reads to 6. _prof() hands back the same object
            // while the stored string is unchanged (memoised in mw-core.js), so one
            // identity check is enough to know the derived pair is still valid.
            // Zero profile reads in the steady state. The ZONE_DATA row is a stable object
            // per zone, and Date.prototype.toString already holds one from zoneAt(), so the
            // zone id comes from a reverse map instead of another _getTimezone(), and the
            // locale is resolved once per zone. Country and locale are picked together in
            // the popup, so a zone change is the signal that the locale may have moved too.
            var _znIdByData = null;
            function _znZoneId(zd) {
                if (!_znIdByData) {
                    _znIdByData = new WeakMap();
                    try {
                        Object.keys(ZONE_DATA).forEach(function (k) { _znIdByData.set(ZONE_DATA[k], k); });
                    } catch (eM) {}
                }
                var id = null;
                try { id = _znIdByData.get(zd); } catch (eG) {}
                return id || forcedTimezone();
            }
            var _znLocByZd = null;
            function _znLocaleFor(zd) {
                if (!_znLocByZd) { try { _znLocByZd = new WeakMap(); } catch (eW) { return _dtfLocale(); } }
                var hit;
                try { hit = _znLocByZd.get(zd); } catch (eG2) {}
                if (hit !== undefined) return hit;
                var lc = _dtfLocale();
                try { _znLocByZd.set(zd, lc); } catch (eS) {}
                return lc;
            }
            // `dstKnown` lets a caller that already resolved the instant's DST state — Date
            // .prototype.toString has it from zoneAt() — skip resolving it again.
            function localizedZoneName(locale, style, when, dstKnown, zdKnown) {
                var t = (when === undefined) ? OrigDateNow() : Number(when);
                if (!isFinite(t)) t = OrigDateNow();
                var zd = zdKnown || getZoneData();
                var isDst = (dstKnown === undefined) ? isDSTByRule(zd.r, zd.base, t) : !!dstKnown;
                var tzId = _znZoneId(zd);
                var lc = locale || _znLocaleFor(zd) || '';
                var key = lc + '|' + (style || 'long') + '|' + tzId + '|' + (isDst ? 1 : 0);
                var hit = _znCache[key];
                if (hit !== undefined) return hit;
                var out = null;
                try {
                    var f = new OrigDTF(lc || undefined, { timeZone: tzId, timeZoneName: style || 'long' });
                    var parts = _ftp.call(f, t);
                    for (var i = 0; i < parts.length; i++) {
                        if (parts[i].type === 'timeZoneName') { out = parts[i].value; break; }
                    }
                } catch (e) {}
                if (out === null) out = getForcedZoneName(t);
                _znCache[key] = out;
                return out;
            }

            // The per-date label, for a zone named explicitly rather than taken from the
            // profile. mw/mw-navigator.js needs this for same-origin frames: it used to carry its
            // OWN eight-entry label map that returned the SUMMER name unconditionally, so
            // a frame said "Eastern European Summer Time" in January while the top window
            // said "Standard" — see [FIX frame-zone-label-table] there. Published on
            // __AFP_MW__ because mw-timezone-screen.js loads before mw-navigator.js.
            try {
                if (MW) {
                    MW.zoneNameFor = function (tzId, when) {
                        var z = ZONE_DATA[tzId];
                        if (!z) return '';
                        var t = (when === undefined) ? OrigDateNow() : Number(when);
                        if (!isFinite(t)) t = OrigDateNow();
                        return isDSTByRule(z.r, z.base, t) ? z.dst : z.std;
                    };
                    // The localised name, for anything that feeds an Intl result rather
                    // than Date.prototype.toString — see the note on localizedZoneName.
                    // Frames go through mw-navigator, which used the English table above
                    // and so printed an English zone next to an Estonian date while the
                    // top window printed the Estonian one: the same value, two answers.
                    MW.zoneNameLocalized = function (locale, style, when) {
                        return localizedZoneName(locale, style, when);
                    };
                }
            } catch (eZn) {}
            
            var DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            function pad2(n) { return (n < 10 ? '0' : '') + n; }
            
            // Whole minutes, toward zero, as V8 answers for an LMT offset with seconds
            // (Kolkata 1900, +05:21:10: -321, not -321.1667) — the shift itself keeps them.
            OrigDateProto.getTimezoneOffset = _mn(function getTimezoneOffset() { if (new.target) throw new TypeError('Date.prototype.getTimezoneOffset is not a constructor'); var _t = _instantOf(this); return Math.trunc(_offAt(_getTimezone(), _t)); });
            _markStatus('tz');

            // [FIX tolocalestring-bypassed-the-zone] These three do NOT go through the
            // Intl.DateTimeFormat constructor this file replaces — the specification wires
            // them to the internal one — so they kept formatting in the host zone while
            // everything around them said otherwise. One line of page script:
            //
            //   new Date().toLocaleString('en-US', {timeZoneName: 'long'})
            //     -> "Moscow Standard Time"        (host, in an en-US America/New_York profile)
            //   new Intl.DateTimeFormat('en-US', {timeZoneName: 'long'}).formatToParts(...)
            //     -> "Eastern Daylight Time"       (profile, correct)
            //
            // Injecting only timeZone is deliberate: it is not a date-or-time component
            // field, so ToDateTimeOptions still applies each method's own defaults and the
            // output shape is unchanged. An explicit timeZone from the caller wins, exactly
            // as it does natively.
            (function () {
                var _tzForceOpts = function (options) {
                    var o = options ? Object.assign({}, options) : {};
                    if (!o.timeZone) o.timeZone = forcedTimezone();
                    return o;
                };
                // Declared with NO formal parameters on purpose: all three natives report
                // length 0, and dev-allfn.html compares name|length|toString for every
                // function present in both scopes. Spelling (locales, options) here made
                // the worker copy report 2 and the pair diverge.
                var _oTLS = OrigDateProto.toLocaleString;
                var _oTLD = OrigDateProto.toLocaleDateString;
                var _oTLT = OrigDateProto.toLocaleTimeString;
                OrigDateProto.toLocaleString = _mn(function toLocaleString() {
                    return _oTLS.call(this, arguments[0], _tzForceOpts(arguments[1]));
                });
                OrigDateProto.toLocaleDateString = _mn(function toLocaleDateString() {
                    return _oTLD.call(this, arguments[0], _tzForceOpts(arguments[1]));
                });
                OrigDateProto.toLocaleTimeString = _mn(function toLocaleTimeString() {
                    return _oTLT.call(this, arguments[0], _tzForceOpts(arguments[1]));
                });
            })();
            OrigDateProto.toString = _mn(function toString() { if (isNaN(_instantOf(this))) return 'Invalid Date'; var _z = zoneAt(this), off = _z.off, _dstF = _z.dst, a = Math.abs(off), gs = off <= 0 ? '+' : '-', gmt = 'GMT'+gs+(Math.floor(a/60)<10?'0':'')+Math.floor(a/60)+(Math.floor(a%60)<10?'0':'')+Math.floor(a%60), name = localizedZoneName(null, 'long', _instantOf(this), _dstF, _z.zd), l = getLocalFromUTC(this); return DAYS[l.getUTCDay()]+' '+MONTHS[l.getUTCMonth()]+' '+pad2(l.getUTCDate())+' '+l.getUTCFullYear()+' '+pad2(l.getUTCHours())+':'+pad2(l.getUTCMinutes())+':'+pad2(l.getUTCSeconds())+' '+gmt+' ('+name+')'; });
            OrigDateProto.toTimeString = _mn(function toTimeString() { if (isNaN(_instantOf(this))) return 'Invalid Date'; var _z = zoneAt(this), off = _z.off, _dstF = _z.dst, a = Math.abs(off), gs = off <= 0 ? '+' : '-', gmt = 'GMT'+gs+(Math.floor(a/60)<10?'0':'')+Math.floor(a/60)+(Math.floor(a%60)<10?'0':'')+Math.floor(a%60), name = localizedZoneName(null, 'long', _instantOf(this), _dstF, _z.zd), l = getLocalFromUTC(this); return pad2(l.getUTCHours())+':'+pad2(l.getUTCMinutes())+':'+pad2(l.getUTCSeconds())+' '+gmt+' ('+name+')'; });
            OrigDateProto.toDateString = _mn(function toDateString() { if (isNaN(_instantOf(this))) return 'Invalid Date'; var l = getLocalFromUTC(this); return DAYS[l.getUTCDay()]+' '+MONTHS[l.getUTCMonth()]+' '+pad2(l.getUTCDate())+' '+l.getUTCFullYear(); });
            OrigDateProto.getFullYear = _mn(function getFullYear() { return getLocalFromUTC(this).getUTCFullYear(); });
            OrigDateProto.getMonth = _mn(function getMonth() { return getLocalFromUTC(this).getUTCMonth(); });
            OrigDateProto.getDate = _mn(function getDate() { return getLocalFromUTC(this).getUTCDate(); });
            OrigDateProto.getDay = _mn(function getDay() { return getLocalFromUTC(this).getUTCDay(); });
            OrigDateProto.getHours = _mn(function getHours() { return getLocalFromUTC(this).getUTCHours(); });
            OrigDateProto.getMinutes = _mn(function getMinutes() { return getLocalFromUTC(this).getUTCMinutes(); });
            OrigDateProto.getSeconds = _mn(function getSeconds() { return getLocalFromUTC(this).getUTCSeconds(); });
            // [FIX setters-computed-on-the-utc-day-and-in-the-host-zone] The getters above
            // answer in the profile's zone; the SETTERS did not. setHours/Minutes/Seconds
            // added the offset to the UTC fields, which lands the call on the wrong calendar
            // day whenever the local date and the UTC date differ — every evening in the
            // Americas — and loses the half hour of Asia/Kolkata and Asia/Tehran outright
            // (setMinutes(0) there left the clock at :30). setDate, setMonth and setFullYear
            // were never patched at all and ran the engine's HOST-zone arithmetic. Measured
            // against Node launched in the profile's zone (test/tz-oracle.mjs), profile
            // America/New_York, the instant 2026-01-16T02:00Z = Jan 15 21:00 local:
            //
            //   d.setHours(10)       Jan 16 10:00   want Jan 15 10:00
            //   d.setHours(0,0,0,0)  Jan 16 00:00   want Jan 15 00:00  ("start of day")
            //   d.setDate(20)        Jan 19         want Jan 20
            //   d.setMonth(5)        22:00          want 21:00         (host has no DST)
            //   IN: d.setMinutes(0)  7:30           want 7:00
            //
            // None of this is a fingerprint; it is a calendar widget, a "today" filter and a
            // reminder time coming out wrong, on every site, for as long as the zone is
            // spoofed. One implementation for the eight local setters: take the LOCAL fields
            // in the profile's zone, replace the ones the call supplies, and convert the wall
            // clock back through the same DST resolution the constructor uses. The spec's
            // shape is kept: every supplied argument is coerced (a present `undefined` is
            // NaN, not "omitted"), extras beyond the declared count are ignored, a NaN
            // receiver stays NaN except in setFullYear/setYear, where it means the epoch's
            // wall clock, and setFullYear takes the year literally — the 0..99 => 1900+ rule
            // belongs to the constructor and to setYear. The worker carries the same code
            // (mw/mw-workers.js _tzShim); tz-oracle holds both to the oracle field by field.
            var OrigGetTime = OrigDateProto.getTime, OrigSetTime = OrigDateProto.setTime;
            function _localParts(ts) {
                var off = zoneAt(new OrigDate(ts)).off;
                var x = new OrigDate(ts - off * 60000);
                return [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(),
                    x.getUTCHours(), x.getUTCMinutes(), x.getUTCSeconds(), x.getUTCMilliseconds()];
            }
            function _wallFieldsToUTC(f) {
                var naive = OrigDateUTC(f[0], f[1], f[2], f[3], f[4], f[5], f[6]);
                if (isNaN(naive)) return NaN;
                if (f[0] >= 0 && f[0] <= 99) {
                    // Date.UTC has just mapped the year to 1900+; the setters mean it literally.
                    var x = new OrigDate(naive);
                    x.setUTCFullYear(f[0]);
                    naive = x.getTime();
                }
                return _naiveToUTC(naive);
            }
            // `from` is the index of the first field the call replaces (0 year .. 6 ms),
            // `count` how many the method declares.
            function _setLocal(d, from, args, count, epochWhenNaN) {
                var t = OrigGetTime.call(d);
                var n = Math.min(args.length, count), nums = [];
                for (var i = 0; i < n; i++) nums.push(Number(args[i]));
                var f;
                if (isNaN(t)) {
                    if (!epochWhenNaN) return OrigSetTime.call(d, NaN);
                    f = [1970, 0, 1, 0, 0, 0, 0];
                } else {
                    f = _localParts(t);
                }
                for (var j = 0; j < nums.length; j++) f[from + j] = nums[j];
                return OrigSetTime.call(d, _wallFieldsToUTC(f));
            }
            OrigDateProto.setFullYear = _mn(function setFullYear(year, month, date) { return _setLocal(this, 0, arguments, 3, true); });
            OrigDateProto.setMonth = _mn(function setMonth(month, date) { return _setLocal(this, 1, arguments, 2, false); });
            OrigDateProto.setDate = _mn(function setDate(date) { return _setLocal(this, 2, arguments, 1, false); });
            OrigDateProto.setHours = _mn(function setHours(hour, min, sec, ms) { return _setLocal(this, 3, arguments, 4, false); });
            OrigDateProto.setMinutes = _mn(function setMinutes(min, sec, ms) { return _setLocal(this, 4, arguments, 3, false); });
            OrigDateProto.setSeconds = _mn(function setSeconds(sec, ms) { return _setLocal(this, 5, arguments, 2, false); });
            OrigDateProto.setMilliseconds = _mn(function setMilliseconds(ms) { return _setLocal(this, 6, arguments, 1, false); });
            // The two legacy members read and write the same fields; getYear used to answer
            // the host's year around New Year.
            OrigDateProto.getYear = _mn(function getYear() {
                var t = OrigGetTime.call(this);
                return isNaN(t) ? NaN : _localParts(t)[0] - 1900;
            });
            OrigDateProto.setYear = _mn(function setYear(year) {
                var y = Number(year);
                if (isNaN(y)) return OrigSetTime.call(this, NaN);
                var yi = Math.trunc(y);
                if (yi >= 0 && yi <= 99) y = 1900 + yi;
                return _setLocal(this, 0, [y], 1, true);
            });

            // Every wrapper above now answers a bad receiver with ITS OWN native refusal.
            // Applied here, after the last of them, and in one place: a wrapper added later is
            // guarded by putting its name in _DATE_PATCHED rather than by remembering a
            // pattern at each site.
            for (var _dg = 0; _dg < _DATE_PATCHED.length; _dg++) _dateGuard(_DATE_PATCHED[_dg]);


            // The per-zone `epoch` field that ZONE_DATA carried for the constructor's old
            // 'M/D/YYYY' branch is gone with that branch — see the note inside _RealDateCtor.
            
            var _RealDateCtor = function Date() {
                if (!(this instanceof _RealDateCtor) && !new.target) return new OrigDate().toString();
                // [FIX date-early-return-prototype] Every branch constructs through
                // Reflect.construct with the caller's new.target: a bare `new OrigDate(...)`
                // here carries the native prototype, and `new Date() instanceof Date` came
                // out false (reproduced on the pre-_mnCtor version as well).
                if (arguments.length === 0) return Reflect.construct(OrigDate, [], new.target || OrigDate);
                // [FIX two-string-shapes-bypassed-the-parser] Two hand-written cases stood
                // here ahead of _parseLocalAware: 'YYYY-M-D' with unpadded fields was built
                // as UTC midnight, and 'M/D/YYYY' was built from a per-zone "epoch" constant
                // whenever the year was before 2000. Chrome parses the first as LOCAL time,
                // and the second turned every pre-2000 date of that shape — birth dates,
                // mostly — into the year 1113. Measured (test/tz-oracle.mjs), profile
                // America/New_York:
                //
                //   new Date('5/20/1985')   1113-07-01 00:56     worker: 1985-05-20 00:00
                //   new Date('12/25/1999')  1113-07-01 00:56     worker: 1999-12-25 00:00
                //   new Date('2026-1-5')    Jan 4 19:00          worker: Jan 5 00:00
                //
                // The worker never had the two cases and was right both times, and
                // Date.parse below never had them either — so `new Date(s)` disagreed with
                // `Date.parse(s)` inside one window, the very pair the note on parse says
                // must agree. Every string goes through _parseLocalAware now.
                // [FIX date-value-construction-used-the-host-zone] It covers every string
                // shape: 'YYYY-MM-DDTHH:mm:ss' with no zone, 'Aug 15 2026 12:00:00',
                // 'M/D/YYYY' and the rest of the legacy grammar are read as the profile's
                // wall clock; absolute forms are recognised and passed through.
                if (arguments.length === 1 && typeof arguments[0] === 'string') {
                    return Reflect.construct(OrigDate, [_parseLocalAware(arguments[0])], new.target || OrigDate);
                }
                // Numeric fields are wall-clock time in the profile's zone, not the host's.
                // Note the year is NOT adjusted for the 0..99 => 1900+ rule here: OrigDateUTC
                // inside _wallToUTC applies it, and doing it twice would move every
                // two-digit year by a century.
                if (arguments.length >= 2) {
                    var a = arguments;
                    var _n = [Number(a[0]), Number(a[1]),
                        a.length > 2 ? Number(a[2]) : 1, a.length > 3 ? Number(a[3]) : 0,
                        a.length > 4 ? Number(a[4]) : 0, a.length > 5 ? Number(a[5]) : 0,
                        a.length > 6 ? Number(a[6]) : 0];
                    for (var _i = 0; _i < _n.length; _i++) {
                        if (isNaN(_n[_i])) return Reflect.construct(OrigDate, [NaN], new.target || OrigDate);
                    }
                    return Reflect.construct(OrigDate,
                        [_wallToUTC(_n[0], _n[1], _n[2], _n[3], _n[4], _n[5], _n[6])],
                        new.target || OrigDate);
                }
                var d = Reflect.construct(OrigDate, arguments, new.target || OrigDate);
                if (isNaN(d.getTime())) return Reflect.construct(OrigDate, [NaN], new.target || OrigDate);
                return d;
            };
            _RealDateCtor.prototype = OrigDateProto; _RealDateCtor.UTC = OrigDateUTC; _RealDateCtor.now = OrigDateNow;
            // Date.parse must agree with `new Date(str)` — a page comparing the two is
            // doing so precisely because they are supposed to be the same operation.
            _RealDateCtor.parse = _mn(function parse(str) { return _parseLocalAware(str); });
            try {
                Object.defineProperty(_RealDateCtor, 'length', { value: 7, configurable: true });
                Object.defineProperty(_RealDateCtor, 'name', { value: 'Date', configurable: true });
            } catch (e) {}
            // [FIX ctor-toString-own-property] window.Date теперь _mnCtor-Proxy —
            // toString приходит из get-trap, не own-property (см. определение _mnCtor выше).
            window.Date = _mnCtor(_RealDateCtor, 'Date', OrigDate.length);
            window.Date.prototype = OrigDateProto;
            // [FIX date-prototype-constructor-pointed-at-the-original] `Date.prototype
            // .constructor === Date` is true in every real browser. It was false here from
            // the moment window.Date became a Proxy: the prototype kept pointing at the
            // untouched native constructor while the global was the wrapper. Nothing
            // noticed for as long as only the window did this — but the worker shim now
            // replaces its constructor too, and a worker answering true against a window
            // answering false is the scope split this file exists to prevent. One
            // assignment settles both, and settles them on the browser's own answer.
            try { OrigDateProto.constructor = window.Date; } catch (eCtorLink) {}
            
            var OrigDTF = Intl.DateTimeFormat, _ro = Intl.DateTimeFormat.prototype.resolvedOptions, _ftp = Intl.DateTimeFormat.prototype.formatToParts, _slo = Intl.DateTimeFormat.supportedLocalesOf;
            var _dtfLocale = function() {
                try {
                    if (_standDownNow()) {
                        var hl = _hostResolved().locale;
                        if (hl) return hl;
                    }
                } catch (eSd) {}
                // [FIX intl-locale-contradicted-navigator-language] The Intl locale must
                // equal navigator.language. A clean browser never disagrees there, and
                // this file used to answer with the profile's locale no matter what the
                // NAVIGATOR module was doing -- while navigator.language is set by that
                // module and by nothing else. Turn navigator off and the page reads the
                // host's language beside the profile's locale.
                //
                // Measured on live Fingerprint Pro events from the user's own Chrome,
                // both directions, same session:
                //
                //   navigator OFF, timezone ON   languages ru-RU   date_time_locale et-EE
                //   navigator ON,  timezone OFF  languages et-EE   date_time_locale ru
                //
                // The first is the half this can close: yield the host locale whenever the
                // module that owns the language claim is not running, so the two agree by
                // construction. The second half is NOT closed here -- with the timezone
                // module off no Intl wrapper is installed at all, so there is nothing to
                // answer with; closing it means installing the locale override under the
                // navigator flag, which is a bigger change than this one.
                //
                // Live via MW.featNow rather than the _FEAT snapshot: the flag is a
                // checkbox and the profile can land after this file loads.
                try {
                    if (!_featNow('navigator')) {
                        var hn = _hostResolved().locale;
                        if (hn) return hn;
                    }
                } catch (eNav) {}
                // [FIX intl-reported-the-tag-instead-of-the-default] This used to answer
                // with the profile's locale TAG, so `new Intl.DateTimeFormat()
                // .resolvedOptions().locale` said `et-EE` — a value no browser produces.
                // Measured on a clean browser forced to that language, one launch per
                // locale: it reports `et`, and 57 of the 67 countries differ from their tag
                // the same way (en-IE -> en-GB, es-CL -> es-MX). The rule is not derivable —
                // `Intl.Locale.minimize()` is right 7 times in 10 and wrong for en-US,
                // pt-BR and zh-CN — so the value is measured by tools/gen-locales.mjs and
                // stored per country. `locale` stays the fallback for the two locales that
                // generator could not switch this browser to.
                var p = _prof();
                return (p && (p.intlLocale || p.locale || p.language)) ||
                    ID.intlLocale || ID.locale || ID.language || null;
            };
            // [FIX resolvedOptions-stomped-explicit-locale] Every wrapper below used to
            // overwrite resolvedOptions().locale with the profile locale
            // UNCONDITIONALLY, including for instances the page had built with an
            // explicit tag. new Intl.NumberFormat('de-DE') then formatted as German
            // while reporting 'et-EE' — a self-contradiction with no privacy upside,
            // since the page already knows which locale it asked for, and a one-line
            // detector: ask for a known tag and see whether resolvedOptions echoes it.
            // Real browser, measured in a pristine iframe on a ru host:
            // new Intl.NumberFormat('de').resolvedOptions().locale === 'de'.
            // The override IS right when no locale was passed, and it has to stay:
            // letting ICU resolve the profile tag on its own splits the answer per
            // service — with 'et-EE' the same pristine realm returns 'et' for Collator
            // and PluralRules but 'et-EE' for the other five, so CreepJS getLocale()
            // would see a two-element set. On a genuine machine that set has exactly
            // one member and it equals navigator.language (measured here: navigator
            // .language 'ru', all seven constructors 'ru'). So the rule is: substitute
            // only for instances whose locale WE supplied — no argument, or the page
            // passing back our own tag (navigator.language round-trips through pages
            // all the time). Anything else is echoed untouched.
            var _intlOurs = new WeakSet();
            // [FIX explicit-timezone-was-overridden] The zone's twin of _intlOurs: instances
            // whose timeZone WE supplied. A formatter the page built for another zone —
            // new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Tokyo'}) — used to format its
            // hours in Tokyo, have its zone NAME replaced with the profile's and resolve to
            // the profile's zone: measured "9 PM EST" and resolvedOptions().timeZone
            // "America/New_York" for a Tokyo formatter, while the worker beside it printed
            // "Japan Standard Time". The page asked for that zone, so there is nothing to
            // hide there; only the default is ours to set, and only that is overridden.
            var _intlOurTz = new WeakSet();
            // [FIX locale-empty-always-ours] Empty locale must be tagged ours even when
            // profile is not in sessionStorage yet at construct time. Otherwise the
            // instance is built with OS locale (ru) forever: resolvedOptions later shows
            // timeZone=Tallinn (unconditional) + locale=ru — half-Russia fingerprint.
            // Live _dtfLocale() is re-read in resolvedOptions / toLocaleString.
            function _intlLoc(loc) {
                var lc = _dtfLocale();
                if (loc === undefined || loc === null || loc === '') {
                    return { arg: lc || undefined, ours: true };
                }
                var first = Array.isArray(loc) ? loc[0] : loc;
                var same = !!lc && typeof first === 'string' && first.toLowerCase() === String(lc).toLowerCase();
                return { arg: loc, ours: same };
            }
            function _intlTag(inst, ours) { if (ours) { try { _intlOurs.add(inst); } catch (eT) {} } return inst; }
            // Shared resolvedOptions wrapper: profile locale only for our own instances.
            function _intlRO(orig) {
                return _mn(function resolvedOptions() {
                    var r = orig.call(this);
                    if (_intlOurs.has(this)) { var lc = _dtfLocale(); if (lc) r.locale = lc; }
                    return r;
                });
            }
            var _RealDTFCtor = function DateTimeFormat(loc, opts) {
                opts = opts ? Object.assign({}, opts) : {};
                // [FIX explicit-timezone-was-overridden] see _intlOurTz above.
                var ourTz = !opts.timeZone;
                if (ourTz) opts.timeZone = forcedTimezone();
                var a = _intlLoc(loc);
                // If profile locale arrived after first paint, empty-loc still must not
                // freeze OS locale inside ICU: pass live tag when ours.
                if (a.ours) {
                    var live = _dtfLocale();
                    if (live) a.arg = live;
                }
                var inst = _intlTag(Reflect.construct(OrigDTF, [a.arg, opts], new.target || OrigDTF), a.ours);
                if (ourTz) { try { _intlOurTz.add(inst); } catch (eTz) {} }
                return inst;
            };
            _RealDTFCtor.prototype = OrigDTF.prototype;
            // [FIX supportedLocalesOf-vanished] Two problems with the static
            // supportedLocalesOf across every Intl wrapper in this section.
            // First, it was simply MISSING on PluralRules and RelativeTimeFormat: the
            // _mnCtor get-trap forwards unknown properties with Reflect.get(ctor, ...)
            // to OUR replacement function, which never carried the static, so
            // Intl.PluralRules.supportedLocalesOf read back undefined while every real
            // browser has it — and ownKeys leaked the same absence to
            // Object.getOwnPropertyNames.
            // Second, where it WAS carried over it went through .bind(Orig), and a bound
            // function renames itself: .name became 'bound supportedLocalesOf' and
            // String(fn) collapsed to 'function () { [native code] }' instead of
            // 'function supportedLocalesOf() { [native code] }'.
            // The bind was unnecessary in the first place — per ECMA-402 every
            // supportedLocalesOf reads the constructor's [[AvailableLocales]] intrinsic
            // and never touches `this`, so it works identically when handed over
            // directly, and direct assignment keeps the native name and toString.
            if (_slo) _RealDTFCtor.supportedLocalesOf = _slo;
            // [FIX ctor-toString-own-property] _mnCtor вместо голой функции + прямого
            // defineProperty на toString — construct-ловушка сохраняет new.target,
            // так что Proxy здесь больше не ломает конструирование (старое опасение
            // в комментарии выше было верным для наивного Proxy, но не для _mnCtor).
            Intl.DateTimeFormat = _mnCtor(_RealDTFCtor, 'DateTimeFormat', OrigDTF.length);
            Intl.DateTimeFormat.prototype = OrigDTF.prototype;
            // timeZone always forced. Locale forced only for default/our instances
            // (explicit new Intl.DateTimeFormat('de') keeps de — CreepJS check).
            Intl.DateTimeFormat.prototype.resolvedOptions = _mn(function resolvedOptions() {
                var r = _ro.call(this);
                // [FIX explicit-timezone-was-overridden] Forced only where the zone was ours
                // to choose; an explicit timeZone option is echoed as ICU resolved it.
                if (_intlOurTz.has(this)) r.timeZone = forcedTimezone();
                if (_intlOurs.has(this)) {
                    var _lc = _dtfLocale();
                    if (_lc) r.locale = _lc;
                }
                return r;
            });
            // Replace long/short zone names so ru-OS never prints «Москва» when TZ is Tallinn.
            Intl.DateTimeFormat.prototype.formatToParts = _mn(function formatToParts(date) {
                // [FIX formatToParts-treated-the-epoch-as-absent] `date || new Date()`
                // sent 0 down the "no argument" path, so formatToParts(0) formatted NOW
                // instead of 1970-01-01. Passing the argument through unchanged is what
                // native does: ECMA-402 already treats undefined as Date.now().
                var p = _ftp.call(this, date);
                var ro = null;
                try { ro = _ro.call(this); } catch (eRo) {}
                // [FIX explicit-timezone-was-overridden] A formatter the page built for
                // another zone keeps ICU's own name for that zone: the substitution below
                // only knows the profile's zone, and printed it beside Tokyo's hours.
                if (!_intlOurTz.has(this) && ro && ro.timeZone && ro.timeZone !== forcedTimezone()) return p;
                var zn = localizedZoneName(ro && ro.locale, ro && ro.timeZoneName, date);
                return p.map(function (x) {
                    return x.type === 'timeZoneName' ? Object.assign({}, x, { value: zn }) : x;
                });
            });
            // [FIX format-patch-never-installed] This block used to open with
            //     var _fmt = OrigDTF.prototype.format;
            // and that very line THROWS. Intl.DateTimeFormat.prototype.format is not a
            // method, it is an ACCESSOR, and its getter rejects the prototype as a
            // receiver: reading it raises
            //   TypeError: Method UnwrapDateTimeFormat called on incompatible receiver
            // The surrounding catch(eFmt){} swallowed it, so the assignment on the next
            // line never ran and format() was left completely unpatched — silently, on
            // every page, since the day it was written. formatToParts() substituted the
            // spoofed timeZoneName while format() went straight to ICU and printed the
            // zone name the REAL host locale resolves, which is precisely the bypass the
            // original comment says this exists to close.
            // Two further reasons the old shape was wrong even had it run: assigning a
            // data property over a native accessor changes what
            // getOwnPropertyDescriptor reports, and native format is a per-instance bound
            // function (identity-stable, works detached as `const f = dtf.format; f(d)`),
            // which a shared prototype method is not.
            // Measured on a clean realm — the replacement below reproduces all of it:
            //   descriptor  {get, set: undefined, enumerable: false, configurable: true}
            //   getter      name 'get format', length 0
            //   bound fn    name '', length 1, ownKeys ['length','name'],
            //               String() 'function () { [native code] }'
            //   dtf.format === dtf.format  (hence the WeakMap)
            // The inner wrapper is passed to _mn as a direct ARGUMENT on purpose: a
            // `var bound = function (date) {}` would pick up the inferred name 'bound'
            // and _mn builds its native-looking toString out of fn.name.
            try {
                var _fmtDesc = Object.getOwnPropertyDescriptor(OrigDTF.prototype, 'format');
                if (_fmtDesc && typeof _fmtDesc.get === 'function') {
                    var _fmtGet = _fmtDesc.get;
                    var _fmtBound = new WeakMap();
                    Object.defineProperty(OrigDTF.prototype, 'format', {
                        get: _mn(function format() {
                            // Call the native getter FIRST: it performs exactly the
                            // receiver validation native does, and throws the same
                            // TypeError for a foreign `this` before we touch the WeakMap.
                            var nativeFmt = _fmtGet.call(this);
                            var self = this;
                            var cached = _fmtBound.get(self);
                            if (cached) return cached;
                            var bound = _mn(function (date) {
                                // Rebuild from parts so the timeZoneName substitution
                                // cannot be bypassed by format() taking a different ICU
                                // path than formatToParts.
                                try {
                                    if (typeof self.formatToParts === 'function') {
                                        return self.formatToParts(date)
                                            .map(function (x) { return x.value; }).join('');
                                    }
                                } catch (eF) {}
                                return nativeFmt(date);
                            });
                            try { _fmtBound.set(self, bound); } catch (eSet) {}
                            return bound;
                        }, true),
                        set: _fmtDesc.set,
                        enumerable: _fmtDesc.enumerable,
                        configurable: true
                    });
                }
            } catch (eFmt) {}
            
            // [FIX intl-locale-gained-a-region-and-a-timezone] Intl.Locale is left NATIVE.
            // A wrapper here used to inject `region` (derived from the profile's zone) and a
            // `timeZone` option into every construction that named neither, so
            // new Intl.Locale('de').toString() answered 'de-US' — 'de-IN' under an Indian
            // profile — and .maximize() put the profile's country into 'ja-Jpan-US', where a
            // real browser answers 'de' and 'ja-Jpan-JP' whatever machine it runs on
            // (test/tz-oracle.mjs, against Node in the same zone; the worker, which never
            // wrapped Locale, agreed with Node). A locale tag carries no zone and the
            // platform has no timeZone option to read, so the injection hid nothing and
            // changed a value every i18n library round-trips. One masked constructor fewer.
            // [FIX #intl-numberformat-locale] Intl.NumberFormat и Intl.Collator возвращали
            // реальную системную локаль (например 'ru') вместо spoofed (например 'et-EE').
            // Intl.DateTimeFormat был запатчен, но эти два — нет, что создавало несоответствие
            // детектируемое через new Intl.NumberFormat().resolvedOptions().locale.
            try {
                var OrigNF = Intl.NumberFormat, _roNF = Intl.NumberFormat.prototype.resolvedOptions;
                var _RealNFCtor = function NumberFormat(loc, opts) {
                    var a = _intlLoc(loc);
                    return _intlTag(Reflect.construct(OrigNF, [a.arg, opts], new.target || OrigNF), a.ours);
                };
                _RealNFCtor.prototype = OrigNF.prototype;
                // [FIX supportedLocalesOf-vanished] see the note at DateTimeFormat above
                if (OrigNF.supportedLocalesOf) _RealNFCtor.supportedLocalesOf = OrigNF.supportedLocalesOf;
                // [FIX ctor-toString-own-property] _mnCtor вместо голой функции + прямого toString.
                Intl.NumberFormat = _mnCtor(_RealNFCtor, 'NumberFormat', OrigNF.length);
                Intl.NumberFormat.prototype = OrigNF.prototype;
                Intl.NumberFormat.prototype.resolvedOptions = _intlRO(_roNF);
            } catch(e) {}
            try {
                var OrigCL = Intl.Collator, _roCL = Intl.Collator.prototype.resolvedOptions;
                var _RealCLCtor = function Collator(loc, opts) {
                    var a = _intlLoc(loc);
                    return _intlTag(Reflect.construct(OrigCL, [a.arg, opts], new.target || OrigCL), a.ours);
                };
                _RealCLCtor.prototype = OrigCL.prototype;
                // [FIX supportedLocalesOf-vanished] see the note at DateTimeFormat above
                if (OrigCL.supportedLocalesOf) _RealCLCtor.supportedLocalesOf = OrigCL.supportedLocalesOf;
                // [FIX ctor-toString-own-property] _mnCtor вместо голой функции + прямого toString.
                Intl.Collator = _mnCtor(_RealCLCtor, 'Collator', OrigCL.length);
                Intl.Collator.prototype = OrigCL.prototype;
                Intl.Collator.prototype.resolvedOptions = _intlRO(_roCL);
            } catch(e) {}
            // [FIX localecompare-sorted-by-the-host] Intl.Collator above carries the claim;
            // String.prototype.localeCompare was wrapped nowhere and went to ICU's DEFAULT
            // locale, which is the machine's and which JS cannot move. The patched-Chromium
            // project sets that default in RendererMain "before the render thread exists,
            // because V8 caches the default locale in the isolate the first time Intl asks"
            // -- a moment an extension does not get, so the two doors have to be brought
            // together here instead.
            //
            // It is a contradiction a page finds on its own, with no reference machine and
            // no corpus: ask both APIs to order the same two letters. Measured claiming
            // et-EE on a ru host (tools/probe-predict.mjs), Estonian sorting o-tilde AFTER
            // z where ru and en sort it with o:
            //
            //   clean   localeCompare -1   Intl.Collator() -1     agree
            //   ours    localeCompare -1   Intl.Collator()  1     4 of 5 pairs disagreed
            //
            // NOT the cause of Fingerprint's bot verdict, and it must not be sold as one:
            // ru and en collate Latin identically, so a claim of en-US produces no split at
            // all, and that run was still graded bad.
            //
            // Same _intlLoc as every constructor above, so an explicit locale still wins and
            // the claim comes from one place. That also means it inherits README "Limits", item 18:
            // the locale lives under the timezone flag while navigator.language lives under
            // its own, and closing that is the same move for both.
            try {
                var _origLC = String.prototype.localeCompare;
                if (typeof _origLC === 'function') {
                    var _lcWrap = _mn(function localeCompare(that) {
                        var a = _intlLoc(arguments.length > 1 ? arguments[1] : undefined);
                        return _origLC.call(this, that, a.arg,
                            arguments.length > 2 ? arguments[2] : undefined);
                    });
                    // Arity from the native: a wrapper declaring one parameter would still
                    // report 1 here, but pinning it means a later edit cannot drift.
                    try {
                        Object.defineProperty(_lcWrap, 'length',
                            { value: _origLC.length, configurable: true });
                    } catch (eLcLen) {}
                    String.prototype.localeCompare = _lcWrap;
                }
            } catch (eLc) {}
            // The same default locale answers these two, and Turkish is the classic probe:
            // a tr-TR claim on any other host would upper-case 'i' to 'I' instead of the
            // dotted capital. No split on the ru/et pair measured today -- both give 'I' --
            // so this is closing the door rather than fixing an observed leak, and it is
            // written down that way.
            try {
                ['toLocaleUpperCase', 'toLocaleLowerCase'].forEach(function (m) {
                    var orig = String.prototype[m];
                    if (typeof orig !== 'function') return;
                    var w = ({ [m]: function () {
                        var a = _intlLoc(arguments.length > 0 ? arguments[0] : undefined);
                        return orig.call(this, a.arg);
                    } })[m];
                    try {
                        Object.defineProperty(w, 'length', { value: orig.length, configurable: true });
                    } catch (eTlLen) {}
                    String.prototype[m] = _mn(w);
                });
            } catch (eTl) {}
            try {
                var OrigPR = Intl.PluralRules, _roPR = Intl.PluralRules.prototype.resolvedOptions;
                var _RealPRCtor = function PluralRules(loc, opts) {
                    var a = _intlLoc(loc);
                    return _intlTag(Reflect.construct(OrigPR, [a.arg, opts], new.target || OrigPR), a.ours);
                };
                _RealPRCtor.prototype = OrigPR.prototype;
                // [FIX supportedLocalesOf-vanished] see the note at DateTimeFormat above
                if (OrigPR.supportedLocalesOf) _RealPRCtor.supportedLocalesOf = OrigPR.supportedLocalesOf;
                // [FIX ctor-toString-own-property] _mnCtor вместо голой функции + прямого toString.
                Intl.PluralRules = _mnCtor(_RealPRCtor, 'PluralRules', OrigPR.length);
                Intl.PluralRules.prototype = OrigPR.prototype;
                Intl.PluralRules.prototype.resolvedOptions = _intlRO(_roPR);
            } catch(e) {}
            try {
                var OrigRTF = Intl.RelativeTimeFormat, _roRTF = Intl.RelativeTimeFormat.prototype.resolvedOptions;
                var _RealRTFCtor = function RelativeTimeFormat(loc, opts) {
                    var a = _intlLoc(loc);
                    return _intlTag(Reflect.construct(OrigRTF, [a.arg, opts], new.target || OrigRTF), a.ours);
                };
                _RealRTFCtor.prototype = OrigRTF.prototype;
                // [FIX supportedLocalesOf-vanished] see the note at DateTimeFormat above
                if (OrigRTF.supportedLocalesOf) _RealRTFCtor.supportedLocalesOf = OrigRTF.supportedLocalesOf;
                // [FIX ctor-toString-own-property] _mnCtor вместо голой функции + прямого toString.
                Intl.RelativeTimeFormat = _mnCtor(_RealRTFCtor, 'RelativeTimeFormat', OrigRTF.length);
                Intl.RelativeTimeFormat.prototype = OrigRTF.prototype;
                Intl.RelativeTimeFormat.prototype.resolvedOptions = _intlRO(_roRTF);
            } catch(e) {}
            // [FIX intl-displaynames-listformat-unwrapped] The five constructors above
            // plus DateTimeFormat were wrapped; Intl.DisplayNames and Intl.ListFormat
            // were not, in the window scope only — the worker has wrapped all seven
            // since [FIX worker-intl-ctors-were-raw] (see the name list in
            // mw-workers.js). Two separate symptoms on a live CreepJS run with an et-EE
            // profile, both from this one gap:
            //   1) new Intl.DisplayNames(undefined, {type:'language'}).of('en-US')
            //      rendered in the REAL OS locale — "американский английский" instead of
            //      Estonian "inglise (Ameerika Ühendriigid)". The display strings follow
            //      the resolved locale, so an unwrapped constructor prints the profile's
            //      cover story in the language we are supposed to be hiding.
            //   2) getLocale() in src/intl/index.ts builds
            //      [...new Set(constructors.map(C => new intl[C]().resolvedOptions().locale))]
            //      over exactly those seven names. ListFormat needs no options, so it
            //      constructed fine and contributed the real 'ru' while the other five
            //      returned 'et-EE' — a two-element set where every genuine browser
            //      yields one. That is the 'ru' that showed up in resolvedOptions.
            // DisplayNames does NOT appear in that set, despite being in the list:
            // `new Intl.DisplayNames()` with no options throws TypeError by spec, and
            // getLocale catches and skips it. Passing opts straight through keeps that
            // throw intact — synthesising an options object here would ADD an entry to
            // a set that has none in a real browser, trading one mismatch for another.
            try {
                var OrigDN = Intl.DisplayNames, _roDN = OrigDN && OrigDN.prototype.resolvedOptions;
                if (OrigDN) {
                    var _RealDNCtor = function DisplayNames(loc, opts) {
                        var a = _intlLoc(loc);
                        return _intlTag(Reflect.construct(OrigDN, [a.arg, opts], new.target || OrigDN), a.ours);
                    };
                    _RealDNCtor.prototype = OrigDN.prototype;
                    if (OrigDN.supportedLocalesOf) _RealDNCtor.supportedLocalesOf = OrigDN.supportedLocalesOf;
                    Intl.DisplayNames = _mnCtor(_RealDNCtor, 'DisplayNames', OrigDN.length);
                    Intl.DisplayNames.prototype = OrigDN.prototype;
                    Intl.DisplayNames.prototype.resolvedOptions = _intlRO(_roDN);
                }
            } catch(e) {}
            try {
                var OrigLF = Intl.ListFormat, _roLF = OrigLF && OrigLF.prototype.resolvedOptions;
                if (OrigLF) {
                    var _RealLFCtor = function ListFormat(loc, opts) {
                        var a = _intlLoc(loc);
                        return _intlTag(Reflect.construct(OrigLF, [a.arg, opts], new.target || OrigLF), a.ours);
                    };
                    _RealLFCtor.prototype = OrigLF.prototype;
                    if (OrigLF.supportedLocalesOf) _RealLFCtor.supportedLocalesOf = OrigLF.supportedLocalesOf;
                    Intl.ListFormat = _mnCtor(_RealLFCtor, 'ListFormat', OrigLF.length);
                    Intl.ListFormat.prototype = OrigLF.prototype;
                    Intl.ListFormat.prototype.resolvedOptions = _intlRO(_roLF);
                }
            } catch(e) {}
            // [FIX segmenter-and-durationformat-were-never-wrapped] Seven constructors were
            // hand-wrapped above and these two were not, so they kept answering with the
            // REAL OS locale while every one of their siblings said the profile's:
            //
            //   new Intl.Collator().resolvedOptions().locale    en-US
            //   new Intl.Segmenter().resolvedOptions().locale   ru        <- the host
            //   new Intl.DurationFormat().resolvedOptions().locale  ru    <- the host
            //
            // One line of page script, no probing required. CreepJS's getLocale() happens
            // to iterate the same seven names this file wraps, which is exactly why the
            // gap survived — the readout was clean while the browser was not. Both are
            // newer than the rest of Intl, which is the whole lesson here: a hand-listed
            // set of constructors goes stale every time the platform grows one, so the
            // loop below takes names rather than repeating the block twice more.
            // [FIX the-loop-still-took-a-hand-LIST] The note above says a hand-listed set
            // goes stale every time the platform grows a constructor — and then listed two
            // names. It went stale exactly as predicted: `tools/probe-engine.mjs`, walking
            // Chrome's own value tree instead of ours, found `Intl.v8BreakIterator`
            // answering with the host locale while all nine of its siblings answered with
            // the claim:
            //
            //   Intl.Collator        resolvedOptions().locale   et-EE   the claim
            //   Intl.v8BreakIterator resolvedOptions().locale   ru      the machine
            //
            // The names come from the browser now. Anything with a `resolvedOptions` on its
            // prototype reads the default locale and therefore has to follow the claim;
            // that test excludes `Intl.Locale` (no resolvedOptions, and it carries the tag
            // the caller handed it) and the plain functions (`getCanonicalLocales`,
            // `supportedValuesOf`) without naming any of them. The seven wrapped by hand
            // above are already replaced, so `_intlWrapped` skips them rather than
            // double-wrapping — order matters here and this loop stays last.
            //
            // This is the structural half of the difference with an engine patch: a patched
            // Chromium moves the renderer's ICU default locale once and every reader
            // follows, including readers written after the patch. An extension wraps
            // readers, so the only way not to fall behind is to stop naming them.
            var _intlWrapped = ['DateTimeFormat', 'NumberFormat', 'Collator', 'PluralRules',
                'RelativeTimeFormat', 'DisplayNames', 'ListFormat'];
            var _intlNames = [];
            try {
                Object.getOwnPropertyNames(Intl).forEach(function (nm) {
                    if (_intlWrapped.indexOf(nm) !== -1) return;
                    var C = Intl[nm];
                    if (typeof C !== 'function' || !C.prototype) return;
                    if (typeof C.prototype.resolvedOptions !== 'function') return;
                    _intlNames.push(nm);
                });
            } catch (eEnum) { _intlNames = ['Segmenter', 'DurationFormat']; }
            _intlNames.forEach(function (nm) {
                try {
                    var Orig = Intl[nm];
                    if (!Orig) return;
                    var _roX = Orig.prototype.resolvedOptions;
                    // Computed key inside the literal, NOT `holder[nm] = function …`:
                    // only the literal form infers the function's name, and an anonymous
                    // one would mask as "function () { [native code] }".
                    var holder = {
                        [nm]: function (loc, opts) {
                            var a = _intlLoc(loc);
                            return _intlTag(Reflect.construct(Orig, [a.arg, opts], new.target || Orig), a.ours);
                        }
                    };
                    var Ctor = holder[nm];
                    Ctor.prototype = Orig.prototype;
                    if (Orig.supportedLocalesOf) Ctor.supportedLocalesOf = Orig.supportedLocalesOf;
                    Intl[nm] = _mnCtor(Ctor, nm, Orig.length);
                    Intl[nm].prototype = Orig.prototype;
                    Intl[nm].prototype.resolvedOptions = _intlRO(_roX);
                } catch (eSg) {}
            });
            // [FIX temporal-replacements-were-bare] Both went in as anonymous function
            // expressions assigned to a property, so .name was '' and String() handed back
            // our source — the exact leak _mn exists to close and which every other
            // replacement in this file already goes through. Anonymous also means _mn
            // would build 'function () { [native code] }'; the names come from the
            // property via a computed key, as elsewhere in the codebase.
            //
            // [FIX temporal-now-answered-from-the-host-clock] timeZoneId was the only
            // method covered, and it is the only one of the six that a fingerprinting
            // script has no reason to call. The four that BUILD a value took the host zone
            // straight from the engine — measured, profile America/New_York on a Moscow
            // host, with `new Date()` reading 12:37 in the same page:
            //
            //   Temporal.Now.plainDateTimeISO()          2026-08-15T19:37   <- host clock
            //   Temporal.Now.plainTimeISO()              19:37              <- host clock
            //   Temporal.Now.zonedDateTimeISO().offset   +03:00             <- host offset
            //   Temporal.Now.zonedDateTimeISO().toString()
            //       2026-08-15T19:37:57.827+03:00[Europe/Moscow]            <- named outright
            //
            // Temporal is a second, complete date-and-time API; every hour spent on Date
            // above is undone by one call here. Each of the four already accepts an
            // explicit time zone, so the fix is to supply the profile's when the caller
            // omits it — no arithmetic of our own, and an explicit argument still wins.
            // `Temporal.Now.instant()` is deliberately untouched: an instant carries no
            // zone, and rewriting it would move a correct absolute value.
            try {
                if (typeof Temporal !== 'undefined' && Temporal.Now) {
                    if (Temporal.Now.timeZoneId) {
                        Temporal.Now.timeZoneId = _mn(({ timeZoneId: function () { return forcedTimezone(); } }).timeZoneId);
                    }
                    // Older drafts exposed Temporal.Now.timeZone; harmless where absent.
                    if (Temporal.Now.timeZone) {
                        Temporal.Now.timeZone = _mn(({ timeZone: function () { return forcedTimezone(); } }).timeZone);
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
                                    return orig.call(Temporal.Now, tz === undefined ? forcedTimezone() : tz);
                                }
                            };
                            Temporal.Now[m] = _mn(holder[m]);
                        } catch (eTm) {}
                    });
                }
            } catch(e) {}

            // [FIX locale-entropy-toLocaleString] CreepJS worker:
            //   systemCurrency = (1).toLocaleString(lang, {currency...})
            //   engineCurrency  = (1).toLocaleString(undefined, {currency...})
            //   localeEntropyIsTrusty = systemCurrency === engineCurrency
            // Without a locale arg, toLocaleString uses the real OS locale (e.g. ru)
            // → "1 доллар США" while lang is et-EE → entropy lie.
            // Force profile locale when loc is omitted/undefined.
            try {
                var _origNumTLS = Number.prototype.toLocaleString;
                Number.prototype.toLocaleString = _mn(function toLocaleString(loc = undefined, opts = undefined) {
                    var _lc = _dtfLocale();
                    if (loc === undefined || loc === null || loc === '') loc = _lc || undefined;
                    return _origNumTLS.call(this, loc, opts);
                });
            } catch (eTLS) {}
            try {
                var _origDateTLS = Date.prototype.toLocaleString;
                Date.prototype.toLocaleString = _mn(function toLocaleString(loc = undefined, opts = undefined) {
                    var _lc = _dtfLocale();
                    if (loc === undefined || loc === null || loc === '') loc = _lc || undefined;
                    return _origDateTLS.call(this, loc, opts);
                });
            } catch (eDTLS) {}
            try {
                var _origDateTLD = Date.prototype.toLocaleDateString;
                Date.prototype.toLocaleDateString = _mn(function toLocaleDateString(loc = undefined, opts = undefined) {
                    var _lc = _dtfLocale();
                    if (loc === undefined || loc === null || loc === '') loc = _lc || undefined;
                    return _origDateTLD.call(this, loc, opts);
                });
            } catch (eTLD) {}
            try {
                var _origDateTLT = Date.prototype.toLocaleTimeString;
                Date.prototype.toLocaleTimeString = _mn(function toLocaleTimeString(loc = undefined, opts = undefined) {
                    var _lc = _dtfLocale();
                    if (loc === undefined || loc === null || loc === '') loc = _lc || undefined;
                    return _origDateTLT.call(this, loc, opts);
                });
            } catch (eTLT) {}

        } catch(e) {}
    })();

    // ===== SCREEN =====
    if (!_FEAT.screen) { /* disabled */ } else
    // [ANTI-CREEP] Патчим instance screen, не Screen.prototype —
    // prototype остаётся чистым при сравнении с iframe в CreepJS.
    if (ID.screenWidth) { try {
        // Only spoof screen when profile differs from native (avoids Prototype lies on real 1920x1080)
        _defIfDiff(screen, 'width',  function() { return ID.screenWidth; });
        _defIfDiff(screen, 'height', function() { return ID.screenHeight; });
        try {
            var _aw = screen.availWidth, _ah = screen.availHeight;
            var _tw = ID.screenWidth, _th = Math.round((ID.screenHeight || 1080) * 0.963 / 8) * 8;
            // If width already matches profile, keep native avail* (taskbar) — no defineProperty
            if (!_sameVal(_aw, _tw)) _defIfDiff(screen, 'availWidth', function() { return ID.screenWidth; });
            if (!_sameVal(_ah, _th)) _defIfDiff(screen, 'availHeight', function() {
                return Math.round((ID.screenHeight || 1080) * 0.963 / 8) * 8;
            });
        } catch (eAv) {
            _defIfDiff(screen, 'availWidth',  function() { return ID.screenWidth; });
            _defIfDiff(screen, 'availHeight', function() { return Math.round((ID.screenHeight || 1080) * 0.963 / 8) * 8; });
        }
        // [FIX avail-origin-and-second-monitor-were-never-touched] availWidth/availHeight
        // were spoofed for a long time; availLeft, availTop and isExtended never were.
        // Found by widening test/hostleak.mjs to the display traits nothing here measured.
        //
        // All three are the physical machine, none of them moves when the profile changes,
        // and each is one line to read:
        //
        //   availLeft / availTop   where the work area starts — i.e. WHICH EDGE the Windows
        //                          taskbar is on, and on a multi-monitor layout whether the
        //                          second display sits to the left (availLeft goes NEGATIVE).
        //   isExtended             one bit: does this box have a second display at all.
        //                          Most visitors are false, so true is a strong split, and
        //                          it survives every profile, IP and country change.
        //
        // Pinning to 0 / 0 / false is not just the majority answer, it is the answer the
        // rest of this block already implies. We report availWidth === screen.width and
        // availHeight === height minus a bottom taskbar; a machine with a LEFT taskbar was
        // therefore already contradicting itself — a work area as wide as the screen that
        // nevertheless starts 62px in. So this closes an incoherence as well as a carrier.
        //
        // Two guards, both load-bearing:
        //   * `in screen` — never CREATE a property the browser does not have. isExtended is
        //     desktop-Chrome-only; defining it on a build without it would be a tell in the
        //     opposite direction, the same mistake as [FIX we-invented-a-chrome-runtime].
        //   * _defIfDiff — installs nothing when the host already answers the pinned value,
        //     which is the common case (bottom taskbar, one monitor) and costs zero own
        //     properties there.
        //
        // NOT OBSERVABLE ON THE HEADLESS RIG, stated so nobody reads a green run as proof:
        // headless already reports 0 / 0 / false, so _defIfDiff correctly installs nothing
        // and hostleak cannot tell this apart from the leak it replaces. The same trap as
        // [FIX headless-ignores-font-settings]. test/parity-static.mjs pins the code instead.
        try {
            if ('availLeft' in screen) _defIfDiff(screen, 'availLeft', function () { return 0; });
            if ('availTop' in screen) _defIfDiff(screen, 'availTop', function () { return 0; });
            if ('isExtended' in screen) _defIfDiff(screen, 'isExtended', function () { return false; });
        } catch (eEx) {}
        // 24 — see [FIX color-depth-was-a-value-chrome-never-reports] in background.js.
        // _defIfDiff means that on a host already reporting 24 this installs no accessor at
        // all, which is the quietest possible outcome.
        _defIfDiff(screen, 'colorDepth', function() { return (ID.colorDepth != null ? ID.colorDepth : 24); });
        _defIfDiff(screen, 'pixelDepth', function() { return (ID.colorDepth != null ? ID.colorDepth : 24); });
    } catch(_) {} }

    // [FIX window-globals-ignored-their-receiver] The nine window accessors below —
    // devicePixelRatio, inner/outer width and height, screenX/Y and their screenLeft/Top
    // spellings — answered the same number no matter WHO they were called on. Measured on
    // a clean Chromium 151 (channel:'chromium'), the descriptor getter taken off `window`:
    //
    //   get.call(window)            1280        get.call({})               TypeError
    //   get.call(null)              1280        get.call(Window.prototype) TypeError
    //   get.call(undefined)         1280        get.call(document)         TypeError
    //   get.call(childFrameWindow)   300        get.call(document.all)     TypeError
    //
    // Ours answered THIS window's clamped number for all eight of the non-window receivers,
    // because the getter never looked at `this` at all. Three separate tells: we invent a
    // number where the platform refuses, we hand OUR window's geometry to a caller asking
    // about a DIFFERENT window, and `.call(document.all)` proves the null test has to be
    // written strictly — `this == null` is TRUE for document.all (the [[IsHTMLDDA]]
    // abstract-equality quirk) while the platform still throws there.
    //
    // The oracle is the platform's own getter, not a brand list: it refuses exactly the
    // receivers the platform refuses, including the ones no `instanceof` can express (a
    // cross-realm Window is not `instanceof` our Window, yet the native answers for it).
    //
    // These accessors are [Global] members — own properties of the window OBJECT — so
    // `window` in this closure IS the object being patched (this file defines only on its
    // own realm's window, never on a frame's), and identity against it is sound. Measured
    // on the same browser: an UNQUALIFIED read (`innerWidth`, the common minified form),
    // a qualified one, one from a nested function and one from eval ALL arrive with
    // `this === window`, so the fast path really is the ordinary path and no hot read pays
    // for the oracle.
    var _selfWin = window;
    function _isSelfWin(recv) {
        // Strict, per the document.all measurement above. `use strict` at the top of this
        // file plus Reflect.apply in the _mn trap means `this` arrives uncoerced, so the
        // null/undefined arms are load-bearing rather than defensive.
        return recv === _selfWin || recv === null || recv === undefined;
    }
    // A capture is only an oracle if it REFUSES a receiver the platform refuses. Verified
    // once, at install: a descriptor that answers for a plain object is not the platform's
    // getter — either there was nothing to capture, or another MAIN-world extension won the
    // document_start race and we captured its shim (AdGuard is documented as active in the
    // user's own profile). Delegating to something that answers everything would be worse
    // than no check at all, so an unverified capture degrades to the old receiver-blind
    // behaviour instead.
    var _oracleProbe = {};
    function _winOracle(get) {
        try { get.call(_oracleProbe); } catch (eO) { return get; }
        return null;
    }
    // [FIX dpr-was-gated-on-the-boot-profile] This read `if (ID.devicePixelRatio)` at
    // INSTALL time, at document_start. When the profile has not landed yet the answer is
    // undefined, no accessor is installed at all, and the page keeps the host's real ratio
    // for its whole life — the later profile cannot reach a getter that was never defined.
    // Every neighbour above is a live getter over ID and therefore self-corrects; this one
    // line did not, which is why the FIRST page of a session came out with spoofed
    // screen.width and a REAL devicePixelRatio.
    //
    // It is not a cosmetic field. Text metrics are measured in CSS pixels, so they scale
    // with it — measured with FingerprintJS v4 over three tabs of one session:
    //
    //   tab1  dpr 1    fontPreferences default 149.3125  sans 144.015625  mono 132.625
    //   tab2  dpr 1.5  fontPreferences default  99.484375 sans  95.953125 mono  88.359375
    //
    // exactly a factor of 1.5, and a DIFFERENT visitorId for the first page the user opens
    // after starting the browser. Same visitor, two identities, decided by tab order.
    //
    // The getter is installed unconditionally now and falls back to the host's own value
    // while the profile is silent, so nothing is invented before there is something to say.
    try {
        // Captured BEFORE _def installs, so it is the platform's getter and not ours.
        // _def threads the receiver into this value function (`fn.call(this)`), which is
        // the only reason the check below can live here rather than in mw-core.
        var _natDprGet = (function () {
            var d = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
            return (d && d.get) ? _winOracle(d.get) : null;
        })();
        var _natDpr = window.devicePixelRatio;
        _def(window, 'devicePixelRatio', function () {
            // A foreign receiver goes to the platform first: it throws for {} / document /
            // Window.prototype exactly as clean does. If it ANSWERS, the receiver is a real
            // Window and we answer the claim — never the native value. dpr is one number per
            // browser window, so `get.call(childWindow)` returns the HOST's ratio (measured:
            // 1 on the rig, and the comment above records a real 1.5 host), while that
            // frame's own devicePixelRatio is the profile's. Handing back the native here
            // would publish the host ratio and split the frame from its own answer — the
            // field this file's note calls the one that changed the visitorId per tab.
            // KEPT DELIBERATELY, though _namedGetter in mw-core.js normally vets the
            // receiver before this function ever runs and makes the line look redundant.
            // It is the fallback for the one case where mw-core's own oracle declines:
            // _origOracle drops a capture that is not demonstrably a refusing getter (a
            // double install, where the descriptor it finds is another module's wrapper
            // rather than the platform's). That case is not theoretical — instrumenting the
            // bundle and loading it showed the UAD prototype patch running TWICE in every
            // child frame, once from the parent's frame bridge and once from the frame's own
            // copy. There the check here is the only one left, and dpr is the field that
            // most deserves it: it scales every text metric, and a tab that got the host
            // ratio produced a different visitorId (measured, in the note above).
            // Cost is one native call on the foreign-receiver path only; the common read
            // is `this === window` and returns without touching it.
            if (!_isSelfWin(this) && _natDprGet) _natDprGet.call(this);
            var v = ID.devicePixelRatio;
            return (typeof v === 'number' && v > 0) ? v : _natDpr;
        });
    } catch (_) {}

    if (!_FEAT.screen) { /* window size skip */ } else
    // ===== MASK WINDOW SIZE =====
    // [FIX stealth-window-screen-parity] Раньше inner/outer/visualViewport патчились
    // только в normal (`if (!_STEALTH)`). В stealth screen уже 1920×1080 из профиля,
    // а реальное окно могло быть 2008×… → client/inner/outer "out of bounds" и
    // matchMedia/device-aspect-ratio fail. Тот же clamp, что в normal, нужен и в stealth:
    // иначе screen лжёт, а viewport — нет. Canvas/audio/webgl в stealth по-прежнему off.
    (function() {
        try {
            // [FIX #profile-staleness] sw/sh раньше кэшировались один раз в замыкании IIFE —
            // меняем на функции, читающие ID.screenWidth/Height при каждом ресайзе/обращении.
            function sw() { return ID.screenWidth || 1920; }
            function sh() { return ID.screenHeight || 1080; }
            // Сохраняем оригинальные геттеры с прототипа Window — они живые,
            // не захваченные значения (которые равны 0 при document_start).
            var _wProto = Object.getPrototypeOf(window);
            // [FIX window-metrics-getters-were-never-found] This looked for the accessors
            // on Window.prototype, and they are NOT there: WebIDL puts the members of a
            // [Global] interface on the global OBJECT, not on its prototype. Measured —
            // Object.getOwnPropertyDescriptor(Window.prototype, 'innerWidth') is undefined
            // in Chrome. So every one of these fell through to the `return 0` stub, and
            // the `if (v <= 0)` branches below then answered with the SPOOFED SCREEN:
            //
            //   real window 900x600  ->  innerWidth 1920, innerHeight 995, outer 1920x1040
            //   after resizing to anything else  ->  still 1920x995
            //
            // Two separate faults from one line. It is a fingerprint contradiction —
            // visualViewport and documentElement.clientWidth reported the real 900 next to
            // a frozen 1920, three APIs describing one viewport and only two of them
            // honest. And it is a plain functional bug: every responsive script reads
            // window.innerWidth, so pages laid out for 1920 inside a 900px window while
            // CSS media queries, which the extension does not touch, saw the truth.
            //
            // Reading the instance first fixes it. The prototype lookup stays as the
            // fallback for anything that really does live there, and the 0-stub stays for
            // a property that exists on neither — but nothing reaches it now.
            //
            // [FIX window-globals-ignored-their-receiver] The bound copy stays: every
            // clamp below wants OUR window's live number and nothing else, and binding is
            // what makes `_giW()` mean that. But a bound function discards the receiver,
            // so it is useless as the oracle — `_giW.call({})` would answer 1280 where the
            // platform throws, and `_giW.call(otherWindow)` would hand our geometry over
            // under the name of theirs. The UNBOUND getter is kept beside it as `afpRaw`
            // (null when the capture did not verify) and is the ONLY thing the receiver
            // check calls.
            function _origGetter(prop) {
                var d = Object.getOwnPropertyDescriptor(window, prop);
                if (!(d && d.get)) d = Object.getOwnPropertyDescriptor(_wProto, prop);
                if (d && d.get) {
                    var bound = d.get.bind(window);
                    bound.afpRaw = _winOracle(d.get);
                    return bound;
                }
                // The 0-stub is tagged, because outerWidth/outerHeight below have to tell
                // "the browser answered 0" from "there was nothing to ask". The first is
                // ordinary and transient and gets passed through; the second would pin the
                // window at zero forever, which no browser does.
                var miss = function() { return 0; };
                miss.afpNoGetter = true;
                // No afpRaw: a stub that answers 0 for everything is the exact opposite of
                // an oracle, so the property keeps the old receiver-blind behaviour rather
                // than delegating into it.
                return miss;
            }
            // Reads the raw platform value for a receiver that is NOT this window. It
            // throws whatever the platform throws, which is the whole point: the refusal is
            // the platform's own, not a TypeError we constructed and could get wrong.
            // Measured against a clean browser, both halves of the same probe page:
            //
            //   .call({})                TypeError: Illegal invocation          (identical)
            //   .call(crossOriginFrame)  SecurityError: Blocked a frame with …  (identical)
            //
            // and with the modules served as ONE file, the shape they ship in, the thrown
            // stack carries only the page's own frames — _mn's apply trap routes it through
            // _stripOwnFrames, so no extension URL rides out. Served as separate files the
            // rig sees our frames, because _selfUrl is then mw-core.js's URL alone; that is
            // the rig, not the build.
            function _rawFor(g, recv) {
                return g.afpRaw ? g.afpRaw.call(recv) : g();
            }
            var _giW = _origGetter('innerWidth'),  _giH = _origGetter('innerHeight');
            var _goW = _origGetter('outerWidth'),  _goH = _origGetter('outerHeight');
            // [FIX outer-inner-chrome] outer ~ screen, inner ~ screen - chrome when maximized.
            //
            // [FIX chrome-height-constant-matched-no-real-browser] The constant was 85 and no
            // browser on this machine produces that. Measured in a REAL window, fresh profile,
            // no bookmarks bar (Chrome default), outerHeight - innerHeight:
            //
            //     Google Chrome 151.0.7922.138 (the installed one)   95
            //     Playwright bundled Chromium 151                    95
            //     this build                                         85
            //
            // Two independent browsers agree on 95, so 85 was a value nobody has - which is the
            // same class of tell as any other invented constant, just quieter.
            //
            // It is a CONSTANT on purpose, and must stay one: the real chrome height moves with
            // the bookmarks bar, so following the host would publish a bit that outlives a
            // profile change. Unlike the panel colour space, nothing else can reach this number -
            // innerHeight and outerHeight are both ours - so a constant genuinely hides it, and
            // the only question is which constant. 95 is the answer both browsers gave.
            //
            // Only reachable when the real window is TALLER than the claimed screen and both get
            // clamped - a small window keeps its own honest numbers. That is why the check for it
            // forces a large window, and why headless with a default viewport cannot see it.
            // Held by test/windowchrome.mjs.
            var _CHROME_H = 95;
            // [FIX window-globals-ignored-their-receiver] The clamps are split out of the
            // getters so the SAME transform can run on another window's raw numbers.
            //
            // A valid foreign Window must not get the native value raw. Every realm this
            // extension patches carries one profile, and sw()/sh()/_availH()/_CHROME_H are
            // all profile-derived, so re-running the clamp here reproduces that frame's own
            // answer BY CONSTRUCTION. Returning the raw native instead would split the two
            // halves of one pair in a single line of page script — measured on a clean
            // Chromium 151, a 300px-wide child frame:
            //
            //   child.innerWidth                        300     (child's own getter)
            //   innerWidth-descriptor.call(childWin)    300     (clean: they agree)
            //   outerWidth-descriptor.call(childWin)   1280     (the top-level browser window)
            //   screenX-descriptor.call(childWin)        10     (the real desktop offset)
            //
            // Under a claimed screen those last two are exactly the numbers _fitPos and the
            // sw() cap exist to hide, and the frame's own getters would have hidden them.
            //
            // NOT FIXED HERE, and measured so the next reader does not have to: a HIDDEN or
            // zero-size frame reads 0x0 in a clean browser, and the `v <= 0` arms below
            // answer the claimed screen instead — 1920x945 under a 1920x1080 profile, which
            // then drags that frame's screenX/screenY to 0 against a clean 10. That is the
            // frame's OWN getter misreporting and predates this change; running the same
            // transform for a foreign receiver keeps the two halves agreeing rather than
            // opening a frame-vs-top split. outerWidth/outerHeight had the same arm repaired
            // by [FIX outer-was-the-screen-while-inner-was-the-window]; inner never did, and
            // the position pair would need the `inner <= 0 -> sw()` fallback repaired too,
            // so it is one defect of its own and not a line to slip in here.
            function _inWv(v) {
                // [FIX host-mode] The window is the window: no claimed screen to clamp to.
                if (_hostHwNow()) return v;
                if (v <= 0) return sw();
                return Math.min(sw(), v);
            }
            Object.defineProperty(window, 'innerWidth',  { get: _mn(function innerWidth() {
                return _inWv(_isSelfWin(this) ? _giW() : _rawFor(_giW, this));
            }, true), configurable: true });
            function _inHv(v) {
                if (_hostHwNow()) return v;
                // [FIX chrome-height-was-measured-from-the-wrong-edge] _CHROME_H used to be
                // subtracted from the SCREEN height while outerHeight is capped at the
                // AVAILABLE height, so the browser chrome the pair implied was
                // availHeight - (screenHeight - 85) = 45px, not the 85 this constant is
                // named for. Real Chrome on this host measures 95-98. Only reachable when
                // the real window is taller than the claimed screen and both get clamped,
                // but there it made outerHeight - innerHeight about half of any real
                // browser's.
                var maxInner = Math.max(200, _availH() - _CHROME_H);
                if (v <= 0) return maxInner;
                // [FIX screen-smaller-than-the-window-was-refutable] A window that FITS the
                // claimed screen keeps its real height, because CSS lays the page out at that
                // height and the two have to agree. This used to cap at availH - _CHROME_H
                // regardless, so any window taller than that — 946px and up on a claimed
                // 1080p screen — reported a height the layout contradicted:
                //
                //   innerHeight 945   against   100vh 1031.37
                //
                // measured on a real Chrome. The width had the same defect and is cured by
                // the screen clamp alone (min(sw(), v) is a no-op once sw() >= the native
                // screen); the height needed this clause too, because its cap is derived
                // from availH rather than from the screen.
                //
                // The clamp below still runs for a window TALLER than the claimed screen,
                // which is the case test/windowchrome.mjs forces and the only one where
                // the synthetic _CHROME_H is reachable.
                if (v <= sh()) return v;
                if (v >= sh() - 10) return maxInner;
                return Math.min(maxInner, v);
            }
            Object.defineProperty(window, 'innerHeight', { get: _mn(function innerHeight() {
                return _inHv(_isSelfWin(this) ? _giH() : _rawFor(_giH, this));
            }, true), configurable: true });
            // avail-like height (taskbar) — never report outerHeight === screen.height
            function _availH() { return Math.round((sh() * 0.963) / 8) * 8; }
            // [FIX outer-was-the-screen-while-inner-was-the-window] `outer <= 0` used to be
            // folded into the maximized test and answer the claimed SCREEN. But the browser
            // hands 0 for the window geometry before it knows it — measured in the first
            // inline script of every load — and in that instant `inner` is already correct.
            // Answering sw() there published a window the page could refute with one
            // subtraction, in the same tick:
            //
            //   parse   inner 1280x720   outer 1920x1040   =>  640px of chrome wide, 320px tall
            //   load    inner 1280x720   outer 1280x 815   =>    0px            wide,  95px tall
            //
            // found by tools/probe-time.mjs, which exists to sweep exactly this axis. 640px of
            // horizontal browser chrome is not a value any browser produces; this file's own
            // _CHROME_H comment records that two real browsers measured 95 vertical, and that
            // inventing a number nobody has is the tell.
            //
            // The answer is to pass the 0 THROUGH, not to substitute a better guess. A first
            // repair returned the inner width instead, which cures the contradiction but
            // leaves a second one: it makes our timeline FLAT where every clean browser's
            // steps. Measured on the clean side, four launch shapes, headless and headed,
            // emulated viewport and real: outerWidth/outerHeight are 0 in the first inline
            // script in all four. So 0 is not a value to hide — it is the value everybody
            // has, for as long as everybody has it, and the shape of the timeline matches
            // clean only if we report it too. A page that subtracts gets a negative number
            // here exactly as it does with no extension installed.
            //
            // The tag is the one case that must NOT pass through: `afpNoGetter` means there
            // was no property to read, so the 0 is ours rather than the browser's and would
            // never be corrected. That keeps the old behaviour on the path it was written for.
            //
            // The maximized case is untouched: a window whose inner already fills the claimed
            // screen still reports the screen.
            function _outWv(inner, outer) {
                if (_hostHwNow()) return outer;
                var i = inner > 0 ? Math.min(sw(), inner) : sw();
                if (outer <= 0) return _goW.afpNoGetter ? sw() : outer;
                // maximized: outerWidth can equal screen.width (normal)
                if (outer >= sw() - 2 || i >= sw() - 2) return sw();
                return Math.min(sw(), Math.max(i, outer));
            }
            Object.defineProperty(window, 'outerWidth',  { get: _mn(function outerWidth() {
                if (_isSelfWin(this)) return _outWv(_giW(), _goW());
                return _outWv(_rawFor(_giW, this), _rawFor(_goW, this));
            }, true), configurable: true });
            function _outHv(inner, outer) {
                if (_hostHwNow()) return outer;
                var ah = _availH();
                var i = inner > 0 ? Math.min(ah, inner) : Math.max(200, ah - _CHROME_H);
                // [FIX hasVvpScreenRes] CreepJS:
                //   (innerWidth===screen.width && outerHeight===screen.height) OR
                //   (visualViewport.width===screen.width && visualViewport.height===screen.height)
                // Old code returned outerHeight=screen.height when maximized → flag true.
                // Real maximized Chrome ≈ screen.availHeight (< screen.height due to taskbar).
                // Same repair as outerWidth above, and the half that carried the 320px: the
                // available height is not the window's height merely because the window has
                // not reported one yet, and a clean browser says 0 here.
                if (outer <= 0) return _goH.afpNoGetter ? ah : outer;
                if (outer >= sh() - 2 || inner >= sh() - 10) return ah;
                return Math.min(ah, Math.max(i + _CHROME_H, outer));
            }
            Object.defineProperty(window, 'outerHeight', { get: _mn(function outerHeight() {
                if (_isSelfWin(this)) return _outHv(_giH(), _goH());
                return _outHv(_rawFor(_giH, this), _rawFor(_goH, this));
            }, true), configurable: true });
            // [FIX window-position-put-it-off-the-screen-edge] inner/outer are clamped to
            // the SPOOFED screen above, but the window's POSITION was left real — and the
            // two have to agree. Measured, real window at (10,10) under a 1920x1080
            // profile, in headless and headed alike:
            //
            //   screen 1920x1080   avail 1920x1040   outer 1920x1040   screenX,screenY 10,10
            //   screenX + outerWidth  = 1930 > 1920
            //   screenY + outerHeight = 1050 > 1040
            //
            // The window reports itself as exactly filling the desktop work area while
            // sitting ten pixels in from the corner — it would hang off two edges at once.
            // No real browser can produce that; two subtractions detect it. Without the
            // extension both sums fit, as they must.
            //
            // The clamp keeps the real offset whenever it still fits and otherwise slides
            // the window back inside, which for the maximized shape this file already
            // reports means (0,0) — precisely what a maximized Chrome reports. screenLeft
            // and screenTop are the same values under older names, so they are patched
            // together: leaving one pair unclamped would trade this contradiction for a
            // fresh one between two spellings of the same number.
            var _gSX = _origGetter('screenX'), _gSY = _origGetter('screenY');
            function _fitPos(real, extent, limit) {
                var v = (typeof real === 'number' && isFinite(real)) ? real : 0;
                if (v < 0) v = 0;
                return Math.min(v, Math.max(0, limit - extent));
            }
            function _posX() { if (_hostHwNow()) return _gSX(); return _fitPos(_gSX(), window.outerWidth, sw()); }
            function _posY() { if (_hostHwNow()) return _gSY(); return _fitPos(_gSY(), window.outerHeight, _availH()); }
            // [FIX window-globals-ignored-their-receiver] The foreign-Window arm rebuilds the
            // clamp's second argument from THAT window's raw inner/outer rather than reading
            // `window.outerWidth`, which would be ours. Reaching it through the receiver as a
            // property (`recv.outerWidth`) is deliberately not done: that invokes a
            // page-reachable accessor, so a detector could install a counting getter on a
            // frame and watch it tick whenever the top's descriptor is called with that
            // frame — a side channel a clean browser does not have.
            //
            // screenLeft/screenTop are separate descriptors with their own native getters, so
            // each one delegates to its own: sharing _gSX would answer for screenX where the
            // platform was asked about screenLeft, and the two spellings must not drift.
            function _posFor(g, recv, vertical) {
                var real = _rawFor(g, recv);
                if (_hostHwNow()) return real;
                var inner = _rawFor(vertical ? _giH : _giW, recv);
                var outer = _rawFor(vertical ? _goH : _goW, recv);
                return vertical
                    ? _fitPos(real, _outHv(inner, outer), _availH())
                    : _fitPos(real, _outWv(inner, outer), sw());
            }
            var _gSL = _origGetter('screenLeft'), _gST = _origGetter('screenTop');
            Object.defineProperty(window, 'screenX', { get: _mn(function screenX() {
                return _isSelfWin(this) ? _posX() : _posFor(_gSX, this, false);
            }, true), configurable: true });
            Object.defineProperty(window, 'screenY', { get: _mn(function screenY() {
                return _isSelfWin(this) ? _posY() : _posFor(_gSY, this, true);
            }, true), configurable: true });
            Object.defineProperty(window, 'screenLeft', { get: _mn(function screenLeft() {
                return _isSelfWin(this) ? _posX() : _posFor(_gSL, this, false);
            }, true), configurable: true });
            Object.defineProperty(window, 'screenTop', { get: _mn(function screenTop() {
                return _isSelfWin(this) ? _posY() : _posFor(_gST, this, true);
            }, true), configurable: true });

            // documentElement.clientWidth — живое свойство, читаем напрямую через прото
            var docEl = document.documentElement;
            if (docEl) {
                // [FIX client-size-read-offsetheight-instead] Same shape of mistake as the
                // window getters above: this took Object.getPrototypeOf(docEl), which is
                // HTMLHtmlElement.prototype, and clientWidth/clientHeight are own
                // properties of Element.prototype — measured, the descriptor was undefined
                // and BOTH fell through to the offsetWidth/offsetHeight fallback. offsetWidth
                // happened to match the viewport width, so nobody noticed; offsetHeight is
                // the CONTENT height, so document.documentElement.clientHeight reported
                // **18** on an ordinary page where the browser says 482. That is not a
                // fingerprinting detail — it is the number sticky headers, virtual scrollers
                // and modal sizing are computed from.
                //
                // Walk the chain for whichever object really owns the accessor, and clamp
                // to the REPORTED viewport rather than to the screen: the client box is
                // inside the viewport, never inside the monitor.
                // [FIX docel-client-size-was-an-own-property] The walk below finds the object
                // that really owns the accessor — Element.prototype — and the patch now goes
                // THERE. It used to go on `docEl` itself, which gave the element two own
                // properties no element has. Measured against clean Chromium on the same
                // machine, one line and no statistics:
                //
                //   Object.getOwnPropertyNames(document.documentElement)
                //     clean  []
                //     ours   ["clientWidth","clientHeight"]
                //
                // Exactly the class already removed from navigator.connection
                // ([FIX worker-connection-was-half-patched]) and from the UA-CH object
                // ([FIX uad-shape-not-just-values]): the VALUE was plausible and the SHAPE
                // was impossible.
                //
                // On the prototype the getter has to stay honest for every other element, so
                // it clamps only for the one element this is about and hands everything else
                // straight to the native accessor — the same identity-check shape as the
                // DOMRect accessors in mw-misc.js.
                function _accessorOwner(obj, prop) {
                    for (var p = obj; p; p = Object.getPrototypeOf(p)) {
                        var d = Object.getOwnPropertyDescriptor(p, prop);
                        if (d && d.get) return { proto: p, desc: d };
                    }
                    return null;
                }
                function _clampClientSize(prop, getter) {
                    var found = _accessorOwner(docEl, prop);
                    if (!found) return;
                    var native = found.desc.get;
                    try {
                        Object.defineProperty(found.proto, prop, {
                            get: _mn(getter(native), true),
                            configurable: found.desc.configurable !== false,
                            enumerable: found.desc.enumerable !== false
                        });
                    } catch (eCS) {}
                }
                _clampClientSize('clientWidth', function (native) {
                    return function clientWidth() {
                        var v = native.call(this);
                        return this === document.documentElement ? Math.min(window.innerWidth, v) : v;
                    };
                });
                _clampClientSize('clientHeight', function (native) {
                    return function clientHeight() {
                        var v = native.call(this);
                        return this === document.documentElement ? Math.min(window.innerHeight, v) : v;
                    };
                });
            }
            // [FIX hasVvpScreenRes-vv] visualViewport must never equal screen width+height together
            // [FIX visualviewport-clamp-sat-on-the-instance] The two clamps were defined ON
            // window.visualViewport. A real VisualViewport has no own properties — width
            // and height are accessors on its prototype — so the instance answered
            // Object.getOwnPropertyNames with ['width','height'] where a clean browser
            // answers ''. Same class as the navigator.connection and documentElement lies
            // test/ownprops.mjs already watches; the object was simply not on its list.
            // The accessors sit on VisualViewport.prototype now, the native getter runs
            // first on `this` so a foreign receiver throws exactly as native does, and the
            // descriptor keeps the native flags.
            //
            // The visual viewport lives INSIDE the layout viewport, so it is clamped to
            // what innerWidth/innerHeight report rather than to the screen — before the
            // window-getter fix above those two were frozen at the screen size while this
            // pair kept returning the real window, the same viewport described twice. The
            // hasVvpScreenRes guard this block was written for still holds without a
            // special case: CreepJS flags
            //   visualViewport.width === screen.width && visualViewport.height === screen.height
            // and innerHeight is capped at screen height minus the browser chrome, so the
            // height half can never match.
            try {
                if (window.visualViewport && typeof VisualViewport !== 'undefined' && VisualViewport.prototype) {
                    var _vvProto = VisualViewport.prototype;
                    [['width', 'innerWidth'], ['height', 'innerHeight']].forEach(function (pair) {
                        var key = pair[0], limit = pair[1];
                        var d = Object.getOwnPropertyDescriptor(_vvProto, key);
                        if (!d || typeof d.get !== 'function') return;
                        var nat = d.get;
                        Object.defineProperty(_vvProto, key, {
                            get: _mn(({ [key]: function () {
                                var v = nat.call(this);
                                return Math.min(v, window[limit]);
                            } })[key], true),
                            set: d.set,
                            enumerable: d.enumerable,
                            configurable: d.configurable
                        });
                    });
                }
            } catch (eVV) {}
        } catch(e) {}
    })();

})();
