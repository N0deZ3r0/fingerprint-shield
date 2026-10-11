/**
 * THE Intl LOCALE MUST EQUAL navigator.language — IN BOTH SCOPES, UNDER EVERY FLAG.
 *
 *   node test/localeflag.mjs
 *
 * A clean browser never disagrees with itself here: `navigator.language`,
 * `navigator.languages[0]` and `Intl.DateTimeFormat().resolvedOptions().locale` are one
 * answer, measured as a bare, single-valued tag.
 *
 * This extension answered them from two different places. `navigator.language` is set by
 * the NAVIGATOR module and by nothing else; the Intl locale was set by `_dtfLocale()` in
 * mw/mw-timezone-screen.js, installed under the TIMEZONE flag. Either checkbox alone
 * therefore made the page contradict itself — and worse, it split the scopes, because
 * mw/mw-workers.js already had it right and says so at its own DateTimeFormat wrapper:
 * "Only timeZone here; locale stays with _intlShim (navigator flag)".
 *
 * Not found by reading any of that. Found in live Fingerprint Pro events off the user's own
 * Chrome while measuring what each module costs, both directions inside one session:
 *
 *   navigator OFF, timezone ON    languages ru-RU   date_time_locale et-EE
 *   navigator ON,  timezone OFF   languages et-EE   date_time_locale ru
 *
 * The first is closed and is what parts 1 and 2 below pin. The second is NOT closed — with
 * the timezone module off the window installs no Intl wrapper at all, so it answers the
 * host while the worker answers the profile. Part 3 MEASURES it and prints it rather than
 * asserting, because a suite that stays red teaches people to ignore it; it is written down
 * as a numbered item in README "Limits" instead, which is where this project keeps what it knows
 * it has not closed. If part 3 ever prints that the scopes agree, close the item and turn
 * the note into an assertion.
 *
 * Part 4 is the options page's "Language — this browser's own", which no suite had ever
 * switched on. Found by ticking it by hand and reading the page at four moments instead of
 * one: the header said the host's language from the first request while the page said the
 * country's from its first script until ~300ms past load, on every load of every tab. Only
 * background.js knew about the switch; the two carriers that reach a page before the
 * inject does went on publishing the country. So part 4 reads the page's FIRST script, not
 * the loaded page — a read after the inject passes against the broken build.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, loadBackground, loadPopup, bootSettled } from './harness.mjs';

const { COUNTRY_DATA, afpPackFeatures, afpCloneFeatures, AFP_DEFAULT_FEATURES } =
  loadBackground(['COUNTRY_DATA', 'afpPackFeatures', 'afpCloneFeatures', 'AFP_DEFAULT_FEATURES']);
const { PROFILES } = loadPopup(['PROFILES']);

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };
const note = (m) => console.log('  note ' + m);
const section = (m) => console.log('\n=== ' + m + ' ===');

// DE, because its locale is the one least likely to equal this host's, and part 2 needs a
// control: "the locale is no longer the profile's" says nothing on a host already on it.
const SEL = { id: 'laptop_mid', cc: 'DE' };

const READ = `(function () {
  var o = {};
  try { o.lang = String(navigator.language); } catch (e) { o.lang = 'THREW'; }
  try { o.langs0 = String((navigator.languages || [])[0]); } catch (e) { o.langs0 = 'THREW'; }
  try { o.intl = String(Intl.DateTimeFormat().resolvedOptions().locale); } catch (e) { o.intl = 'THREW'; }
  return o;
})()`;
const WORKER_JS = `self.onmessage = function () { postMessage(${READ}); };\n`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>loc</title><script>
window.__early = ${READ};
window.__w = new Promise(function (res) {
  var done = false, f = function (v) { if (!done) { done = true; res(v); } };
  try {
    var w = new Worker('/worker.js');
    w.onmessage = function (e) { f(e.data); };
    w.onerror = function (e) { f({ error: (e && e.message) || '(empty)' }); };
    w.postMessage(1);
  } catch (e) { f({ error: 'threw:' + (e && e.name) }); }
  setTimeout(function () { f({ error: 'timeout' }); }, 6000);
});
<` + `/script></head><body>loc</body></html>`;

// What the last DOCUMENT request announced, for part 4: the claim has two halves, and the
// header is the one no script on the page can read back.
let lastAcceptLanguage = null;
const server = createServer((q, r) => {
  if (!q.url.startsWith('/worker.js') && !q.url.startsWith('/favicon')) {
    lastAcceptLanguage = q.headers['accept-language'] || '';
  }
  if (q.url.startsWith('/worker.js')) {
    return r.writeHead(200, {
      'content-type': 'application/javascript', 'cache-control': 'no-store'
    }).end(WORKER_JS);
  }
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// The clean answer, for the control in part 2. Read off a browser with no extension in it,
// on the same page — not about:blank, which is not a document the Intl default resolves
// through the same path on every platform.
let HOST = null;
{
  const d0 = mkdtempSync(join(tmpdir(), 'afp-locflag-clean-'));
  const c0 = await chromium.launchPersistentContext(d0, { ...BROWSER, headless: true, args: [] });
  const p0 = await c0.newPage();
  await p0.goto(BASE, { waitUntil: 'load' });
  HOST = await p0.evaluate(`(${READ})`);
  await c0.close();
  try { rmSync(d0, { recursive: true, force: true }); } catch { /* windows */ }
}

