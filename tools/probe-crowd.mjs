/**
 * HOW BIG IS THE CROWD THIS PUTS YOU IN?
 *
 *   node tools/probe-crowd.mjs           the summary
 *   node tools/probe-crowd.mjs --full    every field, every value
 *
 * The suites in test/ ask, about four thousand times, whether this build contradicts
 * itself. That is the right question for a spoof and it is thoroughly answered. It is not
 * the goal. The goal is that the person using this is hard to pick out of a crowd, and
 * NOTHING here has ever measured the crowd.
 *
 * Those are different properties, and they can point in opposite directions: a perfectly
 * coherent machine that only this extension presents is a perfect fingerprint. So this
 * reads the SHIPPED data — the generated dyn/dev rows, data/countries.json, and the tables
 * background.js and popup.js actually use — and answers three questions with arithmetic
 * rather than opinion.
 *
 *   1. HOW MANY MACHINES CAN IT PRESENT? Every distinct claim the extension is capable of
 *      making, and the bits that represents. This is the ceiling on how much a user can be
 *      told apart from ANOTHER USER OF THIS EXTENSION by the claim alone.
 *
 *   2. WHAT DOES EVERY USER SHARE? The fields that take the same value across every single
 *      combination. Those are not entropy — they are the opposite. A field that is constant
 *      across all users of this extension, and variable in the real population, is a
 *      signature of the extension itself. This is the number the project has never had.
 *
 *   3. WHERE IS THE ENTROPY? Which fields actually carry the distinctions, so the answer to
 *      "add more profiles" can be aimed rather than guessed.
 *
 *   4. HOW ORDINARY IS EACH CLAIM? Added 2026-08-30, when the reference this file used to
 *      refuse to invent was finally MEASURED instead: tools/crowd-reference.json, every
 *      number off a named public source on a named date. The rule did not change — a wrong
 *      reference is still worse than none — so nothing there is interpolated, the truncated
 *      tables say where they stop, and the two questions the sources cannot answer (GPU
 *      share on the general web, logical core counts) are printed as open rather than
 *      guessed at.
 */
import fs from 'node:fs';
import path from 'node:path';
import { root, loadPopup, loadBackground } from '../test/harness.mjs';

