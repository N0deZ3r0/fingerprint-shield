// Static analysis for this extension. Scope is deliberately narrow: find code that
// cannot run, and nothing else. Style rules are off — the codebase is plain ES5-ish
// JS on purpose (no build step, MAIN-world injection), and churning it for style
// would risk the very kind of drift that fingerprint bugs hide in.
//
// Why this exists: the dead-code pass before it was done with grep, which cannot tell
// a dead variable from a NAMED FUNCTION EXPRESSION assigned onto a prototype. Those
// names are load-bearing here — _mn builds the native-looking toString out of fn.name,
// so `function getImageData(...)` must keep its name. grep reported 40+ such false
// positives; a real scope analyser reports none.
module.exports = [
  // A block with ONLY `ignores` is the global one; the same key inside a block that also
  // names `files` merely excludes paths from THAT block, which is how the vendored fixtures
  // went on being parsed after the first attempt at this.
  //
  // test/fixtures/creepjs/ is a THIRD PARTY's code, kept unmodified so that test/creepjs.mjs
  // runs their checks rather than a paraphrase of them. Linting it would only invite editing
  // it, and an edited copy is this project marking its own homework.
  { ignores: ['test/fixtures/**'] },
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'devpages/**', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        location: 'readonly', self: 'readonly', globalThis: 'readonly',
        chrome: 'readonly', console: 'readonly', fetch: 'readonly',
        // Used by afpRefreshExitCountry to put a hard timeout on the one outbound request
        // the service worker makes — a hung fetch must not hang a popup open.
        AbortController: 'readonly',
        sessionStorage: 'readonly', localStorage: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        Worker: 'readonly', SharedWorker: 'readonly', OffscreenCanvas: 'readonly',
        URL: 'readonly', Blob: 'readonly', FileReader: 'readonly',
        XMLHttpRequest: 'readonly', WebAssembly: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly',
        trustedTypes: 'readonly', performance: 'readonly',
        Intl: 'readonly', Notification: 'readonly', Image: 'readonly',
        ImageData: 'readonly', DOMRect: 'readonly', DOMRectReadOnly: 'readonly', Proxy: 'readonly',
        // Constructed deliberately in mw-workers: a refusal has to BE a DOMException, not
        // merely read like one — a page checks instanceof and .code.
        DOMException: 'readonly',
        CSSStyleDeclaration: 'readonly',
        Reflect: 'readonly', WeakSet: 'readonly', WeakMap: 'readonly',
        CustomEvent: 'readonly', BroadcastChannel: 'readonly',
        HTMLCanvasElement: 'readonly', CanvasRenderingContext2D: 'readonly',
        // afp-console-check.js reaches for createValueRange on it — Chrome 152's
        // OpaqueRange entry point. See [FIX opaque-range-rects-were-never-noised].
        HTMLInputElement: 'readonly',
        // audit.html reads the media-query surface the same way dev-mediaparity.html does,
        // and it is an extension page rather than a content script, so it reaches these
        // through the ordinary window rather than through a captured reference.
        matchMedia: 'readonly', getComputedStyle: 'readonly',
        // mw/mw-adblock.js masks the visibility surface, and offset*/offsetParent live on
        // HTMLElement.prototype while client*/getClientRects live on Element.prototype
        // (measured — the split is why both names are needed).
        HTMLElement: 'readonly',
        OffscreenCanvasRenderingContext2D: 'readonly', TextMetrics: 'readonly',
        WebGLRenderingContext: 'readonly', WebGL2RenderingContext: 'readonly',
        // WebGPU interface objects. Both are [SecureContext] and absent on http origins,
        // which is why every use of them is behind a typeof guard.
        GPU: 'readonly', GPUAdapterInfo: 'readonly', MediaCapabilities: 'readonly',
        // Worker-scope interface, referenced inside payload shims that only ever run there.
        WorkerLocation: 'readonly',
        AnalyserNode: 'readonly', AudioBuffer: 'readonly',
        PermissionStatus: 'readonly', MediaDevices: 'readonly',
        SpeechSynthesis: 'readonly', NavigatorUAData: 'readonly',
        NetworkInformation: 'readonly', BatteryManager: 'readonly',
        Screen: 'readonly', Navigator: 'readonly', Element: 'readonly',
        FontFaceSet: 'readonly', FontFace: 'readonly', Geolocation: 'readonly',
        Performance: 'readonly', RTCPeerConnection: 'readonly',
        screen: 'readonly', Range: 'readonly', EventTarget: 'readonly', Event: 'readonly',
        // Chrome 152's OpaqueRange — the range over a form control's VALUE, returned by
        // createValueRange. Guarded with `typeof` everywhere it is used, because every
        // browser the suite runs against is older than it; declared here because the
        // guard's own second half is a direct reference. See
        // [FIX opaque-range-rects-were-never-noised] in mw/mw-misc.js.
        OpaqueRange: 'readonly',
        devicePixelRatio: 'readonly', getComputedStyle: 'readonly', Node: 'readonly',
        MutationObserver: 'readonly', Temporal: 'readonly',
        PluginArray: 'readonly', Plugin: 'readonly', MimeTypeArray: 'readonly',
        MimeType: 'readonly', SpeechSynthesisVoice: 'readonly',
        AudioContext: 'readonly', OfflineAudioContext: 'readonly',
        DOMRectList: 'readonly', ImageBitmap: 'readonly',
        MediaQueryList: 'readonly', TextMetrics: 'readonly',
        // mw-timezone-screen clamps width/height on VisualViewport.prototype rather than
        // on the instance — see [FIX visualviewport-clamp-sat-on-the-instance].
        VisualViewport: 'readonly',
        HTMLIFrameElement: 'readonly',
        module: 'writable', require: 'readonly', __dirname: 'readonly',
        importScripts: 'readonly', postMessage: 'readonly', close: 'readonly',
        onmessage: 'writable', onconnect: 'writable',
        // extension-internal globals, published by one file and read by another
        AFP_DEFAULT_FEATURES: 'readonly', AFP_DEFAULT_PROFILE: 'readonly',
        // Read by background.js buildProfile through afpResolveDpr; declared in defaults.js.
        AFP_PROFILE_DPR: 'readonly',
        // Shared per-site host matching, defaults.js — read by background.js.
        afpHostMatches: 'readonly',
        // afpHostListToggle is the toggle half of the same rule — see
        // [FIX the-switch-read-with-a-suffix-match-and-toggled-with-an-exact-one].
        afpHostListToggle: 'readonly',
        afpCspScope: 'readonly',
        afpCspScopeHost: 'readonly',
        afpCspScopeMatches: 'readonly',
        afpCspHostListed: 'readonly',
        afpTtPolicyName: 'readonly',
        afpMergeFeatures: 'readonly', afpCloneFeatures: 'readonly', afpPackFeatures: 'readonly',
        // afpPersistSelection writes v.ui.m / v.ui.f only when they are NOT the defaults,
        // and afpPackedIfNotDefault is the same decision for background.js, which cannot
        // call the writer (its function is serialised into the page). Both live in
        // defaults.js — see [FIX default-config-still-left-two-keys].
        afpPersistSelection: 'readonly', afpPackedIfNotDefault: 'readonly',
        // seed-lib.js — loaded by importScripts in background.js and as an ISOLATED
        // content script ahead of storage-bridge.js, so both read them as globals.
        // afpEffectiveHostname joined them when dyn/boot.js became a third consumer.
        registrableDomain: 'readonly', deriveDomainSeed: 'readonly',
        afpEffectiveHostname: 'readonly',
        // afpDeviceState resolves battery + the geolocation offset from the MASTER seed,
        // for background.js buildProfile and (through the generated dyn/seedlib.js copy)
        // dyn/boot.js — see [FIX device-state-was-per-domain].
        afpDeviceState: 'readonly',
        AFP_SCHEMA_VERSION: 'readonly', AFP_SCHEMA_KEY: 'readonly', afpMigrateStorage: 'readonly',
        // The one list of media features @media and matchMedia may disagree about —
        // defaults.js, read by audit.js and by dev-mediaparity.html. Two copies of it had
        // already drifted when it was hoisted; see its header there.
        AFP_MEDIA_PARITY_TRADE: 'readonly',
      },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      // the whole point of running this
      'no-unused-vars': ['error', {
        vars: 'all',
        args: 'none',                 // wrapper signatures must mirror the native arity
        varsIgnorePattern: '^_unused',
        caughtErrors: 'none',         // catch(e){} with an empty body is used everywhere
      }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-self-assign': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty': 'off',              // catch(e){} is the house style for "never throw"
      'no-undef': 'error',
    },
  },
];
