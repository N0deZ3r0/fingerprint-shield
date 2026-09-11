/**
 * WHAT THE MAIN BUNDLE'S BYTE COUNT COSTS, PER FRAME.
 *
 *   node tools/probe-bundlecost.mjs
 *
 * mw-bundle.js is injected into every frame of every page — all_frames,
 * match_about_blank, match_origin_as_fallback — so the browser scans its text once per
 * frame before any of it runs. This times that scan with nothing else going on.
 *
 * THREE CASES. The bundle as it ships; the same bundle with its comments put BACK, rebuilt
 * from mw/*.js without stripComments, so the "before" column is measured on the machine
 * reading it rather than quoted from a day that has passed; and a one-line body as the
 * floor, which is what says how much of the number is the harness.
 *
 * ONE PAGE, THE CASES INTERLEAVED, and the reason is the same one tools/probe-textcost.mjs
 * was written for: between two browser launches the same unchanged text measured 1.00 ms
 * and 1.22 ms here, and a change worth 0.6 ms hides inside a spread like that. Twelve
 * rounds of twenty parses each, minimum of the rounds — interference only ever makes a
 * round slower, so the fastest is the cleanest estimate. The inner loop matters as much:
 * performance.now() is coarsened to 100 us in a page, so a single 0.4 ms parse quantises
 * to 0.3 or 0.5 and reads as a 60% difference that is not there.
 *
 * Each parse carries a unique comment prefix so V8's compilation cache cannot answer the
 * second one for free.
 *
 * It is a READOUT, not a verdict — no detector's threshold for page-load cost is known.
 * The regression guard is the comment-line assertion in test/parity-static.mjs, not a
 * timing budget. Exits 0 whatever the table says.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BROWSER, root } from '../test/harness.mjs';
import { MAIN_MODULES } from './gen-bundle.mjs';

const shipped = fs.readFileSync(path.join(root, 'mw-bundle.js'), 'utf8');
const withComments = MAIN_MODULES
  .map((rel) => '// ==== ' + rel + ' ====\n' + fs.readFileSync(path.join(root, rel), 'utf8'))
  .join('\n;\n') + '\n';
const CASES = {
  'comments in': withComments,
  'as shipped': shipped,
  'one-line body': 'var x = 1;\n'
};

const browser = await chromium.launch({ ...BROWSER, headless: true });
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  const out = await page.evaluate((cases) => {
    const names = Object.keys(cases), ROUNDS = 12, INNER = 20, acc = {};
    for (const n of names) { acc[n] = []; try { new Function(cases[n]); } catch (e) { /* warm */ } }
    for (let r = 0; r < ROUNDS; r++) {
      for (const n of names) {
        const t0 = performance.now();
        for (let i = 0; i < INNER; i++) {
          try { new Function('/*' + r + '_' + i + '*/' + cases[n]); } catch (e) { /* shape only */ }
        }
        acc[n].push((performance.now() - t0) / INNER);
      }
    }
    const res = {};
    for (const n of names) res[n] = { min: Math.min.apply(null, acc[n]), chars: cases[n].length };
    return res;
  }, CASES);

  console.log('case             chars     per frame    x30 frames');
  for (const [name, v] of Object.entries(out)) {
    console.log(`${name.padEnd(15)} ${String(v.chars).padStart(8)}   ${v.min.toFixed(3)} ms` +
      `     ${(v.min * 30).toFixed(0)} ms`);
  }
} finally {
  await browser.close();
}
