// storage-bridge.js — ISOLATED world, document_start.
// Publishes timezone, locale, protection mode, noiseSeed (+ early profile skeleton) to MAIN via DOM.
(function() {
    'use strict';
    if (window.__afp_bridge_started__) return;
    window.__afp_bridge_started__ = true;

    // registrableDomain + deriveDomainSeed come from seed-lib.js, which the manifest loads
    // into this ISOLATED entry ahead of this file — the same arrangement defaults.js already
    // has for afpPackFeatures below. They used to be COPIED here from background.js, all ~90
    // public-suffix entries of them, and the two copies had to stay identical character for
    // character: this file publishes the seed every frame falls back to, background.js
    // derives the one that rides on the profile, and mw-core hard-locks whichever arrives
    // first. One divergent hostname and the window and a worker draw the same canvas with
    // two different seeds.
    // effectiveHostname moved into seed-lib.js as afpEffectiveHostname when dyn/boot.js
    // became a third consumer of the same question — see the note there. This file is
    // still the reason it has to be one answer: the seed it derives and the one boot.js
    // derives have to be the same number in the same frame.
    function toDomainSeed(master) {
        if (typeof master !== 'number' || !isFinite(master)) return master;
        try {
            return deriveDomainSeed(master >>> 0, afpEffectiveHostname());
        } catch (e) {
            return master >>> 0;
        }
    }

    // [IMPROVE variant-4] Publish richer early data so profile-injector can avoid
    // inventing a wrong locale/timezone. We still only send what is already in
    // storage — no reconstruction of the full coherent profile (that stays in
    // background.js). Goal: cold-start pages get the last known country +
    // hardware skeleton as early as the async storage read allows, instead of
    // a hard-coded Tallinn/et-EE bootstrap.
    function publish(tz, locale, mode, noiseSeed, features, profileData, profileId) {
        try {
            // [FIX bridge-attributes-were-an-extension-detector] tz/lc/md/ft are no longer
            // written to the DOM. A clean browser has ZERO attributes on <html>; every one
            // of these announced the extension to any script that looked, and they were
            // read only at document_start — by which time this async callback has not run.
            // The ui:ready event below carries the same fields to the one consumer that
            // exists (profile-injector.js), which is how the cold start actually works.
            // data-v-ns went the same way — this note used to say it stayed, for the
            // parent-frame read in mw-core._getSessionSeed. It does not, and the two
            // halves of this comment contradicted each other. A frame gets the domain
            // seed from its OWN copy of this file instead, and afpEffectiveHostname() below
            // already prefers the parent's host for blank/sandbox/srcdoc frames — so the
            // frame and its parent agree by construction rather than by reading across
            // the frame boundary.
            // [FIX only-boot-js-could-send-the-device-state] The battery level and the
            // geolocation offset are derived from the MASTER seed by afpDeviceState, and
            // until now only dyn/boot.js sent them. When boot.js does not run — its markers
            // are not registered yet, or it bails at `!dev || !cc` — this bridge still
            // delivers the machine and the seed, so everything LOOKS right, and the page
            // keeps profile-injector's literal 0.82 battery for the whole load. Measured on
            // a fresh install, one tab, tools/probe-seed.mjs:
            //
            //   load 1  ui:ready deviceState=ABSENT seed=false | deviceState=ABSENT seed=true
            //           -> battery 0.82 (the literal), canvas CORRECT
            //   load 2  ui:ready deviceState=0.78   seed=true  | deviceState=ABSENT seed=true
            //           -> battery 0.78, the value the stored seed implies
            //
            // The canvas survives because the seed travels by two routes and the device
            // state travelled by one. So it travels by two now. This file has what it
            // needs: the MASTER seed, before the line below turns it into the domain one,
            // and seed-lib.js loaded into this ISOLATED entry ahead of it — the same
            // afpDeviceState background.js and dyn/boot.js call, not a fourth copy of it.
            //
            // profile-injector merges this field by field with a guard on each, so the two
            // producers cannot blank each other out and whichever arrives first wins.
            var deviceState;
            if (typeof noiseSeed === 'number' && isFinite(noiseSeed)
                && typeof afpDeviceState === 'function' && profileId) {
                try { deviceState = afpDeviceState(noiseSeed >>> 0, profileId); } catch (eDs) {}
            }
            if (typeof noiseSeed === 'number' && isFinite(noiseSeed)) {
                // [FIX seed-race] Publish domain seed, not master — main-world hard-locks first value
                var domainSeed = toDomainSeed(noiseSeed >>> 0);
                // Nothing is published anywhere a page can read: the ui:ready detail below
                // is the only carrier, and dyn/boot.js has already delivered the same
                // number synchronously by the time this async callback runs. See
                // mw/mw-core.js _getSessionSeed.
                noiseSeed = domainSeed;
            }
        } catch (e) {}
        try {
            document.dispatchEvent(new CustomEvent('ui:ready', {
                detail: {
                    timezone: tz || '',
                    locale: locale || '',
                    mode: mode || 'normal',
                    noiseSeed: (typeof noiseSeed === 'number' && isFinite(noiseSeed)) ? (noiseSeed >>> 0) : undefined,
                    // Extra fields for early coherent bootstrap (variant-4)
                    profileData: (profileData && typeof profileData === 'object') ? profileData : undefined,
                    profileId: profileId || undefined,
                    // The second route for the device state — see the note above.
                    deviceState: deviceState,
                    features: (features && typeof features === 'object') ? features : undefined
                }
            }));
        } catch (e) {}
        try {
            // [FIX default-config-still-left-two-keys] Both keys go through the shared
            // writer in defaults.js, which removes them when they carry the default.
            afpPersistSelection(sessionStorage, mode, features);
            // [FIX feature-flags-arrived-three-hops-late] The flags survive a reload in
            // 'v.ui.f' because mw-core decides _FEAT as it loads and dyn/boot.js runs after
            // it (see the note there). Until now the ONLY writer was mw-core's own ui:state
            // listener, which means the value had to travel
            //
            //   this callback -> ui:ready -> profile-injector merge -> ui:state -> mw-core
            //
            // before it landed. A page that loaded and reloaded quickly beat that chain and
            // came up with default flags — measured as an intermittent failure of the
            // clientRects scenario in test/coldstart.mjs, roughly one run in six.
            //
            // This is the first point in the whole extension that knows the flags, so it
            // writes them here, exactly as it already does for the mode.
            // afpPersistSelection/afpPackFeatures come from defaults.js, which the manifest
            // loads into this ISOLATED entry ahead of this file, so the bit order is the
            // shared one rather than a third private copy.
            //
            // [FIX seed-was-a-named-page-readable-key] `afp_noise_seed_fallback` was
            // written here. It named the extension in its KEY and carried the exact
            // per-domain canvas seed in its VALUE, on the page's own origin. The noise is
            // deterministic and positional — hash(seed, absX, absY), ±1 per channel, the
            // same formula in protect_c.source and mw-canvas-audio — so handing over the
            // seed makes the mask computable analytically and subtractable. That is the
            // one canvas attack the flat-region restore does NOT defeat: an empirical
            // known-image mask measures zero delta on flat pixels, an analytic one does
            // not need to measure anything.
            //
            // The seed now travels the way the machine already does: background.js
            // registers dyn/ns/<nibble>.js x8 alongside the other boot files, dyn/boot.js
            // rebuilds the master from their names and derives the per-domain value with
            // the same deriveDomainSeed every other consumer uses. That is a MAIN-world
            // document_start content script, so it lands before the page's first line —
            // earlier than this async callback ever did — and nothing is stored.
        } catch (e) {}
    }

    // [FIX csp-blob-worker-broke-whatsapp] Hosts whose CSP forbids blob: workers, learned in
    // background.js from the response headers. mw/mw-workers.js reads exactly this
    // sessionStorage key already — it just used to be set only AFTER a worker had died, by
    // which time the page was holding a corpse. On web.whatsapp.com that first worker is the
    // application, so the site did not load at all.
    //
    // Written here rather than passed through ui:ready because the key is what the MAIN
    // world consults, and because this file runs in every frame at document_start. The get
    // is async (~8 ms), but a page's own workers are created after its bundle has loaded,
    // which is far later — and from the second load the value is already in sessionStorage.
    var CSP_NOBLOB_KEY = 'afp_csp_noblob';
    var BLOB_BLOCKED_KEY = 'v.ui.wb';
    // [FIX tt-policy-name-was-probed-by-trying-it] Hosts whose CSP restricts which Trusted
    // Types policy NAMES may exist, learned from the response header in background.js. This
    // one has to arrive before mw-workers decides anything, because the way it used to find
    // out was to CALL createPolicy — and a rejected call reports a violation naming
    // mw-bundle.js before it throws, which no try/catch can undo.
    var CSP_TT_KEY = 'afp_csp_tt';
    var TT_BLOCKED_KEY = 'v.ui.tt';
    // [FIX importscripts-fallback-killed-turnstile] Origins whose CSP refuses a blob: read,
    // so mw-workers can pass through instead of asking and printing a violation.
    var CSP_NC_KEY = 'afp_csp_nc';
    var NC_BLOCKED_KEY = 'v.ui.nc';
    // Whether a worker on this origin may importScripts a blob: URL — the permission the
    // wrapper's fallback needs, and NOT the same as being allowed to create the worker.
    var CSP_NS_KEY = 'afp_csp_ns';
    var NS_BLOCKED_KEY = 'v.ui.ns';
    // [FIX a-refusal-we-passed-through-was-charged-to-us] For the ONE flag that takes a
    // per-document verdict (tte, see askCspVerdict): the host's history ('1') fills it in
    // only where this document's own answer is not there. A settled value ('2'/'0') is
    // tagged with performance.timeOrigin, which every world of one document reads alike;
    // one tagged for another document in the tab is history, and '1' says as much.
    // The tag is the storage OWNER's timeOrigin: the highest same-origin ancestor. A
    // same-origin frame shares the tab's sessionStorage and is another document, so its
    // own timeOrigin would make the top's verdict look like history from inside the frame
    // (measured on the audit page's probe frames, which reset the top's '2' to '1').
    // [FIX csp-restrictions-learned-per-route] The lists hold host/segment (afpCspScope in
    // defaults.js); this document's route is the storage owner's — a blank or srcdoc frame
    // has no route of its own and shares the top's flags anyway.
    function afpDocScope() {
        try { var s = afpCspScope(afpStorageOwner().location.href); if (s) return s; } catch (e) {}
        try { return afpCspScope(location.href); } catch (e2) { return ''; }
    }
    function afpStorageOwner() {
        var w = window;
        try { while (w.parent !== w && w.parent.location.href !== undefined) w = w.parent; } catch (e) {}
        return w;
    }
    function afpDocTag() { try { return String(afpStorageOwner().performance.timeOrigin); } catch (e) { return ''; } }
    // [FIX csp-restrictions-learned-per-route] Every flag value is 'code:timeOrigin:route',
    // route = host/first segment of the storage owner: sessionStorage outlives the document,
    // and a bare '1' left by a strict route stood the next loose document of the tab down.
    // A reader takes another document's value only as history for the SAME route.
    function afpFlagTag() { return afpDocTag() + ':' + afpDocScope(); }
    function afpFlagMine(cur) {
        cur = String(cur || '');
        var i = cur.indexOf(':');
        return i > 0 && cur.slice(i + 1) === afpFlagTag();
    }
    /** The host list says restricted for this route: '1' for this document, unless this document already settled it. */
    function afpHostFlag(key) {
        var cur = sessionStorage.getItem(key);
        if (afpFlagMine(cur) && /^[203]:/.test(String(cur))) return;
        sessionStorage.setItem(key, '1:' + afpFlagTag());
    }
    function applyCspNs(list) {
        try {
            if (!Array.isArray(list)) return;
            var scope = afpDocScope();
            if (!scope) return;
            if (afpCspScopeMatches(list, scope)) afpHostFlag(NS_BLOCKED_KEY);
        } catch (e) {}
    }
    function applyCspNc(list) {
        try {
            if (!Array.isArray(list)) return;
            var scope = afpDocScope();
            if (!scope) return;
            if (afpCspScopeMatches(list, scope)) afpHostFlag(NC_BLOCKED_KEY);
        } catch (e) {}
    }
    function applyCspTt(list) {
        try {
            if (!Array.isArray(list)) return;
            var scope = afpDocScope();
            if (!scope) return;
            if (afpCspScopeMatches(list, scope)) afpHostFlag(TT_BLOCKED_KEY);
        } catch (e) {}
    }
    // [FIX tt-wrapper-laundered-the-pages-plain-string] Whether this origin REQUIRES a
    // TrustedScriptURL at script sinks. Where it does, mw-workers must leave a worker the
    // page built from a bare string alone, so the browser refuses it exactly as it would
    // without us instead of our wrapper minting a trusted URL of its own and letting it run.
    var CSP_TTE_KEY = 'afp_csp_tte';
    var TT_ENFORCED_KEY = 'v.ui.tte';
    function applyCspTte(list) {
        try {
            if (!Array.isArray(list)) return;
            var scope = afpDocScope();
            if (!scope) return;
            // [FIX a-refusal-we-passed-through-was-charged-to-us] A verdict for THIS document
            // ('2' enforcing, '0' not) outranks the host's history.
            if (afpCspScopeMatches(list, scope)) afpHostFlag(TT_ENFORCED_KEY);
        } catch (e) {}
    }
    // [FIX a-refusal-we-passed-through-was-charged-to-us] This document's own answer to
    // "does the CSP require a TrustedScriptURL at script sinks", from the response headers
    // background.js saw for THIS navigation, milliseconds ago. The host list above is
    // add-only and says only "has enforced before"; mw-workers refuses a bare string on its
    // own — instead of handing it to the browser, which charges the refusal to our frame —
    // only on the stronger answer, '2'. '0' says the opposite and stops a stale host entry
    // from mattering for this document.
    //
    // sessionStorage is per origin and per tab, not per document, so the previous
    // document's verdict is still there at document_start and is cleared here before
    // anything reads it; tte.js (registered per host) then writes '1' if it runs, and the
    // verdict lands after that. Only a frame that OWNS the storage does either: the top
    // document, or a child whose parent is cross-origin. A same-origin child shares the
    // top's storage and must not overwrite the top's answer with its own.
    //
    // Re-asserted on pageshow: a document coming back from the back/forward cache runs no
    // content script, and a later document in the tab may have replaced its value.
    function ownsSessionStorage() {
        return afpStorageOwner() === window;
    }
    // The answer carries all five restrictions (audit.html reads them from the service
    // worker), and only tte is written here — see [MEASURED the-verdict-cannot-decide-identity]
    // in background.js: the four others decide what the window answers, and that has to be
    // known before the page's first script, which this asynchronous answer never is.
    //
    // The previous document's verdict is still in sessionStorage at document_start; it is
    // tagged with ITS timeOrigin, so every reader treats it as history ('1') on its own,
    // and it is demoted here as well so the storage says what the readers see.
    function askCspVerdict() {
        try {
            if (!ownsSessionStorage()) return;
            chrome.runtime.sendMessage({ type: 'afpCspVerdict' }, function (v) {
                try {
                    if (chrome.runtime.lastError || !v || typeof v !== 'object') return;
                    if (v.host !== location.hostname || typeof v.tte !== 'boolean') return;
                    var value = (v.tte ? '2:' : '0:') + afpFlagTag();
                    sessionStorage.setItem(TT_ENFORCED_KEY, value);
                    window.addEventListener('pageshow', function (ev) {
                        try { if (ev && ev.persisted) sessionStorage.setItem(TT_ENFORCED_KEY, value); } catch (eP) {}
                    });
                } catch (eV) {}
            });
        } catch (e) {}
    }
    askCspVerdict();
    function applyCspNoBlob(list) {
        try {
            if (!Array.isArray(list)) return;
            var scope = afpDocScope();
            if (!scope) return;
            if (afpCspScopeMatches(list, scope)) afpHostFlag(BLOB_BLOCKED_KEY);
        } catch (e) {}
    }

    // [FIX adblock-mask-contradicted-the-network] "A network-level ad blocker is refusing ad
    // requests", learned in background.js from ERR_BLOCKED_BY_CLIENT. mw/mw-adblock.js stands
    // down when it is set, so the DOM stops claiming slots are rendered while the network
    // says they were refused — see the measured 4-of-13 table in background.js.
    //
    // Browser-wide and persisted, so unlike the CSP list it is already known on the FIRST
    // page of every site — an ad blocker is not a per-origin fact. It expires on its own if
    // no ad request has been refused for a week, which is how removing the blocker turns the
    // module back on without any other bookkeeping.
    var NET_BLOCK_KEY = 'afp_netblock_seen';
    var NET_BLOCK_FLAG = 'v.ui.ab';
    var NET_BLOCK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    function applyNetBlock(ts) {
        try {
            if (typeof ts === 'number' && isFinite(ts) && (Date.now() - ts) < NET_BLOCK_TTL_MS) {
                sessionStorage.setItem(NET_BLOCK_FLAG, '1');
            } else {
                sessionStorage.removeItem(NET_BLOCK_FLAG);
            }
        } catch (e) {}
    }

    // [FIX cold-start-gpu-was-the-wrong-card] `afp_profile_data.gpu` is a GPU_DATA *key*
    // and this world has no table to resolve it, so everything else about the machine
    // travelled and the graphics card did not. Measured after a browser restart, page
    // opened as early as Chrome allows, pc_power selected:
    //
    //   cores 16 · memory 32 · screen 3840x2160 · dpr 2 · tz Europe/Berlin   (correct)
    //   UNMASKED_RENDERER: ANGLE (Intel, Intel(R) Iris(R) Xe Graphics ...)   (laptop_mid)
    //
    // A 4K sixteen-core machine on integrated Intel graphics is a combination no device
    // has — worse than being the wrong machine, because coherence is exactly what a
    // fingerprinter cross-checks. dyn/boot.js carries the resolved strings, but dynamic
    // registrations are cleared when an unpacked extension is reinstalled at browser
    // start, which is the window this path exists for.
    //
    // background.js now RESOLVES the key once, on every profile change, and stores the
    // answer under afp_profile_gl. Nothing is duplicated here: this file forwards what it
    // is given, exactly as it does for the rest of the record.
    var GL_KEY = 'afp_profile_gl';
    var STORAGE_KEYS = [
        'afp_resolved_timezone', 'afp_resolved_locale', 'afp_mode',
        'afp_noise_seed', 'afp_features', 'afp_profile_data', 'afp_profile_id',
        GL_KEY, CSP_NOBLOB_KEY, NET_BLOCK_KEY, CSP_TT_KEY, CSP_TTE_KEY, CSP_NC_KEY, CSP_NS_KEY
    ];

    /** profileData + the resolved graphics fields, in the shape profile-injector maps. */
    function withGl(profileData, gl) {
        if (!profileData || typeof profileData !== 'object') return profileData;
        if (!gl || typeof gl !== 'object') return profileData;
        var out = {};
        for (var k in profileData) if (Object.prototype.hasOwnProperty.call(profileData, k)) out[k] = profileData[k];
        for (var g in gl) if (Object.prototype.hasOwnProperty.call(gl, g) && out[g] === undefined) out[g] = gl[g];
        return out;
    }

    try {
        chrome.storage.local.get(STORAGE_KEYS, function(items) {
            if (chrome.runtime.lastError || !items) return;
            applyCspNoBlob(items[CSP_NOBLOB_KEY]);
            applyCspTt(items[CSP_TT_KEY]);
            applyCspTte(items[CSP_TTE_KEY]);
            applyCspNc(items[CSP_NC_KEY]);
            applyCspNs(items[CSP_NS_KEY]);
            applyNetBlock(items[NET_BLOCK_KEY]);
            publish(
                items.afp_resolved_timezone,
                items.afp_resolved_locale,
                items.afp_mode || 'normal',
                items.afp_noise_seed,
                items.afp_features,
                withGl(items.afp_profile_data, items[GL_KEY]),
                items.afp_profile_id
            );
        });
        chrome.storage.onChanged.addListener(function(changes, area) {
            if (area !== 'local') return;
            // The CSP list is learned from response headers, so on a first visit it can
            // land after this file's initial read — but still long before the page builds
            // a worker of its own.
            if (changes[CSP_NOBLOB_KEY]) applyCspNoBlob(changes[CSP_NOBLOB_KEY].newValue);
            if (changes[CSP_TT_KEY]) applyCspTt(changes[CSP_TT_KEY].newValue);
            if (changes[CSP_TTE_KEY]) applyCspTte(changes[CSP_TTE_KEY].newValue);
            if (changes[CSP_NC_KEY]) applyCspNc(changes[CSP_NC_KEY].newValue);
            if (changes[CSP_NS_KEY]) applyCspNs(changes[CSP_NS_KEY].newValue);
            if (changes[NET_BLOCK_KEY]) applyNetBlock(changes[NET_BLOCK_KEY].newValue);
            if (changes.afp_resolved_timezone || changes.afp_resolved_locale ||
                changes.afp_mode || changes.afp_noise_seed || changes.afp_features ||
                changes.afp_profile_data || changes.afp_profile_id || changes[GL_KEY]) {
                chrome.storage.local.get(STORAGE_KEYS, function(items) {
                    if (chrome.runtime.lastError || !items) return;
                    publish(
                        items.afp_resolved_timezone,
                        items.afp_resolved_locale,
                        items.afp_mode || 'normal',
                        items.afp_noise_seed,
                        items.afp_features,
                        withGl(items.afp_profile_data, items[GL_KEY]),
                        items.afp_profile_id
                    );
                });
            }
        });
    } catch (e) {}
})();
