'use strict';
/**
 * THE single source of AFP defaults.
 *
 * `audio` was removed along with the AudioContext noise: the noise was measurably
 * louder than the fingerprint it hid (see the note in mw/mw-canvas-audio.js).
 * A stored afp_features from an older install may still carry the key —
 * afpMergeFeatures only walks the keys defined here, so it is ignored, not honoured.
 * background.js: importScripts('defaults.js')
 * options.html:  <script src="defaults.js">
 * mw/mw-core.js: its _FEAT fallback must match AFP_DEFAULT_FEATURES LITERALLY,
 *                because the MAIN world cannot importScripts. Verified by
 *                test-defaults.cjs.
 *
 * clientRects defaults to false (CreepJS DOMRect); everything else defaults to
 * true, so a clean install is fully protected.
 */
var AFP_DEFAULT_FEATURES = {
  canvas: true,
  webgl: true,
  webrtc: true,
  navigator: true,
  screen: true,
  timezone: true,
  geolocation: true,
  battery: true,
  fonts: true,
  clientRects: false,
  plugins: true,
  network: true,
  hideAdBlocker: true
};

/*
 * The two names below are this file's published API: it is loaded as a plain script
 * (importScripts in background.js, <script src> in options.html), so its consumers
 * live in other files and a per-file linter cannot see them. AFP_DEFAULT_PROFILE is
 * read by background.js; afpCloneFeatures by background.js and options.js. Verified
 * by grep before silencing — do not delete on the linter's word alone.
 */
/* eslint-disable no-unused-vars */

/**
 * Does `host` fall under one of the entries in a per-site list?
 *
 * An entry covers the host itself and its subdomains, so `example.com` also blocks
 * `www.example.com` — the rule the WebRTC exception list has always used, written once now
 * that a second per-site switch shares it. Used by background.js for both lists and
 * unit-tested in test/background-fns.mjs.
 */
function afpHostMatches(list, host) {
  if (!Array.isArray(list) || typeof host !== 'string' || !host) return false;
  for (var i = 0; i < list.length; i++) {
    var h = list[i];
    if (typeof h !== 'string' || !h) continue;
    if (host === h || host.endsWith('.' + h)) return true;
  }
  return false;
}

/**
 * Flip `host` in a per-site list. Returns { list, covered }: `covered` is whether the list
 * covers the host AFTER the change.
 *
 * [FIX the-switch-read-with-a-suffix-match-and-toggled-with-an-exact-one] The status of both
 * per-site switches is read through afpHostMatches above — an entry covers its subdomains —
 * while the toggle handlers did `list.indexOf(host)`. On a subdomain of a listed apex the
 * click therefore ADDED the subdomain instead of removing the apex, and the switch stayed
 * where it was. Measured in Playwright with `localhost` listed and a tab on foo.localhost:
 *
 *   getSwStatus          blocked:true   blockedCount:1
 *   toggleSwForCurrentTab blocked:true  -> list ['localhost','foo.localhost']
 *   getSwStatus          blocked:true   blockedCount:2
 *
 * and the same for the WebRTC exception list. Entries only ever enter a list from the exact
 * tab hostname, so this bit whenever the user first toggled on the apex and later visited
 * www. The only way back was Options -> Clear.
 *
 * Read and toggle now share one rule: when the host is covered — itself or by a parent
 * entry — EVERY covering entry is removed; otherwise the exact host is added.
 */
/**
 * [FIX csp-restrictions-learned-per-route] The CSP restriction lists (afp_csp_noblob, _tt,
 * _tte, _nc, _ns) hold `host/segment` — the host and the FIRST path segment of the document
 * that sent the restriction — because one host serves documents with different policies
 * (claude.ai: strict on one route, loose on another), and a host-wide entry stood the loose
 * documents down for the life of the profile. A bare host in a list is still honoured on
 * every route: older installs carry them, and background.js collapses a host to one bare
 * entry once three of its routes have restricted and none has been seen loose.
 *
 * The first segment and not the whole path: the marker scripts (noblob.js, tte.js) are
 * registered by match pattern, and a pattern per route is what keeps the answer there at
 * document_start — before the page's first script, which is the only moment that counts
 * (the open-work list 0e). The root document has an empty segment: 'host/'.
 */
