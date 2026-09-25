/**
 * MEASURING MUST NOT MUTATE THE ELEMENT BEING MEASURED.
 *
 *   node test/measurewrite.mjs             headless
 *   node test/measurewrite.mjs --headed    watch it
 *
 * The fonts module answers "how wide is this text in a font this machine does not have?"
 * by swapping the element's own inline font-family for the filtered one, taking the native
 * reading and putting the declaration back. The swap is a write to the style ATTRIBUTE, and
 * a clean browser's getBoundingClientRect / offsetWidth never writes anything at all:
 *
 *     el.style.fontFamily = 'Zapfino';
 *     new MutationObserver(() => hit = true)
 *       .observe(el, { attributes: true, attributeFilter: ['style'] });
 *     el.getBoundingClientRect();
 *
 * `hit` was true here and false in a clean browser. Restoring synchronously hides nothing:
 * records are delivered at the microtask checkpoint and describe what happened, not what is
 * left. It is a worse tell than any name this build used to leave on window, because it asks
 * a generic question and needs to know nothing about this extension — and it fires on the
 * elements a font prober makes, which are the same elements a real page lays out with an
 * inline family. It was found through a page doing ordinary layout, not a probe.
 *
 * [FIX measuring-mutated-the-element-a-page-was-watching] withdraws the record instead of the
 * write. THREE CHECKS, because the cheap way to pass the first one is to break the API:
 *
 *   TELL      measuring an element with an inline blocked family delivers no style record,
 *             through the callback and through takeRecords(), which a page can call in the
 *             same task.
 *   CONTROL   a style write the PAGE makes on that same element, in a later task, still
 *             arrives. Forgetting the element is a microtask, so a later task is clean.
 *   CONTROL   a style write on an element we never measured always arrives, and so does a
 *             childList record — the filter is narrower than "attributes".
 *
 * The clean browser runs the same page: it is what says the assertions mean anything, and
 * what would catch a control that cannot fire for a reason unrelated to us.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harness, root, BROWSER, langArgs, bootSettled } from './harness.mjs';

const headed = process.argv.includes('--headed');
const { assert, eq, section, note, done } = harness();

const PAGE = `<!doctype html><meta charset="utf-8"><title>measurewrite</title><body><div id="app"></div><script>
function mk(family) {
  var el = document.createElement('span');
  el.textContent = 'MMMMMMMMMMWWWWWWWWWW';
  el.style.position = 'absolute';
  el.style.fontSize = '64px';
  if (family) el.style.fontFamily = family;
  document.getElementById('app').appendChild(el);
  return el;
}
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

window.T = async function () {
  var out = {};

  // TELL A — the callback path. The queue is left alone, so a record that survived the
  // filter would arrive at the checkpoint.
  var probe = mk('Zapfino');
  var hits = 0;
  var mo = new MutationObserver(function (recs) { hits += recs.length; });
  mo.observe(probe, { attributes: true, attributeFilter: ['style'] });
  out.width = probe.getBoundingClientRect().width;
  out.offset = probe.offsetWidth;
  await tick();
  out.onMeasure = hits;

  // TELL B — the synchronous path, on a SECOND element with its own observer. Asking
  // takeRecords() drains the queue, so doing it to the element above would have made the
  // check above pass for the wrong reason: the callback cannot fire on records already
  // taken. Separate element, separate observer, neither zero explains the other.
  var probe2 = mk('Zapfino');
  var mo2 = new MutationObserver(function () {});
  mo2.observe(probe2, { attributes: true, attributeFilter: ['style'] });
  probe2.getBoundingClientRect();
  out.taken = mo2.takeRecords().length;
  mo2.disconnect();

  // CONTROL 1 — the page's own write on the very element we measured, a task later.
  hits = 0;
  probe.style.color = 'rgb(1, 2, 3)';
  await tick();
  out.onPageWriteSameEl = hits;
  mo.disconnect();

  // CONTROL 2 — an element nothing measured, and a record that is not an attribute.
  var other = mk(null);
  var hits2 = 0, kinds = [];
  var mo2 = new MutationObserver(function (recs) {
    hits2 += recs.length;
    for (var i = 0; i < recs.length; i++) kinds.push(recs[i].type);
  });
  mo2.observe(other, { attributes: true, childList: true });
  other.style.color = 'rgb(4, 5, 6)';
  other.appendChild(document.createElement('b'));
  await tick();
  out.onUntouched = hits2;
  out.kinds = kinds.sort().join(',');
  mo2.disconnect();

  return out;
};
<\/script>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;

async function run(ctx) {
  const p = await ctx.newPage();
  await p.goto(URL0, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 400));
  const out = await p.evaluate(() => window.T());
  await p.close();
  return out;
}

const cleanBrowser = await chromium.launch({ ...BROWSER, headless: !headed });
const clean = await run(await cleanBrowser.newContext());
await cleanBrowser.close();

const dir = mkdtempSync(path.join(tmpdir(), 'afp-measurewrite-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-field-trial-config'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, ...langArgs()]
});
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  await bootSettled(sw);
  const ours = await run(ctx);

  section('the clean browser is the baseline');
  eq(clean.onMeasure, 0, 'clean: measuring delivers no style record');
  eq(clean.taken, 0, 'clean: takeRecords() during the same task is empty too');
  assert(clean.onPageWriteSameEl > 0, 'clean: the page writing style DOES deliver a record');
  assert(clean.onUntouched > 0, 'clean: so does a write on an untouched element');

  section('the tell: measuring must deliver nothing');
  eq(ours.onMeasure, 0,
    `measuring an element with an inline filtered family delivers no style record ` +
    `(got ${ours.onMeasure}) — the substitution writes the attribute twice and a page ` +
    'watching it reads that as "this browser mutates when it measures"');
  eq(ours.taken, 0,
    `and takeRecords() called in the same task is empty (got ${ours.taken}) — a page does ` +
    'not have to wait for the checkpoint to look');

  section('the controls: the API still works');
  assert(ours.onPageWriteSameEl > 0,
    'the page writing style on the element we measured, a task later, still arrives — ' +
    'the element is forgotten at the microtask checkpoint, not kept');
  assert(ours.onUntouched > 0,
    'a write on an element nothing measured always arrives');
  eq(ours.kinds, clean.kinds,
    `and the record kinds match the clean browser exactly (${ours.kinds} vs ${clean.kinds}) — ` +
    'the filter is style attributes on measured elements, not attributes in general');

  section('and the measurement itself still happened');
  assert(ours.width > 0 && ours.offset > 0,
    `the reading is still a real one (${ours.width.toFixed(1)}px / ${ours.offset}px)`);
  note(`clean ${clean.width.toFixed(1)}px, ours ${ours.width.toFixed(1)}px`);
} finally {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
  server.close();
}
done();
