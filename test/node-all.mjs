/**
 * Pure Node regression suite (no Chrome / Playwright required).
 *
 *   node test/node-all.mjs
 *
 * Covers: syntax of key JS, static parity markers, defaults keys,
 * worker _tzShim Date/DST for several zones.
 *
 * Does NOT cover: real Worker + OffscreenCanvas + extension inject in Chrome.
 * For that: open dev-worker-patch.html in Chrome with the extension loaded,
 * or: npm i && npx playwright install chromium && node test/run.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
let passed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('PASS:', msg);
    passed++;
  }
}

console.log('=== 1) syntax (node --check) ===');
for (const f of [
  'mw/mw-workers.js',
  'mw/mw-navigator.js',
  'mw/mw-timezone-screen.js',
  'background.js',
  'defaults.js',
  'mw/mw-core.js',
  'mw/mw-misc.js',
]) {
  try {
    execSync(`node --check "${path.join(root, f)}"`, { stdio: 'pipe' });
    assert(true, `syntax ${f}`);
  } catch (e) {
    assert(false, `syntax ${f}: ${e.message}`);
  }
}

console.log('\n=== 2) static parity markers ===');
const nav = read('mw/mw-navigator.js');
const workers = read('mw/mw-workers.js');
const bg = read('background.js');
const tz = read('mw/mw-timezone-screen.js');
const manifest = read('manifest.json');

assert(nav.includes('iframe-full-parity'), 'iframe-full-parity');
assert(nav.includes('_patchFrameNavScreen'), '_patchFrameNavScreen');
assert(nav.includes('BatteryManager'), 'iframe battery');
assert(nav.includes('speechVoices'), 'iframe speech');
assert(workers.includes('stealth-worker-parity'), 'stealth-worker-parity');
assert(workers.includes('_stealthParityOnly'), '_stealthParityOnly');
assert(!/if\s*\(\s*_sm\s*\)\s*return\s*;/.test(workers), 'no stealth early-return');
assert(workers.includes('worker-date-api-parity'), 'worker-date-api-parity');
assert(workers.includes('Date.prototype.getHours'), 'Date.getHours in worker');
assert(workers.includes('Date.prototype.toString'), 'Date.toString in worker');
assert(workers.includes('_tzShim.toString()'), 'tzShim emitted');
assert(tz.includes('locale-empty-always-ours'), 'locale-empty-always-ours');
assert(bg.includes('allFrames: true'), 'injectProfile allFrames');
assert(bg.includes('viewport-ch-not-screen'), 'viewport-ch-not-screen');
assert(!/header:\s*'viewport-width'/.test(bg), 'no viewport-width header set');
assert(manifest.includes('"all_frames": true') || manifest.includes('"all_frames":true'), 'manifest all_frames');

console.log('\n=== 3) defaults ↔ core ===');
try {
  execSync(`node "${path.join(root, 'test-defaults.cjs')}"`, { stdio: 'inherit' });
  assert(true, 'test-defaults.cjs');
} catch {
  assert(false, 'test-defaults.cjs');
}

console.log('\n=== 4) worker _tzShim Date/DST (offline) ===');
const src = read('mw/mw-workers.js');
// Extracted by balancing braces rather than by matching whatever text happens to follow.
// The old pattern ended at "\n        }\n\n        function _buildPatchCode", so it broke
// the moment a comment was written above _buildPatchCode — a test that fails because of a
// comment is a test measuring the wrong thing. Same helper shape as fnText in tz-icu.mjs.
function fnText(s, name) {
  const i = s.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const b = s.indexOf('{', i);
  let d = 0, j = b;
  for (; j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) break; }
  }
  return d === 0 ? s.slice(i, j + 1) : null;
}
const shimSrc = fnText(src, '_tzShim');
assert(!!shimSrc, 'extract _tzShim');
if (shimSrc) {
  const _M = (fn) => fn;

  // [FIX dst-rules-were-guessed-from-the-tz-prefix] _tzShim used to take
  // (BASE, NO_DST, IS_EU, IS_US, IS_AU, TZ, _M) — three booleans this test had to
  // restate by hand for every zone, i.e. the test asserted against its own idea of the
  // rules rather than the shipped one. It now takes (BASE, RULE, STD, DST, TZ, _M) and
  // every value comes out of the _TZ_ZONE table in mw/mw-workers.js, so a wrong row in
  // that table fails here instead of being papered over by a correct literal.
  // Exhaustive offset coverage for all zones lives in test/tz-icu.mjs; what this block
  // adds is that the patched Date.prototype methods really produce those answers.
  const zoneTable = (() => {
    const t = src.match(/var _TZ_ZONE = (\{[\s\S]*?\n        \});/);
    assert(!!t, 'extract _TZ_ZONE');
    return t ? eval('(' + t[1] + ')') : {};
  })();

  // Isolate Date methods: apply shim, assert, we don't restore (process exits).
  function runZone(name, cases) {
    const row = zoneTable[name];
    assert(!!row, `_TZ_ZONE has ${name}`);
    if (!row) return;
    const [base, rule, std, dst] = row;
    // Re-eval shim for this zone (overwrites Date.prototype again)
    eval(shimSrc + `\n_tzShim(${base},${rule},${JSON.stringify(std)},${JSON.stringify(dst)},${JSON.stringify(name)},_M);`);
    for (const c of cases) {
      const d = new Date(c.iso);
      assert(d.getTimezoneOffset() === c.off, `${name} offset ${c.iso} → ${d.getTimezoneOffset()} (want ${c.off})`);
      if (c.hours != null) {
        assert(d.getHours() === c.hours, `${name} hours ${c.iso} → ${d.getHours()} (want ${c.hours})`);
      }
      if (c.namePart) {
        assert(d.toString().includes(c.namePart), `${name} toString has "${c.namePart}"`);
      }
    }
  }

  // Europe/Tallinn: UTC+2 / UTC+3 → offset -120 / -180
  runZone('Europe/Tallinn', [
    { iso: '2025-01-15T12:00:00Z', off: -120, hours: 14, namePart: 'Eastern European Standard Time' },
    { iso: '2025-07-15T12:00:00Z', off: -180, hours: 15, namePart: 'Eastern European Summer Time' },
    { iso: '2025-03-30T00:30:00Z', off: -120 },
    { iso: '2025-03-30T01:30:00Z', off: -180 },
    { iso: '2025-10-26T00:30:00Z', off: -180 },
    { iso: '2025-10-26T01:30:00Z', off: -120 },
  ]);

  // Europe/Berlin: UTC+1 / UTC+2 → offset -60 / -120
  runZone('Europe/Berlin', [
    { iso: '2025-01-15T12:00:00Z', off: -60, hours: 13, namePart: 'Central European Standard Time' },
    { iso: '2025-07-15T12:00:00Z', off: -120, hours: 14, namePart: 'Central European Summer Time' },
  ]);

  // America/New_York: UTC-5 / UTC-4 → offset 300 / 240
  runZone('America/New_York', [
    { iso: '2025-01-15T12:00:00Z', off: 300, hours: 7, namePart: 'Eastern Standard Time' },
    { iso: '2025-07-15T12:00:00Z', off: 240, hours: 8, namePart: 'Eastern Daylight Time' },
  ]);

  // Zones whose DST rule was wrong before the rule-table fix — kept here so a
  // regression shows up in the offline suite too, not only in test/tz-icu.mjs.
  runZone('Europe/Istanbul', [
    { iso: '2025-01-15T12:00:00Z', off: -180, hours: 15, namePart: 'Turkey Standard Time' },
    { iso: '2025-07-15T12:00:00Z', off: -180, hours: 15, namePart: 'Turkey Standard Time' },
  ]);
  runZone('America/Mexico_City', [
    { iso: '2025-01-15T12:00:00Z', off: 360, hours: 6, namePart: 'Central Standard Time' },
    { iso: '2025-07-15T12:00:00Z', off: 360, hours: 6, namePart: 'Central Standard Time' },
  ]);
  // Southern hemisphere: DST in the local summer, i.e. around January
  runZone('America/Santiago', [
    { iso: '2025-01-15T12:00:00Z', off: 180, hours: 9, namePart: 'Chile Summer Time' },
    { iso: '2025-07-15T12:00:00Z', off: 240, hours: 8, namePart: 'Chile Standard Time' },
  ]);
  runZone('Pacific/Auckland', [
    { iso: '2025-01-15T12:00:00Z', off: -780, namePart: 'New Zealand Daylight Time' },
    { iso: '2025-07-15T12:00:00Z', off: -720, namePart: 'New Zealand Standard Time' },
  ]);

  // Asia/Tokyo: no DST, UTC+9 → -540
  runZone('Asia/Tokyo', [
    { iso: '2025-01-15T12:00:00Z', off: -540, hours: 21, namePart: 'Japan Standard Time' },
    { iso: '2025-07-15T12:00:00Z', off: -540, hours: 21, namePart: 'Japan Standard Time' },
  ]);
}

// [FIX feature-flags-arrived-three-hops-late] 'v.ui.f' is written by three files and read
// by one. defaults.js owns the packing for the two that can load it; mw/mw-core.js
// re-implements it because the MAIN world cannot importScripts. test-defaults.cjs already
// pins the two KEY LISTS to each other — what it cannot see is whether the bit arithmetic
// on either side agrees, and an off-by-one there would silently turn "canvas off" into
// "webgl off". So: pack with the shared function, decode with mw-core's OWN key order,
// and require every flag to come back.
{
  const defaultsSrc = read('defaults.js');
  const packFn = new Function(defaultsSrc + '\n;return { afpPackFeatures, AFP_DEFAULT_FEATURES };')();
  const coreLit = read('mw/mw-core.js').match(/var d = \{([^}]+)\}/s);
  assert(!!coreLit, 'extract the _FEAT defaults literal from mw-core');
  const coreKeys = [];
  if (coreLit) {
    coreLit[1].split(',').forEach((line) => {
      const m = line.match(/(\w+)\s*:\s*(true|false)/);
      if (m) coreKeys.push(m[1]);
    });
  }
  // mw-core reads back with: bits = parseInt(packed, 36); d[key[i]] = !!(bits & (1 << i))
  const unpackAsCore = (packed) => {
    const bits = parseInt(packed, 36);
    const out = {};
    coreKeys.forEach((k, i) => { out[k] = !!(bits & (1 << i)); });
    return out;
  };
  const CASES = {
    'all on': Object.fromEntries(coreKeys.map((k) => [k, true])),
    'all off': Object.fromEntries(coreKeys.map((k) => [k, false])),
    defaults: packFn.AFP_DEFAULT_FEATURES,
    'canvas off only': { ...packFn.AFP_DEFAULT_FEATURES, canvas: false },
    'clientRects on only': { ...packFn.AFP_DEFAULT_FEATURES, clientRects: true }
  };
  for (const [label, feats] of Object.entries(CASES)) {
    const back = unpackAsCore(packFn.afpPackFeatures(feats));
    const wrong = coreKeys.filter((k) => back[k] !== feats[k]);
    assert(wrong.length === 0, `v.ui.f round-trips through mw-core's key order — ${label}${wrong.length ? ' (differs: ' + wrong.join(',') + ')' : ''}`);
  }
  assert(coreKeys.length === Object.keys(packFn.AFP_DEFAULT_FEATURES).length,
    `both sides pack the same number of flags (${coreKeys.length})`);
  // 13 flags must stay inside a 32-bit shift; a 33rd would silently wrap.
  assert(coreKeys.length < 31, 'the flag count still fits the bitmask');
}

console.log('\n=== summary ===');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
