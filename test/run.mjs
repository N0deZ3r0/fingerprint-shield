// Runs the whole dev-*.html suite in one command.
//
// Why this exists: the suite used to be driven by hand, fifteen navigations at a time,
// and a check skipped by accident looked exactly like a check that passed. The
// in-page runner that replaced it (dev-all.html) loaded each page in a nested iframe
// and dev-allofff.html never finished there — a runner that silently disagrees with
// what it claims to run is worse than no runner. Playwright gives every page its own
// tab, which is the same context the pages were written for.
//
//   node test/run.mjs              all checks
//   node test/run.mjs canvas font  only checks whose name matches a filter
//   node test/run.mjs --headed     watch it happen
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Pages that end with a machine-readable verdict.
const CHECKS = [
  'dev-syntaxcheck.html',
  'dev-runtime.html',
  'dev-wasm.html',
  'dev-wvw.html',
  'dev-enc.html',
  'dev-allfn.html',
  'dev-vsnative.html',
  'dev-allofff.html',
  'dev-perflag.html',
  'dev-symmetry.html',
  'dev-creepcanvas.html',
  'dev-creepcanvashash.html',
  'dev-canvasconsistency.html',
  'dev-fontcheck.html',
  'dev-fontscope.html',
  'dev-textmetrics.html',
  'dev-textwidth-port.html',
  'dev-clientcode.html',
  'dev-dtf-format.html',
  'dev-datecost.html',
  'dev-objecttypes.html',
  'dev-sandboxframe.html',
  'dev-insertcost.html',
  'dev-ownprops.html',
  'dev-plugins.html',
  'dev-fntostring.html',
  'dev-workerpayload.html',
  'dev-worker-patch.html',
  'dev-drawimagelossless.html',
  'dev-lies.html',
  'dev-behavior.html',
  'dev-async.html',
  // The three afp-*-console-check.js files ship to users through README.txt and had no
  // suite at all — they rotted silently and reported FAIL against a working extension.
  'dev-consolechecks.html',
  // Was in NOT_COVERED with the note "FAILS by design until the module is fixed" — it
  // measured 5 of 12 reads masked. The module is fixed ([FIX adblock-mask-contradicted-
  // itself] in mw/mw-adblock.js) and the page reports 12 of 12, so it is a real check now.
  'dev-adblockmask.html',
  // Same probe with the clientRects feature ON and the bait on a fractional origin, so the
  // two getBoundingClientRect patches (mw-misc noise + mw-adblock mask) are exercised
  // together — the case dev-adblockmask.html cannot reach. See
  // [FIX adblock-zero-check-vs-clientrects-noise].
  'dev-adblockmask-clientrects.html',
  'dev-mediaparity.html',
];

