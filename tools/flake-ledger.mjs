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
 * THE TABLE DOES NOT NAME DEFECTS, and the first version did. It said "BROKEN — fails every
 * run, this is a defect" at N/N, which was wrong the first time it mattered: CSP attribution
 * failed 5/5 in the full set and 1/8 run alone, three runs green locally. The difference is
 * LOAD — fifty-four suites back to back leave the machine slower than one suite with it to
 * itself — so N/N means "fails in this context", never "the code is broken". Naming a defect
 * is the expensive kind of wrong: it sends someone into the extension after something that
 * is not there. The row names the one command that separates the two readings instead.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = Math.max(1, Number(process.argv[2] || 5));
const OUT = process.argv.includes('--json') ? 'flake-ledger.json' : null;
// [FIX chasing-one-flake-cost-the-whole-set] The first ledger named `cold start` at 1/5 and
// eight local runs could not reproduce it — the flake belongs to the two-core runner. Going
// back for its assertion text meant another ninety minutes of the WHOLE set for one suite
// worth forty seconds. One suite, N times, is the same evidence for a fiftieth of the cost.
const only = (process.argv.find((a) => a.startsWith('--suite=')) || '').slice(8);
const TARGET = only ? ['test/' + only.replace(/^test\//, '').replace(/\.mjs$/, '') + '.mjs'] : null;

console.log(only
  ? `running ${TARGET[0]} ${RUNS}x over one unchanged tree\n`
  : `running the browser set ${RUNS}x over one unchanged tree\n`);

/** One run: the suite names that failed, or null if the runner itself did not finish. */
function once(n) {
  const t0 = Date.now();
  const argv = TARGET ? [join(root, TARGET[0])] : [join(root, 'test', 'all.mjs'), '--browser'];
  const r = spawnSync(process.execPath, argv,
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  // test/all.mjs's own summary line names them; falling back to the per-suite FAIL lines
  // keeps this working if the run died before printing it.
  const summary = out.split(/\r?\n/).find((l) => /^\d+ of \d+ suites failed:/.test(l.trim()));
  let failed, finished;
  if (TARGET) {
    // One suite: it reports "N passed, M failed" in its own words, and the exit code is the
    // authority — a suite that dies before printing its summary has still failed.
    const m = out.match(/^(\d+) passed, (\d+) failed$/m);
    failed = (r.status !== 0 || (m && Number(m[2]) > 0)) ? [TARGET[0]] : [];
    finished = !!m;
  } else {
    failed = summary
      ? summary.slice(summary.indexOf(':') + 1).split(',').map((s) => s.trim()).filter(Boolean)
      : out.split(/\r?\n/).filter((l) => /^FAIL /.test(l))
        .map((l) => l.replace(/^FAIL\s+/, '').replace(/\s{2,}.*$/, '').trim());
    finished = /all \d+ suites passed/.test(out) || !!summary;
  }
  // [FIX the-ledger-said-which-and-never-why] The first version kept only the suite names,
  // so "cold start 1/5" said a suite flakes and nothing about how — and the next step after
  // a ledger is always to fix the flake, which needs the assertion that failed. A rare
  // failure is also the expensive kind to reproduce: an hour and a half of runner time went
  // into that one line, and throwing away the reason meant spending it again to learn it.
  const why = out.split(/\r?\n/).filter((l) => /^\s*FAIL: /.test(l))
    .map((l) => l.trim().replace(/^FAIL:\s*/, ''));
  console.log(`  run ${n}/${RUNS}  ${secs}s  ${finished ? (failed.length || 'none') : 'DID NOT FINISH'}` +
    (failed.length ? `: ${failed.join(', ')}` : ''));
  for (const w of why.slice(0, 12)) console.log(`      ${w.slice(0, 160)}`);
  if (why.length > 12) console.log(`      … and ${why.length - 12} more`);
  return { finished, failed, why };
}

/**
 * The bare suite name behind a display name.
 *
 * The set's summary line reports what test/all.mjs CALLS a suite — "CSP attribution
 * (Chromium)" — and --suite= wants the file. Guessing from the words gives `CSP`, which is
 * not a suite; the mapping is written down in the runner, so it is read from there.
 */
function fileOf(display) {
  try {
    const all = readFileSync(join(root, 'test', 'all.mjs'), 'utf8');
    const esc = display.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = all.match(new RegExp(`'${esc}',\\s*\\['test/([\\w.-]+)\\.mjs'`));
    if (m) return m[1];
  } catch (e) { /* fall through */ }
  return display.replace(/^test\//, '').replace(/\.mjs$/, '').replace(/\s*\(.*$/, '');
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
    // [FIX the-ledger-called-a-context-a-defect] This said "BROKEN — fails every run, this
    // is a defect" at N/N, and it was wrong the first time it mattered: CSP attribution
    // failed 5/5 in the full set and 1/8 when run alone. The difference is LOAD — fifty-four
    // suites back to back leave the machine slower than one suite with it to itself — so
    // N/N says the suite fails in THIS context, which is not the same claim.
    //
    // Naming a defect is the expensive kind of wrong: it sends someone into the extension
    // looking for something that is not there. So the row says what was measured and names
    // the one command that separates the two readings.
    const verdict = n === RUNS
      ? 'fails every run OF THIS SET — run it alone to tell a defect from load: ' +
        `node tools/flake-ledger.mjs 8 --suite=${fileOf(suite)}`
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
    perSuite: Object.fromEntries(rows), sets: runs.map((r) => r.failed),
    why: runs.map((r) => r.why)
  }, null, 2));
  console.log(`written: ${OUT}`);
}
