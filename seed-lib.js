'use strict';
/**
 * THE single source of the per-domain noise seed.
 *
 * Two consumers derive this seed independently and MUST agree exactly:
 *   background.js     builds the injected profile and the WASM argument
 *   storage-bridge.js runs in every frame and publishes the sessionStorage fallback
 *
 * They agreed because the ~90-entry public-suffix table below was copied verbatim into
 * both, and test/parity-static.mjs compared the two copies character for character. This
 * file removes the copy instead of guarding it: mw/mw-core.js HARD-LOCKS the first seed it
 * resolves for a page load, so a single divergent hostname makes the window and a worker
 * draw one canvas with two seeds — the split [FIX seed-computed-twice] and
 * [FIX provisional-seed-was-locked-forever] both describe.
 *
 * Loaded the same way defaults.js is, which is what makes one copy possible at all:
 *   background.js     importScripts('defaults.js', 'seed-lib.js')  — one SW global scope
 *   manifest.json     ISOLATED content_scripts, ahead of storage-bridge.js
 * The MAIN world cannot importScripts, so mw/*.js still cannot share this — but nothing
 * there derives a domain seed: it receives one.
 *
 * test/harness.mjs inlines this file when it runs background.js, so the ~1100 assertions
 * in test/background-fns.mjs keep exercising these two functions unchanged.
 */
/* eslint-disable no-unused-vars */

