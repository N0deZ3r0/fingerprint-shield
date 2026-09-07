/**
 * Static regression checks for P0 parity fixes.
 * Run: node test/parity-static.mjs
 * Exit 0 = all assertions passed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate as generateDyn } from '../tools/gen-dyn.mjs';
import { generate as generateTables, countries } from '../tools/gen-tables.mjs';
import { loadBackground, loadPopup, balanced } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('PASS:', msg);
  }
}

const nav = read('mw/mw-navigator.js');
const workers = read('mw/mw-workers.js');
const bg = read('background.js');
const manifest = read('manifest.json');

// A1 iframe full parity
assert(nav.includes('[FIX iframe-full-parity]'), 'navigator has iframe-full-parity marker');
assert(nav.includes('_patchFrameNavScreen'), 'navigator defines _patchFrameNavScreen');
assert(nav.includes('_patchFrameAll'), 'navigator defines _patchFrameAll');
assert(nav.includes('hardwareConcurrency'), 'frame patch mentions hardwareConcurrency');
assert(nav.includes('deviceMemory'), 'frame patch mentions deviceMemory');
assert(!/HTMLIFrameElement\.prototype\.contentWindow/.test(nav), 'does not redefine contentWindow getter');
assert(nav.includes('MutationObserver'), 'still uses MutationObserver');

// A3 stealth worker parity
assert(workers.includes('_stealthParityOnly'), 'workers defines _stealthParityOnly');
assert(!/if\s*\(\s*_sm\s*\)\s*return\s*;/.test(workers), 'workers no longer early-returns on stealth');
assert(workers.includes("k === 'navigator' || k === 'timezone'"), 'stealth forces navigator+timezone');
assert(workers.includes('worker-date-api-parity'), 'workers Date API parity marker');
assert(workers.includes('Date.prototype.getHours'), 'workers patches Date.getHours');
assert(workers.includes('Date.prototype.toString'), 'workers patches Date.toString');
assert(workers.includes('Date.prototype.setHours'), 'workers patches Date.setHours');
assert(workers.includes('_tzShim.toString()'), 'tzShim emitted via toString');


// A4 inject allFrames
assert(bg.includes('allFrames: true'), 'injectProfile uses allFrames: true');

// B1 viewport not screen
assert(!/header:\s*'viewport-width'/.test(bg), 'does not set viewport-width header');
assert(!/header:\s*'sec-ch-viewport-width'/.test(bg), 'does not set sec-ch-viewport-width header');
assert(bg.includes('device-memory'), 'still sets device-memory');
assert(bg.includes('[FIX viewport-ch-not-screen]'), 'viewport fix comment present');

// Manifest still all_frames
const man = JSON.parse(manifest);
const cs = man.content_scripts || [];
assert(cs.every((c) => c.all_frames === true), 'all content_scripts all_frames true');
assert(cs.every((c) => c.match_about_blank === true), 'all content_scripts match_about_blank true');
// [FIX opaque-frames-got-the-stub] match_about_blank covers about:blank and about:srcdoc
// and NOTHING else. A data: frame therefore ran with no content script at all — measured,
// it reported the host's screen, timezone, locale, cores, GPU and a userAgent still saying
// HeadlessChrome, from one line of HTML in the embedding page. A blob: frame got the
// parent's partial frame patch and contradicted itself instead. match_origin_as_fallback is
// what reaches a frame whose origin is opaque but inherited from a matching one, and it has
// to be on the dynamic boot registration too or those frames see the scripts without ever
// seeing the SELECTION and fall back to the neutral stub.
assert(cs.every((c) => c.match_origin_as_fallback === true),
  'all content_scripts match_origin_as_fallback true (data:/blob: frames)');
assert(/matchOriginAsFallback: true/.test(bg), 'the dyn/ boot registration sets it too');

// Generic CSS font families: three independent copies decide whether a family name is a
// generic (pass through) or an unknown installed font (block). They disagreed — the
// document.fonts copy lacked ui-serif/ui-sans-serif/ui-monospace while the two canvas
// copies lacked fangsong — so one family name got two different answers inside one
// document. See [FIX generic-family-lists-diverged].
{
  const misc = read('mw/mw-misc.js');
  const canvas = read('mw/mw-canvas-audio.js');
  const balanced = (src, re) => {
    const i = src.search(re), b = src.indexOf('{', i);
    let d = 0, j = b;
    for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
    return Object.keys(eval('(' + src.slice(b, j + 1) + ')')).sort().join(',');
  };
  const a = balanced(canvas, /var _generics =/);
  const b = balanced(misc, /var _sfG =/);
  const c = balanced(workers, /var _gen = \{/);
  assert(a === b, 'generic families: mw-canvas-audio _generics === mw-misc _sfG');
  assert(b === c, 'generic families: mw-misc _sfG === worker _gen');
  assert(a.includes('fangsong') && a.includes('ui-monospace'), 'generic families cover the full CSS Fonts 4 set');
}

// The worker "this source already carries our patch" guard must look for a string the
// generated payload really contains. It drifted once already, when the navigator block
// moved to the _defIf helper and stopped emitting the literal the guard searched for —
// see [FIX already-patched-sentinel-never-matched].
assert(/var _PATCH_MARK = '([^']+)'/.test(workers), 'worker patch marker is a named constant');
{
  const mark = /var _PATCH_MARK = '([^']+)'/.exec(workers)[1];
  const emitted = workers.includes("_PATCH_MARK + 'var _M=(");
  assert(emitted, 'the marker constant is emitted into the payload');
  // Every place that asks "is this source already ours?" must ask via the constant, never
  // a literal — the literal drifted once already, see [FIX already-patched-sentinel-never-
  // matched]. The count is derived rather than written down: it was 2 until module workers
  // got a wrapper of their own ([FIX module-workers-were-handed-straight-through]), and a
  // hardcoded 2 would have to be edited every time a scope is added, which is exactly the
  // kind of edit that gets made without reading what it guards.
  const guards = (workers.match(/indexOf\(_PATCH_MARK\)/g) || []).length;
  // Three source paths can hand us something we already patched: a classic same-origin
  // worker, a classic blob: worker, and a module worker. Each needs its own guard, and
  // the module one is the newest — see [FIX module-workers-were-handed-straight-through].
  const wrappers = (workers.match(/function _wrap(WorkerUrl|ModuleWorker)\b/g) || []).length;
  assert(wrappers === 2, `both worker wrappers are present (found ${wrappers})`);
  assert(guards === 3, `every source path re-entry guard uses the marker constant (found ${guards})`);
  // strip line comments first — the fix note quotes the old marker on purpose
  assert(!workers.replace(/\/\/[^\n]*/g, '').includes('Object.defineProperty(navigator,"hardwareConcurrency"'),
    'the stale hardcoded marker is gone from live code');
  assert(mark.length > 8, 'marker is specific enough to not match arbitrary worker source');
}

// mw-cleanup must not delete __g0: mw-canvas-audio used to call it at getContext time,
// always after cleanup had run, so the per-context WebGL wrap never executed once.
// See [FIX g0-deleted-before-it-was-ever-called].
{
  const cleanup = read('mw/mw-cleanup.js');
  const canvas = read('mw/mw-canvas-audio.js');
  assert(!/'__g0'/.test(cleanup.replace(/\/\/[^\n]*/g, '')), 'mw-cleanup does not delete __g0');
  assert(nav.includes('MW.wrapGL = _wrapGLContext'), 'navigator publishes the GL wrap on __AFP_MW__');
  assert(canvas.includes('MW.wrapGL'), 'canvas reads the GL wrap at load, not at call time');
  assert(!/window\.__g0\(/.test(canvas), 'canvas no longer calls a window global at getContext time');
}

// The dynamic header rules and the static ruleset must cover the SAME request types.
// They did not: the dynamic rules (accept-language, user-agent, sec-ch-ua) fired only on
// main_frame/sub_frame/xmlhttprequest while the static one (sec-ch-ua-platform, arch,
// bitness…) fired on everything, so a subresource carried a spoofed platform next to a
// real User-Agent. See [FIX header-rules-covered-fewer-request-types-than-the-static-ruleset].
{
  const staticRules = JSON.parse(read('rules/static.json'));
  const dyn = /const AFP_HEADER_RESOURCE_TYPES = \[([\s\S]*?)\]/.exec(bg);
  assert(!!dyn, 'background declares AFP_HEADER_RESOURCE_TYPES');
  if (dyn) {
    const dynList = eval('[' + dyn[1] + ']').slice().sort();
    assert(!/resourceTypes: \['main_frame', 'sub_frame', 'xmlhttprequest'\]/.test(bg),
      'no dynamic rule keeps the old narrow three-type list');
    // [FIX unsolicited-client-hints] Three rule shapes now: the always-sent header rule,
    // the unconditional strip of every high-entropy hint, and the per-origin restore. The
    // point of the check is unchanged — no rule may narrow the type list on its own — so it
    // asserts "every rule uses the shared constant", not a fixed count.
    const uses = (bg.match(/resourceTypes: AFP_HEADER_RESOURCE_TYPES/g) || []).length;
    const anyResourceTypes = (bg.match(/resourceTypes:/g) || []).length;
    // [FIX csp-rewrite-for-workers] One rule is allowed its own list: the per-site CSP
    // rewrite edits a RESPONSE header, and only a document's CSP governs the workers it
    // builds — a subresource's CSP header governs nothing of ours.
    // [FIX csp-restrictions-learned-per-route] And a second: the per-route stand-down
    // `allow` exempts the DOCUMENT request of a stood-down route by its URL; the route's
    // subresources are exempted by the tab rule, which does use the shared list minus the
    // two document types. Exactly two such rules.
    const docOnly = (bg.match(/resourceTypes: \['main_frame', 'sub_frame'\] \}/g) || []).length;
    assert(docOnly === 2, `exactly two documents-only rules, the CSP rewrite and the per-route stand-down (found ${docOnly})`);
    assert(uses >= 3 && uses + docOnly === anyResourceTypes,
      `every request-header rule uses the shared list (shared ${uses} + documents-only ${docOnly} of ${anyResourceTypes})`);
    for (const r of staticRules) {
      const stat = (r.condition.resourceTypes || []).slice().sort();
      assert(stat.join(',') === dynList.join(','),
        `static rule ${r.id} covers the same request types as the dynamic rules`);
    }
    assert(!dynList.includes('websocket'),
      'websocket excluded — its handshake carries no Accept-Language and DNR cannot rewrite it');
  }
}

// The synchronous frame patch must NOT wrap Node.prototype.{appendChild,insertBefore,
// replaceChild}. It did, and that put this file on the stack of every node insertion on
// the page — so Chrome blamed mw/mw-navigator.js for console errors the PAGE caused
// (deviceinfo.me probing chrome:// URLs printed ~20 of them under our name). The trigger
// is contentWindow/contentDocument now: the only way a page can reach into a frame, so
// the patch still lands before anything can be read, with identical coverage measured
// against the real unpacked extension across four frame shapes.
// See [FIX blamed-for-the-pages-own-console-errors].
{
  const canvas = read('mw/mw-canvas-audio.js');
  const strip = (t) => t.replace(/\/\/[^\n]*/g, '');
  assert(!/_wrapNodeInsert/.test(strip(nav)), 'navigator no longer wraps the insert methods');
  assert(!/Node\.prototype,\s*'appendChild'/.test(strip(nav)), 'Node.prototype.appendChild left native');
  assert(!/Node\.prototype,\s*'appendChild'/.test(strip(canvas)), 'canvas does not wrap it either');
  assert(/HTMLIFrameElement\.prototype, prop/.test(strip(nav)), 'patch triggers off the iframe accessors');
  assert(/'contentWindow', 'contentDocument'/.test(strip(nav)), 'both accessors are hooked');
  assert(nav.includes('MW.iframeHooks = _iframeHooks'), 'navigator still publishes the hook registry');
  assert(/MW\.iframeHooks\.push/.test(strip(canvas)), 'canvas still registers through it');
}

