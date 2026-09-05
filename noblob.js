// noblob.js — "this origin refuses blob: workers", delivered at document_start.
//
// [FIX the-first-worker-on-a-blob-refusing-origin-was-always-lost] Reported from the field,
// github.com, with the extension installed:
//
//   Creating a worker from 'blob:https://github.com/…' violates the following Content
//   Security Policy directive: "worker-src github.githubassets.com …". The action has
//   been blocked.        mw-bundle.js (_wrapModuleWorker)
//
// BLOCKED — the page did not get its worker. Every worker mw-workers wraps is built from a
// blob, so on an origin whose worker-src omits blob: the construction is refused and the
// page holds a dead object.
//
// The machinery to avoid that already existed and every piece of it worked:
// afpCspBlocksBlobWorkers parses the header correctly (checked against github's exact
// policy), chrome.webRequest.onHeadersReceived delivers it, and the host is recorded in
// afp_csp_noblob. What did not work was the DELIVERY. The flag reached the page through
// chrome.storage -> storage-bridge's async read -> sessionStorage, and a page is free to
// build a worker in its first script, which is earlier than that chain can finish.
// Measured, four fresh profiles, a page carrying `worker-src 'self'` and building a module
// worker in its first script — with a clean-browser control that gets its worker every time:
//
//   load 1 of a fresh profile   worker lost   4 of 4
//   load 2 of the same tab      worker fine   0 of 4     (the reactive flag had landed)
//
// So the answer is the one rtc-off.js and sw-off.js already use: a per-host content script
// whose PRESENCE is the answer, registered for exactly the hosts the CSP observer has
// recorded. It runs after mw-bundle.js — a dynamically registered script always does — but
// still before the page's own first script, and mw-workers reads `v.ui.wb` live on every
// `new Worker()` rather than once at install, so landing in between is early enough.
//
// WHAT THIS STILL DOES NOT SAVE: the very first visit to such a host in a profile, because
// nothing can be registered for a host nobody has seen yet. That is one page load per host
// ever, against one per TAB before — sessionStorage is per tab, so a new tab on the same
// site used to lose its worker again. The residual is recorded in README "Limits".
(function () {
    'use strict';
    try {
        // The same key mw/mw-workers.js reads in _isBlobBlocked(), written here rather than
        // waited for. [FIX csp-restrictions-learned-per-route] The value names the DOCUMENT
        // (the storage owner's timeOrigin — the highest same-origin ancestor, since frames
        // share the tab's sessionStorage) and its ROUTE (host/first segment): sessionStorage
        // outlives the document, and a bare '1' left by a strict route stood the next loose
        // document of the same tab down (measured, test/cspscope.mjs). Readers take another
        // document's value only as history for the SAME route. '3' (observed in this
        // document) outranks the marker and is kept.
        var owner = window;
        try { while (owner.parent !== owner && owner.parent.location.href !== undefined) owner = owner.parent; } catch (eO) {}
        var loc = owner.location;
        var tag = String(owner.performance.timeOrigin) + ':' + loc.hostname + '/' + (loc.pathname.split('/')[1] || '');
        var cur = String(sessionStorage.getItem('v.ui.wb') || '');
        if (!(cur.indexOf('3:') === 0 && cur.slice(2) === tag)) sessionStorage.setItem('v.ui.wb', '1:' + tag);
    } catch (e) {}
})();
