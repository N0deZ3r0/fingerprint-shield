/**
 * Cold start: does a freshly opened tab describe the SELECTED machine at
 * document_start, or the bootstrap stub?
 *
 *   node test/coldstart.mjs             headless
 *   node test/coldstart.mjs --headed    watch it happen
 *
 * Unlike test/run.mjs, which loads the dev-*.html pages as ordinary pages, this suite
 * loads the extension for real — chromium.launchPersistentContext with --load-extension —
 * because what is under test is content-script timing, and timing is the one thing a
 * dev page cannot fake.
 *
 * The probe is the FIRST inline script in <head>: the earliest moment a page's own
 * fingerprinting code can run, and the moment every async path in the extension loses.
 * Before dyn/ existed this suite reported 8 cores / 1920x1080 / Iris Xe /
 * America/New_York on a cold tab and the selected machine after F5 — the same visitor,
 * two machines, one reload apart.
 *
 * Expected values are read from the live tables (popup PROFILES, background
 * COUNTRY_DATA) rather than written out here, so a table edit cannot leave this suite
 * asserting yesterday's numbers.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, loadBackground, loadPopup, bootSettled } from './harness.mjs';
const headed = process.argv.includes('--headed');
// afpPackFeatures comes from defaults.js, which the harness inlines ahead of background.js
// — the same function the extension itself uses to write 'v.ui.f', so the value this suite
// waits for is the value the extension writes rather than a second guess at the encoding.
const { COUNTRY_DATA, GPU_DATA, afpPackFeatures, AFP_DEFAULT_FEATURES } =
  loadBackground(['COUNTRY_DATA', 'GPU_DATA', 'afpPackFeatures', 'AFP_DEFAULT_FEATURES']);
const { PROFILES } = loadPopup(['PROFILES']);

// A worker is a separate scope with its own copy of the profile, and CreepJS hashes it
// separately from the window — so a worker that froze the bootstrap stub while the window
// went on to be corrected is a visible split, not a cosmetic one. Measured with dyn/
// removed: on a cold tab the window reported Europe/Berlin and this worker
// America/New_York, in the same page load.
const WORKER = `
self.onmessage = function () {
  var r = '';
  try {
    var c = new OffscreenCanvas(1, 1);
    var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    var e = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (e) r = gl.getParameter(e.UNMASKED_RENDERER_WEBGL);
  } catch (err) {}
  postMessage({
    gpu: r,
    tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return '?'; } })(),
    lang: navigator.language,
    cores: navigator.hardwareConcurrency
  });
};
`;

const PROBE = `<!doctype html><html><head><script>
// [FIX profile-readable-by-any-page] What a page can actually harvest out of web storage.
// Every VALUE is scanned rather than one known key, so moving the profile to a different
// or randomised key would not make this pass — a profile is recognisable by its contents.
// Called twice per scenario: once from the first inline script (the earliest a page can
// look) and once after background.js has done its ~300ms inject, which is the moment the
// full machine used to land in sessionStorage.
window.__leak = function () {
  var hits = [];
  var SIG = /userAgent|webglRenderer|hwConcurrency|allowedFonts|noiseSeed|screenWidth|profileId/;
  try {
    for (var i = 0; i < sessionStorage.length; i++) {
      var k = sessionStorage.key(i);
      if (SIG.test(sessionStorage.getItem(k) || '')) hits.push('session:' + k);
    }
    for (var j = 0; j < localStorage.length; j++) {
      var lk = localStorage.key(j);
      if (SIG.test(localStorage.getItem(lk) || '')) hits.push('local:' + lk);
    }
  } catch (e) {}
  return hits.join(',');
};
// The residual channel, counted rather than assumed. With the profile in a closure this
// event is the ONLY thing that carries a late profile into the page, so a page that never
// receives one is a page whose profile never updated — and this is also, stated plainly,
// the thing a determined site could still intercept. Registered from the first inline
// script, i.e. the earliest a page could possibly do it.
window.__stateEvents = 0;
document.addEventListener('ui:state', function () { window.__stateEvents++; });
window.__snap = function () {
  var r = '';
  try {
    var c = document.createElement('canvas');
    var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    var e = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (e) r = gl.getParameter(e.UNMASKED_RENDERER_WEBGL);
  } catch (err) {}
  // [FIX profile-readable-by-any-page] This used to be
  // JSON.parse(sessionStorage.getItem('v.ui.s')) — this probe IS a page script, so it
  // was demonstrating the leak while testing for its absence. The selection is read off
  // the bridge attributes instead, which is where dyn/boot.js publishes it on purpose;
  // everything else below is a real observable and needs no help.
  // [FIX machine-skeleton-sat-in-a-dom-attribute] profileId is deliberately NOT observable
  // from the page any more — data-v-hw carried the whole machine on <html> and was removed.
  // The selection is asserted through what it actually produces (cores, memory, screen,
  // renderer, timezone, languages), which is the better test anyway: it checks the effect
  // rather than our own internal channel.
  // mode is likewise no longer observable from the page: data-v-md went the same way
  // ([FIX bridge-attributes-were-an-extension-detector]). Stealth is asserted by what it
  // does — the machine it still reports — not by a flag we hand the page.
  return {
    cores: navigator.hardwareConcurrency,
    mem: navigator.deviceMemory,
    screen: screen.width + 'x' + screen.height,
    tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return '?'; } })(),
    lang: navigator.language,
    langs: (navigator.languages || []).join(','),
    gpu: r,
    leak: window.__leak(),
    // CreepJS's own voiceLangMismatch computation, run at the same early moment it runs:
    // the default localService voice's language vs the Intl locale. A mismatch sets
    // LowerEntropy.TIME_ZONE, which paints the Timezone and Intl section hashes red
    // without recording any lie (totalLies stays 0).
    voiceLang: (function () {
      try {
        var d = (speechSynthesis.getVoices() || []).filter(function (x) { return x.default && x.localService; });
        return d.length === 1 ? d[0].lang : '(' + d.length + ' defaults)';
      } catch (e) { return '?'; }
    })()
  };
};
// [FIX cold-start-gl-limits] / [FIX cold-start-machine-remainder] The point of these two
// is that the FIRST line of a page and the steady state agree. Captured here and captured
// again after background.js has injected, then compared — the failure they exist to catch
// is not a wrong value, it is two different values one reload apart.
window.__gl = function () {
  var o = { renderer: '', maxTex: null, maxVary: null, maxVertUnif: null, aniso: null };
  try {
    var gl = document.createElement('canvas').getContext('webgl') ||
             document.createElement('canvas').getContext('experimental-webgl');
    if (gl) {
      o.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      o.maxVary = gl.getParameter(gl.MAX_VARYING_VECTORS);
      o.maxVertUnif = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS);
      var ae = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ae) o.aniso = gl.getParameter(ae.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      var de = gl.getExtension('WEBGL_debug_renderer_info');
      if (de) o.renderer = gl.getParameter(de.UNMASKED_RENDERER_WEBGL);
    }
  } catch (e) { o.err = String(e); }
  return o;
};
// NO FONT PROBE HERE, AND THIS IS THE REASON — do not add one back without reading it.
// (Also: this block is inside a template literal, so no backticks in it.)
//
// allowedFonts was an empty array in the cold-start profile before this work, so "does a
// family measure natively or fall back to the generic at the first line" looks like the
// obvious behavioural check. It is not measurable from here. Measured on this rig, with
// the extension loaded and the full list in place:
//
//   at the first inline script      MS Gothic → 105.625  (the monospace fallback)
//   ~2.5s later, same page          MS Gothic →  88.00   (resolved)
//
// The same two-step happens for Sylfaen, Ebrima, Malgun Gothic and Gabriola, and it does
// not depend on our list at all: it is Chrome's own font matching, which needs a browser
// -process round trip on Windows and answers with the fallback until that cache is warm.
// An early-vs-late comparison therefore measures the font cache warming up, and passes
// green against a build with allowedFonts deliberately emptied — verified, twice, which
// is how this note came to be written.
//
// What guards the font list instead is static and exact: test/parity-static.mjs compares
// the WIN_FONTS literal in profile-injector.js against the allowedFonts literal in
// background.js entry by entry, so the cold-start profile cannot carry a different list
// from the one that replaces it. Two other traps worth recording for whoever tries again:
// the families must be ones in allowedFonts but NOT in the 23-name _BASE_FONTS (Segoe UI,
// Wingdings and Arial are in _BASE_FONTS and resolve either way), and the comparison must
// tolerate ~0.013 of canvas text noise while looking for a ~17-unit shift.
window.__early = window.__snap();
window.__earlyGl = window.__gl();
// UA-CH is async, so it is captured as a promise the same way the worker is. The value
// must agree with the sec-ch-ua-platform-version the server actually received: the DNR
// rule sends the host's real bucket from the first request, and the cold start used to
// leave the JS side on the '10.0.0' fallback underneath it.
window.__uach = navigator.userAgentData
  ? navigator.userAgentData.getHighEntropyValues(['platformVersion'])
      .then(function (h) { return h.platformVersion; })
      .catch(function () { return 'ERR'; })
  : Promise.resolve('unsupported');
// Started from the same inline script, the earliest a page can spawn one.
window.__worker = new Promise(function (res) {
  try {
    var w = new Worker('/w.js');
    var t = setTimeout(function () { res({ error: 'timeout' }); }, 8000);
    w.onmessage = function (e) { clearTimeout(t); res(e.data); };
    w.onerror = function (e) { clearTimeout(t); res({ error: 'onerror ' + e.message }); };
    w.postMessage(1);
  } catch (e) { res({ error: String(e) }); }
});
</script></head><body>probe</body></html>`;

/**
 * The first ordinary Latin TTF this host has, or null. Preferred names first so the face is
 * the same on every run of a given OS; the recursive scan is the fallback.
 */
function probeFace() {
  const roots = ['C:/Windows/Fonts', '/usr/share/fonts', '/System/Library/Fonts'];
  const preferred = ['arial.ttf', 'DejaVuSans.ttf', 'LiberationSans-Regular.ttf', 'Arial.ttf'];
  for (const dir of roots) {
    let names;
    try { names = readdirSync(dir, { recursive: true }).map(String); } catch (e) { continue; }
    const hit = names.find((n) => preferred.includes(n.split(/[\\/]/).pop())) ||
      names.find((n) => /\.ttf$/i.test(n));
    if (hit) { try { return readFileSync(join(dir, hit)); } catch (e) { /* raced */ } }
  }
  return null;
}

