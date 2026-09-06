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
  // предупреждение «deviceMemory is bucketed (2/4/8/16/32)» (правило жило в попапе,
  // сейчас — в test/profilecoherence.mjs). Профиль объявляет ровно то, что реально
  // репортится: 32.
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
  // [FIX the-crowd-had-no-16-10-laptop] tools/probe-crowd.mjs named three rows of the
  // reference that no profile reached, and this is the one of the three worth claiming.
  //
  //   panel 2560x1600   5.10% on Steam    <- this row
  //   screen 1280x1200  3.71% StatCounter  NOT claimed: it sits directly under the 384x832
  //                                        row the reference itself flags as "plainly not a
  //                                        desktop panel", 16:15 is not a shape anyone
  //                                        manufactures, and claiming it would be inventing
  //                                        a machine out of misfiled mobile traffic
  //   RAM 12 GB         2.51% on Steam     NOT claimable at all: navigator.deviceMemory is
  //                                        bucketed to 2/4/8/16/32 by the spec and
  //                                        background.js clamps to it, so a 12 GB machine
  //                                        reports 8. The population row exists and the API
  //                                        cannot express it.
  //
  // 16:10 Windows laptops (XPS 13/14, Zenbook, Surface Laptop Studio) ship a 2560x1600 panel
  // and Windows offers 200% for it, which is screen 1280x800 at devicePixelRatio 2 — the
  // same units lesson the whole table turns on: screen.width is CSS pixels, the panel is
  // screenW * dpr. RAM is 16, the modal bucket (40.97% on Steam) and the one this set was
  // short of between laptop_mid's 8 and pc_power's 32.
  { id: 'laptop_1610', name: 'Laptop 16:10 · 200%', spec: '1280×800 · 8c · 16GB', gpu: 'Intel Iris Xe', icon: 'laptop',
    screenW: 1280, screenH: 800, dpr: 2, cores: 8, memory: 16, gpuKey: 'intel_iris', platform: 'Win32' },
  // [FIX host-mode] THIS MACHINE. No hardware is substituted: screen, ratio, cores,
  // memory, the GPU and its limits, battery, network and the font list all answer natively,
  // in the window, in every frame and in every worker — and the outgoing hardware hints
  // are left to the browser. The country, the timezone, the locale, the per-domain canvas
  // seed and the rest of the linkability work stay exactly as in the other rows.
  //
  // Why it exists: README "Limits" items 2, 3, 4, 7 and 8 all describe the same gap — a claimed
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
/**
 * [FIX the-popup-never-said-the-screen-claim-was-dropped]
 *
 * `_screenAtLeastNative` in mw/mw-core.js reports the MACHINE's screen whole whenever the
 * claimed pair does not CONTAIN it — both dimensions or neither, because raising one alone
 * would invent a resolution no panel ships. So on an ordinary 1920×1080 host every row
 * below that size substitutes nothing at all on the screen axis: the user picks 1366×768,
 * the popup goes green, and pages keep reading 1920×1080. Nothing said so anywhere —
 * the coherence rules only ever checked a row against ITSELF (cores against memory, GPU
 * against RAM), never against the machine it has to run on — and they now live in
 * test/profilecoherence.mjs, which is the right home for a check on a const table.
 * README "Limits", item 7 described the
 * consequence and no surface carried it to the person choosing.
 *
 * Read straight off `screen`: an extension page is not matched by the content scripts' host
 * pattern, so these are the host's own numbers — the same reason audit.html can use itself
 * as a clean control — and the two properties cost nothing, while `measureHost()` builds a
 * WebGL context and only runs for the host row.
 * They are CSS pixels under the host's own dpr, which is exactly the pair mw-core compares
 * against, so the two answers cannot drift apart.
 */
