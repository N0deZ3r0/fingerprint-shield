// EVERY DOOR FED BY THE ICU DEFAULT LOCALE — ENUMERATED, NOT LISTED.
//
//   node tools/probe-icudoors.mjs
//
// The patched-Chromium project moves ONE thing: the renderer's ICU default locale, set in
// RendererMain before V8 caches it. Everything that reads it follows at once. An extension
// cannot do that — it wraps doors BY NAME, and the list is open-ended, so every Intl API
// Chrome ships next is a door standing open until somebody notices.
//
// Which is why this does not carry a hand-written list. It walks
// `Object.getOwnPropertyNames(Intl)` and the prototypes of String/Number/Date/Array/BigInt/
// Object, finds every constructor and every `toLocale*` method THE BROWSER ACTUALLY HAS, and
// calls each with no locale argument. A door added by a future Chrome is picked up without
// anyone editing this file — which is the whole point of the difference being structural.
//
// Three readings decide each door:
//
//   host    a clean browser on this machine's own locale
//   claim   a clean browser forced to the claimed locale (--lang)
//   ours    the extension, claiming that locale
//
// closed      ours === claim          the door follows the claim
// OPEN        ours === host           the door still speaks for the machine
// THIRD       ours is neither         worse than open: a value no browser produces
// unprovable  host === claim          the two locales format this identically here
//
// The unprovable column is not padding. et-EE and ru-RU agree on a lot (both write
// "1 234,5"), and counting those as passes would be the same mistake as a suite that cannot
// fail.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, loadBackground, loadPopup, bootSettled } from '../test/harness.mjs';

