/**
 * CAN THE WORKER BE PATCHED, AND DOES THE WINDOW AGREE WITH THE ANSWER?
 *
 *   node test/workerpatchgate.mjs             headless
 *   node test/workerpatchgate.mjs --headed    watch it
 *
 * Reported from a real github.com tab with the per-site CSP switch ON — the audit page's
 * scope comparison, ten divergences:
 *
 *     signal                 window            worker
 *     Intl timeZone          Europe/Tallinn    Europe/Moscow
 *     Intl locale            et-EE             ru
 *     navigator.language     et-EE             ru-RU
 *     hardwareConcurrency    8                 18
 *     deviceMemory           8                 16
 *     WebGL renderer         Iris Xe           Arc
 *     canvas hash            54f16587          72b42f7e
 *     …
 *
 * The window claimed the profile while the page's own worker read the machine, which is
 * the one thing the stand-down exists to prevent: a site reads any of those twice and the
 * disagreement IS the fingerprint.
 *
 * THE CAUSE WAS A GATE NOBODY WATCHED. mw-workers hands back the native, unpatched
 * constructor down several paths, and mw-core's stand-down keyed on two of them —
 * worker-src refusing blob:, and a trusted-types NAME allowlist. The third is the source
 * read: the wrapper fetches the original worker script with a synchronous XHR and prepends
 * its payload, and where connect-src refuses a blob: fetch it falls back to importScripts,
 * and where script-src refuses blob: too it passes through. Passing through is CORRECT — a
 * wrapper that cannot load what it wraps destroys the page's worker, which is how Turnstile
 * died on claude.ai. Going on to claim a profile that worker contradicts is not.
 *
 * github.com's live header (curl'd 2026-09-06) is exactly that shape:
 *
 *     worker-src   github.githubassets.com github.com/assets-cdn/worker/ …    no blob:
 *     connect-src  'self' uploads.github.com …                                no blob:
 *     script-src   github.githubassets.com                                    no blob:
 *
 * With the switch OFF, worker-src refuses blob: and the whole origin stands down: coherent,
 * unspoofed, and that is README "Limits", item 6. With the switch ON the rewrite added blob: to
 * worker-src and nothing else, so the worker became CREATABLE while staying UNPATCHABLE and
 * the stand-down lifted. The switch turned a coherent origin into a ten-signal split.
 *
 * The three routes below are the three shapes, and the third is the control that makes the
 * second mean anything:
 *
 *   /gh/    no blob: anywhere            worker refused        → stand down (old gate)
 *   /half/  worker-src blob: only        created, unpatchable  → stand down (the new gate)
 *   /ok/    worker-src + connect-src     created and PATCHED   → no stand down
 *
 * WITHOUT /ok/ THIS SUITE WOULD PASS ON A BUILD THAT NEVER PATCHES ANY WORKER: "window
 * agrees with worker" is satisfied by spoofing nothing at all. /ok/ is where the profile
 * has to appear.
 *
 * Section 4 is the reported case itself: the switch on /gh/, which must now deliver the
 * profile in BOTH scopes rather than lifting the stand-down over an unpatchable worker.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, root, BROWSER } from './harness.mjs';

const headed = process.argv.includes('--headed');
const { assert, eq, section, note, done } = harness();

const READ = `(function () {
  var o = {};
  var t = function (k, f) { try { o[k] = f(); } catch (e) { o[k] = 'THREW ' + e.name; } };
  t('cores', function () { return navigator.hardwareConcurrency; });
  t('memory', function () { return navigator.deviceMemory; });
  t('lang', function () { return navigator.language; });
  t('tz', function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; });
  return o;
})()`;

// The page builds its worker from a BLOB, which is what the audit page does and what any
// site can do in one line. A same-origin script worker would take a different path in the
// wrapper and would not exercise the gate this suite is about.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>gate</title>
<script>
window.__w = new Promise(function (res) {
  var d = false, f = function (v) { if (!d) { d = true; res(v); } };
  try {
    var src = 'onmessage=function(){postMessage(' + ${JSON.stringify(READ)} + ');};';
    var u = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    var w = new Worker(u);
    w.onmessage = function (e) { f(e.data); };
    w.onerror = function (e) { f('error:' + (e && e.message ? e.message : '(empty)')); };
    w.postMessage(1);
  } catch (e) { f('threw:' + (e && e.name)); }
  setTimeout(function () { f('timeout'); }, 6000);
});
</` + `script></head><body>gate</body></html>`;

// Three shapes, one origin, one route each — the lists are learned per host/segment, so
// each route is judged on its own header.
const CSP = {
  // github.com's shape: nothing anywhere admits blob:.
  gh: "default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'",
  // What the rewrite used to produce: the worker may be built and cannot be read or
  // imported, so it runs unpatched.
  half: "default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:",
  // What the rewrite produces now: the source read is admitted, so the payload goes in
  // inline and script-src is never asked about blob: at all.
  ok: "default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self' blob:; worker-src 'self' blob:"
};

let port = 0;
const server = createServer((q, r) => {
  const u = (q.url || '/').split('?')[0];
  const seg = u.split('/')[1] || '';
  const csp = CSP[seg];
  if (!csp) return r.writeHead(404).end('no');
  r.setHeader('Content-Security-Policy', csp);
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

const dir = mkdtempSync(join(tmpdir(), 'afp-gate-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER,
  headless: !headed,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

const KEYS = ['cores', 'memory', 'lang', 'tz'];
// A FRESH TAB every time: the flags live in sessionStorage, so a reused tab would carry
// the previous visit's answer — the reason test/wbcoherence.mjs does the same.
async function visit(route, n) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/${route}/?v=${n}`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  const out = { worker: await p.evaluate(() => window.__w) };
  out.win = await p.evaluate(READ);
  await p.close();
  return out;
}
// Visit 1 learns the header, visit 2 is the steady state — nothing can be registered for a
// route nobody has seen (README "Limits", item 13, and the header of noblob.js).
const settled = async (route) => {
  await visit(route, 1);
  await new Promise((r) => setTimeout(r, 1500));
  return visit(route, 2);
};
const show = (tag, r) => note(`${tag.padEnd(7)} window ${JSON.stringify(r.win)}\n        worker ${JSON.stringify(r.worker)}`);

try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  const hostCores = await sw.evaluate(() => navigator.hardwareConcurrency);
  note(`the machine reports ${hostCores} cores`);

  // ── 3 first: it is the control, and a failure here voids the other two ───────
  section('1) the control: a CSP that admits the read — the worker is PATCHED');
  const ok = await settled('ok');
  show('/ok/', ok);
  assert(ok.worker && typeof ok.worker === 'object',
    `the blob worker runs (${typeof ok.worker === 'object' ? 'ok' : ok.worker})`);
  if (ok.worker && typeof ok.worker === 'object') {
    assert(String(ok.worker.cores) !== String(hostCores),
      `and it does NOT read the machine — it is patched (${ok.worker.cores} vs ${hostCores} cores)`);
    for (const k of KEYS) {
      eq(String(ok.win[k]), String(ok.worker[k]), `window and worker agree on ${k} (${ok.win[k]})`);
    }
  }

  section('2) github\'s shape: no blob: anywhere — refused, and the origin stands down');
  const gh = await settled('gh');
  show('/gh/', gh);
  eq(String(gh.win.cores), String(hostCores),
    `the window stands down to the machine (${gh.win.cores} cores)`);
  // The worker is refused outright here; what matters is that the window did not go on
  // claiming a profile beside a page that can build native workers at will.
  assert(typeof gh.worker !== 'object' || String(gh.worker.cores) === String(hostCores),
    `and nothing in the page reads a profile (${JSON.stringify(gh.worker)})`);

  section('3) [FIX the-third-gate-nobody-watched] creatable, unpatchable — must stand down');
  const half = await settled('half');
  show('/half/', half);
  assert(half.worker && typeof half.worker === 'object',
    `the blob worker RUNS here — worker-src admits it (${typeof half.worker === 'object' ? 'ok' : half.worker})`);
  if (half.worker && typeof half.worker === 'object') {
    // The fixture's whole point: this worker cannot be patched, and section 1 proves that
    // is the CSP's doing and not a wrapper that never patches anything.
    eq(String(half.worker.cores), String(hostCores),
      `and it cannot be patched, so it reads the machine (${half.worker.cores} cores)`);
    // THE ASSERTION THE REPORT IS ABOUT. Before the fix the window answered the profile
    // here — 8 cores beside 18 — and every key below was a divergence a site could read.
    for (const k of KEYS) {
      eq(String(half.win[k]), String(half.worker[k]),
        `the window stood down to match it on ${k} (${half.win[k]})`);
    }
    eq(String(half.win.cores), String(hostCores),
      `the window reads the machine too (${half.win.cores}), so there is nothing to compare`);
  }

  section('4) the reported case: the switch pressed IN the open tab');
  // The user's exact sequence, and the one a fresh-tab test cannot see. The switch clears
  // the per-tab flags the rewrite makes false, and sessionStorage is per tab: a flag left
  // behind keeps the wrapper refusing to read the worker source while the window has
  // already stopped standing down — which is the split, in the one tab the user is looking
  // at, until they close it.
  const openTab = await ctx.newPage();
  await openTab.goto(`${BASE}/gh/?live=1`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 600));
  const flagsBefore = await openTab.evaluate(() =>
    ['v.ui.wb', 'v.ui.nc', 'v.ui.ns'].map((k) => k + '=' + (sessionStorage.getItem(k) ? 'set' : '-')).join(' '));
  note(`flags in that tab before the switch: ${flagsBefore}`);
  await openTab.bringToFront();
  const toggled = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return afpToggleCspRewrite(tab);
  });
  note(`toggle → ${JSON.stringify(toggled)}`);
  eq(toggled.on, true, 'the switch went on for this host');
  const flagsAfter = await openTab.evaluate(() =>
    ['v.ui.wb', 'v.ui.nc', 'v.ui.ns'].map((k) => k + '=' + (sessionStorage.getItem(k) ? 'set' : '-')).join(' '));
  note(`flags after the switch:            ${flagsAfter}`);
  assert(!/v\.ui\.wb=set/.test(flagsAfter), `v.ui.wb was cleared in the open tab (${flagsAfter})`);
  assert(!/v\.ui\.nc=set/.test(flagsAfter),
    `and v.ui.nc with it — the rewrite admits the read now, and leaving this set is what ` +
    `kept the wrapper from patching in the very tab the switch was pressed in (${flagsAfter})`);
  await openTab.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 700));
  const live = { worker: await openTab.evaluate(() => window.__w), win: await openTab.evaluate(READ) };
  show('/gh/ tab', live);
  assert(live.worker && typeof live.worker === 'object',
    `the blob worker runs after the switch (${typeof live.worker === 'object' ? 'ok' : live.worker})`);
  if (live.worker && typeof live.worker === 'object') {
    assert(String(live.worker.cores) !== String(hostCores),
      `and it is PATCHED in that same tab (${live.worker.cores} vs ${hostCores})`);
    for (const k of KEYS) {
      eq(String(live.win[k]), String(live.worker[k]),
        `window and worker agree on ${k} in the tab the switch was pressed in (${live.win[k]})`);
    }
  }
  await openTab.close();

  section('5) and the steady state: a fresh tab with the switch already on');
  const rw = await settled('gh');
  show('/gh/+rw', rw);
  assert(rw.worker && typeof rw.worker === 'object',
    `the blob worker runs — the rewrite admitted it (${typeof rw.worker === 'object' ? 'ok' : rw.worker})`);
  if (rw.worker && typeof rw.worker === 'object') {
    assert(String(rw.worker.cores) !== String(hostCores),
      `and it is PATCHED, which is what the switch promises (${rw.worker.cores} vs ${hostCores})`);
    for (const k of KEYS) {
      eq(String(rw.win[k]), String(rw.worker[k]),
        `window and worker agree on ${k} with the switch on (${rw.win[k]})`);
    }
  }

  section('6) a host switched on BEFORE the fix: the stale entry has to retire itself');
  // The user's real state. They pressed the switch under the old build, where the rewrite
  // admitted the worker and not the read — so the very next load re-learned the host as
  // blob-read-refusing, and these lists are ADD-ONLY. Nothing would ever have taken it out
  // again, and while it sits there storage-bridge keeps writing v.ui.nc, the wrapper keeps
  // passing workers through unpatched, and the window no longer stands down. Updating the
  // extension alone would not have fixed the tab in front of them.
  //
  // Add-only is right for what a SITE sends: one loose document must not erase a strict
  // host. It is wrong for a header we write ourselves, which is the exception made here.
  await sw.evaluate(async (host) => {
    await chrome.storage.local.set({
      afp_csp_nc: [host + '/gh'],
      afp_csp_noblob: [host + '/gh']
    });
    _cspNc = null; _cspNoBlob = null;
    await updateNoBlobScript();
  }, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 1200));
  const listed = await sw.evaluate(() => chrome.storage.local.get(['afp_csp_nc', 'afp_csp_noblob']));
  note(`planted: ${JSON.stringify(listed)}`);
  const healed = await settled('gh');
  show('/gh/heal', healed);
  const after = await sw.evaluate(() => chrome.storage.local.get(['afp_csp_nc', 'afp_csp_noblob']));
  note(`after two visits: ${JSON.stringify(after)}`);
  const holds = (l) => (l || []).some((e) => String(e).split('/')[0] === '127.0.0.1');
  assert(!holds(after.afp_csp_nc),
    `the stale connect-src entry retired itself (${JSON.stringify(after.afp_csp_nc)})`);
  assert(!holds(after.afp_csp_noblob),
    `and so did the blob-worker one (${JSON.stringify(after.afp_csp_noblob)})`);
  assert(healed.worker && typeof healed.worker === 'object',
    `the worker runs again (${typeof healed.worker === 'object' ? 'ok' : healed.worker})`);
  if (healed.worker && typeof healed.worker === 'object') {
    assert(String(healed.worker.cores) !== String(hostCores),
      `and it is patched (${healed.worker.cores} vs ${hostCores})`);
    for (const k of KEYS) {
      eq(String(healed.win[k]), String(healed.worker[k]),
        `window and worker agree on ${k} after the stale entry went (${healed.win[k]})`);
    }
  }
} finally {
  await ctx.close();
  server.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
}

done();
