/**
 * WHAT THE USER'S BROWSER HAS THAT THE RIG'S DOES NOT.
 *
 *   node tools/probe-surface.mjs                 installed Chrome vs the suite's Chromium
 *   node tools/probe-surface.mjs --channel=msedge  another installed browser as side A
 *   node tools/probe-surface.mjs --all           list every addition, reviewed or not
 *
 * WHY THIS EXISTS. Every browser suite in test/ drives the browser Playwright ships, and
 * `--load-extension` has been refused by branded Chrome since 136 — measured again on
 * 152, with a two-line extension, so it is the switch and not our manifest. So the
 * browser the user actually runs is always the newer one, and it is the one no rig on
 * this machine can load the extension into. A patch written against a table measured on
 * the older build goes green on every suite and is still wrong in the browser it ships to.
 *
 * That gap has a shape: an API that exists over there and not over here. This prints it.
 *
 * The first run found two, both real, both introduced by one browser update:
 *
 *   navigator.cpuPerformance     Chrome 152's CPU Performance API — an integer 1..4 the
 *                                browser derives from the REAL processor, sitting beside
 *                                a hardwareConcurrency and a deviceMemory that were the
 *                                profile's. It did not move when the profile did.
 *   OpaqueRange.getClientRects   the range over a form control's VALUE, new in 152 and
 *                                neither an Element nor a Range, so both clientRects
 *                                patches missed it. Per-font text advances, and a
 *                                font-presence oracle in the fallback width.
 *
 * WHAT COUNTS AS A PROBLEM. Not every addition matters — most of a browser update is
 * rendering and CSS. An addition is reported when NO file in the extension mentions the
 * name, i.e. nobody has looked at it yet. Once a patch, a guard or even a comment names
 * it, it drops off this list and stays off. So the output is a triage queue, not a diff:
 * it empties as the additions get judged, and it refills on the next browser update.
 *
 * Exit code is the number of unreviewed additions, so this can gate a release.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../test/harness.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const SHOW_ALL = process.argv.includes('--all');

// Side A is the browser the user runs; side B is the browser the suite drives. FPS_CHROME
// wins over --channel for side A, the same way it does in test/harness.mjs, so a locally
// built Chromium can be measured against the rig with one variable.
const A = process.env.FPS_CHROME
  ? { executablePath: process.env.FPS_CHROME }
  : { channel: arg('channel', 'chrome') };
const B = { channel: 'chromium' };

/**
 * The names a page can reach without doing anything unusual: every global, every
 * global constructor's prototype and statics, and the objects a fingerprinting script
 * reads first. Names only — values differ per machine and would drown the signal.
 */
