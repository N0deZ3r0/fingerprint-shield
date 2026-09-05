// tte.js — "this origin enforces Trusted Types at script sinks", delivered at document_start.
//
// [FIX tte-flag-arrived-after-the-first-script] The flag mw/mw-workers.js reads in
// _ttWouldRefuse used to reach the page only through chrome.storage -> storage-bridge's
// async read -> sessionStorage, ~8 ms in. A page that builds a worker from a bare string in
// its FIRST script is earlier than that — and the wrapper, not yet knowing the document
// would refuse the string, wrapped it, minted a TrustedScriptURL of its own for the blob
// and let a worker run that a clean browser rejects with a TypeError. That is the
// laundering [FIX tt-wrapper-laundered-the-pages-plain-string] closed, re-opened by timing.
//
// It was invisible while the wrapper could not mint on such origins at all (a site's
// `default` policy without createScriptURL made every mint fail — youtube.com). The
// fallback to our own policy that makes the per-site CSP rewrite useful there is exactly
// what made the race observable: test/csprewrite.mjs measured 'accepted' where the control
// says TypeError.
//
// Same delivery as noblob.js, for the same reason: a per-host content script whose
// PRESENCE is the answer, registered for the hosts the CSP observer recorded under
// afp_csp_tte. Runs after mw-bundle.js, before the page's first script; the wrapper reads
// `v.ui.tte` live at each construction. The residual is the same one: the first visit to a
// host in a profile, before the header has been seen.
(function () {
    'use strict';
    try {
        // [FIX a-refusal-we-passed-through-was-charged-to-us] '2' / '0' is this document's
        // own verdict (storage-bridge.js), which outranks the host's history. This file runs
        // in same-origin frames too, and would otherwise reset the top document's answer.
        // A settled value ('2:'/'0:' + tag) belongs to the tab's storage OWNER — the
        // highest same-origin ancestor, whose timeOrigin is the tag — and is left alone;
        // anything else is history, and '1' is at least as true. Not this frame's own
        // timeOrigin: a same-origin frame shares the storage and is a different document,
        // and measured, the audit page's probe frames reset the top's verdict this way.
        // [FIX csp-restrictions-learned-per-route] Every value names the document and its
        // route ('code:timeOrigin:host/segment'); another document's value counts only as
        // history for the same route — see noblob.js.
        var owner = window;
        try { while (owner.parent !== owner && owner.parent.location.href !== undefined) owner = owner.parent; } catch (eO) {}
        var loc = owner.location;
        var tag = String(owner.performance.timeOrigin) + ':' + loc.hostname + '/' + (loc.pathname.split('/')[1] || '');
        var cur = String(sessionStorage.getItem('v.ui.tte') || '');
        var mine = /^[203]:/.test(cur) && cur.slice(2) === tag;
        if (!mine) sessionStorage.setItem('v.ui.tte', '1:' + tag);
    } catch (e) {}
})();
