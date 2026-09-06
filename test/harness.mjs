/**
 * Shared plumbing for the Node-only suites.
 *
 * Two things live here because more than one suite needs them and a second copy
 * would be one more thing to drift:
 *
 *   1. `harness()` — the pass/fail counter every suite in test/ already had inline.
 *      Quiet on success (like test/tz-icu.mjs): a suite with 500 assertions that
 *      prints 500 PASS lines hides the one FAIL in the middle.
 *
 *   2. `loadBackground()` / `loadPopup()` — the real files, executed.
 *
 * On (2): background.js and popup.js are not modules and export nothing, so the
 * other suites reach into them with a regex and `eval` the matched table text.
 * That works for a table but not for a function, and item 2 of the backlog is
 * precisely "these functions have zero coverage". So instead of scraping, the
 * whole file is run as a function body with its host globals passed in as
 * parameters, and the identifiers the caller asks for are returned. Everything
 * the file touches at load time is either stubbed here or genuinely inert:
 *
 *   background.js  — top level is `const`/`function` plus chrome.*.addListener
 *   popup.js       — top level is `const`/`function` plus document.getElementById
 *
 * Running the file in one realm (rather than `vm`) keeps the values ordinary:
 * `instanceof`, `Array.isArray` and object identity all behave, which matters
 * because these suites compare tables across files.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/**
 * What the UI says, in the language the browser under test is actually in.
 *
 * The suites used to compare against Russian string literals, which passed only because the
 * machine they were written on is Russian. The CI runner is not: on it the popup renders from
 * _locales/en and every one of those comparisons would have failed — a suite that is green
 * for a property of the developer's laptop rather than of the code.
 *
 * Pass the value the page itself reports (`chrome.i18n.getUILanguage()`), so the expectation
 * comes from the same catalogue the browser just used.
 *
 *     const M = uiMessages(await page.evaluate(() => chrome.i18n.getUILanguage()));
 *     ok(row.chip === M('popupTagHost'), …);
 */
/**
 * WAIT FOR THE BACKGROUND TO STOP WRITING, not for a number of milliseconds.
 *
 * A suite that plants a fixture — a profile, a country, a mode — has to plant it AFTER
 * `initDefaults` has finished, or the background's own write lands on top of it and the
 * suite measures the default while believing it measures its fixture. Ten suites did that
 * with `setTimeout(r, 1500)` right after the service worker appeared; one of them even
 * carried the comment `// onInstalled → initDefaults`, which names exactly the event it was
 * approximating with a clock.
 *
 * [FIX ten-suites-bet-on-a-clock] Measured on this machine: the background's last startup
 * write lands at +174..218ms without the localisation catalogue and +228..267ms with it —
 * Chrome loads _locales before the extension starts. Fifty milliseconds is nothing here and
 * is not nothing on the two-core runner, where those same ten suites went red together on a
 * commit that changed no extension logic at all. A fixture written at a fixed 1500ms was
 * always going to lose that race eventually; it just took a slower start to make it lose.
 *
 * So: poll what the background writes at startup until it has been still for `quiet` ms,
 * and return how long that took, so a suite can print it and a regression here is visible
 * rather than silent.
 */
