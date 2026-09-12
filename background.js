'use strict';

// seed-lib.js publishes registrableDomain + deriveDomainSeed. Both used to be written out
// here AND, verbatim, inside storage-bridge.js — one ~90-entry public-suffix table copied
// into two files that must never disagree, because mw-core hard-locks the first seed a page
// resolves. importScripts shares one global scope, which is what lets the service worker and
// the ISOLATED content script (see manifest.json) run the same code instead of two copies.
importScripts('defaults.js', 'seed-lib.js');

const STORAGE_KEY = 'afp_country_code';
// Set from the options page. Read by buildProfile AND by the accept-language rule — see
// afpLanguageClaim, which is the only place that decides what the language claim is.
const HOST_LANG_KEY = 'afp_host_language';
const PROFILE_KEY = 'afp_profile_id';
const PROFILE_DATA_KEY = 'afp_profile_data';
const NOISE_SEED_KEY = 'afp_noise_seed'; // master seed; per-domain derived at inject time

/**
 * THE ONE PLACE A NOISE SEED IS MINTED.
 *
 * [FIX the-seed-was-minted-in-three-places] Every value the extension noises is derived from
 * this number — the canvas and WebGL readback through the per-domain seed, the battery and
 * the geolocation offset through afpDeviceState straight off the master. So two seeds in one
 * install means every one of those changes underneath a page that reads twice, together, in
 * one step. Measured by test/stealth.mjs on a fresh tab, normal mode:
 *
 *     canvas.2d          4061171436 -> 1024244234
 *     webglPixels        1018012149 -> 2191095662
 *     fonts.measureText  ~0.01px across all fourteen families
 *     battery.level      0.72       -> 0.83
 *
 * Three writers, and it was not bad luck — it happened on EVERY fresh install:
 *
 *   1. buildProfile()  read the seed out of its own `cached` snapshot and minted one when
 *                      that came back empty;
 *   2. initDefaults()  did the same from a snapshot taken at its own top — BEFORE it wrote
 *                      the default profile a few lines below;
 *   3. the storage.onChanged listener reseeds on a profile change, and initDefaults writing
 *                      that first profile IS a change as far as the listener can tell, so a
 *                      fresh install fired it too.
 *
 * So (2) and (3) both mint on a clean install, in an order nothing decides, and (1) can land
 * between them if a page loads meanwhile. Whether a site SEES it depends only on whether it
 * read between two writes, which is why the symptom came and went with machine load and why
 * a rate could never be quoted for it.
 *
 * The repair is one minter and one memo. The promise is module-scope, so concurrent callers
 * inside this worker share a single mint rather than racing; a worker torn down mid-flight
 * loses the memo, but by then the value is in storage and the next read finds it. (3) keeps
 * its reseed — a new machine SHOULD get new noise — but now only when the profile actually
 * changed, told apart from being created by `oldValue` being present.
 */
let _noiseSeedPromise = null;
async function afpEnsureNoiseSeed() {
    if (!_noiseSeedPromise) {
        // Written so it CANNOT reject, and that is the point rather than tidiness: a
        // rejected memo would send its caller down a fallback that mints a seed nobody
        // stored — a value only that one page ever sees, which is the exact split this
        // function exists to close. If storage is unreachable the memo still holds one
        // number for the life of the worker, so the session stays coherent with itself.
        _noiseSeedPromise = (async () => {
            let have;
            try {
                const st = await chrome.storage.local.get([NOISE_SEED_KEY]);
                have = st && st[NOISE_SEED_KEY];
            } catch (e) {}
            if (typeof have === 'number' && isFinite(have)) return have >>> 0;
            const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
            try { await chrome.storage.local.set({ [NOISE_SEED_KEY]: seed }); } catch (e) {}
            return seed;
        })();
    }
    return _noiseSeedPromise;
}

// ============================================================
// COHERENT PROFILE — GPU ↔ cores ↔ RAM ↔ screen
// ============================================================
function enforceCoherence(profile) {
    if (!profile || typeof profile !== 'object') return profile || {};
    var p = Object.assign({}, profile);
    var gpu = p.gpu || 'intel_iris';
    var cores = p.cores || 8;
    var mem = p.memory || 8;
    var sw = p.screenW || 1920;
    var sh = p.screenH || 1080;

    // GPU tier expectations
    if (gpu === 'intel_uhd') {
        if (cores > 8) cores = 4;
        if (mem > 8) mem = 4;
        if (sw > 1920) { sw = 1366; sh = 768; }
    } else if (gpu === 'intel_iris') {
        if (cores < 4) cores = 8;
        if (cores > 12) cores = 8;
        if (mem < 4) mem = 8;
        if (mem > 16) mem = 8;
        if (sw > 2560) { sw = 1920; sh = 1080; }
    } else if (gpu === 'nvidia_3060') {
        if (cores < 8) cores = 12;
        if (mem < 16) mem = 32;
        if (sw < 1920) { sw = 2560; sh = 1440; }
    } else if (gpu === 'nvidia_3070') {
        if (cores < 12) cores = 16;
        if (mem < 16) mem = 32;
        if (sw < 2560) { sw = 3840; sh = 2160; }
    }

    // Cross rules
    if (cores >= 12 && mem < 16) mem = 32;
    if (sw >= 3840 && cores < 8) cores = 12;
    if (sw >= 3840 && mem < 16) mem = 32;
    if (mem <= 4 && cores > 8) cores = 4;
    if (mem <= 4 && (gpu === 'nvidia_3060' || gpu === 'nvidia_3070')) {
        gpu = 'intel_uhd';
        cores = 4;
        sw = 1366; sh = 768;
    }

    p.gpu = gpu;
    p.cores = cores;
    p.memory = mem;
    p.screenW = sw;
    p.screenH = sh;
    return p;
}


// Задержки инжекции (мс)
// WASM load after tab complete (DELAY_LOAD_WASM). Profile inject is later
// (DELAY_INJECT_PROFILE). Seed/locale may arrive after WASM init; JS wrapper
// reseeds and main-world polls — intentional, not a hard barrier.
const DELAY_INJECT_PROFILE   = 300;
const DELAY_LOAD_WASM        = 50; // after complete; profile inject still at 300
const DELAY_ACTIVATED_PROFILE = 500;
const DELAY_ACTIVATED_WASM   = 50;
const DELAY_STARTUP_BOOT     = 1000;
const DELAY_STARTUP_WASM     = 50;

// [FIX platform-version-pinned-to-windows-10] Every emitter of UA-CH hard-locked
// platformVersion to '10.0.0', justified in mw/mw-navigator.js with "UA string = NT 10.0 →
// platformVersion must be 10.0.0". That premise is false, and a clean browser says so:
// Chrome on Windows 11 also sends "Windows NT 10.0" — it never writes NT 11.0 — while
// reporting platformVersion 19.0.0. Measured side by side on one machine:
//     clean Chrome, Win11 host:  UA "Windows NT 10.0"   platformVersion "19.0.0"
//     with the extension:        UA "Windows NT 10.0"   platformVersion "10.0.0"
// So the lock removed no contradiction; it created one. It matters because the FONT SET
// gives the real family away: font enumeration through DOM layout (offsetWidth/
// offsetHeight) is not covered by this extension — the canvas path is, measured, a font
// outside the allowlist collapses to the fallback width — so a Windows 11 host shows
// Windows 11 fonts (Segoe Fluent Icons) under a Windows 10 banner.
//
// The claim follows the host's FAMILY and nothing finer. Chrome derives platformVersion
// from the Windows build (Win10 → 10.0.0; Win11 21H2 → 13, 22H2/23H2 → 15, 24H2 → 19), and
// passing the exact value through would hand back the build-level entropy the lock was
// trying to remove. Two buckets keep honest the one bit the fonts already leak, and
// collapse everything below it.
const WIN11_PLATFORM_VERSION = '15.0.0'; // Win11 22H2/23H2 — the broadest bucket
// Where the resolved HOST family is remembered — see afpPlatformVersion. Not part of the
// profile: it describes the machine the browser runs on, not the machine being presented.
const HOST_PV_KEY = 'afp_host_platform_version';
const WIN10_PLATFORM_VERSION = '10.0.0';
// [FIX platform-version-read-was-not-deterministic]
//
// This function decides the OS family for THREE consumers — the profile's clientHints (what
// every page reports), the `sec-ch-ua-platform-version` DNR header, and which dyn/pv/*.js
// the boot script registers. It used to answer from a live
// `getHighEntropyValues(['platformVersion'])` on every call, and treat ANY failure or empty
// string as "Windows 10".
//
// That made it non-deterministic in the one place it must not be. Measured on a real
// Chrome 151 / Windows 11 host with the extension live: the page reported 15.0.0 while the
// DNR header on the very same request said 10.0.0 — the profile and the rule had been built
// from two different answers. (A fresh Chromium on the same machine reads 19.0.0 every
// time and never diverges, which is why no suite catches this: a clean test profile only
// ever sees the good path.)
//
// The reading is now resolved ONCE and remembered, in memory for this worker and in storage
// across worker restarts. Only a genuine reading is cached — a failed read falls back to
// the last known good value if there is one, and never overwrites it. So a single
// successful read fixes the answer for good, and the three consumers cannot disagree.
let _hostPlatformVersion = null;
async function afpPlatformVersion() {
    if (_hostPlatformVersion) return _hostPlatformVersion;
    try {
        const stored = await chrome.storage.local.get([HOST_PV_KEY]);
        if (stored && stored[HOST_PV_KEY]) {
            _hostPlatformVersion = stored[HOST_PV_KEY];
            return _hostPlatformVersion;
        }
    } catch (e) {}
    try {
        const uad = navigator.userAgentData;
        if (uad && typeof uad.getHighEntropyValues === 'function') {
            const hev = await uad.getHighEntropyValues(['platformVersion']);
            const major = parseInt(String(hev.platformVersion || '').split('.')[0], 10);
            // isFinite alone is the test for "we actually read something": a host that
            // really is Windows 10 reports major 10, which is a valid reading, not a
            // failure. Only an unreadable value falls through.
            if (isFinite(major)) {
                _hostPlatformVersion = major >= 13 ? WIN11_PLATFORM_VERSION : WIN10_PLATFORM_VERSION;
                try { await chrome.storage.local.set({ [HOST_PV_KEY]: _hostPlatformVersion }); } catch (eSet) {}
                return _hostPlatformVersion;
            }
        }
    } catch (e) {}
    return WIN10_PLATFORM_VERSION;
}

/** Chrome major from SW UA; single fallback for UA string + DNR brands. */
/**
 * The language claim, resolved in ONE place.
 *
 * With `afp_host_language` set, the country's language is not substituted at all: the page
 * and the wire both answer with the browser's own. It is the only configuration measured in
 * which Fingerprint Pro does not report a bot — three values tried on a real Chrome, one
 * variable, everything else held:
 *
 *   navigator.language ru-RU (the host's)   bot not_detected
 *   navigator.language et-EE (the profile)  bot bad / BrowserAutomationStudio
 *   navigator.language en-US (the profile)  bot bad
 *
 * The mechanism was never found, which is why this is a switch the user throws rather than a
 * default: it costs the real language to every site, and that is a trade, not a fix.
 *
 * The header is built the way Chrome builds it, measured on a clean browser with the
 * field-trial config left on (ReduceAcceptLanguage is live for real users), five languages,
 * five times out of five: the regional tag, then its base at q=0.9, and nothing else. The
 * JS list is NOT that list — it is the configured tag alone. See buildProfile's note.
 */
function afpLanguageClaim(country, hostOn) {
    let loc = country.loc, lang = country.lang;
    // The DEFAULT Intl locale is a THIRD string, not a copy of either of the two above.
    // Measured on a clean browser, one launch per locale (tools/gen-locales.mjs): 57 of 67
    // differ from the tag — et-EE reports `et`, en-IE reports `en-GB`, es-CL reports
    // `es-MX` — and the rule cannot be derived, `Intl.Locale.minimize()` gets 7 of 10 and
    // is wrong for exactly the locales with their own CLDR data (en-US, pt-BR, zh-CN).
    // Absent for the two this Chromium cannot switch to, where the tag is the honest
    // fallback: "not measurable here" must not become "whatever this machine speaks".
    let intl = country.intlLocale || country.loc;
    if (hostOn) {
        let host = '';
        try { host = String((self.navigator && self.navigator.language) || ''); } catch (e) {}
        if (host) {
            loc = host;
            const base = host.split('-')[0];
            lang = (base && base !== host) ? (host + ',' + base + ';q=0.9') : host;
        }
        // No table needed for this one: the service worker runs in the very browser being
        // claimed, so its own Intl default IS the answer.
        try {
            const own = new Intl.DateTimeFormat().resolvedOptions().locale;
            if (own) intl = own;
        } catch (e) {}
    }
    return { loc, lang, intl };
}

function afpChromeMajor() {
    try {
        var m = String(navigator.userAgent || '').match(/Chrome\/(\d+)/);
        if (m) return m[1];
    } catch (e) {}
    return '151';
}



const DEFAULT_PROFILE = AFP_DEFAULT_PROFILE;

// [FIX header-rules-covered-fewer-request-types-than-the-static-ruleset]
// The dynamic rules used to fire only on main_frame / sub_frame / xmlhttprequest, while
// the static ruleset next to them (rules/static.json) already listed every type. Chrome
// sends Accept-Language and User-Agent on EVERY request, so a page only had to fetch one
// image or stylesheet from its own server and read the headers: the document arrived as
// et-EE / Windows Chrome and the image beside it as the real Accept-Language and the real
// UA. The static rule made it worse rather than better — that request carried
// sec-ch-ua-platform "Windows" (static, all types) next to a real non-spoofed User-Agent
// (dynamic, three types), a combination no genuine browser produces.
// One list for both rule sets now. 'websocket' is deliberately absent: the WS handshake
// takes no Accept-Language and DNR cannot rewrite its headers anyway.
const AFP_HEADER_RESOURCE_TYPES = [
    'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
    'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'other'
];

// [FIX webgl-params-were-desktop-gl-numbers] These are ANGLE/D3D11 caps, and they are
// shared by every profile on purpose. Chrome on Windows renders WebGL through
// ANGLE over D3D11 — which is what every unmaskedRenderer string in this table says —
// and ANGLE derives these limits from the D3D feature level, not from the card. Measured
// on a real ANGLE/D3D11 context, identical across the d3d11, gl and d3d11on12 backends.
//
// What was here before came from a desktop OpenGL driver instead, so the per-GPU variation
// it expressed does not exist in any Chrome-on-Windows browser, and several rows were
// simply wrong about which enum they were:
//     MAX_COMBINED_TEXTURE_IMAGE_UNITS  192   -> 32   (16 vertex + 16 fragment)
//     MAX_TEXTURE_IMAGE_UNITS            64   -> 16
//     MAX_TEXTURE_LOD_BIAS               16   -> 2
//     MAX_ARRAY_TEXTURE_LAYERS        32768   -> 2048
//     0x8073 labelled MAX_ELEMENTS_VERTICES is MAX_3D_TEXTURE_SIZE  1048575 -> 2048
//     0x8904 labelled MAX_3D_TEXTURE_SIZE is MIN_PROGRAM_TEXEL_OFFSET    16 -> -8
//     0x8A2B labelled MAX_SAMPLES is MAX_FRAGMENT_UNIFORM_BLOCKS        4/8 -> 12
// The GPU's identity lives in unmaskedRenderer, which is where a real browser keeps it.
//
// Two classes are deliberately ABSENT rather than corrected:
//   * the drawing-buffer bit depths (RED/GREEN/BLUE/ALPHA/DEPTH/STENCIL_BITS) describe the
//     context the PAGE asked for, not the GPU. Measured: alpha:false moves ALPHA_BITS 8->0,
//     depth:false moves DEPTH_BITS 24->0, stencil:true moves STENCIL_BITS 0->8. Pinning
//     them to constants contradicts the page's own getContext attributes, which the page
//     obviously knows. They now pass through to the driver, where they carry no GPU signal.
//   * 0x8074 and 0x8B48, which no context answers in either WebGL version.
const ANGLE_D3D11_PARAMS = {
    0x0D33: 16384,  // MAX_TEXTURE_SIZE        (D3D11_REQ_TEXTURE2D_U_OR_V_DIMENSION)
    0x84E8: 16384,  // MAX_RENDERBUFFER_SIZE
    0x851C: 16384,  // MAX_CUBE_MAP_TEXTURE_SIZE
    0x8B4D: 32,     // MAX_COMBINED_TEXTURE_IMAGE_UNITS
    0x8B4C: 16,     // MAX_VERTEX_TEXTURE_IMAGE_UNITS
    0x8872: 16,     // MAX_TEXTURE_IMAGE_UNITS
    // The two names below were swapped in this comment for as long as the table existed —
    // 0x8DFB is MAX_VERTEX_UNIFORM_VECTORS and 0x8DFD is MAX_FRAGMENT_UNIFORM_VECTORS, not
    // the other way round. The VALUES were always right (both verified against a real
    // Intel/ANGLE host: vertex 4096, fragment 1024); only the labels misled.
    0x8DFD: 1024,   // MAX_FRAGMENT_UNIFORM_VECTORS
    0x8DFB: 4096,   // MAX_VERTEX_UNIFORM_VECTORS
    0x8DFC: 30,     // MAX_VARYING_VECTORS
    0x8869: 16,     // MAX_VERTEX_ATTRIBS
    0x84FF: 16,     // MAX_TEXTURE_MAX_ANISOTROPY_EXT
    // WebGL2-only. Listing them is safe now: _wgParam asks the driver first and a null
    // answer is final, so on a WebGL1 context these stay null exactly as they natively are.
    0x8073: 2048,   // MAX_3D_TEXTURE_SIZE
    0x84FD: 2,      // MAX_TEXTURE_LOD_BIAS
    0x8B49: 4096,   // MAX_FRAGMENT_UNIFORM_COMPONENTS
    0x8A2B: 12,     // MAX_FRAGMENT_UNIFORM_BLOCKS
    0x88FF: 2048,   // MAX_ARRAY_TEXTURE_LAYERS
    0x8904: -8,     // MIN_PROGRAM_TEXEL_OFFSET
    0x8905: 7,      // MAX_PROGRAM_TEXEL_OFFSET
    0x8D57: 8       // MAX_SAMPLES
};

// [FIX nvidia-profiles-reported-intels-uniform-limit]
//
// ANGLE over D3D11 flattens almost everything — measured on two machines, an Intel Arc and
// an NVIDIA RTX 3060 report byte-identical extension lists (35 entries, same hash), the same
// shader precisions and the same anisotropy, which is why one shared table has served every
// GPU here. But it does not flatten EVERYTHING: NVIDIA's driver reserves one vertex uniform
// vector and reports 4095 where Intel reports 4096.
//
// So a profile claiming "NVIDIA GeForce RTX 3060" was answering getParameter with Intel's
// 4096 — one number, deterministic, and checkable by anyone who knows the platform. The
// NVIDIA entries get their own table.
//
// Anything else in here is shared on purpose: eleven other limits were compared across the
// two vendors and matched exactly.
const ANGLE_D3D11_PARAMS_NVIDIA = Object.assign({}, ANGLE_D3D11_PARAMS, {
    0x8DFB: 4095    // MAX_VERTEX_UNIFORM_VECTORS — NVIDIA reserves one, Intel does not
});

const GPU_DATA = {
    // [FIX angle-renderer-format-chrome151] The renderer strings below carry the PCI
    // device id and the ", D3D11" backend tag that Chrome/ANGLE has emitted for a while now
    // and that clean Chrome 151 emits — measured on two live 151 boxes (an Intel Arc and an
    // RTX 3060; the Arc read "…(0x00007D55)… , D3D11)" and the 3060 "…(0x00002504)… ,
    // D3D11)"). The old form here had neither the id nor the tag, so every profile answered
    // UNMASKED_RENDERER in a shape no current Chrome produces — a format tell independent of
    // which GPU was claimed. The device id is the model's fixed PCI id, not a per-unit
    // serial, so it is safe to pin. Ids: RTX 3060 0x2504 is the measured one; the others are
    // the values clean Chrome reports for these exact models, cross-checked against a public
    // webGLRenderer fingerprint corpus and (for UHD 630) a chrome://gpu dump —
    //   Iris Xe   0x9A49  (Tiger Lake GT2, the common Iris Xe die)
    //   UHD 630   0x3E9B
    //   RTX 3070  0x2484  (desktop GA104)
    // A given marketing name ships across several dies, so these are the most common id per
    // model, not the only one; re-measure on the target machine if a specific die matters.
    // [FIX decoder-answered-for-the-host-gpu] `hwDecode.av1`: does the claimed card have an
    // AV1 decoder in silicon. navigator.mediaCapabilities.decodingInfo() reports that as
    // `powerEfficient`, and it answered for the HOST — measured on this Arc: AV1 1080p30
    // `true/true/true` beside a profile claiming UHD Graphics 630, a die (Gen9.5, Coffee
    // Lake) that has no AV1 decoder at all. The shape of the software answer is measured,
    // not guessed: the same Chromium launched with --disable-accelerated-video-decode
    // reports AV1 `true/true/false` — supported and smooth stay, only powerEfficient
    // drops. The page side (mw-navigator / mw-workers) only ever DOWNGRADES that one flag
    // for AV1: it never claims a decoder the host lacks, because a site can play a clip
    // and count dropped frames. HEVC, H.264 and VP9 are in hardware on every card here,
    // so they are not listed. (AV1: Gen9.5 no; Xe/Gen12 yes; Ampere yes.)
    'intel_uhd': {
        unmaskedVendor: 'Google Inc. (Intel)',
        unmaskedRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        // WebGPU adapter.info — lowercase vendor, architecture family (not ANGLE string)
        webgpu: { vendor: 'intel', architecture: 'gen-9', device: '', description: '' },
        webglParams: ANGLE_D3D11_PARAMS,
        hwDecode: { av1: false }
    },
    'intel_iris': {
        unmaskedVendor: 'Google Inc. (Intel)',
        unmaskedRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        // Clean Chrome on Iris Xe reports "xe-lpg", not bare "xe"
        webgpu: { vendor: 'intel', architecture: 'xe-lpg', device: '', description: '' },
        webglParams: ANGLE_D3D11_PARAMS,
        hwDecode: { av1: true }
    },
    'nvidia_3060': {
        unmaskedVendor: 'Google Inc. (NVIDIA)',
        unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        webgpu: { vendor: 'nvidia', architecture: 'ampere', device: '', description: '' },
        webglParams: ANGLE_D3D11_PARAMS_NVIDIA,
        hwDecode: { av1: true }
    },
    // nvidia_3070: WebGL-параметры идентичны 3060 — оба используют ANGLE/D3D11 с одинаковыми
    // лимитами драйвера. Профили различаются только строкой renderer (unmaskedRenderer).
    'nvidia_3070': {
        unmaskedVendor: 'Google Inc. (NVIDIA)',
        unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        webgpu: { vendor: 'nvidia', architecture: 'ampere', device: '', description: '' },
        webglParams: ANGLE_D3D11_PARAMS_NVIDIA,
        hwDecode: { av1: true }
    }
};

// [FIX host-mode] THIS MACHINE as a profile.
//
// A stored record with `host: true` is the popup's MEASUREMENT of the machine the browser
// runs on — screen, ratio, cores, memory and, under `gl`, the ANGLE strings, the 19 GL
// limits and the WebGPU adapter info, read in the popup where an extension page renders
// with the host's own GPU process. There is no GPU_DATA row to look up, so the record IS
// the row. Everything built from it carries `hostHw: true`, and that flag is what the page
// side reads: every hardware answer comes from the browser, in the window, in every frame
// and in every worker, and the hardware client hints are left to the browser as well
// (afpSyncHwRuleset below). The values here serve the audit page's "claimed" column and
// the popup's label; nothing answers a page from them.
//
// The measurement can go stale — a monitor unplugged after Apply — and that costs a wrong
// LABEL, never a wrong answer, which is the whole reason the page side does not read them.
function afpIsHostRecord(rec, profileId) {
    return !!((rec && typeof rec === 'object' && rec.host === true) || profileId === 'host');
}
function afpHostGpu(rec) {
    const gl = (rec && rec.gl && typeof rec.gl === 'object') ? rec.gl : {};
    // No table fallback: a record without a measurement (the popup had no WebGL) claims
    // NOTHING, so the audit's "claimed" column reads "no claim" rather than naming an Iris
    // Xe beside a page that reports the real card. The page never answers from these.
    return {
        unmaskedVendor: gl.glVendor || '',
        unmaskedRenderer: gl.glRenderer || '',
        webgpu: {
            vendor: gl.gpuVendor || '', architecture: gl.gpuArch || '',
            device: gl.gpuDevice || '', description: gl.gpuDesc || ''
        },
        webglParams: (gl.glParams && typeof gl.glParams === 'object') ? gl.glParams : {},
        webglMaxAnisotropy: (typeof gl.glMaxAniso === 'number') ? gl.glMaxAniso : 16,
        // The host decodes whatever it decodes; nothing is downgraded.
        hwDecode: { av1: true }
    };
}

const COUNTRY_DATA = {
    // <generated:COUNTRY_DATA> from data/countries.json — do not edit; run: node tools/gen-tables.mjs
    'EE': { tz: 'Europe/Tallinn', loc: 'et-EE', lang: 'et-EE,et;q=0.9', intlLocale: 'et' },
    'DE': { tz: 'Europe/Berlin', loc: 'de-DE', lang: 'de-DE,de;q=0.9', intlLocale: 'de' },
    'GB': { tz: 'Europe/London', loc: 'en-GB', lang: 'en-GB,en;q=0.9', intlLocale: 'en-GB' },
    'FR': { tz: 'Europe/Paris', loc: 'fr-FR', lang: 'fr-FR,fr;q=0.9', intlLocale: 'fr' },
    'IT': { tz: 'Europe/Rome', loc: 'it-IT', lang: 'it-IT,it;q=0.9', intlLocale: 'it' },
    'ES': { tz: 'Europe/Madrid', loc: 'es-ES', lang: 'es-ES,es;q=0.9', intlLocale: 'es-ES' },
    'NL': { tz: 'Europe/Amsterdam', loc: 'nl-NL', lang: 'nl-NL,nl;q=0.9', intlLocale: 'nl' },
    'PL': { tz: 'Europe/Warsaw', loc: 'pl-PL', lang: 'pl-PL,pl;q=0.9', intlLocale: 'pl' },
    'SE': { tz: 'Europe/Stockholm', loc: 'sv-SE', lang: 'sv-SE,sv;q=0.9', intlLocale: 'sv' },
    'FI': { tz: 'Europe/Helsinki', loc: 'fi-FI', lang: 'fi-FI,fi;q=0.9', intlLocale: 'fi' },
    'NO': { tz: 'Europe/Oslo', loc: 'nb-NO', lang: 'nb-NO,nb;q=0.9', intlLocale: 'nb' },
    'DK': { tz: 'Europe/Copenhagen', loc: 'da-DK', lang: 'da-DK,da;q=0.9', intlLocale: 'da' },
    'CZ': { tz: 'Europe/Prague', loc: 'cs-CZ', lang: 'cs-CZ,cs;q=0.9', intlLocale: 'cs' },
    'AT': { tz: 'Europe/Vienna', loc: 'de-AT', lang: 'de-AT,de;q=0.9', intlLocale: 'de' },
    'CH': { tz: 'Europe/Zurich', loc: 'de-CH', lang: 'de-CH,de;q=0.9', intlLocale: 'de' },
    'TR': { tz: 'Europe/Istanbul', loc: 'tr-TR', lang: 'tr-TR,tr;q=0.9', intlLocale: 'tr' },
    'GR': { tz: 'Europe/Athens', loc: 'el-GR', lang: 'el-GR,el;q=0.9', intlLocale: 'el' },
    'PT': { tz: 'Europe/Lisbon', loc: 'pt-PT', lang: 'pt-PT,pt;q=0.9', intlLocale: 'pt-PT' },
    'IE': { tz: 'Europe/Dublin', loc: 'en-IE', lang: 'en-IE,en;q=0.9', intlLocale: 'en-GB' },
    'BE': { tz: 'Europe/Brussels', loc: 'nl-BE', lang: 'nl-BE,nl;q=0.9', intlLocale: 'nl' },
    'RO': { tz: 'Europe/Bucharest', loc: 'ro-RO', lang: 'ro-RO,ro;q=0.9', intlLocale: 'ro' },
    'HU': { tz: 'Europe/Budapest', loc: 'hu-HU', lang: 'hu-HU,hu;q=0.9', intlLocale: 'hu' },
    'BG': { tz: 'Europe/Sofia', loc: 'bg-BG', lang: 'bg-BG,bg;q=0.9', intlLocale: 'bg' },
    'LV': { tz: 'Europe/Riga', loc: 'lv-LV', lang: 'lv-LV,lv;q=0.9', intlLocale: 'lv' },
    'LT': { tz: 'Europe/Vilnius', loc: 'lt-LT', lang: 'lt-LT,lt;q=0.9', intlLocale: 'lt' },
    'SK': { tz: 'Europe/Bratislava', loc: 'sk-SK', lang: 'sk-SK,sk;q=0.9', intlLocale: 'sk' },
    'SI': { tz: 'Europe/Ljubljana', loc: 'sl-SI', lang: 'sl-SI,sl;q=0.9', intlLocale: 'sl' },
    'HR': { tz: 'Europe/Zagreb', loc: 'hr-HR', lang: 'hr-HR,hr;q=0.9', intlLocale: 'hr' },
    'RS': { tz: 'Europe/Belgrade', loc: 'sr-RS', lang: 'sr-RS,sr;q=0.9', intlLocale: 'sr' },
    'CY': { tz: 'Asia/Nicosia', loc: 'el-CY', lang: 'el-CY,el;q=0.9', intlLocale: 'el' },
    'MT': { tz: 'Europe/Malta', loc: 'mt-MT', lang: 'mt-MT,mt;q=0.9' },
    'LU': { tz: 'Europe/Luxembourg', loc: 'fr-LU', lang: 'fr-LU,fr;q=0.9', intlLocale: 'fr' },
    'IS': { tz: 'Atlantic/Reykjavik', loc: 'is-IS', lang: 'is-IS,is;q=0.9' },
    'US': { tz: 'America/New_York', loc: 'en-US', lang: 'en-US,en;q=0.9', intlLocale: 'en-US' },
    'CA': { tz: 'America/Toronto', loc: 'en-CA', lang: 'en-CA,en;q=0.9', intlLocale: 'en-GB' },
    'BR': { tz: 'America/Sao_Paulo', loc: 'pt-BR', lang: 'pt-BR,pt;q=0.9', intlLocale: 'pt-BR' },
    'MX': { tz: 'America/Mexico_City', loc: 'es-MX', lang: 'es-MX,es;q=0.9', intlLocale: 'es-MX' },
    'AR': { tz: 'America/Buenos_Aires', loc: 'es-AR', lang: 'es-AR,es;q=0.9', intlLocale: 'es-MX' },
    'CL': { tz: 'America/Santiago', loc: 'es-CL', lang: 'es-CL,es;q=0.9', intlLocale: 'es-MX' },
    'CO': { tz: 'America/Bogota', loc: 'es-CO', lang: 'es-CO,es;q=0.9', intlLocale: 'es-MX' },
    'PE': { tz: 'America/Lima', loc: 'es-PE', lang: 'es-PE,es;q=0.9', intlLocale: 'es-MX' },
    'JP': { tz: 'Asia/Tokyo', loc: 'ja-JP', lang: 'ja-JP,ja;q=0.9', intlLocale: 'ja' },
    'KR': { tz: 'Asia/Seoul', loc: 'ko-KR', lang: 'ko-KR,ko;q=0.9', intlLocale: 'ko' },
    'CN': { tz: 'Asia/Shanghai', loc: 'zh-CN', lang: 'zh-CN,zh;q=0.9', intlLocale: 'zh-CN' },
    'IN': { tz: 'Asia/Kolkata', loc: 'en-IN', lang: 'en-IN,en;q=0.9', intlLocale: 'en-GB' },
    'SG': { tz: 'Asia/Singapore', loc: 'en-SG', lang: 'en-SG,en;q=0.9', intlLocale: 'en-GB' },
    'HK': { tz: 'Asia/Hong_Kong', loc: 'zh-HK', lang: 'zh-HK,zh;q=0.9', intlLocale: 'zh-TW' },
    'TW': { tz: 'Asia/Taipei', loc: 'zh-TW', lang: 'zh-TW,zh;q=0.9', intlLocale: 'zh-TW' },
    'TH': { tz: 'Asia/Bangkok', loc: 'th-TH', lang: 'th-TH,th;q=0.9', intlLocale: 'th' },
    'VN': { tz: 'Asia/Ho_Chi_Minh', loc: 'vi-VN', lang: 'vi-VN,vi;q=0.9', intlLocale: 'vi' },
    'ID': { tz: 'Asia/Jakarta', loc: 'id-ID', lang: 'id-ID,id;q=0.9', intlLocale: 'id' },
    'MY': { tz: 'Asia/Kuala_Lumpur', loc: 'ms-MY', lang: 'ms-MY,ms;q=0.9', intlLocale: 'ms' },
    'PH': { tz: 'Asia/Manila', loc: 'en-PH', lang: 'en-PH,en;q=0.9', intlLocale: 'en-US' },
    'AE': { tz: 'Asia/Dubai', loc: 'ar-AE', lang: 'ar-AE,ar;q=0.9', intlLocale: 'ar' },
    'IL': { tz: 'Asia/Jerusalem', loc: 'he-IL', lang: 'he-IL,he;q=0.9', intlLocale: 'he' },
    'SA': { tz: 'Asia/Riyadh', loc: 'ar-SA', lang: 'ar-SA,ar;q=0.9', intlLocale: 'ar' },
    'IR': { tz: 'Asia/Tehran', loc: 'fa-IR', lang: 'fa-IR,fa;q=0.9', intlLocale: 'fa' },
    'PK': { tz: 'Asia/Karachi', loc: 'ur-PK', lang: 'ur-PK,ur;q=0.9', intlLocale: 'ur' },
    'BD': { tz: 'Asia/Dhaka', loc: 'bn-BD', lang: 'bn-BD,bn;q=0.9', intlLocale: 'bn' },
    'IQ': { tz: 'Asia/Baghdad', loc: 'ar-IQ', lang: 'ar-IQ,ar;q=0.9', intlLocale: 'ar' },
    'AU': { tz: 'Australia/Sydney', loc: 'en-AU', lang: 'en-AU,en;q=0.9', intlLocale: 'en-GB' },
    'NZ': { tz: 'Pacific/Auckland', loc: 'en-NZ', lang: 'en-NZ,en;q=0.9', intlLocale: 'en-GB' },
    'ZA': { tz: 'Africa/Johannesburg', loc: 'en-ZA', lang: 'en-ZA,en;q=0.9', intlLocale: 'en-GB' },
    'EG': { tz: 'Africa/Cairo', loc: 'ar-EG', lang: 'ar-EG,ar;q=0.9', intlLocale: 'ar' },
    'NG': { tz: 'Africa/Lagos', loc: 'en-NG', lang: 'en-NG,en;q=0.9', intlLocale: 'en-GB' },
    'MA': { tz: 'Africa/Casablanca', loc: 'fr-MA', lang: 'fr-MA,fr;q=0.9', intlLocale: 'fr' },
    'KE': { tz: 'Africa/Nairobi', loc: 'en-KE', lang: 'en-KE,en;q=0.9', intlLocale: 'en-GB' },
    // </generated:COUNTRY_DATA>
};