function hostScreenPair() {
  try { return { w: screen.width | 0, h: screen.height | 0 }; } catch (e) { return { w: 0, h: 0 }; }
}
/** Does this row's claim contain the machine's screen? The same test mw-core applies. */
function screenClaimHolds(p) {
  // The host row claims nothing, so there is nothing to drop.
  if (!p || p.host) return true;
  const s = hostScreenPair();
  if (!s.w || !s.h) return true;   // nothing measured — say nothing
  return (p.screenW | 0) >= s.w && (p.screenH | 0) >= s.h;
}
/** Why the chip is there, with both numbers in it. */
function screenClaimTitle(p) {
  const s = hostScreenPair();
  return `Экран не подменяется: ${p.screenW}×${p.screenH} меньше вашего ${s.w}×${s.h}, ` +
    'и страницы увидят ваш. Подменяется только строка не меньше вашего экрана по обеим сторонам. ' +
    'Остальное — ядра, память, GPU — работает как обычно.';
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
const profileScreenTag = $('profileScreenTag');
const profileIcon = $('profileIcon');
const countryWarn = $('countryWarn');
const countrySelect = $('countrySelect');
const countryBtn = $('countryBtn');
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

/**
 * [FIX the-switches-never-said-which-way-they-pointed]
 *
 * Every one of the three carries role="switch", and not one of them ever wrote
 * aria-checked — measured null on all three in a loaded popup. A switch whose state is
 * unreadable is worse than a plain button: the role promises a state and then refuses to
 * name it, so a screen reader announces "WebRTC, switch" and stops.
 *
 * The class is the CSS hook and stays; this is the one writer that keeps the attribute in
 * step with it, so the two cannot drift the way they did by being set eight places apart.
 */
function setSwitch(el, on) {
  if (!el) return;
  el.classList.toggle('on', !!on);
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

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
  // [FIX three-ways-of-saying-there-is-no-site] The card decides things about the current
  // site; with no site it held three disabled switches under a line repeating what the hero
  // and the note both already said. The note takes its place instead — which also takes the
  // tallest reachable state back under Chrome's cap, where the exit-country row had just
  // pushed it (627px measured, cap 600).
  const card = document.getElementById('siteCard');
  try {
    if (tab && tab.url && tab.url.startsWith('http')) {
      tabHost.textContent = new URL(tab.url).hostname;
      if (tabBadge) tabBadge.style.display = '';
      if (empty) empty.hidden = true;
      if (card) card.hidden = false;
    } else {
      tabHost.textContent = 'Нет активной вкладки';
      if (empty) empty.hidden = false;
      if (card) card.hidden = true;
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
  // The selected row repeats the chip, so the fact is visible without opening the list.
  if (profileScreenTag) {
    const holds = screenClaimHolds(cur);
    profileScreenTag.hidden = holds;
    profileScreenTag.title = holds ? '' : screenClaimTitle(cur);
  }
  if (!profileList) return;
  profileList.innerHTML = '';
  PROFILES.forEach(p => {
    const el = document.createElement('div');
    const selected = p.id === selectedProfileId;
    el.className = 'option' + (selected ? ' selected' : '');
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', selected ? 'true' : 'false');
    el.id = 'profile-opt-' + p.id;   // aria-activedescendant needs a name to point at
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
    // One chip per row: "хост" for the machine row, otherwise the screen note when this
    // row's claim would be dropped on this machine. They cannot both apply — the host row
    // claims no screen either.
    if (p.host) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'хост';
      el.appendChild(tag);
    } else if (!screenClaimHolds(p)) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'экран хоста';
      tag.title = screenClaimTitle(p);
      el.appendChild(tag);
    }
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedProfileId = p.id;
      renderProfiles();
      closeProfileDropdown();
    });
    profileList.appendChild(el);
  });
}
/**
 * [FIX neither-picker-could-be-reached-from-a-keyboard]
 *
 * Measured on a loaded popup: the country list renders 67 rows and the machine list 7, and
 * the number of them a keyboard can reach is ZERO. They are <div>s with role="option" and
 * no tabindex, so Tab steps straight from the button over the whole list to the next
 * control; arrows did nothing, Enter did nothing, and Escape did not close either list.
 * Picking a country or a machine required a mouse, in a window whose every other control
 * is a real button.
 *
 * The rows stay <div>s and stay OUT of the tab order — 67 tab stops would be its own
 * defect. This is the listbox pattern instead: focus rests on one element (the search input
 * for the country list, the list itself for the machine list, which has no input), the
 * arrows move a cursor class, and `aria-activedescendant` names the cursor row to a screen
 * reader without moving focus off the thing being typed into.
 *
 * Enter dispatches the row's own click. That is deliberate rather than lazy: the click
 * handler is where selection, re-render and closing already live, so the keyboard cannot
 * drift from the mouse by having a second copy of that logic.
 *
 * One helper, two callers, for the same reason the two pickers share every CSS class: the
 * country one updated aria-expanded and the machine one did not, which is exactly the kind
 * of split that appears when identical-looking controls are wired twice.
 */
