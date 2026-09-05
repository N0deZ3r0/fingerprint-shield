/**
 * AFP / Fingerprint Shield — paste into page DevTools console (F12).
 * Run on a normal https page with the extension enabled, after reload.
 */
/**
 * What a PAGE can still see of the selection. Shared shape with
 * afp-full-console-check.js and afp-parity-console.js — keep the three in step.
 *
 * [FIX self-check-still-read-the-removed-attributes] This used to rebuild the profile
 * from data-v-tz/-lc/-md/-ft and return null when data-v-tz was missing. Nothing writes
 * a data-v-* attribute any more ([FIX bridge-attributes-were-an-extension-detector]),
 * so it returned null on every page — the "selection published" row failed on a fully
 * working extension and all 5 profile comparisons below were skipped in silence.
 *
 * There is deliberately NO page-visible copy of the machine now: the profile lives in
 * the mw/mw-core.js closure. So this returns only what genuinely survives in the page
 * realm and is INDEPENDENT of the APIs being checked — the mode and the feature flags,
 * both out of sessionStorage. Hardware and locale are not reference values any more and
 * are reported below rather than compared against themselves.
 */
function afpPageState() {
  const ss = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  // Bit order is the key order of AFP_DEFAULT_FEATURES in defaults.js, which is what
  // afpPackFeatures wrote into 'v.ui.f'. Inlined because this file is pasted into a
  // page and cannot import — keep it in step with defaults.js (13 keys, no 'audio').
  const FEAT_KEYS = ['canvas', 'webgl', 'webrtc', 'navigator', 'screen', 'timezone',
    'geolocation', 'battery', 'fonts', 'clientRects', 'plugins', 'network', 'hideAdBlocker'];
  // [FIX self-check-required-keys-the-extension-stops-writing] ABSENCE IS A VALUE HERE.
  // [FIX default-config-still-left-two-keys] made the extension write 'v.ui.m' only when
  // the mode is stealth and 'v.ui.f' only when the flags are NOT the defaults, because a
  // clean Chrome stores nothing at all on a fresh origin and a key that merely repeats the
  // default is a free detector. Every reader inside the extension already treats a missing
  // key as "the default" — on the first load of a tab that is the only thing there is.
  //
  // These checks did not, so a default install (normal mode, default flags — i.e. a fresh
  // one) reported `mode ?` and `feature flags readable FAIL` against a perfectly correct
  // build. Same rot as the chrome.runtime row below, and the same cost: a user following
  // README.txt sees red where there is nothing wrong.
  //
  // The defaults literal is a third hand-maintained copy, so test-defaults.cjs pins it to
  // defaults.js like the other two — this file is pasted into a page and cannot import.
  const FEAT_DEFAULTS = {
    canvas: true, webgl: true, webrtc: true, navigator: true, screen: true,
    timezone: true, geolocation: true, battery: true, fonts: true,
    clientRects: false, plugins: true, network: true, hideAdBlocker: true
  };
  let features = null;
  let featSource = 'default (no v.ui.f — the flags are unchanged)';
  const packed = ss('v.ui.f');
  if (packed) {
    const bits = parseInt(packed, 36);
    if (isFinite(bits)) {
      features = {};
      FEAT_KEYS.forEach((k, i) => { features[k] = !!(bits & (1 << i)); });
      featSource = 'v.ui.f=' + packed;
    }
  }
  if (!features) features = Object.assign({}, FEAT_DEFAULTS);
  // A malformed 'v.ui.f' is still a fault — that one is reported by featBad.
  const featBad = !!packed && featSource.indexOf('v.ui.f=') !== 0;
  return {
    mode: ss('v.ui.m') || 'normal',
    modeSource: ss('v.ui.m') ? 'v.ui.m' : 'default (no v.ui.m — normal)',
    features, featSource, featBad, featKeys: FEAT_KEYS
  };
}

/**
 * The CPU performance tier the profile implies. A hand copy of _cpuTier in mw/mw-core.js,
 * the way FEAT_DEFAULTS above is a hand copy of defaults.js and for the same reason: this
 * file is pasted into a page and cannot import. test/parity-static.mjs compares the two
 * bodies, so the copy cannot drift silently.
 */
