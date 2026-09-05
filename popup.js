'use strict';

const PROFILES = [
  { id: 'laptop_low', name: 'Laptop Budget', spec: '1366×768 · 4c · 4GB', gpu: 'Intel UHD 630', icon: 'laptop',
    // dpr explicit on every row now: the fallback used to read screenW as a PANEL size and
    // is no longer trusted to answer — see afpResolveDpr in background.js.
    screenW: 1366, screenH: 768, dpr: 1, cores: 4, memory: 4, gpuKey: 'intel_uhd', platform: 'Win32' },
  { id: 'laptop_mid', name: 'Laptop Mid', spec: '1920×1080 · 8c · 8GB', gpu: 'Intel Iris Xe', icon: 'laptop',
    // [FIX only-integer-dpr-put-the-scaling-on-the-wrong-side] The premise of that fix was
    // right and is kept: 1920×1080 laptops overwhelmingly run at 125%/150% Windows scaling,
    // and a fleet where every machine reports DPR 1 is itself a mild tell. Its arithmetic
    // was inverted, and the units are the whole story.
    //
    // screen.width is CSS pixels — the PANEL divided by devicePixelRatio. Measured on this
    // project's own rig with --force-device-scale-factor: availWidth is exactly panel/dpr.
    // So a 1920×1080 panel at 150% reports screen.width 1280, not 1920. Setting
    // `screenW: 1920, dpr: 1.5` did not describe a scaled 1080p laptop; it multiplied
    // upward and claimed a 2880×1620 panel — a real one (ThinkPad W540/W550, ASUS Vivobook
    // Pro 15 OLED "2.8K") but a rare one, which is the opposite of what was wanted.
    //
    // The premise is visible in the reference and confirms itself: StatCounter's desktop
    // table is led by 1920×1080 at 22.41%, then 1536×864 at 7.30% and 1280×720 at 5.36% —
    // and those two are not panels anyone manufactures, they are exactly 1080p at 125% and
    // at 150%. See tools/crowd-reference.json.
    //
    // So this row takes the single largest bucket there is — a 1080p panel at 100%, which
    // is 22.41% of desktop web by screen and 51.10% of Steam by panel — and the fractional
    // DPR the old fix wanted moves to a row that can carry it in the right units.
    screenW: 1920, screenH: 1080, dpr: 1, cores: 8, memory: 8, gpuKey: 'intel_iris', platform: 'Win32' },
  // [FIX nobody-claimed-the-modal-ram-bucket] Was memory: 32, alongside pc_power's 32, so
  // the set offered 4 / 8 / 32 / 32 and NOTHING claimed 16 — the commonest bucket there is
  // (40.97% on Steam, against 36.93% for 32, and Steam's gamer bias inflates 32 rather than
  // 16, so on the general web the gap is wider). A 1440p rig with a 3060 and 16 GB is the
  // single most ordinary gaming machine described in that table. The ladder is now
  // 4 / 8 / 16 / 32, which covers both modal buckets instead of doubling up on one.
  // enforceCoherence leaves it alone: its rules are `mem < 16`, strict, so 16 passes.
  { id: 'pc_gaming', name: 'PC Gaming', spec: '1440p · 12c · 16GB', gpu: 'NVIDIA RTX 3060', icon: 'game',
    screenW: 2560, screenH: 1440, dpr: 1, cores: 12, memory: 16, gpuKey: 'nvidia_3060', platform: 'Win32' },
  // [FIX pc-power-memory-desync] Было memory: 64 / spec '64GB'. navigator.deviceMemory
  // по спеке — бакетированное значение, и buildProfile в background.js сводит всё
  // выше 16 к 32 (_memChrome), то есть сайт ВСЕГДА видел 32, а не 64. Из-за этого
  // штатный, ничем не изменённый профиль постоянно подсвечивал собственное
  // предупреждение renderWarnings «deviceMemory is bucketed (2/4/8/16/32)».
  // Профиль объявляет ровно то, что реально репортится: 32.
  // [FIX pc-power-claimed-an-8k-panel] It carried no explicit dpr, so the width fallback
  // answered 2 — and screen.width is CSS pixels, so "3840 wide at DPR 2" is a claim to a
  // 7680×4320 panel. 8K displays exist as products but do not appear anywhere in Steam's
  // primary-display table, whose fourth row is already down at 4.95%. At DPR 1 the same
  // row claims an ordinary 4K panel at 100%, which IS that 4.95% entry.
  { id: 'pc_power', name: 'PC Power', spec: '4K · 16c · 32GB', gpu: 'NVIDIA RTX 3070', icon: 'bolt',
    screenW: 3840, screenH: 2160, dpr: 1, cores: 16, memory: 32, gpuKey: 'nvidia_3070', platform: 'Win32' },
  // [FIX the-two-largest-uncovered-rows-were-scaled-1080p-laptops] The mass the four rows
  // above did not cover was known exactly — 1536×864 at 7.30% and 1280×720 at 5.36% of
  // desktop web (StatCounter, tools/crowd-reference.json) — and it is one machine seen twice:
  // a 1920×1080 panel at 125% and at 150% Windows scaling, which is how most 1080p laptops
  // actually ship. screen.width is CSS pixels, so the claim is the SCALED size with the
  // fractional ratio beside it; both rows imply the same 1920×1080 panel Steam records at
  // 51.10%. The machine behind them is laptop_mid's, on purpose: the same die, the same
  // core count, the same memory bucket, only the scaling differs. What kept them out until
  // now was the popup's own geometry, not the tables — see the picker in popup.html.
  { id: 'laptop_125', name: 'Laptop 1080p · 125%', spec: '1536×864 · 8c · 8GB', gpu: 'Intel Iris Xe', icon: 'laptop',
    screenW: 1536, screenH: 864, dpr: 1.25, cores: 8, memory: 8, gpuKey: 'intel_iris', platform: 'Win32' },
  { id: 'laptop_150', name: 'Laptop 1080p · 150%', spec: '1280×720 · 8c · 8GB', gpu: 'Intel Iris Xe', icon: 'laptop',
    screenW: 1280, screenH: 720, dpr: 1.5, cores: 8, memory: 8, gpuKey: 'intel_iris', platform: 'Win32' },
  // [FIX host-mode] THIS MACHINE. No hardware is substituted: screen, ratio, cores,
  // memory, the GPU and its limits, battery, network and the font list all answer natively,
  // in the window, in every frame and in every worker — and the outgoing hardware hints
  // are left to the browser. The country, the timezone, the locale, the per-domain canvas
  // seed and the rest of the linkability work stay exactly as in the other rows.
  //
  // Why it exists: README "Limits", items 2, 3, 4, 7 and 8 all describe the same gap — a claimed
  // machine whose rasterisation, audio, text metrics, decoder and window geometry are
  // still this machine's. A profile that IS this machine has none of those contradictions
  // by construction, and puts the user in the crowd of everyone with the same hardware
  // rather than in the crowd of this extension's users. The values stored here are a
  // MEASUREMENT, taken in this popup (an extension page renders with the host's own GPU
  // process and screen), and they serve the audit's "claimed" column and this row's label.
  // The page side never answers from them — it answers from the browser — so a monitor
  // unplugged after Apply costs a stale label, never a wrong value.
  { id: 'host', name: 'Эта машина', spec: 'реальное железо', gpu: '', icon: 'pc', host: true }
];

