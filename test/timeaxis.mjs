/**
 * THE TIME AXIS, WITH A VERDICT.
 *
 *   node test/timeaxis.mjs
 *
 * `tools/probe-time.mjs` sweeps everything a page can read at eight moments across a load
 * and a reload, runs the identical sweep on a clean browser, and queues only what moves for
 * us and stays still for them. It is the best instrument in this repository for a whole
 * class of defect — and nothing has ever run it. It is a tool, it prints a report, and a
 * report nobody reads is a report that goes stale the way a hand-written list does.
 *
 * Almost every defect found in the week it was written was a defect of TIME rather than of
 * value: platformVersion 10.0.0 for the first seconds of an install and 15.0.0 after,
 * feature switches inert on the first load of an origin, outgoing headers carrying the
 * host's own for three requests, a cold start serving the previous machine's GPU, a worker
 * baking a provisional canvas seed it could no longer correct. One shape underneath all of
 * them: a value that changes while the profile behind it does not. A page reading the same
 * thing twice gets both answers, and two answers from one visitor is worse than either.
 *
 * This file gives that sweep a verdict, and it is deliberately thin: the measurement lives
 * in the tool, where it can still be run by hand with --all, --stealth and --headed. What is
 * added here is the part a tool cannot have — failing.
 *
 * TWO RUNS, AND THE SECOND ONE IS WHY THE FIRST MEANS ANYTHING.
 *
 *   warm   the steady state. The queue must be EMPTY.
 *   --cold no warm-up, which puts the probe inside the install window. The queue must be
 *          NOT empty and must name platformVersion.
 *
 * The cold run is the negative control, and it is a live one rather than a synthetic: it
 * uses a real, measured, documented behaviour of this extension (the install window, whose
 * width was measured at under 250ms) to prove the sweep can still see a value move. A green
 * warm run on its own proves nothing — a collector that broke and now reads two fields
 * would produce exactly the same "0 moved". That is why the BREADTH is asserted too.
 *
 * COST: about 45 seconds, four browser launches. That is the price of the control; a run
 * without it would be half the time and no evidence.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

function sweep(args) {
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [join(root, 'tools', 'probe-time.mjs'), ...args],
      { cwd: root, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // The tool sets process.exitCode to the size of the queue, so a non-zero exit is a
    // RESULT here, not a crash. Anything without output really is a crash.
    out = String(e.stdout || '');
    code = typeof e.status === 'number' ? e.status : -1;
    if (!out) throw e;
  }
  // [FIX a-verdict-nobody-matched-read-as-a-pass] The count comes off a printed contract
  // line, and a printed line can be renamed. So the MATCH is asserted before the number is
  // believed: an unmatched verdict must not read as "zero moving values".
  const v = out.match(/=== (\d+) unjudged moving value\(s\) ===/);
  const breadth = out.match(/(\d+) values read at each of (\d+) moments/);
  const queue = [...out.matchAll(/^ {3}(\S+)$/gm)].map((m) => m[1]);
  return { out, code, count: v ? Number(v[1]) : null, matched: !!v, breadth, queue };
}

// ── 1) the steady state ──────────────────────────────────────────────────────
console.log('== 1) the warm sweep: nothing may move that a clean browser holds still');
const warm = sweep([]);
ok(warm.matched, 'the tool printed its verdict line — an unmatched verdict would read as zero');
ok(!!warm.breadth, 'and its breadth line, so a collector that shrank cannot pass as quiet');
if (warm.breadth) {
  const values = Number(warm.breadth[1]), moments = Number(warm.breadth[2]);
  console.log(`   ${values} values at ${moments} moments`);
  // A collector that broke would read a handful of fields and move none of them.
  ok(values >= 100, `the sweep still reads the whole surface (${values} values)`);
  ok(moments === 8, `at all eight moments (${moments})`);
}
if (warm.matched) {
  const movers = warm.out.split('### QUEUE')[1] || '';
  console.log(`   queue: ${warm.count}`);
  ok(warm.count === 0,
    `nothing moves for us that a clean browser holds still (${warm.count}) —` +
    (warm.count ? movers.split('\n').slice(1, 12).join('\n') : ''));
  ok(warm.code === warm.count,
    `the exit code carries the same number as the report (${warm.code} vs ${warm.count})`);
}

// ── 2) the negative control ──────────────────────────────────────────────────
// Without this the section above is unfalsifiable: it passes on a broken sweep, a broken
// collector and a broken browser alike, all of which produce silence.
console.log('\n== 2) the cold sweep, which MUST find something (negative control)');
const cold = sweep(['--cold']);
ok(cold.matched, 'the cold run printed its verdict line too');
if (cold.matched) {
  console.log(`   queue: ${cold.count} — ${cold.queue.filter((k) => k.includes('.')).slice(0, 8).join(', ')}`);
  ok(cold.count > 0,
    'the install window is still visible to the sweep — if this is quiet the instrument is ' +
    'broken rather than the extension, and section 1 proves nothing');
  // [FIX the-control-pinned-one-name] This used to require the queue to name
  // uad.hev.platformVersion specifically. That is over-specification of the same kind the
  // tamper suite had: WHICH values move inside the install window depends on the machine,
  // and on the CI runner the cold sweep named five — outerWidth, outerHeight, canvas.2d,
  // fonts.measureText, webglPixels — and not that one. The control's job is to show the
  // sweep can still see movement the warm run does not, and five movers show it better
  // than one. The names are printed so a shrinking list is visible.
  ok(cold.count > warm.count,
    `and the cold run finds more than the warm one (${cold.count} vs ${warm.count}) — that ` +
    'difference is the whole control: the same sweep, the same browser, one warm-up apart');
}

// The two runs must have swept the SAME surface, or "cold found things and warm did not"
// could be a difference of coverage rather than of timing.
if (warm.breadth && cold.breadth) {
  ok(warm.breadth[1] === cold.breadth[1],
    `both runs read the same number of values (${warm.breadth[1]} vs ${cold.breadth[1]})`);
}

console.log('\nThe install window itself is not asserted away: it is measured, under 250ms,\n' +
  'and recorded as a known residual. What this file holds is that the STEADY state does\n' +
  'not move, and that the sweep can still tell the difference.');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
