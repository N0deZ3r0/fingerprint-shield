// WHAT IS THERE TO BE CAUGHT BY, AND HOW MUCH OF IT CAN AN EXTENSION EVEN REACH?
//
//   node tools/probe-engine.mjs           the three-way split
//   node tools/probe-engine.mjs --all     every row, not just the summary
//
// Every other instrument here starts from OUR surface: it lists what this extension changes
// and asks whether the change is coherent. This one starts from the BROWSER. It walks the
// readable value tree of a clean Chrome, reads the same tree under the extension, and sorts
// what it finds into three piles:
//
//   CONTROLLED   the two readings differ -> the extension owns this value
//   UNTOUCHED    the two readings are identical -> whatever it says, it says on its own
//   REFUSED      the read throws or is unreachable in both -> not a channel from a page
//
// The pile that matters is UNTOUCHED. Most of it is the same on every machine on earth and
// carries nothing; some of it is not, and that part is the exposure. This instrument cannot
// tell those apart on one machine — that needs a second one — so it does NOT guess. It
// prints the pile and leaves the judging to a human, which is the honest half.
//
// Below all of it sits a fourth pile no page-level walk can see at all, listed at the end
// from what the project has already measured: the parts of Chrome that answer before any
// script runs.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, bootSettled } from '../test/harness.mjs';

