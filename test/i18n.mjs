/**
 * THE EXTENSION SPEAKS TWO LANGUAGES — and both of them have to actually reach the screen.
 *
 *   node test/i18n.mjs [--headed]
 *
 * Chrome substitutes __MSG_key__ in the MANIFEST and in CSS and NOWHERE ELSE, so an
 * extension page gets nothing for free: i18n.js reads the catalogue and fills the markup at
 * DOMContentLoaded. Two things can go wrong and neither is visible from a code read.
 *
 *   THE CATALOGUE DISAGREES WITH ITSELF — a key in one language and not the other, or the
 *   same key taking a different number of substitutions. Chrome answers '' for a missing
 *   key, and writing '' into a control BLANKS it. That is the failure mode this project
 *   keeps finding in its own instruments, so both the fallback and this suite exist.
 *
 *   THE PAGE NEVER GETS FILLED — the loader does not run, or runs after the paint. Nothing
 *   throws; the UI simply stays in the other language, which looks like a translation that
 *   was never written rather than like a bug.
 *
 * So the popup is opened TWICE in two browsers, one launched with --lang=en-US and one with
 * --lang=ru, and the same elements are read in both. The assertion is that they DIFFER and
 * that each matches its own catalogue — "it rendered something" would pass on a build that
 * ignores the locale completely.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, bootSettled } from './harness.mjs';

// [FIX the-suite-read-a-state-it-did-not-control] The popup's per-site line says one thing
// with a site under it and another with no http tab, and this file used to read whichever it
// happened to get. On this machine both browsers got "no active tab" and it passed; on the CI
// runner one got a site and the other did not, and the suite reported the two LANGUAGES
// disagreeing when what disagreed was the two STATES. A site is opened first now, in both,
// so the line is the same state in each and the only variable left is the language.
const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    .end('<!doctype html><title>site</title>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

const cat = (lang) => JSON.parse(readFileSync(join(root, '_locales', lang, 'messages.json'), 'utf8'));
const en = cat('en'), ru = cat('ru');

// ── 1) the catalogues agree with each other ──────────────────────────────────
console.log('== 1) the two catalogues');
const ek = Object.keys(en), rk = Object.keys(ru);
console.log(`   ${ek.length} keys in en, ${rk.length} in ru`);
ok(ek.length === rk.length, `both catalogues carry the same number of keys (${ek.length} vs ${rk.length})`);
const onlyEn = ek.filter((k) => !rk.includes(k));
const onlyRu = rk.filter((k) => !ek.includes(k));
ok(onlyEn.length === 0, `no key exists only in en (${onlyEn.join(', ') || 'none'})`);
ok(onlyRu.length === 0, `no key exists only in ru (${onlyRu.join(', ') || 'none'})`);
// A key whose two messages take different substitutions drops a value in one language.
const arity = (s) => [...new Set(s.match(/\$[1-9]/g) || [])].sort().join('');
const mism = ek.filter((k) => rk.includes(k) && arity(en[k].message) !== arity(ru[k].message));
ok(mism.length === 0, `every key takes the same substitutions in both (${mism.join(', ') || 'none'})`);
// An empty message is worse than a missing one: it renders as a blank control.
const empty = ek.filter((k) => !en[k].message.trim()).concat(rk.filter((k) => !ru[k].message.trim()));
ok(empty.length === 0, `no message is empty (${empty.join(', ') || 'none'})`);

// ── 2) every key the UI asks for exists ──────────────────────────────────────
console.log('\n== 2) the keys the interface actually asks for');
// Three surfaces, and the two stylesheets — a CSS file is the one place Chrome does the
// substitution itself, so `content: "__MSG_whoCopied__"` is a real reference to a key.
const PAGES = ['popup.html', 'popup.js', 'options.html', 'options.js',
  'whoami.html', 'whoami.js', 'options.css', 'whoami.css', 'manifest.json'];
const used = new Set();
for (const f of PAGES) {
  const src = readFileSync(join(root, f), 'utf8');
  for (const m of src.matchAll(/data-i18n(?:-[a-z-]+)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bT\('([A-Za-z0-9_]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(m[1]);
  // plural() builds its key as a prefix plus a CLDR category; the four are named here so a
  // catalogue entry for a category nobody selects still counts as used.
  for (const m of src.matchAll(/plural\([^,]+, '([A-Za-z0-9_]+)'/g)) {
    for (const cat of ['one', 'few', 'many', 'other']) used.add(m[1] + '_' + cat);
  }
}
const unknown = [...used].filter((k) => !ek.includes(k));
console.log(`   ${used.size} keys referenced by ${PAGES.length} files`);
ok(used.size >= 100, `the UI really is routed through the catalogue (${used.size} keys)`);
ok(unknown.length === 0, `every key it asks for is in the catalogue (${unknown.join(', ') || 'none'})`);
// The other direction: a key nobody asks for is dead weight that still has to be translated.
const orphans = ek.filter((k) => !used.has(k));
ok(orphans.length === 0, `no key in the catalogue is unused (${orphans.join(', ') || 'none'})`);

// ── 3) and the browser renders each language ─────────────────────────────────
async function popupText(lang) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-i18n-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: !headed,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, `--lang=${lang}`]
  });
  // The loader reports a key it could not find rather than blanking the element. Section 2
  // proves the same thing by reading the sources, but only for the references its regexes
  // recognise — this is the page saying it, on every one of the three documents.
  const warns = [];
  ctx.on('page', (pg) => pg.on('console', (m) => {
    if (m.text().includes('[AFP i18n]')) warns.push(m.text());
  }));
  try {
    const sw = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
      await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    await bootSettled(ctx);
    const id = new URL(sw.url()).host;
    // The site has to be the ACTIVE tab when the popup loads, which is the state a user is
    // in — and the state the per-site line below is read in. Same dance as popupfit.mjs:
    // open the popup, front the site, reload.
    const site = await ctx.newPage();
    await site.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load' });
    await site.bringToFront();
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => {
      const el = document.getElementById('applyBtn');
      const site = document.getElementById('siteHost');
      // Wait for the VALUE, not the clock: the per-site line is filled asynchronously, and
      // reading it early is reading the markup's fallback rather than what popup.js decided.
      return !!(el && el.textContent.trim() && site && site.textContent.trim() &&
        document.getElementById('siteCard') && !document.getElementById('siteCard').hidden);
    }, null, { timeout: 15000 });
    // `return p.evaluate(…)` would hand the promise back and let the finally below close the
    // browser out from under it — await here, inside the try.
    const got = await p.evaluate(() => ({
      apply: document.getElementById('applyBtn').textContent.trim(),
      settings: document.getElementById('optionsLink').textContent.trim(),
      hero: document.getElementById('heroTitle').textContent.trim(),
      sub: document.getElementById('heroSub').textContent.trim(),
      site: document.getElementById('siteHost').textContent.trim(),
      uiLang: chrome.i18n.getUILanguage()
    }));

    // The options page in the same browser: a second document, a second copy of the loader,
    // and the one place a message carries markup (<code>defaults.js</code>) that textContent
    // alone would have deleted.
    const o = await ctx.newPage();
    await o.goto(`chrome-extension://${id}/options.html`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 800));
    got.opt = await o.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('h1').textContent.trim(),
      save: document.getElementById('saveBtn').textContent.trim(),
      resetTitle: document.getElementById('resetBtn').getAttribute('title'),
      hintText: document.getElementById('resetHint').textContent.trim(),
      hintCode: (document.querySelector('#resetHint code') || {}).textContent || '',
      // The feature grid is built by options.js from FEAT_META, so this is the JS path on
      // this page — and it is built before any of the rows are painted.
      canvasDesc: (() => {
        const c = [...document.querySelectorAll('#featGrid')][0];
        return c ? c.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
      })(),
      lang: document.documentElement.getAttribute('lang'),
      // Chrome substitutes __MSG_ in a stylesheet itself. This is the ::after on a risky
      // feature row, and the only way to see it is through getComputedStyle.
      riskyCss: (() => {
        const el = document.querySelector('.feat.risky .feat-name');
        return el ? (getComputedStyle(el, '::after').content || '') : '(no risky row)';
      })()
    }));

    const w = await ctx.newPage();
    await w.goto(`chrome-extension://${id}/whoami.html`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1200));
    got.who = await w.evaluate(() => ({
      tagline: document.querySelector('.brand i').textContent.trim(),
      refresh: document.getElementById('refreshBtn').textContent.trim(),
      hardware: document.querySelectorAll('.card h2')[0].textContent.trim(),
      parity: document.getElementById('parityBtn').textContent.trim(),
      tabAria: document.getElementById('parityTab').getAttribute('aria-label'),
      // The stylesheet's own message — Chrome replaces __MSG_whoCopied__ before the sheet is
      // parsed, so a wrong key shows up here as the literal token or as none.
      copiedCss: (() => {
        const el = document.getElementById('userAgent');
        el.classList.add('copied');
        const c = getComputedStyle(el, '::after').content || '';
        el.classList.remove('copied');
        return c;
      })()
    }));
    got.warns = warns.slice();
    return got;
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
  }
}

console.log('\n== 3) the popup, rendered in both languages');
const gotEn = await popupText('en-US');
const gotRu = await popupText('ru');
console.log(`   en (${gotEn.uiLang})  apply="${gotEn.apply}"  settings="${gotEn.settings}"  hero="${gotEn.hero}"`);
console.log(`   ru (${gotRu.uiLang})  apply="${gotRu.apply}"  settings="${gotRu.settings}"  hero="${gotRu.hero}"`);

ok(gotEn.apply === en.popupApply.message,
  `the English popup says "${en.popupApply.message}" on Apply (${gotEn.apply})`);
ok(gotRu.apply === ru.popupApply.message,
  `the Russian one says "${ru.popupApply.message}" (${gotRu.apply})`);
ok(gotEn.settings === en.popupSettings.message && gotRu.settings === ru.popupSettings.message,
  `and the footer link follows too (${gotEn.settings} / ${gotRu.settings})`);
// The per-site line is written by popup.js, not by the markup — so this is the JS path, read
// with a site as the active tab so both browsers are in the same state (see the note at the
// top: they were not, and the suite blamed the languages for it).
ok(gotEn.site === en.popupSiteScope.message && gotRu.site === ru.popupSiteScope.message,
  `so does the per-site line, which popup.js writes (${gotEn.site} / ${gotRu.site})`);
// And the substituted one: "$1 of $2 modules active" goes through afpMsg with arguments, a
// path that silently yields '' if the two catalogues disagree about $1/$2.
const subShape = (m, n) => new RegExp('^' + m.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  .replace(/\\\$1/, '\\d+').replace(/\\\$2/, '\\d+') + '$').test(n);
ok(/\d/.test(gotEn.sub) ? subShape(en.popupSubActive, gotEn.sub) : true,
  `the substituted subtitle keeps its numbers in English ("${gotEn.sub}")`);
ok(/\d/.test(gotRu.sub) ? subShape(ru.popupSubActive, gotRu.sub) : true,
  `and in Russian ("${gotRu.sub}")`);
// The control: without this, a build that ignores the locale entirely passes everything
// above by rendering one language twice.
ok(gotEn.apply !== gotRu.apply && gotEn.settings !== gotRu.settings,
  'the two languages actually differ — otherwise the locale is being ignored and every ' +
  'assertion above is about one language rendered twice');
// No Cyrillic may survive in the English rendering.
ok(!/[А-Яа-яЁё]/.test(gotEn.apply + gotEn.settings + gotEn.hero + gotEn.sub + gotEn.site),
  `nothing Russian is left in the English popup (${JSON.stringify(gotEn)})`);

// ── 4) and the options page, the second document ─────────────────────────────
console.log('\n== 4) the options page');
console.log(`   en  title="${gotEn.opt.title}"  h1="${gotEn.opt.h1}"  save="${gotEn.opt.save}"  lang=${gotEn.opt.lang}`);
console.log(`   ru  title="${gotRu.opt.title}"  h1="${gotRu.opt.h1}"  save="${gotRu.opt.save}"  lang=${gotRu.opt.lang}`);

ok(gotEn.opt.title === en.optTitle.message && gotRu.opt.title === ru.optTitle.message,
  `the tab title follows the locale (${gotEn.opt.title} / ${gotRu.opt.title})`);
ok(gotEn.opt.h1 === en.optH1.message && gotRu.opt.h1 === ru.optH1.message,
  `so does the heading (${gotEn.opt.h1} / ${gotRu.opt.h1})`);
ok(gotEn.opt.save === en.optSave.message && gotRu.opt.save === ru.optSave.message,
  `and the save button (${gotEn.opt.save} / ${gotRu.opt.save})`);
ok(gotEn.opt.resetTitle === en.optResetBtnTitle.message && gotRu.opt.resetTitle === ru.optResetBtnTitle.message,
  `a title= attribute is filled too, not only text (${gotEn.opt.resetTitle} / ${gotRu.opt.resetTitle})`);
// The <code> inside a translated sentence: textContent alone would have deleted the element,
// so assert the element still exists AND still says what it names.
ok(gotEn.opt.hintCode === 'defaults.js' && gotRu.opt.hintCode === 'defaults.js',
  `<code>defaults.js</code> survives translation (en "${gotEn.opt.hintCode}", ru "${gotRu.opt.hintCode}")`);
ok(gotEn.opt.hintText === en.optResetHint.message.replace(/<\/?code>/g, ''),
  `and the sentence around it is the English one ("${gotEn.opt.hintText}")`);
// The lang attribute is not decoration: it picks hyphenation and the screen-reader voice.
ok(gotEn.opt.lang === 'en-US' && gotRu.opt.lang === 'ru',
  `<html lang> follows the UI language (${gotEn.opt.lang} / ${gotRu.opt.lang})`);
// The grid is built by options.js, so this is the JS path on a page whose script runs after
// the loader — a miss here means afpMsg was not there yet when the rows were made.
ok(gotEn.opt.canvasDesc.includes(en.optFeatCanvas.message),
  `the feature rows options.js builds are English too ("${gotEn.opt.canvasDesc}")`);
ok(gotRu.opt.canvasDesc.includes(ru.optFeatCanvas.message),
  `and Russian in the Russian browser ("${gotRu.opt.canvasDesc}")`);
ok(!/[А-Яа-яЁё]/.test(Object.values(gotEn.opt).join(' ')),
  `nothing Russian is left on the English options page (${JSON.stringify(gotEn.opt)})`);

// ── 5) Who Am I, and the two stylesheet messages ─────────────────────────────
console.log('\n== 5) the Who Am I page');
console.log(`   en  tagline="${gotEn.who.tagline}"  refresh="${gotEn.who.refresh}"  check="${gotEn.who.parity}"`);
console.log(`   ru  tagline="${gotRu.who.tagline}"  refresh="${gotRu.who.refresh}"  check="${gotRu.who.parity}"`);
console.log(`   css  risky ${gotEn.opt.riskyCss} / ${gotRu.opt.riskyCss}   copied ${gotEn.who.copiedCss} / ${gotRu.who.copiedCss}`);

ok(gotEn.who.tagline === en.whoTagline.message && gotRu.who.tagline === ru.whoTagline.message,
  `the tagline follows the locale (${gotEn.who.tagline} / ${gotRu.who.tagline})`);
ok(gotEn.who.refresh === en.whoRefresh.message && gotRu.who.refresh === ru.whoRefresh.message,
  `so does Refresh (${gotEn.who.refresh} / ${gotRu.who.refresh})`);
ok(gotEn.who.hardware === en.whoHardware.message && gotRu.who.hardware === ru.whoHardware.message,
  `and a card heading (${gotEn.who.hardware} / ${gotRu.who.hardware})`);
ok(gotEn.who.tabAria === en.whoParityTabAria.message && gotRu.who.tabAria === ru.whoParityTabAria.message,
  `an aria-label is filled, so a screen reader gets the same language (${gotEn.who.tabAria} / ${gotRu.who.tabAria})`);
ok(!/[А-Яа-яЁё]/.test(Object.values(gotEn.who).join(' ')),
  `nothing Russian is left on the English Who Am I page (${JSON.stringify(gotEn.who)})`);

// Chrome's own substitution, in a stylesheet. A wrong key leaves the literal __MSG_…__ in
// place, which is why this asserts on the text rather than merely on it being non-empty.
ok(gotEn.who.copiedCss.includes(en.whoCopied.message) && gotRu.who.copiedCss.includes(ru.whoCopied.message),
  `whoami.css's ::after is translated by Chrome itself (${gotEn.who.copiedCss} / ${gotRu.who.copiedCss})`);
// Exact, not `includes`: the stylesheet owns the " · " separator and the message is the word
// alone. Putting the separator in both rendered " ·  · careful", which `includes` accepted.
ok(gotEn.opt.riskyCss === `" · ${en.optRisky.message}"` && gotRu.opt.riskyCss === `" · ${ru.optRisky.message}"`,
  `options.css's risky-row marker is exactly one separator plus the word ` +
  `(${gotEn.opt.riskyCss} / ${gotRu.opt.riskyCss})`);
ok(!/__MSG_/.test(gotEn.who.copiedCss + gotEn.opt.riskyCss + gotRu.who.copiedCss + gotRu.opt.riskyCss),
  'no __MSG_ token survives into the rendered CSS');

// ── 6) and none of the three pages reported a missing key ────────────────────
console.log('\n== 6) what the pages themselves said');
console.log(`   en ${gotEn.warns.length} warning(s), ru ${gotRu.warns.length}`);
ok(gotEn.warns.length === 0, `no key was missing on any English page (${gotEn.warns.join(' | ') || 'none'})`);
ok(gotRu.warns.length === 0, `nor on any Russian page (${gotRu.warns.join(' | ') || 'none'})`);

// ── 7) the override: a language the browser is NOT in ────────────────────────
// The point of the switch is the case chrome.i18n cannot serve — getMessage answers in the
// browser's language and there is no API to ask it for another. So this runs an English
// browser and asks for Russian, which is the only arrangement that can tell a working
// override from a page that was going to render Russian anyway.
console.log('\n== 7) choosing a language the browser is not in');
{
  const dir = mkdtempSync(join(tmpdir(), 'afp-i18n-sw-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: !headed,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--lang=en-US']
  });
  try {
    const sw = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
      await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    await bootSettled(ctx);
    const id = new URL(sw.url()).host;
    const o = await ctx.newPage();
    await o.goto(`chrome-extension://${id}/options.html`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 600));

    const before = await o.evaluate(() => ({
      ui: chrome.i18n.getUILanguage(),
      h1: document.querySelector('h1').textContent.trim(),
      picker: !!document.getElementById('langSelect')
    }));
    console.log(`   browser ${before.ui}, page says "${before.h1}", picker ${before.picker}`);
    ok(before.picker, 'the options page has a language picker');
    ok(before.h1 === en.optH1.message, `and renders English to start with (${before.h1})`);

    // Through the page's own control, not by writing storage behind its back: the handler
    // is what a user touches and is the thing that has to work.
    await o.selectOption('#langSelect', 'ru');
    await o.waitForFunction(() => document.querySelector('h1').textContent.trim() ===
      'Расширенные настройки', null, { timeout: 15000 }).catch(() => {});
    const after = await o.evaluate(() => ({
      ui: chrome.i18n.getUILanguage(),
      h1: document.querySelector('h1').textContent.trim(),
      lang: document.documentElement.getAttribute('lang'),
      state: (document.getElementById('langState') || {}).textContent || ''
    }));
    console.log(`   after choosing ru: "${after.h1}" (browser still ${after.ui}, lang=${after.lang})`);
    ok(after.h1 === ru.optH1.message,
      `the page is Russian on an English browser (${after.h1})`);
    ok(after.ui === 'en-US',
      `and the browser itself did not change (${after.ui}) — this is the override, not the locale`);
    ok(after.lang === 'ru', `<html lang> follows the choice (${after.lang})`);
    ok(after.state.includes('ru') && after.state.includes('en-US'),
      `the page says which is chosen and what the browser is (${after.state})`);

    // The popup is a different document and must honour the same choice: the override is
    // per-extension, not per-page.
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load' });
    await p.waitForFunction(() => {
      const el = document.getElementById('applyBtn');
      return !!(el && el.textContent.trim());
    }, null, { timeout: 15000 });
    const popupApply = await p.evaluate(() => document.getElementById('applyBtn').textContent.trim());
    console.log(`   popup Apply button: "${popupApply}"`);
    ok(popupApply === ru.popupApply.message,
      `the popup follows the same choice (${popupApply})`);

    // And back: an empty choice means the browser again, which is what makes this a
    // preference rather than a one-way door.
    await o.bringToFront();
    await o.selectOption('#langSelect', '');
    await o.waitForFunction(() => document.querySelector('h1').textContent.trim() ===
      'Advanced settings', null, { timeout: 15000 }).catch(() => {});
    const back = await o.evaluate(() => document.querySelector('h1').textContent.trim());
    ok(back === en.optH1.message, `clearing the choice follows the browser again (${back})`);
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
  }
}

server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
