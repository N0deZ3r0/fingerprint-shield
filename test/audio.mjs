/**
 * Audio must stay EXACTLY what a clean browser produces.
 *
 *   node test/audio.mjs             headless
 *   node test/audio.mjs --headed    watch it
 *
 * This suite guards a decision rather than a fix. Two audio patches once lived in
 * mw/mw-canvas-audio.js - noise on the OfflineAudioContext rendered buffer, and jitter on
 * the AnalyserNode getFloatFrequencyData family - and both were removed because the noise
 * gave away more than it hid. Measured then on CreepJS, one machine, one profile:
 *
 *                     with noise                         without
 *   sum      124.04030525171402 (not in KnownAudio)   124.04347527516074 (in it)
 *   unique   5000 of 5000                             4736 of 5000
 *   lies     1 (sample noise detected)                0
 *
 * Three independent tells, each caught by one line: a sum outside the published KnownAudio
 * table, a uniqueness count no real machine produces, and a sum impossible for the real,
 * untouched compressor gain sitting next to it.
 *
 * Nothing in the code enforces that today - the patches are gone, and what keeps them gone
 * is a comment. This suite makes it an assertion, because re-adding audio noise is a
 * one-function change that would look like an improvement to anyone who had not read the
 * measurement.
 *
 * THE INVARIANT IS A COMPARISON, NOT A CONSTANT. Every value is checked against a clean
 * browser launched beside this one, never against a number written here: the sum is a
 * property of the machine and the Chrome build, so a hardcoded 124.043... would fail on the
 * next rig or the next Chrome and teach whoever met it to delete the check. "Identical to a
 * browser with no extension" is the actual requirement and it travels.
 *
 * The health assertions below (unique < total, the copy matching, stability across two
 * renders) are there so that a Chrome release which changes audio itself is reported as
 * news instead of passing silently on both sides of the comparison.
 *
 * If pinning ever does become necessary - the note in mw/mw-canvas-audio.js says the right
 * move would be pinning the sum to KnownAudio[gain], never randomising - this suite is what
 * has to be rewritten first, deliberately.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';
const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };
const eq = (got, want, m) =>
  ok(Object.is(got, want), `${m} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const PAGE = `<!doctype html><html><body><script>
// The classic probe every audio fingerprinter runs: triangle 10kHz through a
// DynamicsCompressor, 5000 frames offline. CreepJS reads the same graph.
window.__audio = async () => {
  const render = async () => {
    const ctx = new OfflineAudioContext(1, 5000, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12;
    comp.attack.value = 0; comp.release.value = 0.25;
    osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
    const buf = await ctx.startRendering();
    const bins = buf.getChannelData(0);
    // The second read of the same buffer. CreepJS uses exactly this to catch noise that is
    // generated per call rather than per render.
    const copy = new Float32Array(bins.length);
    buf.copyFromChannel(copy, 0);
    let sumAll = 0, sum4500 = 0, copyMatches = true;
    for (let i = 0; i < bins.length; i++) {
      sumAll += Math.abs(bins[i]);
      if (i >= 4500) sum4500 += Math.abs(bins[i]);
      if (copyMatches && bins[i] !== copy[i]) copyMatches = false;
    }
    return { sumAll, sum4500, unique: new Set(bins).size, total: bins.length,
             gain: comp.reduction, copyMatches };
  };

  const first = await render(), second = await render();

  // The other patch that used to live here: jitter on the analyser. A suspended context is
  // silence, and silence reads as -Infinity in every bin, twice.
  let analyser = { supported: false };
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    await ac.suspend();
    const node = ac.createAnalyser();
    const a = new Float32Array(node.frequencyBinCount);
    const b = new Float32Array(node.frequencyBinCount);
    node.getFloatFrequencyData(a);
    node.getFloatFrequencyData(b);
    let stable = true, allSilent = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) stable = false;
      if (a[i] !== -Infinity) allSilent = false;
    }
    analyser = { supported: true, bins: a.length, stable, allSilent };
    ac.close();
  } catch (e) { analyser = { supported: false, err: String(e) }; }

  return {
    first, second,
    stableAcrossRenders: first.sumAll === second.sumAll && first.sum4500 === second.sum4500,
    analyser
  };
};
</script></body></html>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/**
 * Both sides run the SAME Chromium channel on purpose: a bundled build and channel
 * 'chromium' do not agree on everything, so mixing them would make the comparison measure
 * the browsers rather than the extension.
 */
async function read(withExt) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-audio-'));
  let browser = null, ctx;
  if (withExt) {
    ctx = await chromium.launchPersistentContext(dir, {
      ...BROWSER, headless: !headed,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
  } else {
    browser = await chromium.launch({ ...BROWSER, headless: !headed });
    ctx = await browser.newContext();
  }
  try {
    if (withExt) {
      try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch { /* already up */ }
      await new Promise((r) => setTimeout(r, 2500));
    }
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    return await page.evaluate(async () => await window.__audio());
  } finally {
    await ctx.close();
    if (browser) await browser.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
  }
}

try {
  const clean = await read(false);
  const ext = await read(true);

  console.log(`clean : sum4500=${clean.first.sum4500} unique=${clean.first.unique}/${clean.first.total} gain=${clean.first.gain}`);
  console.log(`ext   : sum4500=${ext.first.sum4500} unique=${ext.first.unique}/${ext.first.total} gain=${ext.first.gain}`);

  // ── the decision itself: audio is not touched ──
  eq(ext.first.sum4500, clean.first.sum4500, 'sum over the last 500 bins equals a clean browser');
  eq(ext.first.sumAll, clean.first.sumAll, 'sum over all 5000 bins equals a clean browser');
  eq(ext.first.unique, clean.first.unique, 'the uniqueness count equals a clean browser');
  eq(ext.first.gain, clean.first.gain, 'the compressor gain equals a clean browser');

  // ── the shapes that made the old noise readable ──
  ok(ext.first.unique < ext.first.total,
    `not every sample is distinct (${ext.first.unique} of ${ext.first.total}) — 5000 of 5000 was the ` +
    'old noise signature and no real machine produces it');
  eq(ext.first.copyMatches, true,
    'copyFromChannel returns the same values as getChannelData — no per-read noise');
  eq(ext.stableAcrossRenders, true, 'two renders of the same graph agree');

  // ── the analyser, the second patch that was removed ──
  ok(ext.analyser.supported, `AnalyserNode is reachable (${ext.analyser.err || ''})`);
  if (ext.analyser.supported && clean.analyser.supported) {
    eq(ext.analyser.stable, true, 'two analyser reads of a silent context agree — no jitter');
    eq(ext.analyser.allSilent, clean.analyser.allSilent,
      'a silent context reads as silence, exactly as it does with no extension');
    eq(ext.analyser.bins, clean.analyser.bins, 'frequencyBinCount equals a clean browser');
  }

  console.log(`\nsum4500 ${ext.first.sum4500} — compare against the KnownAudio table published in`);
  console.log('creep.js if this ever needs re-checking; it is a property of the machine, not of us.');
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
