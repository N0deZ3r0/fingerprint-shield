'use strict';

/**
 * The catalogue, with the Russian original kept as the fallback.
 *
 * chrome.i18n.getMessage answers '' for a key it does not have, and writing that into the
 * DOM would blank the control rather than fail loudly — so a miss falls back to the text
 * that used to be hard-coded here. The same rule i18n.js applies to the markup.
 */
var T = function (key, ru) {
  var subs = Array.prototype.slice.call(arguments, 2).map(String);
  try {
    var s = window.afpMsg && window.afpMsg(key, subs.length ? subs : undefined);
    return (typeof s === 'string' && s !== '') ? s : ru;
  } catch (e) { return ru; }
};

/**
 * Options UI — features from chrome.storage, reset = AFP_DEFAULT_FEATURES (defaults.js).
 * defaults.js must be loaded before this script.
 */

var FEAT_META = {
  canvas:       { name: 'Canvas', desc: T('optFeatCanvas', 'Шум getImageData / toDataURL') },
  webgl:        { name: 'WebGL', desc: 'Vendor / renderer / params' },
  webrtc:       { name: 'WebRTC', desc: T('optFeatWebrtc', 'Скрытие локальных IP') },
  navigator:    { name: 'Navigator', desc: 'UA, cores, memory, langs…' },
  screen:       { name: 'Screen', desc: T('optFeatScreen', 'Разрешение и avail*') },
  timezone:     { name: 'Timezone', desc: 'Date / Intl TZ' },
  geolocation:  { name: 'Geolocation', desc: T('optFeatGeolocation', 'Подмена или блок geo') },
  battery:      { name: 'Battery', desc: 'getBattery()' },
  fonts:        { name: 'Fonts', desc: T('optFeatFonts', 'Список шрифтов') },
  clientRects:  { name: 'ClientRects', desc: 'DOMRect noise', risky: true },
  plugins:      { name: 'Plugins', desc: 'navigator.plugins / mimeTypes' },
  network:      { name: 'Network', desc: 'navigator.connection' },
  hideAdBlocker:{ name: 'Hide AdBlock', desc: T('optFeatHideAdBlocker', 'Маскировка ad-bait') }
};

var grid = document.getElementById('featGrid');
var statusEl = document.getElementById('status');
var saveBtn = document.getElementById('saveBtn');
var resetBtn = document.getElementById('resetBtn');

function defaults() {
  if (typeof AFP_DEFAULT_FEATURES === 'undefined') {
    console.error('[AFP options] defaults.js not loaded');
    return {
      canvas: true, webgl: true, webrtc: true,
      navigator: true, screen: true, timezone: true, geolocation: true,
      battery: true, fonts: true, clientRects: false, plugins: true,
      network: true, hideAdBlocker: true
    };
  }
  return typeof afpCloneFeatures === 'function'
    ? afpCloneFeatures()
    : Object.assign({}, AFP_DEFAULT_FEATURES);
}

function showStatus(msg, isErr) {
  statusEl.hidden = false;
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', !!isErr);
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(function() { statusEl.hidden = true; }, 3200);
}

function render(features) {
  grid.innerHTML = '';
  var keys = Object.keys(FEAT_META);
  keys.forEach(function(k) {
    var meta = FEAT_META[k];
    var lab = document.createElement('label');
    lab.className = 'feat' + (meta.risky ? ' risky' : '');
    lab.htmlFor = 'feat_' + k;

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'feat_' + k;
    cb.dataset.key = k;
    cb.checked = features[k] !== false;

    var text = document.createElement('span');
    text.className = 'feat-text';
    text.innerHTML =
      '<span class="feat-name"></span><span class="feat-desc"></span>';
    text.querySelector('.feat-name').textContent = meta.name;
    text.querySelector('.feat-desc').textContent = meta.desc;

    lab.appendChild(cb);
    lab.appendChild(text);
    grid.appendChild(lab);
  });
}

grid.addEventListener('change', function () { markActivePreset(); });

function readForm() {
  var out = defaults();
  grid.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
    out[cb.dataset.key] = cb.checked;
  });
  // Always full key set
  if (typeof afpMergeFeatures === 'function') out = afpMergeFeatures(out);
  return out;
}