// ── this machine, measured ──────────────────────────────────────────────────────
// The GL limits are read under the same 19 enums background.js ships per profile
// (ANGLE_D3D11_PARAMS) so the stored record has the shape every other machine record has;
// test/parity-static.mjs holds this list to that table.
const AFP_GL_PARAM_KEYS = [3379, 32883, 34024, 34045, 34047, 34076, 34921, 34930, 35071,
  35076, 35077, 35371, 35657, 35660, 35661, 36183, 36347, 36348, 36349];
const HOST = { screenW: 0, screenH: 0, dpr: 1, cores: 0, memory: 0, platform: 'Win32', gl: null };
function measureHost() {
  try {
    HOST.screenW = screen.width | 0;
    HOST.screenH = screen.height | 0;
    HOST.dpr = window.devicePixelRatio || 1;
    HOST.cores = navigator.hardwareConcurrency || 0;
    HOST.memory = navigator.deviceMemory || 0;
    HOST.platform = navigator.platform || 'Win32';
  } catch (e) {}
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      // MAX_TEXTURE_MAX_ANISOTROPY_EXT (34047) answers null until its extension is enabled.
      gl.getExtension('EXT_texture_filter_anisotropic');
      const params = {};
      for (const k of AFP_GL_PARAM_KEYS) {
        try { const v = gl.getParameter(k); if (typeof v === 'number') params[k] = v; } catch (e) {}
      }
      HOST.gl = {
        glVendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '') : '',
        glRenderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '',
        glParams: params,
        glMaxAniso: params[34047] || 16,
        gpuVendor: '', gpuArch: '', gpuDevice: '', gpuDesc: ''
      };
      try { gl.getExtension('WEBGL_lose_context').loseContext(); } catch (e) {}
    }
  } catch (e) {}
  // WebGPU answers asynchronously; the row is redrawn when it lands.
  try {
    if (navigator.gpu && navigator.gpu.requestAdapter) {
      navigator.gpu.requestAdapter().then((a) => {
        if (!a || !HOST.gl) return;
        const i = a.info || {};
        HOST.gl.gpuVendor = String(i.vendor || '');
        HOST.gl.gpuArch = String(i.architecture || '');
        HOST.gl.gpuDevice = String(i.device || '');
        HOST.gl.gpuDesc = String(i.description || '');
        try { renderProfiles(); } catch (e) {}
      }).catch(() => {});
    }
  } catch (e) {}
}
/** "Intel(R) Arc(TM) Graphics" out of an ANGLE renderer string, or the string itself. */
function hostGpuLabel() {
  const r = (HOST.gl && HOST.gl.glRenderer) || '';
  // Lazy up to the PCI id or the backend tag: the model itself carries parentheses
  // ("Intel(R) Arc(TM) Graphics"), so a [^(] class stopped at the first one and the row
  // printed the whole ANGLE string.
  const m = /^ANGLE \([^,]+,\s*(.+?)\s*(?:\(0x[0-9A-Fa-f]+\)|Direct3D|,)/.exec(r);
  return (m ? m[1] : r).trim();
}
function profileSpecLine(p) {
  if (p.host) {
    if (!HOST.cores) return 'реальное железо этой машины';
    return `${HOST.screenW}×${HOST.screenH} · ${HOST.cores}c · ${HOST.memory}GB · ${hostGpuLabel() || 'GPU'}`;
  }
  return `${p.spec} · ${p.gpu}`;
}
const ICONS = {
  laptop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>',
  game: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-4 4h-1l-2-2H9l-2 2H6a4 4 0 0 1-4-4v-1a4 4 0 0 1 4-4Z"/><path d="M8 11v3M6.5 12.5h3M15 12h.01M17.5 13.5h.01"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>',
  pc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>'
};

const COUNTRIES = [
  // <generated:COUNTRIES> from data/countries.json — do not edit; run: node tools/gen-tables.mjs
  { code: 'EE', name: 'Estonia', tz: 'Europe/Tallinn' },
  { code: 'DE', name: 'Germany', tz: 'Europe/Berlin' },
  { code: 'GB', name: 'United Kingdom', tz: 'Europe/London' },
  { code: 'FR', name: 'France', tz: 'Europe/Paris' },
  { code: 'IT', name: 'Italy', tz: 'Europe/Rome' },
  { code: 'ES', name: 'Spain', tz: 'Europe/Madrid' },
  { code: 'NL', name: 'Netherlands', tz: 'Europe/Amsterdam' },
  { code: 'PL', name: 'Poland', tz: 'Europe/Warsaw' },
  { code: 'SE', name: 'Sweden', tz: 'Europe/Stockholm' },
  { code: 'FI', name: 'Finland', tz: 'Europe/Helsinki' },
  { code: 'NO', name: 'Norway', tz: 'Europe/Oslo' },
  { code: 'DK', name: 'Denmark', tz: 'Europe/Copenhagen' },
  { code: 'CZ', name: 'Czech Republic', tz: 'Europe/Prague' },
  { code: 'AT', name: 'Austria', tz: 'Europe/Vienna' },
  { code: 'CH', name: 'Switzerland', tz: 'Europe/Zurich' },
  { code: 'TR', name: 'Turkey', tz: 'Europe/Istanbul' },
  { code: 'GR', name: 'Greece', tz: 'Europe/Athens' },
  { code: 'PT', name: 'Portugal', tz: 'Europe/Lisbon' },
  { code: 'IE', name: 'Ireland', tz: 'Europe/Dublin' },
  { code: 'BE', name: 'Belgium', tz: 'Europe/Brussels' },
  { code: 'RO', name: 'Romania', tz: 'Europe/Bucharest' },
  { code: 'HU', name: 'Hungary', tz: 'Europe/Budapest' },
  { code: 'BG', name: 'Bulgaria', tz: 'Europe/Sofia' },
  { code: 'LV', name: 'Latvia', tz: 'Europe/Riga' },
  { code: 'LT', name: 'Lithuania', tz: 'Europe/Vilnius' },
  { code: 'SK', name: 'Slovakia', tz: 'Europe/Bratislava' },
  { code: 'SI', name: 'Slovenia', tz: 'Europe/Ljubljana' },
  { code: 'HR', name: 'Croatia', tz: 'Europe/Zagreb' },
  { code: 'RS', name: 'Serbia', tz: 'Europe/Belgrade' },
  { code: 'CY', name: 'Cyprus', tz: 'Asia/Nicosia' },
  { code: 'MT', name: 'Malta', tz: 'Europe/Malta' },
  { code: 'LU', name: 'Luxembourg', tz: 'Europe/Luxembourg' },
  { code: 'IS', name: 'Iceland', tz: 'Atlantic/Reykjavik' },
  { code: 'US', name: 'United States', tz: 'America/New_York' },
  { code: 'CA', name: 'Canada', tz: 'America/Toronto' },
  { code: 'BR', name: 'Brazil', tz: 'America/Sao_Paulo' },
  { code: 'MX', name: 'Mexico', tz: 'America/Mexico_City' },
  { code: 'AR', name: 'Argentina', tz: 'America/Buenos_Aires' },
  { code: 'CL', name: 'Chile', tz: 'America/Santiago' },
  { code: 'CO', name: 'Colombia', tz: 'America/Bogota' },
  { code: 'PE', name: 'Peru', tz: 'America/Lima' },
  { code: 'JP', name: 'Japan', tz: 'Asia/Tokyo' },
  { code: 'KR', name: 'South Korea', tz: 'Asia/Seoul' },
  { code: 'CN', name: 'China', tz: 'Asia/Shanghai' },
  { code: 'IN', name: 'India', tz: 'Asia/Kolkata' },
  { code: 'SG', name: 'Singapore', tz: 'Asia/Singapore' },
  { code: 'HK', name: 'Hong Kong', tz: 'Asia/Hong_Kong' },
  { code: 'TW', name: 'Taiwan', tz: 'Asia/Taipei' },
  { code: 'TH', name: 'Thailand', tz: 'Asia/Bangkok' },
  { code: 'VN', name: 'Vietnam', tz: 'Asia/Ho_Chi_Minh' },
  { code: 'ID', name: 'Indonesia', tz: 'Asia/Jakarta' },
  { code: 'MY', name: 'Malaysia', tz: 'Asia/Kuala_Lumpur' },
  { code: 'PH', name: 'Philippines', tz: 'Asia/Manila' },
  { code: 'AE', name: 'UAE', tz: 'Asia/Dubai' },
  { code: 'IL', name: 'Israel', tz: 'Asia/Jerusalem' },
  { code: 'SA', name: 'Saudi Arabia', tz: 'Asia/Riyadh' },
  { code: 'IR', name: 'Iran', tz: 'Asia/Tehran' },
  { code: 'PK', name: 'Pakistan', tz: 'Asia/Karachi' },
  { code: 'BD', name: 'Bangladesh', tz: 'Asia/Dhaka' },
  { code: 'IQ', name: 'Iraq', tz: 'Asia/Baghdad' },
  { code: 'AU', name: 'Australia', tz: 'Australia/Sydney' },
  { code: 'NZ', name: 'New Zealand', tz: 'Pacific/Auckland' },
  { code: 'ZA', name: 'South Africa', tz: 'Africa/Johannesburg' },
  { code: 'EG', name: 'Egypt', tz: 'Africa/Cairo' },
  { code: 'NG', name: 'Nigeria', tz: 'Africa/Lagos' },
  { code: 'MA', name: 'Morocco', tz: 'Africa/Casablanca' },
  { code: 'KE', name: 'Kenya', tz: 'Africa/Nairobi' },
  // </generated:COUNTRIES>
];

const LOCALE_BY_CODE = {
  // <generated:LOCALE_BY_CODE> from data/countries.json — do not edit; run: node tools/gen-tables.mjs
  EE:'et-EE',DE:'de-DE',GB:'en-GB',FR:'fr-FR',IT:'it-IT',ES:'es-ES',
  NL:'nl-NL',PL:'pl-PL',SE:'sv-SE',FI:'fi-FI',NO:'nb-NO',DK:'da-DK',
  CZ:'cs-CZ',AT:'de-AT',CH:'de-CH',TR:'tr-TR',GR:'el-GR',PT:'pt-PT',
  IE:'en-IE',BE:'nl-BE',RO:'ro-RO',HU:'hu-HU',BG:'bg-BG',LV:'lv-LV',
  LT:'lt-LT',SK:'sk-SK',SI:'sl-SI',HR:'hr-HR',RS:'sr-RS',CY:'el-CY',
  MT:'mt-MT',LU:'fr-LU',IS:'is-IS',US:'en-US',CA:'en-CA',BR:'pt-BR',
  MX:'es-MX',AR:'es-AR',CL:'es-CL',CO:'es-CO',PE:'es-PE',JP:'ja-JP',
  KR:'ko-KR',CN:'zh-CN',IN:'en-IN',SG:'en-SG',HK:'zh-HK',TW:'zh-TW',
  TH:'th-TH',VN:'vi-VN',ID:'id-ID',MY:'ms-MY',PH:'en-PH',AE:'ar-AE',
  IL:'he-IL',SA:'ar-SA',IR:'fa-IR',PK:'ur-PK',BD:'bn-BD',IQ:'ar-IQ',
  AU:'en-AU',NZ:'en-NZ',ZA:'en-ZA',EG:'ar-EG',NG:'en-NG',MA:'fr-MA',
  KE:'en-KE',
  // </generated:LOCALE_BY_CODE>
};

let selectedProfileId = 'laptop_mid';
let selectedCountryCode = 'US';
let applying = false;
let currentMode = 'normal'; // normal | hidden

const $ = id => document.getElementById(id);
const profileSelect = $('profileSelect');
const profileDropdown = $('profileDropdown');
const profileList = $('profileList');
const profileName = $('profileName');
const profileSpec = $('profileSpec');
const profileIcon = $('profileIcon');
const warningsEl = $('warnings');
const countrySelect = $('countrySelect');
const dropdown = $('dropdown');
const countryCode = $('countryCode');
const countryName = $('countryName');
const countryTz = $('countryTz');
const searchInput = $('searchInput');
const optionList = $('optionList');
const applyBtn = $('applyBtn');
const statusBar = $('statusBar');
const tabHost = $('tabHost');
const tzValue = $('tzValue');
const tabBadge = $('tabBadge');
const webrtcToggle = $('webrtcToggle');
const webrtcLabel = $('webrtcLabel');
const swToggle = $('swToggle');
const swLabel = $('swLabel');
const cspToggle = $('cspToggle');
const cspLabel = $('cspLabel');
const siteHost = $('siteHost');
const hero = $('hero');
const heroTitle = $('heroTitle');
const heroSub = $('heroSub');

// [FIX hero-read-its-state-out-of-the-chip-markup] The six per-module chips are gone from
// the popup — they carried the same answer the hero line already gives, in six pieces.
//
// They were NOT only decoration, which is the part worth remembering if this ever comes
// back: renderShield used to derive the whole hero from them, counting how many carried the
// `on` class. Deleting the markup alone would have left `badges.filter(el => el && …)`
// filtering out six nulls, so `on` would be 0 forever and the popup would sit permanently
// on "Защита не активна" with an amber shield — a broken readout on a working extension,
// and one nothing in the test suite would have caught.
//
// So the count lives here now, written by checkProtectionsOnce, which is the one place that
// actually learns it. That is a second copy of state, which the old comment rightly warned
// against — but there is no longer a first copy for it to drift from.
let _modulesChecked = false;
let _modulesOn = 0;
const MODULE_COUNT = 6;   // canvas, webgl, tz, webrtc, battery, wasm
function renderShield() {
  const total = MODULE_COUNT;
  const on = _modulesOn;
  const hidden = currentMode === 'hidden';
  if (heroTitle) {
    heroTitle.textContent = !_modulesChecked ? 'Защита активна'
      : on === 0 ? 'Защита не активна'
      : hidden ? 'Скрытый режим'
      : 'Защита активна';
  }
  if (heroSub) {
    heroSub.textContent = !_modulesChecked ? 'проверяем модули…'
      : on === 0 ? 'обновите страницу — F5'
      : on + ' из ' + total + ' модулей активно';
  }
  // Amber hero only when we have actually looked and found nothing running.
  if (hero) hero.classList.toggle('is-off', _modulesChecked && on === 0);
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSaved();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
  await updateTabInfo(tab);
  await checkProtections(tab);
  await updateWebrtcToggle();
  await updateSwToggle();
  await updateCspToggle();
  updateModeUI();
  // Before the first render: the host row's label is the measurement.
  measureHost();
  renderProfiles();
  renderCountryHeader();
  renderOptionList();
  renderWarnings();
  bindEvents();
  // Last, and not awaited: the popup is fully usable before this answers, and on an
  // offline browser it never will.
  loadExitCountry(false);
});

