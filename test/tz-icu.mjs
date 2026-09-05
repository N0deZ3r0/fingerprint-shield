/**
 * Timezone/DST truth test.
 *
 *   node test/tz-icu.mjs
 *
 * Why this exists: DST used to be decided by sniffing the zone id (Europe/ -> EU rule,
 * America/ -> US rule, everything else -> a generic "northern summer" month range), and
 * that guess was made TWICE — once in mw/mw-timezone-screen.js for the window, once in
 * mw/mw-workers.js for the worker payload — with the two copies disagreeing. Eight of the
 * 67 selectable countries reported a wrong UTC offset and five of them reported a
 * DIFFERENT wrong offset in the window than in a Worker, which is exactly the kind of
 * self-contradiction the extension exists to avoid.
 *
 * This test does three things, and it runs the SHIPPED code rather than a copy of it:
 * the rule engines are extracted textually from the two source files and evaluated here.
 *
 *   1. the worker's _TZ_ZONE table mirrors the window's ZONE_DATA field for field;
 *   2. every country the popup offers resolves in both tables;
 *   3. both engines agree with real ICU, day by day, for every shipped zone.
 *
 * The one accepted divergence is named in EXEMPT below.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0, passed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { console.error('FAIL:', msg); failed++; }
}

/** Africa/Casablanca is modelled as permanent UTC+1. Morocco is legally UTC+1 all year
 *  but suspends it for Ramadan, which moves ~11 days a year on the lunar calendar.
 *  Modelling that needs a Hijri calendar in both the window and the worker payload; the
 *  approximation is right ~330 days a year and is IDENTICAL in both scopes, which is the
 *  property that actually matters here. Listed so the exemption stays deliberate. */
const EXEMPT = { 'Africa/Casablanca': 'Ramadan break (lunar) not modelled — permanent UTC+1' };

function balanced(src, re, open, close) {
  const i = src.search(re);
  if (i < 0) throw new Error('not found: ' + re);
  const b = src.indexOf(open, i);
  let d = 0, j = b;
  for (; j < src.length; j++) {
    if (src[j] === open) d++;
    else if (src[j] === close) { d--; if (!d) break; }
  }
  return src.slice(b, j + 1);
}
/** Pull a named function declaration out of a source file, braces balanced. */
function fnText(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found: ' + name);
  const b = src.indexOf('{', i);
  let d = 0, j = b;
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) break; }
  }
  return src.slice(i, j + 1);
}

const tzsSrc = read('mw/mw-timezone-screen.js');
const wrkSrc = read('mw/mw-workers.js');
const bgSrc = read('background.js');
const popupSrc = read('popup.js');