function load() {
  chrome.runtime.sendMessage({ type: 'getFeatures' }, function(res) {
    if (chrome.runtime.lastError) {
      // fallback storage
      chrome.storage.local.get(['afp_features'], function(r) {
        var f = (typeof afpMergeFeatures === 'function')
          ? afpMergeFeatures(r.afp_features)
          : Object.assign(defaults(), r.afp_features || {});
        render(f);
        markActivePreset();
      });
      return;
    }
    var f = (res && res.features)
      ? (typeof afpMergeFeatures === 'function' ? afpMergeFeatures(res.features) : res.features)
      : defaults();
    render(f);
    markActivePreset();
  });
}

function save() {
  var f = readForm();
  saveBtn.disabled = true;
  // Written BEFORE setFeatures, because that message is what makes background.js rebuild the
  // profile: writing after would leave the old language on it until the next rebuild.
  try {
    if (hostLangCb) chrome.storage.local.set({ afp_host_language: !!hostLangCb.checked });
  } catch (eHL) {}
  chrome.runtime.sendMessage({ type: 'setFeatures', features: f }, function(res) {
    saveBtn.disabled = false;
    if (chrome.runtime.lastError) {
      showStatus(chrome.runtime.lastError.message || T('optError', 'Ошибка'), true);
      return;
    }
    if (res && res.ok === false) {
      showStatus(res.reason || T('optSaveFailed', 'Ошибка сохранения'), true);
      return;
    }
    showStatus(T('optSaved', 'Сохранено. Обновите открытые вкладки.'));
  });
}

function resetSafe() {
  var f = defaults();
  render(f);
  markActivePreset();
  showStatus(T('optDefaultsSet', 'Выставлены безопасные дефолты — нажмите «Сохранить»'));
}

// ── presets ──────────────────────────────────────────────────────────────────
// A preset is a named set of the checkboxes below, nothing more: it does not save, it does
// not touch the machine profile, and the grid stays the truth. "Safe reset" was already one
// of these — the factory row — and stood alone only because there was nothing to compare it
// against.
//
// The quiet row is MEASURED, not designed. Live Fingerprint Pro events off a real Chrome,
// one module switch at a time, every configuration confirmed by markers inside the event:
//
//   shipped default              bot bad / BAS · anti_detect true  · ml 0.9457
//   minus Navigator/Fonts/       bot not_detected · anti_detect FALSE · tampering false
//     ClientRects                                                    · ml 0.5901
//
// The note under the row says that rather than promising anything, because the difference is
// a trade and the user is the one making it: the invented machine goes, the canvas noise
// stays, so cross-site linkability is still broken while the hardware becomes this machine's.
var PRESETS = [
  {
    id: 'full',
    name: function () { return T('optPresetFullName', 'Полная защита'); },
    desc: function () { return T('optPresetFullDesc', 'Заводской набор: всё, кроме ClientRects. Больше всего подменяется — и Fingerprint Pro помечает такой браузер (измерено: bot bad, anti_detect true).'); },
    features: function () { return defaults(); }
  },
  {
    id: 'quiet',
    name: function () { return T('optPresetQuietName', 'Тихий'); },
    desc: function () { return T('optPresetQuietDesc', 'Без Navigator, Fonts и ClientRects. Измерено: все вердикты чистые. Шум канваса работает, поэтому связываемость между сайтами по-прежнему сломана; выдуманная машина — нет, железо становится настоящим.'); },
    features: function () {
      var f = defaults();
      f.navigator = false;
      f.fonts = false;
      f.clientRects = false;
      return f;
    }
  }
];

var presetList = document.getElementById('presetList');

/** Same key set, same values — a preset is "active" only when the grid matches it exactly. */
function sameFeatures(a, b) {
  var keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (var i = 0; i < keys.length; i++) {
    if ((a[keys[i]] !== false) !== (b[keys[i]] !== false)) return false;
  }
  return true;
}

function markActivePreset() {
  if (!presetList) return;
  var now = readForm();
  presetList.querySelectorAll('.preset').forEach(function (el) {
    var p = PRESETS.filter(function (x) { return x.id === el.dataset.id; })[0];
    el.classList.toggle('active', !!p && sameFeatures(now, p.features()));
  });
}