/**
 * The device pixel ratio for a stored record. Pure, so test/background-fns.mjs can hold it
 * against the popup table directly.
 *
 * [FIX applying-a-profile-dropped-its-dpr] Order matters. The record wins when it carries a
 * ratio; otherwise the machine's DECLARED ratio is looked up by profile id; only then does
 * the width rule apply. The middle step is the fix: popup.handleApply stored records
 * without `dpr` for a long time, so an upgraded install derived 1 for laptop_mid while
 * dyn/dev/laptop_mid.js shipped the declared 1.5 — and a page got whichever source reached
 * it first. Measured live: 127.0.0.1 said 1.5 and abrahamjuliot.github.io said 1, one
 * browser, one minute apart.
 */
function afpResolveDpr(profile, profileId) {
    if (profile && typeof profile.dpr === 'number' && isFinite(profile.dpr) && profile.dpr > 0) {
        return profile.dpr;
    }
    const declared = (typeof AFP_PROFILE_DPR === 'object' && AFP_PROFILE_DPR)
        ? AFP_PROFILE_DPR[profileId] : undefined;
    if (typeof declared === 'number' && isFinite(declared) && declared > 0) return declared;
    // [FIX the-dpr-fallback-read-a-css-width-as-a-panel] It used to be
    // `w >= 3840 ? 2 : w >= 3000 ? 1.5 : 1`, and the inequality is the bug: screenW is CSS
    // pixels, so the PANEL is screenW * dpr. Answering 2 for a 3840-wide screen therefore
    // claimed a 7680x4320 display — the widest thing in the fleet got the biggest
    // multiplier, when scaling works the other way round and makes the CSS width SMALLER.
    // A 1920x1080 panel at 150% reports 1280, which is why StatCounter's desktop table is
    // led by 1920x1080 and then by 1536x864 and 1280x720 — 1080p at 125% and at 150%.
    //
    // There is no width from which the scaling can be inferred, because they are
    // independent axes; that was already said in the note above and then contradicted here.
    // So the fallback stops guessing and answers 1, and every profile carries its ratio
    // explicitly (popup PROFILES, mirrored in AFP_PROFILE_DPR). This value is now only
    // reachable by a STORED record that predates explicit ratios, and 1 is the right answer
    // for one of those: it is what the majority of the fleet reports.
    return 1;
}

async function buildProfile() {
    const cached = await chrome.storage.local.get([PROFILE_DATA_KEY, STORAGE_KEY, NOISE_SEED_KEY, PROFILE_KEY, 'afp_mode', 'afp_features', HOST_LANG_KEY]);
    // [FIX the-default-row-was-modal-by-accident-and-said-so-nowhere] This literal is the
    // crowd every silent install joins, and it is laptop_mid because 1920x1080 at dpr 1 is
    // the modal desktop screen by three to one — the measurement, and the argument against
    // sampling the rows instead, are in test/profilecoherence.mjs, which goes red if the
    // population moves out from under it.
    const profileId = cached[PROFILE_KEY] || 'laptop_mid';
    // [FIX host-mode] The measured record is taken as it is: enforceCoherence would
    // "correct" a real 18-core machine towards one of the four tables, and GPU_DATA has no
    // row for a card it never measured.
    const isHost = afpIsHostRecord(cached[PROFILE_DATA_KEY], profileId);
    const rawRec = cached[PROFILE_DATA_KEY] || DEFAULT_PROFILE;
    const profile = isHost ? Object.assign({}, rawRec) : enforceCoherence(rawRec);
    const countryCode = cached[STORAGE_KEY] || 'US';
    const country = COUNTRY_DATA[countryCode] || COUNTRY_DATA['US'];
    const _langClaim = afpLanguageClaim(country, !!cached[HOST_LANG_KEY]);
    const gpu = isHost ? afpHostGpu(rawRec) : (GPU_DATA[profile.gpu] || GPU_DATA['intel_iris']);
    // Десктоп-профили (pc_*) — без Bluetooth-адаптера типичнее, чем laptop
    const isDesktop = String(profileId).indexOf('pc_') === 0;

    // [FIX seed-not-actually-session-stable] Раньше seed для canvas/audio/timing
    // noise жил только в sessionStorage на стороне mw/*.js — per-origin И
    // per-tab, а не общий на весь профиль, как остальные поля здесь. Теперь seed
    // генерируется один раз и хранится в chrome.storage.local — той же природы,
    // что PROFILE_DATA_KEY/STORAGE_KEY, переживает перезапуск браузера, общий на
    // все вкладки и все сайты. mw/*.js читает его как noiseSeed из этого же
    // объекта профиля (см. _getSessionSeed в mw/*.js).
    let noiseSeed = cached[NOISE_SEED_KEY];
    if (typeof noiseSeed !== 'number') noiseSeed = await afpEnsureNoiseSeed();

    const sw = profile.screenW || 1920;
    const sh = profile.screenH || 1080;
    // DPR: как у реального Windows-пользователя.
    // [FIX dpr-was-width-derived-only] Раньше DPR ВЫВОДИЛСЯ из ширины и других значений,
    // кроме 1 и 2, дать не мог: ветка `>= 3000 → 1.5` была недостижима (единственный
    // профиль ≥3000 — это 3840, а его первым перехватывает `>= 3840 → 2`), а профилей в
    // диапазоне [3000,3840) не было. Реальность иная: 1920×1080 на ноутбуках сплошь идёт
    // со 125%/150% масштабом (DPR 1.25/1.5) — измерено на живой машине (Arc, 150% → DPR 1.5,
    // экран 2008×1255). Экран и масштаб — независимые оси, поэтому DPR теперь может прийти
    // из профиля напрямую; формула осталась запасным вариантом для профилей без него.
    //  1366/1920 @100% → dpr=1 ; 1920 @125/150% → 1.25/1.5 ; 3840 @200% → 2
    const dpr = afpResolveDpr(profile, cached[PROFILE_KEY]);

    // deviceMemory (Chrome 2026+ desktop): powers of 2, typically 2|4|8|16|32.
    // Older Chrome capped at 8; new limits allow 16/32 on non-Android.
    // Still never report arbitrary values like 6, 12, 24, 48.
    var _memRaw = profile.memory || 8;
    var _memChrome = 8;
    if (_memRaw <= 2) _memChrome = 2;
    else if (_memRaw <= 4) _memChrome = 4;
    else if (_memRaw <= 8) _memChrome = 8;
    else if (_memRaw <= 16) _memChrome = 16;
    else _memChrome = 32; // 24/32/64 GB machines → 32

    // [FIX ua-reduction] Chrome ≥110: User-Agent всегда major.0.0.0 (UA Reduction).
    // Полный билд только в Sec-CH-UA-Full-Version / userAgentData — браузер сам.
    // Подставлять 151.0.7922.34 в UA = аномалия относительно реального Chrome.
    const chromeMajor = afpChromeMajor();
    // [FIX ua-dropped-edg-while-brands-kept-microsoft-edge] The host browser's own
    // trailing token is kept, so navigator.userAgent agrees with the native brands this
    // extension deliberately does not rewrite. Empty string on Chrome and Chromium.
    const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;

    // [FIX device-state-was-per-domain] Battery and the geolocation offset are resolved
    // HERE, from the MASTER seed, and travel as finished values — see afpDeviceState in
    // seed-lib.js for the measurement that forced this and for why the entropy is small.
    // The page-side modules used to derive them from `profile.noiseSeed`, which
    // injectProfile() replaces with the PER-DOMAIN seed, so one machine answered two
    // origins with two battery levels and two positions. Same pattern as the ANGLE strings
    // and afp_profile_gl: the table (and here the master) stays in the service worker, and
    // only the answer crosses into the page.
    const deviceState = afpDeviceState(noiseSeed, profileId);

    return {
        noiseSeed,
        ...deviceState,
        // [FIX host-mode] The one flag the page side reads to answer every hardware field
        // natively; see afpIsHostRecord. False on every table row, so nothing changes for
        // them. `hwAv1Decode` rides beside it: false only for a claimed card without an
        // AV1 decoder, and only ever used to DOWNGRADE decodingInfo().powerEfficient.
        hostHw: isHost,
        hwAv1Decode: !(gpu.hwDecode && gpu.hwDecode.av1 === false),
        // [FIX duplicate-profileId-key] Раньше profileId был задан здесь ЕЩЁ
        // РАЗ (тем же выражением, что и const profileId на строке выше) и
        // молча перезаписывался вторым вхождением ключа profileId ниже —
        // первое присваивание было мёртвым кодом. Оставлен один источник
        // истины: локальная const profileId, объявленная выше.
        // normal | stealth — меньше патчей, меньше anti_detect score
        mode: (typeof cached.afp_mode === 'string' ? cached.afp_mode : 'normal'),
        features: afpMergeFeatures(cached.afp_features),
        // [FIX color-depth-was-a-value-chrome-never-reports] 24, not 32. Chrome on Windows
        // reports screen.colorDepth === 24 (and pixelDepth 24) no matter the actual display
        // mode — the 8 alpha bits are not counted. Measured on this host: clean Chromium 24,
        // clean real Chrome 24, and a real Fingerprint Pro event from the user's own Chrome
        // with the extension OFF also carried color_depth 24 while the same browser with it
        // ON reported 32. So the constant was a free, deterministic tell.
        screenWidth: sw, screenHeight: sh, colorDepth: 24, devicePixelRatio: dpr,
        platform: profile.platform || 'Win32', hwConcurrency: profile.cores || 8,
        deviceMemory: _memChrome, webdriver: false, vendor: 'Google Inc.',
        language: _langClaim.loc,
        locale: _langClaim.loc,
        // Read by mw/mw-timezone-screen's _dtfLocale for everything Intl answers with. Kept
        // separate from `locale` because they are different strings on 57 of 67 countries —
        // see afpLanguageClaim.
        intlLocale: _langClaim.intl,
        // [FIX missing-countryCode] Гео в main-world ждёт profile.countryCode;
        // раньше падало на language.split('-').pop() — хрупкий fallback.
        countryCode: countryCode,
        // [FIX languages-was-the-header-list] navigator.languages was derived from the
        // Accept-Language string by stripping the q values, which put the BASE tag in
        // it: ['et-EE','et','en','en-US']. Chrome does not do that, and since
        // ReduceAcceptLanguage shipped it does not send that header either. Measured
        // on a clean browser with the field-trial config left ON (the rig keeps it for
        // exactly this reason), five languages, five times out of five:
        //
        //   pref et-EE   header 'et-EE,et;q=0.9'   navigator.languages ['et-EE']
        //   pref en-GB   header 'en-GB,en;q=0.9'   navigator.languages ['en-GB']
        //
        // The header expands, the JS list does not. Ours announced a four-tag list in
        // the pre-reduction shape — a browser calling itself Chrome 152 while speaking
        // like an older one. Isolated on live Fingerprint Pro events as the single
        // cause of bot: bad / BrowserAutomationStudio: the same build with only this
        // field left native read not_detected.
        languages: [_langClaim.loc],
        doNotTrack: null, maxTouchPoints: 0, pdfViewerEnabled: true,
        // laptop_* → Bluetooth есть; pc_* → типичный desktop без BT-адаптера.
        // Host mode: true, which is the value that installs NO accessor — the adapter is
        // whatever the machine has.
        hasBluetooth: isHost ? true : !isDesktop,
        profileId: profileId,
        userAgent: ua,
        appVersion: `5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`,
        webglVendor: gpu.unmaskedVendor, webglRenderer: gpu.unmaskedRenderer,
        // WebGPU adapter.info aligned with same GPU_DATA entry as WebGL
        webgpuVendor: (gpu.webgpu && gpu.webgpu.vendor) || 'intel',
        webgpuArchitecture: (gpu.webgpu && gpu.webgpu.architecture) || '',
        webgpuDevice: (gpu.webgpu && gpu.webgpu.device) || '',
        webgpuDescription: (gpu.webgpu && gpu.webgpu.description) || '',
        webglMaxAnisotropy: (typeof gpu.webglMaxAnisotropy === 'number') ? gpu.webglMaxAnisotropy : 16,
        timezone: country.tz,
        clientHints: {
            platform: 'Windows', mobile: false, platformVersion: await afpPlatformVersion(),
            architecture: 'x86', bitness: '64', wow64: false, model: '',
            formFactors: ['Desktop']
        },
        mediaDevices: [
            { kind: 'audioinput', label: '', deviceId: 'default-a', groupId: 'default-0' },
            { kind: 'audiooutput', label: '', deviceId: 'default-o', groupId: 'default-0' },
            { kind: 'videoinput', label: '', deviceId: 'default-v', groupId: 'default-0' }
        ],
        // Host mode: null — every family the machine has is allowed through, in the window
        // and in the worker payload (mw-workers hands the shim `null` for the same reason).
        allowedFonts: isHost ? null : [
            'Arial', 'Arial Black', 'Arial Narrow', 'Bahnschrift', 'Calibri', 'Calibri Light', 'Cambria',
            'Cambria Math', 'Candara', 'Candara Light', 'Comic Sans MS', 'Consolas', 'Constantia',
            // [FIX allowlist-claimed-a-font-not-every-windows-has] Dubai / Dubai Light /
            // Dubai Medium were here and are gone. The extension can only SUBTRACT fonts —
            // it blocks a family the host has, it cannot conjure one the host lacks — so
            // what a page observes is `host ∩ allowlist`. Measured on two Windows boxes
            // with the same browser: one had the Dubai family, the other did not, which
            // made the observable set differ by three names for reasons belonging to the
            // machine. Every other name here was present on both.
            // NOT removed on suspicion: Pristina, Haettenschweiler, Monotype Corsiva,
            // Lucida Bright/Sans and Segoe UI Light were all proposed as "rare" and all
            // measured identical on both machines. Cut by measurement, never by vibe — a
            // list trimmed to a handful of base families is a configuration no real
            // Windows install has, which is the same inversion that made the audio noise
            // report 5000/5000 unique samples against a natural 4736.
            // Still unproven and worth a third machine: the language-pack faces
            // (Yu Gothic, Malgun Gothic, SimSun, Microsoft YaHei, Nirmala UI,
            // Leelawadee UI, Javanese Text, Myanmar Text) — present on both boxes here,
            // but neither was a plain en-US install.
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
        webglParams: gpu.webglParams || {},
        plugins: [
            { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
        ],
        mimeTypes: [
            { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
            { type: 'text/pdf', description: 'Portable Document Format', suffixes: 'pdf' }
        ],
        connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
        speechVoices: afpSpeechVoices(country.loc)
    };
}

// [FIX speech-locale] Win10 всегда имеет en-US local voices; при не-en locale
// добавляем один локальный Microsoft voice — иначе Accept-Language / navigator.language
// локальные, а getVoices() только US.
//
// [FIX cold-start-voices] Вынесено из buildProfile на верхний уровень, чтобы этот же
// список попадал в dyn/cc/<CC>.js (tools/gen-dyn.mjs зовёт эту функцию). CreepJS снимает
// голоса рано — у него give-up таймер 300ms — и до холодного старта успевал увидеть
// запасную en-US тройку из mw/mw-canvas-audio.js с Zira по умолчанию. Его проверка
// `defaultVoiceLang.split('-')[0] !== Intl locale.split('-')[0]` при locale de-DE давала
// voiceLangMismatch → LowerEntropy.TIME_ZONE → секции Timezone и Intl помечались
// bold-fail. Это не «ложь» (totalLies остаётся 0), а понижение доверия к локали.
function afpSpeechVoices(locale) {
    var voices = [
                { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true, default: false },
                { name: 'Microsoft Mark - English (United States)', lang: 'en-US', localService: true, default: false },
                { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true, default: true }
            ];
            var loc = locale || 'en-US';
            var base = String(loc).split('-')[0].toLowerCase();
            if (base && base !== 'en') {
                // [FIX voice-names-dropped-the-region-the-three-english-ones-carry]
                //
                // Every entry below used to read "Microsoft <Name> - <Language>" while the
                // three en-US voices above read "... - English (United States)". So the
                // list contradicted its own format, which is checkable by anyone without a
                // database of Windows voices — and it was also simply wrong. Measured on a
                // clean Chrome 152 on the machine this was found on, where the host really
                // does have a Russian voice installed:
                //
                //   real Windows/Chrome   Microsoft Irina - Russian (Russia)
                //   this table            Microsoft Irina - Russian
                //
                // The region is DERIVED, not guessed, and the derivation is anchored:
                //
                //   new Intl.DisplayNames(['en'],
                //       { type: 'language', languageDisplay: 'standard' }).of(lang)
                //
                // reproduces BOTH names this machine can measure — 'Russian (Russia)' and
                // 'English (United States)' — exactly, in Chrome's ICU and in Node's.
                // ('standard' is load-bearing: the default gives "American English" and
                // "Brazilian Portuguese", which Windows does not use.)
                //
                // The strings are BAKED rather than computed at run time on purpose. This
                // function is called by tools/gen-dyn.mjs under Node to fill dyn/cc/<CC>.js
                // and by background.js under Chrome for the late profile; two ICU builds
                // that ever disagreed would put a different voice list in the cold start
                // than in the profile that follows it, which is the split this file spends
                // most of its length avoiding.
                //
                // Known residual, named rather than special-cased: for a few locales
                // Windows keeps its own older spelling where CLDR has moved on —
                // 'Turkish (Türkiye)', 'Czech (Czechia)', 'Chinese (China)' are the ones to
                // expect. Those were wrong before too (they carried no region at all); one
                // rule from one anchored source beats a table of hand-picked exceptions.
                var LOCAL = {
                    de: { name: 'Microsoft Hedda - German (Germany)', lang: 'de-DE' },
                    fr: { name: 'Microsoft Hortense - French (France)', lang: 'fr-FR' },
                    es: { name: 'Microsoft Helena - Spanish (Spain)', lang: 'es-ES' },
                    it: { name: 'Microsoft Elsa - Italian (Italy)', lang: 'it-IT' },
                    pt: { name: 'Microsoft Maria - Portuguese (Brazil)', lang: 'pt-BR' },
                    nl: { name: 'Microsoft Frank - Dutch (Netherlands)', lang: 'nl-NL' },
                    pl: { name: 'Microsoft Paulina - Polish (Poland)', lang: 'pl-PL' },
                    ru: { name: 'Microsoft Irina - Russian (Russia)', lang: 'ru-RU' },
                    ja: { name: 'Microsoft Haruka - Japanese (Japan)', lang: 'ja-JP' },
                    ko: { name: 'Microsoft Heami - Korean (South Korea)', lang: 'ko-KR' },
                    zh: { name: 'Microsoft Huihui - Chinese (China)', lang: 'zh-CN' },
                    tr: { name: 'Microsoft Tolga - Turkish (Türkiye)', lang: 'tr-TR' },
                    sv: { name: 'Microsoft Bengt - Swedish (Sweden)', lang: 'sv-SE' },
                    da: { name: 'Microsoft Helle - Danish (Denmark)', lang: 'da-DK' },
                    fi: { name: 'Microsoft Heidi - Finnish (Finland)', lang: 'fi-FI' },
                    nb: { name: 'Microsoft Hulda - Norwegian Bokmål (Norway)', lang: 'nb-NO' },
                    no: { name: 'Microsoft Hulda - Norwegian Bokmål (Norway)', lang: 'nb-NO' },
                    cs: { name: 'Microsoft Jakub - Czech (Czechia)', lang: 'cs-CZ' },
                    hu: { name: 'Microsoft Szabolcs - Hungarian (Hungary)', lang: 'hu-HU' },
                    ro: { name: 'Microsoft Andrei - Romanian (Romania)', lang: 'ro-RO' },
                    el: { name: 'Microsoft Stefanos - Greek (Greece)', lang: 'el-GR' },
                    ar: { name: 'Microsoft Naayf - Arabic (Saudi Arabia)', lang: 'ar-SA' },
                    he: { name: 'Microsoft Asaf - Hebrew (Israel)', lang: 'he-IL' },
                    th: { name: 'Microsoft Pattara - Thai (Thailand)', lang: 'th-TH' },
                    vi: { name: 'Microsoft An - Vietnamese (Vietnam)', lang: 'vi-VN' },
                    id: { name: 'Microsoft Andika - Indonesian (Indonesia)', lang: 'id-ID' },
                    et: { name: 'Microsoft Kaia - Estonian (Estonia)', lang: 'et-EE' },
                    lv: { name: 'Microsoft Everita - Latvian (Latvia)', lang: 'lv-LV' },
                    lt: { name: 'Microsoft Leonas - Lithuanian (Lithuania)', lang: 'lt-LT' },
                    sk: { name: 'Microsoft Filomena - Slovak (Slovakia)', lang: 'sk-SK' },
                    sl: { name: 'Microsoft Lado - Slovenian (Slovenia)', lang: 'sl-SI' },
                    hr: { name: 'Microsoft Matea - Croatian (Croatia)', lang: 'hr-HR' },
                    bg: { name: 'Microsoft Ivan - Bulgarian (Bulgaria)', lang: 'bg-BG' },
                    uk: { name: 'Microsoft Ostap - Ukrainian (Ukraine)', lang: 'uk-UA' }
                };
                var L = LOCAL[base];
                if (L) {
                    voices[2].default = false;
                    voices.push({
                        name: L.name,
                        lang: loc.indexOf('-') > 0 ? loc : L.lang,
                        localService: true,
                        default: true
                    });
                }
            }
    return voices;
}

// ============================================================
// ЗАГРУЗКА WASM В MAIN МИР (EMSCRIPTEN-СОВМЕСТИМАЯ)
// ============================================================

// [FIX wasm-fetch-was-visible-to-the-page] protect.wasm, as a plain array of bytes, read
// once per service-worker lifetime. It is passed into the MAIN world as an argument to
// executeScript rather than fetched there, so a page that has replaced window.fetch — which
// any page may do — no longer sees a chrome-extension:// request for a file called
// protect.wasm. The full reasoning is at the instantiate call inside the injected function.
//
// An array and not a Uint8Array because executeScript arguments cross a JSON boundary; the
// injected side rebuilds the typed array. ~4.7KB, so ~20KB of JSON, once per tab.
//
// The manifest no longer lists protect.wasm under web_accessible_resources: nothing fetches
// it from a page any more, and an entry there is a resource a page could try to probe.
// chrome.runtime.getURL still resolves for the worker's own fetch below without it.
let _wasmBytesCache = null;
async function getWasmBytes() {
    if (_wasmBytesCache) return _wasmBytesCache;
    try {
        const res = await fetch(chrome.runtime.getURL('protect.wasm'));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        _wasmBytesCache = Array.from(new Uint8Array(await res.arrayBuffer()));
        return _wasmBytesCache;
    } catch (e) {
        console.warn('[AFP] protect.wasm:', e && e.message);
        return null;
    }
}

async function loadWasmToMain(tabId) {
    try {
        const featStore = await chrome.storage.local.get(['afp_features']);
        const feat = featStore.afp_features || {};
        if (feat.canvas === false) return;
    } catch (e) {}
    // Не инжектируем WASM на сайтах с жёсткой CSP или логин-страницах
    let tabUrl = '';
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!isWasmEligibleUrl(tab?.url)) return;
        tabUrl = tab.url;
    } catch(e) { return; }

    // [FIX wasm-fetch-was-visible-to-the-page] The module is read HERE, in the service
    // worker, and handed to the injected function as bytes. It used to be a URL that the
    // page's own fetch resolved — see the long note at the instantiate call. Cached for
    // the life of the worker: 4.7KB, read once, reused by every tab.
    const wasmBytes = await getWasmBytes();
    if (!wasmBytes) return;

    // [FIX wasm-read-the-page-for-what-background-already-knew] The seed and the locale
    // used to be resolved INSIDE the page: the injected function read the profile out of
    // sessionStorage and busy-spun up to 50 ms waiting for it to appear, with this
    // argument as a fallback. Two problems, and moving the profile into a closure only
    // made the first one fatal:
    //   * there is nothing in the page to read any more;
    //   * the two seeds were computed independently — this one from storage, the page's
    //     from `profile.noiseSeed` — and the whole point of [FIX seed-computed-twice]
    //     was that any divergence shows up as a canvas hash that differs between Window
    //     and Worker while every other string matches.
    // Both are answered by taking all three values from the SAME getCachedProfile() that
    // injectProfile uses, deriving the domain seed here exactly as it does, and passing
    // them in. The busy-spin is gone with them: nothing is waited for, because nothing
    // has to arrive.
    let noiseSeedArg = 0;
    let tzArg = '';
    let langArg = '';
    try {
        const p = await getCachedProfile();
        if (p) {
            if (typeof p.noiseSeed === 'number') noiseSeedArg = p.noiseSeed >>> 0;
            if (p.timezone) tzArg = p.timezone;
            if (p.language) langArg = p.language;
        }
    } catch (e) {}
    if (!noiseSeedArg) {
        try {
            const st = await chrome.storage.local.get([NOISE_SEED_KEY]);
            if (typeof st[NOISE_SEED_KEY] === 'number') noiseSeedArg = st[NOISE_SEED_KEY] >>> 0;
        } catch (e) {}
    }
    // Per-domain: WASM noise matches profile inject seed for this host
    // (tabUrl already fetched above — no second chrome.tabs.get needed)
    try {
        const host = new URL(tabUrl).hostname;
        if (host) noiseSeedArg = deriveDomainSeed(noiseSeedArg, host);
    } catch (e) {}

    try {
        const wasmRes = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async function(wasmBytes, noiseSeedArg, tzArg, langArg) {
            // [FIX wasm-markers-were-client-litter] mw-canvas-audio TAKES __w0/__w1 off
            // window as soon as they land, so their absence no longer means "not loaded".
            // The status object is where the answer lives now — and unlike the pair, it
            // exists in a fresh iframe too, so CreepJS's litter diff never sees it.
            try { if (window.__t0 && window.__t0.wasm) return { success: true, cached: true }; } catch (eC) {}

            try {
                let wasmMemory;
                let HEAP8, HEAP32, HEAPU8, HEAPF32;
                function updateMemoryViews() {
                    const b = wasmMemory.buffer;
                    HEAP8 = new Int8Array(b);
                    HEAPU8 = new Uint8Array(b);
                    HEAP32 = new Int32Array(b);
                    HEAPF32 = new Float32Array(b);
                }

                // [CLEANUP] getValue удалена вместе с addAudioNoise ниже — читать из кучи
                // WASM больше некому. Обмен остался односторонним: setValue пишет seed, а
                // результаты возвращаются либо через HEAPU8 (canvas), либо возвращаемым
                // значением (substitute_text_*). Тот же случай, что с UTF8ToString ниже.
                function setValue(ptr, value, type) {
                    switch(type) {
                        case 'i32': HEAP32[ptr >> 2] = value; break;
                        case 'float': HEAPF32[ptr >> 2] = value; break;
                        default: HEAP8[ptr] = value;
                    }
                }

                // [CLEANUP] Здесь была UTF8ToString (WASM ptr → JS-строка, ~26 строк) —
                // ни разу не вызывалась. Обмен строками с WASM в этом файле идёт
                // ТОЛЬКО в сторону WASM (allocStr → substitute_text_width /
                // substitute_text_metrics / set_locale); ни один из оставленных
                // экспортов не возвращает char*, так что обратное преобразование
                // не нужно (см. [CLEANUP] про убранные getFake*-методы ниже).

                // [FIX utf8-length-surrogate-miscount] Ветка `c >= 0xD800 && c <= 0xDFFF`
                // никогда не срабатывает для КОРРЕКТНОЙ пары: codePointAt на high
                // surrogate возвращает уже склеенный code point (напр. 0x1F600), то
                // есть > 0xDFFF → падало в `else len += 3` БЕЗ i++, после чего low
                // surrogate считался отдельно (он-то в диапазон попадает) как +4.
                // Итог 3+4=7 байт на emoji вместо 4 — расхождение с stringToUTF8
                // ниже, который через тот же codePointAt пишет ровно 4. Порядок
                // условий приведён к тому, что реально делает stringToUTF8:
                // сначала <= 0xFFFF (3 байта), иначе 4 байта + пропуск low surrogate.
                function lengthBytesUTF8(str) {
                    let len = 0;
                    for (let i = 0; i < str.length; ++i) {
                        const c = str.codePointAt(i);
                        if (c <= 0x7F) len++;
                        else if (c <= 0x7FF) len += 2;
                        else if (c <= 0xFFFF) len += 3;
                        else { len += 4; i++; }
                    }
                    return len;
                }

                function stringToUTF8(str, outPtr, maxBytesToWrite) {
                    if (!(maxBytesToWrite > 0)) return 0;
                    const endIdx = outPtr + maxBytesToWrite - 1;
                    let outIdx = outPtr;
                    for (let i = 0; i < str.length; ++i) {
                        let u = str.codePointAt(i);
                        if (u <= 0x7F) {
                            if (outIdx >= endIdx) break;
                            HEAPU8[outIdx++] = u;
                        } else if (u <= 0x7FF) {
                            if (outIdx + 1 >= endIdx) break;
                            HEAPU8[outIdx++] = 0xC0 | (u >> 6);
                            HEAPU8[outIdx++] = 0x80 | (u & 63);
                        } else if (u <= 0xFFFF) {
                            if (outIdx + 2 >= endIdx) break;
                            HEAPU8[outIdx++] = 0xE0 | (u >> 12);
                            HEAPU8[outIdx++] = 0x80 | ((u >> 6) & 63);
                            HEAPU8[outIdx++] = 0x80 | (u & 63);
                        } else {
                            if (outIdx + 3 >= endIdx) break;
                            HEAPU8[outIdx++] = 0xF0 | (u >> 18);
                            HEAPU8[outIdx++] = 0x80 | ((u >> 12) & 63);
                            HEAPU8[outIdx++] = 0x80 | ((u >> 6) & 63);
                            HEAPU8[outIdx++] = 0x80 | (u & 63);
                            i++;
                        }
                    }
                    HEAPU8[outIdx] = 0;
                    return outIdx - outPtr;
                }

                // [CLEANUP] wasmImports использует стандартные emscripten-имена
                // (emscripten_resize_heap/emscripten_memcpy_big) — эта сборка
                // (emscripten 3.1.6) экспортирует функции под asm/env, без
                // однобуквенной минификации import-объекта старой сборки.
                // [FIX wasm-rebuild-growth-mechanism] Пересобранный protect.wasm
                // (те же emcc 3.1.6, но другой набор флагов — не нашёл точную
                // комбинацию, дающую identical import-имена оригинальной сборки)
                // использует emscripten_notify_memory_growth вместо
                // emscripten_resize_heap: WASM сам вызывает нативную инструкцию
                // memory.grow и только ПОСЛЕ уведомляет JS — не спрашивает
                // разрешения заранее, в отличие от старого механизма. Держим
                // оба импорта одновременно — WebAssembly.instantiate использует
                // только те, которые реально нужны конкретному .wasm, так что
                // один и тот же wasmImports работает и со старой, и с новой
                // сборкой без дополнительных условий.
                const wasmImports = {
                    env: {
                        emscripten_resize_heap: function(requestedSize) {
                            const oldSize = HEAPU8.length;
                            requestedSize >>>= 0;
                            const maxHeapSize = 2147483648;
                            if (requestedSize > maxHeapSize) return false;
                            const newSize = Math.max(requestedSize, Math.ceil(oldSize * 1.2));
                            const aligned = Math.ceil(newSize / 65536) * 65536;
                            try {
                                wasmMemory.grow((Math.min(maxHeapSize, aligned) - oldSize + 65535) >>> 16);
                                updateMemoryViews();
                                return true;
                            } catch(e) { return false; }
                        },
                        emscripten_notify_memory_growth: function(memoryIndex) {
                            updateMemoryViews();
                        },
                        emscripten_memcpy_big: function(dest, src, num) {
                            HEAPU8.copyWithin(dest, src, src + num);
                        }
                    }
                };
                // Одна и та же таблица под оба namespace: сборка может импортировать
                // из env или из wasi_snapshot_preview1 (см. комментарий выше).
                wasmImports.wasi_snapshot_preview1 = wasmImports.env;

                // [FIX wasm-fetch-was-visible-to-the-page] This used to be
                // `await fetch(wasmUrl)` — and this function body runs with world: 'MAIN',
                // in the page's own realm, roughly 50ms after the load event. A page has
                // had its own scripts running for a long time by then, so a site that
                // replaced window.fetch (which any page may do, no privilege needed) saw a
                // request to chrome-extension://<token>/protect.wasm. use_dynamic_url hides
                // the extension ID in that URL, but not the scheme and not the file name:
                // "an extension is compiling WASM into this page" is the whole signal.
                //
                // The bytes are read in the service worker instead — a separate realm no
                // page can touch — and arrive as an ordinary argument. 4.7KB, once per tab.
                // Nothing is requested from the page, so there is nothing to observe.
                //
                // WebAssembly.instantiate is still the page's object and could be hooked;
                // that is inherent to running in the page's realm and cannot be fixed by
                // capturing a pristine reference without adding another permanent global
                // for every page to probe. What it exposes is a module, not a URL.
                const bytes = new Uint8Array(wasmBytes);

                const result = await WebAssembly.instantiate(bytes, wasmImports);
                const asm = result.instance.exports;

                wasmMemory = asm.memory;
                updateMemoryViews();
                // [FIX wasm-rebuild-init-name] Пересобранная версия экспортирует
                // _initialize вместо __wasm_call_ctors (тот же emcc, другой набор
                // флагов). У этого конкретного C-кода нет глобальных объектов с
                // рантайм-конструкторами (только простые static POD со
                // скалярными инициализаторами, попадающие прямо в data-сегмент) —
                // так что вызов этой функции здесь скорее формальность, но
                // оставляем try любого из двух имён на случай будущих пересборок.
                try { (asm.__wasm_call_ctors || asm._initialize || function(){})(); } catch(e) {}

                function allocStr(s) {
                    const bytes = lengthBytesUTF8(s) + 1;
                    const ptr = asm.malloc(bytes);
                    if (ptr) stringToUTF8(s, ptr, bytes);
                    return ptr;
                }

                // [CLEANUP] Убраны методы, которые ни разу не читаются mw/*.js:
                // getFakePlatform/HardwareConcurrency/DeviceMemory/Vendor/
                // WebGLVendor/Renderer, getTimezone/Language, getRandomInt,
                // getWebGLExtensions/MaxAnisotropy, getFakeBatteryLevel,
                // shouldBlockUrl, getRandomMode, getFakeWebdriver,
                // getFakeScreenWidth/Height. WebGL vendor/renderer/params на
                // JS-стороне идут через отдельную таблицу GPU_DATA в этом же
                // файле — WASM для них не источник. Оставлены только методы,
                // реально вызываемые из mw/*.js (см. комментарий там же).
                const wrapper = {
                    // [FIX position-dependent-noise] add_canvas_noise пересобран с
                    // offset_x/offset_y в сигнатуре — раньше шум был функцией
                    // ширины/высоты ЧТЕНИЯ, а не абсолютной позиции пикселя на
                    // canvas, из-за чего один и тот же пиксель получал разный шум
                    // в зависимости от того, читают его блоком или по одному —
                    // именно это ловит fingerprintswitcher-овский CheckIntegrity.
                    addCanvasNoise: function(d, offsetX, offsetY) {
                        const px = d.data, len = px.length;
                        if (!len) return;
                        const p = asm.malloc(len);
                        if (!p) return;
                        try {
                            HEAPU8.set(px, p);
                            asm.add_canvas_noise(p, d.width, d.height, d.width * 4, len, offsetX || 0, offsetY || 0);
                            px.set(HEAPU8.subarray(p, p + len));
                        } finally { asm.free(p); }
                    },
                    // shouldSkipCanvasNoise removed — gated first (w,h) broke deterministic re-read
                    // [CLEANUP] addAudioNoise удалена — её никто не вызывал. Шум
                    // AudioContext был убран раньше (он оказался громче того отпечатка,
                    // который скрывал), а обёртка осталась и создавала впечатление, будто
                    // аудио всё ещё шумится. Проверено замером: значение, которое читает
                    // FingerprintJS, совпадает с чистым браузером байт в байт, и совпадает
                    // между двумя разными машинами — шума там нет и не было.
                    //
                    // Сам экспорт add_audio_noise остаётся в .wasm, как и
                    // get_fake_shader_precision выше: пересборка не требуется, неиспользуемый
                    // экспорт стоит только байты.
                    // [CLEANUP+FIX] getFakeShaderPrecision удалён. Он выделял по 8 байт
                    // на указатель и читал ДВА i32 из каждого, тогда как C-функция
                    // get_fake_shader_precision пишет ровно ОДИН — второй элемент был
                    // непроинициализированной памятью кучи, и mw-navigator.js отдавал
                    // именно его для FRAGMENT_SHADER (замер: 1520 вместо 127/127/23).
                    // Патч getShaderPrecisionFormat убран целиком, нативные значения
                    // корректны и одинаковы на любом desktop-GPU — подробный разбор
                    // всех четырёх дефектов см. в mw/mw-navigator.js, секция
                    // «WEBGL SHADER PRECISION — НЕ ПАТЧИМ». Экспорт остаётся в .wasm
                    // (пересборка не требуется), просто больше не вызывается.
                    substituteTextWidth: function(real, font, text) {
                        const fontPtr = allocStr(font || '');
                        const textPtr = allocStr(text || '');
                        if (!fontPtr || !textPtr) { asm.free(fontPtr); asm.free(textPtr); return real; }
                        try { return asm.substitute_text_width(real, fontPtr, textPtr); }
                        finally { asm.free(fontPtr); asm.free(textPtr); }
                    },
                    substituteTextMetrics: function(prop, real) {
                        if (!prop) return real;
                        const ptr = allocStr(prop);
                        if (!ptr) return real;
                        try { return asm.substitute_text_metrics(ptr, real); }
                        finally { asm.free(ptr); }
                    },
                    // [CLEANUP] normalizeTiming удалён вместе с патчем performance.now:
                    // единственным потребителем была секция PERFORMANCE.NOW в
                    // mw/mw-misc.js, а она убрана (джиттер ломал монотонность и
                    // разрушал собственный кламп Chrome в 0.1 мс — подробный разбор
                    // там же). Экспорт normalize_timing остаётся в .wasm, просто
                    // больше не вызывается — пересборка не требуется.
                    setLocale: function(tz, lang) {
                        const tzPtr = allocStr(tz || '');
                        const lPtr = allocStr(lang || '');
                        try { if (tzPtr && lPtr) asm.set_locale(tzPtr, lPtr); }
                        finally { asm.free(tzPtr); asm.free(lPtr); }
                    }
                };

                // [FIX main-world-profile-source] Здесь стоял _mwProfile() — третья по
                // счёту попытка прочитать профиль из страницы. Сначала он искался в
                // documentElement[Symbol.for('js.runtime.bridge.v2')].profile и
                // window.__AFP_PROFILE__ (оба УДАЛЯЮТСЯ на document_start, то есть оба
                // выражения всегда давали undefined), потом — в
                // sessionStorage['v.ui.s']. Теперь профиль не лежит в странице вообще
                // ([FIX profile-readable-by-any-page], см. mw/mw-core.js), и читать его
                // отсюда больше не нужно: сид, таймзона и язык приходят аргументами из
                // того же getCachedProfile(), которым пользуется injectProfile.
                //
                // [FIX wasm-seed-desync] Один seed с профилем (noiseSeed), не sessionStorage random.
                // C seed_random при len=1 сам расширяет до 8 слов; g_identity_seed = hash(g_seed[0]).
                //
                // [FIX seed-computed-twice] Порядок был обратный: сначала
                // noiseSeedArg (его background считает ОТДЕЛЬНО — из
                // storage[NOISE_SEED_KEY], с запасным путём через getCachedProfile,
                // и затем deriveDomainSeed по хосту), и лишь потом профиль. То есть
                // сид вычислялся дважды и независимо: один раз для профиля
                // (masterSeed = profile.noiseSeed → deriveDomainSeed), другой раз для
                // WASM. Достаточно любому из входов или запасных веток разойтись —
                // и окно шумит одним сидом, а воркер другим, потому что воркерный
                // payload берёт сид ТОЛЬКО из профиля (_P().noiseSeed), как и
                // JS-фолбэк в mw-core (_getSessionSeed).
                // Наблюдаемо это ровно так, как у пользователя: строка canvas у
                // CreepJS расходится между Window и Worker, все остальные строки
                // совпадают, и никакие правки пути чтения на это не влияют.
                // Воспроизведено в dev-creepcanvashash.html?wasmseed=<другой сид>:
                // окно 99d4f64d против воркера e205fde1.
                // Теперь источник правды один — профиль, тот же самый объект, из
                // которого сид берут и mw-core, и воркерный payload.
                //
                // [FIX seed-fallback-won-the-race] Раньше сид ЧИТАЛСЯ из страницы, с
                // busy-spin до 50 мс, потому что загрузчик стартует на document_start и
                // мог опередить инъекцию профиля; noiseSeedArg был запасным вариантом и
                // считался по своему хосту, из-за чего на переходе между сайтами окно
                // (WASM) расходилось с воркером (JS-порт, читает _P().noiseSeed).
                // Наблюдалось как расхождение строки canvas у CreepJS при полном
                // совпадении всех остальных строк — и, что характерно, не сдвигалось
                // никакими правками пути чтения пикселей.
                // Гонки больше нет: аргумент выведен из ТОГО ЖЕ getCachedProfile() и той
                // же deriveDomainSeed, что и профиль для injectProfile (см. вызывающую
                // функцию), поэтому ждать нечего и расходиться нечему.
                var seedWord = 0;
                if (typeof noiseSeedArg === 'number' && isFinite(noiseSeedArg)) {
                    seedWord = noiseSeedArg >>> 0;
                }
                // [FIX seed-was-a-named-page-readable-key] A sessionStorage read stood here
                // as a second opinion on the seed. The key is gone from the whole extension
                // — it named us and it handed the page the number that makes the positional
                // canvas noise invertible. Nothing is lost: noiseSeedArg is computed by the
                // caller from the SAME getCachedProfile() and the SAME deriveDomainSeed the
                // injected profile uses, which is the point of [FIX seed-computed-twice];
                // a fallback reading a different channel could only ever disagree with it.
                if (!seedWord) seedWord = 0xC0FFEE;
                const sp = asm.malloc(4);
                if (sp) {
                    try {
                        setValue(sp, seedWord, 'i32');
                        asm.seed_random(sp, 1);
                    } finally { asm.free(sp); }
                }

                // Синхронизация с профилем (locale) — тот же источник, что у mw/*.
                // Приходит аргументом по той же причине, что и сид выше.
                if (tzArg) {
                    try { wrapper.setLocale(tzArg, langArg || ''); } catch(e) {}
                }

                // [FIX clientCode-w0-enumerable] Bare assignment → enumerable globals.
                // CreepJS getClientCode scans Object.keys(window).slice(-50); __w0/__w1
                // land in that tail after late WASM load and become code hash litter.
                try {
                    Object.defineProperty(window, '__w0', {
                        value: wrapper, writable: true, configurable: true, enumerable: false
                    });
                } catch (eW0) { window.__w0 = wrapper; }
                try {
                    Object.defineProperty(window, '__w1', {
                        value: true, writable: true, configurable: true, enumerable: false
                    });
                } catch (eW1) { window.__w1 = true; }
                window.dispatchEvent(new CustomEvent('ui:w'));

                return { success: true };

            } catch(e) {
                // [FIX wasm-csp-error-named-the-extension] A page whose CSP omits
                // 'wasm-unsafe-eval' rejects WebAssembly.instantiate, and this printed
                // "WASM load error: …" into ITS console, attributed to the extension —
                // measured on a page served with `script-src 'self' 'unsafe-inline'`, and
                // youtube.com is the same shape. It is not an error condition here: the
                // very next lines set __w2, which makes mw-canvas-audio resolve the JS
                // noise path instead (see _resolveCanvasMode), so the canvas is still
                // covered. Anything unexpected is still reported.
                //
                // [FIX last-console-call-in-the-page-realm] That report used to be a
                // console.error RIGHT HERE, and this function body runs with world: 'MAIN'
                // — the page's own realm. Two ways that gives the extension away, and a
                // page needs no privilege for either:
                //   * console is the PAGE's object here, so a site that replaced
                //     console.error before our script runs receives the text as a plain
                //     callback — it does not have to be watching devtools;
                //   * Chrome attributes the record to its caller, which puts
                //     chrome-extension://<id>/... in the page console.
                // Every mw/*.js file is console-silent for exactly this reason (measured:
                // zero calls across all ten), and two earlier fixes exist purely to get
                // this extension's name off the page's console —
                // [FIX blamed-for-the-pages-own-console-errors] and
                // [FIX extension-id-leaked-through-error-stacks]. This was the one line
                // left that could still announce us, on the one path nobody exercises.
                //
                // Nothing is lost: the message already travels home in the return value
                // below, and the CALLER logs it — in the service worker, whose console is
                // a separate devtools target that no page can read or replace.
                try {
                    Object.defineProperty(window, '__w2', {
                        value: true, writable: true, configurable: true, enumerable: false
                    });
                } catch (e2) {
                    try { window.__w2 = true; } catch (e3) {}
                }
                return { error: e.message };
            }
        },
        args: [wasmBytes, noiseSeedArg, tzArg, langArg]
    });
        // [FIX last-console-call-in-the-page-realm] The injected function reports failure
        // through its RETURN value, which used to be discarded — the diagnostic was printed
        // in the page's realm instead (see the long note at that catch). It is read here
        // now, so the same information reaches the same developer, in the service worker's
        // console, which no page can read. The CSP/WebAssembly cases stay quiet for the
        // reason stated there: a page whose CSP omits 'wasm-unsafe-eval' is not a fault,
        // __w2 sends mw-canvas-audio down the JS noise path and the canvas stays covered.
        const wasmErr = wasmRes && wasmRes[0] && wasmRes[0].result && wasmRes[0].result.error;
        if (wasmErr && !/WebAssembly|Content Security Policy|wasm/i.test(wasmErr)) {
            console.warn('[AFP] WASM load error:', wasmErr);
        }
    } catch(e) { if (!isErrorPageMsg(e.message)) console.warn('[AFP] loadWasmToMain:', e.message); }
}

