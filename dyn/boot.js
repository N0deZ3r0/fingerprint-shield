// dyn/boot.js — cold-start assembler. MAIN world, document_start.
//
// Hand-written; the files that run before it are generated (tools/gen-dyn.mjs) and
// carry nothing but data. background.js registers them as ONE dynamic content script —
// dev, country, mode, platform-version, the eight hex digits of the master noise seed,
// the generated copy of seed-lib.js, then this one — and the order inside a single
// registration is guaranteed, so by the time this runs every marker is set.
//
// What it publishes is deliberately the SAME channel storage-bridge.js already
// publishes on: the data-v-* attributes and a `ui:ready` event. One consumer
// (profile-injector.js), one merge path.
//
// ORDER, MEASURED — do not assume the other way round. A dynamically registered content
// script runs AFTER the manifest ones, not before:
//
//     profile-injector → mw-core → dyn/boot
//
// So the attributes this file sets are NOT visible to the manifest scripts as they load.
// What makes the cold start work anyway is the `ui:ready` event below: profile-injector
// listens for it and re-merges, and that still happens before the page's own first
// script — which is the whole point, since the async paths (storage-bridge's
// chrome.storage.local.get, background's inject on tabs.onUpdated) do not.
//
// The same measurement is why the option flags CANNOT travel this way. mw-core computes
// _FEAT once as it loads — before this file runs — and _FEAT decides which patches get
// installed at all, a decision with no later hook to correct. Shipping one file per flag
// was tried and reverted: 26 files that changed nothing. A non-default flag therefore
// still takes effect from the SECOND load of a tab onward.
(function () {
    'use strict';
    var dev = null, cc = null, mode = null, pv = null, ns = null, sl = null;
    try { dev = self.__AFP_BOOT_DEV__ || null; } catch (e) {}
    try { cc = self.__AFP_BOOT_CC__ || null; } catch (e) {}
    try { mode = self.__AFP_BOOT_MODE__ || null; } catch (e) {}
    try { pv = self.__AFP_BOOT_PV__ || null; } catch (e) {}
    // [FIX seed-was-a-named-page-readable-key] The master noise seed, rebuilt from the
    // eight dyn/ns/<pos><hex>.js files background.js registered ahead of this one, and the
    // generated copy of seed-lib.js that turns it into the per-domain value.
    try { ns = self.__AFP_BOOT_NS__ || null; } catch (e) {}
    try { sl = self.__AFP_BOOT_SL__ || null; } catch (e) {}

    // The markers exist for the length of this function. They are defined
    // non-enumerable so Object.keys(window) never sees them (CreepJS reads the tail of
    // that list as client code — see the __p0 note in mw/mw-core.js), and deleted here
    // so nothing survives into the page even for a later reader.
    try { delete self.__AFP_BOOT_DEV__; } catch (e) {}
    try { delete self.__AFP_BOOT_CC__; } catch (e) {}
    try { delete self.__AFP_BOOT_MODE__; } catch (e) {}
    try { delete self.__AFP_BOOT_PV__; } catch (e) {}
    try { delete self.__AFP_BOOT_NS__; } catch (e) {}
    try { delete self.__AFP_BOOT_SL__; } catch (e) {}

    // The per-domain seed. Derived HERE rather than shipped, because the seed is per site
    // and only the 32-bit master can be spelled with sixteen files. afpEffectiveHostname
    // is what makes a blank/srcdoc/sandbox frame agree with its parent by construction:
    // it prefers the parent's host when this frame has none, exactly as storage-bridge.js
    // does with the same function.
    //
    // This runs before the page's first script, so unlike every earlier path there is no
    // window in which a page can read a canvas under one seed and read it again under
    // another — the flip that [FIX provisional-seed-was-locked-forever] could only narrow,
    // not close. Measured before this: one page load, two canvas hashes (early 1169538152,
    // late 222371209) while the same page with the extension off gave one number twice.
    // [FIX repeated-nibble-collapsed-the-seed] The marker is eight <position><digit> PAIRS,
    // not eight bare digits, and it is reassembled by position rather than by arrival order.
    // With bare digits a seed that repeats one named the same file twice in the registration
    // — Chrome runs a repeated path once — so seven characters arrived, this test failed and
    // the page fell back to the provisional host hash. That is ~7 installs in 8, and it
    // looked like nothing was wrong. All eight positions must be present: a partial marker
    // means a half-registered script, and a wrong seed is worse than no seed, because
    // mw-core would lock it.
    var noiseSeed;
    // [FIX device-state-was-per-domain] Battery and the geolocation offset, derived from
    // the MASTER seed by the same afpDeviceState background.js uses (sl is the generated
    // copy of seed-lib.js). They have to be resolved here as well as there, because on a
    // cold tab this file is what the page reads until the inject lands ~300ms later — and
    // a battery level that changes mid-page is the very contradiction the fix removes.
    var deviceState = null;
    if (ns && sl && typeof sl.d === 'function' && /^([0-7][0-9a-f]){8}$/.test(ns)) {
        try {
            var digits = [];
            for (var di = 0; di < 16; di += 2) digits[+ns.charAt(di)] = ns.charAt(di + 1);
            var hex = '';
            for (var pi = 0; pi < 8; pi++) hex += (digits[pi] || '');
            if (hex.length === 8) {
                var master = parseInt(hex, 16) >>> 0;
                var host = (typeof sl.h === 'function') ? sl.h() : '';
                var derived = sl.d(master, host);
                if (typeof derived === 'number' && isFinite(derived)) noiseSeed = derived >>> 0;
                if (typeof sl.s === 'function' && dev) {
                    try { deviceState = sl.s(master, dev.id); } catch (eDs) {}
                }
            }
        } catch (e) {}
    }

    // A half-registered script (a file renamed without re-running the generator) must
    // publish nothing rather than a machine from one profile and a timezone from
    // another — an incoherent pair is worse than the stub it would replace.
    if (!dev || !cc) return;

    var hw = {
        id: dev.id,
        screenW: dev.screenW, screenH: dev.screenH, dpr: dev.dpr,
        cores: dev.cores, memory: dev.memory,
        platform: dev.platform, bluetooth: dev.bluetooth,
        glVendor: dev.glVendor, glRenderer: dev.glRenderer,
        // [FIX cold-start-gl-limits] The numeric GL limits and the WebGPU adapter info,
        // which used to arrive only with the full profile — see the note in
        // tools/gen-dyn.mjs for what a page saw in the gap.
        glParams: dev.glParams, glMaxAniso: dev.glMaxAniso,
        gpuVendor: dev.gpuVendor, gpuArch: dev.gpuArch,
        gpuDevice: dev.gpuDevice, gpuDesc: dev.gpuDesc,
        // [FIX host-mode] The flag, and only the flag: dyn/dev/host.js carries no values.
        host: dev.host === true,
        // [FIX decoder-answered-for-the-host-gpu] Absent on a file older than this field
        // means "no downgrade", which is what every card but one answers anyway.
        av1: (typeof dev.av1 === 'boolean') ? dev.av1 : true,
        cc: cc.cc, langs: cc.langs, voices: cc.voices, pv: pv
    };

    // [FIX machine-skeleton-sat-in-a-dom-attribute] data-v-hw is NOT published.
    //
    // It used to carry the whole machine as JSON on <html>, where any script could read it
    // at any moment — 20 fields: profile id, screen, dpr, cores, memory, platform,
    // bluetooth, both UNMASKED GL strings, the 19-entry GL limit table, the WebGPU adapter
    // info, country, languages and the voice list. That is the same content moving the
    // profile into a closure was meant to take away from the page, sitting in the DOM the
    // whole time; the GL and WebGPU fields had made it bigger, not smaller.
    //
    // It is also redundant. Measured by removing it and running the suites: the ONLY
    // failures were assertions that read the attribute themselves — every behavioural
    // check (cores, memory, screen, timezone, languages, renderer, worker parity, opaque
    // frames, module workers) still passed. Its one consumer, profile-injector.js, reads
    // `data-v-hw` in a synchronous path that runs BEFORE this file — so at that moment the
    // attribute cannot exist yet — and gets the identical object from `profileData` in the
    // ui:ready detail below, which is what actually makes the cold start work.
    //
    // The three left are still read: tz/lc by profile-injector's merge, md by mw-core's
    // stealth check. They carry one value each, not the machine.
    // Nothing is published on the DOM any more. tz/lc/md went the same way data-v-hw did
    // and for the same measured reason: this file runs AFTER every manifest script, so an
    // attribute set here cannot be seen by the code that reads attributes at load — it can
    // only be seen by the PAGE. Everything travels in the ui:ready detail below.

    try {
        document.dispatchEvent(new CustomEvent('ui:ready', {
            detail: {
                timezone: cc.tz,
                locale: cc.loc,
                mode: mode || 'normal',
                profileId: hw.id,
                countryCode: hw.cc,
                languages: hw.langs,
                speechVoices: cc.voices,
                platformVersion: pv || undefined,
                profileData: hw,
                // [FIX device-state-was-per-domain] Undefined when the seed files were not
                // registered (an install with no seed yet, or the window after a browser
                // restart clears the dynamic registration). profile-injector.js treats an
                // absent value exactly as it treats an absent noiseSeed: it keeps its own
                // literal until the real profile arrives.
                deviceState: deviceState || undefined,
                // [FIX seed-was-a-named-page-readable-key] noiseSeed used to be absent
                // here, and the note said it was "not derivable from the selection". That
                // was true of the DOMAIN seed and it is still true — what changed is that
                // the MASTER seed now arrives as file names (dyn/ns/*), so the derivation
                // can happen above. undefined when this install has no seed yet, which
                // profile-injector treats exactly as it treated the old absence.
                noiseSeed: (typeof noiseSeed === 'number') ? noiseSeed : undefined
            }
        }));
    } catch (e) {}
})();
