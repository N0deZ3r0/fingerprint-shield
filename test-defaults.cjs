#!/usr/bin/env node
/**
 * Verify every hand-maintained copy of the default feature flags agrees with the source
 * of truth in defaults.js, key for key and value for value.
 *
 * The MAIN world cannot importScripts, so mw-core.js keeps its own _FEAT fallback literal;
 * options.js keeps a third literal as an emergency fallback for the case where defaults.js
 * failed to load ("[AFP options] defaults.js not loaded"). Each copy is a place the set can
 * silently drift — a flag added to defaults.js but not to a copy changes what that copy
 * protects. This test pins all three together so a divergence fails CI instead of shipping.
 */
const fs = require('fs');
const path = require('path');
const root = __dirname;

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Pull a `{ key: true|false, ... }` block out of a file and return it as a plain object.
// `re` must capture the object body (the part between the braces) in group 1.
function parseFlags(label, src, re) {
  const m = src.match(re);
  if (!m) { console.error(`parse fail: ${label}`); process.exit(1); }
  const out = {};
  m[1].split(',').forEach((line) => {
    const mm = line.match(/(\w+)\s*:\s*(true|false)/);
    if (mm) out[mm[1]] = mm[2] === 'true';
  });
  return out;
}

// The source of truth.
const truth = parseFlags(
  'defaults.js AFP_DEFAULT_FEATURES',
  read('defaults.js'),
  /var AFP_DEFAULT_FEATURES = \{([^}]+)\}/s
);

// Every copy that must match it, with the pattern that isolates its literal.
const copies = [
  {
    label: 'mw-core.js _FEAT fallback',
    flags: parseFlags('mw-core.js _FEAT', read('mw/mw-core.js'), /var d = \{([^}]+)\}/s)
  },
  {
    // options.js defaults(): the literal returned when defaults.js is absent. Anchored on
    // the `return {` inside that guard so it cannot match anything else in the file.
    label: 'options.js defaults() fallback',
    flags: parseFlags('options.js fallback', read('options.js'), /return \{\s*(canvas:[^}]+)\}/s)
  },
  // [FIX self-check-required-keys-the-extension-stops-writing] The two scripts README.txt
  // tells users to paste into a console. They are pasted into a PAGE, so they cannot
  // import defaults.js either, and they need the defaults for the same reason mw-core does:
  // 'v.ui.f' is absent whenever the flags are unchanged, and absence means "the defaults".
  // Before that they simply reported FAIL on any install running the default configuration.
  {
    label: 'afp-console-check.js FEAT_DEFAULTS',
    flags: parseFlags('afp-console-check.js', read('afp-console-check.js'),
      /const FEAT_DEFAULTS = \{([^}]+)\}/s)
  },
  {
    label: 'afp-full-console-check.js FEAT_DEFAULTS',
    flags: parseFlags('afp-full-console-check.js', read('afp-full-console-check.js'),
      /const FEAT_DEFAULTS = \{([^}]+)\}/s)
  }
];

let bad = 0;
for (const { label, flags } of copies) {
  for (const k of Object.keys(truth)) {
    if (flags[k] !== truth[k]) {
      console.error(`mismatch [${label}] ${k}: defaults=${truth[k]} copy=${flags[k]}`);
      bad++;
    }
  }
  for (const k of Object.keys(flags)) {
    if (!(k in truth)) { console.error(`extra key [${label}] ${k}`); bad++; }
  }
}

if (bad) process.exit(1);
console.log(
  `OK defaults ↔ ${copies.length} copies (${Object.keys(truth).length} keys):`,
  copies.map((c) => c.label).join(', ')
);
