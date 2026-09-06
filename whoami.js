// Who Am I — AFP storage (getFullConfig + live navigator)
(function () {
  /**
   * The catalogue, with the Russian original kept as the fallback — a key that is not
   * there leaves today's text rather than blanking the element. Same rule as i18n.js.
   */
  const T = (key, ru, ...subs) => {
    try {
      const m = window.afpMsg && window.afpMsg(key, subs.length ? subs.map(String) : undefined);
      return (typeof m === 'string' && m !== '') ? m : ru;
    } catch (e) { return ru; }
  };

  const $ = (id) => document.getElementById(id);
  let profile = null;
  let features = null;
  let mode = 'normal';

  function setText(id, val) {
    const el = $(id);
    if (el) el.textContent = val == null || val === '' ? '—' : String(val);
  }

  function setBadge(id, text, ok) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('ok', !!ok);
  }

  async function load() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'getFullConfig' });
      if (res && res.profile) profile = res.profile;
      if (res && res.features) features = res.features;
      if (res && res.mode) mode = res.mode;
    } catch (e) {
      console.warn('[WhoAmI] getFullConfig', e);
    }
    try {
      const st = await chrome.storage.local.get(['afp_features', 'afp_mode', 'afp_noise_seed', 'afp_profile_id', 'afp_country_code']);
      if (!features) features = st.afp_features || null;
      if (!mode) mode = st.afp_mode || 'normal';
      if (!profile) {
        profile = {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          languages: navigator.languages,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory: navigator.deviceMemory,
          maxTouchPoints: navigator.maxTouchPoints,
          screenWidth: screen.width,
          screenHeight: screen.height,
          colorDepth: screen.colorDepth,
          devicePixelRatio: window.devicePixelRatio,
          timezone: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone,
          noiseSeed: st.afp_noise_seed,
          profileId: st.afp_profile_id,
          countryCode: st.afp_country_code
        };
      }
      if (profile.noiseSeed == null && st.afp_noise_seed != null) profile.noiseSeed = st.afp_noise_seed;
      if (!profile.countryCode && st.afp_country_code) profile.countryCode = st.afp_country_code;
    } catch (e2) {
      console.warn('[WhoAmI] storage', e2);
    }
    render();
  }

  function seedHash(seed) {
    const n = (typeof seed === 'number' ? seed : 0) >>> 0;
    const h = n.toString(16).toUpperCase().padStart(8, '0');
    return '#' + h.slice(0, 4) + '-' + h.slice(4, 8);
  }

  function render() {
    const p = profile || {};
    const status = $('protectionStatus');
    if (status) {
      const ind = status.querySelector('.status-indicator');
      const txt = status.querySelector('.status-text');
      if (ind) ind.classList.add('active');
      if (txt) {
        txt.textContent = (mode === 'stealth' || mode === 'hidden')
          ? T('whoModeStealth', 'Скрытый') : T('whoModeNormal', 'Обычный');
      }
    }

    setText('fingerprintHash', seedHash(p.noiseSeed));
    setText('userAgent', p.userAgent || navigator.userAgent);
    setText('platform', p.platform || navigator.platform);
    setText('language', p.language || navigator.language);
    setText('languages', Array.isArray(p.languages) ? p.languages.join(', ') : (navigator.languages || []).join(', '));

    setText('cpuCores', p.hwConcurrency != null ? p.hwConcurrency : (p.hardwareConcurrency != null ? p.hardwareConcurrency : navigator.hardwareConcurrency));
    setText('memory', p.deviceMemory != null ? p.deviceMemory : navigator.deviceMemory);
    setText('touchPoints', p.maxTouchPoints != null ? p.maxTouchPoints : navigator.maxTouchPoints);

    const sw = p.screenWidth || screen.width;
    const sh = p.screenHeight || screen.height;
    setText('resolution', sw + ' × ' + sh);
    setText('colorDepth', (p.colorDepth != null ? p.colorDepth : screen.colorDepth) + '-bit');
    setText('pixelRatio', p.devicePixelRatio != null ? p.devicePixelRatio : window.devicePixelRatio);

    setText('gpuVendor', p.webglVendor || '—');
    setText('gpuRenderer', p.webglRenderer || '—');
    setBadge('webglStatus', p.webglRenderer ? 'ok' : 'n/a', !!p.webglRenderer);

    setText('timezone', p.timezone || '—');
    try {
      // [FIX] Offset from profile TZ, not host browser (was desync when country ≠ real TZ)
      var tzName = p.timezone || (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone;
      var offsetMin = null;
      if (tzName && typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
        var parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tzName,
          timeZoneName: 'shortOffset'
        }).formatToParts(new Date());
        var tzPart = parts.find(function (x) { return x.type === 'timeZoneName'; });
        if (tzPart && tzPart.value) {
          var m = String(tzPart.value).match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
          if (m) {
            var sign = m[1] === '-' ? -1 : 1;
            offsetMin = sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10));
          }
        }
      }
      if (offsetMin == null) offsetMin = -new Date().getTimezoneOffset();
      var hours = offsetMin / 60;
      var label = (hours >= 0 ? '+' : '') + (Number.isInteger(hours) ? hours : hours.toFixed(1)) + 'h';
      setText('timezoneOffset', label);
    } catch (_) {
      setText('timezoneOffset', '—');
    }
    setText('geolocation', (p.countryCode || '') + (p.timezone ? ' · ' + p.timezone : ''));
    setBadge('locationStatus', p.timezone ? 'ok' : '—', !!p.timezone);

    const feat = features || {};
    const canvasOn = feat.canvas !== false;
    setText('canvasProtection', canvasOn ? 'noise on' : 'off');
    setText('canvasNoise', p.noiseSeed != null ? 'seed ' + seedHash(p.noiseSeed) : '—');
    setBadge('canvasStatus', canvasOn ? 'on' : 'off', canvasOn);

    setText('webrtcMode', feat.webrtc !== false ? 'protected' : 'off');
    setText('webrtcLeak', feat.webrtc !== false ? 'blocked' : 'native');
    setBadge('webrtcStatus', feat.webrtc !== false ? 'on' : 'off', feat.webrtc !== false);

    setText('dntSignal', p.doNotTrack != null ? String(p.doNotTrack) : String(navigator.doNotTrack));
    setText('gpcSignal', (navigator.globalPrivacyControl != null) ? String(navigator.globalPrivacyControl) : '—');
    setText('visibilitySignal', document.visibilityState || '—');
    setText('windowNameSignal', window.name ? '(set)' : '(empty)');

    renderFeaturesGrid(feat);
    
  }

  function renderFeaturesGrid(feat) {
    const grid = $('protectionsGrid');
    if (!grid) return;
    const keys = [
      'canvas', 'webgl', 'webrtc', 'navigator', 'screen', 'timezone',
      'geolocation', 'fonts', 'battery', 'plugins', 'network', 'clientRects', 'hideAdBlocker'
    ];
    if (feat && Object.keys(feat).length) {
      grid.innerHTML = keys.map((k) => {
        // A missing key means the default, which is "on" — same rule as
        // afpMergeFeatures in defaults.js.
        const enabled = feat[k] === undefined ? true : !!feat[k];
        return '<div class="protection-item ' + (enabled ? 'active' : 'inactive') + '"><span>' + k + '</span></div>';
      }).join('');
    } else {
      grid.innerHTML = '<div class="protection-item active"><span>defaults</span></div>';
    }
  }

  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.hidden = false;
    setTimeout(() => { t.hidden = true; }, 1800);
  }

  // ==========================================================================
  // SCOPE PARITY SELF-CHECK
  //
  // The invariant the whole extension rests on: window, Worker and iframe must
  // report the same thing. A site does not have to know the true value to catch a
  // spoof — it only has to read one signal twice and see two answers, and then it
  // knows more about the visitor than it would have learned from the truth.
  //
  // The dev-*.html suite checks this, but only for whoever runs it. This runs it on
  // whatever the user is actually browsing.
  //
  // It cannot run on this page: whoami.html is chrome-extension://, which the content
  // scripts do not match (they match *://*/*), so this document's navigator is the
  // real one. The probe is injected into a chosen tab instead.
  // ==========================================================================

  /**
   * Injected into the page's MAIN world. Reads the same probe in three realms.
   *
   * The probe takes its global object as a parameter rather than closing over one:
   * that is what makes the iframe reading its OWN Navigator/Intl/Date instead of the
   * parent's, with no eval — which a site's CSP would block anyway. The worker gets
   * the same function through toString(), the way mw-workers.js emits its payload.
   */
  async function afpScopeProbe() {
    function probe(G) {
      var r = {};
      function t(k, fn) {
        try {
          var v = fn();
          r[k] = v === undefined ? '<undefined>' : String(v);
        } catch (e) { r[k] = 'ERR ' + (e && e.message ? e.message : e); }
      }
      var N = G.navigator;
      t('navigator.hardwareConcurrency', function () { return N.hardwareConcurrency; });
      t('navigator.deviceMemory', function () { return N.deviceMemory; });
      t('navigator.platform', function () { return N.platform; });
      t('navigator.userAgent', function () { return N.userAgent; });
      t('navigator.language', function () { return N.language; });
      t('navigator.languages', function () { return (N.languages || []).join(','); });
      t('userAgentData.platform', function () { return N.userAgentData.platform; });
      t('userAgentData.brands', function () {
        return (N.userAgentData.brands || []).map(function (b) { return b.brand + ' ' + b.version; }).sort().join(' | ');
      });
      t('Intl timeZone', function () { return new G.Intl.DateTimeFormat().resolvedOptions().timeZone; });
      t('Intl locale', function () { return new G.Intl.DateTimeFormat().resolvedOptions().locale; });
      // Two fixed instants, one either side of the northern DST switch: a zone faked as
      // a single "now" offset gives the same number twice and is caught here.
      t('getTimezoneOffset Jan', function () { return new G.Date('2025-01-15T12:00:00Z').getTimezoneOffset(); });
      t('getTimezoneOffset Jul', function () { return new G.Date('2025-07-15T12:00:00Z').getTimezoneOffset(); });
      t('getHours Jul', function () { return new G.Date('2025-07-15T12:00:00Z').getHours(); });
      t('Date.toString zone', function () {
        var m = /\(([^)]*)\)/.exec(new G.Date('2025-07-15T12:00:00Z').toString());
        return m ? m[1] : '<none>';
      });
      // OffscreenCanvas is the one drawing surface all three realms have, so the same
      // pixels can be compared without switching API between scopes.
      t('canvas hash', function () {
        var c = new G.OffscreenCanvas(220, 40);
        var x = c.getContext('2d', { willReadFrequently: true });
        x.textBaseline = 'top';
        x.font = '16px Arial';
        x.fillStyle = '#f60';
        x.fillRect(0, 0, 90, 20);
        x.fillStyle = '#069';
        x.fillText('Fingerprint Shield', 2, 14);
        var d = x.getImageData(0, 0, 220, 40).data;
        var h = 0x811c9dc5;
        for (var i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0; }
        return (h >>> 0).toString(16);
      });
      function gl(G2) {
        var c = new G2.OffscreenCanvas(64, 64);
        return c.getContext('webgl2') || c.getContext('webgl');
      }
      t('WebGL vendor', function () {
        var g = gl(G), e = g.getExtension('WEBGL_debug_renderer_info');
        return g.getParameter(e ? e.UNMASKED_VENDOR_WEBGL : g.VENDOR);
      });
      t('WebGL renderer', function () {
        var g = gl(G), e = g.getExtension('WEBGL_debug_renderer_info');
        return g.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : g.RENDERER);
      });
      t('WebGL MAX_TEXTURE_SIZE', function () { return gl(G).getParameter(0x0D33); });
      return r;
    }

    var out = { window: null, worker: null, iframe: null, notes: [] };

    try { out.window = probe(window); }
    catch (e) { out.notes.push({ c: 'window', d: e.message }); }

    // about:blank inherits this origin, and the content scripts declare
    // match_about_blank, so the frame is patched the same way a real subframe is.
    try {
      var fr = document.createElement('iframe');
      fr.style.display = 'none';
      document.documentElement.appendChild(fr);
      await new Promise(function (r) { setTimeout(r, 80); });
      out.iframe = probe(fr.contentWindow);
      fr.remove();
    } catch (e2) {
      out.notes.push({ c: 'iframe', d: e2.message });
    }

    try {
      var body = 'self.onmessage=function(){var probe=' + probe.toString() +
        ';try{postMessage({ok:1,r:probe(self)});}catch(e){postMessage({ok:0,e:String(e)});}};';
      var url = URL.createObjectURL(new Blob([body], { type: 'application/javascript' }));
      // A document that requires TrustedScriptURL (youtube.com) refuses the bare string
      // with a TypeError before any CSP is consulted. Same workaround audit.js uses: mint a
      // policy — allowed, and reported nowhere, on an origin without a trusted-types
      // allowlist — and retry. Only when the plain form was refused, so an ordinary page
      // still builds its worker exactly as before. Without this the row read "Worker
      // недоступен" on every trusted-types site, which is where the answer matters most.
      // One construction, not a throwaway probe: on a blob-refusing origin every blob
      // worker built here is watched by the wrapper and its failure sets the tab's
      // stand-down flag, so a second attempt would be a second chance to trip it.
      function buildWorker() {
        try { return new Worker(url); }
        catch (eTT) {
          if (!(eTT instanceof TypeError) || typeof trustedTypes === 'undefined' || !trustedTypes) throw eTT;
          var pol = trustedTypes.defaultPolicy || null;
          var minted = null;
          try { minted = pol && pol.createScriptURL(url); } catch (eDef) { minted = null; }
          if (!minted || String(minted) !== url) {
            pol = trustedTypes.createPolicy('afp-whoami-' + Math.random().toString(36).slice(2),
              { createScriptURL: function (s) { return s; } });
            minted = pol.createScriptURL(url);
          }
          return new Worker(minted);
        }
      }
      var res = await new Promise(function (resolve) {
        var w = buildWorker();
        var timer = setTimeout(function () { try { w.terminate(); } catch (e) {} resolve({ ok: 0, e: 'timeout' }); }, 8000);
        w.onmessage = function (ev) { clearTimeout(timer); try { w.terminate(); } catch (e) {} resolve(ev.data); };
        w.onerror = function (ev) { clearTimeout(timer); resolve({ ok: 0, e: ev.message || 'worker failed to start' }); };
        w.postMessage(1);
      });
      URL.revokeObjectURL(url);
      if (res && res.ok) out.worker = res.r;
      else out.notes.push({ c: 'worker', d: (res && res.e) || null });
    } catch (e3) {
      // A site whose CSP forbids blob: workers is a real answer, not a failure of ours.
      out.notes.push({ c: 'workerCsp', d: e3.message });
    }

    return out;
  }

  const parityTab = $('parityTab');
  const parityBtn = $('parityBtn');
  const parityOut = $('parityOut');

  async function fillTabList() {
    if (!parityTab) return;
    let tabs = [];
    try { tabs = await chrome.tabs.query({}); } catch (e) { tabs = []; }
    const here = location.href;
    const usable = tabs.filter((t) =>
      t.id != null && t.url && /^https?:\/\//.test(t.url) && t.url !== here);
    // Most recently looked at first — that is the page the user has in mind.
    usable.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    if (!usable.length) {
      parityTab.innerHTML = '<option value="">' +
        esc(T('whoNoTabs', 'нет открытых http(s) вкладок')) + '</option>';
      parityTab.disabled = true;
      if (parityBtn) parityBtn.disabled = true;
      return;
    }
    parityTab.disabled = false;
    if (parityBtn) parityBtn.disabled = false;
    parityTab.innerHTML = usable.map((t) => {
      let host = t.url;
      try { host = new URL(t.url).host; } catch (e) {}
      const title = (t.title || host).slice(0, 60);
      return '<option value="' + t.id + '">' + esc(host + ' — ' + title) + '</option>';
    }).join('');
  }

  /**
   * One note from the probe, in words. The probe cannot reach a catalogue, so it hands
   * back {c: which scope, d: the platform's own message} and the sentence is built here.
   * A plain string is still accepted: an older probe result, or a note added by hand.
   */
  function noteText(n) {
    if (typeof n === 'string') return n;
    const d = n.d || T('whoNoAnswer', 'нет ответа');
    if (n.c === 'window') return T('whoNoteWindow', 'окно: ' + d, d);
    if (n.c === 'iframe') return T('whoNoteIframe', 'iframe недоступен: ' + d, d);
    if (n.c === 'workerCsp') {
      return T('whoNoteWorkerCsp', 'Worker недоступен: ' + d + ' (вероятно CSP страницы)', d);
    }
    return T('whoNoteWorker', 'Worker недоступен: ' + d, d);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /**
   * "3 расхождения", "3 divergences" — the count and its noun, in whatever language the
   * browser is in.
   *
   * Russian has three plural forms and English two, and chrome.i18n has no notion of
   * plurals at all, so the category comes from Intl.PluralRules for the UI language and
   * is used as a key suffix: whoSplit_one, whoSplit_few, whoSplit_many, whoSplit_other.
   * Both catalogues carry all four so the pair stays diffable; English simply never
   * selects few or many. The hand-written Russian rule stays as the fallback for the case
   * where the catalogue is not there at all.
   */
  function plural(n, key, one, few, many) {
    let cat = null;
    try {
      cat = new Intl.PluralRules(chrome.i18n.getUILanguage()).select(n);
    } catch (e) { cat = null; }
    if (cat) {
      const m = T(key + '_' + cat, '', String(n));
      if (m) return m;
    }
    const mod100 = n % 100, mod10 = n % 10;
    let ru;
    if (mod100 >= 11 && mod100 <= 14) ru = many;
    else if (mod10 === 1) ru = one;
    else if (mod10 >= 2 && mod10 <= 4) ru = few;
    else ru = many;
    return n + ' ' + ru;
  }

  function renderParity(out) {
    const scopes = ['window', 'worker', 'iframe'];
    const present = scopes.filter((s) => out[s]);
    if (!present.length) {
      parityOut.innerHTML = '<p class="parity-note">' +
        esc(out.notes.map(noteText).join(' · ') ||
          T('whoNoScopes', 'ни одна область не ответила')) + '</p>';
      setBadge('parityBadge', T('whoNoData', 'нет данных'), false);
      return;
    }
    const signals = Object.keys(out[present[0]]);
    let splits = 0;
    const rows = signals.map((sig) => {
      const vals = present.map((s) => out[s][sig]);
      // Only compare what actually answered: a scope that could not run is not a split.
      const real = vals.filter((v) => v != null && v.slice(0, 4) !== 'ERR ');
      const split = real.length > 1 && real.some((v) => v !== real[0]);
      if (split) splits++;
      const cells = scopes.map((s) => {
        if (!out[s]) return '<td class="parity-na">—</td>';
        const v = out[s][sig];
        const cls = String(v).slice(0, 4) === 'ERR ' ? 'parity-na' : (split ? 'parity-bad' : '');
        return '<td class="' + cls + '" title="' + esc(v) + '">' + esc(String(v).slice(0, 46)) + '</td>';
      }).join('');
      return '<tr class="' + (split ? 'split' : '') + '">' +
        '<td class="mark ' + (split ? 'parity-bad' : 'parity-ok') + '">' + (split ? '≠' : '=') + '</td>' +
        '<td class="sig">' + esc(sig) + '</td>' + cells + '</tr>';
    }).join('');

    parityOut.innerHTML =
      '<table class="parity-table"><tr><th></th><th>' + esc(T('whoThSignal', 'сигнал')) +
      '</th><th>' + esc(T('whoThWindow', 'окно')) + '</th><th>Worker</th><th>iframe</th></tr>' +
      rows + '</table>' +
      '<p class="parity-verdict ' + (splits ? 'parity-bad' : 'parity-ok') + '">' +
      esc(splits
        ? T('whoVerdictSplits',
          plural(splits, 'whoSplit', 'расхождение', 'расхождения', 'расхождений') +
            ' между областями — сайту достаточно прочитать любой из них дважды',
          plural(splits, 'whoSplit', 'расхождение', 'расхождения', 'расхождений'))
        : T('whoVerdictMatch',
          'все ' + plural(signals.length, 'whoSignal', 'сигнал', 'сигнала', 'сигналов') +
            ' совпадают в ' + plural(present.length, 'whoScope', 'области', 'областях', 'областях'),
          plural(signals.length, 'whoSignal', 'сигнал', 'сигнала', 'сигналов'),
          plural(present.length, 'whoScope', 'области', 'областях', 'областях'))) +
      '</p>' +
      (out.notes.length
        ? '<p class="parity-note">' + esc(out.notes.map(noteText).join(' · ')) + '</p>' : '') +
      (present.length < 3
        ? '<p class="parity-note">' + esc(T('whoPartialScopes',
          'Проверены не все области: сравнение тем слабее, чем меньше их отвечает.')) + '</p>'
        : '');
    setBadge('parityBadge',
      splits
        ? plural(splits, 'whoSplit', 'расхождение', 'расхождения', 'расхождений')
        : T('whoParityMatch', 'совпадает'),
      !splits);
  }

  async function runParity() {
    const tabId = Number(parityTab && parityTab.value);
    if (!tabId) { toast(T('whoNoTab', 'Нет подходящей вкладки')); return; }
    parityBtn.disabled = true;
    const label = parityBtn.textContent;
    parityBtn.textContent = T('whoChecking', 'Проверяем…');
    parityOut.innerHTML = '<p class="parity-note">' +
      esc(T('whoRunningInTab', 'выполняется в выбранной вкладке…')) + '</p>';
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: afpScopeProbe
      });
      if (!res || !res.result) throw new Error(T('whoNoResult', 'вкладка не вернула результат'));
      renderParity(res.result);
    } catch (e) {
      parityOut.innerHTML = '<p class="parity-note">' +
        esc(T('whoParityFailed', 'не удалось: ' + (e.message || e), String(e.message || e))) +
        '</p><p class="parity-note">' + esc(T('whoUnscriptable',
          'Страницы chrome://, интернет-магазин расширений и вкладки с ошибкой загрузки ' +
          'скриптовать нельзя — откройте обычный сайт и обновите список.')) + '</p>';
      setBadge('parityBadge', T('whoParityError', 'ошибка'), false);
    } finally {
      parityBtn.disabled = false;
      parityBtn.textContent = label;
    }
  }

  if (parityBtn) parityBtn.addEventListener('click', runParity);

  // Click-to-copy for the two values anyone actually wants out of this page: the
  // fingerprint hash and the User-Agent. Delegated from document, so it keeps working
  // after render() rewrites the text of those elements — a handler bound to the node
  // would not, since setText replaces textContent on every refresh.
  // The class is the only feedback; whoami.css draws the "скопировано" bubble from it.
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-copy]');
    if (!el) return;
    const text = el.textContent.trim();
    if (!text || text === '—' || text === '…') return;
    navigator.clipboard.writeText(text).then(() => {
      el.classList.add('copied');
      clearTimeout(el._copyT);
      el._copyT = setTimeout(() => el.classList.remove('copied'), 1400);
    }).catch(() => toast(T('whoCopyFailed', 'Не удалось скопировать')));
  });

  const refreshBtn = $('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () =>
      load().then(fillTabList).then(() => toast(T('whoRefreshed', 'Обновлено'))));
  }

  load();
  fillTabList();
})();
