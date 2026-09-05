/**
 * THE LAYOUT AND THE VIEWPORT APIs MUST DESCRIBE ONE WINDOW.
 *
 *   node test/viewport.mjs             headless
 *   node test/viewport.mjs --headed    watch it
 *
 * A window cannot be wider than the monitor it is on, and CSS layout is not ours to fake.
 * The profile claimed 1920x1080 while the real window was 2008.5 CSS px wide, so every API
 * was clamped to the claim and the page still laid out at the true width. Measured on a real
 * Chrome, extension on:
 *
 *   innerWidth / outerWidth / clientWidth / visualViewport / screen.width   1920
 *   100vw, 50vw x2, width:100% on <html>, getBoundingClientRect             2008.5
 *
 * That is REFUTABLE, not merely unusual: the layout proves the screen is at least 2008 wide,
 * so a site does not have to take the 1920 on trust —
 *
 *   document.documentElement.getBoundingClientRect().width !== window.innerWidth
 *
 * is the whole detector. mw-core.js now raises the claimed screen to at least the native one
 * before any consumer reads it, which makes every clamp below it a no-op instead of a lie.
 *
 * WHY THE WINDOW IS FORCED WIDE. The bug only exists when the real window is BIGGER than the
 * claimed screen; inside a smaller window every number is already honest and the suite would
 * pass against the broken build. The viewport below is deliberately wider and taller than the
 * largest screen any shipped profile claims. Same reasoning as test/windowchrome.mjs, which
 * forces a tall window for the same kind of clamp.
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

// The window is deliberately WIDER and TALLER than what the default profile claims
// (laptop_mid, 1920x1080). Both halves of the defect need that:
//
//   width   the claim was min(screen, real) = 1920 against a 2200px layout;
//   height  the cap was availH - chrome = 945, so ANY window taller than that contradicted
//           the layout, even one that fits the claimed screen comfortably.
//
// In headless Chromium the reported screen follows the emulated viewport, so after the fix
// the claim is raised to 2200x1100 and both clamps become no-ops — which is the point. The
// negative control is in the changelog: with mw-core's clamp reverted this file goes red on
// the width, and with the innerHeight clause reverted it goes red on the height.
const PROFILE_SCREEN = { width: 1920, height: 1080 };
const VIEW = { width: 2200, height: 1100 };

const PAGE = '<!doctype html><html><body><p>vp</p></body></html>';
const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const READ = () => {
  const mk = (css) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;height:5px;' + css;
    document.documentElement.appendChild(d);
    const w = d.getBoundingClientRect().width;
    d.remove();
    return Math.round(w * 100) / 100;
  };
  const mkH = () => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:5px;height:100vh';
    document.documentElement.appendChild(d);
    const h = d.getBoundingClientRect().height;
    d.remove();
    return Math.round(h * 100) / 100;
  };
  return {
    innerWidth, innerHeight, outerWidth, outerHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
    vv: visualViewport ? Math.round(visualViewport.width * 100) / 100 : null,
    vw100: mk('width:100vw'),
    vw50: mk('width:50vw'),
    htmlRect: Math.round(document.documentElement.getBoundingClientRect().width * 100) / 100,
    vh100: mkH(),
    screenW: screen.width, screenH: screen.height,
    availW: screen.availWidth, availH: screen.availHeight,
    cores: navigator.hardwareConcurrency
  };
};

async function read(clean) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-vp-'));
  let browser = null;
  const ctx = clean
    ? await (browser = await chromium.launch({ ...BROWSER, headless: !headed }))
      .newContext({ viewport: VIEW })
    : await chromium.launchPersistentContext(dir, {
      ...BROWSER, headless: !headed, viewport: VIEW,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
  try {
    if (!clean) {
      try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch { /* up */ }
      await new Promise((r) => setTimeout(r, 2500));
    }
    const page = await ctx.newPage();
    await page.setViewportSize(VIEW);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    // The profile arrives ~300ms after navigation; read after it has landed, because the
    // clamp this checks is applied when it does.
    await page.waitForTimeout(1200);
    const got = await page.evaluate(READ);
    // What the PROFILE claims, read where it lives. Needed to tell "the claim was kept" from
    // "the machine's own pair was substituted" — the whole-pair assertion below needs both.
    if (!clean) {
      try {
        const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 5000 });
        got.claim = await sw.evaluate(async () => {
          const st = await chrome.storage.local.get(['afp_profile_data']);
          const d = (st && st.afp_profile_data) || {};
          return { w: d.screenW | 0, h: d.screenH | 0 };
        });
      } catch (e) { got.claim = null; got.claimErr = String(e).slice(0, 120); }
    }
    return got;
  } finally {
    await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds it */ }
  }
}