const ZONE_DATA = eval('(' + balanced(tzsSrc, /var ZONE_DATA =/, '{', '}') + ')');
const TZ_ZONE = eval('(' + balanced(wrkSrc, /var _TZ_ZONE = \{/, '{', '}') + ')');
const COUNTRY_DATA = eval('(' + balanced(bgSrc, /const COUNTRY_DATA =/, '{', '}') + ')');
const COUNTRIES = eval(balanced(popupSrc, /const COUNTRIES =/, '[', ']'));

// ---- 1) the two tables must mirror each other ------------------------------
console.log('=== 1) worker _TZ_ZONE mirrors window ZONE_DATA ===');
const zKeys = Object.keys(ZONE_DATA), wKeys = Object.keys(TZ_ZONE);
assert(zKeys.length === wKeys.length, `same zone count (window ${zKeys.length}, worker ${wKeys.length})`);
for (const tz of zKeys) {
  const z = ZONE_DATA[tz], w = TZ_ZONE[tz];
  if (!w) { assert(false, `worker table missing ${tz}`); continue; }
  assert(w[0] === z.base, `${tz} base (window ${z.base}, worker ${w[0]})`);
  assert(w[1] === z.r, `${tz} rule (window ${z.r}, worker ${w[1]})`);
  assert(w[2] === z.std, `${tz} std label`);
  assert(w[3] === z.dst, `${tz} dst label`);
  assert(z.r !== 0 || z.std === z.dst, `${tz} has no DST rule so std must equal dst`);
}
for (const tz of wKeys) assert(!!ZONE_DATA[tz], `window table missing ${tz} (present in worker)`);

// ---- 2) every selectable country resolves -----------------------------------
console.log('=== 2) every selectable country resolves in both tables ===');
for (const c of COUNTRIES) {
  const cd = COUNTRY_DATA[c.code];
  assert(!!cd, `COUNTRY_DATA has ${c.code}`);
  if (!cd) continue;
  assert(cd.tz === c.tz, `${c.code} tz agrees between popup and background`);
  assert(!!ZONE_DATA[cd.tz], `ZONE_DATA has ${cd.tz} (${c.code})`);
  assert(!!TZ_ZONE[cd.tz], `_TZ_ZONE has ${cd.tz} (${c.code})`);
}

// ---- 3) run the SHIPPED engines against ICU ---------------------------------
// window: isDSTByRule + its two date helpers, with the module's OrigDate aliases bound
// [PERF zone-lookup-per-getter] The shipped window path is _dstAt — the year's bounds once,
// then the interval of the last instant answered — and isDSTByRule is the reference it is
// derived from. Both are lifted here and run side by side: a bounds formula that drifted
// from the reference would show as a daily disagreement long before any suite in a browser
// noticed. `ref` is the reference, `fast` the shipped path; `fast` takes the zone record
// itself, because the memo is keyed on its identity and a fresh object per call would
// never exercise it.
const winEngine = new Function(
  'OrigDate', 'OrigDateUTC',
  [fnText(tzsSrc, 'nthDowUTC'), fnText(tzsSrc, 'lastDowUTC'), fnText(tzsSrc, 'isDSTByRule'),
    fnText(tzsSrc, '_dstBounds'), fnText(tzsSrc, '_dstAt'),
    'var _dstMemo = { zd: null, lo: 0, hi: 0, dst: false };',
    'return { ref: isDSTByRule, fast: _dstAt };'].join('\n')
)(Date, Date.UTC);

// worker: the same, lifted out of _tzShim, which takes BASE/RULE as parameters — isDstAt is
// the memoised path there too, so _dstBounds and the memo come with it.
const shim = fnText(wrkSrc, '_tzShim');
const wrkEngine = new Function(
  'BASE', 'RULE',
  [fnText(shim, 'nthDow'), fnText(shim, 'lastDow'), fnText(shim, '_dstBounds'),
    'var _dstMemo = { lo: 0, hi: 0, dst: false };', fnText(shim, 'isDstAt'),
    'return isDstAt;'].join('\n')
);

function icuOffset(tz, ts) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(new Date(ts));
  const v = p.find((x) => x.type === 'timeZoneName').value;
  const m = /GMT([+-])(\d\d):(\d\d)/.exec(v);
  return m ? (m[1] === '-' ? 1 : -1) * (+m[2] * 60 + +m[3]) : 0;
}

console.log('=== 3) both engines vs real ICU, daily, 2024-2027 ===');
let checked = 0;
for (const tz of zKeys) {
  const { base, r } = ZONE_DATA[tz];
  const zd = { r, base };
  const wrkIsDst = wrkEngine(base, r);
  let icuBad = 0, splitBad = 0, memoBad = 0, firstBad = '';
  for (let y = 2024; y <= 2027; y++) {
    for (let d = 0; d < 366; d++) {
      const ts = Date.UTC(y, 0, 1 + d, 12, 0, 0);
      if (new Date(ts).getUTCFullYear() !== y) break;
      checked++;
      const win = base + (winEngine.fast(zd, ts) ? -60 : 0);
      const ref = base + (winEngine.ref(r, base, ts) ? -60 : 0);
      const wrk = base + (wrkIsDst(ts) ? -60 : 0);
      if (win !== ref) memoBad++;
      if (win !== wrk) splitBad++;
      const real = icuOffset(tz, ts);
      if (win !== real) {
        icuBad++;
        if (!firstBad) firstBad = `${new Date(ts).toISOString().slice(0, 10)} real=${real} got=${win}`;
      }
    }
  }
  // A window/worker split is never acceptable, exemption or not: that is the signal a
  // detector reads by comparing the two scopes.
  assert(memoBad === 0, `${tz}: the memoised lookup agrees with the reference rule (${memoBad} days differ)`);
  assert(splitBad === 0, `${tz}: window and worker agree (${splitBad} days differ)`);
  if (EXEMPT[tz]) {
    assert(icuBad > 0, `${tz}: still exempt for a reason — ${EXEMPT[tz]}`);
    console.log(`  note ${tz}: ${icuBad} day(s) off ICU, exempt (${EXEMPT[tz]})`);
  } else {
    assert(icuBad === 0, `${tz}: matches ICU every day${firstBad ? ' — first miss ' + firstBad : ''}`);
  }
}

