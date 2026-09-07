// DO THE THREE DOORS THAT ANSWER "IS THIS FONT INSTALLED" AGREE WITH EACH OTHER?
//
// From the patched-Chromium series, patch 0058: "the allowlist hid what Windows ships, and
// its two doors disagreed" — three doors (measureText, and the rest) gave different answers
// about the same family, which is a contradiction a page can find on its own with no
// reference machine.
//
// This extension has the same three:
//   1. canvas measureText   — mw/mw-canvas-audio.js normalises a family outside the
//                             allowlist onto the generic fallback, so a hidden font
//                             measures exactly as sans-serif does
//   2. document.fonts.check — mw/mw-misc.js
//   3. FontFace + local()   — mw/mw-misc.js
//
// A font that is really installed and really hidden must read HIDDEN through all three. If
// one of them still says "installed", the allowlist is decorative and the page has caught it.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, bootSettled } from '../test/harness.mjs';

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end('<!doctype html>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// Families a stock Windows/Office install has that are NOT in the extension's allowlist,
// plus controls: one the allowlist keeps, and one that exists nowhere.
const NAMES = ['Agency FB', 'Century Gothic', 'MT Extra', 'Arial', 'Nonexistent Family ZZQQ'];

const READ = `(function (names) {
  var c = document.createElement('canvas');
  var x = c.getContext('2d');
  function width(family) {
    x.font = '48px "' + family + '", monospace';
    return Math.round(x.measureText('mmmmmwwwwwiiiii0123').width * 100) / 100;
  }
  var mono = width('___no_such_family___');
  var out = [];
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    var row = { name: n, width: width(n), mono: mono, check: null, local: null };
    row.byWidth = row.width !== mono;                 // door 1: it renders differently
    try { row.check = document.fonts.check('48px "' + n + '"'); } catch (e) { row.check = 'THREW'; }
    out.push(row);
  }
  return { rows: out, mono: mono };
})(${JSON.stringify(NAMES)})`;

// FontFace + local() has to be awaited, so it runs as its own step.
const LOCAL = `(async function (names) {
  var out = {};
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    try {
      var f = new FontFace('probe' + i, 'local("' + n + '")');
      await f.load();
      out[n] = { loaded: true, status: f.status };
    } catch (e) {
      var st = null, ld = null;
      try { st = f.status; } catch (e2) {}
      // The loaded promise must be rejected too, and with the same error: a refusal that
      // leaves it pending forever is the same tell one room over.
      try { ld = await f.loaded.then(function () { return 'RESOLVED'; },
        function (x) { return 'rejected:' + (x && x.name); }); } catch (e3) { ld = 'threw'; }
      // The SHAPE of the refusal, not just the fact of it: a hidden font has to be
      // refused exactly the way a missing one is, or the difference is the tell.
      out[n] = {
        loaded: false, status: st, loadedProp: ld,
        name: e && e.name, ctor: e && e.constructor && e.constructor.name,
        code: e && e.code, message: e && e.message,
        isDOMException: (typeof DOMException !== 'undefined') && (e instanceof DOMException)
      };
    }
  }
  return out;
})(${JSON.stringify(NAMES)})`;

async function read(withExt) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-fd-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: true,
    args: withExt ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  try {
    if (withExt) {
      ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await bootSettled(ctx);
    }
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    const base = await page.evaluate(READ);
    const local = await page.evaluate(LOCAL);
    for (const r of base.rows) { r.localRaw = local[r.name]; r.local = !!(local[r.name] && local[r.name].loaded); }
    return base;
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
  }
}

const CLEAN = await read(false);
const OURS = await read(true);
server.close();

const show = (tag, o) => {
  console.log(`\n--- ${tag} ---   (generic fallback width ${o.mono})`);
  for (const r of o.rows) {
    const doors = [r.byWidth, r.check, r.local];
    const yes = doors.filter((d) => d === true).length;
    const split = yes !== 0 && yes !== 3;
    console.log(`  ${r.name.padEnd(24)} width ${String(r.width).padStart(8)}` +
      `   measureText ${String(r.byWidth).padEnd(5)}` +
      `   fonts.check ${String(r.check).padEnd(5)}` +
      `   local() ${String(r.local).padEnd(5)}` +
      (split ? '   <-- THE DOORS DISAGREE' : ''));
    if (r.localRaw && !r.localRaw.loaded) {
      console.log(`  ${''.padEnd(24)}   refused as: ${r.localRaw.ctor}/${r.localRaw.name} code ${r.localRaw.code}` +
        `  DOMException ${r.localRaw.isDOMException}  "${r.localRaw.message}"` +
        `  status ${r.localRaw.status}  loaded ${r.localRaw.loadedProp}`);
    }
  }
};
show('CLEAN', CLEAN);
show('OURS', OURS);

// [FIX the-verdict-counted-a-browser-behaviour-as-a-defect] The first version counted any
// family whose three doors did not all agree, and called the fixed build REFUTABLE — but
// document.fonts.check answers TRUE for a family that exists nowhere, in a clean browser
// too, because check() asks whether the font can be USED and a missing one falls back. So
// "the doors disagree" is the normal shape for an absent family, not a defect.
//
// The question that means something: does a family we HIDE present the same three answers
// as a family the clean browser genuinely does not have? If it does, the page cannot tell
// "hidden by an extension" from "not installed", which is the whole point.
const triple = (r) => [r.byWidth, r.check, r.local].join('/');
const ABSENT = triple(CLEAN.rows[CLEAN.rows.length - 1]);   // the nonexistent family, clean
console.log('');
console.log(`what a clean browser shows for a family it does not have:  ${ABSENT}`);

let wrong = 0;
for (const r of OURS.rows) {
  const cleanRow = CLEAN.rows.find((c) => c.name === r.name);
  const hidden = !r.byWidth;                       // the allowlist hides it from measureText
  const want = hidden ? ABSENT : triple(cleanRow);  // else it must read exactly as clean does
  const got = triple(r);
  const ok = got === want;
  if (!ok) wrong++;
  console.log(`  ${r.name.padEnd(24)} ${hidden ? 'hidden ' : 'allowed'}   want ${want.padEnd(18)} got ${got.padEnd(18)} ${ok ? 'ok' : 'MISMATCH'}`);
}
console.log('');
console.log(wrong === 0
  ? 'every door tells the same story: a hidden font is indistinguishable from an absent one'
  : `${wrong} family/families where a door still admits what the others hide`);
process.exit(wrong ? 1 : 0);
