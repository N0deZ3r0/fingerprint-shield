// Worker job used by dev-workerpayload.html. Same-origin on purpose: that is the path
// where mw/mw-workers.js reads the source over XHR and prepends the generated patch, so
// what runs here is the real product, not a stand-in.
// Reports the handful of values the patch is supposed to control, for the two dates that
// sit either side of a DST boundary in the profile zone.
self.postMessage({
  cores: self.navigator.hardwareConcurrency,
  mem: self.navigator.deviceMemory,
  lang: self.navigator.language,
  ua: self.navigator.userAgent,
  platform: self.navigator.platform,
  tz: (function () {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return String(e); }
  })(),
  janOff: new Date(Date.UTC(2026, 0, 15, 12)).getTimezoneOffset(),
  julOff: new Date(Date.UTC(2026, 6, 15, 12)).getTimezoneOffset()
});
