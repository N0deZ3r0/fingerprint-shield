/**
 * OUR TRUSTED-TYPES POLICY IN A CROSS-ORIGIN FRAME ON A REWRITTEN ORIGIN.
 *
 *   node test/ttpolicy.mjs
 *
 * The shape no other suite builds, and the one the deferred seed fix turns on. A full
 * 52-suite run is green with the noise seed keyed on the frame OR on the top site, which
 * means nothing here covers it rather than that it is safe — measured 2026-09-06.
 *
 * Top document on 127.0.0.1; frame from localhost, a different origin, carrying what the
 * per-site rewrite writes for THAT host:
 *
 *     require-trusted-types-for 'script'; trusted-types pagepolicy <ourNameFor(localhost)>
 *
 * The frame mints "pagepolicy" as a real site does, wraps a blob URL with it and builds a
 * worker. Our wrapper intercepts, and to wrap that worker it must mint ITS OWN policy — the
 * name derived from the seed. Keyed on the document own host it is on the allowlist and the
 * mint succeeds; keyed on the top site it is not, and Chrome refuses it.
 *
 * THE OBSERVABLE IS THE WORKER ANSWER, not a log line: a patched worker reports the profile,
 * an unpatched one reports the machine. Measured both ways:
 *
 *     seed on the frame own host    frame window 8   frame WORKER 8    no violation
 *     seed on the top site          frame window 8   frame WORKER 18   VIOLATION naming us
 *
 * TWO EARLIER VERSIONS OF THIS PROBE WERE INVALID and both mistakes are kept in mind here:
 * it first served a policy name from a CONSTANT master seed while the extension mints from
 * a random one (neither arm matched, both stood down, and the arms agreed for a reason
 * unrelated to the question); then it allowed ONLY our name on the header, so the page
 * could mint nothing, build no worker, and never reach our wrapper at all. A real rewritten
 * header APPENDS our name to the site own allowlist, which is what this one does.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

let portTop = 0, portFrame = 0, allowedName = null;

const FRAME = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
var out = { cores: String(navigator.hardwareConcurrency), worker: 'pending' };
try { out.tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { out.tz = 'THREW'; }
// What a real site on a trusted-types origin does: mint its OWN policy, then use it.
var pol = null;
try { pol = trustedTypes.createPolicy('pagepolicy', { createScriptURL: function (u) { return u; } }); }
catch (e) { out.pagePolicy = 'THREW:' + e.name; }
if (pol) out.pagePolicy = 'minted';
try {
  var u = URL.createObjectURL(new Blob(['onmessage=function(){postMessage(navigator.hardwareConcurrency)}'],
    { type: 'text/javascript' }));
  var w = new Worker(pol ? pol.createScriptURL(u) : u);
  out.worker = 'constructed';
  w.onmessage = function (e) { out.workerCores = String(e.data); send(); };
  w.onerror = function (e) { out.worker = 'error:' + (e && e.message ? e.message : '(empty)'); send(); };
  w.postMessage(1);
} catch (e) { out.worker = 'threw:' + e.name; }
function send() { try { parent.postMessage(out, '*'); } catch (e) {} }
setTimeout(send, 2500);
</` + `script></body></html>`;

const TOP = () => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
window.__run = new Promise(function (done) {
  addEventListener('message', function (e) { if (e.data && 'cores' in e.data) done(e.data); });
  var f = document.createElement('iframe');
  f.src = 'http://localhost:${portFrame}/frame';
  f.style.display = 'none';
  document.body.appendChild(f);
  setTimeout(function () { done({ cores: 'TIMEOUT' }); }, 10000);
});
</` + `script></body></html>`;

const serverFrame = createServer((q, r) => {
  const h = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  // The site's own name FIRST, ours appended — which is what afpRewriteCsp does.
  if (allowedName) {
    h['Content-Security-Policy'] =
      `require-trusted-types-for 'script'; trusted-types pagepolicy ${allowedName}`;
  }
  r.writeHead(200, h).end(FRAME);
});
await new Promise((r) => serverFrame.listen(0, '127.0.0.1', r));
portFrame = serverFrame.address().port;
const serverTop = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(TOP()));
await new Promise((r) => serverTop.listen(0, '127.0.0.1', r));
portTop = serverTop.address().port;

const dir = mkdtempSync(join(tmpdir(), 'afp-tt-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: true,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  const hostCores = await sw.evaluate(() => String(navigator.hardwareConcurrency));
  const names = await sw.evaluate(async () => ({
    frame: await afpTtPolicyNameFor('localhost'),
    top: await afpTtPolicyNameFor('127.0.0.1')
  }));
  allowedName = names.frame;
  console.log(`this machine has ${hostCores} cores`);
  console.log(`policy name for the FRAME host (localhost): ${names.frame}   <- on the header`);
  console.log(`policy name for the TOP host (127.0.0.1):   ${names.top}\n`);

  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 130)); });
  await p.goto(`http://127.0.0.1:${portTop}/`, { waitUntil: 'load' });
  const got = await p.evaluate(() => window.__run);
  const top = await p.evaluate(() => ({
    cores: String(navigator.hardwareConcurrency),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone
  }));
  console.log('TOP    ' + JSON.stringify(top));
  console.log('FRAME  ' + JSON.stringify(got));
  console.log('console errors: ' + (errs.slice(0, 4).join(' | ') || 'none'));

  // ── the fixture is live ────────────────────────────────────────────────────
  // Every assertion below is about what happens INSIDE this shape, so the shape has to
  // exist first. Both of these were silently false in earlier versions of the probe, and
  // each time the two arms agreed for a reason that had nothing to do with the question.
  ok(got.pagePolicy === 'minted',
    `the frame's own trusted-types policy was minted (${got.pagePolicy}) — without it the ` +
    'page builds no worker and our wrapper is never reached');
  ok(got.worker === 'constructed',
    `and the worker was constructed through it (${got.worker})`);
  ok(String(top.cores) !== String(hostCores),
    `the top window presents the profile rather than the machine (${top.cores} vs ${hostCores})`);

  // ── the frame ──────────────────────────────────────────────────────────────
  ok(String(got.cores) === String(top.cores),
    `the frame's window agrees with the top window (${got.cores} vs ${top.cores})`);
  ok(got.workerCores !== undefined,
    'the frame\'s worker answered at all — a scope that cannot be read is a free pass');
  ok(String(got.workerCores) !== String(hostCores),
    `the frame's WORKER is patched (${got.workerCores}) rather than reading the machine ` +
    `(${hostCores}) — this is the value that moves when the noise seed is keyed on the top ` +
    'site instead of the frame\'s own host');
  ok(String(got.workerCores) === String(got.cores),
    `and it agrees with the window beside it (${got.workerCores} vs ${got.cores}) — a split ` +
    'here is the class the third worker gate closed');

  // ── and nothing named us on the way ────────────────────────────────────────
  // A refused mint is not silent: Chrome prints a violation carrying the policy NAME, which
  // is a channel of its own. The failing arm produced exactly this line.
  const named = errs.filter((e) => /TrustedTypePolicy/.test(e));
  ok(named.length === 0,
    `no Trusted-Types violation was reported (${named.join(' | ') || 'none'})`);
} finally {
  await ctx.close();
  serverTop.close(); serverFrame.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
