/**
 * Generates mw-bundle.js — the MAIN-world content script, as ONE file.
 *
 * WHY THIS EXISTS
 *
 * Chrome emits one console error PER BLOCKED SCRIPT when it tries to inject into a frame
 * that is sandboxed without `allow-scripts`, and our manifest deliberately reaches every
 * frame it can (all_frames + match_about_blank + match_origin_as_fallback — see
 * [FIX opaque-frames-got-the-stub], which is not negotiable: a data: frame with no content
 * script reported the host's screen, timezone, locale, cores, GPU and a HeadlessChrome UA).
 *
 * Those frames cannot run ANY script, ours included, so the injection buys nothing there —
 * it only prints. Measured on a page with five sandboxed/blank frames and no scripts of its
 * own, clean Chromium against this build:
 *
 *     clean                      0 console errors
 *     11 MAIN files + 3 ISOLATED + 14 dyn      78
 *
 * and on real sites, which is where a user would notice: youtube.com 27 against 1 clean,
 * stackoverflow.com 31 against 3. Nothing breaks — the page's own scripts are blocked in
 * those frames too — but it is noise in every visitor's console, it scales with the number
 * of files we register, and the count is the one part of it we control.
 *
 * The eleven MAIN modules are independent IIFEs that run in a fixed order, so they
 * concatenate exactly. One file, one message per sandboxed frame instead of eleven.
 *
 * THE SEPARATOR MATTERS. Every module ends `})();` and the next begins `(function () {`.
 * Without a `;` between them ASI does not help — `})()\n(function(){})()` parses as a CALL
 * of the first IIFE's result, which is `undefined`, and the whole bundle dies at load with
 * "undefined is not a function". The separator below is not cosmetic.
 *
 * THE BUNDLE CARRIES NO COMMENTS
 *
 * [FIX six-hundred-kilobytes-of-comments-in-every-frame] The modules keep every [FIX] line
 * — they are the source of truth and nothing here edits them — but the concatenation the
 * manifest injects does not, because that text is scanned once per FRAME, at
 * document_start, on every page. Measured on this build:
 *
 *     mw-bundle.js with comments      1,075,029 bytes   15,945 lines
 *     the same file, comments blanked   420,344 bytes   15,945 lines   -60.9%
 *
 * and what the difference costs to parse, Chromium 141, one page, cases interleaved,
 * twelve rounds of twenty, minimum of the rounds — three runs of
 * tools/probe-bundlecost.mjs, which is the tool to re-measure this with:
 *
 *     comments in      6.365 / 7.795 / 7.810 ms per frame     x30 frames  191 / 234 / 234 ms
 *     as shipped       5.230 / 6.390 / 6.535 ms per frame     x30 frames  157 / 192 / 196 ms
 *
 * — 1.1 to 1.4 ms per frame, and the count is per frame: youtube.com carries 27 of them
 * against a clean browser's 1 by the count taken above for the console-error argument.
 * It is a readout and not a verdict; no detector's threshold for page-load cost is known.
 *
 * LINES ARE BLANKED, NOT REMOVED. Deleting them buys 9,993 bytes more and measures the
 * same, while moving every line number in the file — and line numbers here are evidence:
 * mw/mw-core.js records `Object.apply (…/mw-bundle.js:1548:36)` as a measured stack frame.
 * Every `// ==== <module> ====` header therefore stays on the line it was on (3, 526, 590,
 * 2699, 4892, 7011, 8815, 10962, 15129, 15456, 15911) and a stack frame still divides
 * straight back into a module and a line in it.
 *
 * WHAT KEEPS IT HONEST
 *
 * The modules stay on disk as the source of truth, and everything that reads them keeps
 * working: dev-*.html loads them individually (so the browser suite exercises the unbundled
 * path), test/parity-static.mjs greps them, the console-check scripts do not care. The
 * bundle is verified byte for byte by parity-static, exactly the way dyn/ is — a module
 * edited without re-running the generator turns `npm test` red rather than shipping stale
 * code. And ORDER is checked there too: mw-cleanup.js must stay last, because it removes
 * the window markers the modules ahead of it hand each other.
 *
 *   node tools/gen-bundle.mjs           write the file
 *   node tools/gen-bundle.mjs --check   report drift, write nothing (exit 1 if stale)
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { root } from '../test/harness.mjs';
import * as acorn from 'acorn';

/**
 * The MAIN-world load order. This list IS the order — the manifest names only the bundle
 * now, so there is nowhere else for it to live. parity-static asserts that every file in
 * mw/ appears here, so a new module cannot be silently left out of the build, and that
 * mw-cleanup.js is last.
 */
