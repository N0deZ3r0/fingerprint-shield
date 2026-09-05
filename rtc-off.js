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
// The marker is non-enumerable, for the reason every other one here is: Object.keys(window)
// feeds CreepJS getClientCode(), and a name that shows up there is client litter a clean
// browser does not have. It is named like its neighbours (__p0/__t0/__w0), and it only
// exists on hosts where the user has switched protection off — where, by definition, the
// page is already allowed to see the address this extension would otherwise hide.
(function () {
    'use strict';
    try {
        Object.defineProperty(window, '__r0', {
            value: true, writable: true, configurable: true, enumerable: false
        });
    } catch (e) {
        try { window.__r0 = true; } catch (e2) {}
    }
})();
