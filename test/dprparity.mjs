/**
 * DOES matchMedia AGREE WITH THE CSS ENGINE ABOUT THE PIXEL RATIO?
 *
 *   node test/dprparity.mjs [ratio]
 *
 * The rig runs at ratio 1, where a profile claiming 1 cannot contradict anything — which is
 * why this went unseen. The author's machine is 1.53, and there the audit page reported
 * `(-webkit-min-device-pixel-ratio: 1.5)` and `(min-resolution: 1.5dppx)` answering one way
 * from matchMedia and the other from the engine.
 *
 * The engine's answer is read the only way a page can read it: a @media rule that changes a
 * property, then getComputedStyle. That is also exactly how a detector reads it.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BROWSER, root, bootSettled } from './harness.mjs';

const RATIO = Number(process.argv[2] || 1.53);

const PAGE = `<!doctype html><title>dpr</title>
<style>
  #probe { color: rgb(1, 1, 1); }
  @media (min-resolution: 1.5dppx) { #probe { color: rgb(2, 2, 2); } }
  @media (-webkit-min-device-pixel-ratio: 1.5) { #probe { color: rgb(3, 3, 3); } }
</style>
<div id="probe">x</div>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

async function read(withExt) {
  const dir = mkdtempSync(path.join(tmpdir(), 'afp-dpr-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: true, deviceScaleFactor: RATIO,
    args: withExt ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  try {
    if (withExt) {
      ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await bootSettled(ctx);
    }
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'load' });
    return await p.evaluate(() => ({
      dpr: window.devicePixelRatio,
      mmRes: matchMedia('(min-resolution: 1.5dppx)').matches,
      mmWk: matchMedia('(-webkit-min-device-pixel-ratio: 1.5)').matches,
      // What the ENGINE decided, which no extension can reach.
      css: getComputedStyle(document.getElementById('probe')).color
    }));
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
  }
}

const clean = await read(false);
const ours = await read(true);
const engineSaysHigh = (r) => r.css === 'rgb(3, 3, 3)' || r.css === 'rgb(2, 2, 2)';

console.log(`device scale factor ${RATIO}\n`);
for (const [name, r] of [['clean', clean], ['ours', ours]]) {
  console.log(`  ${name.padEnd(6)} dpr=${String(r.dpr).padEnd(20)} matchMedia res=${String(r.mmRes).padEnd(5)} ` +
    `wk=${String(r.mmWk).padEnd(5)} engine=${r.css} (${engineSaysHigh(r) ? 'high-dpi' : 'not high-dpi'})`);
}

const disagrees = (r) => r.mmRes !== engineSaysHigh(r) || r.mmWk !== engineSaysHigh(r);
console.log('');
console.log(`  clean disagrees with its own engine: ${disagrees(clean)}`);
console.log(`  ours  disagrees with its own engine: ${disagrees(ours)}`);
console.log(disagrees(ours) && !disagrees(clean)
  ? '\nSTILL REFUTABLE: a page reads matchMedia and one @media rule and has the contradiction.'
  : '\nno contradiction a page can read here.');

server.close();
process.exit(disagrees(ours) && !disagrees(clean) ? 1 : 0);