async function loadSaved() {
  try {
    const s = await chrome.storage.local.get(['afp_profile_id', 'afp_country_code', 'afp_mode']);
    if (s.afp_profile_id) selectedProfileId = s.afp_profile_id;
    if (s.afp_country_code) selectedCountryCode = s.afp_country_code;
    const m = s.afp_mode;
    if (m === 'stealth' || m === 'hidden') currentMode = 'hidden';
    else currentMode = 'normal'; // covers 'normal' and legacy 'maximum'/'max' from before that mode was removed
  } catch (e) {}
}

async function updateTabInfo(tab) {
  const empty = document.getElementById('emptyState');
  try {
    if (tab && tab.url && tab.url.startsWith('http')) {
      tabHost.textContent = new URL(tab.url).hostname;
      if (tabBadge) tabBadge.style.display = '';
      if (empty) empty.hidden = true;
    } else {
      tabHost.textContent = 'Нет активной вкладки';
      if (empty) empty.hidden = false;
      // keep mode pill visible
      if (tabBadge) tabBadge.style.display = '';
    }
  } catch (e) {
    tabHost.textContent = 'Нет активной вкладки';
    if (empty) empty.hidden = false;
  }
}

// [CLEANUP] _setBadge lived here — it painted the six per-module chips. The chips are gone
// and it had no other caller, so the whole per-module rendering path went with them; what
// the probe below learns is now reduced to a count (see renderShield).

