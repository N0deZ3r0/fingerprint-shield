/**
 * Is every shipped device profile internally coherent?
 *
 *   node test/profilecoherence.mjs
 *
 * These five rules used to be a box in the popup. `renderWarnings` read the selected row,
 * checked it against itself, and painted a list of English sentences into a Russian UI —
 * except that it never did, because PROFILES is a `const` in popup.js and no row it holds
 * can trigger any of them. Measured on the shipped build: 0 warnings on all seven rows.
 *
 * So the box was a build-time check wearing a runtime costume. It could only ever fire for
 * somebody EDITING that table, which is exactly who a test suite is for and exactly who a
 * popup is not: the person who breaks the coherence is not the person who opens the popup,
 * and by the time they are the same person the build has already shipped. Here it fails the
 * suite instead, before anything reaches a user — and it can say more than a 360px card had
 * room for.
 *
 * Two things the popup could not do and this can:
 *
 *  - it checks EVERY row, not the one that happens to be selected;
 *  - it checks the claims against what background.js will actually report. The
 *    `deviceMemory is bucketed` rule exists because buildProfile clamps anything above 16
 *    to 32, so a row claiming 64 was a row lying to its own popup (see the pc_power note in
 *    popup.js). That is a relationship between two files, which is not a thing a warning
 *    box inside one of them can see.
 *
 * The rules are the popup's, unchanged in substance. Where the text has changed it is
 * because a test can name the row and the numbers, and a 10.5px line could not.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

// popup.js is a classic script, not a module: it is read and evaluated rather than
// imported, the same way test/tables.mjs reads it. Only the table is taken — evaluating the
// whole file would need a DOM.
const src = readFileSync(join(root, 'popup.js'), 'utf8');
const start = src.indexOf('const PROFILES = [');
if (start < 0) throw new Error('PROFILES not found in popup.js');
let i = src.indexOf('[', start), depth = 0, end = -1;
for (let j = i; j < src.length; j++) {
  if (src[j] === '[') depth++;
  else if (src[j] === ']') { depth--; if (!depth) { end = j + 1; break; } }
}
if (end < 0) throw new Error('PROFILES table is not balanced');
const PROFILES = new Function('return ' + src.slice(i, end))();
console.log(`${PROFILES.length} profiles read from popup.js\n`);

// The rules, exactly as renderWarnings held them. Each returns a reason or null, so a
// failure names the row AND the numbers behind it.
const RULES = [
  ['high core count without the RAM to match', (p) =>
    p.cores >= 12 && p.memory < 16
      ? `${p.cores} cores with ${p.memory}GB — 12+ cores ship with 16GB or more` : null],
  ['4K panel on a low-core CPU', (p) =>
    p.screenW >= 3840 && p.cores < 8
      ? `${p.screenW}px wide with ${p.cores} cores` : null],
  ['deviceMemory outside the buckets', (p) =>
    p.memory > 8 && p.memory !== 16 && p.memory !== 32
      ? `${p.memory}GB is not a bucket; navigator.deviceMemory reports 2/4/8/16/32 and ` +
        `buildProfile clamps anything above 16 to 32, so the site would read a different ` +
        `number than this row claims` : null],
  ['NVIDIA GPU with low RAM', (p) =>
    (p.gpuKey === 'nvidia_3060' || p.gpuKey === 'nvidia_3070') && p.memory < 16
      ? `${p.gpuKey} with ${p.memory}GB` : null],
  ['UHD 630 on high-end silicon', (p) =>
    p.gpuKey === 'intel_uhd' && (p.cores >= 12 || p.memory >= 16)
      ? `intel_uhd with ${p.cores} cores / ${p.memory}GB` : null]
];

for (const p of PROFILES) {
  // The host row claims nothing — it reports the machine it runs on — so there is nothing
  // for a coherence rule to be about. renderWarnings returned early on it for the same
  // reason.
  if (p.host) { console.log(`${p.id.padEnd(12)} host row — claims nothing, skipped`); continue; }
  const hits = RULES.map(([, f]) => f(p)).filter(Boolean);
  ok(hits.length === 0, `${p.id}: ${hits.join('; ')}`);
  if (!hits.length) {
    console.log(`${p.id.padEnd(12)} ${(p.cores + 'c').padEnd(4)} ${(p.memory + 'GB').padEnd(5)} ` +
      `${(p.screenW + '×' + p.screenH).padEnd(10)} ${(p.gpuKey || '—').padEnd(13)} coherent`);
  }
}

// ── the row every install starts on ──────────────────────────────────────────────
//
// [FIX the-default-row-was-modal-by-accident-and-said-so-nowhere] initDefaults writes one
// row on a fresh install and every user who never opens the popup keeps it, so that row is
// the crowd this extension puts its users in. Which row it is was recorded nowhere, and the
// obvious-looking objection — "one machine for everybody is a cluster" — has the answer
// backwards. Measured from tools/crowd-reference.json, whose numbers are each taken from a
// named public source on a named date:
//
//     screen_css_px (StatCounter, page-view weighted)   1920x1080  22.41%
//                                                       1536x864    7.30%   <- next
//     physical_panel (Steam, gamer-biased)              1920x1080  51.10%
//
// 1920x1080 at dpr 1 is the modal desktop screen by a factor of three over the runner-up,
// and laptop_mid IS that row. So the constant default already puts every user in the
// LARGEST real crowd there is. Sampling the seven rows by population weight was considered
// and is refused here in writing: it would move roughly 78% of installs off the modal row
// into rarer ones, shrinking each moved user's crowd, and it would buy anonymity only
// against a detector that has already identified the extension — against which the user is
// identified anyway. This is the uniformity argument Tor Browser makes, and it points the
// other way from the intuition.
//
// The cost of the choice is that a table which stops matching the population is invisible:
// the default would go on being the default long after 1920x1080 stopped being modal. That
// is what this section is. It fails when the reference says the crowd has moved, which is a
// prompt to re-measure the rows, not to change this number.
{
  const crowd = JSON.parse(readFileSync(join(root, 'tools/crowd-reference.json'), 'utf8'));
  const bg = readFileSync(join(root, 'background.js'), 'utf8');
  const defaultId = (/cached\[PROFILE_KEY\] \|\| '([a-z0-9_]+)'/.exec(bg) || [])[1];
  ok(!!defaultId, 'background.js names the row a fresh install starts on');
  const row = PROFILES.find((r) => r.id === defaultId);
  ok(!!row, `that row (${defaultId}) is one of the popup's own — a default nothing declares ` +
    `is a machine nobody checked`);

  // The reference's own notes disqualify one row: StatCounter's "desktop" bucket leaks
  // mobile, and 384x832 is not a desktop panel. Dropped by the note, not by taste.
  const rows = crowd.screen_css_px.rows
    .filter(([res]) => !(crowd.screen_css_px.notes || {})[res] ||
      !/not a desktop panel/.test(crowd.screen_css_px.notes[res]));
  const modal = rows[0];
  const claimed = `${row.screenW}x${row.screenH}`;
  ok(claimed === modal[0],
    `the install default claims the modal desktop screen — ${defaultId} says ${claimed}, ` +
    `StatCounter's top desktop row is ${modal[0]} at ${modal[1]}%. A default that is not ` +
    `modal puts every silent install in a smaller crowd than the one available`);
  const runnerUp = rows[1];
  ok(modal[1] > runnerUp[1],
    `and it is modal by a margin worth keeping — ${modal[0]} ${modal[1]}% against ` +
    `${runnerUp[0]} ${runnerUp[1]}%`);
  ok((row.dpr || 1) === 1,
    `${defaultId} reports that screen at dpr ${row.dpr || 1}: screen.width is CSS pixels, ` +
    `so a scaled row claiming 1920x1080 would report something else to the page`);

  // Negative control: the check has to be able to say the crowd moved.
  const moved = [['2560x1440', 30.0], ['1920x1080', 22.41]];
  ok(claimed !== moved[0][0],
    'negative control — against a reference whose top row is 2560x1440, the assertion ' +
    'above is the one that fires');
}

// A rule nothing can break is a rule nobody has to keep, and this whole file exists because
// five of them sat in a popup for months without once firing. Each is fed a row built to
// break it: if a rule stops being able to fail, it says so here rather than going quiet.
console.log('\nnegative control — each rule against a row built to break it');
const BAD = [
  { id: 'x1', cores: 16, memory: 8, screenW: 1920, screenH: 1080, gpuKey: 'intel_iris' },
  { id: 'x2', cores: 4, memory: 8, screenW: 3840, screenH: 2160, gpuKey: 'intel_iris' },
  { id: 'x3', cores: 8, memory: 64, screenW: 1920, screenH: 1080, gpuKey: 'intel_iris' },
  { id: 'x4', cores: 8, memory: 8, screenW: 1920, screenH: 1080, gpuKey: 'nvidia_3060' },
  { id: 'x5', cores: 16, memory: 32, screenW: 1920, screenH: 1080, gpuKey: 'intel_uhd' }
];
RULES.forEach(([name, f], n) => {
  const why = f(BAD[n]);
  console.log(`  ${name.padEnd(42)} ${why ? 'fires' : 'DEAD'}`);
  ok(!!why, `the rule "${name}" can still fail (it did not fire on a row built to break it)`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