const FULL = process.argv.includes('--full');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// The generated rows, not a copy of them: whatever gen-dyn wrote is what ships, and if the
// two ever disagree test/parity-static.mjs already turns red.
const devices = fs.readdirSync(path.join(root, 'dyn/dev'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => JSON.parse(/value: (\{[\s\S]*\}),\n/.exec(read(`dyn/dev/${f}`))[1]))
  // "This machine" is not a claim and has no row in any population table: it puts the
  // user in the crowd of everyone with the same hardware, which is the size of the real
  // population and not of this set. Left out of the arithmetic, named at the end.
  .filter((d) => !d.host);

const countries = JSON.parse(read('data/countries.json'));
const { PROFILES } = loadPopup(['PROFILES']);
const { GPU_DATA } = loadBackground(['GPU_DATA']);

// One row per combination the popup can produce: what a site reads, flattened. Only fields
// a page can actually observe — the id and the internal keys are not claims about a machine.
const rows = [];
for (const d of devices) {
  for (const [cc, c] of Object.entries(countries)) {
    rows.push({
      'screen.width': d.screenW,
      'screen.height': d.screenH,
      'screen (pair)': `${d.screenW}x${d.screenH}`,
      'devicePixelRatio': d.dpr,
      'hardwareConcurrency': d.cores,
      'deviceMemory': d.memory,
      'navigator.platform': d.platform,
      'webgl.vendor': d.glVendor,
      'webgl.renderer': d.glRenderer,
      'webgl.params (19 values)': JSON.stringify(d.glParams),
      'webgl.maxAnisotropy': d.glMaxAniso,
      'webgpu.vendor': d.gpuVendor,
      'webgpu.architecture': d.gpuArch,
      'webgpu.device': d.gpuDevice,
      'webgpu.description': d.gpuDesc,
      'navigator.bluetooth present': d.bluetooth,
      'timezone': c.tz,
      'locale': c.loc,
      'accept-language': c.lang,
      'geolocation (lat,lon)': `${c.lat},${c.lon}`,
      'country': cc,
    });
  }
}

const FIELDS = Object.keys(rows[0]);
const values = {};
for (const f of FIELDS) {
  const m = new Map();
  for (const r of rows) m.set(String(r[f]), (m.get(String(r[f])) || 0) + 1);
  values[f] = m;
}

const bits = (n) => (n > 0 ? Math.log2(n) : 0);
const combos = new Set(rows.map((r) => FIELDS.map((f) => r[f]).join(''))).size;

console.log(`\n${devices.length} device rows x ${Object.keys(countries).length} countries ` +
  `= ${rows.length} combinations, ${combos} of them distinct`);
console.log(`So the claim itself carries at most ${bits(combos).toFixed(1)} bits — that is the ` +
  `ceiling on telling\none user of this extension apart from another BY THE CLAIM. ` +
  `Everything below is where those bits are.`);

// ---- 2. what every user shares -------------------------------------------
const constant = FIELDS.filter((f) => values[f].size === 1);
console.log(`\n### THE SAME FOR EVERY USER (${constant.length} of ${FIELDS.length} fields)`);
console.log('Not entropy — the opposite. A field constant across every combination this');
console.log('extension can produce, and variable in the real population, is a signature OF');
console.log('the extension. Judge each: is the real population constant here too?\n');
for (const f of constant) {
  console.log(`   ${f.padEnd(26)} ${String([...values[f].keys()][0]).slice(0, 60)}`);
}

// ---- 3. where the entropy is ---------------------------------------------
const varying = FIELDS.filter((f) => values[f].size > 1)
  .sort((a, b) => values[b].size - values[a].size);
console.log(`\n### WHERE THE DISTINCTIONS ARE (${varying.length} fields)`);
for (const f of varying) {
  const m = values[f];
  const spread = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const top = spread[0];
  console.log(`   ${f.padEnd(26)} ${String(m.size).padStart(3)} values, ` +
    `${bits(m.size).toFixed(1).padStart(4)} bits   ` +
    `commonest: ${String(top[0]).slice(0, 34)} (${((top[1] / rows.length) * 100).toFixed(0)}%)`);
  if (FULL && m.size <= 12) {
    for (const [v, n] of spread) console.log(`        ${String(v).slice(0, 70)}  x${n}`);
  }
}

// ---- the four machines, side by side, which is the thing to actually judge ----
const MACHINE = ['screen (pair)', 'devicePixelRatio', 'hardwareConcurrency', 'deviceMemory',
  'webgl.vendor', 'webgpu.architecture', 'navigator.bluetooth present'];
console.log(`
### THE MACHINE, SEPARATELY — and this is the number that matters`);
console.log(`   The country half varies the locale, the timezone and the position. It cannot`);
console.log(`   vary one thing about the hardware. So a site reading only the hardware sees one`);
console.log(`   of ${devices.length}: ${bits(devices.length).toFixed(1)} bits, against ${bits(combos).toFixed(1)} for the whole claim.
`);
const w = Math.max(...MACHINE.map((f) => f.length));
console.log('   ' + ''.padEnd(w) + '  ' + devices.map((d) => String(d.id).padEnd(16)).join(''));
for (const f of MACHINE) {
  const cells = devices.map((d) => {
    const r = rows.find((x) => x['webgl.renderer'] === d.glRenderer);
    return String(r[f]).slice(0, 15).padEnd(16);
  });
  console.log('   ' + f.padEnd(w) + '  ' + cells.join(''));
}
console.log('   ' + 'GPU'.padEnd(w) + '  ' +
  devices.map((d) => d.glRenderer.replace(/^ANGLE \(/, '').split(',')[1] ? d.glRenderer.replace(/^ANGLE \([^,]+, /, '').split(' (')[0].slice(0, 15).padEnd(16) : '?'.padEnd(16)).join(''));
// Two of the four share a byte-identical 19-value GL parameter table; worth knowing,
// because that table is one of the heavier things a fingerprinter reads off WebGL.
const glGroups = new Map();
for (const d of devices) {
  const k = JSON.stringify(d.glParams);
  glGroups.set(k, (glGroups.get(k) || []).concat(d.id));
}
console.log('');
for (const [, ids] of glGroups) {
  if (ids.length > 1) {
    console.log(`   NOTE  ${ids.join(' and ')} ship a byte-identical webgl parameter table,`);
    console.log(`         so that surface carries ${bits(glGroups.size).toFixed(1)} bit rather than ${bits(devices.length).toFixed(1)}.`);
  }
}

// ---- the four rows against a real population -----------------------------
//
// This section used to be a paragraph saying the reference did not exist. It exists now:
// tools/crowd-reference.json, every number read off a named public source on a named date,
// nothing interpolated. Read its `_README` and the per-entry `bias` before arguing from any
// figure here — one of the four tables (GPU) is disqualified by its own bias and says so.
//
// The units trap is handled by scoring each field against the source that actually measures
// it. A browser reports screen.width in CSS pixels, so StatCounter — which reads browsers —
// is the reference for that, and its table is full of resolutions no panel is made in
// (1536x864 is a 1080p panel at 125%). Steam reads the OS, so it is the reference for the
// PHYSICAL panel, which for a profile is screenW * dpr. Both are printed, because a profile
// can be ordinary in one and impossible in the other.
const ref = JSON.parse(read('tools/crowd-reference.json'));
const share = (entry, key) => {
  const hit = entry.rows.find(([k]) => k === String(key));
  return hit ? hit[1] : null;
};
// '—' rather than 'not recorded': the column is 7 wide and a phrase that overflows it
// breaks every row after it. The legend below says what the dash means.
const pct = (v) => (v === null ? '      —' : `${v.toFixed(2).padStart(6)}%`);

console.log(`\n### THE ${devices.length} ROWS AGAINST A REAL POPULATION`);
console.log(`   reference: tools/crowd-reference.json, fetched ${ref.fetched}`);
console.log(`   screen  ${ref.screen_css_px.source} (${ref.screen_css_px.period})`);
console.log(`   panel   ${ref.physical_panel.source} (${ref.physical_panel.period})`);
console.log(`   RAM     ${ref.ram_gb.source} (${ref.ram_gb.period})`);
console.log(`   "—" means the source's published rows do not reach that value — NOT that it`);
console.log(`   is rare. Both tables are truncated and both say where they stop.\n`);

console.log('   ' + 'profile'.padEnd(12) + 'screen (CSS)'.padEnd(14) + 'share'.padEnd(9) +
  'claimed panel'.padEnd(15) + 'share'.padEnd(9) + 'RAM'.padEnd(5) + 'share');
for (const d of devices) {
  const css = `${d.screenW}x${d.screenH}`;
  const panel = `${d.screenW * d.dpr}x${d.screenH * d.dpr}`;
  console.log('   ' + String(d.id).padEnd(12) + css.padEnd(14) +
    pct(share(ref.screen_css_px, css)).padEnd(9) + panel.padEnd(15) +
    pct(share(ref.physical_panel, panel)).padEnd(9) +
    String(d.memory).padEnd(5) + pct(share(ref.ram_gb, d.memory)));
}

// The actionable half: what the population has that nothing here offers. A profile set is
// judged by COVERAGE OF THE MASS, not by how many rows it has — each doubling is worth one
// bit, but a bit spent on a configuration nobody runs buys nothing.
console.log(`\n   THE MASS THIS SET DOES NOT COVER`);
const haveCss = new Set(devices.map((d) => `${d.screenW}x${d.screenH}`));
const havePanel = new Set(devices.map((d) => `${d.screenW * d.dpr}x${d.screenH * d.dpr}`));
const haveRam = new Set(devices.map((d) => String(d.memory)));
let missed = 0;
const skipCss = new Set(ref.screen_css_px.exclude_from_gaps || []);
for (const [k, v] of ref.screen_css_px.rows) {
  if (skipCss.has(k)) continue;
  if (!haveCss.has(k) && !(ref.screen_css_px.notes || {})[k]) {
    console.log(`     screen ${k.padEnd(12)} ${v.toFixed(2).padStart(6)}% of desktop web — no profile claims it`);
    missed++;
  } else if (!haveCss.has(k)) {
    console.log(`     screen ${k.padEnd(12)} ${v.toFixed(2).padStart(6)}%  (${ref.screen_css_px.notes[k]})`);
    missed++;
  }
}
for (const [k, v] of ref.ram_gb.rows) {
  if (!haveRam.has(k)) {
    console.log(`     RAM    ${(k + ' GB').padEnd(12)} ${v.toFixed(2).padStart(6)}% on Steam — no profile claims it`);
    missed++;
  }
}
for (const [k, v] of ref.physical_panel.rows) {
  if (!havePanel.has(k)) {
    console.log(`     panel  ${k.padEnd(12)} ${v.toFixed(2).padStart(6)}% on Steam — no profile implies it`);
    missed++;
  }
}
if (!missed) console.log('     (none in the recorded rows)');

// And the reverse: a claim the sources place nowhere. Not proof of rarity — both tables are
// truncated — but the place to look first.
console.log(`\n   CLAIMS THE SOURCES DO NOT REACH`);
for (const d of devices) {
  const panel = `${d.screenW * d.dpr}x${d.screenH * d.dpr}`;
  const note = (ref.physical_panel.notes || {})[panel];
  // At dpr 1 the CSS row and the panel are the same number, so a panel missing from
  // Steam's gamer-skewed table is still supported if StatCounter recorded it. Without
  // this, laptop_low — the best-supported row in the set — printed as unsupported.
  const alsoCss = d.dpr === 1 && share(ref.screen_css_px, panel) !== null;
  if (share(ref.physical_panel, panel) === null && !alsoCss) {
    console.log(`     ${String(d.id).padEnd(12)} implies a ${panel} panel`);
    for (const line of (note || 'not in the published rows').match(/.{1,70}(\s|$)/g) || [])
      console.log('                  ' + line.trim());
  }
}

console.log(`\n### WHAT THIS STILL CANNOT TELL YOU`);
console.log('   The GPU. Steam\'s video-card table is four discrete NVIDIA parts, because its');
console.log('   population buys them, while the web at large runs Intel integrated — so it');
console.log('   cannot score the two Intel rows at all and can only rank the two NVIDIA ones');
console.log('   against each other. No source measuring GPU share across general web traffic');
console.log('   was found; see gpu_model.bias in the reference.');
console.log('   The logical core count. Steam publishes PHYSICAL cores and');
console.log('   navigator.hardwareConcurrency reports LOGICAL processors, which SMT and');
console.log('   Intel\'s hybrid parts make non-derivable. The 4/8/12/16 claims are unscored.');
console.log('   The tail of the screen table — the top six are 48.6% of desktop web and the');
console.log('   other half is rendered with JavaScript and was not readable.');
console.log('   Per-country screens. The profile is paired with a country and the reference');
console.log('   is worldwide, so a claim can be ordinary globally and odd where it is used.');
console.log('');

// Deliberately no exit code: this is a readout, not a verdict. Nothing here is a pass or a
// fail — it is the material for a decision about the profile set.
console.log(`(${PROFILES.length} popup profiles, ${Object.keys(GPU_DATA).length} GPU rows behind them; ` +
  `${PROFILES.filter((p) => p.host).length} of the profiles is "this machine" and claims nothing — ` +
  `its crowd is everyone with that hardware, which no table here can count)`);
