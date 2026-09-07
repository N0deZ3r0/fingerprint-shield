/**
 * The per-site lists on the options page.
 *
 *   node test/optionslists.mjs
 *
 * Each switch in the popup writes a permanent, per-site decision, and the options page is the
 * only place those lists can be READ or cleared — the confusion that started this work was a
 * WebRTC exception set weeks earlier and invisible from every page since. So the page is
 * driven here rather than eyeballed: the list has to show what storage holds, Clear has to
 * empty storage AND drop the document_start registration that mirrors it, and the button has
 * to be disabled when there is nothing to clear.
 *
 * THE LAST SECTION IS A DIFFERENT KIND OF LIST, and it was added because that difference is
 * what had been missed. The three above are filled by the USER pressing a switch. Six more —
 * the CSP shapes this extension learns per host as you browse — fill themselves, grow without
 * a cap, are not touched by a profile change, and had no screen, no count and no way to clear.
 * That is [FIX the-off-state-was-invisible] again, on the lists that actually grow on their
 * own. The screen shows a COUNT and never the sites: a page of host names would be the
 * browsing history the entry is about, printed larger.
 */
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, uiMessages, langArgs, bootSettled } from './harness.mjs';

/**
 * [FIX clear-was-waited-for-by-the-clock] Clicking Clear sends a message to the service
 * worker, which clears the list and answers, and the page re-renders on that answer. The
 * three call sites slept 1500-2000ms for that round trip. On the CI runner one guessed wrong
 * — `Clear empties them (4 entries: 2 — do not allow blob workers; …)`, the list still
 * holding exactly what Clear had been asked to remove — and a suite that reports a defect
 * because a message was in flight is reporting the machine, not the code.
 *
 * The wait has a name: the row says it is empty. If it never does within the budget, the
 * assertion that follows still fails, and now for the right reason.
 */
async function emptied(page, id, want) {
  await page.waitForFunction(
    ([elId, text]) => (document.getElementById(elId) || {}).textContent === text,
    [id, want], { timeout: 15000 }
  ).catch(() => { /* the assertion that follows reports it in its own words */ });
}
const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

const dir = mkdtempSync(join(tmpdir(), 'afp-optlists-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, ...langArgs()]
});
try {
  const bg = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
    await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(ctx);
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
  // The page renders in the browser's own language; the expectations come from the same
  // catalogue it used, not from Russian literals that only pass on one machine.
  const M = uiMessages(await page.evaluate(() => chrome.i18n.getUILanguage()));
  const empty = await read(page);
  console.log('empty      ' + JSON.stringify(empty));
  ok(empty.sw === M('optSwEmpty'), `the SW card says the list is empty (${empty.sw})`);
  ok(empty.swBtn === true, 'Clear is disabled with nothing to clear (service workers)');
  ok(empty.rtc === M('optRtcEmpty'), `the WebRTC card says the list is empty (${empty.rtc})`);
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
  await emptied(page, 'swList', M('optSwEmpty'));
  const afterSw = await read(page);
  console.log('SW cleared ' + JSON.stringify(afterSw));
  ok(afterSw.sw === M('optSwEmpty'), `Clear empties the SW list on screen (${afterSw.sw})`);
  ok(afterSw.swBtn === true, 'and disables its own button again');
  ok(afterSw.status === M('optSwCleared'), `and says so (${afterSw.status})`);
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
  await emptied(page, 'rtcList', M('optRtcEmpty'));
  const afterRtc = await read(page);
  console.log('RTC cleared ' + JSON.stringify(afterRtc));
  ok(afterRtc.rtc === M('optRtcEmpty'), `the WebRTC button clears its own list (${afterRtc.rtc})`);
  const last = await regIds();
  ok(!last.includes('afp-rtc-off'), `and drops its marker (${last.join(',')})`);

  // [FIX the-learned-lists-were-the-invisible-ones] The three lists above are filled by the
  // user pressing a switch. The six checked here fill themselves while browsing — one entry
  // per site whose CSP has a shape worth remembering — and until this section they had no
  // screen, no count and no way to clear, while a profile change left them in place. The
  // treatment is the one [FIX the-off-state-was-invisible] gave the WebRTC list.
  //
  // THE COUNT IS ASSERTED, NOT THE HOSTS, and the screen shows the same: a page listing the
  // sites would be the browsing history this entry is about, printed larger.
  await bg.evaluate(async () => {
    await chrome.storage.local.set({
      afp_csp_noblob: ['a.example.com', 'b.example.com/app'],
      afp_csp_tt: ['c.example.net'],
      afp_csp_mixed: ['d.example.org']
    });
  });
  await page.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1200));
  const learned = await page.evaluate(() => ({
    text: document.getElementById('learnedList').textContent,
    btn: document.getElementById('learnedClearBtn').disabled
  }));
  console.log('learned      ' + JSON.stringify(learned));
  ok(learned.text.startsWith(M('optLearnedRows').replace('$1', '4').split('$2')[0]),
    `the learned lists are counted on screen (${learned.text})`);
  ok(learned.btn === false, 'and Clear is enabled while there is something to clear');
  // The hosts must NOT be on screen — that is the whole reason this shows a number.
  ok(!/example\.(com|net|org)/.test(learned.text),
    `no site name is printed (${learned.text})`);

  await page.click('#learnedClearBtn');
  await emptied(page, 'learnedList', M('optLearnedEmpty'));
  const afterLearned = await page.evaluate(() => ({
    text: document.getElementById('learnedList').textContent,
    btn: document.getElementById('learnedClearBtn').disabled
  }));
  console.log('learned clr  ' + JSON.stringify(afterLearned));
  ok(afterLearned.text === M('optLearnedEmpty'), `Clear empties them (${afterLearned.text})`);
  ok(afterLearned.btn === true, 'and disables its own button');
  // Storage, not just the screen: a button that repaints without writing is the failure this
  // suite exists to catch on the other three lists.
  const storedLearned = await bg.evaluate(async () => {
    const g = await chrome.storage.local.get(['afp_csp_noblob', 'afp_csp_tt', 'afp_csp_mixed']);
    return Object.keys(g).map((k) => k + '=' + JSON.stringify(g[k] || [])).join(' ');
  });
  ok(!/example/.test(storedLearned), `and storage is actually empty (${storedLearned})`);
} finally {
  await ctx.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
