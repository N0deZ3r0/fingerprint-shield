/**
 * AFP parity console check — paste on any https page with Shield loaded.
 * Verifies top ↔ iframe ↔ about:blank ↔ worker for critical profile fields.
 * Exit code style: prints PASS/FAIL table; window.__AFP_PARITY__ = report object.
 */
(async function afpParityCheck() {
  'use strict';
  function snap(win) {
    var n = win.navigator;
    var s = win.screen;
    var tz = '';
    try { tz = win.Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    return {
      hc: n.hardwareConcurrency,
      dm: n.deviceMemory,
      lang: n.language,
      langs: n.languages ? Array.from(n.languages) : [],
      plat: n.platform,
      ua: (n.userAgent || '').slice(0, 48),
      sw: s && s.width,
      sh: s && s.height,
      cd: s && s.colorDepth,
      dpr: win.devicePixelRatio,
      tz: tz
    };
  }
  function eq(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (String(a[i]) !== String(b[i])) return false;
      return true;
    }
    return String(a) === String(b);
  }
  var top = snap(window);
  var iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;border:0';
  document.body.appendChild(iframe);
  var ifr = snap(iframe.contentWindow);

  var blank = document.createElement('iframe');
  blank.src = 'about:blank';
  blank.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;border:0';
  await new Promise(function (r) {
    blank.onload = r;
    document.body.appendChild(blank);
    setTimeout(r, 500);
  });
  // allow extension scan interval / load hook
  await new Promise(function (r) { setTimeout(r, 200); });
  var bl = snap(blank.contentWindow);

  var workerHc = await new Promise(function (resolve) {
    try {
      var code = 'postMessage({hc:navigator.hardwareConcurrency,dm:navigator.deviceMemory,lang:navigator.language,plat:navigator.platform})';
      var w = new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
      var t = setTimeout(function () { try { w.terminate(); } catch (e) {} resolve({ err: 'timeout' }); }, 3000);
      w.onmessage = function (ev) {
        clearTimeout(t);
        try { w.terminate(); } catch (e) {}
        resolve(ev.data);
      };
    } catch (e) {
      resolve({ err: String(e) });
    }
  });

  var keys = ['hc', 'dm', 'lang', 'plat', 'sw', 'sh', 'tz'];
  var rows = [];
  keys.forEach(function (k) {
    var tv = top[k];
    var iv = ifr[k];
    var bv = bl[k];
    var wv = k === 'hc' ? workerHc.hc : (k === 'dm' ? workerHc.dm : (k === 'lang' ? workerHc.lang : (k === 'plat' ? workerHc.plat : tv)));
    var okI = eq(tv, iv);
    var okB = eq(tv, bv);
    var okW = (k === 'sw' || k === 'sh' || k === 'tz') ? true : eq(tv, wv);
    rows.push({
      field: k,
      top: tv,
      iframe: iv,
      blank: bv,
      worker: (k === 'sw' || k === 'sh' || k === 'tz') ? 'n/a' : wv,
      pass: okI && okB && okW
    });
  });

  var report = {
    // [FIX profile-readable-by-any-page] The profile is not in the page any more (it
    // lives in the mw/mw-core.js closure), so the mode comes from the small key that
    // still carries it — nothing else here needed the profile.
    // [FIX bridge-attributes-were-an-extension-detector] The data-v-md read that used to
    // come first is dropped: nothing writes it any more, so it was a guaranteed null and
    // 'v.ui.m' answered every time anyway.
    mode: (function () {
      try {
        return sessionStorage.getItem('v.ui.m') || 'unknown';
      } catch (e) { return 'unknown'; }
    })(),
    top: top,
    iframe: ifr,
    blank: bl,
    worker: workerHc,
    rows: rows,
    allPass: rows.every(function (r) { return r.pass; })
  };
  window.__AFP_PARITY__ = report;
  console.log('%cAFP parity ' + (report.allPass ? 'PASS' : 'FAIL') + ' mode=' + report.mode, report.allPass ? 'color:green;font-weight:bold' : 'color:red;font-weight:bold');
  console.table(rows);
  try { document.body.removeChild(iframe); } catch (e) {}
  try { document.body.removeChild(blank); } catch (e) {}
  return report;
})();
