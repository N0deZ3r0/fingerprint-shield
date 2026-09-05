/**
 * WHICH SEED DID THE PAGE ACTUALLY USE?
 *
 *   node tools/probe-seed.mjs            twelve fresh tabs
 *   node tools/probe-seed.mjs 30         more, because the symptom is intermittent
 *   node tools/probe-seed.mjs 12 --headed
 *
 * the open-work list item 6: on a fresh tab the first load sometimes sees different noise from the
 * second — canvas, WebGL readback, text metrics and battery all moving together, which is
 * one seed rather than four bugs.
 *
 * THE MEASUREMENT THAT NARROWS IT. `battery.level` is a pure function of the MASTER seed:
 * afpDeviceState in seed-lib.js computes `0.62 + (mix(seed) % 33)/100` for any non-desktop
 * profile. So the level the page reports can be checked against the level the seed IN
 * STORAGE implies — 33 possible values, so a mismatch is caught 32 times in 33 — and that
 * turns "the noise changed" into "the page was handed a seed that is not the stored one".
 *
 * Three sources can hand a page that number, and this asks all three at once:
 *
 *   storage        chrome.storage.local['afp_noise_seed'], read from the service worker
 *   registration   the seed is SPELLED AS FILE NAMES — dyn/ns/<position><hex digit>.js,
 *                  eight of them inside the afp-boot registration, so a registration left
 *                  behind by an earlier seed delivers that earlier seed to document_start
 *                  [FIX seed-was-a-named-page-readable-key]
 *   the page       what it actually noised with, inverted from battery.level
 *
 * Read together they say which one disagreed, which is the question a hundred more runs of
 * test/stealth.mjs cannot answer.
 *
 * IT USES THE HEAVY COLLECTOR ON PURPOSE. An earlier version of this file drew one canvas
 * and read one battery, and across 24 fresh tabs it never reproduced the split; the same
 * machine reproduces it through test/stealth.mjs, which runs the whole 119-value collector
 * with its WebGL contexts, audio render and geolocation. Whatever the mechanism is, it needs
 * the load — so the provocation here is the same collector, and only the instrumentation is
 * new. A probe that cannot make the symptom appear cannot locate it.
 *
 * Exit code is the number of tabs whose page disagreed with storage.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, BROWSER, loadBackground } from '../test/harness.mjs';
import { EXPR } from './probe-collect.mjs';

const HEADED = process.argv.includes('--headed');
const TABS = Number(process.argv.find((a) => /^\d+$/.test(a)) || 12);
const EXT = process.env.FPS_EXT_ROOT ? path.resolve(process.env.FPS_EXT_ROOT) : root;

// The real function, not a copy of it — seed-lib.js is what background.js and dyn/boot.js
// both run, and the harness inlines it. A reimplementation here would be a fifth copy of a
// derivation this project has already been bitten by duplicating.
const { afpDeviceState } = loadBackground(['afpDeviceState']);
const levelFor = (seed, profileId) => afpDeviceState(seed, profileId).batteryLevel;

/**
 * The page records every `ui:state` it sees. That event is the live profile channel, and
 * mw-core's listener REPLACES its profile wholesale on each one — so a publisher that omits
 * a field silently wipes the value an earlier, more complete publisher had put there. This
 * is what tells one publisher from another when a value falls back.
 *
 * The listener is added from an ordinary page script, so it misses whatever dyn/boot.js
 * established before the document had any script of its own; that is fine, because the
 * question is which LATER event overwrote it.
 */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>seed</title>
<script>
window.__t0 = Date.now();
window.__ui = [];
document.addEventListener('ui:state', function (e) {
  var d = (e && e.detail) || {};
  window.__ui.push({
    at: Date.now() - window.__t0,
    hasBattery: Object.prototype.hasOwnProperty.call(d, 'batteryLevel'),
    battery: d.batteryLevel,
    hasSeed: Object.prototype.hasOwnProperty.call(d, 'noiseSeed'),
    keys: Object.keys(d).length
  });
});
</script></head><body>probe</body></html>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

/** dyn/ns/<position><hex>.js x8 -> the number those file names spell. */
function seedFromFiles(js) {
  if (!Array.isArray(js)) return null;
  const digits = [];
  for (const f of js) {
    const m = /dyn\/ns\/(\d)([0-9a-f])\.js$/.exec(f);
    if (m) digits[Number(m[1])] = m[2];
  }
  if (digits.length !== 8 || digits.some((d) => d === undefined)) return null;
  return parseInt(digits.join(''), 16) >>> 0;
}

/**
 * ONE FRESH BROWSER PER ROUND, and that is the whole point of the shape.
 *
 * The first version opened many tabs in ONE browser and never reproduced the split across
 * twenty-four of them, while test/stealth.mjs reproduces it regularly. The difference is not
 * how hard the page works — this runs the same collector — it is HOW OLD THE INSTALL IS. The
 * suite measures a tab in a browser that was created seconds earlier; by the fourteenth tab
 * of one browser everything asynchronous has long since settled.
 *
 * So each round is a fresh persistent profile, warmed the same five loads, and exactly one
 * measured tab — the suite's shape, with the storage and registration reads the suite cannot
 * make.
 */
