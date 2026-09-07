/**
 * The shipped audit page, driven the way a user drives it.
 *
 *   node test/auditpage.mjs             headless
 *   node test/auditpage.mjs --headed    watch it
 *
 * WHY THIS EXISTS AT ALL, and it is not "because everything should have a test". The three
 * afp-*-console-check.js scripts shipped to users through README.txt with NO suite running
 * them, and they rotted silently: four separate rots accumulated, each reporting FAIL
 * against a perfectly correct build, until test/consolechecks.mjs was written to judge their
 * VERDICT rather than merely load them. audit.html is the same shape of thing — a consumer
 * of the extension's own surface, shipped, and read by a human rather than by a runner. It
 * gets a suite on the day it lands rather than after the same four rots.
 *
 * WHAT IT ASSERTS, and the second one is the point:
 *
 *   1. the page runs at all — tabs listed, injection succeeds, a verdict is printed;
 *   2. the verdict is GREEN, which means the page agreed that the tab it inspected reports
 *      the claim rather than the host. That is a real end-to-end statement about the
 *      extension, made through the same three sources the page uses;
 *   3. the check COUNT does not silently shrink. A row that stops being rendered takes its
 *      failure with it, and a page reporting "all 3 checks passed" reads exactly like one
 *      reporting "all 18 checks passed" to anything that only greps for green.
 *
 * The target tab is warmed before the audit runs. A profile created by mkdtemp is a FRESH
 * INSTALL, and for the first seconds of one the extension is still assembling itself — see
 * [FIX the-install-window-sent-the-host-instead-of-the-profile]. Skipping that measures the
 * install window and reports it as a defect in the page.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harness, root, BROWSER } from './harness.mjs';

const headed = process.argv.includes('--headed');
const { assert, done } = harness();

// /ttonly/ is youtube.com's trusted-types shape with blob: workers ALLOWED — what the
// per-site rewrite switch produces there: `require-trusted-types-for 'script'`, no name
// allowlist, and a `default` policy the page creates WITHOUT createScriptURL. The audit's
// own probe used to fail on it twice over; see the last section of this file.
const TT_PAGE = '<!doctype html><meta charset="utf-8"><title>audit target</title><body>target' +
  '<script>try{trustedTypes.createPolicy("default",{createHTML:function(s){return s;}});}catch(e){}</script>';

const server = createServer((q, r) => {
  // /noblob/ carries a CSP that refuses blob: workers — the shape of github.com and of
  // youtube.com's script-src fallback. The audit's own worker probe cannot run there, and
  // the last section of this file is about what it prints INSTEAD of a reading.
  if (q.url.startsWith('/noblob/')) {
    r.setHeader('content-security-policy', "worker-src 'self'");
    // And the other half of the same lesson: vk.com sends this, so the iframe scope loaded
    // nothing and printed TIMEOUT. The probe frames a srcdoc document now, which no framing
    // policy applies to — one target exercises both repairs.
    r.setHeader('x-frame-options', 'DENY');
  }
  if (q.url.startsWith('/ttonly/')) {
    r.setHeader('content-security-policy', "script-src 'self' blob: 'unsafe-inline'; require-trusted-types-for 'script'");
    return r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(TT_PAGE);
  }
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    .end('<!doctype html><meta charset="utf-8"><title>audit target</title><body>target');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const dir = mkdtempSync(path.join(tmpdir(), 'afp-auditpage-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER,
  headless: !headed,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});

try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  assert(id.length === 32, `the extension is loaded (id length ${id.length})`);

  const target = await ctx.newPage();
  for (let i = 0; i < 4; i++) {
    await target.goto(`http://127.0.0.1:${port}/t${i}`, { waitUntil: 'load' });
  }

  const audit = await ctx.newPage();
  const pageErrors = [];
  audit.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 120)));
  audit.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text().slice(0, 120)); });
  await audit.goto(`chrome-extension://${id}/audit.html`, { waitUntil: 'load' });

  // A page that throws while loading still renders its markup, and every assertion below
  // would then be about an empty document rather than about the extension.
  assert(pageErrors.length === 0,
    `audit.html loads without an error (${pageErrors.join(' | ') || 'clean'})`);

  const tabCount = await audit.$$eval('#tab option', (o) => o.length);
  assert(tabCount >= 1, `the tab picker offers the http target (${tabCount} option(s))`);

  await audit.click('#run');
  const finished = await audit
    .waitForFunction(() => document.getElementById('verdict').textContent.trim().length > 0,
      { timeout: 25000 })
    .then(() => true).catch(() => false);
  const status = await audit.$eval('#status', (e) => e.textContent.trim());
  assert(finished, `the audit finished and printed a verdict (status: ${status || 'empty'})`);

  const verdict = await audit.$eval('#verdict', (e) => e.textContent.trim());
  const m = verdict.match(/all (\d+) checks passed|(\d+) of (\d+) checks failed/);
  assert(!!m, `the verdict is in the shape this suite can read — "${verdict}"`);

  const passed = m && m[1] ? Number(m[1]) : 0;
  assert(/^all \d+ checks passed$/.test(verdict),
    `the audit is GREEN against this build — "${verdict}"`);

  // A shrinking count is how a green verdict becomes meaningless. 15 is below the 18 the
  // page renders today, so adding a row never breaks this and deleting three does.
  assert(passed >= 15,
    `the page still runs a full battery rather than a shrunken one (${passed} checks)`);

  // The claim column has to be populated, or every row in the first table reads "no claim"
  // and a green verdict means nothing was compared.
  const noClaim = await audit.$$eval('table tr td:nth-child(5)',
    (tds) => tds.filter((td) => td.textContent.trim() === 'no claim').length);
  assert(noClaim === 0,
    `every row had a claim from the service worker to compare against (${noClaim} without one)`);

  // [AUDIT copyable-state] The snapshot: the state a bug report needs, as one text block.
  await audit.waitForFunction(() => !document.getElementById('copy').disabled, null, { timeout: 8000 }).catch(() => {});
  const dump = await audit.$eval('#dump', (e) => e.value);
  assert(/^extension: \d+\.\d+/m.test(dump), 'the snapshot names the extension version');
  assert(/^tab: http:\/\/127\.0\.0\.1/m.test(dump), 'and the tab it inspected');
  assert(dump.includes(`verdict: ${verdict}`), 'and carries the verdict it printed');
  // Keys come back sorted through chrome.scripting's result serialisation.
  assert(/^page flags \(sessionStorage\): \{.*"v\.ui\.wb"/m.test(dump), 'and the per-site flags the page can read');
  assert(/^document headers \(service worker\): /m.test(dump), "and the document's own header verdict from the service worker");
  assert(/^host lists: \{"noblob":("route"|"host"|false)/m.test(dump) && /^per-site switches: \{"cspRewrite":(true|false)/m.test(dump),
    'and the host lists and per-site switches for this host');
  // [AUDIT routes-of-this-host] The lists are per route, so the snapshot names the routes.
  assert(/^routes of this host: /m.test(dump), 'and which routes of this host are on which list');
  assert(/^host seen both strict and loose: (true|false)$/m.test(dump),
    'and whether the host was seen both restricting and not (the mark that stops the collapse)');
  // innerText applies the page's text-transform, so the section title arrives in capitals.
  assert(/every scope tells the same story/i.test(dump), 'and the table itself');
  const hidden = await audit.$eval('#dump', (e) => e.hidden);
  assert(hidden === false, 'the snapshot is shown on the page once built');

  // [AUDIT the-snapshot-could-only-be-read-by-eye] The machine-readable half. Parsed rather
  // than pattern-matched: a regex over a JSON blob would pass on a string that no parser
  // accepts, which is the failure mode this block is here to prevent. The rows are the
  // claim/page/host table — the one measurement no rig can produce, because branded Chrome
  // refuses --load-extension — so a bug report can now be diffed instead of retyped.
  const jsonPart = dump.split('\n--- json ---\n')[1];
  assert(!!jsonPart, 'the snapshot carries a --- json --- block');
  let parsed = null;
  try { parsed = JSON.parse((jsonPart || '').trim()); } catch (e) { parsed = null; }
  assert(parsed && typeof parsed === 'object', 'and it parses');
  if (parsed) {
    assert(Array.isArray(parsed.rows) && parsed.rows.length > 0,
      `and carries the table as rows (${parsed.rows && parsed.rows.length})`);
    const row = (parsed.rows || [])[0] || {};
    assert(['key', 'claim', 'page', 'host', 'state', 'why'].every((k) => k in row),
      `each row has all five columns and its verdict (${Object.keys(row).join(',')})`);
    assert(parsed.rows.every((r) => ['ok', 'bad', 'skip'].includes(r.state)),
      'every row state is one of ok/bad/skip');
    // The prose and the object are written by one call each — assert they agree, or the
    // half nobody reads is free to drift.
    assert(parsed.verdict === verdict,
      `the json repeats the verdict the page printed (${parsed.verdict})`);
    assert(typeof parsed.extension === 'string' && /^\d+\.\d+/.test(parsed.extension),
      `and the extension version (${parsed.extension})`);
    const bad = parsed.rows.filter((r) => r.state === 'bad').length;
    console.log(`  json: ${parsed.rows.length} rows, ${bad} failing, verdict "${parsed.verdict}"`);
  }

  // And the three sources really are three: if the host column equalled the page column the
  // page would be reporting the machine, which is the failure the whole page exists to catch.
  const hostRow = await audit.$$eval('table tr', (trs) => {
    const tr = trs.find((r) => r.children[0] && r.children[0].textContent.trim() === 'timezone');
    return tr ? [...tr.children].map((td) => td.textContent.trim()) : null;
  });
  assert(!!hostRow && hostRow[2] !== hostRow[3],
    `the page and the host really differ, so the comparison is real ` +
    `(page ${hostRow && hostRow[2]}, host ${hostRow && hostRow[3]})`);

  // ── a scope that cannot be read must still be JUDGED ─────────────────────────
  //
  // [FIX a-scope-that-could-not-be-read-was-a-free-pass] Both of the real-browser runs
  // that prompted this printed 'no reading' for one of the two scopes — grey, uncounted,
  // verdict still green. This pins the property that replaced it: on an origin whose CSP
  // refuses blob: workers the audit cannot build its own worker, and it must say something
  // that counts either way rather than shrug.
  //
  // Deliberately NOT an assertion that the verdict is red. Whether the window contradicts
  // an unpatchable worker there is a property of the extension, and one that is meant to
  // change; whether the audit judges the scope at all is a property of the audit, and that
  // is what this file is for. Written the other way round, fixing the extension would have
  // broken this test.
  {
    const t2 = await ctx.newPage();
    for (let i = 0; i < 2; i++) {
      await t2.goto(`http://127.0.0.1:${port}/noblob/t${i}`, { waitUntil: 'load' });
    }
    const a2 = await ctx.newPage();
    await a2.goto(`chrome-extension://${id}/audit.html`, { waitUntil: 'load' });
    await a2.$$eval('#tab option', (opts) => {
      const sel = document.getElementById('tab');
      const hit = opts.find((o) => o.textContent.includes('/noblob/'));
      if (hit) sel.value = hit.value;
    });
    await a2.click('#run');
    await a2.waitForFunction(
      () => document.getElementById('verdict').textContent.trim().length > 0,
      { timeout: 25000 }).catch(() => {});
    const rows = await a2.$eval('#out', (e) => e.innerText);
    const v2 = await a2.$eval('#verdict', (e) => e.textContent.trim());
    const line = rows.split(/\r?\n/).find((l) => /^worker\t/.test(l)) || '';
    assert(!!line, `the worker scope has a row on a blob-refusing origin — ${line || '(no row)'}`);
    assert(!/no reading/i.test(line),
      `the worker scope is judged rather than skipped — ${line.slice(0, 110)}`);
    assert(/agrees|SPLIT|NO READING/.test(line),
      `and the judgement is one this suite recognises — ${line.slice(0, 110)}`);
    // [FIX the-audit-counted-the-stand-down-as-a-failure] And the verdict itself, which the
    // first version of this section deliberately did not assert because the redness was then
    // a property of the extension. It no longer is: the window yields on such an origin, the
    // audit knows the gate by reading the same two sessionStorage keys mw-core reads, and a
    // green verdict here means those two agree. Red means one of them changed without the
    // other — which is exactly what a real browser reported as "7 of 16 checks failed" on a
    // build where the stand-down was working perfectly.
    assert(/^all \d+ checks passed$/.test(v2),
      `the audit agrees with the stand-down instead of counting it — "${v2}"`);
    // [FIX the-two-halves-were-only-checkable-in-CI] The row that carries the half no page
    // can see. A document cannot read the headers its own request went out with, so until
    // this row existed the two halves of the stand-down could only be compared from a suite
    // — on a runner whose failure set on unchanged code ranges 0..12, where one observation
    // of them diverging could neither be confirmed nor reproduced. Asserted rather than
    // merely rendered, because a row nobody reads is a row that rots: the first version of
    // it looked only at whole-host exclusions and called every per-ROUTE stand-down a
    // disagreement, which this fixture caught immediately.
    const halves = rows.split(/\r?\n/).find((l) => /^stand-down, both halves\t/.test(l)) || '';
    assert(!!halves, `the audit reports both halves of the stand-down — ${halves || '(no row)'}`);
    assert(/the halves agree/.test(halves),
      `and on a blob-refusing origin they agree — ${halves.slice(0, 150)}`);
    assert(/by (host|route)/.test(halves),
      `and it says which exclusion covers it, host-wide or per route — ${halves.slice(0, 150)}`);
    // [AUDIT what-an-anti-detect-detector-reads] The section added after Fingerprint Pro
    // called this browser BrowserAutomationStudio with the extension on and clean without it.
    // It deliberately judges nothing — nobody has established which of these a detector
    // weighs — so what is asserted is that it READS: the rows exist, they carry both realms,
    // and window.chrome is among them, that being the one surface where this extension has
    // already shipped a defect (an invented chrome.runtime real Chrome does not have).
    const anti = rows.split(/\r?\n/).filter((l) => /^(chromeKeys|chromeTypes|fontPrefs|emojiWidth|webglParamHash)\t/.test(l));
    assert(anti.length >= 5,
      `the anti-detect surface is reported, page against host (${anti.length} rows)`);
    const chromeRow = anti.find((l) => /^chromeTypes\t/.test(l)) || '';
    assert(/app:/.test(chromeRow) && /runtime:/.test(chromeRow),
      `window.chrome's shape is among them (${chromeRow.slice(0, 120)})`);
    assert(/page = host|DIFFERS/.test(anti[0]),
      `and every row says whether the two realms agree (${anti[0].slice(0, 120)})`);
    const fline = rows.split(/\r?\n/).find((l) => /^same-origin iframe/.test(l)) || '';
    assert(!/no reading|TIMEOUT/i.test(fline),
      `the iframe scope survives a framing refusal — ${fline.slice(0, 110) || '(no row)'}`);
    await a2.close(); await t2.close();
  }

  // ── youtube's trusted-types shape with blob: allowed ────────────────────────────
  //
  // [FIX the-audit-probe-tripped-on-youtubes-default-policy] Reported from a real youtube.com
  // tab with the rewrite switch on: "worker failed to start" and a console error charged to
  // mw-bundle.js. Measured on the csprewrite fixture: the probe's retry threw on the page's
  // own `default` policy (no createScriptURL), and its first, bare-string attempt was
  // refused through the extension's Worker proxy, which is the frame Chrome names. Here the
  // worker must be a real reading that agrees with the window, and the page under audit
  // must not have printed a trusted-types refusal — the probe must not provoke one.
  {
    const t3 = await ctx.newPage();
    const targetConsole = [];
    t3.on('console', (m) => { if (m.type() === 'error') targetConsole.push(m.text().slice(0, 120)); });
    for (let i = 0; i < 2; i++) {
      // On localhost, not 127.0.0.1: the lists are per host, and section 2 has put 127.0.0.1
      // on the blob-refusing one, which would stand this document down before the audit ran.
      await t3.goto(`http://localhost:${port}/ttonly/t${i}`, { waitUntil: 'load' });
      await new Promise((r) => setTimeout(r, 400));
    }
    targetConsole.length = 0;
    const a3 = await ctx.newPage();
    await a3.goto(`chrome-extension://${id}/audit.html`, { waitUntil: 'load' });
    await a3.$$eval('#tab option', (opts) => {
      const sel = document.getElementById('tab');
      const hit = opts.find((o) => o.textContent.includes('/ttonly/'));
      if (hit) sel.value = hit.value;
    });
    await a3.click('#run');
    await a3.waitForFunction(
      () => document.getElementById('verdict').textContent.trim().length > 0,
      { timeout: 25000 }).catch(() => {});
    const rows3 = await a3.$eval('#out', (e) => e.innerText);
    const v3 = await a3.$eval('#verdict', (e) => e.textContent.trim());
    const wline = rows3.split(/\r?\n/).find((l) => /^worker\t/.test(l)) || '';
    assert(/all match the window/.test(wline) && /agrees/.test(wline),
      `on a trusted-types origin that allows blob: the audit's worker is a real reading that agrees — ${wline.slice(0, 120) || '(no row)'}`);
    assert(/^all \d+ checks passed$/.test(v3), `and the verdict is green — "${v3}"`);
    // [AUDIT who-is-named-in-a-refusal] On a document that requires Trusted Types the audit
    // provokes one bare-string refusal and reads who the record names — the live check of
    // [FIX a-refusal-we-passed-through-was-charged-to-us] in a browser no rig can load.
    const rline = rows3.split(/\r?\n/).find((l) => /^bare-string worker refusal/.test(l)) || '';
    assert(/refused by the wrapper/.test(rline) && /nothing names us/.test(rline),
      `the refusal row is a real reading and names nobody — ${rline.slice(0, 140) || '(no row)'}`);
    const tt = targetConsole.filter((l) => /TrustedScriptURL/.test(l));
    assert(tt.length === 0,
      `the probe provoked no trusted-types refusal in the page's console (${tt.length ? tt[0] : 'clean'})`);
    await a3.close(); await t3.close();
  }
} finally {
  await ctx.close();
  server.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
}

done();
