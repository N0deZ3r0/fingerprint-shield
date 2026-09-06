/**
 * CreepJS's OWN test pages, served locally, ours against a clean browser of the same binary.
 *
 *   node test/creepjs.mjs            headless
 *   node test/creepjs.mjs --headed   watch them render
 *
 * Every other suite here asks whether this build contradicts ITSELF. These two pages ask
 * something no self-consistency check can: whether the values are what a browser's own
 * libraries would produce. The difference is not theoretical — on 2026-09-03 the user
 * opened `tests/timezone.html` in their real Chrome and read
 *
 *     ✖ reported location: Europe/Tallinn fake
 *
 * while all 38 suites were green. The page builds `+new Date('7/1/1113')` and looks the
 * epoch up in a table of every zone's LMT offset; the zone model had one CURRENT rule per
 * zone and applied it to the twelfth century. Nothing in test/ could see it, because
 * nothing in test/ knew what 1113 is supposed to be — and the fix
 * ([FIX the-zone-model-had-no-history]) is exactly the kind that a rewrite can undo
 * silently. So the page itself becomes a fixture.
 *
 * The fixtures are the upstream files, unmodified, in test/fixtures/creepjs/ — fetched
 * 2026-09-03 from github.com/abrahamjuliot/creepjs (docs/tests/). They are a THIRD PARTY's
 * checks and are meant to be replaced wholesale when refreshed, never edited: an edited
 * copy would be this project marking its own homework. tools/pack.mjs excludes test/, so
 * they do not ship.
 *
 * THE VERDICT IS A COMPARISON, never a fixed expectation. A clean browser of the same
 * binary renders the same page in the same rig, and ours must add no marker it does not
 * have. Asserting "no fake anywhere" would fail on the rig's own quirks (headless has no
 * service worker fonts, the CI runner has no GPU) and would be a different, weaker claim.
 *
 *   timezone.html   every `.fake` / `.erratic` marker, by the row it sits in
 *   workers.html    the window / dedicated / shared / service scope hashes, and which of
 *                   them the page paints red against the window — the split
 *                   [[creepjs-worker-scope-page]] is about
 *
 * On `localhost`, not 127.0.0.1: workers.html registers a service worker, and the CSP
 * lists this project learns are per host — 127.0.0.1 is the address every other suite
 * teaches, and a page here must not inherit their history.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';

const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };
const eq = (a, b, m) => ok(a === b, `${m}\n      ours  ${JSON.stringify(a)}\n      clean ${JSON.stringify(b)}`);

const FIX = join(root, 'test', 'fixtures', 'creepjs');
const TYPES = { js: 'application/javascript', html: 'text/html', css: 'text/css' };
const server = createServer((q, r) => {
  const name = (q.url || '/').split('?')[0].replace(/^\/+/, '') || 'timezone.html';
  const ext = name.split('.').pop();
  let body;
  try { body = readFileSync(join(FIX, name)); } catch (e) { r.writeHead(404).end('no'); return; }
  r.writeHead(200, { 'content-type': TYPES[ext] || 'text/plain', 'cache-control': 'no-store' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = (p) => `http://localhost:${port}/${p}`;

// Read the rendered page rather than re-running its logic: the markers ARE the verdict, and
// a re-implementation here would be a second thing to keep in step with upstream.
const READ_TZ = `(function () {
  var out = { marks: [], rows: {} };
  document.querySelectorAll('.fake, .erratic').forEach(function (el) {
    var row = el.parentNode;
    var label = String((row && row.textContent) || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    out.marks.push(el.className + ': ' + label);
  });
  document.querySelectorAll('#fingerprint-data > div > div').forEach(function (d) {
    // Each row opens with the page's own verdict glyph (✔ / ✖); the label starts after it.
    var t = String(d.textContent || '').replace(/\\s+/g, ' ').trim().replace(/^[^A-Za-z]+/, '');
    var i = t.indexOf(':');
    if (i > 0 && i < 40) out.rows[t.slice(0, i)] = t.slice(i + 1).trim();
  });
  return out;
})()`;

const READ_WK = `(function () {
  var cols = [];
  document.querySelectorAll('#fingerprint-data [style*="background"]').forEach(function (d) {
    var h = d.querySelector('.hash');
    if (!h) return;
    var name = String((d.querySelector('strong') || {}).textContent || '').trim();
    var bg = String(d.getAttribute('style') || '').replace(/\\s+/g, ' ');
    cols.push({
      scope: name || 'window',
      hash: String(h.textContent || '').trim(),
      red: /background:\\s*(?!none|#bbbbbb1f)\\S/.test(bg),
      grey: /#bbbbbb1f/.test(bg)
    });
  });
  return cols;
})()`;

async function measure(withExt, page, waitFor) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-creep-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !headed,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: withExt ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  try {
    if (withExt) {
      try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch (e) {}
      await new Promise((r) => setTimeout(r, 1500));   // onInstalled → initDefaults
    }
    const p = await ctx.newPage();
    // Twice: the first visit to a host is the documented residual of every per-site flag
    // here, and a comparison made in that window would measure the residual, not the page.
    await p.goto(url(page), { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1200));
    await p.goto(url(page), { waitUntil: 'load' });
    await p.waitForFunction(waitFor, null, { timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    return await p.evaluate(page === 'timezone.html' ? READ_TZ : READ_WK);
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  }
}

const TZ_READY = () => !!document.querySelector('#fingerprint-data .jumbo');
const WK_READY = () => document.querySelectorAll('#fingerprint-data .hash').length >= 3;

let tzClean, tzOurs, wkClean, wkOurs;
try {
  tzClean = await measure(false, 'timezone.html', TZ_READY);
  tzOurs = await measure(true, 'timezone.html', TZ_READY);
  wkClean = await measure(false, 'workers.html', WK_READY);
  wkOurs = await measure(true, 'workers.html', WK_READY);
} finally {
  server.close();
}

// ---- timezone.html ----------------------------------------------------------
console.log('\n=== timezone.html ===');
for (const [label, r] of [['clean', tzClean], ['ours', tzOurs]]) {
  console.log(`  ${label}: location=${JSON.stringify(r.rows['reported location'])} offset=${JSON.stringify(r.rows['reported offset'])} zone=${JSON.stringify(r.rows.zone)}`);
  console.log(`     marks: ${r.marks.length ? JSON.stringify(r.marks) : '(none)'}`);
}

// The rig has to be real, or every comparison below is two clean browsers.
ok(tzOurs.rows.zone !== tzClean.rows.zone || tzOurs.rows['reported offset'] !== tzClean.rows['reported offset'],
  `the extension is changing the zone (ours ${JSON.stringify(tzOurs.rows.zone)}, clean ${JSON.stringify(tzClean.rows.zone)})`);
eq(tzOurs.marks.length, tzClean.marks.length,
  `no marker the page does not also print for a clean browser — ${JSON.stringify(tzOurs.marks)}`);
ok(!/fake/.test(String(tzOurs.rows['reported location'])),
  `reported location is not called fake (${JSON.stringify(tzOurs.rows['reported location'])})`);
ok(!/fake/.test(String(tzOurs.rows['reported offset'])),
  `nor the offset (${JSON.stringify(tzOurs.rows['reported offset'])})`);
ok(!/fake/.test(String(tzOurs.rows.zone)) && !/fake/.test(String(tzOurs.rows.date)),
  `nor the zone label and the date (${JSON.stringify(tzOurs.rows.zone)})`);
eq(String(tzOurs.rows['system health']), String(tzClean.rows['system health']), 'system health reads as it does clean');
// The page derives a "computed location" from the 1113 epoch and prints the zone it lands
// in. That it EQUALS the reported zone is the whole 1113 check, from the page's own mouth.
ok(String(tzOurs.rows['computed location'] || '').includes(String(tzOurs.rows['reported location'] || 'x')),
  `the epoch of 7/1/1113 lands in the zone we report — computed ${JSON.stringify(tzOurs.rows['computed location'])}`);

// ---- workers.html -----------------------------------------------------------
console.log('\n=== workers.html ===');
const fmt = (cols) => cols.map((c) => `${c.scope || 'window'}=${c.hash}${c.red ? ' RED' : ''}${c.grey ? ' (none)' : ''}`).join('  ');
console.log(`  clean  ${fmt(wkClean)}`);
console.log(`  ours   ${fmt(wkOurs)}`);

ok(wkOurs.length >= 3 && wkClean.length >= 3, `the page rendered its scope panels (ours ${wkOurs.length}, clean ${wkClean.length})`);
if (wkOurs.length >= 3 && wkClean.length >= 3) {
  // Which scopes the page paints red against the window — that pattern, not the hashes
  // themselves, is what a reader of this page sees as "the scopes disagree".
  const pattern = (cols) => cols.map((c) => `${c.scope || 'window'}:${c.red ? 'red' : c.grey ? 'none' : 'ok'}`).join(',');
  // [FIX this-page-cannot-support-a-scope-verdict] NOT ASSERTED, and the reason is measured.
  //
  // This was `eq(pattern(wkOurs), pattern(wkClean))`, then a one-sided version of the same
  // rule ("a scope may not be RED for us where it is OK for clean"). Both flaked, and the
  // second one flaked in the direction that looks like a real defect. The counting settles it
  // — EIGHT consecutive runs of this suite, one unchanged build, tallying both sides of the
  // same run:
  //
  //     the clean browser's window disagreed with its own workers   6 of 8
  //     ours did                                                    4 of 8
  //
  // The window-scope hash on this page is BISTABLE in an unpatched browser, at a rate higher
  // than ours. A single draw from that cannot support any verdict about the extension: with
  // p ~ 0.5 on each side independently, "ours red, clean green" comes up by chance a quarter
  // of the time, and asserting on it manufactures a defect out of a coin toss. Reading either
  // side twice does not help — both reads land on the same alternate value often enough
  // (measured when a two-read stand-down was tried and still failed).
  //
  // So the pattern is PRINTED and not judged. The claim it was trying to make — this
  // extension does not pull the scopes apart — is made properly by two instruments that
  // enumerate stable values instead of hashing a page:
  //
  //   test/wbcoherence.mjs        the worker-readable surface on stand-down origins
  //   test/modeclaims.mjs part 4  36 enumerated values, window against worker, with a
  //                               liveness check that the stand-down actually fired
  //
  // Both are deterministic and both report 0 disagreements. Deleting this readout instead of
  // printing it would lose the only place the upstream page's own verdict is visible at all.
  const cleanPat = pattern(wkClean), oursPat = pattern(wkOurs);
  console.log(`  scope pattern (printed, NOT judged — this page's window hash is bistable in a\n` +
    `  clean browser too, 6 of 8 runs against our 4; see the comment in this file)\n` +
    `      ours  ${oursPat}\n      clean ${cleanPat}`);
  // And the window's own hash must have MOVED, or the page was measuring a clean browser.
  ok(wkOurs[0].hash !== wkClean[0].hash,
    `the window scope reports something else than clean (ours ${wkOurs[0].hash}, clean ${wkClean[0].hash})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