const ALL = process.argv.includes('--all');

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end('<!doctype html>hi'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// The walk runs in the page. It reads DATA properties and ACCESSOR getters, never calls a
// method: calling arbitrary functions on a live document has side effects, and a side effect
// is not a measurement. Objects are descended into, cycles are cut by identity, and depth is
// bounded so the tree cannot run away through DOM parents.
const READ = `(function () {
  var seen = new WeakSet();
  var out = {};
  var MAXDEPTH = 4, MAXKEYS = 40000;
  var count = 0;

  function record(path, v) {
    if (count >= MAXKEYS) return;
    count++;
    out[path] = v;
  }
  function scalar(v) {
    var t = typeof v;
    if (v === null) return 'null';
    if (t === 'undefined') return 'undefined';
    if (t === 'string') return v.length > 120 ? 'str:' + v.length + ':' + v.slice(0, 100) : 'str:' + v;
    if (t === 'number' || t === 'boolean' || t === 'bigint') return t + ':' + String(v);
    if (t === 'symbol') return 'symbol';
    if (t === 'function') return 'fn:' + (v.name || '') + '/' + v.length;
    return null;
  }
  function walk(obj, path, depth) {
    if (!obj || depth > MAXDEPTH || count >= MAXKEYS) return;
    if (typeof obj === 'object' || typeof obj === 'function') {
      if (seen.has(obj)) return;
      seen.add(obj);
    }
    // Own properties AND the prototype chain's accessors: a browser puts most readable
    // state on prototypes, so an own-only walk would miss nearly all of it.
    var chain = [], o = obj, guard = 0;
    while (o && guard++ < 6) { chain.push(o); o = Object.getPrototypeOf(o); }
    for (var ci = 0; ci < chain.length; ci++) {
      var names;
      try { names = Object.getOwnPropertyNames(chain[ci]); } catch (e) { continue; }
      for (var i = 0; i < names.length; i++) {
        var k = names[i];
        if (k === 'constructor' || k === 'caller' || k === 'arguments' || k === 'callee') continue;
        var p = path + '.' + k;
        if (out[p] !== undefined) continue;
        var d;
        try { d = Object.getOwnPropertyDescriptor(chain[ci], k); } catch (e) { continue; }
        if (!d) continue;
        var v;
        if (d.get) {
          try { v = d.get.call(obj); } catch (e) { record(p, 'REFUSED:' + (e && e.name)); continue; }
        } else if ('value' in d) {
          v = d.value;
        } else { continue; }
        var s = scalar(v);
        if (s !== null) { record(p, s); continue; }
        record(p, 'obj');
        walk(v, p, depth + 1);
      }
    }
  }

  // The roots a page actually reads from. window last: it is the widest and the depth guard
  // should be spent on the interesting ones first.
  // [FIX the-budget-was-the-answer] window LAST plus a 4000 cap meant the walk ran out
  // before reaching window's own properties, and the run reported "0 names present only
  // with the extension" — which probe-scopes had already refuted by finding __t0 and __p0
  // exactly there. Widest root first, and a cap high enough that hitting it is itself news.
  var roots = [
    ['window', window], ['navigator', navigator], ['screen', screen], ['location', location],
    ['performance', performance], ['history', history], ['document', document],
    ['visualViewport', window.visualViewport], ['crypto', crypto],
    ['Intl', Intl], ['console', console]
  ];
  for (var r = 0; r < roots.length; r++) {
    try { walk(roots[r][1], roots[r][0], 0); } catch (e) {}
  }

  // [FIX the-instrument-could-not-see-the-hiding-place] getOwnPropertyNames does not list
  // SYMBOL keys, so moving a marker onto Symbol.for('...') would vanish from the walk above
  // and read as a clean result. A clean window carries no own symbols at all, which makes
  // this the cheapest possible check and the one that has to exist BEFORE anything is moved
  // there — an instrument blind to the hiding place turns hiding into a green light.
  try {
    var syms = Object.getOwnPropertySymbols(window);
    for (var si = 0; si < syms.length; si++) {
      var sd;
      try { sd = Object.getOwnPropertyDescriptor(window, syms[si]); } catch (e) { continue; }
      var sv = sd && ('value' in sd) ? scalar(sd.value) : 'accessor';
      record('window[symbol:' + String(syms[si]) + ']', sv === null ? 'obj' : sv);
    }
    record('window.ownSymbols.count', 'number:' + syms.length);
  } catch (e) {}

  // And the other half a walk cannot reach: a property that exists but is not LISTED. Direct
  // access answers even when every enumeration door has been wrapped, so the names this
  // build is known to use are asked for by hand rather than looked up.
  ['__t0', '__p0', '__w0', '__w1', '__r0', '__s0', '__AFP_MW__', '__AFP_PATCH_URL'].forEach(function (n) {
    var present = 'no';
    try { present = (window[n] !== undefined) ? 'yes' : 'no'; } catch (e) { present = 'threw'; }
    var listed = 'no';
    try { listed = (Object.getOwnPropertyNames(window).indexOf(n) !== -1) ? 'yes' : 'no'; } catch (e) {}
    var inOp = 'no';
    try { inOp = (n in window) ? 'yes' : 'no'; } catch (e) {}
    record('probe.direct.' + n, 'str:reachable=' + present + ' listed=' + listed + ' in=' + inOp);
  });
  return { values: out, read: count };
})()`;

async function read(withExt) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-eng-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...BROWSER, headless: true,
    args: withExt ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []
  });
  try {
    if (withExt) {
      ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
      await bootSettled(ctx);
    }
    // [FIX the-reload-was-only-on-one-side] Ours used to reload to let the profile land,
    // and that alone set performance.navigation.type to 1 and filled the unload timings,
    // which the diff then reported as 24 values "the extension owns". Both sides now make
    // exactly the same two visits, so navigation shape cannot be the difference.
    const warm = await ctx.newPage();
    await warm.goto(BASE, { waitUntil: 'load' });
    await warm.close();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    return await page.evaluate(READ);
  } finally {
    await ctx.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows */ }
  }
}

const CLEAN = await read(false);
const OURS = await read(true);
server.close();

// A clock is not a claim. Two browser launches happen at two moments and allocate two
// heaps, so every timestamp and every heap size differs no matter what is loaded -- putting
// those in the same pile as navigator.deviceMemory said the extension "owns" 24 values it
// does not touch. They go in their own pile and are read, not counted.
const isClock = (k, v) => /^performance\.(timing\.|timeOrigin|navigation\.)/.test(k) ||
  /^document\.(lastModified|timeline)/.test(k) ||
  (/^number:1[6-9][0-9]{11}/.test(String(v)));
const isHeap = (k) => /^performance\.memory\./.test(k);

const keys = Object.keys(CLEAN.values);
const controlled = [], untouched = [], refused = [], onlyOurs = [], onlyClean = [];
const clocks = [], heaps = [];
for (const k of keys) {
  const a = CLEAN.values[k], b = OURS.values[k];
  if (b === undefined) { onlyClean.push(k); continue; }
  if (String(a).startsWith('REFUSED') && String(b).startsWith('REFUSED')) { refused.push(k); continue; }
  if (a === b) { untouched.push(k); continue; }
  if (isHeap(k)) { heaps.push({ k, a, b }); continue; }
  if (isClock(k, a)) { clocks.push({ k, a, b }); continue; }
  controlled.push({ k, a, b });
}
for (const k of Object.keys(OURS.values)) if (CLEAN.values[k] === undefined) onlyOurs.push(k);

