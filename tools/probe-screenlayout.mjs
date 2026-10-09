/**
 * WHICH SCREEN PROPERTY MAKES A RESPONSIVE WIDGET PICK THE WRONG LAYOUT.
 *
 *   node tools/probe-screenlayout.mjs [url]
 *
 * Reported from georgian-airways.com/ru: with the extension the date picker cannot be used —
 * the dates are drawn, no fare is shown under them, and a click selects nothing. Measured in
 * the reporter's own browser: at the centre of a day cell, document.elementFromPoint returns
 * a MuiDialog-container rather than the cell, and a click dispatched straight at the cell
 * DOES select the date. So the widget is not broken; a transparent dialog is sitting over it
 * and eating the clicks.
 *
 * The dialog is a SECOND calendar. Clean, the page draws 133 day cells and no visible
 * MuiDialog-root; with the extension it draws 266 and one. The widget renders both its inline
 * and its dialog variant, and the dialog's full-viewport container covers the inline one.
 *
 * Bisected over the feature switches, one module at a time: `screen` alone reproduces it, and
 * every other module leaves 133. Two candidates are already ruled out by measurement, which is
 * why this file exists rather than a guess:
 *
 *   the claimed SIZE      setting the profile's screen to exactly the window still doubled
 *   window.outerHeight    forced back to innerHeight with the module on, still doubled
 *
 * What is left is screen.width/height/availWidth/availHeight themselves, and this overrides
 * them in the page at document_start to find which one the widget reads. The override is
 * re-applied on a short timer because the extension installs its own accessors at
 * document_start too and whichever defines last wins.
 */
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, BROWSER, langArgs, bootSettled } from '../test/harness.mjs';

const URL_ = process.argv.find((a) => a.startsWith('http')) || 'https://georgian-airways.com/ru';
const headed = process.argv.includes('--headed');
const VW = 1600, VH = 900;

const LOOK = () => {
  const live = [...document.querySelectorAll('[class*="MuiDialog-root"]')]
    .filter((n) => getComputedStyle(n).visibility === 'visible');
  const cells = [...document.querySelectorAll('[class*="day-"]')].filter((n) => n.getBoundingClientRect().width > 0);
  let hit = 'no cells';
  if (cells.length) {
    const t = cells[Math.floor(cells.length / 2)];
    const b = t.getBoundingClientRect();
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    hit = (top === t || t.contains(top)) ? 'the day cell' : (top ? String(top.className).slice(0, 26) : 'null');
  }
  return {
    cells: cells.length, dlg: live.length, hit,
    scr: screen.width + 'x' + screen.height, avail: screen.availWidth + 'x' + screen.availHeight,
    win: innerWidth + 'x' + innerHeight, outer: outerWidth + 'x' + outerHeight
  };
};

const OPEN = () => {
  const el = document.querySelector('[class*="datepicker_value"]');
  if (!el) return;
  const r = el.getBoundingClientRect();
  ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((t) => el.dispatchEvent(
    new MouseEvent(t, { bubbles: true, cancelable: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })));
};

// Re-applied for the first second: the extension defines its accessors at document_start as
// well, and a single definition at the wrong moment measures the race rather than the claim.
const persist = (code) => `(() => { const go = () => { try { ${code} } catch (e) {} };
  go(); let n = 0; const t = setInterval(() => { go(); if (++n > 40) clearInterval(t); }, 25); })();`;

const defineScreen = (pairs) => pairs.map(([k, expr]) =>
  `try { Object.defineProperty(window.screen, '${k}', { configurable: true, get: () => ${expr} }); } catch (e) {}
   try { Object.defineProperty(Screen.prototype, '${k}', { configurable: true, get: () => ${expr} }); } catch (e) {}`
).join('\n');

async function trial(label, initCode, withExt = true) {
  let ctx, browser, dir;
  if (withExt) {
    dir = mkdtempSync(path.join(tmpdir(), 'afp-screenlayout-'));
    ctx = await chromium.launchPersistentContext(dir, {
      ...BROWSER, headless: !headed,
      ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, ...langArgs()]
    });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 30000 });
    await bootSettled(sw);
  } else {
    browser = await chromium.launch({ ...BROWSER, headless: !headed });
    ctx = await browser.newContext();
  }
  const p = await ctx.newPage();
  await p.setViewportSize({ width: VW, height: VH });
  // A spurious resize is the other way one render becomes two: the widget re-measures and
  // mounts the variant for the size it now believes it has.
  await p.addInitScript(`window.__afpEv = { resize: 0, orientationchange: 0, vvResize: 0, sizes: [] };
    addEventListener('resize', () => { __afpEv.resize++; __afpEv.sizes.push(innerWidth + 'x' + innerHeight); }, true);
    addEventListener('orientationchange', () => __afpEv.orientationchange++, true);
    try { visualViewport.addEventListener('resize', () => __afpEv.vvResize++, true); } catch (e) {}`);
  if (initCode) await p.addInitScript(persist(initCode));
  await p.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForSelector('input[name="departure_0"]', { timeout: 90000 });
  await p.waitForTimeout(6000);
  await p.evaluate(OPEN);
  await p.waitForTimeout(6000);
  const ev = await p.evaluate(() => window.__afpEv);
  const mq = await p.evaluate(MQ);
  console.log('   events: ' + JSON.stringify(ev));
  const r = await p.evaluate(LOOK);
  console.log('   matchMedia vs CSS: ' + JSON.stringify(mq));
  console.log(`${r.dlg === 0 ? 'OK      ' : 'DOUBLED '}${label.padEnd(34)} cells=${String(r.cells).padEnd(4)} ` +
    `dlg=${r.dlg} screen=${r.scr} avail=${r.avail} win=${r.win} outer=${r.outer}  click->${r.hit}`);
  await p.close();
  if (withExt) { await ctx.close(); try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ } }
  else await browser.close();
}

