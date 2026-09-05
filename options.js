'use strict';

/**
 * Options UI — features from chrome.storage, reset = AFP_DEFAULT_FEATURES (defaults.js).
 * defaults.js must be loaded before this script.
 */

var FEAT_META = {
  canvas:       { name: 'Canvas', desc: 'Шум getImageData / toDataURL' },
  webgl:        { name: 'WebGL', desc: 'Vendor / renderer / params' },
  webrtc:       { name: 'WebRTC', desc: 'Скрытие локальных IP' },
  navigator:    { name: 'Navigator', desc: 'UA, cores, memory, langs…' },
  screen:       { name: 'Screen', desc: 'Разрешение и avail*' },
  timezone:     { name: 'Timezone', desc: 'Date / Intl TZ' },
  geolocation:  { name: 'Geolocation', desc: 'Подмена или блок geo' },
  battery:      { name: 'Battery', desc: 'getBattery()' },
  fonts:        { name: 'Fonts', desc: 'Список шрифтов' },
  clientRects:  { name: 'ClientRects', desc: 'DOMRect noise', risky: true },
  plugins:      { name: 'Plugins', desc: 'navigator.plugins / mimeTypes' },
  network:      { name: 'Network', desc: 'navigator.connection' },
  hideAdBlocker:{ name: 'Hide AdBlock', desc: 'Маскировка ad-bait' }
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
      });
      return;
    }
    var f = (res && res.features)
      ? (typeof afpMergeFeatures === 'function' ? afpMergeFeatures(res.features) : res.features)
      : defaults();
    render(f);
  });
}

function save() {
  var f = readForm();
  saveBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'setFeatures', features: f }, function(res) {
    saveBtn.disabled = false;
    if (chrome.runtime.lastError) {
      showStatus(chrome.runtime.lastError.message || 'Ошибка', true);
      return;
    }
    if (res && res.ok === false) {
      showStatus(res.reason || 'Ошибка сохранения', true);
      return;
    }
    showStatus('Сохранено. Обновите открытые вкладки.');
  });
}

function resetSafe() {
  var f = defaults();
  render(f);
  showStatus('Выставлены безопасные дефолты — нажмите «Сохранить»');
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
    rtcList.textContent = 'Список пуст — WebRTC защищён везде.';
    return;
  }
  rtcList.textContent = hosts.join(', ');
}

function loadRtcExceptions() {
  chrome.runtime.sendMessage({ type: 'getWebrtcExceptionList' }, function(res) {
    if (chrome.runtime.lastError) { rtcList.textContent = 'не удалось прочитать список'; return; }
    renderRtcExceptions(res && res.hosts);
  });
}

rtcClearBtn.addEventListener('click', function() {
  rtcClearBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'clearWebrtcExceptions' }, function(res) {
    if (chrome.runtime.lastError || !res || res.ok === false) {
      showStatus((res && res.reason) || 'Не удалось очистить', true);
      rtcClearBtn.disabled = false;
      return;
    }
    renderRtcExceptions([]);
    showStatus('WebRTC защита включена на всех сайтах. Обновите открытые вкладки.');
  });
});

// ── Service Worker blocks ────────────────────────────────────────────────────
var swList = document.getElementById('swList');
var swClearBtn = document.getElementById('swClearBtn');

function renderSwBlocked(hosts) {
  var n = (hosts || []).length;
  swClearBtn.disabled = !n;
  swList.textContent = n ? hosts.join(', ') : 'Список пуст — service worker разрешён везде.';
}

function loadSwBlocked() {
  chrome.runtime.sendMessage({ type: 'getSwBlockedList' }, function(res) {
    if (chrome.runtime.lastError) { swList.textContent = 'не удалось прочитать список'; return; }
    renderSwBlocked(res && res.hosts);
  });
}

swClearBtn.addEventListener('click', function() {
  swClearBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'clearSwBlocked' }, function(res) {
    if (chrome.runtime.lastError || !res || res.ok === false) {
      showStatus((res && res.reason) || 'Не удалось очистить', true);
      swClearBtn.disabled = false;
      return;
    }
    renderSwBlocked([]);
    showStatus('Service Worker разрешён на всех сайтах. Обновите открытые вкладки.');
  });
});

// ── CSP rewrites ─────────────────────────────────────────────────────────────
var cspList = document.getElementById('cspList');
var cspClearBtn = document.getElementById('cspClearBtn');

function renderCspRewrite(hosts) {
  var n = (hosts || []).length;
  cspClearBtn.disabled = !n;
  cspList.textContent = n ? hosts.join(', ') : 'Список пуст — заголовки сайтов не переписаны.';
}

function loadCspRewrite() {
  chrome.runtime.sendMessage({ type: 'getCspRewriteList' }, function(res) {
    if (chrome.runtime.lastError) { cspList.textContent = 'не удалось прочитать список'; return; }
    renderCspRewrite(res && res.hosts);
  });
}

cspClearBtn.addEventListener('click', function() {
  cspClearBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'clearCspRewrite' }, function(res) {
    if (chrome.runtime.lastError || !res || res.ok === false) {
      showStatus((res && res.reason) || 'Не удалось очистить', true);
      cspClearBtn.disabled = false;
      return;
    }
    renderCspRewrite([]);
    showStatus('Заголовки сайтов восстановлены везде. Обновите открытые вкладки.');
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
  if (off) { geoState.textContent = 'Проверка выключена.'; return; }
  if (!cc) { geoState.textContent = 'Страна выхода ещё не определена.'; return; }
  var when = at ? new Date(at).toLocaleTimeString() : '—';
  geoState.textContent = 'Последнее чтение: ' + cc + ' в ' + when + '.';
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
        showStatus('Проверка страны выключена, сохранённое значение удалено.');
      });
      return;
    }
    showStatus('Проверка страны включена.');
    chrome.runtime.sendMessage({ type: 'getExitCountry', force: true }, function (res) {
      if (chrome.runtime.lastError || !res || !res.ok) { renderGeoState('', 0, false); return; }
      renderGeoState(res.cc, res.at, res.off);
    });
  });
});

saveBtn.addEventListener('click', save);
resetBtn.addEventListener('click', resetSafe);

load();
loadRtcExceptions();
loadSwBlocked();
loadCspRewrite();
loadGeoCheck();