console.log(`read ${CLEAN.read} values in a clean browser, ${OURS.read} under the extension\n`);
console.log(`CONTROLLED  ${String(controlled.length).padStart(5)}   the extension owns the value`);
console.log(`UNTOUCHED   ${String(untouched.length).padStart(5)}   identical in both — says whatever it says on its own`);
console.log(`REFUSED     ${String(refused.length).padStart(5)}   throws in both — not a channel from a page`);
console.log(`ONLY OURS   ${String(onlyOurs.length).padStart(5)}   present only with the extension loaded`);
console.log(`ONLY CLEAN  ${String(onlyClean.length).padStart(5)}   present only without it`);
console.log(`clocks      ${String(clocks.length).padStart(5)}   timestamps — two launches, two moments. Not a claim.`);
console.log(`heap        ${String(heaps.length).padStart(5)}   performance.memory — read below, it is the one that matters`);
if (heaps.length) {
  console.log('');
  console.log('JS HEAP — this is the weight of our own code, seen from the page:');
  for (const h of heaps) {
    const ca = Number(String(h.a).split(':')[1]), oa = Number(String(h.b).split(':')[1]);
    console.log(`   ${h.k.padEnd(40)} clean ${String(ca).padStart(10)}   ours ${String(oa).padStart(10)}` +
      `   x${(oa / ca).toFixed(2)}`);
  }
  console.log('   performance.memory is Chrome-only, needs no permission, and nothing here');
  console.log('   substitutes it: the heap is real. On a page that loads nothing the ratio is');
  console.log('   the whole bundle; on a heavy page it is diluted. Repeat before trusting a');
  console.log('   single ratio -- allocation is not deterministic between launches.');
}

if (onlyOurs.length) {
  console.log('\nPRESENT ONLY WITH THE EXTENSION — each one is a name a page can test for:');
  for (const k of onlyOurs) console.log(`   ${k} = ${OURS.values[k]}`);
}
if (onlyClean.length) {
  console.log('\nGONE UNDER THE EXTENSION — an absence is as readable as a value:');
  for (const k of onlyClean) console.log(`   ${k} = ${CLEAN.values[k]}`);
}

console.log('\nCONTROLLED, every row:');
for (const c of controlled.sort((x, y) => (x.k < y.k ? -1 : 1))) {
  console.log(`   ${c.k.padEnd(46)} clean ${String(c.a).slice(0, 32).padEnd(34)} ours ${String(c.b).slice(0, 32)}`);
}

const outFile = join(tmpdir(), 'afp-engine-untouched.txt');
writeFileSync(outFile, untouched.join('\n') + '\n', 'utf8');
console.log(`\nthe UNTOUCHED list is ${untouched.length} long and written to ${outFile}`);
if (ALL) { console.log(''); for (const k of untouched) console.log(`   ${k} = ${CLEAN.values[k]}`); }

console.log(`
BELOW THIS WALK — what no page-level scan can see, and no MV3 extension can move.
Listed from what this project has already measured, not from a guess:

   TLS / HTTP2 handshake     JA3, JA4, the h2 SETTINGS frame. Decided at the socket,
                             before a byte of the page exists. LIMITS 14.
   the site's own service    runs outside every content script. Measured once at 16 cores
   worker                    against 18, Europe/Berlin against Europe/Moscow. LIMITS 5.
   the CSS engine            @media answers from the real window while matchMedia answers
                             from the profile. LIMITS 8.
   ICU's default locale      set in the renderer before V8 caches it; an extension can only
                             wrap the named doors that read it, one at a time.
   real parallelism          hardwareConcurrency is a number; running workers is behaviour.
   real memory               deviceMemory is a bucket; allocating is behaviour. LIMITS 19, 20.
   rasterisation             canvas text, WebGL shading and font hinting are computed by
                             this machine's driver. Noise is not substitution. LIMITS 2, 3, 4.
   the audio graph           OfflineAudioContext computes on the real stack. LIMITS 2.
   process and window        outerHeight - innerHeight is the browser's own chrome; an
   geometry                  infobar or a different build changes it.
`);
