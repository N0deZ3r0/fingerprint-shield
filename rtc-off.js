// rtc-off.js — "WebRTC protection is OFF for this host", delivered at document_start.
//
// [FIX the-per-site-flag-arrived-320ms-late] The exception lives in chrome.storage and
// reaches the page inside the profile, which background.js injects on tabs.onUpdated
// 'complete' plus a timer. Measured in a real browser, on an excepted host, one single
// RTCPeerConnection:
//
//     ui:state ... 315ms wp=false
//     event=0   sdp=1   stats=1
//
// The srflx candidate had already been offered through onicecandidate while the flag was
// still at its default (protected, so it was hidden), and the SDP was read after the flag
// landed (so it was not). One connection, two answers — the switch half-applied, which is
// worse than either position: a site the user deliberately allowed still loses the
// candidate its call needs, and a page that watches both channels sees them contradict.
//
// A registered content script is the only thing that beats the page's first script (see
// [FIX mv3-sync-channel] in background.js — onCommitted with injectImmediately loses that
// race, measured). background.js keeps this file registered for exactly the hosts on the
// exception list, so its mere PRESENCE is the answer and no storage read is needed.
//
// The marker is a field of the shared status set, which no longer lives under a name on
// window at all — see [FIX the-status-object-was-a-name-a-page-could-test-for] in
// mw/mw-canvas-audio.js. It only exists on hosts where the user has switched protection
// off — where, by definition, the page is already allowed to see the address this
// extension would otherwise hide.
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
    try { _status().r = true; } catch (e) {}
})();