function renderPresets() {
  if (!presetList) return;
  presetList.innerHTML = '';
  PRESETS.forEach(function (p) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'preset';
    row.dataset.id = p.id;
    var n = document.createElement('span');
    n.className = 'preset-name';
    n.textContent = p.name();
    var d = document.createElement('span');
    d.className = 'preset-desc';
    d.textContent = p.desc();
    row.appendChild(n);
    row.appendChild(d);
    row.addEventListener('click', function () {
      render(p.features());
      markActivePreset();
      showStatus(T('optPresetPicked', 'Набор выставлен — нажмите «Сохранить»'));
    });
    presetList.appendChild(row);
  });
}

// ── the language claim ───────────────────────────────────────────────────────
// Stored on its own key rather than as a fourteenth module: it is not a patch that can be
// switched off, it is a choice about WHAT the patched value says. background.js reads it in
// buildProfile and puts the browser's own language on the profile instead of the country's.
var hostLangCb = document.getElementById('hostLang');

function loadHostLang() {
  if (!hostLangCb) return;
  chrome.storage.local.get(['afp_host_language'], function (r) {
    hostLangCb.checked = !!(r && r.afp_host_language);
  });
}

// ── WebRTC exceptions ────────────────────────────────────────────────────────
// The one place the per-site switch's state is visible as a LIST. Everything else shows
// it one host at a time, and only while the popup is open.
var rtcList = document.getElementById('rtcList');
var rtcClearBtn = document.getElementById('rtcClearBtn');

function renderRtcExceptions(hosts) {
  var n = (hosts || []).length;
  rtcClearBtn.disabled = !n;
  if (!n) {
    rtcList.textContent = T('optRtcEmpty', 'Список пуст — WebRTC защищён везде.');
    return;
  }
  rtcList.textContent = hosts.join(', ');
}

function loadRtcExceptions() {
  chrome.runtime.sendMessage({ type: 'getWebrtcExceptionList' }, function(res) {
    if (chrome.runtime.lastError) { rtcList.textContent = T('optListReadFailed', 'не удалось прочитать список'); return; }
    renderRtcExceptions(res && res.hosts);
  });
}

rtcClearBtn.addEventListener('click', function() {
  rtcClearBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'clearWebrtcExceptions' }, function(res) {
    if (chrome.runtime.lastError || !res || res.ok === false) {
      showStatus((res && res.reason) || T('optClearFailed', 'Не удалось очистить'), true);
      rtcClearBtn.disabled = false;
      return;
    }
    renderRtcExceptions([]);
    showStatus(T('optRtcCleared', 'WebRTC защита включена на всех сайтах. Обновите открытые вкладки.'));
  });
});

// ── Service Worker blocks ────────────────────────────────────────────────────
var swList = document.getElementById('swList');
var swClearBtn = document.getElementById('swClearBtn');

function renderSwBlocked(hosts) {
  var n = (hosts || []).length;
  swClearBtn.disabled = !n;
  swList.textContent = n ? hosts.join(', ') : T('optSwEmpty', 'Список пуст — service worker разрешён везде.');
}

function loadSwBlocked() {
  chrome.runtime.sendMessage({ type: 'getSwBlockedList' }, function(res) {
    if (chrome.runtime.lastError) { swList.textContent = T('optListReadFailed', 'не удалось прочитать список'); return; }
    renderSwBlocked(res && res.hosts);
  });
}

swClearBtn.addEventListener('click', function() {
  swClearBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'clearSwBlocked' }, function(res) {
    if (chrome.runtime.lastError || !res || res.ok === false) {
      showStatus((res && res.reason) || T('optClearFailed', 'Не удалось очистить'), true);
      swClearBtn.disabled = false;
      return;
    }
    renderSwBlocked([]);
    showStatus(T('optSwCleared', 'Service Worker разрешён на всех сайтах. Обновите открытые вкладки.'));
  });
});

// ── CSP rewrites ─────────────────────────────────────────────────────────────
var cspList = document.getElementById('cspList');
var cspClearBtn = document.getElementById('cspClearBtn');

function renderCspRewrite(hosts) {
  var n = (hosts || []).length;
  cspClearBtn.disabled = !n;
  cspList.textContent = n ? hosts.join(', ') : T('optCspEmpty', 'Список пуст — заголовки сайтов не переписаны.');
}

