/**
 * A REAL BOOKING CALENDAR, CLEAN BESIDE OURS.
 *
 *   node tools/probe-datepicker.mjs [url]
 *   node tools/probe-datepicker.mjs --headed
 *
 * Reported from the field: on georgian-airways.com/ru the date picker "shows nothing" with
 * the extension installed. The widget is Websky, built on moment, and it opens as a panel of
 * day cells rather than an <input type=date> — so nothing about it is a browser control the
 * suite already covers, and the failure mode reported is the hardest kind to guess at: not an
 * error, not a dead element, just no dates.
 *
 * This loads the page twice — a clean browser and a profile with the extension loaded — opens
 * the picker in both, and prints what the panel actually contains. Everything is printed for
 * BOTH, because the only readings that mean anything here are the ones that differ.
 *
 * THE EXTENSION HAS TO BE ON, and proving that is half the probe. The first version of this
 * launched the context by hand and reported 18 cores and the host timezone on both sides —
 * which reads exactly like "the extension changes nothing" and actually meant the extension
 * had not booted. So it goes through test/harness.mjs (BROWSER, langArgs, bootSettled) like
 * every suite does, and the first line of each block is the evidence that the thing under
 * test is running at all.
 */
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, BROWSER, langArgs, bootSettled } from '../test/harness.mjs';

const headed = process.argv.includes('--headed');
const URL_ = process.argv.find((a) => a.startsWith('http')) || 'https://georgian-airways.com/ru';

// The widget's class names are CSS-module hashes, so nothing here matches a literal: the
// trigger is the element whose class CONTAINS datepicker_value, and the cells are the ones
// whose class contains day-. A build of the site that rehashes them still probes.
const OPEN = () => {
  const el = document.querySelector('[class*="datepicker_value"]') ||
             document.querySelector('[class*="datepicker"]');
  if (!el) return 'no datepicker element';
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((t) => el.dispatchEvent(
    new MouseEvent(t, {
      bubbles: true, cancelable: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
    })));
  return 'opened via ' + (el.className || '').toString().split(/\s+/)[0];
};

const READ = () => {
  const o = {};
  // Is the extension on? Read first, so a run where it never booted cannot be mistaken for a
  // run where it changed nothing.
  o.cores = navigator.hardwareConcurrency;
  o.mem = navigator.deviceMemory;
  o.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  o.intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
  o.navLang = navigator.language;
  o.offset = new Date().getTimezoneOffset();
  o.dateStr = new Date().toString().slice(0, 33);
  o.isoNow = new Date().toISOString().slice(0, 19);
  // What moment thinks, since the widget is built on it.
  try {
    o.momentNow = window.moment ? window.moment().format('YYYY-MM-DD HH:mm') : 'no moment';
    o.momentTz = window.moment ? String(window.moment().utcOffset()) : '';
  } catch (e) { o.momentNow = 'THREW ' + e.name; }

  const vis = (n) => n.getBoundingClientRect().width > 0;
  const cells = [...document.querySelectorAll('[class*="day-"]')].filter(vis);
  o.cells = cells.length;
  o.cellsEmpty = cells.filter((n) => !(n.textContent || '').trim()).length;
  o.numbered = cells.filter((n) => /^\d{1,2}$/.test((n.textContent || '').trim())).length;
  // A cell a user cannot press is as good as absent, and this is the shape the report
  // describes: a panel that is there and offers nothing.
  o.unpickable = cells.filter((n) => {
    const c = (n.className || '').toString();
    const s = getComputedStyle(n);
    return /disabled|unavailable|inactive|off|past/i.test(c) ||
      s.pointerEvents === 'none' || parseFloat(s.opacity) < 0.4;
  }).length;
  o.firstNumbers = cells.map((n) => (n.textContent || '').trim())
    .filter((t) => /^\d{1,2}$/.test(t)).slice(0, 10).join(',');
  // [the responsive hypothesis] The extension answers matchMedia from the profile while the
  // CSS engine answers from the real window — LIMITS item 8. A site that picks its layout in
  // JS and lays it out in CSS then gets two different answers to "how wide am I", which is
  // exactly how one widget becomes two, or none.
  o.innerW = window.innerWidth;
  o.screenW = screen.width;
  o.dpr = window.devicePixelRatio;
  o.mmNarrow = matchMedia('(max-width: 768px)').matches;
  o.mmWide = matchMedia('(min-width: 1024px)').matches;
  o.mmHover = matchMedia('(hover: hover)').matches;
  o.mmPointer = matchMedia('(pointer: coarse)').matches;
  // The CSS engine's own answer to the same question, which no JS patch reaches.
  try {
    const st = document.createElement('style');
    st.textContent = '#afpmq{--w:0}@media (max-width:768px){#afpmq{--w:1}}' +
                     '@media (min-width:1024px){#afpmq{--w:2}}';
    const d = document.createElement('div'); d.id = 'afpmq';
    document.documentElement.appendChild(st); document.documentElement.appendChild(d);
    o.cssW = getComputedStyle(d).getPropertyValue('--w').trim();
    st.remove(); d.remove();
  } catch (e) { o.cssW = 'THREW'; }
  // The reported symptom in its own terms: "the dates are there, the prices are not, you
  // cannot pick, the window is inert". So the fare under each cell is read, not the cell.
  o.priced = cells.filter((n) => {
    const t = (n.innerText || n.textContent || '');
    return /\d[\d\s.,]*\s*(₾|GEL|\$|€|USD|EUR|руб|₽)/i.test(t);
  }).length;
  o.currency = (document.body.innerText.match(/₾|GEL|USD|EUR|€|\$/g) || []).length;
  const panel = document.querySelector('[class*="datepicker"] [class*="calendar"]') ||
                document.querySelector('[class*="calendar"]') ||
                document.querySelector('[class*="datepicker"]');
  if (panel) {
    const s = getComputedStyle(panel);
    o.panelPE = s.pointerEvents; o.panelOp = s.opacity;
    o.panelAria = panel.getAttribute('aria-disabled') || panel.getAttribute('disabled') || '-';
  } else { o.panelPE = o.panelOp = o.panelAria = 'no panel'; }
  o.spinners = [...document.querySelectorAll('[class*="load" i],[class*="spin" i],[class*="preload" i]')]
    .filter(vis).length;
  o.pickers = document.querySelectorAll('[class*="datepicker"]').length;
  o.pickersVisible = [...document.querySelectorAll('[class*="datepicker"]')].filter(vis).length;
  const cap = [...document.querySelectorAll('[class*="month"]')].filter(vis)
    .map((n) => (n.textContent || '').trim()).filter((t) => t && t.length < 24);
  o.captions = [...new Set(cap)].slice(0, 6);
  return o;
};