// ============================================================
// ИНЖЕКЦИЯ ПРОФИЛЯ В MAIN МИР
// ============================================================

const WEBRTC_EXCEPTIONS_KEY = 'afp_webrtc_exceptions'; // hosts where WebRTC protection отключена

async function getWebrtcExceptions() {
    const r = await chrome.storage.local.get([WEBRTC_EXCEPTIONS_KEY]);
    return Array.isArray(r[WEBRTC_EXCEPTIONS_KEY]) ? r[WEBRTC_EXCEPTIONS_KEY] : [];
}

// [FIX service-worker-scope-is-unreachable] A site's own service worker reads the REAL
// machine — measured, window against SW on one page: 16 cores against 18, Europe/Berlin
// against Europe/Moscow, an RTX 3070 against the host's Intel Arc — and there is no way to
// patch that scope from an MV3 extension: blob: scripts are refused, script redirects are
// disallowed, content scripts never run there and Chrome cannot rewrite a response body.
// The platform closes the third-party case on its own (a SW script must be same-origin, so
// a tracker cannot ship one), which leaves sites fingerprinting through THEIR OWN worker.
// Only two levers exist, allow or deny, so this is a per-site switch like the WebRTC one —
// default ALLOW, because denying by default takes offline mode, push and PWAs with it.
const SW_BLOCKED_KEY = 'afp_sw_blocked'; // hosts where service workers are refused

async function getSwBlockedHosts() {
    const r = await chrome.storage.local.get([SW_BLOCKED_KEY]);
    return Array.isArray(r[SW_BLOCKED_KEY]) ? r[SW_BLOCKED_KEY] : [];
}

// [FIX the-per-site-flag-arrived-320ms-late] The exception list, delivered at
// document_start as the PRESENCE of one registered content script (see rtc-off.js for the
// measurement that forced this). The profile carries the same answer, but it lands ~320 ms
// into the page — after a connection may already have offered its candidates — and the
// three RTC hooks then disagree with each other inside one connection.
//
// Nothing about the user is encoded here: the registration's `matches` ARE the host list,
// so a host that is not excepted never sees the file at all.
const RTC_OFF_SCRIPT_ID = 'afp-rtc-off';
let _rtcOffChain = Promise.resolve();

/** `*://host/*` plus the subdomain form, mirroring the endsWith('.' + h) match below. */
/**
 * [FIX csp-restrictions-learned-per-route] Match patterns for the CSP marker scripts
 * (noblob.js, tte.js): a bare host as rtcOffMatches builds it; a `host/segment` entry as
 * that route only — the segment itself, with a query, and everything under it — on the
 * host and its subdomains. The root route ('host/') is the root document alone. A segment
 * carrying pattern syntax is skipped rather than risk the whole registration.
 */
function afpCspScopePatterns(entries) {
    const out = [];
    for (const e of entries) {
        if (typeof e !== 'string' || !e) continue;
        const i = e.indexOf('/');
        if (i < 0) { out.push.apply(out, rtcOffMatches([e])); continue; }
        const h = e.slice(0, i), seg = e.slice(i + 1);
        if (!h || /[/*\s]/.test(h) || /[*?\s]/.test(seg)) continue;
        const hosts = [h];
        if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(h) && h.indexOf(':') === -1) hosts.push('*.' + h);
        for (const hh of hosts) {
            out.push(`*://${hh}/${seg}`, `*://${hh}/${seg}?*`);
            if (seg) out.push(`*://${hh}/${seg}/*`);
        }
    }
    return out;
}

function rtcOffMatches(hosts) {
    const out = [];
    for (const h of hosts) {
        if (typeof h !== 'string' || !h || /[/*\s]/.test(h)) continue;
        out.push(`*://${h}/*`);
        // An IP literal has no subdomains and Chrome rejects the pattern outright, which
        // would take the whole registration down with it.
        if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(h) && h.indexOf(':') === -1) out.push(`*://*.${h}/*`);
    }
    return out;
}

const SW_OFF_SCRIPT_ID = 'afp-sw-off';
let _swOffChain = Promise.resolve();

function updateSwOffScript() {
    _swOffChain = _swOffChain.catch(() => {}).then(() => applySwOffScript());
    return _swOffChain;
}

/** Same registration dance as the WebRTC marker — see applyRtcOffScript for the why. */
async function applySwOffScript() {
    try {
        const matches = rtcOffMatches(await getSwBlockedHosts());
        const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SW_OFF_SCRIPT_ID] });
        const registered = !!(existing && existing.length);
        if (!matches.length) {
            if (registered) await chrome.scripting.unregisterContentScripts({ ids: [SW_OFF_SCRIPT_ID] });
            return;
        }
        const spec = {
            id: SW_OFF_SCRIPT_ID,
            js: ['sw-off.js'],
            matches,
            runAt: 'document_start',
            world: 'MAIN',
            allFrames: true,
            matchOriginAsFallback: true,
            persistAcrossSessions: true
        };
        if (registered) {
            await chrome.scripting.updateContentScripts([spec]);
        } else {
            try {
                await chrome.scripting.registerContentScripts([spec]);
            } catch (eDup) {
                if (!/Duplicate script ID/i.test(eDup && eDup.message)) throw eDup;
                await chrome.scripting.updateContentScripts([spec]);
            }
        }
    } catch (e) {
        console.warn('[AFP] updateSwOffScript:', e && e.message);
    }
}

// [FIX the-first-worker-on-a-blob-refusing-origin-was-always-lost] The third script of this
// shape, and the reason is the one written at the top of noblob.js: an origin whose CSP
// omits blob: from its worker sources refuses every worker mw-workers builds, and the flag
// that would have stopped it from trying arrived through chrome.storage and storage-bridge —
// later than the page's own first script. Measured: the first load of a fresh profile lost
// its worker 4 times in 4, the second load none, with a clean-browser control that kept it
// every time.
//
// So the hosts the CSP observer has already recorded get the answer synchronously, the same
// way the WebRTC and service-worker switches deliver theirs.
const NOBLOB_SCRIPT_ID = 'afp-noblob';
let _noBlobChain = Promise.resolve();

function updateNoBlobScript() {
    // [FIX tte-flag-arrived-after-the-first-script] The trusted-types marker rides the same
    // chain, so every caller that refreshes one refreshes both — the two lists are learned
    // by the same observer from the same header.
    _noBlobChain = _noBlobChain.catch(() => {}).then(() => applyNoBlobScript()).then(() => applyTteScript());
    return _noBlobChain;
}

const TTE_SCRIPT_ID = 'afp-tte';

/** tte.js for the hosts in afp_csp_tte — the noblob.js dance with a different key. */
async function applyTteScript() {
    try {
        const matches = afpCspScopePatterns(await loadCspTte());
        const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [TTE_SCRIPT_ID] });
        const registered = !!(existing && existing.length);
        if (!matches.length) {
            if (registered) await chrome.scripting.unregisterContentScripts({ ids: [TTE_SCRIPT_ID] });
            return;
        }
        const spec = {
            id: TTE_SCRIPT_ID,
            js: ['tte.js'],
            matches,
            runAt: 'document_start',
            world: 'ISOLATED',
            allFrames: true,
            // [FIX csp-restrictions-learned-per-route] false, not true: Chrome refuses a
            // path pattern with match_origin_as_fallback ("The path component ... must be
            // '*'"), and the per-route patterns carry paths. Nothing is lost — a blank or
            // srcdoc frame reads the flag its top document wrote into the shared
            // sessionStorage, tagged with the top's timeOrigin and route.
            matchOriginAsFallback: false,
            persistAcrossSessions: true
        };
        if (registered) {
            await chrome.scripting.updateContentScripts([spec]);
        } else {
            try {
                await chrome.scripting.registerContentScripts([spec]);
            } catch (eDup) {
                if (!/Duplicate script ID/i.test(eDup && eDup.message)) throw eDup;
                await chrome.scripting.updateContentScripts([spec]);
            }
        }
    } catch (e) { console.warn('[AFP] applyTteScript:', e && e.message); }
}

/** Same registration dance as the other two — see applyRtcOffScript for the why. */
async function applyNoBlobScript() {
    try {
        const matches = afpCspScopePatterns(await loadCspNoBlob());
        const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [NOBLOB_SCRIPT_ID] });
        const registered = !!(existing && existing.length);
        if (!matches.length) {
            if (registered) await chrome.scripting.unregisterContentScripts({ ids: [NOBLOB_SCRIPT_ID] });
            return;
        }
        const spec = {
            id: NOBLOB_SCRIPT_ID,
            js: ['noblob.js'],
            matches,
            runAt: 'document_start',
            // ISOLATED, unlike its two siblings. They publish into the page's own realm
            // because what they carry is read there; this one only writes a sessionStorage
            // key, and sessionStorage is the document's — shared by both worlds — so the
            // page gains no new script of ours for the sake of one setItem.
            world: 'ISOLATED',
            allFrames: true,
            // [FIX csp-restrictions-learned-per-route] false, not true: Chrome refuses a
            // path pattern with match_origin_as_fallback ("The path component ... must be
            // '*'"), and the per-route patterns carry paths. Nothing is lost — a blank or
            // srcdoc frame reads the flag its top document wrote into the shared
            // sessionStorage, tagged with the top's timeOrigin and route.
            matchOriginAsFallback: false,
            persistAcrossSessions: true
        };
        if (registered) {
            await chrome.scripting.updateContentScripts([spec]);
        } else {
            try {
                await chrome.scripting.registerContentScripts([spec]);
            } catch (eDup) {
                if (!/Duplicate script ID/i.test(eDup && eDup.message)) throw eDup;
                await chrome.scripting.updateContentScripts([spec]);
            }
        }
    } catch (e) {
        console.warn('[AFP] updateNoBlobScript:', e && e.message);
    }
}

function updateRtcOffScript() {
    _rtcOffChain = _rtcOffChain.catch(() => {}).then(() => applyRtcOffScript());
    return _rtcOffChain;
}

async function applyRtcOffScript() {
    try {
        const matches = rtcOffMatches(await getWebrtcExceptions());
        const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [RTC_OFF_SCRIPT_ID] });
        const registered = !!(existing && existing.length);
        // No exceptions: the script must go away entirely. A registration with a stale
        // match list is the shape of [FIX header-vs-js-platform-version-drift] — a ghost
        // producer from an older state, still answering after the state that made it left.
        if (!matches.length) {
            if (registered) await chrome.scripting.unregisterContentScripts({ ids: [RTC_OFF_SCRIPT_ID] });
            return;
        }
        const spec = {
            id: RTC_OFF_SCRIPT_ID,
            js: ['rtc-off.js'],
            matches,
            runAt: 'document_start',
            world: 'MAIN',
            allFrames: true,
            matchOriginAsFallback: true,
            persistAcrossSessions: true
        };
        if (registered) {
            await chrome.scripting.updateContentScripts([spec]);
        } else {
            try {
                await chrome.scripting.registerContentScripts([spec]);
            } catch (eDup) {
                if (!/Duplicate script ID/i.test(eDup && eDup.message)) throw eDup;
                await chrome.scripting.updateContentScripts([spec]);
            }
        }
    } catch (e) {
        console.warn('[AFP] updateRtcOffScript:', e && e.message);
    }
}