function afpCspScope(url) {
  try {
    var u = new URL(url);
    var seg = u.pathname.split('/')[1] || '';
    return u.hostname + '/' + seg;
  } catch (e) { return ''; }
}
function afpCspScopeHost(entry) {
  var s = String(entry || ''), i = s.indexOf('/');
  return i < 0 ? s : s.slice(0, i);
}
/** Does the list restrict the document at `scope` (host/segment, from afpCspScope)? */
function afpCspScopeMatches(list, scope) {
  if (!Array.isArray(list) || typeof scope !== 'string' || !scope) return false;
  var i = scope.indexOf('/');
  var host = i < 0 ? scope : scope.slice(0, i), seg = i < 0 ? '' : scope.slice(i + 1);
  for (var k = 0; k < list.length; k++) {
    var e = list[k];
    if (typeof e !== 'string' || !e) continue;
    var j = e.indexOf('/'), eh = j < 0 ? e : e.slice(0, j);
    if (!(host === eh || host.endsWith('.' + eh))) continue;
    if (j < 0 || e.slice(j + 1) === seg) return true;
  }
  return false;
}
/** Any entry of this host, whatever the route — "the site restricts somewhere". */
function afpCspHostListed(list, host) {
  if (!Array.isArray(list) || typeof host !== 'string' || !host) return false;
  for (var k = 0; k < list.length; k++) {
    var eh = afpCspScopeHost(list[k]);
    if (eh && (host === eh || host.endsWith('.' + eh))) return true;
  }
  return false;
}

function afpHostListToggle(list, host) {
  var src = Array.isArray(list) ? list.filter(function (h) { return typeof h === 'string' && h; }) : [];
  if (afpHostMatches(src, host)) {
    return {
      list: src.filter(function (h) { return !(host === h || host.endsWith('.' + h)); }),
      covered: false
    };
  }
  return { list: src.concat([host]), covered: true };
}

/**
 * Device pixel ratio per machine, as popup.js declares it.
 *
 * [FIX applying-a-profile-dropped-its-dpr] The record the popup stores carries screen,
 * cores, memory, gpu and platform — never `dpr`. buildProfile() then derives one from the
 * width (1920 -> 1) while dyn/dev/<id>.js carries the declared 1.5, so the two sources
 * disagreed again on any install that had ever pressed Apply, and on every install
 * upgraded from a build older than this one. Measured live: 127.0.0.1 reported dpr 1.5
 * (dyn) and abrahamjuliot.github.io reported 1 (injected profile), same browser, same
 * minute.
 *
 * Keyed by profile id so an EXISTING stored record needs no migration: buildProfile looks
 * the ratio up when the record does not carry one. test/parity-static.mjs holds this map
 * against popup PROFILES, resolved by the same rule tools/gen-dyn.mjs uses.
 */
// laptop_125 / laptop_150 are the two scaled-1080p laptops — the fractional ratio is the
// whole point of those rows. `host` ("this machine") always stores the measured ratio;
// 1 is only the answer for a record that somehow lost it, and it is never what a page is
// told. (No comments inside the literal: test/parity-static.mjs parses it as JSON.)
var AFP_PROFILE_DPR = {
  laptop_low: 1,
  laptop_mid: 1,
  pc_gaming: 1,
  pc_power: 1,
  laptop_125: 1.25,
  laptop_150: 1.5,
  laptop_1610: 2,
  host: 1
};

/**
 * Baseline hardware profile, used when storage is empty — and written verbatim as the
 * stored record for `laptop_mid` by initDefaults() in background.js. It must therefore
 * BE laptop_mid, field for field, as popup.js declares it.
 *
 * [FIX default-record-had-no-dpr] It was missing `dpr`, and that one gap made the same
 * machine answer two ways. buildProfile() derives a missing dpr from the width — 1920 → 1
 * — while dyn/dev/laptop_mid.js is generated from the popup's record, which says 1.5. So
 * whichever source reached a tab first decided its ratio. Measured with FingerprintJS v4
 * over three tabs of one session, no settings touched:
 *
 *   tab1  ui:state arrived at 329ms with dpr 1    -> fontPreferences default 149.3125
 *   tab2  no ui:state, dyn cold start, dpr 1.5    -> fontPreferences default  99.484375
 *
 * Text metrics are CSS pixels, so they scale with the ratio: exactly ×1.5, and a DIFFERENT
 * visitorId for the first page of the session. test/parity-static.mjs now holds this
 * record against popup.js's laptop_mid so the two cannot drift again.
 */
var AFP_DEFAULT_PROFILE = {
  screenW: 1920,
  screenH: 1080,
  dpr: 1,
  cores: 8,
  memory: 8,
  gpu: 'intel_iris',
  platform: 'Win32'
};

/**
 * Merge a stored fragment onto the full set of 14 keys.
 * Installs that predate a key get its default rather than undefined.
 */