let disagreed = 0, moved = 0, regStale = 0, rounds = 0;
for (let n = 1; n <= TABS; n++) {
  const dir = mkdtempSync(path.join(tmpdir(), 'afp-seed-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER,
    headless: !HEADED,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0]
      || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    const workerState = () => sw.evaluate(async () => {
      const out = {};
      try {
        const s = await chrome.storage.local.get(['afp_noise_seed', 'afp_profile_id']);
        out.seed = s.afp_noise_seed;
        out.profileId = s.afp_profile_id;
      } catch (e) { out.storageError = String(e && e.message); }
      try {
        const regs = await chrome.scripting.getRegisteredContentScripts({ ids: ['afp-boot'] });
        out.js = regs && regs[0] ? regs[0].js : null;
      } catch (e) { out.regError = String(e && e.message); }
      return out;
    }).catch((e) => ({ swError: String(e && e.message) }));

    const warm = await ctx.newPage();
    for (let i = 0; i < 4; i++) await warm.goto(URL_ + '?warm=' + i, { waitUntil: 'load' });
    await warm.reload({ waitUntil: 'load' });

    const tab = await ctx.newPage();
    // addInitScript lands in the MAIN world before the document has scripts of its own, so
    // unlike a listener added by the page it can see the ui:ready that dyn/boot.js
    // dispatches. That event IS the handshake, and whether it carries a deviceState at all
    // is the difference between "the producer never sent one" and "a consumer dropped it".
    await tab.addInitScript(() => {
      window.__ready = [];
      document.addEventListener('ui:ready', (e) => {
        const d = (e && e.detail) || {};
        window.__ready.push({
          hasDeviceState: !!(d.deviceState && typeof d.deviceState === 'object'),
          battery: d.deviceState && d.deviceState.batteryLevel,
          hasSeed: typeof d.noiseSeed === 'number',
          hasProfileData: !!d.profileData,
        });
      });
    });
    await tab.goto(URL_ + '?run=1', { waitUntil: 'load' });
    const a = await tab.evaluate(EXPR);
    const uiA = await tab.evaluate('window.__ui').catch(() => []);
    const rdyA = await tab.evaluate('window.__ready').catch(() => []);
    const wa = await workerState();
    await tab.reload({ waitUntil: 'load' });
    const b = await tab.evaluate(EXPR);
    const uiB = await tab.evaluate('window.__ui').catch(() => []);
    const rdyB = await tab.evaluate('window.__ready').catch(() => []);
    const wb = await workerState();
    rounds++;

    const pageMoved = a['canvas.2d'] !== b['canvas.2d']
      || a['battery.level'] !== b['battery.level'];
    const seedMoved = wa.seed !== wb.seed;
    const want = String(levelFor(wb.seed, wb.profileId));
    const regA = seedFromFiles(wa.js), regB = seedFromFiles(wb.js);
    const regBad = regA !== wa.seed || regB !== wb.seed;
    const bad = [['load1', a], ['load2', b]]
      .filter(([, r]) => String(r['battery.level']) !== want);

    if (pageMoved) moved++;
    if (bad.length) disagreed++;
    if (regBad) regStale++;

    if (pageMoved || bad.length || seedMoved || regBad) {
      console.log(`round ${n}:`);
      console.log(`   storage        ${wa.seed} -> ${wb.seed}${seedMoved ? '   MOVED' : ''}`);
      console.log(`   registration   ${regA} -> ${regB}${regBad ? '   STALE against storage' : ''}`);
      console.log(`   battery        ${a['battery.level']} -> ${b['battery.level']}   (stored seed implies ${want})`);
      console.log(`   canvas         ${a['canvas.2d']} -> ${b['canvas.2d']}`);
      for (const [w, evs] of [['load1', rdyA], ['load2', rdyB]]) {
        console.log(`   ui:ready on ${w}: ` + (evs.length
          ? evs.map((e) => `deviceState=${e.hasDeviceState ? e.battery : 'ABSENT'}` +
            ` seed=${e.hasSeed} profileData=${e.hasProfileData}`).join(' | ')
          : '(none)'));
      }
      for (const [w, evs] of [['load1', uiA], ['load2', uiB]]) {
        console.log(`   ui:state on ${w}: ` + (evs.length
          ? evs.map((e) => `+${e.at}ms ${e.keys} keys battery=${e.hasBattery ? e.battery : 'ABSENT'}`).join(' | ')
          : '(none seen by the page)'));
      }
      if (bad.length) {
        console.log(`   => ${bad.map(([w]) => w).join(' and ')} did NOT use the stored seed`);
        for (const cand of [regA, regB].filter((x) => x !== null && x !== wb.seed)) {
          console.log(`      seed ${cand} (from a registration) would imply ` +
            `${levelFor(cand, wb.profileId)}`);
        }
      }
    } else {
      console.log(`round ${n}: steady (seed ${wb.seed}, battery ${b['battery.level']})`);
    }
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  }
}
server.close();

console.log(`\n${moved} of ${rounds} rounds changed what the page saw between the two loads`);
console.log(`${disagreed} of ${rounds} rounds had a load that did not use the STORED seed`);
console.log(`${regStale} of ${rounds} rounds had a registration spelling a different seed`);
if (!moved && !disagreed && !regStale) {
  console.log('\nQuiet run. The rate floats with machine load, so this clears nothing —');
  console.log('judge by paired runs against a pristine tree, never by one quiet run.');
}
process.exitCode = disagreed;
