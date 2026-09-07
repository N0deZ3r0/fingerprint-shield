// TWO CHECKS A PAGE CAN RUN WITHOUT KNOWING ANYTHING ABOUT THIS MACHINE.
//
// Both come from the patched-Chromium series, where each was measured and closed:
//
// 1. WRITE-THEN-READ (patch 0027, "noise only the pixels a page cannot predict").
//    "Canvas noise is caught one way: write a known colour, read it back, compare.
//    CreepJS does exactly that over an 8x8 grid of random colours, and this build failed
//    it -- measured, 5 of 64 pixels came back with a channel off by one." A solid fill is
//    exactly predictable, so any difference is the noise admitting itself. No reference
//    machine needed, no corpus, one canvas.
//
// 2. COLLATION (patch 0017, door 2 of the language cluster). The browser sets the
//    renderer's ICU default locale "in RendererMain before the render thread exists,
//    because V8 caches the default locale in the isolate the first time Intl asks". An
//    extension has no such moment: mw/mw-timezone-screen.js wraps Intl.Collator so a
//    no-argument instance carries the profile locale, but String.prototype.localeCompare
//    is not wrapped anywhere and goes to ICU's default -- the host's. Estonian collation
//    is distinctive (z < z-caron < o-tilde < a-diaeresis), so the two APIs can be asked
//    the same question and compared against each other.
//
// Neither needs the user: clean browser beside patched one, same page, same code.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, loadBackground, loadPopup, bootSettled } from '../test/harness.mjs';

