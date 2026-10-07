/**
 * A SEEDED HOST MUST CARRY THE HEADER THAT JUSTIFIES IT.
 *
 *   node test/cspseed.mjs
 *
 * [FIX the-first-visit-paid-for-a-policy-this-tree-had-already-measured] pre-populates the
 * blob-refusing list with two hosts, so the first visit to them in a fresh profile keeps its
 * worker instead of losing it and printing mw-bundle.js as the cause. A seed is a claim about
 * a policy served by somebody else, which is the kind of claim that rots quietly: the host
 * relaxes its CSP, or the predicate that reads it is narrowed, and the seed goes on standing
 * the window down for a reason that stopped being true. Nothing else in the suite would
 * notice, because a wrongly-seeded host behaves exactly like a correctly-learned one.
 *
 * So every seed records the policy it was measured from, and this file runs the SHIPPED
 * predicate over it. The seed and its evidence then go stale together, and the failure names
 * the host.
 *
 * THE PREDICATE IS LIFTED, NOT RE-IMPLEMENTED — _cspListBlocksBlobWorkers out of mw-core.js
 * between the markers test/background-fns.mjs already uses. A second copy of the parser here
 * could agree with this list forever while the shipped one disagreed with both.
 *
 * This is the file that caught the first draft of the list. Read as one joined header,
 * youtube.com's script-src carries 'strict-dynamic' — which ADMITS a blob: worker — and the
 * host looked like it did not belong. It sends three policies, a blob: worker has to satisfy
 * every one of them, and the first has no blob: and no 'strict-dynamic'. Eyeballing one
 * directive is exactly the mistake the evidence requirement exists to prevent.
 */
import { harness, read, loadBackground, mockChrome } from './harness.mjs';

const { assert, eq, section, note, done } = harness();

// ── the shipped predicate, lifted ──────────────────────────────────────────────
const core = read('mw/mw-core.js');
const BEGIN = '// ---- lifted by test/background-fns.mjs: begin ----';
const END = '// ---- lifted by test/background-fns.mjs: end ----';
assert(core.indexOf(BEGIN) !== -1 && core.indexOf(END) !== -1,
  'the lift markers are still in mw/mw-core.js — if they were renamed this file is ' +
  'silently testing nothing, so it fails here rather than passing empty');
const lifted = core.slice(core.indexOf(BEGIN) + BEGIN.length, core.indexOf(END));
const blocks = new Function(lifted + ';return _cspListBlocksBlobWorkers;')();

const { CSP_NOBLOB_SEEDS, afpNoBlobScopes } =
  loadBackground(['CSP_NOBLOB_SEEDS', 'afpNoBlobScopes'], { chrome: mockChrome({}).chrome });

// ── the control: the predicate is not a constant ───────────────────────────────
//
// Every assertion below is "blocks === true", and the cheap way for all of them to pass is a
// predicate that answers true to everything. These two say it discriminates, on policies
// shaped like the seeds rather than on toys.
section('0) the predicate still says no somewhere');
eq(blocks("worker-src 'self' blob:"), false,
  'a worker-src that names blob: does NOT block — otherwise every seed below passes for ' +
  'the wrong reason and so would a host that must never be seeded');
eq(blocks("script-src 'strict-dynamic' https:"), false,
  "and neither does a script-src fallback carrying 'strict-dynamic', which admits a blob: " +
  'worker — the exact shape that made youtube.com look unseedable');
eq(blocks("worker-src 'self'"), true, "while worker-src 'self' alone does block");

// ── the seeds ──────────────────────────────────────────────────────────────────
section('1) every seed is justified by the policy recorded with it');
assert(Array.isArray(CSP_NOBLOB_SEEDS) && CSP_NOBLOB_SEEDS.length > 0,
  `the seed list is a non-empty array (${CSP_NOBLOB_SEEDS.length} entries)`);
for (const s of CSP_NOBLOB_SEEDS) {
  assert(typeof s.csp === 'string' && s.csp.trim() !== '',
    `${s.host}: records the policy it was measured from`);
  eq(blocks(s.csp), true,
    `${s.host}: that policy refuses a blob: worker, by the shipped predicate — if this ` +
    'fails the host either relaxed its CSP or the predicate changed, and either way the ' +
    'seed is now standing the window down for a reason that is no longer true');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(s.measured)),
    `${s.host}: carries the date it was measured (${s.measured})`);
}

