/**
 * MEASURE THE DEFAULT Intl LOCALE FOR EVERY COUNTRY, AND STORE IT.
 *
 *   node tools/gen-locales.mjs            measure and write data/countries.json
 *   node tools/gen-locales.mjs --dry      measure and print, write nothing
 *
 * `navigator.language` and `Intl.DateTimeFormat().resolvedOptions().locale` are NOT the same
 * string. On this host: navigator.language ru-RU, Intl default ru. Forced to Estonian:
 * navigator.language et-EE, Intl default et. The extension answered the profile's tag in
 * both places, so it reported `et-EE` as the Intl default — a value no browser produces.
 *
 * The rule cannot be derived. `new Intl.Locale(tag).minimize()` was the obvious candidate and
 * it is wrong for exactly the locales that have their own CLDR data — measured, 7 of 10:
 *
 *   et-EE -> et    ru-RU -> ru    de-DE -> de    fr-FR -> fr    nb-NO -> nb
 *   en-GB -> en-GB    es-MX -> es-MX               minimize() agrees on these seven
 *   en-US -> en-US    pt-BR -> pt-BR    zh-CN -> zh-CN   minimize() would say en, pt, zh
 *
 * So it is asked of the browser, once per distinct locale, and stored beside the GPU strings
 * and the crowd data for the same reason those are stored: measured, sourced, and re-runnable
 * when the browser's ICU moves under it.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER } from '../test/harness.mjs';

const DRY = process.argv.includes('--dry');
const FILE = 'data/countries.json';
const data = JSON.parse(readFileSync(FILE, 'utf8'));

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end('<!doctype html>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// One launch per DISTINCT locale, not per country: several countries share a tag and the
// answer depends on the tag alone.
const locales = [...new Set(Object.values(data).map((d) => d.loc))].sort();
console.log(`${Object.keys(data).length} countries, ${locales.length} distinct locales\n`);

// [FIX the-browser-refusing-was-recorded-as-an-answer] The first run wrote `mt-MT -> ru`
// and `is-IS -> ru`: this Chromium ships no Maltese or Icelandic UI, so `--lang` does not
// take and the browser stays on the HOST's locale. Recording that would have made a Maltese
// profile announce a Russian Intl locale — a refusal read as a measurement, and one that
// would have been invisible on a machine whose own locale is English.
//
// The host's answer is taken first, and any locale whose result collapses onto it while
// asking for a different language is reported UNAVAILABLE and left unwritten. The runtime
// then keeps its own fallback, which is honest: "not measurable here" is not "Russian".
const hostDir = mkdtempSync(join(tmpdir(), 'afp-locgen-host-'));
const hostCtx = await chromium.launchPersistentContext(hostDir, { ...BROWSER, headless: true, args: [] });
let HOST_INTL = null;
try {
  const hp = await hostCtx.newPage();
  await hp.goto(BASE, { waitUntil: 'load' });
  HOST_INTL = await hp.evaluate(() => new Intl.DateTimeFormat().resolvedOptions().locale);
} finally {
  await hostCtx.close();
  try { rmSync(hostDir, { recursive: true, force: true }); } catch { /* windows */ }
}
console.log(`this machine's own Intl default: ${HOST_INTL}`);
console.log('');

const measured = {};
let i = 0;
for (const loc of locales) {
  i++;
  const dir = mkdtempSync(join(tmpdir(), 'afp-locgen-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: true, args: [`--lang=${loc}`, `--accept-lang=${loc}`]
  });
  try {
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'load' });
    const r = await p.evaluate(() => {
      const out = {};
      try { out.intl = new Intl.DateTimeFormat().resolvedOptions().locale; } catch (e) { out.intl = null; }
      try { out.nf = new Intl.NumberFormat().resolvedOptions().locale; } catch (e) { out.nf = null; }
      try { out.navLang = navigator.language; } catch (e) { out.navLang = null; }
      return out;
    });
    // A result equal to the host's, for a different language, is the browser declining to
    // switch — not this locale's default.
    r.unavailable = (r.intl === HOST_INTL) &&
      (String(loc).split('-')[0] !== String(HOST_INTL).split('-')[0]);
    measured[loc] = r;
    const agree = r.intl === r.nf ? '' : '   <-- DateTimeFormat and NumberFormat DISAGREE';
    const flag = r.unavailable ? '   <-- UNAVAILABLE, the browser stayed on the host locale' : '';
    console.log(`  ${String(i).padStart(2)}/${locales.length}  ${loc.padEnd(8)} -> ${String(r.intl).padEnd(8)}` +
      `  navigator.language ${r.navLang}${agree}${flag}`);
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
  }
}
server.close();

// The two constructors have to agree: they read the same default, and a build where they do
// not is a browser nobody has, which is exactly what this file exists to stop us claiming.
const split = locales.filter((l) => measured[l].intl !== measured[l].nf);
if (split.length) {
  console.error(`\n${split.length} locale(s) where DateTimeFormat and NumberFormat disagree — not writing.`);
  process.exit(1);
}
const failed = locales.filter((l) => !measured[l].intl);
if (failed.length) {
  console.error(`\n${failed.length} locale(s) produced no answer: ${failed.join(', ')} — not writing.`);
  process.exit(1);
}

const unavailable = locales.filter((l) => measured[l].unavailable);
if (unavailable.length) {
  console.log('');
  console.log(`${unavailable.length} locale(s) this browser cannot switch to — left unwritten,`);
  console.log(`so the runtime keeps its own fallback: ${unavailable.join(', ')}`);
}

let changed = 0, same = 0, skipped = 0;
for (const cc of Object.keys(data)) {
  const m = measured[data[cc].loc];
  if (m.unavailable) { delete data[cc].intlLocale; skipped++; continue; }
  if (data[cc].intlLocale === m.intl) { same++; continue; }
  data[cc].intlLocale = m.intl;
  changed++;
}
// Only rows that were actually MEASURED count as differing: a row left unwritten has no
// intlLocale at all, and listing it here as "differs" is how the first run made two
// refusals look like findings.
const differsFromLoc = Object.keys(data).filter(
  (cc) => data[cc].intlLocale && data[cc].intlLocale !== data[cc].loc);
console.log('');
console.log(`${changed} row(s) updated, ${same} already correct, ${skipped} left to the runtime fallback`);
console.log(`${differsFromLoc.length} of ${Object.keys(data).length} countries have an Intl default that is NOT the locale tag:`);
console.log(`   ${differsFromLoc.map((cc) => `${cc} ${data[cc].loc}->${data[cc].intlLocale}`).join('   ')}`);

if (DRY) {
  console.log('\n--dry: nothing written');
} else {
  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`\nwrote ${FILE} — now run: node tools/gen-tables.mjs`);
}
