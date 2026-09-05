/**
 * Generates the four country tables from data/countries.json.
 *
 * WHY
 *
 * The same 67 countries were written out in four places, in four shapes:
 *
 *   background.js   COUNTRY_DATA     code -> tz, locale, Accept-Language
 *   popup.js        COUNTRIES        code, display name, tz   (the dropdown)
 *   popup.js        LOCALE_BY_CODE   code -> locale           (what Apply stores)
 *   mw/mw-geo.js    COORDS           code -> [lat, lon]
 *
 * None of them crashes when a country is missing — every lookup falls back to US — so the
 * failure was silent and was exactly what this extension exists to prevent: Europe/Tallinn
 * on the clock, en-US out of Intl and New York coordinates from geolocation, in one page.
 * test/tables.mjs grew 1660 assertions to catch that after the fact. This removes the
 * class instead: adding a country is one JSON entry, and the four tables cannot disagree
 * because only one of them is written by hand.
 *
 * HOW
 *
 * The tables are rewritten IN PLACE, between markers, rather than moved into generated
 * files the way dyn/ does it. Deliberately: COUNTRY_DATA sits in the service worker,
 * COORDS inside an IIFE in a MAIN-world content script, and COUNTRIES next to the popup's
 * render code. Extracting them would mean new files in the manifest and a new load order
 * to get wrong — for tables that are pure data and already load fine where they are.
 *
 *   node tools/gen-tables.mjs           write the tables
 *   node tools/gen-tables.mjs --check   report drift, write nothing (exit 1 if stale)
 *
 * test/parity-static.mjs runs this in memory and fails if any file on disk differs, so an
 * edit made to a table instead of to the JSON is caught rather than shipped.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { root } from '../test/harness.mjs';

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** The single source. Key order here is the order the popup lists countries in. */
export function countries() {
  return JSON.parse(read('data/countries.json'));
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Each table: the file it lives in, the marker name, and how one row is written. */
function blocks(data) {
  const codes = Object.keys(data);
  return {
    'background.js': {
      COUNTRY_DATA: codes.map((c) => {
        const d = data[c];
        return `    ${q(c)}: { tz: ${q(d.tz)}, loc: ${q(d.loc)}, lang: ${q(d.lang)} },`;
      }).join('\n')
    },
    'popup.js': {
      COUNTRIES: codes.map((c) =>
        `  { code: ${q(c)}, name: ${q(data[c].name)}, tz: ${q(data[c].tz)} },`).join('\n'),
      // Six per line, the shape this table already had — it is a lookup nobody reads by eye.
      LOCALE_BY_CODE: codes.reduce((rows, c, i) => {
        const cell = `${c}:${q(data[c].loc)}`;
        if (i % 6 === 0) rows.push([]);
        rows[rows.length - 1].push(cell);
        return rows;
      }, []).map((r) => '  ' + r.join(',') + ',').join('\n')
    },
    'mw/mw-geo.js': {
      COORDS: codes.slice().sort().map((c) =>
        `            ${c}: [${data[c].lat}, ${data[c].lon}],`).join('\n')
    }
  };
}

/** Every generated file, as { relative path -> contents }. */
export function generate() {
  const data = countries();
  const spec = blocks(data);
  const out = {};
  for (const [file, tables] of Object.entries(spec)) {
    let src = read(file);
    for (const [name, body] of Object.entries(tables)) {
      const open = `// <generated:${name}> from data/countries.json — do not edit; run: node tools/gen-tables.mjs`;
      const close = `// </generated:${name}>`;
      const re = new RegExp(
        `([ \\t]*)// <generated:${name}>[^\\n]*\\n[\\s\\S]*?[ \\t]*// </generated:${name}>`
      );
      if (!re.test(src)) throw new Error(`${file}: no <generated:${name}> markers`);
      const indent = re.exec(src)[1];
      // Emit the file's OWN line ending. background.js is CRLF and the others are LF, so a
      // hardcoded '\n' wrote LF rows into a CRLF file — which round-trips fine until
      // something normalises the file, and then the generator reports permanent drift
      // against output nobody edited. The repo has hit this before; see the note about
      // CRLF on the payload-array check in test/parity-static.mjs.
      const nl = src.includes('\r\n') ? '\r\n' : '\n';
      const rows = body.split('\n').join(nl);
      src = src.replace(re, `${indent}${open}${nl}${rows}${nl}${indent}${close}`);
    }
    out[file] = src;
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const check = process.argv.includes('--check');
  const files = generate();
  let stale = 0;
  for (const [rel, body] of Object.entries(files)) {
    if (read(rel) === body) continue;
    stale++;
    if (check) console.error(`stale: ${rel}`);
    else { fs.writeFileSync(path.join(root, rel), body); console.log(`wrote ${rel}`); }
  }
  if (check && stale) {
    console.error(`\n${stale} file(s) out of date — run: node tools/gen-tables.mjs`);
    process.exit(1);
  }
  console.log(stale
    ? `\n${stale} file(s) updated`
    : `tables match data/countries.json (${Object.keys(countries()).length} countries)`);
}
