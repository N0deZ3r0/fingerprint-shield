/**
 * DOES THE SPOOFED KEYBOARD LAYOUT LOOK LIKE A REAL ONE?
 *
 *   node test/kblayout.mjs
 *
 * `navigator.keyboard.getLayoutMap()` is a per-machine fingerprint, and this extension
 * answers it with a US QWERTY so that every user shares one cohort instead of carrying their
 * own. The map it used to answer with was written out by hand, and measured against a real
 * Chrome it was wrong in two places: it carried `Space`, which a real map does not, and
 * lacked `IntlBackslash`, which a real map has.
 *
 * The consequence was not a smaller cohort but a signature. Fingerprint Pro reported
 * `keyboard_layout_name: "en-US"` beside a `keyboard_layout_hash` that was ours, and called
 * the browser BrowserAutomationStudio with `anti_detect_browser: true` and tampering 0.96 —
 * while the same machine with the extension off parsed as clean Chrome 152. Bisected on live
 * events with the thirteen option switches: all off is clean, WebGL alone is clean, the
 * navigator module alone reproduces the entire verdict.
 *
 * A layout that CLASSIFIES as en-US and HASHES to a value no en-US keyboard produces is
 * exactly what such a detector looks for. So the key set now comes from the browser's own
 * map and only the values are made US — and a machine already on US gets its native map back
 * untouched.
 *
 * The assertion is against a clean browser launched beside this one, never against a list
 * written here: a hard-coded key set is how the first version got it wrong.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BROWSER, root, bootSettled } from './harness.mjs';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

// navigator.keyboard needs a secure context, and loopback is one — about:blank is not, which
// is how the first run of this probe reported "no navigator.keyboard in this browser".
const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end('<!doctype html>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

async function layout(withExt) {
  const dir = mkdtempSync(path.join(tmpdir(), 'afp-kb-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: true,
    args: withExt ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  try {
    if (withExt) {
      ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await bootSettled(ctx);
    }
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'load' });
    return await p.evaluate(async () => {
      if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) return null;
      const m = await navigator.keyboard.getLayoutMap();
      const entries = [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      return {
        keys: entries.map((e) => e[0]),
        values: entries.map((e) => e[0] + '=' + e[1]),
        brand: Object.prototype.toString.call(m)
      };
    });
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
  }
}

const clean = await layout(false);
const ours = await layout(true);

if (!clean || !ours) {
  console.log('navigator.keyboard is absent in this browser — nothing to compare');
  server.close();
  process.exit(0);
}

console.log(`clean: ${clean.keys.length} keys, ${clean.brand}`);
console.log(`ours:  ${ours.keys.length} keys, ${ours.brand}`);

const missing = clean.keys.filter((k) => !ours.keys.includes(k));
const extra = ours.keys.filter((k) => !clean.keys.includes(k));
console.log(`  only in clean: ${missing.join(' ') || '(none)'}`);
console.log(`  only in ours:  ${extra.join(' ') || '(none)'}`);

// THE KEY SET IS PHYSICAL. It belongs to the browser and the machine, not to the layout, so
// a spoofed layout that adds or drops a key is describing a keyboard that does not exist.
ok(missing.length === 0 && extra.length === 0,
  `the key set is the browser's own (${missing.length} missing, ${extra.length} extra)`);
// And the object's class, which the old hand-built Map could not preserve on a US machine.
ok(ours.brand === clean.brand,
  `and the map is the same kind of object as a clean browser's (${ours.brand} vs ${clean.brand})`);

// The values MAY differ — that is the spoof — but on a machine already on US they must not,
// because replacing a correct map with an equal one can only lose.
const valueDiffs = ours.values.filter((v, i) => v !== clean.values[i]);
console.log(`  values differing: ${valueDiffs.length}${valueDiffs.length ? ' — ' + valueDiffs.slice(0, 6).join(' ') : ''}`);
const cleanIsUs = clean.values.includes('KeyQ=q') && clean.values.includes('KeyA=a');
if (cleanIsUs) {
  ok(valueDiffs.length === 0,
    `this machine is already US, so nothing is rewritten (${valueDiffs.length} differ)`);
} else {
  ok(ours.values.includes('KeyQ=q'), 'a non-US machine is answered with US values');
}

server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