function serve() {
  return new Promise((ok) => {
    const s = createServer((req, res) => {
      if (req.url.startsWith('/w.js')) {
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(WORKER);
        return;
      }
      if (req.url.startsWith('/framed')) {
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
          .end('<!doctype html><html><body><iframe name="widget-channel" src="/inner"></iframe></body></html>');
        return;
      }
      if (req.url.startsWith('/canvasflag')) {
        // The same drawing as /canvasseed, but NOT read while the document is being parsed.
        // That difference is the whole point — see the note at the canvas assertion below.
        //
        // EVERY byte is hashed here, where /canvasseed samples every 997th, and that is not
        // a detail. The canvas noise is sparse, the seed is minted fresh by each apply(), and
        // a sparse sample can miss the perturbed bytes entirely: the assertion below passed
        // ONCE against a deliberately broken build before this was measured and changed. A
        // check that can go green on the bug it was written for is worth less than no check.
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(
          '<!doctype html><html><head><script>' +
          'window.__cv = function () {' +
          '  var c = document.createElement("canvas"); c.width = 300; c.height = 150;' +
          '  var x = c.getContext("2d"); x.textBaseline = "top"; x.font = "14px Arial";' +
          '  x.fillStyle = "#f60"; x.fillRect(0, 0, 100, 50);' +
          '  x.fillStyle = "#069"; x.fillText("Cwm fjordbank glyphs vext quiz", 2, 15);' +
          '  var d = x.getImageData(0, 0, 300, 150), h = 0;' +
          '  for (var i = 0; i < d.data.length; i++) h = (h * 31 + d.data[i]) >>> 0;' +
          '  return h;' +
          '};' +
          '</script></head><body>flag</body></html>');
        return;
      }
      if (req.url.startsWith('/canvasseed')) {
        // Hashes a drawing from the FIRST inline script and again on demand. Any change in
        // the number between the two means the noise seed changed under the page — see
        // scenario 10.
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(
          '<!doctype html><html><head><script>' +
          'window.__cv = function () {' +
          '  var c = document.createElement("canvas"); c.width = 300; c.height = 150;' +
          '  var x = c.getContext("2d"); x.textBaseline = "top"; x.font = "14px Arial";' +
          '  x.fillStyle = "#f60"; x.fillRect(0, 0, 100, 50);' +
          '  x.fillStyle = "#069"; x.fillText("Cwm fjordbank glyphs vext quiz", 2, 15);' +
          '  var d = x.getImageData(0, 0, 300, 150), h = 0;' +
          '  for (var i = 0; i < d.data.length; i += 997) h = (h * 31 + d.data[i]) >>> 0;' +
          '  return h;' +
          '};' +
          'window.__early = window.__cv();' +
          '</script></head><body>seed</body></html>');
        return;
      }
      if (req.url.startsWith('/rects')) {
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(
          '<!doctype html><html><body>' +
          '<span id="d" style="font:16px Arial">WeBrowserTools.com &lt;canvas&gt; 1.0</span>' +
          '<div id="k" style="position:absolute;left:10px;top:20px;width:400px;height:100px"></div>' +
          '<script>window.__rects = function () {' +
          '  var el = document.getElementById("d");' +
          '  var b = el.getBoundingClientRect(), c = el.getClientRects()[0];' +
          '  var known = document.getElementById("k").getBoundingClientRect();' +
          '  var own = new DOMRect(1.5, 2.5, 3.5, 4.5);' +
          '  var rng = document.createRange(); rng.selectNodeContents(el);' +
          '  var rb = rng.getBoundingClientRect();' +
          '  var k = function (r) { return [r.x, r.y, r.width, r.height, r.top, r.right, r.bottom, r.left].join("|"); };' +
          '  var ident = function (r) {' +
          '    var e = { width: r.right - r.left, height: r.bottom - r.top, right: r.left + r.width,' +
          '      left: r.right - r.width, bottom: r.top + r.height, top: r.bottom - r.height,' +
          '      x: r.right - r.width, y: r.bottom - r.height };' +
          '    return e.width === r.width && e.height === r.height && e.right === r.right &&' +
          '      e.left === r.left && e.bottom === r.bottom && e.top === r.top &&' +
          '      e.x === r.x && e.y === r.y; };' +
          '  return { b: k(b), c: k(c), sameBC: k(b) === k(c),' +
          '    widthOk: (b.right - b.left) === b.width, heightOk: (b.bottom - b.top) === b.height,' +
          '    xIsLeft: b.x === b.left, yIsTop: b.y === b.top,' +
          '    width: b.width,' +
          '    identElem: ident(b), identRange: ident(rb),' +
          '    knownUntouched: known.width === 400 && known.height === 100,' +
          '    ownUntouched: own.x === 1.5 && own.y === 2.5 && own.width === 3.5 && own.height === 4.5,' +
          '    json: JSON.stringify(b) === JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, top: b.top, right: b.right, bottom: b.bottom, left: b.left }),' +
          '    isRect: b instanceof DOMRect && Object.prototype.toString.call(el.getClientRects()) === "[object DOMRectList]" };' +
          '};</script></body></html>');
        return;
      }
      if (req.url.startsWith('/tz')) {
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(
          '<!doctype html><html><body><iframe id="f"></iframe><script>' +
          'window.__tz = function () {' +
          '  function probe(w) {' +
          '    var f = new w.Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "full" });' +
          '    var ro = f.resolvedOptions();' +
          '    var nm = new w.Intl.DateTimeFormat(undefined, { timeZoneName: "long" }).formatToParts(new w.Date())' +
          '      .filter(function (p) { return p.type === "timeZoneName"; }).map(function (p) { return p.value; }).join("");' +
          '    return { full: f.format(new w.Date()), locale: ro.locale, tz: ro.timeZone, name: nm,' +
          '      dateToString: String(new w.Date()) };' +
          '  }' +
          '  return { win: probe(window), frame: probe(document.getElementById("f").contentWindow) };' +
          '};</script></body></html>');
        return;
      }
      if (req.url.startsWith('/font.ttf')) {
        // A real, loadable face under a family name that is NOT on the allowlist. Only a
        // genuine file makes the @font-face exemption observable: a declared family
        // shadows the local font of the same name, so a broken src always measures as the
        // fallback whether we exempted it or not.
        //
        // [FIX the-webfont-fixture-was-a-windows-path] This read C:/Windows/Fonts/arial.ttf
        // and 404'd anywhere else, so `webFontKept` came back false and one assertion of
        // 160 was red for the RIG rather than for the build — measured on Ubuntu 24.04,
        // `159 passed, 1 failed`, "fonts: a family registered via @font-face is never
        // blocked". Which face it is does not matter to what is asked here: the probe only
        // wants to know whether a family the PAGE declares is exempt from the allowlist. So
        // the first ordinary Latin face on disk is served, and a host with none 404s
        // exactly as before rather than pretending to have one.
        const buf = probeFace();
        if (buf) res.writeHead(200, { 'content-type': 'font/ttf', 'cache-control': 'no-store' }).end(buf);
        else res.writeHead(404).end();
        return;
      }
      if (req.url.startsWith('/fonts')) {
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(
          '<!doctype html><html><head><style>@font-face{font-family:AfpProbeFace;src:url(/font.ttf)}</style></head>' +
          // CSS loads a face lazily, on first use — without this the probe would measure
          // AfpProbeFace before it exists and see the fallback, which is what a blocked
          // family looks like.
          '<body><span style="font-family:AfpProbeFace">preload</span><span id="s"></span>' +
          '<script>window.__fonts = function () {' +
          '  var el = document.getElementById("s");' +
          '  el.style.fontSize = "72px"; el.style.position = "absolute";' +
          '  el.textContent = "mmmmmmmmmmlliWwMmIi0Oo";' +
          '  var c = document.createElement("canvas").getContext("2d");' +
          '  function dom(f) { el.style.fontFamily = f + ",monospace"; return [el.offsetWidth, Math.round(el.getBoundingClientRect().width)]; }' +
          '  function cv(f) { c.font = "72px " + f + ",monospace"; return c.measureText(el.textContent).width; }' +
          '  var base = dom("monospace"), cbase = cv("monospace");' +
          '  var allowed = dom("Arial"), blocked = dom("Agency FB");' +
          '  var cAllowed = cv("Arial"), cBlocked = cv("Agency FB");' +
          '  el.style.fontFamily = "Agency FB,monospace";' +
          '  var before = el.getAttribute("style");' +
          '  var w = el.offsetWidth;' +
          '  var after = el.getAttribute("style");' +
          '  var webFont = dom("AfpProbeFace");' +
          '  return { base: base, allowed: allowed, blocked: blocked,' +
          '    canvasBlockedIsBase: Math.abs(cBlocked - cbase) < 0.05,' +
          '    canvasAllowedDiffers: Math.abs(cAllowed - cbase) > 1,' +
          '    styleIntact: before === after, w: w, webFontKept: webFont[0] !== base[0] };' +
          '};</script></body></html>');
        return;
      }
      if (req.url.startsWith('/inner')) {
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
          .end('<!doctype html><html><body>inner</body></html>');
        return;
      }
      if (req.headers['sec-ch-ua-platform-version']) {
        lastPlatformVersionHeader = req.headers['sec-ch-ua-platform-version'].replace(/"/g, '');
      }
      res.writeHead(200, {
        'content-type': 'text/html',
        'cache-control': 'no-store',
        'accept-ch': 'sec-ch-ua-platform-version',
        'critical-ch': 'sec-ch-ua-platform-version'
      }).end(PROBE);
    });
    s.listen(0, () => ok({ server: s, port: s.address().port }));
  });
}

let lastPlatformVersionHeader = null;

let passed = 0;
const failures = [];
function eq(got, want, msg) {
  if (got === want) passed++;
  else failures.push(`${msg} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/** What the popup writes when you pick this machine and this country, plus what the
 *  page must then report. */
function selection(profileId, cc, mode = 'normal') {
  const p = PROFILES.find((x) => x.id === profileId);
  const c = COUNTRY_DATA[cc];
  if (!p) throw new Error(`no such profile in popup PROFILES: ${profileId}`);
  if (!c) throw new Error(`no such country in background COUNTRY_DATA: ${cc}`);
  return {
    storage: {
      afp_profile_id: p.id,
      afp_profile_data: {
        screenW: p.screenW, screenH: p.screenH, cores: p.cores,
        memory: p.memory, gpu: p.gpuKey, platform: p.platform
      },
      afp_country_code: cc,
      afp_resolved_timezone: c.tz,
      afp_resolved_locale: c.loc,
      afp_mode: mode
    },
    want: {
      cores: p.cores,
      // buildProfile buckets deviceMemory; 24/32/64 GB machines all report 32.
      mem: p.memory <= 2 ? 2 : p.memory <= 4 ? 4 : p.memory <= 8 ? 8 : p.memory <= 16 ? 16 : 32,
      screen: `${p.screenW}x${p.screenH}`,
      tz: c.tz,
      lang: c.loc,
      // [FIX languages-was-the-header-list] Not derived from the Accept-Language string any
      // more. Measured on a clean browser with the field-trial config left on: the header
      // expands a regional tag with its base ('et-EE,et;q=0.9') while navigator.languages
      // stays the configured language alone (['et-EE']). background.js now says the same.
      langs: c.loc,
      gpu: GPU_DATA[p.gpuKey].unmaskedRenderer,
      leak: ''
    }
  };
}

function check(label, snap, want) {
  for (const k of Object.keys(want)) eq(snap[k], want[k], `${label}: ${k}`);
}

const { server, port } = await serve();
const userDataDir = mkdtempSync(join(tmpdir(), 'afp-coldstart-'));
const launch = () => chromium.launchPersistentContext(userDataDir, {
  ...BROWSER,
  headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
let ctx = await launch();

try {
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  // [FIX cold-start-flaked-on-two-clock-bets] Both waits here were fixed sleeps, and the
  // flake ledger caught both on the two-core runner — 2 failures in 15 runs of this suite
  // alone, with the assertions naming exactly these two races:
  //
  //   run 5   every value was the DEFAULT profile — 8 cores where the fixture says 16,
  //           America/New_York where it says Europe/Berlin — because initDefaults had not
  //           finished when the fixture was written and landed on top of it.
  //   run 12  `stealth: cores — got 4, want 12`, the PREVIOUS selection's cores: the boot
  //           script had not been re-registered for the new one when the tab opened.
  //
  // Neither is a guess about the extension. Both are this file betting that 1200 and 1500
  // milliseconds are enough on a machine it has never seen. What it is actually waiting for
  // has a name in both cases, so it waits for that.
  const applied = async (sel) => sw.evaluate(async (want) => {
    const reg = await chrome.scripting.getRegisteredContentScripts({ ids: ['afp-boot'] });
    const js = (reg[0] && reg[0].js) || [];
    const st = await chrome.storage.local.get(['afp_profile_id', 'afp_country_code', 'afp_mode']);
    return js.includes(want.dev) && js.includes(want.cc) &&
      st.afp_profile_id === want.id && st.afp_country_code === want.code &&
      st.afp_mode === want.mode;
  }, {
    dev: `dyn/dev/${sel.storage.afp_profile_id}.js`,
    cc: `dyn/cc/${sel.storage.afp_country_code}.js`,
    id: sel.storage.afp_profile_id,
    code: sel.storage.afp_country_code,
    mode: sel.storage.afp_mode
  });

  const apply = async (sel) => {
    await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, sel.storage);
    // registerBootScript runs off storage.onChanged; the popup awaits applyToCurrentTab
    // before it reloads the tab, which is the same wait by another name. Waited for by the
    // VALUE — the registered files and the stored selection both being this one — because a
    // tab opened before that is a tab describing the previous machine.
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      if (await applied(sel).catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`the boot script never came to describe ${sel.storage.afp_profile_id}/` +
      `${sel.storage.afp_country_code}/${sel.storage.afp_mode} within 20s — every reading ` +
      'after this would be of some other machine');
  };
  const early = async (url) => {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const snap = await page.evaluate(() => window.__early);
    return { page, snap };
  };

  // The other half of the same lesson: this stood in for initDefaults finishing, and a
  // fixture written before it finishes is a fixture the background overwrites.
  await bootSettled(ctx);

  // 1. A brand-new tab, the case the popup's own "close and reopen" flow produces.
  const a = selection('pc_power', 'DE');
  await apply(a);
  const first = await early(`http://127.0.0.1:${port}/`);
  check('new tab', first.snap, a.want);

  // 1b. The worker scope of that same cold tab. A worker that answers with a different
  //     machine than its own window is the split CreepJS reports as a scope mismatch,
  //     and hasBadWebGL is exactly `main UNMASKED_RENDERER !== worker renderer`.
  // 1c. The voice list at document_start must already belong to the selected country,
  //     because CreepJS reads it within ~300ms of page start and never looks again.
  eq(first.snap.voiceLang.split('-')[0], a.want.lang.split('-')[0],
    'new tab: default voice language matches the locale (CreepJS voiceLangMismatch)');

  // 1d. The JS layer and the HTTP layer must tell the same Windows family. Asserted
  //     against the header the server saw rather than a literal, so this holds on a
  //     Windows 10 host too.
  //
  //     [FIX unsolicited-client-hints] platform-version is a HIGH-entropy hint: Chrome
  //     sends it only to origins that asked via Accept-CH, so the extension no longer sets
  //     it on every request. It is stripped by default and restored, with the profile's
  //     value, only for origins observed asking — which means it appears from the request
  //     AFTER the opt-in is learned, exactly as Chrome's own hints do. This navigation is
  //     what makes that request happen; the assertion below is unchanged in substance, and
  //     the strip-by-default is what stops the race leaking the host's real build (measured
  //     before it existed: the server got the host's "19.0.0" against the profile's
  //     "15.0.0").
  //     The wait is the opt-in being learned: the Accept-CH observation is coalesced by a
  //     short timer before it becomes a rule, so a navigation fired immediately after the
  //     first response would still race it. Measured on a bare harness, the sequence is
  //     [null, null, "15.0.0", "15.0.0"] — stripped until the rule lands, the profile's
  //     value from then on.
  //     Polled rather than slept on. A fixed 1200 ms wait was tried first and produced an
  //     intermittent failure — the opt-in has to travel response -> webRequest listener ->
  //     storage -> a coalescing timer -> a DNR write, and under load that overruns any
  //     constant someone picks. Re-navigating until the header actually shows is the same
  //     thing the browser does anyway, and it cannot be flaky: it either arrives inside the
  //     budget or the assertion below reports honestly that it never did.
  for (let i = 0; i < 12 && typeof lastPlatformVersionHeader !== 'string'; i++) {
    await new Promise((r) => setTimeout(r, 400));
    await first.page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  }
  const uach = await first.page.evaluate(() => window.__uach);
  eq(typeof lastPlatformVersionHeader, 'string', 'platformVersion: the server received the hint');
  eq(uach, lastPlatformVersionHeader, 'platformVersion: JS agrees with sec-ch-ua-platform-version');

  // 1e. The profile is not in the page's storage — not at the first line (checked by
  //     `leak` in the snapshot above), and not after background.js delivers the full one
  //     either, which is the moment it used to be written into sessionStorage['v.ui.s'].
  const delivered = await first.page
    .waitForFunction(() => window.__stateEvents > 0, null, { timeout: 10000 })
    .then(() => true).catch(() => false);
  eq(delivered, true, 'new tab: background delivered the profile over ui:state');
  eq(await first.page.evaluate(() => window.__leak()), '',
    'new tab: web storage still holds nothing profile-shaped after that delivery');

  // 1f. The rest of the machine, which used to arrive only with that delivery.
  //
  //     UNMASKED_RENDERER named the spoofed card from the first line, but every NUMERIC
  //     limit still came from the real driver until the profile landed — an Arc claiming
  //     to be an Iris Xe, with the Arc's MAX_TEXTURE_SIZE underneath. Same shape for
  //     allowedFonts, which was `[]` at document_start. Nothing exposed it before,
  //     because a reload found the previous load's profile in sessionStorage; with the
  //     profile in a closure every load is the cold one, so the skeleton has to be
  //     complete rather than merely early.
  //
  //     READ THIS BEFORE TRUSTING THE getParameter ASSERTIONS BELOW. GPU_DATA's table is
  //     a MEASURED ANGLE/D3D11 table, and on a host that is itself ANGLE/D3D11 every
  //     entry in it equals the host's own value — verified on the development machine
  //     (Intel Arc): all 19 identical over a WebGL2 context. So a "the limit equals the
  //     table" assertion cannot fail there no matter what the code does, and neither can
  //     early-vs-late. That is not a flaw in the spoof — matching real hardware is the
  //     entire objective — but it does mean those two checks only bite on a host whose
  //     GPU disagrees with the table.
  //
  //     The channel used to be asserted here by reading data-v-hw off <html>. That
  //     attribute is gone — it published the whole machine to any script that asked
  //     ([FIX machine-skeleton-sat-in-a-dom-attribute]) — and a test has no business
  //     depending on an internal channel anyway. test/parity-static.mjs asserts the
  //     generator, dyn/boot.js and profile-injector.js still carry glParams; what is left
  //     here is the behaviour.
  const glTable = GPU_DATA[PROFILES.find((p) => p.id === 'pc_power').gpuKey].webglParams;

  const earlyGl = await first.page.evaluate(() => window.__earlyGl);
  const lateGl = await first.page.evaluate(() => window.__gl());
  eq(JSON.stringify(earlyGl), JSON.stringify(lateGl),
    'gl limits: the first line of the page and the steady state agree');
  eq(lateGl.maxTex, glTable[3379], 'gl limits: MAX_TEXTURE_SIZE agrees with the profile table');
  eq(lateGl.maxVary, glTable[36348], 'gl limits: MAX_VARYING_VECTORS agrees with the profile table');
  eq(lateGl.maxVertUnif, glTable[36347], 'gl limits: MAX_VERTEX_UNIFORM_VECTORS agrees with the profile table');

  //     allowedFonts is the other half of the same fix and is NOT asserted from here —
  //     see the long note next to __gl in the probe for the measurements that rule it out
  //     (Chrome's font cache answers with the fallback for the first ~2s regardless of
  //     our list). test/parity-static.mjs compares the two font literals directly instead.

  // 1h. Viewport geometry. Four APIs describe one window — innerWidth/Height,
  //     visualViewport, documentElement.client*, and outer*/screenX/screenY against the
  //     spoofed screen. A real browser cannot disagree with itself about any of it, and
  //     all four were wrong at once: the window getters were looked up on Window.prototype,
  //     where WebIDL does NOT put the members of a [Global] interface, so they fell back to
  //     a `return 0` stub and the code answered with the SPOOFED SCREEN instead. Measured
  //     before the fix — a real 900x600 window reported innerWidth 1920 and innerHeight 995
  //     and did not move when resized, while visualViewport next to it reported the honest
  //     900x600. That is a fingerprint contradiction and a plain layout bug in one.
  //
  //     Asserted as relationships, never as literals: the rig's window size is not fixed.
  const geo = await first.page.evaluate(() => ({
    sw: screen.width, sh: screen.height, aw: screen.availWidth, ah: screen.availHeight,
    ow: outerWidth, oh: outerHeight, iw: innerWidth, ih: innerHeight,
    sx: screenX, sy: screenY, sl: screenLeft, st: screenTop,
    vw: visualViewport.width, vh: visualViewport.height,
    cw: document.documentElement.clientWidth, ch: document.documentElement.clientHeight
  }));
  eq(geo.sx + geo.ow <= geo.sw, true, `viewport: the window fits the screen horizontally (${geo.sx}+${geo.ow} vs ${geo.sw})`);
  eq(geo.sy + geo.oh <= geo.ah, true, `viewport: the window fits the work area vertically (${geo.sy}+${geo.oh} vs ${geo.ah})`);
  eq(geo.sx === geo.sl && geo.sy === geo.st, true, 'viewport: screenX/Y and screenLeft/Top agree');
  eq(geo.iw <= geo.ow && geo.ih <= geo.oh, true, `viewport: inner fits inside outer (${geo.iw}x${geo.ih} in ${geo.ow}x${geo.oh})`);
  eq(geo.ow <= geo.aw && geo.oh <= geo.ah, true, 'viewport: outer fits the available area');
  eq(Math.abs(geo.vw - geo.iw) <= 1 && Math.abs(geo.vh - geo.ih) <= 1, true,
    `viewport: visualViewport matches innerWidth/Height (${geo.vw}x${geo.vh} vs ${geo.iw}x${geo.ih})`);
  eq(geo.cw <= geo.iw && geo.ch <= geo.ih, true,
    `viewport: documentElement.client* fits the viewport (${geo.cw}x${geo.ch} in ${geo.iw}x${geo.ih})`);
  // clientHeight used to come from offsetHeight — the CONTENT height, 18px on a short page.
  eq(geo.ch > 100, true, `viewport: clientHeight is the viewport, not the content box (${geo.ch})`);
  // CreepJS hasVvpScreenRes: the visual viewport must never equal the whole screen.
  eq(geo.vw === geo.sw && geo.vh === geo.sh, false, 'viewport: visualViewport is not the full screen (hasVvpScreenRes)');
  // And the metrics must be LIVE, not pinned to the profile's screen.
  await first.page.setViewportSize({ width: 812, height: 543 });
  await new Promise((r) => setTimeout(r, 400));
  const resized = await first.page.evaluate(() => ({
    iw: innerWidth, ih: innerHeight, vw: visualViewport.width, cw: document.documentElement.clientWidth
  }));
  eq(resized.iw, 812, 'viewport: innerWidth follows a real resize');
  eq(resized.ih, 543, 'viewport: innerHeight follows a real resize');
  eq(resized.vw, 812, 'viewport: visualViewport follows a real resize');
  eq(resized.cw, 812, 'viewport: documentElement.clientWidth follows a real resize');

  // 1i. Frames with an OPAQUE origin — data: and blob:.
  //
  //     `match_about_blank` covers about:blank and about:srcdoc and nothing else, so a
  //     data: frame ran with no content script at all: measured, it reported the host's
  //     screen, timezone, locale, core count, GPU and a userAgent still containing
  //     "HeadlessChrome". One line of HTML in the page under test and the whole extension
  //     was bypassed. A blob: frame was worse in a subtler way — the parent's frame patch
  //     reached its navigator and screen while its own Date and WebGL stayed native, so
  //     the frame contradicted itself: `+0300 (Eastern Daylight Time)`.
  //
  //     `match_origin_as_fallback` is what injects into a frame whose origin is opaque but
  //     derived from a matching one. Asserted from INSIDE the frame over postMessage,
  //     because a parent cannot reach into an opaque-origin child — which is exactly why
  //     the hole went unnoticed: every probe that reaches in gets a SecurityError first.
  const opaque = await first.page.evaluate(async () => {
    const INNER = '<script>' +
      'var d = { tz: Intl.DateTimeFormat().resolvedOptions().timeZone,' +
      ' off: new Date().getTimezoneOffset(), screen: screen.width + "x" + screen.height,' +
      ' cores: navigator.hardwareConcurrency, headless: navigator.userAgent.indexOf("Headless") !== -1 };' +
      'try { var g = document.createElement("canvas").getContext("webgl");' +
      ' var e = g.getExtension("WEBGL_debug_renderer_info");' +
      ' d.gl = g.getParameter(e.UNMASKED_RENDERER_WEBGL); } catch (err) { d.gl = "ERR"; }' +
      'parent.postMessage(JSON.stringify(d), "*");' +
      '<\/script>';
    const grab = (src, sandbox) => new Promise((res) => {
      const f = document.createElement('iframe');
      if (sandbox) f.setAttribute('sandbox', sandbox);
      f.src = src;
      const t = setTimeout(() => res({ err: 'timeout' }), 6000);
      const h = (e) => { try { const v = JSON.parse(e.data); clearTimeout(t); window.removeEventListener('message', h); res(v); } catch (x) {} };
      window.addEventListener('message', h);
      document.body.appendChild(f);
    });
    return {
      data: await grab('data:text/html,' + encodeURIComponent('<html><body>' + INNER + '</body></html>'), 'allow-scripts'),
      blob: await grab(URL.createObjectURL(new Blob(['<html><body>' + INNER + '</body></html>'], { type: 'text/html' })), null)
    };
  });
  const topOffset = await first.page.evaluate(() => new Date().getTimezoneOffset());
  for (const kind of ['data', 'blob']) {
    const f = opaque[kind] || {};
    eq(f.err, undefined, `${kind}: frame answered`);
    if (f.err) continue;
    eq(f.tz, a.want.tz, `${kind}: timezone is the profile's`);
    // The offset is the half that stayed native in a blob: frame while Intl above it was
    // already spoofed — the two disagreeing inside one frame is the detectable part.
    eq(f.off, topOffset, `${kind}: getTimezoneOffset agrees with the top frame`);
    eq(f.screen, a.want.screen, `${kind}: screen is the profile's`);
    eq(f.cores, a.want.cores, `${kind}: cores are the profile's`);
    eq(f.gl, a.want.gpu, `${kind}: renderer is the profile's`);
    eq(f.headless, false, `${kind}: the userAgent does not say Headless`);
  }

  // 1j. Module workers. `new Worker(url, {type:'module'})` went to the native constructor
  //     untouched, and a module worker is a complete scope — measured beside the classic
  //     one in the same page: Europe/Moscow, -180, 18 cores, ru-RU and a userAgent still
  //     saying HeadlessChrome, against the classic worker's fully spoofed answers. Two
  //     lines of script. Bundlers emit {type:'module'} by default, so this is the common
  //     shape now, not an exotic one.
  const modw = await first.page.evaluate(async () => {
    const BODY = 'var d = { tz: Intl.DateTimeFormat().resolvedOptions().timeZone,' +
      ' off: new Date().getTimezoneOffset(), cores: navigator.hardwareConcurrency,' +
      ' lang: navigator.language, headless: navigator.userAgent.indexOf("Headless") !== -1 };' +
      'try { var g = new OffscreenCanvas(1,1).getContext("webgl");' +
      ' var e = g.getExtension("WEBGL_debug_renderer_info");' +
      ' d.gl = g.getParameter(e.UNMASKED_RENDERER_WEBGL); } catch (err) { d.gl = "ERR"; }' +
      'postMessage(d);';
    const spawn = (opts) => new Promise((res) => {
      try {
        const w = new Worker(URL.createObjectURL(new Blob([BODY], { type: 'text/javascript' })), opts);
        const t = setTimeout(() => res({ err: 'timeout' }), 8000);
        w.onmessage = (e) => { clearTimeout(t); res(e.data); };
        w.onerror = (e) => { clearTimeout(t); res({ err: 'onerror ' + (e.message || '') }); };
      } catch (e) { res({ err: String(e).slice(0, 40) }); }
    });
    // A worker that spawns a worker. The parent was patched but did not wrap its own
    // Worker constructor, so the CHILD ran native — the same total bypass as data: frames
    // and module workers, and worker pools driven by a coordinator worker are an ordinary
    // pattern. The child reports through the parent.
    const NEST = 'var mine = (function(){' + BODY.replace('postMessage(d);', 'return d;') + '})();' +
      'var childSrc = "postMessage((function(){" + ' + JSON.stringify(BODY.replace('postMessage(d);', 'return d;')) + ' + "})());";' +
      'try {' +
      '  var cu = URL.createObjectURL(new Blob([childSrc], { type: "text/javascript" }));' +
      '  var c = new Worker(cu);' +
      '  c.onmessage = function (e) { postMessage({ mine: mine, child: e.data }); };' +
      '  c.onerror = function (e) { postMessage({ mine: mine, child: { err: "onerror" } }); };' +
      '  setTimeout(function () { postMessage({ mine: mine, child: { err: "timeout" } }); }, 6000);' +
      '} catch (err) { postMessage({ mine: mine, child: { err: String(err).slice(0, 30) } }); }';
    const nested = await new Promise((res) => {
      try {
        const w = new Worker(URL.createObjectURL(new Blob([NEST], { type: 'text/javascript' })));
        const t = setTimeout(() => res({ err: 'timeout' }), 10000);
        w.onmessage = (e) => { clearTimeout(t); res(e.data); };
        w.onerror = (e) => { clearTimeout(t); res({ err: 'onerror ' + (e.message || '') }); };
      } catch (e) { res({ err: String(e).slice(0, 40) }); }
    });
    return { classic: await spawn(undefined), module: await spawn({ type: 'module' }), nested };
  });
  eq(modw.module.err, undefined, 'module worker: started');
  if (!modw.module.err) {
    eq(modw.module.tz, a.want.tz, 'module worker: timezone is the profile\'s');
    eq(modw.module.cores, a.want.cores, 'module worker: cores are the profile\'s');
    eq(modw.module.lang, a.want.lang, 'module worker: language is the profile\'s');
    eq(modw.module.gl, a.want.gpu, 'module worker: renderer is the profile\'s');
    eq(modw.module.headless, false, 'module worker: the userAgent does not say Headless');
    // The two worker flavours must not disagree with each other either.
    eq(JSON.stringify(modw.module), JSON.stringify(modw.classic),
      'module and classic workers return identical answers');
  }
  eq(modw.nested && modw.nested.err, undefined, 'nested worker: the parent answered');
  if (modw.nested && !modw.nested.err) {
    const child = modw.nested.child || {};
    eq(child.err, undefined, 'nested worker: the child answered');
    if (!child.err) {
      eq(child.tz, a.want.tz, 'nested worker: child timezone is the profile\'s');
      eq(child.cores, a.want.cores, 'nested worker: child cores are the profile\'s');
      eq(child.gl, a.want.gpu, 'nested worker: child renderer is the profile\'s');
      eq(child.headless, false, 'nested worker: the child userAgent does not say Headless');
      eq(JSON.stringify(child), JSON.stringify(modw.nested.mine),
        'nested worker: child and parent return identical answers');
    }
  }

  // 1k. The three things CreepJS's worker-scope page compares window against a worker on,
  //     each of which had drifted apart. Reported by the user as "the workers diverged":
  //     with a clean browser Window, Dedicated and Shared all hash the SAME, and with the
  //     extension the Window hash stood alone.
  //
  //     * appVersion — WorkerNavigator implements NavigatorID, and appVersion was the one
  //       member the worker payload never set, so it still read "...HeadlessChrome...".
  //     * clientCode — getClientCode() opens with `if (/_$/.test(key)) return true`: a name
  //       ending in an underscore counts as client code unconditionally, past every
  //       native-looking check. `__AFP_P0__`, the profile baton, was republished on every
  //       afpSetProfile and so outlived mw-cleanup. A clean browser reports none.
  //     * measureText on an OffscreenCanvas — a blocked font was measured on a REGULAR
  //       canvas scratch, and the two interfaces do not measure alike (clean browser,
  //       16px monospace: 105.617 vs 96.766), so the substituted width did not match that
  //       context's own generic and the block undid itself.
  const scopeParity = await first.page.evaluate(async () => {
    const READ = `(function(){
      var mt = function (c, f) { c.font = '16px ' + f; var m = c.measureText('mwmwmwmwlli');
        return [m.actualBoundingBoxAscent, m.actualBoundingBoxDescent, m.width].join(','); };
      var oc = new OffscreenCanvas(64, 32).getContext('2d');
      var base = mt(oc, 'monospace');
      return { appVersion: navigator.appVersion, ua: navigator.userAgent,
        offBlockedIsGeneric: mt(oc, "'Agency FB', monospace") === base,
        offAllowedResolves: mt(oc, "'Segoe UI', monospace") !== base }; })()`;
    const win = eval(READ);
    const wk = await new Promise((res) => {
      const w = new Worker(URL.createObjectURL(new Blob(
        ['self.onmessage=function(){postMessage(' + READ + ');};'], { type: 'text/javascript' })));
      const t = setTimeout(() => res({ err: 'timeout' }), 8000);
      w.onmessage = (e) => { clearTimeout(t); res(e.data); };
      w.onerror = () => { clearTimeout(t); res({ err: 'onerror' }); };
      w.postMessage(1);
    });
    // getClientCode, verbatim from creepjs/tests/workers.js
    const limit = 50;
    const [p1, p2] = (1).constructor.toString().split((1).constructor.name);
    const isEngine = (fn) => typeof fn !== 'function' ||
      ('' + fn === p1 + fn.name + p2 || '' + fn === p1 + (fn.name || '').replace('get ', '') + p2);
    const isClient = (obj, key) => {
      if (/_$/.test(key)) return true;
      const d = Object.getOwnPropertyDescriptor(obj, key);
      return !d || !isEngine(d.get || d.value);
    };
    let code = Object.keys(self).slice(-limit).filter((x) => isClient(self, x));
    Object.getOwnPropertyNames(self).slice(-limit).forEach((x) => {
      if (!code.includes(x) && isClient(self, x)) code.push(x);
    });
    code = [...code, ...Object.getOwnPropertyNames(self.navigator)];
    const navProto = Object.getPrototypeOf(self.navigator);
    Object.getOwnPropertyNames(navProto).forEach((x) => {
      if (!code.includes(x) && isClient(navProto, x)) code.push(x);
    });
    return { win, wk, code };
  });
  eq(scopeParity.wk.err, undefined, 'scope parity: the worker answered');
  if (!scopeParity.wk.err) {
    eq(scopeParity.wk.appVersion, scopeParity.win.appVersion, 'scope parity: appVersion matches the window');
    eq(/Headless/.test(String(scopeParity.wk.appVersion)), false, 'scope parity: worker appVersion does not say Headless');
    eq(scopeParity.wk.offBlockedIsGeneric, scopeParity.win.offBlockedIsGeneric,
      'scope parity: a blocked font measures the same way in both scopes');
    eq(scopeParity.win.offBlockedIsGeneric, true,
      'scope parity: a blocked font measures as the generic on an OffscreenCanvas');
    eq(scopeParity.win.offAllowedResolves, true,
      'scope parity: an allowed font still resolves on an OffscreenCanvas');
  }
  // The probe page IS a page script, so its own helpers are legitimate client code and a
  // clean browser running this same page would report them too. Listed explicitly rather
  // than pattern-matched: if the probe grows another global the assertion fails loudly and
  // someone adds it here, which is better than a filter wide enough to hide the extension's.
  const PROBE_OWN = ['__leak', '__snap', '__gl', '__early', '__earlyGl', '__stateEvents', '__uach', '__worker'];
  const stray = scopeParity.code.filter((x) => !PROBE_OWN.includes(x));
  eq(stray.join(','), '', 'scope parity: the extension leaves no client code of its own');

  // 1l. The canvas seed, window against worker, on the FIRST load of a tab.
  //
  //     mw-core's _getSessionSeed() hard-locks the first value it resolves, and on a cold
  //     start that can happen before the profile carries a noiseSeed — dyn/boot.js ships
  //     none on purpose, since the seed is per-domain and not derivable from the selection.
  //     The worker used to read the seed straight from the profile instead, so the window
  //     drew with the provisional host-hash value while the worker drew with the real domain
  //     seed that background.js injected. Measured before the fix, first load of a fresh
  //     tab: window 2135e950, worker 4064a550, and every other field in the scope
  //     comparison identical — canvas alone, which is exactly how it was reported.
  //
  //     This probe draws in the page's own script, which is early enough to force the lock.
  const seedParity = await first.page.evaluate(async () => {
    const HASH = 'var d=x.getImageData(0,0,60,20).data;var h=0x811c9dc5>>>0;' +
      'for(var i=0;i<d.length;i++){h^=d[i];h=Math.imul(h,0x01000193)>>>0;}';
    const DRAW = 'x.textBaseline="top";x.font="14px Arial";x.fillStyle="#f60";x.fillRect(0,0,60,20);' +
      'x.fillStyle="#069";x.fillText("Ab9!",2,2);';
    const win = (new Function('var c=document.createElement("canvas");c.width=60;c.height=20;' +
      'var x=c.getContext("2d");' + DRAW + HASH + 'return h.toString(16);'))();
    const wk = await new Promise((res) => {
      const body = 'self.onmessage=function(){var c=new OffscreenCanvas(60,20);var x=c.getContext("2d");' +
        DRAW + HASH + 'postMessage(h.toString(16));};';
      const w = new Worker(URL.createObjectURL(new Blob([body], { type: 'text/javascript' })));
      const t = setTimeout(() => res('timeout'), 8000);
      w.onmessage = (e) => { clearTimeout(t); res(e.data); };
      w.onerror = () => { clearTimeout(t); res('onerror'); };
      w.postMessage(1);
    });
    return { win, wk };
  });
  eq(seedParity.wk, seedParity.win,
    `canvas seed: the worker draws with the window's seed (win ${seedParity.win}, worker ${seedParity.wk})`);

  // 1m. Error stacks must not name the extension.
  //
  //     Every wrapper re-throws what the native threw, and V8 builds the stack from the
  //     frames actually on it — ours by absolute URL. Measured before the fix, one line of
  //     page script per surface, eight of them leaking:
  //       "at width (chrome-extension://<id>/mw/mw-core.js:1018:31)"
  //     That is not "something is spoofed", it is the extension's ID, its file layout and
  //     the line number, handed over on request. A clean browser throws the same TypeError
  //     with only the page's own frames.
  //
  //     The check looks for the scheme rather than a known id: any extension URL in a stack
  //     is the same disclosure regardless of which build produced it.
  const stackLeaks = await first.page.evaluate(() => {
    const hits = [];
    const scan = (label, s) => {
      const t = String(s || '');
      if (t.indexOf('chrome-extension://') !== -1) hits.push(label);
    };
    const attempt = (label, fn) => {
      try { scan(label + ' (returned)', fn()); } catch (e) { scan(label, e.stack); scan(label + ' msg', e.message); }
    };
    attempt('Date.prototype.getTimezoneOffset.call(null)', () => Date.prototype.getTimezoneOffset.call(null));
    attempt('new (getTimezoneOffset)', () => new Date.prototype.getTimezoneOffset());
    attempt('Date.parse with throwing toString', () => Date.parse({ toString() { throw new Error('boom'); } }));
    attempt('measureText()', () => document.createElement('canvas').getContext('2d').measureText());
    attempt('offscreen measureText()', () => new OffscreenCanvas(8, 8).getContext('2d').measureText());
    attempt('Intl.Segmenter bad locale', () => new Intl.Segmenter('!!!'));
    attempt('Intl.DurationFormat bad locale', () => Intl.DurationFormat && new Intl.DurationFormat('!!!'));
    attempt('Temporal bad zone', () => (typeof Temporal === 'undefined') || Temporal.Now.zonedDateTimeISO('No/Where'));
    attempt('hardwareConcurrency getter off prototype',
      () => Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get.call(null));
    attempt('screen.width getter off prototype',
      () => Object.getOwnPropertyDescriptor(Screen.prototype, 'width').get.call(null));
    attempt('innerWidth getter off window',
      () => Object.getOwnPropertyDescriptor(window, 'innerWidth').get.call(null));
    attempt('toLocaleString on a plain object', () => Date.prototype.toLocaleString.call({}));
    try { null.f(); } catch (e) { scan('a plain page TypeError', e.stack); }
    return hits;
  });
  eq(stackLeaks.join(', '), '', 'error stacks never name the extension');

  const w = await first.page.evaluate(() => window.__worker);
  eq(w.error, undefined, 'worker: started');
  eq(w.tz, a.want.tz, 'worker: tz matches the window');
  eq(w.lang, a.want.lang, 'worker: lang matches the window');
  eq(w.cores, a.want.cores, 'worker: cores match the window');
  eq(w.gpu, first.snap.gpu, 'worker: renderer matches the window (hasBadWebGL)');

  // 1g. Date VALUE construction, in both scopes.
  //
  //     getTimezoneOffset() and toString() answered from the profile long before this
  //     check existed; the epoch a Date is built FROM did not. Numeric fields and every
  //     local-time string went to the engine, which reads them in the host zone — so
  //     `new Date(y,m,d)` and `new Date(y,m,d).getTimezoneOffset()` described two
  //     different places, and two lines of arithmetic recovered the real one. In the
  //     worker the constructor was not replaced at all, which additionally left bare
  //     `Date()` printing the host zone in the host's own language.
  //
  //     Asserted as identities against getTimezoneOffset() rather than against literals:
  //     that offset is already checked against ICU day by day in test/tz-icu.mjs, so this
  //     needs no second copy of the DST rules and holds for whichever zone is selected.
  const DATE_PROBE = `
    var out = {};
    var y = new Date().getFullYear();
    var probeDate = new Date(y, 6, 15);
    var off = probeDate.getTimezoneOffset();
    out.off = off;
    // CreepJS computeTimezoneOffset(), verbatim: a local-parsed date against a UTC-parsed
    // one. It never calls getTimezoneOffset, which is why it saw through the old patch.
    var d = new Date().getDate(), mo = new Date().getMonth();
    var f = function (n) { return ('' + n).length == 1 ? '0' + n : n; };
    out.creep = +(((Date.parse(new Date((mo + 1) + '/' + f(d) + '/' + y)) -
      (+new Date(y + '-' + f(mo + 1) + '-' + f(d)))) / 60000).toFixed(0));
    out.creepWant = new Date().getTimezoneOffset();
    out.numeric = (Date.UTC(y, 6, 15) - probeDate.getTime()) / 60000;
    out.parseDelta = (Date.parse(y + '-07-15T12:00:00Z') - Date.parse(y + '-07-15T12:00:00')) / 60000;
    // Absolute forms must be left alone, or a correct value gets moved.
    out.iso = new Date(y + '-07-15T12:00:00Z').toISOString();
    out.dateOnly = new Date(y + '-07-15').toISOString();
    out.offsetForm = new Date(y + '-07-15T12:00:00+02:00').toISOString();
    // toLocaleString is wired to the INTERNAL DateTimeFormat, so it needs its own patch.
    // The zone NAME only — toLocaleString returns the whole formatted stamp, so a plain
    // equality against the Intl part compares a date to a zone label and always fails.
    out.dtf = new Intl.DateTimeFormat('en-US', { timeZoneName: 'long' })
      .formatToParts(new Date()).filter(function (p) { return p.type === 'timeZoneName'; })[0].value;
    out.tlsHasZone = new Date().toLocaleString('en-US', { timeZoneName: 'long' }).indexOf(out.dtf) !== -1;
    // Bare Date() bypasses Date.prototype.toString by specification.
    var bare = String(Date());
    out.bareZone = bare.slice(bare.indexOf('GMT'));
    var s = String(new Date());
    out.toStringZone = s.slice(s.indexOf('GMT'));
    out.ctorLinked = Date.prototype.constructor === Date;
    out.roundTrip = (function () { var x = new Date(y, 5, 10, 13, 45, 30); return x.getHours() + ':' + x.getMinutes(); })();

    // Temporal is a SECOND complete date-and-time API. Four of Temporal.Now's six methods
    // built their value from the host clock, so one call undid everything above:
    // plainDateTimeISO() read the host wall clock and zonedDateTimeISO().toString() wrote
    // "[Europe/Moscow]" into the string, under an America/New_York profile.
    out.temporalTZ = (typeof Temporal === 'undefined') ? 'n/a' : Temporal.Now.timeZoneId();
    out.temporalZoneOfZDT = (typeof Temporal === 'undefined') ? 'n/a' : Temporal.Now.zonedDateTimeISO().timeZoneId;
    // The wall clock Temporal reports must be the one Date reports, to the minute.
    out.temporalClock = (typeof Temporal === 'undefined') ? 'n/a'
      : Temporal.Now.plainDateTimeISO().toString().slice(11, 16);
    out.dateClock = (function () { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); })();
    // Every Intl constructor must resolve to ONE locale.
    //
    // [FIX the-intl-list-was-still-a-list] This was nine names typed out, and the comment
    // above it recorded why that is dangerous: Segmenter and DurationFormat were newer than
    // the rest, were missing from the list, and answered with the HOST's locale while their
    // siblings answered with the profile's. The fix at the time was to add two names — which
    // leaves the next new constructor in exactly the same position.
    //
    // So the list is gone and Intl is ENUMERATED (backticks avoided on purpose: this whole
    // probe is a template literal, and one backtick here ends it). Whatever the engine ships
    // is what gets asked, including a constructor that does not exist on this machine yet.
    // The names ride alongside the locales so a failure says WHICH one disagreed, and the
    // count rides too, so an enumeration that silently found nothing cannot read as agreement.
    out.intlSeen = [];
    out.intlLocales = Object.getOwnPropertyNames(Intl).map(function (n) {
      var C;
      try { C = Intl[n]; } catch (e) { return null; }
      // A constructor, not Intl.getCanonicalLocales or a namespace object.
      if (typeof C !== 'function' || !/^[A-Z]/.test(n)) return null;
      try {
        // DisplayNames is the one that refuses to be constructed without an option.
        var i = (n === 'DisplayNames') ? new C(undefined, { type: 'region' }) : new C();
        if (!i || typeof i.resolvedOptions !== 'function') return null;
        var loc = i.resolvedOptions().locale;
        if (typeof loc !== 'string' || !loc) return null;
        out.intlSeen.push(n + '=' + loc);
        return loc;
      } catch (e) { return null; }
    }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort().join(',');
    out.intlCount = out.intlSeen.length;
    out.intlSeen = out.intlSeen.join(' ');
  `;
  const dp = await first.page.evaluate(async (probe) => {
    const win = (new Function(probe + 'return out;'))();
    const url = URL.createObjectURL(new Blob([probe + 'postMessage(out);'], { type: 'text/javascript' }));
    const worker = await new Promise((res) => {
      const wk = new Worker(url);
      const t = setTimeout(() => res({ error: 'timeout' }), 8000);
      wk.onmessage = (e) => { clearTimeout(t); res(e.data); };
      wk.onerror = (e) => { clearTimeout(t); res({ error: 'onerror ' + e.message }); };
    });
    return { win, worker };
  }, DATE_PROBE);

  eq(dp.worker.error, undefined, 'date: the probe worker started');
  for (const scope of ['win', 'worker']) {
    const v = dp[scope];
    if (!v || v.error) continue;
    eq(v.creep, v.creepWant, `date/${scope}: CreepJS offset derivation agrees with getTimezoneOffset`);
    eq(v.numeric, -v.off, `date/${scope}: new Date(y,m,d) is wall clock in the profile zone`);
    eq(v.parseDelta, -v.off, `date/${scope}: Date.parse of a zoneless string is profile-local`);
    eq(v.iso, `${new Date().getFullYear()}-07-15T12:00:00.000Z`, `date/${scope}: an explicit Z is left alone`);
    eq(v.dateOnly, `${new Date().getFullYear()}-07-15T00:00:00.000Z`, `date/${scope}: a bare ISO date stays UTC`);
    eq(v.offsetForm, `${new Date().getFullYear()}-07-15T10:00:00.000Z`, `date/${scope}: an explicit offset is left alone`);
    eq(v.tlsHasZone, true, `date/${scope}: toLocaleString names the same zone as Intl`);
    eq(v.bareZone, v.toStringZone, `date/${scope}: bare Date() names the same zone as toString`);
    eq(v.ctorLinked, true, `date/${scope}: Date.prototype.constructor === Date`);
    if (v.temporalTZ !== 'n/a') {
      eq(v.temporalZoneOfZDT, v.temporalTZ, `date/${scope}: Temporal.Now zoned value carries the same zone it reports`);
      eq(v.temporalClock, v.dateClock, `date/${scope}: Temporal wall clock agrees with Date`);
    }
    // One locale, not two — the assertion is the COUNT, so it holds for any country.
    eq(v.intlLocales.split(',').length, 1,
      `date/${scope}: every Intl constructor resolves one locale (${v.intlLocales}) — ${v.intlSeen}`);
    // [FIX the-intl-list-was-still-a-list] An enumeration that finds nothing agrees with
    // itself perfectly. Nine were hand-listed before, so anything below that is a broken
    // sweep rather than a smaller engine.
    eq(v.intlCount >= 9, true,
      `date/${scope}: the enumeration reached the whole of Intl (${v.intlCount} constructors: ${v.intlSeen})`);
  }
  // And the two scopes must not merely each be self-consistent — they must agree.
  const dpDiff = Object.keys(dp.win)
    .filter((k) => String(dp.win[k]) !== String((dp.worker || {})[k]))
    .map((k) => `${k}: win=${JSON.stringify(dp.win[k])} worker=${JSON.stringify((dp.worker || {})[k])}`);
  eq(dpDiff.join(' | '), '', 'date: window and worker return identical answers');

  // 2. A brand-new ORIGIN. localhost and 127.0.0.1 are different origins, so this tab
  //    has no sessionStorage to inherit from — the first visit to an unseen site, which
  //    a per-origin cache could never have covered.
  const fresh = await early(`http://localhost:${port}/`);
  check('new origin', fresh.snap, a.want);
  await fresh.page.close();

  // 3. F5 on a tab that is already open when the profile changes. sessionStorage still
  //    holds the PREVIOUS machine here; before data-v-hw only its timezone and locale
  //    were corrected at document_start and the hardware stayed stale.
  const b = selection('laptop_low', 'JP');
  await apply(b);
  await first.page.reload({ waitUntil: 'domcontentloaded' });
  check('reload after switch', await first.page.evaluate(() => window.__early), b.want);
  await first.page.close();

  // 4. Stealth is chosen in the same popup and reaches the page the same way.
  const c = selection('pc_gaming', 'GB', 'stealth');
  await apply(c);
  const st = await early(`http://127.0.0.1:${port}/`);
  eq(st.snap.cores, 12, 'stealth: cores');
  eq(st.snap.leak, '', 'stealth: nothing profile-shaped in web storage');
  await st.page.close();

  // 5. Browser restart. persistAcrossSessions is set, but measured: an unpacked
  //    extension is re-installed at browser start and installing clears dynamic
  //    registrations, so the list really is empty for a moment. background.js therefore
  //    re-registers at service-worker top level rather than from onStartup alone. What
  //    is asserted here is that the registration comes back on its own and that pages
  //    loaded afterwards are correct — the handful of navigations that may start before
  //    the service worker gets that far cannot be covered from JS at all, and they are
  //    the residual limit of this fix.
  await ctx.close();
  ctx = await launch();
  // [FIX cold-start-gpu-was-the-wrong-card] BEFORE waiting for the registration to come
  // back — the window the note above calls residual, and the one a user meets when the
  // browser restores tabs at startup. It is measurable after all: what a page sees there
  // comes from storage-bridge, which forwards the stored record, and that record names the
  // GPU by KEY. Every other field of the selected machine arrived and the graphics card did
  // not, so the page reported a 1440p twelve-core box on integrated Intel graphics — a
  // machine that does not exist, which is worse than the wrong machine. background.js now
  // resolves the key into afp_profile_gl and the bridge carries it.
  //
  // What CAN be asserted there is coherence. In that instant the page may still be on the
  // bootstrap stub (laptop_mid) or already on the selection — both are real machines — but
  // it must not be half of each. Before the fix it was: 12 cores, 1440p and integrated
  // Intel graphics, a combination no device has, which is a stronger signal than simply
  // being the wrong machine.
  const beforeReg = await early(`http://127.0.0.1:${port}/`);
  const gpuOf = (id) => GPU_DATA[PROFILES.find((p) => p.id === id).gpuKey].unmaskedRenderer;
  const coresOf = (id) => PROFILES.find((p) => p.id === id).cores;
  const machines = ['laptop_mid', 'pc_gaming'];
  const claimed = machines.find((id) => beforeReg.snap.cores === coresOf(id));
  eq(!!claimed && beforeReg.snap.gpu === gpuOf(claimed), true,
    'restart, page opened before the registration returns: one machine, not a hybrid — ' +
    `cores ${beforeReg.snap.cores} with ${String(beforeReg.snap.gpu).slice(0, 46)}`);
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  let registered = [];
  for (let i = 0; i < 60 && !registered.length; i++) {
    registered = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    if (!registered.length) await new Promise((r) => setTimeout(r, 100));
  }
  // Named files rather than the whole list: the platformVersion entry depends on the
  // host's Windows family, so a literal would only pass on the machine that wrote it.
  const js = (registered[0] && registered[0].js) || [];
  eq(js.includes('dyn/dev/pc_gaming.js'), true, 'after restart: the machine file is registered');
  eq(js.includes('dyn/cc/GB.js'), true, 'after restart: the country file is registered');
  eq(js.includes('dyn/mode/stealth.js'), true, 'after restart: the mode file is registered');
  eq(js.some((f) => /^dyn\/pv\/win1[01]\.js$/.test(f)), true, 'after restart: a platformVersion file is registered');
  eq(js[js.length - 1], 'dyn/boot.js', 'after restart: the assembler is last');
  const restarted = await early(`http://127.0.0.1:${port}/`);
  eq(restarted.snap.leak, '', 'after restart: nothing profile-shaped in web storage');
  eq(restarted.snap.cores, 12, 'after restart: cores');
  eq(restarted.snap.tz, COUNTRY_DATA['GB'].tz, 'after restart: tz');
  eq(restarted.snap.gpu, GPU_DATA[PROFILES.find((p) => p.id === 'pc_gaming').gpuKey].unmaskedRenderer,
    'after restart: gpu');
  await restarted.page.close();

  // 6. window.name. Not a cold-start question, but it needs the same thing this file is
  //    the only place to get — the extension actually loaded — so it runs on this rig
  //    rather than paying for a second browser launch.
  //
  //    The cleanup used to run in EVERY frame, which destroyed the name a page gives its
  //    own iframe. Measured on google.com/recaptcha/api2/demo: the challenge frame came
  //    back empty (322 bytes against 12961) and the page threw
  //    "Cannot read properties of undefined (reading 'postMessage')" from reCAPTCHA's
  //    CE.init — the anchor looks its challenge frame up by name. The checkbox then never
  //    ticks. Top-level clearing is kept: measured on a clean Chromium 151, window.name
  //    survives both same-origin and cross-origin navigation in the same tab, so the
  //    tracking vector is real and the browser does not close it on its own.
  //    Back to normal mode first: the block is deliberately off in stealth, and step 4
  //    left the profile there.
  await apply(selection('laptop_mid', 'US'));
  const np = await ctx.newPage();
  await np.goto(`http://127.0.0.1:${port}/one`, { waitUntil: 'domcontentloaded' });
  await np.evaluate(() => { window.name = 'TRACKING-ID-12345'; });
  await np.goto(`http://127.0.0.1:${port}/two`, { waitUntil: 'domcontentloaded' });
  eq(await np.evaluate(() => window.name), '', 'window.name: cleared on the top frame');

  await np.goto(`http://127.0.0.1:${port}/framed`, { waitUntil: 'load' });
  const inner = np.frames().find((f) => /\/inner/.test(f.url()));
  eq(!!inner, true, 'window.name: the framed page loaded');
  if (inner) eq(await inner.evaluate(() => window.name), 'widget-channel',
    'window.name: a subframe keeps the name its embedder gave it');
  await np.close();

  // 7. clientRects. The noise lives on the DOMRect accessors, so getBoundingClientRect
  //    and getClientRects — which used to disagree, one noised and one native — describe
  //    the same rectangle. Only geometry that varies between machines is touched: a rect
  //    from a TEXT run is, a fixed CSS box is not, because CreepJS pins the hash of a
  //    known element and noising a value identical on every Blink browser can only expose
  //    the extension (same trade the canvas solid fill lost). The flag takes effect from
  //    the second load of a tab, hence the reload — see the ORDER note in dyn/boot.js.
  //
  //    That reload is doing double duty since [FIX profile-readable-by-any-page]: _FEAT
  //    is read as mw-core.js loads, and the thing it used to be read out of (the profile
  //    in sessionStorage) is gone. This scenario is therefore the regression guard for
  //    the small carrier that replaced it, `v.ui.f` — if that stops surviving F5, the
  //    `on`/`off` runs below become identical and the first assertion goes red.
  const feats = (clientRects) => ({ canvas: true, webgl: true, webrtc: true, navigator: true,
    screen: true, timezone: true, geolocation: true, battery: true, fonts: true, clientRects,
    plugins: true, network: true, hideAdBlocker: true });
  const rectRun = async (clientRects) => {
    await apply({ storage: { ...selection('laptop_mid', 'US').storage, afp_features: feats(clientRects) } });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/rects`, { waitUntil: 'load' });
    // Wait for the flag to be persisted with THIS run's value before reloading. Waiting
    // merely for the key to exist is not enough: three files write it (storage-bridge on
    // its storage callback, background on inject, mw-core on ui:state), so the key can be
    // present while still holding the previous run's flags, and the reload then measures
    // the wrong configuration. Both failure shapes look identical from the assertion below
    // — `on.width === off.width` — and neither has anything to do with clientRects.
    // Measured: 'v.ui.f' lands 8.3±0.4 ms after the page's first script, while `load` on
    // this tiny local page fires sooner, so without a wait the reload simply wins.
    // [FIX default-config-still-left-two-keys] The key is written only when the flags are
    // NOT the defaults, and removed otherwise — a clean Chrome stores nothing on a fresh
    // origin, so a key repeating the default was a free detector. `feats(false)` IS the
    // default set (clientRects defaults to false), so the `off` run must wait for the key
    // to be ABSENT, not to hold a value. Waiting for a value there hung for the full
    // timeout and reported "the off flags reached the page — got false", which named the
    // flags rather than the writer that had correctly declined to write them.
    //
    // Stated plainly, because it is weaker than what this line used to prove: on the
    // DEFAULT run "absent" is also the state of a tab where nothing has run yet, so that
    // run can no longer distinguish "the writer declined" from "the writer never ran". It
    // still catches the failure that matters here — a stale or wrongly-written value at
    // reload time makes the wait time out — and the non-default run below exercises the
    // writer end to end, which is the half that can actually be broken.
    const wantFlags = afpPackFeatures(feats(clientRects));
    const wantAbsent = wantFlags === afpPackFeatures(AFP_DEFAULT_FEATURES);
    // The timeout used to be swallowed with `.catch(() => {})`. When the flags genuinely
    // did not arrive, the reload then measured the PREVIOUS configuration and the run failed
    // as `a text rect is noised — got false`, which names the wrong thing entirely and sent
    // more than one investigation after clientRects. The precondition reports itself now:
    // the flags either arrived or they did not, and the assertion below only speaks about
    // rects when they did.
    const flagsArrived = await p
      .waitForFunction(
        ([want, absent]) => (sessionStorage.getItem('v.ui.f') === (absent ? null : want)),
        [wantFlags, wantAbsent], { timeout: 10000 })
      .then(() => true).catch(() => false);
    eq(flagsArrived, true,
      `clientRects: the ${clientRects ? 'on' : 'off'} flags reached the page before the reload`);
    await p.reload({ waitUntil: 'load' });
    const out = await p.evaluate(() => window.__rects());
    await p.close();
    return out;
  };
  // The same scenario WITHOUT the reload — i.e. the first time this origin is seen in a
  // tab, which is the load a fingerprinting script actually gets. A fresh page is a fresh
  // top-level browsing context, so its sessionStorage (and therefore 'v.ui.f') is empty,
  // exactly as it is on a real first visit.
  const rectRunFirst = async (clientRects) => {
    await apply({ storage: { ...selection('laptop_mid', 'US').storage, afp_features: feats(clientRects) } });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/rects`, { waitUntil: 'load' });
    const out = await p.evaluate(() => window.__rects());
    await p.close();
    return out;
  };
  const off = await rectRun(false);
  const on = await rectRun(true);
  // [FIX rect-noise-check-watched-one-number] This compared ONE number, `width`, and it
  // reported FAIL on a correct build twice during the Chrome 152 audit — once inside a
  // full `test/all.mjs --browser` run and once standing alone — each time sending the
  // investigation at clientRects, which was not the thing that had moved. It then passed
  // ten runs in a row afterwards, so it is intermittent rather than broken, and what
  // makes it intermittent has not been pinned down.
  //
  // What HAS been measured is that a single field is the wrong thing to watch either way.
  // _bcrNoise adds at most ±0.001px and snaps to a 1/4096 grid, while Blink already lays
  // text out on 1/64 = 64/4096, so a seed whose noise falls under half a grid step rounds
  // straight back to the value it started from. Over 100 000 session seeds, on this rig's
  // actual span (measured in clean Chromium: x 8, y 8, right 262.9375, bottom 25), with
  // width derived as noise(right) - noise(x) exactly as the accessors derive it:
  //
  //     width unchanged              4.69%
  //     all eight fields unchanged   0.00%
  //
  // So a width-only check is expected to go red about one run in twenty-one with nothing
  // wrong at all. All eight numbers are compared now — they come from four independently
  // seeded draws — and both strings are printed, so if this ever does go red it names what
  // it saw instead of sending anyone back to this comment.
  eq(on.b !== off.b, true,
    `clientRects: a text rect is noised when the flag is on (on ${on.b} / off ${off.b})`);

  // [FIX a-switch-off-its-default-was-inert-on-the-first-load] Everything above RELOADS
  // before measuring, and that reload is why the suite never saw this: 'v.ui.f' does not
  // exist on the first load of an origin, so _FEAT falls back to the DEFAULTS and a switch
  // the user moved off its default does nothing at all until the second load. Measured in
  // a real Chrome 152 with clientRects ON: a fresh origin reported 0 of 6 rect fields on
  // the noise grid, the same page after F5 reported 6 of 6 — the same origin answering two
  // different ways depending on whether it had been visited before.
  //
  // So this run does NOT reload, and it demands the same answer as the run that did. The
  // whole rect string is compared for the reason given above: one field can survive the
  // noise unchanged about one run in twenty-one.
  const onFirstLoad = await rectRunFirst(true);
  eq(onFirstLoad.b === on.b, true,
    `clientRects: the FIRST load of an origin noises exactly like the second ` +
    `(first ${onFirstLoad.b} / second ${on.b})`);
  // And the other direction, which is the one that hits twelve of the thirteen flags: a
  // feature left at its default must not change across that boundary either. This one
  // passes today and is here so a fix for the line above cannot quietly break it.
  const offFirstLoad = await rectRunFirst(false);
  eq(offFirstLoad.b === off.b, true,
    `clientRects: the first load of an origin agrees with the second when the flag is off`);

  // [FIX a-switch-off-its-default-was-inert-on-the-first-load] The OTHER direction, and the
  // one that reaches twelve of the thirteen flags: a feature the user turned OFF stayed ON
  // for the first load of an origin, because the defaults win there and every flag but
  // clientRects ships ON. So the SAME origin answered with a noised canvas before F5 and the
  // browser's own pixels after — two hashes for one site, which is worse than either answer
  // on its own.
  const cvFeats = () => ({ ...feats(false), canvas: false });
  const cvRun = async (reload) => {
    await apply({ storage: { ...selection('laptop_mid', 'US').storage, afp_features: cvFeats() } });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/canvasflag`, { waitUntil: 'load' });
    if (reload) {
      await p.waitForFunction((w) => sessionStorage.getItem('v.ui.f') === w,
        afpPackFeatures(cvFeats()), { timeout: 10000 }).catch(() => {});
      await p.reload({ waitUntil: 'load' });
    }
    const h = await p.evaluate(() => window.__cv());
    await p.close();
    return h;
  };
  const cvFirst = await cvRun(false);
  const cvSecond = await cvRun(true);
  eq(cvFirst === cvSecond, true,
    `canvas: the first load of an origin honours a switch turned OFF, exactly like the ` +
    `second (first ${cvFirst}, second ${cvSecond})`);

  // WHAT THIS DOES NOT COVER, stated because the boundary is real and cannot be moved from
  // inside the extension. The decision is taken at the first read and then frozen, so it is
  // the USER'S answer only when that first read happens after the flags land. A page that
  // hashes a canvas from an inline script while the document is still being parsed — which
  // /canvasseed above deliberately does — asks before anything can know, and freezes on the
  // shipped defaults. Freezing is still right: the alternative is one document producing two
  // different hashes, which is worse than one wrong one. Closing this last gap needs the
  // flags to exist before mw-core loads, and the only way to arrange that is to move
  // mw-bundle.js out of the manifest into a dynamic registration behind a generated flags
  // file — a trade of a first-load defect for a silent-failure mode on the extension's most
  // critical injection, which is not obviously worth it.
  eq(on.sameBC, true, 'clientRects: getBoundingClientRect === getClientRects[0]');
  eq(on.widthOk, true, 'clientRects: right - left === width');
  eq(on.heightOk, true, 'clientRects: bottom - top === height');
  eq(on.xIsLeft, true, 'clientRects: x === left');
  eq(on.yIsTop, true, 'clientRects: y === top');
  eq(on.json, true, 'clientRects: toJSON reports the same numbers as the accessors');
  // CreepJS recomputes every field from the others in BOTH directions — right-left AND
  // left+width. Deriving width from a subtraction only satisfied one of them, and a long
  // text run (a Range) is where the other broke; the noise is snapped to a 2^-12 grid so
  // every sum among these values is exact. Ranges are the case that failed, so both.
  eq(on.identElem, true, 'clientRects: every DOMRect identity holds both ways (element)');
  eq(on.identRange, true, 'clientRects: every DOMRect identity holds both ways (range)');
  eq(on.knownUntouched, true, 'clientRects: a fixed CSS box keeps the browser own numbers');
  eq(on.ownUntouched, true, 'clientRects: a rect the page built itself is left alone');
  eq(on.isRect, true, 'clientRects: still a real DOMRect in a real DOMRectList');

  // 8. DOM font enumeration. measureText already collapsed a family outside the allowlist
  //    to the fallback while layout did not, so one page got two answers about the same
  //    font — measured on amiunique.org, which enumerates purely by layout and listed all
  //    167 installed families with the extension on, byte for byte the same as a clean
  //    browser. The read side is filtered now; what matters is that it agrees with canvas,
  //    leaves allowed fonts alone, does not disturb the element it measures, and never
  //    blocks a @font-face family — that last one is what keeps icon fonts working.
  await apply({ storage: { ...selection('laptop_mid', 'US').storage, afp_features: feats(false) } });
  const fp = await ctx.newPage();
  await fp.goto(`http://127.0.0.1:${port}/fonts`, { waitUntil: 'load' });
  await fp.reload({ waitUntil: 'load' });
  await fp.evaluate(() => document.fonts.ready);
  const fr = await fp.evaluate(() => window.__fonts());
  eq(fr.allowed[0] !== fr.base[0], true, 'fonts: an allowlisted family still measures as itself');
  eq(fr.blocked[0], fr.base[0], 'fonts: a blocked family measures as the fallback (offsetWidth)');
  eq(fr.blocked[1], fr.base[1], 'fonts: and through getBoundingClientRect too');
  eq(fr.canvasBlockedIsBase, true, 'fonts: canvas says the same about the blocked family');
  eq(fr.canvasAllowedDiffers, true, 'fonts: canvas says the same about the allowed one');
  eq(fr.styleIntact, true, 'fonts: measuring leaves the element style byte-identical');
  eq(fr.webFontKept, true, 'fonts: a family registered via @font-face is never blocked');
  await fp.close();

  // 9. The timezone NAME. The English table in mw-timezone-screen.js is right for
  //    Date.prototype.toString — V8 writes those in English whatever the locale — and
  //    wrong for Intl, where it was being substituted into a localised result:
  //      laupäev, 15. august 2026, kell 14:27:52 Eastern European Summer Time
  //    A real et-EE browser writes "Ida-Euroopa suveaeg" there. Frames took a second
  //    path (mw-navigator) with the same table, so window and frame could disagree —
  //    which is what browserleaks.com/javascript puts side by side.
  await apply(selection('laptop_mid', 'EE'));
  const tp = await ctx.newPage();
  await tp.goto(`http://127.0.0.1:${port}/tz`, { waitUntil: 'load' });
  await tp.reload({ waitUntil: 'load' });
  const tz = await tp.evaluate(() => window.__tz());
  eq(tz.win.tz, COUNTRY_DATA['EE'].tz, 'zone name: the window is in the selected zone');
  eq(tz.win.name, tz.frame.name, 'zone name: window and iframe agree');
  eq(tz.win.full, tz.frame.full, 'zone name: and so do their full formats');
  eq(/European/.test(tz.win.name), false, 'zone name: reported in the profile locale, not English');
  // Measured on a clean browser with the zone forced to Europe/Tallinn: toString's zone
  // name follows the LOCALE and matches Intl exactly — ru host "(Восточная Европа, летнее
  // время)", et-EE "(Ida-Euroopa suveaeg)", en-US "(Eastern European Summer Time)". So the
  // invariant is not "English" (an earlier note here said that and was wrong) but "the two
  // APIs agree".
  const nameIn = (s) => (String(s).match(/\(([^)]*)\)\s*$/) || [, ''])[1];
  eq(nameIn(tz.win.dateToString), tz.win.name, 'zone name: Date.toString matches Intl (window)');
  eq(nameIn(tz.frame.dateToString), tz.frame.name, 'zone name: Date.toString matches Intl (iframe)');
  eq(nameIn(tz.win.dateToString), nameIn(tz.frame.dateToString), 'zone name: toString agrees across scopes');
  await tp.close();

  // 10. The canvas seed is the SAME number at the page's first line and after everything
  //     has landed — with a master seed whose hex form REPEATS a digit.
  //
  //     [FIX seed-was-a-named-page-readable-key] moved the seed out of a sessionStorage key
  //     that named the extension and handed the page the number that makes the positional
  //     canvas noise invertible. It travels as file names instead (dyn/ns/*), which also
  //     closes the flip the old async path could only narrow: measured before that change,
  //     one page load gave two canvas hashes (1169538152 early, 222371209 late) while the
  //     same page with the extension off gave one number twice.
  //
  //     [FIX repeated-nibble-collapsed-the-seed] is why the seed here is 0x44ad44ad and not
  //     something arbitrary. The first version of those files was one per DIGIT, appended in
  //     order; a repeated digit therefore named the same PATH twice in one registration, and
  //     Chrome runs a repeated path once. Seven characters arrived instead of eight, boot.js
  //     rejected the marker, and the page fell back to the provisional host hash — silently,
  //     because that fallback is a perfectly ordinary-looking number. It reproduced in 3 of 3
  //     tabs with master 178f44ad and not at all with 90e31a5c, and only ~12% of random seeds
  //     have eight distinct hex digits, so the passing case was the rare one. A seed with
  //     eight distinct digits would keep this test green against exactly that bug.
  await apply({ storage: { ...selection('laptop_mid', 'US').storage, afp_noise_seed: 0x44ad44ad } });
  const sp = await ctx.newPage();
  await sp.goto(`http://127.0.0.1:${port}/canvasseed`, { waitUntil: 'load' });
  const seedEarly = await sp.evaluate(() => window.__early);
  await new Promise((r) => setTimeout(r, 2500));
  const seedLate = await sp.evaluate(() => window.__cv());
  eq(seedEarly, seedLate,
    `canvas seed: one page load, one hash, with a repeating master seed (early ${seedEarly}, late ${seedLate})`);
  // A second tab on the same origin must agree with the first: the seed is per registrable
  // domain, so two tabs of one site are one machine.
  const sp2 = await ctx.newPage();
  await sp2.goto(`http://127.0.0.1:${port}/canvasseed`, { waitUntil: 'load' });
  eq(await sp2.evaluate(() => window.__early), seedLate, 'canvas seed: a second tab agrees');
  await sp2.close();
  await sp.close();
} finally {
  await ctx.close();
  server.close();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
}

for (const f of failures) console.error('FAIL:', f);
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
