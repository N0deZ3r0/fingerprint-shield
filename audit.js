/**
 * THE AUDIT PAGE — three sources, in the browser that actually runs this extension.
 *
 * Every suite in test/ drives the Chromium Playwright ships, because branded Chrome has
 * refused --load-extension since 136. So the browser the extension is installed in is the
 * one browser nothing measures, and the cost of that is on record: of six defects found in
 * the Chrome 152 audit, four were invisible to all twenty-nine suites — two arrived as
 * console errors a user pasted, two were found by driving the real browser by hand.
 *
 * This page turns that into one click. It can do something no rig can, and something
 * afp-console-check.js explicitly cannot:
 *
 *   THE CLAIM   chrome.runtime 'getFullConfig' — what the service worker decided to present.
 *   THE PAGE    chrome.scripting.executeScript into a real tab, world MAIN — what a site sees.
 *   THE HOST    this page's own realm. The manifest's all-URLs match pattern does not
 *               cover chrome-extension:, so the content scripts never run here. Measured
 *               rather than assumed: this tab reads 18 cores and Europe/Moscow on a machine
 *               whose pages read 8 and America/New_York.
 *
 * That third source is the one that matters. afp-console-check.js runs IN a patched page, so
 * it has no reference to compare against — it says so itself, and after
 * [FIX self-check-still-read-the-removed-attributes] it reports the hardware as values
 * rather than pretending to check them, because `navigator.x === prof.x` where `prof.x` WAS
 * `navigator.x` can only ever pass. Here the reference is real, and it comes from two
 * independent directions at once: the claim from the privileged side, the host from this
 * realm.
 *
 * WORLD 'MAIN' IS LOAD-BEARING. The patches are installed on MAIN's prototypes; an ISOLATED
 * injection shares the DOM but not the JS realm, so it would read the host through a patched
 * page and every row would be wrong in the same direction.
 */
'use strict';

const $ = (id) => document.getElementById(id);

