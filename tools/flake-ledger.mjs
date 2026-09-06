/**
 * HOW OFTEN DOES EACH SUITE FAIL WHEN NOTHING CHANGES?
 *
 *   node tools/flake-ledger.mjs [runs]        default 5
 *
 * On 2026-09-06 the browser job returned 12 red suites, then 0, then 2, then 4, then 0 —
 * on ONE unchanged commit, with failure sets that did not overlap. Three conclusions were
 * drawn from single runs that day and one of them was wrong: a control run of the previous
 * commit came back 2 against 12 and I called the change guilty, then a rerun of the accused
 * commit came back clean.
 *
 * A job with that range cannot be read one run at a time, and no amount of care in reading
 * it fixes that. So this runs the whole set N times over the same tree and prints how many
 * of the N each suite failed — the only shape of evidence that can answer "is this suite
 * flaky, is it broken, or was that one unlucky afternoon".
 *
 * It answers three standing questions at once:
 *   - which suites actually flake, and how badly, so they can be fixed rather than reran;
 *   - whether the browser job has earned the right to gate a release (it currently gates
 *     one, which I added on a day it went 0..12);
 *   - whether the stand-down's two halves really diverge past the first visit, which one
 *     observation could not settle and 20x CPU throttling did not reproduce.
 *
 * A suite that fails every run is not flake — it is a defect, and the table says so with a
 * different word, because those two need opposite responses and get confused constantly.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = Math.max(1, Number(process.argv[2] || 5));
const OUT = process.argv.includes('--json') ? 'flake-ledger.json' : null;

console.log(`running the browser set ${RUNS}x over one unchanged tree\n`);

/** One run: the suite names that failed, or null if the runner itself did not finish. */
function once(n) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(root, 'test', 'all.mjs'), '--browser'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  // test/all.mjs's own summary line names them; falling back to the per-suite FAIL lines
  // keeps this working if the run died before printing it.
  const summary = out.split(/\r?\n/).find((l) => /^\d+ of \d+ suites failed:/.test(l.trim()));
  const failed = summary
    ? summary.slice(summary.indexOf(':') + 1).split(',').map((s) => s.trim()).filter(Boolean)
    : out.split(/\r?\n/).filter((l) => /^FAIL /.test(l))
      .map((l) => l.replace(/^FAIL\s+/, '').replace(/\s{2,}.*$/, '').trim());
  const finished = /all \d+ suites passed/.test(out) || !!summary;
  console.log(`  run ${n}/${RUNS}  ${secs}s  ${finished ? (failed.length || 'none') : 'DID NOT FINISH'}` +
    (failed.length ? `: ${failed.join(', ')}` : ''));
  return { finished, failed };
}

const runs = [];
for (let i = 1; i <= RUNS; i++) runs.push(once(i));

const counts = new Map();
for (const r of runs) for (const s of r.failed) counts.set(s, (counts.get(s) || 0) + 1);
const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);

console.log(`\n${'suite'.padEnd(40)} failed  verdict`);
console.log('-'.repeat(72));
if (!rows.length) {
  console.log('(nothing failed in any run)');
} else {
  for (const [suite, n] of rows) {
    // A suite that fails EVERY run is broken; one that fails some is flaky. The two need
    // opposite responses — fix the code, or fix the measurement — and calling both "failing"
    // is what turned one unlucky run into a wrong conclusion.
    const verdict = n === RUNS ? 'BROKEN — fails every run, this is a defect'
      : n > RUNS / 2 ? 'flaky, badly'
        : 'flaky';
    console.log(`${suite.padEnd(40)} ${String(n).padStart(2)}/${RUNS}   ${verdict}`);
  }
}

const clean = runs.filter((r) => r.finished && !r.failed.length).length;
console.log('-'.repeat(72));
console.log(`${clean}/${RUNS} runs were completely green`);
console.log(clean === RUNS
  ? 'the set is stable over these runs — a gate on it is justified by this evidence'
  : `a gate on this job blocks ${RUNS - clean} release attempt(s) in ${RUNS} for reasons ` +
    'that are not the code');

if (OUT) {
  writeFileSync(join(root, OUT), JSON.stringify({
    at: new Date().toISOString(), runs: RUNS, cleanRuns: clean,
    perSuite: Object.fromEntries(rows), sets: runs.map((r) => r.failed)
  }, null, 2));
  console.log(`written: ${OUT}`);
}