async function injectProfile(tabId) {
    try {
        const profile = await getCachedProfile();
        let webrtcProtected = true;
        let swBlocked = false;
        let host = '';
        try {
            const tab = await chrome.tabs.get(tabId);
            host = new URL(tab.url).hostname;
            const exceptions = await getWebrtcExceptions();
            webrtcProtected = !afpHostMatches(exceptions, host);
            swBlocked = afpHostMatches(await getSwBlockedHosts(), host);
        } catch(e) { /* не удалось получить host — оставляем защиту включённой */ }

        // Per-domain seed: same browser identity family, different canvas/audio per site
        const masterSeed = (typeof profile.noiseSeed === 'number') ? profile.noiseSeed >>> 0 : 0;
        const domainSeed = host ? deriveDomainSeed(masterSeed, host) : masterSeed;
        // [FIX masterSeed-shipped-to-the-page] The injected profile crosses into the page
        // realm, so everything on it is one interception away (it used to be worse: it
        // was written straight into sessionStorage['v.ui.s'] for anyone to read — see
        // [FIX profile-readable-by-any-page] in mw/mw-core.js). Alongside the correctly
        // domain-scoped noiseSeed it also carried masterSeed — the global
        // seed from chrome.storage.local, identical on every site and across browser
        // restarts — plus seedDomain. Neither is read by anything: not by mw/*.js, not by
        // background.js itself, not by any harness (the only hit is one comment in
        // dev-creepcanvashash.html). So the per-domain derivation right above, and the
        // matching derivation in storage-bridge.js, were both undone by handing the page
        // the master they exist to hide — a ready-made cross-site identifier, with zero
        // consumer to justify it. Same shape as [FIX afp-global-leak] in
        // mw/mw-canvas-audio.js: a value written for nobody, removed entirely.
        const profileWithFlags = {
            ...profile,
            webrtcProtected,
            swBlocked,
            noiseSeed: domainSeed
        };

        // [FIX inject-all-frames] Profile must reach same-origin iframes too. ui:state
        // only fires on the frame's own document, so allFrames is what makes every
        // accessible frame get it — and since the profile stopped being written to
        // origin-shared sessionStorage ([FIX profile-readable-by-any-page], see
        // mw/mw-core.js) this is now the ONLY thing that reaches a child frame at all.
        await chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: true },
            world: 'MAIN',
            func: (p, packedFeatures) => {
                try {
                    // Legacy carriers: an older build of the extension may still have
                    // written the profile into any of these before the upgrade.
                    try { sessionStorage.removeItem('v.ui.s'); } catch (eRm0) {}
                    try { sessionStorage.removeItem('__afp_last_profile__'); } catch (eRm) {}
                    try { sessionStorage.removeItem('afp_mode'); sessionStorage.removeItem('afp_st'); } catch (eRm2) {}
                    // [FIX default-config-still-left-two-keys] Written only when they are
                    // not the default; removed otherwise. A clean Chrome has an EMPTY
                    // sessionStorage on a fresh origin (measured), so a key that merely
                    // repeats the default buys nothing and costs a one-line detector.
                    // Both decisions are taken in the service worker — this function is
                    // serialised into the page and cannot see defaults.js — and arrive as
                    // arguments: `packedFeatures` is null when it equals the default pack.
                    // Third writer of the same pair, alongside storage-bridge.js and
                    // mw-core's ui:state listener, on the same principle as before:
                    // whichever path reaches the tab first should be enough.
                    if ((p && p.mode) === 'stealth') sessionStorage.setItem('v.ui.m', 'stealth');
                    else sessionStorage.removeItem('v.ui.m');
                    if (packedFeatures) sessionStorage.setItem('v.ui.f', packedFeatures);
                    else sessionStorage.removeItem('v.ui.f');
                    // [FIX seed-was-a-named-page-readable-key] `afp_noise_seed_fallback`
                    // was written here too. It is gone from all three writers: the key
                    // named the extension and its value was the per-domain canvas seed,
                    // which makes the positional noise analytically invertible. The seed
                    // reaches every scope through dyn/ns/<nibble>.js at document_start now
                    // — earlier than this inject, and stored nowhere. See the long note in
                    // storage-bridge.js and dyn/boot.js.
                    // [FIX bridge-attributes-were-an-extension-detector] tz/lc/md are no
                    // longer written to the DOM — a clean browser has no attributes on
                    // <html>, and these were read only at document_start, long before this
                    // inject runs. The profile itself reaches the page through ui:state.
                } catch (e) {}
                try {
                    document.dispatchEvent(new CustomEvent('ui:state', { detail: p }));
                } catch (e2) {}
            },
            // null rather than the string when the flags ARE the defaults — see the
            // removeItem branch above and afpPersistSelection in defaults.js.
            args: [profileWithFlags, afpPackedIfNotDefault(profile.features)]
        });
    } catch(e) { if (!isErrorPageMsg(e.message)) console.warn('[AFP] injectProfile:', e.message); }
}

// Сайты где WASM в MAIN world не инжектируем:
// - жёсткий CSP может блокировать blob-воркеры созданные Emscripten
// - логин-страницы не нуждаются в fingerprint protection
//
// [CLEANUP] Раньше дублировался с skipHosts в wasm-loader.js (ISOLATED world,
// теперь удалён из манифеста как мёртвый код — см. #gpu-desync/loadWasmToMain).
// Этот список — теперь единственный источник правды для WASM-исключений.
const WASM_SKIP_HOSTS = [
    'google.com', 'google.ru', 'google.ee',
    'gmail.com', 'mail.google.com', 'drive.google.com',
    'docs.google.com', 'accounts.google.com', 'myaccount.google.com',
    'battle.net', 'blizzard.com', 'bnet.com',
];

function isWasmEligibleUrl(url) {
    if (!url?.startsWith('http')) return false;
    try {
        const host = new URL(url).hostname;
        return !WASM_SKIP_HOSTS.some(h => host === h || host.endsWith('.' + h));
    } catch { return false; }
}

function isInjectableUrl(url) {
    return url?.startsWith('http://') || url?.startsWith('https://');
}

// [FIX #error-page-inject] Chrome бросает "Frame with ID 0 is showing error page"
// когда scripting.executeScript вызывается на таб с ошибкой загрузки (net::ERR_*,
// chrome-error://, пустая вкладка в процессе загрузки). isInjectableUrl проверял
// только протокол URL, но не статус таба — URL может быть http, а страница при этом
// уже показывать ошибку или ещё не завершить загрузку.
// [FIX #isTabInjectable-unused] Раньше эта проверка (включая chrome-error:// фильтр)
// была оформлена как отдельная async-функция с повторным chrome.tabs.get(tabId) —
// но ни разу не вызывалась, вместо неё по всему файлу был скопирован укороченный
// инлайн-паттерн БЕЗ chrome-error:// фильтра. Теперь это синхронная проверка уже
// полученного tab-объекта — используется во всех местах вместо дублированного инлайна,
// не требует лишнего API-вызова, и везде получает chrome-error:// фильтр.
function isTabInjectable(tab) {
    return !!tab &&
        isInjectableUrl(tab.url) &&
        tab.status === 'complete' &&
        !tab.url?.startsWith('chrome-error://') &&
        !tab.discarded;
}

async function injectProfileOnAllTabs() {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (isTabInjectable(tab)) {
            await injectProfile(tab.id);
            setTimeout(() => loadWasmToMain(tab.id), DELAY_STARTUP_WASM);
        }
    }
}

// ============================================================
// ХОЛОДНЫЙ СТАРТ — dyn/ boot script
// ============================================================
//
// injectProfile выше приходит на tabs.onUpdated 'complete' + 300ms. Для уже открытой
// вкладки этого достаточно, для СВЕЖЕЙ — нет: sessionStorage у неё пуст, и
// profile-injector.js на document_start собирает нейтральную заглушку (laptop_mid /
// 1920x1080 / 8c / Iris Xe / America/New_York). Замер на реальном расширении: страница,
// читающая navigator.hardwareConcurrency первым инлайн-скриптом, видит 8 ядер на новой
// вкладке и 16 после F5 — один и тот же посетитель, две машины.
//
// Синхронного способа прочитать состояние расширения из content script в MV3 нет:
// chrome.storage.* асинхронен, а пуш из service worker (webNavigation.onCommitted +
// executeScript с injectImmediately) измерен и проигрывает — рендерер не ждёт браузерный
// процесс. Успевает только content script, у которого данные уже лежат в загружаемом
// файле. Поэтому выбор записан именами файлов: dyn/dev/<profileId>.js, dyn/cc/<CC>.js,
// dyn/mode/<mode>.js — их генерирует tools/gen-dyn.mjs из тех же таблиц, из которых
// buildProfile собирает настоящий профиль. Порядок внутри одной регистрации
// гарантирован, поэтому dyn/boot.js идёт последним и собирает всё вместе.
const BOOT_SCRIPT_ID = 'afp-boot';

// Единственное место, где список id профилей продублирован из popup.js PROFILES:
// background.js не загружает popup.js, а регистрировать несуществующий файл нельзя —
// registerContentScripts на это бросает. Совпадение проверяет test/parity-static.mjs.
const BOOT_DEVICE_IDS = ['laptop_low', 'laptop_mid', 'pc_gaming', 'pc_power', 'laptop_125', 'laptop_150', 'laptop_1610', 'host'];

// Вызовов четыре — верхний уровень, onInstalled/onStartup, storage.onChanged и
// applyToCurrentTab — и первые два стартуют одновременно на свежей установке. Оба
// видели пустой getRegisteredContentScripts и оба звали registerContentScripts, второй
// падал с "Duplicate script ID" (измерено). Само по себе это переживалось — один вызов
// всё же регистрировал скрипт, — но при смене профиля проиграть мог как раз тот вызов,
// который нёс НОВЫЙ выбор, и вкладка осталась бы на старом. Очередь делает порядок
// вызовов порядком записей: последний вызвавший выигрывает.
let _bootScriptChain = Promise.resolve();
// [FIX cold-start-gpu-was-the-wrong-card] The stored profile record names a GPU by KEY;
// GPU_DATA, which turns that key into ANGLE strings, WebGPU fields and numeric limits,
// lives only here. dyn/boot.js ships the resolved values, but dynamic registrations are
// cleared when an unpacked extension is reinstalled at browser start — so the first page
// of a restarted session had every field of the selected machine except its graphics card,
// and reported a 4K sixteen-core box with integrated Intel graphics (measured).
//
// The answer is resolved once, here, where the table is, and stored beside the record.
// storage-bridge.js forwards it like any other stored field; nothing duplicates the table.
const PROFILE_GL_KEY = 'afp_profile_gl';

async function syncProfileGl() {
    try {
        const cached = await chrome.storage.local.get([PROFILE_DATA_KEY, PROFILE_KEY]);
        const rec = cached[PROFILE_DATA_KEY] || DEFAULT_PROFILE;
        // [FIX host-mode] The measured record carries its own graphics fields.
        const gpu = afpIsHostRecord(rec, cached[PROFILE_KEY])
            ? afpHostGpu(rec)
            : (GPU_DATA[rec && rec.gpu] || GPU_DATA['intel_iris']);
        if (!gpu) return;
        const wg = gpu.webgpu || {};
        await chrome.storage.local.set({
            [PROFILE_GL_KEY]: {
                glVendor: gpu.unmaskedVendor,
                glRenderer: gpu.unmaskedRenderer,
                glParams: gpu.webglParams || {},
                glMaxAniso: (typeof gpu.webglMaxAnisotropy === 'number') ? gpu.webglMaxAnisotropy : 16,
                gpuVendor: wg.vendor || '',
                gpuArch: typeof wg.architecture === 'string' ? wg.architecture : '',
                gpuDevice: typeof wg.device === 'string' ? wg.device : '',
                gpuDesc: typeof wg.description === 'string' ? wg.description : '',
                // Travels with the card, like the limits — see hwDecode on GPU_DATA.
                av1: !(gpu.hwDecode && gpu.hwDecode.av1 === false)
            }
        });
    } catch (e) { console.warn('[AFP] syncProfileGl:', e && e.message); }
}

function registerBootScript() {
    _bootScriptChain = _bootScriptChain
        .catch(function() {})
        .then(function() { return applyBootScript(); });
    return _bootScriptChain;
}

async function applyBootScript() {
    try {
        const st = await chrome.storage.local.get([PROFILE_KEY, STORAGE_KEY, 'afp_mode', NOISE_SEED_KEY]);
        const devId = BOOT_DEVICE_IDS.indexOf(st[PROFILE_KEY]) !== -1 ? st[PROFILE_KEY] : 'laptop_mid';
        const cc = COUNTRY_DATA[st[STORAGE_KEY]] ? st[STORAGE_KEY] : 'US';
        const mode = st['afp_mode'] === 'stealth' ? 'stealth' : 'normal';
        // [FIX cold-start-platform-version] platformVersion следует за СЕМЕЙСТВОМ хоста,
        // а не за выбором пользователя, поэтому это отдельное измерение на два значения.
        // Без него холодный старт брал литерал '10.0.0' из profile-injector.js, пока DNR
        // уже слал настоящий бакет: измерено на Windows 11,
        // navigator.userAgentData.getHighEntropyValues() отвечал 10.0.0 первые ~300 мс и
        // 15.0.0 после, при sec-ch-ua-platform-version="15.0.0" во всех запросах. Страница,
        // читающая client hints рано, видела JS-слой с Windows 10 под Windows 11-заголовком.
        const pv = (await afpPlatformVersion()) === WIN11_PLATFORM_VERSION ? 'win11' : 'win10';
        // [FIX seed-was-a-named-page-readable-key] The master noise seed, spelled as eight
        // file names. It used to reach the page through sessionStorage under a key that
        // named the extension and held the seed itself — which makes the positional canvas
        // noise analytically invertible. Nothing is stored now: these files put the number
        // in a MAIN-world document_start content script, which lands before the page's
        // first line and before the async storage read that used to carry it.
        // dyn/seedlib.js is the generated copy of seed-lib.js, so the derivation boot.js
        // runs is the same one background.js and storage-bridge.js run.
        // An install with no seed yet registers neither: dyn/boot.js publishes no seed, and
        // mw-core falls back exactly as it did before, rather than to a wrong number.
        // [FIX repeated-nibble-collapsed-the-seed] The POSITION is part of the file name.
        // With one file per digit, a seed whose hex form repeats a digit named the same path
        // twice in this array and Chrome ran it once — seven digits arrived instead of
        // eight, boot.js rejected the marker, and the page fell back to the provisional host
        // hash without anything looking wrong. Measured: 90e31a5c (all digits distinct) gave
        // a stable canvas hash, 178f44ad (a repeated '4') flipped in every tab. Only ~12% of
        // seeds have eight distinct hex digits.
        const nsFiles = (typeof st[NOISE_SEED_KEY] === 'number' && isFinite(st[NOISE_SEED_KEY]))
            ? ((st[NOISE_SEED_KEY] >>> 0).toString(16).padStart(8, '0').split('')
                .map(function (c, i) { return `dyn/ns/${i}${c}.js`; }).concat(['dyn/seedlib.js']))
            : [];
        const spec = {
            id: BOOT_SCRIPT_ID,
            js: [`dyn/dev/${devId}.js`, `dyn/cc/${cc}.js`, `dyn/mode/${mode}.js`, `dyn/pv/${pv}.js`]
                .concat(nsFiles).concat(['dyn/boot.js']),
            matches: ['*://*/*'],
            runAt: 'document_start',
            world: 'MAIN',
            allFrames: true,
            // [FIX opaque-frames-got-the-stub] The manifest entries carry
            // match_origin_as_fallback so they reach data:/blob: frames; without the same
            // flag here the generated selection files did not, so those frames ran the
            // scripts but never saw a data-v-hw attribute and profile-injector fell back
            // to its neutral laptop_mid / America/New_York / Iris Xe stub. Measured with
            // pc_power/DE selected: the top frame said Europe/Berlin and an RTX 3070 while
            // a blob: frame in the same page said America/New_York and an Iris Xe — one
            // page, two machines, which is worse than the frame being uncovered.
            matchOriginAsFallback: true,
            // Заявленное поведение — пережить перезапуск. Измерено, что на распакованном
            // расширении этого НЕ происходит: при старте браузера оно переустанавливается,
            // а установка сбрасывает динамические регистрации, и сразу после подъёма
            // service worker список пуст. Поэтому флаг оставлен (для нормальной установки
            // он работает), но полагаться на него нельзя — страховкой служит вызов
            // registerBootScript() на верхнем уровне, см. ниже.
            persistAcrossSessions: true
        };
        const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [BOOT_SCRIPT_ID] });
        if (existing && existing.length) {
            await chrome.scripting.updateContentScripts([spec]);
        } else {
            try {
                await chrome.scripting.registerContentScripts([spec]);
            } catch (eDup) {
                // Регистрация могла появиться между get и register (например, восстановлена
                // Chrome из прошлой сессии). Тогда это update, а не ошибка.
                if (!/Duplicate script ID/i.test(eDup && eDup.message)) throw eDup;
                await chrome.scripting.updateContentScripts([spec]);
            }
        }
    } catch (e) {
        console.warn('[AFP] registerBootScript:', e && e.message);
    }
}

// ============================================================
// [CLEANUP] injectIsolatedScripts удалена.
// Раньше инжектировала protect.js+wasm-loader.js в world: 'ISOLATED'
// (как и объявлено в манифесте для этих файлов). Но window.__w0,
// который создавали эти файлы, живёт в ISOLATED-контексте — отдельном,
// невидимом для world: 'MAIN', где работает mw/*.js (он и патчит
// CanvasRenderingContext2D/AudioContext/т.д. — весь реальный фингерпринт).
// mw/*.js обращается к window.__w0, который на самом деле
// создаётся ниже, в loadWasmToMain() через executeScript с world: 'MAIN' —
// это единственный путь, который реально влияет на фингерпринт.
// protect.js/wasm-loader.js и их content_scripts-запись в манифесте
// убраны как мёртвый код (см. manifest.json).
// ============================================================

// [FIX #error-page-inject] Chrome бросает "Frame with ID 0 is showing error page"
// даже когда tab.status==='complete' — статус complete не означает injectable.
// Это не баг расширения, а штатное поведение: Chrome запускает onInstalled/onStartup
// пока часть вкладок ещё показывает ошибки (timeout, dns failure, etc.).
// Решение: фильтруем эту конкретную ошибку молча (не warn), остальные — логируем.
function isErrorPageMsg(msg) {
    return msg && (
        msg.includes('error page') ||
        msg.includes('cannot be scripted') ||
        msg.includes('Cannot access') ||
        msg.includes('No tab with id')
    );
}

// ============================================================
// СОБЫТИЯ
// ============================================================

// [FIX duplicate-onstartup-listeners] Раньше здесь стояло ДВА отдельных
// chrome.runtime.onStartup.addListener — один инжектил профиль во все вкладки
// (читая chrome.storage.local "как есть"), другой вызывал initDefaults()
// (который может ЗАПИСАТЬ дефолты в chrome.storage.local, если их ещё нет).
// Chrome вызывает несколько listener'ов одного события в порядке регистрации —
// значит инжект (объявленный первым) гарантированно выполнялся бы раньше
// initDefaults (объявленного вторым), а не после. На практике это работало
// только благодаря случайной разнице таймингов (у инжекта был setTimeout на
// DELAY_STARTUP_BOOT, у initDefaults — нет), а не благодаря явному порядку
// зависимостей. Объединено в один listener: initDefaults() и обновление правил
// гарантированно завершаются ДО инжекта профиля — порядок теперь в коде, а не
// в разнице задержек.
chrome.runtime.onStartup.addListener(async () => {
    await initDefaults();
    await updateDynamicLanguageRule();
    afpRebuildSdTabs().catch(function () {});
    await updateDynamicDeviceRule();
    await registerBootScript();
    await syncProfileGl();
    await updateRtcOffScript();
    await updateSwOffScript();
    await updateNoBlobScript();
    setTimeout(async () => {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (isTabInjectable(tab)) {
                injectProfile(tab.id);
                setTimeout(() => loadWasmToMain(tab.id), DELAY_STARTUP_WASM);
            }
        }
    }, DELAY_STARTUP_BOOT);
});

chrome.runtime.onInstalled.addListener(async () => {
    await initDefaults();
    await updateDynamicLanguageRule();
    afpRebuildSdTabs().catch(function () {});
    await updateDynamicDeviceRule();
    await registerBootScript();
    await syncProfileGl();
    await updateRtcOffScript();
    await updateSwOffScript();
    await updateNoBlobScript();
    setTimeout(injectProfileOnAllTabs, DELAY_STARTUP_BOOT);
});


// [FIX cold-start-machine] Не только из onStartup/onInstalled, а на КАЖДОМ подъёме
// service worker. Измерено: после перезапуска браузера getRegisteredContentScripts()
// возвращает пустой список, несмотря на persistAcrossSessions — распакованное
// расширение переустанавливается при старте, а установка сбрасывает динамические
// регистрации. Вызов на верхнем уровне поднимает её так рано, как service worker
// вообще может что-то сделать. Идемпотентен: сравнивает и переписывает ту же запись.
//
// Остаточное окно закрыть из JS нельзя: если Chrome начнёт навигацию раньше, чем
// завершится этот await, страница получит заглушку из profile-injector.js — как до
// фикса, но только для самых первых навигаций сессии, а не для каждой новой вкладки.
registerBootScript();
syncProfileGl();
// Same reason as the line above: an unpacked extension is reinstalled on browser start and
// the install clears dynamic registrations, so the marker has to be re-asserted on every
// service worker wake, not only on the two lifecycle events.
updateRtcOffScript();
updateSwOffScript();
updateNoBlobScript();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // profile-injector.js и mw/*.js инжектирует манифест (content_scripts, document_start, world: MAIN).
    // loadWasmToMain нужен т.к. MAIN world не может получить WASM напрямую из
    // манифеста (fetch/instantiate WASM в MAIN-контексте страницы требует
    // executeScript — content_scripts не поддерживают инжект .wasm файлов).
    // [FIX #error-page-inject] Ждём 'complete' а не 'loading': к этому моменту
    // Chrome уже знает показывает ли таб ошибку. При 'loading' executeScript
    // падает с "Frame is showing error page" если страница не загрузилась.
    if (changeInfo.status === 'complete' && isTabInjectable(tab)) {
        setTimeout(() => injectProfile(tabId), DELAY_INJECT_PROFILE);
        setTimeout(() => loadWasmToMain(tabId), DELAY_LOAD_WASM);
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        // profile-injector.js/mw/*.js уже покрыты манифестом (document_start,
        // world: MAIN) — повторный инжект здесь не нужен, страница уже загружена.
        if (isTabInjectable(tab)) {
            setTimeout(() => injectProfile(activeInfo.tabId), DELAY_ACTIVATED_PROFILE);
            setTimeout(() => loadWasmToMain(activeInfo.tabId), DELAY_ACTIVATED_WASM);
        }
    } catch(e) { /* таб закрыт */ }
});

// ============================================================
// ХРАНИЛИЩЕ
// ============================================================

// Пишет afp_resolved_timezone + afp_resolved_locale — единый источник для storage-bridge.
async function syncResolvedCountryFields(countryCode) {
    const code = countryCode || 'US';
    const country = COUNTRY_DATA[code] || COUNTRY_DATA['US'];
    await chrome.storage.local.set({
        'afp_resolved_timezone': country.tz,
        'afp_resolved_locale': country.loc
    });
    return country;
}

// ============================================================
// GENERIC FONT PINNING
// ============================================================
// Two Windows machines, SAME browser (Edge 151), extension off, measured with
// tools/collect-metrics.html v5: of 175 fields only 11 differed, and three of them were one
// fact — the CSS generic `monospace` resolves to Courier New on one box and Consolas on the
// other, while BOTH machines measure both faces identically when they are named directly.
// So it is not font rendering and not font availability: it is the browser's own
// fixed-width font SETTING, and it survives every profile change.
//
// It is pinned here rather than in mw/ because a wrapper could only lie about the
// measurement. Fingerprint Pro reads this through DOM layout (a span with
// font-family:monospace, measured with getBoundingClientRect), not through canvas
// measureText, so normalising the canvas path would have missed the actual read — and
// lying in one path while the other renders differently is the self-contradiction this
// codebase keeps refusing. chrome.fontSettings changes what the browser ACTUALLY uses, so
// DOM and canvas agree by construction and there is no wrapper to detect.
//
// Only `fixed` is pinned. The other generics (standard, serif, sansserif, cursive,
// fantasy) were byte-identical on both machines, and this project's rule is that nothing
// gets touched until two machines disagree about it. They stay candidates for a third
// machine, not for a guess.
//
// Consolas rather than Courier New because it is Chrome's and Edge's own Windows default
// for fixed-width, i.e. the larger crowd, and it ships with every Windows since Vista.
// Font settings set through this API are extension-scoped: Chrome reverts them when the
// extension is disabled or removed.
const AFP_PINNED_FIXED_FONT = 'Consolas';

async function afpApplyFontPinning(enabled) {
    try {
        if (!chrome.fontSettings) return;   // permission absent or older Chrome
        // [FIX host-mode] The pin is a claim about the machine's default monospace face,
        // and host mode claims nothing about the machine: the setting is handed back.
        try {
            const st = await chrome.storage.local.get([PROFILE_DATA_KEY, PROFILE_KEY]);
            if (afpIsHostRecord(st[PROFILE_DATA_KEY], st[PROFILE_KEY])) enabled = false;
        } catch (eSt) {}
        if (enabled) {
            await chrome.fontSettings.setFont({ genericFamily: 'fixed', fontId: AFP_PINNED_FIXED_FONT });
        } else {
            // Unticking the `fonts` switch has to hand the setting back, not merely stop
            // re-applying it — otherwise the option claims control it does not deliver,
            // which is the same complaint the measureText section already carries.
            await chrome.fontSettings.clearFont({ genericFamily: 'fixed' });
        }
    } catch (e) {}
}

async function initDefaults() {
    const cached = await chrome.storage.local.get([
        PROFILE_KEY, STORAGE_KEY, 'afp_resolved_timezone', 'afp_resolved_locale', 'afp_mode',
        'afp_features', NOISE_SEED_KEY, AFP_SCHEMA_KEY
    ]);
    // Schema migrations FIRST: everything below reads these same values, so converting
    // afterwards would let one startup act on a shape that is about to be rewritten. The
    // decision itself is afpMigrateStorage in defaults.js — a pure function, so it is
    // covered by tests rather than only reachable from a live service worker.
    try {
        const moved = afpMigrateStorage(cached);
        if (moved) {
            await chrome.storage.local.set(moved);
            Object.assign(cached, moved);
        }
    } catch (eMig) { console.warn('[AFP] schema migration:', eMig && eMig.message); }
    if (!cached[PROFILE_KEY]) {
        await chrome.storage.local.set({ [PROFILE_KEY]: 'laptop_mid', [PROFILE_DATA_KEY]: DEFAULT_PROFILE });
    }
    if (!cached[STORAGE_KEY]) {
        await chrome.storage.local.set({ [STORAGE_KEY]: 'US' });
    }
    if (!cached['afp_mode']) {
        await chrome.storage.local.set({ 'afp_mode': 'normal' });
    }
    // [FIX maximum-mode-migrate] The `maximum`/`max`/`hidden` conversion that stood here is
    // now the v0->v1 step of afpMigrateStorage above — same conversion, but recorded as done
    // instead of re-evaluated on every startup forever.
    if (!cached['afp_features']) {
        await chrome.storage.local.set({
            afp_features: afpCloneFeatures()
        });
    }
    // Applied at startup as well as on change: the setting lives in the browser, not in a
    // content script, so nothing re-establishes it per navigation.
    await afpApplyFontPinning(
        (cached['afp_features'] || afpCloneFeatures()).fonts !== false);
    // [FIX early-noise-seed] Seed должен быть в storage до первой навигации,
    // иначе bridge/WASM/JS-fallback могут разойтись на первом визите.
    //
    // [FIX the-seed-was-minted-in-three-places] This used to test `cached`, the snapshot
    // taken at the top of this function — that is, BEFORE the default profile was written a
    // few lines above, and therefore before the onChanged listener had its chance to reseed
    // off that write. It read stale by construction and minted a second seed on every fresh
    // install. afpEnsureNoiseSeed re-reads and mints at most once; see its header.
    await afpEnsureNoiseSeed();
    const code = cached[STORAGE_KEY] || 'US';
    const country = COUNTRY_DATA[code] || COUNTRY_DATA['US'];
    // Всегда синхронизируем пару TZ+locale (баг lang=en-US + tz=Tallinn)
    if (cached['afp_resolved_timezone'] !== country.tz ||
        cached['afp_resolved_locale'] !== country.loc) {
        await syncResolvedCountryFields(code);
    }
}

// initDefaults() и обновление правил теперь выполняются в единственном
// onStartup listener выше (см. [FIX duplicate-onstartup-listeners]).

// ============================================================
// ОБРАБОТЧИКИ СООБЩЕНИЙ
// ============================================================

let _cachedProfile = null;
let _buildingProfile = null;
let _profileGeneration = 0;

/**
 * [FIX apply-could-reinject-the-pre-change-profile] Invalidating the cache means all
 * THREE of these, and the message handler for 'applyToCurrentTab' only cleared
 * _cachedProfile. Two things went wrong when a build happened to be in flight at that
 * moment — which is the normal case, since the popup writes to storage and immediately
 * sends the message, and the storage.onChanged listener starts a rebuild of its own:
 *   1) getCachedProfile() short-circuits on _buildingProfile before it ever looks at
 *      storage, so the inject that followed shipped the PRE-change profile;
 *   2) _profileGeneration was not bumped, so when that stale build resolved it happily
 *      assigned itself to _cachedProfile and every later tab got it too, until the next
 *      unrelated storage write.
 * The generation counter exists precisely to disown an in-flight build; bumping it is
 * what makes the resolve handler above skip its assignment. One helper now, used
 * everywhere, so the three lines cannot drift apart again.
 */
function invalidateProfileCache() {
    _profileGeneration++;
    _cachedProfile = null;
    _buildingProfile = null;
}

async function getCachedProfile() {
    if (_cachedProfile) return _cachedProfile;
    if (_buildingProfile) return _buildingProfile;
    const myGen = ++_profileGeneration;
    _buildingProfile = buildProfile().then(function(p) {
        if (_profileGeneration === myGen) {
            _cachedProfile = p;
            _buildingProfile = null;
        }
        return p;
    }).catch(function(e) {
        if (_profileGeneration === myGen) {
            _buildingProfile = null;
        }
        throw e;
    });
    return _buildingProfile;
}

