/**
 * THE ONE COLLECTOR. Everything a page can read, in one list, in two halves.
 *
 * Lifted out of tools/probe-diff.mjs when a second instrument needed the same list.
 * It is a source-text export rather than a function export, because both consumers hand
 * it to a browser rather than call it: probe-diff through page.evaluate, probe-time as
 * literal text inside the first inline <script> of the document under test. A closure
 * does not survive either trip, so the export is what does survive — the text.
 *
 * WHY IT IS SPLIT IN TWO, and this is the whole reason the file exists rather than an
 * `export` bolted onto probe-diff. The original was one `async function` that read
 * navigator, then AWAITED voices for up to 2.5 s, then read the media queries, WebGL, the
 * canvas and the fonts. For a clean-against-ours diff that ordering is invisible: both
 * sides pay the same 2.5 s and the values are compared, not their timestamps.
 *
 * For a sweep along the time axis it is fatal. Six snapshots taken at parse, DCL, load,
 * +100 ms, +500 ms and +2 s would all reach `matchMedia` at about the same wall clock
 * moment — two and a half seconds after the earliest of them started — and the instrument
 * would report a flat timeline for two thirds of its values no matter what the browser did
 * underneath. A sweep whose null result is manufactured by its own collector is exactly
 * the kind of check this project has thrown out three times.
 *
 * So: `collectSync` touches nothing that can await and is true to the instant it is called.
 * `collectAsync` holds the seven groups that genuinely cannot be read synchronously
 * (high-entropy client hints, permissions, voices, battery, geolocation, WebGPU, audio) and
 * is STARTED at the instant, resolving whenever the browser answers — which is the same
 * deal a real fingerprinting script gets.
 *
 * Two behaviours changed in the lift, both forced by the new consumer, both improvements
 * for the old one:
 *
 *   speechSynthesis: `addEventListener('voiceschanged')` where it used to assign
 *       `onvoiceschanged`. Six concurrent snapshots assigning one handler leaves one
 *       winner and five that silently fall through to their timeout, which would have
 *       shown up as five stages "losing" the voice list. Assigning is also the more
 *       page-visible of the two, so the diff loses a little of its own footprint.
 *   WebGL: the context is explicitly lost after it is read. Chrome keeps about sixteen
 *       live contexts per page and drops the oldest beyond that; six snapshots at two
 *       contexts each sit right on the edge, and a dropped context reads as a changed
 *       value. Not needed by the diff, harmless to it.
 *
 * Everything else is byte for byte what probe-diff read, so its counts do not move.
 */

