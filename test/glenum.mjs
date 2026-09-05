/**
 * getParameter with an enum the context does not have: ours against a clean browser.
 *
 *   node test/glenum.mjs            headless
 *   node test/glenum.mjs --headed   watch it
 *
 * Reported 2026-09-04 from hh.ru, filed under this extension's own errors:
 *
 *   WebGL: INVALID_ENUM: getParameter: invalid parameter name
 *   mw-bundle.js:4609 (orig) … 4537 (_wgParam) … 4615 (getParameter)
 *
 * The warning is the PAGE's: a fingerprinting script sweeps a list of pnames, several of
 * them WebGL2-only or extension-gated, and the driver refuses each one. A clean browser
 * prints exactly the same three lines for the same sweep — measured, this file — and the
 * only difference is the stack: Chrome charges a WebGL warning to the innermost script
 * frame, which is our wrapper rather than the page's script.
 *
 * IT IS LEFT THAT WAY ON PURPOSE, and this suite is what keeps it that way.
 *
 * Silencing it means not calling the driver — answering null from a table of pnames we
 * believe to be invalid. That is measurable, and it was measured before being rejected:
 *
 *     gl.getParameter(0x88FF)      clean null   ours null
 *     gl.getError()  after it      clean INVALID_ENUM   ours INVALID_ENUM
 *
 * The error flag is READABLE BY SCRIPT. A wrapper that skipped the driver would answer
 * NO_ERROR where every real browser answers INVALID_ENUM — trading a console line no
 * script can see for a one-line detector any script can run. The console attribution stays;
 * see README "Limits".
 *
 * So the property pinned here is "identical to clean where the driver refuses":
 *   - the same getError() after EVERY pname, refused or answered — the script-readable half;
 *   - the same value wherever the driver refused (null in both);
 *   - an answer, not null, wherever it did not — but NOT the same answer, because a pname
 *     the driver answers is exactly what this extension substitutes, and the CI runner's
 *     GPU-less MAX_TEXTURE_SIZE of 8192 against the profile's 16384 would make equality a
 *     false red rather than a finding;
 *   - the same NUMBER of WebGL console warnings (a suppression would drop it to zero, and
 *     that is the change this suite exists to catch).
 *
 * The pnames are the ones measured as refused on this engine with EVERY supported
 * extension enabled (so no page action can make them valid), plus the debug-renderer pair,
 * which a fingerprinter reads by its numeric value without enabling the extension — the
 * exact shape hh.ru has.
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
const eq = (a, b, m) => ok(a === b, `${m}\n      ours  ${JSON.stringify(a)}\n      clean ${JSON.stringify(b)}`);

// [measured 2026-09-04] refused on webgl even with all 35 extensions enabled; the last two
// are refused until WEBGL_debug_renderer_info is enabled, and 0x0D33/0x1F00 are controls
// that must keep answering.
const PNAMES = [0x88FF, 0x8D57, 0x8073, 0x8905, 0x8A31, 0x8B48, 0x9122, 0x9630,
  0x9245, 0x9246, 0x0D33, 0x1F00];

const PAGE = `<!doctype html><meta charset="utf-8"><body><script>
window.__r = (function () {
  var out = {};
  ['webgl', 'webgl2'].forEach(function (kind) {
    var gl = document.createElement('canvas').getContext(kind);
    if (!gl) { out[kind] = 'no context'; return; }
    var rows = {};
    PNAMES.forEach(function (p) {
      while (gl.getError() !== gl.NO_ERROR) { /* drain */ }
      var v;
      try { v = String(gl.getParameter(p)); } catch (e) { v = 'THREW ' + e.name; }
      var e2 = gl.getError();
      rows['0x' + p.toString(16).toUpperCase()] = v + ' | err=' + e2;
    });
    out[kind] = rows;
  });
  return out;
})();
<\/script>`;

const server = createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    .end(PAGE.replace('PNAMES', JSON.stringify(PNAMES)));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

async function measure(withExt) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-glenum-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !headed,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: withExt ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  try {
    if (withExt) {
      try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch (e) {}
      await new Promise((r) => setTimeout(r, 1500));   // onInstalled → initDefaults
    }
    const p = await ctx.newPage();
    const warnings = [];
    p.on('console', (m) => {
      if (!/INVALID_ENUM/.test(m.text())) return;
      const loc = m.location() || {};
      warnings.push(/^chrome-extension:/.test(String(loc.url || '')) ? 'extension' : 'page');
    });
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1000));
    return { rows: await p.evaluate('window.__r'), warnings };
  } finally {
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const clean = await measure(false);
const ours = await measure(true);
server.close();

for (const kind of ['webgl', 'webgl2']) {
  console.log(`\n=== ${kind} ===`);
  const c = clean.rows[kind], o = ours.rows[kind];
  if (typeof c !== 'object' || typeof o !== 'object') {
    ok(String(c) === String(o), `${kind}: both browsers agree there is no context (${c} / ${o})`);
    continue;
  }
  for (const p of Object.keys(c)) {
    console.log(`  ${p.padEnd(8)} clean ${String(c[p]).padEnd(28)} ours ${o[p]}`);
  }
  // The ERROR FLAG must match everywhere: that is the script-readable half, and the one
  // a suppression would break. The VALUE must match only where the driver refused — a
  // pname it answers is exactly what this extension is here to substitute, and on a
  // machine whose real limit differs from the profile's (the CI runner has no GPU and
  // reports MAX_TEXTURE_SIZE 8192 against the profile's 16384) demanding equality there
  // would be a false red rather than a finding.
  for (const p of Object.keys(c)) {
    const cErr = String(c[p]).split('err=')[1], oErr = String(o[p]).split('err=')[1];
    eq(oErr, cErr, `${kind} ${p}: the same getError() as a clean browser`);
    if (cErr !== '0') {
      eq(o[p], c[p], `${kind} ${p}: refused by the driver in both, with the same value`);
    } else {
      ok(String(o[p]).split(' | ')[0] !== 'null',
        `${kind} ${p}: answered in both (clean ${String(c[p]).split(' | ')[0]}, ours ${String(o[p]).split(' | ')[0]})`);
    }
  }
}

console.log(`\nINVALID_ENUM console warnings — clean ${clean.warnings.length} (${[...new Set(clean.warnings)].join(',') || 'none'}), ` +
  `ours ${ours.warnings.length} (${[...new Set(ours.warnings)].join(',') || 'none'})`);
ok(clean.warnings.length > 0, `the sweep really does make a clean browser warn (${clean.warnings.length})`);
eq(ours.warnings.length, clean.warnings.length,
  'the same NUMBER of warnings as clean — neither added nor suppressed');
// And the documented residual, asserted rather than described: they are charged to us.
// If this ever stops being true the fix is welcome, but it must not have cost the error
// flag above — that is what the rows already pinned.
ok(ours.warnings.every((w) => w === 'extension'),
  `and Chrome charges them to the innermost script frame, which is ours — the documented residual (${[...new Set(ours.warnings)].join(',')})`);
ok(clean.warnings.every((w) => w === 'page'),
  'while a clean browser charges them to the page that asked');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