function registrableDomain(hostname) {
    try {
        var h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
        if (!h || h === 'localhost') return h || 'localhost';
        // IPv4 / IPv6 — treat as-is
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.indexOf(':') !== -1) return h;
        var parts = h.split('.').filter(Boolean);
        if (parts.length <= 2) return h;

        // Known multi-label public suffixes. Value = number of labels that form the public suffix.
        // Registrable domain = public-suffix labels + 1.
        var MULTI = {
            // United Kingdom
            'co.uk': 2, 'org.uk': 2, 'me.uk': 2, 'ac.uk': 2, 'gov.uk': 2,
            'ltd.uk': 2, 'plc.uk': 2, 'net.uk': 2, 'sch.uk': 2,
            // Australia
            'com.au': 2, 'net.au': 2, 'org.au': 2, 'edu.au': 2, 'gov.au': 2,
            'asn.au': 2, 'id.au': 2, 'csiro.au': 2,
            // Japan
            'co.jp': 2, 'or.jp': 2, 'ne.jp': 2, 'ac.jp': 2, 'go.jp': 2,
            'ed.jp': 2, 'gr.jp': 2, 'lg.jp': 2,
            // Brazil
            'com.br': 2, 'net.br': 2, 'org.br': 2, 'gov.br': 2, 'edu.br': 2,
            'art.br': 2, 'blog.br': 2, 'flog.br': 2, 'vix.br': 2,
            // New Zealand
            'co.nz': 2, 'net.nz': 2, 'org.nz': 2, 'govt.nz': 2, 'ac.nz': 2,
            'school.nz': 2, 'geek.nz': 2, 'gen.nz': 2, 'kiwi.nz': 2,
            // South Africa
            'co.za': 2, 'org.za': 2, 'web.za': 2, 'gov.za': 2, 'ac.za': 2, 'edu.za': 2,
            // Mexico / LatAm
            'com.mx': 2, 'org.mx': 2, 'gob.mx': 2, 'edu.mx': 2, 'net.mx': 2,
            'com.ar': 2, 'org.ar': 2, 'gov.ar': 2, 'edu.ar': 2, 'net.ar': 2,
            'com.cl': 2, 'gob.cl': 2, 'gov.cl': 2,
            'com.co': 2, 'org.co': 2, 'gov.co': 2, 'edu.co': 2, 'net.co': 2,
            'com.pe': 2, 'org.pe': 2, 'gob.pe': 2, 'edu.pe': 2, 'net.pe': 2,
            // Turkey
            'com.tr': 2, 'org.tr': 2, 'gov.tr': 2, 'edu.tr': 2, 'k12.tr': 2,
            'av.tr': 2, 'bel.tr': 2, 'pol.tr': 2, 'gen.tr': 2,
            // India
            'co.in': 2, 'org.in': 2, 'net.in': 2, 'gov.in': 2, 'ac.in': 2,
            'res.in': 2, 'edu.in': 2, 'firm.in': 2, 'gen.in': 2, 'ind.in': 2,
            // China / East Asia
            'com.cn': 2, 'net.cn': 2, 'org.cn': 2, 'gov.cn': 2, 'edu.cn': 2, 'ac.cn': 2,
            'com.tw': 2, 'org.tw': 2, 'gov.tw': 2, 'edu.tw': 2, 'idv.tw': 2,
            'com.hk': 2, 'org.hk': 2, 'gov.hk': 2, 'edu.hk': 2, 'net.hk': 2, 'idv.hk': 2,
            'com.sg': 2, 'org.sg': 2, 'gov.sg': 2, 'edu.sg': 2, 'net.sg': 2, 'per.sg': 2,
            'com.my': 2, 'org.my': 2, 'gov.my': 2, 'edu.my': 2, 'net.my': 2, 'name.my': 2,
            'co.kr': 2, 'or.kr': 2, 'ne.kr': 2, 'go.kr': 2, 'ac.kr': 2,
            're.kr': 2, 'pe.kr': 2, 'hs.kr': 2, 'ms.kr': 2,
            // Ukraine / CIS
            'com.ua': 2, 'org.ua': 2, 'gov.ua': 2, 'edu.ua': 2, 'net.ua': 2, 'in.ua': 2,
            // Israel / Middle East
            'co.il': 2, 'org.il': 2, 'net.il': 2, 'ac.il': 2, 'gov.il': 2, 'idf.il': 2, 'muni.il': 2,
            'com.sa': 2, 'org.sa': 2, 'gov.sa': 2, 'edu.sa': 2, 'med.sa': 2, 'pub.sa': 2, 'sch.sa': 2,
            'co.ae': 2, 'org.ae': 2, 'gov.ae': 2, 'ac.ae': 2, 'sch.ae': 2, 'net.ae': 2,
            // Europe extras
            'co.at': 2, 'or.at': 2, 'ac.at': 2, 'gv.at': 2, 'priv.at': 2,
            'com.pt': 2, 'org.pt': 2, 'gov.pt': 2, 'edu.pt': 2,
            // Popular platform / private suffixes (so user.github.io gets its own seed)
            'github.io': 2,
            'githubusercontent.com': 2,
            'blogspot.com': 2,
            'blogger.com': 2,
            'herokuapp.com': 2,
            'netlify.app': 2,
            'vercel.app': 2,
            'pages.dev': 2,
            'workers.dev': 2,
            'web.app': 2,
            'firebaseapp.com': 2,
            'appspot.com': 2,
            'azurewebsites.net': 2,
            'cloudfunctions.net': 2,
            'ngrok.io': 2,
            'ngrok-free.app': 2,
            'loca.lt': 2,
            'trycloudflare.com': 2,
            'glitch.me': 2,
            'replit.dev': 2,
            'repl.co': 2,
            'codesandbox.io': 2,
            'stackblitz.io': 2,
            'surge.sh': 2
        };

        // Longest match first (3 then 2 labels)
        for (var n = Math.min(3, parts.length - 1); n >= 2; n--) {
            var candidate = parts.slice(-n).join('.');
            if (MULTI[candidate]) {
                var pubLabels = MULTI[candidate];
                var need = pubLabels + 1;
                if (parts.length >= need) {
                    return parts.slice(-need).join('.');
                }
            }
        }

        // Generic rule for remaining multi-part TLDs
        var sld = parts[parts.length - 2];
        if (['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'gob', 'or', 'ne', 'go', 'ed', 'gr', 'gen', 'ind', 'firm', 'res', 'priv', 'ltd', 'plc'].indexOf(sld) !== -1 && parts.length >= 3) {
            return parts.slice(-3).join('.');
        }
        return parts.slice(-2).join('.');
    } catch (e) {
        return String(hostname || 'unknown');
    }
}

