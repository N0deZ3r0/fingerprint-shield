/**
 * DOES A MODE DO WHAT ITS TABLE SAYS? — enumerated, not listed.
 *
 *   node test/modeclaims.mjs             headless
 *   node test/modeclaims.mjs --headed    watch it
 *
 * THREE tables in mw/mw-core.js define what this extension does in a mode, all three written
 * by hand, and until this file nothing compared any of them with what the browser reports.
 *
 *   _HW_PROPS        21 property names. Host mode's whole promise is that NO hardware is
 *                    substituted; a property that gets patched but never added to that list
 *                    stays spoofed in host mode, and the promise is quietly false.
 *   _STEALTH_FEAT    13 feature flags saying which modules stay ON in stealth. Nothing checked
 *                    that the ones it turns OFF are actually off, or the reverse.
 *   _WK_PROPS        17 names handed back on an origin where a worker cannot be patched, so
 *                    the window does not claim what the worker contradicts. A forgotten name
 *                    there is a two-line contradiction on github.com or youtube.com.
 *
 * All three are checked here by ENUMERATION, and each has a negative control that was run:
 *
 *   drop `width` from _HW_PROPS                 host claims 1920 against a 1280 machine, exit 1
 *   say canvas:true without rebuilding          "stealth keeps canvas ON as its table says"
 *   drop `hardwareConcurrency` from _WK_PROPS   window 8 cores, worker 18, exit 1
 *
 * test/hostmode.mjs asks the first question from a SECOND hand list of ~25 `t('key', fn)`
 * probes. Two lists that have to agree about a third thing, and no enumeration anywhere. This
 * project has now paid three times for exactly that shape — nine methods in pagework part 4
 * hiding 129 accessor divergences, the same again for methods, and an eighty-entry `CASES`
 * array in dev-vsnative.html hiding two live wrong arities — so the fix is the same one:
 * read every accessor off the CLEAN browser and compare values, and read the flag table out of
 * mw/mw-core.js rather than retyping it here.
 *
 * WHAT IS DELIBERATELY NOT COMPARED, each for a measured reason rather than convenience:
 *
 *   navigator.webdriver   the extension hides automation in EVERY mode. Under Playwright the
 *                         clean browser answers true and ours false; that is the extension
 *                         working, and it is not a statement about hardware.
 *   connection rtt/downlink   live estimates. The header of test/hostmode.mjs records them
 *                         moving between two reads a second apart (1.45 vs 1.5) and between
 *                         browsers launched minutes apart (100 vs 150); comparing them across
 *                         two browser launches measures the network, not the mode.
 *   outerWidth/outerHeight   ONLY when the clean side reports 0, and then with a message.
 *                         Measured: loading an unpacked extension makes Chrome realise a real
 *                         window, so `outerWidth` reads 1280 with the extension and 0 without
 *                         it in the same headless launch shape. Instrumenting the helper
 *                         proved the extension is innocent — `outWv inner=1280 outer=1280
 *                         host=true` — the number came from the NATIVE getter and host mode
 *                         passed it through. Skipping it silently would hide a real leak here
 *                         later, so it is skipped out loud.
 *
 * THE CONTROL IS PART 2, and it is not decoration: an ordinary table profile has to MOVE the
 * same values that part 1 requires host mode to leave alone. Without it, a collector that
 * silently returned the same thing everywhere would make part 1 green.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, read as readFile, balanced, bootSettled } from './harness.mjs';

const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('  FAIL:', m); failed++; } };

// The flag table, read out of the module that owns it. Retyping it here would be a fourth
// hand list, and the one that decides whether the other three are right.
const STEALTH_FEAT = (() => {
  const src = readFile('mw/mw-core.js');
  const body = balanced(src, /var _STEALTH_FEAT\s*=/, '{', '}');
  const out = {};
  for (const m of body.matchAll(/([A-Za-z]+)\s*:\s*(true|false)/g)) out[m[1]] = m[2] === 'true';
  if (!Object.keys(out).length) throw new Error('could not read _STEALTH_FEAT');
  return out;
})();

const COLLECT = `(function () {
  var out = {};
  function val(v) {
    try {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      var t = typeof v;
      if (t === 'function') return 'function';
      if (t !== 'object') return t + ':' + String(v);
      if (Array.isArray(v)) return 'array:' + v.join(',');
      if (typeof v.length === 'number' && v.length < 40) {
        var a = [];
        for (var i = 0; i < v.length; i++) { try { a.push(String((v[i] && v[i].name) || v[i])); } catch (e) { a.push('?'); } }
        return 'listlike:' + a.join(',');
      }
      return 'object:' + Object.prototype.toString.call(v);
    } catch (e) { return 'ERR'; }
  }
  function readAll(label, holder, inst) {
    if (!holder || !inst) return;
    var names; try { names = Object.getOwnPropertyNames(holder); } catch (e) { return; }
    names.forEach(function (n) {
      if (n === 'constructor') return;
      var d; try { d = Object.getOwnPropertyDescriptor(holder, n); } catch (e) { return; }
      if (!d || typeof d.get !== 'function') return;
      try { out[label + '.' + n] = val(inst[n]); } catch (e) { out[label + '.' + n] = 'THREW'; }
    });
  }
  readAll('Navigator', (typeof Navigator !== 'undefined') && Navigator.prototype, navigator);
  if (typeof screen !== 'undefined') readAll('Screen', (typeof Screen !== 'undefined') && Screen.prototype, screen);
  try { if (navigator.connection) readAll('NetworkInformation', Object.getPrototypeOf(navigator.connection), navigator.connection); } catch (e) {}
  ['devicePixelRatio', 'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
   'screenX', 'screenY', 'screenLeft', 'screenTop'].forEach(function (n) {
    try { out['window.' + n] = val(window[n]); } catch (e) {}
  });
  ['(min-resolution: 1.5dppx)', '(-webkit-min-device-pixel-ratio: 1.5)', '(pointer: fine)',
   '(any-pointer: coarse)', '(hover: hover)', '(any-hover: none)', '(update: fast)',
   '(color-gamut: p3)', '(dynamic-range: high)', '(monochrome: 0)',
   '(orientation: landscape)', '(prefers-color-scheme: dark)'].forEach(function (q) {
    try { out['mq ' + q] = String(matchMedia(q).matches); } catch (e) {}
  });
  // The per-feature probes. Each one is the thing a flag in _STEALTH_FEAT is ABOUT, which is
  // the only part of this file a human has to keep in step — the values above are enumerated.
  try {
    var g = new OffscreenCanvas(32, 32).getContext('webgl');
    if (g) {
      var dbg = g.getExtension('WEBGL_debug_renderer_info');
      out['feat.webgl'] = dbg ? String(g.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'no-ext';
    }
  } catch (e) { out['feat.webgl'] = 'ERR'; }
  try {
    var c = new OffscreenCanvas(200, 60), x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '16px Arial'; x.fillStyle = '#f60'; x.fillRect(1, 1, 60, 20);
    x.fillStyle = '#069'; x.fillText('mode claims probe', 2, 15);
    var d = x.getImageData(0, 0, 200, 60).data, h = 5381;
    for (var i = 0; i < d.length; i += 7) h = ((h * 33) ^ d[i]) >>> 0;
    out['feat.canvas'] = String(h);
  } catch (e) { out['feat.canvas'] = 'ERR'; }
  try {
    var fx = new OffscreenCanvas(10, 10).getContext('2d'), w = [];
    ['16px "Segoe UI"', '16px "MS Gothic"', '16px "Nonexistent Family"'].forEach(function (f) {
      fx.font = f; w.push(fx.measureText('mmmMMMwwwWWW').width.toFixed(4));
    });
    out['feat.fonts'] = w.join(',');
  } catch (e) { out['feat.fonts'] = 'ERR'; }
  try {
    var el = document.createElement('div');
    el.setAttribute('style', 'position:absolute;left:13.37px;top:7.11px;width:101.3px;height:11.7px');
    document.documentElement.appendChild(el);
    var r = el.getBoundingClientRect();
    out['feat.clientRects'] = [r.x, r.y, r.width, r.height].map(function (v) { return v.toFixed(6); }).join(',');
    el.remove();
  } catch (e) { out['feat.clientRects'] = 'ERR'; }
  out['feat.plugins'] = val(navigator.plugins);
  try { out['feat.network'] = navigator.connection ? String(navigator.connection.effectiveType) : 'n/a'; } catch (e) {}
  out['feat.screen'] = screen.width + 'x' + screen.height;
  out['feat.navigator'] = String(navigator.hardwareConcurrency) + '/' + String(navigator.userAgent);
  try { out['feat.timezone'] = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
  return out;
})()`;

/**
 * Part 4 needs a collector that runs in a WORKER too, so it cannot touch document, screen or
 * matchMedia. The property list is the intersection the browser itself reports — every
 * accessor on WorkerNavigator.prototype and on the objects under it — never a written set.
 */