const { COUNTRY_DATA } = loadBackground(['COUNTRY_DATA']);
const { PROFILES } = loadPopup(['PROFILES']);
const SEL = { id: 'laptop_mid', cc: 'EE' };

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end('<!doctype html>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const READ = `(function () {
  var out = {};

  // ---- 1. write a known colour, read it back -----------------------------------
  // Deterministic colours, not random: two browsers have to write the same grid for the
  // comparison below to mean anything.
  var c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  var x = c.getContext('2d', { willReadFrequently: true });
  var want = [];
  for (var gy = 0; gy < 8; gy++) {
    for (var gx = 0; gx < 8; gx++) {
      var i = gy * 8 + gx;
      var col = [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256];
      want.push(col);
      x.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
      x.fillRect(gx * 8, gy * 8, 8, 8);
    }
  }
  var bad = 0, sample = null;
  for (var g = 0; g < 64; g++) {
    var px = (g % 8) * 8 + 4, py = ((g / 8) | 0) * 8 + 4;
    var d = x.getImageData(px, py, 1, 1).data;
    var w = want[g];
    if (d[0] !== w[0] || d[1] !== w[1] || d[2] !== w[2]) {
      bad++;
      if (!sample) sample = { at: g, want: w.join(','), got: d[0] + ',' + d[1] + ',' + d[2] };
    }
  }
  out.plainFill = { changed: bad, of: 64, sample: sample };

  // The same grid on a canvas that ALSO carries text — the case patch 0027 records as its
  // honest limit: a rect inside the text bounds is noised, one outside is not.
  var c2 = document.createElement('canvas');
  c2.width = 200; c2.height = 64;
  var x2 = c2.getContext('2d', { willReadFrequently: true });
  x2.font = '16px sans-serif';
  x2.fillStyle = '#123456';
  x2.fillText('afp predict probe', 4, 20);
  x2.fillStyle = 'rgb(10,200,30)';
  x2.fillRect(150, 40, 20, 20);          // away from the text
  var r2 = x2.getImageData(158, 48, 1, 1).data;
  out.rectBesideText = { want: '10,200,30', got: r2[0] + ',' + r2[1] + ',' + r2[2] };

  // putImageData is exactly predictable too.
  var c3 = document.createElement('canvas');
  c3.width = 8; c3.height = 8;
  var x3 = c3.getContext('2d', { willReadFrequently: true });
  var img = x3.createImageData(8, 8);
  for (var p = 0; p < img.data.length; p += 4) {
    img.data[p] = 17; img.data[p + 1] = 99; img.data[p + 2] = 200; img.data[p + 3] = 255;
  }
  x3.putImageData(img, 0, 0);
  var r3 = x3.getImageData(4, 4, 1, 1).data;
  out.putImageData = { want: '17,99,200', got: r3[0] + ',' + r3[1] + ',' + r3[2] };

  // ---- 2. does sorting agree with the language claimed? -------------------------
  var sgn = function (n) { return n < 0 ? -1 : (n > 0 ? 1 : 0); };
  var pairs = [['\\u00F5','z'], ['\\u00E4','z'], ['\\u00F6','z'], ['\\u00FC','z'], ['\\u017E','z']];
  out.lang = { claimed: null, dtf: null, navigator: null, rows: [] };
  try { out.lang.claimed = new Intl.Collator().resolvedOptions().locale; } catch (e) {}
  try { out.lang.dtf = new Intl.DateTimeFormat().resolvedOptions().locale; } catch (e) {}
  try { out.lang.navigator = navigator.language; } catch (e) {}
  for (var k = 0; k < pairs.length; k++) {
    var a = pairs[k][0], b = pairs[k][1];
    var row = { pair: a + '/' + b, string: null, collator: null, et: null, upper: null };
    try { row.string = sgn(a.localeCompare(b)); } catch (e) {}
    try { row.collator = sgn(new Intl.Collator().compare(a, b)); } catch (e) {}
    try { row.et = sgn(new Intl.Collator('et').compare(a, b)); } catch (e) {}
    out.lang.rows.push(row);
  }
  // The Turkish dotted-i probe reads the same default locale from a different door.
  try { out.lang.upperI = 'i'.toLocaleUpperCase(); } catch (e) {}
  try { out.lang.monthNames = new Date(2026, 0, 15).toLocaleString(undefined, { month: 'long' }); } catch (e) {}
  return out;
})()`;

async function read(withExt) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-pred-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: true,
    args: withExt ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  try {
    if (withExt) {
      const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await bootSettled(sw);
      const p = PROFILES.find((x) => x.id === SEL.id);
      const c = COUNTRY_DATA[SEL.cc];
      await sw.evaluate(async (d) => { await chrome.storage.local.set(d); }, {
        afp_profile_id: p.id,
        afp_profile_data: { screenW: p.screenW, screenH: p.screenH, cores: p.cores,
          memory: p.memory, gpu: p.gpuKey, platform: p.platform },
        afp_country_code: SEL.cc, afp_resolved_timezone: c.tz,
        afp_resolved_locale: c.loc, afp_mode: 'normal'
      });
      await new Promise((r) => setTimeout(r, 1500));
    }
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    if (withExt) await page.reload({ waitUntil: 'load' });
    return await page.evaluate(READ);
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
  }
}

const CLEAN = await read(false);
const OURS = await read(true);
server.close();

const show = (tag, o) => {
  console.log(`\n--- ${tag} ---`);
  console.log(`  1. write-then-read`);
  console.log(`     plain 8x8 grid       ${o.plainFill.changed} of ${o.plainFill.of} pixels changed` +
    (o.plainFill.sample ? `   e.g. #${o.plainFill.sample.at} wanted ${o.plainFill.sample.want}, got ${o.plainFill.sample.got}` : ''));
  console.log(`     rect beside text     wanted ${o.rectBesideText.want}, got ${o.rectBesideText.got}`);
  console.log(`     putImageData         wanted ${o.putImageData.want}, got ${o.putImageData.got}`);
  console.log(`  2. language`);
  console.log(`     navigator ${o.lang.navigator}   Collator ${o.lang.claimed}   DTF ${o.lang.dtf}` +
    `   'i'.toLocaleUpperCase ${o.lang.upperI}   month ${o.lang.monthNames}`);
  for (const r of o.lang.rows) {
    const flag = r.string === r.collator ? '' : '   <-- localeCompare and Intl.Collator DISAGREE';
    console.log(`     ${r.pair}   localeCompare ${String(r.string).padStart(2)}` +
      `   Collator() ${String(r.collator).padStart(2)}   Collator('et') ${String(r.et).padStart(2)}${flag}`);
  }
};
show('CLEAN', CLEAN);
show('OURS', OURS);

const dis = (o) => o.lang.rows.filter((r) => r.string !== r.collator).length;
console.log('\n=== what a page could conclude ===');
console.log(`  predictable pixels altered:  clean ${CLEAN.plainFill.changed}/64   ours ${OURS.plainFill.changed}/64`);
console.log(`  rect beside text intact:     clean ${CLEAN.rectBesideText.want === CLEAN.rectBesideText.got}` +
  `   ours ${OURS.rectBesideText.want === OURS.rectBesideText.got}`);
console.log(`  putImageData intact:         clean ${CLEAN.putImageData.want === CLEAN.putImageData.got}` +
  `   ours ${OURS.putImageData.want === OURS.putImageData.got}`);
console.log(`  sort disagrees with claim:   clean ${dis(CLEAN)}/5   ours ${dis(OURS)}/5`);
