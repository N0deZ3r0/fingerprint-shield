/**
 * Do the three scripts README.txt tells users to paste actually PASS against the real
 * extension?
 *
 *   node test/consolechecks.mjs             headless
 *   node test/consolechecks.mjs --headed    watch it
 *
 * dev-consolechecks.html already fetches all three, runs them, and fails if one throws or
 * emits no rows. That is a load test, not a verdict test — it cannot tell a green run from
 * a red one, and the gap has now cost four separate rots, every one of them reporting FAIL
 * on a CORRECT build:
 *
 *   chrome.runtime         demanded the stub [FIX we-invented-a-chrome-runtime] deleted
 *   mode / feature flags   demanded v.ui.m / v.ui.f, which a default install stopped
 *                          writing ([FIX default-config-still-left-two-keys])
 *   WebGL parity           read the UNMASKED_* enums without enabling
 *                          WEBGL_debug_renderer_info — see below
 *
 * A self-check that cries wolf is worse than none: the user cannot tell which red line
 * matters, and a real regression hides among the false ones. So this asserts the verdict.
 *
 * IT ALSO WATCHES THE CONSOLE, which is the half a row count cannot see. The WebGL rot
 * produced four copies of
 *
 *   WebGL: INVALID_ENUM: getParameter: invalid parameter name,
 *   WEBGL_debug_renderer_info not enabled
 *
 * and Chrome attributed them to mw-bundle.js, because the extension's getParameter wrapper
 * is what called the driver. So a diagnostic script we ship made the extension look like it
 * was throwing WebGL errors on the user's own page — while the parity row it belonged to
 * silently compared null against null. Both halves are asserted here.
 *
 * The scripts are evaluated from disk rather than served, so this measures exactly what
 * ships.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';
const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('  FAIL:', m); failed++; } };

const SCRIPTS = ['afp-console-check.js', 'afp-full-console-check.js', 'afp-parity-console.js'];

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
   .end('<!doctype html><meta charset=utf-8><title>selfcheck</title><body><p>ok'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const userDataDir = mkdtempSync(join(tmpdir(), 'afp-cc-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

const results = {};
try {
  await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await ctx.grantPermissions(['geolocation'], { origin: `http://127.0.0.1:${port}` });

  for (const file of SCRIPTS) {
    const page = await ctx.newPage();
    const console_ = [];
    page.on('console', (m) => console_.push(m.text()));
    page.on('pageerror', (e) => console_.push('PAGEERROR ' + String(e && e.message)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    // Each script reports through console.table; capture the rows as data.
    await page.evaluate(() => {
      window.__rows = [];
      const t = console.table.bind(console);
      console.table = (d) => { try { window.__rows.push(...d); } catch (e) {} return t(d); };
    });
    await page.evaluate(readFileSync(join(root, file), 'utf8'));
    // The full check builds workers and awaits blobs; give it room to finish.
    await new Promise((r) => setTimeout(r, 5000));
    const rows = await page.evaluate(() => window.__rows.map((r) => JSON.parse(JSON.stringify(r))));
    results[file] = { rows, console: console_ };
    await page.close();
  }
} finally {
  await ctx.close();
  server.close();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
}

const isFail = (r) => /(^|")FAIL("|$)/i.test(JSON.stringify(r));

for (const file of SCRIPTS) {
  const { rows, console: msgs } = results[file];
  const bad = rows.filter(isFail);
  console.log(`\n=== ${file} — ${rows.length} rows, ${bad.length} FAIL`);
  bad.slice(0, 10).forEach((r) => console.log('    !', JSON.stringify(r)));

  // A verdict of "0 failures" is only worth something if the script actually ran. The two
  // short ones produce ~20 rows and the full one ~70; anything near zero means it bailed.
  ok(rows.length >= 5,
    `${file}: produced rows to judge (${rows.length}) — 0 failures is meaningless without them`);
  ok(bad.length === 0,
    `${file}: every probe passes against the real extension` +
    (bad.length ? ` — ${bad.map((r) => (r.check || r.name)).join('; ')}` : ''));

  // The console half. A self-check must not make the extension look like it is failing.
  const gl = msgs.filter((m) => /INVALID_ENUM|WEBGL_debug_renderer_info/i.test(m));
  ok(gl.length === 0,
    `${file}: emits no WebGL INVALID_ENUM warnings` +
    (gl.length ? ` — ${gl.length}x "${gl[0].slice(0, 80)}"` : ''));
  const named = msgs.filter((m) => m.indexOf('chrome-extension://') !== -1);
  ok(named.length === 0,
    `${file}: nothing it prints names chrome-extension://` +
    (named.length ? ` — ${named[0].slice(0, 90)}` : ''));
  const errs = msgs.filter((m) => m.startsWith('PAGEERROR'));
  ok(errs.length === 0, `${file}: raises no uncaught page error (${errs[0] || 'none'})`);
}

// The specific row the WebGL rot hid behind: it reported "all match" while both sides read
// null for the two enums that actually identify the GPU. Pin that it is comparing something.
{
  const rows = results['afp-full-console-check.js'].rows;
  const parity = rows.find((r) => /WebGL getParameter/.test(String(r.check || '')));
  ok(!!parity, 'the full check still has a window/worker WebGL getParameter parity row');
  if (parity) {
    const detail = String(parity.detail || '');
    // Not "did it match" — "did it compare anything". With the extension unenabled both
    // sides answered null and the row was green while checking nothing, so the assertion
    // has to be about the VALUES. An ANGLE renderer string is what a resolved UNMASKED
    // read looks like on this rig; null / n/a / ERR are the three ways it can be hollow.
    ok(/ANGLE/.test(detail),
      `the parity row actually resolved the UNMASKED enums — it reports what it compared ` +
      `(detail: ${detail.slice(0, 120)})`);
    ok(!/\bnull\b|n\/a|ERR/.test(detail),
      `no enum in the parity row came back hollow (detail: ${detail.slice(0, 120)})`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