/** What a page can be asked, in one self-contained function — executeScript serialises it. */
function pageCollector() {
  const out = { errors: [] };
  const t = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'THREW ' + e.name; } };

  t('cores', () => navigator.hardwareConcurrency);
  t('memory', () => navigator.deviceMemory);
  t('platform', () => navigator.platform);
  t('userAgent', () => navigator.userAgent);
  t('language', () => navigator.language);
  t('languages', () => (navigator.languages || []).join(','));
  t('timezone', () => Intl.DateTimeFormat().resolvedOptions().timeZone);
  // The NUMERIC side of the same fact: a realm can carry the right zone LABEL and the wrong
  // offset in one Date object, which is exactly how the scriptless sandbox frame read the
  // machine in numbers while reading the profile in words.
  t('offJan', () => new Date(2026, 0, 15).getTimezoneOffset());
  t('locale', () => Intl.DateTimeFormat().resolvedOptions().locale);
  t('screenW', () => screen.width);
  t('screenH', () => screen.height);
  t('dpr', () => window.devicePixelRatio);
  t('cpuPerformance', () => ('cpuPerformance' in Navigator.prototype ? navigator.cpuPerformance : '(no such API)'));
  t('gpu', () => {
    const gl = document.createElement('canvas').getContext('webgl');
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return gl.getParameter(d.UNMASKED_RENDERER_WEBGL);
  });
  t('navOwn', () => Object.getOwnPropertyNames(navigator).sort().join(',') || '(none)');
  // [FIX the-audit-blamed-the-sites-own-polyfills-on-the-extension] The same read in a realm
  // the SITE's scripts never touched. Our content scripts do run there — the manifest
  // carries match_about_blank — so anything of ours is present in both, while a polyfill the
  // page assigned to its own navigator is present only above. That difference is what tells
  // "the extension added a property" from "vk.com wrote its WebRTC shim", which the row used
  // to charge to us.
  //
  // about:blank and not location.href: the iframe the scope check below builds loads the
  // SAME URL, so the page's scripts run in it too and it cannot answer this question. That
  // was the first attempt and it changed nothing.
  // [FIX the-audit-counted-the-stand-down-as-a-failure] The extension's own condition, read
  // from the page it applies to. mw-core stands the window down where a worker cannot be
  // patched — README "Limits", item 6 — and on such an origin the page reporting the machine is
  // the fix working, not the spoof failing. Inferring it from the worker probe would be
  // guesswork; these are the two keys the gate actually reads.
  t('standDown', () => {
    try {
      // 'code:timeOrigin:route' since [FIX csp-restrictions-learned-per-route]; this
      // document's, or another document's for the same route (history).
      const tag = String(performance.timeOrigin);
      const route = location.hostname + '/' + (location.pathname.split('/')[1] || '');
      const on = (k) => {
        const v = String(sessionStorage.getItem(k) || ''), p = v.split(':');
        return /^[123]$/.test(p[0]) && (p[1] === tag || p.slice(2).join(':') === route);
      };
      return on('v.ui.wb') || on('v.ui.tt');
    } catch (e) { return false; }
  });

  t('navOwnBlank', () => {
    const f = document.createElement('iframe');
    f.style.display = 'none';
    document.documentElement.appendChild(f);
    let names = '(none)';
    try {
      names = Object.getOwnPropertyNames(f.contentWindow.navigator).sort().join(',') || '(none)';
    } finally { f.remove(); }
    return names;
  });
  t('screenOwn', () => Object.getOwnPropertyNames(screen).sort().join(',') || '(none)');
  t('markers', () => Object.getOwnPropertyNames(window).filter((n) => /^__/.test(n)).sort().join(',') || '(none)');
  // [AUDIT copyable-state] The per-site flags this page can read — the state a bug report
  // needs beside the table. Both reports of 2026-09-03 arrived without them and the cause
  // had to be reconstructed from the shape of the symptoms.
  t('flags', () => {
    const o = {};
    ['v.ui.wb', 'v.ui.tt', 'v.ui.tte', 'v.ui.nc', 'v.ui.ns', 'v.ui.ab', 'v.ui.m'].forEach((k) => {
      try { o[k] = sessionStorage.getItem(k); } catch (e) { o[k] = 'THREW'; }
    });
    return o;
  });

  // An error a page can read must not name the extension. Both shapes: the synchronous
  // throw and the REJECTED PROMISE, which is a different code path and the one that was
  // leaking the id until [FIX stack-strip-only-covered-the-synchronous-throw].
  t('stackSync', () => {
    try { Object.getOwnPropertyDescriptor(Screen.prototype, 'width').get.call(null); return 'did not throw'; }
    catch (e) { return /chrome-extension:\/\//.test(String(e && e.stack)) ? 'NAMES THE EXTENSION' : 'clean'; }
  });

  // matchMedia against the CSS engine: one engine, two ways of asking, and it cannot
  // disagree with itself — except where it structurally must, and those are separated here
  // rather than counted. `order` and not `outline-width`, which computes to 0 with no
  // outline-style and made an earlier version of this check call everything a disagreement.
  //
  // THE SPLIT IS THE SAME ONE dev-mediaparity.html MAKES, and it matters both ways:
  //
  //   the -webkit- device-pixel-ratio family and `resolution` ARE a real trade. matchMedia
  //   is answered from the profile's dpr; the CSS engine answers from the real window, and
  //   an extension cannot reach the CSS engine. On any machine whose real dpr differs from
  //   the claimed one they disagree, and nothing can be done about it.
  //
  //   the UNPREFIXED device-pixel-ratio spellings are NOT a trade. Blink has no such media
  //   feature, so a clean browser answers false through BOTH channels and there is nothing
  //   to spoof — answering them from the profile was a wrong answer to an invalid question,
  //   and [FIX unprefixed-device-pixel-ratio-was-answered-at-all] removed it. They stay in
  //   the list precisely so a regression there is caught rather than accepted.
  t('media', () => {
    // AFP_MEDIA_PARITY_TRADE from defaults.js, byte for byte, and it has to be a COPY:
    // this function is serialised whole by chrome.scripting.executeScript and runs in the
    // inspected tab's MAIN world, where nothing audit.html loads exists. The same bind as
    // afpCpuTier above it. test/parity-static.mjs compares the two literals, so the copy
    // cannot drift the way this one already had — it was missing the whole input family.
    const TRADE = /^\(?((min-|max-)?(device-)?(width|height)|(min-|max-)?resolution|-webkit-(min-|max-)?device-pixel-ratio|(any-)?(hover|pointer)|update)/;
    const qs = ['(prefers-color-scheme: dark)', '(forced-colors: active)', '(dynamic-range: high)',
      '(color-gamut: p3)', '(pointer: fine)', '(hover: hover)', '(update: fast)',
      '(min-device-pixel-ratio: 1.5)', '(max-device-pixel-ratio: 1.5)', '(device-pixel-ratio: 1)',
      '(-webkit-min-device-pixel-ratio: 1.5)', '(min-resolution: 1.5dppx)',
      '(scripting: enabled)', '(orientation: landscape)', '(monochrome: 0)'];
    const el = document.createElement('div');
    el.className = 'afp-mq-probe';
    document.body.appendChild(el);
    const st = document.createElement('style');
    document.head.appendChild(st);
    const bad = [], trade = [];
    for (const q of qs) {
      st.textContent = '.afp-mq-probe{order:1}@media ' + q + '{.afp-mq-probe{order:7}}';
      const css = getComputedStyle(el).order === '7';
      if (matchMedia(q).matches !== css) (TRADE.test(q) ? trade : bad).push(q);
    }
    el.remove(); st.remove();
    return { unexpected: bad.length ? bad.join(' ; ') : '(none)',
      expected: trade.length ? trade.join(' ; ') : '(none)', asked: qs.length };
  });

  return new Promise((resolve) => {
    const finish = () => resolve(out);
    // [FIX the-audit-compared-two-realms-of-thirteen] Three now: the worker, the plain
    // same-origin frame, and the scriptless sandbox where both 2026-09-06 defects lived.
    let pending = 3;
    const done = () => { if (--pending === 0) finish(); };

    // A dedicated worker. It reads the machine through a completely separate patch path —
    // a payload the window prepends to the worker source — so the two agreeing is not a
    // tautology, it is the property [FIX worker-connection-half-patched] exists to hold.
    // [FIX a-scope-that-could-not-be-read-was-a-free-pass] Two real runs, two different
    // sites, and on each one of these two scopes reported 'no reading' — grey, uncounted,
    // and the verdict still said every check passed. Both reasons belong to the PAGE, and
    // both are now either worked around or named, because the second one hid a defect: on
    // an origin whose CSP refuses blob: workers the extension hands the native Worker
    // constructors back, so the page's workers read the host while the window goes on
    // claiming the profile. The scope row is the one check that would have shown it and it
    // was the row that could not run.
    //
    // `out.workerWhy` carries WHICH rule stopped it, because the three are distinguishable
    // and they do not mean the same thing:
    //
    //   tt-enforced   `new Worker(<string>)` throws TypeError — the document requires a
    //                 TrustedScriptURL. Worked around below: mint a policy and retry.
    //   tt-names      minting the policy throws too — a `trusted-types` NAME allowlist.
    //   csp-blob      construction succeeds, then errors with an EMPTY message — the
    //                 classic signature of a CSP that refuses blob: workers.
    //
    // The last two are exactly the origins where our own worker patch cannot be installed
    // either, which is what lets the renderer derive a verdict without a worker at all.
    try {
      const src = 'onmessage=function(){postMessage({cores:navigator.hardwareConcurrency,' +
        'memory:navigator.deviceMemory,platform:navigator.platform,ua:navigator.userAgent,' +
        'tz:Intl.DateTimeFormat().resolvedOptions().timeZone,' +
        'locale:Intl.DateTimeFormat().resolvedOptions().locale,lang:navigator.language});};';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      // [FIX the-audit-probe-tripped-on-youtubes-default-policy] Two defects in the old
      // retry, both reported from a youtube.com tab as "worker failed to start" plus a
      // console error charged to mw-bundle.js, and both reproduced on the csprewrite
      // fixture:
      //
      //   1. It took `trustedTypes.defaultPolicy` on trust. YouTube HAS a default policy
      //      and it implements no createScriptURL, so the retry threw
      //      "Policy default's TrustedTypePolicyOptions did not specify a 'createScriptURL'
      //      member" — the same trap mw-workers hit and fixed as
      //      [FIX default-policy-that-cannot-mint-blocked-every-worker]. The default policy's
      //      answer is tried and a policy of our own is minted when it cannot.
      //   2. It always began with a bare string. Where the header says the document requires
      //      TrustedScriptURL that call is refused — correctly — but with the extension's
      //      Worker proxy installed (the per-site rewrite switch does that on youtube) the
      //      refusal happens THROUGH the proxy, and Chrome names the frame that made the
      //      sink call: the page under audit printed our bundle in its console for a
      //      violation the audit itself had provoked. The flag mw-workers reads for the same
      //      decision is read here too, and where it is set the probe mints first.
      const enforced = (() => {
        // '1' host history; '2:<timeOrigin>' this document's own verdict (mw-workers _tteFlag).
        try { return /^(1$|2:)/.test(String(sessionStorage.getItem('v.ui.tte'))); } catch (e) { return false; }
      })();
      const mint = () => {
        // Minting emits no violation where no name allowlist exists (youtube is that shape);
        // where one does, createPolicy throws and the row says so rather than guessing.
        let pol = trustedTypes.defaultPolicy, t = null;
        if (pol) { try { t = pol.createScriptURL(url); } catch (eDef) { t = null; } }
        if (!t || typeof t === 'string') {
          try {
            pol = trustedTypes.createPolicy('afp-audit-' + Math.random().toString(36).slice(2),
              { createScriptURL: (u) => u });
            t = pol.createScriptURL(url);
          } catch (eName) { out.workerWhy = 'tt-names'; throw eName; }
        }
        out.workerWhy = 'tt-enforced';
        return t;
      };
      let w;
      if (enforced && typeof trustedTypes !== 'undefined' && trustedTypes) {
        w = new Worker(mint());
      } else {
        try {
          w = new Worker(url);
        } catch (eTT) {
          // A TrustedScriptURL document the header did not announce (a first visit).
          if (eTT.name !== 'TypeError' || typeof trustedTypes === 'undefined' || !trustedTypes) throw eTT;
          w = new Worker(mint());
        }
      }
      const timer = setTimeout(() => { out.worker = 'TIMEOUT'; done(); }, 4000);
      w.onmessage = (e) => { clearTimeout(timer); out.worker = e.data; w.terminate(); done(); };
      w.onerror = (e) => {
        clearTimeout(timer);
        if (!e.message) out.workerWhy = 'csp-blob';
        out.worker = 'ERROR ' + (e.message || '(empty — a CSP that forbids blob: workers)');
        done();
      };
      w.postMessage(1);
    } catch (e) { out.worker = 'THREW ' + e.name; done(); }

    // [AUDIT who-is-named-in-a-refusal] Where THIS document's headers require a
    // TrustedScriptURL (v.ui.tte '2:<timeOrigin>' — the verdict from background.js), a
    // worker built from a bare string is refused: by the wrapper since
    // [FIX a-refusal-we-passed-through-was-charged-to-us], and by the browser before that —
    // which charged the refusal to the innermost script frame on the stack, ours, in the
    // page's console and on chrome://extensions. This row is the one way to check that in
    // the browser you actually run: one refusal is provoked and the violation records are
    // read for who they name. Skipped where the document does not enforce, because there
    // the string would build a real worker.
    try {
      const verified = (() => {
        try {
          const v = String(sessionStorage.getItem('v.ui.tte') || '');
          return /^2:/.test(v) && v.split(':')[1] === String(performance.timeOrigin);
        } catch (e) { return false; }
      })();
      if (!verified) {
        out.ttRefusal = 'n/a';
      } else {
        const seen = [];
        const onV = (e) => seen.push(String(e.sourceFile || ''));
        document.addEventListener('securitypolicyviolation', onV);
        let refused = false, message = '';
        try {
          const w = new Worker('/afp-audit-refusal-probe.js');
          try { w.terminate(); } catch (e) {}
        } catch (e) { refused = !!e && e.name === 'TypeError'; message = String(e && e.message).slice(0, 90); }
        pending++;
        setTimeout(() => {
          document.removeEventListener('securitypolicyviolation', onV);
          out.ttRefusal = { refused, message, violations: seen.length, named: seen.some((s) => /chrome-extension/.test(s)) };
          done();
        }, 150);
      }
    } catch (e) { out.ttRefusal = 'THREW ' + e.name; }

    // A same-origin iframe: its own realm, patched by a different code path again.
    try {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:absolute;left:-9999px;width:80px;height:80px';
      const timer = setTimeout(() => { out.iframe = 'TIMEOUT'; done(); }, 4000);
      f.onload = () => {
        clearTimeout(timer);
        try {
          const w2 = f.contentWindow;
          out.iframe = {
            cores: w2.navigator.hardwareConcurrency, memory: w2.navigator.deviceMemory,
            tz: new w2.Intl.DateTimeFormat().resolvedOptions().timeZone,
            lang: w2.navigator.language,
            navOwn: Object.getOwnPropertyNames(w2.navigator).sort().join(',') || '(none)',
          };
        } catch (e) { out.iframe = 'THREW ' + e.name; }
        f.remove(); done();
      };
      // [FIX a-scope-that-could-not-be-read-was-a-free-pass] Not location.href. On vk.com
      // that version simply never loaded and the row printed TIMEOUT: the site sends
      // X-Frame-Options, so its document refuses to be framed by anything, us included.
      // Appended with NO src and NO srcdoc: the frame lands on about:blank, inherits this
      // origin, and our content scripts reach it (match_about_blank + matchOriginAsFallback).
      //
      // srcdoc was the first attempt and it threw TypeError on youtube.com. `srcdoc` is a
      // TrustedHTML sink, and `require-trusted-types-for 'script'` covers every Trusted
      // Types sink rather than only the script-URL ones — so assigning a plain string to it
      // is refused exactly like `new Worker(<string>)` is. The XFO fixture that pinned the
      // srcdoc repair carries no trusted-types header, so it could not have caught this.
      // Assigning nothing touches no sink at all, and answers both refusals at once.
      document.body.appendChild(f);
    } catch (e) { out.iframe = 'THREW ' + e.name; done(); }

    // [FIX the-audit-compared-two-realms-of-thirteen] The two rows above were the whole
    // scope table, and BOTH defects found on 2026-09-06 lived in a realm it never opened:
    // a same-origin sandbox WITHOUT allow-scripts. That is the one shape where our content
    // scripts cannot run and the parent can still reach the globals, so the platform hands
    // any page a pristine set of interface prototypes in one line — and in it the patched
    // getter refused a receiver the platform accepts, and Date answered its NUMBERS from
    // the machine while its strings answered from the profile.
    //
    // The numeric side of Date is read here for that reason: a zone label and an offset can
    // disagree inside one object, and the label alone looked right the whole time.
    const realmRead = (w2) => ({
      cores: w2.navigator.hardwareConcurrency, memory: w2.navigator.deviceMemory,
      tz: new w2.Intl.DateTimeFormat().resolvedOptions().timeZone,
      lang: w2.navigator.language,
      off: new w2.Date(2026, 0, 15).getTimezoneOffset()
    });
    const realmFrame = (key, prep) => {
      try {
        const f = document.createElement('iframe');
        f.style.cssText = 'position:absolute;left:-9999px;width:80px;height:80px';
        // done() counts collectors, so it must run EXACTLY once for this frame. A frame
        // with no src fires load on some paths and not on others, so there are three ways
        // in — onload, a short fallback, and the timeout — and without this guard two of
        // them fire, pending goes negative and finish() runs before the other collectors
        // have answered. That is what turned the whole scope table red the first time.
        let fired = false;
        const read = () => {
          if (fired) return;
          fired = true;
          clearTimeout(timer);
          try { out[key] = realmRead(f.contentWindow); } catch (e) { out[key] = 'THREW ' + e.name; }
          try { f.remove(); } catch (eR) {}
          done();
        };
        const timer = setTimeout(() => {
          if (fired) return;
          fired = true;
          out[key] = 'TIMEOUT';
          try { f.remove(); } catch (eR) {}
          done();
        }, 4000);
        f.onload = read;
        try { prep(f); } catch (e) {
          if (!fired) { fired = true; clearTimeout(timer); out[key] = 'THREW ' + e.name; done(); }
          return;
        }
        document.body.appendChild(f);
        setTimeout(read, 400);
      } catch (e) { out[key] = 'THREW ' + e.name; done(); }
    };
    // No src and no srcdoc, for the reason the row above gives: both are Trusted-Types
    // sinks and a document that enforces them refuses a plain string.
    realmFrame('sandboxFrame', (f) => f.setAttribute('sandbox', 'allow-same-origin'));

    // The rejected-promise stack, which needs an await and so cannot sit with the rest.
    navigator.userAgentData.getHighEntropyValues('not-a-sequence')
      .then(() => { out.stackAsync = 'did not reject'; })
      .catch((e) => {
        out.stackAsync = /chrome-extension:\/\//.test(String(e && e.stack))
          ? 'NAMES THE EXTENSION' : 'clean';
      });
  });
}

/** This page's own realm — the HOST: the all-URLs match pattern misses chrome-extension:. */
function hostValues() {
  const gl = (() => {
    try {
      const c = document.createElement('canvas').getContext('webgl');
      const d = c.getExtension('WEBGL_debug_renderer_info');
      return c.getParameter(d.UNMASKED_RENDERER_WEBGL);
    } catch (e) { return '(unavailable)'; }
  })();
  return {
    cores: navigator.hardwareConcurrency,
    memory: navigator.deviceMemory,
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    language: navigator.language,
    languages: (navigator.languages || []).join(','),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    screenW: screen.width,
    screenH: screen.height,
    dpr: window.devicePixelRatio,
    cpuPerformance: ('cpuPerformance' in Navigator.prototype ? navigator.cpuPerformance : '(no such API)'),
    gpu: gl,
    navOwn: Object.getOwnPropertyNames(navigator).sort().join(',') || '(none)',
    screenOwn: Object.getOwnPropertyNames(screen).sort().join(',') || '(none)',
    markers: Object.getOwnPropertyNames(window).filter((n) => /^__/.test(n)).sort().join(',') || '(none)',
  };
}

const CLAIM_OF = {
  cores: (p) => p.hwConcurrency,
  memory: (p) => p.deviceMemory,
  platform: (p) => p.platform,
  userAgent: (p) => p.userAgent,
  language: (p) => p.language,
  languages: (p) => (p.languages || []).join(','),
  timezone: (p) => p.timezone,
  screenW: (p) => p.screenWidth,
  screenH: (p) => p.screenHeight,
  dpr: (p) => p.devicePixelRatio,
  gpu: (p) => p.webglRenderer,
};

const esc = (v) => String(v === undefined ? '(undefined)' : v)
  .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function section(title, header, body) {
  return `<h2>${esc(title)}</h2><table><tr>${header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${body}</table>`;
}

function verdictCell(state, text) {
  return `<td class="${state}">${esc(text)}</td>`;
}

function run(tabId) {
  const status = $('status');
  status.textContent = 'reading…';
  chrome.runtime.sendMessage({ type: 'getFullConfig' }, (cfg) => {
    const profile = (cfg && cfg.profile) || {};
    chrome.scripting.executeScript(
      { target: { tabId }, world: 'MAIN', func: pageCollector },
      (res) => {
        if (chrome.runtime.lastError || !res || !res[0]) {
          status.textContent = 'could not inject: ' +
            ((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'no result') +
            ' — pick an ordinary http(s) tab, not a chrome:// or Web Store page';
          return;
        }
        status.textContent = '';
        render(profile, res[0].result || {}, hostValues());
        buildDump(tabId, profile, res[0].result || {});
      }
    );
  });
}

/**
 * [AUDIT copyable-state] Everything this page saw, as one block of text: the table, the
 * per-site flags the page can read, the document's own header verdict from the service
 * worker, the host lists and the per-site switches for this host, versions. Both reports of
 * 2026-09-03 came as a screenshot of the table plus one console line, and the cause had to
 * be reconstructed from the shape of the symptoms; the rig cannot load a branded Chrome, so
 * this page is the only instrument in the browser the user runs.
 */
function buildDump(tabId, profile, page) {
  const lines = [];
  // Every pair goes into both shapes at once: the prose a person pastes into a report, and
  // the object under it. Two writers would drift, and the one that drifts is always the one
  // nobody reads.
  const data = {};
  const add = (k, v) => {
    data[k] = v;
    lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  };
  const KEYS = ['afp_csp_noblob', 'afp_csp_tt', 'afp_csp_tte', 'afp_csp_nc', 'afp_csp_ns', 'afp_csp_mixed', 'afp_csp_rewrite',
    'afp_sw_blocked', 'afp_webrtc_exceptions', 'afp_profile_id', 'afp_country_code', 'afp_mode'];
  chrome.tabs.get(tabId, (tab) => {
    const url = (tab && tab.url) || '';
    const host = (() => { try { return new URL(url).hostname; } catch (e) { return ''; } })();
    chrome.storage.local.get(KEYS, (st) => {
      st = st || {};
      chrome.runtime.sendMessage({ type: 'afpCspVerdictForTab', tabId }, (verdict) => {
        // Per route since [FIX csp-restrictions-learned-per-route]: 'route' is this
        // document's, 'host' is another route of the same host (the site restricts
        // somewhere else), false is neither.
        const scope = afpCspScope(url);
        const listed = (k) => afpCspScopeMatches(st[k], scope) ? 'route' : (afpCspHostListed(st[k], host) ? 'host' : false);
        add('extension', chrome.runtime.getManifest().version);
        add('browser', navigator.userAgent);
        add('tab', url);
        add('verdict', $('verdict').textContent.trim());
        add('profile', { id: st.afp_profile_id, country: st.afp_country_code, mode: st.afp_mode, hostHw: !!profile.hostHw });
        add('document headers (service worker)', verdict || 'no record for this tab');
        add('host lists', { noblob: listed('afp_csp_noblob'), tt: listed('afp_csp_tt'), tte: listed('afp_csp_tte'),
          nc: listed('afp_csp_nc'), ns: listed('afp_csp_ns') });
        // [AUDIT routes-of-this-host] Since [FIX csp-restrictions-learned-per-route] the
        // lists hold host/segment, so "the site is listed" no longer says which documents
        // it applies to. Every entry of this host, per list, plus whether the host was seen
        // BOTH restricting and not (afp_csp_mixed — the mark that stops the collapse to one
        // host-wide entry). Storage is the only other place this is visible.
        const routesOf = (k) => (Array.isArray(st[k]) ? st[k] : []).filter((e) => {
          const eh = afpCspScopeHost(e);
          return eh && (host === eh || host.endsWith('.' + eh));
        });
        const routes = {};
        for (const k of ['afp_csp_noblob', 'afp_csp_tt', 'afp_csp_tte', 'afp_csp_nc', 'afp_csp_ns']) {
          const r = routesOf(k);
          if (r.length) routes[k.replace('afp_csp_', '')] = r;
        }
        add('routes of this host', Object.keys(routes).length ? routes : 'none learned');
        add('host seen both strict and loose', afpCspHostListed(st.afp_csp_mixed, host));
        add('per-site switches', {
          cspRewrite: !!(st.afp_csp_rewrite && Object.prototype.hasOwnProperty.call(st.afp_csp_rewrite, host)),
          serviceWorkerBlocked: listed('afp_sw_blocked'),
          webrtcException: listed('afp_webrtc_exceptions')
        });
        add('page flags (sessionStorage)', page.flags);
        add('worker probe', page.worker && typeof page.worker === 'object' ? 'ok' : page.worker);
        if (page.workerWhy) add('worker probe rule', page.workerWhy);
        add('refusal probe', page.ttRefusal);
        lines.push('', $('out').innerText.trim());
        // [AUDIT the-snapshot-could-only-be-read-by-eye] The machine-readable half, LAST so
        // the prose above it stays the first thing a reader sees, and fenced by a line that
        // is easy to split on. `rows` is the claim/page/host table — the three columns this
        // page exists to produce — and everything else is the state that was true when it
        // was taken. Held by test/auditpage.mjs, which parses it rather than matching it.
        data.rows = AUDIT_ROWS;
        lines.push('', '--- json ---', JSON.stringify(data));
        const dump = $('dump');
        dump.value = lines.join('\n');
        dump.hidden = false;
        $('copy').disabled = false;
      });
    });
  });
}

/**
 * Rows where the HOST showing through is the design rather than a failure, with the rule
 * that decides it. Keyed rather than blanket, and each one is a predicate over (claim, host)
 * so that the same key can still fail when the rule does not apply.
 *
 * Only the screen so far. A screen cannot be smaller than the window it contains — CSS
 * layout proves the lower bound, and a claim of 1920 beside a 2008px viewport is refutable
 * with one `100vw` — so mw-core raises the claim to at least the native panel. README "Limits"
 * item 7. A host SMALLER than the claim showing through is still a failure: nothing forces
 * that, and it would mean the spoof did not apply at all.
 */
// The values a WORKER can read, and so the ones mw-core hands back on an origin where a
// worker cannot be patched. Deliberately not screen, dpr or the media queries: there is no
// screen and no DOM in a worker scope, they are never stood down, and treating them this
// way would turn one named limit into a blanket excuse.
const WORKER_VISIBLE = {
  cores: 1, memory: 1, platform: 1, userAgent: 1, language: 1, languages: 1,
  timezone: 1, locale: 1, gpu: 1,
};

const RAISED_TO_HOST = {
  screenW: (claim, hostV) => Number(hostV) > Number(claim),
  screenH: (claim, hostV) => Number(hostV) > Number(claim),
};

/**
 * [AUDIT the-snapshot-could-only-be-read-by-eye] The claim/page/host table as data, filled
 * by render() and emitted by buildDump(). Module scope because those two are separate calls
 * on the same result and threading a second return value through render() would touch every
 * section for the benefit of one.
 */
let AUDIT_ROWS = [];
/** undefined/null stay distinguishable from the strings "undefined" and "null". */
const str = (v) => (v === undefined || v === null) ? null : String(v);

function render(profile, page, host) {
  let bad = 0, checked = 0;
  const out = [];
  AUDIT_ROWS = [];

  // ---- 1. the page must report the CLAIM, and must not report the HOST ----
  let body = '';
  for (const key of Object.keys(CLAIM_OF)) {
    const claim = CLAIM_OF[key](profile);
    const seen = page[key];
    const hostV = host[key];
    let state, text;
    if (claim === undefined || claim === null || claim === '') {
      state = 'skip'; text = 'no claim';
    } else if (page.standDown === true && WORKER_VISIBLE[key]
               && String(claim) !== String(hostV)) {
      // [FIX the-audit-counted-the-stand-down-as-a-failure] Reported from a real browser on
      // youtube.com: "7 of 16 checks failed", every one of them a value the extension had
      // just been taught to hand over on purpose. That origin refuses blob: workers, so its
      // own workers read the machine and the window yields rather than contradict them —
      // README "Limits", item 6, and the scope row two tables down says "the window agrees with
      // it" in the same breath. The page was calling one behaviour a pass and a failure at
      // once.
      //
      // BOTH DIRECTIONS, or this is just a broader excuse than the one it replaces. Where
      // the stand-down is in force the host is the RIGHT answer and is named; the claim is
      // the wrong one and FAILS, because that is precisely the defect that shipped between
      // 2026-08-22 and 2026-09-02 — the gate was written, believed, and never fired once.
      // Only the values a worker can actually read are treated this way: screen, dpr and
      // the rest have no worker-side reader, are not stood down, and keep their own rules.
      // The `claim !== host` guard above is what keeps this from being a free pass. Where
      // the two are the same value — platform and userAgent on this machine — the row
      // cannot tell a stand-down from a spoof, there is nothing to hand over, and calling
      // it a named limit only shrinks the count. Those fall through and are CHECKED.
      if (String(seen) === String(hostV)) {
        state = 'skip'; text = 'the stand-down — README "Limits", item 6'; 
      } else {
        state = 'bad'; bad++; checked++;
        text = 'STILL CLAIMING where a worker reads the host';
      }
    } else if (String(seen) === String(claim)) {
      state = 'ok'; text = 'matches the claim'; checked++;
    } else if (RAISED_TO_HOST[key] && RAISED_TO_HOST[key](claim, hostV)) {
      // [FIX the-audit-called-a-documented-limit-a-failure] Reported from a real browser:
      // a green build, and "2 of 17 checks failed" — both of them the screen, on a machine
      // whose panel is 2008x1255 CSS px against a claim of 1920x1080.
      //
      // That is not the spoof failing, it is the spoof being refused: a screen cannot be
      // smaller than the window it contains, CSS layout proves the lower bound, and a claim
      // of 1920 beside a 2008px viewport is refutable with one `100vw`. mw-core raises the
      // claim to at least the native panel for exactly that reason, and README "Limits", item 7
      // says so — the list is printed directly under this verdict, which made the page
      // contradict itself on the same screen.
      //
      // So it is named rather than counted, and the discriminator is the rule itself, not
      // the key: the host being LARGER than the claim is the case the clamp exists for. A
      // host SMALLER than the claim showing through is still a failure, because nothing
      // forces that and it would mean the spoof simply did not apply.
      state = 'skip'; text = 'the host is larger than the claim — README "Limits", item 7';
    } else if (String(seen) === String(hostV)) {
      state = 'bad'; text = 'THE HOST — not patched here'; bad++; checked++;
    } else {
      state = 'bad'; text = 'neither claim nor host'; bad++; checked++;
    }
    body += `<tr><td>${esc(key)}</td><td class="v">${esc(claim)}</td><td class="v">${esc(seen)}</td><td class="v">${esc(hostV)}</td>${verdictCell(state, text)}</tr>`;
    // [AUDIT the-snapshot-could-only-be-read-by-eye] The same row, as data. Both reports of
    // 2026-09-03 arrived as a screenshot of this table, and the three columns had to be
    // retyped before anything could be compared with them. They are the one measurement no
    // rig can produce — a branded Chrome refuses --load-extension — so they are worth
    // handing over in a form a script can read.
    AUDIT_ROWS.push({ key: key, claim: str(claim), page: str(seen), host: str(hostV), state: state, why: text });
  }
  out.push(section('the page reports the claim, not the host',
    ['', 'claimed (service worker)', 'seen by the page', 'this machine', ''], body));
  out.push('<p class="note">The middle two columns are the whole point. A rig can produce ' +
    'the first and the third, never the second — this extension cannot be loaded into a ' +
    'branded Chrome from the command line.</p>');

  // ---- 2. every scope agrees ----
  body = '';
  const scopes = [['worker', page.worker], ['same-origin iframe', page.iframe],
    ['sandboxed frame (no scripts)', page.sandboxFrame]];
  for (const [name, got] of scopes) {
    if (!got || typeof got !== 'object') {
      // A scope that could not be read used to print grey and leave the total alone. That
      // is the same shape as every self-check this project has had to fix: it reports
      // nothing wrong on a build that is broken. Either the reason is a page rule that
      // ALSO tells us what a worker here would read — in which case the verdict is derived
      // from the two columns already collected — or the scope counts as unread, which is a
      // failure and not a footnote.
      const blind = name === 'worker' &&
        (page.workerWhy === 'csp-blob' || page.workerWhy === 'tt-names');
      if (blind) {
        // Both of those rules stop OUR patch as surely as they stopped this probe:
        // mw-workers builds every patched worker from a blob and needs a policy name to
        // hand it over. So on this origin the page's own workers run native and read the
        // machine — no worker of ours is needed to know it. What the row then asks is
        // whether the WINDOW still claims something else, which is a contradiction a site
        // can read in two lines, and it is the reason this branch exists at all.
        const pairs = [['cores', 'cores'], ['memory', 'memory'],
          ['timezone', 'timezone'], ['language', 'language']];
        const off = pairs.filter(([k]) => String(page[k]) !== String(host[k]))
          .map(([k]) => `${k}: window ${page[k]} vs a worker here ${host[k]}`);
        checked++;
        const why = page.workerWhy === 'csp-blob'
          ? "this origin's CSP refuses blob: workers"
          : 'this origin allows only named Trusted-Types policies';
        if (off.length) bad++;
        body += `<tr><td>${esc(name)}</td><td class="v" colspan="3">${esc(why)}, so a worker here is ` +
          `unpatchable and reads this machine — ${esc(off.length ? off.join(' ; ') : 'and the window agrees with it')}</td>` +
          verdictCell(off.length ? 'bad' : 'ok',
            off.length ? 'SPLIT — the window contradicts it' : 'agrees');
        continue;
      }
      checked++; bad++;
      body += `<tr><td>${esc(name)}</td><td class="v" colspan="3">${esc(got)}</td>` +
        verdictCell('bad', 'NO READING — this scope went unchecked') + '</tr>';
      continue;
    }
    // The January offset joins the four: a realm can carry the right zone LABEL and the
    // wrong offset in the same Date object, which is how the sandbox frame read the machine
    // in numbers while reading the profile in words.
    const pairs = [['cores', page.cores], ['memory', page.memory], ['tz', page.timezone],
      ['lang', page.language], ['off', page.offJan]];
    const off = pairs.filter(([k, v]) => got[k] !== undefined && String(got[k]) !== String(v))
      .map(([k, v]) => `${k}: ${got[k]} vs window ${v}`);
    checked++;
    if (off.length) bad++;
    body += `<tr><td>${esc(name)}</td><td class="v" colspan="3">${esc(off.length ? off.join(' ; ') : 'cores, memory, timezone, language and the January offset all match the window')}</td>` +
      verdictCell(off.length ? 'bad' : 'ok', off.length ? 'DISAGREES with the window' : 'agrees');
  }
  // ---- who is named in a refusal (documents that require Trusted Types only) ----
  {
    const r = page.ttRefusal;
    if (r && typeof r === 'object') {
      checked++;
      const good = r.refused && !r.named;
      if (!good) bad++;
      const text = !r.refused
        ? 'the bare string was NOT refused — this document accepted a worker its header says it must not'
        : r.named
          ? 'refused, and a violation record names an extension — the refusal went through our frame'
          : r.violations
            ? 'refused by the browser, and the violation record is charged to the page'
            : 'refused by the wrapper: the same TypeError, no violation record, nothing named';
      body += `<tr><td>bare-string worker refusal</td><td class="v" colspan="3">${esc(text)}${r.message ? ' — ' + esc(r.message) : ''}</td>` +
        verdictCell(good ? 'ok' : 'bad', good ? 'nothing names us' : 'NAMED, or not refused');
    } else {
      body += `<tr><td>bare-string worker refusal</td><td class="v" colspan="3">${esc(r === 'n/a'
        ? 'not applicable — this document does not require Trusted Types, or its verdict has not arrived'
        : r)}</td>` + verdictCell('skip', 'not applicable');
    }
  }
  out.push(section('every scope tells the same story', ['scope', 'reading', '', '', ''], body));

  // ---- 3. what a page can read about the extension itself ----
  body = '';
  // [FIX the-audit-blamed-the-sites-own-polyfills-on-the-extension] Reported from a real
  // browser on vk.com: `navigator own properties: getUserMedia — differs from clean`, and
  // counted as a failure. The extension never touches that name — it appears in one comment
  // and nowhere else — and it is the classic WebRTC polyfill a site writes itself:
  //
  //     navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || …
  //
  // The comparison was unfair by construction. It read the AUDITED page, where the site's
  // own scripts have run, against this extension page, where none have — so any site that
  // assigns anything onto navigator is charged to us.
  //
  // The discriminator is the one CreepJS itself uses and test/clientlitter.mjs already
  // trusts: a FRESH same-origin iframe. Our content scripts run there too (all_frames), so
  // whatever WE add is present in both; whatever the PAGE added is present only in the top
  // document. So the row now asks about the intersection — what survives into a realm the
  // site's scripts never touched — and names the rest as the page's.
  const pageAdded = (top, frame) => {
    const f = new Set(String(frame || '').split(',').filter(Boolean));
    return String(top || '').split(',').filter((n) => n && !f.has(n));
  };
  const frameNav = page.navOwnBlank;
  const oursNav = (frameNav === undefined || frameNav === null || /^THREW/.test(String(frameNav)))
    ? page.navOwn                       // no blank-frame reading: fall back to the harsher comparison
    : frameNav;
  const sitesNav = (frameNav && !/^THREW/.test(String(frameNav)))
    ? pageAdded(page.navOwn, frameNav) : [];

  const litter = [
    ['error stack, synchronous throw', page.stackSync, 'clean'],
    ['error stack, rejected promise', page.stackAsync, 'clean'],
    ['navigator own properties', oursNav, host.navOwn],
    ['screen own properties', page.screenOwn, host.screenOwn],
    ['media queries vs the CSS engine', page.media && page.media.unexpected, '(none)'],
  ];
  for (const [name, got, want] of litter) {
    checked++;
    const good = String(got) === String(want);
    if (!good) bad++;
    body += `<tr><td>${esc(name)}</td><td class="v">${esc(got)}</td><td class="v">${esc(want)}</td>` +
      verdictCell(good ? 'ok' : 'bad', good ? 'as a clean browser' : 'differs from clean');
  }
  // What the SITE put on navigator, shown so the row above is readable rather than merely
  // shorter. Not counted: a page assigning to its own navigator is a page doing its job.
  if (sitesNav.length) {
    body += `<tr><td>…of which the site's own, not ours</td><td class="v">${esc(sitesNav.join(','))}</td>` +
      `<td class="v">absent from a fresh blank iframe</td>` +
      verdictCell('skip', "the page's own script — not counted");
  }
  // The markers are a known, argued difference rather than a defect, so they are reported
  // and not counted — see the note under the table.
  // The dpr/resolution family disagrees by construction — matchMedia answers from the
  // profile, the CSS engine from the real window, and no extension reaches the CSS engine.
  // Shown so it is never mistaken for the unprefixed spellings above, which must agree.
  body += `<tr><td>…of which structural (dpr vs the real window)</td><td class="v">${esc(page.media && page.media.expected)}</td><td class="v">expected</td>` +
    verdictCell('skip', 'cannot be fixed from an extension');
  body += `<tr><td>window markers</td><td class="v">${esc(page.markers)}</td><td class="v">${esc(host.markers)}</td>` +
    verdictCell('skip', 'known — reported, not counted');
  out.push(section('what a page can read about the extension',
    ['', 'in the page', 'clean (this tab)', ''], body));
  out.push('<p class="note">The clean column is this page\'s own realm: extension pages are ' +
    'not matched by <code>*://*/*</code>, so the content scripts never ran here. ' +
    '<code>__t0</code> and <code>__p0</code> are ours and non-enumerable; they cancel in the ' +
    'iframe diff CreepJS actually performs, which is why they are shown rather than failed.</p>');

  $('out').innerHTML = out.join('');
  const v = $('verdict');
  v.className = bad ? 'bad' : 'ok';
  v.textContent = bad
    ? `${bad} of ${checked} checks failed`
    : `all ${checked} checks passed`;
}

// ---- tab picker ----------------------------------------------------------
chrome.tabs.query({}, (tabs) => {
  const sel = $('tab');
  const usable = tabs.filter((t) => /^https?:/.test(t.url || ''));
  if (!usable.length) {
    sel.innerHTML = '<option>open any ordinary http(s) page first</option>';
    $('run').disabled = true;
    return;
  }
  usable.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  sel.innerHTML = usable.map((t) =>
    `<option value="${t.id}">${esc((t.title || t.url).slice(0, 90))}</option>`).join('');
});

$('run').addEventListener('click', () => {
  const id = Number($('tab').value);
  $('copy').disabled = true;
  $('dump').hidden = true;
  if (id) run(id);
});

$('copy').addEventListener('click', () => {
  const text = $('dump').value;
  const status = $('status');
  navigator.clipboard.writeText(text).then(
    () => { status.textContent = 'copied'; },
    () => { $('dump').select(); status.textContent = 'select the text and copy it by hand'; }
  );
});
