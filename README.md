<div align="center">

# Fingerprint Shield

**One coherent invented machine — the same one in the window, in every frame and in every worker.**

[![CI](https://github.com/N0deZ3r0/fingerprint-shield/actions/workflows/ci.yml/badge.svg)](https://github.com/N0deZ3r0/fingerprint-shield/actions/workflows/ci.yml)
![version](https://img.shields.io/badge/version-2.5.30-3b5bdb)
![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4c6ef5)
![suites](https://img.shields.io/badge/suites-58-2f9e44)
![runtime dependencies](https://img.shields.io/badge/runtime_dependencies-0-2f9e44)

**English** · [Русский](README.ru.md)

</div>

Coherence is the whole point. A site does not identify you by any single value; it
identifies you by values that agree. Claiming a 1366×768 screen while the layout proves the
window is wider, or answering `matchMedia` from a profile while the CSS engine answers from
the real display, does not hide a machine — it produces a machine that cannot exist, and
that is rarer than the one you started with.

Every fix here carries a measurement, and every suite compares the result against a clean
browser rather than against an assumption.

<div align="center">

<img src="docs/ui-whoami.png?v=2.5.30" width="100%" alt="The Who Am I page: fingerprint hash, platform, language and timezone, then the invented hardware, screen, GPU, canvas and WebRTC state, and the list of active modules">

<sub><b>Who Am I</b> — the machine as a site reads it. Every value on this page is the
claim, not the host, and the fingerprint hash at the top is what a tracker would key on.</sub>

</div>

## Install

Not in the Chrome Web Store — load it unpacked.

1. Download the zip from [Releases](https://github.com/N0deZ3r0/fingerprint-shield/releases/latest)
   and extract it. CI builds it from the commit the tag points at, and it contains the
   extension only: no dev pages, no suites, no generators.
2. Open `chrome://extensions/` and turn on **Developer mode**.
3. Click **Load unpacked** and point it at the extracted folder.

To run from source instead, point **Load unpacked** at a clone of this repository.

> The extension's interface follows your browser's language, in English or Russian. The
> audit page, this README and the code comments are in English only.

## What it looks like

<table>
<tr>
<td width="38%" valign="top" align="center">

<img src="docs/ui-popup.png?v=2.5.30" width="100%" alt="The extension popup: protection active, six of six modules, the exit country, per-site WebRTC, Service Worker and CSP switches, the normal or stealth mode selector and the device profile">

<sub>The popup: country, per-site switches, device profile.</sub>

</td>
<td width="62%" valign="top" align="center">

<img src="docs/ui-modules.png?v=2.5.30" width="100%" alt="The protection modules grid in the options page: Canvas, WebGL, WebRTC, Navigator, Screen, Timezone, Geolocation, Battery, Fonts, ClientRects, Plugins, Network and Hide AdBlock, each a checkbox with a one-line description">

<sub>Thirteen modules, switched one by one. `ClientRects` ships off — it is
the one that makes CreepJS go red.</sub>

</td>
</tr>
</table>

The interface is in English and Russian and follows the browser's own language — there is no
switch to set. A key missing from a catalogue leaves the text that is already there and says
so on the console, because `chrome.i18n.getMessage` answers an unknown key with an empty
string and writing that into the page would blank the control rather than fail.
`test/i18n.mjs` opens the browser twice, `--lang=en-US` and `--lang=ru`, and requires the two
renderings to differ — without that, a build ignoring the locale passes every other check by
showing one language twice.

## How it is verified

```bash
npm ci
npm test           # the 10 Node suites — seconds, no browser
npm run test:all   # adds the 48 Playwright suites — six to eight minutes
```

**58 suites** in total. The Node half runs on every push and every pull request; it includes
`test/parity-static.mjs`, which re-runs both generators in memory and fails if
`mw-bundle.js` or `dyn/` on disk are stale. The Playwright half loads the extension for real
in Chromium and is triggered manually, because its assertions are Windows facts — the ANGLE
renderer strings, the font list, `outerHeight - innerHeight`.

Two are worth naming. `clean vs ours` diffs a patched browser against an unpatched one and
fails on any difference nobody has judged. `timezones vs ICU` checks 941 timezone assertions
against the ICU that Node bundles, which is why the Node version is pinned.

The population reference in `tools/crowd-reference.json` is read off named public sources on
a named date — StatCounter for screen resolution, the Steam hardware survey for GPUs — with
each source's sampling bias written down beside it. Nothing there is interpolated or rounded
to taste. Where a number has no source, the tool prints a dash instead of guessing.

## Limits

What this extension knowingly does **not** close. The rule for being on this list: a site
can read it, and we know we cannot stop it — either the platform does not allow it, or
closing it would cost more than the leak. The item numbers are referenced from the code and
from the audit page, so they are not renumbered.

1. **The machine is 2.6 bits.** There are six table profiles. A site reading only hardware —
   screen, cores, memory, GPU — sees one of six machines.
2. **Audio and text metrics are the host's.** `OfflineAudioContext` computes on this
   machine's real audio stack. Text metrics are noised; audio is not.
3. **WebGL readback is noised, not controlled.** Noise is not substitution: a site holding a
   reference for this GPU sees "not that one", not "this other one".
4. **The GPU is spoofed at the string level.** `UNMASKED_RENDERER_WEBGL` and
   `GPUAdapterInfo` answer from the profile; anything actually computed on the card does not.
5. **A site's own service worker reads the real machine.** Measured on one page: 16 cores
   against 18, `Europe/Berlin` against `Europe/Moscow`.
6. **On a `trusted-types` origin the machine becomes the host's** — coherently. Creating a
   policy raises a violation that the browser builds in C++ from the real stack and names
   the extension in; JS cannot reach that.
7. **The screen becomes the host's when the window is wider than the claim.** A screen
   cannot be smaller than the window, and one `100vw` proves the lower bound.
8. **`@media` and `matchMedia` disagree on several features.** `matchMedia` answers from the
   profile; the CSS engine answers from the real window, and the CSS engine is out of reach.
   The pixel-ratio half is closed since 2.5.27 — a claimed dpr the engine disproves is
   refutable in two lines, so the ratio yields to the host as the screen does above.
9. **The install window.** For the first seconds after install or reload, dynamic DNR rules
   are not registered yet. The headers that leaked there — `accept-language`, which is a
   country — have been moved into the static ruleset and are now closed.
10. **A canvas read by an inline script during parse** gets the defaults, because the feature
    decision freezes on first use.
11. **Window geometry before the browser knows it.** In the first inline script
    `outerWidth`/`outerHeight` are `0`. We pass that `0` through, exactly as a clean browser does.
12. **Exit country is the one axis internal coherence cannot see.** Every suite asks whether
    the build contradicts itself. None can ask whether the claimed country matches the
    network the traffic actually leaves from.
13. **First visit to an origin that refuses blob workers.** Every worker this extension
    patches is built from a blob; an origin whose CSP bars `blob:` rejects that construction.
    A policy sent in a `<meta>` tag instead is read from the page itself and costs no worker;
    what is left there is the first load's early requests, whose headers still carry the profile.
14. **TLS and HTTP/2 are out of reach.** Cipher order, TLS extensions, ALPN, curves, the
    HTTP/2 SETTINGS frame — JA3/JA4 and the h2 fingerprint are formed before the page gets a
    byte, and Cloudflare and Akamai read them as a matter of course.
15. **The WebRTC decoder and codec list are the graphics card, not a table.**
    `decodingInfo()` answers `powerEfficient` from whether the real card has a hardware
    decoder; `getCapabilities('video')` lists `video/H265` only where the hardware does HEVC.
16. **A WebGL warning about an unknown constant names us.** Chrome attributes `INVALID_ENUM`
    to the nearest script frame, which is our wrapper.

17. **The marker names are fixed.** `'__t0' in window` answers yes for this build and no
    for a clean browser, in the top document and in frames, and `__AFP_PATCH_URL` is the
    worker’s equivalent. They are non-enumerable, so a name diff against a fresh iframe
    does not show them — but a constant anyone can guess once needs no diff. Deriving them
    per site is blocked by the markers being set before the seed exists and by the
    in-browser checks that read them. There were two names on the window until 2.5.27; the
    second is a field of the first now. Hiding either was measured as worse than owning one
    fewer — a clean window has zero own symbols, so a symbol key makes the count anomalous
    and `Symbol.keyFor` hands the name back, while hiding from enumeration alone makes
    reachable, listed and `in` disagree, which no browser does for any name.

18. **The Intl locale and `navigator.language` answer to different switches.** The language
    claim belongs to the navigator module; the window's Intl locale is installed under the
    timezone one. With navigator off the locale follows it back to the host, but the
    mirrored case is open: with the timezone module off no Intl wrapper is installed at all,
    so the window answers with the machine's locale while a worker answers with the
    profile's.

19. **The claimed core count is a number; parallelism is behaviour.**
    `navigator.hardwareConcurrency` answers with the profile while the machine still runs as
    many workers at once as it really has. An extension cannot refuse the ninth the way an
    eight-core processor would — the scheduler belongs to the engine.

20. **The claimed memory size is not backed either.** `navigator.deviceMemory` reports the
    profile's bucket while a page can allocate and watch for the bend that never comes. Same
    reason: the allocator belongs to the engine. Both of these are silent, need no
    permission, and are readable by any page that thinks to look.

21. **One `sessionStorage` key is visible.** The per-document Trusted Types verdict lives at
    `v.ui.tte`. It claims nothing about the machine — it decides who is named in a refusal —
    but on a fresh origin a clean browser has no keys at all, so `sessionStorage.length`
    reading 1 instead of 0 finds it without guessing the name. It stays because it has to
    survive navigation: a previous document's verdict for the same route is what keeps the
    proxies from installing on a repeat load.
22. **A wrapped property costs more to read than a native one, and they all cost the same.**
    By shape this extension is indistinguishable from a patched engine. Of 149 facts read in
    three browsers — a clean Chromium, a patched Chromium claiming the same machine, and this
    extension — 132 match in all three: descriptor shape, the getter's name, length and
    `toString`, what it does with a foreign receiver, own-key sets, redefinability. Timing is
    what separates them. Read natively these properties cost different amounts, because
    `deviceMemory` hands back a cached integer while `platform` builds a string; read through
    one JS closure the call is the whole cost and does not care which property it stands in
    front of, so 9 of the 12 substitutable `navigator`/`screen` properties land within 10% of
    each other, against 3 of 12 in either browser without wrappers. That needs no permission,
    no second browser and no reference measurement — a page computes it about itself in a few
    milliseconds. `Date.prototype.getHours` costs 88 times native. The price is the Proxy that
    makes `String(getter)` answer `[native code]`, and the one alternative to it measured far
    worse. Date is structurally worse still: a native `getHours` is an intrinsic the JIT
    hoists out of a loop, and a JavaScript function never will be. This is the boundary of
    wrapping in the page's own world rather than a defect in one wrapper.

23. **A `Critical-CH` retry on a brand-new origin goes out without the OS build.** A site asks
    for the high-entropy client hints in a response header, so the extension learns of the
    request only by observing that response, and only then can it write a DNR rule.
    `Critical-CH` makes Chrome reissue the request from its network stack 4-7 ms later —
    faster than any rule can be written, because MV3 has no blocking `webRequest` to sit in
    front of it. Measured on a new host: a clean browser's retry carries arch, bitness, model,
    wow64 and platform-version; ours carries the first four, native, because on a host that
    matches the claim the extension no longer touches them. Only
    `sec-ch-ua-platform-version` is absent, and the host's real build is never sent. The rest
    of the first visit is closed since 2.5.29: a new host's rules are written at once instead
    of after a 300 ms coalescing timer, which had made the whole first visit go out stripped.

The extension's own audit page carries the same list beside its verdict, because a green
verdict is only ever as broad as the questions asked.

## Re-measure it yourself

```bash
node tools/probe-diff.mjs     # what the build CHANGES against a clean browser
node tools/probe-time.mjs     # what changes over TIME and does not for a clean browser
node tools/probe-crowd.mjs    # the size of the crowd you land in
node tools/diff-metrics.mjs   # two machines: what differs between them
node test/hostleak.mjs        # host values that make it through
```

## Build

```bash
npm run build         # regenerates dyn/ and mw-bundle.js
node tools/pack.mjs   # builds dist/ — the extension only, 248 files
node tools/shots.mjs  # retakes the screenshots above from the running extension
```

`mw-bundle.js` is generated from the eleven modules in `mw/`. Edit the modules, not the
bundle; `npm test` fails if the bundle on disk is stale.

## Contributing

Bug reports and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Found a
security problem? [Report it privately](https://github.com/N0deZ3r0/fingerprint-shield/security/advisories/new)
rather than in a public issue.

## License

[MIT](LICENSE).
