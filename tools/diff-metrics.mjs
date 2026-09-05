/**
 * TWO MACHINES, ONE TABLE.
 *
 *   node tools/diff-metrics.mjs <other-machine.json>
 *   node tools/diff-metrics.mjs <a.json> <b.json>     compare two saved dumps
 *
 * With one argument this collects THIS machine's dump headlessly (clean Chromium, no
 * extension — tools/collect-metrics.html is loaded as-is) and diffs it against the file.
 *
 * Why this exists: "is X a per-machine carrier?" is the question that decides whether a
 * value is worth spoofing, and it cannot be answered on one machine. It also cannot be
 * answered by eye across two 120-line JSON files — the interesting fields are the ones
 * that stay the same, and those are the easiest to skim past.
 *
 * The classification is the only thing that matters:
 *
 *   SAME    -> not a carrier. Spoofing it buys nothing and risks a contradiction.
 *   DIFFERS -> a real per-machine value. This is what a visitor id can be built from.
 *
 * Fields that MUST differ (the GPU's own name, core count, screen, timezone) are listed
 * separately as the rig's sanity check: if those match, the two files are from one machine
 * and every other verdict is worthless.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'path';
import { root } from '../test/harness.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// --save collects a dump and writes it, comparing nothing. Two builds on ONE machine
// cannot both be "here", so answering "does our build behave like stock?" needs each
// side captured separately and then diffed as two files.
const saveArg = process.argv.find((a) => a.startsWith('--save='));
const SAVE = saveArg ? saveArg.slice('--save='.length) : null;

if (!args.length && !SAVE) {
  console.error('usage: node tools/diff-metrics.mjs <other-machine.json> [this-machine.json]');
  console.error('       node tools/diff-metrics.mjs --save=<file>   collect this side only');
  process.exit(2);
}

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));

// Browser, not machine: the other dump may come from Edge while this side runs Chromium,
// and the two ship different default fonts and different rasteriser builds. Matching the
// channel is what turns "these two files differ" into "these two MACHINES differ".
//   node tools/diff-metrics.mjs other.json --channel=msedge
const channelArg = process.argv.find((a) => a.startsWith('--channel='));
const CHANNEL = channelArg ? channelArg.slice('--channel='.length) : 'chromium';

// Which binary this side collects from. FPS_CHROME wins over --channel so the same
// command can dump a locally built Chromium; without it nothing changes and --channel
// keeps meaning what it meant. This spells the choice out instead of importing BROWSER
// from the harness because here the channel is a parameter, not a constant.
const LAUNCH = process.env.FPS_CHROME
  ? { executablePath: process.env.FPS_CHROME }
  : { channel: CHANNEL };

async function collectHere() {
  const browser = await chromium.launch({ ...LAUNCH, headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto(pathToFileURL(path.join(root, 'tools', 'collect-metrics.html')).href,
    { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const t = document.getElementById('out');
    return t && t.value && t.value.length > 200;
  }, { timeout: 30000 });
  const json = await page.evaluate(() => document.getElementById('out').value);
  await browser.close();
  return JSON.parse(json);
}

if (SAVE && !args.length) {
  const dump = await collectHere();
  writeFileSync(SAVE, JSON.stringify(dump, null, 2));
  console.log(`wrote ${SAVE}  (${process.env.FPS_CHROME || 'channel:' + CHANNEL})`);
  process.exit(0);
}

const B = load(args[0]);
const A = args[1] ? load(args[1]) : await collectHere();

// Flatten so nested blocks (webgl.limits.*, raster.*, fontPreferences.*) compare per leaf.
function flat(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out);
    else out[key] = String(v);
  }
  return out;
}
const fa = flat(A), fb = flat(B);

// Not evidence about the machine: identity of the box, when it ran, and the GPU's own
// name (which is the thing being controlled for, not measured).
const RIG = [/^collectedAt/, /^probeVersion/, /^extensionActive/, /^userAgent/, /^timezone/,
  /^language/, /^screen$/, /^devicePixelRatio/, /^hardwareConcurrency/, /^deviceMemory/,
  /webgl\.unmasked/, /webgl\.extensions$/, /\.resolved$/,
  // v7's WebGPU block: the adapter's IDENTITY is the control, exactly like
  // webgl.unmasked* above — two different machines are supposed to disagree there, and
  // listing it as entropy would bury the limits, which are the part worth reading.
  /^webgpu\.vendor/, /^webgpu\.architecture/, /^webgpu\.device/, /^webgpu\.description/];
const isRig = (k) => RIG.some((re) => re.test(k));

const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();
const missing = keys.filter((k) => !(k in fa) || !(k in fb));
const compared = keys.filter((k) => !isRig(k) && !missing.includes(k));
const differs = compared.filter((k) => fa[k] !== fb[k]);
const same = compared.filter((k) => fa[k] === fb[k]);

console.log(`\nA  ${A.userAgent ? A.userAgent.slice(-38) : '?'}`);
console.log(`   ${fa['webgl.unmaskedRenderer'] || '?'}`);
console.log(`B  ${B.userAgent ? B.userAgent.slice(-38) : '?'}`);
console.log(`   ${fb['webgl.unmaskedRenderer'] || '?'}`);

if (A.probeVersion !== B.probeVersion) {
  console.log(`\n!! probeVersion ${A.probeVersion} vs ${B.probeVersion} — the older dump was ` +
    `collected by an earlier tools/collect-metrics.html and is missing fields. Anything it ` +
    `never measured cannot be answered from it; re-collect on both machines to compare those.`);
}

// Sanity: the two files must actually be two machines.
const gpuDiffers = fa['webgl.unmaskedRenderer'] !== fb['webgl.unmaskedRenderer'];
console.log(`\nrig check — the GPUs differ: ${gpuDiffers ? 'yes' : 'NO, these look like one machine'}`);

console.log(`\n### DIFFERS between the machines — real per-machine entropy (${differs.length})`);
for (const k of differs) console.log(`   ${k.padEnd(34)} A ${fa[k].slice(0, 26).padEnd(28)} B ${fb[k].slice(0, 26)}`);

console.log(`\n### SAME on both — not a carrier, spoofing buys nothing (${same.length})`);
for (const k of same) console.log(`   ${k.padEnd(34)} ${fa[k].slice(0, 44)}`);

if (missing.length) {
  console.log(`\n### ONLY IN ONE FILE — unanswerable until both are re-collected (${missing.length})`);
  for (const k of missing) console.log(`   ${k.padEnd(34)} ${(k in fa) ? 'A only' : 'B only'}`);
}

console.log('');