async function checkProtections(tab) {
  if (!tab || !tab.url || !tab.url.startsWith('http')) return;
  await checkProtectionsOnce(tab);
  // modules / WASM may mark status slightly after open
  setTimeout(function () { checkProtectionsOnce(tab); }, 400);
  setTimeout(function () { checkProtectionsOnce(tab); }, 1200);
}

async function checkProtectionsOnce(tab) {
  if (!tab || !tab.id) return;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        // [FIX status-was-a-page-readable-key] The set is a non-enumerable window
        // property now, not a sessionStorage key any page could read. This function
        // already runs in the page's own realm (world: 'MAIN' above) and already reads
        // window.__w0/__w1 two lines down, so nothing about this probe had to change
        // except which object it looks at.
        var s = {};
        try { s = window.__t0 || {}; } catch (e) {}
        return {
          canvas: !!s.canvas, webgl: !!s.webgl,
          tz: !!s.tz, webrtc: !!s.webrtc, battery: !!s.battery,
          wasm: !!s.wasm
        };
      }
    });
    if (!res?.result) return;
    const s = res.result;
    // The six keys are still probed individually — the page reports them that way and the
    // count has to match MODULE_COUNT — but only the total reaches the UI now.
    _modulesOn = [s.canvas, s.webgl, s.tz, s.webrtc, s.battery, s.wasm].filter(Boolean).length;
    _modulesChecked = true;
    renderShield();
  } catch (e) {}
}