// [FIX storage-onchanged-area] Слушатель не проверял areaName — любая запись в
// chrome.storage.session/sync/managed с совпадающим именем ключа сбрасывала кэш
// профиля и дёргала реинжект всех вкладок. Расширение хранит всё в local.
// [FIX seed-change-keeps-stale-cache] NOISE_SEED_KEY не был в списке ключей,
// сбрасывающих _cachedProfile: после смены профиля устройства ниже пишется
// НОВЫЙ seed, но кэш собранного профиля (со старым seed) при этом не
// инвалидировался — injectProfileOnAllTabs через 150ms рассылал старый seed,
// а storage-bridge (ISOLATED) читал уже новый напрямую из storage. Два разных
// seed на одной странице — ровно тот класс расхождения, от которого защищается
// hard-lock в mw-core._getSessionSeed.
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes['afp_features']) {
        const f = changes['afp_features'].newValue;
        afpApplyFontPinning(!f || f.fonts !== false);
    }
    if (changes[PROFILE_KEY] || changes[PROFILE_DATA_KEY] || changes[STORAGE_KEY] ||
        changes['afp_mode'] || changes['afp_features'] || changes[NOISE_SEED_KEY]) {
        invalidateProfileCache();
        // [FIX header-claimed-windows-10-while-js-said-windows-11] The DNR rule carries a
        // SNAPSHOT of the profile (the platform-version claim), and it was refreshed from
        // only three places: onStartup, onInstalled, and a COUNTRY change. Any other way
        // the profile changed left the header describing the previous one, while every
        // page got the new profile immediately — the header and the JS drifting apart is
        // the one failure this file keeps saying it guards against.
        //
        // The country branch below re-runs it too, but only after syncResolvedCountryFields
        // so the rule sees the new locale; skipping it here keeps that ordering intact
        // instead of racing it.
        if (!changes[STORAGE_KEY]) {
            updateDynamicLanguageRule().catch(function () {});
        }
    }
    // Смена машины/страны/режима меняет НАБОР файлов, из которых собран холодный старт.
    // Без этого новая вкладка продолжала бы грузить предыдущий выбор до перезапуска.
    if (changes[PROFILE_KEY] || changes[STORAGE_KEY] || changes['afp_mode']) {
        registerBootScript();
    }
    // The resolved graphics fields follow the record they describe.
    if (changes[PROFILE_KEY] || changes[PROFILE_DATA_KEY]) {
        syncProfileGl();
        // [FIX host-mode] The font pin is decided per record as well as per switch: a
        // change into or out of host mode has to hand the setting back or re-apply it.
        chrome.storage.local.get(['afp_features']).then(function (st) {
            const f = st && st.afp_features;
            afpApplyFontPinning(!f || f.fonts !== false);
        }).catch(function () {});
    }
    // The document_start marker mirrors the exception list, so it follows the LIST rather
    // than the one code path that happens to edit it today. The toggle handler awaits its
    // own call for immediacy; this is what keeps every other writer — the options page's
    // Clear, a migration, a future one — from leaving the registration behind.
    if (changes[WEBRTC_EXCEPTIONS_KEY]) {
        updateRtcOffScript();
    }
    if (changes[SW_BLOCKED_KEY]) {
        updateSwOffScript();
    }
    // The CSP observer adds a host the moment it first sees the header, which is DURING
    // the load that is about to lose its worker. Re-registering here is what makes the
    // NEXT load of that host — and every other tab on it — arrive already knowing.
    // Either gate's host list moves the header rewrite, so both are watched here. Only
    // the blob list also drives a content script; the trusted-types one is read by
    // storage-bridge on the page side and by standDownHosts() here.
    // [FIX the-header-half-queued-behind-seven-rebuilds] The route rules first and on their own:
    // they are a route's header half and must not wait behind a full rebuild.
    if (changes[CSP_TT_KEY] || changes[CSP_NOBLOB_KEY]) afpSyncSdRouteRules().catch(function () {});
    if (changes[CSP_TT_KEY] && !changes[CSP_NOBLOB_KEY]) {
        updateDynamicLanguageRule().catch(function () {});
    }
    if (changes[CSP_NOBLOB_KEY]) {
        updateNoBlobScript();
        // The header rewrite is keyed off the same list — see standDownHosts().
        updateDynamicLanguageRule().catch(function () {});
    }
    // [FIX tte-flag-arrived-after-the-first-script] The trusted-types marker follows its list.
    if (changes[CSP_TTE_KEY] && !changes[CSP_NOBLOB_KEY]) {
        _cspTte = null;
        updateNoBlobScript();
    }
    // [FIX csp-rewrite-for-workers] The options page's Clear, or another writer.
    if (changes[CSP_REWRITE_KEY]) {
        _cspRewrite = null;
        applyCspRewriteRules().then(function () { return updateDynamicLanguageRule(); }).catch(function () {});
    }
    // [IMPROVE] Новый noiseSeed при смене профиля устройства —
    // иначе canvas/audio hash совпадает между «разными» машинами.
    //
    // [FIX the-seed-was-minted-in-three-places] CHANGED, not created. initDefaults writes the
    // default profile on a fresh install, and to this listener that write looked exactly like
    // the user picking a new machine — so a clean install reseeded here as well as in
    // initDefaults itself, twice, in an order nothing decided. `oldValue` is the exact
    // discriminator the API already hands over: absent on the first write of a key, present
    // on every later one. The reseed itself is right and stays; a new machine has to get new
    // noise or two "different" machines share a canvas hash.
    const profChanged = [PROFILE_KEY, PROFILE_DATA_KEY].some(
        (k) => changes[k] && changes[k].oldValue !== undefined);
    if (profChanged) {
        const newSeed = (Math.random() * 0xFFFFFFFF) >>> 0;
        chrome.storage.local.set({ [NOISE_SEED_KEY]: newSeed }).catch(function() {});
    }
    // [FIX lang+tz + variant-4] Смена страны → TZ + locale вместе + немедленный
    // реинжект. Раньше стоял setTimeout(..., 150): за эти 150 мс bridge уже
    // мог опубликовать новые tz/locale, а страница ещё держала
    // старый полный профиль → краткая рассинхронизация. Теперь ждём
    // syncResolvedCountryFields (чтобы getCachedProfile увидел свежие поля)
    // и сразу инжектим без искусственной задержки.
    if (changes[STORAGE_KEY]) {
        const code = changes[STORAGE_KEY].newValue || 'US';
        (async function() {
            try {
                await syncResolvedCountryFields(code);
                await updateDynamicLanguageRule();
                await injectProfileOnAllTabs();
            } catch (e) {
                console.warn('[AFP] country-change inject:', e && e.message);
            }
        })();
    }
    if (changes[PROFILE_DATA_KEY] || changes['afp_mode']) {
        // mode/profile → reinject (stealth patches apply on next document_start)
        // Небольшая задержка оставлена: storage write + cache invalidate должны
        // успеть завершиться до getCachedProfile внутри inject.
        setTimeout(function() { injectProfileOnAllTabs(); }, 50);
    }
    if (changes[PROFILE_DATA_KEY] || changes[STORAGE_KEY]) {
        updateDynamicDeviceRule();
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // [FIX a-refusal-we-passed-through-was-charged-to-us] storage-bridge.js, at
    // document_start: "did the headers of the document I run in enforce Trusted Types?"
    if (message.type === 'afpCspVerdict') {
        afpCspVerdictWhenSettled(sender).then(sendResponse, function () { sendResponse(null); });
        return true;
    }
    // [FIX a-meta-csp-was-never-learned] storage-bridge.js at DOMContentLoaded: the policies a
    // document declared in <meta> elements, which the header observer cannot see. The URL and
    // the tab are the SENDER's, never the message's.
    if (message.type === 'afpMetaCsp') {
        try {
            afpNoteMetaCsp(String((sender && sender.url) || ''), message.policies,
                sender && sender.tab ? sender.tab.id : -1, !!sender && sender.frameId === 0);
        } catch (eMeta) {}
        return false;
    }
    // audit.html: the same record for the top document of a tab it inspects.
    if (message.type === 'afpCspVerdictForTab') {
        sendResponse(afpCspVerdictFor({ tab: { id: Number(message.tabId) }, frameId: 0 }));
        return false;
    }
    // [FIX the-two-halves-were-only-checkable-in-CI] The stand-down has two deliveries and
    // they are not one mechanism: the MAIN-world bundle stops claiming a profile, and an
    // `allow` rule takes the origin out of every header rewrite. A page can see the first
    // — it is what navigator answers — and can never see the second, because no document
    // can read the headers its own request went out with.
    //
    // So the halves could only ever be compared from a suite, and the suite that does it
    // runs on a CI runner whose failure set on unchanged code ranges 0..12. One observation
    // of them diverging past the first visit could not be confirmed there and 20x CPU
    // throttling did not reproduce it here.
    //
    // This hands the second half to audit.html, which runs in the browser the user actually
    // browses with, against the sites they actually visit. Two booleans and the host they
    // are about: what the window decided, and whether this origin is out of the header
    // rewrite. Disagreement between them is the thing nothing could observe before.
    if (message.type === 'afpStandDownHalvesForHost') {
        const href = String(message.href || '');
        let host = '', seg = '';
        try {
            const u = new URL(href);
            host = u.hostname;
            seg = (u.pathname.split('/')[1] || '');
        } catch (eU) { host = ''; }
        standDownScopes().then(function (scopes) {
            const hosts = (scopes && scopes.hosts) || [];
            const routes = (scopes && scopes.routes) || [];
            const covers = function (h) { return host === h || host.endsWith('.' + h); };
            // BOTH shapes, because the exclusion has both: a host that stands down whole is
            // in `hosts`, and one that stands down on a single route is in `routes` with the
            // path segment. Reading only `hosts` reported "the headers still carry the
            // profile" for every per-route stand-down — measured against the audit suite's
            // own fixture, which learns a route.
            const byHost = hosts.some(covers);
            const byRoute = routes.some(function (r) { return covers(r.host) && r.seg === seg; });
            sendResponse({
                host: host, route: host + '/' + seg,
                headerExempt: byHost || byRoute,
                how: byHost ? 'host' : (byRoute ? 'route' : 'none'),
                hosts: hosts.length, routes: routes.length
            });
        }).catch(function () { sendResponse({ host: host, headerExempt: null }); });
        return true;
    }
    if (message.type === 'getFullConfig') {
        Promise.all([
            getCachedProfile(),
            chrome.storage.local.get(['afp_features', 'afp_mode', 'afp_noise_seed', 'afp_profile_id', 'afp_country_code'])
        ]).then(function(pair) {
            var p = pair[0] || {};
            var st = pair[1] || {};
            if (p && st.afp_noise_seed != null && p.noiseSeed == null) p.noiseSeed = st.afp_noise_seed;
            if (p && st.afp_profile_id && !p.profileId) p.profileId = st.afp_profile_id;
            if (p && st.afp_country_code && !p.countryCode) p.countryCode = st.afp_country_code;
            var features = (typeof afpMergeFeatures === 'function')
                ? afpMergeFeatures(st.afp_features)
                : (st.afp_features || null);
            sendResponse({
                profile: p,
                features: features,
                mode: st.afp_mode || 'normal'
            });
        }).catch(function(e) {
            sendResponse({ error: e.message });
        });
        return true;
    }
    if (message.type === 'applyToCurrentTab') {
        (async () => {
            try {
                // Storage has just changed under us; drop any in-flight build too,
                // see invalidateProfileCache.
                invalidateProfileCache();
                // [FIX cold-start-machine] Popup перезагружает активную вкладку сразу
                // после ответа на это сообщение. Регистрация boot-скрипта запускается
                // из storage.onChanged параллельно, и без этого await перезагрузка
                // могла успеть раньше — тогда первый document_start после Apply собрал
                // бы ПРЕДЫДУЩИЙ выбор. Повторный вызов идемпотентен.
                await registerBootScript();
                // [FIX #tz-other-sites] Применяем ко ВСЕМ вкладкам, не только активной —
                // иначе новая/другая вкладка остаётся с дефолтной America/New_York до F5.
                await injectProfileOnAllTabs();
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (isTabInjectable(tab)) {
                    sendResponse({ ok: true, url: tab.url });
                } else {
                    // Настройки сохранены и разосланы; активная вкладка просто не http
                    sendResponse({ ok: true, reason: 'no_http_tab' });
                }
            } catch(e) {
                sendResponse({ ok: false, reason: e.message });
            }
        })();
        return true;
    }
    if (message.type === 'getWebrtcStatus') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab?.url?.startsWith('http')) { sendResponse({ host: null, protected: true }); return; }
                const host = new URL(tab.url).hostname;
                const exceptions = await getWebrtcExceptions();
                const isException = exceptions.some(h => host === h || host.endsWith('.' + h));
                // `enabled` is the GLOBAL option toggle, and the popup needs it to tell the
                // truth: with the module switched off in the options page nothing is patched
                // on any host, while this per-site switch would still have been drawn ON.
                // Same class of promise-without-a-patch as the one the switch itself made
                // before [FIX per-site-switch-was-decided-before-the-flag-existed].
                const st = await chrome.storage.local.get(['afp_features']);
                const enabled = afpMergeFeatures(st.afp_features).webrtc !== false;
                sendResponse({ host, protected: !isException, enabled, exceptionCount: exceptions.length });
            } catch(e) { sendResponse({ host: null, protected: true, enabled: true, error: e.message }); }
        })();
        return true;
    }
    if (message.type === 'getSwStatus') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab?.url?.startsWith('http')) { sendResponse({ host: null, blocked: false }); return; }
                const host = new URL(tab.url).hostname;
                const list = await getSwBlockedHosts();
                sendResponse({ host, blocked: afpHostMatches(list, host), blockedCount: list.length });
            } catch (e) { sendResponse({ host: null, blocked: false, error: e.message }); }
        })();
        return true;
    }
    if (message.type === 'toggleSwForCurrentTab') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab?.url?.startsWith('http')) { sendResponse({ ok: false, reason: 'no_http_tab' }); return; }
                const host = new URL(tab.url).hostname;
                // [FIX the-switch-read-with-a-suffix-match-and-toggled-with-an-exact-one]
                // The same rule getSwStatus reads with — see afpHostListToggle in defaults.js.
                const r = afpHostListToggle(await getSwBlockedHosts(), host);
                await chrome.storage.local.set({ [SW_BLOCKED_KEY]: r.list });
                // The marker decides at document_start; the profile carries the same answer
                // for anything that asks later.
                await updateSwOffScript();
                await injectProfile(tab.id);
                sendResponse({ ok: true, host, blocked: r.covered });
            } catch (e) { sendResponse({ ok: false, reason: e.message }); }
        })();
        return true;
    }
    // [FIX csp-rewrite-for-workers] The per-site CSP switch — see afpRewriteCsp.
    if (message.type === 'getCspRewriteStatus') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab?.url?.startsWith('http')) { sendResponse({ host: null, on: false, needed: false }); return; }
                const host = new URL(tab.url).hostname;
                const map = await loadCspRewrite();
                // "Needed" = the two restrictions the rewrite lifts. TT enforcement alone
                // does not stop the wrapper (it wraps what the page passed as trusted).
                const lists = await Promise.all([loadCspNoBlob(), loadCspTt()]);
                const needed = lists.some(function (l) { return afpCspHostListed(l, host); });
                const on = Object.prototype.hasOwnProperty.call(map, host);
                sendResponse({ host, on, needed, learned: on && !!map[host], count: Object.keys(map).length });
            } catch (e) { sendResponse({ host: null, on: false, needed: false, error: e.message }); }
        })();
        return true;
    }
    if (message.type === 'toggleCspRewriteForCurrentTab') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab?.url?.startsWith('http')) { sendResponse({ ok: false, reason: 'no_http_tab' }); return; }
                const r = await afpToggleCspRewrite(tab);
                sendResponse({ ok: true, host: r.host, on: r.on, rewritten: r.rewritten, unneeded: r.unneeded });
            } catch (e) { sendResponse({ ok: false, reason: e.message }); }
        })();
        return true;
    }
    if (message.type === 'getCspRewriteList') {
        (async () => {
            try { sendResponse({ ok: true, hosts: Object.keys(await loadCspRewrite()) }); }
            catch (e) { sendResponse({ ok: false, hosts: [], reason: e.message }); }
        })();
        return true;
    }
    if (message.type === 'clearCspRewrite') {
        (async () => {
            try {
                _cspRewrite = {};
                await chrome.storage.local.set({ [CSP_REWRITE_KEY]: {} });
                await applyCspRewriteRules();
                await updateDynamicLanguageRule();
                sendResponse({ ok: true });
            } catch (e) { sendResponse({ ok: false, reason: e.message }); }
        })();
        return true;
    }
    // [FIX the-learned-lists-were-the-invisible-ones] The options page shows and clears three
    // per-site lists — the CSP rewrite, the service-worker block and the WebRTC exceptions —
    // and the user CHOSE every entry in all three with a switch. The six lists below are the
    // opposite: this extension writes them by itself, one entry per host (or route) whose CSP
    // has a shape worth remembering, as the user browses. They had no screen, no count and no
    // way to clear, they grow without a cap, and a profile change does not touch them — so a
    // user who switches identity keeps a record of where the previous one had been.
    //
    // That is exactly the defect [FIX the-off-state-was-invisible] named for the WebRTC
    // exception list ("per-site state whose off position looks like its on position"), and the
    // treatment there was this: show it, count it, let it be cleared. The learned lists never
    // got it, and they are the ones that fill up on their own.
    //
    // NOT cleared on a profile change, deliberately: what a site's CSP forbids has nothing to
    // do with which machine we claim, and forgetting it costs one page load per host to relearn
    // (noblob.js documents that residual). Clearing is the user's call, like the other three.
    if (message.type === 'getCspLearnedLists') {
        (async () => {
            try {
                const got = await chrome.storage.local.get(CSP_LEARNED_KEYS);
                const lists = {};
                CSP_LEARNED_KEYS.forEach(function (k) {
                    lists[k] = Array.isArray(got[k]) ? got[k] : [];
                });
                sendResponse({ ok: true, lists });
            } catch (e) { sendResponse({ ok: false, lists: {}, reason: e.message }); }
        })();
        return true;
    }
    if (message.type === 'clearCspLearnedLists') {
        (async () => {
            try {
                const patch = {};
                CSP_LEARNED_KEYS.forEach(function (k) { patch[k] = []; });
                await chrome.storage.local.set(patch);
                // Every memo that answers from these lists, or the worker keeps deciding from
                // what it read before the clear — the shape [FIX the-csp-observer-judged-from-
                // a-cache-that-had-not-loaded] is about.
                _cspNoBlob = null; _cspTt = null; _cspTte = null;
                _cspNc = null; _cspNs = null; _cspMixed = null;
                // The two marker scripts are REGISTERED from these lists, so a cleared list
                // that leaves them registered would keep answering for hosts nobody listed.
                await updateNoBlobScript();
                await applyTteScript();
                sendResponse({ ok: true });
            } catch (e) { sendResponse({ ok: false, reason: e.message }); }
        })();
        return true;
    }
    if (message.type === 'getSwBlockedList') {
        (async () => {
            try { sendResponse({ ok: true, hosts: await getSwBlockedHosts() }); }
            catch (e) { sendResponse({ ok: false, hosts: [], reason: e.message }); }
        })();
        return true;
    }
    if (message.type === 'clearSwBlocked') {
        (async () => {
            try {
                await chrome.storage.local.set({ [SW_BLOCKED_KEY]: [] });
                await updateSwOffScript();
                await injectProfileOnAllTabs();
                sendResponse({ ok: true });
            } catch (e) { sendResponse({ ok: false, reason: e.message }); }
        })();
        return true;
    }
    if (message.type === 'getWebrtcExceptionList') {
        (async () => {
            try { sendResponse({ ok: true, hosts: await getWebrtcExceptions() }); }
            catch (e) { sendResponse({ ok: false, hosts: [], reason: e.message }); }
        })();
        return true;
    }
    if (message.type === 'clearWebrtcExceptions') {
        (async () => {
            try {
                await chrome.storage.local.set({ [WEBRTC_EXCEPTIONS_KEY]: [] });
                await updateRtcOffScript();
                await injectProfileOnAllTabs();
                sendResponse({ ok: true });
            } catch (e) { sendResponse({ ok: false, reason: e.message }); }
        })();
        return true;
    }
    if (message.type === 'toggleWebrtcForCurrentTab') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab?.url?.startsWith('http')) { sendResponse({ ok: false, reason: 'no_http_tab' }); return; }
                const host = new URL(tab.url).hostname;
                // [FIX the-switch-read-with-a-suffix-match-and-toggled-with-an-exact-one]
                // Covered (itself or by a parent entry) -> every covering entry goes and
                // protection comes back; not covered -> the host is added as an exception.
                // getWebrtcStatus reads with the same suffix rule, so the two cannot disagree.
                const r = afpHostListToggle(await getWebrtcExceptions(), host);
                await chrome.storage.local.set({ [WEBRTC_EXCEPTIONS_KEY]: r.list });

                // The document_start marker mirrors this list — see updateRtcOffScript.
                await updateRtcOffScript();
                // Реинжектим профиль с новым флагом сразу же
                await injectProfile(tab.id);
                sendResponse({ ok: true, host, protected: !r.covered });
            } catch(e) { sendResponse({ ok: false, reason: e.message }); }
        })();
        return true;
    }
    if (message.type === 'getExitCountry') {
        (async () => {
            try {
                // `force` only on an explicit user gesture (the popup's retry). Opening the
                // popup must not mean a request every time.
                const r = await afpRefreshExitCountry(!!message.force);
                sendResponse({
                    ok: true, cc: r.cc || '', at: r.at || 0, off: !!r.off,
                    // Whether the value is old enough that the popup should say so rather
                    // than assert a mismatch it cannot currently confirm.
                    stale: !r.cc || (Date.now() - (r.at || 0)) > EXIT_TTL_MS
                });
            } catch (e) { sendResponse({ ok: false, cc: '', reason: e.message }); }
        })();
        return true;
    }
    if (message.type === 'getFeatures') {
        chrome.storage.local.get(['afp_features'], function(r) {
            sendResponse({
                features: afpMergeFeatures(r.afp_features)
            });
        });
        return true;
    }
    if (message.type === 'setFeatures') {
        (async () => {
            try {
                const f = afpMergeFeatures(message.features || {});
                await chrome.storage.local.set({ afp_features: f });
                invalidateProfileCache();
                // The options page writes afp_host_language just before sending this, and
                // that key is read by TWO builders: buildProfile below and the
                // accept-language rule. Rebuilding only the profile would leave the header
                // announcing the country's language while navigator.language announced the
                // machine's — the exact window/wire split this switch exists to remove.
                await updateDynamicLanguageRule();
                await injectProfileOnAllTabs();
                sendResponse({ ok: true });
            } catch (e) {
                sendResponse({ ok: false, reason: e.message });
            }
        })();
        return true;
    }
});

// [FIX stale-dynamic-rules-from-older-builds-were-never-removed]
//
// Dynamic DNR rules persist across page loads, worker restarts, extension reloads and
// browser restarts — they live in the profile, not in the code. Both writers below clear
// only their OWN id (`removeRuleIds: [1000]` / `[1001]`), so any rule an EARLIER build of
// this extension created under a different id is still installed on every user who ever ran
// that build, and no amount of reinstalling the current code removes it.
//
// That is not hypothetical: on a real Chrome the `sec-ch-ua-platform-version` header stayed
// "10.0.0" through three reloads while the profile, the page's own
// getHighEntropyValues() and rule 1000 all said 15.0.0 — the value was coming from
// somewhere the current code does not write and does not clean up.
//
// We own the dynamic-rule namespace, so anything outside the ids we currently issue is
// garbage by definition. Pruned once per worker start, before the rules are rebuilt.
// 1001 is deliberately absent: it was the unconditional device-hint rule, replaced by the
// per-origin rules in AFP_HINT_RULE_IDS ([FIX unsolicited-client-hints]). Leaving it out
// makes the pruner delete it from every profile that still carries it.
//
// A function, not a const: AFP_HINT_RULE_IDS is declared further down and `const` has no
// hoisting, so reading it at module-evaluation time here is a temporal-dead-zone error.
// The pruner runs after evaluation, so resolving it at call time is both correct and the
// smaller change.
function afpDynamicRuleIds() {
    // 1001/1002 are the stand-down allow rules, 1003 the client-hint strip; 1200.. the
    // per-site CSP rewrites. One writer per id — see AFP_HINT_STRIP_RULE_ID.
    return [1000, 1001, 1002, AFP_HINT_STRIP_RULE_ID].concat(AFP_HINT_RULE_IDS).concat(afpCspRuleIds());
}
async function pruneStaleDynamicRules() {
    try {
        const existing = await chrome.declarativeNetRequest.getDynamicRules();
        const stale = existing
            .map(function (r) { return r.id; })
            .filter(function (id) { return afpDynamicRuleIds().indexOf(id) === -1; });
        if (stale.length) {
            console.warn('[AFP] removing stale dynamic rules from an older build: ' + stale.join(','));
            await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: stale });
        }
    } catch (e) {
        console.warn('[AFP] pruneStaleDynamicRules:', e.message);
    }
}

// [FIX the-header-half-queued-behind-seven-rebuilds] ONE REBUILD AT A TIME, AND AT MOST ONE WAITING.
//
// A fresh install calls this from seven places inside its first second — onInstalled, the
// profile write, the country write, the worker-start pass and the writes that follow — and
// every call used to run in full and concurrently: two ruleset toggles, rule 1000, the route
// rules and the client-hint rules, about five DNR operations each, all queued behind one
// another in the browser. On a fast machine that queue drains unnoticed. On the public CI
// runner, where one DNR write costs hundreds of milliseconds inside the full set, the header
// half of a route learned during that second landed page loads late: test/wbcoherence.mjs
// saw the window stand down by visit 3 while the document request went on carrying the
// profile's user-agent through visit 7 — every nightly pass of 2026-09-11, and two of three
// v2.5.30 tag attempts on the fork. Reproduced by delaying every DNR write in the service
// worker: seven overlapping rebuilds, and no route rule for /wb/ through all seven visits.
//
// Coalesced: a call made while another is WAITING joins it — that run has not started, so it
// reads everything the new call would have read. A call made while one is RUNNING queues a
// single follow-up, which reads the state as it stands when it starts.
let _dlrChain = Promise.resolve();
let _dlrWaiting = null;
function updateDynamicLanguageRule() {
    if (_dlrWaiting) return _dlrWaiting;
    const run = _dlrChain.catch(function () {}).then(function () {
        _dlrWaiting = null;
        return afpUpdateDynamicLanguageRuleNow();
    });
    _dlrWaiting = run;
    _dlrChain = run;
    return run;
}
async function afpUpdateDynamicLanguageRuleNow() {
    try {
        const cached = await chrome.storage.local.get([STORAGE_KEY, HOST_LANG_KEY]);
        const countryCode = cached[STORAGE_KEY] || 'US';
        const country = COUNTRY_DATA[countryCode] || COUNTRY_DATA['US'];
        // Same helper as buildProfile: the header and navigator.language are one claim, and
        // the whole point of the switch is that BOTH stop lying, not one of them.
        const _hdrLang = afpLanguageClaim(country, !!cached[HOST_LANG_KEY]).lang;
        // The header and the JS value must be the same string. Both come from the profile,
        // so a future change to one cannot leave the other behind — the window/worker/header
        // split is the failure mode this whole file keeps guarding against.
        const chProfile = await getCachedProfile();
        // [FIX header-claimed-windows-10-while-js-said-windows-11] This used to fall back
        // to WIN10_PLATFORM_VERSION whenever the cached profile had no clientHints —
        // asserting "Windows 10" in the header while the page's own
        // getHighEntropyValues() answered 15.0.0. Measured on a real Chrome 151 / Win11
        // host with the extension live:
        //
        //   JS   platformVersion            15.0.0
        //   HTTP sec-ch-ua-platform-version 10.0.0
        //
        // Everything else agreed byte for byte (brands, fullVersionList, uaFullVersion),
        // so the OS claim was the single field contradicting itself — exactly what the
        // comment above this block promises cannot happen.
        //
        // A missing value is now left NATIVE instead of guessed: no header is set, the
        // browser sends its own, and nothing can disagree with the JS. Guessing was never
        // safe here — the fallback is a different OS family, not a rounding.
        const platformVersion = (chProfile.clientHints && chProfile.clientHints.platformVersion) || '';
        // [FIX host-mode] The hardware-hint strip follows the same profile the rules do.
        await afpSyncHwRuleset(!!chProfile.hostHw);
        // [FIX the-arch-strip-hid-a-value-the-host-already-matched] The arch strip follows
        // the HOST, not the profile — an x86_64 machine answers those four the way every
        // row claims them, whichever row is selected.
        await afpSyncArchRuleset(await afpHostArchNative());
        // Keep network UA / CH aligned with the Windows spoof the MAIN world shows.
        // Without this, JS navigator.userAgent can say Windows while the request
        // still carries HeadlessChrome/Linux — a high-confidence bot signal.
        var maj = afpChromeMajor();
        var spoofUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'
            + maj + '.0.0.0 Safari/537.36';
        // [FIX ua-ch-brand-added-to-three-sources-of-four] `sec-ch-ua` is no longer set.
        //
        // It used to be a literal — '"Not=A?Brand";v="99", "Google Chrome";v="<maj>",
        // "Chromium";v="<maj>"' — while `sec-ch-ua-full-version-list` below was
        // deliberately left native. On a Chromium build that literal ADDED a Google Chrome
        // brand the browser does not have, so the two headers disagreed, and the JS side
        // (mw-navigator's _ensureChromeBrands / _ensureFullVersionList) added it as well:
        // three sources claiming Chrome, one not. Fingerprint Pro reads headers AND the JS
        // payload, so that split is exactly the kind of thing it grades as tampering.
        //
        // Leaving the header alone makes it match the browser's own JS by construction, for
        // Chrome and Chromium alike. Nothing is lost: the brand list encodes neither the OS
        // nor the locale — the Windows claim rides on sec-ch-ua-platform and
        // -platform-version below, and the major version is the browser's real one anyway
        // (afpChromeMajor reads it from the host UA), so the literal was reconstructing a
        // value it never changed. It also removes the drift risk of pinning a GREASE order
        // that Chrome is free to change.
        // [FIX unsolicited-client-hints] sec-ch-ua-platform-version is NOT set here any
        // more. It is a high-entropy hint: Chrome sends it only to origins that asked via
        // Accept-CH, so setting it unconditionally added a header to every request that a
        // real browser would not have sent. It now lives in the per-origin rules built by
        // rebuildClientHintRules(), which reads the same profile value.
        //
        // `platformVersion` is still resolved above because that is what those rules use —
        // and an unknown value still means "say nothing" rather than "claim Windows 10".
        void platformVersion;
        const _sdScopes = await standDownScopes();
        const _sdHosts = _sdScopes.hosts;
        // [FIX the-standdown-never-fired] Excluding those hosts from rule 1000 is not
        // enough, and the first version of this measured that: the header did not become
        // the browser's own, it DISAPPEARED. rules/static.json id 1 REMOVES
        // accept-language (and the client-hint family) on every request — that strip is
        // what [FIX install-window-leaks-the-host-os-build] moved into the static ruleset
        // so nothing leaks before the dynamic rules land — and a static rule cannot be
        // given a domain exclusion at runtime. A request that is exempt from rule 1000 but
        // not from rule 1 asks with no Accept-Language at all, which is not what any
        // browser does and is a louder signal than the one being fixed.
        //
        // An `allow` rule at a higher priority is the API's own answer: modifyHeaders rules
        // below it do not apply. One rule takes the origin out of BOTH the static strip and
        // every dynamic rewrite, so it asks exactly as the browser would.
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [1000, 1001, 1002],
            addRules: [{
                id: 1000,
                priority: 2,
                action: {
                    type: 'modifyHeaders',
                    requestHeaders: ([
                        { header: 'accept-language', operation: 'set', value: _hdrLang },
                        { header: 'user-agent', operation: 'set', value: spoofUa },
                        /* sec-ch-ua: left native — see the note above */
                        { header: 'sec-ch-ua-platform', operation: 'set', value: '"Windows"' },
                        { header: 'sec-ch-ua-mobile', operation: 'set', value: '?0' },
                        /* sec-ch-ua-full-version / full-version-list: leave native build */
                    ])
                },
                condition: Object.assign({
                    urlFilter: '*://*/*',
                    resourceTypes: AFP_HEADER_RESOURCE_TYPES
                }, _sdHosts.length ? {
                    excludedRequestDomains: _sdHosts,
                    excludedInitiatorDomains: _sdHosts
                } : {})
            }].concat(_sdHosts.length ? [{
                id: 1001,
                priority: 3,
                action: { type: 'allow' },
                condition: {
                    urlFilter: '*://*/*',
                    requestDomains: _sdHosts,
                    resourceTypes: AFP_HEADER_RESOURCE_TYPES
                }
            }, {
                id: 1002,
                priority: 3,
                action: { type: 'allow' },
                condition: {
                    urlFilter: '*://*/*',
                    initiatorDomains: _sdHosts,
                    resourceTypes: AFP_HEADER_RESOURCE_TYPES
                }
            }] : [])
        });
        // Not from _sdScopes: that snapshot is several awaits old by now. See afpSyncSdRouteRules.
        await afpSyncSdRouteRules();
        // [FIX per-origin-hints-outlived-the-profile] The per-origin SET rules carry profile
        // VALUES (device memory, dpr, the OS bucket) and were rebuilt only when an origin's
        // Accept-CH was observed and at worker start — so a profile change left every origin
        // already learned sending the PREVIOUS machine's hints until its next Accept-CH,
        // while the page reported the new one. In host mode the same staleness would have
        // kept a table row's device-memory rule alive over the browser's own answer. This
        // function already runs on every profile change and at startup, so the rebuild
        // follows it here.
        await rebuildClientHintRules();
    } catch(e) { console.warn('[AFP] updateDynamicLanguageRule:', e.message); }
}