function loadCspRewrite() {
  chrome.runtime.sendMessage({ type: 'getCspRewriteList' }, function(res) {
    if (chrome.runtime.lastError) { cspList.textContent = T('optListReadFailed', 'не удалось прочитать список'); return; }
    renderCspRewrite(res && res.hosts);
  });
}

cspClearBtn.addEventListener('click', function() {
  cspClearBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'clearCspRewrite' }, function(res) {
    if (chrome.runtime.lastError || !res || res.ok === false) {
      showStatus((res && res.reason) || T('optClearFailed', 'Не удалось очистить'), true);
      cspClearBtn.disabled = false;
      return;
    }
    renderCspRewrite([]);
    showStatus(T('optCspCleared', 'Заголовки сайтов восстановлены везде. Обновите открытые вкладки.'));
  });
});

// Both lists are written from the POPUP, which can be used while this page is open — and a
// stale list here is the same "invisible state" that made the WebRTC switch confusing in the
// first place. chrome.storage fires in every extension page, so the lists follow their
// storage rather than the moment this page happened to load.
try {
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'local') return;
    if (changes.afp_sw_blocked) renderSwBlocked(changes.afp_sw_blocked.newValue || []);
    if (changes.afp_webrtc_exceptions) renderRtcExceptions(changes.afp_webrtc_exceptions.newValue || []);
    if (changes.afp_csp_rewrite) renderCspRewrite(Object.keys(changes.afp_csp_rewrite.newValue || {}));
  });
} catch (e) {}

// ── Exit-country check ───────────────────────────────────────────────────────
// The only outbound request this extension makes on its own, so it gets a visible switch
// and a visible last reading rather than being a silent background habit. Stored under its
// own key, NOT in afp_features: that set describes patches applied to a page, this one
// describes what the service worker does on the network, and the two have different
// consumers (defaults.js, mw-core's copy, both console checks, four parity assertions).
var geoCheck = document.getElementById('geoCheck');
var geoState = document.getElementById('geoState');

function renderGeoState(cc, at, off) {
  if (off) { geoState.textContent = T('optGeoOff', 'Проверка выключена.'); return; }
  if (!cc) { geoState.textContent = T('optGeoUnknown', 'Страна выхода ещё не определена.'); return; }
  var when = at ? new Date(at).toLocaleTimeString() : '—';
  geoState.textContent = T('optGeoLast', 'Последнее чтение: ' + cc + ' в ' + when + '.', cc, when);
}

function loadGeoCheck() {
  chrome.storage.local.get(['afp_geocheck', 'afp_exit_cc', 'afp_exit_at'], function (r) {
    var on = r.afp_geocheck !== false;   // absent means on, like every other default here
    geoCheck.checked = on;
    renderGeoState(r.afp_exit_cc || '', r.afp_exit_at || 0, !on);
  });
}

geoCheck.addEventListener('change', function () {
  var on = geoCheck.checked;
  chrome.storage.local.set({ afp_geocheck: on }, function () {
    if (!on) {
      // Turning it off drops the stored reading too — leaving a stale country behind would
      // let the popup keep asserting a mismatch nothing is refreshing any more.
      chrome.storage.local.remove(['afp_exit_cc', 'afp_exit_at'], function () {
        renderGeoState('', 0, true);
        showStatus(T('optGeoTurnedOff', 'Проверка страны выключена, сохранённое значение удалено.'));
      });
      return;
    }
    showStatus(T('optGeoTurnedOn', 'Проверка страны включена.'));
    chrome.runtime.sendMessage({ type: 'getExitCountry', force: true }, function (res) {
      if (chrome.runtime.lastError || !res || !res.ok) { renderGeoState('', 0, false); return; }
      renderGeoState(res.cc, res.at, res.off);
    });
  });
});

saveBtn.addEventListener('click', save);
resetBtn.addEventListener('click', resetSafe);

// ── What the extension learned by itself ─────────────────────────────────────
// [FIX the-learned-lists-were-the-invisible-ones] The three lists above are filled by the
// user pressing a switch; these six fill themselves while browsing. They had no screen, no
// count and no way to clear, and a profile change leaves them in place — the same shape
// [FIX the-off-state-was-invisible] named for the WebRTC list, on the lists that actually
// grow on their own.
var learnedList = document.getElementById('learnedList');
var learnedClearBtn = document.getElementById('learnedClearBtn');