// MUI picks its layout with useMediaQuery, i.e. matchMedia. LIMITS item 8 records that
// matchMedia answers from the profile while the CSS engine answers from the real window — so
// this prints both for the breakpoints MUI uses. A disagreement there is the one thing that
// would explain a widget rendering its desktop AND its mobile variant at the same moment.
const MQ = () => {
  const probe = (q) => {
    const id = 'afpq' + Math.random().toString(36).slice(2, 8);
    const st = document.createElement('style');
    st.textContent = '#' + id + '{--m:0}@media ' + q + '{#' + id + '{--m:1}}';
    const d = document.createElement('div');
    d.id = id;
    document.documentElement.append(st, d);
    const css = getComputedStyle(d).getPropertyValue('--m').trim() === '1';
    st.remove();
    d.remove();
    return { js: matchMedia(q).matches, css };
  };
  const out = {};
  for (const q of ['(max-width:599.95px)', '(max-width:899.95px)', '(max-width:1199.95px)',
    '(min-width:600px)', '(min-width:900px)', '(min-width:1200px)',
    '(max-height:899.95px)', '(min-width:1536px)', '(min-width:1920px)',
    // The hardware half, which is the OTHER thing _FEAT.screen gates (mw-misc.js) and the
    // half LIMITS item 8 names: hover, any-hover, pointer, any-pointer, update.
    '(hover: hover)', '(hover: none)', '(any-hover: hover)', '(any-hover: none)',
    '(pointer: fine)', '(pointer: coarse)', '(any-pointer: fine)', '(any-pointer: coarse)',
    '(update: fast)', '(update: slow)', '(color-gamut: srgb)', '(color-gamut: p3)',
    '(dynamic-range: standard)', '(dynamic-range: high)', '(forced-colors: active)',
    '(inverted-colors: inverted)', '(min-resolution: 1.5dppx)', '(min-resolution: 2dppx)',
    '(prefers-reduced-motion: reduce)', '(orientation: portrait)',
    // COMPOUND queries: the patch recognises a query by the feature names in it, and a
    // responsive library writes breakpoints that carry both a width and a hardware term.
    // A query the patch only half understands is the one shape the single-feature checks
    // above cannot catch.
    '(min-width:900px) and (hover:hover)', '(max-width:899.95px) and (pointer:coarse)',
    'screen and (max-width:899.95px)', 'screen and (min-width:900px)',
    'only screen and (max-width:899.95px)', '(min-width:900px) and (pointer:fine)',
    '(max-width:1199.95px) and (hover:none)', 'screen and (min-width:600px) and (max-width:899.95px)',
    '(min-resolution:1.5dppx) and (min-width:900px)', 'not all and (min-width:900px)']) {
    const r = probe(q);
    if (r.js !== r.css) out[q] = 'js=' + r.js + ' css=' + r.css;
  }
  return Object.keys(out).length ? out : 'every breakpoint agrees';
};

console.log(`probing ${URL_} at ${VW}x${VH}\n`);
await trial('no extension', null, false);
await trial('extension as shipped', null);
// Every property the dump showed the module changing, all put back at once. If this still
// doubles, the module changes something the dump does not cover — matchMedia above being the
// first candidate, since that is the one surface LIMITS item 8 already records as divergent.
await trial('every changed property -> window',
  defineScreen([['width', 'innerWidth'], ['height', 'innerHeight'],
    ['availWidth', 'innerWidth'], ['availHeight', 'innerHeight']]) +
  `\ntry { Object.defineProperty(window, 'outerHeight', { configurable: true, get: () => innerHeight }); } catch (e) {}` +
  `\ntry { Object.defineProperty(window, 'outerWidth', { configurable: true, get: () => innerWidth }); } catch (e) {}`);