export async function bootSettled(swOrCtx, { quiet = 400, timeout = 20000 } = {}) {
  // Takes either the worker or the context, because half the call sites never kept a handle
  // — they wrote `ctx.serviceWorkers()[0] || await ctx.waitForEvent(...)` for the side
  // effect and threw the worker away.
  let sw = swOrCtx;
  if (typeof swOrCtx.serviceWorkers === 'function') {
    sw = swOrCtx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
      swOrCtx.serviceWorkers()[0] ||
      await swOrCtx.waitForEvent('serviceworker', { timeout });
  }
  // All three things the background does before it is ready, not just the storage writes:
  // a fixed sleep was covering the content-script registration and the dynamic DNR rules
  // too, and replacing it with a storage-only check would shorten the wait past them.
  const probe = async () => sw.evaluate(async (keys) => {
    const st = await chrome.storage.local.get(keys);
    let scripts = 'n/a', rules = 'n/a';
    try { scripts = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).sort().join(','); }
    catch (e) { /* not granted here */ }
    try { rules = String((await chrome.declarativeNetRequest.getDynamicRules()).length); }
    catch (e) { /* not granted here */ }
    return JSON.stringify(st) + '|' + scripts + '|' + rules;
  }, ['afp_country_code', 'afp_resolved_timezone', 'afp_resolved_locale', 'afp_profile_id',
    'afp_profile_data', 'afp_noise_seed', 'afp_mode', 'afp_features']);

  const t0 = Date.now();
  let last = null, lastChange = Date.now();
  for (;;) {
    let now;
    try { now = await probe(); }
    catch (e) { now = null; }   // the worker was asleep or restarting; ask again
    if (now !== last) { last = now; lastChange = Date.now(); }
    else if (now !== null && Date.now() - lastChange >= quiet) return Date.now() - t0;
    if (Date.now() - t0 > timeout) {
      throw new Error(`the background never went quiet within ${timeout}ms — ` +
        'a fixture planted now would be overwritten and the suite would measure the default');
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * `--lang=…` when FPS_LANG is set, and nothing otherwise.
 *
 * Spread into a launch's args by the suites that read what the UI SAYS. Without it those
 * suites can only ever be run in the language of whatever machine they run on — this
 * project's own machine is Russian and the CI runner is English, so neither one alone
 * proves the other works:
 *
 *     FPS_LANG=en-US node test/popupfit.mjs
 */
export const langArgs = () => (process.env.FPS_LANG ? [`--lang=${process.env.FPS_LANG}`] : []);

export function uiMessages(uiLang) {
  const lang = String(uiLang || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  const cat = JSON.parse(fs.readFileSync(path.join(root, '_locales', lang, 'messages.json'), 'utf8'));
  return (key) => {
    if (!cat[key]) throw new Error(`no message "${key}" in _locales/${lang} — the suite and the catalogue disagree`);
    return cat[key].message;
  };
}

/**
 * Which browser binary the Playwright suites drive. Spread into the launch
 * options: `chromium.launch({ ...BROWSER, headless: !headed })`.
 *
 * Default is `channel: 'chromium'` — what all 39 launch sites hardcoded before
 * this existed, so an unset FPS_CHROME reproduces the old behaviour exactly.
 * Setting FPS_CHROME to an executable path points the whole suite at a custom
 * build, which is how a separately built Chromium gets measured against exactly
 * these suites rather than against a paraphrase of them.
 *
 * Why one export instead of a literal in 39 places: the binaries DISAGREE.
 * Playwright's bundled build and channel:'chromium' already differ on
 * navigator.plugins (0 vs 5), and a patched build is a third answer. A suite
 * that quietly drove the wrong one would print FAILURES: 0 and read as a pass —
 * the same shape of mistake as a skip path. One switch, one place to read it.
 *
 * The banner prints only when FPS_CHROME is set, so default output stays byte
 * for byte what it was and nothing that parses this output has to change.
 */
/**
 * THE RIG WAS MEASURING A BROWSER NOBODY RUNS, and it cost a patch that read as
 * green for a week. Playwright launches with --disable-field-trial-config, which
 * turns off Chromium's canned trial config; a plain launch has it ON. One of the
 * experiments in there is ReduceAcceptLanguage, and while it is on, the
 * Accept-Language header is stamped from the reduce service's own copy of the
 * language list -- past both hooks patch 0017 installed. Under the rig: header
 * follows the claim, 431 passed. Same binary launched plainly: header announces
 * the host's ru-RU. Measured both ways in tools/probe-doors.mjs.
 *
 * So the suite drops that one default argument and keeps every other one. The
 * arguments Playwright passes to make automation stable (no first run, no
 * background networking) do not change what a page can read; the trial config
 * decides which FEATURES exist, and a feature that exists for users has to exist
 * while we measure them.
 */
const NO_FIELD_TRIAL_SUPPRESSION = { ignoreDefaultArgs: ['--disable-field-trial-config'] };

export const BROWSER = process.env.FPS_CHROME
  ? { executablePath: process.env.FPS_CHROME, ...NO_FIELD_TRIAL_SUPPRESSION }
  : { channel: 'chromium', ...NO_FIELD_TRIAL_SUPPRESSION };

if (BROWSER.executablePath) {
  if (!fs.existsSync(BROWSER.executablePath)) {
    throw new Error(`FPS_CHROME points at a file that does not exist: ${BROWSER.executablePath}`);
  }
  console.log(`browser: ${BROWSER.executablePath} (FPS_CHROME)`);
}

export function harness() {
  let passed = 0, failed = 0;
  return {
    /** Records a result; only failures are printed. */
    assert(cond, msg) {
      if (cond) passed++;
      else { console.error('FAIL:', msg); failed++; }
    },
    eq(got, want, msg) {
      const ok = Object.is(got, want);
      if (ok) passed++;
      else { console.error('FAIL:', `${msg} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); failed++; }
    },
    section(title) { console.log(`=== ${title} ===`); },
    note(text) { console.log(`  note ${text}`); },
    done() {
      console.log(`\n=== summary ===`);
      console.log(`${passed} passed, ${failed} failed`);
      process.exit(failed ? 1 : 0);
    }
  };
}

/**
 * Pull a balanced `{...}` / `[...]` literal out of a source file, starting at the
 * first match of `re`. Same helper test/tz-icu.mjs uses; for tables that live
 * inside a function body and so cannot be reached by running the file.
 */
export function balanced(src, re, open, close) {
  const i = src.search(re);
  if (i < 0) throw new Error('not found: ' + re);
  const b = src.indexOf(open, i);
  let d = 0, j = b;
  for (; j < src.length; j++) {
    if (src[j] === open) d++;
    else if (src[j] === close) { d--; if (!d) break; }
  }
  if (d !== 0) throw new Error('unbalanced: ' + re);
  return src.slice(b, j + 1);
}

/** Any host object the file only pokes at load time: every access returns another one. */
function deepStub() {
  const f = function () { return deepStub(); };
  return new Proxy(f, {
    // `then` must stay undefined or `await chrome.storage.local.get()` would hang
    // on a thenable that never settles.
    //
    // Symbol.toPrimitive is the one symbol that must answer: background.js does its own
    // startup work at load (registerBootScript), and that builds file paths out of values
    // read back from the stub — `dyn/dev/${devId}.js`. Without this the coercion throws
    // "Cannot convert object to primitive value", which the file's own try/catch then
    // reports as a warning on every suite that loads it. The stub is meant to be inert,
    // not to make load-time code look broken.
    get: (_t, p) => {
      if (p === 'then') return undefined;
      if (p === Symbol.toPrimitive) return () => 'stub';
      return typeof p === 'symbol' ? undefined : deepStub();
    },
    set: () => true,
    apply: () => deepStub()
  });
}

const IMPORT_LINE = "importScripts('defaults.js', 'seed-lib.js');";

/**
 * A FUNCTIONAL `chrome`, for the suites that exercise background.js's ASYNC flows rather
 * than its pure functions: a real key-value store, a dynamic-rule table that refuses a
 * duplicate id the way the browser does, and recorded calls for the registration APIs.
 * Everything else stays inert. `seed` is the storage's initial contents.
 *
 * It exists because two defects of the 2026-09-03 audit lived entirely in those flows —
 * a rule id written by two functions, and an observer deciding from a cache that had not
 * loaded yet — and deepStub() above, which answers every call with another stub, can
 * neither hold a rule table nor tell "wrote the host" from "did not".
 */
export function mockChrome(seed = {}) {
  const store = new Map(Object.entries(seed));
  const rules = new Map();
  const sessionRules = new Map();
  const calls = [];
  const listeners = {};
  const noop = { addListener() {} };
  const list = (keys) => (Array.isArray(keys) ? keys : [keys]);
  const chrome = {
    storage: {
      local: {
        get: async (keys) => { const out = {}; list(keys).forEach((k) => { if (store.has(k)) out[k] = store.get(k); }); return out; },
        set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
        remove: async (keys) => { list(keys).forEach((k) => store.delete(k)); }
      },
      onChanged: noop
    },
    declarativeNetRequest: {
      updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => {
        calls.push({ api: 'updateDynamicRules', remove: removeRuleIds.slice(), add: addRules.map((r) => r.id) });
        removeRuleIds.forEach((id) => rules.delete(id));
        addRules.forEach((r) => {
          if (rules.has(r.id)) throw new Error(`Rule with id ${r.id} does not have a unique ID.`);
          rules.set(r.id, r);
        });
      },
      getDynamicRules: async () => [...rules.values()],
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        removeRuleIds.forEach((id) => sessionRules.delete(id));
        addRules.forEach((r) => sessionRules.set(r.id, r));
      },
      getSessionRules: async () => [...sessionRules.values()],
      updateEnabledRulesets: async () => {}
    },
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async (specs) => { calls.push({ api: 'registerContentScripts', specs }); },
      updateContentScripts: async (specs) => { calls.push({ api: 'updateContentScripts', specs }); },
      unregisterContentScripts: async () => {},
      executeScript: async () => []
    },
    runtime: { onStartup: noop, onInstalled: noop, onMessage: noop, getURL: (p) => 'chrome-extension://mock/' + p, lastError: null },
    tabs: { onUpdated: noop, onActivated: noop, onRemoved: { addListener: (fn) => { listeners.tabRemoved = fn; } }, query: async () => [], get: async () => ({}), reload: async () => {} },
    webRequest: { onHeadersReceived: noop, onBeforeRequest: noop, onErrorOccurred: noop },
    fontSettings: { setFont: async () => {}, clearFont: async () => {} }
  };
  chrome.__mock = { rules, sessionRules };
  return { chrome, store, rules, sessionRules, calls, listeners };
}

/**
 * Runs background.js and returns the named top-level identifiers.
 * `ua` becomes navigator.userAgent (afpChromeMajor reads it).
 * `chrome` replaces the inert stub with a functional one — see mockChrome.
 */
export function loadBackground(names, opts = {}) {
  const bg = read('background.js');
  if (!bg.includes(IMPORT_LINE)) {
    throw new Error('background.js no longer starts with ' + IMPORT_LINE + ' — update test/harness.mjs');
  }
  // Both imported files are inlined rather than stubbed: importScripts shares one
  // global scope with its caller, and so does textual concatenation, while a stub
  // function could not declare AFP_DEFAULT_PROFILE where background.js sees it.
  // seed-lib.js carries registrableDomain / deriveDomainSeed, which used to be written
  // out inside background.js — inlining it keeps the ~1100 assertions in
  // test/background-fns.mjs exercising the same two functions through the same call.
  const body = [
    read('defaults.js'),
    read('seed-lib.js'),
    bg.replace(IMPORT_LINE, ''),
    `;return { ${names.join(', ')} };`
  ].join('\n');
  const nav = 'ua' in opts
    ? (opts.ua === null ? null : { get userAgent() { if (opts.ua === 'throw') throw new Error('blocked'); return opts.ua; } })
    : { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36' };
  return new Function('chrome', 'navigator', 'self', body)(opts.chrome || deepStub(), nav, deepStub());
}

/** Runs popup.js and returns the named top-level identifiers. */
export function loadPopup(names) {
  const body = read('popup.js') + `\n;return { ${names.join(', ')} };`;
  const documentStub = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, addEventListener() {} })
  };
  const windowStub = { addEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  return new Function('chrome', 'document', 'window', 'navigator', body)(
    deepStub(), documentStub, windowStub, { userAgent: 'test', language: 'en-US' }
  );
}
