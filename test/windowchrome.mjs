/**
 * The window chrome the profile implies must be a height a real browser produces.
 *
 *   node test/windowchrome.mjs             headless, forced large window
 *   node test/windowchrome.mjs --headed    watch it
 *
 * When the real window is taller than the screen the profile claims, mw-timezone-screen
 * clamps both edges: outerHeight down to the claimed available height, innerHeight to
 * that minus _CHROME_H. The difference between the two is then entirely ours - it is the
 * browser chrome we are asserting the user has.
 *
 * That constant was 85, and measured on this machine in a real window with a fresh profile
 * (no bookmarks bar, which is Chrome's default) both browsers said 95:
 *
 *     Google Chrome 151.0.7922.138   outerHeight - innerHeight = 95
 *     bundled Chromium 151           95
 *     this build, before             85
 *
 * 85 is a number no browser here produces. It hid nothing extra - the value is a constant
 * either way - so it was a tell for free, which is the worst kind.
 *
 * WHY THIS NEEDS A FORCED WINDOW. The clamp only runs when the real window exceeds the
 * claimed screen. A default Playwright viewport is far smaller than the claimed 1080, so
 * nothing clamps, our getters return the honest numbers, and clean and patched agree
 * perfectly - green, and blind to the whole question. So the window is forced taller than
 * the claimed screen, the only state where the constant is observable at all.
 *
 * WHY --headed IS THE RUN THAT COUNTS, the same way test/fontpin.mjs works. A headless
 * browser has no window manager and invents its own frame: measured here with the window
 * forced to 1200x1400, a CLEAN headless Chromium reports a chrome height of 98, while the
 * same clean browser in a real window reports 95. So the headless control is an artifact,
 * and asserting against it would pin the constant to a number no user has - which is the
 * exact defect this file exists to catch. Headless therefore checks only what survives
 * headless (the clamp is coherent, nothing impossible is reported) and says out loud that
 * it is not judging the height; --headed compares ours against a real browser's.
 *
 * THE CONTROL. Under --headed a clean browser is launched with the same forced window and
 * the assertion is that ours EQUALS its chrome height. Writing 95 into the assertion
 * instead would just be the old constant with a nicer number - the value has to come from
 * a browser, so that a future Chrome which changes its frame is reported rather than
 * silently enshrined.
 *
 * NOTE ON REAL CHROME. --load-extension is ignored by Chrome 136 and later (verified again
 * here on 151.0.7922.138: no service worker appears and every value stays clean), so the
 * extension side can only be exercised on Chromium. That is sound for this measurement
 * because both browsers were measured side by side on this machine, in a real window, and
 * both reported 95.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, bootSettled } from './harness.mjs';
const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };
const eq = (got, want, m) =>
  ok(Object.is(got, want), `${m} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// Taller than the 1080 every profile claims, so the clamp is guaranteed to run.
const WINDOW = '--window-size=1200,1400';

const PAGE = `<!doctype html><html><body><script>
window.__p = () => ({
  outerW: outerWidth, outerH: outerHeight, innerW: innerWidth, innerH: innerHeight,
  dW: outerWidth - innerWidth, dH: outerHeight - innerHeight,
  screenW: screen.width, screenH: screen.height,
  availW: screen.availWidth, availH: screen.availHeight
});
</script></body></html>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

async function read(withExt) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-wc-'));
  const args = [WINDOW];
  if (withExt) args.push(`--disable-extensions-except=${root}`, `--load-extension=${root}`);
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: !headed, viewport: null, args
  });
  try {
    if (withExt) {
      try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch { /* up */ }
      await bootSettled(ctx);
    }
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    return await page.evaluate(() => window.__p());
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
  }
}

try {
  const clean = await read(false);
  const ext = await read(true);

  console.log(`clean : chrome ${clean.dW}x${clean.dH}   outer ${clean.outerW}x${clean.outerH}` +
    `   inner ${clean.innerW}x${clean.innerH}   screen ${clean.screenW}x${clean.screenH}`);
  console.log(`ext   : chrome ${ext.dW}x${ext.dH}   outer ${ext.outerW}x${ext.outerH}` +
    `   inner ${ext.innerW}x${ext.innerH}   screen ${ext.screenW}x${ext.screenH}`);

  // The rig has to actually be in the clamped state, or nothing below means anything.
  ok(clean.innerH > ext.screenH,
    `the forced window is taller than the claimed screen (real inner ${clean.innerH} vs claimed ` +
    `screen ${ext.screenH}) — otherwise the clamp never runs and this suite proves nothing`);
  ok(ext.outerH <= ext.availH,
    `outerHeight (${ext.outerH}) fits the claimed available height (${ext.availH})`);
  ok(ext.outerH !== ext.screenH,
    `outerHeight (${ext.outerH}) is not the full claimed screen height (${ext.screenH}) — ` +
    'CreepJS reads that pair as a lie');

  // The point of the suite — and only a real window can judge it. See the header: a clean
  // headless browser invents a 98px frame where the same browser on screen has 95.
  if (headed) {
    eq(ext.dH, clean.dH, 'the window chrome height we imply equals the one a real browser has');
    eq(ext.dW, clean.dW, 'the window chrome width we imply equals the one a real browser has');
  } else {
    console.log(`  (chrome height not asserted: headless invents its own frame — clean reports ` +
      `${clean.dH} here against 95 in a real window. Run with --headed)`);
  }

  ok(ext.innerH > 0 && ext.innerW > 0, 'the viewport stays positive after clamping');
  ok(ext.innerH < ext.outerH, 'innerHeight stays below outerHeight');

  console.log(`\nchrome height: ours ${ext.dH}, a clean browser ${clean.dH}` +
    (ext.dH === clean.dH ? ' — agree' : ' — DIFFER'));
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
