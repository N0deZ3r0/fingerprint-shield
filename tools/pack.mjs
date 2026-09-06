/**
 * THE EXTENSION, WITHOUT THE WORKSHOP.
 *
 *   node tools/pack.mjs            build dist/
 *   node tools/pack.mjs --check    verify only, write nothing (exit 1 on a problem)
 *
 * This repository IS the extension — it is loaded unpacked straight from the working tree,
 * which is why mw-bundle.js and dyn/ are committed (see .gitignore). The price is that the
 * directory Chrome loads also holds seventy dev pages, twenty suites, the generators and
 * the source modules the bundle was built from. None of that is needed to RUN it, and
 * Chrome validates every file it finds in an extension directory.
 *
 * So: dist/ is the same extension with the workshop left behind. The CI workflow uploads
 * it as the build artifact, so what you download from GitHub is the extension and nothing
 * else, while the suites stay in the repository where CI can still run them.
 *
 * WHAT KEEPS IT HONEST, because a hand-written file list is a thing that rots in silence
 * and the failure — a missing file — does not show up until an install is broken:
 *
 *   - The list is an EXCLUDE list, so a new source file ships by default. Forgetting to
 *     add something is the failure that cannot happen; shipping one file too many is the
 *     one that can, and it costs nothing.
 *   - Every path the manifest names must be in dist/.
 *   - Every path background.js names as a string literal must be in dist/ — but only if it
 *     exists in the source tree at all, since some of those literals are synthetic URLs
 *     rather than files.
 *   - Every src= and href= in every packed HTML page must resolve inside dist/.
 *   - dyn/ must arrive with all six of its subdirectories non-empty. It is generated, and
 *     an empty one would produce an extension that loads and then reports the wrong
 *     machine on every cold start.
 *   - dist/ on disk, when it exists, must MATCH the source it was packed from. It is
 *     gitignored, so nothing ships it — but README.txt tells the user to Load unpacked
 *     from it, which makes a stale copy the build they are actually running, and one that
 *     hides: every suite here loads the working TREE. Measured cost of not checking: six
 *     hand-runs of this script in one day, and a user told to reload an extension whose
 *     dist/ was two fixes behind.
 *   - No top-level name may start with an underscore except the three Chrome reserves.
 *     That one is not theoretical: a scratch file named `_creep.mjs` in the project root
 *     once made real Chrome refuse the whole extension with "Не удалось загрузить
 *     манифест" — naming the manifest, not the file — while every Playwright suite passed,
 *     because `--load-extension` skips that validation entirely.
 */
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../test/harness.mjs';

const CHECK_ONLY = process.argv.includes('--check');
const DIST = path.join(root, 'dist');

// Directories that never ship. `mw/` is here on purpose: those eleven modules are the
// SOURCE the bundle is generated from, the manifest loads only mw-bundle.js, and the only
// mentions of them outside tools/ and test/ are in comments — checked, not assumed.
const SKIP_DIRS = new Set([
  'node_modules', '_metadata', '.git', '.github', '.claude', 'dist',
  'test', 'tools', 'mw', 'docs',
]);

// Individual files that never ship. profile-injector.js is the twelfth bundle input, not a
// content script of its own; protect_c.source is the C the wasm was built from.
const SKIP_FILES = new Set([
  'package.json', 'package-lock.json', 'eslint.config.js', 'test-defaults.cjs',
  '.gitattributes', '.gitignore', 'protect_c.source', 'profile-injector.js',
  'notes-baseline-ours.json', 'dev-workerjob.js',
]);
// [FIX a-stray-log-in-the-root-shipped-in-the-release] The list above is a DENY list, so
// anything in the root that nobody thought to name goes into dist/. Caught by leaving a
// `npm run test:all > edge-run.log` in the root while working: the packer copied it, and
// `--check` then reported dist/ as behind the source because the log kept growing. A build
// log is the harmless version — a heap dump, a har capture or a scratch note with a session
// cookie in it would have shipped the same way. These are the shapes a working tree grows.
// NOT `/^_/` here, though a scratch file is as likely to be named `_note.js` as `note.log`:
// the reserved-name check below walks the COLLECTED list, so skipping underscored files
// would silence the guard that stops Chrome refusing the whole extension. A name Chrome
// reserves has to FAIL, not disappear.
const SKIP_PATTERNS = [/^dev-.*\.html$/, /\.md$/, /\.rar$/, /\.bak$/,
  /\.log$/, /\.tmp$/, /\.zip$/, /\.har$/, /\.heapsnapshot$/];

// README.txt and the three afp-*-console.js DO ship. They are not code the extension runs,
// but README.txt is written as the release note for this package and it is the document
// that tells a user to paste those three into a console — shipping the instructions
// without the thing they instruct would be worse than shipping four extra files.

const problems = [];
const fail = (msg) => problems.push(msg);