/**
 * The hostname a frame should derive its seed from.
 *
 * Moved here from storage-bridge.js, which had the only copy, when dyn/boot.js became a
 * third consumer — see [FIX seed-was-a-named-page-readable-key]. Everything that derives a
 * domain seed in a PAGE has to answer this question identically, and the reason is the
 * reason at the top of this file: mw/mw-core.js hard-locks the first seed a page load
 * resolves, so two scopes that pick different hostnames draw one canvas with two seeds.
 *
 * [FIX iframe-canvas-seed] Sandbox / about:blank / srcdoc frames often have an empty
 * location.hostname. Deriving from "" made every such frame lock a DIFFERENT seed than the
 * top page — a canvas mismatch between main and iframe on SannySoft / CreepJS. The parent's
 * host is preferred instead, via ancestorOrigins (readable cross-origin in Chrome) or the
 * referrer, which is what makes a frame and its parent agree BY CONSTRUCTION rather than by
 * reading a value across the frame boundary.
 *
 * Never called in the service worker — background.js derives from the tab's URL, which it
 * already has. It is defined there only because this file is one file.
 */
function afpEffectiveHostname() {
    try {
        if (location.hostname) return location.hostname;
    } catch (e0) {}
    try {
        var ao = location.ancestorOrigins;
        if (ao && ao.length) {
            for (var i = 0; i < ao.length; i++) {
                try {
                    var h = new URL(ao[i]).hostname;
                    if (h) return h;
                } catch (e1) {}
            }
        }
    } catch (e2) {}
    try {
        if (window.parent && window.parent !== window) {
            var ph = window.parent.location.hostname;
            if (ph) return ph;
        }
    } catch (e3) {}
    try {
        if (document.referrer) {
            var rh = new URL(document.referrer).hostname;
            if (rh) return rh;
        }
    } catch (e4) {}
    return '';
}

/**
 * Device STATE derived from the master seed — battery and the geolocation offset.
 *
 * [FIX device-state-was-per-domain] These used to be computed in the page from
 * `profile.noiseSeed`, which is the PER-DOMAIN seed (deriveDomainSeed above). Canvas
 * should be per-domain — it is noise, and a different mask per site is the point. Battery
 * charge and physical position are not noise, they are the state of one machine, and a
 * machine has one of each. Measured on a real Chrome, extension on, the same minute:
 *
 *     example.com      battery 0.90   chargingTime 2700   geo 59.4336, 24.7439
 *     127.0.0.1:8901   battery 0.93   chargingTime 2730   geo 59.4437, 24.7243
 *
 * — one device with two charge levels and two positions 1.2 km apart. Any tracker present
 * on both origins (an ad network, an analytics SDK, a script served from a shared CDN)
 * reads a browser contradicting itself, which is the signal this codebase spends its whole
 * effort avoiding: see [FIX adblock-mask-contradicted-the-network] in background.js, where
 * a module is switched OFF rather than allowed to disagree with another layer.
 *
 * So they come from the MASTER seed, which is one number per install, and they are
 * computed HERE because this file is the one place background.js (importScripts) and
 * dyn/boot.js (the generated copy, see tools/gen-dyn.mjs) both run. The page never
 * receives the master itself — that was removed on purpose, it is a ready-made cross-site
 * identifier with no consumer ([FIX masterSeed-shipped-to-the-page] in background.js) —
 * only these finished low-entropy values ride on the profile, the same way the ANGLE
 * strings are resolved in background.js instead of shipping the GPU key.
 *
 * ENTROPY IS DELIBERATELY SMALL, and that is the one thing to preserve if this is edited.
 * Making a value identical on every origin is exactly what turns it into a cross-site
 * identifier, so the win is only real if there is little to identify with. Battery is 33
 * levels plus a flag, which is what a real battery carries anyway. The geolocation offset
 * is quantised to a 20x20 grid over ±0.01° — steps of ~111 m of latitude and ~57 m of
 * longitude at these latitudes, coherent with the 50–89 m accuracy reported beside it —
 * instead of the 1000x1000 grid it used to be. That is ~8.6 bits rather than ~20, and it
 * still keeps the position off the exact country centroid, which is what the offset was
 * for: a round two-decimal coordinate is not a value any real device reports.
 *
 * The four battery numbers are returned together so the derivation exists ONCE. It used
 * to be written out twice — mw/mw-misc.js for the top document and mw/mw-navigator.js for
 * child frames — with no parity assertion holding the copies together, unlike every other
 * duplicated table here. `null` means Infinity: these values cross the JSON boundary of
 * chrome.scripting.executeScript, which turns Infinity into null anyway, so the mapping is
 * written down rather than discovered.
 */
