/**
 * The pure functions in background.js, which had no coverage at all.
 *
 *   node test/background-fns.mjs
 *
 * The one that matters most is registrableDomain. It decides which sites share a
 * canvas/audio/timing seed, and both ways of getting it wrong are silent:
 *
 *   too greedy  — alice.github.io and bob.github.io collapse to github.io and two
 *                 unrelated sites get the SAME noise, which is a linkable pair;
 *   too shy     — www.example.com and example.com become different domains and one
 *                 site sees its own fingerprint change as the user clicks around,
 *                 which is louder than not spoofing at all.
 *
 * Neither throws, neither shows up in any dev page, and the ~100-entry public
 * suffix list it carries is exactly the kind of table that rots. So the checks
 * below are mostly invariants over that table rather than hand-picked examples.
 */
import { harness, read, balanced, loadBackground, loadPopup, mockChrome } from './harness.mjs';

const t = harness();

const bg = loadBackground([
  'registrableDomain', 'deriveDomainSeed', 'enforceCoherence', 'afpChromeMajor',
  'isWasmEligibleUrl', 'isInjectableUrl', 'isTabInjectable', 'isErrorPageMsg',
  'WASM_SKIP_HOSTS', 'afpResolveDpr', 'AFP_PROFILE_DPR', 'afpHostMatches',
  'afpDeviceState', 'afpParseTraceCountry'
]);
const {
  registrableDomain, deriveDomainSeed, enforceCoherence, isWasmEligibleUrl,
  isInjectableUrl, isTabInjectable, isErrorPageMsg, WASM_SKIP_HOSTS
} = bg;

// ---- 0) afpResolveDpr: the record, the machine, then the width ---------------
// [FIX applying-a-profile-dropped-its-dpr] The middle step is the one that matters: a
// record stored WITHOUT dpr — every record popup.handleApply wrote before today — has to
// resolve to the ratio its machine declares, or background disagrees with dyn/ and a page
// gets whichever source reached it first.
t.section('0) afpResolveDpr');
{
  const { afpResolveDpr, AFP_PROFILE_DPR } = bg;
  const { PROFILES } = loadPopup(['PROFILES']);
  t.eq(afpResolveDpr({ screenW: 1920, dpr: 1.25 }, 'laptop_mid'), 1.25, 'the record wins when it carries a ratio');
  t.eq(afpResolveDpr({ screenW: 1920 }, 'laptop_mid'), 1, 'no dpr in the record: the machine declares 1');
  t.eq(afpResolveDpr({ screenW: 3840 }, 'pc_power'), 1, 'no dpr in the record: pc_power declares 1');
  // [FIX the-dpr-fallback-read-a-css-width-as-a-panel] These two used to demand 2 for a
  // 3840-wide record, and that is what pinned the defect in place: screenW is CSS pixels,
  // so answering 2 claimed a 7680x4320 panel. Scaling makes the CSS width SMALLER, so no
  // width implies a ratio at all, and the fallback answers 1 for every width now.
  t.eq(afpResolveDpr({ screenW: 3840 }, undefined), 1, 'unknown machine, 4K width: no ratio is implied by a width');
  t.eq(afpResolveDpr({ screenW: 1920 }, undefined), 1, 'unknown machine, 1920 width: the same');
  t.eq(afpResolveDpr({ screenW: 1366 }, undefined), 1, 'unknown machine, narrow width: the same');
  t.eq(afpResolveDpr({ screenW: 1920, dpr: 0 }, 'laptop_mid'), 1, 'a zero in the record is not a ratio');
  t.eq(afpResolveDpr(null, 'pc_gaming'), 1, 'no record at all: the machine still decides');
  // And the map is the popup's, machine by machine — the same pairing parity-static pins
  // statically, asserted here through the function that actually reads it.
  for (const p of PROFILES) {
    const want = (typeof p.dpr === 'number' && p.dpr > 0) ? p.dpr : 1;
    t.eq(afpResolveDpr({ screenW: p.screenW }, p.id), want, `${p.id}: a dpr-less record resolves to ${want}`);
    t.eq(AFP_PROFILE_DPR[p.id], want, `${p.id}: the map itself agrees`);
  }
}

// ---- 0b) afpHostMatches: one rule for both per-site lists ---------------------
// The WebRTC exceptions and the service-worker blocks now share this. A subdomain is
// covered by its parent entry, which is what makes "block example.com" mean what a user
// expects, and nothing else may be.
t.section('0b) afpHostMatches');
{
  const { afpHostMatches } = bg;
  t.eq(afpHostMatches(['example.com'], 'example.com'), true, 'the host itself');
  t.eq(afpHostMatches(['example.com'], 'www.example.com'), true, 'a subdomain');
  t.eq(afpHostMatches(['example.com'], 'a.b.example.com'), true, 'a deep subdomain');
  t.eq(afpHostMatches(['example.com'], 'notexample.com'), false, 'a name that merely ends the same way');
  t.eq(afpHostMatches(['example.com'], 'example.com.evil.net'), false, 'the entry appearing as a prefix');
  t.eq(afpHostMatches(['127.0.0.1'], '127.0.0.1'), true, 'an IP literal');
  t.eq(afpHostMatches(['127.0.0.1'], 'localhost'), false, 'localhost is a different host from 127.0.0.1');
  t.eq(afpHostMatches([], 'example.com'), false, 'an empty list matches nothing');
  t.eq(afpHostMatches(['', null, 5], 'example.com'), false, 'junk entries match nothing');
  t.eq(afpHostMatches(null, 'example.com'), false, 'no list at all');
  t.eq(afpHostMatches(['example.com'], ''), false, 'no host at all');
}

// ---- 1) registrableDomain: worked examples ----------------------------------
t.section('1) registrableDomain');
const CASES = [
  // plain
  ['example.com', 'example.com'],
  ['www.example.com', 'example.com'],
  ['a.b.c.example.com', 'example.com'],
  ['example.io', 'example.io'],
  // case and brackets are normalised
  ['WWW.EXAMPLE.COM', 'example.com'],
  ['Example.Com', 'example.com'],
  // multi-label public suffixes from the MULTI table
  ['example.co.uk', 'example.co.uk'],
  ['www.example.co.uk', 'example.co.uk'],
  ['a.b.example.co.uk', 'example.co.uk'],
  ['shop.example.co.jp', 'example.co.jp'],
  ['www.example.com.br', 'example.com.br'],
  ['site.example.com.au', 'example.com.au'],
  // private suffixes: every user must get their own domain
  ['alice.github.io', 'alice.github.io'],
  ['docs.alice.github.io', 'alice.github.io'],
  ['my-app.vercel.app', 'my-app.vercel.app'],
  ['preview.my-app.vercel.app', 'my-app.vercel.app'],
  ['thing.pages.dev', 'thing.pages.dev'],
  // hosts with no registrable domain to speak of
  ['localhost', 'localhost'],
  ['127.0.0.1', '127.0.0.1'],
  ['192.168.1.10', '192.168.1.10'],
  ['[::1]', '::1'],
  ['fe80::1', 'fe80::1'],
  // a bare public suffix is returned as-is rather than throwing
  ['co.uk', 'co.uk'],
  ['com', 'com']
];
for (const [input, want] of CASES) t.eq(registrableDomain(input), want, `registrableDomain(${JSON.stringify(input)})`);

// Empty / missing input must not throw and must not return undefined: the result is
// fed straight into a string hash.
for (const bad of ['', null, undefined, 0, NaN, {}, []]) {
  const got = registrableDomain(bad);
  t.assert(typeof got === 'string' && got.length > 0, `registrableDomain(${String(bad)}) returns a non-empty string (got ${JSON.stringify(got)})`);
}

