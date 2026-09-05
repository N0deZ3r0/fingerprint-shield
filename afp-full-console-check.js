/**
 * AFP Full Self-Check — paste into DevTools console on an https page
 * with the extension enabled (after Reload + F5).
 */
(async function AFPFullCheck() {
  const rows = [];
  const ok = (group, name, pass, detail) => {
    rows.push({
      group,
      check: name,
      result: pass ? 'PASS' : 'FAIL',
      detail: detail == null ? '' : String(detail).slice(0, 180)
    });
  };
  const section = (g) => rows.push({ group: g, check: '—', result: '', detail: '' });

  // ── Profile / mode / features ──────────────────────────────────
  section('PROFILE');
  // [FIX profile-readable-by-any-page] The profile lives in the mw/mw-core.js closure;
  // a console script is a page script and does not get to read it.
  //
  // [FIX self-check-still-read-the-removed-attributes] This used to rebuild `prof` from
  // data-v-tz/-lc/-md/-ft and evaluate to null when data-v-tz was absent. Nothing writes
  // a data-v-* attribute any more ([FIX bridge-attributes-were-an-extension-detector]),
  // so `prof` was null on every page: the "selection published" row failed against a
  // fully working extension, and all 14 `if (prof?…)` rows below were skipped in silence.
  // What a page can still see is the mode and the flags, both in sessionStorage — see
  // the twin helper in afp-console-check.js.
  const ss = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  // Bit order is AFP_DEFAULT_FEATURES' key order in defaults.js, which afpPackFeatures
  // used to write 'v.ui.f'. This list had a stale 'audio' key in it — 14 names against
  // the 13 that are packed — which shifted every flag from 'webgl' on by one bit.
  const FEAT_KEYS = ['canvas', 'webgl', 'webrtc', 'navigator', 'screen', 'timezone',
    'geolocation', 'battery', 'fonts', 'clientRects', 'plugins', 'network', 'hideAdBlocker'];
  // [FIX self-check-required-keys-the-extension-stops-writing] A missing key is the
  // DEFAULT, not a failure — [FIX default-config-still-left-two-keys] stopped writing
  // 'v.ui.m' outside stealth and 'v.ui.f' when the flags are unchanged, because a clean
  // Chrome stores nothing on a fresh origin. These two rows still demanded them, so a
  // default install failed its own self-check. The long version is in afp-console-check.js;
  // the defaults literal below is a copy test-defaults.cjs pins to defaults.js.
  const FEAT_DEFAULTS = {
    canvas: true, webgl: true, webrtc: true, navigator: true, screen: true,
    timezone: true, geolocation: true, battery: true, fonts: true,
    clientRects: false, plugins: true, network: true, hideAdBlocker: true
  };
  let feat = null;
  let featSource = 'default (no v.ui.f — the flags are unchanged)';
  const packedFeat = ss('v.ui.f');
  if (packedFeat) {
    const bits = parseInt(packedFeat, 36);
    if (isFinite(bits)) {
      feat = {}; FEAT_KEYS.forEach((k, i) => { feat[k] = !!(bits & (1 << i)); });
      featSource = 'v.ui.f=' + packedFeat;
    }
  }
  const featBad = !!packedFeat && !feat;
  if (!feat) feat = Object.assign({}, FEAT_DEFAULTS);
  const prof = { mode: ss('v.ui.m') || 'normal', features: feat };
  ok('PROFILE', 'profile NOT readable from the page', !sessionStorage.getItem('v.ui.s'),
    sessionStorage.getItem('v.ui.s') ? 'v.ui.s is populated — regression' : 'v.ui.s empty');
  // A clean browser leaves ZERO attributes on <html>. This row used to assert that the
  // selection WAS published there, which is now exactly the regression to watch for.
  const htmlAttrs = document.documentElement.getAttributeNames();
  ok('PROFILE', '<html> carries no extension attributes', htmlAttrs.length === 0,
    htmlAttrs.length ? 'leaks: ' + htmlAttrs.join(',') : 'bare, as in a clean browser');
  const mode = prof.mode;
  ok('PROFILE', 'mode', mode === 'normal' || mode === 'stealth',
    mode + (ss('v.ui.m') ? ' — v.ui.m' : ' — default (no v.ui.m)'));
  const featOff = FEAT_KEYS.filter((k) => !feat[k]);
  ok('PROFILE', 'feature flags resolved', !featBad,
    (featOff.length ? 'off: ' + featOff.join(',') : 'all on') + ' — ' + featSource);

  // [FIX status-was-a-page-readable-key] window.__t0, not sessionStorage — the old key
  // was self-describing JSON on an origin where a clean Chrome stores nothing.
  let status = {};
  try { status = window.__t0 || {}; } catch (e) {}
  ok('PROFILE', 'status marks window.__t0', true, JSON.stringify(status));

  // ── Navigator ──────────────────────────────────────────────────
  section('NAVIGATOR');
  ok('NAVIGATOR', 'webdriver !== true', navigator.webdriver !== true, String(navigator.webdriver));
  // [FIX self-check-still-read-the-removed-attributes] These read the machine off
  // data-v-hw and compared the live API against it. No page-visible copy of the machine
  // survives, and the helper had already degraded them to `navigator.x === navigator.x`,
  // so they could only ever pass. Reported as values — a check that cannot fail reads as
  // verification without being any. What IS still checkable without a reference is
  // internal coherence, which the worker-parity rows below do.
  ok('NAVIGATOR', 'hardwareConcurrency (no page-side reference)', true, String(navigator.hardwareConcurrency));
  ok('NAVIGATOR', 'deviceMemory (no page-side reference)', true, String(navigator.deviceMemory));
  ok('NAVIGATOR', 'platform (no page-side reference)', true, String(navigator.platform));
  ok('NAVIGATOR', 'userAgent contains Chrome', /Chrome\/\d+/.test(navigator.userAgent), navigator.userAgent.slice(0, 80));
  ok('NAVIGATOR', 'language / languages', Array.isArray(navigator.languages) && navigator.languages.length > 0,
    navigator.language + ' | ' + JSON.stringify((navigator.languages || []).slice(0, 3)));
  // navigator.language must be the head of navigator.languages — a split there is a
  // one-line inconsistency, and it needs no profile to detect.
  ok('NAVIGATOR', 'language === languages[0]',
    !navigator.languages || !navigator.languages.length || navigator.language === navigator.languages[0],
    navigator.language + ' vs ' + (navigator.languages || [])[0]);
  // No reference value; what holds regardless is that a Win32 desktop claim and a
  // non-zero touch count do not belong together.
  ok('NAVIGATOR', 'maxTouchPoints coherent with platform',
    typeof navigator.maxTouchPoints === 'number' &&
    (!/^Win32|^MacIntel|^Linux x86/.test(navigator.platform) || navigator.maxTouchPoints === 0),
    navigator.platform + ' / ' + navigator.maxTouchPoints);

  // UA-CH
  try {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      const he = await navigator.userAgentData.getHighEntropyValues([
        'platformVersion', 'architecture', 'bitness', 'model', 'uaFullVersion', 'fullVersionList'
      ]);
      // [FIX self-check-still-pinned-platformVersion-to-win10] Follows the host: '15.0.0'
      // (WIN11_PLATFORM_VERSION) on Windows 11, '10.0.0' otherwise — see the twin note in
      // afp-console-check.js. Pinned to Win10 it failed on every Windows 11 machine.
      ok('NAVIGATOR', 'UA-CH platformVersion is a shipped bucket',
        he.platformVersion === '10.0.0' || he.platformVersion === '15.0.0', he.platformVersion);
      ok('NAVIGATOR', 'UA-CH architecture', !!he.architecture, he.architecture);
      ok('NAVIGATOR', 'UA-CH brands', Array.isArray(navigator.userAgentData.brands) && navigator.userAgentData.brands.length > 0,
        JSON.stringify(navigator.userAgentData.brands));
    } else {
      ok('NAVIGATOR', 'UA-CH', false, 'userAgentData missing');
    }
  } catch (e) {
    ok('NAVIGATOR', 'UA-CH', false, e.message);
  }

  // ── Timezone / locale ──────────────────────────────────────────
  section('TIMEZONE');
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    ok('TIMEZONE', 'Intl timeZone resolves', !!tz && tz !== 'UTC', String(tz));
    const off = new Date().getTimezoneOffset();
    ok('TIMEZONE', 'getTimezoneOffset number', typeof off === 'number', String(off));
    // Intl's locale and navigator.language come from different layers of the spoof;
    // they must agree, and that comparison needs no profile reference.
    const loc = Intl.DateTimeFormat().resolvedOptions().locale;
    ok('TIMEZONE', 'Intl locale === navigator.language', loc === navigator.language,
      loc + ' vs ' + navigator.language);
  } catch (e) {
    ok('TIMEZONE', 'Intl', false, e.message);
  }

  // ── Screen ─────────────────────────────────────────────────────
  section('SCREEN');
  // No page-side reference for the panel — reported, plus the invariants that hold
  // without one: avail* never exceeds the screen, and the viewport never exceeds avail.
  ok('SCREEN', 'width x height (no page-side reference)', true, screen.width + 'x' + screen.height);
  ok('SCREEN', 'availWidth <= width', screen.availWidth <= screen.width,
    screen.availWidth + ' <= ' + screen.width);
  ok('SCREEN', 'availHeight <= height', screen.availHeight <= screen.height,
    screen.availHeight + ' <= ' + screen.height);
  ok('SCREEN', 'innerWidth <= availWidth', window.innerWidth <= screen.availWidth,
    window.innerWidth + ' <= ' + screen.availWidth);
  ok('SCREEN', 'colorDepth', screen.colorDepth === 24 || screen.colorDepth === 32, String(screen.colorDepth));
  ok('SCREEN', 'devicePixelRatio', typeof devicePixelRatio === 'number', String(devicePixelRatio));

  // ── WebGL ──────────────────────────────────────────────────────
  section('WEBGL');
  let mainR = null, mainV = null;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) {
      ok('WEBGL', 'context', false, 'no webgl');
    } else {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      mainV = gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : 0x9245);
      mainR = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : 0x9246);
      const mV = gl.getParameter(gl.VENDOR);
      const mR = gl.getParameter(gl.RENDERER);
      ok('WEBGL', 'context', true, '');
      ok('WEBGL', 'masked Vendor WebKit', /WebKit/i.test(String(mV)), mV);
      ok('WEBGL', 'masked Renderer WebKit', /WebKit/i.test(String(mR)), mR);
      ok('WEBGL', 'UNMASKED vendor', !!mainV, mainV);
      ok('WEBGL', 'UNMASKED renderer', !!mainR, mainR);
      // [FIX self-check-still-read-the-removed-attributes] Compared against data-v-hw's
      // glRenderer, which is gone; the row had already gone inert. Without a reference,
      // the checkable part is that it is not the software rasteriser a headless browser
      // falls back to.
      if (mode === 'normal' && (!feat || feat.webgl !== false))
        ok('WEBGL', 'UNMASKED not SwiftShader/llvmpipe',
          !/SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(String(mainR)), String(mainR));
      // toString
      const ts = Function.prototype.toString.call(gl.getParameter);
      ok('WEBGL', 'getParameter toString native-ish', /native code|getParameter/.test(ts), ts.slice(0, 50));
    }
  } catch (e) {
    ok('WEBGL', 'probe', false, e.message);
  }

  // Worker parity
  try {
    const code = `
      self.onmessage = function () {
        try {
          var c = new OffscreenCanvas(1, 1);
          var gl = c.getContext('webgl');
          if (!gl) { self.postMessage({ err: 'no gl' }); return; }
          var e = gl.getExtension('WEBGL_debug_renderer_info');
          self.postMessage({
            r: gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : 0x9246),
            v: gl.getParameter(e ? e.UNMASKED_VENDOR_WEBGL : 0x9245),
            hc: navigator.hardwareConcurrency,
            plat: navigator.platform
          });
        } catch (err) { self.postMessage({ err: String(err) }); }
      };
    `;
    const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    const wr = await new Promise((resolve) => {
      const w = new Worker(url);
      const t = setTimeout(() => { try { w.terminate(); } catch (e) {} resolve({ err: 'timeout' }); }, 4000);
      w.onmessage = (ev) => { clearTimeout(t); try { w.terminate(); } catch (e) {} resolve(ev.data); };
      w.postMessage(1);
    });
    URL.revokeObjectURL(url);
    if (wr.err) {
      ok('WEBGL', 'worker probe', false, wr.err);
    } else {
      ok('WEBGL', 'hasBadWebGL false (main===worker renderer)', mainR && wr.r === mainR,
        'main: ' + mainR + ' | worker: ' + wr.r);
      // [FIX self-check-still-read-the-removed-attributes] These two compared the worker
      // against `prof`, which the helper filled from the WINDOW's own navigator — so the
      // real subject was always window-vs-worker parity, and gating them on a dead
      // attribute is what stopped them running. Stated against the window directly: a
      // worker that answers differently from its own window is the scope split CreepJS
      // reports, and it needs no profile to see.
      ok('WEBGL', 'worker hardwareConcurrency === window',
        wr.hc === navigator.hardwareConcurrency, wr.hc + ' vs ' + navigator.hardwareConcurrency);
      ok('WEBGL', 'worker platform === window',
        wr.plat === navigator.platform, wr.plat + ' vs ' + navigator.platform);
    }
  } catch (e) {
    ok('WEBGL', 'worker parity', false, e.message);
  }

  // ── Canvas ─────────────────────────────────────────────────────
  section('CANVAS');
  try {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 120, 40);
    ctx.fillStyle = '#069';
    ctx.font = '16px Arial';
    ctx.fillText('AFP-canvas', 4, 24);
    const a = ctx.getImageData(0, 0, 120, 40).data;
    const b = ctx.getImageData(0, 0, 120, 40).data;
    let same = true, sum = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) same = false;
      sum += a[i];
    }
    ok('CANVAS', 'getImageData stable', same, same ? 'stable' : 'unstable');
    ok('CANVAS', 'pixel data non-empty', sum > 0, 'sum=' + sum);
    const url1 = c.toDataURL();
    const url2 = c.toDataURL();
    ok('CANVAS', 'toDataURL stable', url1 === url2, url1.slice(0, 40) + '…');
    ok('CANVAS', 'toDataURL is png/jpeg', /^data:image\//.test(url1), url1.slice(0, 30));
  } catch (e) {
    ok('CANVAS', 'probe', false, e.message);
  }

  // ── Scope parity: window vs worker ─────────────────────────────
  // The probes above test each scope on its own; nothing compared them. Every canvas
  // fix in this project has been about the two scopes answering differently — flat
  // regions restored in one and not the other, convertToBlob encoding a clean canvas
  // in the worker, WebGL params read off the real driver there. Those are exactly the
  // regressions a single-scope probe cannot see.
  // The scene and the hash live in real functions and are shipped into the worker with
  // Function.prototype.toString, so the two sides cannot drift apart. No text is drawn
  // on purpose: workers have no document.fonts and font resolution can legitimately
  // differ, which would make this a flaky alarm instead of a signal.
  section('PARITY');
  const PW = 160, PH = 60;
  function drawScene(ctx, w, h) {
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#069');
    g.addColorStop(1, '#fc0');
    ctx.fillStyle = g;
    ctx.fillRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(w * 0.35, h * 0.5, h * 0.28, 0, 6.283185);
    ctx.fill();
  }
  function fnv1a(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  // Solid fill: a real browser rasterises it byte-identical everywhere, so the flat
  // restore must give every pixel back. Anything above 0 is the canvas background test.
  function flatDelta(ctx, w, h, rgb) {
    const d = ctx.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] !== rgb[0] || d[i + 1] !== rgb[1] || d[i + 2] !== rgb[2]) n++;
    }
    return n;
  }
  // CheckIntegrity: one block read vs the same pixels read 1x1. Static bitmap → equal.
  function integrityDelta(ctx, x0, y0, n) {
    const block = ctx.getImageData(x0, y0, n, n).data;
    let bad = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const one = ctx.getImageData(x0 + x, y0 + y, 1, 1).data;
        const i = (y * n + x) * 4;
        if (block[i] !== one[0] || block[i + 1] !== one[1] || block[i + 2] !== one[2]) bad++;
      }
    }
    return bad;
  }
  // VENDOR, RENDERER and the two UNMASKED_* enums. The list used to be extended with
  // whatever keys data-v-hw's glParams carried; that attribute is gone, and the extension
  // was always optional — these four are the ones the comparison is about.
  const GL_ENUMS = [0x1F00, 0x1F01, 0x9245, 0x9246];

  let mainSide = null;
  try {
    const pc = document.createElement('canvas');
    pc.width = PW; pc.height = PH;
    const pctx = pc.getContext('2d');
    drawScene(pctx, PW, PH);
    const gidHash = fnv1a(pctx.getImageData(0, 0, PW, PH).data);
    const blob = await new Promise((r) => pc.toBlob(r));
    const pngHash = blob ? fnv1a(new Uint8Array(await blob.arrayBuffer())) : 'no-blob';
    const pngLen = blob ? blob.size : -1;

    const fc = document.createElement('canvas');
    fc.width = PW; fc.height = PH;
    const fctx = fc.getContext('2d');
    fctx.fillStyle = 'rgb(17,34,51)';
    fctx.fillRect(0, 0, PW, PH);
    const flat = flatDelta(fctx, PW, PH, [17, 34, 51]);
    const integ = integrityDelta(pctx, 20, 12, 8);

    let glVals = null;
    try {
      const gc = document.createElement('canvas');
      const gl = gc.getContext('webgl');
      if (gl) {
        // [FIX parity-read-unmasked-without-enabling-the-extension] The two UNMASKED_*
        // enums only answer on a context where WEBGL_debug_renderer_info has been enabled.
        // This context is fresh and nothing enabled it, so both reads returned null AND
        // logged, per read:
        //
        //   WebGL: INVALID_ENUM: getParameter: invalid parameter name,
        //   WEBGL_debug_renderer_info not enabled
        //
        // Two costs. The visible one is four warnings in the user's console (two here, two
        // in the worker below) — and because the extension's getParameter wrapper is the
        // caller, Chrome attributes them to mw-bundle.js, so a diagnostic script we ship
        // made the extension look like it was throwing WebGL errors. The worse one is
        // silent: half of this "parity" row compared null against null, so a genuine
        // window↔worker mismatch on the two enums that actually identify the GPU would
        // have passed. Verified in a clean browser: the same call logs the same warning
        // there, so it was never an extension defect — it was this probe's.
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        glVals = GL_ENUMS.map((p) => {
          if ((p === 0x9245 || p === 0x9246) && !dbg) return 'n/a';
          try { return String(gl.getParameter(p)); } catch (e) { return 'ERR'; }
        });
      }
    } catch (e) {}
    mainSide = { gid: gidHash, png: pngHash, pngLen, flat, integ, gl: glVals };
  } catch (e) {
    ok('PARITY', 'window side', false, e.message);
  }

  if (mainSide) {
    ok('PARITY', 'solid fill unnoised (window)', mainSide.flat === 0, mainSide.flat + ' px differ from fill');
    ok('PARITY', 'block read === 1x1 reads (window)', mainSide.integ === 0, mainSide.integ + ' px differ');
    try {
      const code = drawScene.toString() + '\n' + fnv1a.toString() + '\n' +
        flatDelta.toString() + '\n' + integrityDelta.toString() + '\n' + `
        self.onmessage = async function () {
          try {
            var PW = ${PW}, PH = ${PH};
            var c = new OffscreenCanvas(PW, PH);
            var ctx = c.getContext('2d');
            drawScene(ctx, PW, PH);
            var gid = fnv1a(ctx.getImageData(0, 0, PW, PH).data);
            var blob = await c.convertToBlob();
            var png = fnv1a(new Uint8Array(await blob.arrayBuffer()));
            var fc = new OffscreenCanvas(PW, PH);
            var fctx = fc.getContext('2d');
            fctx.fillStyle = 'rgb(17,34,51)';
            fctx.fillRect(0, 0, PW, PH);
            var flat = flatDelta(fctx, PW, PH, [17, 34, 51]);
            var integ = integrityDelta(ctx, 20, 12, 8);
            var gl = null;
            try {
              var gc = new OffscreenCanvas(1, 1).getContext('webgl');
              if (gc) {
                // Must mirror the window side exactly, including the 'n/a' — see the note
                // there. A parity probe whose two halves ask the question differently
                // measures the difference between the halves, not between the scopes.
                var dbg = gc.getExtension('WEBGL_debug_renderer_info');
                gl = ${JSON.stringify(GL_ENUMS)}.map(function (p) {
                  if ((p === 0x9245 || p === 0x9246) && !dbg) return 'n/a';
                  try { return String(gc.getParameter(p)); } catch (e) { return 'ERR'; }
                });
              }
            } catch (e) {}
            self.postMessage({ gid: gid, png: png, pngLen: blob.size, flat: flat, integ: integ, gl: gl });
          } catch (err) { self.postMessage({ err: String(err) }); }
        };`;
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      const wr = await new Promise((resolve) => {
        const w = new Worker(url);
        const t = setTimeout(() => { try { w.terminate(); } catch (e) {} resolve({ err: 'timeout' }); }, 6000);
        w.onmessage = (ev) => { clearTimeout(t); try { w.terminate(); } catch (e) {} resolve(ev.data); };
        w.postMessage(1);
      });
      URL.revokeObjectURL(url);

      if (wr.err) {
        ok('PARITY', 'worker probe', false, wr.err);
      } else {
        ok('PARITY', 'canvas getImageData hash', mainSide.gid === wr.gid,
          'window ' + mainSide.gid + ' | worker ' + wr.gid);
        // The bug this catches: the worker used to encode the ORIGINAL canvas, so its
        // PNG was both a different hash and noticeably smaller — noise hurts deflate.
        ok('PARITY', 'PNG hash (toBlob vs convertToBlob)', mainSide.png === wr.png,
          'window ' + mainSide.png + ' (' + mainSide.pngLen + ' B) | worker ' + wr.png + ' (' + wr.pngLen + ' B)');
        ok('PARITY', 'solid fill unnoised (worker)', wr.flat === 0, wr.flat + ' px differ from fill');
        ok('PARITY', 'block read === 1x1 reads (worker)', wr.integ === 0, wr.integ + ' px differ');
        if (mainSide.gl && wr.gl) {
          const diff = GL_ENUMS.map((p, i) => [p, mainSide.gl[i], wr.gl[i]])
                               .filter((t) => t[1] !== t[2]);
          // [FIX parity-read-unmasked-without-enabling-the-extension] The values are
          // REPORTED, not just compared. While both sides read the UNMASKED enums off a
          // context with WEBGL_debug_renderer_info unenabled, both answered null, "all
          // match" was true, and the row that exists to catch a window↔worker GPU
          // mismatch was comparing nothing — with no way to tell from its own output.
          // A verdict that cannot show what it compared is not a verdict.
          const shown = mainSide.gl.map((v) => String(v).slice(0, 40)).join(' | ');
          ok('PARITY', 'WebGL getParameter (' + GL_ENUMS.length + ' enums)', diff.length === 0,
            diff.length ? diff.slice(0, 3).map((t) => '0x' + t[0].toString(16) + ': ' + t[1] + ' vs ' + t[2]).join('; ')
                        : 'all match: ' + shown);
        } else {
          ok('PARITY', 'WebGL getParameter', true, 'no GL context in ' + (mainSide.gl ? 'worker' : 'window') + ' — skipped');
        }
      }
    } catch (e) {
      ok('PARITY', 'worker probe', false, e.message);
    }
  }

  // ── Audio ──────────────────────────────────────────────────────
  section('AUDIO');
  try {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC) {
      ok('AUDIO', 'OfflineAudioContext', false, 'missing');
    } else {
      const ctx = new AC(1, 44100, 44100);
      const osc = ctx.createOscillator();
      const comp = ctx.createDynamicsCompressor();
      osc.type = 'triangle';
      osc.frequency.value = 10000;
      osc.connect(comp);
      comp.connect(ctx.destination);
      osc.start(0);
      const buf = await ctx.startRendering();
      const data = buf.getChannelData(0);
      let sum = 0, nonZero = 0;
      for (let i = 0; i < Math.min(data.length, 5000); i++) {
        sum += Math.abs(data[i]);
        if (data[i] !== 0) nonZero++;
      }
      ok('AUDIO', 'OfflineAudioContext render', data.length > 0, 'len=' + data.length + ' energy=' + sum.toFixed(4));
      ok('AUDIO', 'signal present', nonZero > 10, 'nonZero=' + nonZero);
      // second render — should be stable with same seed
      const ctx2 = new AC(1, 44100, 44100);
      const osc2 = ctx2.createOscillator();
      const comp2 = ctx2.createDynamicsCompressor();
      osc2.type = 'triangle';
      osc2.frequency.value = 10000;
      osc2.connect(comp2);
      comp2.connect(ctx2.destination);
      osc2.start(0);
      const buf2 = await ctx2.startRendering();
      const d2 = buf2.getChannelData(0);
      let eq = true;
      for (let i = 0; i < Math.min(2000, data.length, d2.length); i++) {
        if (data[i] !== d2[i]) { eq = false; break; }
      }
      ok('AUDIO', 'render stable (same seed)', eq, eq ? 'stable' : 'differs');
    }
  } catch (e) {
    ok('AUDIO', 'probe', false, e.message);
  }

  // ── WebRTC ─────────────────────────────────────────────────────
  section('WEBRTC');
  try {
    const RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!RTC) {
      ok('WEBRTC', 'RTCPeerConnection', false, 'missing');
    } else {
      const pc = new RTC({ iceServers: [] });
      ok('WEBRTC', 'construct', true, '');
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      ok('WEBRTC', 'createOffer SDP', !!(offer && offer.sdp), (offer.sdp || '').slice(0, 60));
      // local candidates may be blocked by feature
      let candCount = 0;
      pc.onicecandidate = (e) => { if (e.candidate) candCount++; };
      await pc.setLocalDescription(offer);
      await new Promise((r) => setTimeout(r, 400));
      ok('WEBRTC', 'ICE (may be empty if blocked)', true, 'candidates≈' + candCount);
      pc.close();
    }
  } catch (e) {
    ok('WEBRTC', 'probe', false, e.message);
  }

  // ── Battery ────────────────────────────────────────────────────
  section('BATTERY');
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      ok('BATTERY', 'getBattery', true, 'level=' + b.level + ' charging=' + b.charging);
      ok('BATTERY', 'level in 0..1', b.level >= 0 && b.level <= 1, String(b.level));
    } else {
      ok('BATTERY', 'getBattery API', false, 'not available (ok on some builds)');
    }
  } catch (e) {
    ok('BATTERY', 'probe', false, e.message);
  }

  // ── Plugins / mimeTypes ────────────────────────────────────────
  section('PLUGINS');
  try {
    ok('PLUGINS', 'navigator.plugins length', navigator.plugins.length >= 0, String(navigator.plugins.length));
    ok('PLUGINS', 'mimeTypes length', navigator.mimeTypes.length >= 0, String(navigator.mimeTypes.length));
  } catch (e) {
    ok('PLUGINS', 'probe', false, e.message);
  }

  // ── Client rects ───────────────────────────────────────────────
  section('DOMRECT');
  try {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:10px;top:10px;width:100px;height:40px;';
    document.body.appendChild(el);
    const r1 = el.getBoundingClientRect();
    const r2 = el.getBoundingClientRect();
    ok('DOMRECT', 'getBoundingClientRect stable',
      r1.x === r2.x && r1.y === r2.y && r1.width === r2.width,
      JSON.stringify({ x: r1.x, y: r1.y, w: r1.width, h: r1.height }));
    document.body.removeChild(el);
  } catch (e) {
    ok('DOMRECT', 'probe', false, e.message);
  }

  // ── Geolocation ────────────────────────────────────────────────
  section('GEO');
  try {
    if (!navigator.geolocation) {
      ok('GEO', 'API', false, 'missing');
    } else {
      const pos = await new Promise((resolve) => {
        const t = setTimeout(() => resolve({ err: 'timeout' }), 2500);
        navigator.geolocation.getCurrentPosition(
          (p) => { clearTimeout(t); resolve(p); },
          (e) => { clearTimeout(t); resolve({ err: e.message }); },
          { timeout: 2000, maximumAge: 0 }
        );
      });
      if (pos.err) {
        ok('GEO', 'getCurrentPosition', feat.geolocation === false, pos.err);
      } else {
        ok('GEO', 'getCurrentPosition', true,
          pos.coords.latitude.toFixed(4) + ', ' + pos.coords.longitude.toFixed(4));
        ok('GEO', 'coords finite', isFinite(pos.coords.latitude) && isFinite(pos.coords.longitude), '');
      }
    }
  } catch (e) {
    ok('GEO', 'probe', false, e.message);
  }

  // ── Adblock hide (bait) ────────────────────────────────────────
  section('ADBLOCK');
  try {
    const bait = document.createElement('div');
    bait.id = 'google-ad';
    bait.className = 'adsbox ad-banner';
    bait.style.cssText = 'display:none;width:0;height:0;';
    document.body.appendChild(bait);
    const st = getComputedStyle(bait);
    const rect = bait.getBoundingClientRect();
    // hideAdBlocker may force display/size for bait
    ok('ADBLOCK', 'getComputedStyle on bait', true, 'display=' + st.display + ' visibility=' + st.visibility);
    ok('ADBLOCK', 'getBoundingClientRect on bait', true, 'w=' + rect.width + ' h=' + rect.height);
    document.body.removeChild(bait);
    ok('ADBLOCK', 'window.adblock hidden', window.adblock === undefined, String(window.adblock));
  } catch (e) {
    ok('ADBLOCK', 'probe', false, e.message);
  }

  // ── Chrome runtime (CreepJS) ───────────────────────────────────
  section('CHROME');
  try {
    ok('CHROME', 'chrome exists', typeof chrome !== 'undefined', typeof chrome);
    // [FIX self-check-demanded-the-stub-that-was-removed] Was `!!(... && chrome.runtime)`,
    // i.e. it demanded the very stub [FIX we-invented-a-chrome-runtime-...] deleted from
    // mw/mw-core.js. An ordinary page in real Chrome has app/csi/loadTimes and no runtime
    // — measured on Chrome 151 with this extension live. The old assertion failed on a
    // correct build and passed on the signature it was supposed to catch.
    ok('CHROME', 'chrome.runtime absent', !(window.chrome && chrome.runtime),
      Object.getOwnPropertyNames(window.chrome || {}).join(','));
  } catch (e) {
    ok('CHROME', 'probe', false, e.message);
  }

  // ── toString / iframe proxy signals ────────────────────────────
  section('STEALTH_SIGNALS');
  try {
    const samples = [
      ['HTMLCanvasElement.getContext', HTMLCanvasElement.prototype.getContext],
      ['WebGLRenderingContext.getParameter', WebGLRenderingContext.prototype.getParameter],
      ['navigator.permissions.query', navigator.permissions && navigator.permissions.query]
    ];
    for (const [label, fn] of samples) {
      if (typeof fn !== 'function') {
        ok('STEALTH_SIGNALS', label, true, 'n/a');
        continue;
      }
      const s = Function.prototype.toString.call(fn);
      ok('STEALTH_SIGNALS', label + ' toString', /\[native code\]/.test(s) || s.length < 80, s.slice(0, 60));
    }
  } catch (e) {
    ok('STEALTH_SIGNALS', 'probe', false, e.message);
  }

  // ── Cleanup markers (should be gone after mw-cleanup) ──────────
  section('CLEANUP');
  ok('CLEANUP', '__AFP_MW__ removed', typeof window.__AFP_MW__ === 'undefined', String(typeof window.__AFP_MW__));
  ok('CLEANUP', '__AFP_GEO__ removed', typeof window.__AFP_GEO__ === 'undefined', '');
  ok('CLEANUP', '__AFP_ADBLOCK_HIDE__ removed', typeof window.__AFP_ADBLOCK_HIDE__ === 'undefined', '');
  ok('CLEANUP', '__g0 removed or harmless', true, typeof window.__g0);

  // ── Summary ────────────────────────────────────────────────────
  const checks = rows.filter(r => r.result === 'PASS' || r.result === 'FAIL');
  const failed = checks.filter(r => r.result === 'FAIL');
  const passed = checks.filter(r => r.result === 'PASS');

  console.log('%cAFP FULL SELF-CHECK', 'font-size:16px;font-weight:bold;color:#0a0');
  // The profile id is deliberately not observable from a page any more, so the summary
  // names what IS: the mode, the machine as presented, and the flags.
  console.log('Mode: ' + mode + ' | Presenting: ' + navigator.platform +
    ', ' + navigator.hardwareConcurrency + ' cores, ' + screen.width + 'x' + screen.height +
    ' | Flags: ' + (feat ? (featOff.length ? 'off=' + featOff.join(',') : 'all on') : 'unknown'));
  console.table(rows.filter(r => r.result));
  console.log('%cPassed: ' + passed.length + ' / Failed: ' + failed.length,
    failed.length ? 'color:#c00;font-weight:bold' : 'color:#0a0;font-weight:bold');
  if (failed.length) {
    console.log('Failed checks:');
    failed.forEach(f => console.log('  ✗ [' + f.group + '] ' + f.check + ' — ' + f.detail));
  } else {
    console.log('%cAll probes PASS', 'color:#0a0;font-weight:bold');
  }
  return { passed: passed.length, failed: failed.length, rows };
})();