function afpDeviceState(masterSeed, profileId) {
    var s = (typeof masterSeed === 'number' && isFinite(masterSeed)) ? (masterSeed >>> 0) : 0xC0FFEE;
    // Each field gets its own mix of the master, so that (for example) the charging flag
    // is not a function of the latitude offset. Taking `s % 5` and `s % 20` straight off
    // one number makes the second determine the first.
    function mix(salt) {
        var h = (s ^ (salt >>> 0)) >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
        return (h ^ (h >>> 16)) >>> 0;
    }
    // Desktops (pc_*) are mains-powered: Chrome reports charging, level 1. Same rule
    // buildProfile() uses for hasBluetooth, and the reason both keys exist.
    var isDesktop = String(profileId || '').indexOf('pc_') === 0;
    var charging = isDesktop ? true : ((mix(0x9E3779B1) % 5) !== 0);
    var level = isDesktop ? 1 : Math.round((0.62 + (mix(0x85EBCA77) % 33) / 100) * 100) / 100;
    // Deliberately NOT time-varying. A level that moves between two reads without a
    // `levelchange` event is a worse contradiction than one that holds still, and this
    // extension fires no such event; a stationary charge over one page load is ordinary.
    var chargingTime = charging ? (level >= 1 ? 0 : 1800 + ((level * 1000) | 0)) : null;
    var dischargingTime = charging ? null : Math.max(600, Math.round(level * 12000));
    // 20 steps of 0.001° per axis, centred on the country centroid: (q - 9.5) * 0.001.
    var offLat = ((mix(0xC2B2AE3D) % 20) - 9.5) * 0.001;
    var offLon = ((mix(0x27D4EB2F) % 20) - 9.5) * 0.001;
    return {
        batteryLevel: level,
        batteryCharging: charging,
        batteryChargingTime: chargingTime,
        batteryDischargingTime: dischargingTime,
        geoOffsetLat: offLat,
        geoOffsetLon: offLon,
        geoAccuracy: 50 + (mix(0x165667B1) % 40)
    };
}

function deriveDomainSeed(masterSeed, hostname) {
    var base = (typeof masterSeed === 'number' && isFinite(masterSeed)) ? (masterSeed >>> 0) : 0xA5A5A5A5;
    var domain = registrableDomain(hostname);
    // FNV-1a 32-bit mix with domain string
    var h = 0x811c9dc5 >>> 0;
    for (var i = 0; i < domain.length; i++) {
        h ^= domain.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    // mix with master seed
    h = Math.imul(h ^ base, 0x01000193) >>> 0;
    h ^= base >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
}

/**
 * [FIX policy-name-was-a-signature] The Trusted Types policy name mw/mw-workers.js creates
 * its own policy under, and the name background.js writes into a rewritten
 * `trusted-types` allowlist — ONE function on both sides, evaluated on the same domain
 * seed. It used to be the literal 'afp-blob-url', readable through
 * trustedTypes.getPolicyNames() on every origin where the wrapper minted: the extension's
 * signature, and the one thing the open-work list still listed as open after the CSP rewrite. Derived
 * from the DOMAIN seed rather than drawn once per install, because the same string on
 * every site would be a cross-site identifier, which is worse than a signature. Stable per
 * site and install, different across sites, not a string anyone can grep for. A letter
 * first, then letters and digits, 8 long — a valid tt-policy-name token and the shape of a
 * minified name. The MAIN-world copy in mw/mw-workers.js is held to this one by
 * test/parity-static.mjs.
 */
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
