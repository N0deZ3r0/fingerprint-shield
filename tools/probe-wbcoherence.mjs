/**
 * DOES THE COHERENT STAND-DOWN EVER FIRE?
 *
 * Two origin shapes leave a worker unpatchable, and mw-core's gate reads a sessionStorage
 * key for each. Both keys are written after the MAIN bundle has already computed its
 * feature set, so this asks the question by measurement rather than by reading the gate.
 *
 *   /wb/  worker-src 'self'                      blob: workers refused
 *   /tt/  trusted-types page-policy (+require)   only the PAGE may mint a policy
 *
 *   node tools/probe-wbcoherence.mjs [--headed]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, BROWSER } from '../test/harness.mjs';

const headed = process.argv.includes('--headed');
const EXT = process.env.FPS_EXT_ROOT ? path.resolve(process.env.FPS_EXT_ROOT) : root;

const READ = '({cores:navigator.hardwareConcurrency,memory:navigator.deviceMemory,' +
  'tz:Intl.DateTimeFormat().resolvedOptions().timeZone,lang:navigator.language})';
const WORKER_JS = `self.onmessage=()=>postMessage(${READ});\n`;

// /wb/ builds the worker from its own URL; /tt/ must mint a TrustedScriptURL first, which
// is the whole point of that fixture — the page can, we cannot.
const page = (mkUrl) => `<!doctype html><html><head><meta charset="utf-8"><title>probe</title>
<script>
window.__flags = (function(){try{return {wb:sessionStorage.getItem('v.ui.wb'),
  tt:sessionStorage.getItem('v.ui.tt'),tte:sessionStorage.getItem('v.ui.tte')};}
  catch(e){return 'THREW';}})();
window.__w = new Promise(function (res) {
  var d = false, f = function (v) { if (!d) { d = true; res(v); } };
  try {
    var w = new Worker(${mkUrl});
    w.onmessage = function (e) { f(e.data); };
    w.onerror = function (e) { f('error:' + (e && e.message ? e.message : '(empty)')); };
    w.postMessage(1);
  } catch (e) { f('threw:' + (e && e.name) + ':' + (e && e.message)); }
  setTimeout(function () { f('timeout'); }, 5000);
});
</script></head><body>probe</body></html>`;

const FIXTURES = {
  '/wb/': {
    csp: "worker-src 'self'",
    html: page("'/worker.js'"),
    why: "blob: workers refused — _isBlobBlocked() hands the native ctors back",
  },
  '/tt/': {
    csp: "require-trusted-types-for 'script'; trusted-types page-policy",
    html: page("trustedTypes.createPolicy('page-policy',{createScriptURL:function(s){return s;}}).createScriptURL('/worker.js')"),
    why: "only the name `page-policy` may be minted — ours cannot be",
  },
};

const server = createServer((q, r) => {
  if (q.url.includes('/worker.js')) {
    return r.writeHead(200, { 'content-type': 'application/javascript' }).end(WORKER_JS);
  }
  const key = Object.keys(FIXTURES).find((k) => q.url.startsWith(k)) || '/wb/';
  r.writeHead(200, {
    'content-type': 'text/html', 'cache-control': 'no-store',
    'content-security-policy': FIXTURES[key].csp,
  }).end(FIXTURES[key].html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const dir = mkdtempSync(path.join(tmpdir(), 'afp-wb-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await (ctx.serviceWorkers()[0] || ctx.waitForEvent('serviceworker', { timeout: 20000 }));
await new Promise((r) => setTimeout(r, 2000));

for (const [key, fx] of Object.entries(FIXTURES)) {
  console.log(`\n=== ${key}  ${fx.why}`);
  console.log(`    ${fx.csp}`);
  for (const visit of [1, 2, 3]) {
    const p = await ctx.newPage();
    await p.goto(`${BASE}${key}?v=${visit}`, { waitUntil: 'load' });
    const worker = await p.evaluate('window.__w');
    const win = await p.evaluate(READ);
    const early = await p.evaluate('window.__flags');
    console.log(`  visit ${visit}  flags at the page's first script ${JSON.stringify(early)}`);
    console.log(`    window ${JSON.stringify(win)}`);
    console.log(`    worker ${typeof worker === 'object' ? JSON.stringify(worker) : worker}`);
    if (worker && typeof worker === 'object') {
      const off = ['cores', 'memory', 'tz', 'lang']
        .filter((k) => String(worker[k]) !== String(win[k]));
      console.log(off.length ? `    >>> SPLIT on ${off.join(', ')}` : '    coherent');
    }
    await p.close();
  }
}
await ctx.close();
try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
server.close();