const COLLECT_BOTH = `(function () {
  var out = {};
  function val(v) {
    try {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      var t = typeof v;
      if (t === 'function') return 'function';
      if (t !== 'object') return t + ':' + String(v);
      if (Array.isArray(v)) return 'array:' + v.join(',');
      if (typeof v.length === 'number' && v.length < 40) {
        var a = [];
        for (var i = 0; i < v.length; i++) { try { a.push(String((v[i] && v[i].name) || v[i])); } catch (e) { a.push('?'); } }
        return 'listlike:' + a.join(',');
      }
      return 'object:' + Object.prototype.toString.call(v);
    } catch (e) { return 'ERR'; }
  }
  function walk(prefix, proto, inst) {
    if (!proto || !inst) return;
    var names; try { names = Object.getOwnPropertyNames(proto); } catch (e) { return; }
    names.forEach(function (n) {
      if (n === 'constructor') return;
      var d; try { d = Object.getOwnPropertyDescriptor(proto, n); } catch (e) { return; }
      if (!d || typeof d.get !== 'function') return;
      try { out[prefix + n] = val(inst[n]); } catch (e) { out[prefix + n] = 'THREW'; }
    });
  }
  walk('nav.', (typeof WorkerNavigator !== 'undefined') ? WorkerNavigator.prototype
             : ((typeof Navigator !== 'undefined') ? Navigator.prototype : null), navigator);
  try { if (navigator.connection) walk('conn.', Object.getPrototypeOf(navigator.connection), navigator.connection); } catch (e) {}
  try { if (navigator.userAgentData) walk('uad.', Object.getPrototypeOf(navigator.userAgentData), navigator.userAgentData); } catch (e) {}
  try { out['intl.tz'] = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
  try { out['intl.locale'] = Intl.DateTimeFormat().resolvedOptions().locale; } catch (e) {}
  try { out['date.off'] = String(new Date(2021, 0, 1).getTimezoneOffset()); } catch (e) {}
  try {
    var g = new OffscreenCanvas(32, 32).getContext('webgl');
    if (g) {
      var dbg = g.getExtension('WEBGL_debug_renderer_info');
      out['gl.renderer'] = dbg ? String(g.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'no-ext';
      out['gl.vendor'] = dbg ? String(g.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : 'no-ext';
    }
  } catch (e) {}
  try {
    var c = new OffscreenCanvas(200, 60), x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '16px Arial'; x.fillStyle = '#f60'; x.fillRect(1, 1, 60, 20);
    x.fillStyle = '#069'; x.fillText('standdown probe', 2, 15);
    var d = x.getImageData(0, 0, 200, 60).data, h = 5381;
    for (var i = 0; i < d.length; i += 7) h = ((h * 33) ^ d[i]) >>> 0;
    out['canvas2d'] = String(h);
  } catch (e) {}
  return out;
})()`;
const SD_WORKER = 'self.onmessage=function(){postMessage(' + COLLECT_BOTH + ');};\n';
const SD_PAGE = '<!doctype html><meta charset=utf-8><title>sd</title><body>sd<script>' +
  'window.__win = ' + COLLECT_BOTH + ';' +
  'window.__wrk = new Promise(function (res) {' +
  '  try { var w = new Worker("/worker.js");' +
  '    var t = setTimeout(function () { res({ __err: "timeout" }); }, 15000);' +
  '    w.onmessage = function (e) { clearTimeout(t); res(e.data); };' +
  '    w.onerror = function (e) { clearTimeout(t); res({ __err: String(e.message || "(empty)") }); };' +
  '    w.postMessage(1); } catch (e) { res({ __err: String(e) }); }' +
  '});<' + '/script>';