// [FIX device-headers-desync] rules.json (статичный ruleset) раньше просто
// удалял device-memory/dpr/viewport-width/-height заголовки полностью, никак
// не зная о выбранном профиле — а JS-сторона (navigator.deviceMemory,
// window.devicePixelRatio в mw/*.js) выставляет конкретное число из
// профиля. Сайт, сверяющий JS API и HTTP-заголовок для одного и того же
// атрибута (напр. navigator.deviceMemory=8 но заголовок Device-Memory
// отсутствует вовсе), видит прямое расхождение. declarativeNetRequest не
// поддерживает подстановку динамических значений в статичные правила —
// поэтому эти 3 заголовка перенесены в динамическое правило, пересчитываемое
// при каждой смене профиля, синхронно со значениями из buildProfile().
// [FIX unsolicited-client-hints] Every hint below used to be SET on every request to every
// site, from a rule with no domain condition. That is not what a browser does. Chrome sends
// exactly three hints unprompted — sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform — and
// every other one only after the origin asks for it with an `Accept-CH` response header.
// The unprefixed `device-memory` / `dpr` spellings it no longer sends at all.
//
// Measured against a clean Chrome on the same machine, identical Accept-CH: 18-20 headers
// there against 24 here, the extras being device-memory, sec-ch-device-memory, dpr,
// sec-ch-dpr, sec-ch-ua-wow64, sec-ch-ua-model (with arch, bitness and platform-version
// added unconditionally too, invisible in that capture only because the probe had asked for
// them). A detector needs no canvas and no JS for that — it counts headers.
//
// `modifyHeaders` cannot express "rewrite only if the browser was already sending it":
// `set` ADDS an absent header, and DNR has no condition on request-header presence. So the
// opt-in is learned instead — Accept-CH is observed on responses, and each hint gets its own
// rule limited by `requestDomains` to the origins that actually asked for THAT hint. An
// origin that never asks is served a browser-shaped request.
// [FIX the-install-window-sent-the-host-instead-of-the-profile]
//
// EVERY KEY BELOW IS ALSO REMOVED BY rules/static.json, and that duplication is the fix.
//
// The design was already right — strip by default at priority 1, set per origin at priority
// 2 — but BOTH halves lived in DYNAMIC rules, and a dynamic rule does not exist during the
// seconds after the extension is installed, updated or reloaded. A static ruleset does: it
// is live from extension load, before any navigation can happen. Measured in that window,
// eight loads on a fresh profile:
//
//     /n1../n4   accept-language: ru-RU,ru;q=0.9        the host's real language AND country
//     /n2../n3   sec-ch-ua-platform-version: "19.0.0"   the host's real Windows build
//     /n5        accept-language: en-US,en;q=0.9        the dynamic rules finally landed
//
// After moving the strip into the static ruleset, the host values never appear at all: the
// window sends NOTHING for these headers and the profile's values arrive when the dynamic
// rules do. Nothing about the settled state changed — the priority-2 set rules still win,
// which is what makes this safe to do statically.
//
// accept-language is removed rather than set to a constant for the same reason platformVersion
// is: the static rule cannot know the profile, and a wrong claim is worse than silence. It is
// also the header that mattered most here — a language names a COUNTRY, next to a profile
// claiming America/New_York.
//
// WHAT THIS DOES NOT COVER, and it cannot be covered statically: `user-agent`. It cannot be
// removed (it is not optional) and it cannot be set without knowing the host's Chrome major,
// which nothing knows until the service worker runs. On Chrome that costs nothing — the real
// UA and the spoofed one are byte-identical, since the rewrite only drops a trailing browser
// token. On EDGE the window reveals `Edg/`. Named rather than hidden.
//
// test/parity-static.mjs pins the two lists together, so a hint added here without being
// added there turns the suite red rather than re-opening the window for that one header.
// [FIX host-mode] The five hints that describe the MACHINE — the OS build and the two
// device hints — return null in host mode, so no per-origin rule is built and the browser
// answers with its own. The strip that would otherwise silence them lives in a SEPARATE
// static ruleset (rules/static-hw.json) that afpSyncHwRuleset disables for the same
// selection; the identity/locale strip in rules/static.json stays on in every mode.
// [FIX the-arch-strip-hid-a-value-the-host-already-matched] arch / bitness / model /
// wow64 were said to need no exception because "they are the values every x64 Windows
// desktop reports, host included". That is true of the VALUE and false of the STRIP: the
// strip fired on every host, so on a host that already answers those four exactly, the
// four headers were removed and then set back — and between the two, on the first request
// to a new origin, they were simply absent. Measured on an x86_64 rig, clean Chromium 141
// against an origin answering Accept-CH:
//
//     clean browser     sec-ch-ua-arch "x86"   -bitness "64"   -model ""   -wow64 ?0
//     AFP_CH_HINTS      "x86"                  "64"            ""          ?0
//
// — the same four constants, so leaving the headers ALONE makes them match the browser's
// own JS by construction, which is the argument already made for the brand list above.
// The exemption is therefore a reading taken from the host (afpHostArchNative), not a
// constant: on an ARM host the browser answers "arm" and the strip is the only truthful
// option. Its strip lives in a third static ruleset, rules/static-arch.json, switched the
// way afpSyncHwRuleset switches the hardware one.
const AFP_HW_HINTS = ['sec-ch-ua-platform-version', 'sec-ch-device-memory', 'device-memory', 'sec-ch-dpr', 'dpr'];
const AFP_CH_HINTS = (function () {
    const hints = {
        'sec-ch-ua-arch': function () { return '"x86"'; },
        'sec-ch-ua-bitness': function () { return '"64"'; },
        'sec-ch-ua-model': function () { return '""'; },
        'sec-ch-ua-wow64': function () { return '?0'; },
        'sec-ch-ua-platform-version': function (p) {
            const v = (p.clientHints && p.clientHints.platformVersion) || '';
            return v ? '"' + v + '"' : null;
        },
        // The viewport hints are deliberately absent: real Chrome reports the LAYOUT viewport
        // there, which tracks innerWidth rather than screen.*, so forcing the profile's screen
        // size desynced them from the JS side — see [FIX viewport-ch-not-screen].
        'sec-ch-device-memory': function (p) { return String(p.deviceMemory); },
        'device-memory': function (p) { return String(p.deviceMemory); },
        'sec-ch-dpr': function (p) { return String(p.devicePixelRatio); },
        'dpr': function (p) { return String(p.devicePixelRatio); }
    };
    // One list decides both halves: which static file strips the hint, and which per-origin
    // rule stays unbuilt in host mode. A hint in one and not the other is what
    // test/parity-static.mjs is there to catch.
    AFP_HW_HINTS.forEach(function (h) {
        const f = hints[h];
        hints[h] = function (p) { return (p && p.hostHw) ? null : f(p); };
    });
    return hints;
})();
const AFP_HW_RULESET_ID = 'ruleset_static_hw';
/**
 * The static strip of the hardware hints follows the selection: on for every table row (it
 * is what keeps the install window from sending the host's OS build), off for host mode,
 * where the host's build and device hints are the right answer and a silent header would be
 * the odd one out. updateEnabledRulesets persists, so this is idempotent and cheap to call
 * from every place the profile is rebuilt.
 */
async function afpSyncHwRuleset(hostHw) {
    try {
        if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateEnabledRulesets) return;
        await chrome.declarativeNetRequest.updateEnabledRulesets(hostHw
            ? { disableRulesetIds: [AFP_HW_RULESET_ID] }
            : { enableRulesetIds: [AFP_HW_RULESET_ID] });
    } catch (e) { console.warn('[AFP] afpSyncHwRuleset:', e && e.message); }
}
const AFP_ARCH_HINTS = ['sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-model', 'sec-ch-ua-wow64'];
const AFP_ARCH_RULESET_ID = 'ruleset_static_arch';
let _hostArchNative = null;
let _hostArchRead = null;
/**
 * Does this host already answer the four arch hints exactly as the profile claims them?
 *
 * The service worker is not patched by the content scripts, so its own userAgentData is
 * the host's — the same oracle afpPlatformVersion reads the OS build through.
 *
 * NOT PERSISTED, where afpPlatformVersion deliberately is. A stored 'x86' survives a
 * Chrome profile copied onto an ARM machine, and there the host's own "arm" would go out
 * on the wire while JS kept answering x86 — a flat contradiction, and a worse one than the
 * bucket staleness the stored OS reading exists to avoid. Re-reading costs nothing: the
 * value is local to this browser process and the call resolves off a cached answer.
 *
 * The in-flight promise is shared for the reason [FIX two-observers-in-one-tick-lost-a-host]
 * records below: two callers in one tick must not have one of them decide from the
 * unresolved `false` while the other decides from the reading.
 */
async function afpHostArchNative() {
    if (_hostArchNative !== null) return _hostArchNative;
    if (!_hostArchRead) {
        _hostArchRead = (async function () {
            try {
                const uad = navigator.userAgentData;
                if (uad && typeof uad.getHighEntropyValues === 'function') {
                    const hev = await uad.getHighEntropyValues(['architecture', 'bitness', 'model', 'wow64']);
                    return hev.architecture === 'x86' && hev.bitness === '64' &&
                        (hev.model || '') === '' && !hev.wow64;
                }
            } catch (e) {}
            return false;
        })().then(function (v) { _hostArchNative = v; _hostArchRead = null; return v; });
    }
    return _hostArchRead;
}
/**
 * The arch strip follows the reading, not the mode: it is off on a host whose four values
 * already equal the claim — every profile row included, host mode included — and on
 * everything else it stays on. updateEnabledRulesets persists per browser profile and is
 * idempotent, so this is cheap to call from every place the rules are rebuilt.
 */
async function afpSyncArchRuleset(native) {
    try {
        if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateEnabledRulesets) return;
        await chrome.declarativeNetRequest.updateEnabledRulesets(native
            ? { disableRulesetIds: [AFP_ARCH_RULESET_ID] }
            : { enableRulesetIds: [AFP_ARCH_RULESET_ID] });
    } catch (e) { console.warn('[AFP] afpSyncArchRuleset:', e && e.message); }
}
const CH_OPTIN_KEY = 'afp_ch_optin';
// One rule per hint, so a site that asked only for dpr does not also start receiving arch.
const AFP_HINT_RULE_IDS = Object.keys(AFP_CH_HINTS).map(function (_, i) { return 1010 + i; });
// Unconditional REMOVE for every managed hint, at a lower priority than the per-origin SET
// rules above, so the two compose: an origin that asked gets the profile's value, an origin
// that did not gets no header at all.
//
// The remove half is what makes the learning safe. Without it there is a window on the very
// first response from a new origin — before the Accept-CH observation has turned into a
// rule — and `Critical-CH` makes Chrome retry the request IMMEDIATELY, inside that window.
// Measured in test/coldstart.mjs: the header went out carrying the HOST's real build,
// "19.0.0", against the profile's "15.0.0". Leaking the true OS build to the one kind of
// site that bothers to ask for it is a worse failure than the unsolicited header this whole
// change is removing. Stripping by default means the race can only ever cost a header that
// is absent for a moment, never one that tells the truth about the machine.
//
// [FIX the-hint-strip-and-the-stand-down-allow-shared-rule-id-1002] This was 1002 — the
// same id updateDynamicLanguageRule writes the stand-down initiatorDomains `allow` under.
// That function ends by calling rebuildClientHintRules, which removes 1002 and re-adds it as
// this strip, so the allow it had written moments earlier never survived the function that
// created it. Measured in real Chromium after one rebuild with a learned stand-down host:
// 1000 modifyHeaders, 1001 allow (requestDomains), 1002 modifyHeaders STRIP — no initiator
// allow at all. Rule 1000 already excluded the initiator, so a request a youtube or github
// page sent to any third party was stripped by the static ruleset with nothing to shield it
// and went out with NO accept-language — the louder signal the note at standDownHosts warns
// about. test/background-fns.mjs section 11 now holds every dynamic id to one writer; the
// stale 1002 strip an older install still carries is removed by updateDynamicLanguageRule's
// own removeRuleIds on the first wake.
const AFP_HINT_STRIP_RULE_ID = 1003;

let _chOptIn = null;          // { '<hint>': ['example.com', …] }
let _chRebuildTimer = null;

/**
 * One storage read per key at a time.
 *
 * [FIX two-observers-in-one-tick-lost-a-host] Every learned-list loader below memoised the
 * VALUE but not the read in flight. Two responses observed in the same tick — two tabs
 * restoring at browser start — each started a read; the second replaced the array the first
 * was about to push its host into, and the write that followed dropped an add-only entry.
 * Found while writing the cold-cache test: two hosts noted back to back, only the second
 * stored. test/background-fns.mjs section 13 reproduces it. Concurrent callers share the
 * pending read now; a cache a writer has reset to null (afpForgetCspHosts, the onChanged
 * handlers) is simply re-read on the next call.
 */
const _afpLoads = Object.create(null);
function afpLoadStored(key, getCache, setCache, parse) {
    const have = getCache();
    if (have) return Promise.resolve(have);
    if (!_afpLoads[key]) {
        _afpLoads[key] = Promise.resolve()
            .then(function () { return chrome.storage.local.get([key]); })
            .then(function (got) { if (!getCache()) setCache(parse(got && got[key])); return getCache(); },
                function () { if (!getCache()) setCache(parse(undefined)); return getCache(); })
            .finally(function () { delete _afpLoads[key]; });
    }
    return _afpLoads[key];
}
const afpStoredList = function (v) { return Array.isArray(v) ? v : []; };
const afpStoredMap = function (v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; };

async function loadChOptIn() {
    return afpLoadStored(CH_OPTIN_KEY, function () { return _chOptIn; }, function (v) { _chOptIn = v; }, afpStoredMap);
}

/** Rebuild one DNR rule per hint, each scoped to the origins that requested it. */
async function rebuildClientHintRules() {
    try {
        const optIn = await loadChOptIn();
        const profile = await getCachedProfile();
        const hints = Object.keys(AFP_CH_HINTS);
        // [FIX host-mode] The dynamic strip leaves the hardware hints alone in host mode,
        // as the static one does (afpSyncHwRuleset): with no per-origin SET rule to win
        // over it, a strip here would silence the browser's own answer, which is the one
        // this mode exists to let through.
        // [FIX the-arch-strip-hid-a-value-the-host-already-matched] The second half of the
        // exemption. Dropping the per-origin SET rule as well as the strip is the point: on
        // a matching host those four become fully native, which is byte-identical to the
        // clean browser on every request rather than only on the ones a rule reaches.
        const archNative = await afpHostArchNative();
        const exempt = function (h) {
            return (profile && profile.hostHw && AFP_HW_HINTS.indexOf(h) !== -1) ||
                (archNative && AFP_ARCH_HINTS.indexOf(h) !== -1);
        };
        const stripped = hints.filter(function (h) { return !exempt(h); });
        // [FIX an-empty-strip-rule-threw-and-took-the-whole-write-with-it] There are nine
        // managed hints and both exemptions are now list-shaped: AFP_HW_HINTS is five of
        // them and AFP_ARCH_HINTS is the other four. In host mode ON a matching host both
        // fire, `stripped` is EMPTY, and a modifyHeaders rule with no headers is not a
        // no-op — Chrome rejects the rule, updateDynamicRules throws for the WHOLE call,
        // the catch below logs it, and every id the call meant to remove stays exactly as
        // it was. Which is the worst possible outcome: the rules that survive are the ones
        // the previous profile wrote.
        //
        // Measured with the writes logged from inside the worker, test/hostmode.mjs:
        //
        //     t+0.000  write hostHw=false add=[1003,1014,1015,1017]   (laptop_mid)
        //     t+3.037  write hostHw=true  add=[1003]                  (host, strip empty)
        //     t+6.040  first host-mode request
        //              sec-ch-ua-platform-version: "10.0.0"
        //              getDynamicRules() -> 1014 still there
        //
        // The write at t+3.037 said add=[1003] and removed nothing, because it never
        // landed. On the wire that is the profile's OS build in the one mode whose whole
        // purpose is to answer the machine's own — 78/0 to 77/1, and the failing assertion
        // named the header rather than the throw, which is why this took a log inside the
        // worker to see rather than a re-read of the diff.
        const addRules = [];
        if (stripped.length) {
            addRules.push({
                id: AFP_HINT_STRIP_RULE_ID,
                priority: 1,
                action: {
                    type: 'modifyHeaders',
                    requestHeaders: stripped.map(function (h) {
                        return { header: h, operation: 'remove' };
                    })
                },
                condition: { urlFilter: '*://*/*', resourceTypes: AFP_HEADER_RESOURCE_TYPES }
            });
        }
        for (let i = 0; i < hints.length; i++) {
            const hint = hints[i];
            if (exempt(hint)) continue;
            const domains = optIn[hint];
            if (!domains || !domains.length) continue;
            const value = AFP_CH_HINTS[hint](profile);
            if (value === null) continue;   // nothing truthful to say — stay quiet
            addRules.push({
                id: AFP_HINT_RULE_IDS[i],
                priority: 2,
                action: {
                    type: 'modifyHeaders',
                    requestHeaders: [{ header: hint, operation: 'set', value: value }]
                },
                // requestDomains matches the domain AND its subdomains, which is the same
                // scope Chrome uses when it decides to send a hint.
                condition: { requestDomains: domains, resourceTypes: AFP_HEADER_RESOURCE_TYPES }
            });
        }
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: AFP_HINT_RULE_IDS.concat([AFP_HINT_STRIP_RULE_ID]),
            addRules: addRules
        });
    } catch (e) { console.warn('[AFP] rebuildClientHintRules:', e.message); }
}

// [FIX csp-blob-worker-broke-whatsapp] Some origins forbid blob: workers outright —
// web.whatsapp.com ships `worker-src` with an explicit list of its own paths and no `blob:`.
// Every worker we wrap is constructed from a blob, so on such a page the construction is
// blocked and the app never boots.
//
// mw/mw-workers.js already learns this, but only from the FAILURE: a CSP-blocked
// `new Worker(blobUrl)` does not throw, it returns a live object that dies later with an
// empty error message, so the answer arrives after the page already holds a dead worker.
// Its own comment records that the first worker on such an origin cannot be saved — and on
// WhatsApp the first worker IS the application.
//
// The service worker sees the response headers before the document is parsed, which is
// early enough. Hosts whose CSP forbids blob: workers are recorded here; storage-bridge.js
// turns that into the `v.ui.wb` flag mw-workers already reads, so the MAIN world skips the
// blob path from the start and hands the page a native worker.
const CSP_NOBLOB_KEY = 'afp_csp_noblob';
let _cspNoBlob = null;

/**
 * Does this CSP forbid workers created from a blob: URL?
 *
 * [FIX csp-header-read-as-one-policy] One header can carry SEVERAL policies, separated by
 * commas, and the browser enforces every one of them — so blob: is refused if ANY policy
 * refuses it. This read the whole header as a single policy, which meant the LAST
 * `script-src` in the string silently overwrote the first. youtube.com sends three:
 *
 *   script-src 'unsafe-eval' 'self' 'unsafe-inline' https://…;report-uri …/allowlist
 *   require-trusted-types-for 'script'
 *   base-uri 'self';object-src 'none';script-src 'report-sample' 'nonce-…' 'strict-dynamic' https: http: …
 *
 * Only the first refuses blob:. The old parser read the third and happened to reach the
 * same verdict, which is why nothing looked wrong — but the two differ in general, and
 * they differ in the direction that costs us: a site whose only worker-constraining policy
 * is a strict-dynamic one had its workers left unpatched for no reason.
 */
function afpCspBlocksBlobWorkers(value) {
    return String(value || '').split(',').some(afpPolicyBlocksBlobWorkers);
}

/**
 * One policy. Worker sources fall back worker-src -> child-src -> script-src -> default-src.
 *
 * Measured in Chromium, one single-policy page per row, `new Worker(<blob URL>)`:
 *
 *   script-src 'nonce-N'                                    blocked
 *   script-src 'nonce-N' https: http:                       blocked   <- `*`/schemes do NOT cover blob:
 *   script-src 'self' 'unsafe-inline'                       blocked
 *   script-src 'nonce-N' blob:                              WORKS
 *   script-src 'nonce-N' 'strict-dynamic'                   WORKS     <- and this was missed
 *   script-src 'nonce-N' 'strict-dynamic'; worker-src 'self'  blocked <- so read the EFFECTIVE
 *                                                                       directive, not any of them
 */
function afpPolicyBlocksBlobWorkers(policy) {
    const directives = {};
    String(policy || '').split(';').forEach(function (part) {
        const t = part.trim().split(/\s+/).filter(Boolean);
        if (!t.length) return;
        directives[t[0].toLowerCase()] = t.slice(1).map(function (s) { return s.toLowerCase(); });
    });
    const list = directives['worker-src'] || directives['child-src'] ||
                 directives['script-src'] || directives['default-src'];
    if (!list) return false;                            // workers unconstrained
    if (list.indexOf('blob:') !== -1) return false;     // explicitly allowed
    // 'strict-dynamic' drops the host/scheme allowlist and admits whatever an already-trusted
    // script asks for, a blob: worker included — measured above, not inferred from the spec.
    if (list.indexOf("'strict-dynamic'") !== -1) return false;
    return true;
}

/**
 * Does this CSP restrict which Trusted Types policy NAMES may be created?
 *
 * [FIX tt-policy-name-was-probed-by-trying-it] mw/mw-workers.js used to find this out by
 * calling `trustedTypes.createPolicy('afp-blob-url', …)` inside a try/catch. The catch
 * handles the functional half correctly — we stop wrapping — but a rejected createPolicy
 * REPORTS A VIOLATION before it throws, and a violation cannot be caught. Measured on
 * claude.ai, whose header carries `trusted-types Kssz2 default`:
 *
 *     Creating a TrustedTypePolicy named 'afp-blob-url' violates the following Content
 *     Security policy directive: "trusted-types Kssz2 default".
 *          at mw-bundle.js:10236
 *
 * So the probe printed the extension's file name into the page's console on every load,
 * which is the same channel [FIX csp-reports-are-a-second-stack-channel] closed once
 * already: the report is built in C++ from the real stack, and no JS masking reaches it.
 *
 * There is no API that answers "may I create this name" without trying, so the question is
 * answered HERE instead, from the response header, exactly as blob-worker support already
 * is. The page-side code then never calls createPolicy at all on such an origin.
 *
 * `trusted-types *` allows any name; `trusted-types` with no list allows NONE; anything
 * else is an allowlist we are not on (our names are generated, so they can never be in a
 * site's list). 'none' is the keyword form of the empty list.
 */
function afpCspRestrictsTrustedTypes(value, name) {
    return String(value || '').split(',').some(function (policy) {
        let restricted = false;
        String(policy || '').split(';').forEach(function (part) {
            const t = part.trim().split(/\s+/).filter(Boolean);
            if (!t.length || t[0].toLowerCase() !== 'trusted-types') return;
            const names = t.slice(1).map(function (s) { return s.toLowerCase(); });
            // A bare `trusted-types` (or an explicit 'none') permits no policy at all. A
            // list that names OUR policy — which only a rewritten header does, see
            // afpRewriteCsp step 3 — does not restrict us.
            const ours = name ? String(name).toLowerCase() : null;
            if (names.indexOf('*') === -1 && (!ours || names.indexOf(ours) === -1)) restricted = true;
        });
        return restricted;
    });
}

/**
 * Does this CSP ENFORCE Trusted Types at script sinks?
 *
 * [FIX tt-wrapper-laundered-the-pages-plain-string] Separate question from both of its
 * neighbours: `trusted-types` restricts policy NAMES, this one decides whether a bare
 * string is refused at all. A document can have either without the other.
 *
 * It has to be known because of what the worker wrapper does. Handed `new Worker('/w.js')`
 * it does not pass that string on — it fetches the source, wraps it and constructs the
 * worker from a blob of OUR making, minted through OUR policy. On a document that requires
 * TrustedScriptURL that quietly launders a value the browser was supposed to reject:
 *
 *   clean   worker threw TypeError, 1 violation reported
 *   ours    worker ok,              0 violations
 *
 * The site's own broken call starts working, and any page can turn the difference into a
 * one-line detector by assigning a bare string under its own CSP and seeing whether it
 * throws. Caught by test/cspattribution.mjs PART 4. Where this is set the wrapper only
 * touches workers whose URL the page ALREADY passed as a TrustedScriptURL — which is what
 * a site under such a CSP does, Turnstile included.
 */
function afpCspEnforcesTrustedTypes(value) {
    return String(value || '').split(',').some(function (policy) {
        let enforced = false;
        String(policy || '').split(';').forEach(function (part) {
            const t = part.trim().split(/\s+/).filter(Boolean);
            if (!t.length || t[0].toLowerCase() !== 'require-trusted-types-for') return;
            const forWhat = t.slice(1).map(function (s) {
                return s.toLowerCase().replace(/^'/, '').replace(/'$/, '');
            });
            if (forWhat.indexOf('script') !== -1) enforced = true;
        });
        return enforced;
    });
}

/**
 * Does this CSP refuse a `blob:` fetch/XHR?
 *
 * [FIX importscripts-fallback-killed-turnstile] mw-workers reads a blob worker's source
 * synchronously so it can INLINE it rather than importScripts it. Where connect-src (or
 * default-src) omits blob:, that read is refused — and the refusal is a CSP violation
 * naming our file, the same un-catchable report class as the Trusted Types probe above.
 * claude.ai: `default-src 'none'; connect-src 'self'`, so the read never had a chance.
 *
 * Knowing in advance turns two console errors per worker into a clean passthrough.
 */
function afpCspBlocksBlobConnect(value) {
    return String(value || '').split(',').some(function (policy) {
        const directives = {};
        String(policy || '').split(';').forEach(function (part) {
            const t = part.trim().split(/\s+/).filter(Boolean);
            if (!t.length) return;
            directives[t[0].toLowerCase()] = t.slice(1).map(function (x) { return x.toLowerCase(); });
        });
        const list = directives['connect-src'] || directives['default-src'];
        if (!list) return false;                        // unconstrained
        if (list.indexOf('blob:') !== -1) return false; // explicitly allowed
        return true;
    });
}

/**
 * Does this CSP refuse a `blob:` URL to importScripts?
 *
 * [FIX importscripts-fallback-killed-turnstile] Distinct from afpPolicyBlocksBlobWorkers,
 * which answers "may a blob WORKER be created" and reads worker-src first. This answers
 * "once inside, may that worker import a blob", which is the script directive — and the two
 * genuinely differ. claude.ai grants the first and refuses the second:
 *
 *     worker-src blob:                                     -> worker created
 *     script-src 'nonce-...' 'unsafe-eval' https://...      -> importScripts(blob:) refused
 *
 * Conflating them is what let the wrapper start and then strand itself, taking Cloudflare
 * Turnstile's worker down with it.
 */
function afpCspBlocksBlobScript(value) {
    return String(value || '').split(',').some(function (policy) {
        const directives = {};
        String(policy || '').split(';').forEach(function (part) {
            const t = part.trim().split(/\s+/).filter(Boolean);
            if (!t.length) return;
            directives[t[0].toLowerCase()] = t.slice(1).map(function (x) { return x.toLowerCase(); });
        });
        const list = directives['script-src-elem'] || directives['script-src'] || directives['default-src'];
        if (!list) return false;                            // unconstrained
        if (list.indexOf('blob:') !== -1) return false;     // explicitly allowed
        // 'strict-dynamic' admits whatever an already-trusted script asks for, blobs
        // included — measured for workers in afpPolicyBlocksBlobWorkers, same rule here.
        if (list.indexOf("'strict-dynamic'") !== -1) return false;
        return true;
    });
}

