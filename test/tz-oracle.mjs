/**
 * THE DATE LAYER AGAINST A BROWSER THAT REALLY IS IN THE CLAIMED ZONE.
 *
 *   node test/tz-oracle.mjs             headless
 *   node test/tz-oracle.mjs --headed    watch it
 *
 * Every other suite here asks one of two questions: does the build agree with itself
 * (window vs worker, header vs JS), or does it differ from a clean browser ON THIS HOST.
 * Neither asks whether the answer is CORRECT for the machine being presented — and the
 * Date patch answers dozens of calls a real page makes for reasons that have nothing to
 * do with fingerprinting: parsing a birth date, `setHours(0,0,0,0)` for "start of day",
 * formatting an event time in a named zone. The 2026-09-03 audit found all of these wrong
 * while thirty-five suites were green:
 *
 *   new Date('5/20/1985')                    1113-07-01     (a fixed "epoch" constant)
 *   d.setHours(10)  at 21:00 Jan 15 New York  Jan 16 10:00  (computed on the UTC day)
 *   d.setDate(20)                            Jan 19         (host-zone arithmetic)
 *   IN: d.setMinutes(0) at 7:30              7:30           (UTC minutes, half-hour zone)
 *   DTF {timeZone:'Asia/Tokyo'} long name    Eastern Standard Time
 *   new Intl.Locale('de').toString()         de-US
 *
 * The oracle is Node itself, launched with TZ set to the profile's zone: its ICU and V8
 * are the same engines Chrome ships, so what it prints IS what a browser in that zone
 * prints. The collector below runs unchanged in the page, in a dedicated worker, and in
 * that Node process, and the three answers have to agree field for field — for two
 * profiles, because a half-hour zone (Asia/Kolkata) breaks arithmetic that a whole-hour
 * zone hides.
 *
 * [FIX the-oracle-moved-under-a-minor-release] "The same engines" holds only while the two
 * carry the same tzdata. Node 24.20.0 ("deps: update timezone to 2026c") moves
 * Africa/Casablanca to UTC+0 somewhere between 2026-07-01 and 2026-10-03, the two nearest
 * instants probed below, while Playwright's Chromium 141 and Chromium 153 still answer UTC+1.
 * Profile MA's dstEdges went red on 2026-09-11 on both CI hosts with nothing changed here:
 * under Node 24.19.0 (tz 2026b) this suite is 461/0 on 2.5.28 and 2.5.29 alike, measured.
 * So CI pins the exact Node release (see ci.yml). When the browser's tzdata catches up this
 * goes red again from the other side, and the fix then is to move the pin — the date layer
 * answers whatever the browser's own ICU answers, which is what a real browser in the zone
 * would say.
 *
 * Whitespace inside Intl output is normalised before comparing: ICU puts U+202F before
 * AM/PM and the exact code point has moved between releases.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { harness, root, BROWSER, bootSettled } from './harness.mjs';

const headed = process.argv.includes('--headed');
const { assert, eq, section, note, done } = harness();

// One collector, three realms. Returned as strings so nothing depends on structured clone.
const READ_SRC = `(function () {
  var o = {};
  var t = function (k, f) { try { o[k] = String(f()); } catch (e) { o[k] = 'THREW ' + e.name; } };
  var iso = function (x) { return x.toISOString(); };
  var loc = function (x) {
    return x.getFullYear() + '-' + (x.getMonth() + 1) + '-' + x.getDate() + ' ' +
      x.getHours() + ':' + (x.getMinutes() < 10 ? '0' : '') + x.getMinutes();
  };
  // 2026-01-16T02:00Z — Jan 15 21:00 in New York, Jan 16 07:30 in Kolkata: the local
  // date and the UTC date differ, which is the case the setters got wrong.
  var base = 1768528800000;
  t('setDate20', function () { var d = new Date(base); d.setDate(20); return loc(d) + ' | ' + iso(d); });
  t('setMonth5', function () { var d = new Date(base); d.setMonth(5); return loc(d) + ' | ' + iso(d); });
  t('setMonth5_3', function () { var d = new Date(base); d.setMonth(5, 3); return loc(d) + ' | ' + iso(d); });
  t('setFullYear2030', function () { var d = new Date(base); d.setFullYear(2030); return loc(d) + ' | ' + iso(d); });
  t('setFullYear50', function () { var d = new Date(base); d.setFullYear(50); return d.getFullYear() + ' ' + d.getMonth() + ' ' + d.getDate(); });
  t('setFullYearOnNaN', function () { var d = new Date(NaN); d.setFullYear(2020); return loc(d) + ' | ' + iso(d); });
  t('setHours10', function () { var d = new Date(base); d.setHours(10); return loc(d) + ' | ' + iso(d); });
  t('setHours10_15', function () { var d = new Date(base); d.setHours(10, 15); return loc(d) + ' | ' + iso(d); });
  t('setHours0000', function () { var d = new Date(base); d.setHours(0, 0, 0, 0); return loc(d) + ' | ' + iso(d); });
  t('setHours25', function () { var d = new Date(base); d.setHours(25); return loc(d) + ' | ' + iso(d); });
  t('setHoursUndefMin', function () { var d = new Date(base); return String(d.setHours(10, undefined)); });
  t('setMinutes0', function () { var d = new Date(base); d.setMinutes(0); return loc(d) + ' | ' + iso(d); });
  t('setMinutes70', function () { var d = new Date(base); d.setMinutes(70); return loc(d) + ' | ' + iso(d); });
  t('setSeconds5', function () { var d = new Date(base); d.setSeconds(5, 250); return iso(d); });
  t('setMilliseconds7', function () { var d = new Date(base); d.setMilliseconds(7); return iso(d); });
  t('setYear99', function () { var d = new Date(base); d.setYear(99); return loc(d) + ' | ' + iso(d); });
  t('getYear', function () { return new Date(base).getYear(); });
  t('setDateReturn', function () { var d = new Date(base); return d.setDate(20) === d.getTime(); });
  t('setDateNaN', function () { var d = new Date(base); return String(d.setDate('x')); });
  t('ctorWall', function () { var d = new Date(2026, 0, 15, 10, 30); return loc(d) + ' | ' + iso(d); });
  t('ctor2digitYear', function () { var d = new Date(99, 0, 1); return d.getFullYear(); });
  t('parseMDY1985', function () { var d = new Date('5/20/1985'); return loc(d) + ' | ' + iso(d); });
  t('parseMDY1999', function () { var d = new Date('12/25/1999'); return loc(d) + ' | ' + iso(d); });
  t('parseMDY2005', function () { var d = new Date('1/1/2005'); return loc(d) + ' | ' + iso(d); });
  t('parseUnpaddedISO', function () { var d = new Date('2026-1-5'); return loc(d) + ' | ' + iso(d); });
  t('parseLocalISO', function () { var d = new Date('2026-01-15T10:00:00'); return loc(d) + ' | ' + iso(d); });
  t('parseDateOnlyISO', function () { var d = new Date('2026-01-05'); return loc(d) + ' | ' + iso(d); });
  t('DateParseMDY', function () { return Date.parse('5/20/1985') === new Date('5/20/1985').getTime(); });
  var d0 = new Date('2026-01-15T12:00:00Z');
  t('dtfTokyoLong', function () {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', timeZoneName: 'long', hour: 'numeric' })
      .formatToParts(d0).filter(function (p) { return p.type === 'timeZoneName'; })[0].value;
  });
  t('dtfTokyoShortFormat', function () {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', timeZoneName: 'short', hour: 'numeric' }).format(d0);
  });
  t('dtfTokyoResolved', function () { return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo' }).resolvedOptions().timeZone; });
  t('dtfUtcResolved', function () { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().timeZone; });
  t('dtfOurLong', function () {
    return new Intl.DateTimeFormat('en-US', { timeZoneName: 'long', hour: 'numeric' })
      .formatToParts(d0).filter(function (p) { return p.type === 'timeZoneName'; })[0].value;
  });
  t('dtfOurHour', function () { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(d0); });
  t('localeDe', function () { var l = new Intl.Locale('de'); return l.toString() + ' region=' + l.region + ' base=' + l.baseName; });
  t('localeJaMax', function () { return new Intl.Locale('ja').maximize().toString(); });
  t('localeDeAT', function () { return new Intl.Locale('de', { region: 'AT' }).toString(); });
  // [PERF zone-lookup-per-getter] The zone lookup keeps the interval of the last instant it
  // answered for; these instants sit one second either side of every transition of both
  // hemispheres' rules, cross a year boundary, and jump back and forth, so the memo is
  // invalidated on every edge and the answer is still the oracle's. New York: 2026-03-08
  // 07:00Z and 2026-11-01 06:00Z, 2027-03-14 07:00Z. Sydney: 2026-04-04 16:00Z (DST ends),
  // 2026-10-03 16:00Z (DST starts).
  var E = [Date.UTC(2026, 2, 8, 6, 59, 59), Date.UTC(2026, 2, 8, 7), Date.UTC(2026, 10, 1, 5, 59, 59), Date.UTC(2026, 10, 1, 6),
    Date.UTC(2027, 2, 14, 6, 59, 59), Date.UTC(2027, 2, 14, 7), Date.UTC(2025, 11, 31, 23, 59, 59), Date.UTC(2026, 0, 1),
    Date.UTC(2026, 3, 4, 15, 59, 59), Date.UTC(2026, 3, 4, 16), Date.UTC(2026, 9, 3, 15, 59, 59), Date.UTC(2026, 9, 3, 16),
    Date.UTC(2026, 6, 1, 12), Date.UTC(2026, 0, 15, 12), Date.UTC(2026, 6, 1, 12), Date.UTC(2026, 2, 8, 7)];
  // [FIX the-rule-table-was-the-source-of-truth] Inside Morocco's Ramadan break, which the
  // hand-written rule could not model at all — the zone is legally UTC+1 all year and steps
  // back to UTC+0 for a lunar month, so test/tz-icu.mjs carried it as an EXEMPTION for 147
  // days a year. Meaningless for the other profiles, which is the point: the same instant is
  // compared against Node in each of their zones too.
  t('ramadanBreak', function () {
    var d = new Date(Date.UTC(2026, 2, 1, 12));
    return d.getTimezoneOffset() + ' ' + loc(d) + ' ' + (d.toString().match(/GMT[+-]\d{4}/) || [''])[0];
  });
  t('dstEdges', function () {
    return E.map(function (ms) { var d = new Date(ms); return d.getTimezoneOffset() + '/' + d.getHours() + ':' + d.getMinutes() + '/' + d.getDate(); }).join(' ');
  });
  // [FIX the-zone-model-had-no-history] Before 2024 the offset is ICU's for the zone in
  // force, seconds and all — 1113 is LMT everywhere, and CreepJS's timezone test looks
  // +new Date('7/1/1113') up in a table of every zone's LMT epoch.
  t('hist1113', function () { return +new Date('7/1/1113') + ' ' + new Date(1113, 6, 1).getTimezoneOffset(); });
  t('hist1900', function () { var d = new Date(1900, 0, 1, 12); return d.getTimezoneOffset() + ' ' + (d.toString().match(/GMT[+-]\d{4}/) || [''])[0] + ' ' + iso(d); });
  t('hist1970', function () { var d = new Date('07/01/1970'); return d.getTimezoneOffset() + ' ' + d.getHours() + ' ' + iso(d); });
  t('hist2010', function () { var d = new Date(2010, 6, 1, 12); return d.getTimezoneOffset() + ' ' + iso(d) + ' ' + loc(new Date(Date.UTC(2010, 0, 15, 12))); });
  t('creepEpoch', function () {
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    var f = new Intl.DateTimeFormat('en', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    var sys = +new Date('7/1/1113');
    return String(+new Date(f.format(new Date('7/1/1113'))) === sys) + ' ' + sys;
  });
  t('dstEdgesWall', function () {
    return E.map(function (ms) { var d = new Date(ms); var w = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()); return String(w.getTime() - ms); }).join(' ');
  });
  return o;
})()`;

const WORKER_JS = `self.onmessage = function () { postMessage(${READ_SRC}); };\n`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>tz oracle</title></head><body>tz
<script>
window.__w = new Promise(function (res) {
  try {
    var w = new Worker('/w.js');
    w.onmessage = function (e) { res(e.data); };
    w.onerror = function (e) { res('error:' + (e && e.message)); };
    w.postMessage(1);
  } catch (e) { res('threw:' + e.name); }
  setTimeout(function () { res('timeout'); }, 6000);
});
</script></body></html>`;

const server = createServer((q, r) => {
  const u = (q.url || '/').split('?')[0];
  if (u === '/w.js') return r.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' }).end(WORKER_JS);
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/** The same collector, run by Node in `tz` — what a real browser in that zone prints. */
function oracle(tz) {
  const out = execFileSync(process.execPath, ['-e', `console.log(JSON.stringify(${READ_SRC}))`],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  return JSON.parse(out);
}
const norm = (s) => String(s).replace(/[  ]/g, ' ');

const dir = mkdtempSync(path.join(tmpdir(), 'afp-tzo-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER,
  headless: !headed,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

async function measure(n) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?v=${n}`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 600));
  const win = await p.evaluate(READ_SRC);
  const tz = await p.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const worker = await p.evaluate(async () => await window.__w);
  await p.close();
  return { win, worker, tz };
}

function compare(label, zone, got) {
  section(label);
  // MODE CHECK first: a page that is not being spoofed at all would agree with a Node
  // process in the HOST zone and the whole section would measure nothing.
  eq(got.tz, zone, `the window is in the profile zone (${got.tz})`);
  assert(got.worker && typeof got.worker === 'object', `the worker answered (${typeof got.worker === 'object' ? 'ok' : got.worker})`);
  const exp = oracle(zone);
  let wrongWin = 0, wrongWorker = 0;
  for (const k of Object.keys(exp)) {
    const e = norm(exp[k]), w = norm(got.win[k]), wk = norm(got.worker && got.worker[k]);
    if (w !== e) wrongWin++;
    if (wk !== e) wrongWorker++;
    eq(w, e, `window ${k}`);
    eq(wk, e, `worker ${k}`);
  }
  note(`${Object.keys(exp).length} fields — window wrong: ${wrongWin}, worker wrong: ${wrongWorker}`);
}

try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(sw);
  // Warm the origin once so the measured load runs under the settled profile.
  const warm = await ctx.newPage(); await warm.goto(`${BASE}/?warm=1`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500)); await warm.close();

  const st0 = await sw.evaluate(() => chrome.storage.local.get(['afp_country_code']));
  eq(st0.afp_country_code || 'US', 'US', 'the fixture starts on the default country');
  compare('1) profile US — America/New_York, whole-hour offset with DST', 'America/New_York', await measure(1));

  // A half-hour zone: setMinutes and the .5 in setHours only show up here.
  await sw.evaluate(() => chrome.storage.local.set({ afp_country_code: 'IN' }));
  await bootSettled(sw);
  const warm2 = await ctx.newPage(); await warm2.goto(`${BASE}/?warm=2`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500)); await warm2.close();
  compare('2) profile IN — Asia/Kolkata, UTC+5:30, no DST', 'Asia/Kolkata', await measure(2));

  // The southern hemisphere: DST spans the new year, the rule's other branch.
  await sw.evaluate(() => chrome.storage.local.set({ afp_country_code: 'AU' }));
  await bootSettled(sw);
  const warm3 = await ctx.newPage(); await warm3.goto(`${BASE}/?warm=3`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500)); await warm3.close();
  compare('3) profile AU — Australia/Sydney, DST across the new year', 'Australia/Sydney', await measure(3));

  // The zone the report of 2026-09-03 came from — LMT +01:39:00 in 1113, EU rule today.
  await sw.evaluate(() => chrome.storage.local.set({ afp_country_code: 'EE' }));
  await bootSettled(sw);
  const warm4 = await ctx.newPage(); await warm4.goto(`${BASE}/?warm=4`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500)); await warm4.close();
  compare('4) profile EE — Europe/Tallinn, LMT history', 'Europe/Tallinn', await measure(4));

  // The zone no rule table can express: permanent UTC+1 with a lunar-calendar break.
  await sw.evaluate(() => chrome.storage.local.set({ afp_country_code: 'MA' }));
  await bootSettled(sw);
  const warm5 = await ctx.newPage(); await warm5.goto(`${BASE}/?warm=5`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500)); await warm5.close();
  compare('5) profile MA — Africa/Casablanca, the Ramadan break', 'Africa/Casablanca', await measure(5));
} finally {
  await ctx.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  server.close();
}

done();
