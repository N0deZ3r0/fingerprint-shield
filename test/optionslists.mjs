/**
 * The two per-site lists on the options page.
 *
 *   node test/optionslists.mjs
 *
 * Both switches in the popup write a permanent, per-site decision, and the options page is
 * the only place either list can be READ or cleared — the confusion that started this work
 * was a WebRTC exception set weeks earlier and invisible from every page since. So the page
 * is driven here rather than eyeballed: the list has to show what storage holds, Clear has
 * to empty storage AND drop the document_start registration that mirrors it, and the button
 * has to be disabled when there is nothing to clear.
 */
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';
const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

const dir = mkdtempSync(join(tmpdir(), 'afp-optlists-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
try {
  const bg = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
    await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 3000));
  const id = new URL(bg.url()).host;
  const OPTIONS = `chrome-extension://${id}/options.html`;

  const regIds = () => bg.evaluate(async () =>
    (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const read = (page) => page.evaluate(() => ({
    sw: document.getElementById('swList').textContent.trim(),
    swBtn: document.getElementById('swClearBtn').disabled,
    rtc: document.getElementById('rtcList').textContent.trim(),
    rtcBtn: document.getElementById('rtcClearBtn').disabled,
    status: document.getElementById('status').textContent.trim()
  }));

  // ── empty ────────────────────────────────────────────────────────────────────
  let page = await ctx.newPage();
  await page.goto(OPTIONS, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1200));
  const empty = await read(page);
  console.log('empty      ' + JSON.stringify(empty));
  ok(/Список пуст/.test(empty.sw), `the SW card says the list is empty (${empty.sw})`);
  ok(empty.swBtn === true, 'Clear is disabled with nothing to clear (service workers)');
  ok(/Список пуст/.test(empty.rtc), `the WebRTC card says the list is empty (${empty.rtc})`);
  ok(empty.rtcBtn === true, 'Clear is disabled with nothing to clear (WebRTC)');
  await page.close();

  // ── populated ────────────────────────────────────────────────────────────────
  await bg.evaluate(async () => {
    await chrome.storage.local.set({
      afp_sw_blocked: ['example.com', 'shop.example.org'],
      afp_webrtc_exceptions: ['meet.example.net']
    });
  });
  await new Promise((r) => setTimeout(r, 2000));
  page = await ctx.newPage();
  await page.goto(OPTIONS, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1200));
  const full = await read(page);
  console.log('populated  ' + JSON.stringify(full));
  ok(full.sw.includes('example.com') && full.sw.includes('shop.example.org'),
    `the SW card lists both blocked hosts (${full.sw})`);
  ok(full.swBtn === false, 'Clear becomes available once something is blocked');
  ok(full.rtc.includes('meet.example.net'), `the WebRTC card lists its exception (${full.rtc})`);
  const before = await regIds();
  console.log('registered ' + JSON.stringify(before));
  ok(before.includes('afp-sw-off') && before.includes('afp-rtc-off'),
    `both document_start markers are registered while the lists have entries (${before.join(',')})`);

  // ── cleared, through the page's own button ───────────────────────────────────
  await page.click('#swClearBtn');
  await new Promise((r) => setTimeout(r, 2000));
  const afterSw = await read(page);
  console.log('SW cleared ' + JSON.stringify(afterSw));
  ok(/Список пуст/.test(afterSw.sw), `Clear empties the SW list on screen (${afterSw.sw})`);
  ok(afterSw.swBtn === true, 'and disables its own button again');
  ok(/разрешён на всех сайтах/i.test(afterSw.status), `and says so (${afterSw.status})`);
  ok(afterSw.rtc.includes('meet.example.net'), 'the WebRTC list is untouched by the SW button');

  const stored = await bg.evaluate(() => chrome.storage.local.get(['afp_sw_blocked', 'afp_webrtc_exceptions']));
  ok(Array.isArray(stored.afp_sw_blocked) && stored.afp_sw_blocked.length === 0,
    `storage is empty too (${JSON.stringify(stored.afp_sw_blocked)})`);
  const after = await regIds();
  console.log('registered ' + JSON.stringify(after));
  ok(!after.includes('afp-sw-off'),
    `the SW marker is unregistered with the list it mirrors (${after.join(',')})`);
  ok(after.includes('afp-rtc-off'), 'and the WebRTC marker stays, because its list still has an entry');

  // ── a change made elsewhere while this page is open ──────────────────────────
  // The popup writes these lists too, and a user can have both open. Nothing polled, so a
  // list could sit stale for as long as the tab stayed open — the same invisible state the
  // switches themselves were fixed for.
  await bg.evaluate(async () => { await chrome.storage.local.set({ afp_sw_blocked: ['live.example.com'] }); });
  await new Promise((r) => setTimeout(r, 1200));
  const live = await read(page);
  console.log('written elsewhere ' + JSON.stringify(live));
  ok(live.sw.includes('live.example.com'),
    `the open page follows a change made from the popup (${live.sw})`);
  ok(live.swBtn === false, 'and re-enables Clear without a reload');
  await bg.evaluate(async () => { await chrome.storage.local.set({ afp_sw_blocked: [] }); });
  await new Promise((r) => setTimeout(r, 1000));

  await page.click('#rtcClearBtn');
  await new Promise((r) => setTimeout(r, 2000));
  const afterRtc = await read(page);
  console.log('RTC cleared ' + JSON.stringify(afterRtc));
  ok(/Список пуст/.test(afterRtc.rtc), `the WebRTC button clears its own list (${afterRtc.rtc})`);
  const last = await regIds();
  ok(!last.includes('afp-rtc-off'), `and drops its marker (${last.join(',')})`);
} finally {
  await ctx.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
