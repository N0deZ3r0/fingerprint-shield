/**
 * WHICH DEV PAGES CAN ACTUALLY FAIL.
 *
 *   node tools/probe-devpages.mjs
 *   node tools/probe-devpages.mjs canvas font    only checks whose name matches
 *
 * test/run.mjs drives all of dev-*.html through `chromium.launch()` — a PLAIN browser, with
 * no --load-extension anywhere in the file. The obvious conclusion is that none of those
 * pages can be evidence about the extension. IT IS WRONG, and this tool was built on it
 * before anyone checked: **most of the dev pages load `mw/mw-*.js` THEMSELVES**, each
 * carrying its own MODULES list, so the wrappers are installed on the page whether an
 * extension is present or not. That is the design — it is how they measure the modules in a
 * browser nothing can be loaded into.
 *
 * Which makes the question this tool asks a narrow one: what happens if the extension is
 * loaded UNDERNEATH such a page. The answer is that every module is applied twice, one
 * wrapper around another, and the failures that follow are the double install. The first
 * version reported "10 of 36 would break" and NINE of those ten were self-installing — the
 * number was the instrument, not the build. `dev-perflag.html` looked like the one survivor
 * until the page it drives in its iframes, `dev-flagcase.html`, turned out to carry the same
 * list.
 *
 * So the tool now sorts self-installing pages out first and judges nobody on a double
 * install. What is left in the "would break" column is a page that does NOT install the
 * modules and still fails with the extension present, which would be worth reading.
 *
 * A page can still be unable to fail — dev-adblockmask.html prints FAILURES: 0 against a
 * build with a real defect in it — but the reason is the page's own assertions, not the
 * browser it runs in. See the header of test/pagework.mjs, where that one was measured.
 *
 * Exit code is the number of pages that FAIL with the extension loaded.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER, root, loadBackground, loadPopup } from '../test/harness.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const headed = process.argv.includes('--headed');
const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// The list is READ OUT of test/run.mjs rather than copied: a page added there has to be
// judged here too, and a second copy of a list this long would drift within a week.
const runSrc = readFileSync(join(ROOT, 'test', 'run.mjs'), 'utf8');
const block = runSrc.slice(runSrc.indexOf('const CHECKS = ['), runSrc.indexOf('];', runSrc.indexOf('const CHECKS = [')));
const CHECKS = [...block.matchAll(/'([^']+\.html)'/g)].map((m) => m[1]);

/**
 * [FIX the-tool-called-its-own-double-install-a-defect] A page that loads `mw/mw-*.js` as
 * page scripts INSTALLS THE MODULES ITSELF — that is how it measures them in a browser with
 * no extension, and dev-lies.html even spells out the load order. Running such a page with
 * the extension loaded applies every module TWICE, one wrapper around another, and what it
 * then reports is the double install, not the build.
 *
 * The first version of this tool did not know that and reported ten pages as "would break if
 * run.mjs loaded the extension". NINE of the ten load their own modules. The number was an
 * artefact of the instrument, and it was written into the open-work list and repeated before anyone
 * checked what those pages do — the same mistake this file was built to catch, one level up:
 * a measurement whose conditions do not match the thing being measured.
 *
 * They are separated out rather than dropped: which pages are self-installing is exactly what
 * a reader needs to know before trusting either column.
 */
const selfInstalls = (name, depth) => {
  try {
    var src = readFileSync(join(ROOT, name), 'utf8');
    if (/mw\/mw-[a-z-]+\.js/.test(src)) return true;
    // One level of children: dev-perflag.html installs nothing itself and drives
    // dev-flagcase.html in sixteen iframes, which does.
    if (depth) return false;
    var kids = [...src.matchAll(/(dev-[a-z0-9-]+\.html)/g)].map((m) => m[1]);
    return kids.some((k) => k !== name && selfInstalls(k, 1));
  } catch (e) { return false; }
};
if (!CHECKS.length) { console.error('could not read CHECKS out of test/run.mjs'); process.exit(2); }
const wanted = filters.length ? CHECKS.filter((c) => filters.some((f) => c.includes(f))) : CHECKS;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.source': 'text/plain' };
const server = createServer(async (q, r) => {
  try {
    const p = join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, ''));
    if (!p.startsWith(ROOT)) { r.writeHead(403).end(); return; }
    const body = await readFile(p);
    r.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream',
      'cache-control': 'no-store' }).end(body);
  } catch (e) { r.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// The same predicate test/run.mjs waits on, so "produced a verdict" means the same thing in
// both files and a page that this one times out on is one that one would fail too.
const VERDICT = () => {
  const el = document.getElementById('out') || document.getElementById('sum') || document.body;
  const t = el && el.textContent;
  if (!t || /^\s*running/i.test(t)) return null;
  return /FAILURES:\s*\d+/.test(t) || /^\s*FAIL\b/m.test(t) || /^\s*VERDICT\b/m.test(t)
    || /^\s*PASS\b/m.test(t) || /\d+\s+passed/i.test(t) || /\d+\s+failed/i.test(t) ? t : null;
};

async function readPage(ctx, check) {
  const page = await ctx.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}/${check}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const h = await page.waitForFunction(VERDICT, null,
      { timeout: check === 'dev-perflag.html' ? 90000 : 45000, polling: 200 });
    return String(await h.jsonValue()).trim();
  } catch (e) {
    return null;                       // no verdict — run.mjs would call this a failure
  } finally {
    await page.close();
  }
}