const server = createServer((q, r) => {
  const u = q.url || '/';
  if (u.indexOf('/worker.js') === 0) {
    r.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(SD_WORKER);
    return;
  }
  // /wb/ is the stand-down shape github.com has: worker-src 'self' refuses a blob: worker, so
  // _isBlobBlocked() hands the native constructors back and the page's own workers read the
  // machine. /ok/ is the same document with no CSP — the control for part 4.
  if (u.indexOf('/wb/') === 0 || u.indexOf('/ok/') === 0) {
    const h = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
    if (u.indexOf('/wb/') === 0) h['content-security-policy'] = "worker-src 'self'";
    r.writeHead(200, h).end(SD_PAGE);
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    .end('<!doctype html><meta charset=utf-8><title>modeclaims</title><body>m<script>window.__o = ' + COLLECT + ';<' + '/script>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const url = base + '/';

/**
 * BOTH SIDES ARE launchPersistentContext, always. `chromium.launch()` + `newContext()`
 * emulates a viewport and reports outerWidth 0 while a persistent context gives a real
 * window; using different shapes for clean and ours produced two "leaks" that were the
 * harness. The clean side still has no realised window (no extension to force one), which is
 * what the outer* skip below is for.
 */
async function run(profile) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-modeclaims-'));
  const launch = () => chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: !headed,
    args: profile ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  let ctx = await launch();
  try {
    if (profile) {
      const sw = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
        await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await bootSettled(ctx);
      await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, profile);
      await new Promise((r) => setTimeout(r, 1500));
      // Restart so the boot script is registered before the page loads — the same settle the
      // cold-start suite performs, and without it the profile arrives after the first script.
      await ctx.close();
      await new Promise((r) => setTimeout(r, 1200));
      ctx = await launch();
      ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await bootSettled(ctx);
    }
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: 'load' });
    const o = await p.evaluate(() => window.__o);
    await p.close();
    return o;
  } finally {
    await ctx.close().catch(() => {});
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds the profile */ }
  }
}

