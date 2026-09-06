/**
 * WHERE A WORKER CANNOT BE PATCHED, THE WINDOW MUST NOT CONTRADICT IT.
 *
 *   node test/wbcoherence.mjs             headless
 *   node test/wbcoherence.mjs --headed    watch it
 *
 * Two origin shapes leave a worker running native code, for two unrelated reasons:
 *
 *   /wb/   worker-src 'self'                     blob: workers refused, so _isBlobBlocked()
 *                                                hands the native constructors back —
 *                                                github.com's shape, and the script-src
 *                                                fallback youtube.com lands on
 *   /tt/    trusted-types page-policy (+require)  only the PAGE may mint a policy, so our
 *                                                TrustedScriptURL can never exist
 *
 * On both, the page's own workers read the machine and nothing can change that. What CAN
 * change is whether the window sits beside them claiming something else, and until
 * [FIX the-standdown-never-fired] it did, on every visit:
 *
 *   window {cores:8,  memory:8,  tz:America/New_York, lang:en-US}
 *   worker {cores:18, memory:16, tz:Europe/Moscow,    lang:ru-RU}
 *
 * A FRESH TAB PER VISIT, and that is why this file exists next to test/ttworker.mjs rather
 * than inside it. That suite navigates twice in ONE tab, and sessionStorage survives a
 * navigation — so the flag is already present before the bundle on its second load, the
 * stand-down fires, and it passed against a build where a real visitor in a new tab got the
 * split every time. Same lesson as test/blobcsp.mjs: the delivery IS the subject, so nothing
 * may be warmed.
 *
 * THE COMPARISON IS THE WHOLE SURFACE, not the four fields that were measured. The
 * stand-down works from a list of property names in mw-core, and a list is exactly the kind
 * of thing that goes stale when a new spoofed value is added. Reading everything a worker
 * can reach — an OffscreenCanvas hash and the WebGL strings included — makes a forgotten
 * name fail here instead of shipping.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harness, root, BROWSER, bootSettled } from './harness.mjs';

const headed = process.argv.includes('--headed');
const { assert, eq, section, note, done } = harness();
const EXT = process.env.FPS_EXT_ROOT ? path.resolve(process.env.FPS_EXT_ROOT) : root;
if (process.env.FPS_EXT_ROOT) console.log(`extension root: ${EXT} (FPS_EXT_ROOT)`);

// One collector, handed to both scopes as source text — the same design as
// tools/probe-collect.mjs and for the same reason: two readers that must not drift.
// OffscreenCanvas is the bridge, being the only 2D and WebGL surface a worker has.
const READ = `(function () {
  var o = {};
  var t = function (k, f) { try { o[k] = f(); } catch (e) { o[k] = 'THREW ' + e.name; } };
  t('cores', function () { return navigator.hardwareConcurrency; });
  t('memory', function () { return navigator.deviceMemory; });
  t('platform', function () { return navigator.platform; });
  t('ua', function () { return navigator.userAgent; });
  t('lang', function () { return navigator.language; });
  t('langs', function () { return (navigator.languages || []).join(','); });
  t('tz', function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; });
  t('locale', function () { return Intl.DateTimeFormat().resolvedOptions().locale; });
  t('tzoff', function () { return new Date(2021, 0, 1).getTimezoneOffset(); });
  t('uadPlatform', function () {
    return navigator.userAgentData ? navigator.userAgentData.platform : 'n/a';
  });
  t('conn', function () {
    var c = navigator.connection;
    return c ? [c.effectiveType, c.rtt, c.downlink, c.saveData].join('/') : 'n/a';
  });
  t('canvas', function () {
    var c = new OffscreenCanvas(120, 40), x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '14px sans-serif';
    x.fillStyle = '#f60'; x.fillRect(1, 1, 62, 20);
    x.fillStyle = '#069'; x.fillText('afp coherence probe', 2, 15);
    var d = x.getImageData(0, 0, 120, 40).data, h = 5381;
    for (var i = 0; i < d.length; i += 7) h = ((h * 33) ^ d[i]) >>> 0;
    return h;
  });
  t('gl', function () {
    var g = new OffscreenCanvas(32, 32).getContext('webgl');
    if (!g) return 'no-webgl';
    var dbg = g.getExtension('WEBGL_debug_renderer_info');
    return [dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?',
      g.getParameter(g.MAX_TEXTURE_SIZE)].join(' | ');
  });
  return o;
})()`;

const WORKER_JS = `self.onmessage = function () { postMessage(${READ}); };\n`;

// The third scope. Served under the SAME path prefix so it inherits that fixture's CSP, and
// it PUBLISHES its reading rather than being eval'd from the parent: eval is a TrustedScript
// sink, so contentWindow.eval would be refused on the /tt/ fixture and the frame row would
// fail for the probe's own reason rather than the build's.
const FRAME_JS = `<!doctype html><meta charset="utf-8"><title>f</title>`
  + `<script>window.__r = ${READ};<` + `/script>`;

const pageFor = (mkUrl) => `<!doctype html><html><head><meta charset="utf-8"><title>coh</title>
<script>
window.__f = new Promise(function (res) {
  var fr = document.createElement('iframe');
  fr.style.display = 'none';
  fr.onload = function () {
    try { res(fr.contentWindow.__r || 'no-reading'); } catch (e) { res('threw:' + e.name); }
  };
  fr.src = location.pathname + '?frame=1';
  document.documentElement.appendChild(fr);
  setTimeout(function () { res('timeout'); }, 6000);
});
window.__w = new Promise(function (res) {
  var d = false, f = function (v) { if (!d) { d = true; res(v); } };
  try {
    var w = new Worker(${mkUrl});
    w.onmessage = function (e) { f(e.data); };
    w.onerror = function (e) { f('error:' + (e && e.message ? e.message : '(empty)')); };
    w.postMessage(1);
  } catch (e) { f('threw:' + (e && e.name)); }
  setTimeout(function () { f('timeout'); }, 6000);
});
</script></head><body>coh</body></html>`;

const FIXTURES = {
  // The control comes first on purpose: were the extension simply not spoofing, every
  // assertion below would pass for the wrong reason. This one fails in that case.
  '/plain/': { csp: null, url: "'/worker.js'", why: 'an ordinary origin — the worker IS patched' },
  '/wb/': { csp: "worker-src 'self'", url: "'/worker.js'", why: 'blob: workers refused' },
  '/tt/': {
    csp: "require-trusted-types-for 'script'; trusted-types page-policy",
    url: "trustedTypes.createPolicy('page-policy',{createScriptURL:function(s){return s;}})"
      + ".createScriptURL('/worker.js')",
    why: 'only the page may mint a policy',
  },
};

// What the browser ASKED with, per fixture. The JS half of the stand-down is only half a
// fix: if DNR kept rewriting accept-language and user-agent on these hosts, the document
// would ask in one identity and report another, which is the same contradiction moved from
// window-vs-worker to JS-vs-HTTP.
const asked = {};

const server = createServer((q, r) => {
  const seen = Object.keys(FIXTURES).find((k) => q.url.startsWith(k));
  // Per URL, not per fixture: the frame's request (?frame=1) used to overwrite the
  // document's, and since [FIX csp-restrictions-learned-per-route] the two can differ on the
  // learning visit — the route's allow rule lands between them.
  if (seen && q.url.indexOf('/worker.js') === -1) {
    asked[q.url] = { al: q.headers['accept-language'] || '', ua: q.headers['user-agent'] || '' };
  }
  if (q.url.indexOf('frame=1') !== -1) {
    const fk = Object.keys(FIXTURES).find((k) => q.url.startsWith(k)) || '/plain/';
    const fh = { 'content-type': 'text/html', 'cache-control': 'no-store' };
    if (FIXTURES[fk].csp) fh['content-security-policy'] = FIXTURES[fk].csp;
    return r.writeHead(200, fh).end(FRAME_JS);
  }
  if (q.url.indexOf('/worker.js') !== -1) {
    return r.writeHead(200, { 'content-type': 'application/javascript' }).end(WORKER_JS);
  }
  const key = Object.keys(FIXTURES).find((k) => q.url.startsWith(k)) || '/plain/';
  const h = { 'content-type': 'text/html', 'cache-control': 'no-store' };
  if (FIXTURES[key].csp) h['content-security-policy'] = FIXTURES[key].csp;
  r.writeHead(200, h).end(pageFor(FIXTURES[key].url));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const dir = mkdtempSync(path.join(tmpdir(), 'afp-coh-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER,
  headless: !headed,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const KEYS = ['cores', 'memory', 'platform', 'ua', 'lang', 'langs', 'tz', 'locale', 'tzoff',
  'uadPlatform', 'conn', 'canvas', 'gl'];

try {
  await (ctx.serviceWorkers()[0] || ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  // The CSP observer has to be listening before the visit it is meant to observe — the same
  // race test/blobcsp.mjs documents, one layer down.
  await bootSettled(ctx);

  const visit = async (key, n) => {
    const p = await ctx.newPage();          // FRESH TAB: empty sessionStorage, every time
    await p.goto(`${BASE}${key}?v=${n}`, { waitUntil: 'load' });
    const worker = await p.evaluate('window.__w');
    const frame = await p.evaluate('window.__f');
    const win = await p.evaluate(READ);
    await p.close();
    return { worker, frame, win, sent: asked[`${key}?v=${n}`] || {} };
  };

  section('0) the control — an ordinary origin still reports the profile');
  {
    const { worker, frame, win, sent } = await visit('/plain/', 1);
    assert(worker && typeof worker === 'object',
      `a plain origin builds its worker (${typeof worker === 'object' ? 'ok' : worker})`);
    eq(String(win.cores), '8', 'the window claims the profile here (8 cores)');
    if (worker && typeof worker === 'object') {
      const off = KEYS.filter((k) => String(worker[k]) !== String(win[k]));
      eq(off.join(',') || '(none)', '(none)',
        'and the patched worker agrees with it — the case the stand-down must NOT touch');
    }
    eq(String(sent.ua), String(win.ua),
      'the user-agent it asked with is the one it reports');
    eq(String(sent.al).split(',')[0], String(win.lang),
      'and so is the language');
    const foff = (frame && typeof frame === 'object')
      ? KEYS.filter((k) => String(frame[k]) !== String(win[k])) : ['(no frame reading)'];
    eq(foff.join(',') || '(none)', '(none)',
      'and so does a same-origin iframe');
  }

  for (const key of ['/wb/', '/tt/']) {
    section(`${key === '/wb/' ? 1 : 2}) ${key}  ${FIXTURES[key].why}`);
    for (const n of [1, 2, 3]) {
      const { worker, frame, win, sent } = await visit(key, n);
      if (!worker || typeof worker !== 'object') {
        // Visit 1 of /wb/ is allowed to lose its worker outright — README "Limits", item 13 — and a
        // worker that never ran cannot contradict anything.
        note(`   visit ${n}: no worker (${worker})`);
        assert(n === 1, `visit ${n} losing the worker is the documented first-visit residual`);
        continue;
      }
      const off = KEYS.filter((k) => String(worker[k]) !== String(win[k]))
        .map((k) => `${k}: window ${win[k]} vs worker ${worker[k]}`);
      eq(off.join(' ; ') || '(none)', '(none)',
        `visit ${n} (fresh tab): the window says exactly what the unpatchable worker says`);
      // The header half. Without the DNR exclusion these two fail while the block above
      // passes — the contradiction moved rather than closed.
      // Not on the learning visit: the document was requested before anything was known,
      // and whether the window then stands down before DOMContentLoaded is a race in both
      // directions (README "Limits", item 13). From the second visit the route's rule and the
      // document_start marker are both in place, and the two must agree.
      if (n === 1) {
        note(`   visit 1: header half not judged — the learning visit is the documented residual (asked ${String(sent.al).split(',')[0]}, reports ${win.lang})`);
      } else {
        eq(String(sent.ua), String(win.ua),
          `visit ${n}: the user-agent it asked with is the one it reports`);
        eq(String(sent.al).split(',')[0], String(win.lang),
          `visit ${n}: and so is the language`);
      }
      // [FIX the-stand-down-stopped-at-the-window] The third scope, and the one the first
      // version of this suite did not have: the window yielded while every same-origin
      // iframe went on spoofing, which is a contradiction a page reads without a worker at
      // all — seven signals of it, measured on youtube.com.
      const foff = (frame && typeof frame === 'object')
        ? KEYS.filter((k) => String(frame[k]) !== String(win[k]))
          .map((k) => `${k}: window ${win[k]} vs iframe ${frame[k]}`)
        : [`(no frame reading: ${frame})`];
      eq(foff.join(' ; ') || '(none)', '(none)',
        `visit ${n}: and a same-origin iframe says it too`);
    }
  }

  section('3) a flag that lands after DOMContentLoaded: a frame built later follows the window');
  // [FIX a-frame-built-after-the-flag-split-from-its-window] The window freezes its answer
  // at DOMContentLoaded; a frame the page builds afterwards used to read sessionStorage for
  // itself, so a flag that landed in between — a wrapped worker dying, an observer in another
  // tab of the site — stood the frame down while the window went on claiming the profile.
  // Measured in the user's browser on youtube.com: window Iris Xe / -120 / one canvas hash,
  // its about:blank frame Arc / -180 / another. The frame adopts the parent's frozen decision
  // now; the flag is planted here by hand, after the window has settled.
  {
    // On a host the learned lists do not cover: /wb/ and /tt/ above taught the observer
    // that 127.0.0.1 refuses blob: workers, so every new tab there stands down at
    // document_start — the case this section is NOT about. Same server, other name.
    const p = await ctx.newPage();
    await p.goto(`${BASE.replace('127.0.0.1', 'localhost')}/plain/?late=1`, { waitUntil: 'load' });
    const win = await p.evaluate(READ);
    eq(String(win.cores), '8', 'the window settled on the profile');
    // 'code:timeOrigin:route' since [FIX csp-restrictions-learned-per-route].
    await p.evaluate(() => { sessionStorage.setItem('v.ui.wb', '1:' + performance.timeOrigin + ':' + location.hostname + '/' + (location.pathname.split('/')[1] || '')); });
    const frame = await p.evaluate(`new Promise(function (res) {
      var fr = document.createElement('iframe'); fr.style.display = 'none';
      fr.onload = function () { try { res(fr.contentWindow.__r || 'no-reading'); } catch (e) { res('threw:' + e.name); } };
      fr.src = location.pathname + '?frame=1&late=1';
      document.documentElement.appendChild(fr);
      setTimeout(function () { res('timeout'); }, 6000);
    })`);
    // [FIX the-host-capture-was-readable-on-the-marker] The frame inherited the host's
    // capture (asserted below through its readings), and the page reads nothing of it.
    const leak = await p.evaluate(`(function () {
      var t = window.__t0, out = { top: 'absent', frame: 'absent' };
      try { out.top = t && ('hi' in t) ? String(t.hi) : 'absent'; } catch (e) { out.top = 'threw ' + e.name; }
      try {
        var fr = document.createElement('iframe'); fr.style.display = 'none'; document.documentElement.appendChild(fr);
        var ft = fr.contentWindow.__t0; out.frame = ft && ('hi' in ft) ? String(ft.hi) : 'absent'; fr.remove();
      } catch (e2) { out.frame = 'threw ' + e2.name; }
      return out;
    })()`);
    eq(leak.top + ' / ' + leak.frame, 'undefined / undefined',
      "the host's Intl capture on the status marker answers the PAGE with undefined, in the top and in a frame");
    const again = await p.evaluate(READ);
    eq(KEYS.filter((k) => String(again[k]) !== String(win[k])).join(',') || '(none)', '(none)',
      'the window keeps the answer it froze');
    const foff = (frame && typeof frame === 'object')
      ? KEYS.filter((k) => String(frame[k]) !== String(win[k]))
        .map((k) => `${k}: window ${win[k]} vs iframe ${frame[k]}`)
      : [`(no frame reading: ${frame})`];
    eq(foff.join(' ; ') || '(none)', '(none)',
      'and a same-origin iframe built after the flag landed says exactly what the window says');
    await p.close();
  }
} finally {
  await ctx.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  server.close();
}

done();