// The worker payload must be assembled from REAL functions, not string literals.
// Anything still concatenated is invisible to ESLint — no parse check, no no-undef — and
// the injection sits in try{}catch{}, so a syntax error there does not throw: it silently
// leaves every worker unpatched with a quiet console. dev-workerpayload.html compiles the
// emitted script; this keeps the source from drifting back.
{
  const shims = (workers.match(/^        function _\w+Shim\(/gm) || []).length;
  assert(shims >= 10, `worker logic lives in real functions (found ${shims} shims)`);
  const emitted = (workers.match(/Shim\.toString\(\)/g) || []).length;
  assert(emitted >= 10, `every shim is emitted via toString (found ${emitted})`);
  // No multi-line string concatenation left inside the payload array.
  // \r?\n, not \n: the repo's files are CRLF and this file was the one place that still
  // held LF in the middle. An assertion about how the payload is BUILT must not turn red
  // because a line ending changed.
  const arr = new RegExp('\\r?\\n            return \\[\\r?\\n([\\s\\S]*?)\\r?\\n            \\]\\.join').exec(workers);
  assert(!!arr, 'payload array located');
  if (arr) {
    // A line ending in `' +` is only a problem when it is emitted JS being built out of
    // literals. The same shape appears harmlessly when a shim INVOCATION wraps because its
    // argument list is long — those lines carry a .toString() splice, so they are excluded.
    const concat = arr[1].split('\n')
      .filter((l) => /'\s*\+\s*$/.test(l) && !l.includes('toString()')).length;
    assert(concat === 0, `no multi-line string blocks left in the payload (found ${concat})`);
    assert(!/function _M\(f,acc\)/.test(arr[1]), 'the mask is no longer a string literal');
    assert(!/function _defIf\(o,p,v\)/.test(arr[1]), '_defIf is no longer a string literal');
  }
}

// [FIX plugins-branch-shipped-unmasked-functions] Every function mw/*.js hands to the page
// has to go through _mn, or Function.prototype.toString on it prints this codebase. The
// navigator.plugins fallback was assigning six of them bare — invisible in practice
// because real Chromium always reports 5 PDF plugins so that branch never ran, and
// invisible to review because it is one `= function(` among thousands of lines.
//
// So this is checked as an invariant over all of mw/ rather than at those six lines: a
// bare function expression assigned to any property is a finding. The one allowed target
// is MW.* — that is __AFP_MW__, the internal registry mw-cleanup.js deletes before the
// page runs, so nothing there is reachable from a page.
{
  const files = fs.readdirSync(path.join(root, 'mw')).filter((f) => f.endsWith('.js'));
  assert(files.length >= 10, `scanning mw/ (${files.length} files)`);
  const naked = [];
  for (const f of files) {
    const lines = read('mw/' + f).split('\n');
    lines.forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
      const m = /(\w+)((?:\.\w+)+|\[[^\]]+\])\s*=\s*function\s*[(*]/.exec(code);
      if (m && m[1] !== 'MW') naked.push(`mw/${f}:${i + 1}  ${code.slice(0, 72)}`);
    });
  }
  assert(naked.length === 0,
    'no unmasked function is assigned to a property in mw/' + (naked.length ? '\n       ' + naked.join('\n       ') : ''));

  // And the specific repair, named, so a revert reads as a revert.
  const misc = read('mw/mw-misc.js');
  assert(misc.includes('[FIX plugins-branch-shipped-unmasked-functions]'), 'plugins fix marker present');
  for (const name of ['item', 'namedItem', 'refresh']) {
    assert(new RegExp(`_mn\\(function ${name}\\s*\\(`).test(misc), `navigator.plugins ${name}() is masked`);
  }
  // @@iterator is inherited from the native prototype when there is one, so the instance
  // carries no own symbol — a real navigator.plugins has none either.
  assert(/if \(!HAS_PLUGIN_ARRAY\) \{/.test(misc), 'PluginArray only gets a hand-built iterator when the interface is missing');
  assert(/if \(!HAS_MIME_ARRAY\) \{/.test(misc), 'MimeTypeArray only gets a hand-built iterator when the interface is missing');
  assert(/if \(!HAS_PLUGIN\) makeIterable/.test(misc), 'Plugin only gets a hand-built iterator when the interface is missing');
}

// [FIX answered-questions-the-real-context-refuses] getParameter must consult the driver
// before its table in BOTH scopes: several table entries are WebGL2-only and UNMASKED_* is
// null until WEBGL_debug_renderer_info is enabled, so a table-first lookup answered
// questions no real context answers. A brand-check failure must also stay a failure —
// getParameter.call({}, …) natively throws "Illegal invocation", and returning a number
// there turns a tampering probe into a positive result.
{
  const winFn = nav.slice(nav.indexOf('function _wgParam'), nav.indexOf('var g1 = WebGLRenderingContext.prototype'));
  const wrkFn = workers.slice(workers.indexOf('function make(orig)'), workers.indexOf('if (typeof WebGLRenderingContext'));
  assert(winFn.length > 200 && wrkFn.length > 200, 'both getParameter implementations located');
  for (const [label, src] of [['window', winFn], ['worker', wrkFn]]) {
    // The native call has to happen before the table is consulted.
    const nativeAt = src.search(/orig\.call\(/);
    const tableAt = src.search(/hasOwnProperty\.call\(/);
    assert(nativeAt > 0 && tableAt > 0 && nativeAt < tableAt,
      `${label} getParameter asks the driver before its table`);
    assert(/native === null \|\| native === undefined/.test(src),
      `${label} getParameter returns null where the driver returns null`);
    assert(/catch \(e0\) \{ throw /.test(src),
      `${label} getParameter rethrows a brand-check failure instead of answering`);
  }
}

// [FIX eight-copies-of-the-profile-reader] _prof was copied verbatim into all eight
// modules, each with its own memo, so a page load parsed the profile once per module.
// mw-core.js keeps the implementation — it needs a profile before __AFP_MW__ exists —
// and publishes it; everyone else reads it from there.
{
  const files = fs.readdirSync(path.join(root, 'mw')).filter((f) => f.endsWith('.js'));
  const owners = files.filter((f) => /function _prof\s*\(/.test(read('mw/' + f)));
  assert(owners.join(',') === 'mw-core.js', `only mw-core.js defines _prof (found: ${owners.join(', ') || 'none'})`);

  const core = read('mw/mw-core.js');
  // Both export paths — the defineProperty one and the catch fallback. A module that
  // reads MW.prof from an object that does not carry it calls undefined.
  assert((core.match(/\bprof: _prof\b/g) || []).length === 2,
    'mw-core publishes prof on both __AFP_MW__ export paths');

  // Every module that uses _prof must get it from somewhere.
  for (const f of files) {
    const src = read('mw/' + f);
    if (f === 'mw-core.js' || !/_prof\(\)/.test(src)) continue;
    assert(/var _prof = MW\.prof;/.test(src) || /var _prof = \(window\.__AFP_MW__ && window\.__AFP_MW__\.prof\)/.test(src),
      `mw/${f} takes _prof from the registry`);
  }
}

// [FIX worker-webgpu-reported-the-real-gpu] / [FIX webgpu-info-patched-on-the-instance]
// WebGPU identity is spoofed in two places — mw-navigator.js for the window, the
// _webgpuShim inside mw-workers.js for the worker payload — and they have to stay the same
// patch. Nothing here needs a GPU, which matters because the live page
// (dev-webgpu-parity.html) cannot run in the headless suite: requestAdapter() resolves to
// null there, so it is listed under NOT_COVERED and run by hand with --headed.
{
  // Comment lines are dropped before matching, and the window slice is bounded by the next
  // section header. Both blocks DISCUSS the API they no longer call — the whole point of
  // the cleanup note is to say why requestAdapterInfo and the limits tables are absent —
  // and prose about a pattern must not count as the pattern. (Same trap dev-symmetry.html
  // documents for its own source scans; the first version of this check failed on its own
  // explanatory comments.)
  const codeOnly = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const winStart = nav.indexOf('WEBGPU adapter.info');
  const winEnd = nav.indexOf('WEBGL SHADER PRECISION', winStart);
  assert(winStart > 0 && winEnd > winStart, 'window WebGPU block is bounded by its section headers');
  const wgpuWin = codeOnly(nav.slice(winStart, winEnd));
  const wgpuWrk = codeOnly(workers.slice(workers.indexOf('function _webgpuShim'), workers.indexOf('function _maskShim')));
  assert(wgpuWin.length > 500, 'window WebGPU block located');
  assert(wgpuWrk.length > 500, 'worker _webgpuShim located');

  // Both patch the interface prototype. Defining these on the instance is what made
  // JSON.stringify(adapter.info) return a populated object where a clean browser returns
  // "{}" — see the long note in mw-navigator.js.
  for (const [label, src] of [['window', wgpuWin], ['worker', wgpuWrk]]) {
    assert(/GPUAdapterInfo\.prototype/.test(src), `${label} patches GPUAdapterInfo.prototype`);
    assert(!/defineProperty\(\s*(infoObj|adapter\.info|info)\s*,/.test(src),
      `${label} does not define properties on the adapter.info instance`);
    // Dead API — Chrome ships neither, so a reference means the code drifted back.
    assert(!/requestAdapterInfo/.test(src), `${label} carries no requestAdapterInfo branch`);
    assert(!/'isFallbackAdapter'\s+in\s+adapter/.test(src),
      `${label} carries no adapter.isFallbackAdapter branch`);
    // [FIX requestAdapter-wrapper-put-this-file-in-the-page-console] requestAdapter must
    // stay native. Wrapping it placed this extension on the stack of Chrome's own
    // "powerPreference is currently ignored on Windows" warning (crbug.com/369219127),
    // so the console of every WebGPU site named the file. Nothing about GPU identity
    // needs the call intercepted — the fields are read off GPUAdapterInfo.prototype.
    assert(!/requestAdapter/.test(src), `${label} leaves GPU.prototype.requestAdapter native`);
    assert(!/forceFallbackAdapter/.test(src), `${label} does not intercept the adapter request`);
    // Limits are deliberately untouched in both scopes.
    assert(!/GPUSupportedLimits|maxTextureDimension/.test(src), `${label} leaves adapter.limits native`);
    for (const f of ['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter']) {
      assert(new RegExp(`'${f}'`).test(src), `${label} covers info.${f}`);
    }
  }

  // The two derivations must land on the same family for the same profile — that agreement
  // IS the feature, so the fallback defaults cannot drift apart.
  const winDerive = /nvidia'; a = a \|\| 'ampere'/.test(nav) && /intel'; a = a \|\| 'xe-lpg'/.test(nav);
  const wrkDerive = /nvidia'; a = a \|\| 'ampere'/.test(workers) && /intel'; a = a \|\| 'xe-lpg'/.test(workers);
  assert(winDerive && wrkDerive, 'window and worker derive the same family defaults from webglVendor');

  // Emitted, and behind the same flag as WebGL: one GPU, one switch.
  assert(/\(' \+ _webgpuShim\.toString\(\) \+ '\)/.test(workers), 'the worker shim is emitted via toString');
  // `&& !_hw` is host mode: the worker reads the real adapter there, as the window does.
  assert(/_on\('webgl'\) && !_hw\) \? \('\(' \+ _webgpuShim\.toString/.test(workers),
    'the worker shim rides the webgl feature flag (and stands aside in host mode)');
  assert(/var wgpu = JSON\.stringify\(_getWGPU\(\)\);/.test(workers), 'the payload carries the profile GPU info');
}

// [FIX platform-version-pinned-to-windows-10] The value now has ONE source — the profile
// background.js builds from the host's family — and three consumers that must never drift:
// the window UA-CH, the worker payload, and the sec-ch-ua-platform-version header. A
// literal reintroduced at any of them is a split waiting to happen, so nothing may assign
// '10.0.0' outright; it may only survive as a `|| '10.0.0'` fallback.
{
  const files = { 'mw/mw-navigator.js': nav, 'mw/mw-workers.js': workers, 'background.js': bg };
  for (const [name, src] of Object.entries(files)) {
    const hard = src.split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => !l.trim().startsWith('//')
        && /(?:platformVersion|platform-version)[^\n]*'10\.0\.0'/.test(l)
        && !/\|\|\s*'10\.0\.0'/.test(l)
        // A fallback is fine, spelled either `|| '10.0.0'` inline or a default object
        // literal carrying an explicit `// fallback only` marker. Anything else is a pin.
        && !/fallback only/.test(l))
      .map(([i, l]) => `${name}:${i} ${l.trim().slice(0, 70)}`);
    assert(hard.length === 0,
      `${name} pins no platformVersion literal` + (hard.length ? '\n       ' + hard.join('\n       ') : ''));
  }
  assert(/async function afpPlatformVersion\(\)/.test(bg), 'background derives platformVersion from the host');
  assert(/major >= 13/.test(bg), 'and buckets it by Windows family rather than passing the build through');
  assert(/platformVersion: await afpPlatformVersion\(\)/.test(bg), 'the profile carries the derived value');
  // [FIX unsolicited-client-hints] The header moved out of the unconditional rule into the
  // per-origin client-hint rules, so it is no longer built from the local `platformVersion`
  // variable — it reads the profile directly. The property this check exists for is
  // unchanged: ONE source, the profile, for the header as well as the window and the worker.
  assert(/'sec-ch-ua-platform-version':[\s\S]{0,240}p\.clientHints\.platformVersion/.test(bg),
    'the DNR header uses that same value (via the per-origin client-hint rule)');
  // …and it says nothing at all rather than inventing a family when the value is unknown.
  assert(/'sec-ch-ua-platform-version':[\s\S]{0,240}return v \? '"' \+ v \+ '"' : null/.test(bg),
    'an unknown platformVersion omits the header instead of claiming one');
  assert(/_chPv = JSON\.stringify\(_ch\.platformVersion/.test(workers), 'the worker payload reads it from the profile');
  assert(/platformVersion: c\.platformVersion/.test(nav), 'the window UA-CH reads it from the profile');
}

// ── dyn/ — the cold-start boot script ───────────────────────────────────────────
// The files under dyn/ are generated from GPU_DATA, COUNTRY_DATA and popup's PROFILES.
// Nothing at runtime re-derives them, so a table edit that skips the generator would
// ship a cold start describing a machine or a country that no longer exists — exactly
// the kind of silent split the rest of this file exists to catch.
{
  const files = generateDyn();
  const stale = Object.entries(files)
    .filter(([rel, body]) => !fs.existsSync(path.join(root, rel)) || read(rel) !== body)
    .map(([rel]) => rel);
  assert(stale.length === 0,
    'dyn/ matches the tables' + (stale.length ? ` — stale: ${stale.slice(0, 4).join(', ')}${stale.length > 4 ? ` (+${stale.length - 4})` : ''}; run: node tools/gen-dyn.mjs` : ''));

  const orphans = [];
  // dyn/ns belongs in this list, and used to be missing from it — which left the ONE
  // directory whose naming scheme actually changed as the only one nothing swept. The old
  // layout was sixteen files named `<hex>.js`; [FIX repeated-nibble-collapsed-the-seed]
  // replaced it with 128 named `<pos><hex>.js`. A surviving `0.js`..`f.js` from before that
  // rename is never regenerated, never registered and never compared, so it would have sat
  // in a shipped extension indefinitely with every suite green.
  for (const dir of ['dyn/dev', 'dyn/cc', 'dyn/mode', 'dyn/pv', 'dyn/ns']) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) if (!files[`${dir}/${name}`]) orphans.push(`${dir}/${name}`);
  }
  // dyn/ itself, for the same reason. Everything at this level is generated except
  // boot.js — naming it here is also the assertion that the assembler is still on disk,
  // which nothing else states: a missing boot.js makes registerContentScripts throw into
  // the catch in registerBootScript, and cold start goes quietly back to the stub.
  for (const name of fs.readdirSync(path.join(root, 'dyn'))) {
    if (fs.statSync(path.join(root, 'dyn', name)).isDirectory()) continue;
    if (name === 'boot.js' || files[`dyn/${name}`]) continue;
    orphans.push(`dyn/${name}`);
  }
  assert(fs.existsSync(path.join(root, 'dyn/boot.js')), 'dyn/boot.js, the hand-written assembler, is on disk');
  assert(orphans.length === 0, 'dyn/ has no leftover files' + (orphans.length ? ` — ${orphans.join(', ')}` : ''));

  // registerContentScripts throws on a path that does not exist, and the throw would be
  // swallowed by the catch in registerBootScript — leaving cold start silently broken.
  const { PROFILES } = loadPopup(['PROFILES']);
  const { COUNTRY_DATA } = loadBackground(['COUNTRY_DATA']);
  const declared = (bg.match(/const BOOT_DEVICE_IDS = \[([^\]]*)\]/) || [, ''])[1]
    .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert(declared.join('|') === PROFILES.map((p) => p.id).join('|'),
    `BOOT_DEVICE_IDS matches popup PROFILES — background has [${declared}], popup has [${PROFILES.map((p) => p.id)}]`);
  assert(Object.keys(COUNTRY_DATA).every((cc) => files[`dyn/cc/${cc}.js`]),
    'every COUNTRY_DATA key has a dyn/cc file');
  assert(declared.every((id) => files[`dyn/dev/${id}.js`]), 'every BOOT_DEVICE_ID has a dyn/dev file');

  // The mechanism itself: a MAIN-world document_start script is the only channel that
  // beats the page's first inline script (measured — webNavigation.onCommitted with
  // injectImmediately does not), and boot.js must stay last because it reads what the
  // generated files ahead of it define.
  assert(/id: BOOT_SCRIPT_ID/.test(bg), 'background registers the boot script');
  assert(/'dyn\/boot\.js'\s*\]/.test(bg), 'dyn/boot.js is the last file in the registration');
  assert(/runAt: 'document_start'/.test(bg) && /world: 'MAIN'/.test(bg), 'boot script is MAIN world at document_start');
  assert(/persistAcrossSessions: true/.test(bg), 'boot script survives a service-worker restart');
  // [FIX machine-skeleton-sat-in-a-dom-attribute] The machine travels in the ui:ready
  // DETAIL, never as a DOM attribute: data-v-hw put the whole thing — screen, cores,
  // memory, both UNMASKED GL strings, the GL limit table, the WebGPU adapter info,
  // languages, voices — on <html> for any script to read at any time. It was also
  // redundant: measured, removing it broke only assertions that read it themselves.
  // [FIX bridge-attributes-were-an-extension-detector] NOTHING is written to <html>. A
  // clean browser leaves zero attributes there, so every one of ours announced the
  // extension to any script that looked — and the set carried the machine (hw), the
  // timezone, the locale, the mode, the 13 flags and the per-domain canvas seed. All of
  // them were measured redundant or replaceable: the cold start runs on the ui:ready
  // detail, the seed reaches other scopes through sessionStorage, and the frame-bridge
  // marker is __p0, which the parent reads and never writes.
  for (const f of ['dyn/boot.js', 'storage-bridge.js', 'background.js',
    'mw/mw-core.js', 'mw/mw-canvas-audio.js', 'profile-injector.js']) {
    assert(!/setAttribute\(\s*['"]data-v-/.test(read(f)), `${f} writes no data-v-* attribute`);
  }
  assert(!/setAttribute\('data-v-hw'/.test(read('dyn/boot.js')),
    'boot.js does NOT publish the machine as a DOM attribute');
  assert(/profileData: hw/.test(read('dyn/boot.js')),
    'boot.js passes the machine in the ui:ready detail instead');
  assert(/detail\.profileData/.test(read('profile-injector.js')),
    'profile-injector reads it from the event');

  // platformVersion travels the same channel: the DNR header carries the host's real
  // bucket from the first request, so a cold start left on the '10.0.0' fallback puts a
  // Windows 10 claim under a Windows 11 header.
  assert(/dyn\/pv\/\$\{pv\}\.js/.test(bg), 'the boot registration includes the platformVersion file');
  assert(/=== WIN11_PLATFORM_VERSION \? 'win11' : 'win10'/.test(bg), 'and picks it from afpPlatformVersion');
  assert(/__AFP_BOOT_PV__/.test(read('dyn/boot.js')), 'boot.js reads the platformVersion marker');
  assert(/platformVersion: pv \|\| undefined/.test(read('dyn/boot.js')), 'and publishes it');
  assert(/detail\.platformVersion/.test(read('profile-injector.js')), 'profile-injector applies it to clientHints');
  const pvFiles = { 'dyn/pv/win10.js': /"10\.0\.0"/, 'dyn/pv/win11.js': /"15\.0\.0"/ };
  for (const [f, re] of Object.entries(pvFiles)) {
    assert(fs.existsSync(path.join(root, f)) && re.test(read(f)), `${f} carries the matching bucket`);
  }
  // Same voice list on both sides of the cold-start boundary.
  assert(/afpSpeechVoices\(country\.loc\)/.test(bg), 'buildProfile takes speechVoices from the shared function');
  assert(/afpSpeechVoices\(d\.loc\)/.test(read('tools/gen-dyn.mjs')), 'and so does the generator');

  // [FIX voice-names-dropped-the-region-the-three-english-ones-carry] The three English
  // voices always carried "English (United States)" while every localised one read just
  // "- German", "- Russian". A list that contradicts its own naming format is checkable by
  // anyone, with no database of Windows voices needed, which is what made it worth fixing
  // and what this pins. The regions are derived from Intl.DisplayNames with
  // languageDisplay 'standard' — see the note at afpSpeechVoices — so this asserts the
  // SHAPE rather than 34 hand-written strings that would rot with CLDR.
  {
    const { afpSpeechVoices } = loadBackground(['afpSpeechVoices']);
    const REGION = / - [^-]+ \([^()]+\)$/;
    for (const loc of ['en-US', 'de-DE', 'ru-RU', 'et-EE', 'ja-JP', 'pt-BR', 'nb-NO', 'uk-UA']) {
      const voices = afpSpeechVoices(loc);
      assert(voices.length >= 3, `afpSpeechVoices('${loc}') returns a list (${voices.length})`);
      const bad = voices.filter((v) => !REGION.test(v.name));
      assert(bad.length === 0,
        `every voice name for ${loc} names its region like the English ones do` +
        (bad.length ? ` — ${bad.map((v) => v.name).join('; ')}` : ''));
      const defaults = voices.filter((v) => v.default);
      assert(defaults.length === 1,
        `exactly one voice is the default for ${loc} (${defaults.length})`);
    }
    // The one name this machine could measure against a real Windows voice.
    const ru = afpSpeechVoices('ru-RU').find((v) => v.lang === 'ru-RU');
    assert(ru && ru.name === 'Microsoft Irina - Russian (Russia)',
      `the Russian voice is spelled as clean Chrome spells it (${ru && ru.name})`);
  }

  // [FIX cold-start-gl-limits] The numeric GL limits belong to the machine, so they ride
  // in dyn/dev/<id>.js next to the two UNMASKED strings. Before this they arrived only
  // with the full profile, and for that window getParameter answered from the real
  // driver while UNMASKED_RENDERER already named the spoofed card.
  {
    const boot = read('dyn/boot.js');
    const inj = read('profile-injector.js');
    assert(/glParams: gpu\.webglParams \|\| \{\}/.test(read('tools/gen-dyn.mjs')),
      'the generator ships webglParams with the machine');
    assert(/glParams: dev\.glParams/.test(boot), 'boot.js forwards them');
    assert(/p\.webglParams = pd\.glParams/.test(inj), 'profile-injector applies them to an existing profile');
    assert(/webglParams: glParams/.test(inj), 'and to the cold-start one');
    for (const k of ['gpuVendor', 'gpuArch', 'gpuDevice', 'gpuDesc']) {
      assert(boot.includes(k) && inj.includes(k), `WebGPU adapter field ${k} travels the cold-start channel`);
    }
    const devFile = read('dyn/dev/pc_gaming.js');
    assert(/"glParams":\{"3379":\d+/.test(devFile), 'a generated machine file really carries the limit table');
  }

  // [FIX cold-start-machine-remainder] Three tables are written out in BOTH background.js
  // (buildProfile) and profile-injector.js (the cold-start profile), because the MAIN
  // world cannot importScripts — the same constraint that forces mw-core.js to keep its
  // own copy of AFP_DEFAULT_FEATURES. Compared here so the duplication is guarded rather
  // than trusted: a font added on one side and not the other is a page whose font list
  // changes on reload, which is worse than either list alone.
  {
    const inj = read('profile-injector.js');
    const table = (src, re) => {
      try { return new Function('return ' + balanced(src, re, '[', ']'))(); }
      catch (e) { return { error: e.message }; }
    };
    const pairs = [
      // buildProfile reads `allowedFonts: isHost ? null : [ … ]` since host mode; the
      // balanced() walk starts at the first '[' after the match either way.
      ['allowedFonts', /allowedFonts: (?:isHost \? null : )?\[/, /var WIN_FONTS = \[/],
      ['plugins', /plugins: \[\s+\{ name: 'PDF Viewer'/, /var PDF_PLUGINS = \[/],
      ['mimeTypes', /mimeTypes: \[\s+\{ type: 'application\/pdf'/, /var PDF_MIME_TYPES = \[/]
    ];
    for (const [name, bgRe, injRe] of pairs) {
      const a = table(bg, bgRe);
      const b = table(inj, injRe);
      assert(Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b),
        `${name}: buildProfile and the cold-start profile carry the same table` +
        (Array.isArray(a) ? ` (${a.length} entries)` : ` — ${JSON.stringify(a)} / ${JSON.stringify(b)}`));
    }
    assert(/connection: \{ effectiveType: '4g', downlink: 10, rtt: 50, saveData: false \}/.test(bg) &&
           /connection: \{ effectiveType: '4g', downlink: 10, rtt: 50, saveData: false \}/.test(inj),
      'connection: both sides describe the same link');
  }

  // [FIX feature-flags-arrived-three-hops-late] 'v.ui.f' has three writers on purpose —
  // whichever path reaches a tab first should be enough, the way 'v.ui.m' has always
  // worked. What must NOT happen is three private encodings: a bit order that differs
  // between writers would make the flags mean different things depending on which one won
  // the race, which is worse than the late delivery this fixed.
  {
    const sb = read('storage-bridge.js');
    const core = read('mw/mw-core.js');
    const man = JSON.parse(read('manifest.json'));
    const iso = (man.content_scripts || []).find((c) => c.world === 'ISOLATED') || {};
    const js = iso.js || [];
    assert(js.indexOf('defaults.js') !== -1 && js.indexOf('defaults.js') < js.indexOf('storage-bridge.js'),
      'defaults.js is loaded into the ISOLATED world before storage-bridge.js');
    assert(/function afpPackFeatures/.test(read('defaults.js')),
      'defaults.js owns the shared feature packing');
    assert(/afpPersistSelection\(sessionStorage, mode, features\)/.test(sb),
      'storage-bridge writes both keys through the shared writer');
    assert(/afpPackedIfNotDefault\(profile\.features\)/.test(bg),
      'background decides the same thing in the worker and passes the answer in');
    // mw-core cannot importScripts, so it re-implements the encoding; the bit order it
    // uses is Object.keys of its own defaults literal, which test-defaults.cjs already
    // pins to the defaults.js one, key for key.
    assert(/_FEAT_KEYS = Object\.keys\(d\)/.test(core), 'mw-core derives the bit order from its defaults literal');
    assert(/bits\.toString\(36\)/.test(core) && /bits\.toString\(36\)/.test(read('defaults.js')),
      'both encodings are the same base-36 bitmask');
    const writers = [
      ['storage-bridge.js', sb], ['background.js', bg], ['mw/mw-core.js', core]
    ].filter(([, src]) => /setItem\('v\.ui\.f'|afpPersistSelection\(/.test(src)).map(([n]) => n);
    assert(writers.length === 3, `all three writers set v.ui.f (found: ${writers.join(', ') || 'none'})`);

    // [FIX default-config-still-left-two-keys] Every writer must be able to REMOVE, not
    // only set. A clean Chrome has an empty sessionStorage on a fresh origin (measured,
    // extension off: zero keys), so a key repeating the default is a free detector — and
    // sessionStorage outlives an Apply, so a user who turns a flag off and back on would
    // keep a stale key for the rest of the session if the writers could only ever set.
    assert(/removeItem\('v\.ui\.f'\)/.test(bg) && /removeItem\('v\.ui\.m'\)/.test(bg),
      'background removes both keys when they carry the default');
    assert(/removeItem\('v\.ui\.f'\)/.test(core) && /removeItem\('v\.ui\.m'\)/.test(core),
      'mw-core removes both keys when they carry the default');
    assert(/store\.removeItem\('v\.ui\.f'\)/.test(read('defaults.js')) &&
           /store\.removeItem\('v\.ui\.m'\)/.test(read('defaults.js')),
      'the shared writer removes both keys when they carry the default');
    assert(/_FEAT_DEFAULTS/.test(core),
      'mw-core compares against the untouched defaults, not the resolved _FEAT');
  }

  // ── the MAIN-world bundle ───────────────────────────────────────────────────────
  // [FIX one-console-error-per-file-per-sandboxed-frame] The manifest names ONE MAIN file
  // now. Chrome prints a console error per BLOCKED SCRIPT in every frame that is sandboxed
  // without allow-scripts, and we deliberately reach every frame we can — so the count of
  // registered files was being paid, per frame, in every visitor's console. Measured on a
  // page with five such frames and no scripts of its own: clean 0, this build 78 before,
  // 48 after. On real sites: youtube.com 27 against 1 clean, stackoverflow.com 31 against 3.
  //
  // The modules stay on disk and stay the source of truth — dev-*.html still loads them
  // one by one, so the browser suite exercises the UNBUNDLED path while the nine
  // real-extension suites exercise the bundle. What has to be guarded is drift: a module
  // edited without re-running the generator would ship stale code while every test that
  // reads the sources still passed. Same guarantee dyn/ already has, same mechanism.
  {
    const { generate: generateBundle, MAIN_MODULES, BUNDLE_PATH } =
      await import('../tools/gen-bundle.mjs');
    assert(fs.existsSync(path.join(root, BUNDLE_PATH)), `${BUNDLE_PATH} exists`);
    assert(read(BUNDLE_PATH) === generateBundle(),
      `${BUNDLE_PATH} matches its modules — run: node tools/gen-bundle.mjs`);
    // A new module that nobody adds to the list would simply never run in the shipped
    // extension, and every source-reading test would still be green.
    const onDisk = fs.readdirSync(path.join(root, 'mw')).filter((n) => n.endsWith('.js'))
      .map((n) => `mw/${n}`);
    const missing = onDisk.filter((f) => MAIN_MODULES.indexOf(f) === -1);
    assert(missing.length === 0, `every mw/*.js is in the bundle — missing: ${missing.join(', ')}`);
    assert(MAIN_MODULES[MAIN_MODULES.length - 1] === 'mw/mw-cleanup.js',
      'mw-cleanup.js is last — it deletes the window markers the modules ahead of it hand each other');
    assert(MAIN_MODULES.indexOf('mw/mw-core.js') > MAIN_MODULES.indexOf('profile-injector.js'),
      'profile-injector runs before mw-core — it hands over the profile baton');
    const mainEntry = (man.content_scripts || []).find((c) => c.world === 'MAIN') || {};
    assert(JSON.stringify(mainEntry.js) === JSON.stringify([BUNDLE_PATH]),
      `the MAIN content_scripts entry names only ${BUNDLE_PATH}`);
    // Two IIFEs joined by a newline alone parse as a CALL of the first one's result. The
    // byte-comparison above already covers it, but the failure is silent and total (the
    // whole bundle dies at load), so it gets its own line.
    const seams = (read(BUNDLE_PATH).match(/\n;\n/g) || []).length;
    assert(seams === MAIN_MODULES.length - 1,
      `every seam carries a semicolon — found ${seams}, want ${MAIN_MODULES.length - 1}`);
  }

  // ── globals a clean browser does not have ───────────────────────────────────────
  // [FIX seven-adblock-globals-a-clean-browser-does-not-have] mw-adblock.js used to define
  // adblock / AdBlock / adBlock / uBlock / ublock / fuckAdBlock / blockAdBlock on window as
  // masked accessors returning undefined. A property that does not exist ALREADY reads as
  // undefined, so they answered nothing new — while `'fuckAdBlock' in window` became true,
  // which is false in every real browser, and the site's own anti-adblock library could no
  // longer publish its global because the setter swallowed it.
  //
  // Measured, own-property names of window against a clean Chromium on the same rig:
  //   before  clean 1237, ours 1246   (+ the seven, + __t0/__p0)
  //   after   clean 1237, ours 1239   (only __t0/__p0, both documented)
  {
    const ab = read('mw/mw-adblock.js').replace(/\/\/[^\n]*/g, '');
    for (const name of ['fuckAdBlock', 'blockAdBlock', 'uBlock', 'AdBlock']) {
      assert(!new RegExp(`['"]${name}['"]`).test(ab),
        `mw-adblock does not define a window.${name} a clean browser lacks`);
    }
    assert(!/Object\.defineProperty\(window,\s*name/.test(ab),
      'mw-adblock defines no window property from a name list');
  }

  // ── display traits the headless rig cannot exercise ─────────────────────────────
  // [FIX avail-origin-and-second-monitor-were-never-touched] availLeft, availTop and
  // isExtended are the physical machine and survive every profile change: the taskbar edge,
  // a negative availLeft when a second display sits to the left, and one bit for "this box
  // has more than one monitor". Found by widening test/hostleak.mjs to the display traits it
  // never measured.
  //
  // This is pinned STATICALLY because a headless browser already answers 0 / 0 / false, so
  // _defIfDiff installs nothing there and a green behavioural run proves nothing either way
  // — the same trap [FIX headless-ignores-font-settings] documents for chrome.fontSettings.
  // What can be checked here is that the code is present, guarded, and pins the values the
  // avail* block beside it already implies.
  {
    const scr = read('mw/mw-timezone-screen.js');
    for (const [prop, val] of [['availLeft', '0'], ['availTop', '0'], ['isExtended', 'false']]) {
      assert(new RegExp(`'${prop}' in screen`).test(scr),
        `screen.${prop} is only touched when the browser actually has it`);
      assert(new RegExp(`_defIfDiff\\(screen, '${prop}', function \\(\\) \\{ return ${val}; \\}\\)`).test(scr),
        `screen.${prop} is pinned to ${val}, and only when it differs`);
    }
    // The coherence argument, kept honest: we claim a work area as wide as the screen, so
    // the origin has to be the top-left corner. If availWidth ever stops tracking
    // screen.width, this pair needs rethinking rather than keeping.
    assert(/availWidth', function\(\) \{ return ID\.screenWidth; \}/.test(scr),
      'availWidth still equals the declared screen width — what makes availLeft 0 coherent');
  }

  // ── what a page can read out of web storage ─────────────────────────────────────
  // [FIX status-was-a-page-readable-key] / [FIX seed-was-a-named-page-readable-key]
  //
  // Measured with the extension loaded for real, at the page's FIRST inline script, with a
  // no-extension control on the same rig:
  //
  //   ON    afp_noise_seed_fallback=2901981054
  //         v.ui.t={"canvas":true,"webgl":true,"tz":true,…}
  //         v.ui.m=normal   (+ v.ui.f later)
  //   OFF   []                                    <- zero keys
  //
  // Two of those were worse than a name: the seed makes the positional canvas noise
  // analytically invertible, and the status set named every module that was running. Both
  // are gone — the status to a non-enumerable window property, the seed to dyn/ns/*.js —
  // and the remaining two are written only when they are not the default.
  //
  // This is a NAME check on purpose. test/coldstart.mjs already scans storage VALUES for a
  // profile-shaped regex; that is a different question ("is the whole machine readable")
  // and it answered "no leaks" while all four keys were sitting there, because a bare
  // number and {"canvas":true,…} match none of its patterns.
  {
    const storageWriters = ['background.js', 'storage-bridge.js', 'profile-injector.js',
      'popup.js', 'defaults.js', 'dyn/boot.js', 'seed-lib.js',
      ...fs.readdirSync(path.join(root, 'mw')).map((n) => `mw/${n}`)];
    for (const f of storageWriters) {
      const src = read(f);
      assert(!/afp_noise_seed_fallback/.test(src.replace(/\/\/[^\n]*/g, '')),
        `${f} does not carry the noise seed in web storage`);
      assert(!/(session|local)Storage\.setItem\(\s*'v\.ui\.t'/.test(src),
        `${f} does not write the status set to web storage`);
    }
    // The replacement is the same shape as __w0/__p0: non-enumerable, no "afp" in the
    // name, and read by the one consumer that needs it — popup.js, whose probe already
    // runs in the page realm and already reads window.__w0/__w1 in the same call.
    assert(/Object\.defineProperty\(window, '__t0'/.test(read('mw/mw-core.js')),
      'mw-core publishes the status set as a non-enumerable window property');
    assert(/window\.__t0/.test(read('popup.js')), 'the popup reads it from there');
    assert(!/sessionStorage/.test(read('popup.js').replace(/\/\/[^\n]*/g, '')),
      'and no longer from sessionStorage');
  }

  // ── the master noise seed travels as file names ─────────────────────────────────
  // [FIX seed-was-a-named-page-readable-key] Sixteen one-digit files; background.js
  // registers the eight that spell the master seed. That puts it in a MAIN-world
  // document_start script — before the page's first line, and earlier than the async
  // storage read it replaced — so the FIRST seed mw-core resolves is already the
  // authoritative one. Measured before this change: one page load, two canvas hashes
  // (early 1169538152, late 222371209); the same page with the extension off gave one
  // number twice.
  {
    const boot = read('dyn/boot.js');
    // [FIX repeated-nibble-collapsed-the-seed] 128 files, not 16: the POSITION is part of
    // the name. One file per digit meant a seed repeating a digit named the same path twice
    // in one registration, Chrome ran it once, and seven digits arrived — measured, a flip
    // in 3 of 3 tabs with master 178f44ad and none with 90e31a5c. Only ~12% of seeds have
    // eight distinct hex digits, so the version that passed was the unlucky-to-catch one.
    for (let pos = 0; pos < 8; pos++) {
      for (const n of '0123456789abcdef') {
        assert(fs.existsSync(path.join(root, `dyn/ns/${pos}${n}.js`)), `dyn/ns/${pos}${n}.js exists`);
      }
    }
    assert(/dyn\/ns\/\$\{i\}\$\{c\}\.js/.test(bg),
      'background spells the seed with them, position first — a bare digit would collapse on a repeat');
    assert(/\(\[0-7\]\[0-9a-f\]\)\{8\}/.test(boot),
      'boot.js requires all eight <position><digit> pairs');
    assert(/toString\(16\)\.padStart\(8, '0'\)/.test(bg), 'eight hex digits, most significant first');
    assert(/'dyn\/seedlib\.js'/.test(bg), 'and registers the generated derivation alongside');
    assert(/__AFP_BOOT_NS__/.test(boot) && /__AFP_BOOT_SL__/.test(boot),
      'boot.js reads both markers');
    assert(/delete self\.__AFP_BOOT_NS__/.test(boot) && /delete self\.__AFP_BOOT_SL__/.test(boot),
      'and deletes them, like every other boot marker');
    assert(/noiseSeed: \(typeof noiseSeed === 'number'\) \? noiseSeed : undefined/.test(boot),
      'boot.js publishes the derived seed in the ui:ready detail');
    // The generated copy is what makes one derivation possible in three worlds. It must be
    // seed-lib.js verbatim apart from the wrapper — the generator check above already fails
    // on any byte of drift, this states WHY the copy is allowed to exist.
    const seedlib = read('dyn/seedlib.js');
    assert(/function deriveDomainSeed/.test(seedlib) && /function afpEffectiveHostname/.test(seedlib),
      'dyn/seedlib.js carries the same two functions');
    assert(/^\/\/ Generated by tools\/gen-dyn\.mjs/.test(seedlib), 'and is generated, not hand-kept');
  }
}

// ── Copies that had no guard at all ─────────────────────────────────────────────
// Everything compared above is duplicated for a stated reason — a service worker, an
// ISOLATED content script and the MAIN world cannot share a module — and each pair is
// checked so the duplication is guarded rather than trusted. The three below are the same
// kind of copy and were the ones nothing compared: all three happened to be in step when
// this was written, which is exactly when a guard is cheap to add and worth nothing later.
/** An array literal, evaluated. */
const list = (src, re) => {
  try { return new Function('return ' + balanced(src, re, '[', ']'))(); }
  catch (e) { return { error: e.message }; }
};
{
  const sb = read('storage-bridge.js');
  const core = read('mw/mw-core.js');

  /** A function's source with comments and whitespace normalised away. */
  const fnBody = (src, name) => {
    const i = src.indexOf('function ' + name + '(');
    if (i < 0) return null;
    const b = src.indexOf('{', i);
    let d = 0, j = b;
    for (; j < src.length; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}') { d--; if (!d) break; }
    }
    if (d !== 0) return null;
    return src.slice(i, j + 1)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // 1. The per-domain seed derivation. background.js needs it for the injected profile and
  // the WASM argument; storage-bridge.js needs it in every frame for the sessionStorage
  // fallback. mw-core HARD-LOCKS the first seed a page resolves, so a single hostname the
  // two answer differently makes the window and a worker draw one canvas with two seeds —
  // the failure [FIX seed-computed-twice] and [FIX provisional-seed-was-locked-forever]
  // both describe.
  //
  // This was two verbatim copies, and the assertion here compared them character for
  // character. seed-lib.js replaced them with one file both contexts load, so what is
  // checked now is that the copies have not come BACK: a local `function
  // registrableDomain` in either file would shadow the shared one silently, and the
  // symptom — one wrong public suffix — is invisible until a canvas hash splits.
  {
    const lib = read('seed-lib.js');
    for (const name of ['registrableDomain', 'deriveDomainSeed']) {
      assert(!!fnBody(lib, name), `seed-lib.js declares ${name}()`);
      for (const [label, src] of [['background.js', bg], ['storage-bridge.js', sb]]) {
        assert(!fnBody(src, name), `${label} does not redeclare ${name}() — it loads seed-lib.js`);
      }
    }
    // Both load paths, asserted where they are written: importScripts shares the service
    // worker's global scope, and the manifest entry has to put the library BEFORE the file
    // that calls it, exactly as it already does for defaults.js.
    assert(/importScripts\('defaults\.js', 'seed-lib\.js'\);/.test(bg),
      'background.js imports seed-lib.js alongside defaults.js');
    const iso = (JSON.parse(read('manifest.json')).content_scripts || [])
      .find((c) => c.world === 'ISOLATED') || {};
    const js = iso.js || [];
    assert(js.indexOf('seed-lib.js') !== -1 && js.indexOf('seed-lib.js') < js.indexOf('storage-bridge.js'),
      'seed-lib.js is loaded into the ISOLATED world before storage-bridge.js');
  }

  // 2. _BASE_FONTS. mw-core owns it and publishes it on __AFP_MW__, but mw-workers.js has
  // to snapshot it at load (mw-cleanup.js deletes the registry before any page can build a
  // worker) and carries a literal fallback for the case where the registry is missing. That
  // fallback is what a worker measures fonts against, so if it drifts the window and the
  // worker disagree about which families are installed — the exact split
  // [FIX worker-fonts-window-only] was about.
  {
    const a = list(core, /var _BASE_FONTS = \[/);
    const b = list(read('mw/mw-workers.js'), /return \['arial', ?'arial black'/);
    assert(Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b),
      `_BASE_FONTS: mw-core and the mw-workers fallback carry the same list` +
      (Array.isArray(a) ? ` (${a.length} names)` : ` — ${JSON.stringify(a)} / ${JSON.stringify(b)}`));
  }

  // 3. The Windows font list has THREE copies, not two. The pair above compares
  // background.js against profile-injector.js; mw-core's _DEFAULT_PROFILE holds a third,
  // which is what every mw/*.js module falls back to through the ID proxy when no profile
  // has arrived. A family present in one and missing from another is a page whose font list
  // changes as the profile lands.
  {
    const a = list(bg, /allowedFonts: (?:isHost \? null : )?\[/);
    const b = list(core, /allowedFonts: \[/);
    assert(Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b),
      `allowedFonts: buildProfile and mw-core _DEFAULT_PROFILE carry the same table` +
      (Array.isArray(a) ? ` (${a.length} entries)` : ` — ${JSON.stringify(a)} / ${JSON.stringify(b)}`));
  }

  // 4. The Chrome-major fallback. Five files answer "which Chrome are we" when the host UA
  // carries no Chrome/<n>, and mw-core said 148 while the other four said 151 — the window
  // would have claimed one browser while the DNR header, the worker payload and the cold
  // start claimed another. Asserted as a set of one rather than against a fixed number, so
  // bumping the version stays a single edit that either lands everywhere or fails here.
  {
    const sources = {
      'background.js': /return '(\d+)';\s*\n?\s*}\s*\n+\s*const DEFAULT_PROFILE/,
      'mw/mw-core.js': /var _cv = '(\d+)'/,
      'mw/mw-navigator.js': /return '(\d+)';\s*\n\s*}\s*\n\s*function _plainBrands/,
      'profile-injector.js': /var cv = m \? m\[1\] : '(\d+)'/
    };
    const found = {};
    for (const [file, re] of Object.entries(sources)) {
      const m = re.exec(file === 'background.js' ? bg : read(file));
      found[file] = m ? m[1] : 'NOT FOUND';
    }
    const distinct = [...new Set(Object.values(found))];
    assert(distinct.length === 1 && distinct[0] !== 'NOT FOUND',
      'Chrome-major fallback is one value across every file — ' +
      Object.entries(found).map(([f, v]) => `${f}:${v}`).join(', '));
  }
}

// The feature-flag key set has copies outside defaults.js that test-defaults.cjs does not
// see: the two dev pages that drive the per-flag realms build their own list, and a stale
// key there spends a realm toggling a flag nothing reads while reporting it, forever, as a
// checkbox with no effect — which the page classes as a NOTE, so nobody looks. 'audio' sat
// in both long after the flag went with the AudioContext noise.
{
  const keys = Object.keys(
    new Function('return ' + balanced(read('defaults.js'), /var AFP_DEFAULT_FEATURES = \{/, '{', '}'))()
  );
  for (const page of ['dev-perflag.html', 'dev-flagcase.html']) {
    const got = list(read(page), /const KEYS = \[/);
    assert(Array.isArray(got) && JSON.stringify(got) === JSON.stringify(keys),
      `${page}: KEYS is the AFP_DEFAULT_FEATURES key set` +
      (Array.isArray(got)
        ? ` — extra [${got.filter((k) => !keys.includes(k))}], missing [${keys.filter((k) => !got.includes(k))}]`
        : ''));
  }
}

// The four country tables are generated from data/countries.json. Nothing at runtime
// re-derives them, so a country edited in one table and not the others would ship exactly
// the split test/tables.mjs grew 1660 assertions to catch — Europe/Tallinn on the clock,
// en-US out of Intl, New York coordinates from geolocation, in one page. Those assertions
// stay: they check the DATA is coherent, this checks the FILES were regenerated from it.
{
  const stale = Object.entries(generateTables())
    .filter(([rel, body]) => read(rel) !== body)
    .map(([rel]) => rel);
  assert(stale.length === 0,
    'the country tables match data/countries.json' +
    (stale.length ? ` — stale: ${stale.join(', ')}; run: node tools/gen-tables.mjs` : ` (${Object.keys(countries()).length} countries)`));
}

// Every dev-*.html must be declared in test/run.mjs — either in CHECKS, where it is run, or
// in NOT_COVERED, where it is named as deliberately unrun. Fourteen were in neither: not
// executed, and not listed as unexecuted, so `all N checks passed` described a smaller suite
// than the directory held and nothing pointed at the gap. That is the same failure mode the
// header of run.mjs was written about — "a check skipped by accident looked exactly like a
// check that passed" — reappearing one level up, in the list instead of in a page.
{
  const runner = read('test/run.mjs');
  // Both lists, read as source: CHECKS is an array of bare strings, NOT_COVERED an array of
  // [name, why] pairs, so one scan for quoted dev-*.html names covers both. Anything the
  // runner MENTIONS is declared; the point is to catch files it never names at all.
  const declared = new Set((runner.match(/'(dev-[\w.-]+\.html)'/g) || []).map((s) => s.slice(1, -1)));
  const onDisk = fs.readdirSync(root).filter((f) => /^dev-.*\.html$/.test(f));
  const undeclared = onDisk.filter((f) => !declared.has(f));
  assert(undeclared.length === 0,
    'every dev-*.html is declared in test/run.mjs (CHECKS or NOT_COVERED)' +
    (undeclared.length ? ` — missing: ${undeclared.join(', ')}` : ` (${onDisk.length} pages)`));
  // And nothing is listed that no longer exists: a renamed page left in CHECKS makes the
  // runner report a permanent failure for a file it cannot load.
  const ghosts = [...declared].filter((f) => !fs.existsSync(path.join(root, f)));
  assert(ghosts.length === 0,
    'test/run.mjs lists no dev page that has been deleted' + (ghosts.length ? ` — ${ghosts.join(', ')}` : ''));
}

// mw-adblock.js decides "is this bait blocked?" from getBoundingClientRect().width/height.
// mw-misc.js loads BEFORE it and, when the clientRects feature is on, adds ±0.001px noise
// to the DOMRect accessors — so a blocked bait can report width ~0.001 instead of a hard 0.
// A bare `=== 0` there misses it and the mask silently does not fire. See
// [FIX adblock-zero-check-vs-clientrects-noise]. The mask must therefore test "effectively
// zero", and this pins that so the tolerant check cannot be quietly reverted to `=== 0`.
{
  const adblock = read('mw/mw-adblock.js');
  // 1) A near-zero helper exists and is what the rect checks go through.
  assert(/function _nearZero\(/.test(adblock),
    'mw-adblock defines a _nearZero tolerance helper for blocked-size detection');
  // 2) The getBoundingClientRect bait check uses it, not an exact === 0 on width/height.
  assert(/_nearZero\(r\.width\)\s*\|\|\s*_nearZero\(r\.height\)/.test(adblock),
    'the getBoundingClientRect bait check is epsilon-tolerant (_nearZero on width/height)');
  // 3) No bare `.width === 0` / `.height === 0` on a rect survives anywhere in the file —
  //    that exact comparison is the reintroduction this guards against.
  assert(!/\br\.(?:width|height)\s*===\s*0\b/.test(adblock),
    'mw-adblock has no bare `r.width === 0` / `r.height === 0` (would miss noised zeros)');
  // 4) _baitRect must not let a noised near-zero width/height survive as a tell: it falls
  //    back to the bait size when the real read is effectively zero, via _nearZero.
  assert(/_nearZero\(r\.width\)\s*\?\s*300/.test(adblock) && /_nearZero\(r\.height\)\s*\?\s*250/.test(adblock),
    '_baitRect substitutes the bait size when width/height read effectively zero');
}

// ── Names Chrome reserves for itself ────────────────────────────────────────────
// A file whose name starts with an underscore, anywhere in the extension directory, fails
// the whole unpacked load — "Cannot load extension with file or directory name _x.
// Filenames starting with _ are reserved for use by the system." — and the browser reports
// it as a MANIFEST failure, which points at the wrong file entirely. It cost a load once,
// over a scratch runner sitting in the root (now tools/creep-webrtc.mjs). Chrome allows
// exactly three: _locales, _metadata, _platform_specific.
//
// node_modules is skipped: it is a dev dependency tree with no business in a packaged
// build, and scanning it here would only report offenders nobody can fix.
{
  const ALLOWED = new Set(['_locales', '_metadata', '_platform_specific']);
  const SKIP = new Set(['node_modules', '.git']);
  const bad = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const here = rel ? rel + '/' + e.name : e.name;
      // An allowed reserved name is Chrome's own territory, contents included: loading an
      // unpacked extension with a DNR ruleset makes the browser write
      // _metadata/generated_indexed_rulesets/_ruleset1 into this very directory. Flagging
      // what Chrome puts there would fail the suite over the browser doing its job.
      if (ALLOWED.has(e.name)) continue;
      if (e.name.startsWith('_')) bad.push(here);
      if (e.isDirectory()) walk(path.join(dir, e.name), here);
    }
  };
  walk(root, '');
  assert(bad.length === 0,
    'no file or directory name starts with an underscore (Chrome refuses the unpacked load)' +
    (bad.length ? ' — found ' + bad.join(', ') : ''));
}

// ── The default record IS laptop_mid ────────────────────────────────────────────
// [FIX default-record-had-no-dpr] initDefaults() stores AFP_DEFAULT_PROFILE as the record
// for laptop_mid, and dyn/dev/laptop_mid.js is generated from the popup's record for the
// same machine. Nothing tied the two together, and they drifted on exactly one field: the
// popup declared dpr 1.5, the default had no dpr at all, and buildProfile derives 1 from
// the width. One machine, two ratios, and which one a tab got depended on whether the
// background injection beat the cold start — measured as a different FingerprintJS
// visitorId on the first tab of a session.
{
  const { PROFILES: POPUP_PROFILES } = loadPopup(['PROFILES']);
  const mid = POPUP_PROFILES.find((p) => p.id === 'laptop_mid');
  assert(!!mid, 'popup declares a laptop_mid profile');
  const src = read('defaults.js');
  const m = /var AFP_DEFAULT_PROFILE = (\{[\s\S]*?\});/.exec(src);
  assert(!!m, 'AFP_DEFAULT_PROFILE literal located in defaults.js');
  if (m && mid) {
    const def = JSON.parse(m[1].replace(/([a-zA-Z_$][\w$]*):/g, '"$1":').replace(/'/g, '"').replace(/,\s*}/g, '}'));
    // gpuKey in the popup is written into storage as `gpu` — see handleApply in popup.js.
    const want = { screenW: mid.screenW, screenH: mid.screenH, dpr: mid.dpr,
                   cores: mid.cores, memory: mid.memory, gpu: mid.gpuKey, platform: mid.platform };
    for (const k of Object.keys(want)) {
      assert(def[k] === want[k],
        `AFP_DEFAULT_PROFILE.${k} equals popup laptop_mid.${k} (${JSON.stringify(def[k])} vs ${JSON.stringify(want[k])})`);
    }
  }
}

// ── AFP_PROFILE_DPR is popup PROFILES, resolved ─────────────────────────────────
// [FIX applying-a-profile-dropped-its-dpr] buildProfile looks the ratio up in this map when
// the stored record does not carry one, and dyn/dev/<id>.js is generated straight from the
// popup with the same rule. A map that drifts from the popup puts the two sources back into
// disagreement, which is the whole bug.
{
  const { PROFILES: PP } = loadPopup(['PROFILES']);
  const src = read('defaults.js');
  const m = /var AFP_PROFILE_DPR = (\{[\s\S]*?\});/.exec(src);
  assert(!!m, 'AFP_PROFILE_DPR literal located in defaults.js');
  if (m) {
    const map = JSON.parse(m[1].replace(/([a-zA-Z_$][\w$]*):/g, '"$1":').replace(/,\s*}/g, '}'));
    // The same resolution tools/gen-dyn.mjs applies: an explicit dpr wins, else 1. The
    // width-derived fallback was removed on all three sides — see
    // [FIX the-dpr-fallback-read-a-css-width-as-a-panel] in background.js afpResolveDpr.
    const dprOf = (p) => (typeof p.dpr === 'number' && isFinite(p.dpr) && p.dpr > 0) ? p.dpr : 1;
    assert(Object.keys(map).length === PP.length,
      `AFP_PROFILE_DPR covers every popup profile (${Object.keys(map).length} vs ${PP.length})`);
    for (const p of PP) {
      assert(map[p.id] === dprOf(p),
        `AFP_PROFILE_DPR.${p.id} matches the popup record (${map[p.id]} vs ${dprOf(p)})`);
    }
  }
}

// ── device state must not be re-derived in the page ──────────────────────────
//
// [FIX device-state-was-per-domain] Battery charge and physical position are properties of
// ONE machine, so they cannot be computed from `noiseSeed` — injectProfile() replaces that
// with the per-domain seed, and the same laptop then answered two origins with two charge
// levels and two positions 1.2 km apart (measured; see afpDeviceState in seed-lib.js).
// afpDeviceState resolves them from the MASTER seed instead, in the one file background.js
// and dyn/boot.js share, and the page-side modules only read the finished fields.
//
// This is a grep rather than a behavioural check because the failure is silent: re-deriving
// in the page produces perfectly plausible values, just different ones per site, and no
// single-origin test can see it. The battery formula in particular used to exist TWICE —
// mw-misc.js for the top document, mw-navigator.js for child frames — with nothing holding
// the copies together, which is how they were free to drift.
{
  const src = {
    'mw/mw-misc.js': read('mw/mw-misc.js'),
    'mw/mw-navigator.js': read('mw/mw-navigator.js'),
    'mw/mw-geo.js': read('mw/mw-geo.js'),
  };
  for (const [name, body] of Object.entries(src)) {
    assert(!/0\.62\s*\+\s*\(\s*s\s*%\s*33/.test(body),
      `${name}: no local battery-level formula (it belongs to afpDeviceState)`);
    assert(!/%\s*1000\s*\)\s*\/\s*1000/.test(body),
      `${name}: no local 1000-step geolocation jitter (coarsened and moved to afpDeviceState)`);
  }
  // The seed itself must not reach the geolocation surface any more. Comment lines are
  // stripped first: the fix is explained there, and the explanation names the field it
  // removed.
  const geoCode = src['mw/mw-geo.js'].split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert(!/noiseSeed/.test(geoCode),
    'mw-geo.js reads no seed — position comes from geoOffsetLat/Lon on the profile');
  for (const f of ['batteryLevel', 'batteryCharging', 'batteryChargingTime', 'batteryDischargingTime']) {
    assert(src['mw/mw-misc.js'].includes(f), `mw-misc.js reads ${f} from the profile`);
    assert(src['mw/mw-navigator.js'].includes(f), `mw-navigator.js reads ${f} from the profile`);
  }
  // Both battery consumers, and both producers, must agree that null means Infinity —
  // chrome.scripting.executeScript serialises its arguments as JSON, which has no Infinity.
  assert(/=== null/.test(src['mw/mw-misc.js']) && /=== null/.test(src['mw/mw-navigator.js']),
    'both battery readers map the null-on-the-wire back to Infinity');
  const seedlib = read('seed-lib.js');
  assert(/function afpDeviceState\(/.test(seedlib),
    'seed-lib.js defines afpDeviceState — the one producer both background.js and dyn/ use');
  assert(/var chargingTime = charging \?/.test(seedlib) &&
         /var dischargingTime = charging \?/.test(seedlib),
    'afpDeviceState derives both battery times from the charging flag, not per site');
}

// ── no global Error.prototype.stack filter, and the stack cleaners stay wired ─
//
// [FIX the-global-stack-filter-was-dead-code] mw-misc.js used to guard a stack filter on
// `Object.getOwnPropertyDescriptor(Error.prototype, 'stack')`, which is `undefined` in V8 —
// `stack` is an own accessor on each error INSTANCE. The block therefore never installed,
// in either mode, and two real leaks lived behind it until the probe list in
// test/stackleak.mjs was widened. The runtime assertions are there; these two are the
// static half, because the failure mode is code that looks like protection and is not.
{
  // Comment lines are stripped first: the removal note in mw-misc.js quotes the old guard
  // verbatim, which is the point of the note and would otherwise trip this check.
  const codeOnly = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const misc = codeOnly(read('mw/mw-misc.js'));
  assert(!/getOwnPropertyDescriptor\(\s*Error\.prototype\s*,\s*['"]stack['"]/.test(misc),
    'mw-misc.js installs no Error.prototype.stack filter (that descriptor is undefined in V8)');
  // The two cleaners that DO work must stay on the paths where the leaks were found.
  const workers = read('mw/mw-workers.js');
  assert(/catch \(eCtor\) \{ throw _stripFrames\(eCtor\); \}/.test(workers),
    'mw-workers.js strips its own frames from a failed Worker construction');
  const geo = read('mw/mw-geo.js');
  assert(!/setTimeout\(\s*function\s*\(\)\s*\{\s*try\s*\{\s*success\(/.test(geo),
    'mw-geo.js does not call the page callback from a closure of ours (that puts our frame on its stack)');
  assert(/setTimeout\(success, 20, makePos\(\)\)/.test(geo),
    'mw-geo.js hands the page callback straight to the scheduler');
}

// ── the shipped self-checks must not demand what the extension removed ───────
//
// [FIX self-check-demanded-the-stub-that-was-removed] afp-console-check.js and
// afp-full-console-check.js both asserted `chrome.runtime` was PRESENT, long after
// [FIX we-invented-a-chrome-runtime-...] deleted that stub from mw-core.js because real
// Chrome exposes app/csi/loadTimes and no runtime to an ordinary page. So they reported
// FAIL on a correct build and would have gone green on the signature they exist to catch.
//
// dev-consolechecks.html cannot catch this: it verifies these files LOAD, do not throw and
// emit rows — not that their assertions are right. That is deliberate (a probe may fail for
// environmental reasons in the rig), so the specific regression is pinned here instead.
{
  for (const f of ['afp-console-check.js', 'afp-full-console-check.js']) {
    const body = read(f);
    // The two positive forms these files used: `!!cr` and `!!(window.chrome && ...)`.
    // A negated assertion, and the `false` in a catch handler, are both fine.
    const bad = body.split('\n').filter((l) =>
      /\bok\(/.test(l) && /!!\s*\(?\s*(cr\b|window\.chrome)/.test(l));
    assert(bad.length === 0,
      `${f}: asserts chrome.runtime is ABSENT, as a real Chrome page has it` +
      (bad.length ? ` — found: ${bad[0].trim()}` : ''));
  }
  // [FIX parity-read-unmasked-without-enabling-the-extension] The UNMASKED_* enums answer
  // only where WEBGL_debug_renderer_info has been enabled; asking without it returns null
  // AND logs an INVALID_ENUM warning that Chrome attributes to mw-bundle.js, because our
  // getParameter wrapper is the caller. test/consolechecks.mjs catches this at runtime;
  // this is the version that runs in `npm test` with no browser. Both the window and the
  // worker half must enable it, and they must do it the same way — a parity probe whose
  // halves differ measures the halves.
  {
    const full = read('afp-full-console-check.js');
    const enables = (full.match(/getExtension\('WEBGL_debug_renderer_info'\)/g) || []).length;
    assert(enables >= 3,
      `afp-full-console-check.js enables WEBGL_debug_renderer_info everywhere it reads ` +
      `UNMASKED_* (found ${enables} call sites: the WEBGL section, the worker parity ` +
      `window side, and its worker side)`);
    assert(/if \(\(p === 0x9245 \|\| p === 0x9246\) && !dbg\) return 'n\/a';/.test(full),
      'afp-full-console-check.js skips the UNMASKED enums rather than requesting them disabled');
  }

  // [FIX worker-connection-was-half-patched] navigator.connection is substituted twice —
  // mw-navigator.js for the window, mw-workers.js inside the emitted worker payload — and
  // the two used to disagree: the worker set effectiveType only, leaving rtt and downlink
  // at the host's real numbers. One Worker construction showed 4g/50/10 in the window and
  // 4g/100/8.35 beside it. dev-wvw.html catches it at runtime; this is the version that
  // runs in `npm test` with no browser, and it pins the VALUES so the two cannot drift
  // apart again the way they did. Plain substring checks on purpose: the shapes are fixed
  // one-liners in both files, and a regex here would only add a way to be subtly wrong.
  {
    const nav = read('mw/mw-navigator.js');
    const wrk = read('mw/mw-workers.js');
    const want = [
      ['effectiveType', "'4g'"],
      ['downlink', '10'],
      ['rtt', '50'],
      ['saveData', 'false']
    ];
    for (const [prop, val] of want) {
      assert(nav.includes(`_def(proto, '${prop}',`),
        `mw-navigator.js still substitutes connection.${prop} for the window`);
      assert(wrk.includes(`_cdef('${prop}', function ${prop}() { return ${val}; })`),
        `mw-workers.js substitutes the SAME connection.${prop} = ${val} in the worker`);
    }
    assert(!wrk.includes("Object.defineProperty(c, 'effectiveType'"),
      'mw-workers.js defines connection properties on the PROTOTYPE, not the instance ' +
      '(a real NetworkInformation has no own properties — see [FIX instance-own-property-lies])');
  }
}

// ===== the install window cannot send the host =====
//
// [FIX the-install-window-sent-the-host-instead-of-the-profile] The strip-by-default rule
// used to exist only as a DYNAMIC rule, which does not exist during the seconds after the
// extension is installed, updated or reloaded — and in that window the host's real
// accept-language and sec-ch-ua-platform-version went out on the wire. It is in the STATIC
// ruleset now, which is live from extension load.
//
// The two lists must stay identical: a hint added to AFP_CH_HINTS and not to the static rule
// re-opens the window for exactly that header, silently, and no runtime suite can see it —
// the window is over before any of them measure anything.
{
  const staticRules = JSON.parse(read('rules/static.json'));
  // [FIX host-mode] The strip is in TWO static rulesets now: rules/static.json holds the
  // identity/locale group and stays on in every mode; rules/static-hw.json holds exactly
  // the hardware hints (AFP_HW_HINTS) and is disabled for host mode by afpSyncHwRuleset,
  // where the host's own build and device hints are the right answer. Together they must
  // still cover every managed hint, or the install window re-opens for the one left out.
  const hwRules = JSON.parse(read('rules/static-hw.json'));
  const { AFP_CH_HINTS, AFP_HW_HINTS } = loadBackground(['AFP_CH_HINTS', 'AFP_HW_HINTS']);
  const hdrs = staticRules[0].action.requestHeaders.concat(hwRules[0].action.requestHeaders);
  const removed = new Set(hdrs.filter((h) => h.operation === 'remove').map((h) => h.header));
  for (const hint of Object.keys(AFP_CH_HINTS)) {
    assert(removed.has(hint),
      `rules/static.json + rules/static-hw.json remove ${hint} by default, so the install ` +
      `window cannot send the host's own value for it`);
  }
  const hwRemoved = hwRules[0].action.requestHeaders.filter((h) => h.operation === 'remove').map((h) => h.header);
  assert(hwRemoved.slice().sort().join('|') === AFP_HW_HINTS.slice().sort().join('|'),
    `rules/static-hw.json removes exactly the hardware hints background.js lists as such ` +
    `(${hwRemoved.join(',')} vs ${AFP_HW_HINTS.join(',')}) — that file is the one host mode switches off`);
  for (const hint of AFP_HW_HINTS) {
    assert(!staticRules[0].action.requestHeaders.some((h) => h.header === hint),
      `${hint} is NOT also stripped by rules/static.json — otherwise switching the hardware ` +
      `ruleset off in host mode would change nothing`);
    assert(AFP_CH_HINTS[hint]({ hostHw: true, deviceMemory: 8, devicePixelRatio: 1,
      clientHints: { platformVersion: '15.0.0' } }) === null,
      `${hint} builds no per-origin rule in host mode`);
  }
  const manifest = JSON.parse(read('manifest.json'));
  const rulesets = (manifest.declarative_net_request || {}).rule_resources || [];
  assert(rulesets.some((r) => r.id === 'ruleset_static_hw' && r.path === 'rules/static-hw.json' && r.enabled === true),
    'the manifest ships rules/static-hw.json as ruleset_static_hw, enabled by default');
  assert(/AFP_HW_RULESET_ID = 'ruleset_static_hw'/.test(bg),
    'background.js toggles the ruleset the manifest names');
  assert(removed.has('accept-language'),
    'rules/static.json removes accept-language by default — the header that names a COUNTRY, ' +
    "and the one measured leaking the host's ru-RU while the profile claimed America/New_York");
  assert(staticRules[0].priority === 1,
    `the static strip stays at priority 1 (found ${staticRules[0].priority}) so the ` +
    `priority-2 dynamic rules still win once they exist — that is what makes stripping safe`);
  // And the dynamic strip is still there: the static one covers the window, the dynamic one
  // is what the runtime suites exercise, and neither is a reason to drop the other.
  assert(/id: AFP_HINT_STRIP_RULE_ID[\s\S]{0,200}?operation: 'remove'/.test(bg),
    'background.js still builds the dynamic strip rule as well');
}

// ===== the READMEs must not quote a number that has moved =====
// Both were wrong when this was written: README.txt announced 2.4.12 while manifest.json
// said 2.5.3, "twenty suites" while test/all.mjs runs 39, "234 files" while the packer
// writes 242. A version and a suite count can both be derived exactly, so they are pinned
// here; everything else in those files is deliberately approximate ("sixty-odd dev pages")
// rather than a number nobody re-checks.
{
  const all = read('test/all.mjs');
  const arrStart = all.indexOf('const SUITES = [');
  const arr = all.slice(arrStart, all.indexOf('];', arrStart));
  const nodeSuites = (arr.match(/\n {2}\[/g) || []).length;
  const browserSuites = (all.match(/SUITES\.push\(\[/g) || []).length;
  const version = JSON.parse(read('manifest.json')).version;
  const txt = read('README.txt'), md = read('README.md'), ru = read('README.ru.md');

  assert(txt.startsWith(`Fingerprint Shield ${version} — release package`),
    `README.txt announces the version in manifest.json (${version})`);
  assert(md.includes(`badge/version-${version}-`),
    `README.md's version badge is the one in manifest.json (${version})`);
  // Every screenshot the front pages reference must be there — a broken image is the first
  // thing a visitor sees. Both READMEs, because they carry DIFFERENT pictures: the English
  // page shows the English interface and the Russian page the Russian one.
  //
  // [FIX the-new-screenshot-showed-the-old-picture] And each carries ?v=<version>. GitHub
  // caches a README image by its URL, so replacing the bytes at the same path shows the OLD
  // picture to anyone whose browser or GitHub's own proxy still holds it — measured: the
  // blob on the remote was byte-for-byte the new one while the page kept drawing the
  // previous release's popup. The query moves with the version, so the URL does too, and it
  // is asserted rather than merely tolerated: a screenshot silently one release behind is
  // exactly the failure it exists to prevent.
  for (const [file, src] of [['README.md', md], ['README.ru.md', ru]]) {
    for (const m of src.matchAll(/<img src="([^"]+)"/g)) {
      const [img, query] = m[1].split('?');
      assert(fs.existsSync(path.join(root, img)), `${file} shows ${img}, which exists`);
      assert(query === `v=${version}`,
        `${file}'s ${img} is cache-busted with the current version (?${query || 'nothing'})`);
    }
  }
  assert(txt.includes(`the ${nodeSuites} Node suites`),
    `README.txt: the Node suite count is ${nodeSuites}`);
  assert(txt.includes(`the ${browserSuites} Playwright suites`),
    `README.txt: the Playwright suite count is ${browserSuites}`);
  assert(ru.includes(`${nodeSuites} узловых сьютов`),
    `README.ru.md: the Node suite count is ${nodeSuites}`);
  assert(ru.includes(`${browserSuites} браузерн`),
    `README.ru.md: the Playwright suite count is ${browserSuites}`);
  // The badge carries the same number inside a URL, which is an even easier place to
  // leave one behind than prose.
  assert(ru.includes(`badge/сьютов-${nodeSuites + browserSuites}-`) ||
    ru.includes(`badge/%D1%81%D1%8C%D1%8E%D1%82%D0%BE%D0%B2-${nodeSuites + browserSuites}-`),
    `README.ru.md's suite badge is ${nodeSuites + browserSuites}`);
  assert(ru.includes(`${nodeSuites + browserSuites} сьютов`),
    `README.ru.md: the total suite count is ${nodeSuites + browserSuites}`);
  // The front page links to files by name; a renamed one would leave a dead link on the
  // page every visitor lands on.
  for (const m of md.matchAll(/\]\(([^)#:]+\.(?:md|txt))\)/g)) {
    assert(fs.existsSync(path.join(root, m[1])), `README.md links to ${m[1]}, which exists`);
  }
}

// ===== the Trusted Types policy name is ONE function in two files =====
// [FIX csp-rewrite-for-workers] afpRewriteCsp adds the name to a site's `trusted-types`
// allowlist and afpCspRestrictsTrustedTypes treats a list carrying it as open; the name
// itself is what mw/mw-workers.js creates in _ttWrap and _ttEnsurePolicy. Two spellings
// would make the rewrite admit a policy the wrapper never creates.
// [FIX policy-name-was-a-signature] It was one LITERAL ('afp-blob-url', a signature any
// page could read through getPolicyNames); now it is afpTtPolicyName on the domain seed,
// in seed-lib.js for background.js and copied into the MAIN bundle — so the copy is pinned.
{
  const fnOf = (src, label) => {
    const m = src.match(/function afpTtPolicyName\(domainSeed\) \{[\s\S]*?\r?\n[ \t]*\}\r?\n/);
    assert(!!m, `${label} carries afpTtPolicyName`);
    return m ? m[0].split(/\r?\n/).map((l) => l.trim()).join('\n') : '';
  };
  const a = fnOf(read('seed-lib.js'), 'seed-lib.js');
  const b = fnOf(read('mw/mw-workers.js'), 'mw/mw-workers.js');
  assert(a && a === b, "mw-workers' afpTtPolicyName is seed-lib.js's, byte for byte (indentation aside)");
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(!/'afp-blob-url'/.test(strip(read('mw/mw-workers.js')) + strip(bg)),
    'the fixed name afp-blob-url is gone from the code (comments may keep the history)');
  // And the two CSP markers are registered from the same lists the observer writes.
  assert(/js: \['tte\.js'\]/.test(bg) && /js: \['noblob\.js'\]/.test(bg),
    'both document_start CSP markers (noblob.js, tte.js) are registered by background.js');
  // 'code:timeOrigin:route' since [FIX csp-restrictions-learned-per-route].
  assert(/sessionStorage\.setItem\('v\.ui\.tte', '1:' \+ tag\)/.test(read('tte.js')),
    'tte.js writes the flag _ttWouldRefuse reads, tagged with the document and its route');
}

// ===== the popup measures the host's GL limits under the enums the tables ship =====
// [FIX host-mode] The "this machine" record has to have the shape of every other machine
// record — the same 19 GL enums GPU_DATA carries — or the audit's claim column and the
// cold-start skeleton would describe a card with a different set of limits than the
// table rows do. The popup cannot import background.js, so it carries the list; this pins
// it to the table the list is a copy of.
{
  const { ANGLE_D3D11_PARAMS } = loadBackground(['ANGLE_D3D11_PARAMS']);
  const m = /const AFP_GL_PARAM_KEYS = \[([\s\S]*?)\];/.exec(read('popup.js'));
  assert(!!m, 'popup.js declares AFP_GL_PARAM_KEYS');
  if (m) {
    const popupKeys = m[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number).sort((a, b) => a - b);
    const tableKeys = Object.keys(ANGLE_D3D11_PARAMS).map(Number).sort((a, b) => a - b);
    assert(popupKeys.join(',') === tableKeys.join(','),
      `AFP_GL_PARAM_KEYS is exactly the enum set of ANGLE_D3D11_PARAMS (${popupKeys.length} vs ${tableKeys.length})`);
  }
}

// ===== the CPU performance tier lives in ONE function =====
//
// [FIX cpu-performance-tier-was-the-host-machine] navigator.cpuPerformance (Chrome 152)
// is answered in three places — the window and every same-origin frame in
// mw/mw-navigator.js, and the worker payload in mw/mw-workers.js — plus a fourth copy in
// afp-console-check.js, which is pasted into a page and cannot import. Three of them read
// MW.cpuTier; the fourth is a hand copy, exactly like the FEAT_DEFAULTS copy that
// test-defaults.cjs pins. The whole value of the tier is that those four agree, so the
// bodies are compared here rather than trusted.
//
// No rig can check this one at runtime: every browser the suite drives is older than the
// API, and branded Chrome refuses --load-extension, so nothing on this machine can run
// both the patch and the property. A static comparison is what is left.
{
  const core = read('mw/mw-core.js');
  const selfcheck = read('afp-console-check.js');
  const body = (src, name) => {
    try {
      return balanced(src, new RegExp('function ' + name + '[(]'), '{', '}')
        .replace(/\/\/[^\n]*/g, '')     // comments carry file-specific notes
        .replace(/\s+/g, ' ')
        .trim();
    } catch (e) { return null; }
  };
  const coreBody = body(core, '_cpuTier');
  const pageBody = body(selfcheck, 'afpCpuTier');
  assert(!!coreBody, 'mw-core.js defines _cpuTier');
  assert(!!pageBody, 'afp-console-check.js defines afpCpuTier');
  assert(!!coreBody && coreBody === pageBody,
    'the self-check\'s afpCpuTier is byte-for-byte mw-core.js _cpuTier ' +
    '(a drifted copy would report the wrong tier as a FAIL on a correct build)');
  assert(/cpuTier: _cpuTier/.test(core.slice(core.indexOf('__AFP_MW__'))),
    'mw-core.js publishes cpuTier on __AFP_MW__');
  assert((core.match(/cpuTier: _cpuTier/g) || []).length === 2,
    'both branches of the __AFP_MW__ export carry cpuTier (the fallback branch is what ' +
    'runs when defineProperty is refused)');
  assert(nav.includes('var _cpuTier = MW.cpuTier;'),
    'mw-navigator.js reads the tier from mw-core rather than carrying its own thresholds');
  assert(/__AFP_MW__ && window\.__AFP_MW__\.cpuTier/.test(workers),
    'mw-workers.js captures MW.cpuTier at load, like _prof');
  for (const [file, src] of [['mw/mw-navigator.js', nav], ['mw/mw-workers.js', workers]]) {
    assert(!/c >= 12 && m >= 16/.test(src),
      `${file} carries no second copy of the tier thresholds`);
  }
  // The property is only ever ATTACHED where the browser already has it. Inventing it on
  // Chrome 151 would be [FIX we-invented-a-chrome-runtime-real-chrome-does-not-have]
  // again, and the browsers this suite drives are all older than 152 — so a missing guard
  // would ship green.
  assert(/'cpuPerformance' in Navigator\.prototype/.test(nav),
    'mw-navigator.js patches the window tier only where Navigator.prototype has it');
  assert(/'cpuPerformance' in navProto/.test(nav),
    'mw-navigator.js patches a frame tier only where THAT frame\'s prototype has it');
  assert(/if\("cpuPerformance" in navigator\)_defIf/.test(workers),
    'the worker payload guards the tier on the property existing in that scope');
}

// ===== Chrome 152 OpaqueRange rects are marked for noise =====
//
// [FIX opaque-range-rects-were-never-noised] createValueRange hands back an OpaqueRange,
// which is neither an Element nor a Range, so it needed a third pair of markers next to
// the two the clientRects section already had. Same blind spot as the tier: no browser the
// suite drives has the class, so only a static check can hold it.
{
  const misc = read('mw/mw-misc.js');
  assert(/typeof OpaqueRange !== 'undefined'/.test(misc),
    'mw-misc.js guards the OpaqueRange patch on the class existing');
  assert(/OpaqueRange\.prototype\.getBoundingClientRect = _mn/.test(misc) &&
    /OpaqueRange\.prototype\.getClientRects = _mn/.test(misc),
    'BOTH OpaqueRange rect methods are wrapped (patching one is [FIX getclientrects-desync])');
  assert(/_markValueRect\(/.test(misc) && /_markValueRectList\(/.test(misc),
    'the OpaqueRange rects go through the ungated markers');
  assert(!/_markRect\(_origOGBCR/.test(misc),
    'the OpaqueRange rect does NOT go through _hasText — an <input> reports textContent ' +
    '\'\' whatever its value, so the gate would skip every one of these rects');
  assert(/OpaqueRange: 'readonly'/.test(read('eslint.config.js')),
    'OpaqueRange is declared for the linter (the guard\'s second half is a real reference)');
}

// ===== the limits are listed in both places, or in neither =====
//
// README "Limits" is the one list of what this extension knowingly does NOT close, and audit.html
// repeats it in short form — because a green verdict is read on that page, and a green
// verdict is only ever as broad as the list of questions asked. Two copies of a list is the
// same setup that let the media-parity trade drift (the block below this one), so the same
// treatment: they are held to the same length.
//
// Length and not content, deliberately. README "Limits" carries the argument for each limit in
// several paragraphs and audit.html carries one sentence; comparing the prose would either
// fail constantly or assert nothing. What actually goes wrong is a limit being added to one
// file and not the other, and a count catches exactly that.
//
// The numbered sections are the limits; the trailing "how to re-measure" section is not one,
// which is why the pattern is anchored on a digit.
{
  // The Limits list lives in the README now; its items are a numbered markdown list whose
  // entries open with a bold lead-in, which is what anchors the pattern.
  const readme = read('README.md');
  const from = readme.indexOf('\n## Limits\n');
  const limits = readme.slice(from + 1, readme.indexOf('\n## ', from + 1));
  const sections = limits.match(/^\d+\. \*\*/gm) || [];
  const page = read('audit.html');
  const bullets = (page.match(/<li>/g) || []).length;

  assert(sections.length >= 10,
    `README "Limits" still lists the limits rather than having quietly shrunk (${sections.length})`);
  assert(sections.length === bullets,
    `audit.html lists one bullet per README "Limits" section — ${sections.length} sections, ` +
    `${bullets} bullets. A limit added to one file and not the other is how the audit page ` +
    `starts reading broader than it is`);
  assert(/id="limits"/.test(page),
    'audit.html renders the known-limits list beside the verdict, not only in README "Limits"');
  assert(/README "Limits"/.test(page),
    "audit.html points at the Limits section of the README for the argument behind each line");

  // The numbering has to be a sequence, or "12 sections" stops meaning "12 limits".
  const nums = sections.map((s) => Number(s.match(/\d+/)[0]));
  for (let i = 0; i < nums.length; i++) {
    assert(nums[i] === i + 1,
      `README "Limits" section ${i + 1} is numbered ${nums[i]} — the list is counted, so it has ` +
      `to be a sequence`);
  }
}

// ===== the media-parity trade list is ONE judgement in two places =====
//
// [FIX three-copies-of-one-judgement] `@media` and matchMedia are one engine, so a
// disagreement between them is a signature rather than a wrong value — except for the few
// features where matchMedia answers from the profile and the CSS engine from the real
// window, which no extension can reach. That exception list was written out three times:
// in dev-mediaparity.html, in the `media` row of audit.js, and (for a different question —
// ours against a clean browser, not JS against CSS) in tools/probe-diff.mjs.
//
// Two of the three had already drifted. dev-mediaparity.html accepted the input family
// (hover / any-hover / pointer / any-pointer / update); audit.js did not. On the desktop
// both were measured on, mw-misc's forced answers happen to be the true ones and nothing
// diverges, so the gap was invisible — but audit.js runs in the USER's browser, and on a
// touchscreen it is eight disagreements at once, which dev-mediaparity.html reports as
// expected and audit.js would have reported to the user as a fault in their own build.
//
// The list lives in defaults.js now. dev-mediaparity.html READS it, because it loads its
// own scripts and can. audit.js CANNOT: its collector is serialised whole by
// chrome.scripting.executeScript and runs in the inspected tab's MAIN world, where nothing
// audit.html loads exists — the same bind as afpCpuTier two blocks up, and the reason a
// first attempt at a single source made that row throw a ReferenceError and report
// "(undefined)" while the page still rendered eighteen rows. So audit.js keeps a copy and
// this pins it, byte for byte.
{
  const shared = read('defaults.js');
  const decl = shared.match(/var AFP_MEDIA_PARITY_TRADE\s*=\s*\n?\s*(\/.*\/);/);
  assert(!!decl, 'defaults.js declares AFP_MEDIA_PARITY_TRADE — the media-parity trade list');

  // dev-mediaparity.html reads the shared name and loads the file that defines it.
  const dev = read('dev-mediaparity.html');
  assert(dev.includes('AFP_MEDIA_PARITY_TRADE.test('),
    'dev-mediaparity.html tests against the shared list rather than a copy');
  assert(/const MODULES = \['defaults\.js'/.test(dev),
    'dev-mediaparity.html loads defaults.js first among its modules, so the shared list exists');
  assert(!/const ACCEPTED = \//.test(dev),
    'dev-mediaparity.html no longer carries its own regex literal');

  // audit.js keeps a copy because it must, and the copy is the same literal.
  const auditCopy = read('audit.js').match(/const TRADE = (\/.*\/);/);
  assert(!!auditCopy, 'audit.js declares its pinned TRADE copy');
  assert(auditCopy && decl && auditCopy[1] === decl[1],
    'audit.js TRADE is byte-for-byte AFP_MEDIA_PARITY_TRADE from defaults.js — a drifted ' +
    'copy is how the user\'s own audit page reports a fault that is not there');

  // And the judgement itself, asserted on the literal rather than on where it lives. The
  // unprefixed spellings must stay OUT: Blink has no such media feature, a clean browser
  // answers false through both channels, and answering them from the profile was a wrong
  // answer to an invalid question — [FIX unprefixed-device-pixel-ratio-was-answered-at-all].
  // Both pages still ASK them, so this is what keeps the asking meaningful.
  const re = new RegExp(decl[1].slice(1, -1));
  for (const q of ['(device-pixel-ratio: 1)', '(min-device-pixel-ratio: 1.5)',
    '(max-device-pixel-ratio: 1.5)']) {
    assert(!re.test(q), `${q} is NOT a trade — Blink has no unprefixed device-pixel-ratio`);
  }
  for (const q of ['(-webkit-min-device-pixel-ratio: 1.5)', '(min-resolution: 1.5dppx)',
    '(device-width: 1920px)', '(pointer: fine)', '(hover: hover)', '(update: fast)',
    '(any-pointer: coarse)', '(any-hover: none)']) {
    assert(re.test(q), `${q} IS a trade — the profile answers it and the CSS engine cannot`);
  }
  for (const q of ['(prefers-color-scheme: dark)', '(forced-colors: active)',
    '(color-gamut: p3)', '(monochrome: 0)', '(orientation: landscape)',
    '(dynamic-range: high)', '(scripting: enabled)']) {
    assert(!re.test(q), `${q} is NOT a trade — a disagreement there is a real defect`);
  }
}

// ===== the noise seed is minted in exactly one place =====
//
// [FIX the-seed-was-minted-in-three-places] Every noised value derives from this one number,
// so a second mint changes the canvas, the WebGL readback, the text metrics and the battery
// at once, underneath a page that reads twice. Three writers did it — buildProfile off its
// own stale snapshot, initDefaults off a snapshot taken before it wrote the default profile,
// and the onChanged reseed firing on that very write because a creation looks like a change.
//
// THIS IS A STATIC CHECK BECAUSE THE RACE CANNOT BE TESTED AT RUNTIME. Whether a site sees
// the split depends on whether it read between two writes; the same tree measured 1-of-6,
// then 6-of-8, then 0-of-8 with no changes at all, because the frequency tracks machine load.
// A suite that reproduces it a fraction of the time cannot prove a fix either. What CAN be
// held is the shape that caused it: one minter, and a reseed that fires on a change rather
// than on a creation.
{
  const bg = read('background.js');
  const noComments = bg.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  // Every place that generates a random 32-bit value AND writes it to the seed key. The
  // deliberate reseed on a profile change is one of them and is expected; what must not come
  // back is a THIRD, or a second mint on the "does it exist yet" path.
  const mints = noComments.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /Math\.random\(\)\s*\*\s*0xFFFFFFFF/.test(l));
  assert(mints.length === 2,
    `background.js generates a seed in exactly two places — afpEnsureNoiseSeed and the ` +
    `deliberate reseed on a profile change (found ${mints.length}: lines ` +
    `${mints.map(([n]) => n).join(', ')})`);

  assert(/let _noiseSeedPromise = null;[\s\S]{0,80}async function afpEnsureNoiseSeed\(\)/.test(bg),
    'afpEnsureNoiseSeed is memoised at module scope, so concurrent callers inside one ' +
    'service worker share a single mint instead of racing');

  // Both former minters go through it now.
  assert(/noiseSeed = await afpEnsureNoiseSeed\(\)/.test(bg),
    'buildProfile takes its seed from afpEnsureNoiseSeed rather than minting its own');
  assert(/\[FIX early-noise-seed\][\s\S]{0,700}?await afpEnsureNoiseSeed\(\);/.test(bg),
    'initDefaults ensures the seed through the same function');
  assert(!/typeof cached\[NOISE_SEED_KEY\] !== 'number'/.test(noComments),
    'nothing decides whether to mint from a STALE snapshot any more — that test read ' +
    '`cached` from before initDefaults wrote the default profile, which is what made the ' +
    'second mint happen on every fresh install');

  // And the reseed distinguishes a change from a creation.
  assert(/changes\[k\] && changes\[k\]\.oldValue !== undefined/.test(noComments),
    'the profile-change reseed fires on a CHANGE (oldValue present) and not on the initial ' +
    'write of the profile, which a fresh install performs and which is not a machine change');
}

// ===== a ratchet against waiting by the clock =====
// [FIX ten-suites-bet-on-a-clock] Forty-eight suites waited a fixed 1500-4000ms for
// `initDefaults` to finish and then planted a fixture, which lands underneath the
// background's own write whenever the machine is slower than the guess. They wait for
// bootSettled() now — but 113 fixed sleeps remain elsewhere in test/, 55 of them a second or
// longer, and every one is the same bet waiting to be lost on a slower machine than this.
//
// They are not rewritten wholesale: each has its own reason and some are legitimately
// waiting for wall-clock behaviour. What must not happen is the number GROWING, which is
// how the forty-eight accumulated in the first place. A new one has to displace an old one,
// or come with a note explaining what it waits for that no condition can express.
//
// Lower the ceiling when you convert one. Never raise it.
// [FIX the-ceiling-counted-a-file-the-repository-does-not-have] The first version read the
// test/ DIRECTORY, which on this machine also holds test/fps-core.mjs — the successor
// browser project's instrument, listed in .gitignore, present in no clone. It carries one
// long sleep, so the count was 55 here and 54 in CI, and the ratchet failed on the first
// clean checkout it met. A ceiling has to be counted from something every checkout has.
//
// Counting only what test/all.mjs lists was the first fix and it was too narrow: it would
// have let sleeps grow freely in the suites that are run by hand. .gitignore already names
// what is not part of this repository, so it is read here — self-maintaining, and it keeps
// every suite under the ratchet rather than only the gated ones.
{
  const CEILING = 49;
  const ignored = new Set(read('.gitignore').split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('test/') && !l.includes('*'))
    .map((l) => l.slice(5)));
  const files = fs.readdirSync(path.join(root, 'test'))
    .filter((f) => f.endsWith('.mjs') && !ignored.has(f));
  const long = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, 'test', f), 'utf8');
    const n = (src.match(/setTimeout\(\s*r\s*,\s*\d{4,}\s*\)/g) || []).length;
    if (n) long.push([f, n]);
  }
  const total = long.reduce((a, [, n]) => a + n, 0);
  assert(total <= CEILING,
    `waits of a second or more in test/: ${total}, ceiling ${CEILING} — a new fixed sleep ` +
    'is a new bet that this machine is as fast as the next one. Wait for the value ' +
    '(bootSettled, waitForFunction) or lower the ceiling by converting an old one. ' +
    `Busiest: ${long.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, n]) => `${f}:${n}`).join(', ')}`);
  if (total < CEILING) {
    assert(false, `the clock-wait ceiling is stale: ${total} left, ceiling still ${CEILING} ` +
      '— lower it to lock the improvement in, or the next one silently spends the slack');
  }
}if (failed) {
  console.error('\n' + failed + ' assertion(s) failed');
  process.exit(1);
}
console.log('\nAll static parity assertions passed.');
