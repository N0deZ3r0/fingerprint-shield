/**
 * CreepJS getClientLitter: every own window name a FRESH IFRAME does not have.
 *
 *   node test/clientlitter.mjs
 *
 * Verbatim from its built source — the collector creates an iframe, diffs
 * Object.getOwnPropertyNames(window) against the iframe's, and hashes the result into the
 * `code` value the page prints. Two things follow, and both were learned the hard way:
 *
 *   - NON-ENUMERABLE DOES NOT HIDE ANYTHING here. `__w0`/`__w1` were made non-enumerable
 *     to escape the other collector (getClientCode reads Object.keys), and this one caught
 *     them anyway: measured on abrahamjuliot.github.io, the list was ["0", "__w0", "__w1"].
 *   - What DOES cancel is anything the iframe has too. Our content scripts run in a blank
 *     iframe, so __p0/__t0/__r0/__s0 subtract out; the WASM pair was injected into the top
 *     frame only, which is exactly why it stood out.
 *
 * "0" is the probe's own iframe, indexed on window while it is still attached — every
 * browser reports it, with or without an extension, so it is the floor rather than a leak.
 * The control run proves that rather than assuming it.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';
const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

const PAGE = '<!doctype html><html><body><p>litter</p></body></html>';
const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/** getClientLitter(), as CreepJS ships it. */
function collect() {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const iframeWindow = iframe.contentWindow;
  const windowKeys = Object.getOwnPropertyNames(window);
  const iframeKeys = Object.getOwnPropertyNames(iframeWindow);
  document.body.removeChild(iframe);
  return windowKeys.filter((x) => !iframeKeys.includes(x));
}

async function run(withExt) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-litter-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: !headed,
    args: withExt ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  try {
    if (withExt) {
      try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch { /* up */ }
      await new Promise((r) => setTimeout(r, 3000));
    }
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    // WASM lands ~50ms in and the handover happens on its event; give both room, then read
    // the way the page would — late, after everything has settled.
    await new Promise((r) => setTimeout(r, 2500));
    return await p.evaluate(collect);
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
  }
}

const clean = await run(false);
const ours = await run(true);
server.close();

console.log('clean browser : ' + JSON.stringify(clean));
console.log('with extension: ' + JSON.stringify(ours));

const extra = ours.filter((k) => !clean.includes(k));
ok(extra.length === 0,
  `the extension adds nothing to the client-litter list (${extra.join(', ') || 'nothing'})`);
ok(!ours.includes('__w0') && !ours.includes('__w1'),
  'the WASM handover leaves no window property behind');
ok(clean.length > 0,
  `the control still reports the probe's own iframe, so the comparison is live (${JSON.stringify(clean)})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