// The key names are the extension's, not the reader's: a screen that says afp_csp_ns tells
// nobody anything, and a screen that says nothing at all is what this fixes.
var LEARNED_LABEL = {
  afp_csp_noblob: T('optLearnNoblob', 'не пускают blob-воркеры'),
  afp_csp_tt: T('optLearnTt', 'ограничивают имена политик Trusted Types'),
  afp_csp_tte: T('optLearnTte', 'требуют TrustedScriptURL у sink'),
  afp_csp_nc: T('optLearnNc', 'не пускают blob: в fetch/XHR'),
  afp_csp_ns: T('optLearnNs', 'не пускают importScripts blob:'),
  afp_csp_mixed: T('optLearnMixed', 'ограничивают на одних маршрутах и не на других')
};

function renderLearned(lists) {
  lists = lists || {};
  var total = 0, rows = [];
  Object.keys(LEARNED_LABEL).forEach(function (k) {
    var n = (lists[k] || []).length;
    total += n;
    if (n) rows.push(n + ' — ' + LEARNED_LABEL[k]);
  });
  learnedClearBtn.disabled = !total;
  // The COUNT, not the hosts. A page of site names would be the browsing history this entry
  // is about, printed larger; the number is what tells the reader there is something here.
  learnedList.textContent = total
    ? T('optLearnedRows', total + ' записей: ' + rows.join('; '), total, rows.join('; '))
    : T('optLearnedEmpty', 'Пусто — ничего ещё не выучено.');
}

function loadLearned() {
  chrome.runtime.sendMessage({ type: 'getCspLearnedLists' }, function (res) {
    if (chrome.runtime.lastError) { learnedList.textContent = T('optStateReadFailed', 'не удалось прочитать состояние'); return; }
    renderLearned(res && res.lists);
  });
}

learnedClearBtn.addEventListener('click', function () {
  learnedClearBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'clearCspLearnedLists' }, function (res) {
    if (chrome.runtime.lastError || !res || res.ok === false) {
      showStatus((res && res.reason) || T('optClearFailed', 'Не удалось очистить'), true);
      learnedClearBtn.disabled = false;
      return;
    }
    renderLearned({});
    showStatus(T('optLearnedCleared', 'Забыто. Каждый сайт будет выучен заново — ценой одной загрузки страницы.'));
  });
});

// ── interface language ───────────────────────────────────────────────────────
// chrome.i18n answers in the BROWSER's language and offers no way to ask for another, so
// the override lives in i18n.js as a second catalogue read from the extension's own
// _locales. This is only the control for it: pick, store, reload. The reload is not
// cosmetic — every string on every open page was written at DOMContentLoaded from the old
// catalogue, and re-applying them here would leave the popup and Who Am I in the old
// language until they were next opened.
var langSelect = document.getElementById('langSelect');
var langState = document.getElementById('langState');

function renderLangState() {
  if (!langState) return;
  var chosen = '';
  try { chosen = localStorage.getItem('afp.lang') || ''; } catch (e) { chosen = ''; }
  var browser = '';
  try { browser = chrome.i18n.getUILanguage(); } catch (e) { browser = '?'; }
  langState.textContent = chosen
    ? T('optLangChosen', 'Выбран: ' + chosen + '. Браузер: ' + browser + '.', chosen, browser)
    : T('optLangFollowing', 'Следует за браузером: ' + browser + '.', browser);
}

if (langSelect) {
  try { langSelect.value = localStorage.getItem('afp.lang') || ''; } catch (e) { /* blocked */ }
  renderLangState();
  langSelect.addEventListener('change', function () {
    var ok = window.afpSetLang ? window.afpSetLang(langSelect.value) : false;
    if (!ok) { showStatus(T('optLangFailed', 'Не удалось сохранить язык'), true); return; }
    renderLangState();
    showStatus(T('optLangSaved', 'Язык сохранён — страница перезагрузится'));
    setTimeout(function () { location.reload(); }, 600);
  });
}

renderPresets();
loadHostLang();
load();
loadRtcExceptions();
loadSwBlocked();
loadCspRewrite();
loadGeoCheck();
loadLearned();