/** Read everything readable without awaiting, and never throw. */
function collectSync() {
  const out = {};
  const t = (k, f) => { try { const v = f(); out[k] = v === undefined ? '(undefined)' : String(v); } catch (e) { out[k] = 'THREW ' + e.name; } };

  // navigator — every scalar the prototype exposes, so a property added by a browser
  // update is compared without anyone listing it here first.
  for (const p of Object.getOwnPropertyNames(Navigator.prototype).sort()) {
    let v;
    try { v = navigator[p]; } catch (e) { continue; }
    const ty = typeof v;
    if (ty === 'function' || ty === 'object' || ty === 'undefined') continue;
    out['navigator.' + p] = String(v);
  }
  t('navigator.languages', () => (navigator.languages || []).join(','));
  t('navigator.own', () => Object.getOwnPropertyNames(navigator).sort().join(',') || '(none)');
  t('screen.own', () => Object.getOwnPropertyNames(screen).sort().join(',') || '(none)');
  for (const p of ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth',
    'availLeft', 'availTop']) t('screen.' + p, () => screen[p]);
  t('screen.orientation', () => screen.orientation.type + '/' + screen.orientation.angle);
  for (const p of ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio'])
    t('window.' + p, () => window[p]);
  // The one that catches litter: which own names the page can enumerate on window.
  t('window.own', () => Object.getOwnPropertyNames(window).filter((n) => /^__/.test(n)).sort().join(',') || '(none)');
  t('chrome.own', () => Object.getOwnPropertyNames(window.chrome || {}).sort().join(',') || '(none)');

  // client hints, the half that answers synchronously
  try {
    const uad = navigator.userAgentData;
    t('uad.brands', () => JSON.stringify(uad.brands));
    t('uad.mobile', () => uad.mobile);
    t('uad.platform', () => uad.platform);
    t('uad.own', () => Object.getOwnPropertyNames(uad).join(',') || '(none)');
  } catch (e) { out['uad'] = 'THREW ' + e.name; }

  // time and locale
  t('intl.timeZone', () => Intl.DateTimeFormat().resolvedOptions().timeZone);
  t('intl.locale', () => Intl.DateTimeFormat().resolvedOptions().locale);
  t('intl.numbering', () => Intl.NumberFormat().resolvedOptions().locale);
  t('intl.collator', () => new Intl.Collator().resolvedOptions().locale);
  t('date.offsetJan', () => new Date('2026-01-15T12:00:00Z').getTimezoneOffset());
  t('date.offsetJul', () => new Date('2026-07-15T12:00:00Z').getTimezoneOffset());
  t('date.toString', () => new Date('2026-01-15T12:00:00Z').toString().slice(16));

  // plugins
  t('plugins', () => [...navigator.plugins].map((p) => p.name).join('|'));
  t('mimeTypes', () => [...navigator.mimeTypes].map((m) => m.type).join('|'));

  // network
  try {
    const c = navigator.connection;
    for (const k of ['effectiveType', 'rtt', 'downlink', 'saveData']) out['connection.' + k] = String(c[k]);
  } catch (e) { out['connection'] = 'THREW'; }

  // media queries — one engine, two ways of asking
  for (const q of ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)',
    '(forced-colors: active)', '(dynamic-range: high)', '(color-gamut: p3)', '(color-gamut: rec2020)',
    '(inverted-colors: inverted)', '(monochrome: 0)', '(pointer: fine)', '(any-pointer: coarse)',
    '(hover: hover)', '(update: fast)', '(prefers-contrast: more)', '(prefers-reduced-transparency: reduce)'])
    t('media.' + q.replace(/[()]/g, '').replace(/:\s*/, '='), () => matchMedia(q).matches);

  // WebGL
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    t('webgl.vendor', () => gl.getParameter(gl.VENDOR));
    t('webgl.renderer', () => gl.getParameter(gl.RENDERER));
    t('webgl.version', () => gl.getParameter(gl.VERSION));
    t('webgl.unmaskedVendor', () => gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL));
    t('webgl.unmaskedRenderer', () => gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
    t('webgl.extensions', () => gl.getSupportedExtensions().sort().join(','));
    for (const p of ['MAX_TEXTURE_SIZE', 'MAX_RENDERBUFFER_SIZE', 'MAX_VIEWPORT_DIMS',
      'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_VARYING_VECTORS', 'ALIASED_LINE_WIDTH_RANGE'])
      t('webgl.param.' + p, () => String(gl.getParameter(gl[p])));
    t('webgl.precision', () => {
      const s = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      return s.rangeMin + '/' + s.rangeMax + '/' + s.precision;
    });
    // A shaded quad, read back: flat fills carry nothing, which is why hostleak was rewritten.
    t('webglPixels', () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const g = c.getContext('webgl', { preserveDrawingBuffer: true });
      const vs = g.createShader(g.VERTEX_SHADER);
      g.shaderSource(vs, 'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}');
      g.compileShader(vs);
      const fs = g.createShader(g.FRAGMENT_SHADER);
      g.shaderSource(fs, 'precision highp float;varying vec2 v;void main(){gl_FragColor=vec4(abs(sin(v.x*12.)),abs(cos(v.y*9.)),v.x*v.y,1.);}');
      g.compileShader(fs);
      const pr = g.createProgram(); g.attachShader(pr, vs); g.attachShader(pr, fs); g.linkProgram(pr); g.useProgram(pr);
      const b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
      const loc = g.getAttribLocation(pr, 'p'); g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
      g.drawArrays(g.TRIANGLES, 0, 3);
      const px = new Uint8Array(64 * 64 * 4); g.readPixels(0, 0, 64, 64, g.RGBA, g.UNSIGNED_BYTE, px);
      let h = 0; for (let i = 0; i < px.length; i++) h = (h * 31 + px[i]) >>> 0;
      try { g.getExtension('WEBGL_lose_context').loseContext(); } catch (e) {}
      return h;
    });
    // Six snapshots on one page is twelve contexts; Chrome starts dropping the oldest at
    // about sixteen, and a dropped context answers null to everything.
    try { gl.getExtension('WEBGL_lose_context').loseContext(); } catch (e) {}
  } catch (e) { out['webgl'] = 'THREW ' + e.name; }

  // canvas
  t('canvas.2d', () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 80;
    const x = c.getContext('2d'); x.textBaseline = 'top'; x.font = '14px Arial';
    x.fillStyle = '#f60'; x.fillRect(0, 0, 100, 50); x.fillStyle = '#069';
    x.fillText('Cwm fjordbank glyphs vext quiz', 2, 15);
    const d = x.getImageData(0, 0, 300, 80).data;
    let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0; return h;
  });

  // fonts, through the two channels a page has
  // The last two are the only ones OUTSIDE the profile's claim, and they are here because
  // without them this list proves nothing about the allowlist. WIN_FONTS in
  // profile-injector.js contains the other fourteen — Bahnschrift, Gabriola, Nirmala UI and
  // the rest are claimed, so the module is supposed to let them through untouched, and
  // "identical with the flag on and off" was the right answer to the wrong question.
  // Agency FB and MS Outlook are installed on a desktop Windows and claimed by nothing,
  // which is what makes `fonts.check` and the text metrics able to move at all. The same
  // discovery, in the same week, made test/modules.mjs skip its font row on a host that has
  // neither of them.
  const FONTS = ['Arial', 'Segoe UI', 'Calibri', 'Cambria', 'Consolas', 'Tahoma', 'Verdana',
    'Gabriola', 'Ink Free', 'Bahnschrift', 'MS Gothic', 'SimSun', 'Malgun Gothic', 'Nirmala UI',
    'Agency FB', 'MS Outlook'];
  t('fonts.measureText', () => {
    const c = document.createElement('canvas').getContext('2d');
    return FONTS.map((f) => {
      c.font = '72px "' + f + '",monospace';
      return f + '=' + c.measureText('mmmmmmmmmmlli').width.toFixed(2);
    }).join('|');
  });
  t('fonts.check', () => FONTS.map((f) => f + '=' + document.fonts.check('12px "' + f + '"')).join('|'));

  // codecs
  t('codecs', () => ['video/webm;codecs=vp9', 'video/mp4;codecs=avc1.42E01E', 'audio/mpeg',
    'video/mp4;codecs=av01.0.05M.08'].map((c) => document.createElement('video').canPlayType(c)).join('|'));
  // WebRTC's codec list is the ENCODER/DECODER hardware talking: `video/H265` appears in it
  // only where the card encodes (send) / decodes (receive) HEVC — measured, it disappears
  // under --disable-accelerated-video-encode / -decode. Not touched by the extension; read so
  // that a change is judged rather than missed.
  t('rtc.sendCodecs', () => {
    const s = {}; RTCRtpSender.getCapabilities('video').codecs.forEach((c) => { s[c.mimeType] = 1; });
    return Object.keys(s).sort().join(',');
  });
  t('rtc.recvCodecs', () => {
    const s = {}; RTCRtpReceiver.getCapabilities('video').codecs.forEach((c) => { s[c.mimeType] = 1; });
    return Object.keys(s).sort().join(',');
  });

  // the shape of what we wrap: a native-looking function stays native-looking
  t('toString.gbcr', () => String(Element.prototype.getBoundingClientRect));
  t('toString.getParameter', () => String(WebGLRenderingContext.prototype.getParameter));
  t('toString.getImageData', () => String(CanvasRenderingContext2D.prototype.getImageData));
  t('toString.Worker', () => String(Worker));
  t('descriptor.hardwareConcurrency', () => {
    const d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency');
    return 'enumerable=' + d.enumerable + ' configurable=' + d.configurable + ' name=' + (d.get && d.get.name);
  });

  // an error stack must not name a third party
  t('stack.namesExtension', () => {
    try { Object.getOwnPropertyDescriptor(Screen.prototype, 'width').get.call(null); return 'did not throw'; }
    catch (e) { return /chrome-extension:\/\//.test(String(e.stack)) ? 'YES' : 'no'; }
  });
  return out;
}