const clean = await read(true);
const ours = await read(false);
server.close();

const show = (label, r) => {
  console.log(`  ${label}`);
  console.log(`     inner ${r.innerWidth}x${r.innerHeight}  outer ${r.outerWidth}x${r.outerHeight}  client ${r.clientWidth}x${r.clientHeight}  vv ${r.vv}`);
  console.log(`     layout 100vw ${r.vw100}  50vw ${r.vw50}  htmlRect ${r.htmlRect}  100vh ${r.vh100}`);
  console.log(`     screen ${r.screenW}x${r.screenH}  avail ${r.availW}x${r.availH}  cores ${r.cores}`);
};
console.log('');
show('clean', clean);
show('ours ', ours);
console.log('');

ok(ours.cores !== clean.cores,
  `the extension is actually active — cores ours ${ours.cores} vs clean ${clean.cores}` +
  (ours.cores === clean.cores ? ' (IDENTICAL: nothing was tested)' : ''));

// Without this the run proves nothing: inside a window that already fits the claimed screen
// every number is honest even on the broken build.
ok(clean.vw100 > PROFILE_SCREEN.width && clean.vh100 > PROFILE_SCREEN.height,
  `the rig window (${clean.vw100}x${clean.vh100}) is bigger than the claimed screen ` +
  `(${PROFILE_SCREEN.width}x${PROFILE_SCREEN.height}) — otherwise the clamp never fires`);

// The detector, on both sides. A tolerance of 1px absorbs subpixel rounding and the
// scrollbar, which is what separates vw from clientWidth in any browser.
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
for (const [label, r] of [['clean', clean], ['ours', ours]]) {
  ok(near(r.vw100, r.innerWidth),
    `${label}: 100vw agrees with innerWidth (${r.vw100} vs ${r.innerWidth})`);
  ok(near(r.htmlRect, r.innerWidth),
    `${label}: documentElement's rect agrees with innerWidth (${r.htmlRect} vs ${r.innerWidth})`);
  ok(near(r.vw50 * 2, r.vw100),
    `${label}: 50vw is half of 100vw (${r.vw50} x2 vs ${r.vw100})`);
  ok(near(r.vh100, r.innerHeight),
    `${label}: 100vh agrees with innerHeight (${r.vh100} vs ${r.innerHeight})`);
  // The physical impossibility this is all about.
  ok(r.screenW >= r.innerWidth,
    `${label}: the screen is not narrower than the window (screen ${r.screenW}, window ${r.innerWidth})`);
  ok(r.screenH >= r.innerHeight,
    `${label}: the screen is not shorter than the window (screen ${r.screenH}, window ${r.innerHeight})`);
  ok(r.screenW >= r.availW && r.screenH >= r.availH,
    `${label}: avail fits inside the screen (${r.availW}x${r.availH} in ${r.screenW}x${r.screenH})`);
}

// [FIX screen-smaller-than-the-window-was-refutable] The claim and the machine are the only
// two pairs that may be reported, and a MIX of the two is what this catches: raising each
// dimension on its own turns a 1366x768 profile on a 1280x1024 monitor into 1366x1024, which
// no panel has ever shipped. A made-up resolution is worse than the honest one — it is unique
// rather than merely true — so the rule is whole-pair, and this is where it is held.
if (ours.claim && ours.claim.w > 0) {
  const keptClaim = ours.screenW === ours.claim.w && ours.screenH === ours.claim.h;
  const tookNative = ours.screenW === clean.screenW && ours.screenH === clean.screenH;
  const claimContains = ours.claim.w >= clean.screenW && ours.claim.h >= clean.screenH;
  console.log(`screen: claim ${ours.claim.w}x${ours.claim.h}, machine ${clean.screenW}x${clean.screenH}, reported ${ours.screenW}x${ours.screenH}`);
  ok(keptClaim || tookNative,
    `the reported screen is one whole pair, not a mix (claim ${ours.claim.w}x${ours.claim.h}, ` +
    `machine ${clean.screenW}x${clean.screenH}, reported ${ours.screenW}x${ours.screenH})`);
  ok(claimContains ? keptClaim : tookNative,
    claimContains
      ? 'the claim contains the machine, so the claim is kept'
      : "the claim does not contain the machine, so the machine's own pair is reported");
} else {
  ok(false, 'could not read the claimed screen from the service worker' +
    (ours.claimErr ? ' — ' + ours.claimErr : ' — got ' + JSON.stringify(ours.claim)));
}


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