function collect(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...collect(path.join(dir, e.name), r));
    } else {
      if (SKIP_FILES.has(e.name)) continue;
      if (SKIP_PATTERNS.some((p) => p.test(e.name))) continue;
      out.push(r);
    }
  }
  return out;
}

const files = collect(root);
const shipped = new Set(files);
const exists = (p) => shipped.has(p.replace(/^\.\//, '').replace(/^\//, ''));

// ---- what the manifest names ----
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const fromManifest = [];
const walkManifest = (v) => {
  if (typeof v === 'string') {
    if (/\.(js|css|html|json|png|wasm)$/.test(v)) fromManifest.push(v);
  } else if (Array.isArray(v)) v.forEach(walkManifest);
  else if (v && typeof v === 'object') Object.values(v).forEach(walkManifest);
};
walkManifest(manifest);
for (const p of fromManifest) {
  if (!exists(p)) fail(`the manifest names ${p} and dist/ would not have it`);
}

// ---- what background.js names ----
const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const literals = new Set(
  (bg.match(/['"][A-Za-z0-9_./-]+\.(?:js|css|html|wasm|json)['"]/g) || [])
    .map((s) => s.slice(1, -1))
);
for (const p of literals) {
  const abs = path.join(root, p.replace(/^\//, ''));
  // Only a literal that IS a file in the source tree is a claim about a file.
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
  if (!exists(p.replace(/^\//, ''))) fail(`background.js loads ${p} and dist/ would not have it`);
}

// ---- what the shipped pages name ----
for (const f of files.filter((n) => n.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, f), 'utf8');
  const refs = (html.match(/(?:src|href)\s*=\s*["'][^"']+["']/g) || [])
    .map((a) => a.replace(/^.*["']([^"']+)["']$/, '$1'))
    .filter((u) => !/^(https?:|data:|#|chrome)/.test(u));
  for (const u of refs) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(f), u.split(/[?#]/)[0]));
    if (!exists(resolved)) fail(`${f} references ${u} and dist/ would not have it`);
  }
}

// ---- dyn/ must be whole ----
for (const sub of ['cc', 'dev', 'mode', 'ns', 'pv']) {
  const n = files.filter((f) => f.startsWith(`dyn/${sub}/`)).length;
  if (!n) fail(`dyn/${sub}/ is empty — run node tools/gen-dyn.mjs`);
}
if (!exists('dyn/boot.js') || !exists('dyn/seedlib.js')) fail('dyn/boot.js or dyn/seedlib.js is missing');

// ---- Chrome's reserved names ----
const ALLOWED_UNDERSCORE = new Set(['_locales', '_metadata', '_platform_specific']);
for (const f of files) {
  const top = f.split('/')[0];
  if (top.startsWith('_') && !ALLOWED_UNDERSCORE.has(top)) {
    fail(`${top} starts with an underscore, which Chrome reserves — the whole extension would refuse to load`);
  }
}

// ---- and nothing from the workshop slipped through ----
for (const f of files) {
  if (/^(test|tools|mw)\//.test(f) || /^dev-/.test(f) || f.endsWith('.md')) {
    fail(`${f} is workshop, not extension`);
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

const bytes = files.reduce((n, f) => n + fs.statSync(path.join(root, f)).size, 0);
const mb = (bytes / 1048576).toFixed(2);

// ---- dist/ is not behind the source ----
// Only when it exists: a tree that has never been packed is not stale, and CI packs after
// checking. Compared by CONTENT, not mtime — a checkout has no useful timestamps.
let distNote = 'dist/ not built';
if (CHECK_ONLY && fs.existsSync(DIST)) {
  const distFiles = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), p);
      else distFiles.push(p);
    }
  })(DIST, '');
  const want = new Set(files);
  const stale = [], extra = [];
  for (const f of distFiles) if (!want.has(f)) extra.push(f);
  for (const f of files) {
    const d = path.join(DIST, f);
    if (!fs.existsSync(d)) { stale.push(f + ' (missing)'); continue; }
    const a = fs.readFileSync(path.join(root, f)), b = fs.readFileSync(d);
    if (!a.equals(b)) stale.push(f);
  }
  const bad = stale.concat(extra.map((f) => f + ' (not in the source)'));
  if (bad.length) {
    fail(`dist/ is behind the source — ${bad.length} file(s): ${bad.slice(0, 6).join(', ')}` +
      (bad.length > 6 ? ', …' : '') + ' — run node tools/pack.mjs');
  }
  distNote = `dist/ matches (${distFiles.length} files)`;
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

if (CHECK_ONLY) {
  console.log(`ok — ${files.length} files, ${mb} MB, every referenced path present; ${distNote}`);
  process.exit(0);
}

fs.rmSync(DIST, { recursive: true, force: true });
for (const f of files) {
  const dest = path.join(DIST, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, f), dest);
}
console.log(`dist/  ${files.length} files, ${mb} MB  (Fingerprint Shield ${manifest.version})`);
console.log('load it with chrome://extensions → Load unpacked → dist');