function afpMergeFeatures(stored) {
  var out = {};
  var keys = Object.keys(AFP_DEFAULT_FEATURES);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    out[k] = (stored && typeof stored[k] === 'boolean')
      ? stored[k]
      : AFP_DEFAULT_FEATURES[k];
  }
  return out;
}

/** Deep copy of features — never share one object between tabs or the cache. */
function afpCloneFeatures(src) {
  return afpMergeFeatures(src || AFP_DEFAULT_FEATURES);
}

/**
 * Storage schema version. Bump when the SHAPE of what lives in chrome.storage.local
 * changes — a key renamed, a value's meaning changed, a field added that old data cannot
 * be read without.
 *
 * Why this exists: chrome.storage.local survives extension updates, so an install that has
 * been running for a year holds whatever shape the build from a year ago wrote. Until now
 * the only defence was one ad-hoc `else if` inside initDefaults, which migrated the removed
 * `maximum` mode. That worked, but it is a pattern that does not scale: each future change
 * adds another special case, they run in whatever order they were written, and nothing
 * records that a given install has already been converted — so every migration must stay in
 * the code forever and stay idempotent by luck rather than by construction.
 *
 * A version counter fixes the ordering and the bookkeeping at once: migrations are a list,
 * they run in order from the stored version to the current one, and each runs exactly once
 * per install.
 */
var AFP_SCHEMA_VERSION = 1;
var AFP_SCHEMA_KEY = 'afp_schema_version';

/**
 * Decide what needs rewriting for an install sitting at `stored[AFP_SCHEMA_KEY]`.
 *
 * A PURE function on purpose: it takes a snapshot of storage and returns the object to
 * write, touching no chrome API. That is what makes it testable — the alternative, doing
 * the work inline in initDefaults, is only reachable from a live service worker, which is
 * exactly why the one migration that already existed had no test at all.
 *
 * Returns null when there is nothing to do, so the caller does not write on every startup.
 * `from` 0 covers both a fresh install and every build that predates this counter; the
 * migrations are written to be safe on both, which is why they check the value they are
 * about to change rather than assuming it.
 */
function afpMigrateStorage(stored) {
  var s = stored || {};
  var from = (typeof s[AFP_SCHEMA_KEY] === 'number') ? s[AFP_SCHEMA_KEY] : 0;
  if (from >= AFP_SCHEMA_VERSION) return null;
  var out = {};

  // v0 -> v1. The modes `maximum` and `max` were removed; `hidden` is the UI's name for
  // what storage calls `stealth`, and an older build wrote the UI name here. This is the
  // migration that used to sit inline in initDefaults, moved rather than invented — an
  // install that already ran that code is unaffected, because the mode it left behind is
  // one this no longer matches.
  var mode = s.afp_mode;
  if (mode === 'maximum' || mode === 'max') out.afp_mode = 'normal';
  else if (mode === 'hidden') out.afp_mode = 'stealth';

  out[AFP_SCHEMA_KEY] = AFP_SCHEMA_VERSION;
  return out;
}

/**
 * Pack the flags into the compact form that survives a reload in sessionStorage['v.ui.f'].
 *
 * mw/mw-core.js decides _FEAT and _STEALTH as it loads and has no later hook to correct
 * them, so those two are the only part of the profile that has to persist somewhere the
 * page can see (the profile itself lives in a closure — see the long note in mw-core).
 * Thirteen booleans, one base-36 number: no user agent, no GPU, no screen, no seed, no
 * locale. It says which protections are on, not who the user is pretending to be.
 *
 * The BIT ORDER is this object's key order. mw-core keeps its own copy of both the
 * defaults and the unpacking — the MAIN world cannot importScripts — and test-defaults.cjs
 * fails if the two key lists ever disagree, so the packing cannot silently reinterpret
 * itself. Everything that CAN share this function does: background.js and
 * storage-bridge.js both load this file.
 */
function afpPackFeatures(features) {
  var keys = Object.keys(AFP_DEFAULT_FEATURES);
  var bits = 0;
  for (var i = 0; i < keys.length; i++) {
    var v = features && typeof features[keys[i]] === 'boolean'
      ? features[keys[i]]
      : AFP_DEFAULT_FEATURES[keys[i]];
    if (v) bits |= (1 << i);
  }
  return bits.toString(36);
}

