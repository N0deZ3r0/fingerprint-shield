// WHAT DOES A BROWSER REPORT AS ITS DEFAULT Intl LOCALE, GIVEN A UI LANGUAGE?
//
//   node tools/probe-defaultlocale.mjs
//
// `Intl.DateTimeFormat().resolvedOptions().locale` — no argument, so the DEFAULT locale — is
// not the same string as `navigator.language`. Measured on this host: navigator.language
// ru-RU, Intl default ru. Measured claiming Estonian: navigator.language et-EE, Intl default
// et. The extension answers the profile's tag verbatim in both places, so it reports et-EE
// where a real Estonian browser reports et — a value no browser produces.
//
// The obvious guess is `new Intl.Locale(tag).minimize()`, which turns ru-RU into ru and et-EE
// into et. It is a guess, and en-US is where it would break: minimize() gives `en`, while a
// US browser is expected to say `en-US`. So this asks the browser instead of asking me, one
// launch per tag, and prints minimize() beside the answer so the rule is either confirmed or
// refuted in one table rather than assumed.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER } from '../test/harness.mjs';

const TAGS = ['et-EE', 'en-US', 'ru-RU', 'de-DE', 'en-GB', 'pt-BR', 'fr-FR', 'zh-CN', 'nb-NO', 'es-MX'];

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end('<!doctype html>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

async function ask(tag) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-dl-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: true, args: [`--lang=${tag}`, `--accept-lang=${tag}`]
  });
  try {
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'load' });
    return await p.evaluate((t) => {
      const out = { navLang: navigator.language, langs: (navigator.languages || []).join(',') };
      try { out.dtf = new Intl.DateTimeFormat().resolvedOptions().locale; } catch (e) { out.dtf = 'THREW'; }
      try { out.nf = new Intl.NumberFormat().resolvedOptions().locale; } catch (e) { out.nf = 'THREW'; }
      try { out.min = new Intl.Locale(t).minimize().toString(); } catch (e) { out.min = 'THREW'; }
      try { out.max = new Intl.Locale(t).maximize().toString(); } catch (e) { out.max = 'THREW'; }
      return out;
    }, tag);
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
  }
}

console.log('tag       navigator.language   Intl default   NumberFormat   minimize()   agrees?');
let agree = 0, disagree = 0;
for (const tag of TAGS) {
  const r = await ask(tag);
  const ok = r.dtf === r.min;
  if (ok) agree++; else disagree++;
  console.log(`${tag.padEnd(9)} ${String(r.navLang).padEnd(20)} ${String(r.dtf).padEnd(14)}` +
    ` ${String(r.nf).padEnd(14)} ${String(r.min).padEnd(12)} ${ok ? 'yes' : 'NO'}`);
}
server.close();
console.log(`\nminimize() predicts the default locale: ${agree} of ${agree + disagree}`);
console.log(disagree === 0
  ? 'rule holds on every tag asked — safe to derive rather than store.'
  : 'rule does NOT hold — the value has to be measured per locale and stored, not derived.');