// Type a city, take the first suggestion. Nothing here submits a search or a booking: the
// two fields are filled so the widget has a route to price, and that is the whole point.
async function fillRoute(p) {
  const pick = async (name, text) => {
    const el = await p.$(`input[name="${name}"]`);
    if (!el) return `${name}: not found`;
    await el.click();
    await el.fill('');
    await el.type(text, { delay: 60 });
    await p.waitForTimeout(2500);
    // The suggestion list is unhashed only by its position under the field, so take the
    // first option-looking node that appeared and is visible.
    const got = await p.evaluate(() => {
      const opts = [...document.querySelectorAll('[class*="option" i],[class*="suggest" i],[class*="autocomplete" i] li,li[class*="item" i]')]
        .filter((n) => n.getBoundingClientRect().width > 0 && (n.textContent || '').trim());
      if (!opts.length) return null;
      const o = opts[0];
      const t = (o.textContent || '').trim().slice(0, 30);
      const r = o.getBoundingClientRect();
      ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((k) => o.dispatchEvent(
        new MouseEvent(k, { bubbles: true, cancelable: true, view: window,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })));
      return t;
    });
    if (!got) { await el.press('Enter'); }
    await p.waitForTimeout(1500);
    const val = await p.evaluate((n) => {
      const i = document.querySelector(`input[name="${n}"]`);
      return i ? i.value : '';
    }, name);
    return `${name}="${val}"${got ? ' via "' + got + '"' : ' via Enter'}`;
  };
  const a = await pick('departure_0', 'Тбилиси');
  const b = await pick('arrival_0', 'Москва');
  return a + '  ' + b;
}