// [FIX a-refusal-we-passed-through-was-charged-to-us] The per-document Trusted Types
// verdict, keyed by tab and frame. The host lists in afpJudgeCsp are add-only, which is
// the safe direction for "leave the page's string to the browser" and the wrong one for
// "refuse it ourselves": a host that enforced once and stopped would have its bare-string
// workers refused by mw-workers where the browser accepts them. So the refusal the
// wrapper answers on its own is gated on THIS response's headers, handed to
// storage-bridge.js when it asks at document_start (runtime message 'afpCspVerdict'),
// milliseconds after this observer ran for the same navigation. In memory only: the
// record is useless once the document is gone, and a service-worker restart between the
// two events would need the document to commit and its first content script to run
// inside that gap.
//
// The record carries all five restrictions the observer judges (the four that depend on
// the rewrite map settle one storage read later) — audit.html shows them as "this
// document's headers said", beside the host lists. But ONLY tte is acted on by the page.
//
// [MEASURED the-verdict-cannot-decide-identity] The same day this was generalised to all
// five in storage-bridge.js — '2'/'0' per document over the host's '1', so that a loose
// document of a strict host (claude.ai's shape) would keep the profile instead of standing
// down for the life of the profile — and reverted after two suites turned red for the
// same reason: the verdict arrives ASYNCHRONOUSLY, after document_start and after the
// page's first script. test/ttworker.mjs: the window froze its stand-down on an empty flag
// at DOMContentLoaded while the worker, told '2' milliseconds later, stood aside — a split.
// test/cspattribution.mjs: with the proxies installed until a verdict says otherwise, the
// page's own refused string on a youtube-shaped host went through our trap again and was
// charged to us — exactly [FIX tt-violation-named-our-file] undone. Anything that decides
// what the WINDOW answers has to be known before the first script, and only the host
// history (noblob.js, tte.js, the bridge's storage read) is. tte is the one flag whose
// verdict changes no identity — it decides who is NAMED in a refusal — so it alone rides.
const _cspVerdicts = new Map();
const CSP_VERDICT_CAP = 2000;
const CSP_VERDICT_FLAGS = ['tte', 'wb', 'tt', 'nc', 'ns'];
function afpRecordCspVerdict(details, host, tte) {
    if (!details || typeof details.tabId !== 'number' || details.tabId < 0) return null;
    const key = details.tabId + ':' + (details.frameId || 0);
    const rec = { host, tte: !!tte, wb: null, tt: null, nc: null, ns: null, settle: null, settled: null };
    rec.settled = new Promise(function (res) { rec.settle = res; });
    _cspVerdicts.delete(key);
    _cspVerdicts.set(key, rec);
    if (_cspVerdicts.size > CSP_VERDICT_CAP) _cspVerdicts.delete(_cspVerdicts.keys().next().value);
    return rec;
}
/** The four rewrite-dependent flags; undefined leaves a flag unknown (null) for the bridge. */
function afpSettleCspVerdict(rec, wb, tt, nc, ns) {
    if (!rec) return;
    const b = (v) => (v === undefined || v === null) ? null : !!v;
    rec.wb = b(wb); rec.tt = b(tt); rec.nc = b(nc); rec.ns = b(ns);
    try { rec.settle(); } catch (e) {}
}
function afpCspVerdictShape(rec) {
    const out = { host: rec.host };
    CSP_VERDICT_FLAGS.forEach(function (k) { out[k] = rec[k]; });
    return out;
}
function afpCspVerdictRecord(sender) {
    if (!sender || !sender.tab || typeof sender.tab.id !== 'number') return null;
    return _cspVerdicts.get(sender.tab.id + ':' + (sender.frameId || 0)) || null;
}
function afpCspVerdictFor(sender) {
    const rec = afpCspVerdictRecord(sender);
    return rec ? afpCspVerdictShape(rec) : null;
}
// The bridge asks after the document committed, normally well after the observer settled
// the record; "normally" is not "always", so the answer waits, briefly, and a flag still
// unsettled goes out as null, which the bridge leaves to the host list.
function afpCspVerdictWhenSettled(sender) {
    const rec = afpCspVerdictRecord(sender);
    if (!rec) return Promise.resolve(null);
    return Promise.race([rec.settled, new Promise(function (r) { setTimeout(r, 300); })])
        .then(function () { return afpCspVerdictShape(rec); });
}
function afpForgetCspVerdicts(tabId) {
    const prefix = tabId + ':';
    for (const k of Array.from(_cspVerdicts.keys())) if (k.indexOf(prefix) === 0) _cspVerdicts.delete(k);
}

function afpNoteCsp(details) {
    try {
        if (details.type !== 'main_frame' && details.type !== 'sub_frame') return;
        const headers = details.responseHeaders || [];
        const raw = [];
        for (let i = 0; i < headers.length; i++) {
            // Report-Only never blocks anything — reading it would disable wrapping on
            // origins that are merely measuring a future policy.
            if (String(headers[i].name || '').toLowerCase() === 'content-security-policy') raw.push(headers[i].value);
        }
        let host = '';
        try { host = new URL(details.url).hostname; } catch (eU) { return; }
        if (!host) return;
        const scope = afpCspScope(details.url);
        const tabId = details.type === 'main_frame' && typeof details.tabId === 'number' ? details.tabId : -1;
        // [FIX a-refusal-we-passed-through-was-charged-to-us] This document's own verdict,
        // recorded before the add-only lists have their say and for documents with no CSP
        // at all. The rewrite leaves require-trusted-types-for in place, so the raw header
        // answers this exactly as the rewritten one would.
        let tteHere = false;
        for (let i = 0; i < raw.length; i++) if (afpCspEnforcesTrustedTypes(raw[i])) tteHere = true;
        const rec = afpRecordCspVerdict(details, host, tteHere);
        if (!raw.length) {
            afpSettleCspVerdict(rec, false, false, false, false);
            // [FIX a-meta-csp-was-never-learned] No header is not "no policy": a route learned
            // from a <meta> element sends none on every visit. See afpSdTabForRoute.
            afpSdTabForRoute(tabId, details.url);
            afpNoteLooseDocument(host);
            return;
        }
        // [FIX the-csp-observer-judged-from-a-cache-that-had-not-loaded] The verdict waits
        // for the rewrite map. This used to read `_cspRewrite` synchronously, and on the
        // request that WAKES the service worker the map is still null: startup reaches
        // loadCspRewrite only after several awaited round trips, while the waking event is
        // dispatched the moment the script has evaluated. A host the user had switched to
        // rewriting was therefore judged from the SITE's header — webRequest sees the
        // original, measured: nonce present, no worker-src — and put back on the
        // blob-refusing list, after which updateNoBlobScript registered noblob.js for it
        // and every later tab stood down while the popup showed the switch ON. Measured in
        // test/csprewrite.mjs 3b before the fix: the cold visit read 18 cores in the window
        // beside 8 in its worker, then 18/18 on every tab after. Nothing below was ever
        // synchronous — the lists are written through promises — so the wait costs one
        // storage read per worker lifetime. The old note here called a cold cache harmless.
        // The policy name is needed only to judge a `trusted-types` allowlist; resolving it
        // costs a storage read, and every await here delays the flag the page's first load
        // is waiting for — measured on the rig, one extra read moved the learning visit's
        // stand-down past DOMContentLoaded of a small page (test/wbcoherence.mjs visit 1).
        const needName = raw.some(function (v) { return /trusted-types/i.test(String(v)); });
        Promise.all([loadCspRewrite(), needName ? afpTtPolicyNameFor(host) : Promise.resolve(null)]).then(function (pair) {
            try { afpJudgeCsp(host, details.type, headers, raw, pair[0], rec, pair[1], scope, tabId); } catch (eJ) { afpSettleCspVerdict(rec); }
        }, function () { afpSettleCspVerdict(rec); });
    } catch (e) {}
}

/** The observer's verdict on one document's CSP, with the rewrite map in hand. */
function afpJudgeCsp(host, type, headers, raw, rw, rec, name, scope, tabId) {
    scope = scope || (host + '/');
    if (tabId === undefined) tabId = -1;
    let blocked = false, ttRestricted = false, ncBlocked = false, nsBlocked = false;
    // [FIX tt-wrapper-laundered-the-pages-plain-string] Add-only like its neighbours,
    // and for the same asymmetry: a host wrongly IN this list costs one thing, the
    // workers it builds from bare strings go unpatched. A host wrongly OUT of it costs
    // the SITE its own rejection, which is both a behaviour change and a detector.
    let ttEnforced = false;
    for (let i = 0; i < raw.length; i++) {
        if (afpCspBlocksBlobWorkers(raw[i])) blocked = true;
        if (afpCspRestrictsTrustedTypes(raw[i], name)) ttRestricted = true;
        if (afpCspBlocksBlobConnect(raw[i])) ncBlocked = true;
        if (afpCspBlocksBlobScript(raw[i])) nsBlocked = true;
        if (afpCspEnforcesTrustedTypes(raw[i])) ttEnforced = true;
    }
    // [FIX csp-rewrite-for-workers] A host the user switched to rewriting: the rule is
    // kept in step with what the site sends, and the restrictions are judged from the
    // header the page will actually GET — the rewritten one — so blob: workers read as
    // admitted, a trusted-types allowlist that now names our policy reads as open, and
    // everything the rewrite leaves in place (TT enforcement, a connect-src or
    // script-src without blob:) is still learned. That last part matters: forgetting
    // `tte` let the wrapper launder a bare-string worker the site meant to refuse
    // (measured in test/csprewrite.mjs, 'accepted' where a clean browser throws).
    if (rw && Object.prototype.hasOwnProperty.call(rw, host)) {
        // Learned from the DOCUMENT the user navigated to, never from a same-host
        // sub-frame: one host can serve different policies per path, and a frame's
        // narrower allowlist rewritten over the main page would block its scripts.
        if (type === 'main_frame') afpRelearnCspRewrite(host, headers, name);
        // [FIX the-switch-created-the-split-it-was-meant-to-close] Add-only is the right rule
        // for what a SITE sends, because one loose document must not erase a strict host. It
        // is the wrong rule for a host we are rewriting: that header is ours, we know what it
        // permits, and a host switched on before this fix carries entries learned from the
        // header it no longer gets. Retired once per navigation, not per request.
        // The marker scripts are REGISTERED from these lists, so emptying the list is only
        // half of it — noblob.js stayed matched and went on writing v.ui.wb, and the origin
        // went on standing down against a storage entry that was already gone. Caught by
        // test/workerpatchgate.mjs section 6, which read both the storage and the scopes.
        // Refreshed only when something actually retired, so an ordinary navigation on a
        // rewritten host costs one storage read and no registration churn.
        if (type === 'main_frame') {
            afpForgetCspHost(host).then(function (rm) {
                if (rm && rm.length) return updateNoBlobScript();
            }).catch(function () {});
        }
        const eff = afpRewriteCsp(raw, name) || raw.join(', ');
        blocked = false;
        ttRestricted = afpCspRestrictsTrustedTypes(eff, name);
        ncBlocked = afpCspBlocksBlobConnect(eff);
        nsBlocked = afpCspBlocksBlobScript(eff);
        ttEnforced = afpCspEnforcesTrustedTypes(eff);
    }


    // [FIX the-third-gate-nobody-watched] A worker that CAN be created and CANNOT be
    // patched counts as blocked, because the consequence is identical and the stand-down
    // is what has to follow.
    //
    // mw-workers hands back the native constructor down five paths; the stand-down in
    // mw-core watched two of them (worker-src, the trusted-types name list). The third:
    // the wrapper reads the original worker source with a synchronous XHR and prepends its
    // payload, and where that read is refused it falls back to importScripts — and where
    // THAT is refused too it passes through, deliberately, because a wrapper that cannot
    // load what it wraps destroys the page's worker (see [FIX
    // importscripts-fallback-killed-turnstile]). Passing through is right. Going on to
    // claim a profile the resulting worker contradicts is not.
    //
    // Reported from a real github.com tab with the rewrite switch ON: window on the
    // profile (Tallinn, et-EE, Iris Xe, 8 cores) beside a worker on the machine (Moscow,
    // ru, Arc, 18 cores) — ten signals, any one of which a site reads twice to see it.
    //
    // Judged on the EFFECTIVE header, so it lands after the rewrite branch above: with the
    // rewrite admitting the read (step 2b of afpRewriteCsp) the worker is patched again and
    // this term is false, which is the whole point of the switch.
    if (!blocked && ncBlocked && nsBlocked) blocked = true;
    // This document's own answer, before the host's history below has its say.
    afpSettleCspVerdict(rec, blocked, ttRestricted, ncBlocked, nsBlocked);
    // [FIX csp-restrictions-learned-per-route] The header rule for this tab follows what the
    // page is about to be told: stood down where the marker will say so.
    if (type === 'main_frame') afpSetSdTab(tabId, blocked || ttRestricted);

    // [FIX one-loose-response-erased-the-whole-origin] These four lists are ADD-ONLY.
    //
    // They used to toggle: a response whose CSP did not carry the restriction removed
    // the host again. One host serves many documents, and they do not all carry the
    // same policy — measured on a two-route local server, one strict and one loose:
    //
    //     after /strict                 ns=["127.0.0.1"]
    //     after /loose   (same host)    ns=[]              <- erased
    //     after /strict again           ns=["127.0.0.1"]
    //
    // claude.ai is exactly that shape, which is why it never stayed recorded and the
    // Turnstile fix did not take on the real site even though it worked in the rig.
    //
    // Add-only because the two errors are not remotely equal. A host wrongly IN the
    // list costs one thing: its workers go unpatched, which is the documented safe
    // outcome. A host wrongly OUT of it costs the SITE — a dead Turnstile worker, a
    // WhatsApp that never boots. The residual is that an origin which genuinely
    // relaxes its CSP stays conservative until storage is cleared; that is the cheap
    // direction to be wrong in.
    // [FIX csp-restrictions-learned-per-route] Per ROUTE (host/segment), not per host —
    // see afpCspScope in defaults.js. Still add-only within a route. A host collapses to
    // one bare entry once three of its routes have restricted and no document of it has
    // been seen loose (afp_csp_mixed): github.com refuses blob: workers everywhere and has
    // a route per repository, and a list that grew with every repository would drag a
    // six-pattern registration behind each; claude.ai, strict on one route and loose on
    // another, is marked mixed by its first loose document and never collapses.
    // The list update itself is afpNoteCspList below, shared with the <meta> path.
    function noteCspHost(loader, key, restricted) { afpNoteCspList(loader, key, restricted, host, scope); }
    noteCspHost(loadCspNoBlob, CSP_NOBLOB_KEY, blocked);
    // The four restrictions are independent — a page can forbid blob: workers and allow
    // any policy name, or the reverse — and mw-workers answers them at different moments,
    // so they cannot share one list.
    noteCspHost(loadCspTt, CSP_TT_KEY, ttRestricted);
    noteCspHost(loadCspNc, CSP_NC_KEY, ncBlocked);
    noteCspHost(loadCspNs, CSP_NS_KEY, nsBlocked);
    noteCspHost(loadCspTte, CSP_TTE_KEY, ttEnforced);
}

/** One add-only list, one route: the rules are in the note above noteCspHost in afpJudgeCsp. */
function afpNoteCspList(loader, key, restricted, host, scope) {
    loader().then(function (list) {
        if (!restricted) {
            if (afpCspHostListed(list, host)) afpMarkCspMixed(host);
            return;
        }
        if (afpCspScopeMatches(list, scope)) return;
        list.push(scope);
        // Written at once — the page's first load is waiting on this — and collapsed
        // in a second write only when there is something to collapse.
        try { chrome.storage.local.set({ [key]: list }); } catch (eS) {}
        loadCspMixed().then(function (mixed) {
            if (mixed.indexOf(host) !== -1) return;
            const routes = list.filter(function (e) { return e.indexOf('/') !== -1 && afpCspScopeHost(e) === host; });
            if (routes.length < 3) return;
            for (let i = list.length - 1; i >= 0; i--) if (routes.indexOf(list[i]) !== -1) list.splice(i, 1);
            if (list.indexOf(host) === -1) list.push(host);
            try { chrome.storage.local.set({ [key]: list }); } catch (eS2) {}
        }, function () {});
    });
}

/**
 * [FIX a-meta-csp-was-never-learned] The learning afpJudgeCsp does for a header, for a policy
 * that arrived as a <meta http-equiv="Content-Security-Policy"> element instead — reported by
 * storage-bridge.js once the document's <head> is parsed.
 *
 * web.telegram.org/a/ sends no CSP header at all; `worker-src 'self'` is a meta element. The
 * observer in afpNoteCsp reads response headers only, so the route was never listed: no
 * noblob.js marker, no `allow` rules, and every new tab rediscovered the policy by spending
 * a worker on it. mw-core now reads the element at read time and keeps that worker alive,
 * but the header half of the stand-down and the marker for the NEXT document are keyed off
 * afp_csp_noblob, which is what this writes.
 *
 * The verdict is afpJudgeCsp's minus its rewrite branch: the per-site rewrite edits headers,
 * and a policy inside the document is out of its reach. Add-only and only for what a meta
 * RESTRICTS — a loose one says nothing about the header its host sends on other documents.
 */
function afpNoteMetaCsp(url, policies, tabId, isTop) {
    let host = '';
    try { host = new URL(url).hostname; } catch (eU) { return; }
    const scope = afpCspScope(url);
    if (!host || !scope) return;
    const all = (Array.isArray(policies) ? policies : []).map(String).filter(Boolean).join(', ');
    if (!all) return;
    const blocked = afpCspBlocksBlobWorkers(all) ||
        (afpCspBlocksBlobConnect(all) && afpCspBlocksBlobScript(all));
    if (!blocked) return;
    afpNoteCspList(loadCspNoBlob, CSP_NOBLOB_KEY, true, host, scope);
    // The rest of THIS tab's requests, as the header path does when the response arrives —
    // here as soon as the <head> has been read. Only a top document moves the tab rule.
    if (isTop) afpSetSdTab(tabId, true);
}

/**
 * [FIX a-meta-csp-was-never-learned] The tab rule for a document that sent NO CSP header.
 * That used to switch the rule off unconditionally, which was right while every listed route
 * had been learned from a header: no header meant a document that did not restrict. A route
 * learned from a <meta> element sends no header on ANY visit, so the rule went off at every
 * response and came back at DOMContentLoaded, and the subresources in between left under the
 * profile while the window stood down. The lists decide here, as they do from the URL in
 * afpSdTabFromUrl; unlike there, "not listed" does turn the rule off, because this document
 * has now answered for itself.
 */
function afpSdTabForRoute(tabId, url) {
    if (typeof tabId !== 'number' || tabId < 0) return;
    const scope = afpCspScope(url);
    if (!scope) { afpSetSdTab(tabId, false); return; }
    Promise.all([loadCspNoBlob(), loadCspTt(), loadCspRewrite()]).then(function (r) {
        const host = afpCspScopeHost(scope);
        const rewritten = Object.prototype.hasOwnProperty.call(r[2] || {}, host);
        afpSetSdTab(tabId, !rewritten && (afpCspScopeMatches(r[0], scope) || afpCspScopeMatches(r[1], scope)));
    }, function () { afpSetSdTab(tabId, false); });
}
// ============================================================
// [FIX csp-rewrite-for-workers] PER-SITE CSP REWRITE — the switch past README "Limits", item 6.
//
// On youtube.com every worker this extension builds is refused: the FIRST of its three
// Content-Security-Policy headers is a script-src allowlist with no blob: and no
// worker-src, so a blob: worker fails that policy whatever the other two say (measured —
// the header triple is quoted in test/background-fns.mjs). The wrapper then hands back the
// native constructors, the page's workers read the machine, and the window stands down to
// agree with them: 18 cores, ru-RU, Europe/Moscow, the real GPU — coherent, and exactly
// what the user did not install this for.
//
// JS cannot change a CSP. declarativeNetRequest can: a `modifyHeaders` rule that SETS the
// response header on that host. The value has to be static, and that is the whole cost of
// this feature, stated up front:
//
//   * A policy with a per-response 'nonce-…' cannot be replayed. Its nonce and its
//     'strict-dynamic' are dropped and 'unsafe-inline' is kept (or added), which is what
//     keeps the page's own nonce-authorised inline scripts running. For youtube.com that
//     policy already carries 'unsafe-inline' and 'https: http:', so what is lost is the
//     nonce-based defence-in-depth — the static allowlist policy beside it stays and still
//     confines external scripts to Google's hosts. A site whose ONLY policy is nonce-based
//     would be opened up further, which is why this is per-site, off by default, and
//     amber in the popup.
//   * Every policy whose effective worker directive lacks blob: gets an explicit
//     `worker-src <its own sources> blob:`. Nothing else in the policy moves; the
//     trusted-types directives in particular are kept — the wrapper handles those on its
//     own (see _ttWrap in mw/mw-workers.js), and dropping them would be a second weakening
//     for nothing.
//
// Idempotent by construction: a rewritten header has no nonce and admits blob:, so
// afpRewriteCsp returns null on it — which is also how the observer below tells "already
// rewritten" from "the site changed its policy".
//
// A host on this list is FORGOTTEN by the two restriction lists the rewrite makes false
// (blob-refusing, trusted-types allowlist) and left out of standDownHosts(), so nothing on
// the page side stands down; the other three (tte, nc, ns) stay true under the rewritten
// header and stay learned. The tab's own `v.ui.wb` / `v.ui.tt` are cleared at toggle time,
// because sessionStorage outlives a reload.
// ============================================================
const CSP_REWRITE_KEY = 'afp_csp_rewrite';   // { host: rewritten header value ('' = not learned yet) }
const AFP_CSP_RULE_BASE = 1200;
const AFP_CSP_RULE_MAX = 100;
let _cspRewrite = null;

async function loadCspRewrite() {
    return afpLoadStored(CSP_REWRITE_KEY, function () { return _cspRewrite; }, function (v) { _cspRewrite = v; }, afpStoredMap);
}
/**
 * Rewrite a document's CSP so that a blob: worker can be created under it.
 *
 * `values` are the header values as received — several headers, each possibly several
 * comma-separated policies. Returns ONE header value carrying every policy, or null when
 * nothing needs to change (no nonce to drop, blob: already admitted everywhere).
 *
 * Pure, so test/background-fns.mjs holds it against youtube.com's real header triple.
 */
function afpRewriteCsp(values, name) {
    const policies = [];
    (Array.isArray(values) ? values : [values]).forEach(function (v) {
        String(v || '').split(',').forEach(function (p) { if (p.trim()) policies.push(p.trim()); });
    });
    // Decide FIRST whether anything has to change, on the policies as sent: a blob: worker
    // refused somewhere, or a trusted-types allowlist that leaves us out. If not, there is
    // no rule to build — and, in particular, a nonce policy that already admits blob:
    // through 'strict-dynamic' keeps its nonce. Once one policy needs the static rule,
    // every nonce in the set has to go, because one `set` replaces the whole header.
    const needs = policies.some(function (p) { return afpPolicyBlocksBlobWorkers(p); }) ||
        policies.some(function (p) { return afpCspRestrictsTrustedTypes(p, name); });
    if (!needs) return null;
    let changed = false;
    const isKeyed = function (s) { return /^'(nonce-|sha(256|384|512)-)/i.test(s); };
    const isDyn = function (s) { return s.toLowerCase() === "'strict-dynamic'"; };
    const out = policies.map(function (policy) {
        const dirs = [];
        policy.split(';').forEach(function (part) {
            const t = part.trim().split(/\s+/).filter(Boolean);
            if (t.length) dirs.push([t[0].toLowerCase(), t.slice(1)]);
        });
        const find = function (n) { for (let i = 0; i < dirs.length; i++) if (dirs[i][0] === n) return dirs[i]; return null; };
        const lower = function (l) { return l.map(function (s) { return s.toLowerCase(); }); };
        // 1. A nonce cannot be replayed by a static rule. Drop it — and 'strict-dynamic',
        //    which trusts nothing without it — and keep 'unsafe-inline' in force, which the
        //    nonce was overriding, so the page's own inline scripts still run.
        dirs.forEach(function (d) {
            if (!/^script-src(-elem|-attr)?$/.test(d[0])) return;
            if (!d[1].some(function (s) { return /^'nonce-/i.test(s); })) return;
            d[1] = d[1].filter(function (s) { return !isKeyed(s) && !isDyn(s); });
            if (lower(d[1]).indexOf("'unsafe-inline'") === -1) d[1].push("'unsafe-inline'");
            changed = true;
        });
        // 2. The effective worker directive must admit blob:. Same fallback chain the
        //    observer reads (afpPolicyBlocksBlobWorkers): worker-src, child-src, script-src,
        //    default-src. A policy that constrains nothing is left constraining nothing.
        const eff = (find('worker-src') || find('child-src') || find('script-src') || find('default-src') || [null, null])[1];
        if (eff && lower(eff).indexOf('blob:') === -1 && lower(eff).indexOf("'strict-dynamic'") === -1) {
            // Keywords that mean nothing in a worker-src, and 'none', which Chrome ignores
            // (with a console warning) as soon as any other source stands beside it.
            const base = eff.filter(function (s) {
                return !isKeyed(s) && !isDyn(s) &&
                    !/^'(report-sample|unsafe-inline|unsafe-eval|unsafe-hashes|none)'$/i.test(s);
            });
            const ws = find('worker-src');
            if (ws) ws[1] = base.concat(['blob:']);
            else dirs.push(['worker-src', base.concat(['blob:'])]);
            changed = true;
        }
        // 2b. [FIX the-switch-created-the-split-it-was-meant-to-close] The wrapper reads the
        //     ORIGINAL worker source with a synchronous XHR before prepending its payload,
        //     and that read is governed by connect-src. Admitting blob: WORKERS without
        //     admitting the READ produces a worker that can be created and cannot be
        //     patched — which is strictly worse than refusing it, because mw-core's
        //     stand-down keys on worker-src and therefore lifts, and the window goes on
        //     claiming a profile its own workers contradict.
        //
        //     github.com is exactly that shape, measured from the live header:
        //
        //         worker-src   github.githubassets.com …          no blob:
        //         connect-src  'self' uploads.github.com …        no blob:
        //         script-src   github.githubassets.com            no blob:
        //
        //     so the switch turned a coherent stand-down into a ten-signal split between
        //     the window and the worker.
        //
        //     connect-src and NOT script-src, deliberately. Reading a blob the page itself
        //     created lets nothing execute; `script-src blob:` would let an injected blob
        //     run, which is a real weakening of exactly the thing a CSP is for. And with
        //     the read available the payload goes in INLINE, so the importScripts fallback
        //     — the one path that needs script-src — is never taken.
        const conn = find('connect-src') || find('default-src');
        if (conn && lower(conn[1]).indexOf('blob:') === -1) {
            const cs = find('connect-src');
            if (cs) { cs[1] = cs[1].concat(['blob:']); }
            else {
                // Inherited from default-src: the same keyword filter step 2 uses, because
                // 'none' beside a real source is ignored with a console warning.
                const cbase = conn[1].filter(function (s) {
                    return !isKeyed(s) && !isDyn(s) &&
                        !/^'(report-sample|unsafe-inline|unsafe-eval|unsafe-hashes|none)'$/i.test(s);
                });
                dirs.push(['connect-src', cbase.concat(['blob:'])]);
            }
            changed = true;
        }
        // 3. A `trusted-types` allowlist that does not name our policy makes the wrapper
        //    stand aside (it cannot mint a TrustedScriptURL without reporting a violation —
        //    see afpCspRestrictsTrustedTypes). One more NAME on the list is the smallest
        //    possible change: the site's own names stay, `require-trusted-types-for` stays,
        //    and only a policy called afp-blob-url becomes creatable. `'none'` is the
        //    keyword for an empty list and is replaced by the name.
        const tt = find('trusted-types');
        if (tt && name) {
            const names = lower(tt[1]);
            if (names.indexOf('*') === -1 && names.indexOf(String(name).toLowerCase()) === -1) {
                tt[1] = tt[1].filter(function (s) { return s.toLowerCase() !== "'none'"; }).concat([String(name)]);
                changed = true;
            }
        }
        return dirs.map(function (d) { return [d[0]].concat(d[1]).join(' '); }).join('; ');
    });
    return changed ? out.join(', ') : null;
}
// [FIX policy-name-was-a-signature] The name mw/mw-workers.js creates its own Trusted
// Types policy under is per SITE now — afpTtPolicyName (seed-lib.js) on the domain seed —
// so every consumer here takes it as an argument, resolved for the host in question.
async function afpTtPolicyNameFor(host) {
    try {
        const st = await chrome.storage.local.get([NOISE_SEED_KEY]);
        const master = st && typeof st[NOISE_SEED_KEY] === 'number' ? (st[NOISE_SEED_KEY] >>> 0) : null;
        if (master === null) return null;
        return afpTtPolicyName(deriveDomainSeed(master, String(host || '')));
    } catch (e) { return null; }
}

/** The document's CSP headers, fetched from the service worker (no cookies, no cache). */
async function afpCspRewriteFetch(url) {
    try {
        const ctrl = new AbortController();
        const kill = setTimeout(function () { ctrl.abort(); }, 8000);
        let res;
        try {
            res = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: ctrl.signal });
        } finally { clearTimeout(kill); }
        // fetch() joins repeated headers with ", " — exactly the separator the parser splits on.
        const v = res.headers.get('content-security-policy');
        return v ? [v] : [];
    } catch (e) { return []; }
}

function afpCspRuleId(i) { return AFP_CSP_RULE_BASE + i; }
function afpCspRuleIds() {
    const ids = [];
    for (let i = 0; i < AFP_CSP_RULE_MAX; i++) ids.push(afpCspRuleId(i));
    return ids;
}

/** One SET rule per learned host, main frames and sub frames of that host only. */
async function applyCspRewriteRules() {
    try {
        const map = await loadCspRewrite();
        const listed = Object.keys(map);
        const hosts = listed.filter(function (h) { return map[h]; }).slice(0, AFP_CSP_RULE_MAX);
        const addRules = hosts.map(function (host, i) {
            return {
                id: afpCspRuleId(i),
                priority: 2,
                action: {
                    type: 'modifyHeaders',
                    responseHeaders: [{ header: 'content-security-policy', operation: 'set', value: map[host] }]
                },
                condition: { requestDomains: [host], resourceTypes: ['main_frame', 'sub_frame'] }
            };
        });
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: afpCspRuleIds(), addRules: addRules });
        // [FIX the-csp-observer-judged-from-a-cache-that-had-not-loaded] Self-heal. A host
        // on this list must not sit on the two lists the rewrite makes false, and until the
        // observer learned to wait for the map it put one back there on every wake — an
        // entry that PERSISTS in storage and keeps noblob.js registered. This runs on every
        // worker start (and every change of the list), so an install that carries such an
        // entry sheds it, and the per-tab flags it left behind are cleared in its open tabs.
        // Nothing is reloaded: the flag freezes at DOMContentLoaded anyway, so the page the
        // user is looking at keeps its answer and the next navigation gets the right one.
        if (listed.length) {
            const removed = await afpForgetCspHosts(listed);
            if (removed.length) {
                await updateNoBlobScript();
                removed.forEach(function (h) { afpClearTabFlags(h, false); });
            }
        }
    } catch (e) { console.warn('[AFP] applyCspRewriteRules:', e && e.message); }
}

/**
 * Take `hosts` out of the two lists the rewrite makes false — blob: workers refused, and a
 * trusted-types allowlist without our name — in storage and in the caches. The other three
 * (TT enforced, no blob: connect, no blob: importScripts) stay true under the rewritten
 * header and stay learned; dropping `tte` is what let a bare-string worker through.
 * Returns the hosts that were actually on one of the lists.
 */
async function afpForgetCspHosts(hosts) {
    // [FIX the-switch-created-the-split-it-was-meant-to-close] CSP_NC_KEY joined the two:
    // step 2b of afpRewriteCsp admits the blob: READ, so a host that is being rewritten is no
    // longer one whose worker source cannot be read — and a stale entry here keeps
    // storage-bridge writing v.ui.nc, which keeps the wrapper passing workers through
    // unpatched while the window no longer stands down. That is the reported split.
    const keys = [CSP_NOBLOB_KEY, CSP_TT_KEY, CSP_NC_KEY];
    const removed = [];
    try {
        const got = await chrome.storage.local.get(keys);
        const patch = {};
        keys.forEach(function (k) {
            const list = Array.isArray(got[k]) ? got[k] : [];
            // Entries are host/segment since [FIX csp-restrictions-learned-per-route]; a host
            // goes with every route of it.
            const kept = list.filter(function (e) { return hosts.indexOf(afpCspScopeHost(e)) === -1; });
            if (kept.length === list.length) return;
            patch[k] = kept;
            list.forEach(function (e) {
                const h = afpCspScopeHost(e);
                if (hosts.indexOf(h) !== -1 && removed.indexOf(h) === -1) removed.push(h);
            });
        });
        if (Object.keys(patch).length) await chrome.storage.local.set(patch);
    } catch (e) {}
    _cspNoBlob = null; _cspTt = null; _cspNc = null;
    return removed;
}
async function afpForgetCspHost(host) { return afpForgetCspHosts([host]); }