function renderProfiles() {
  const cur = PROFILES.find(x => x.id === selectedProfileId) || PROFILES.find(x => x.id === 'laptop_mid');
  if (profileName) profileName.textContent = cur.name;
  if (profileSpec) profileSpec.textContent = profileSpecLine(cur);
  if (profileIcon) profileIcon.innerHTML = ICONS[cur.icon] || ICONS.laptop;
  if (!profileList) return;
  profileList.innerHTML = '';
  PROFILES.forEach(p => {
    const el = document.createElement('div');
    const selected = p.id === selectedProfileId;
    el.className = 'option' + (selected ? ' selected' : '');
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', selected ? 'true' : 'false');
    el.dataset.id = p.id;
    // textContent throughout: the host row carries a renderer string read off the GPU.
    const two = document.createElement('span');
    two.className = 'opt-2';
    const name = document.createElement('span');
    name.textContent = p.name;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = profileSpecLine(p);
    two.appendChild(name);
    two.appendChild(sub);
    el.appendChild(two);
    if (p.host) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'хост';
      el.appendChild(tag);
    }
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedProfileId = p.id;
      renderProfiles();
      renderWarnings();
      closeProfileDropdown();
    });
    profileList.appendChild(el);
  });
}
function openProfileDropdown() {
  if (!profileSelect) return;
  closeDropdown();
  profileDropdown.classList.add('open');
  profileSelect.classList.add('open');
  $('profileBtn').setAttribute('aria-expanded', 'true');
}
function closeProfileDropdown() {
  if (!profileSelect) return;
  profileDropdown.classList.remove('open');
  profileSelect.classList.remove('open');
  $('profileBtn').setAttribute('aria-expanded', 'false');
}

// The exit country, as background.js read it from Cloudflare's trace endpoint. Null until
// the answer arrives; '' when the lookup is off or has never succeeded.
let exitCC = null;

function renderCountryHeader() {
  const c = COUNTRIES.find(x => x.code === selectedCountryCode) || COUNTRIES[0];
  countryCode.textContent = c.code;
  countryName.textContent = c.name;
  if (tzValue) tzValue.textContent = c.tz;

  // [FIX nothing-compared-the-profile-against-the-exit-ip] The one disagreement this
  // extension could never see about itself. Everything else it guarantees is internal —
  // header against JS, window against worker, cold start against inject — and all of it
  // stays true while the profile claims Estonia over a Frankfurt exit node, which is the
  // first axis a fingerprinter actually checks.
  //
  // It is written into the timezone line rather than added as a row, and that is not a
  // cosmetic choice: the popup rests at 590px against Chrome's 600px cap, and the existing
  // #warnings box takes it to 628 the moment it holds a single line (measured). A new row
  // here would have put every mismatch behind a scrollbar. The line under the country name
  // is already the "detail about this country" slot, it is exactly where the user is
  // looking when they pick one, and swapping its text costs no height at all.
  const mismatch = exitCC && exitCC !== c.code;
  countryTz.textContent = mismatch ? `IP: ${exitName(exitCC)} — не совпадает` : c.tz;
  countryTz.classList.toggle('warn', !!mismatch);
  countryTz.title = mismatch
    ? `Профиль заявляет ${c.name} (${c.code}), а запросы уходят с адреса в ${exitName(exitCC)} (${exitCC}). ` +
      `Это расхождение видно любому сайту без единой строчки JS. Смените страну или узел VPN.`
    : '';
}

/** A country name for a code we may not offer — the exit can be anywhere. */
function exitName(cc) {
  const known = COUNTRIES.find(x => x.code === cc);
  return known ? known.name : cc;
}