const { COUNTRY_DATA } = loadBackground(['COUNTRY_DATA']);
const { PROFILES } = loadPopup(['PROFILES']);
const SEL = { id: 'laptop_mid', cc: 'EE' };

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end('<!doctype html>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const READ = `(function () {
  var out = {};
  var D = new Date(Date.UTC(2026, 0, 7, 15, 4, 5));
  function put(k, fn) {
    try {
      var v = fn();
      out[k] = (v === undefined) ? 'undefined' : String(v);
    } catch (e) { out[k] = 'THREW:' + (e && e.name); }
  }

  // ---- every Intl constructor this browser ships, found by asking it ----------------
  // Options only where the constructor REQUIRES them (DisplayNames throws without a type);
  // everything else is called bare, which is the case that reads the default locale.
  var needs = { DisplayNames: { type: 'region' } };
  var firstArg = { Locale: 'en-US' };
  Object.getOwnPropertyNames(Intl).forEach(function (name) {
    var C;
    try { C = Intl[name]; } catch (e) { return; }
    if (typeof C !== 'function') return;
    put('Intl.' + name + ' resolvedOptions.locale', function () {
      var inst = new C(firstArg[name], needs[name]);
      if (!inst || typeof inst.resolvedOptions !== 'function') {
        // Intl.Locale has no resolvedOptions; its own toString is the answer.
        return (inst && typeof inst.toString === 'function') ? inst.toString() : 'no-resolvedOptions';
      }
      return inst.resolvedOptions().locale;
    });
    // And what it actually PRODUCES, which is the half a page can read without asking the
    // API what locale it thinks it is using.
    put('Intl.' + name + ' output', function () {
      var inst = new C(firstArg[name], needs[name]);
      if (!inst) return 'no-instance';
      if (typeof inst.format === 'function') {
        // The one argument each formatter accepts differs; try the plausible ones in turn.
        var tries = [D, 1234567.891, ['a', 'b', 'c'], 'a\\u00F1b'];
        for (var i = 0; i < tries.length; i++) {
          try { return inst.format(tries[i]); } catch (e) {}
        }
        try { return inst.format(-3, 'day'); } catch (e) {}
        return 'format-refused-every-argument';
      }
      if (typeof inst.of === 'function') { try { return inst.of('EE'); } catch (e) { return inst.of('ru'); } }
      if (typeof inst.select === 'function') return inst.select(2);
      if (typeof inst.compare === 'function') return String(inst.compare('\\u00F5', 'z'));
      if (typeof inst.segment === 'function') {
        return Array.from(inst.segment('a\\u00F1b'), function (s) { return s.segment; }).join('|');
      }
      return 'no-output-method';
    });
  });

  // ---- every toLocale* method on the built-in prototypes, likewise found ------------
  var hosts = [
    ['String', String.prototype, 'i\\u00F5'],
    ['Number', Number.prototype, 1234567.891],
    ['Date', Date.prototype, D],
    ['Array', Array.prototype, [1234.5, D]],
    ['Object', Object.prototype, {}]
  ];
  try { hosts.push(['BigInt', BigInt.prototype, BigInt('12345678901234567890')]); } catch (e) {}
  hosts.forEach(function (row) {
    var label = row[0], proto = row[1], subject = row[2];
    var names;
    try { names = Object.getOwnPropertyNames(proto); } catch (e) { return; }
    names.forEach(function (m) {
      if (!/^toLocale/.test(m) && m !== 'localeCompare') return;
      var fn;
      try { fn = proto[m]; } catch (e) { return; }
      if (typeof fn !== 'function') return;
      put(label + '.' + m, function () {
        return (m === 'localeCompare') ? String(fn.call(subject, 'z')) : String(fn.call(subject));
      });
    });
  });

  // ---- one behavioural door that no name would reveal --------------------------------
  put('sort via localeCompare', function () {
    return ['z', '\\u00F5', '\\u00E4', 'a'].sort(function (a, b) { return a.localeCompare(b); }).join('');
  });
  return out;
})()`;

// [FIX the-reference-browser-was-in-another-timezone] The claim reading used to run in the
// host's zone while ours ran in the claimed one, so `Date.toLocaleString` came back an hour
// apart and the instrument reported two doors "still answering for the machine" — with the
// DATE FORMAT already matching the claim exactly, which is the half that was actually being
// asked about. Two permanent false rows is how an instrument gets ignored, so the reference
// is put in the claimed zone instead of the report being explained away.
async function launch(args, withExt, tz) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-icu-'));
  const opts = { ...BROWSER, headless: true, args };
  if (tz) opts.timezoneId = tz;
  const ctx = await chromium.launchPersistentContext(dir, opts);
  try {
    if (withExt) {
      const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await bootSettled(sw);
      const p = PROFILES.find((x) => x.id === SEL.id);
      const c = COUNTRY_DATA[SEL.cc];
      await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
        afp_profile_id: p.id,
        afp_profile_data: { screenW: p.screenW, screenH: p.screenH, cores: p.cores,
          memory: p.memory, gpu: p.gpuKey, platform: p.platform },
        afp_country_code: SEL.cc, afp_resolved_timezone: c.tz,
        afp_resolved_locale: c.loc, afp_mode: 'normal'
      });
      await new Promise((r) => setTimeout(r, 1500));
    }
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    if (withExt) await page.reload({ waitUntil: 'load' });
    return await page.evaluate(READ);
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
  }
}

const CLAIM = COUNTRY_DATA[SEL.cc].loc;
const CLAIM_TZ = COUNTRY_DATA[SEL.cc].tz;
const HOST = await launch([], false);
const WANT = await launch([`--lang=${CLAIM}`, `--accept-lang=${CLAIM}`], false, CLAIM_TZ);
const OURS = await launch([`--disable-extensions-except=${root}`, `--load-extension=${root}`], true);
server.close();

const keys = Object.keys(HOST);
console.log(`claim ${CLAIM}   doors found by enumeration: ${keys.length}\n`);
let open = 0, closed = 0, third = 0, unprovable = 0;
const cut = (v) => String(v).replace(/\s+/g, ' ').slice(0, 24);
for (const k of keys) {
  const host = HOST[k], want = WANT[k], ours = OURS[k];
  let v;
  if (host === want) { v = 'unprovable'; unprovable++; }
  else if (ours === want) { v = 'closed'; closed++; }
  else if (ours === host) { v = 'OPEN'; open++; }
  else { v = 'THIRD'; third++; }
  if (v === 'closed' || v === 'unprovable') continue;
  console.log(`  ${v.padEnd(6)} ${k.padEnd(38)} host ${cut(host).padEnd(26)}claim ${cut(want).padEnd(26)}ours ${cut(ours)}`);
}
console.log(`\nclosed ${closed}   OPEN ${open}   THIRD ${third}   unprovable ${unprovable}`);
console.log(open + third === 0
  ? 'every door this browser has follows the claim.'
  : `${open + third} door(s) still answer for the machine.`);
process.exit(open + third ? 1 : 0);