function afpCpuTier(cores, mem) {
    var c = Number(cores) || 0;
    var m = Number(mem) || 0;
    if (c >= 12 && m >= 16) return 4;
    if (c >= 8 && m >= 8) return 3;
    if (c >= 4) return 2;
    return 1;
}

(async function AFPCheck() {
  const out = [];
  const ok = (name, pass, detail) => {
    out.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
  };

  // --- what the page can know about the selection ---
  //
  // [FIX profile-readable-by-any-page] This used to read the whole profile out of
  // sessionStorage['v.ui.s'] — and that it COULD is exactly what got fixed: the profile
  // lives in the mw/mw-core.js closure now. A console script runs in the page realm, so
  // it gets what a page gets, which is the bridge attributes dyn/boot.js publishes on
  // <html>. Those carry the machine and the locale, i.e. everything the comparisons
  // below actually compare against; fields they do not carry get no expectation and
  // their checks are skipped, exactly as they already were before a profile was applied.
  const prof = afpPageState();
  ok('profile is NOT readable from the page', !sessionStorage.getItem('v.ui.s'),
    sessionStorage.getItem('v.ui.s') ? 'v.ui.s is populated — regression' : 'v.ui.s empty');
  // [FIX bridge-attributes-were-an-extension-detector] A clean browser leaves ZERO
  // attributes on <html>, so any of ours would announce the extension to the first
  // script that looked. This row used to assert the opposite — that the selection WAS
  // published there — which is now precisely the regression to watch for.
  const htmlAttrs = document.documentElement.getAttributeNames();
  ok('<html> carries no extension attributes', htmlAttrs.length === 0,
    htmlAttrs.length ? 'leaks: ' + htmlAttrs.join(',') : 'bare, as in a clean browser');

  const mode = prof.mode;
  ok('mode', mode === 'normal' || mode === 'stealth', mode + ' — ' + prof.modeSource);
  // The flags survive a reload in 'v.ui.f' — but ONLY when they are not the defaults, so a
  // missing key resolves to the defaults rather than failing. What is still a fault is a
  // key that exists and does not parse. See the note in afpPageState.
  const featOff = prof.featKeys.filter((k) => !prof.features[k]);
  ok('feature flags resolved', !prof.featBad,
    (featOff.length ? 'off: ' + featOff.join(',') : 'all on') + ' — ' + prof.featSource);

  // --- navigator ---
  ok('navigator.webdriver false/undefined', navigator.webdriver !== true, String(navigator.webdriver));
  // [FIX self-check-still-read-the-removed-attributes] These five used to read the
  // machine off data-v-hw and compare the live API against it. That attribute is gone on
  // purpose and there is no page-visible copy of the machine left, so the comparison has
  // no reference: written as `navigator.x === prof.x` where prof.x WAS navigator.x, it
  // could only ever pass. Reported as values instead — a check that cannot fail is worse
  // than no check, because it reads as verification.
  ok('hardwareConcurrency (no page-side reference)', true, String(navigator.hardwareConcurrency));
  ok('deviceMemory (no page-side reference)', true, String(navigator.deviceMemory));
  ok('platform (no page-side reference)', true, String(navigator.platform));
  ok('language (no page-side reference)', true,
    navigator.language + ' | ' + (navigator.languages || []).slice(0, 3).join(','));

  // --- timezone ---
  // No profile reference either; what IS checkable without one is that the zone resolves
  // and that navigator.language's region agrees with it, which is the mismatch a
  // detector actually looks for.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    ok('timezone resolves', !!tz && tz !== 'UTC', String(tz));
  } catch (e) {
    ok('timezone resolves', false, e.message);
  }

  // --- screen ---
  ok('screen (no page-side reference)', true,
    screen.width + 'x' + screen.height + ' @' + devicePixelRatio);

  // --- WebGL ---
  let mainRenderer = null, mainVendor = null;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      mainVendor = gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
      mainRenderer = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      ok('WebGL context', true, mainRenderer);
      const maskedV = gl.getParameter(gl.VENDOR);
      const maskedR = gl.getParameter(gl.RENDERER);
      ok('WebGL masked Vendor≈WebKit', /WebKit/i.test(String(maskedV)), maskedV);
      ok('WebGL masked Renderer≈WebKit', /WebKit/i.test(String(maskedR)), maskedR);
      // [FIX self-check-still-read-the-removed-attributes] The two UNMASKED strings used
      // to be compared against data-v-hw's glVendor/glRenderer. Same story as the
      // hardware rows above: no page-visible reference survives, and both branches had
      // already gone inert because the helper left the fields undefined. Reported, and
      // checked for the one thing that needs no reference — that they are not the
      // software rasteriser a headless browser falls back to.
      if (mode === 'normal') {
        ok('WebGL UNMASKED not SwiftShader/llvmpipe',
          !/SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(String(mainRenderer)),
          mainVendor + ' | ' + mainRenderer);
      }
      if (mode === 'stealth') {
        ok('WebGL stealth: UNMASKED left native (parity)', true, mainRenderer);
      }
    } else {
      ok('WebGL context', false, 'no webgl');
    }
  } catch (e) {
    ok('WebGL', false, e.message);
  }

  // --- Worker WebGL parity (hasBadWebGL) ---
  try {
    const workerCode = `
      self.onmessage = function() {
        try {
          var c = new OffscreenCanvas(1,1);
          var gl = c.getContext('webgl');
          if (!gl) { self.postMessage({ err: 'no gl' }); return; }
          var ext = gl.getExtension('WEBGL_debug_renderer_info');
          var r = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
          var v = gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
          self.postMessage({ renderer: r, vendor: v });
        } catch (e) { self.postMessage({ err: String(e) }); }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const workerRenderer = await new Promise((resolve) => {
      const w = new Worker(url);
      const t = setTimeout(() => { try { w.terminate(); } catch (e) {} resolve({ err: 'timeout' }); }, 3000);
      w.onmessage = (ev) => { clearTimeout(t); try { w.terminate(); } catch (e) {} resolve(ev.data); };
      w.postMessage(1);
    });
    URL.revokeObjectURL(url);
    if (workerRenderer.err) {
      ok('Worker WebGL', false, workerRenderer.err);
    } else {
      ok('hasBadWebGL should be false',
        mainRenderer != null && workerRenderer.renderer === mainRenderer,
        'main: ' + mainRenderer + ' | worker: ' + workerRenderer.renderer);
    }
  } catch (e) {
    ok('Worker WebGL parity', false, e.message);
  }

  // --- canvas noise signal ---
  try {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f0f';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#000';
    ctx.font = '16px Arial';
    ctx.fillText('AFP', 4, 20);
    const a = ctx.getImageData(0, 0, 64, 64).data;
    const b = ctx.getImageData(0, 0, 64, 64).data;
    let same = true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
    ok('canvas getImageData stable (same seed)', same, same ? 'stable' : 'unstable between reads');
  } catch (e) {
    ok('canvas', false, e.message);
  }

  // --- toString native-ish ---
  try {
    const s = Function.prototype.toString.call(navigator.permissions && navigator.permissions.query
      ? navigator.permissions.query : HTMLCanvasElement.prototype.getContext);
    ok('sample toString looks native or callable', typeof s === 'string', s.slice(0, 60));
  } catch (e) {
    ok('toString probe', true, 'skipped');
  }

  // --- chrome runtime (CreepJS hasBadChromeRuntime) ---
  // [FIX self-check-demanded-the-stub-that-was-removed] This asserted chrome.runtime was
  // PRESENT, which is the opposite of what the extension should produce. Real Chrome
  // exposes app/csi/loadTimes to an ordinary page and no `runtime` — a page sees that
  // property only when some extension declares externally_connectable for its origin. The
  // stub we used to install was therefore an anti-detect signature, and it was removed on
  // purpose ([FIX we-invented-a-chrome-runtime-...] in mw/mw-core.js). Measured on a real
  // Chrome 151 with this extension live: Object.getOwnPropertyNames(window.chrome) is
  // exactly ["loadTimes","csi","app"]. So this check reported FAIL on a correct build and
  // would have gone green on the bug.
  try {
    const cr = window.chrome && window.chrome.runtime;
    ok('chrome.runtime absent (real Chrome has app/csi/loadTimes only)', !cr,
      cr ? 'present — the removed stub is back' : 'absent');
  } catch (e) {
    ok('chrome.runtime', false, e.message);
  }

  // --- UA-CH platformVersion lock ---
  try {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      const he = await navigator.userAgentData.getHighEntropyValues(['platformVersion', 'architecture']);
      // [FIX self-check-still-pinned-platformVersion-to-win10] The OS claim follows the
      // HOST now — background.js afpPlatformVersion() answers WIN11_PLATFORM_VERSION
      // ('15.0.0') on Windows 11 and '10.0.0' otherwise, and the DNR header sends the
      // same bucket. Pinned to '10.0.0', this row failed on every Windows 11 machine
      // while the extension was doing the right thing.
      ok('UA-CH platformVersion is a shipped bucket',
        he.platformVersion === '10.0.0' || he.platformVersion === '15.0.0', he.platformVersion);
    } else {
      ok('UA-CH', false, 'userAgentData missing');
    }
  } catch (e) {
    ok('UA-CH', false, e.message);
  }

  // --- CPU performance tier (Chrome 152 and newer) ---
  //
  // navigator.cpuPerformance is an integer 1..4 (0 means "could not classify") that
  // Chrome computes from the REAL processor, and it does not move when the profile does.
  // The extension derives it from the profile's cores and memory instead — see
  // [FIX cpu-performance-tier-was-the-host-machine] in mw/mw-core.js — so on a patched
  // page it must be the tier those two reported values imply. Unpatched, this row reads
  // the machine sitting under the profile.
  //
  // Skipped rather than failed on a browser without the property: every Chromium the
  // suite drives is older than 152, and the extension deliberately does not invent it
  // there.
  try {
    if (typeof Navigator === 'undefined' || !('cpuPerformance' in Navigator.prototype)) {
      ok('CPU tier follows the profile', true,
        'skipped — no navigator.cpuPerformance in this browser (Chrome 152+)');
    } else if (!prof.features.navigator) {
      ok('CPU tier follows the profile', true, 'skipped — the navigator switch is off');
    } else {
      const cores = navigator.hardwareConcurrency, mem = navigator.deviceMemory;
      const want = afpCpuTier(cores, mem);
      const got = navigator.cpuPerformance;
      ok('CPU tier follows the profile', got === want,
        got + ' for ' + cores + ' cores / ' + mem + ' GB (the profile implies ' + want + ')');
    }
  } catch (e) {
    ok('CPU tier follows the profile', false, e.message);
  }

  // --- form-value rects (Chrome 152 and newer) ---
  //
  // OpaqueRange, new in Chrome 152, measures the text inside a form control and is
  // neither an Element nor a Range, so it needed its own patch — see
  // [FIX opaque-range-rects-were-never-noised] in mw/mw-misc.js. No rig on this machine
  // can reach that path (Chromium 151 has no OpaqueRange, and branded Chrome refuses
  // --load-extension), which is why the check lives here, in the browser the user runs.
  //
  // [FIX rect-check-used-a-grid-that-moves-with-the-zoom] The first version of this row
  // asked whether a field had left Blink's 1/64 px layout grid, reasoning that the noise
  // snaps to a finer 1/4096 and would therefore knock it off. That is true at page scale
  // exactly 1 and false everywhere else. Measured live on a real Chrome 152 window at
  // devicePixelRatio 1.5, where the page is scaled by 0.9997958 and NOTHING lands on
  // 1/64: an entirely un-noised rect showed all four fields "off the 1/64 grid", so the
  // row passed on the very build whose bug it was written for.
  //
  // The grid that does not move is the one the noise itself imposes. _bcrNoise ends in
  // Math.round(v * 4096) / 4096, so EVERY field of a noised rect — width and height
  // included, since they are differences of two such values — is an exact multiple of
  // 1/4096, at any zoom. Measured on the same window, same span, same string:
  //
  //     un-noised   0 of 6 fields on the 1/4096 grid, width 134.64053344726562
  //     noised      6 of 6,                           width 134.6416015625
  //
  // The element rect is measured first and used as the CONTROL, which also removes the
  // second way this row could lie: when the clientRects switch is on but the noise is not
  // running on this load, nothing is noised and "the OpaqueRange rect is not noised" says
  // nothing about the patch. That happens for real — a switch flipped away from its
  // default is inert on the first load of each origin, because _FEAT is fixed as
  // mw-core.js loads and 'v.ui.f' does not exist yet there — so the row reports it
  // instead of failing.
  try {
    if (typeof OpaqueRange === 'undefined' ||
        typeof HTMLInputElement.prototype.createValueRange !== 'function') {
      ok('form-value rects are noised', true,
        'skipped — no OpaqueRange in this browser (Chrome 152+)');
    } else if (!prof.features.clientRects) {
      ok('form-value rects are noised', true,
        'skipped — the clientRects switch is off, which is its default');
    } else {
      // Fractional left/top on purpose: a rect whose four raw numbers all sit on the
      // device pixel grid is left alone by _rectIsKnown, and would read as un-noised.
      const CSS = 'position:absolute;left:10.3px;top:20.7px;font:16px serif';
      const TEXT = 'The quick brown fox';
      const onGrid = (v) => Math.abs(v * 4096 - Math.round(v * 4096)) < 1e-9;
      const allOnGrid = (b, keys) => keys.every((k) => onGrid(b[k]));
      const RECT = ['x', 'y', 'width', 'height', 'right', 'bottom'];

      const span = document.createElement('span');
      span.style.cssText = CSS;
      span.textContent = TEXT;
      document.body.appendChild(span);
      const sb = span.getBoundingClientRect();
      span.remove();
      const controlNoised = allOnGrid(sb, RECT);

      const inp = document.createElement('input');
      inp.style.cssText = CSS;
      inp.value = TEXT;
      document.body.appendChild(inp);
      const r = inp.createValueRange(0, TEXT.length);
      const b = r.getBoundingClientRect();
      const l = r.getClientRects()[0];
      inp.remove();
      // The two methods must also describe the SAME rect. Patching one and leaving the
      // other native is what [FIX getclientrects-desync] was, and a page that reads both
      // then sees a geometry that cannot exist — louder than no noise at all.
      const agree = !!l && b.x === l.x && b.width === l.width && b.height === l.height;
      const noised = allOnGrid(b, RECT);

      if (!controlNoised) {
        ok('form-value rects are noised', true,
          'skipped — the clientRects noise is not running on this load (an element rect ' +
          'is not noised either), so this row has no control. Reload the page: a switch ' +
          'moved off its default is inert on the first load of an origin.');
      } else {
        ok('form-value rects are noised', noised && agree,
          'width ' + b.width + ' (an element rect on this page IS noised) — on the ' +
          '1/4096 noise grid: ' + noised + ', getClientRects agrees: ' + agree);
      }
    }
  } catch (e) {
    ok('form-value rects are noised', false, e.message);
  }

  // --- status bag ---
  try {
    // [FIX status-was-a-page-readable-key] window.__t0, not sessionStorage — the old key
    // was self-describing JSON on an origin where a clean Chrome stores nothing.
    const st = window.__t0 || {};
    ok('protection status marks', true, JSON.stringify(st));
  } catch (e) {}

  // print table
  console.log('%cAFP Fingerprint Shield — self-check', 'font-size:14px;font-weight:bold');
  console.table(out.map(r => ({
    check: r.name,
    result: r.pass ? 'PASS' : 'FAIL',
    detail: r.detail
  })));
  const failed = out.filter(r => !r.pass);
  console.log(failed.length ? ('Failed: ' + failed.length) : 'All probes passed (see details).');
  return out;
})();
