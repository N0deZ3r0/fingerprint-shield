/**
 * WHAT THE SHIELD ACTUALLY CHANGED, ACCORDING TO SOMETHING THAT IS NOT THE SHIELD.
 *
 *   node tools/oracle-diff.mjs <on.txt> <off.txt>
 *
 * Every suite in test/ drives the Chromium Playwright ships, because branded Chrome has
 * refused --load-extension since 136. So the browser this extension is actually installed in
 * is the one browser nothing measures, and the cost is on record: of six defects found in the
 * Chrome 152 audit, four were invisible to every suite.
 *
 * The observer extension the author wrote closes that gap from the other side. It records
 * what a site READ — the surface, the source that read it, and the value it got — in the real
 * browser, on a real site. Two of its reports, one with this extension enabled and one with
 * it disabled, are a clean-vs-patched comparison that no rig here can produce.
 *
 * WHAT THIS PRINTS, and the order matters:
 *
 *   UNCHANGED   a value the site read identically both ways. This is the interesting half:
 *               every one is something we may believe we spoof and do not.
 *   CHANGED     the spoof took. Listed with both values, because "it changed" is not the
 *               same as "it changed to something plausible".
 *   ONLY ON / ONLY OFF   a surface read in one run and not the other. Usually the site taking
 *               a different path, sometimes us provoking or suppressing a read.
 *
 * IT REPORTS WHAT IT COULD NOT PARSE. The input is a report pasted as text, its shape is not
 * a contract, and a parser that silently drops half the lines would produce a short, clean,
 * wrong answer — the exact failure this project keeps finding in its own instruments. Lines
 * that look like a reading and did not parse are counted and shown.
 */
import { readFileSync } from 'node:fs';

const [onPath, offPath] = process.argv.slice(2);
if (!onPath || !offPath) {
  console.error('usage: node tools/oracle-diff.mjs <report-with-shield-on.txt> <report-with-shield-off.txt>');
  process.exit(2);
}

// Values that CANNOT match between two runs and mean nothing when they differ: noise is
// per-domain-seeded and re-drawn, timings are timings, and ids are minted per visit.
const VOLATILE = /canvas|audio|toDataURL|getImageData|getChannelData|seed|hash|Worker|blob:|cookie|indexedDB|localStorage|sessionStorage|matchMedia|script\.src|permissions\.query/i;

/**
 * The readings in one report: surface -> the value the site got.
 *
 * Two shapes carry a value. The summary block at the top states a fact and its value on the
 * next line ("Сайт узнал ваш часовой пояс" / "Europe/Tallinn"); the detailed log names a
 * surface and then "результат: X". Both are read, because the summary covers things the log
 * only implies.
 */
function parse(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const readings = new Map();
  const unparsed = [];
  let surface = null;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;

    // "0.47 сnavigator.hardwareConcurrency" — a timestamp glued to a surface name.
    const m = l.match(/^\d+\.\d+\s*с([A-Za-z][\w.]*(?:\.[\w]+)*)(?:×\d+)?$/);
    if (m) { surface = m[1]; continue; }

    // The value line is either "результат: X" or "аргумент: … · результат: X" — the second
    // shape is how every call that takes arguments reports, and dropping it lost canvas,
    // matchMedia and the whole WebGL extension sweep on the first test of this parser.
    const res = l.match(/(?:^|·\s*)результат:\s*(.+)$/);
    if (res && surface) {
      // First reading wins: a surface read many times should agree with itself, and if it
      // does not, that is a finding of its own rather than something to average away.
      if (!readings.has(surface)) readings.set(surface, res[1].trim());
      surface = null;
      continue;
    }

    // The summary block: a sentence, then the value alone on the next line.
    // "Сайт узнал ваш часовой пояс" and "Сайт узнал, сколько ядер…" — the comma form was
    // dropped by requiring whitespace, which quietly lost cores and memory.
    const said = l.match(/^Сайт узнал(?:а)?[,:]?\s+(.+?)$/);
    if (said && lines[i + 1] && !/^основание:/.test(lines[i + 1])) {
      const key = 'summary: ' + said[1].replace(/[.:]$/, '');
      if (!readings.has(key)) readings.set(key, lines[i + 1]);
      continue;
    }

    if (/^результат:/.test(l) && !surface) unparsed.push(l);
  }
  return { readings, unparsed };
}

const on = parse(readFileSync(onPath, 'utf8'));
const off = parse(readFileSync(offPath, 'utf8'));

console.log(`shield ON : ${on.readings.size} readings from ${onPath}`);
console.log(`shield OFF: ${off.readings.size} readings from ${offPath}`);
if (on.unparsed.length || off.unparsed.length) {
  console.log(`could not attribute ${on.unparsed.length + off.unparsed.length} "результат:" line(s) ` +
    'to a surface — the answer below is missing them');
}
if (!on.readings.size || !off.readings.size) {
  console.error('\nnothing parsed on one side — is that the report text, whole, as the page shows it?');
  process.exit(1);
}

const all = [...new Set([...on.readings.keys(), ...off.readings.keys()])].sort();
const unchanged = [], changed = [], onlyOn = [], onlyOff = [], volatile = [];

for (const k of all) {
  const a = on.readings.get(k), b = off.readings.get(k);
  if (a === undefined) { onlyOff.push([k, b]); continue; }
  if (b === undefined) { onlyOn.push([k, a]); continue; }
  if (a === b) { (VOLATILE.test(k) ? volatile : unchanged).push([k, a]); continue; }
  changed.push([k, a, b]);
}

const show = (title, rows, fmt) => {
  console.log(`\n${title} — ${rows.length}`);
  console.log('-'.repeat(72));
  if (!rows.length) { console.log('  (none)'); return; }
  for (const r of rows) console.log('  ' + fmt(r));
};

// First, because it is the half that can be a defect.
show('UNCHANGED — the site got the same value with the shield on and off', unchanged,
  ([k, v]) => `${k.padEnd(38)} ${String(v).slice(0, 60)}`);
show('CHANGED — the spoof took (on / off)', changed,
  ([k, a, b]) => `${k.padEnd(38)} ${String(a).slice(0, 30)}   <-   ${String(b).slice(0, 30)}`);
show('ONLY WITH THE SHIELD ON', onlyOn, ([k, v]) => `${k.padEnd(38)} ${String(v).slice(0, 60)}`);
show('ONLY WITH IT OFF', onlyOff, ([k, v]) => `${k.padEnd(38)} ${String(v).slice(0, 60)}`);
show('same both ways, and expected to be — noise, storage, timings', volatile,
  ([k, v]) => `${k.padEnd(38)} ${String(v).slice(0, 60)}`);

console.log('\n' + '='.repeat(72));
console.log(`${unchanged.length} value(s) the shield did not move. Each is either something ` +
  'it never claimed to,\nor something it claims and does not — and the second kind is what ' +
  'this comparison exists for.');
