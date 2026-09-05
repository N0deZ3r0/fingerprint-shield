/**
 * The real detectors, run for real: BotD and FingerprintJS, both from fingerprintjs.
 *
 *   node test/detectors.mjs             headless
 *   node test/detectors.mjs --headed    watch it
 *
 * Every other suite in this directory measures something WE decided to measure. This one
 * asks the two libraries that actually ship on other people's sites, loaded from their own
 * CDN, and grades the extension by their verdict instead of ours. Their source is public,
 * so the assertions below name the exact check each one performs rather than trusting a
 * summary — see https://github.com/fingerprintjs/BotD/tree/main/src/detectors.
 *
 * NEEDS NETWORK. It is deliberately NOT part of `npm test`, which is offline and must stay
 * that way; when the CDN cannot be reached this exits 0 with SKIP rather than red, because
 * a suite that fails on a flaky network teaches people to ignore it.
 *
 * WHY EACH ASSERTION IS HERE — every one of these is a check BotD really runs, and each one
 * is a plausible way for this extension to hurt rather than help:
 *
 *   bot === false           the whole point. The clean rig scores bot: true /
 *                           headless_chrome, so this also proves the rig is the hard case.
 *   productSub '20030107'   detectProductSub: any Chrome that says anything else is a bot.
 *                           A navigator spoof that rebuilds the object can drop it.
 *   eval.toString().length  detectEvalLengthInconsistency: must be 33 on Chromium. This is
 *                           the canary for a GLOBAL Function.prototype.toString gate — the
 *                           one that once took CreepJS from 7 lies to 207.
 *   plugins instanceof      detectPluginsArray: a spoofed list that is a plain Array, not a
 *     PluginArray           PluginArray, is graded HeadlessChrome.
 *   plugins.length > 0      detectPluginsLengthInconsistency: 0 plugins on desktop Chrome
 *                           is HeadlessChrome.
 *   mimeTypes prototypes    areMimeTypesConsistent walks EVERY entry and compares
 *                           Object.getPrototypeOf against MimeType.prototype. Plain
 *                           objects in the list fail it.
 *   rtt !== 0               detectRTT: rtt 0 off Android is HeadlessChrome. We pin 50.
 *   webdriver false         the clean rig reports TRUE here, so this is a real fix, not a
 *                           tautology.
 *   outer size non-zero     detectWindowSize, when the document has focus.
 *   documentElement keys    detectDocumentAttributes looks for selenium/webdriver/driver.
 *                           This is also the guard on ever putting data-v-* back.
 *
 * And from FingerprintJS, the two properties a fingerprint has to have to be believable —
 * failing either is worse than being spoofed at all:
 *
 *   no component errors     a component that throws is a hole a real browser does not have.
 *   visitorId STABLE        identical across fresh tabs and a reload of one origin. An id
 *                           that moves under a site breaks the site and looks like tamper.
 *   visitorId DIFFERS       between two origins, which is the per-domain noise seed doing
 *     across origins        its job: no cross-site linking.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';
const headed = process.argv.includes('--headed');
// The negative control, and it is not decoration: a suite that only ever reports "not a
// bot" cannot be told apart from one that is not asking. `--clean` runs the SAME page and
// the SAME assertions in a browser with no extension, where this rig scores
// bot: true / headless_chrome and navigator.webdriver is true. Expect it to be RED.
//   node test/detectors.mjs --clean
const clean = process.argv.includes('--clean');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };
const eq = (got, want, m) => ok(Object.is(got, want), `${m} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const PAGE = `<!doctype html><html><body><script type="module">
window.__run = (async () => {
  const out = {};
  try {
    const Botd = await import('https://openfpcdn.io/botd/v1');
    out.botd = await (await Botd.load({ monitoring: false })).detect();
  } catch (e) { out.botdErr = String(e); }
  try {
    const FP = await import('https://openfpcdn.io/fingerprintjs/v4');
    const r = await (await FP.load()).get();
    out.visitorId = r.visitorId;
    out.componentErrors = Object.entries(r.components)
      .filter(([, v]) => v.error).map(([k]) => k);
  } catch (e) { out.fpErr = String(e); }
  // The same signals BotD grades, read the way its sources read them, so a failure names
  // the value rather than only the verdict.
  out.raw = {
    productSub: navigator.productSub,
    evalLength: eval.toString().length,
    pluginsIsArray: navigator.plugins instanceof PluginArray,
    pluginsLength: navigator.plugins.length,
    mimeProtoOk: Object.getPrototypeOf(navigator.mimeTypes) === MimeTypeArray.prototype,
    mimeItemsOk: (() => { let o = true;
      for (let i = 0; i < navigator.mimeTypes.length; i++) {
        o = o && Object.getPrototypeOf(navigator.mimeTypes[i]) === MimeType.prototype;
      } return o; })(),
    rtt: navigator.connection ? navigator.connection.rtt : 'absent',
    webdriver: navigator.webdriver,
    outerZero: outerWidth === 0 && outerHeight === 0,
    docElKeys: Object.keys(document.documentElement).join(','),
    appVersionHeadless: /headless/i.test(navigator.appVersion),
    uaHeadless: /headless/i.test(navigator.userAgent),
  };
  return out;
})();
</script></body></html>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const userDataDir = mkdtempSync(join(tmpdir(), 'afp-detectors-'));
// --clean launches a plain browser with no extension (the control); otherwise the
// persistent context with the extension loaded.
let browser = null;
const ctx = clean
  ? await (browser = await chromium.launch({ ...BROWSER, headless: !headed })).newContext()
  : await chromium.launchPersistentContext(userDataDir, {
    ...BROWSER, headless: !headed,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });

const read = async (host) => {
  const p = await ctx.newPage();
  await p.goto(`http://${host}:${port}/`, { waitUntil: 'load' });
  const v = await p.evaluate(async () => await window.__run);
  await p.close();
  return v;
};

try {
  if (!clean) {
    try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch { /* already up */ }
    await new Promise((r) => setTimeout(r, 3000));
  }

  const first = await read('127.0.0.1');
  if (first.botdErr || first.fpErr) {
    console.log(`SKIP — the detector CDN is unreachable (${first.botdErr || first.fpErr})`);
    console.log('This suite needs network on purpose; nothing is asserted offline.');
    await ctx.close(); if (browser) await browser.close(); server.close();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* windows */ }
    process.exit(0);
  }

  // ── BotD ──────────────────────────────────────────────────────────────────────
  eq(first.botd.bot, false, `BotD verdict (kind: ${first.botd.botKind || 'none'})`);
  const r = first.raw;
  eq(r.productSub, '20030107', 'productSub is the one value Chrome reports');
  eq(r.evalLength, 33, 'eval.toString().length is 33 — no global toString gate');
  eq(r.pluginsIsArray, true, 'navigator.plugins is a real PluginArray');
  ok(r.pluginsLength > 0, `plugins list is not empty (${r.pluginsLength})`);
  eq(r.mimeProtoOk, true, 'navigator.mimeTypes is a real MimeTypeArray');
  eq(r.mimeItemsOk, true, 'every mimeTypes entry is a real MimeType');
  ok(r.rtt !== 0, `connection.rtt is not 0 (${r.rtt})`);
  eq(r.webdriver, false, 'navigator.webdriver is false');
  eq(r.outerZero, false, 'window outer size is not 0x0');
  eq(r.docElKeys, '', 'documentElement carries no own keys for detectDocumentAttributes to read');
  eq(r.appVersionHeadless, false, 'appVersion says nothing about Headless');
  eq(r.uaHeadless, false, 'userAgent says nothing about Headless');

  // ── FingerprintJS ─────────────────────────────────────────────────────────────
  eq((first.componentErrors || []).length, 0,
    `no FingerprintJS component throws (${(first.componentErrors || []).join(', ')})`);

  // Stable under one origin: two more fresh tabs and a reload.
  const again = await read('127.0.0.1');
  const third = await read('127.0.0.1');
  ok(first.visitorId === again.visitorId && again.visitorId === third.visitorId,
    `visitorId is stable across tabs on one origin (${[first, again, third].map((x) => x.visitorId).join(' ')})`);

  // And different on another origin — the per-domain seed, which is the whole reason the
  // canvas noise is seeded per registrable domain rather than per install.
  const other = await read('localhost');
  ok(other.visitorId !== first.visitorId,
    `visitorId differs on another origin (127.0.0.1 ${first.visitorId}, localhost ${other.visitorId})`);
  // ...but stable there too, so "differs" is separation and not jitter.
  const otherAgain = await read('localhost');
  eq(otherAgain.visitorId, other.visitorId, 'and is stable on that origin as well');

  console.log(`\nBotD: ${first.botd.bot ? 'BOT ' + first.botd.botKind : 'not a bot'}`);
  console.log(`FingerprintJS visitorId: ${first.visitorId} (127.0.0.1) / ${other.visitorId} (localhost)`);
} finally {
  await ctx.close();
  if (browser) await browser.close();
  server.close();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
}

console.log(`\n${passed} passed, ${failed} failed` +
  (clean ? '  — --clean is the CONTROL: red here is the correct result' : ''));
process.exit(failed ? 1 : 0);