/** The seven groups that cannot be read synchronously. Started now, answered whenever. */
async function collectAsync() {
  const out = {};

  // client hints, the half behind a promise
  try {
    const hev = await navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness',
      'model', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64', 'formFactors']);
    for (const k of Object.keys(hev).sort()) out['uad.hev.' + k] = JSON.stringify(hev[k]);
  } catch (e) { out['uad.hev'] = 'THREW ' + e.name; }

  // permissions — the state a page reads WITHOUT prompting
  for (const n of ['geolocation', 'notifications', 'camera', 'microphone', 'midi']) {
    try { out['permissions.' + n] = (await navigator.permissions.query({ name: n })).state; }
    catch (e) { out['permissions.' + n] = 'THREW ' + e.name; }
  }

  // speech
  out.voices = await new Promise((res) => {
    const read = () => {
      const v = speechSynthesis.getVoices();
      if (v.length) res(v.map((x) => x.name + '/' + x.lang + (x.default ? '*' : '')).join('|'));
    };
    try { speechSynthesis.addEventListener('voiceschanged', read); } catch (e) {}
    read();
    setTimeout(() => res(String(speechSynthesis.getVoices().length) + ' voices, none named'), 2500);
  });

  // device state
  try {
    const b = await navigator.getBattery();
    out['battery.charging'] = String(b.charging);
    out['battery.level'] = String(b.level);
  } catch (e) { out['battery'] = 'THREW ' + e.name; }
  out['geolocation.position'] = await new Promise((res) => {
    if (!navigator.geolocation) return res('(none)');
    navigator.geolocation.getCurrentPosition(
      (p) => res(p.coords.latitude.toFixed(3) + ',' + p.coords.longitude.toFixed(3) + '/' + p.coords.accuracy),
      (e) => res('ERR ' + e.code), { timeout: 4000 });
    setTimeout(() => res('TIMEOUT'), 4500);
  });

  // WebGPU
  try {
    const a = await navigator.gpu.requestAdapter();
    for (const k of ['vendor', 'architecture', 'device', 'description']) out['webgpu.' + k] = String(a.info[k]);
    out['webgpu.features'] = [...a.features].sort().join(',');
    const lim = {}; for (const k in a.limits) lim[k] = a.limits[k];
    out['webgpu.limits'] = Object.keys(lim).sort().map((k) => k + '=' + lim[k]).join(',');
  } catch (e) { out['webgpu'] = 'THREW ' + e.name; }

  // the decoder — powerEfficient is Chrome's word for "a hardware decoder exists", i.e.
  // the real card. Measured on an Intel Arc: AV1 true/true/true; with hardware decode
  // disabled: AV1 true/true/false and HEVC false/false/false (Chrome has no software HEVC).
  for (const [name, ct] of [['av1', 'video/mp4; codecs="av01.0.08M.08"'], ['hevc', 'video/mp4; codecs="hvc1.1.6.L93.B0"'],
    ['vp9', 'video/webm; codecs="vp09.00.10.08"'], ['h264', 'video/mp4; codecs="avc1.42E01E"']]) {
    try {
      const r = await navigator.mediaCapabilities.decodingInfo({ type: 'file',
        video: { contentType: ct, width: 1920, height: 1080, bitrate: 5e6, framerate: 30 } });
      out['media.decode.' + name] = [r.supported, r.smooth, r.powerEfficient].join('/');
    } catch (e) { out['media.decode.' + name] = 'THREW ' + e.name; }
  }

  // storage quota. Checked 2026-09-02 on a real Chrome 148 and on the rig's Chromium, same
  // machine, 322 GB system volume: both answer exactly 10 GiB (10737418240) for an ordinary
  // origin, in the window and in a worker — a constant, not the 60%-of-disk figure older
  // builds reported. Read so that a browser that starts answering the disk again lands in
  // the queue rather than in a fingerprint.
  try { out['storage.quota'] = String((await navigator.storage.estimate()).quota); }
  catch (e) { out['storage.quota'] = 'THREW ' + e.name; }

  // audio
  out['audio.hash'] = await new Promise((res) => {
    try {
      const ctx = new OfflineAudioContext(1, 5000, 44100);
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 10000;
      const c = ctx.createDynamicsCompressor(); o.connect(c); c.connect(ctx.destination); o.start(0);
      ctx.startRendering().then((buf) => {
        const d = buf.getChannelData(0); let s = 0;
        for (let i = 4000; i < 5000; i++) s += Math.abs(d[i]); res(s.toFixed(8));
      });
    } catch (e) { res('THREW'); }
  });

  return out;
}

/**
 * Source text of both halves, for injection. Consumers paste this and then call the two
 * names themselves, because WHEN each half is called is the thing they disagree about.
 */
export const SOURCE = [String(collectSync), String(collectAsync)].join('\n\n');

/** One expression evaluating to a promise of every value — what probe-diff wants. */
export const EXPR =
  '(async () => {\n' + SOURCE + '\nreturn Object.assign(collectSync(), await collectAsync());\n})()';