async function run(label, withExt) {
  const errs = [];
  let ctx, browser, dir;
  if (withExt) {
    dir = mkdtempSync(path.join(tmpdir(), 'afp-datepicker-'));
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
  // [the availability hypothesis] A calendar that opens with nothing to pick is a calendar
  // whose schedule request failed. This extension rewrites request headers, so a request that
  // the site makes and the server refuses is a failure mode no DOM reading would name.
  // Every xhr/fetch, not a guessed allowlist: the endpoint that carries the fares is the
  // thing being looked for, so filtering by a name I guessed would be the one way to miss it.
  const net = [];
  const short = (u) => u.replace(/^https?:\/\//, '').slice(0, 110);
  // The exchange itself for the fare/route endpoint. Both sides answer 200, so the status
  // says nothing: what matters is whether the REQUEST differs and whether the ANSWER is
  // empty. "No flights from Tbilisi" with a 200 is a server that was asked a question it
  // read differently, not a request that failed.
  const gql = [];
  p.on('response', (res) => {
    const q = res.request();
    if (q.resourceType() !== 'xhr' && q.resourceType() !== 'fetch') return;
    net.push({ status: res.status(), method: q.method(), url: short(res.url()) });
    if (!/graphql|nemo|websky\.tech/i.test(res.url())) return;
    (async () => {
      let body = '';
      try { body = (await res.text()).slice(0, 600); } catch (e) { body = 'unreadable: ' + e.message; }
      const h = q.headers();
      gql.push({
        post: String(q.postData() || '').slice(0, 300),
        accLang: h['accept-language'] || '(none)',
        ua: (h['user-agent'] || '').slice(-40),
        chLang: h['sec-ch-ua-platform'] || '',
        body
      });
    })();
  });
  p.on('requestfailed', (q) => {
    if (q.resourceType() !== 'xhr' && q.resourceType() !== 'fetch') return;
    net.push({ status: 'FAILED ' + ((q.failure() && q.failure().errorText) || '?'), method: q.method(), url: short(q.url()) });
  });
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message).slice(0, 200)));
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (!/ERR_NAME_NOT_RESOLVED|Failed to load resource|ERR_BLOCKED/.test(t)) errs.push('console ' + t.slice(0, 200));
  });
  await p.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForTimeout(9000);
  // A ROUTE FIRST, which the first version of this probe skipped — and that is why it
  // reported "no prices" on both sides and called it no difference. Websky asks for fares
  // for a route; with the origin and destination empty there is nothing to price, so the
  // panel is priceless in a clean browser too and the reading means nothing.
  const filled = await fillRoute(p);
  const how = await p.evaluate(OPEN);
  await p.waitForTimeout(6000);
  const r = await p.evaluate(READ);

  console.log(`\n===== ${label} =====`);
  console.log(`  on?        cores=${r.cores} mem=${r.mem}`);
  console.log(`  time       tz=${r.tz} offset=${r.offset} intl=${r.intlLocale} navLang=${r.navLang}`);
  console.log(`  Date()     ${r.dateStr}`);
  console.log(`  ISO        ${r.isoNow}`);
  console.log(`  moment     ${r.momentNow}  utcOffset=${r.momentTz}`);
  console.log(`  route      ${filled}`);
  console.log(`  ${how}`);
  console.log(`  CELLS      ${r.cells}  numbered=${r.numbered}  empty=${r.cellsEmpty}  UNPICKABLE=${r.unpickable}`);
  console.log(`  days       ${r.firstNumbers}`);
  console.log(`  PRICES     cells carrying a fare: ${r.priced}  (currency marks: ${r.currency})`);
  console.log(`  inert      panel pointer-events=${r.panelPE} opacity=${r.panelOp} aria-disabled=${r.panelAria}`);
  console.log(`  spinners   ${r.spinners} loading/spinner nodes visible`);
  await p.waitForTimeout(1500);
  console.log(`  GRAPHQL    ${gql.length} exchange(s) with the fare endpoint`);
  gql.slice(0, 3).forEach((g, i) => {
    console.log(`    [${i}] accept-language: ${g.accLang}   ua-tail: ${g.ua}`);
    console.log(`    [${i}] request : ${g.post.replace(/\s+/g, ' ').slice(0, 230)}`);
    console.log(`    [${i}] response: ${g.body.replace(/\s+/g, ' ').slice(0, 300)}`);
  });
  const bad = net.filter((n) => String(n.status).startsWith('FAILED') || Number(n.status) >= 400);
  console.log(`  network    ${net.length} xhr/fetch, ${bad.length} failed or >=400`);
  bad.slice(0, 10).forEach((n) => console.log(`    !! ${n.status} ${n.method} ${n.url}`));
  net.slice(0, 14).forEach((n) => console.log(`    ${String(n.status).padEnd(7)} ${n.method} ${n.url}`));
  console.log(`  captions   ${JSON.stringify(r.captions)}`);
  console.log(`  viewport   innerW=${r.innerW} screenW=${r.screenW} dpr=${r.dpr}`);
  console.log(`  matchMedia narrow<=768=${r.mmNarrow} wide>=1024=${r.mmWide} hover=${r.mmHover} coarse=${r.mmPointer}`);
  console.log(`  CSS ENGINE same question -> --w=${r.cssW}   (0=neither 1=narrow 2=wide)`);
  console.log(`  pickers    ${r.pickers} in DOM, ${r.pickersVisible} visible`);
  if (errs.length) console.log('  errors\n    ' + errs.slice(0, 6).join('\n    '));

  await p.close();
  if (withExt) { await ctx.close(); try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ } }
  else await browser.close();
  return r;
}

console.log(`probing ${URL_}`);
const clean = await run('CLEAN', false);
const ours = await run('WITH EXTENSION', true);

console.log('\n===== verdict =====');
if (ours.cores === clean.cores && ours.tz === clean.tz) {
  console.log('  INCONCLUSIVE: the extension reported the same machine and zone as the clean');
  console.log('  browser, so either it stood down on this origin or it never booted. Nothing');
  console.log('  below distinguishes the build from the site.');
}
const row = (k) => `  ${k.padEnd(11)} clean ${String(clean[k]).padEnd(22)} ours ${ours[k]}` +
  (String(clean[k]) !== String(ours[k]) ? '   <-- DIFFERS' : '');
['cores', 'tz', 'offset', 'navLang', 'cells', 'numbered', 'unpickable', 'firstNumbers', 'momentNow',
 'priced', 'currency', 'panelPE', 'panelOp', 'spinners', 'innerW', 'screenW', 'dpr', 'mmNarrow', 'mmWide', 'mmHover', 'mmPointer', 'cssW', 'pickers', 'pickersVisible']
  .forEach((k) => console.log(row(k)));