/**
 * Write `v.ui.m` / `v.ui.f` ONLY when they differ from the defaults; remove them otherwise.
 *
 * [FIX default-config-still-left-two-keys] A clean Chrome stores NOTHING on a fresh origin
 * — measured, extension off, `sessionStorage.length === 0` — so any key at all is a
 * one-line detector, whatever it is named. Two of the four we used to write are gone
 * outright (the status set moved to a non-enumerable window property, the noise seed now
 * arrives through dyn/ and is never stored). These two cannot go the same way: mw/mw-core.js
 * decides _FEAT and _STEALTH as it LOADS, dyn/boot.js runs after it (measured — see the
 * header of that file), and 26 one-flag boot files were already tried and reverted for
 * exactly that reason. They are the one thing that genuinely needs an origin-scoped store.
 *
 * What they do not need is to be written when they say nothing. Both readers treat an
 * absent value as "the default", which they already had to: on the first load of a tab the
 * keys do not exist yet. So an install running the defaults — normal mode, default flags,
 * which is what a fresh install is — now leaves sessionStorage byte-identical to a clean
 * browser, and only a user who has actually changed a setting carries one opaque key.
 *
 * Removing on the default path is not optional: sessionStorage outlives an Apply, so a user
 * who turns a flag off and back on would otherwise keep a key forever that no longer says
 * anything.
 */
/**
 * The packed flags, or null when they are exactly the defaults.
 *
 * background.js injects a function into the page and can only hand it JSON, so it cannot
 * call afpPersistSelection there — it decides here and passes the answer. null means
 * "remove the key", which is what the page-side branch does with it.
 */
function afpPackedIfNotDefault(features) {
  var packed = afpPackFeatures(features);
  return packed === afpPackFeatures(AFP_DEFAULT_FEATURES) ? null : packed;
}

function afpPersistSelection(store, mode, features) {
  try {
    if (mode === 'stealth') store.setItem('v.ui.m', 'stealth');
    else store.removeItem('v.ui.m');
  } catch (e) {}
  try {
    if (!features || typeof features !== 'object') return;
    var packed = afpPackFeatures(features);
    if (packed === afpPackFeatures(AFP_DEFAULT_FEATURES)) store.removeItem('v.ui.f');
    else store.setItem('v.ui.f', packed);
  } catch (e) {}
}

/**
 * THE ONE MEDIA-PARITY TRADE LIST.
 *
 * `@media` in a stylesheet and `matchMedia()` in script are the same engine answering the
 * same question, so a real browser cannot disagree with itself — and a divergence is not a
 * wrong value, it is a positive signature that something is patching the JS side. Two pages
 * check for that: dev-mediaparity.html sweeps ~50 features against the modules, and the
 * `media` row of audit.js re-asks 15 of them in the user's own browser.
 *
 * Both need the same exception list, because a few features CANNOT agree: matchMedia is
 * answered from the profile while the CSS engine answers from the real window, and an
 * extension cannot reach the CSS engine. The full argument — including why dropping the
 * override costs MORE (creep.js takes our spoofed screen and demands matchMedia confirm it,
 * so removing it scores two documented lies where keeping it scores none) — is written out
 * at the ACCEPTED comment in dev-mediaparity.html, and is not repeated here.
 *
 * Why it lives in defaults.js rather than in each page. The two copies had already drifted
 * by the time this was written: audit.js accepted only the dpr and resolution families,
 * while dev-mediaparity.html also accepted hover / any-hover / pointer / any-pointer /
 * update. On the desktop both files were measured on, the forced input answers happen to be
 * the true ones and nothing diverged, so the gap was invisible; on a touchscreen it is eight
 * disagreements at once, which dev-mediaparity.html reports as expected and audit.js would
 * have reported to the user as a fault in their own build. One list, one judgement.
 *
 * ADDING TO THIS IS A CLAIM, and the expensive kind: that the divergence is structural and
 * that closing it would cost more elsewhere. The accessibility preferences were forced too
 * and were DROPPED rather than added here — see [FIX accessibility-prefs-were-forced-onto-
 * the-user] in mw/mw-misc.js — because nothing of ours demanded them and the cost landed on
 * the user rather than on the fingerprint. That is the default; this list is the exception.
 *
 * The unprefixed `device-pixel-ratio` spellings are deliberately NOT here. Blink has no such
 * media feature, so a clean browser answers false through both channels, there is nothing to
 * spoof, and [FIX unprefixed-device-pixel-ratio-was-answered-at-all] removed our answer.
 * Both pages still ASK them, precisely so a regression is caught rather than accepted.
 */
var AFP_MEDIA_PARITY_TRADE =
  /^\(?((min-|max-)?(device-)?(width|height)|(min-|max-)?resolution|-webkit-(min-|max-)?device-pixel-ratio|(any-)?(hover|pointer)|update)/;
