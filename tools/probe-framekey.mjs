/**
 * WHICH HOST KEYS THE PER-DOMAIN SEED — the frame's own, or the site the page is on?
 *
 *   node tools/probe-framekey.mjs
 *   node tools/probe-framekey.mjs --headed
 *
 * Three writers answer that question and they do not use the same input:
 *
 *   dyn/boot.js          afpEffectiveHostname()  -> location.hostname FIRST, so a
 *                        cross-origin frame keys on ITS OWN host
 *   storage-bridge.js    the same function, the same answer
 *   background.js        injectProfile(): `new URL(tab.url).hostname` — the TAB's host —
 *                        pushed with allFrames:true, so every frame gets the TOP site's seed
 *
 * mw-core hard-locks whichever seed is resolved first ([FIX seed-hard-lock]), and boot.js
 * runs before the page's first script while the inject lands ~300ms later. So the answer a
 * frame gives can depend on WHEN it draws, and this probe reads both moments:
 *
 *   /p   draws in the page's first inline script  -> whatever boot.js delivered
 *   /pl  draws nothing until 2s after load        -> whatever injectProfile delivered
 *
 * Realms read (one listener, several hostnames via --host-resolver-rules):
 *
 *   top a.localhost                        first party
 *   top t.localhost                        the same host as a first party
 *   frame t.localhost inside a.localhost   third-party frame
 *   frame t.localhost inside b.localhost   the same third party on another site
 *   frame a.localhost inside a.localhost   same-origin control
 *
 * The comparisons that decide it are printed at the bottom.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, loadBackground, loadPopup } from '../test/harness.mjs';

const headed = process.argv.includes('--headed');
const { COUNTRY_DATA } = loadBackground(['COUNTRY_DATA']);
const { PROFILES } = loadPopup(['PROFILES']);
const PROFILE_ID = 'laptop_mid', CC = 'EE';
const P = PROFILES.find((x) => x.id === PROFILE_ID);
const C = COUNTRY_DATA[CC];

// One drawing, one hash. Text over a filled rect: more than two colours, so the noise is
// not skipped ([FIX canvas-noise-skips-hard-edges]).
const SNAP = `
function __draw() {
  var c = document.createElement('canvas'); c.width = 200; c.height = 50;
  var x = c.getContext('2d');
  x.textBaseline = 'top'; x.font = '14px Arial';
  x.fillStyle = '#f60'; x.fillRect(1, 1, 90, 24);
  x.fillStyle = '#069'; x.fillText('Cwm fjord bank', 2, 15);
  var s = c.toDataURL(), h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
function __snap() {
  var o = { host: location.hostname };
  try { o.canvas = __draw(); } catch (e) { o.canvas = 'ERR'; }
  try { o.cores = navigator.hardwareConcurrency; } catch (e) {}
  try { o.mem = navigator.deviceMemory; } catch (e) {}
  try { o.screen = screen.width + 'x' + screen.height + '@' + devicePixelRatio; } catch (e) {}
  try {
    var gl = document.createElement('canvas').getContext('webgl');
    var d = gl.getExtension('WEBGL_debug_renderer_info');
    o.gpu = String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)).slice(0, 60);
  } catch (e) { o.gpu = 'ERR'; }
  return o;
}`;

// /p  — reads in the page's first inline script AND again 2s later.
// /pl — touches no canvas until 2s after load, so the first seed it ever asks for is
//       whatever arrived last.
const PAGE_EARLY = '<script>' + SNAP + '\n' +
  'window.__early = __snap();\n' +
  'window.__late = new Promise(function (r) { setTimeout(function () { r(__snap()); }, 2000); });\n' +
  '<\/script>';
const PAGE_LATE = '<script>' + SNAP + '\n' +
  'window.__early = null;\n' +
  'window.__late = new Promise(function (r) { setTimeout(function () { r(__snap()); }, 2000); });\n' +
  '<\/script>';

let PORT = 0;
const server = createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  if (u.pathname === '/host') {
    const f = u.searchParams.get('f'), p = u.searchParams.get('p') || '/p';
    r.end('<!doctype html><meta charset=utf-8><title>host</title>' +
      '<iframe id="f" src="http://' + f + ':' + PORT + p + '"></iframe>');
    return;
  }
  r.end('<!doctype html><meta charset=utf-8><title>p</title>' +
    (u.pathname === '/pl' ? PAGE_LATE : PAGE_EARLY));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;
// Without this every *.localhost name resolves to ::1, the listener is not there, and the
// frame is a Chrome error page that answers with the host's own values.
const HOSTS = ['a.localhost', 'b.localhost', 't.localhost'];
const RESOLVER = '--host-resolver-rules=' + HOSTS.map((h) => 'MAP ' + h + ' 127.0.0.1').join(', ');

const userDataDir = mkdtempSync(join(tmpdir(), 'afp-framekey-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...BROWSER, headless: !headed,
  args: ['--disable-extensions-except=' + root, '--load-extension=' + root, RESOLVER]
});

const url = (h, p) => 'http://' + h + ':' + PORT + p;

async function readTop(host, path_) {
  const page = await ctx.newPage();
  await page.goto(url(host, path_), { waitUntil: 'load' });
  const early = await page.evaluate(() => window.__early);
  const late = await page.evaluate(() => window.__late);
  await page.close();
  return { early, late };
}
async function readFrame(topHost, frameHost, path_) {
  const page = await ctx.newPage();
  await page.goto(url(topHost, '/host?f=' + frameHost + '&p=' + path_), { waitUntil: 'load' });
  const fr = page.frames().find((f) => f !== page.mainFrame());
  const early = fr ? await fr.evaluate(() => window.__early) : null;
  const late = fr ? await fr.evaluate(() => window.__late) : null;
  await page.close();
  return { early, late };
}

const R = {};
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
    afp_profile_id: P.id,
    afp_profile_data: {
      screenW: P.screenW, screenH: P.screenH, cores: P.cores,
      memory: P.memory, gpu: P.gpuKey, platform: P.platform, dpr: P.dpr
    },
    afp_country_code: CC, afp_resolved_timezone: C.tz, afp_resolved_locale: C.loc,
    afp_mode: 'normal'
  });
  await new Promise((r) => setTimeout(r, 1500));

  R.topA = await readTop('a.localhost', '/p');
  R.topT = await readTop('t.localhost', '/p');
  R.frameTinA = await readFrame('a.localhost', 't.localhost', '/p');
  R.frameTinB = await readFrame('b.localhost', 't.localhost', '/p');
  R.frameAinA = await readFrame('a.localhost', 'a.localhost', '/p');
  // late-only: the seed that arrived last, not the one that arrived first
  R.topA_late = await readTop('a.localhost', '/pl');
  R.frameTinA_late = await readFrame('a.localhost', 't.localhost', '/pl');
} finally {
  await ctx.close();
  rmSync(userDataDir, { recursive: true, force: true });
  server.close();
}

const c = (x) => (x && x.canvas) || '-';
const row = (name, r) => console.log(
  '  ' + name.padEnd(32) + ' early ' + String(c(r.early)).padEnd(10) + ' late ' + c(r.late));

console.log('\nCANVAS HASH PER REALM (profile ' + PROFILE_ID + '/' + CC + ')\n');
row('top a.localhost', R.topA);
row('top t.localhost', R.topT);
row('frame t IN a', R.frameTinA);
row('frame t IN b', R.frameTinB);
row('frame a IN a (same-origin)', R.frameAinA);
row('top a - drawn late only', R.topA_late);
row('frame t IN a - drawn late only', R.frameTinA_late);

console.log('\nMACHINE PER REALM\n');
for (const [k, v] of Object.entries(R)) {
  const s = v.early || v.late;
  if (s) console.log('  ' + k.padEnd(16) + ' ' + String(s.host).padEnd(14) + ' ' +
    s.cores + 'c ' + s.mem + 'GB ' + s.screen + ' ' + s.gpu);
}

const eq = (a, b) => c(a) === c(b);
const say = (q, cond, yes, no) =>
  console.log('  ' + q + '\n      ' + (cond ? 'YES  ' + yes : 'NO   ' + no));
console.log('\nVERDICT\n');
say('Is a third-party frame keyed on its OWN host?',
  eq(R.frameTinA.early, R.topT.early),
  'frame t IN a == top t  - the frame carries t.localhost seed, not the site seed',
  'frame t IN a != top t');
say('Does that frame show the SAME noise on two different sites?',
  eq(R.frameTinA.early, R.frameTinB.early),
  'frame t IN a == frame t IN b  - a cross-site identifier for the embedded party',
  'frame t IN a != frame t IN b  - keyed per embedding site');
say('Does the frame disagree with its own parent page?',
  !eq(R.frameTinA.early, R.topA.early),
  'frame != parent  - two seeds in one page',
  'frame == parent');
say('Same-origin frame agrees with its parent?',
  eq(R.frameAinA.early, R.topA.early), 'as it must', 'BROKEN - same-origin child differs');
say('Does the answer depend on WHEN the page draws?',
  !eq(R.frameTinA.early, R.frameTinA_late.late),
  'early != late in the frame - boot.js and injectProfile deliver different seeds',
  'early == late in the frame - both deliveries agree');
say('  ... and in the top document?',
  !eq(R.topA.early, R.topA_late.late), 'early != late at the top too', 'top is stable');
console.log('');
