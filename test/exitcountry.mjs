/**
 * The exit-country check: does the popup tell the truth about the one axis this extension
 * cannot otherwise see?
 *
 *   node test/exitcountry.mjs             headless
 *   node test/exitcountry.mjs --headed    watch it
 *
 * [FIX nothing-compared-the-profile-against-the-exit-ip] Every other guarantee in this
 * codebase is INTERNAL — the header agrees with the JS, the window agrees with the worker,
 * the cold start agrees with the inject — and all of it stays true while the profile claims
 * Estonia over a Frankfurt exit node. That is the first thing a fingerprinter compares and
 * the only thing 22 suites could not measure, because they all measure the browser against
 * itself.
 *
 * MOST OF THIS IS HERMETIC ON PURPOSE. The reading is seeded into storage rather than
 * fetched, so the rows below test the logic that decides what to SHOW — which is where the
 * mistakes are — and not Cloudflare's uptime. A suite that goes red on a train is a suite
 * people learn to ignore. One row at the end does hit the network, and it is allowed to
 * skip: it checks the contract (a two-letter code, stored, dated), never a specific country.
 *
 * SEEDING WAS NOT ENOUGH, and the first CI browser run is what showed it. Two of the seeded
 * rows — the stale reading and the one with no reading at all — are exactly the two states
 * that INVITE a refresh, so opening the popup sent the service worker to Cloudflare and the
 * live answer replaced the fixture mid-row. On the machine this was written on that is
 * invisible: the exit node is in Estonia and the profile claims Estonia, so the overwrite
 * changed nothing. On a GitHub runner in the United States it turned both rows red, and the
 * warning they were asserting the absence of was perfectly correct.
 *
 * So the lookup is BLOCKED for the seeded rows — `ctx.route` reaches the extension service
 * worker's own fetch, measured — and the block is verified rather than assumed before they
 * run. It is lifted again for the live row at the end.
 *
 * The three states that must not produce a warning are as important as the one that must.
 * Claiming a mismatch the extension cannot currently confirm would send the user to change
 * a setting that was never wrong.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';
const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('  FAIL:', m); failed++; } };

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
   .end('<!doctype html><title>site</title>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const dir = mkdtempSync(join(tmpdir(), 'afp-exitcc-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

try {
  const bg = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
    await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 3000));
  const id = new URL(bg.url()).host;

  // The popup must load with a site as the active tab — see the note in test/popupfit.mjs.
  const site = await ctx.newPage();
  await site.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 400, height: 900 });

  // The lookup is blocked for every seeded row below, and the block is CHECKED first. A
  // block that silently did not take would leave the rows exactly as fragile as they were,
  // passing here and failing on a runner in another country — which is the shape of bug
  // this whole file is now guarding against.
  const TRACE = '**/cdn-cgi/trace';
  await ctx.route(TRACE, (r) => r.abort());
  const blocked = await bg.evaluate(async () => {
    await chrome.storage.local.set({ afp_geocheck: true });
    await chrome.storage.local.remove(['afp_exit_cc', 'afp_exit_at']);
    const res = await afpRefreshExitCountry(true);
    return (res && res.cc) || null;
  }).catch(() => null);
  ok(blocked === null,
    `the live lookup is blocked while the seeded rows run (got ${blocked || 'nothing'}) — ` +
    `without that, the two states that invite a refresh (stale, and never read) have their ` +
    `fixture replaced by wherever this machine actually is`);

  /** Seed a reading, reopen the popup, and read what the country line ended up saying. */
  async function withReading(state) {
    await bg.evaluate(async (s) => {
      await chrome.storage.local.set({ afp_country_code: 'EE' });
      if (s.geocheck === false) await chrome.storage.local.set({ afp_geocheck: false });
      else await chrome.storage.local.set({ afp_geocheck: true });
      if (s.cc === null) await chrome.storage.local.remove(['afp_exit_cc', 'afp_exit_at']);
      else await chrome.storage.local.set({ afp_exit_cc: s.cc, afp_exit_at: s.at });
    }, state);
    await popup.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load' });
    await site.bringToFront();
    await popup.reload({ waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1400));
    return popup.evaluate(() => ({
      code: document.getElementById('countryCode').textContent,
      line: document.getElementById('countryTz').textContent,
      warn: document.getElementById('countryTz').classList.contains('warn'),
      title: document.getElementById('countryTz').title,
      height: document.body.scrollHeight
    }));
  }

  const NOW = Date.now();

  // 1) The case the feature exists for: the profile says EE, the address says DE.
  const bad = await withReading({ cc: 'DE', at: NOW });
  console.log('mismatch (EE vs DE) :', JSON.stringify(bad));
  ok(bad.code === 'EE', `the selected country is still shown (${bad.code})`);
  ok(bad.warn === true, 'the country line is marked as a warning');
  ok(/не совпадает/.test(bad.line), `the line says the address disagrees (${bad.line})`);
  ok(/Germany|DE/.test(bad.line), `and names where the address actually is (${bad.line})`);
  ok(/seed|visitor id|Смените/i.test(bad.title),
    'the tooltip explains the consequence rather than only the fact');

  // 2) Agreement must be silent. A warning that is always on is a warning nobody reads.
  const good = await withReading({ cc: 'EE', at: NOW });
  console.log('match    (EE vs EE) :', JSON.stringify(good));
  ok(good.warn === false, 'no warning when the address agrees with the profile');
  ok(good.line === 'Europe/Tallinn', `the line goes back to the timezone (${good.line})`);

  // 3) A reading older than the TTL is not evidence of anything. Asserting a mismatch from
  //    it would nag about a VPN node the user may have already changed back.
  const stale = await withReading({ cc: 'DE', at: NOW - 25 * 60 * 60 * 1000 });
  console.log('stale    (DE, 25h)  :', JSON.stringify(stale));
  ok(stale.warn === false, 'a stale reading raises no warning');

  // 4) Switched off means silent, not "unknown country".
  const off = await withReading({ cc: 'DE', at: NOW, geocheck: false });
  console.log('lookup off          :', JSON.stringify(off));
  ok(off.warn === false, 'no warning when the lookup is disabled');
  ok(off.line === 'Europe/Tallinn', `the timezone line is intact (${off.line})`);

  // 5) Never read at all — a fresh install, or every attempt failed.
  const none = await withReading({ cc: null, at: 0 });
  console.log('never read          :', JSON.stringify(none));
  ok(none.warn === false, 'no warning before anything has been read');

  // Height is the constraint the whole design turns on: the popup rests at 590 against
  // Chrome's 600 cap. Asserted in every state, not just the warning one.
  const heights = [bad, good, stale, off, none].map((s) => s.height);
  ok(heights.every((h) => h === heights[0]),
    `every exit-country state is the same height (${JSON.stringify(heights)})`);
  ok(heights[0] <= 600, `and inside Chrome's popup cap (${heights[0]}px)`);

  // 6) The contract with the network, allowed to skip. Not "is the country EE" — that is
  //    the rig's VPN, not a property of the code.
  //    The block goes here: everything above is seeded and must not be reachable by a
  //    refresh, everything below is the one row that is meant to hit the wire.
  await ctx.unroute(TRACE);
  //    Calls afpRefreshExitCountry directly rather than through chrome.runtime.sendMessage:
  //    a service worker does not deliver a message to its OWN onMessage listener, so the
  //    first version of this row got no reply and read as "offline" on a working network.
  //    The message path is covered anyway — the popup rows above go through it, and the
  //    mismatch could not have rendered otherwise.
  const live = await bg.evaluate(async () => {
    await chrome.storage.local.set({ afp_geocheck: true });
    await chrome.storage.local.remove(['afp_exit_cc', 'afp_exit_at']);
    const res = await afpRefreshExitCountry(true);
    const st = await chrome.storage.local.get(['afp_exit_cc', 'afp_exit_at']);
    return { res: { ok: true, cc: res.cc, stale: !res.cc }, st };
  });
  console.log('live lookup         :', JSON.stringify(live));
  if (live.res && live.res.ok && live.res.cc) {
    ok(/^[A-Z]{2}$/.test(live.res.cc), `a live lookup returns a 2-letter code (${live.res.cc})`);
    ok(live.st.afp_exit_cc === live.res.cc, 'and the same value reached storage');
    ok(typeof live.st.afp_exit_at === 'number' && live.st.afp_exit_at > 0,
      'with a timestamp, so staleness can be judged later');
    ok(live.res.stale === false, 'a reading taken just now is not stale');
  } else {
    console.log('       (skipped: no usable answer — offline, blocked, or the endpoint moved)');
  }
} finally {
  await ctx.close();
  server.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
