// mw-cleanup.js — remove window/DOM bag markers (profile lives in the mw-core closure)
(function () {
  'use strict';
  var SYM = Symbol.for('js.runtime.bridge.v2');
  // [CLEANUP] __AFP_FEATURES__, __AFP_MODE__, __AFP_STATUS__ and __afp_mn were in this
  // list but nothing in the extension has set them since state moved out of window
  // ('v.ui.m' in sessionStorage when it is not the default, the status set on the
  // non-enumerable window.__t0, the profile into the mw-core closure) —
  // four deletes of keys that never
  // existed. __AFP_PROFILE__ stays: mw-bag.js migrates a legacy value out of it and
  // profile-injector.js still reads it as a fallback, so it can genuinely be present.
  // __g0 is NOT deleted here any more, and must not be re-added: it is mw-navigator's
  // per-context WebGL wrap, and mw-canvas-audio.js used to call it at getContext time,
  // i.e. always after this file had already removed it — see
  // [FIX g0-deleted-before-it-was-ever-called]. That call site now captures the function
  // at load time, so the global itself is gone from mw-navigator too and there is nothing
  // left here to delete.
  // __AFP_P0__ is the profile baton from profile-injector.js to mw-core.js; mw-core
  // deletes it the moment it reads it, so this is only for the case where mw-core did
  // not load at all (a dev-*.html that lists a subset of the modules). Leaving a live
  // profile object on window would undo the whole point of moving it into a closure.
  [
    '__AFP_PROFILE__', '__AFP_P0__',
    '__AFP_GEO__', '__AFP_ADBLOCK_HIDE__'
  ].forEach(function (k) {
    try { delete window[k]; } catch (e) {}
  });
  // Keep __AFP_MW__ until modules finished — this runs last, safe to remove
  try { delete window.__AFP_MW__; } catch (e) {}
  try { delete window[SYM]; } catch (e) {}
  try { delete document.documentElement[SYM]; } catch (e) {}
})();