// Descriptive or console-driven; listed so nobody assumes they are covered.
const NOT_COVERED = [
  ['dev-readbackwarn.html', 'counts Chrome readback warnings — read the console'],
  ['dev-warnvisible.html', 'proves the page cannot trap that warning'],
  ['dev-timingvar.html', 'shows getTimingResolution is not stable'],
  ['dev-backendmatrix.html', 'native GPU/CPU canvas matrix, no extension code'],
  ['dev-scopecanvas-standalone.html', 'run in a real browser with the extension on'],
  ['dev-popup-preview.html', 'renders the real popup with a chrome.* stub — look at it, it asserts nothing'],
  // WebGPU needs a real GPU AND a secure origin. This runner serves 127.0.0.1, which is a
  // secure origin, so navigator.gpu is there — but headless Chromium resolves
  // requestAdapter() to null, so every row would skip and the page would report
  // FAILURES: 0 forever. Listing it here rather than in CHECKS keeps that from reading as
  // a pass; the page says the same thing in its own verdict.
  // Both measured the AudioContext noise, which was removed together with the `audio`
  // flag — see the "AUDIO — НЕ ПАТЧИМ" note in mw/mw-canvas-audio.js. Kept as a record of
  // what was measured, listed here so neither is mistaken for a live check.
  ['dev-audio-akamai.html', 'measured the AudioContext noise, which no longer exists'],
  ['dev-audio-consistency.html', 'measured the AudioContext noise, which no longer exists'],
  ['dev-webgpu-parity.html', 'needs a real GPU — headless returns a null adapter; run: node test/run.mjs --headed webgpu'],
  // The fourteen below were in NEITHER list — not run, and not declared unrun either, so
  // the count at the bottom of this file described a smaller suite than the directory held
  // and nothing said so. Each was measured against this runner before being written down
  // here: all fourteen print a readout and state no verdict it can match, so they belong
  // with the descriptive pages rather than in CHECKS. Adding one to CHECKS means giving it
  // a verdict line first — see the note on dev-perflag.html above, which was red for
  // exactly this reason and needed the line, not a longer timeout.
  ['dev-akamai-max.html', 'Akamai-style multi-signal readout — compare the table by eye'],
  ['dev-akamai-probe.html', 'smaller Akamai-style readout — compare the table by eye'],
  ['dev-blank.html', 'an empty page, used as the control realm for other probes'],
  ['dev-bugfield.html', 'asks whether pristine Chrome already splits permissions/Notification across scopes — needs a clean browser beside it'],
  ['dev-checkintegrity.html', 'canvas position/path consistency readout (1x1 vs block reads)'],
  ['dev-clientcode-worker.html', 'CreepJS getClientCode over the blob-worker path — read the output'],
  ['dev-fonts-check.html', 'font consistency readout, incl. invalid CSS that must throw'],
  ['dev-hardcore.html', 'broad anti-detect self-test table — read it, it states no verdict'],
  ['dev-intl-locale.html', 'Intl locale coverage across the constructors — read the table'],
  ['dev-paintbackend.html', 'default vs willReadFrequently canvas backends — no extension code'],
  ['dev-parity-iframe-worker.html', 'runs afp-parity-console.js in an iframe and a worker — read the output'],
  ['dev-webgl-parity.html', 'WebGL getParameter against the GPU_DATA table — read the table'],
  ['dev-webgl-readpixels.html', 'WebGL readPixels/getParameter parity readout'],
  ['dev-webgl-shader-precision.html', 'getShaderPrecisionFormat vs the ANGLE/D3D11 reference matrix'],
  // Not probes at all — listed so the "is every page declared" guard in
  // test/parity-static.mjs can tell "deliberately not a check" from "forgotten". Both were
  // referenced elsewhere (one in this file's own header, one as an iframe target), which is
  // why a grep for their names made them look accounted for when they were not.
  // Cannot produce a trustworthy verdict over http, and says so in its own header: both
  // stack cleaners key on 'chrome-extension://', which no page served by this runner has,
  // so it measures the rig rather than the code. Needs the real-extension rig instead.
  ['dev-stealthstack.html', 'error-stack leakage — INERT over http; run it under the real extension (see its header)'],
  ['dev-all.html', 'the superseded in-page runner this file replaced — see the header'],
  ['dev-flagcase.html', 'one realm for one flag combination; driven by dev-perflag.html, not run alone'],
];

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css',
  '.source': 'text/plain', '.cjs': 'text/javascript', '.txt': 'text/plain',
};

function serve() {
  return new Promise((ok) => {
    const s = createServer(async (req, res) => {
      const path = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      // Everything is served from the extension directory and nothing above it.
      const file = join(ROOT, path);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          'content-type': MIME[extname(file)] || 'application/octet-stream',
          'cache-control': 'no-store',
        }).end(body);
      } catch { res.writeHead(404).end('not found'); }
    });
    s.listen(0, '127.0.0.1', () => ok({ server: s, port: s.address().port }));
  });
}

// A page is done when it states a verdict. Three shapes are in use across the suite.
function verdictOf(text) {
  if (!text || /^\s*running/i.test(text)) return null;
  const m = /FAILURES:\s*(\d+)/.exec(text);
  const passFail = /(\d+)\s+passed,\s*(\d+)\s+failed/i.exec(text);
  const failLines = text.split('\n').filter((l) => /^\s*FAIL\b/.test(l));
  // A page that PASSES states it with a line beginning "PASS". That shape was missing
  // here, so a passing page matched none of the patterns, the runner waited out the full
  // 45s timeout and then reported it as FAILED — 11 of the 24 checks were permanently red
  // no matter what the code did, which is precisely the "runner that silently disagrees
  // with what it claims to run" this file's header warns about. Failure is still decided
  // by the FAIL lines below; PASS only tells us the page has finished.
  const passLines = text.split('\n').filter((l) => /^\s*PASS\b/.test(l));
  const verdict = /^\s*VERDICT\b.*$/m.exec(text);
  if (!m && !passFail && !failLines.length && !passLines.length && !verdict) return null;
  const n = m ? Number(m[1])
    : passFail ? Number(passFail[2])
    : failLines.length;
  const verdictBad = verdict
    && /\bFAIL\b|<<<|\bSPLIT\b/.test(verdict[0])
    && !/no lie|not the cause|did not|every engine constant|passed through/i.test(verdict[0]);
  // [FIX a-failing-page-that-said-nothing] A page whose verdict is "FAILURES: 1" and whose
  // rows are TABLE CELLS rather than lines beginning with FAIL produced no detail at all:
  // CI printed "dev-datecost.html … FAIL 484ms" and nothing else, on a machine the author
  // cannot reach, which leaves guessing as the only next step. Any line MENTIONING fail is
  // taken when the line-start shape found none — it is a last resort and it is better than
  // silence.
  const failish = text.split('\n')
    .filter((l) => /\bFAIL\b/i.test(l) && !/^\s*FAILURES:/i.test(l))
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  return {
    failed: n > 0 || !!verdictBad,
    detail: failLines.slice(0, 2).map((s) => s.trim()).join(' | ')
      || (n > 0 ? failish.slice(0, 2).join(' | ') : '')
      || (passFail ? passFail[0] : '')
      || (verdict ? verdict[0].trim().slice(0, 100) : ''),
  };
}

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const filters = args.filter((a) => !a.startsWith('--'));
// An explicit filter can also reach the NOT_COVERED pages. Those are excluded from the
// automated set because they cannot produce a trustworthy verdict unattended — a real GPU,
// a console to read — but naming one is a deliberate act, and `node test/run.mjs --headed
// webgpu` telling you "0 checks passed" is a worse answer than running the page.
const wanted = filters.length
  ? CHECKS.concat(NOT_COVERED.map(([n]) => n)).filter((c) => filters.some((f) => c.includes(f)))
  : CHECKS;

