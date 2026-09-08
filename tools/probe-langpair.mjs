// DOES THE HEADER AGREE WITH THE SCRIPT?
//
//   node tools/probe-langpair.mjs
//   FPS_PATCHED=<path-to-chrome.exe> node tools/probe-langpair.mjs
//
// Every other instrument in tools/ reads the page. Fingerprint Pro does not: it is a server
// product, and the request that carries the fingerprint carries the REQUEST HEADERS beside
// it. So there is a whole coherence check nothing here has ever run — whether the
// Accept-Language this extension puts on the wire is the one its own navigator claims, in
// the shape a browser actually belonging to that country would produce.
//
// It is worth asking because `bot: bad` was isolated, module by module, to the navigator
// layer and inside it to navigator.language, and because the header is rewritten by a DNR
// rule that is a SEPARATE mechanism from the JS claim. Two mechanisms for one value is how
// [FIX header-vs-js-platform-version-drift] happened: a ghost rule from an older build kept
// rewriting a hint the script had stopped claiming, and nothing in the tree could see it,
// because every suite read the page.
//
// Three browsers again, and the first is the one that matters most here — a clean Chromium
// actually launched in Estonian is the ground truth for what an Estonian browser sends, not
// a guess about it. Chromium's ReduceAcceptLanguage trial is live in this rig on purpose
// (harness.mjs keeps the field-trial config rather than suppressing it, so the rig is the
// browser people run), which is exactly the behaviour a hand-written header can miss.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, loadBackground, loadPopup, bootSettled } from '../test/harness.mjs';

const PATCHED = process.env.FPS_PATCHED || '';
const { COUNTRY_DATA } = loadBackground(['COUNTRY_DATA']);
const { PROFILES } = loadPopup(['PROFILES']);
const SEL = { id: 'laptop_mid', cc: 'EE' };
const CC = COUNTRY_DATA[SEL.cc];

// The document request is the one that counts — it is the one a server product reads beside
// the payload — but a subresource is recorded too, because DNR rules can be scoped by
// resource type and a rule that covers one and not the other is its own contradiction.
const seen = [];
const server = createServer((q, r) => {
  seen.push({ url: q.url, al: q.headers['accept-language'] || '(none)' });
  if (q.url === '/sub.js') return r.writeHead(200, { 'content-type': 'application/javascript' }).end('void 0;');
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    .end('<!doctype html><script src="/sub.js"></script>hi');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

async function read(label, opts, withExt) {
  const mark = seen.length;
  const dir = mkdtempSync(join(tmpdir(), 'afp-lang-'));
  const ctx = await chromium.launchPersistentContext(dir, opts);
  try {
    if (withExt) {
      const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await bootSettled(sw);
      const p = PROFILES.find((x) => x.id === SEL.id);
      await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
        afp_profile_id: p.id,
        afp_profile_data: { screenW: p.screenW, screenH: p.screenH, cores: p.cores,
          memory: p.memory, gpu: p.gpuKey, platform: p.platform },
        afp_country_code: SEL.cc, afp_resolved_timezone: CC.tz,
        afp_resolved_locale: CC.loc, afp_mode: 'normal'
      });
      await new Promise((r) => setTimeout(r, 1500));
    }
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    if (withExt) await page.reload({ waitUntil: 'load' });
    const js = await page.evaluate(() => ({
      language: navigator.language,
      languages: (navigator.languages || []).join(','),
      intl: new Intl.DateTimeFormat().resolvedOptions().locale
    }));
    const mine = seen.slice(mark);
    const doc = mine.filter((x) => x.url === '/').pop();
    const sub = mine.filter((x) => x.url === '/sub.js').pop();
    return { label, js, doc: doc ? doc.al : '(no request)', sub: sub ? sub.al : '(no request)' };
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
  }
}

const rows = [];
console.log(`reading, claim = ${CC.loc} / ${SEL.cc}\n`);
// NO Playwright `locale` here, deliberately. That option drives Emulation.setLocaleOverride
// and a CDP Accept-Language override, so the browser stops being a browser launched in
// Estonian and becomes one told what to answer — it reported a single-value header and an
// et-EE Intl default, which is the emulation talking, not Chromium. --lang is what a user's
// install actually varies. Both region forms are read because Chrome's UI language is
// usually region-less (this host's own is bare `ru`), so `et` is the likelier real setting
// and `et-EE` the one the profile claims.
rows.push(await read('A  clean, --lang=' + CC.loc, {
  ...BROWSER, headless: true, args: ['--lang=' + CC.loc]
}, false));
rows.push(await read('A2 clean, --lang=' + CC.loc.split('-')[0], {
  ...BROWSER, headless: true, args: ['--lang=' + CC.loc.split('-')[0]]
}, false));
if (PATCHED && existsSync(PATCHED)) {
  rows.push(await read('B  patched build, --fps-lang', {
    executablePath: PATCHED, headless: true,
    ignoreDefaultArgs: ['--disable-field-trial-config'],
    args: ['--fps-profile=' + SEL.id, '--fps-lang=' + CC.loc, '--fps-timezone=' + CC.tz]
  }, false));
} else {
  console.log('  (no FPS_PATCHED — running without the patched build)\n');
}
rows.push(await read('C  this extension', {
  ...BROWSER, headless: true,
  args: ['--disable-extensions-except=' + root, '--load-extension=' + root]
}, true));
server.close();

for (const r of rows) {
  console.log(r.label);
  console.log('   Accept-Language, document   ' + r.doc);
  console.log('   Accept-Language, script     ' + r.sub);
  console.log('   navigator.language          ' + r.js.language);
  console.log('   navigator.languages         ' + r.js.languages);
  console.log('   Intl default locale         ' + r.js.intl);
  console.log('');
}

// The question is not whether our header equals the clean browser's byte for byte — it is
// whether the RELATION between header and script is the same one. A browser whose header
// disagrees with its own navigator is a contradiction a server sees for free, and neither
// value alone would show it.
const A = rows[0];
const shape = (r) => (r.doc === '(none)' ? 'no header'
  : r.doc === r.js.languages ? 'header == navigator.languages'
  : r.doc.split(',')[0].split(';')[0] === r.js.language ? 'header leads with navigator.language'
  : 'HEADER AND SCRIPT DISAGREE');
console.log('the relation each browser holds between its header and its script');
for (const r of rows) console.log('  ' + r.label.slice(0, 30).padEnd(32) + shape(r));

const bad = rows.filter((r) => shape(r) !== shape(A));
console.log('');
if (!bad.length) {
  console.log('every browser holds the same relation the clean one does — no server-side contradiction here.');
} else {
  console.log(bad.length + ' browser(s) hold a relation the clean browser does not:');
  for (const r of bad) console.log('  ' + r.label.trim() + '  ->  ' + shape(r));
  console.log('\nA server reads both halves of this in one request, with no script at all.');
}
