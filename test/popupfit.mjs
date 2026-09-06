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
import { BROWSER, root, uiMessages, langArgs, bootSettled } from './harness.mjs';
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
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, ...langArgs()]
});
try {
  const bg = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
    await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(ctx);
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

  // What the popup SAYS depends on the browser's language, and this file used to compare
  // against Russian literals — green on a Russian machine, red on an English CI runner, and
  // in neither case about the popup. The expectations come from the catalogue the page
  // itself just rendered from.
  const M = uiMessages(await popup.evaluate(() => chrome.i18n.getUILanguage()));
  // The longest status the popup can produce, and the longest exit-country warning: both
  // are height inputs, so both have to be the ones this language actually shows.
  const LONGEST = M('popupSwBlocked') + M('popupPressF5');
  const MISMATCH = M('popupExitMismatch').replace('$1', 'United States of America');

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

  const msgGeo = await popup.evaluate((LONGEST) => {
    // The longest message the popup can actually produce, now that the hostname is not
    // repeated into it.
    window.showStatus(LONGEST, 'ok', 60000);
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
  }, LONGEST);
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

  // [FIX the-warning-ate-the-timezone] EVERY REACHABLE HEIGHT, not the resting one.
  //
  // The exit-country mismatch used to be written OVER the timezone, and the justification
  // was arithmetic printed by this very file: the popup rested at 590 against the 600 cap,
  // so a row did not fit. The arithmetic moved and nobody re-read it — the line below had
  // been printing "overflows the cap by -11px" for a while, which is the refutation, on
  // every run. So the number is not left as a printed aside any more: the tallest state the
  // popup can reach is measured and asserted.
  //
  // Two states move it, and they move it in opposite directions:
  //   + the warning row, which is what the redesign spends
  //   − no http tab, where the per-site card is swapped out for the note (84px shorter)
  const exitHeights = await popup.evaluate(async (MISMATCH) => {
    const out = {};
    const w = document.getElementById('countryWarn');
    const hadHidden = w.hidden, before = w.textContent;
    // The longest realistic form: a country name we do not offer, so exitName falls back.
    w.textContent = MISMATCH;
    w.hidden = false;
    out.withMismatch = document.body.scrollHeight;
    out.clipped = w.scrollWidth > w.clientWidth + 1;
    w.hidden = true;
    out.quiet = document.body.scrollHeight;
    // The state that used to be the tallest of all, driven through the popup's own code.
    await window.updateTabInfo(null);
    out.noTab = document.body.scrollHeight;
    out.cardHidden = document.getElementById('siteCard').hidden;
    out.noteShown = !document.getElementById('emptyState').hidden;
    w.hidden = false;
    out.noTabWithMismatch = document.body.scrollHeight;
    w.textContent = before; w.hidden = hadHidden;
    return out;
  }, MISMATCH);
  console.log(`heights: quiet ${exitHeights.quiet}px, mismatch ${exitHeights.withMismatch}px, ` +
    `no tab ${exitHeights.noTab}px, no tab + mismatch ${exitHeights.noTabWithMismatch}px (cap ${MAX})`);
  ok(exitHeights.withMismatch > exitHeights.quiet,
    `the warning costs a row instead of deleting the timezone (${exitHeights.withMismatch} vs ${exitHeights.quiet})`);
  ok(exitHeights.cardHidden && exitHeights.noteShown,
    'with no http tab the per-site card is swapped out for the note, rather than sitting there disabled');
  // The assertion the printed aside should have been all along.
  const tallest = Math.max(exitHeights.quiet, exitHeights.withMismatch,
    exitHeights.noTab, exitHeights.noTabWithMismatch);
  ok(tallest <= MAX, `the TALLEST reachable state fits (${tallest}px, cap ${MAX})`);
  // A row that could wrap would make the number above meaningless on a narrower name.
  const nowrapWarn = await popup.evaluate(() =>
    getComputedStyle(document.getElementById('countryWarn')).whiteSpace === 'nowrap');
  ok(nowrapWarn, 'and the warning row is nowrap, so a long country name cannot grow it');
  await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
    await window.updateTabInfo(tab);
  });
  await new Promise((r) => setTimeout(r, 300));

  // [FIX the-popup-never-said-the-screen-claim-was-dropped] mw-core's _screenAtLeastNative
  // reports the MACHINE's screen whole whenever the claimed pair does not contain it, so on
  // an ordinary 1080p host most rows substitute nothing on that axis — and the popup said so
  // nowhere. The chip is asserted against the SAME arithmetic, read off the popup's own
  // `screen`, so this cannot pass by both sides being wrong the same way: the rule is
  // recomputed here from the row and the machine, not copied from the code that renders it.
  //
  // It rides in the button/option row rather than #warnings for the reason measured right
  // above — a #warnings row does not fit — so the height is asserted too.
  // THE RIG CANNOT SUPPLY THE INTERESTING CASE. Playwright's setViewportSize emulates the
  // device metrics, so `screen` in this popup reads 400×551 — smaller than every row, so
  // every claim holds and the chip never fires. Asserted against that alone the block would
  // be green on a build that never renders a chip at all. The machine is therefore stubbed
  // to a known 1920×1080 for the real assertion, and the rig's own screen is read first
  // only as a consistency check.
  const chipsFor = (mw, mh, select) => popup.evaluate(({ mw, mh, select }) => {
    const S = Object.getPrototypeOf(screen);
    const dw = Object.getOwnPropertyDescriptor(S, 'width');
    const dh = Object.getOwnPropertyDescriptor(S, 'height');
    const wasSelected = selectedProfileId;
    try {
      if (mw) {
        Object.defineProperty(S, 'width', { configurable: true, get: () => mw });
        Object.defineProperty(S, 'height', { configurable: true, get: () => mh });
      }
      if (select) selectedProfileId = select;
      renderProfiles();
      const s = { w: screen.width | 0, h: screen.height | 0 };
      const rows = [...document.querySelectorAll('#profileList .option')].map((el) => {
        const p = (typeof PROFILES !== 'undefined' ? PROFILES : []).find((x) => x.id === el.dataset.id) || {};
        const tag = el.querySelector('.tag');
        return {
          id: el.dataset.id,
          claim: p.host ? 'host' : `${p.screenW}×${p.screenH}`,
          // The rule, recomputed: both dimensions or neither, as mw-core has it.
          holds: p.host ? true : ((p.screenW | 0) >= s.w && (p.screenH | 0) >= s.h),
          chip: tag ? tag.textContent : '',
          titled: !!(tag && tag.title)
        };
      });
      const btnTag = document.getElementById('profileScreenTag');
      return {
        s, rows, height: document.body.scrollHeight, selected: selectedProfileId,
        btnHidden: !btnTag || btnTag.hidden, btnTitled: !!(btnTag && btnTag.title)
      };
    } finally {
      if (mw) { Object.defineProperty(S, 'width', dw); Object.defineProperty(S, 'height', dh); }
      selectedProfileId = wasSelected;
      renderProfiles();
    }
  }, { mw, mh, select });

  const chips = await chipsFor(0, 0, '');
  const show = (c, label) => {
    console.log(`screen chips          ${label}: machine ${c.s.w}×${c.s.h}`);
    for (const r of c.rows) {
      console.log(`  ${r.id.padEnd(11)} claims ${r.claim.padEnd(10)} ${r.holds ? 'holds' : 'DROPPED'}` +
        (r.chip ? `  chip "${r.chip}"` : ''));
    }
  };
  const agrees = (c) => {
    for (const r of c.rows) {
      if (r.id === 'host') {
        ok(r.chip === M('popupTagHost'), `the host row keeps its own chip (${r.chip})`);
        continue;
      }
      ok((r.chip === M('popupTagHostScreen')) === !r.holds,
        `${r.id} claims ${r.claim} on a ${c.s.w}×${c.s.h} machine — ` +
        `${r.holds ? 'the claim holds, so no chip' : 'the claim is dropped, so the chip is there'}` +
        ` (chip: "${r.chip}")`);
      if (!r.holds) ok(r.titled, `${r.id}'s chip carries the explanation on its title`);
    }
  };
  show(chips, 'as the rig reports it');
  ok(chips.rows.length > 0, `the picker rendered its rows (${chips.rows.length})`);
  agrees(chips);

  // The real case: a 1920×1080 machine, which is the single largest bucket there is, and
  // laptop_low / laptop_125 / laptop_150 sitting under it. The selected row is one of them,
  // so the button chip is exercised in its VISIBLE state — on the rig's own screen it never
  // is.
  const small = await chipsFor(1920, 1080, 'laptop_low');
  show(small, 'stubbed 1920×1080');
  agrees(small);
  const DROPPED = ['laptop_low', 'laptop_125', 'laptop_150'];
  const HOLDS = ['laptop_mid', 'pc_gaming', 'pc_power'];
  for (const id of DROPPED) {
    const r = small.rows.find((x) => x.id === id);
    ok(r && r.chip === M('popupTagHostScreen'),
      `on a 1920×1080 machine ${id} (${r && r.claim}) is marked — its screen is never substituted`);
  }
  for (const id of HOLDS) {
    const r = small.rows.find((x) => x.id === id);
    ok(r && r.chip === '',
      `and ${id} (${r && r.claim}) is not marked — it contains the machine`);
  }
  ok(small.btnHidden === false, 'the selected row repeats the chip in the button');
  ok(small.btnTitled, 'and the button chip carries the explanation on its title');
  ok(small.height === resting,
    `the chip costs no height (${small.height}px vs ${resting}px) — it rides in the row, not in #warnings`);

  // [FIX the-popup-never-said-the-site-had-stood-down] Driven end to end through the real
  // popup code: the note is set by showStandDown(), which reads `window.__t0.sd` out of the
  // ACTIVE TAB with chrome.scripting — the same boolean mw-core froze — so this exercises
  // the read path and not a string. Both directions are asserted, because a note that never
  // clears is as wrong as one that never shows.
  const standDown = async (on) => {
    await site.evaluate((v) => {
      try {
        if (!window.__t0 || typeof window.__t0 !== 'object') window.__t0 = {};
        window.__t0.sd = v;
      } catch (e) { /* the marker is non-configurable in some builds */ }
    }, on);
    await popup.evaluate(async () => { await window.updateWebrtcToggle(); });
    // showStandDown is async and runs after updateWebrtcToggle returns.
    await new Promise((r) => setTimeout(r, 400));
    return popup.evaluate(() => {
      const el = document.getElementById('siteHost');
      return {
        text: el.textContent, warn: el.classList.contains('warn'), title: el.title,
        height: document.body.scrollHeight,
        clipped: el.scrollWidth > el.clientWidth + 1,
        nowrap: getComputedStyle(el).whiteSpace === 'nowrap'
      };
    });
  };
  // [FIX the-stand-down-note-erased-the-webrtc-one] The two notes that share this one line
  // are decided by two different reads, so the axes have to be crossed rather than driven
  // one at a time: with only the stand-down axis moved, the cell that regressed — the global
  // WebRTC switch off AND the site standing down — was never entered, and the suite stayed
  // green while showStandDown() wrote the line whole and dropped the other note.
  //
  // The global switch is the options page's, so it is set where the options page sets it:
  // afp_features in chrome.storage.local, read back by background.js's getWebrtcStatus. It
  // is restored at the end of the block, because everything below assumes the default.
  const webrtcGlobal = async (on) => {
    await popup.evaluate(async (on) => {
      const st = await chrome.storage.local.get(['afp_features']);
      await chrome.storage.local.set({ afp_features: { ...(st.afp_features || {}), webrtc: on } });
    }, on);
    await new Promise((r) => setTimeout(r, 150));
  };
  const cell = async (webrtcOn, sd) => { await webrtcGlobal(webrtcOn); return standDown(sd); };

  const sdOn = await cell(true, true);
  const sdOff = await cell(true, false);
  const offSd = await cell(false, true);    // the cell that lost the WebRTC note
  const offOnly = await cell(false, false);
  await webrtcGlobal(true);
  console.log(`stand-down note       "${sdOn.text}" (${sdOn.height}px), off: "${sdOff.text}"`);
  console.log(`with WebRTC off       "${offSd.text}" (${offSd.height}px, clipped ${offSd.clipped}),` +
    ` stand-down off: "${offOnly.text}"`);
  ok(sdOn.text.endsWith(M('popupNoteStandDown')),
    `the site line says the machine is not substituted here (${sdOn.text})`);
  ok(sdOn.warn, 'and it is amber, like the exit-country disagreement');
  ok(!!sdOn.title, 'and the full explanation is on the title attribute');
  ok(sdOn.height === resting,
    `it costs no height (${sdOn.height}px vs ${resting}px) — it rides in the hostname line`);
  ok(sdOn.nowrap && !sdOn.clipped,
    `and that line is nowrap, so a longer note cannot wrap the popup taller (clipped ${sdOn.clipped})`);
  ok(!sdOff.text.includes(M('popupNoteStandDown')) && !sdOff.warn && sdOff.title === '',
    `the note, the amber and the title all clear when the site is not standing down (${sdOff.text})`);

  // The other three cells of the same pair. The WebRTC note on its own is the state
  // [FIX the-off-state-was-invisible] exists for, and it was being erased on exactly the
  // sites where stand-down is common (github, youtube).
  const RTC = M('popupNoteWebrtcOff'), SD = M('popupNoteStandDown');
  ok(offOnly.text.includes(RTC) && !offOnly.text.includes(SD) && !offOnly.warn,
    `WebRTC off alone names the setting and nothing else (${offOnly.text})`);
  ok(offOnly.title === '', `and carries no title — the line has room for it (${offOnly.title})`);
  ok(offSd.text.includes(RTC) && offSd.text.includes(SD),
    `both notes survive together (${offSd.text})`);
  // Order is load-bearing, not cosmetic: the line ellipsises from the tail, and the
  // stand-down half is the one with a title to be recovered from.
  ok(offSd.text.indexOf(RTC) >= 0 && offSd.text.indexOf(RTC) < offSd.text.indexOf(SD),
    `and the WebRTC note is the visible prefix, since the tail is what the ellipsis cuts (${offSd.text})`);
  ok(offSd.warn, 'the line is still amber for the stand-down half');
  ok(offSd.title.includes(RTC) && offSd.title.includes(SD),
    'and the title leads with the whole line, so the ellipsised half stays readable');
  ok(offSd.nowrap,
    `the line is still nowrap with both notes on it (clipped ${offSd.clipped}) — it cannot wrap the popup taller`);
  // [FIX the-host-was-printed-twice] Newly assertable. The title has always been the fallback
  // for the cut half, but a fallback is not a readout: with the hostname leading the line,
  // this exact pair — the state the WebRTC note exists to communicate — was ellipsised on
  // screen every time. The hero names the host now, and the notes have the whole width.
  ok(!offSd.clipped,
    `and both notes FIT on it rather than relying on the title (clipped ${offSd.clipped})`);
  ok(offSd.height === resting,
    `and the pair costs no height (${offSd.height}px vs ${resting}px), which is what keeps it under the ${MAX}px cap`);

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
  // [FIX the-host-was-printed-twice] This used to assert the card's line WAS the hostname,
  // which is how the popup ended up printing it twice — the hero shows it too, and with both
  // per-site notes appended the line ran past the card and was ellipsised. The invariant the
  // assertion was reaching for is the one asserted now: the site is named exactly once in the
  // whole window. That is checked properly in test/popupkeys.mjs, over every leaf node; here
  // it is enough that this line is no longer one of the two.
  ok(!first.host.includes('127.0.0.1'),
    `the per-site line no longer repeats the hostname the hero already shows (${first.host})`);
  ok(first.host === M('popupSiteScope'), `it says what the card decides instead (${first.host})`);
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