const PC = { screenW: 2560, screenH: 1440, cores: 12, memory: 16, gpu: 'nvidia_3060', platform: 'Win32', dpr: 1 };
const country = { afp_country_code: 'EE', afp_resolved_timezone: 'Europe/Tallinn', afp_resolved_locale: 'et-EE' };
const CLEAN = await run(null);
const HOST = await run({ afp_profile_id: 'host', afp_profile_data: { host: true }, ...country, afp_mode: 'normal' });
const NORMAL = await run({ afp_profile_id: 'pc_gaming', afp_profile_data: PC, ...country, afp_mode: 'normal' });
const STEALTH = await run({ afp_profile_id: 'pc_gaming', afp_profile_data: PC, ...country, afp_mode: 'stealth' });

// Not hardware, or not comparable across two browser launches — see the header. The last two
// are the ones this file was wrong about on its first run and they are worth naming: host mode
// KEEPS the per-domain canvas seed and the text-width noise on purpose (the open-work list 0a, "что
// остаётся профильным"). What it hands back to the machine there is the font ALLOWLIST, not
// the noise — linkability across sites is the part host mode never gives up, because it is not
// a claim about hardware. test/hostmode.mjs is the instrument for the allowlist half.
const EXCLUDED = /^Navigator\.(webdriver|userAgent|appVersion|language|languages|userAgentData|doNotTrack|globalPrivacyControl)$|^NetworkInformation\.(rtt|downlink)$|^feat\.(navigator|timezone|canvas|fonts)$/;