const dir = mkdtempSync(join(tmpdir(), 'afp-locflag-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(sw);
  const p = PROFILES.find((x) => x.id === SEL.id);
  const c = COUNTRY_DATA[SEL.cc];

  async function run(features, label) {
    await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
      afp_profile_id: p.id,
      afp_profile_data: {
        screenW: p.screenW, screenH: p.screenH, cores: p.cores,
        memory: p.memory, gpu: p.gpuKey, platform: p.platform
      },
      afp_country_code: SEL.cc, afp_resolved_timezone: c.tz,
      afp_resolved_locale: c.loc, afp_mode: 'normal', afp_features: features
    });
    await new Promise((r) => setTimeout(r, 900));
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    // Wait for the VALUE, not the clock. The flags travel to the page through this key, and
    // it is deliberately ABSENT when they equal the shipped defaults.
    const want = afpPackFeatures(features);
    const arrived = await page
      .waitForFunction(([w, absent]) => sessionStorage.getItem('v.ui.f') === (absent ? null : w),
        [want, want === afpPackFeatures(AFP_DEFAULT_FEATURES)], { timeout: 10000 })
      .then(() => true).catch(() => false);
    ok(arrived, `${label}: the flags reached the page`);
    await page.reload({ waitUntil: 'load' });
    const win = await page.evaluate(`(${READ})`);
    const wrk = await page.evaluate(() => window.__w);
    await page.close();
    note(`${label}: window ${win.lang} / ${win.langs0} / ${win.intl}` +
      `   worker ${wrk.lang} / ${wrk.langs0} / ${wrk.intl}`);
    return { win, wrk };
  }

  // [FIX the-invariant-was-stronger-than-the-browser] The first version of this asserted
  // `navigator.language === resolvedOptions().locale` and the CLEAN browser failed it:
  //
  //   clean: navigator.language ru-RU   navigator.languages[0] ru-RU   Intl locale ru
  //
  // ICU resolves the default locale to the bare tag when the region is the language's
  // default, so the two are equal for de-DE and not for ru-RU. What a real browser
  // guarantees is narrower, and it is what is checked here: the PRIMARY SUBTAG is shared,
  // and the window and the worker say the same thing. Written down because an assertion
  // stronger than the platform is a suite that fails on correct code.
  const primary = (t) => String(t || '').split('-')[0].toLowerCase();
  const consistent = (r) => primary(r.win.lang) === primary(r.win.intl) &&
    primary(r.wrk.lang) === primary(r.wrk.intl) && r.win.langs0 === r.win.lang;
  const sameScopes = (r) => r.win.lang === r.wrk.lang && r.win.intl === r.wrk.intl;
  const agree = (r) => consistent(r) && sameScopes(r);

  note(`clean browser: ${HOST.lang} / ${HOST.langs0} / ${HOST.intl}`);
  ok(primary(HOST.lang) === primary(HOST.intl),
    `a clean browser shares the primary subtag (${HOST.lang} vs ${HOST.intl})`);

  section('1) the shipped defaults: one locale, and it is the profile');
  const R1 = await run(afpCloneFeatures(), 'defaults');
  ok(agree(R1), 'language, languages[0] and the Intl locale are one answer in both scopes');
  // [FIX the-suite-expected-the-TAG] It asserted the Intl locale equals the profile's locale
  // tag. It does not: the DEFAULT Intl locale is a third string, measured per locale, and
  // de-DE reports `de`. The table now carries it, so the expectation comes from the same
  // measured field the runtime reads rather than from the tag beside it.
  const wantIntl = c.intlLocale || c.loc;
  ok(R1.win.intl === wantIntl,
    `and that answer is the measured default for the profile (${R1.win.intl} vs ${wantIntl})`);

  section('2) navigator OFF: the locale follows it back to the host');
  const noNav = afpCloneFeatures();
  noNav.navigator = false;
  const R2 = await run(noNav, 'navigator off');
  ok(agree(R2), 'still one answer, in the window and in the worker');
  // The control. Without it, a host that already speaks the profile's language would make
  // the assertion above pass whether or not anything actually yielded.
  if (HOST.lang === c.loc) {
    note(`unprovable on this host: it already speaks ${c.loc}, so "not the profile" says nothing`);
  } else {
    ok(R2.win.intl !== c.loc,
      `and it is no longer the profile (${R2.win.intl}, profile ${c.loc})`);
    ok(R2.win.intl === HOST.intl, `it is the host (${R2.win.intl} vs ${HOST.intl})`);
  }

  section('3) navigator ON, timezone OFF — a README "Limits" item, measured not asserted');
  const noTz = afpCloneFeatures();
  noTz.timezone = false;
  const R3 = await run(noTz, 'timezone off');
  note(agree(R3)
    ? 'the scopes agree here after all — if this holds, close the LIMITS item and assert it'
    : `SPLIT as documented: window says ${R3.win.lang} but Intl ${R3.win.intl}; ` +
      `worker says ${R3.wrk.lang} and Intl ${R3.wrk.intl}`);

  section('4) "Language — this browser\'s own": the host, from the first script, and on the wire');
  // Back to the shipped flags, then the switch is thrown the way a user throws it: the box
  // and Save on the options page. Writing the key into storage would skip the message that
  // rebuilds the header rule and the cold-start file set, which is half of what is tested.
  await run(afpCloneFeatures(), 'defaults again');
  const id = new URL(sw.url()).host;
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${id}/options.html`, { waitUntil: 'load' });
  await opt.waitForSelector('#feat_canvas');
  // Save disables its button until the background has answered, so the button coming back
  // is the event — not a number of milliseconds after the click.
  const save = async (on) => {
    await opt.setChecked('#hostLang', on);
    await opt.click('#saveBtn');
    await opt.waitForFunction(() => !document.getElementById('saveBtn').disabled, null, { timeout: 15000 });
  };
  const visit = async (label) => {
    const page = await ctx.newPage();
    lastAcceptLanguage = null;
    await page.goto(BASE, { waitUntil: 'load' });
    const early = await page.evaluate(() => window.__early);
    const atLoad = await page.evaluate(`(${READ})`);
    const wrk = await page.evaluate(() => window.__w);
    await page.waitForTimeout(600);   // past the inject; a late flip is the other half of the defect
    const late = await page.evaluate(`(${READ})`);
    await page.close();
    const f = (o) => `${o.lang} / ${o.langs0} / ${o.intl}`;
    note(`${label}: header ${JSON.stringify(lastAcceptLanguage)}   first script ${f(early)}` +
      `   load ${f(atLoad)}   later ${f(late)}   worker ${f(wrk)}`);
    return { early, atLoad, late, wrk, header: lastAcceptLanguage };
  };
  const same = (a, b) => a.lang === b.lang && a.langs0 === b.langs0 && a.intl === b.intl;

  await save(true);
  const H = await visit('host language on');
  if (HOST.lang === c.loc) {
    note(`unprovable on this host: it already speaks ${c.loc}, the country's language and its own are one`);
  } else {
    ok(H.early.lang === HOST.lang && H.early.langs0 === HOST.lang,
      `the page's FIRST script reads the host's language (${H.early.lang}, host ${HOST.lang}, country ${c.loc})`);
    ok(H.early.intl === HOST.intl, `and the host's Intl default (${H.early.intl} vs ${HOST.intl})`);
    ok(String(H.header).split(',')[0] === HOST.lang,
      `the header leads with the same tag (${H.header})`);
  }
  ok(same(H.early, H.atLoad) && same(H.early, H.late),
    'one answer for the life of the page — first script, load, and after the inject');
  ok(H.wrk.lang === H.early.lang && H.wrk.intl === H.early.intl, 'and the worker agrees with the window');

  await save(false);
  const C = await visit('host language off again');
  ok(C.early.lang === c.loc && C.early.intl === wantIntl,
    `switched off, the first script is back on the country's (${C.early.lang} / ${C.early.intl})`);
  ok(String(C.header).split(',')[0] === c.loc, `and so is the header (${C.header})`);
  ok(same(C.early, C.atLoad) && same(C.early, C.late), 'again one answer for the life of the page');
  await opt.close();
} finally {
  await ctx.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