// ── the shape, because a bad entry takes the whole registration with it ────────
//
// afpCspScopePatterns skips an entry carrying pattern syntax rather than risk the
// registration, and chrome.scripting rejects a malformed match outright — which would take
// noblob.js down for every learned host too, turning one bad seed into a total loss.
section('2) every seed is a bare host a match pattern can be built from');
const seen = new Set();
for (const s of CSP_NOBLOB_SEEDS) {
  const h = s.host;
  assert(typeof h === 'string' && h !== '', 'the host is a non-empty string');
  eq(h, String(h).toLowerCase(), `${h}: lower case, as the observer compares them`);
  assert(h.indexOf('/') === -1, `${h}: a bare host, not a route — a seed covers every route`);
  assert(!/[*?\s]/.test(h), `${h}: no pattern syntax`);
  assert(h.indexOf('.') > 0, `${h}: looks like a hostname`);
  assert(!seen.has(h), `${h}: listed once`);
  seen.add(h);
}

// ── and the three ways out, which are what make a seed safe to ship ────────────
section('3) a seed is earlier than learning, not stronger than it');
{
  const host = CSP_NOBLOB_SEEDS[0].host;

  const plain = loadBackground(['afpNoBlobScopes'], { chrome: mockChrome({}).chrome });
  const got = await plain.afpNoBlobScopes();
  assert(got.indexOf(host) !== -1,
    `a fresh profile that has visited nothing already stands ${host} down (${got.join(', ')}) ` +
    '— this is the whole point: the first visit cannot be helped by anything learned on it');

  // The rewrite switch exists to make blob: workers LEGAL on a host. A seed that outlived it
  // would keep noblob.js writing the flag and keep the window standing down, which is the
  // split [FIX the-switch-created-the-split-it-was-meant-to-close] is about.
  const rw = loadBackground(['afpNoBlobScopes'],
    { chrome: mockChrome({ afp_csp_rewrite: { [host]: '' } }).chrome });
  eq((await rw.afpNoBlobScopes()).indexOf(host), -1,
    `the per-site CSP rewrite being on for ${host} drops its seed`);

  // The escape hatch. afpNoteLooseDocument marks a host mixed the first time a document of
  // it arrives with no policy, so an origin that genuinely relaxes is picked up by the same
  // observer that would have learned it — no release required.
  const mixed = loadBackground(['afpNoBlobScopes'],
    { chrome: mockChrome({ afp_csp_mixed: [host] }).chrome });
  eq((await mixed.afpNoBlobScopes()).indexOf(host), -1,
    `and a document of ${host} seen with no policy at all drops it too`);

  // A bare seed covers every route of its host, so a learned route under it is redundant.
  // Registering both would drag an extra pattern pair behind every repository github.com
  // taught us about before the seed existed.
  const warm = loadBackground(['afpNoBlobScopes'],
    { chrome: mockChrome({ afp_csp_noblob: [host + '/one', host + '/two', 'other.test/x'] }).chrome });
  const w = await warm.afpNoBlobScopes();
  eq(w.filter((e) => e.indexOf(host) === 0).join(), host,
    `routes learned under ${host} before the seed collapse into the bare entry`);
  assert(w.indexOf('other.test/x') !== -1,
    'while a learned route on an unseeded host is untouched');
  note(`seeded: ${CSP_NOBLOB_SEEDS.map((s) => s.host).join(', ')}`);
}


// ── and the objection that made seeding inadmissible in the first place ───────
//
// README "Limits", item 13 rejected a hard-coded list on two grounds. "Invented rather than measured"
// is answered by sections 1 and 2 above. The other one — that it goes stale SILENTLY and in
// the direction of losing protection, a host relaxing its CSP while we keep standing its
// window down — is answered by one clause in afpNoteCspList, and only a test of that clause
// makes the answer worth anything. The seed is NOT in the learned list, so the obvious
// reading of that function does not cover it.
section('4) a seeded host that relaxes its CSP un-seeds itself');
{
  const host = CSP_NOBLOB_SEEDS[0].host;
  const { chrome, store } = mockChrome({});
  const { afpNoteCsp, afpNoBlobScopes: scopes } =
    loadBackground(['afpNoteCsp', 'afpNoBlobScopes'], { chrome });

  assert((await scopes()).indexOf(host) !== -1, `${host} starts seeded`);

  // A policy that genuinely admits a blob: worker AND its patch: blob: in the worker source,
  // in the read (connect-src) and in the importScripts fallback (script-src). Anything less
  // still judges as blocked, which is what the negative control for the github entry showed.
  const relaxed = "worker-src 'self' blob:; connect-src 'self' blob:; script-src 'self' blob:";
  afpNoteCsp({ type: 'main_frame', tabId: 7, frameId: 0, url: `https://${host}/`,
    responseHeaders: [{ name: 'Content-Security-Policy', value: relaxed }] });
  await new Promise((r) => setTimeout(r, 300));

  eq((store.get('afp_csp_mixed') || []).indexOf(host) !== -1, true,
    `one response from ${host} that no longer refuses marks it mixed — through the same ` +
    'observer that would have learned it, with no release in between');
  eq((await scopes()).indexOf(host), -1,
    'and the seed is gone, so its workers are patched again and the window stops standing down');
}

done();