// ---- 2) registrableDomain over its own suffix table --------------------------
// Every entry in MULTI must behave like a public suffix: one label below it is a
// registrable domain, and two labels below it collapse to that same domain. A typo in
// a key, or a value of 3 where 2 was meant, breaks one of these.
t.section('2) registrableDomain vs its own MULTI table');
// The table lives in seed-lib.js, which background.js and storage-bridge.js both load —
// it was written out in each of them until the copies were merged. registrableDomain
// itself still arrives through loadBackground above, because importScripts shares one
// global scope and test/harness.mjs inlines the library the same way it inlines
// defaults.js, so the assertions below exercise the real function, not a re-parse.
const MULTI = eval('(' + balanced(read('seed-lib.js'), /var MULTI = \{/, '{', '}') + ')');
t.assert(Object.keys(MULTI).length > 50, `MULTI table found (${Object.keys(MULTI).length} entries)`);
for (const suffix of Object.keys(MULTI)) {
  t.eq(MULTI[suffix], 2, `${suffix}: label count is 2 (the lookup loop only ever finds 2- and 3-label keys)`);
  t.eq(registrableDomain('site.' + suffix), 'site.' + suffix, `site.${suffix} is its own registrable domain`);
  t.eq(registrableDomain('www.site.' + suffix), 'site.' + suffix, `www.site.${suffix} folds into site.${suffix}`);
  t.eq(registrableDomain('a.b.site.' + suffix), 'site.' + suffix, `a.b.site.${suffix} folds into site.${suffix}`);
  // Two tenants under one suffix must never collide.
  t.assert(registrableDomain('alice.' + suffix) !== registrableDomain('bob.' + suffix),
    `alice.${suffix} and bob.${suffix} stay apart`);
}

// ---- 3) deriveDomainSeed -----------------------------------------------------
t.section('3) deriveDomainSeed');
const MASTER = 0x1234abcd;

// Same site, any subdomain, any casing → one seed. This is what keeps a single site's
// canvas hash stable while the user navigates it.
const sameSite = ['example.com', 'www.example.com', 'shop.example.com', 'a.b.example.com', 'WWW.EXAMPLE.COM'];
const first = deriveDomainSeed(MASTER, sameSite[0]);
for (const h of sameSite) t.eq(deriveDomainSeed(MASTER, h), first, `${h} shares the seed of example.com`);

// Different sites → different seeds. Includes the pairs the suffix table exists for.
const distinct = [
  'example.com', 'example.net', 'example.co.uk', 'other.co.uk', 'example.com.br',
  'alice.github.io', 'bob.github.io', 'a.vercel.app', 'b.vercel.app',
  'localhost', '127.0.0.1', '192.168.1.10', 'google.com', 'gmail.com'
];
const bySeed = new Map();
for (const h of distinct) {
  const s = deriveDomainSeed(MASTER, h);
  t.assert(Number.isInteger(s) && s >= 0 && s <= 0xFFFFFFFF, `${h}: seed is a uint32 (got ${s})`);
  t.assert(!bySeed.has(s), `${h}: seed differs from ${bySeed.get(s)}`);
  bySeed.set(s, h);
}

// A different master seed must move every domain, or reinstalling changes nothing.
let moved = 0;
for (const h of distinct) if (deriveDomainSeed(MASTER, h) !== deriveDomainSeed(0x0BADF00D, h)) moved++;
t.eq(moved, distinct.length, 'every domain seed follows the master seed');

// Non-numeric master must not poison the hash into a constant.
for (const junk of [undefined, null, NaN, Infinity, 'abc', {}]) {
  const a = deriveDomainSeed(junk, 'example.com');
  const b = deriveDomainSeed(junk, 'example.net');
  t.assert(Number.isInteger(a) && a !== b, `master=${String(junk)}: still a uint32 and still per-domain`);
}
t.eq(deriveDomainSeed(undefined, 'example.com'), deriveDomainSeed(null, 'example.com'),
  'the non-numeric master fallback is one fixed value');

// ---- 3b) afpDeviceState ------------------------------------------------------
// [FIX device-state-was-per-domain] The property that matters is the one the old code
// broke: these values must NOT vary with the site. They used to be derived in the page
// from profile.noiseSeed, which injectProfile replaces with deriveDomainSeed(master,
// host) — so one laptop reported battery 0.90 to example.com and 0.93 to another origin
// in the same minute, and two positions 1.2 km apart. Here the input is the MASTER seed,
// and the test is that feeding it any domain seed changes the answer while the master
// alone decides it.
t.section('3b) afpDeviceState');
{
  const { afpDeviceState } = bg;
  const KEYS = ['batteryLevel', 'batteryCharging', 'batteryChargingTime',
    'batteryDischargingTime', 'geoOffsetLat', 'geoOffsetLon', 'geoAccuracy'];

  // Identical for every host, because the host is not an input at all.
  const ref = JSON.stringify(afpDeviceState(MASTER, 'laptop_mid'));
  for (const h of ['example.com', '127.0.0.1', 'google.com', 'a.vercel.app']) {
    t.eq(JSON.stringify(afpDeviceState(MASTER, 'laptop_mid')), ref,
      `same master → same device state regardless of ${h}`);
    // The old inputs: had these been passed, the answer would move per site.
    t.assert(JSON.stringify(afpDeviceState(deriveDomainSeed(MASTER, h), 'laptop_mid')) !== ref,
      `${h}: a per-domain seed produces a DIFFERENT state — which is the bug being fixed`);
  }

  for (const k of KEYS) {
    t.assert(Object.prototype.hasOwnProperty.call(afpDeviceState(MASTER, 'laptop_mid'), k),
      `carries ${k}`);
  }

  // Desktops are mains-powered — same rule buildProfile uses for hasBluetooth.
  for (const id of ['pc_gaming', 'pc_power']) {
    const d = afpDeviceState(MASTER, id);
    t.eq(d.batteryLevel, 1, `${id}: level 1`);
    t.eq(d.batteryCharging, true, `${id}: charging`);
    t.eq(d.batteryChargingTime, 0, `${id}: nothing left to charge`);
    t.eq(d.batteryDischargingTime, null, `${id}: dischargingTime is Infinity (null on the wire)`);
  }

  // Invariants over many installs, laptops only.
  const levels = new Set(), lats = new Set(), lons = new Set();
  let charging = 0, discharging = 0;
  for (let i = 0; i < 400; i++) {
    const d = afpDeviceState(Math.imul(i + 1, 0x9E3779B1) >>> 0, 'laptop_mid');
    t.assert(d.batteryLevel >= 0.62 && d.batteryLevel <= 0.94, `level ${d.batteryLevel} in the laptop band`);
    t.assert(d.geoAccuracy >= 50 && d.geoAccuracy <= 89, `accuracy ${d.geoAccuracy} in range`);
    t.assert(Math.abs(d.geoOffsetLat) <= 0.01 && Math.abs(d.geoOffsetLon) <= 0.01,
      'offset stays inside ±0.01°');
    // Exactly one of the two times is finite, and it is the one the state implies.
    if (d.batteryCharging) {
      charging++;
      t.assert(d.batteryDischargingTime === null && typeof d.batteryChargingTime === 'number',
        'charging: chargingTime finite, dischargingTime infinite');
    } else {
      discharging++;
      t.assert(d.batteryChargingTime === null && typeof d.batteryDischargingTime === 'number',
        'discharging: dischargingTime finite, chargingTime infinite');
    }
    levels.add(d.batteryLevel); lats.add(d.geoOffsetLat); lons.add(d.geoOffsetLon);
  }
  t.assert(charging > 0 && discharging > 0, 'both charging states occur across installs');
  // The coarse grid is the whole reason unifying these across origins is safe: a value
  // that is identical everywhere is a cross-site identifier, so it must carry little.
  t.assert(lats.size <= 20 && lons.size <= 20,
    `geo offset stays on the 20-step grid (${lats.size}x${lons.size}) — not the old 1000`);
  t.assert(levels.size <= 33, `battery level stays on its 33-step grid (${levels.size})`);

  // Junk master must still answer, and answer one fixed way.
  for (const junk of [undefined, null, NaN, 'abc', {}]) {
    const d = afpDeviceState(junk, 'laptop_mid');
    t.assert(typeof d.batteryLevel === 'number' && isFinite(d.batteryLevel),
      `master=${String(junk)}: still a usable level`);
  }
}

// ---- 3c) afpParseTraceCountry -------------------------------------------------
// The value this returns is compared against COUNTRY_DATA keys and, on a mismatch, told to
// the user as "your VPN is somewhere else". Both failure directions are bad and neither is
// loud: a false positive nags about a mismatch that does not exist, a false negative leaves
// the one axis the extension cannot otherwise see unchecked. So the parser is strict and
// the strictness is pinned here rather than trusted.
t.section('3c) afpParseTraceCountry');
{
  const { afpParseTraceCountry: P } = bg;
  const REAL = [
    'fl=152f77', 'h=www.cloudflare.com', 'ip=203.0.113.7', 'ts=1787336509.000',
    'visit_scheme=https', 'uag=curl/8.21.0', 'colo=TLL', 'sliver=025-canary-cloudflare',
    'http=http/1.1', 'loc=EE', 'tls=TLSv1.3', 'sni=plaintext', 'warp=off', 'gateway=off'
  ].join('\n') + '\n';

  t.eq(P(REAL), 'EE', 'a real cdn-cgi/trace body yields its loc');
  t.eq(P('loc=de\n'), 'DE', 'a lowercase code is upper-cased');
  t.eq(P('a\nloc=US\nb'), 'US', 'found in the middle of the body');
  t.eq(P('loc=EE'), 'EE', 'found with no trailing newline');
  t.eq(P('loc=EE\r\n'), 'EE', 'CRLF is tolerated');

  // Cloudflare answers loc=XX when it cannot place the address. XX is not a country, and
  // reporting it would show the user a mismatch against a place that does not exist.
  t.eq(P('loc=XX\n'), '', 'loc=XX means "unknown", not a country');

  // Anything not exactly two letters is refused rather than trimmed into shape: a value
  // that matches no COUNTRY_DATA key is indistinguishable from "no answer" downstream, so
  // it must BE "no answer" here.
  for (const junk of ['loc=E\n', 'loc=EEE\n', 'loc=\n', 'loc=1E\n', 'loc=E1\n', 'loc= EE\n'])
    t.eq(P(junk), '', `${JSON.stringify(junk)} is refused`);

  // `loc=` must be a whole line, or a key that merely ends in "loc" would answer for it.
  t.eq(P('xloc=EE\n'), '', 'a key ending in loc does not match');
  t.eq(P('colo=TLL\nloc=EE\n'), 'EE', 'colo does not shadow loc');
  t.eq(P('colo=TLL\n'), '', 'colo alone yields nothing');

  for (const empty of ['', null, undefined, {}, 0])
    t.eq(P(empty), '', `${String(empty)} yields no country`);
}

// ---- 4) enforceCoherence -----------------------------------------------------
t.section('4) enforceCoherence');
t.assert(JSON.stringify(enforceCoherence(null)) === '{}', 'null → {}');
t.assert(JSON.stringify(enforceCoherence(undefined)) === '{}', 'undefined → {}');
t.assert(enforceCoherence({ gpu: 'intel_iris' }) !== null, 'a partial profile is accepted');
// A truthy non-object is passed straight back rather than replaced with {}. That is
// harmless where it is called — buildProfile reads five fields off the result and each
// one has its own `|| default` — so this records the behaviour instead of asserting a
// tidier one the code does not have.
for (const junk of ['nope', 42, true]) {
  t.eq(enforceCoherence(junk), junk, `a truthy non-object (${JSON.stringify(junk)}) is returned unchanged`);
  let threw = false;
  try { enforceCoherence(junk); } catch { threw = true; }
  t.assert(!threw, `enforceCoherence(${JSON.stringify(junk)}) does not throw`);
}

// Documented repair: 4 GB rules out a discrete card, so the whole machine steps down.
const downgraded = enforceCoherence({ gpu: 'nvidia_3070', cores: 16, memory: 4, screenW: 3840, screenH: 2160 });
t.assert(downgraded.gpu !== 'nvidia_3070' || downgraded.memory >= 16,
  `a 4 GB RTX 3070 is repaired (got ${JSON.stringify(downgraded)})`);

// Input matrix: every combination the storage could hold, including ones the popup
// cannot produce (an older build, a hand-edited storage entry, a partially written
// profile). The point is the post-conditions, which must hold for all of them.
const gpus = ['intel_uhd', 'intel_iris', 'nvidia_3060', 'nvidia_3070', 'unknown_gpu', undefined];
const coreOpts = [1, 2, 4, 8, 12, 16, 32, undefined];
const memOpts = [1, 2, 4, 8, 16, 32, 64, undefined];
const screens = [[1024, 768], [1366, 768], [1920, 1080], [2560, 1440], [3840, 2160], [undefined, undefined]];
let combos = 0, notIdempotent = 0, incomplete = 0, brokenRule = 0, firstBroken = '';
let nvidiaLowMem = 0;
for (const gpu of gpus) for (const cores of coreOpts) for (const memory of memOpts) for (const [screenW, screenH] of screens) {
  combos++;
  const input = { gpu, cores, memory, screenW, screenH, platform: 'Win32' };
  const out = enforceCoherence(input);

  // The caller (buildProfile) reads all five fields straight out of the result.
  if (!out.gpu || !out.cores || !out.memory || !out.screenW || !out.screenH) incomplete++;

  // Repairing an already-repaired profile must change nothing, or the reported machine
  // depends on how many times the profile happened to pass through here.
  const twice = enforceCoherence(out);
  for (const k of ['gpu', 'cores', 'memory', 'screenW', 'screenH']) {
    if (out[k] !== twice[k]) notIdempotent++;
  }

  // Coherence rules, restated as post-conditions.
  const bad =
    (out.cores >= 12 && out.memory < 16) ? 'cores>=12 with <16 GB' :
    (out.screenW >= 3840 && out.cores < 8) ? '4K with <8 cores' :
    (out.screenW >= 3840 && out.memory < 16) ? '4K with <16 GB' :
    (out.memory <= 4 && out.cores > 8) ? '<=4 GB with >8 cores' : '';
  if (bad) {
    brokenRule++;
    if (!firstBroken) firstBroken = `${bad} — ${JSON.stringify(input)} → ${JSON.stringify(out)}`;
  }
  if (out.memory <= 4 && (out.gpu === 'nvidia_3060' || out.gpu === 'nvidia_3070')) nvidiaLowMem++;

  // Untouched fields must survive.
  if (out.platform !== 'Win32') brokenRule++;
}
t.assert(combos > 1000, `matrix covers ${combos} profiles`);
t.eq(incomplete, 0, 'every result has all five hardware fields set');
t.eq(notIdempotent, 0, 'enforceCoherence is idempotent across the matrix');
t.eq(brokenRule, 0, `every result satisfies the coherence rules${firstBroken ? ' — first miss: ' + firstBroken : ''}`);
t.eq(nvidiaLowMem, 0, 'no result pairs a discrete NVIDIA card with <=4 GB of RAM');

// ---- 5) afpChromeMajor -------------------------------------------------------
t.section('5) afpChromeMajor');
// The result is concatenated into the UA string and into the DNR sec-ch-ua brand list,
// so it has to be a bare major number whatever navigator says.
const uaCases = [
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36', '151'],
  ['Mozilla/5.0 Chrome/99.0.1234.56 Safari/537.36', '99'],
  ['Mozilla/5.0 (X11; Linux x86_64) Chrome/200.0.0.0', '200']
];
for (const [ua, want] of uaCases) {
  const { afpChromeMajor } = loadBackground(['afpChromeMajor'], { ua });
  t.eq(afpChromeMajor(), want, `afpChromeMajor() on "${ua.slice(0, 40)}…"`);
}
for (const ua of ['', 'Mozilla/5.0 Firefox/128.0', 'throw', null]) {
  const { afpChromeMajor } = loadBackground(['afpChromeMajor'], { ua });
  const got = afpChromeMajor();
  t.assert(/^\d+$/.test(got), `afpChromeMajor() falls back to a bare number for ua=${JSON.stringify(ua)} (got ${JSON.stringify(got)})`);
}

// ---- 6) URL and tab guards ---------------------------------------------------
t.section('6) isInjectableUrl / isWasmEligibleUrl / isTabInjectable');
for (const [url, want] of [
  ['http://example.com/', true],
  ['https://example.com/', true],
  ['https://example.com', true],
  ['chrome://extensions', false],
  ['chrome-error://chromewebdata/', false],
  ['file:///C:/x.html', false],
  ['about:blank', false],
  ['devtools://devtools/bundled/x.html', false],
  ['ftp://example.com/', false],
  ['', false],
  [undefined, false],
  [null, false]
]) t.eq(!!isInjectableUrl(url), want, `isInjectableUrl(${JSON.stringify(url)})`);

for (const [url, want] of [
  ['https://example.com/', true],
  ['http://example.com/', true],
  ['https://notgoogle.com/', true],
  ['https://google.com.example.net/', true],
  ['https://google.com/', false],
  ['https://www.google.com/', false],
  ['https://mail.google.com/', false],
  ['https://eu.battle.net/', false],
  ['chrome://extensions', false],
  ['not a url', false],
  ['', false],
  [undefined, false]
]) t.eq(!!isWasmEligibleUrl(url), want, `isWasmEligibleUrl(${JSON.stringify(url)})`);

// The skip list is only useful if every entry actually skips, including its subdomains.
for (const host of WASM_SKIP_HOSTS) {
  t.eq(isWasmEligibleUrl('https://' + host + '/'), false, `WASM skipped on ${host}`);
  t.eq(isWasmEligibleUrl('https://sub.' + host + '/'), false, `WASM skipped on sub.${host}`);
  t.eq(isWasmEligibleUrl('https://' + host + '.evil.example/'), true, `${host}.evil.example is NOT treated as ${host}`);
}

const okTab = { url: 'https://example.com/', status: 'complete', discarded: false };
for (const [tab, want, why] of [
  [okTab, true, 'a loaded http tab'],
  [{ ...okTab, status: 'loading' }, false, 'still loading'],
  [{ ...okTab, discarded: true }, false, 'discarded'],
  [{ ...okTab, url: 'chrome-error://chromewebdata/' }, false, 'error page'],
  [{ ...okTab, url: 'chrome://extensions' }, false, 'chrome:// page'],
  [{ url: 'https://example.com/' }, false, 'no status field'],
  [{}, false, 'empty object'],
  [null, false, 'null'],
  [undefined, false, 'undefined']
]) t.eq(!!isTabInjectable(tab), want, `isTabInjectable — ${why}`);

// ---- 7) isErrorPageMsg -------------------------------------------------------
t.section('7) isErrorPageMsg');
// These are the literal Chrome messages the injector swallows instead of logging.
for (const msg of [
  'Frame with ID 0 is showing error page',
  'The extensions gallery cannot be scripted.',
  'Cannot access contents of the page.',
  'Cannot access a chrome:// URL',
  'No tab with id: 42.'
]) t.assert(!!isErrorPageMsg(msg), `swallowed: ${msg}`);

for (const msg of [
  'Extension context invalidated.',
  'Could not establish connection. Receiving end does not exist.',
  'Something else went wrong',
  ''
]) t.assert(!isErrorPageMsg(msg), `still reported: ${JSON.stringify(msg)}`);

for (const msg of [null, undefined]) {
  let threw = false;
  try { isErrorPageMsg(msg); } catch { threw = true; }
  t.assert(!threw && !isErrorPageMsg(msg), `isErrorPageMsg(${String(msg)}) is falsy and does not throw`);
}

// ---- 6) storage schema migrations -------------------------------------------
// afpMigrateStorage is a pure function on a storage snapshot, which is the whole reason it
// can be tested at all: the conversion it replaces lived inline in initDefaults and was
// reachable only from a live service worker, so the one migration this extension had
// shipped for its whole life without a single assertion.
t.section('6) afpMigrateStorage');
{
  const { afpMigrateStorage, AFP_SCHEMA_VERSION, AFP_SCHEMA_KEY } =
    loadBackground(['afpMigrateStorage', 'AFP_SCHEMA_VERSION', 'AFP_SCHEMA_KEY']);

  t.assert(typeof AFP_SCHEMA_VERSION === 'number' && AFP_SCHEMA_VERSION >= 1,
    `AFP_SCHEMA_VERSION is a number (${AFP_SCHEMA_VERSION})`);

  // The removed modes convert, and the version is stamped so it happens once.
  for (const [was, want] of [['maximum', 'normal'], ['max', 'normal'], ['hidden', 'stealth']]) {
    const got = afpMigrateStorage({ afp_mode: was });
    t.eq(got && got.afp_mode, want, `mode ${was} migrates to ${want}`);
    t.eq(got && got[AFP_SCHEMA_KEY], AFP_SCHEMA_VERSION, `${was}: the new version is written`);
  }

  // A mode that is already current must be left ALONE — a migration that rewrites a good
  // value is how a "fix" turns into a setting that silently resets on every update.
  for (const keep of ['normal', 'stealth']) {
    const got = afpMigrateStorage({ afp_mode: keep });
    t.assert(got && !('afp_mode' in got), `mode ${keep} is not touched, only the version is stamped`);
  }

  // Idempotent: once stamped, there is nothing to do, and the caller must not write.
  t.eq(afpMigrateStorage({ [AFP_SCHEMA_KEY]: AFP_SCHEMA_VERSION, afp_mode: 'normal' }), null,
    'an install already at the current version needs no write');
  t.eq(afpMigrateStorage({ [AFP_SCHEMA_KEY]: AFP_SCHEMA_VERSION + 5 }), null,
    'a version from a NEWER build is left alone rather than downgraded');

  // A fresh install (no version key at all) is version 0 and gets stamped, so the next
  // startup does no work.
  const fresh = afpMigrateStorage({});
  t.eq(fresh && fresh[AFP_SCHEMA_KEY], AFP_SCHEMA_VERSION, 'a fresh install is stamped');
  t.eq(afpMigrateStorage(fresh), null, 'and stamping it is enough — the second run is a no-op');

  // Garbage in must not throw: this runs on data written by builds that no longer exist.
  for (const junk of [null, undefined, { [AFP_SCHEMA_KEY]: 'not a number' }, { afp_mode: 42 }]) {
    let threw = null;
    try { afpMigrateStorage(junk); } catch (e) { threw = e; }
    t.assert(!threw, `afpMigrateStorage(${JSON.stringify(junk)}) does not throw`);
  }
}

// ---- afpCspRestrictsTrustedTypes ---------------------------------------------
// [FIX tt-policy-name-was-probed-by-trying-it] This decides whether mw-workers may call
// createPolicy at all. Getting it wrong in the permissive direction re-creates the bug —
// a rejected createPolicy REPORTS a violation naming mw-bundle.js before it throws, and no
// try/catch can undo a report. Getting it wrong the other way silently stops patching
// workers on pages that would have allowed us.
{
  t.section('afpCspRestrictsTrustedTypes');
  const { afpCspRestrictsTrustedTypes: R } = loadBackground(['afpCspRestrictsTrustedTypes']);
  const ROWS = [
    // [header value, restricts?, what it is]
    ['trusted-types Kssz2 default', true, "claude.ai's real header: an allowlist we are not on"],
    ['trusted-types *', false, 'a wildcard admits any name, including ours'],
    ['trusted-types', true, 'a bare directive admits none'],
    ['trusted-types none', true, "'none' is the empty list spelled out"],
    ["script-src 'self'; trusted-types foo; require-trusted-types-for 'script'", true,
      'found among other directives'],
    ["script-src 'self'", false, 'no trusted-types directive at all'],
    ["require-trusted-types-for 'script'", false,
      'enforcement WITHOUT an allowlist — youtube.com: any name may be created, so we may wrap'],
    ["script-src 'self', trusted-types abc", true, 'a second comma-separated policy'],
    ['TRUSTED-TYPES *', false, 'directive names are case-insensitive'],
    ['trusted-types  a  b  ', true, 'extra whitespace'],
    ['', false, 'empty header'],
    ['default-src *', false, 'unrelated directive'],
  ];
  for (const [value, want, why] of ROWS) {
    t.eq(R(value), want, `${why} — ${JSON.stringify(value).slice(0, 60)}`);
  }
  for (const junk of [null, undefined, 0, {}]) {
    t.eq(R(junk), false, `${String(junk)} restricts nothing`);
  }
  // The distinction the whole fix turns on, stated as its own row: youtube enforces Trusted
  // Types but names no allowlist, claude.ai names one. Same feature, opposite answers.
  t.assert(R("require-trusted-types-for 'script'") === false &&
           R("trusted-types Kssz2 default; require-trusted-types-for 'script'") === true,
    'enforcement alone is not a restriction; an allowlist is');
}

// ---- afpCspBlocksBlobWorkers -------------------------------------------------
//
// This decides whether mw/mw-workers.js may patch an origin's workers at all, and being
// wrong is silent in both directions: say "blocked" when it is not and the worker scope
// answers with the HOST's machine while the window answers with the profile's — the scope
// mismatch a fingerprinter looks for; say "allowed" when it is not and the page's first
// worker is built from a blob, refused, and dies with an EMPTY error message, which on a
// site whose first worker IS the application means the site does not start.
//
// Every row below was measured in Chromium before it was written down — one single-policy
// page per row, `new Worker(<blob URL>)`, and whether it reports back. None of it is inferred
// from the spec, because two of the answers are not what the spec reads like.
{
  t.section('afpCspBlocksBlobWorkers');
  const { afpCspBlocksBlobWorkers } = loadBackground(['afpCspBlocksBlobWorkers']);

  const ROWS = [
    // [header value, blocks?, what was measured]
    ["script-src 'nonce-N'", true, 'no blob:, no strict-dynamic'],
    ["script-src 'self' 'unsafe-inline'", true, "'self' does not cover blob:"],
    ["script-src 'nonce-N' https: http:", true, 'scheme sources do NOT cover blob:'],
    ["default-src 'self'", true, 'falls back to default-src'],
    ["script-src *", true, '`*` does not cover blob: either'],
    ["script-src 'nonce-N' blob:", false, 'explicitly allowed'],
    ["script-src 'nonce-N' 'strict-dynamic'", false, 'strict-dynamic admits it'],
    ["script-src 'nonce-N' 'strict-dynamic' https: http:", false, 'strict-dynamic still wins'],
    // The effective directive is worker-src -> child-src -> script-src -> default-src, and
    // only that one is consulted: a strict-dynamic script-src does not rescue a worker-src
    // that omits blob:.
    ["script-src 'nonce-N' 'strict-dynamic';worker-src 'self'", true, 'worker-src overrides script-src'],
    ["script-src 'self';worker-src blob:", false, 'worker-src allows it'],
    ["script-src 'self';child-src blob:", false, 'child-src is consulted before script-src'],
    // Nothing that constrains workers at all.
    ["img-src 'self'", false, 'no worker-constraining directive'],
    ["require-trusted-types-for 'script'", false, 'TT alone says nothing about workers'],
    ['', false, 'empty header'],
    [null, false, 'no header'],
    // [FIX csp-header-read-as-one-policy] Several policies in ONE header, comma separated;
    // the browser enforces all of them, so blob: is refused if ANY of them refuses it.
    // Read as a single policy, the last script-src overwrote the first and the first is
    // the one that blocks.
    ["script-src 'nonce-N' 'strict-dynamic',script-src 'self'", true, 'second policy blocks'],
    ["script-src 'self',script-src 'nonce-N' 'strict-dynamic'", true, 'first policy blocks'],
    ["script-src 'nonce-N' 'strict-dynamic',script-src blob:", false, 'neither blocks'],
  ];
  for (const [value, want, why] of ROWS) {
    t.eq(afpCspBlocksBlobWorkers(value), want, `${JSON.stringify(value)} — ${why}`);
  }

  // youtube.com's real header, verbatim from the live response on 2026-08-16. Three
  // comma-separated policies; only the first refuses blob:, and the old single-policy read
  // happened to reach the same verdict from the third — right answer, wrong reason.
  const YT = "script-src 'unsafe-eval' 'self' 'unsafe-inline' https://www.google.com " +
    "https://apis.google.com https://ssl.gstatic.com https://*.youtube.com;" +
    "report-uri https://csp.withgoogle.com/csp/youtube_main/allowlist," +
    "require-trusted-types-for 'script',base-uri 'self';object-src 'none';" +
    "script-src 'report-sample' 'nonce-YTdL4OhqW22gPKSoOORuHw' 'unsafe-inline' " +
    "'strict-dynamic' https: http: 'unsafe-eval';report-uri https://csp.withgoogle.com/csp/youtube_main/strict";
  t.eq(afpCspBlocksBlobWorkers(YT), true, 'youtube.com refuses blob: workers (measured in the browser)');
  t.eq(afpCspBlocksBlobWorkers(YT.split(',').slice(2).join(',')), false,
    'and it is the FIRST of its three policies doing it, not the strict-dynamic one');
}

// ---- 9) afpRewriteCsp: youtube.com's header, rewritten so our workers pass --------------
// [FIX csp-rewrite-for-workers] The three headers exactly as `curl -sD -` returned them on
// 2026-09-03 (nonce shortened). What must hold: every policy admits a blob: worker
// afterwards, the nonce is gone (a static rule cannot replay it), the site's allowlist and
// its trusted-types header survive untouched, and the function is idempotent — a header
// it already rewrote comes back as "nothing to change", which is how the observer tells
// the rewritten header from a changed site.
t.section('9) afpRewriteCsp');
{
  const { afpRewriteCsp, afpCspBlocksBlobWorkers, afpCspEnforcesTrustedTypes, afpPolicyBlocksBlobWorkers } =
    loadBackground(['afpRewriteCsp', 'afpCspBlocksBlobWorkers', 'afpCspEnforcesTrustedTypes', 'afpPolicyBlocksBlobWorkers']);
  const H1 = "script-src 'unsafe-eval' 'self' 'unsafe-inline' https://www.google.com https://apis.google.com " +
    "https://ssl.gstatic.com https://www.gstatic.com https://*.youtube.com https://*.google.com https://youtube.com " +
    "https://www.youtube.com;report-uri https://csp.withgoogle.com/csp/youtube_main/allowlist";
  const H2 = "require-trusted-types-for 'script'";
  const H3 = "base-uri 'self';object-src 'none';script-src 'report-sample' 'nonce-D3KIdeXdummiJQOt6pGH3w' " +
    "'unsafe-inline' 'strict-dynamic' https: http: 'unsafe-eval';report-uri https://csp.withgoogle.com/csp/youtube_main/strict";
  const out = afpRewriteCsp([H1, H2, H3]);
  t.assert(typeof out === 'string' && out.length > 0, 'youtube.com\'s triple is rewritten');
  const policies = String(out).split(',').map((s) => s.trim());
  t.eq(policies.length, 3, 'three policies in, three policies out');
  t.eq(afpCspBlocksBlobWorkers(out), false, 'no policy refuses a blob: worker any more');
  t.eq(policies.filter((p) => afpPolicyBlocksBlobWorkers(p)).length, 0, 'checked policy by policy as well');
  t.assert(/^script-src 'unsafe-eval' 'self' 'unsafe-inline' https:\/\/www\.google\.com/.test(policies[0]),
    'the allowlist policy keeps its script-src verbatim');
  t.assert(/; worker-src 'self' https:\/\/www\.google\.com [^;]*https:\/\/www\.youtube\.com blob:$/.test(policies[0].replace(/; report-uri[^;]*/, '')) ||
    /worker-src [^;]*blob:/.test(policies[0]),
    `and gains a worker-src made of its own hosts plus blob: (${policies[0].slice(-120)})`);
  t.eq(policies[1], H2, 'the trusted-types header is byte for byte what the site sent');
  t.eq(afpCspEnforcesTrustedTypes(out), true, 'so trusted types are still enforced');
  t.assert(!/'nonce-/.test(out), 'the nonce is gone');
  t.assert(!/'strict-dynamic'/.test(out), "and so is 'strict-dynamic', which trusts nothing without it");
  t.assert(/'unsafe-inline'/.test(policies[2]), "the strict policy keeps 'unsafe-inline', so the page's inline scripts still run");
  t.assert(/base-uri 'self'; object-src 'none'/.test(policies[2]), 'base-uri and object-src survive');
  t.assert(/report-uri https:\/\/csp\.withgoogle\.com\/csp\/youtube_main\/strict/.test(policies[2]), 'and so does the report-uri');
  t.eq(afpRewriteCsp([out]), null, 'idempotent: the rewritten header comes back as nothing-to-change');
  t.eq(afpRewriteCsp(["script-src 'self' blob:"]), null, 'a policy that already admits blob: is left alone');
  t.eq(afpRewriteCsp(["script-src 'nonce-abc' 'strict-dynamic'"]), null,
    "a nonce policy WITH strict-dynamic admits blob: workers already (measured) and is left alone — its nonce is not touched");
  t.eq(afpRewriteCsp(["script-src 'self'", "script-src 'nonce-abc' 'strict-dynamic'"]),
    "script-src 'self'; worker-src 'self' blob:, script-src 'unsafe-inline'; worker-src blob:",
    'but once ANOTHER policy in the set needs the static rule, the nonce policy loses its nonce too — one set replaces the whole header');
  // [FIX the-switch-created-the-split-it-was-meant-to-close] connect-src joined worker-src
  // here. Admitting the WORKER without admitting the source READ gave a worker that could be
  // created and could not be patched, and mw-core's stand-down keys on worker-src, so it
  // lifted: window on the profile beside a worker on the machine, reported from a real
  // github.com tab. Neither of these two policies constrains connect-src, so each inherits
  // one — for the first from its own absent default-src (nothing to inherit, so none is
  // added), for the second from nothing at all.
  t.eq(afpRewriteCsp(["default-src 'self'"]),
    "default-src 'self'; worker-src 'self' blob:; connect-src 'self' blob:",
    'a lone default-src gets an explicit worker-src AND connect-src beside it — the wrapper reads the worker source before it patches it');
  t.eq(afpRewriteCsp(["script-src 'self'; connect-src 'self' blob:"]),
    "script-src 'self'; connect-src 'self' blob:; worker-src 'self' blob:",
    'a connect-src that already admits blob: is left exactly as it was');
  t.eq(afpRewriteCsp(["script-src 'nonce-x'; worker-src 'self'"]), "script-src 'unsafe-inline'; worker-src 'self' blob:",
    'a nonce-only script-src is opened to inline (the cost the switch is amber for) and worker-src gains blob:');
  t.eq(afpRewriteCsp([]), null, 'no header, nothing to do');
  t.eq(afpRewriteCsp(["img-src 'self'"]), null, 'a policy that never constrains scripts or workers is left alone');
  // The trusted-types allowlist: one more name, nothing else — claude.ai's shape.
  const { afpCspRestrictsTrustedTypes } = loadBackground(['afpCspRestrictsTrustedTypes']);
  // [FIX policy-name-was-a-signature] The name is an argument now, per site.
  const NM = 'k7p2q9x1';
  const cl = afpRewriteCsp(["trusted-types Kssz2 default; script-src 'self' blob:"], NM);
  t.eq(cl, "trusted-types Kssz2 default k7p2q9x1; script-src 'self' blob:",
    "an allowlist without our policy gains exactly our name; the site's names stay");
  t.eq(afpCspRestrictsTrustedTypes(cl, NM), false, 'and the observer then reads it as not restricting us');
  t.eq(afpCspRestrictsTrustedTypes(cl, 'other000'), true, 'but restricting a different name — the name is per site, and the observer judges with the right one');
  t.eq(afpCspRestrictsTrustedTypes("trusted-types Kssz2 default", NM), true, 'while the original still restricts');
  t.eq(afpRewriteCsp(["trusted-types 'none'; script-src 'self' blob:"], NM), "trusted-types k7p2q9x1; script-src 'self' blob:",
    "'none' is replaced by the name");
  t.eq(afpRewriteCsp(["trusted-types *; script-src 'self' blob:"], NM), null, 'a wildcard list is left alone');
  t.eq(afpRewriteCsp(["trusted-types a k7p2q9x1; script-src 'self' blob:"], NM), null, 'and so is one that already names us');
  t.eq(afpRewriteCsp(["trusted-types Kssz2 default; script-src 'self' blob:"], null), null,
    'with no name to give (no seed yet) an allowlist is left alone rather than opened to a name nobody will create');
  // The name itself: from the domain seed, the shape of a minified identifier, stable.
  const { afpTtPolicyName, deriveDomainSeed, afpTtPolicyNameFor } = loadBackground(
    ['afpTtPolicyName', 'deriveDomainSeed', 'afpTtPolicyNameFor'],
    { chrome: mockChrome({ afp_noise_seed: 5 }).chrome });
  t.assert(/^[a-z][a-z0-9]{7}$/.test(afpTtPolicyName(5)), `a letter then seven letters or digits (${afpTtPolicyName(5)})`);
  t.eq(afpTtPolicyName(5), afpTtPolicyName(5), 'deterministic');
  t.assert(afpTtPolicyName(5) !== afpTtPolicyName(6), 'and different for a different seed');
  t.eq(afpTtPolicyName('5'), null, 'null for a non-number: no name is better than a wrong one');
  t.eq(await afpTtPolicyNameFor('www.youtube.com'), afpTtPolicyName(deriveDomainSeed(5, 'www.youtube.com')),
    'background.js resolves the per-host name the way the page will: the domain seed of the master seed');
  t.assert((await afpTtPolicyNameFor('www.youtube.com')) !== (await afpTtPolicyNameFor('claude.ai')),
    'two sites, two names — nothing to link them by');
}

// ---- 10) afpHostListToggle: read and toggle share one rule --------------------------
// [FIX the-switch-read-with-a-suffix-match-and-toggled-with-an-exact-one] The measured
// case: `localhost` listed, the tab on foo.localhost. Status said "covered", the click added
// a second entry and status still said "covered". See the note at the function in defaults.js.
t.section('10) afpHostListToggle');
{
  const { afpHostListToggle } = loadBackground(['afpHostListToggle']);
  let r = afpHostListToggle(['localhost'], 'foo.localhost');
  t.eq(r.covered, false, 'a subdomain of a listed apex: the click UNcovers it');
  t.eq(r.list.join(), '', 'by removing the apex entry that covered it');
  r = afpHostListToggle(['localhost', 'foo.localhost'], 'foo.localhost');
  t.eq(r.list.join(), '', 'every entry covering the host goes, the exact one and the parent');
  t.eq(r.covered, false, 'and the host is uncovered');
  r = afpHostListToggle([], 'foo.localhost');
  t.eq(r.list.join(), 'foo.localhost', 'an unlisted host is added as spelled');
  t.eq(r.covered, true, 'and is then covered');
  r = afpHostListToggle(['foo.localhost'], 'localhost');
  t.eq(r.list.join(), 'foo.localhost,localhost', 'a child entry does not cover its parent, so the parent is added');
  r = afpHostListToggle(['example.com'], 'notexample.com');
  t.eq(r.list.join(), 'example.com,notexample.com', 'a suffix without the dot is not a subdomain');
  r = afpHostListToggle(['example.com', 'other.org'], 'www.example.com');
  t.eq(r.list.join(), 'other.org', 'unrelated entries survive the removal');
  r = afpHostListToggle(null, 'a.b');
  t.eq(r.list.join() + '|' + r.covered, 'a.b|true', 'a missing list is an empty one');
  // Round trip: two clicks on the same host from the same tab restore the list exactly.
  const twice = afpHostListToggle(afpHostListToggle(['other.org'], 'x.y').list, 'x.y');
  t.eq(twice.list.join(), 'other.org', 'toggle twice is a no-op');
}

// ---- 11) the dynamic rule table: every id written by exactly one function ----------
// [FIX the-hint-strip-and-the-stand-down-allow-shared-rule-id-1002] updateDynamicLanguageRule
// wrote the initiatorDomains `allow` for stand-down hosts as rule 1002 and then called
// rebuildClientHintRules, which removed 1002 and re-added it as the client-hint strip. So the
// allow that keeps a third-party request from a youtube/github page from losing its
// accept-language never survived the function that created it — measured in real Chromium:
// 1000 modifyHeaders, 1001 allow, 1002 modifyHeaders strip, no initiator allow at all.
t.section('11) dynamic rule ids');
{
  const { chrome, rules } = mockChrome({
    afp_country_code: 'DE', afp_profile_id: 'laptop_mid',
    afp_profile_data: { screenW: 1920, screenH: 1080, dpr: 1, cores: 8, memory: 8, gpu: 'intel_iris', platform: 'Win32' },
    afp_noise_seed: 123456789, afp_mode: 'normal', afp_host_platform_version: '15.0.0',
    afp_csp_noblob: ['github.com'],
    afp_ch_optin: { 'sec-ch-ua-platform-version': ['example.com'] }
  });
  const { updateDynamicLanguageRule, afpDynamicRuleIds, AFP_HINT_STRIP_RULE_ID, standDownScopes } =
    loadBackground(['updateDynamicLanguageRule', 'afpDynamicRuleIds', 'AFP_HINT_STRIP_RULE_ID', 'standDownScopes'], { chrome });
  // Let the worker's own startup pass settle before the call under test.
  await new Promise((r) => setTimeout(r, 300));
  const ids = afpDynamicRuleIds();
  t.eq(new Set(ids).size, ids.length, `afpDynamicRuleIds lists every id once (${ids.slice(0, 6).join(',')}…)`);
  t.assert(AFP_HINT_STRIP_RULE_ID !== 1001 && AFP_HINT_STRIP_RULE_ID !== 1002, `the strip has an id of its own (${AFP_HINT_STRIP_RULE_ID})`);
  t.eq((await standDownScopes()).hosts.join(), 'github.com', 'the fixture has one stand-down host');
  await updateDynamicLanguageRule();
  const r1001 = rules.get(1001), r1002 = rules.get(1002), strip = rules.get(AFP_HINT_STRIP_RULE_ID);
  t.eq(r1001 && r1001.action.type, 'allow', 'rule 1001 is the requestDomains allow');
  t.eq(r1001 && (r1001.condition.requestDomains || []).join(), 'github.com', 'scoped to the stand-down host');
  t.eq(r1002 && r1002.action.type, 'allow', 'rule 1002 is the initiatorDomains allow — and it SURVIVES the function that wrote it');
  t.eq(r1002 && (r1002.condition.initiatorDomains || []).join(), 'github.com', 'scoped to the same host as initiator');
  t.eq(strip && strip.action.type, 'modifyHeaders', 'the client-hint strip is installed beside them');
  t.assert(strip && strip.action.requestHeaders.every((h) => h.operation === 'remove'), 'and it only removes');
  const r1000 = rules.get(1000);
  t.eq(r1000 && (r1000.condition.excludedInitiatorDomains || []).join(), 'github.com', 'rule 1000 still excludes the initiator');
}

// ---- 16) Accept-CH from a host nobody had heard of -----------------------------------
// [FIX the-first-request-after-accept-ch-lost-its-hints] afpNoteAcceptCH coalesced EVERY
// observation behind a 300ms timer, and on a host that was not in the opt-in map yet that
// timer was the whole window: the strip was already in force, no per-origin SET rule
// existed, and the rest of the first page load went out with the hints simply absent where
// a clean browser was answering. Measured on this rig against one origin sending Accept-CH,
// server timestamps: clean answered all five on the subresource at t+12ms, this build
// answered none of them and its rules landed at t+325ms.
//
// The two paths are told apart by the NUMBER of updateDynamicRules calls rather than by
// timing alone — a rebuild that merely happened to be fast would still be the timer, and a
// suite that only looked at the clock could not say which one it had watched.
t.section('16) Accept-CH from a host nobody had heard of');
{
  const { chrome, rules, calls } = mockChrome({
    afp_country_code: 'US', afp_profile_id: 'laptop_mid',
    afp_profile_data: { screenW: 1920, screenH: 1080, dpr: 1, cores: 8, memory: 8, gpu: 'intel_iris', platform: 'Win32' },
    afp_noise_seed: 5, afp_mode: 'normal', afp_host_platform_version: '15.0.0',
    afp_ch_optin: {}
  });
  const { afpNoteAcceptCH } = loadBackground(['afpNoteAcceptCH'], { chrome });
  const writes = () => calls.filter((c) => c.api === 'updateDynamicRules').length;
  const setRuleFor = (hint) => [...rules.values()].find((r) => (r.action.requestHeaders || [])
    .some((h) => h.header === hint && h.operation === 'set'));
  // The load-time startup pass writes rules of its own. Wait for it to STOP rather than
  // guess at it, or the count below belongs partly to something else.
  await new Promise((r) => setTimeout(r, 300));
  for (let last = -1; last !== writes();) { last = writes(); await new Promise((r) => setTimeout(r, 80)); }
  const mark = writes();
  const respond = (path, value) => afpNoteAcceptCH({
    url: 'https://fresh.example' + path, responseHeaders: [{ name: 'Accept-CH', value }]
  });

  respond('/one', 'sec-ch-dpr');
  // Well under the 300ms timer: anything visible here cannot have come through it.
  await new Promise((r) => setTimeout(r, 80));
  t.assert(setRuleFor('sec-ch-dpr'), 'a host seen for the first time has its per-origin rule before the coalesce window closes');
  t.eq(writes() - mark, 1, 'and that took exactly one DNR write');
  // Not `setRuleFor(...).condition` — on a build where the rule is ABSENT, which is the
  // build this section exists to catch, that deref throws a TypeError, the file dies where
  // it stands, and the sections after this one never run at all. A guard that turns a named
  // failure into a stack trace is most of a guard thrown away.
  t.eq(((setRuleFor('sec-ch-dpr') || {}).condition || {}).requestDomains?.join() ?? '(no rule)',
    'fresh.example', 'the rule is scoped to the host that asked');

  respond('/two', 'device-memory');
  await new Promise((r) => setTimeout(r, 80));
  t.assert(!setRuleFor('device-memory'), 'a SECOND hint from a host already in the map is still coalesced — no rule yet');
  t.eq(writes() - mark, 1, 'and no second write yet either');
  await new Promise((r) => setTimeout(r, 350));
  t.assert(setRuleFor('device-memory'), 'the coalesced hint arrives once the 300ms timer fires');
  t.eq(writes() - mark, 2, 'two writes in all: one immediate for the new host, one coalesced for the known one');
  t.assert(setRuleFor('sec-ch-dpr'), 'and the first hint survived the rebuild that added the second');
}

// ---- 18) both exemptions at once leave nothing to strip -------------------------------
// [FIX an-empty-strip-rule-threw-and-took-the-whole-write-with-it] There are nine managed
// hints, AFP_HW_HINTS is five of them and AFP_ARCH_HINTS is the other four, so host mode ON
// a matching host exempts all nine and the strip rule's header list is EMPTY. Chrome
// rejects a modifyHeaders rule with no headers, and the rejection is not local to that
// rule: updateDynamicRules throws for the whole call, so every id the call meant to REMOVE
// survives. Measured in a real browser before this was fixed — test/hostmode.mjs went 78/0
// to 77/1 and the wire carried `sec-ch-ua-platform-version "10.0.0"` in the one mode whose
// purpose is to answer the machine's own, three seconds after the write that should have
// deleted that rule reported itself as done.
//
// The failing assertion named the header, not the throw, which is why it took a log inside
// the service worker to find. This section is the cheap version of that log.
t.section('18) both exemptions at once leave nothing to strip');
{
  const SEED = {
    afp_country_code: 'US', afp_profile_id: 'host',
    // afpIsHostRecord reads the record, not the id alone: a measured record carries `host`.
    afp_profile_data: { host: true, screenW: 1920, screenH: 1080, dpr: 1, cores: 8, memory: 8, gpu: 'intel_iris', platform: 'Win32' },
    afp_noise_seed: 5, afp_mode: 'normal', afp_host_platform_version: '15.0.0',
    afp_ch_optin: { 'sec-ch-ua-arch': ['asked.example'], 'sec-ch-ua-platform-version': ['asked.example'] }
  };
  const { chrome, rules, calls } = mockChrome(SEED);
  const userAgentData = {
    getHighEntropyValues: async () => ({ architecture: 'x86', bitness: '64', model: '', wow64: false })
  };
  const bg = loadBackground(['updateDynamicLanguageRule', 'rebuildClientHintRules',
    'AFP_HINT_STRIP_RULE_ID', 'AFP_CH_HINTS', 'AFP_HW_HINTS', 'AFP_ARCH_HINTS'], { chrome, userAgentData });

  // The arithmetic that makes the case reachable at all, asserted rather than assumed: if a
  // tenth hint is added to one list and not the other, this section stops testing anything.
  t.eq(Object.keys(bg.AFP_CH_HINTS).length, bg.AFP_HW_HINTS.length + bg.AFP_ARCH_HINTS.length,
    `every managed hint is in exactly one exemption list, so both at once leaves none ` +
    `(${Object.keys(bg.AFP_CH_HINTS).length} hints, ${bg.AFP_HW_HINTS.length} hardware + ${bg.AFP_ARCH_HINTS.length} arch)`);

  await bg.updateDynamicLanguageRule();
  const strip = rules.get(bg.AFP_HINT_STRIP_RULE_ID);
  t.assert(!strip || (strip.action.requestHeaders || []).length > 0,
    'the strip rule is either absent or carries headers — never present and empty, which is ' +
    'the shape Chrome rejects for the whole updateDynamicRules call');

  // And the write has to have LANDED, which is the half the throw destroyed: a stale
  // per-origin rule from the previous profile must not survive the switch.
  const stale = [...rules.values()].some((r) => (r.action.requestHeaders || [])
    .some((h) => h.operation === 'set' && bg.AFP_CH_HINTS[h.header]));
  t.assert(!stale,
    'and no per-origin SET rule for a managed hint is left behind — in host mode on a ' +
    'matching host every one of the nine is the browser\'s own answer');
  t.assert(calls.some((c) => c.api === 'updateDynamicRules'),
    'the rebuild wrote at all (a throw inside it is swallowed, so silence looks like success)');
}

// ---- 17) the arch exemption is a reading of the host, and its default is to strip ------
// [FIX the-arch-strip-hid-a-value-the-host-already-matched] The exemption is only safe
// while it is read from the host: on an ARM machine the browser answers "arm" and leaving
// the four alone would put that on the wire under an x86 claim. So the DEFAULT — a host
// that says nothing about its architecture, which is the state loadBackground's fake
// navigator is in and the state the service worker is in before its first read resolves —
// has to be the strip, not the exemption.
//
// The second half checks the fix itself, and checks BOTH halves of it: the four leave the
// strip AND no per-origin SET rule is built for them, so a matching host is byte-identical
// to a clean browser on every request rather than only on the ones a rule reaches.
t.section('17) the arch exemption is a reading of the host');
{
  const SEED = {
    afp_country_code: 'US', afp_profile_id: 'laptop_mid',
    afp_profile_data: { screenW: 1920, screenH: 1080, dpr: 1, cores: 8, memory: 8, gpu: 'intel_iris', platform: 'Win32' },
    afp_noise_seed: 5, afp_mode: 'normal', afp_host_platform_version: '15.0.0',
    // An origin that has asked for all four, so an unbuilt SET rule is a decision and not
    // an empty opt-in map.
    afp_ch_optin: {
      'sec-ch-ua-arch': ['asked.example'], 'sec-ch-ua-bitness': ['asked.example'],
      'sec-ch-ua-model': ['asked.example'], 'sec-ch-ua-wow64': ['asked.example'],
      'sec-ch-dpr': ['asked.example']
    }
  };
  const NAMES = ['updateDynamicLanguageRule', 'afpHostArchNative', 'AFP_ARCH_HINTS',
    'AFP_ARCH_RULESET_ID', 'AFP_HINT_STRIP_RULE_ID'];
  const strippedBy = (rules, id) => (rules.get(id) ? rules.get(id).action.requestHeaders.map((h) => h.header) : []);
  const setRules = (rules) => [...rules.values()].flatMap((r) => (r.action.requestHeaders || [])
    .filter((h) => h.operation === 'set').map((h) => h.header)).sort();
  const switched = (calls, id) => calls.filter((c) => c.api === 'updateEnabledRulesets')
    .map((c) => (c.enable.includes(id) ? 'enable' : c.disable.includes(id) ? 'disable' : '')).filter(Boolean).pop() || '(never touched)';

  // The safe default: no userAgentData at all, which is what every other suite loads with.
  {
    const { chrome, rules, calls } = mockChrome(SEED);
    const bgA = loadBackground(NAMES, { chrome });
    t.eq(await bgA.afpHostArchNative(), false, 'a host that answers nothing about its architecture does not count as matching');
    await bgA.updateDynamicLanguageRule();
    const stripped = strippedBy(rules, bgA.AFP_HINT_STRIP_RULE_ID);
    t.eq(bgA.AFP_ARCH_HINTS.filter((h) => !stripped.includes(h)).join(), '',
      `all four arch hints are still stripped when the host is unknown (${stripped.join(',')})`);
    t.assert(setRules(rules).includes('sec-ch-ua-arch'), 'and the origin that asked still gets the profile value set for it');
    t.eq(switched(calls, bgA.AFP_ARCH_RULESET_ID), 'enable', 'the static arch ruleset is left ENABLED on such a host');
  }

  // The reading the fix turns on: x86 / 64 / '' / not-wow64, which is what AFP_CH_HINTS
  // claims for every row, so the truthful move is to send nothing and let the host answer.
  {
    const { chrome, rules, calls } = mockChrome(SEED);
    const userAgentData = {
      getHighEntropyValues: async () => ({ architecture: 'x86', bitness: '64', model: '', wow64: false })
    };
    const bgB = loadBackground(NAMES, { chrome, userAgentData });
    t.eq(await bgB.afpHostArchNative(), true, 'a host answering x86 / 64 / no model / not-wow64 matches what every profile row claims');
    await bgB.updateDynamicLanguageRule();
    const stripped = strippedBy(rules, bgB.AFP_HINT_STRIP_RULE_ID);
    t.eq(bgB.AFP_ARCH_HINTS.filter((h) => stripped.includes(h)).join(), '',
      `none of the four arch hints is stripped on a matching host (${stripped.join(',')})`);
    t.assert(stripped.includes('sec-ch-dpr'), 'while the hints the host does NOT already match are stripped as before');
    t.eq(bgB.AFP_ARCH_HINTS.filter((h) => setRules(rules).includes(h)).join(), '',
      `and no per-origin SET rule is built for them either, so they stay fully native (${setRules(rules).join(',')})`);
    t.assert(setRules(rules).includes('sec-ch-dpr'), 'the same origin still gets a SET rule for the hint that is not exempt');
    t.eq(switched(calls, bgB.AFP_ARCH_RULESET_ID), 'disable', 'and the static arch ruleset is DISABLED');
  }
}

// ---- 12) the CSP observer with a cache that has not loaded yet ----------------------
// [FIX the-csp-observer-judged-from-a-cache-that-had-not-loaded] afpNoteCsp consulted
// `_cspRewrite` synchronously; on the request that WAKES the service worker it is null, the
// host was judged from the site's original header and re-added to the blob-refusing list —
// after which noblob.js stood every tab down while the switch showed ON. Calling the
// observer straight after load is exactly that state: the startup pass has not resolved a
// single await yet.
t.section('12) afpNoteCsp on a cold cache');
{
  const YT = [
    "script-src 'unsafe-eval' 'self' 'unsafe-inline' https://www.google.com https://*.youtube.com;report-uri /allowlist",
    "require-trusted-types-for 'script'",
    "base-uri 'self';object-src 'none';script-src 'report-sample' 'nonce-D3KIdeXd' 'unsafe-inline' 'strict-dynamic' https: http: 'unsafe-eval';report-uri /strict"
  ];
  const headersOf = (vals) => vals.map((value) => ({ name: 'Content-Security-Policy', value }));
  const { chrome, store } = mockChrome({
    afp_country_code: 'US', afp_profile_id: 'laptop_mid',
    afp_profile_data: { screenW: 1920, screenH: 1080, dpr: 1, cores: 8, memory: 8, gpu: 'intel_iris', platform: 'Win32' },
    afp_noise_seed: 5, afp_mode: 'normal', afp_host_platform_version: '15.0.0',
    afp_csp_rewrite: { 'www.youtube.com': "script-src 'self'; worker-src 'self' blob:" }
  });
  const { afpNoteCsp } = loadBackground(['afpNoteCsp'], { chrome });
  // No await between load and call: the cache is as cold as it gets.
  afpNoteCsp({ type: 'main_frame', url: 'https://www.youtube.com/watch?v=x', responseHeaders: headersOf(YT) });
  await new Promise((r) => setTimeout(r, 200));
  // The control, after the first verdict has settled (section 13 is about the same tick).
  afpNoteCsp({ type: 'main_frame', url: 'https://other.example/', responseHeaders: headersOf(YT) });
  await new Promise((r) => setTimeout(r, 200));
  const noblob = store.get('afp_csp_noblob') || [];
  const tt = store.get('afp_csp_tt') || [];
  const tte = store.get('afp_csp_tte') || [];
  // Entries are host/segment since [FIX csp-restrictions-learned-per-route].
  t.assert(!noblob.some((e) => e.startsWith('www.youtube.com')), `a rewritten host is not learned as blob-refusing on a cold cache (${JSON.stringify(noblob)})`);
  t.assert(!tt.some((e) => e.startsWith('www.youtube.com')), 'nor as a trusted-types allowlist host');
  t.assert(tte.includes('www.youtube.com/watch'), 'but its trusted-types ENFORCEMENT is still learned, for the route');
  t.assert(noblob.includes('other.example/'), 'the control: the same header on a host that is NOT rewritten is learned as blob-refusing (its root route)');
}

// ---- 13) two observations in one tick must both be kept ----------------------------
// [FIX two-observers-in-one-tick-lost-a-host] Found by the section above: with the two calls
// back to back, only the SECOND host was stored. Each list loader memoised its value but not
// the read in flight, so the second read replaced the array the first was about to push
// into, and the write that followed dropped an add-only entry. Two tabs restoring at
// browser start is that shape.
t.section('13) concurrent CSP observations');
{
  const H = "script-src 'self'; require-trusted-types-for 'script'";
  const headersOf = (v) => [{ name: 'Content-Security-Policy', value: v }];
  const { chrome, store } = mockChrome({
    afp_country_code: 'US', afp_profile_id: 'laptop_mid',
    afp_profile_data: { screenW: 1920, screenH: 1080, dpr: 1, cores: 8, memory: 8, gpu: 'intel_iris', platform: 'Win32' },
    afp_noise_seed: 5, afp_mode: 'normal', afp_host_platform_version: '15.0.0'
  });
  const { afpNoteCsp } = loadBackground(['afpNoteCsp'], { chrome });
  afpNoteCsp({ type: 'main_frame', url: 'https://a.example/', responseHeaders: headersOf(H) });
  afpNoteCsp({ type: 'main_frame', url: 'https://b.example/', responseHeaders: headersOf(H) });
  await new Promise((r) => setTimeout(r, 300));
  const noblob = store.get('afp_csp_noblob') || [];
  const tte = store.get('afp_csp_tte') || [];
  t.eq(noblob.slice().sort().join(), 'a.example/,b.example/', `both hosts are on the blob-refusing list (${JSON.stringify(noblob)})`);
  t.eq(tte.slice().sort().join(), 'a.example/,b.example/', `and both on the trusted-types-enforced list (${JSON.stringify(tte)})`);
}

// ---- 15) restrictions per route, headers per route and per tab ---------------------
// [FIX csp-restrictions-learned-per-route] One host, a strict route and a loose one. The
// list must name the route, the loose route must stay off it, a third strict route must
// collapse the host unless it was seen loose, and the header rules must follow: the
// route's documents by urlFilter, the tab's subresources by a session rule.
t.section('15) CSP restrictions per route');
{
  const { afpCspScope, afpCspScopeMatches, afpCspHostListed, afpCspScopePatterns } = loadBackground(
    ['afpCspScope', 'afpCspScopeMatches', 'afpCspHostListed', 'afpCspScopePatterns']);
  t.eq(afpCspScope('https://claude.ai/chat/abc?x=1'), 'claude.ai/chat', 'the scope is host + first segment');
  t.eq(afpCspScope('https://claude.ai/'), 'claude.ai/', 'the root document has an empty segment');
  t.eq(afpCspScope('not a url'), '', 'no URL, no scope');
  t.eq(afpCspScopeMatches(['claude.ai/chat'], 'claude.ai/chat'), true, 'a route entry matches its route');
  t.eq(afpCspScopeMatches(['claude.ai/chat'], 'claude.ai/api'), false, 'and not another route of the host');
  t.eq(afpCspScopeMatches(['claude.ai/chat'], 'app.claude.ai/chat'), true, 'subdomains inherit, as bare hosts always did');
  t.eq(afpCspScopeMatches(['claude.ai'], 'claude.ai/anything'), true, 'a bare host entry (older installs, or collapsed) matches every route');
  t.eq(afpCspHostListed(['claude.ai/chat'], 'claude.ai'), true, 'the host is listed somewhere');
  t.eq(afpCspHostListed(['claude.ai/chat'], 'other.ai'), false, 'another host is not');
  t.eq(afpCspScopePatterns(['a.test/chat', '127.0.0.1/', 'b.test']).join(' '),
    '*://a.test/chat *://a.test/chat?* *://a.test/chat/* *://*.a.test/chat *://*.a.test/chat?* *://*.a.test/chat/* *://127.0.0.1/ *://127.0.0.1/?* *://b.test/* *://*.b.test/*',
    'patterns: the segment, its query, everything under it, on the host and subdomains; root is the root; an IP has no subdomains; a bare host is host-wide');

  const headersOf = (v) => [{ name: 'Content-Security-Policy', value: v }];
  const STRICT = "script-src 'self'";
  const { chrome, store, sessionRules } = mockChrome({
    afp_country_code: 'US', afp_profile_id: 'laptop_mid',
    afp_profile_data: { screenW: 1920, screenH: 1080, dpr: 1, cores: 8, memory: 8, gpu: 'intel_iris', platform: 'Win32' },
    afp_noise_seed: 5, afp_mode: 'normal', afp_host_platform_version: '15.0.0'
  });
  const { afpNoteCsp, standDownScopes, afpApplySdRouteRules, afpSdTabFromUrl } =
    loadBackground(['afpNoteCsp', 'standDownScopes', 'afpApplySdRouteRules', 'afpSdTabFromUrl'], { chrome });
  const settle = () => new Promise((r) => setTimeout(r, 120));
  afpNoteCsp({ type: 'main_frame', tabId: 3, frameId: 0, url: 'https://mixed.test/app/1', responseHeaders: headersOf(STRICT) });
  await settle();
  t.eq((store.get('afp_csp_noblob') || []).join(), 'mixed.test/app', 'a strict route is learned as that route');
  afpNoteCsp({ type: 'main_frame', tabId: 4, frameId: 0, url: 'https://mixed.test/api/x', responseHeaders: headersOf("default-src 'self' blob:") });
  await settle();
  t.eq((store.get('afp_csp_noblob') || []).join(), 'mixed.test/app', 'a loose route of the same host adds nothing');
  t.eq((store.get('afp_csp_mixed') || []).join(), 'mixed.test', 'and marks the host mixed');
  afpNoteCsp({ type: 'main_frame', tabId: 3, frameId: 0, url: 'https://mixed.test/docs/', responseHeaders: headersOf(STRICT) });
  afpNoteCsp({ type: 'main_frame', tabId: 3, frameId: 0, url: 'https://mixed.test/blog/', responseHeaders: headersOf(STRICT) });
  await settle();
  t.eq((store.get('afp_csp_noblob') || []).slice().sort().join(), 'mixed.test/app,mixed.test/blog,mixed.test/docs', 'three strict routes on a MIXED host stay three routes');
  for (const seg of ['a', 'b', 'c']) afpNoteCsp({ type: 'main_frame', tabId: 5, frameId: 0, url: `https://allstrict.test/${seg}/`, responseHeaders: headersOf(STRICT) });
  await settle();
  const all = (store.get('afp_csp_noblob') || []).filter((e) => e.startsWith('allstrict.test'));
  t.eq(all.join(), 'allstrict.test', 'three strict routes on a host never seen loose collapse to the bare host');
  t.eq(sessionRules.get(1004) && sessionRules.get(1004).condition.tabIds.slice().sort().join(), '3,5', 'the tab rule lists the tabs whose top document stands down (3 and 5), not the loose one (4)');
  t.assert(!(sessionRules.get(1004).condition.resourceTypes || []).includes('main_frame'), 'and leaves main_frame out: the next navigation is spoofed like the document it fetches');
  afpNoteCsp({ type: 'main_frame', tabId: 3, frameId: 0, url: 'https://mixed.test/api/y', responseHeaders: [] });
  await settle();
  t.eq(sessionRules.get(1004).condition.tabIds.join(), '5', 'a tab that navigates to a document with no CSP leaves the rule');
  const sd = await standDownScopes();
  t.eq(sd.hosts.join(), 'allstrict.test', 'the bare hosts go to rule 1000\'s exclusions and the 1001/1002 pair');
  t.eq(sd.routes.map((r) => r.host + '/' + r.seg).sort().join(), 'mixed.test/app,mixed.test/blog,mixed.test/docs', 'the routes get rules of their own');
  await afpApplySdRouteRules(sd.routes);
  const { rules } = chrome.__mock;
  const routeRules = [...rules.values()].filter((r) => r.id >= 5000);
  t.eq(routeRules.length, 3, 'one allow rule per route');
  t.eq(routeRules.map((r) => r.condition.regexFilter).sort().join(' '),
    '^https?://([^/]+\\.)?mixed\\.test(?::\\d+)?/app(?:[/?#]|$) ^https?://([^/]+\\.)?mixed\\.test(?::\\d+)?/blog(?:[/?#]|$) ^https?://([^/]+\\.)?mixed\\.test(?::\\d+)?/docs(?:[/?#]|$)',
    'anchored on the host or a subdomain, an optional port, closed by a separator or the end');
  const rx = new RegExp(routeRules[0].condition.regexFilter);
  t.assert(rx.test('https://www.mixed.test/app?x=1') && rx.test('http://mixed.test:8080/app/x') && !rx.test('https://mixed.test/apple'),
    'the regex takes the route with a query on a subdomain, with a port, and not a longer segment');
  t.eq(routeRules[0].condition.resourceTypes.join(), 'main_frame,sub_frame', 'for document requests only');
  // A loose route that sends NO CSP at all (returns before the judge) still marks the host.
  afpNoteCsp({ type: 'main_frame', tabId: 6, frameId: 0, url: 'https://nocsp.test/app/', responseHeaders: headersOf(STRICT) });
  await settle();
  afpNoteCsp({ type: 'main_frame', tabId: 6, frameId: 0, url: 'https://nocsp.test/', responseHeaders: [] });
  await settle();
  t.assert((store.get('afp_csp_mixed') || []).includes('nocsp.test'), 'a document with no CSP header on a listed host marks it mixed');
  afpNoteCsp({ type: 'main_frame', tabId: 6, frameId: 0, url: 'https://nocsp.test/docs/', responseHeaders: headersOf(STRICT) });
  afpNoteCsp({ type: 'main_frame', tabId: 6, frameId: 0, url: 'https://nocsp.test/blog/', responseHeaders: headersOf(STRICT) });
  await settle();
  t.eq((store.get('afp_csp_noblob') || []).filter((e) => e.startsWith('nocsp.test')).sort().join(), 'nocsp.test/app,nocsp.test/blog,nocsp.test/docs',
    'so three strict routes beside a no-CSP one do not collapse');

  // [FIX the-tab-rule-arrived-after-the-first-subresources] The tab rule from the URL, before
  // the response: a route already on a list answers at request time, an unknown one waits.
  const tabIds = () => (sessionRules.get(1004) ? sessionRules.get(1004).condition.tabIds.slice().sort().join() : '(no rule)');
  afpSdTabFromUrl(11, 'https://mixed.test/app/x');
  await settle();
  t.assert(tabIds().split(',').includes('11'), `a known strict route is answered from the URL alone (${tabIds()})`);
  afpSdTabFromUrl(12, 'https://mixed.test/api/x');
  await settle();
  t.assert(!tabIds().split(',').includes('12'), `a known loose route adds nothing (${tabIds()})`);
  afpSdTabFromUrl(13, 'https://never-seen.test/x');
  await settle();
  t.assert(!tabIds().split(',').includes('13'), 'an unknown route is left to the observer');
  // A tab already listed must not be un-listed by a URL that merely is not on a list: the
  // headers of the new document decide that, a moment later.
  afpSdTabFromUrl(11, 'https://never-seen.test/x');
  await settle();
  t.assert(tabIds().split(',').includes('11'), 'and an unknown route does not clear a tab the observer had set');
}

// A host the user switched to rewriting does not stand down, whatever its list says. Its own
// mock: loadCspRewrite memoises, and the real invalidation rides on storage.onChanged, which
// this mock does not dispatch — writing the key into a live instance would test the memo.
{
  const { chrome, sessionRules } = mockChrome({
    afp_country_code: 'US', afp_profile_id: 'laptop_mid',
    afp_profile_data: { screenW: 1920, screenH: 1080, dpr: 1, cores: 8, memory: 8, gpu: 'intel_iris', platform: 'Win32' },
    afp_noise_seed: 5, afp_mode: 'normal', afp_host_platform_version: '15.0.0',
    afp_csp_noblob: ['rw.test/app'],
    afp_csp_rewrite: { 'rw.test': "script-src 'self' blob:" }
  });
  const { afpSdTabFromUrl } = loadBackground(['afpSdTabFromUrl'], { chrome });
  afpSdTabFromUrl(21, 'https://rw.test/app/x');
  await new Promise((r) => setTimeout(r, 120));
  const ids = sessionRules.get(1004) ? sessionRules.get(1004).condition.tabIds.join() : '(no rule)';
  t.assert(!ids.split(',').includes('21'), `a rewritten host is not stood down from the URL (${ids})`);
}

// ---- 14) the per-document trusted-types verdict --------------------------------------
// [FIX a-refusal-we-passed-through-was-charged-to-us] The host lists are add-only, so a
// host that enforced once reads as enforcing for good. That is the safe direction for
// "leave the page's string to the browser" and the WRONG one for "refuse it ourselves" —
// which mw-workers now does, so that the browser's refusal is not charged to our frame.
// The stronger answer is per document: this response's own headers, keyed by tab and
// frame, handed to storage-bridge.js when it asks, dropped with the tab.
t.section('14) per-document trusted-types verdict');
{
  const headersOf = (v) => [{ name: 'Content-Security-Policy', value: v }];
  const { chrome, listeners } = mockChrome({
    afp_country_code: 'US', afp_profile_id: 'laptop_mid',
    afp_profile_data: { screenW: 1920, screenH: 1080, dpr: 1, cores: 8, memory: 8, gpu: 'intel_iris', platform: 'Win32' },
    afp_noise_seed: 5, afp_mode: 'normal', afp_host_platform_version: '15.0.0',
    afp_csp_rewrite: { 'www.youtube.com': "script-src 'self'; worker-src 'self' blob:" }
  });
  const { afpNoteCsp, afpCspVerdictFor } = loadBackground(['afpNoteCsp', 'afpCspVerdictFor'], { chrome });
  const settle = () => new Promise((r) => setTimeout(r, 60));
  const get = (tabId, frameId) => afpCspVerdictFor({ tab: { id: tabId }, frameId });
  const ask = (tabId, frameId) => { const v = get(tabId, frameId); return v ? JSON.stringify({ host: v.host, tte: v.tte }) : 'null'; };
  t.eq(ask(7, 0), 'null', 'nothing recorded yet: null');
  afpNoteCsp({ type: 'main_frame', tabId: 7, frameId: 0, url: 'https://a.example/x', responseHeaders: headersOf("script-src 'self'; require-trusted-types-for 'script'") });
  t.eq(ask(7, 0), '{"host":"a.example","tte":true}', 'an enforcing document: tte true, keyed by tab and frame, before anything async');
  await settle();
  // [FIX the-host-lists-answered-for-a-document-they-had-not-seen] All five, per document.
  {
    const v = get(7, 0);
    t.eq(v.wb, true, "script-src 'self' with no worker-src: blob: workers refused (wb)");
    t.eq(v.ns, true, 'and a blob: importScripts refused (ns)');
    t.eq(v.tt, false, 'no trusted-types name allowlist (tt)');
    t.eq(typeof v.nc, 'boolean', 'the blob: fetch flag is settled too (nc)');
  }
  afpNoteCsp({ type: 'sub_frame', tabId: 7, frameId: 3, url: 'https://b.example/f', responseHeaders: headersOf("script-src 'self'") });
  t.eq(ask(7, 3), '{"host":"b.example","tte":false}', 'a sub-frame whose CSP does not enforce: tte false, under its own key');
  t.eq(ask(7, 0), '{"host":"a.example","tte":true}', "and the top frame's verdict is untouched by it");
  afpNoteCsp({ type: 'main_frame', tabId: 7, frameId: 0, url: 'https://a.example/y', responseHeaders: [] });
  t.eq(ask(7, 0), '{"host":"a.example","tte":false}', 'the next document in that frame, with NO CSP header, replaces it: tte false');
  t.eq(JSON.stringify([get(7, 0).wb, get(7, 0).tt, get(7, 0).nc, get(7, 0).ns]), '[false,false,false,false]', 'and with no CSP the four others settle to false at once');
  afpNoteCsp({ type: 'script', tabId: 7, frameId: 0, url: 'https://a.example/s.js', responseHeaders: headersOf("require-trusted-types-for 'script'") });
  t.eq(ask(7, 0), '{"host":"a.example","tte":false}', 'a subresource is not a document and records nothing');
  // A host the user switched to rewriting: judged from the header the page will GET.
  afpNoteCsp({ type: 'main_frame', tabId: 9, frameId: 0, url: 'https://www.youtube.com/watch', responseHeaders: headersOf("script-src 'self'; require-trusted-types-for 'script'") });
  await settle();
  t.eq(get(9, 0) && get(9, 0).wb, false, 'a rewritten host: the same blob-refusing header reads as NOT refusing, because the rewrite admits blob: workers');
  t.eq(get(9, 0) && get(9, 0).tte, true, 'while its trusted-types enforcement, which the rewrite keeps, still reads as enforcing');
  afpNoteCsp({ type: 'main_frame', tabId: -1, frameId: 0, url: 'https://c.example/', responseHeaders: headersOf("require-trusted-types-for 'script'") });
  t.eq(ask(-1, 0), 'null', 'a response outside any tab records nothing');
  t.eq(JSON.stringify(afpCspVerdictFor({})), 'null', 'a sender without a tab gets null');
  t.assert(typeof listeners.tabRemoved === 'function', 'the verdicts are dropped with the tab (tabs.onRemoved is listened to)');
  if (typeof listeners.tabRemoved === 'function') {
    listeners.tabRemoved(7);
    t.eq(ask(7, 0) + ask(7, 3), 'nullnull', 'closing the tab forgets both frames');
  }
}

t.done();
