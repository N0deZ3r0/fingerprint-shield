// sw-off.js — "service workers are blocked for this host", delivered at document_start.
//
// [FIX service-worker-scope-is-unreachable] A site's own service worker reads the real
// machine and cannot be patched from an MV3 extension — measured, and every route is
// closed: blob: scripts are refused, script redirects are disallowed, content scripts never
// run in that scope, and Chrome has no way to rewrite a response body. So the only lever is
// to refuse the registration, and the refusal has to be known before the page's first
// script — the same reason rtc-off.js exists. background.js keeps this file registered for
// exactly the hosts the user switched off, so its PRESENCE is the answer.
//
// It also clears what is already there: blocking new registrations would do nothing on a
// site whose worker was installed before the switch was flipped, and that worker keeps
// answering from the same scope. Only same-origin script can unregister it, which is
// precisely where this runs.
(function () {
    'use strict';
    // [FIX the-status-object-was-a-name-a-page-could-test-for] This used to be its own
    // non-enumerable own property of window. Non-enumerable keeps it out of
    // Object.keys and so out of CreepJS getClientCode, but it does nothing about
    // `'__r0' in window`, which a clean browser answers false to everywhere and which
    // needs no baseline at all. The flag is a field of the shared status set now, and
    // that set is carried by a synchronous CustomEvent rather than by a name — see the
    // long note in mw/mw-canvas-audio.js. Own window properties added here: none.
    var _ST_EV = 'js.runtime.bridge.v2.s';
    var _CE0 = window.CustomEvent;
    function _status() {
        try {
            var ev = new _CE0(_ST_EV, { detail: {} });
            window.dispatchEvent(ev);
            if (ev.detail && ev.detail.v) return ev.detail.v;
        } catch (e0) {}
        var st = {};
        try {
            window.addEventListener(_ST_EV, function (e2) {
                try { if (e2 && e2.detail && !e2.detail.v) e2.detail.v = st; } catch (e3) {}
            }, true);
        } catch (e1) {}
        return st;
    }
    try { _status().s = true; } catch (e) {}
    try {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
            navigator.serviceWorker.getRegistrations().then(function (regs) {
                for (var i = 0; i < regs.length; i++) {
                    try { regs[i].unregister(); } catch (eU) {}
                }
            }).catch(function () {});
        }
    } catch (eR) {}
})();
