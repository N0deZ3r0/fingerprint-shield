/**
 * DOES THE GENERIC FONT PIN REACH RENDERING?
 *
 *   node test/fontpin.mjs --headed    the only run that proves anything
 *   node test/fontpin.mjs             API check only; the rendering half is skipped
 *
 * Standalone, NOT in test/all.mjs, because the thing it verifies cannot be verified
 * headless — and that is the whole reason this file exists as its own suite.
 *
 * background.js pins the browser's fixed-width generic to Consolas through
 * chrome.fontSettings, so that the CSS generic `monospace` resolves to the same face on
 * every machine. Two Windows boxes on the same browser disagreed about it (Courier New vs
 * Consolas) and that difference survives every profile change, which is what made it worth
 * closing.
 *
 * **HEADLESS CHROMIUM IGNORES THE PREFERENCE FOR RENDERING.** Measured both ways on one
 * machine, one build:
 *
 *            monospace   Consolas    Courier New
 *   headless 489.6875    448.640625  489.6875     -> resolves to Courier New
 *   headed   448.64175   448.64175   489.68549    -> resolves to Consolas
 *
 * The API reports success in BOTH — getFont returns Consolas with levelOfControl
 * "controlled_by_this_extension" either way. So a headless check of the preference passes
 * against a build where rendering never changed, and a headless check of the RENDERING
 * fails against a build that is perfectly correct. Neither is worth anything on its own;
 * this suite asserts the API in both modes and the rendering only where it can mean
 * something.
 */
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, bootSettled } from './harness.mjs';
const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

const dir = mkdtempSync(join(tmpdir(), 'afp-fontpin-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(sw);

  const api = await sw.evaluate(async () => {
    const r = { hasApi: !!(globalThis.chrome && chrome.fontSettings) };
    if (!r.hasApi) return r;
    try { r.font = await chrome.fontSettings.getFont({ genericFamily: 'fixed' }); }
    catch (e) { r.err = String(e); }
    return r;
  });
  ok(api.hasApi, 'chrome.fontSettings is available (the fontSettings permission is in the manifest)');
  ok(api.font && api.font.fontId === 'Consolas',
    `the fixed-width generic is pinned to Consolas (got ${api.font && api.font.fontId})`);
  ok(api.font && api.font.levelOfControl === 'controlled_by_this_extension',
    `and this extension is the one controlling it (got ${api.font && api.font.levelOfControl})`);

  const page = await ctx.newPage();
  await page.setContent('<!doctype html><meta charset=utf-8><body></body>');
  await new Promise((r) => setTimeout(r, 400));
  const m = await page.evaluate(() => {
    function w(fam) {
      const s = document.createElement('span');
      s.textContent = 'mmMwWLliI0fiflO&1';
      s.style.cssText = 'position:absolute;left:-9999px;font-size:48px;white-space:nowrap';
      s.style.fontFamily = fam;
      document.body.appendChild(s);
      const v = s.getBoundingClientRect().width;
      document.body.removeChild(s);
      return v;
    }
    return { monospace: w('monospace'), consolas: w("'Consolas'"), courier: w("'Courier New'") };
  });
  console.log(`\n  monospace ${m.monospace}   Consolas ${m.consolas}   Courier New ${m.courier}`);

  // Both faces have to be present, or "resolves to Consolas" would be unfalsifiable.
  ok(Math.abs(m.consolas - m.courier) > 1,
    'Consolas and Courier New measure differently, so the comparison below can fail');

  if (headed) {
    ok(Math.abs(m.monospace - m.consolas) < 1,
      `the CSS generic monospace renders as Consolas (${m.monospace} vs Consolas ${m.consolas}, ` +
      `Courier New ${m.courier})`);
  } else {
    console.log('  (rendering not asserted: headless ignores the font preference — run with --headed)');
  }
} finally {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