// ---- 4) the ICU path itself, which now answers for every instant ------------
// [FIX the-rule-table-was-the-source-of-truth] The rule engines above are the FALLBACK now;
// what the page actually reads comes from _icuZoneAt, which finds a year's transitions from
// ICU (twelve month samples, then a binary search to the minute) and caches the intervals.
// A search that missed a transition would answer with the neighbouring offset — right for
// most of the year and wrong for weeks — so it is compared with ICU directly: once a day
// across the year, and every ten minutes for two hours either side of every transition it
// claims to have found. Node's ICU is Chrome's, which is what makes this checkable outside
// a browser at all.
console.log('\n=== 4) the ICU interval search vs ICU itself ===');
{
  const icu = new Function('OrigDate', 'OrigDateUTC', 'OrigDTF', '_ftp',
    ['var _icuFmt = {}, _icuMemo = new Map(), _icuYears = {};',
      'var _ICU_MIN_YEAR = -270000, _ICU_MAX_YEAR = 270000;',
      fnText(tzsSrc, '_icuOffsetAt'), fnText(tzsSrc, '_icuTransition'),
      fnText(tzsSrc, '_icuYearIntervals'),
      'var _icuLast = { tz: null, lo: 0, hi: 0, off: 0 };',
      fnText(tzsSrc, '_icuZoneAt'),
      'return { at: _icuZoneAt, intervals: _icuYearIntervals };'].join('\n')
  )(Date, Date.UTC, Intl.DateTimeFormat, Intl.DateTimeFormat.prototype.formatToParts);

  // Four transitions in one year (Morocco's Ramadan pair), a zone that dropped DST, both
  // hemispheres, two LMT years, and a zone that changed its rule outright.
  const CASES = [
    ['Africa/Casablanca', 2024], ['Africa/Casablanca', 2025], ['Asia/Tehran', 2022],
    ['Australia/Sydney', 2026], ['America/Santiago', 2026], ['Asia/Kolkata', 1941],
    ['Europe/Tallinn', 1113], ['Europe/Tallinn', 2026], ['America/New_York', 1113],
    ['Europe/Moscow', 2011], ['Pacific/Apia', 2011],
  ];
  let probed = 0;
  for (const [tz, y] of CASES) {
    const iv = icu.intervals(tz, y);
    assert(!!iv, `${tz} ${y}: the year's intervals were found`);
    if (!iv) continue;
    const yLo = Date.UTC(y, 0, 1), yHi = Date.UTC(y + 1, 0, 1);
    const probes = [];
    // Every six hours across the year catches an interval the search MISSED entirely; ten
    // minutes either side of each boundary it claims catches one it merely misplaced.
    for (let d = yLo; d < yHi; d += 21600000) probes.push(d);
    for (const seg of iv) for (let t = seg.lo - 7200000; t <= seg.lo + 7200000; t += 600000) probes.push(t);
    let bad = 0, first = '';
    for (const ts of probes) {
      if (ts < yLo || ts >= yHi) continue;
      probed++;
      const got = icu.at(tz, ts), real = icuOffset(tz, ts);
      // icuOffset reads whole minutes off a longOffset name while the search keeps the
      // seconds an LMT offset carries, so they are compared as the browser truncates them.
      if (Math.trunc(got) !== Math.trunc(real)) {
        bad++;
        if (!first) first = `${new Date(ts).toISOString()} real=${real} got=${got}`;
      }
    }
    assert(bad === 0, `${tz} ${y}: the interval search agrees with ICU at every probe (${iv.length} interval(s))${first ? ' — first miss ' + first : ''}`);
  }
  console.log(`  ${probed} instants checked across ${CASES.length} zone-years`);
  // Morocco really does break for Ramadan — without it the cases above would be passing on
  // zones that never exercise the multi-interval path at all. Three intervals: UTC+1, the
  // break at UTC+0, UTC+1 again, and the break is a lunar month, which is what the search has
  // to find while knowing nothing about the lunar calendar.
  const ma = icu.intervals('Africa/Casablanca', 2024);
  assert(ma && ma.length === 3, `Africa/Casablanca 2024 is three intervals — UTC+1, the Ramadan break, UTC+1 (got ${ma ? ma.length : 0})`);
  const maSpan = ma && ma.length === 3 ? Math.round((ma[2].lo - ma[1].lo) / 86400000) : 0;
  assert(maSpan >= 28 && maSpan <= 40, `and the break is a lunar month long (${maSpan} days)`);
}

console.log(`\n=== summary === (${checked} zone-days checked)`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