async function surface(launch) {
  const browser = await chromium.launch({
    ...launch,
    headless: true,
    // Same reason as test/harness.mjs: the trial config decides which FEATURES exist, and
    // a feature that exists for users has to exist while we measure them.
    ignoreDefaultArgs: ['--disable-field-trial-config'],
  });
  try {
    const page = await (await browser.newContext()).newPage();
    // A real https origin: some interfaces are secure-context only, and about:blank is
    // not the realm anything is measured in.
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    return await page.evaluate(() => {
      const names = new Set();
      const seen = new Set();
      const add = (prefix, obj) => {
        if (!obj || seen.has(obj)) return;
        seen.add(obj);
        let props;
        try { props = Object.getOwnPropertyNames(obj); } catch (e) { return; }
        for (const k of props) names.add(prefix + '.' + k);
      };
      for (const k of Object.getOwnPropertyNames(globalThis)) {
        names.add('window.' + k);
        let v;
        try { v = globalThis[k]; } catch (e) { continue; }
        if (typeof v !== 'function') continue;
        add(k + '.static', v);
        if (v.prototype) add(k + '.prototype', v.prototype);
      }
      add('window.proto', Object.getPrototypeOf(globalThis));
      const pairs = [
        ['navigator', navigator], ['navigator.proto', Object.getPrototypeOf(navigator)],
        ['screen', screen], ['screen.proto', Object.getPrototypeOf(screen)],
        ['document', document], ['location', location], ['performance', performance],
        ['performance.proto', Object.getPrototypeOf(performance)],
        ['Intl', Intl], ['console', console], ['chrome', globalThis.chrome],
      ];
      for (const [prefix, obj] of pairs) add(prefix, obj);
      return {
        ua: navigator.userAgent,
        version: (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || '?',
        names: [...names].sort(),
      };
    });
  } finally {
    await browser.close();
  }
}

/**
 * Everything the extension ships, as one string. A name found anywhere in it — in a
 * patch, in a guard, or only in a line of the change log saying why it is left alone
 * — has been looked at, and that is the whole test. Deliberately generous: this is a
 * queue of things nobody has considered, and a false "reviewed" costs one grep while a
 * false "new" costs attention on every run forever. The prose files count for the same
 * reason: "we looked and it carries nothing" is a review, and it has to be recordable
 * somewhere that is not a patch.
 *
 * THIS FILE IS EXCLUDED FROM ITS OWN SCAN. Every name in the header above appears in the
 * walked tree otherwise, so the probe would mark as reviewed exactly the things it had
 * just reported — a tool that quietly satisfies its own check is worse than no tool.
 * mw-bundle.js is skipped for a duller reason: it is a copy of mw/, and counting it twice
 * changes nothing.
 */
function extensionText() {
  const SELF = 'tools/probe-surface.mjs';
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.posix.normalize(path.posix.join(dir, e.name));
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'icons', 'dyn', '_metadata'].includes(e.name)) continue;
        walk(rel);
      } else if (/\.(js|cjs|mjs|json|html|md|txt)$/.test(e.name) &&
                 e.name !== 'mw-bundle.js' && rel !== SELF) {
        files.push(rel);
      }
    }
  };
  walk('.');
  return files.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
}

const [a, b] = await Promise.all([surface(A), surface(B)]);
const known = new Set(b.names);
const added = a.names.filter((n) => !known.has(n));
const removed = b.names.filter((n) => !new Set(a.names).has(n));

console.log(`user's browser   Chrome ${a.version}   ${a.names.length} names`);
console.log(`the rig's        Chrome ${b.version}   ${b.names.length} names`);

if (a.version === b.version) {
  console.log('\nBoth sides are the same version, so this run can only see build ' +
    'differences (Chromium ships without XSLT, for one). It is not evidence that the ' +
    'suite is measuring what the user runs — that needs the two to diverge.');
}

// The identifier to grep for: the leaf, plus the interface it hangs off. Either being
// mentioned counts, since a guard usually names the interface and a patch the member.
const tokens = (n) => {
  const parts = n.split('.');
  const leaf = parts[parts.length - 1];
  const head = parts[0];
  return [leaf, head].filter((t) => t && t.length > 3);
};
const source = extensionText();
const mentions = new Map();
const isReviewed = (n) => tokens(n).some((t) => {
  if (!mentions.has(t)) mentions.set(t, source.includes(t));
  return mentions.get(t);
});

const unreviewed = added.filter((n) => !isReviewed(n));
const reviewed = added.filter(isReviewed);

console.log(`\n### ADDED in the user's browser (${added.length}) — ` +
  `${reviewed.length} already named somewhere in the extension`);
for (const n of (SHOW_ALL ? added : unreviewed)) {
  console.log(`   ${isReviewed(n) ? ' ' : '!'} ${n}`);
}
if (!SHOW_ALL && reviewed.length) {
  console.log(`   (${reviewed.length} reviewed one(s) hidden — --all shows them)`);
}

if (removed.length) {
  console.log(`\n### ONLY in the rig's browser (${removed.length}) — a patch guarded on ` +
    `one of these is dead code in the browser that ships`);
  for (const n of removed) console.log(`     ${n}`);
}

console.log(`\n=== ${unreviewed.length} problem(s) — API in the user's browser that no ` +
  `file in this extension mentions ===`);
process.exitCode = unreviewed.length;
