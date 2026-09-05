// mw-bag.js — sweeps the carriers the profile used to live on.
//
// [FIX profile-readable-by-any-page] This file used to BE the store: it owned
// sessionStorage['v.ui.s'] and migrated every older carrier into it. The profile lives
// in the mw/mw-core.js closure now (the reasoning is written out there), so nothing here
// stores anything — it only makes sure the old carriers are empty, and hands anything
// still found on one of them forward on the same baton profile-injector.js uses.
//
// Runs between profile-injector.js and mw-core.js in the manifest, which is exactly the
// window where the baton exists.
(function () {
  'use strict';
  var BATON = '__AFP_P0__';

  function handOff(p) {
    if (!p || typeof p !== 'object') return;
    try {
      // profile-injector.js already ran and normally set this; a value it built from
      // the bridge attributes is fresher than anything salvaged below, so it wins.
      if (window[BATON]) return;
    } catch (e0) {}
    try {
      Object.defineProperty(window, BATON, {
        value: p, writable: true, configurable: true, enumerable: false
      });
    } catch (e) { try { window[BATON] = p; } catch (e2) {} }
  }

  // Keys written by builds that predate the closure. Whatever is on them is handed
  // forward first and removed after — a tab left open across the upgrade still holds a
  // full profile in 'v.ui.s', and dropping it would cost that tab its machine for one
  // load. The removes are unconditional, so by the time the page's first script runs
  // every one of these is empty whether or not it was used.
  try {
    var legacy = sessionStorage.getItem('v.ui.s') || sessionStorage.getItem('__afp_last_profile__');
    if (legacy) { try { handOff(JSON.parse(legacy)); } catch (eP) {} }
    sessionStorage.removeItem('__afp_last_profile__');
    sessionStorage.removeItem('v.ui.s');
    sessionStorage.removeItem('afp_mode');
    sessionStorage.removeItem('afp_st');
  } catch (eMig) {}

  // Legacy window / documentElement bags, migrated once and deleted.
  try {
    if (window.__AFP_PROFILE__ && typeof window.__AFP_PROFILE__ === 'object') {
      handOff(window.__AFP_PROFILE__);
      try { delete window.__AFP_PROFILE__; } catch (e) {}
    }
  } catch (e) {}
  try {
    var sym = Symbol.for('js.runtime.bridge.v2');
    var root = document.documentElement;
    var old = root[sym];
    if (old && typeof old.getProfile === 'function') {
      var p = old.getProfile();
      if (p) handOff(p);
      try { delete root[sym]; } catch (e) {}
    }
    try { delete window[sym]; } catch (e) {}
  } catch (e) {}
})();
