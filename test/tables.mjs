/**
 * Cross-file consistency of the country / profile / GPU tables.
 *
 *   node test/tables.mjs
 *
 * Why this exists: the same 67 countries are spelled out in four different files
 * and nothing made them agree.
 *
 *   popup.js       COUNTRIES        code, display name, timezone   (what the user picks)
 *   popup.js       LOCALE_BY_CODE   code -> locale                 (what the popup stores)
 *   background.js  COUNTRY_DATA     code -> timezone, locale, Accept-Language
 *   mw/mw-geo.js   COORDS           code -> latitude/longitude
 *
 * A country present in one and missing from another does not crash: the lookups
 * all fall back to US. So the failure mode is silent and is exactly the one this
 * extension exists to prevent — Europe/Tallinn in the clock, en-US in
 * Intl.DateTimeFormat, and New York coordinates in geolocation, on the same page.
 *
 * Not covered here, because test/tz-icu.mjs already owns it: whether each `tz`
 * exists in the two zone tables and produces the right offset.
 */
import { harness, read, balanced, loadBackground, loadPopup } from './harness.mjs';

const t = harness();

const { COUNTRY_DATA, GPU_DATA, DEFAULT_PROFILE, enforceCoherence } = loadBackground([
  'COUNTRY_DATA', 'GPU_DATA', 'DEFAULT_PROFILE', 'enforceCoherence'
]);
const { COUNTRIES, LOCALE_BY_CODE, PROFILES } = loadPopup(['COUNTRIES', 'LOCALE_BY_CODE', 'PROFILES']);
// COORDS is a local inside the geolocation IIFE, so it has to be read textually.
const COORDS = eval('(' + balanced(read('mw/mw-geo.js'), /var COORDS = \{/, '{', '}') + ')');

const codes = COUNTRIES.map((c) => c.code);
const codeSet = new Set(codes);

// ---- 1) the four tables list the same countries -----------------------------
t.section('1) same country set in all four tables');
t.eq(codes.length, codeSet.size, 'COUNTRIES has no duplicate codes');
t.assert(codes.length > 0, 'COUNTRIES is not empty');

/** Both directions: a missing row silently falls back to US, an extra row is dead weight. */
function sameKeys(label, keys) {
  const set = new Set(keys);
  t.eq(set.size, keys.length, `${label} has no duplicate keys`);
  for (const c of codeSet) t.assert(set.has(c), `${label} is missing ${c} (offered by the popup)`);
  for (const k of set) t.assert(codeSet.has(k), `${label} has ${k}, which the popup does not offer`);
}
sameKeys('COUNTRY_DATA', Object.keys(COUNTRY_DATA));
sameKeys('LOCALE_BY_CODE', Object.keys(LOCALE_BY_CODE));
sameKeys('mw-geo COORDS', Object.keys(COORDS));

for (const c of COUNTRIES) {
  t.assert(/^[A-Z]{2}$/.test(c.code), `${c.code} is a two-letter uppercase code`);
  t.assert(!!c.name && typeof c.name === 'string', `${c.code} has a display name`);
  t.assert(!!c.tz && c.tz.includes('/'), `${c.code} has an IANA zone`);
}

// ---- 2) locale: popup, background and the Accept-Language header agree ------
t.section('2) locale agrees across popup, background and Accept-Language');
for (const code of codes) {
  const row = COUNTRY_DATA[code];
  if (!row) continue;
  const loc = LOCALE_BY_CODE[code];

  // The popup writes LOCALE_BY_CODE[code] into afp_resolved_locale while background.js
  // builds the injected profile from COUNTRY_DATA[code].loc. Two sources, one value:
  // if they disagree, navigator.language and Intl.DateTimeFormat().resolvedOptions()
  // disagree too, which is a one-line detection.
  t.eq(loc, row.loc, `${code}: popup LOCALE_BY_CODE vs background COUNTRY_DATA.loc`);

  const region = String(row.loc).split('-')[1];
  t.eq(region, code, `${code}: locale region subtag matches the country`);
  let canonical = null;
  try { canonical = Intl.getCanonicalLocales(row.loc)[0]; } catch { /* reported below */ }
  t.eq(canonical, row.loc, `${code}: ${row.loc} is a canonical BCP-47 tag`);

  // Accept-Language must lead with the same locale, or the header contradicts the JS.
  const tags = String(row.lang).split(',').map((s) => s.trim());
  t.eq(tags[0], row.loc, `${code}: Accept-Language leads with ${row.loc}`);
  t.assert(!tags[0].includes(';'), `${code}: the leading Accept-Language tag carries no q-value`);

  // Second entry is the bare language of the locale — what Chrome actually sends.
  const bare = String(row.loc).split('-')[0];
  t.assert(tags.length > 1 && tags[1].split(';')[0] === bare,
    `${code}: Accept-Language continues with the bare language "${bare}" (got "${tags[1]}")`);

  let prevQ = 1;
  for (let i = 1; i < tags.length; i++) {
    const m = /^([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*);q=(0(?:\.\d+)?|1(?:\.0+)?)$/.exec(tags[i]);
    if (!m) { t.assert(false, `${code}: malformed Accept-Language entry "${tags[i]}"`); continue; }
    const q = parseFloat(m[2]);
    t.assert(q < prevQ, `${code}: q-values strictly descending at "${tags[i]}"`);
    prevQ = q;
  }
}

// ---- 3) geolocation coordinates ---------------------------------------------
t.section('3) mw-geo COORDS');
const seen = new Map();
for (const code of codes) {
  const c = COORDS[code];
  if (!Array.isArray(c)) { t.assert(false, `${code}: COORDS row is not a [lat, lon] pair`); continue; }
  t.eq(c.length, 2, `${code}: COORDS row has two numbers`);
  const [lat, lon] = c;
  t.assert(Number.isFinite(lat) && lat >= -90 && lat <= 90, `${code}: latitude ${lat} in range`);
  t.assert(Number.isFinite(lon) && lon >= -180 && lon <= 180, `${code}: longitude ${lon} in range`);
  const key = `${lat},${lon}`;
  t.assert(!seen.has(key), `${code}: coordinates are not a copy of ${seen.get(key)}`);
  seen.set(key, code);
}

// The coordinate and the timezone must describe the same place. Solar time from the
// longitude is within ~1.5h of the standard offset for every real capital; the bug this
// catches is the one [FIX us-geo-tz] describes, where US was San Francisco (-8.2h solar)
// while its zone was America/New_York (-5h) — a 3.2h split a site can just subtract.
const ZONE_DATA = eval('(' + balanced(read('mw/mw-timezone-screen.js'), /var ZONE_DATA =/, '{', '}') + ')');
const SOLAR_TOLERANCE_H = 2.5;
let worst = { code: null, diff: 0 };
for (const code of codes) {
  const row = COUNTRY_DATA[code], c = COORDS[code];
  const zone = row && ZONE_DATA[row.tz];
  if (!zone || !Array.isArray(c)) continue;
  const utcHours = -zone.base / 60; // ZONE_DATA.base is getTimezoneOffset-style: negative east
  const diff = Math.abs(c[1] / 15 - utcHours);
  if (diff > worst.diff) worst = { code, diff };
  t.assert(diff <= SOLAR_TOLERANCE_H,
    `${code}: coordinates (lon ${c[1]}) and ${row.tz} (UTC${utcHours >= 0 ? '+' : ''}${utcHours}) are ${diff.toFixed(1)}h apart`);
}
t.note(`widest longitude/offset gap: ${worst.code} at ${worst.diff.toFixed(2)}h (tolerance ${SOLAR_TOLERANCE_H}h)`);

// ---- 4) hardware profiles ----------------------------------------------------
t.section('4) popup PROFILES vs background GPU_DATA');
const ids = PROFILES.map((p) => p.id);
t.eq(new Set(ids).size, ids.length, 'PROFILES have unique ids');

const usedGpuKeys = new Set();
for (const p of PROFILES) {
  // [FIX host-mode] "This machine" names no GPU row, claims no numbers and is never run
  // through enforceCoherence; the popup measures it. Its shape is asserted, not its values.
  if (p.host) {
    t.assert(p.host === true && !p.gpuKey && p.cores === undefined && p.screenW === undefined,
      `${p.id}: the host row carries a flag and no hardware claim`);
    continue;
  }
  t.assert(!!GPU_DATA[p.gpuKey], `${p.id}: gpuKey "${p.gpuKey}" exists in GPU_DATA`);
  usedGpuKeys.add(p.gpuKey);

  // The spec string is what the user reads; the numbers are what the site reads.
  // pc_power shipped with "64GB" in the spec while reporting 32 — see the FIX note
  // in popup.js. This is the assertion that would have caught it.
  const cores = /(\d+)c\b/.exec(p.spec);
  const mem = /(\d+)\s*GB/.exec(p.spec);
  t.assert(cores && +cores[1] === p.cores, `${p.id}: spec "${p.spec}" states ${p.cores} cores`);
  t.assert(mem && +mem[1] === p.memory, `${p.id}: spec "${p.spec}" states ${p.memory} GB`);

  // The label next to the profile and the string WebGL reports must name one GPU.
  const model = /(\d{3,4}|Xe)\b/.exec(p.gpu);
  t.assert(model && GPU_DATA[p.gpuKey].unmaskedRenderer.includes(model[1]),
    `${p.id}: label "${p.gpu}" and unmaskedRenderer name the same GPU`);

  // A profile the popup offers must survive background.js untouched, or the user
  // picks "PC Gaming" and the page is told something else.
  const after = enforceCoherence({
    gpu: p.gpuKey, cores: p.cores, memory: p.memory,
    screenW: p.screenW, screenH: p.screenH, platform: p.platform
  });
  for (const k of ['gpu', 'cores', 'memory', 'screenW', 'screenH']) {
    const want = k === 'gpu' ? p.gpuKey : p[k];
    t.eq(after[k], want, `${p.id}: enforceCoherence leaves ${k} alone`);
  }
}
for (const k of Object.keys(GPU_DATA)) {
  t.assert(usedGpuKeys.has(k), `GPU_DATA has "${k}", which no profile selects`);
}

// Every GPU must answer the same set of WebGL parameters. A key present for one card
// and absent for another means that card falls through to the real driver for that
// parameter, which is a per-GPU leak rather than a per-GPU value.
const gpuKeys = Object.keys(GPU_DATA);
const paramRef = Object.keys(GPU_DATA[gpuKeys[0]].webglParams).sort().join(',');
for (const k of gpuKeys) {
  t.eq(Object.keys(GPU_DATA[k].webglParams).sort().join(','), paramRef,
    `${k}: webglParams covers the same parameters as ${gpuKeys[0]}`);
  const g = GPU_DATA[k];
  t.assert(/^Google Inc\. \(.+\)$/.test(g.unmaskedVendor), `${k}: unmaskedVendor looks like Chrome's`);
  t.assert(g.unmaskedRenderer.startsWith('ANGLE ('), `${k}: unmaskedRenderer looks like Chrome's`);
  t.assert(!!g.webgpu && typeof g.webgpu.vendor === 'string' && !!g.webgpu.architecture,
    `${k}: has a WebGPU adapter row`);
  t.assert(g.unmaskedRenderer.toLowerCase().includes(g.webgpu.vendor),
    `${k}: WebGL and WebGPU name the same vendor (${g.webgpu.vendor})`);

  // WebGL UNMASKED_* and WebGPU adapter.info describe one card, and comparing them is a
  // one-line cross-check any site can run — "Iris in WebGL, nvidia in WebGPU" is a
  // block-grade contradiction on its own. The family has to be derivable from the WebGL
  // strings and land on the WebGPU vendor.
  const glText = (g.unmaskedVendor + ' ' + g.unmaskedRenderer).toLowerCase();
  const glFamily = /nvidia/.test(glText) ? 'nvidia'
    : /amd|ati|radeon/.test(glText) ? 'amd'
    : /intel/.test(glText) ? 'intel'
    : /apple/.test(glText) ? 'apple' : 'unknown';
  t.eq(g.webgpu.vendor, glFamily, `${k}: WebGPU vendor matches the family in the WebGL strings`);

  // architecture is per-family: Chrome reports xe-lpg / gen-9 for Intel and ampere for
  // Ampere NVIDIA. A value from the wrong family is the same contradiction one field over.
  const ARCH_BY_FAMILY = { intel: ['gen-9', 'xe-lpg', 'xe-hpg'], nvidia: ['ampere', 'ada', 'turing'], amd: ['rdna-2', 'rdna-3', ''] };
  const allowed = ARCH_BY_FAMILY[g.webgpu.vendor];
  t.assert(!allowed || allowed.indexOf(g.webgpu.architecture) !== -1,
    `${k}: architecture "${g.webgpu.architecture}" belongs to vendor "${g.webgpu.vendor}"`);

  // device/description are empty on a clean Chrome for these cards; a stray value here
  // would be identity the real browser does not publish.
  t.eq(g.webgpu.device, '', `${k}: WebGPU device is empty, as Chrome reports it`);
  t.eq(g.webgpu.description, '', `${k}: WebGPU description is empty, as Chrome reports it`);

  // [FIX nvidia-texture-size-was-a-desktop-gl-number] The renderer string names the
  // graphics backend, and the backend — not the card — sets the texture ceiling. Both
  // NVIDIA rows used to claim ANGLE/D3D11 and 32768 in the same breath, which is a number
  // D3D11 cannot produce: D3D11_REQ_TEXTURE2D_U_OR_V_DIMENSION is 16384 at every feature
  // level 11_x. A row that contradicts itself is worse than one that is merely unusual,
  // because catching it needs no reference data at all.
  if (/Direct3D11|D3D11/i.test(g.unmaskedRenderer)) {
    for (const [en, name] of [[0x0D33, 'MAX_TEXTURE_SIZE'], [0x84E8, 'MAX_RENDERBUFFER_SIZE'], [0x851C, 'MAX_CUBE_MAP_TEXTURE_SIZE']]) {
      const v = g.webglParams[en];
      t.assert(v == null || v <= 16384,
        `${k}: ${name} is ${v}, above the D3D11 ceiling of 16384 the renderer string claims`);
    }
  }

  // [FIX webgl-params-were-desktop-gl-numbers] The drawing-buffer bit depths belong to the
  // context the PAGE created, not to the GPU: measured, alpha:false moves ALPHA_BITS from 8
  // to 0, depth:false moves DEPTH_BITS from 24 to 0, stencil:true moves STENCIL_BITS from 0
  // to 8. A constant here contradicts the attributes the page itself passed to getContext,
  // which is the cheapest kind of contradiction to catch. They pass through to the driver.
  for (const [en, name] of [[0x0D52, 'RED_BITS'], [0x0D53, 'GREEN_BITS'], [0x0D54, 'BLUE_BITS'],
    [0x0D55, 'ALPHA_BITS'], [0x0D56, 'DEPTH_BITS'], [0x0D57, 'STENCIL_BITS']]) {
    t.assert(!(en in g.webglParams), `${k}: ${name} is not pinned — it follows the context attributes`);
  }
  // Enums no context answers in either WebGL version. Listing one means answering where the
  // real browser returns null.
  for (const en of [0x8074, 0x8B48]) {
    t.assert(!(en in g.webglParams), `${k}: 0x${en.toString(16).toUpperCase()} is absent — no context answers it`);
  }
}

// [FIX nvidia-profiles-reported-intels-uniform-limit] One table PER VENDOR, not one for
// everything and not one per card.
//
// The old rule here was "one table, the caps are backend-determined". That is true of
// almost all of them — measured on an Intel Arc and an NVIDIA RTX 3060, the extension lists
// are byte-identical (35 entries), as are the shader precisions, the anisotropy and eleven
// of the twelve limits. But NVIDIA's driver reserves one vertex uniform vector and reports
// 4095 where Intel reports 4096, so a single shared table made every NVIDIA profile answer
// with Intel's number.
//
// Still asserted by IDENTITY within a vendor, which is what the original rule was protecting:
// cards of one vendor must share the very same object, so there is no room for a per-card
// copy to drift.
{
  const vendorOf = (k) => (GPU_DATA[k].unmaskedVendor.match(/\((\w+)\)/) || [, '?'])[1];
  const byVendor = {};
  for (const k of gpuKeys) (byVendor[vendorOf(k)] ||= []).push(k);
  for (const [vendor, keys] of Object.entries(byVendor)) {
    const tables = keys.map((k) => GPU_DATA[k].webglParams);
    t.assert(tables.every((x) => x === tables[0]),
      `${vendor}: all its cards share one webglParams object (${keys.join(', ')})`);
  }
  // The vendor difference is exactly one enum, and it is this one. A second divergence
  // appearing here means someone measured something new — or guessed.
  const intel = GPU_DATA[Object.entries(byVendor).find(([v]) => v === 'Intel')[1][0]].webglParams;
  const nvidia = GPU_DATA[Object.entries(byVendor).find(([v]) => v === 'NVIDIA')[1][0]].webglParams;
  const differing = [...new Set([...Object.keys(intel), ...Object.keys(nvidia)])]
    .filter((en) => String(intel[en]) !== String(nvidia[en]));
  t.assert(differing.length === 1 && Number(differing[0]) === 0x8DFB,
    `Intel and NVIDIA differ in exactly MAX_VERTEX_UNIFORM_VECTORS (differing: ${differing.map((e) => '0x' + Number(e).toString(16)).join(',') || 'none'})`);
  t.assert(intel[0x8DFB] === 4096 && nvidia[0x8DFB] === 4095,
    `and by the measured values — Intel 4096, NVIDIA 4095 (got ${intel[0x8DFB]} / ${nvidia[0x8DFB]})`);
}

// ---- 5) the default profile is a profile the popup can show ------------------
t.section('5) defaults.js AFP_DEFAULT_PROFILE is one of the popup profiles');
// On a clean install background.js builds from DEFAULT_PROFILE while the popup shows
// laptop_mid as selected. If those are different machines the popup lies on first run.
const match = PROFILES.find((p) =>
  p.gpuKey === DEFAULT_PROFILE.gpu && p.cores === DEFAULT_PROFILE.cores &&
  p.memory === DEFAULT_PROFILE.memory && p.screenW === DEFAULT_PROFILE.screenW &&
  p.screenH === DEFAULT_PROFILE.screenH && p.platform === DEFAULT_PROFILE.platform);
t.assert(!!match, `DEFAULT_PROFILE matches a popup profile (got ${JSON.stringify(DEFAULT_PROFILE)})`);
t.eq(match && match.id, 'laptop_mid', 'and it is the one the popup pre-selects');

// Both files fall back to the same country when storage is empty.
const popupSrc = read('popup.js'), bgSrc = read('background.js');
t.assert(/let selectedCountryCode = 'US'/.test(popupSrc), 'popup falls back to US');
t.assert(/cached\[STORAGE_KEY\] \|\| 'US'/.test(bgSrc), 'background falls back to US');
t.assert(/let selectedProfileId = 'laptop_mid'/.test(popupSrc), 'popup falls back to laptop_mid');
t.assert(/cached\[PROFILE_KEY\] \|\| 'laptop_mid'/.test(bgSrc), 'background falls back to laptop_mid');

t.done();