console.log('\n0) the browsers are what this file thinks they are');
ok(Object.keys(CLEAN).length > 40, `the collector reached the surfaces (${Object.keys(CLEAN).length} values)`);
ok(CLEAN['feat.screen'] !== NORMAL['feat.screen'],
  `an ordinary profile moves the screen (clean ${CLEAN['feat.screen']}, normal ${NORMAL['feat.screen']})`);
console.log(`  _STEALTH_FEAT read from mw/mw-core.js: ${Object.entries(STEALTH_FEAT).map(([k, v]) => k + '=' + v).join(' ')}`);

/* ------------------------------------------- 1) host mode substitutes no hardware -------- */
console.log('\n1) host mode: every enumerated value equals a clean browser');
let hostDiff = 0, hostSkipped = 0;
for (const k of Object.keys(CLEAN)) {
  if (EXCLUDED.test(k)) continue;
  const c = String(CLEAN[k]), h = String(HOST[k]);
  // outer* only where the clean side has a realised window — never silently.
  if (/^window\.outer/.test(k) && c === 'number:0') {
    console.log(`  SKIPPED ${k}: the clean browser has no realised window here (reports 0), ` +
      'and an extension makes Chrome realise one — see the header');
    hostSkipped++;
    continue;
  }
  if (c === h) continue;
  hostDiff++;
  ok(false, `host mode changes ${k}: clean ${c} host ${h}`);
}
ok(hostDiff === 0, `host mode left every comparable hardware value alone (${hostDiff} changed)`);
console.log(`  ${Object.keys(CLEAN).length} values, ${hostSkipped} skipped out loud, ${hostDiff} differing`);

/* ------------------------------------------- 2) the control: normal mode MOVES them ------ */
console.log('\n2) control — an ordinary profile moves what host mode leaves alone');
const moved = Object.keys(CLEAN).filter((k) => !EXCLUDED.test(k) && String(CLEAN[k]) !== String(NORMAL[k]));
console.log(`  ${moved.length} value(s) move under pc_gaming: ${moved.slice(0, 8).join(', ')}${moved.length > 8 ? ' …' : ''}`);
ok(moved.length >= 8,
  `the collector can see a mode change at all (${moved.length} values move under an ordinary profile)`);
for (const key of ['feat.screen', 'feat.webgl', 'Navigator.hardwareConcurrency']) {
  ok(String(CLEAN[key]) !== String(NORMAL[key]), `control moves ${key}`);
  ok(String(CLEAN[key]) === String(HOST[key]), `and host mode does not: ${key}`);
}

