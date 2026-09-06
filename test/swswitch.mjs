/**
 * The per-site service-worker switch.
 *
 *   node test/swswitch.mjs
 *
 * A site's own service worker reads the REAL machine — measured, window against SW on one
 * page: 16 cores against 18, Europe/Berlin against Europe/Moscow, a spoofed RTX 3070
 * against the host's Intel Arc — and no MV3 extension can patch that scope: blob: scripts
 * are refused, script redirects are disallowed, content scripts never run there, and Chrome
 * cannot rewrite a response body. The platform closes the third-party case on its own (the
 * script must be same-origin, so a tracker cannot ship one), which leaves the site's OWN
 * worker, and the only lever left is allow or deny.
 *
 * So this suite is about the switch behaving like a switch. Four things have to hold, and
 * the last two are the ones that would rot silently:
 *   - default is ALLOW, because denying by default takes offline mode and push with it;
 *   - a blocked host is refused in the browser's own shape (see test/stackleak.mjs for the
 *     shape itself), and the refusal reaches a page that registers in its first script,
 *     which is why sw-off.js is a document_start content script and not a profile flag;
 *   - a worker the site installed BEFORE the switch was flipped is gone — refusing new
 *     registrations while the old one keeps answering would be protection on paper only;
 *   - the neighbouring host is untouched, which is what makes it per-site at all.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root as ROOT, bootSettled } from './harness.mjs';
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

const SW = 'self.addEventListener("install", function () {}); self.addEventListener("message", function (e) { e.source.postMessage("alive"); });';
const PAGE = `<!doctype html><html><body><script>
window.__try = async function () {
  const out = { marker: !!window.__s0 };
  try { out.before = (await navigator.serviceWorker.getRegistrations()).length; } catch (e) { out.before = 'ERR'; }
  try {
    const r = await navigator.serviceWorker.register('/plain-sw.js');
    out.register = 'OK';
    try { await r.unregister(); } catch (e) {}
  } catch (e) {
    out.register = e.name + '/' + e.code + ' :: ' + String(e.message).slice(-52);
  }
  return out;
};
window.__install = async function () {
  try { await navigator.serviceWorker.register('/plain-sw.js'); await navigator.serviceWorker.ready; return 'installed'; }
  catch (e) { return e.name; }
};
window.__count = async function () {
  try { return (await navigator.serviceWorker.getRegistrations()).length; } catch (e) { return 'ERR'; }
};
</script></body></html>`;

const server = createServer((q, r) => {
  const u = (q.url || '/').split('?')[0];
  if (u === '/plain-sw.js') { r.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(SW); return; }
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const dir = mkdtempSync(join(tmpdir(), 'afp-swswitch-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: true,
  args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT]
});
const bg = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
  await ctx.waitForEvent('serviceworker', { timeout: 20000 });
await bootSettled(ctx);

const setBlocked = async (list) => {
  await bg.evaluate(async (l) => { await chrome.storage.local.set({ afp_sw_blocked: l }); }, list);
  await new Promise((r) => setTimeout(r, 2500));
};
const visit = async (host, fn) => {
  const p = await ctx.newPage();
  await p.goto(`http://${host}:${port}/`, { waitUntil: 'load' });
  const v = await p.evaluate(fn);
  await p.close();
  return v;
};

const dflt = await visit('127.0.0.1', () => window.__try());
console.log('default            : ' + JSON.stringify(dflt));
ok(dflt.register === 'OK', `default is ALLOW — a site's own worker registers (${dflt.register})`);
ok(dflt.marker === false, 'no marker on a host that was never blocked');

console.log('site installs one  : ' + await visit('127.0.0.1', () => window.__install()));
const installed = await visit('127.0.0.1', () => window.__count());
console.log('registrations      : ' + installed);
ok(installed === 1, `the site really had a worker before the switch was flipped (${installed})`);

await setBlocked(['127.0.0.1']);
const blocked = await visit('127.0.0.1', () => window.__try());
console.log('blocked            : ' + JSON.stringify(blocked));
ok(blocked.marker === true, 'the document_start marker is present on a blocked host');
ok(/NotSupportedError/.test(blocked.register),
  `a blocked host is refused, in the browser's own shape (${blocked.register})`);
ok(blocked.before === 0,
  `the worker installed earlier is already gone when the page's first script runs (${blocked.before})`);

const neighbour = await visit('localhost', () => window.__try());
console.log('neighbour host     : ' + JSON.stringify(neighbour));
ok(neighbour.register === 'OK' && neighbour.marker === false,
  `blocking one host leaves the next one alone (${neighbour.register})`);

await setBlocked([]);
const again = await visit('127.0.0.1', () => window.__try());
console.log('unblocked again    : ' + JSON.stringify(again));
ok(again.register === 'OK' && again.marker === false, `unblocking restores it (${again.register})`);

await ctx.close();
server.close();
try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }

console.log(`
${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