function lbRows(list) { return Array.from(list.querySelectorAll('.option')); }

function lbSetActive(list, holder, el) {
  lbRows(list).forEach((o) => o.classList.toggle('active', o === el));
  if (el && el.id) {
    holder.setAttribute('aria-activedescendant', el.id);
    // `nearest` and not `center`: the list is scrolled by this call on every arrow press,
    // and centering would make a two-row nudge jump the whole viewport.
    try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  } else {
    holder.removeAttribute('aria-activedescendant');
  }
}

/** The cursor starts on the current choice, not at the top: arrowing away from what is
 *  already selected is the movement a user expects, and on the country list the selected
 *  row can be 200 rows down. */
function lbEnsureActive(list, holder) {
  const rows = lbRows(list);
  if (!rows.length) { lbSetActive(list, holder, null); return; }
  if (rows.some((o) => o.classList.contains('active'))) return;
  lbSetActive(list, holder, rows.find((o) => o.classList.contains('selected')) || rows[0]);
}

function lbMove(list, holder, step) {
  const rows = lbRows(list);
  if (!rows.length) return;
  const cur = rows.findIndex((o) => o.classList.contains('active'));
  let next;
  if (step === 'first') next = 0;
  else if (step === 'last') next = rows.length - 1;
  else next = cur < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, cur + step));
  lbSetActive(list, holder, rows[next]);
}

/**
 * @param {object} cfg select/btn/list/holder plus the open/close pair the caller already has.
 *   `holder` is the element focus actually sits on while the list is open, and therefore the
 *   element that carries aria-activedescendant.
 */
function wireListbox(cfg) {
  const { select, btn, list } = cfg;
  if (!select || !btn || !list) return;
  const holder = () => cfg.holder() || list;
  // Bound on the container so one listener serves the button, the search input and the list
  // — every place focus can be while this picker is in play.
  select.addEventListener('keydown', (e) => {
    const open = cfg.isOpen();
    if (!open) {
      // A closed combobox opens on Down/Up as well as on Enter/Space, which the button
      // already does natively.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cfg.open();
        lbEnsureActive(list, holder());
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); lbMove(list, holder(), 1); break;
      case 'ArrowUp': e.preventDefault(); lbMove(list, holder(), -1); break;
      case 'Home': e.preventDefault(); lbMove(list, holder(), 'first'); break;
      case 'End': e.preventDefault(); lbMove(list, holder(), 'last'); break;
      case 'Enter': {
        e.preventDefault();
        const el = list.querySelector('.option.active');
        // The row's own handler: one selection path for mouse and keyboard alike.
        if (el) el.click();
        break;
      }
      case 'Escape':
        e.preventDefault();
        // close() restores focus to the button — it has to, because a selection made with
        // Enter closes the same way and left activeElement on <body> until it did.
        cfg.close();
        break;
      case 'Tab':
        // Tab leaves the picker; a list left open behind it would float over whatever the
        // user moved to. Not prevented — the move itself is what they asked for.
        cfg.close();
        break;
      default: break;
    }
  });
}