const cleanBrowser = await chromium.launch({ ...BROWSER, headless: !headed });
const cleanCtx = await cleanBrowser.newContext();
const dir = mkdtempSync(join(tmpdir(), 'afp-devpages-'));
const extCtx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
// THE PROFILE HAS TO BE SET, or half the answer is a rig artefact. Measured on the first
// run of this tool, with the extension at its defaults: dev-dtf-format.html reported two
// failures of the form `want "Eastern European Standard Time", got "Eastern Standard Time"`
// — the page was written against a Tallinn profile and a fresh install answers with the
// cold-start stub's America/New_York. That is the page and the rig disagreeing about the
// fixture, not the extension being wrong, and reported as a defect it would have cost
// somebody an afternoon. laptop_mid/EE is what the dev pages expect; it is also what
// test/geopolicy.mjs and friends set.
{
  const sw = extCtx.serviceWorkers()[0] || await extCtx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  const { COUNTRY_DATA } = loadBackground(['COUNTRY_DATA']);
  const { PROFILES } = loadPopup(['PROFILES']);
  const P = PROFILES.find((x) => x.id === 'laptop_mid');
  const C = COUNTRY_DATA['EE'];
  await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
    afp_profile_id: P.id,
    afp_profile_data: {
      screenW: P.screenW, screenH: P.screenH, cores: P.cores,
      memory: P.memory, gpu: P.gpuKey, platform: P.platform, dpr: P.dpr
    },
    afp_country_code: 'EE', afp_resolved_timezone: C.tz, afp_resolved_locale: C.loc,
    afp_mode: 'normal'
  });
  await new Promise((r) => setTimeout(r, 1500));
}

const rows = [];
try {
  for (let i = 0; i < wanted.length; i++) {
    const check = wanted[i];
    process.stdout.write(`[${i + 1}/${wanted.length}] ${check} … `);
    const a = await readPage(cleanCtx, check);      // clean, load 1
    const b = await readPage(cleanCtx, check);      // clean, load 2 — the volatility control
    const c = await readPage(extCtx, check);        // with the extension
    // run.mjs's own rule: a verdict is failing if it names a non-zero count.
    const fails = (t) => {
      if (t === null) return null;
      const m = /FAILURES:\s*(\d+)/.exec(t) || /(\d+)\s+failed/i.exec(t);
      if (m) return Number(m[1]);
      return /^\s*FAIL/m.test(t) ? 1 : 0;
    };
    const fc = fails(a), fo = fails(c);
    let state;
    if (selfInstalls(check, 0)) state = 'self-installing';
    else if (a === null) state = 'no verdict clean';
    else if (c === null) state = 'NO VERDICT with us';
    else if (fo > 0) state = 'FAILS with us';
    else if (a !== b) state = 'volatile, both pass';
    else if (a === c) state = 'same text, both pass';
    else state = 'reacts, both pass';
    rows.push({ check, state, fc, fo });
    console.log(`${state}   (clean ${fc}, ours ${fo})`);
  }
} finally {
  await cleanBrowser.close();
  await extCtx.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  server.close();
}

const by = (s) => rows.filter((r) => r.state === s);
const bad = rows.filter((r) => r.state === 'FAILS with us' || r.state === 'NO VERDICT with us');
const NL = String.fromCharCode(10);
console.log(NL + '=== would BREAK if test/run.mjs loaded the extension ===' + NL);
for (const r of bad) console.log(`  ${r.state.padEnd(20)} ${r.check.padEnd(34)} clean ${r.fc}, ours ${r.fo}`);
if (!bad.length) console.log('  (none - every page still passes with the extension loaded)');
console.log(NL + '=== installs the modules itself: must run CLEAN, not judged here ===' + NL);
for (const r of by('self-installing')) console.log('  ' + r.check.padEnd(34) + `clean ${r.fc}, ours ${r.fo} (double install)`);
if (!by('self-installing').length) console.log('  (none)');
console.log(NL + '=== passes either way, and its output does not move ===');
console.log('   (not evidence about this extension: satisfied with nothing loaded)' + NL);
for (const r of by('same text, both pass')) console.log('  ' + r.check);
console.log(NL + '=== passes either way, output moves ===' + NL);
for (const r of by('reacts, both pass')) console.log('  ' + r.check);
for (const r of by('volatile, both pass')) console.log('  ' + r.check + '   (volatile - its own output differs between two clean loads)');
console.log(NL + `${rows.length} pages: ${by('self-installing').length} install the modules themselves, ` +
  `${bad.length} of the rest would break under the extension, ` +
  `${by('same text, both pass').length} print the same either way.` + NL);
process.exit(bad.length);
