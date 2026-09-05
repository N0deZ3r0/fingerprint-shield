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
    try {
        Object.defineProperty(window, '__s0', {
            value: true, writable: true, configurable: true, enumerable: false
        });
    } catch (e) {
        try { window.__s0 = true; } catch (e2) {}
    }
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
