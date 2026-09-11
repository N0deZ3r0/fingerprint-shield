/**
 * The media-query parity page, re-run on hardware and settings this machine does not have.
 *
 *   node test/mediadisplay.mjs             headless
 *   node test/mediadisplay.mjs --headed    watch it
 *
 * dev-mediaparity.html asks every media feature twice - once as a CSS @media rule, once
 * through matchMedia - and fails when the two disagree, because @media and matchMedia are
 * one engine answering one question and no real browser contradicts itself.
 *
 * It could only ever ask about THIS machine. The dev rig is a desktop, mouse, sRGB panel,
 * no accessibility preference set - which is exactly the machine mw/mw-misc.js used to
 * force matchMedia to describe. Every forced answer was therefore true here, the page was
 * green, and three separate contradictions were sitting one laptop away:
 *
 *   emulated condition        disagreements, before the fixes
 *   Display-P3 panel          1     (color-gamut: p3)
 *   rec2020 panel             2     + (color-gamut: rec2020)
 *   user set reduced-motion   2     (prefers-reduced-motion, both values)
 *   Windows High Contrast     2     (forced-colors, both values)
 *   prefers-contrast: more    2     (prefers-contrast, both values)
 *   touch device              8     hover / any-hover / pointer / any-pointer
 *
 * The first five are fixed - those features are no longer forced, see
 * [FIX color-gamut-was-forced-against-an-engine-we-cannot-reach] and
 * [FIX accessibility-prefs-were-forced-onto-the-user] in mw/mw-misc.js. The touch group is
 * KEPT and accepted, because dropping it moves the contradiction onto our own spoofed
 * navigator.maxTouchPoints instead of removing it; the reasoning is written out at ACCEPTED
 * in dev-mediaparity.html. This suite holds both halves: the fixed ones must show no
 * disagreement, and the accepted one must still be COUNTED as accepted rather than quietly
 * ceasing to diverge.
 *
 * Conditions are emulated at ENGINE level (CDP Emulation.setEmulatedMedia, or a Playwright
 * context for touch), so the CSS side moves with them. A page-level lie would prove
 * nothing: the whole question is whether our JS agrees with the engine.
 *
 * THE CONTROL IS THE POINT. Every scenario first checks, in a page with none of our code,
 * that the emulated condition really took effect. Without it, the day CDP renames a feature
 * this suite goes green while testing nothing - the failure mode of every "assert that
 * nothing is wrong" test, and the reason test/webrtc-sdp.mjs opens the same way.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { BROWSER, root } from './harness.mjs';

const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.css': 'text/css', '.source': 'text/plain', '.cjs': 'text/javascript' };
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/**
 * `control` is the query a CLEAN browser must answer true under this scenario - the proof
 * that the emulation reached the engine. `accepted` marks the one scenario whose divergence
 * is the documented, deliberate one, where the page must still be counting it.
 */
const SCENARIOS = [
  { name: 'host machine', features: [], context: {}, control: null },
  { name: 'Display-P3', control: '(color-gamut: p3)',
    features: [{ name: 'color-gamut', value: 'p3' }] },
  { name: 'rec2020', control: '(color-gamut: rec2020)',
    features: [{ name: 'color-gamut', value: 'rec2020' }] },
  { name: 'reduced-motion', control: '(prefers-reduced-motion: reduce)',
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] },
  { name: 'High Contrast', control: '(forced-colors: active)',
    features: [{ name: 'forced-colors', value: 'active' }] },
  { name: 'contrast: more', control: '(prefers-contrast: more)',
    features: [{ name: 'prefers-contrast', value: 'more' }] },
  { name: 'touch device', control: '(any-pointer: coarse)', features: [], accepted: true,
    context: { hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } } }
];

// [FIX the-dev-page-runner-drove-a-browser-nobody-chose] The second site that skipped
// BROWSER, and the same cost: this suite reads media queries and display capabilities,
// which is exactly the axis on which the bundled shell and channel:'chromium' differ.
const browser = await chromium.launch({ ...BROWSER, headless: !headed });
try {
  for (const sc of SCENARIOS) {
    const ctx = await browser.newContext(sc.context || {});
    try {
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      if (sc.features.length) await cdp.send('Emulation.setEmulatedMedia', { features: sc.features });

      // -- the control: a browser with none of our code, under the same condition --
      await page.goto(`http://127.0.0.1:${port}/devpages/dev-blank.html`, { waitUntil: 'load' });
      const clean = await page.evaluate((q) => {
        if (!q) return null;
        const st = document.createElement('style'); document.head.appendChild(st);
        const d = document.createElement('div'); document.body.appendChild(d);
        st.textContent = 'div{--v:0}@media ' + q + '{div{--v:1}}';
        return { css: getComputedStyle(d).getPropertyValue('--v').trim() === '1',
                 js: matchMedia(q).matches };
      }, sc.control);
      if (sc.control) {
        ok(clean.css === clean.js,
          `${sc.name}: a clean browser agrees with itself on ${sc.control}`);
        ok(clean.css === true,
          `${sc.name}: the emulation reached the engine - clean CSS answers ${sc.control} ` +
          `with ${clean.css}, expected true`);
      }

      // -- the page under test --
      await page.goto(`http://127.0.0.1:${port}/devpages/dev-mediaparity.html`, { waitUntil: 'load' });
      await page.waitForFunction(() => {
        const el = document.getElementById('out');
        return el && el.textContent && !/^\s*running/i.test(el.textContent);
      }, { timeout: 60000 });
      const out = await page.evaluate(() => document.getElementById('out').textContent);

      const mFail = /FAILURES:\s*(\d+)/.exec(out);
      const mAcc = /accepted \([^)]*\):\s*(\d+)/.exec(out);
      ok(mFail, `${sc.name}: the parity page stated a verdict`);
      if (mFail) {
        ok(Number(mFail[1]) === 0, `${sc.name}: 0 unexpected disagreements` +
          (Number(mFail[1]) ? '\n' + out.split('\n').filter((l) => /FAIL/.test(l)).join('\n') : ''));
      }
      // The touch scenario must still EXERCISE the accepted path. Without this it would
      // pass just as happily if hover/pointer silently stopped being forced - which is a
      // different build, not a passing one.
      if (sc.accepted) {
        ok(mAcc && Number(mAcc[1]) > 0,
          `${sc.name}: the input divergence is still counted as accepted ` +
          `(got ${mAcc ? mAcc[1] : 'no count'})`);
      }
      console.log(`  ${sc.name.padEnd(15)} failures: ${mFail ? mFail[1] : '?'}` +
        `   accepted: ${mAcc ? mAcc[1] : '?'}`);
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
