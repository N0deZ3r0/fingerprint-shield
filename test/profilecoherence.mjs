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