/* ------------------------------------------- 3) stealth does what its table says --------- */
// The flag names on the left come from _STEALTH_FEAT itself; the probe on the right is the
// only hand-made link in this file, and it is one line per flag.
const PROBE = {
  canvas: 'feat.canvas', fonts: 'feat.fonts', clientRects: 'feat.clientRects',
  plugins: 'feat.plugins', network: 'feat.network', screen: 'feat.screen', webgl: 'feat.webgl'
};
console.log('\n3) stealth: a flag it turns OFF is off, a flag it leaves ON is on');
for (const [flag, key] of Object.entries(PROBE)) {
  if (!(flag in STEALTH_FEAT)) { console.log(`  SKIPPED ${flag}: not named in _STEALTH_FEAT`); continue; }
  const c = String(CLEAN[key]), s = String(STEALTH[key]), n = String(NORMAL[key]);
  if (c === n) {
    // The feature does not move on this machine even in normal mode, so stealth cannot be
    // judged by it. Said out loud rather than counted as a pass.
    console.log(`  SKIPPED ${flag} (${key}): normal mode does not move it here either ` +
      `(clean ${c.slice(0, 30)}), so this probe cannot judge stealth`);
    continue;
  }
  if (STEALTH_FEAT[flag]) {
    ok(s !== c, `stealth keeps ${flag} ON as its table says (${key}: clean ${c.slice(0, 24)}, stealth ${s.slice(0, 24)})`);
  } else {
    ok(s === c, `stealth turns ${flag} OFF as its table says (${key}: clean ${c.slice(0, 24)}, stealth ${s.slice(0, 24)})`);
  }
}

/* ------------------------------- 4) the stand-down, the third hand table ----------------- */
//
// _WK_PROPS in mw/mw-core.js is 17 names: the properties the window hands back on an origin
// where a worker cannot be patched, so it does not claim what the worker contradicts. Its
// guard, test/wbcoherence.mjs, opens by saying "THE COMPARISON IS THE WHOLE SURFACE, not the
// four fields that were measured… a list is exactly the kind of thing that goes stale" — and
// then asks 25 hand-written probes. This part is that sentence, implemented.
console.log('\n4) stand-down origin: the window claims nothing the worker contradicts');
{
  const dir = mkdtempSync(join(tmpdir(), 'afp-sd-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: !headed,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  const seen = {};
  try {
    ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    await bootSettled(ctx);
    for (const route of ['/wb/', '/ok/']) {
      // Twice, reading the second: the first visit to a host is the documented residual of
      // every per-site flag here, and a comparison made in that window measures the residual.
      let win = null, wrk = null;
      for (let i = 0; i < 2; i++) {
        const p = await ctx.newPage();
        await p.goto(base + route, { waitUntil: 'load' });
        if (i === 1) { win = await p.evaluate(() => window.__win); wrk = await p.evaluate(() => window.__wrk); }
        await p.close();
      }
      ok(!(wrk && wrk.__err), `${route}: the worker answered (${(wrk && wrk.__err) || 'ok'})`);
      if (!wrk || wrk.__err) continue;
      seen[route] = win;
      const shared = Object.keys(win).filter((k) => k in wrk);
      const diff = shared.filter((k) => String(win[k]) !== String(wrk[k]));
      console.log(`  ${route} — ${shared.length} values readable in both scopes, ${diff.length} disagreeing`);
      for (const k of diff) console.log(`      ${k.padEnd(24)} window=${String(win[k]).slice(0, 34)}  worker=${String(wrk[k]).slice(0, 34)}`);
      ok(diff.length === 0, `${route}: window and worker agree on every enumerated value (${diff.length} differ)`);
    }
    // LIVENESS, and it is the whole reason part 4 can be trusted: on a stand-down origin the
    // machine must be a DIFFERENT one from an ordinary origin. Without this, "window agrees
    // with worker" is satisfied by nothing standing down at all, and the section is vacuous —
    // the same trap dev-ownprops.html fell into for months.
    if (seen['/wb/'] && seen['/ok/']) {
      const a = seen['/wb/'], b = seen['/ok/'];
      const moved = Object.keys(b).filter((k) => String(a[k]) !== String(b[k]));
      console.log(`  liveness: ${moved.length} value(s) differ between the stand-down origin and an ordinary one` +
        (moved.length ? ` — ${moved.slice(0, 6).join(', ')}${moved.length > 6 ? ' …' : ''}` : ''));
      ok(moved.length >= 5, `the stand-down actually fired (${moved.length} values handed to the machine)`);
    }
  } finally {
    await ctx.close().catch(() => {});
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds the profile */ }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