console.log(`Serving ${ROOT}`);
console.log(`Running ${wanted.length} check(s)${headed ? ' (headed)' : ' (headless)'}…`);
console.log('(Progress prints per file; up to ~45s each if no verdict.)\n');

const { server, port } = await serve();
const browser = await chromium.launch({ headless: !headed });
const ctx = await browser.newContext();
const rows = [];
const PAGE_TIMEOUT = 45000;
// Per-page overrides for anything that legitimately needs longer than the default.
// dev-perflag drives sixteen sequential iframe realms, each loading the full module set.
// It is not actually slow — each realm answers in about 50ms — but it was assumed to be,
// because it reported a timeout on every run; the real cause was that it stated no
// verdict this runner could match. Kept a little generous since its inner guard allows
// 25s per realm if one ever does stall.
const PAGE_TIMEOUT_OVERRIDE = {
  'dev-perflag.html': 90000,
};

for (let i = 0; i < wanted.length; i++) {
  const check = wanted[i];
  process.stdout.write(`[${i + 1}/${wanted.length}] ${check} … `);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('threw: ' + e.message));
  const started = Date.now();
  let result = null;
  try {
    await page.goto(`http://127.0.0.1:${port}/${check}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    result = await page.waitForFunction(() => {
      const el = document.getElementById('out') || document.getElementById('sum') || document.body;
      const t = el && el.textContent;
      if (!t || /^\s*running/i.test(t)) return null;
      return /FAILURES:\s*\d+/.test(t) || /^\s*FAIL\b/m.test(t) || /^\s*VERDICT\b/m.test(t)
        || /^\s*PASS\b/m.test(t)
        || /\d+\s+passed/i.test(t) || /\d+\s+failed/i.test(t)
        ? t : null;
    }, null, { timeout: PAGE_TIMEOUT_OVERRIDE[check] || PAGE_TIMEOUT, polling: 200 })
      .then((h) => h.jsonValue());
  } catch (e) {
    result = null;
    if (!errors.length) errors.push(e.message || 'timeout');
  }
  const ms = Date.now() - started;
  const v = result ? verdictOf(result) : null;
  if (!v) {
    rows.push({ check, ok: false, detail: errors[0] || 'never produced a verdict', ms });
    console.log(`FAIL  ${ms}ms  ${errors[0] || 'no verdict'}`);
  } else {
    rows.push({ check, ok: !v.failed, detail: v.detail, ms });
    console.log(`${v.failed ? 'FAIL' : 'ok  '}  ${ms}ms` + (v.detail ? `  ${v.detail}` : ''));
  }
  await page.close();
}

await browser.close();
server.close();

const pad = Math.max(...rows.map((r) => r.check.length));
let failed = 0;
for (const r of rows) {
  if (!r.ok) failed++;
  const mark = r.ok ? 'ok  ' : 'FAIL';
  console.log(
    `${mark}  ${r.check.padEnd(pad)}  ${String(r.ms).padStart(5)}ms` +
    (r.detail ? `  ${r.detail}` : '')
  );
}
console.log('');
console.log(failed ? `${failed} of ${rows.length} checks FAILED` : `all ${rows.length} checks passed`);
if (!filters.length) {
  console.log('\nnot covered by this runner:');
  for (const [n, why] of NOT_COVERED) console.log(`  ${n.padEnd(34)} ${why}`);
}
process.exit(failed ? 1 : 0);