/**
 * Clear the two per-tab stand-down flags in every open tab of `host`, optionally reloading
 * them. sessionStorage outlives a navigation, so a flag a page set for itself under the
 * original header would otherwise keep the tab standing down under the rewritten one.
 */
function afpClearTabFlags(host, reload) {
    try {
        Promise.resolve(chrome.tabs.query({})).then(function (tabs) {
            (tabs || []).forEach(function (t) {
                try {
                    if (!t.url || new URL(t.url).hostname !== host) return;
                    chrome.scripting.executeScript({
                        target: { tabId: t.id, allFrames: true },
                        func: function () {
                            ['v.ui.wb', 'v.ui.tt', 'v.ui.nc'].forEach(function (k) {
                                try { sessionStorage.removeItem(k); } catch (e) {}
                            });
                        }
                    }).then(function () { if (reload) return chrome.tabs.reload(t.id); }).catch(function () {});
                } catch (eT) {}
            });
        }).catch(function () {});
    } catch (e) {}
}

/**
 * Called by the observer for a host on the list: keep the rule in step with what the site
 * actually sends. null from the rewriter means the header seen already admits our workers
 * (it is the rewritten one, or the site relaxed) and there is nothing to store.
 */
function afpRelearnCspRewrite(host, headers, name) {
    try {
        const values = [];
        for (let i = 0; i < headers.length; i++) {
            if (String(headers[i].name || '').toLowerCase() === 'content-security-policy') values.push(headers[i].value);
        }
        if (!values.length) return;
        const rw = afpRewriteCsp(values, name);
        if (!rw || rw === _cspRewrite[host]) return;
        const wasPending = !_cspRewrite[host];
        _cspRewrite[host] = rw;
        chrome.storage.local.set({ [CSP_REWRITE_KEY]: _cspRewrite })
            .then(applyCspRewriteRules)
            .then(function () {
                // The switch was flipped but the header could not be fetched then (a consent
                // redirect, a network hiccup), so THIS load was the one that taught us — and
                // it ran under the original header, where the page's own failed worker has
                // already set the tab's `v.ui.wb`. Left alone, that tab stands down until it
                // is closed. Reload the host's tabs once with the flags cleared, so the load
                // that follows is the first one under the rewritten header.
                if (wasPending) afpClearTabFlags(host, true);
            })
            .catch(function () {});
    } catch (e) {}
}

/** The popup's switch. Learns the header on the spot so the reload that follows gets it. */
async function afpToggleCspRewrite(tab) {
    const host = new URL(tab.url).hostname;
    const map = await loadCspRewrite();
    let on = !Object.prototype.hasOwnProperty.call(map, host);
    let rewritten = false, unneeded = false;
    if (on) {
        const values = await afpCspRewriteFetch(tab.url);
        const rw = values.length ? afpRewriteCsp(values, await afpTtPolicyNameFor(host)) : null;
        if (values.length && !rw) {
            // The header was read and it needs nothing: no blob: refusal, no allowlist
            // without us. Switching "on" would change no header and claim to. Say so and
            // stay off — the row was dimmed for this reason, but it can still be clicked.
            unneeded = true;
            on = false;
        } else {
            map[host] = rw || '';   // '' = the observer learns it on the next load
            rewritten = !!rw;
            await afpForgetCspHost(host);
        }
    } else {
        delete map[host];
    }
    if (unneeded) return { host, on: false, rewritten: false, unneeded: true };
    _cspRewrite = map;
    await chrome.storage.local.set({ [CSP_REWRITE_KEY]: map });
    await applyCspRewriteRules();
    // The stand-down lists changed, so the header allow-rules for them follow.
    await updateDynamicLanguageRule();
    afpRebuildSdTabs().catch(function () {});
    await updateNoBlobScript();
    // The per-tab flags the rewrite makes false outlive a reload; without this the reload
    // keeps standing down.
    //
    // [FIX the-switch-created-the-split-it-was-meant-to-close] v.ui.nc joined the list when
    // step 2b of afpRewriteCsp started admitting the blob: READ. Clearing wb and tt while
    // leaving nc set is the worst of both: the window stops standing down (wb gone) and the
    // wrapper still refuses to read the worker source (nc), so the tab the switch was
    // pressed in gets the split the switch was pressed to avoid — until it is closed,
    // because sessionStorage is per tab. v.ui.ns and v.ui.tte stay: the rewrite leaves
    // script-src and require-trusted-types-for exactly as the site sent them.
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: function () {
                ['v.ui.wb', 'v.ui.tt', 'v.ui.nc'].forEach(function (k) {
                    try { sessionStorage.removeItem(k); } catch (e) {}
                });
            }
        });
    } catch (eX) {}
    return { host, on, rewritten, unneeded: false };
}

const CSP_TT_KEY = 'afp_csp_tt';   // hosts whose CSP restricts Trusted Types policy names
let _cspTt = null;

/**
 * The hosts where mw-core stands the window down — the union of both gates.
 *
 * [FIX the-standdown-never-fired] The JS half of the stand-down makes navigator.userAgent
 * and navigator.language answer natively on such an origin, because a worker there reads
 * the machine and cannot be stopped. If DNR went on rewriting the request headers, the
 * contradiction would simply move: the document would ASK in en-US and then report ru-RU
 * from script, which is a disagreement between two channels rather than between two scopes
 * — the same class of signal, and the one [FIX header-vs-js-platform-version-drift] was
 * about. So the header rewrite is skipped for exactly the hosts the window yields on.
 *
 * Both exclusions, and they answer different requests: requestDomains covers the document
 * itself and anything it loads from its own host, initiatorDomains covers everything that
 * page sends anywhere else — including to whatever third party is doing the scoring.
 */
async function standDownScopes() {
    try {
        const [wb, tt, rw] = await Promise.all([loadCspNoBlob(), loadCspTt(), loadCspRewrite()]);
        const hosts = [], routes = [], seen = new Set();
        [].concat(wb || [], tt || []).forEach(function (e) {
            if (typeof e !== 'string' || !e || seen.has(e)) return;
            seen.add(e);
            const i = e.indexOf('/'), h = i < 0 ? e : e.slice(0, i);
            // [FIX csp-rewrite-for-workers] A rewritten host does not stand down.
            if (Object.prototype.hasOwnProperty.call(rw || {}, h)) return;
            if (i < 0) { if (hosts.indexOf(h) === -1) hosts.push(h); } else routes.push({ host: h, seg: e.slice(i + 1) });
        });
        return { hosts, routes };
    } catch (e) { return { hosts: [], routes: [] }; }
}

// [FIX csp-restrictions-learned-per-route] The header side of a per-ROUTE stand-down. The
// 1001/1002 pair exempts a whole host, which is right for a host that stands down whole
// and a contradiction the moment one route does not: the loose document would answer the
// profile from JS and send the machine on the wire. So a stood-down ROUTE is exempted in
// two pieces. Its document requests (main_frame, sub_frame) by URL — a urlFilter carries
// the path, one dynamic rule per route. Its subresources by TAB — DNR has no path for an
// initiator, but it has the tab: one session rule whose tabIds are the tabs whose top
// document currently stands down, kept in step by the observer (afpSetSdTab) on every
// navigation and rebuilt from the open tabs when the worker starts. main_frame/sub_frame
// are left out of the tab rule on purpose: a navigation from a stood-down document to a
// loose route is a main_frame request made while the tab is still listed, and it must be
// spoofed like the document it fetches. Residual: the first subresources of a navigation
// between routes of different strictness go out under the previous document's rule, and
// a loose frame inside a stood-down tab (or the reverse) follows the tab, not itself.
const AFP_SD_ROUTE_RULE_BASE = 5000;
const AFP_SD_ROUTE_MAX = 200;
const AFP_SD_TAB_RULE_ID = 1004;
function afpSdRouteRuleIds() {
    const ids = [];
    for (let i = 0; i < AFP_SD_ROUTE_MAX; i++) ids.push(AFP_SD_ROUTE_RULE_BASE + i);
    return ids;
}
function afpSdRouteRegex(host, seg) {
    const esc = function (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    // An optional port between the host and the path: the rig serves on one, and a
    // regex that forgot it matched testMatchOutcome's port-less URL and no real request.
    return '^https?://([^/]+\\.)?' + esc(host) + '(?::\\d+)?/' + esc(seg) + '(?:[/?#]|$)';
}
async function afpApplySdRouteRules(routes) {
    const addRules = (routes || []).slice(0, AFP_SD_ROUTE_MAX).map(function (r, i) {
        return {
            id: AFP_SD_ROUTE_RULE_BASE + i,
            priority: 3,
            action: { type: 'allow' },
            // The host or a subdomain, then the segment, then a separator or the end —
            // '/seg/x' and '/seg?q' but not '/segment'. A regex and not '||host/seg^':
            // measured on the rig, the urlFilter form let the document request through
            // rule 1000 (an IP host, possibly — DNR gave no error either way).
            condition: { regexFilter: afpSdRouteRegex(r.host, r.seg), resourceTypes: ['main_frame', 'sub_frame'] }
        };
    });
    // Its own call, so that a pattern DNR refuses cannot take rule 1000 down with it.
    try {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: afpSdRouteRuleIds(), addRules });
    } catch (e) { console.warn('[AFP] stand-down route rules:', e && e.message); }
}
// [FIX the-header-half-queued-behind-seven-rebuilds] The route rules on a chain of their own,
// reading the lists at WRITE time. They are the header half of a route's stand-down and the
// one thing a new entry in the CSP lists must move at once, so the storage listener calls this
// directly instead of waiting for a whole rebuild to reach them — and the rebuild calls it too,
// so no writer ever hands them a snapshot older than its own write. Coalesced like the rebuild.
let _sdRouteChain = Promise.resolve();
let _sdRouteWaiting = null;
function afpSyncSdRouteRules() {
    if (_sdRouteWaiting) return _sdRouteWaiting;
    const run = _sdRouteChain.catch(function () {}).then(async function () {
        _sdRouteWaiting = null;
        const scopes = await standDownScopes();
        await afpApplySdRouteRules(scopes.routes);
    });
    _sdRouteWaiting = run;
    _sdRouteChain = run;
    return run;
}
const _sdTabs = new Set();
let _sdTabSync = Promise.resolve();
function afpSetSdTab(tabId, on) {
    if (typeof tabId !== 'number' || tabId < 0) return;
    const had = _sdTabs.has(tabId);
    if (on === had) return;
    if (on) _sdTabs.add(tabId); else _sdTabs.delete(tabId);
    afpSyncSdTabRule();
}
function afpSyncSdTabRule() {
    _sdTabSync = _sdTabSync.then(async function () {
        const ids = Array.from(_sdTabs);
        try {
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [AFP_SD_TAB_RULE_ID],
                addRules: ids.length ? [{
                    id: AFP_SD_TAB_RULE_ID,
                    priority: 3,
                    action: { type: 'allow' },
                    condition: {
                        urlFilter: '*://*/*',
                        tabIds: ids,
                        resourceTypes: AFP_HEADER_RESOURCE_TYPES.filter(function (t) { return t !== 'main_frame' && t !== 'sub_frame'; })
                    }
                }] : []
            });
        } catch (e) { console.warn('[AFP] stand-down tab rule:', e && e.message); }
    });
    return _sdTabSync;
}
// [FIX the-tab-rule-arrived-after-the-first-subresources] The observer sets a tab's
// stand-down from the RESPONSE headers, which is the only way to learn an unknown route —
// and one round trip too late for a route already known: the subresources a navigation
// starts before its headers arrive (a preloaded stylesheet, a script in the head, a
// prefetch) went out under the PREVIOUS document's rule. Between routes of different
// strictness that is the contradiction the route rules exist to remove, moved to the first
// few requests. For a route already on a list the answer is in the URL, so it is decided
// at request time; an unknown route is left to the observer exactly as before, and the
// observer still has the last word on both (a site that relaxed, a rewritten host).
function afpSdTabFromUrl(tabId, url) {
    if (typeof tabId !== 'number' || tabId < 0 || !url) return;
    const scope = afpCspScope(url);
    if (!scope) return;
    Promise.all([loadCspNoBlob(), loadCspTt(), loadCspRewrite()]).then(function (r) {
        const host = afpCspScopeHost(scope);
        if (Object.prototype.hasOwnProperty.call(r[2] || {}, host)) { afpSetSdTab(tabId, false); return; }
        // Only ON: "not on the list" is not yet "this document does not restrict" — the
        // headers may still say so, and turning the rule off here would undo the tab's
        // previous document a moment before the new one has answered for itself.
        if (afpCspScopeMatches(r[0], scope) || afpCspScopeMatches(r[1], scope)) afpSetSdTab(tabId, true);
    }, function () {});
}

/** At worker start the set is empty and the session rule may be stale: rebuild from the open tabs. */
async function afpRebuildSdTabs() {
    try {
        const [tabs, wb, tt, rw] = await Promise.all([chrome.tabs.query({}), loadCspNoBlob(), loadCspTt(), loadCspRewrite()]);
        _sdTabs.clear();
        (tabs || []).forEach(function (t) {
            if (!t || typeof t.id !== 'number' || !/^https?:/.test(t.url || '')) return;
            const scope = afpCspScope(t.url), host = afpCspScopeHost(scope);
            if (Object.prototype.hasOwnProperty.call(rw || {}, host)) return;
            if (afpCspScopeMatches(wb, scope) || afpCspScopeMatches(tt, scope)) _sdTabs.add(t.id);
        });
        await afpSyncSdTabRule();
    } catch (e) {}
}
async function loadCspTt() {
    return afpLoadStored(CSP_TT_KEY, function () { return _cspTt; }, function (v) { _cspTt = v; }, afpStoredList);
}

const CSP_MIXED_KEY = 'afp_csp_mixed';   // hosts seen BOTH restricting and not: never collapsed to a bare entry
let _cspMixed = null;
async function loadCspMixed() {
    return afpLoadStored(CSP_MIXED_KEY, function () { return _cspMixed; }, function (v) { _cspMixed = v; }, afpStoredList);
}
/** A document with no CSP at all, on a host that restricts somewhere: the loose route the collapse must keep. */
function afpNoteLooseDocument(host) {
    Promise.all([loadCspNoBlob(), loadCspTt(), loadCspNc(), loadCspNs()]).then(function (lists) {
        if (lists.some(function (l) { return afpCspHostListed(l, host); })) afpMarkCspMixed(host);
    }, function () {});
}
function afpMarkCspMixed(host) {
    loadCspMixed().then(function (mixed) {
        if (mixed.indexOf(host) !== -1) return;
        mixed.push(host);
        try { chrome.storage.local.set({ [CSP_MIXED_KEY]: mixed }); } catch (e) {}
    }, function () {});
}
const CSP_TTE_KEY = 'afp_csp_tte';  // hosts whose CSP requires TrustedScriptURL at script sinks
let _cspTte = null;

async function loadCspTte() {
    return afpLoadStored(CSP_TTE_KEY, function () { return _cspTte; }, function (v) { _cspTte = v; }, afpStoredList);
}

const CSP_NC_KEY = 'afp_csp_nc';   // hosts whose CSP refuses a blob: fetch/XHR
let _cspNc = null;

async function loadCspNc() {
    return afpLoadStored(CSP_NC_KEY, function () { return _cspNc; }, function (v) { _cspNc = v; }, afpStoredList);
}

const CSP_NS_KEY = 'afp_csp_ns';   // hosts whose CSP refuses importScripts of a blob:
// The six this extension learns by itself, as one list — the options page reads and clears
// them through it, and a seventh learned key added later belongs here rather than in three
// separate places.
const CSP_LEARNED_KEYS = [CSP_NOBLOB_KEY, CSP_TT_KEY, CSP_TTE_KEY, CSP_NC_KEY, CSP_NS_KEY, CSP_MIXED_KEY];
let _cspNs = null;

async function loadCspNs() {
    return afpLoadStored(CSP_NS_KEY, function () { return _cspNs; }, function (v) { _cspNs = v; }, afpStoredList);
}

async function loadCspNoBlob() {
    return afpLoadStored(CSP_NOBLOB_KEY, function () { return _cspNoBlob; }, function (v) { _cspNoBlob = v; }, afpStoredList);
}

// [FIX adblock-mask-contradicted-the-network] mw/mw-adblock.js makes a blocked ad slot read
// as rendered. That is coherent on its own — an empty slot and no network blocking is an
// ordinary combination — but NOT beside a real network-level blocker. Measured on
// theguardian.com, one page, thirteen techniques a real anti-adblock script uses, run in two
// browsers at once:
//
//                                    clean browser      AdGuard + this extension
//   7 DOM reads (offsetHeight, …)    0 detect           0 detect      <- our half works
//   fetch / <img> / <script> to an
//   ad host, window.adsbygoogle      0 detect           4 DETECT      <- nothing here covers it
//   ------------------------------------------------------------------------------
//   total                            0 of 13            4 of 13
//
// So a site that reads both halves sees ad requests being refused while every ad slot on the
// page reports itself rendered at 300x250 — a combination the control proves cannot occur
// naturally. That trades "this user has an ad blocker" (tens of percent of users, nearly no
// entropy) for "this browser contradicts itself", which is the exact bargain the fix inside
// mw-adblock.js was written to undo, arriving again from the network side.
//
// It cannot be fixed by masking more: making the network look unblocked would mean actually
// loading the ads. So the module stands down instead — when a blocker is refusing ad requests,
// both layers say "blocked" and agree.
//
// Browser-wide, not per-host, because an ad blocker is a property of the browser: one
// observation anywhere is enough, and it answers on the FIRST page of every site rather than
// the second. ERR_BLOCKED_BY_CLIENT is what Chrome reports when another extension cancels a
// request; this extension's own rules are all `modifyHeaders` and cancel nothing, so we
// cannot be looking at ourselves.
const AD_NET_PATTERNS = [
    '*://*.doubleclick.net/*', '*://*.googlesyndication.com/*',
    '*://*.googletagservices.com/*', '*://*.adnxs.com/*',
    '*://*.amazon-adsystem.com/*', '*://*.criteo.com/*',
    '*://*.adsrvr.org/*', '*://*.rubiconproject.com/*',
    '*://*.pubmatic.com/*', '*://*.taboola.com/*', '*://*.outbrain.com/*'
];
// Only the timestamp is stored. Freshness is decided where the flag is READ
// (storage-bridge.js, NET_BLOCK_TTL_MS) so there is one definition of "still true" rather
// than a writer and a reader that can disagree about it.
// ============================================================
// EXIT COUNTRY — the one thing this extension could never see about itself
// ============================================================
//
// Every coherence guarantee in this file is INTERNAL: the header agrees with the JS, the
// window agrees with the worker, the cold start agrees with the inject. None of that says
// anything about the axis a fingerprinter actually starts from — the IP the request
// arrives on. A profile claiming Estonia is coherent to the last byte and still wrong if
// the exit node is in Frankfurt, and nothing in 22 test suites can notice, because they
// all measure the browser against itself.
//
// So this asks. One request, to Cloudflare's trace endpoint, which answers with a
// two-letter country and needs no key:
//
//     $ curl https://www.cloudflare.com/cdn-cgi/trace
//     ...
//     loc=EE
//     colo=TLL
//
// WHAT IT COSTS, stated plainly because it is the first outbound request this extension
// has ever made on its own: Cloudflare learns this IP asked, which it would learn from any
// page load behind it anyway. Nothing about the profile, the machine or the browsing is
// sent — the request carries no body and no identifier we add. It runs in the service
// worker, so no page can observe it, and `afp_geocheck` turns it off completely.
//
// It does NOT switch the country by itself. Changing the profile mints a new seed and a
// new visitor id (see the storage.onChanged handler above), so doing that behind the
// user's back would destroy the stable identity the whole extension exists to provide.
// It reports, the popup shows the disagreement, the user decides.
const EXIT_CC_KEY = 'afp_exit_cc';        // 'EE' | '' when unknown
const EXIT_AT_KEY = 'afp_exit_at';        // ms timestamp of the last successful read
const GEOCHECK_KEY = 'afp_geocheck';      // false disables the lookup entirely
const EXIT_TTL_MS = 30 * 60 * 1000;       // a VPN hop is a manual act; half an hour is plenty
const EXIT_URL = 'https://www.cloudflare.com/cdn-cgi/trace';

/**
 * Pull `loc` out of a cdn-cgi/trace body. Pure, so test/background-fns.mjs can hold it
 * against real and malformed payloads instead of only the happy one.
 *
 * Strict on purpose: the value goes on to be compared against COUNTRY_DATA keys, and a
 * lookup that quietly matches nothing is indistinguishable from "no answer" at the call
 * site. Anything that is not exactly two ASCII letters is rejected rather than trimmed
 * into shape. `loc=XX` is what Cloudflare returns when it cannot place the address, and
 * it is not a country — it must not be reported as one.
 */
function afpParseTraceCountry(text) {
    try {
        const m = /(?:^|\n)loc=([A-Za-z]{2})(?:\r?\n|$)/.exec(String(text || ''));
        if (!m) return '';
        const cc = m[1].toUpperCase();
        return cc === 'XX' ? '' : cc;
    } catch (e) { return ''; }
}

let _exitInFlight = null;

/**
 * Read the exit country, at most once per TTL. Returns the cached value on any failure —
 * an offline moment must not erase a reading the popup is about to show, and it must not
 * be reported as "your VPN moved".
 */
async function afpRefreshExitCountry(force) {
    if (_exitInFlight) return _exitInFlight;
    _exitInFlight = (async function () {
        let cached = { cc: '', at: 0 };
        try {
            const got = await chrome.storage.local.get([EXIT_CC_KEY, EXIT_AT_KEY, GEOCHECK_KEY]);
            if (got[GEOCHECK_KEY] === false) return { cc: '', at: 0, off: true };
            cached = { cc: got[EXIT_CC_KEY] || '', at: got[EXIT_AT_KEY] || 0 };
        } catch (e) {}
        if (!force && cached.cc && (Date.now() - cached.at) < EXIT_TTL_MS) return cached;
        try {
            // No cookies, no cache, and a hard timeout: this must never hang a popup open.
            const ctrl = new AbortController();
            const kill = setTimeout(function () { ctrl.abort(); }, 6000);
            let res;
            try {
                res = await fetch(EXIT_URL, {
                    method: 'GET', credentials: 'omit', cache: 'no-store',
                    redirect: 'error', signal: ctrl.signal
                });
            } finally { clearTimeout(kill); }
            if (!res || !res.ok) return cached;
            const cc = afpParseTraceCountry(await res.text());
            if (!cc) return cached;
            const fresh = { cc: cc, at: Date.now() };
            try { await chrome.storage.local.set({ [EXIT_CC_KEY]: cc, [EXIT_AT_KEY]: fresh.at }); } catch (eS) {}
            return fresh;
        } catch (e) {
            return cached;   // offline, aborted, blocked — the last known reading stands
        }
    })().finally(function () { _exitInFlight = null; });
    return _exitInFlight;
}

const NET_BLOCK_KEY = 'afp_netblock_seen';
let _netBlockWrittenAt = 0;

function afpNoteNetBlock(details) {
    try {
        if (!/ERR_BLOCKED_BY_CLIENT|ERR_BLOCKED_BY_ADMINISTRATOR/.test(String(details.error || ''))) return;
        const now = Date.now();
        // One storage write per hour at most: a page can produce dozens of blocked ad
        // requests, and the value being written is the same coarse fact every time.
        if (now - _netBlockWrittenAt < 60 * 60 * 1000) return;
        _netBlockWrittenAt = now;
        chrome.storage.local.set({ [NET_BLOCK_KEY]: now });
    } catch (e) {}
}

/** Learn from an `Accept-CH` / `Critical-CH` response which hints an origin wants. */
function afpNoteAcceptCH(details) {
    try {
        const headers = details.responseHeaders || [];
        let tokens = '';
        for (let i = 0; i < headers.length; i++) {
            const n = String(headers[i].name || '').toLowerCase();
            if (n === 'accept-ch' || n === 'critical-ch') tokens += ',' + (headers[i].value || '');
        }
        if (!tokens) return;
        const asked = tokens.toLowerCase().split(',')
            .map(function (s) { return s.trim().replace(/^"|"$/g, ''); })
            .filter(function (s) { return Object.prototype.hasOwnProperty.call(AFP_CH_HINTS, s); });
        if (!asked.length) return;

        let host = '';
        try { host = new URL(details.url).hostname; } catch (eU) { return; }
        if (!host) return;

        loadChOptIn().then(function (optIn) {
            // Whether this host was in the map AT ALL before this response. Read before the
            // lists below are mutated, or it is always true; and per HOST, not per hint — a
            // host already known for one hint is not a new origin because it asks for a second.
            let known = false;
            for (const h in optIn) {
                if (Object.prototype.hasOwnProperty.call(optIn, h) &&
                    Array.isArray(optIn[h]) && optIn[h].indexOf(host) !== -1) { known = true; break; }
            }
            let changed = false;
            for (let i = 0; i < asked.length; i++) {
                const hint = asked[i];
                if (!optIn[hint]) optIn[hint] = [];
                if (optIn[hint].indexOf(host) === -1) { optIn[hint].push(host); changed = true; }
            }
            if (!changed) return;
            try { chrome.storage.local.set({ [CH_OPTIN_KEY]: optIn }); } catch (eS) {}
            // [FIX the-first-request-after-accept-ch-lost-its-hints] The coalesce was
            // unconditional, and on a host nobody had heard of it WAS the window. Measured
            // on one rig, clean Chromium 141 beside the same binary with this build, one
            // origin answering Accept-CH, timestamps from the server:
            //
            //     clean   /?n1        t+7ms    no hints (not opted in yet — correct)
            //             /favicon    t+30ms   arch "x86" bitness "64" model "" wow64 ?0
            //                                  platform-version ""
            //     ours    /?n1        t+15ms   no hints
            //             /favicon    t+103ms  ALL FIVE ABSENT
            //                                  per-origin rules landed at t+325ms
            //
            // — so the whole first page load on a new origin went out stripped where a clean
            // browser was already answering, and ~310ms of that ~325ms was this timer. A new
            // host now rebuilds at once; one extra DNR write costs 1.5-2.9ms measured warm in
            // the live worker. The timer stays for a host already in the map, which is the
            // case it was written for: one page carrying Accept-CH on many subresources.
            //
            // What is left is not zero: response -> browser process -> this observer ->
            // loadChOptIn (a microtask warm, a storage read cold) -> updateDynamicRules
            // (~3ms warm), plus an unbounded wake if the worker was asleep. And Chrome's
            // Critical-CH retry is outside all of it — measured arriving 7ms after the first
            // response on clean and 25ms here, issued by the network stack, with no blocking
            // hook in MV3 to sit in front of it. That residue is README "Limits", item 23.
            if (!known) {
                if (_chRebuildTimer) { clearTimeout(_chRebuildTimer); _chRebuildTimer = null; }
                rebuildClientHintRules();
                return;
            }
            // Coalesce: a page can carry Accept-CH on many subresources at once, and each
            // rebuild is a full DNR write.
            if (_chRebuildTimer) clearTimeout(_chRebuildTimer);
            _chRebuildTimer = setTimeout(function () {
                _chRebuildTimer = null;
                rebuildClientHintRules();
            }, 300);
        });
    } catch (e) {}
}

try {
    // Observation only — MV3 has no blocking webRequest, and none is needed: the rewriting
    // is still DNR's job, this listener only decides WHERE it is allowed to apply.
    chrome.webRequest.onHeadersReceived.addListener(
        afpNoteAcceptCH, { urls: ['<all_urls>'] }, ['responseHeaders']
    );
    chrome.webRequest.onHeadersReceived.addListener(
        afpNoteCsp, { urls: ['<all_urls>'] }, ['responseHeaders']
    );
    // [FIX the-tab-rule-arrived-after-the-first-subresources] Before the response, for a
    // route whose answer is already known — see afpSdTabFromUrl.
    chrome.webRequest.onBeforeRequest.addListener(function (d) {
        try { if (d.type === 'main_frame') afpSdTabFromUrl(d.tabId, d.url); } catch (e) {}
    }, { urls: ['<all_urls>'], types: ['main_frame'] });
    chrome.tabs.onRemoved.addListener(function (tabId) {
        afpForgetCspVerdicts(tabId);
        afpSetSdTab(tabId, false);
    });
    chrome.webRequest.onErrorOccurred.addListener(
        afpNoteNetBlock, { urls: AD_NET_PATTERNS }
    );
} catch (eWR) { console.warn('[AFP] webRequest observer:', eWR.message); }

// Kept under its old name because several call sites schedule it after a profile change;
// the values inside the per-origin rules come from the profile, so they need the same
// refresh the other rules get.
async function updateDynamicDeviceRule() {
    await rebuildClientHintRules();
}
// [FIX dnr-rules-were-a-snapshot-that-could-outlive-the-build]
//
// Dynamic DNR rules PERSIST — across page loads, across a service-worker restart, and
// across reloading an unpacked extension. Both rules below carry a snapshot of the profile
// (the OS-version claim, device-memory, dpr), and they were rebuilt from only three places:
// chrome.runtime.onStartup, chrome.runtime.onInstalled, and a country change. A user who
// reloads the extension without restarting Chrome and without touching a setting therefore
// keeps whatever the rule said before — indefinitely.
//
// Measured on a real Chrome with the extension live: the header claimed
// sec-ch-ua-platform-version "10.0.0" while the page's own getHighEntropyValues() answered
// "15.0.0", on the same request. The service worker itself resolves the host correctly
// (getHighEntropyValues -> 19.0.0 -> bucket 15.0.0, verified), so nothing was computing the
// wrong value — the rule was simply older than the build that fixed it, from back when
// '10.0.0' was hardcoded.
//
// Re-deriving both rules whenever this worker starts closes that window: an MV3 worker
// spins up on essentially any extension event, so the rules cannot lag the profile by more
// than one wake. Errors are swallowed for the same reason the listeners above swallow
// them — a failed rule refresh must not take the worker down with it.
// The OS reading is resolved BEFORE the rules are built, not concurrently with them. That
// ordering is the whole point: afpPlatformVersion caches the first genuine answer, so
// waiting for it here means the rule is written from the same value the pages will get
// rather than from whichever of the two resolved first. If the reading is unavailable on
// this wake the rule still gets the Windows 10 default — but the next wake retries, and one
// success fixes it permanently, because the value is then in storage.
(async function () {
    try { await pruneStaleDynamicRules(); } catch (e) {}
    try { await afpPlatformVersion(); } catch (e) {}
    try { await afpHostArchNative(); } catch (e) {}
    try { await updateDynamicLanguageRule(); } catch (e) {}
    // [FIX csp-rewrite-for-workers] Loads the map (the observer reads it synchronously) and
    // re-applies the rules, which dynamic rules would have kept anyway — idempotent.
    try { await applyCspRewriteRules(); } catch (e) {}
    try { await updateDynamicDeviceRule(); } catch (e) {}
})();