function openProfileDropdown() {
  if (!profileSelect) return;
  closeDropdown();
  profileDropdown.classList.add('open');
  profileSelect.classList.add('open');
  $('profileBtn').setAttribute('aria-expanded', 'true');
  // No search input here, so the list itself holds focus and carries the cursor.
  lbEnsureActive(profileList, profileList);
  try { profileList.focus({ preventScroll: true }); } catch (e) { profileList.focus(); }
}
function closeProfileDropdown() {
  if (!profileSelect) return;
  const had = profileDropdown.contains(document.activeElement);
  profileDropdown.classList.remove('open');
  profileSelect.classList.remove('open');
  $('profileBtn').setAttribute('aria-expanded', 'false');
  profileList.removeAttribute('aria-activedescendant');
  if (had) $('profileBtn').focus();
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
  // [FIX the-warning-ate-the-timezone] It used to be written OVER the timezone, and the
  // justification was arithmetic: the popup rested at 590px against Chrome's 600px cap and a
  // row would not fit. That arithmetic has moved — the popup rests at 551px, and
  // test/popupfit.mjs has been printing the headroom on every run since the feature landed.
  //
  // Overwriting was never free, whatever the height said. The timezone is what the profile
  // CLAIMS, the warning is where the address actually is, and a user deciding what to do
  // about the disagreement needs both at once; showing one by deleting the other left them
  // reading a country name with no zone under it. So the zone stays put and the warning gets
  // a line of its own, nowrap, which costs the height of one line and nothing more.
  const mismatch = exitCC && exitCC !== c.code;
  countryTz.textContent = c.tz;
  countryTz.classList.remove('warn');
  countryTz.title = '';
  if (countryWarn) {
    countryWarn.hidden = !mismatch;
    countryWarn.textContent = mismatch ? `Адрес выхода: ${exitName(exitCC)} — не совпадает` : '';
    countryWarn.title = mismatch
      ? `Профиль заявляет ${c.name} (${c.code}), а запросы уходят с адреса в ${exitName(exitCC)} (${exitCC}). ` +
        `Это расхождение видно любому сайту без единой строчки JS. Смените страну или узел VPN.`
      : '';
  }
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
      el.id = 'country-opt-' + c.code;
      el.innerHTML = `
        <span>${c.name}</span>
        <span class="code">${c.code}</span>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedCountryCode = c.code;
        renderCountryHeader();
        closeDropdown();
      });
      optionList.appendChild(el);
    });
  // Re-place the cursor: the list above was just rebuilt, so the row that carried it is
  // gone. Without this, typing anything would leave Enter with nothing to press.
  if (countrySelect.classList.contains('open')) lbEnsureActive(optionList, searchInput);
}

function openDropdown() {
  closeProfileDropdown();
  dropdown.classList.add('open');
  countrySelect.classList.add('open');
  // [FIX the-country-button-never-said-it-was-open] The profile button below has always
  // updated this; this one never did, so anything reading the popup aloud was told the menu
  // stayed shut while it was open on screen. Two pickers that share every class and every
  // rule behaved differently because they were wired twice.
  countryBtn.setAttribute('aria-expanded', 'true');
  lbEnsureActive(optionList, searchInput);
  setTimeout(() => searchInput.focus(), 40);
}
function closeDropdown() {
  const had = dropdown.contains(document.activeElement);
  dropdown.classList.remove('open');
  countrySelect.classList.remove('open');
  countryBtn.setAttribute('aria-expanded', 'false');
  searchInput.removeAttribute('aria-activedescendant');
  searchInput.value = '';
  renderOptionList();
  if (had) countryBtn.focus();
}

// [CLEANUP] renderWarnings + #warnings. Five coherence rules over the PROFILES table above,
// written in English inside a Russian UI, and unreachable: measured 0 warnings on all seven
// shipped rows. PROFILES is a const in this file, so the box could only ever fire for
// someone EDITING it — which is a build-time check wearing a runtime box. The rules are
// asserted over the shipped table in test/profilecoherence.mjs now, where a bad edit fails
// the suite instead of reaching a user, and the ~38px they reserved paid for the
// exit-country warning to stop overwriting the timezone.

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
  // Both lists become operable without a mouse. One helper, two callers — see wireListbox.
  wireListbox({
    select: countrySelect, btn: countryBtn, list: optionList,
    holder: () => searchInput,
    isOpen: () => countrySelect.classList.contains('open'),
    open: openDropdown, close: closeDropdown
  });
  wireListbox({
    select: profileSelect, btn: $('profileBtn'), list: profileList,
    holder: () => profileList,
    isOpen: () => profileSelect.classList.contains('open'),
    open: openProfileDropdown, close: closeProfileDropdown
  });
  applyBtn.addEventListener('click', handleApply);
  webrtcToggle.addEventListener('click', handleWebrtcToggle);
  swToggle.addEventListener('click', handleSwToggle);
  if (cspToggle) cspToggle.addEventListener('click', handleCspToggle);
  const modes = Array.from(document.querySelectorAll('#modeGrid .mode'));
  modes.forEach((el, i) => {
    el.addEventListener('click', () => selectMode(el.getAttribute('data-mode')));
    el.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = modes[(i + d + modes.length) % modes.length];
      next.focus();
      selectMode(next.getAttribute('data-mode'));
    });
  });
}

/**
 * [FIX the-stand-down-note-erased-the-webrtc-one]
 *
 * Two notes ride in the site card's one line, and they are decided by two different reads at
 * two different moments: the global WebRTC switch comes back from `getWebrtcStatus`, the
 * stand-down boolean comes back later from `chrome.scripting` in the tab. Both wrote
 * `siteHost.textContent` whole, so the later one erased the earlier one. Measured through the
 * real popup, four combinations:
 *
 *   webrtc ON , standDown OFF   "127.0.0.1"
 *   webrtc ON , standDown ON    "127.0.0.1 · машина не подменяется"
 *   webrtc OFF, standDown OFF   "127.0.0.1 · WebRTC выключен в настройках"
 *   webrtc OFF, standDown ON    "127.0.0.1 · машина не подменяется"      <- the note is gone
 *
 * The comment on the old line even claimed "showStandDown() only ever ADDS"; it did not, and
 * the cell it broke is the common one — stand-down fires on github.com and youtube.com, and
 * the note it dropped is the whole of [FIX the-off-state-was-invisible].
 *
 * So the line has ONE writer now and the two notes are held apart as state. Order is not
 * cosmetic: `.card.site .hint` is nowrap + ellipsis (popup.css), so with both notes present
 * the tail is what gets cut — and the stand-down half already has a title to be recovered
 * from, while the WebRTC half's only channel is the visible line. That title now leads with
 * the whole line, the same way showStatus puts its full message on the bar, so the cut half
 * is readable rather than merely present. No new row and no wrap: the card is still one
 * line, which is what keeps the popup under Chrome's 600px cap.
 */
const SITE_NOTE_WEBRTC = 'WebRTC выключен в настройках';
const SITE_NOTE_STANDDOWN = 'машина не подменяется';
const SITE_NOTE_SD_TITLE =
  'Этот сайт ограничивает Trusted Types или запрещает blob-воркеры, ' +
  'поэтому его собственные воркеры читают настоящую машину. Окно отвечает так же — ' +
  'иначе сайт видит противоречие в две строки. Страна, зона, локаль и шум канваса ' +
  'работают как обычно. Переключатель «CSP → воркеры» ниже — это рычаг для такого сайта.';
// [FIX the-host-was-printed-twice] The line used to LEAD with the hostname, which the hero
// already prints — and with both notes appended it ran past the card and was ellipsised
// (measured: clipped true with WebRTC off on a standing-down site). `host` stays as the
// identity, because showStandDown() guards on it, but it is no longer what gets drawn:
// `lead` is, and the width the duplicate was taking goes to the notes.
const SITE_NOTE_BASE = 'Только для этого сайта';
const SITE_NOTE_NOTAB = 'Нет активной вкладки';
let siteNote = { host: '', lead: SITE_NOTE_BASE, webrtc: false, standDown: false };

function renderSiteHint() {
  const notes = [];
  if (siteNote.webrtc) notes.push(SITE_NOTE_WEBRTC);
  if (siteNote.standDown) notes.push(SITE_NOTE_STANDDOWN);
  // The label is what the line says when it has nothing else to say. With a note on it the
  // label is the least useful thing there — the line is nowrap and ellipsises from the tail,
  // so a fixed prefix spends the width the notes need. Measured with both notes present:
  // with the prefix the line was still cut, without it it fits.
  const parts = notes.length ? notes : [siteNote.lead];
  const txt = parts.join(' · ');
  siteHost.textContent = txt;
  // Amber stays the stand-down state alone — the module being off in the options page is a
  // different statement and gets words, not colour (see updateWebrtcToggle below).
  siteHost.classList.toggle('warn', siteNote.standDown);
  // The title is the stand-down channel and clears with it. It leads with the full line so
  // the ellipsised half is recoverable; the WebRTC note on its own does not reach the edge,
  // so it gets no title, exactly as before this fix.
  siteHost.title = siteNote.standDown ? txt + '\n\n' + SITE_NOTE_SD_TITLE : '';
}

async function updateWebrtcToggle() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'getWebrtcStatus' });
    if (!res || !res.host) {
      webrtcToggle.disabled = true;
      siteNote = { host: '', lead: SITE_NOTE_NOTAB, webrtc: false, standDown: false };
      renderSiteHint();
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
    //
    // The line is rebuilt from scratch on every update, so the stand-down state it may be
    // carrying from the previous site goes with it: showStandDown() re-decides it for THIS
    // host and re-renders, and both notes come back together.
    webrtcToggle.disabled = false;
    siteNote = { host: res.host, lead: SITE_NOTE_BASE, webrtc: res.enabled === false, standDown: false };
    renderSiteHint();
    webrtcLabel.classList.toggle('warn', res.enabled !== false && !res.protected);
    webrtcLabel.classList.toggle('off', res.enabled === false);
    setSwitch(webrtcToggle, res.protected && res.enabled !== false);
    showStandDown(res.host);
  } catch (e) {}
}

/**
 * [FIX the-popup-never-said-the-site-had-stood-down]
 *
 * On an origin that restricts Trusted-Types policy names or refuses blob: workers, mw-core
 * stands the window down: the machine answers from the BROWSER, whole, because the site's
 * own workers read it and a window that claimed otherwise would contradict them in two
 * lines (README "Limits", item 6). It is the fix working — and it is total, per site, and common
 * (github.com, youtube.com).
 *
 * Nothing in this popup said so. `grep standDown popup.js` was empty: the state lived in
 * audit.html and in the console checks, while the popup went on showing every module green.
 * That is the same defect as the screen chip on the profile row, in a bigger place: the
 * user believes in a substitution that this site has deliberately switched off.
 *
 * THE SOURCE IS THE DECISION, NOT A RE-DERIVATION. `_standDownNow()` publishes its frozen
 * answer on `window.__t0.sd` (that is how child frames inherit it), so the popup reads that
 * one boolean rather than re-reading `v.ui.tt` / `v.ui.wb` and re-implementing the route and
 * timeOrigin matching audit.js does — a second implementation of a rule this fiddly would
 * disagree with the first on some origin, and the popup would be confidently wrong.
 *
 * It rides in the hostname line, amber, for the reason the exit-country warning does: a new
 * row does not fit under Chrome's 600px cap. Only when it is TRUE — an absent `__t0` (a
 * chrome:// tab, a page our content scripts never reached) says nothing rather than "fine".
 */
async function showStandDown(host) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN',
      func: () => { try { return !!(window.__t0 && window.__t0.sd); } catch (e) { return false; } }
    });
    if (!(res && res[0] && res[0].result === true)) return;
    // [FIX the-stand-down-note-erased-the-webrtc-one] The answer arrives after
    // updateWebrtcToggle has already rendered, so this sets its own note and re-renders
    // rather than writing the line — which is what dropped the WebRTC one. The host guard is
    // for the same asynchrony: a verdict for a tab the popup has since moved off must not
    // stamp the line that now names a different site.
    if (siteNote.host !== host) return;
    siteNote.standDown = true;
    renderSiteHint();
  } catch (e) { /* chrome://, an extension page, a tab we cannot script — say nothing */ }
}

async function handleWebrtcToggle() {
  webrtcToggle.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'toggleWebrtcForCurrentTab' });
    if (res && res.ok) {
      setSwitch(webrtcToggle, res.protected);
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
    webrtcToggle.disabled = false;
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
      swToggle.disabled = true;
      return;
    }
    swToggle.disabled = false;
    swLabel.classList.toggle('warn', !!res.blocked);
    setSwitch(swToggle, !res.blocked);
  } catch (e) {}
}

async function handleSwToggle() {
  swToggle.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'toggleSwForCurrentTab' });
    if (res && res.ok) {
      setSwitch(swToggle, !res.blocked);
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
    swToggle.disabled = false;
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
      cspToggle.disabled = true;
      return;
    }
    cspToggle.disabled = false;
    setSwitch(cspToggle, !!res.on);
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
  cspToggle.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'toggleCspRewriteForCurrentTab' });
    if (res && res.ok && res.unneeded) {
      // Read and found harmless: nothing was rewritten and the switch stays off.
      setSwitch(cspToggle, false);
      cspLabel.classList.remove('warn');
      cspLabel.classList.add('off');
      showStatus('CSP сайта не мешает подмене — ничего не переписано', 'ok');
    } else if (res && res.ok) {
      setSwitch(cspToggle, !!res.on);
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
    cspToggle.disabled = false;
  }
}

function updateModeUI() {
  document.querySelectorAll('#modeGrid .mode').forEach(el => {
    const on = el.getAttribute('data-mode') === currentMode;
    el.classList.toggle('active', on);
    // role="radio" without this says there is a choice and refuses to say which — the same
    // gap the three switches had. One writer, next to the class it must agree with.
    el.setAttribute('aria-checked', on ? 'true' : 'false');
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