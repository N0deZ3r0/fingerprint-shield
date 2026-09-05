/**
 * Does the popup fit, and do its per-site switches still line up with the DOM?
 *
 *   node test/popupfit.mjs
 *
 * Chrome caps a popup at 600px and adds a scrollbar past it. Nothing checked that, so the
 * Service Worker row pushed the resting height to 652 and the scrollbar arrived unnoticed;
 * a status message added 53px more on every click, because it sat in the flow. Both are
 * measured here rather than eyeballed — the height WITH a message shown is the one that
 * used to regress, so it is asserted separately.
 *
 * The suite also drives both switches through the real popup script. That is not padding:
 * merging the two rows into one card renamed the elements they write to, and a stale id
 * would leave the popup silently doing nothing while every other suite stayed green.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';
const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

const MAX = 600;   // Chrome's popup height cap

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
   .end('<!doctype html><title>site</title>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const dir = mkdtempSync(join(tmpdir(), 'afp-popupfit-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
try {
  const bg = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
    await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 3000));
  const id = new URL(bg.url()).host;

  // The popup must LOAD while a site is the active tab: that is the state a user is in,
  // and it is what hides the "no active tab" note. Measuring without it reads 37px short.
  const site = await ctx.newPage();
  await site.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 400, height: 700 });
  await popup.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load' });
  await site.bringToFront();
  await popup.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1500));

  const resting = await popup.evaluate(() => document.body.scrollHeight);
  console.log(`resting height        ${resting}px (cap ${MAX})`);
  ok(resting <= MAX, `the popup fits without a scrollbar (${resting}px, cap ${MAX})`);

  // [FIX the-status-message-sat-on-the-apply-button] Height was the only thing measured
  // here, and the bar passed it while sitting 3px ON the Apply button — the one control
  // the user had just pressed. Position is now asserted too, and against the BUTTON rather
  // than a coordinate: the bar is absolutely positioned inside .foot and sized to the links
  // row, so "below the button" is structural and holds at any popup height.
  //
  // The popup window is as tall as its content, so the viewport is sized to it first. With
  // the old viewport-fixed bar that distinction was the whole bug: measured at 600px the
  // overlap was 3px, at the real 590px it was worse.
  await popup.setViewportSize({ width: 400, height: resting });
  await new Promise((r) => setTimeout(r, 200));

  const msgGeo = await popup.evaluate(() => {
    // The longest message the popup can actually produce, now that the hostname is not
    // repeated into it.
    window.showStatus('Service Worker заблокирован — обновите страницу (F5)', 'ok', 60000);
    const R = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
    const btn = R(document.getElementById('applyBtn'));
    const bar = document.getElementById('statusBar');
    const st = R(bar);
    const lk = R(document.querySelector('.links'));
    // [FIX the-status-message-had-nowhere-to-land] EVERY control, not the two that were
    // reported. Checking named elements one at a time is how this took three attempts:
    // each fix satisfied the assertion that existed and landed on the next widget along.
    const hits = [];
    document.querySelectorAll('button, a, input, .prof, .toggle, [role=listbox]').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (!b.height) return;
      const over = Math.min(b.bottom, st.bottom) - Math.max(b.top, st.top);
      if (over > 0) hits.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + (el.className.split(' ')[0] || '')) + ` +${Math.round(over)}px`);
    });
    return {
      height: document.body.scrollHeight, btn, st, lk, hits,
      overlap: Math.max(0, Math.min(btn.bottom, st.bottom) - Math.max(btn.top, st.top)),
      overlapLinks: Math.max(0, Math.min(lk.bottom, st.bottom) - Math.max(lk.top, st.top)),
      clipped: bar.scrollWidth > bar.clientWidth + 1,
      title: bar.title
    };
  });
  console.log(`with a status message ${msgGeo.height}px  ` +
    `(button ${msgGeo.btn.top}-${msgGeo.btn.bottom}, bar ${msgGeo.st.top}-${msgGeo.st.bottom})`);
  ok(msgGeo.height === resting,
    `a status message does not resize the popup (${msgGeo.height}px vs ${resting}px) — it is out of the flow`);
  ok(msgGeo.overlap === 0,
    `the status message does not cover the Apply button (overlap ${msgGeo.overlap}px, ` +
    `button ends ${msgGeo.btn.bottom}, bar starts ${msgGeo.st.top})`);
  // [FIX the-status-message-then-covered-the-footer-links] The first attempt at keeping the
  // bar off the button parked it on "Настройки" / "Who Am I" instead. Both are asserted now,
  // because "does not cover the button" was satisfied by a layout the user still had to
  // report. The bar sits above the whole footer.
  ok(msgGeo.overlapLinks === 0,
    `the status message does not cover the footer links either (overlap ${msgGeo.overlapLinks}px, ` +
    `links ${msgGeo.lk.top}-${msgGeo.lk.bottom}, bar ${msgGeo.st.top}-${msgGeo.st.bottom})`);
  // The assertion that would have caught all three attempts at once.
  ok(msgGeo.hits.length === 0,
    `the status message covers no control anywhere in the popup` +
    (msgGeo.hits.length ? ` — hits: ${msgGeo.hits.join(', ')}` : ''));
  ok(msgGeo.clipped === false,
    'the longest real message fits on the bar\'s single line without being ellipsised');
  ok(!!msgGeo.title,
    'and the full text is on the title attribute, so a longer one is still readable');

  // [FIX nothing-compared-the-profile-against-the-exit-ip] The exit-country mismatch is
  // written into the line under the country name instead of being added as a row, and the
  // reason is arithmetic: the popup rests at 590px against Chrome's 600px cap, and the
  // existing #warnings box takes it to 628 the moment it holds one line — measured right
  // here, below. So a new row would have put every mismatch behind a scrollbar, and a
  // mismatch is not a rare state: it happens to anyone who moves a VPN node.
  //
  // Both halves are asserted. The first is the one the design depends on.
  const exitHeights = await popup.evaluate(() => {
    const out = {};
    const tz = document.getElementById('countryTz');
    const before = tz.textContent, hadWarn = tz.classList.contains('warn');
    // The longest realistic form: a country name we do not offer, so exitName falls back.
    tz.textContent = 'IP: Соединённые Штаты Америки — не совпадает';
    tz.classList.add('warn');
    out.withMismatch = document.body.scrollHeight;
    tz.textContent = before;
    tz.classList.toggle('warn', hadWarn);
    out.restored = document.body.scrollHeight;
    // And what a row would have cost, for the record.
    const w = document.getElementById('warnings');
    const wasHidden = w.hidden, html = w.innerHTML;
    w.innerHTML = '<div class="warning">· sample</div>';
    w.hidden = false;
    out.withRow = document.body.scrollHeight;
    w.innerHTML = html; w.hidden = wasHidden;
    return out;
  });
  console.log(`with a country mismatch ${exitHeights.withMismatch}px ` +
    `(a #warnings row would be ${exitHeights.withRow}px)`);
  ok(exitHeights.withMismatch === resting,
    `the exit-country warning costs no height (${exitHeights.withMismatch}px vs ${resting}px) — ` +
    `it replaces the timezone line, which is nowrap + ellipsis`);
  ok(exitHeights.withMismatch <= MAX,
    `and the popup still fits with the warning shown (${exitHeights.withMismatch}px, cap ${MAX})`);
  ok(exitHeights.restored === resting, 'restoring the timezone line restores the height');
  // Not an assertion about our feature — a measurement of the pre-existing box, kept so the
  // number in the comment above cannot quietly stop being true.
  console.log(`       (#warnings overflows the cap by ${exitHeights.withRow - MAX}px when it fires — ` +
    `pre-existing, untested before this line, and why the warning does not go there)`);

  // Both switches, through the popup's own code, against what the DOM shows.
  const read = () => popup.evaluate(() => ({
    host: document.getElementById('siteHost').textContent,
    rtcOn: document.getElementById('webrtcToggle').classList.contains('on'),
    rtcWarn: document.getElementById('webrtcLabel').classList.contains('warn'),
    swOn: document.getElementById('swToggle').classList.contains('on'),
    swWarn: document.getElementById('swLabel').classList.contains('warn')
  }));
  await popup.evaluate(async () => { await window.updateWebrtcToggle(); await window.updateSwToggle(); });
  const first = await read();
  console.log('fresh state           ' + JSON.stringify(first));
  ok(first.host === '127.0.0.1', `the card names the site once (${first.host})`);
  ok(first.rtcOn === true, 'WebRTC starts protected');
  ok(first.swOn === true, 'a service worker starts allowed');
  ok(first.rtcWarn === false && first.swWarn === false, 'nothing is amber on the defaults');

  await popup.evaluate(async () => { await window.handleSwToggle(); });
  await new Promise((r) => setTimeout(r, 1200));
  const blocked = await read();
  console.log('after blocking SW     ' + JSON.stringify(blocked));
  ok(blocked.swOn === false && blocked.swWarn === true,
    'blocking a service worker flips its switch and marks the label');
  ok(blocked.rtcOn === true && blocked.rtcWarn === false, 'and leaves the WebRTC row alone');
  const stored = await bg.evaluate(() => chrome.storage.local.get(['afp_sw_blocked']));
  ok(Array.isArray(stored.afp_sw_blocked) && stored.afp_sw_blocked.includes('127.0.0.1'),
    `the block reached storage (${JSON.stringify(stored.afp_sw_blocked)})`);

  await popup.evaluate(async () => { await window.handleWebrtcToggle(); });
  await new Promise((r) => setTimeout(r, 1200));
  const both = await read();
  console.log('after WebRTC off      ' + JSON.stringify(both));
  ok(both.rtcOn === false && both.rtcWarn === true, 'the WebRTC row flips independently');

  const after = await popup.evaluate(() => document.body.scrollHeight);
  ok(after <= MAX, `still fits after both switches moved (${after}px)`);

} finally {
  await ctx.close();
  server.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
