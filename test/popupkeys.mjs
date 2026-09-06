/**
 * Can the popup be operated without a mouse, and does it say what its controls are doing?
 *
 *   node test/popupkeys.mjs [--headed]
 *
 * Nothing asked this before, and the answer was no. Measured on a loaded popup:
 *
 *   country list        67 rows, 0 reachable from a keyboard
 *   machine list         7 rows, 0 reachable from a keyboard
 *   the three switches  role="switch", aria-checked null on all three
 *   the two modes       role="tab" with no tabpanel, aria-selected null on both
 *   #countryBtn         aria-expanded frozen at "false" with the list open
 *
 * The rows are <div>s with role="option" and no tabindex, so Tab stepped from the button
 * straight over the whole list; arrows did nothing, Enter did nothing, Escape did not close.
 * Picking a country or a machine required a mouse, in a window where every other control is
 * a real button. And role="switch" is a promise to report a state: three switches made it
 * and none of them kept it, so a screen reader announced "WebRTC, switch" and stopped.
 *
 * TWO KINDS OF ASSERTION HERE, and the split matters. The ARIA half compares an attribute
 * against the class beside it — cheap, and it catches the drift that happens when a state is
 * written in eight places. The KEYBOARD half drives the real popup and asks whether the
 * VALUE changed, never whether a class moved: a cursor that highlights the right row and
 * selects nothing is the failure this suite exists to catch, and it looks identical to
 * success in the DOM.
 *
 * The last section is the negative control, and it is here because assertions about classes
 * would pass against a build with no keyboard layer at all — classes move on their own.
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

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    .end('<!doctype html><title>site</title>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const dir = mkdtempSync(join(tmpdir(), 'afp-popupkeys-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
try {
  const bg = ctx.serviceWorkers().find((w) => w.url().includes('background.js')) ||
    await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 3000));
  const id = new URL(bg.url()).host;

  // A site has to be the active tab: without one the per-site card is swapped out for the
  // note, and half of what this file drives is not on screen.
  const site = await ctx.newPage();
  await site.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 360, height: 700 });
  await p.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load' });
  await site.bringToFront();
  await p.reload({ waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1800));

  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const active = () => p.evaluate(() =>
    document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none');
  const codeNow = () => p.evaluate(() => document.getElementById('countryCode').textContent);
  const nameNow = () => p.evaluate(() => document.getElementById('profileName').textContent);

  // ── 1) the switches say which way they point ─────────────────────────────────
  console.log('== 1) role="switch" and aria-checked');
  const sw = await p.evaluate(() => ['webrtcToggle', 'swToggle', 'cspToggle'].map((i) => {
    const e = document.getElementById(i);
    return {
      id: i, role: e.getAttribute('role'), checked: e.getAttribute('aria-checked'),
      cls: e.classList.contains('on'), disabled: e.disabled
    };
  }));
  for (const s of sw) {
    console.log(`   ${s.id.padEnd(14)} role=${s.role} aria-checked=${s.checked} class-on=${s.cls}`);
    ok(s.role === 'switch', `${s.id} is a switch (${s.role})`);
    ok(s.checked === String(s.cls),
      `${s.id} reports its state: aria-checked=${s.checked} beside class-on=${s.cls}`);
  }

  // The attribute has to FOLLOW the switch, not merely exist. Driven through the popup's
  // own handler, which is where the eight separate writers used to live.
  const before = sw[1].cls;
  await p.evaluate(async () => { await window.handleSwToggle(); });
  await settle(1200);
  const after = await p.evaluate(() => {
    const e = document.getElementById('swToggle');
    return { checked: e.getAttribute('aria-checked'), cls: e.classList.contains('on') };
  });
  console.log(`   after a real toggle: class-on ${before} -> ${after.cls}, aria-checked=${after.checked}`);
  ok(after.cls !== before, 'the toggle actually flipped the switch (otherwise the next line proves nothing)');
  ok(after.checked === String(after.cls), 'and aria-checked followed it through the popup own handler');
  await p.evaluate(async () => { await window.handleSwToggle(); });
  await settle(1200);

  // ── 2) the mode pair is a radio group ────────────────────────────────────────
  console.log('\n== 2) the two modes');
  const modes = await p.evaluate(() => [...document.querySelectorAll('#modeGrid .mode')].map((e) => ({
    mode: e.dataset.mode, role: e.getAttribute('role'), checked: e.getAttribute('aria-checked'),
    cls: e.classList.contains('active')
  })));
  const groupRole = await p.getAttribute('#modeGrid', 'role');
  console.log(`   #modeGrid role=${groupRole}; ` + modes.map((m) => `${m.mode}=${m.checked}/${m.role}`).join(' '));
  ok(groupRole === 'radiogroup', `the group is a radiogroup, not a tablist without panels (${groupRole})`);
  for (const m of modes) {
    ok(m.role === 'radio', `${m.mode} is a radio (${m.role})`);
    ok(m.checked === String(m.cls), `${m.mode} reports its state (aria-checked=${m.checked}, class ${m.cls})`);
  }
  // A radiogroup is expected to move between its radios with the arrows.
  await p.focus('#modeGrid .mode');
  await p.keyboard.press('ArrowRight');
  await settle(600);
  const afterArrow = await p.evaluate(() => ({
    checked: [...document.querySelectorAll('#modeGrid .mode')].map((e) => e.getAttribute('aria-checked')).join(','),
    badge: document.getElementById('tabBadge').textContent
  }));
  console.log(`   ArrowRight -> aria-checked ${afterArrow.checked}, badge "${afterArrow.badge}"`);
  ok(afterArrow.checked === 'false,true', `the arrow moved the choice (${afterArrow.checked})`);
  ok(/Скрыт/.test(afterArrow.badge), `and the mode really changed, not only the attribute (${afterArrow.badge})`);
  await p.keyboard.press('ArrowLeft');
  await settle(600);

  // ── 3) the country list, by keyboard only ────────────────────────────────────
  console.log('\n== 3) the country list without a mouse');
  const rows = await p.evaluate(() => document.querySelectorAll('#optionList .option').length);
  await p.focus('#countryBtn');
  await p.keyboard.press('ArrowDown');
  await settle();
  const opened = await p.evaluate(() => ({
    open: document.getElementById('countrySelect').classList.contains('open'),
    expanded: document.getElementById('countryBtn').getAttribute('aria-expanded'),
    desc: document.getElementById('searchInput').getAttribute('aria-activedescendant')
  }));
  console.log(`   ${rows} rows; ArrowDown -> open=${opened.open} aria-expanded=${opened.expanded} cursor=${opened.desc}`);
  ok(opened.open === true, 'ArrowDown on the closed button opens the list');
  ok(opened.expanded === 'true',
    `and the button says so — this attribute was frozen at "false" while the list was open (${opened.expanded})`);
  ok(!!opened.desc,
    'the cursor is named to a screen reader through aria-activedescendant, which is the only ' +
    'channel it has: focus stays in the search input so typing keeps working');
  // The cursor starts on the current choice, not at the top: the selected row can be 200 down.
  ok(/-US$/.test(opened.desc || ''), `and it starts on the selected row (${opened.desc})`);

  const startCode = await codeNow();
  await p.keyboard.press('ArrowDown');
  const movedTo = await p.evaluate(() => (document.querySelector('#optionList .option.active') || {}).id);
  // MOVING IS NOT PICKING. If arrowing selected as it went, every assertion below would
  // pass for the wrong reason.
  ok(await codeNow() === startCode,
    'moving the cursor does not select — the value only changes on Enter');
  await p.keyboard.press('Enter');
  await settle(400);
  const picked = await codeNow();
  console.log(`   cursor ${movedTo} + Enter -> ${startCode} -> ${picked}, focus on ${await active()}`);
  ok(picked !== startCode, `Enter selects the row under the cursor (${startCode} -> ${picked})`);
  ok(await p.evaluate(() => !document.getElementById('countrySelect').classList.contains('open')),
    'and the list closes behind it');
  ok(await active() === 'countryBtn',
    'focus comes back to the button that opened it — it used to land on the body, so the next ' +
    'key press reached nothing at all');

  // Typing filters, and Enter has to take the filtered row. This is the path that broke
  // first: the list is rebuilt on every keystroke, and the cursor went with it.
  await p.keyboard.press('ArrowDown');
  await settle();
  await p.keyboard.type('japa');
  await settle(400);
  const filtered = await p.evaluate(() => ({
    rows: document.querySelectorAll('#optionList .option').length,
    cursor: (document.querySelector('#optionList .option.active') || {}).id
  }));
  ok(filtered.rows >= 1 && !!filtered.cursor,
    `the cursor is re-placed after the list is rebuilt by typing (${filtered.rows} rows, cursor ${filtered.cursor})`);
  await p.keyboard.press('Enter');
  await settle(400);
  const jp = await p.evaluate(() => ({
    code: document.getElementById('countryCode').textContent,
    tz: document.getElementById('countryTz').textContent
  }));
  console.log(`   typed "japa" -> ${filtered.rows} row(s), Enter -> ${jp.code} / ${jp.tz}`);
  ok(jp.code === 'JP', `Enter takes the typed row (${jp.code})`);
  ok(jp.tz === 'Asia/Tokyo', `and the timezone under the name follows it (${jp.tz})`);

  await p.keyboard.press('ArrowDown');
  await settle();
  await p.keyboard.press('Escape');
  await settle();
  console.log(`   Escape -> closed, focus on ${await active()}`);
  ok(await p.evaluate(() => !document.getElementById('countrySelect').classList.contains('open')),
    'Escape closes the list');
  ok(await p.getAttribute('#countryBtn', 'aria-expanded') === 'false', 'and the button says so');
  ok(await active() === 'countryBtn', 'and focus is back on the button');

  // ── 4) the machine list, which has no search input ───────────────────────────
  console.log('\n== 4) the machine list');
  await p.focus('#profileBtn');
  await p.keyboard.press('ArrowDown');
  await settle();
  const pOpen = await p.evaluate(() => ({
    open: document.getElementById('profileSelect').classList.contains('open'),
    focus: document.activeElement.id,
    desc: document.getElementById('profileList').getAttribute('aria-activedescendant')
  }));
  console.log(`   open=${pOpen.open}, focus on ${pOpen.focus}, cursor ${pOpen.desc}`);
  ok(pOpen.open === true, 'ArrowDown opens it');
  ok(pOpen.focus === 'profileList',
    `focus moves into the list itself, because there is no input to hold it (${pOpen.focus})`);
  ok(!!pOpen.desc, 'and the cursor is named through aria-activedescendant');
  const startName = await nameNow();
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  await settle(400);
  const endName = await nameNow();
  console.log(`   End + Enter -> ${startName} -> ${endName}, focus on ${await active()}`);
  ok(endName !== startName, `End jumps to the last row and Enter takes it (${startName} -> ${endName})`);
  ok(await active() === 'profileBtn', 'focus returns to the button');
  await p.keyboard.press('ArrowDown');
  await settle();
  await p.keyboard.press('Home');
  await p.keyboard.press('Enter');
  await settle(400);
  const homeName = await nameNow();
  ok(homeName !== endName, `Home jumps back to the first (${homeName})`);

  // ── 5) the host is named once ────────────────────────────────────────────────
  console.log('\n== 5) the host, printed once');
  const hostHits = await p.evaluate(() => {
    const host = document.getElementById('tabHost').textContent.trim();
    const hits = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el.children.length) return;              // leaves only, or every ancestor counts
      if ((el.textContent || '').includes(host)) hits.push(el.id || el.className || el.tagName);
    });
    return { host, hits };
  });
  console.log(`   "${hostHits.host}" appears in: ${hostHits.hits.join(', ') || 'nothing'}`);
  ok(hostHits.hits.length === 1,
    `the current site is named exactly once (${hostHits.hits.length}: ${hostHits.hits.join(', ')}) — ` +
    'it used to lead the per-site line as well, which is what ellipsised that line notes');

  // ── 6) negative control ──────────────────────────────────────────────────────
  // Everything above would also pass against a popup with no keyboard layer if the
  // assertions were about classes. They are about values, but that is a claim, so it gets
  // checked: with the handler removed the same keys must stop working.
  console.log('\n== 6) negative control: the same keys against a popup with the layer torn out');
  await p.evaluate(() => {
    // Replacing the node drops every listener bound to it, which is the whole layer for
    // this picker — wireListbox binds one handler on the container.
    const sel = document.getElementById('countrySelect');
    sel.replaceWith(sel.cloneNode(true));
  });
  await p.evaluate(() => { document.getElementById('countryBtn').focus(); });
  const codeBefore = await codeNow();
  await p.keyboard.press('ArrowDown');
  await settle();
  const deadOpen = await p.evaluate(() =>
    document.getElementById('countrySelect').classList.contains('open'));
  await p.keyboard.press('Enter');
  await settle(300);
  console.log(`   with the listener gone: ArrowDown opened=${deadOpen}, value ${codeBefore} -> ${await codeNow()}`);
  ok(deadOpen === false, 'without the handler the list does not open — so section 3 was measuring the handler');
  ok(await codeNow() === codeBefore, 'and nothing is selected, so those assertions can fail');
} finally {
  await ctx.close();
  server.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