/**
 * Ask background.js for the exit country and redraw if it says anything.
 *
 * Deliberately fire-and-forget: the popup must render immediately from storage, exactly as
 * it did before, and improve when the answer lands. Blocking the first paint on a network
 * read would make an offline browser feel like a broken extension.
 */
function loadExitCountry(force) {
  try {
    chrome.runtime.sendMessage({ type: 'getExitCountry', force: !!force }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) return;
      // A stale reading is not evidence of a mismatch — it is evidence of no reading.
      exitCC = res.stale ? '' : (res.cc || '');
      renderCountryHeader();
    });
  } catch (e) {}
}

function renderOptionList(filter = '') {
  const q = filter.toLowerCase();
  optionList.innerHTML = '';
  COUNTRIES
    .filter(c => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
    .forEach(c => {
      const el = document.createElement('div');
      el.className = 'option' + (c.code === selectedCountryCode ? ' selected' : '');
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', c.code === selectedCountryCode ? 'true' : 'false');
      el.innerHTML = `
        <span>${c.name}</span>
        <span class="code">${c.code}</span>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedCountryCode = c.code;
        renderCountryHeader();
        closeDropdown();
        renderWarnings();
      });
      optionList.appendChild(el);
    });
}

function openDropdown() {
  closeProfileDropdown();
  dropdown.classList.add('open');
  countrySelect.classList.add('open');
  setTimeout(() => searchInput.focus(), 40);
}
function closeDropdown() {
  dropdown.classList.remove('open');
  countrySelect.classList.remove('open');
  searchInput.value = '';
  renderOptionList();
}

function renderWarnings() {
  const p = PROFILES.find(x => x.id === selectedProfileId);
  if (!p) return;
  const msgs = [];
  // The host row claims nothing, so nothing about it can be incoherent; its one caveat
  // (the hardware is not substituted) is on the row itself.
  if (p.host) {
    warningsEl.innerHTML = '';
    warningsEl.hidden = true;
    return;
  }
  if (p.cores >= 12 && p.memory < 16) msgs.push('High core count is typically paired with 16 GB+ RAM');
  if (p.screenW >= 3840 && p.cores < 8) msgs.push('4K display is unusual with a low-core-count CPU');
  if (p.memory > 8 && p.memory !== 16 && p.memory !== 32) msgs.push('deviceMemory is bucketed (2/4/8/16/32)');
  if ((p.gpuKey === 'nvidia_3060' || p.gpuKey === 'nvidia_3070') && p.memory < 16)
    msgs.push('NVIDIA GPU with low RAM looks incoherent');
  if (p.gpuKey === 'intel_uhd' && (p.cores >= 12 || p.memory >= 16))
    msgs.push('UHD 630 rarely pairs with high-end CPU/RAM');
  warningsEl.innerHTML = msgs.map(m => `<div class="warning">· ${m}</div>`).join('');
  warningsEl.hidden = msgs.length === 0;
}

let _statusTimer = null;
function showStatus(msg, type, duration = 2500) {
  if (_statusTimer) clearTimeout(_statusTimer);
  statusBar.hidden = false;
  statusBar.textContent = msg;
  // [FIX the-status-message-sat-on-the-apply-button] The bar is one line now, so that it
  // fits the links row and cannot reach the Apply button. A message longer than the width
  // is ellipsised rather than wrapped — wrapping would grow it upward, straight back over
  // the button — so the full text stays reachable here.
  statusBar.title = msg;
  statusBar.className = 'status-bar' + (type === 'err' ? ' err' : '');
  _statusTimer = setTimeout(() => {
    statusBar.className = 'status-bar';
    statusBar.textContent = '';
    statusBar.hidden = true;
  }, duration);
}

async function handleApply() {
  if (applying) return;
  const profile = PROFILES.find(x => x.id === selectedProfileId);
  const country = COUNTRIES.find(x => x.code === selectedCountryCode);
  if (!profile || !country) {
    showStatus('Выберите профиль и страну', 'err');
    return;
  }
  applying = true;
  applyBtn.disabled = true;
  applyBtn.textContent = 'Применяю…';
  try {
    // [FIX host-mode] The host row stores the MEASUREMENT taken in this popup, marked
    // `host: true`, plus the GL record background.js would otherwise look up in GPU_DATA
    // — there is no table row for "this machine", so the popup is where the answer is.
    if (profile.host && !HOST.cores) measureHost();
    const data = profile.host
      ? {
          host: true,
          screenW: HOST.screenW, screenH: HOST.screenH, dpr: HOST.dpr,
          cores: HOST.cores, memory: HOST.memory, gpu: 'host', platform: HOST.platform,
          gl: HOST.gl || undefined
        }
      : {
          screenW: profile.screenW, screenH: profile.screenH,
          dpr: profile.dpr, cores: profile.cores, memory: profile.memory,
          gpu: profile.gpuKey, platform: profile.platform
        };
    await chrome.storage.local.set({
      'afp_profile_id': profile.id,
      // dpr is part of the machine, not a derived detail — see
      // [FIX applying-a-profile-dropped-its-dpr] in defaults.js. Omitting it here is what
      // let buildProfile fall back to the width rule and disagree with dyn/.
      'afp_profile_data': data,
      'afp_country_code': country.code,
      'afp_resolved_timezone': country.tz,
      'afp_resolved_locale': LOCALE_BY_CODE[country.code] || 'en-US',
      'afp_mode': currentMode === 'hidden' ? 'stealth' : currentMode
    });
    let injected = false, reason = '';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'applyToCurrentTab' });
      injected = resp && resp.ok;
      reason = (resp && resp.reason) || '';
    } catch (e) {}
    if (injected) {
      showStatus('Готово: ' + profile.name + ' · ' + country.code, 'ok');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
      if (tab && tab.id && tab.url && tab.url.startsWith('http')) {
        try { await chrome.tabs.reload(tab.id); } catch (e) {}
      }
    } else if (reason === 'no_http_tab') {
      showStatus('Сохранено — откройте сайт и нажмите F5', 'ok');
    } else {
      showStatus('Сохранено — обновите вкладку (F5)', 'ok');
    }
  } catch (e) {
    showStatus('Ошибка: ' + e.message, 'err');
  } finally {
    applyBtn.disabled = false;
    applyBtn.textContent = 'Применить';
    applying = false;
  }
}

function bindEvents() {
  const countryBtn = $('countryBtn');
  if (countryBtn) {
    countryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.contains('open') ? closeDropdown() : openDropdown();
    });
  }
  searchInput.addEventListener('input', () => renderOptionList(searchInput.value));
  searchInput.addEventListener('click', e => e.stopPropagation());
  const profileBtn = $('profileBtn');
  if (profileBtn) {
    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      profileDropdown.classList.contains('open') ? closeProfileDropdown() : openProfileDropdown();
    });
  }
  document.addEventListener('click', e => {
    if (!countrySelect.contains(e.target)) closeDropdown();
    if (profileSelect && !profileSelect.contains(e.target)) closeProfileDropdown();
  });
  applyBtn.addEventListener('click', handleApply);
  webrtcToggle.addEventListener('click', handleWebrtcToggle);
  swToggle.addEventListener('click', handleSwToggle);
  if (cspToggle) cspToggle.addEventListener('click', handleCspToggle);
  document.querySelectorAll('#modeGrid .mode').forEach(el => {
    el.addEventListener('click', () => selectMode(el.getAttribute('data-mode')));
  });
}

async function updateWebrtcToggle() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'getWebrtcStatus' });
    if (!res || !res.host) {
      webrtcToggle.style.opacity = '0.4';
      webrtcToggle.style.pointerEvents = 'none';
      siteHost.textContent = 'нет активной вкладки';
      return;
    }
    // The module can be off globally (options page). The switch still records the
    // per-site preference for when it comes back, but the row must not claim a
    // protection that nothing is running.
    //
    // [FIX the-off-state-was-invisible] The hint used to print the bare hostname in both
    // positions, and the exception list was not shown anywhere at all. Measured in the
    // user's own browser: 127.0.0.1 had been switched off days earlier and forgotten, so
    // the same page leaked while localhost — the same server, one hostname apart — did
    // not. Nothing on screen said why. A switch whose OFF state looks like its ON state,
    // for a setting that is per-site and permanent, is the whole of "то работает, то нет".
    // The hint is the hostname and nothing else, by request. The OFF state is carried by
    // the switch and by the amber colour instead of by words, and the LIST — the thing
    // that was invisible and caused the whole "то работает, то нет" — lives in the options
    // page, where it can be read and cleared without cluttering this row.
    // The hostname is printed once, by the card, and the state lives on the switch and on
    // the label's colour. Amber means "this site is off the default", which is the thing
    // worth noticing a week later; the module being off in the options page is a different
    // statement and gets the words.
    siteHost.textContent = res.enabled === false ? res.host + ' · WebRTC выключен в настройках' : res.host;
    webrtcLabel.classList.toggle('warn', res.enabled !== false && !res.protected);
    webrtcLabel.classList.toggle('off', res.enabled === false);
    webrtcToggle.classList.toggle('on', res.protected && res.enabled !== false);
  } catch (e) {}
}

async function handleWebrtcToggle() {
  webrtcToggle.style.pointerEvents = 'none';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'toggleWebrtcForCurrentTab' });
    if (res && res.ok) {
      webrtcToggle.classList.toggle('on', res.protected);
      // The label carries the amber "this site is off the default" state, and the click
      // handler has to set it too — updateWebrtcToggle only runs when the popup opens.
      webrtcLabel.classList.toggle('warn', !res.protected);
      // [FIX the-click-had-no-visible-effect] The RTC hooks read the flag per call now, so
      // the API follows the switch the moment background.js re-injects — and the previous
      // version of this line said exactly that and stopped there. Which was useless to the
      // person holding the mouse: a fingerprinting page runs its WebRTC probe ONCE, at
      // load, and prints the result. Toggling underneath an already-rendered CreepJS
      // changes nothing on screen, so the switch reads as dead even while it works.
      // Measured on abrahamjuliot.github.io, same build, one reload apart: switch ON gives
      // "foundation/ip: blocked" and "stun connection: blocked", switch OFF gives
      // "ip: 203.0.113.7" (address redacted) and the srflx candidate line.
      //
      // So the tab is reloaded here, exactly as selectMode() does for the mode switch —
      // one control, one visible consequence. The old copy asked the user to press F5;
      // pressing it for them is the same answer without the homework.
      let reloaded = false;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id && tab.url && tab.url.startsWith('http')) {
          await chrome.tabs.reload(tab.id);
          reloaded = true;
        }
      } catch (e) {}
      // The hostname is deliberately NOT repeated here: the site card names it one line
      // above, and printing it twice is what pushed this popup past Chrome's 600px cap
      // once already. It also made the message long enough to be ellipsised now that the
      // bar is a single line — see showStatus.
      showStatus(
        (res.protected ? 'WebRTC защита включена' : 'WebRTC защита выключена') +
          (reloaded ? ' — вкладка обновлена' : ' — обновите страницу (F5)'),
        'ok'
      );
    } else showStatus('Не удалось переключить WebRTC', 'err');
  } catch (e) {
    showStatus('Не удалось переключить WebRTC', 'err');
  } finally {
    webrtcToggle.style.pointerEvents = '';
  }
}

// ── per-site Service Worker ──────────────────────────────────────────────────
// ON means the site may use one. That is the opposite polarity to the WebRTC row above,
// and deliberately so: a service worker is a capability the site HAS by default, while
// WebRTC protection is something we ADD. Both rows go amber when this site is not on the
// default setting, which is the state worth noticing.
async function updateSwToggle() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'getSwStatus' });
    if (!res || !res.host) {
      swToggle.style.opacity = '0.4';
      swToggle.style.pointerEvents = 'none';
      return;
    }
    swLabel.classList.toggle('warn', !!res.blocked);
    swToggle.classList.toggle('on', !res.blocked);
  } catch (e) {}
}

async function handleSwToggle() {
  swToggle.style.pointerEvents = 'none';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'toggleSwForCurrentTab' });
    if (res && res.ok) {
      swToggle.classList.toggle('on', !res.blocked);
      swLabel.classList.toggle('warn', !!res.blocked);
      // Reloading is not cosmetic here: blocking also unregisters what the site already
      // installed, and allowing it again only matters from the next load on.
      let reloaded = false;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id && tab.url && tab.url.startsWith('http')) {
          await chrome.tabs.reload(tab.id);
          reloaded = true;
        }
      } catch (e) {}
      // Same reason as the WebRTC message above: the host is already on screen.
      showStatus(
        (res.blocked ? 'Service Worker заблокирован' : 'Service Worker разрешён') +
          (reloaded ? ' — вкладка обновлена' : ' — обновите страницу (F5)'),
        'ok'
      );
    } else showStatus('Не удалось переключить Service Worker', 'err');
  } catch (e) {
    showStatus('Не удалось переключить Service Worker', 'err');
  } finally {
    swToggle.style.pointerEvents = '';
  }
}

// ── per-site CSP rewrite ─────────────────────────────────────────────────────
// [FIX csp-rewrite-for-workers] OFF by default and amber when on, like the two rows above
// it when they are off their default. Dimmed when the site's CSP does not refuse our
// workers — there the switch would change the header for nothing.
async function updateCspToggle() {
  if (!cspToggle) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'getCspRewriteStatus' });
    if (!res || !res.host) {
      cspToggle.style.opacity = '0.4';
      cspToggle.style.pointerEvents = 'none';
      return;
    }
    cspToggle.classList.toggle('on', !!res.on);
    cspLabel.classList.toggle('warn', !!res.on);
    cspLabel.classList.toggle('off', !res.on && !res.needed);
    cspLabel.title = res.on
      ? 'CSP этого сайта переписан: наши воркеры проходят, nonce-политика сайта ослаблена. Выключите, чтобы вернуть заголовок сайта.'
      : (res.needed
        ? 'CSP сайта не пускает наши воркеры, и подмена здесь стоит на паузе (README, «Пределы», пункт 6). Включите, чтобы переписать заголовок — это ослабит защиту сайта от XSS.'
        : 'CSP сайта не мешает подмене — переключатель не нужен.');
  } catch (e) {}
}

async function handleCspToggle() {
  cspToggle.style.pointerEvents = 'none';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'toggleCspRewriteForCurrentTab' });
    if (res && res.ok && res.unneeded) {
      // Read and found harmless: nothing was rewritten and the switch stays off.
      cspToggle.classList.remove('on');
      cspLabel.classList.remove('warn');
      cspLabel.classList.add('off');
      showStatus('CSP сайта не мешает подмене — ничего не переписано', 'ok');
    } else if (res && res.ok) {
      cspToggle.classList.toggle('on', !!res.on);
      cspLabel.classList.toggle('warn', !!res.on);
      cspLabel.classList.remove('off');
      let reloaded = false;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id && tab.url && tab.url.startsWith('http')) {
          await chrome.tabs.reload(tab.id);
          reloaded = true;
        }
      } catch (e) {}
      showStatus(
        (res.on ? (res.rewritten ? 'CSP переписан' : 'CSP: жду заголовок сайта') : 'CSP сайта восстановлен') +
          (reloaded ? ' — вкладка обновлена' : ' — обновите страницу (F5)'),
        'ok'
      );
    } else showStatus('Не удалось переключить CSP', 'err');
  } catch (e) {
    showStatus('Не удалось переключить CSP', 'err');
  } finally {
    cspToggle.style.pointerEvents = '';
  }
}

function updateModeUI() {
  document.querySelectorAll('#modeGrid .mode').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-mode') === currentMode);
  });
  if (tabBadge) {
    const labels = { normal: 'Обычный', hidden: 'Скрытый' };
    tabBadge.textContent = labels[currentMode] || 'Обычный';
    tabBadge.className = 'badge pill' + (currentMode === 'hidden' ? ' warn' : '');
  }
  renderShield();
  const hint = document.getElementById('modeHint');
  if (hint) {
    hint.textContent = currentMode === 'hidden'
      ? 'Меньше патчей — ниже score на проверках'
      : 'Полная подмена профиля устройства';
  }
}

async function selectMode(mode) {
  if (!mode || mode === currentMode) return;
  currentMode = mode;
  updateModeUI();
  const storageMode = mode === 'hidden' ? 'stealth' : mode;
  try {
    await chrome.storage.local.set({ afp_mode: storageMode });
    let reloaded = false;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id && tab.url && tab.url.startsWith('http')) {
        await chrome.tabs.reload(tab.id);
        reloaded = true;
      }
    } catch (e) {}
    const names = { normal: 'Обычный режим', hidden: 'Скрытый режим' };
    showStatus(
      (names[mode] || mode) + (reloaded ? ' — вкладка обновлена' : ' — откройте http-вкладку и F5'),
      'ok',
      3500
    );
  } catch (e) {
    showStatus('Не удалось сохранить режим', 'err');
  }
}