export const MAIN_MODULES = [
  'profile-injector.js',
  'mw/mw-bag.js',
  'mw/mw-core.js',
  'mw/mw-timezone-screen.js',
  'mw/mw-navigator.js',
  'mw/mw-canvas-audio.js',
  'mw/mw-misc.js',
  'mw/mw-workers.js',
  'mw/mw-geo.js',
  'mw/mw-adblock.js',
  'mw/mw-cleanup.js'
];

export const BUNDLE_PATH = 'mw-bundle.js';

const ACORN = { ecmaVersion: 2022, sourceType: 'script' };

/**
 * Every token of `src` with the line and column it sits on, joined into one string.
 *
 * Two sources with the same fingerprint are the same PROGRAM: the same tokens, in the same
 * order, on the same lines — so every ASI decision, the one thing whitespace can still
 * change, is decided the same way in both. That is the equivalence the strip below has to
 * preserve. "It still parses" is not that equivalence, and would not have caught the
 * counter-example stripComments' own memo carries.
 */
function fingerprint(src, label) {
  const out = [];
  try {
    for (const t of acorn.tokenizer(src, { ...ACORN, locations: true })) {
      out.push(t.type.label + '|' + (t.value === undefined ? '' : String(t.value)) +
        '|' + t.loc.start.line + ':' + t.loc.start.column);
      if (t.type.label === 'eof') break;
    }
  } catch (e) {
    throw new Error(`${label}: does not tokenize — ${e.message}`);
  }
  return out.join('\n');
}

/**
 * Blanks every line a comment covers END TO END, keeping the line itself.
 *
 * A LINE FILTER OVER /^\s*\/\// IS NOT SAFE, and the counter-example is four lines long:
 *
 *     var a = 1;              var a = 1;
 *     /* x               ->   /* x
 *     // y *\/            var b = 2;
 *     var b = 2;
 *
 * — the filter eats the line that CLOSES the block comment, and everything after it is
 * swallowed by a comment that now never ends. The ranges here come from acorn instead, so
 * a `//` inside a string, a template literal or a regex is not a comment and is not
 * touched. The token fingerprint above is compared before anything is returned, so a strip
 * that moved so much as one token throws rather than writing a bundle.
 *
 * LINES ARE BLANKED, NOT DELETED, and that is not tidiness. Line numbers in the bundle are
 * evidence: mw/mw-core.js records `Object.apply (…/mw-bundle.js:1548:36)` as a measured
 * stack frame, and bundle line 1548 has to keep pointing at the same source line for that
 * record to mean anything. Deleting the lines instead buys 9,993 further bytes of the
 * 654,685 — 1.5% of the win — and costs every recorded number and every stack frame read
 * off a running build.
 */
export function stripComments(src, label) {
  const comments = [];
  try {
    acorn.parse(src, { ...ACORN, onComment: comments });
  } catch (e) {
    throw new Error(`${label}: does not parse — ${e.message}`);
  }
  const lineStart = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStart.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0, hi = lineStart.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStart[m] <= pos) lo = m; else hi = m - 1; }
    return lo;
  };
  const lineEnd = (i) => (i + 1 < lineStart.length ? lineStart[i + 1] - 1 : src.length);
  const blank = new Set();
  for (const c of comments) {
    const a = lineOf(c.start), b = lineOf(c.end);
    if (src.slice(lineStart[a], c.start).trim() !== '') continue;   // code shares its first line
    if (src.slice(c.end, lineEnd(b)).trim() !== '') continue;       // code shares its last line
    for (let i = a; i <= b; i++) blank.add(i);
  }
  const lines = src.split('\n');
  for (const i of blank) lines[i] = '';
  const out = lines.join('\n');
  if (fingerprint(src, label) !== fingerprint(out, label + ' stripped')) {
    throw new Error(`${label}: stripping moved or changed a token — the bundle was NOT written`);
  }
  return out;
}


export function generate() {
  const banner =
    '// Generated by tools/gen-bundle.mjs — do not edit. Edit the modules and re-run it.\n' +
    '// Sources, in load order: ' + MAIN_MODULES.join(', ') + '\n';
  const parts = MAIN_MODULES.map((rel) => {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    return '// ==== ' + rel + ' ====\n' + stripComments(src, rel);
  });
  // See THE SEPARATOR MATTERS above: `;` between two IIFEs, not just a newline.
  return banner + parts.join('\n;\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const body = generate();
  const abs = path.join(root, BUNDLE_PATH);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (current === body) {
    console.log(`${BUNDLE_PATH} already up to date (${MAIN_MODULES.length} modules, ${body.length} bytes)`);
  } else if (process.argv.includes('--check')) {
    console.error(`stale: ${BUNDLE_PATH} — run: node tools/gen-bundle.mjs`);
    process.exit(1);
  } else {
    fs.writeFileSync(abs, body);
    console.log(`wrote ${BUNDLE_PATH} (${MAIN_MODULES.length} modules, ${body.length} bytes)`);
  }
}
