Fingerprint Shield 2.5.26 — release package
==========================================

  This is the document that ships INSIDE the package: structure, CI, and the suites that
  are not part of `npm test`. The repository's front page is README.md.

Load in Chrome:
  chrome://extensions → Developer mode → Load unpacked → this folder

  ...or, for a copy without the workshop in it:
    node tools/pack.mjs        -> dist/, then Load unpacked -> dist
  This repository IS the extension, so the folder Chrome loads also holds sixty-odd dev
  pages, the suites, the generators and the ten mw/ modules the bundle was built from. None
  of that is needed to run it, and Chrome validates every file it finds in an extension
  directory. dist/ is the same extension with all of that left behind: about 240 files
  against the ~400 in the repository. `node tools/pack.mjs --check` verifies without writing and is part of
  `npm test`, so a file that stops shipping turns the suite red rather than an install.

Continuous integration (.github/workflows/ci.yml):
  node      lint + the 9 Node suites + the package check. Seconds, every push and PR.
            This is the one worth gating on: it includes test/parity-static.mjs, which
            re-runs both generators in memory, so a module edited without re-running
            tools/gen-bundle.mjs fails here instead of shipping.
  package   builds dist/ and uploads it as the run's artifact, so what you download from
            GitHub is the extension rather than the workshop. Expires after 90 days, and
            an artifact cannot be linked to - it is a download from a run page.
  release   the same dist/, zipped with manifest.json at the archive root and attached to
            a GitHub Release. Triggered by a tag whose name must match manifest.json:
              git tag v2.3.4 && git push origin v2.3.4
            A mismatched tag fails the job rather than publishing a zip whose version is a
            lie. Permanent, and the URL does not move:
              https://github.com/<owner>/<repo>/releases/download/v2.3.4/fingerprint-shield-2.3.4.zip
            NOTE: on a PRIVATE repository that URL still needs authentication. It works in
            a browser where you are signed in; curl needs a token; a stranger gets a 404.
            Only making the repository public turns it into a link anyone can follow.
  browser   the 45 Playwright suites, on a WINDOWS runner because that is what they
            measure. MANUAL ONLY (Run workflow): it takes six to eight minutes, private-repo
            Windows minutes bill at 2x, and the runner is a Server SKU whose font set
            differs from a desktop Windows 11 - so a first red run may mean the runner, not
            the code. Judge one manual run before letting it gate anything.

Structure matches manifest.json:
  mw/*.js          MAIN-world patches — THE SOURCE. Edited by hand.
  mw-bundle.js     GENERATED from profile-injector.js + mw/*.js, in load order.
                   This is what the manifest actually loads, and the only reason it
                   exists is the console: Chrome prints one error per BLOCKED SCRIPT in
                   every frame that is sandboxed without allow-scripts, and we reach every
                   frame on purpose. Measured on a page with five such frames: 78 errors
                   with eleven MAIN files, 48 with one. On youtube.com, 27 against 1 for a
                   clean browser.
                   After editing ANY module:
                     node tools/gen-bundle.mjs
                   (test/parity-static.mjs fails if you forget — it compares byte for byte,
                    the same guard dyn/ has. dev-*.html still loads the modules one by one,
                    so the browser suite keeps exercising the unbundled path.)
  rules/static.json  DNR static rules — the identity/locale strip, on in every mode
  rules/static-hw.json  the hardware-hint strip (OS build, device-memory, dpr); background.js
                   switches this ruleset OFF for the "Эта машина" profile, where the
                   browser's own hints are the right answer
  icons/           extension icons
  protect.wasm     canvas/audio noise
  dyn/             cold-start boot files — GENERATED, do not edit
                   background.js registers dyn/dev/<profile>.js, dyn/cc/<CC>.js,
                   dyn/mode/<mode>.js, dyn/pv/<win10|win11>.js, the eight
                   dyn/ns/<pos><hex>.js that spell the master noise seed, dyn/seedlib.js
                   and dyn/boot.js as one document_start content script, so a freshly
                   opened tab describes the selected machine — and derives the right
                   canvas seed — before the page's first script instead of a stub.
                   After editing PROFILES / COUNTRY_DATA / GPU_DATA:
                     node tools/gen-dyn.mjs
                   (test/parity-static.mjs fails if you forget)
  data/countries.json  THE country list — 67 entries, name/tz/locale/Accept-Language/lat/lon.
                   The four country tables are GENERATED from it, in place, between
                   // <generated:NAME> markers:
                     background.js  COUNTRY_DATA      popup.js  COUNTRIES, LOCALE_BY_CODE
                     mw/mw-geo.js   COORDS
                   Adding or changing a country = edit this file, then:
                     node tools/gen-tables.mjs     (then node tools/gen-dyn.mjs — dyn/
                                                    carries one file per country)
                   Never edit the tables themselves; parity-static fails if they drift.
  seed-lib.js      registrableDomain + deriveDomainSeed + afpEffectiveHostname — the
                   per-domain noise seed. Loaded by background.js (importScripts), by the
                   ISOLATED content script (manifest, ahead of storage-bridge.js), and
                   copied VERBATIM by the generator into dyn/seedlib.js for the MAIN
                   world, which can do neither. The seed is never stored anywhere a page
                   can read: it used to live in sessionStorage under a key that named the
                   extension and held the number that makes the canvas noise invertible.
                   If it fails to load the derivation silently falls back to the MASTER
                   seed, which is the same value on every site — see the note in the file.

Modes (popup):
  normal  — full profile spoof
  hidden  — stealth (fewer patches)

Profiles (popup, a picker): four table machines, two scaled-1080p laptops (1536x864 @ 1.25
and 1280x720 @ 1.5 — the same panel at 125%/150% Windows scaling), and "Эта машина": the
host itself. That last row substitutes NO hardware — screen, cores, memory, GPU strings and
limits, WebGPU, battery, network, fonts, decoder and the hardware client hints all answer
from the browser, in the window, in frames and in workers — while the country, timezone,
locale and the per-domain canvas seed stay the profile's. Its crowd is everyone with the
same hardware. Held by test/hostmode.mjs.

After Apply: reload the tab (F5).

Per-site switches (popup, site card): WebRTC protection, Service Worker, and
"CSP → воркеры". The last one is OFF by default: on a site whose CSP refuses blob:
workers (youtube.com) the extension otherwise stands down whole so as not to contradict
the site's own workers; switching it on rewrites that site's CSP response header
(worker-src + blob:, the nonce policy weakened to 'unsafe-inline') so the workers get
patched. It costs the site some of its XSS defence, which is why it is per site and
amber. Held by test/csprewrite.mjs.

Audit page (in the browser you actually run):
  Options -> Аудит -> Открыть, or chrome-extension://<id>/audit.html
  Three sources at once, which is what nothing else here can do:
    the CLAIM   from the service worker (getFullConfig)
    the PAGE    injected into a real tab, world MAIN
    the HOST    this page's own realm - the manifest's all-URLs pattern does not cover
                chrome-extension:, so the content scripts never run here and it reads the
                real machine. Measured: 18 cores / Europe/Moscow in this tab against
                8 / America/New_York in the tab it inspects.
  The claim column is the one afp-console-check.js cannot have: that script runs INSIDE a
  patched page, so `navigator.x === prof.x` where prof.x WAS navigator.x can only ever pass.
  Driven by test/auditpage.mjs, which judges the verdict and the check COUNT.

Console self-check (on https page):
  paste afp-full-console-check.js
  (afp-console-check.js is the short one; afp-parity-console.js compares scopes)
  These three are covered by dev-consolechecks.html in the browser suite — it runs each
  one and fails if it throws or reports nothing. It does NOT assert that every probe
  passes: that needs a real extension, so read the table yourself when you paste it.

Tests:
  npm test           lint + the Node suites (seconds, no browser)
  npm run test:all   the above plus the Chromium dev-page suite
  npm run test:browser            just the dev pages
  node test/run.mjs <filter>      one dev page, e.g. `node test/run.mjs plugins`
  node test/stackleak.mjs         loads the extension for real and checks that no error
                                  stack a page can read names chrome-extension://<id>.
                                  Covers [FIX extension-id-leaked-through-error-stacks];
                                  the dev-page suite CANNOT (both cleaners key on that
                                  literal, absent from an http page). Measured: 0 leaks in
                                  normal AND stealth — _stripOwnFrames is not stealth-gated
                                  and covers these paths, so the !_STEALTH gate on the
                                  Error.stack filter in mw-misc costs nothing here.
  node test/detectors.mjs         runs the REAL detectors — BotD and FingerprintJS, from
                                  their own CDN — against the loaded extension, and grades
                                  it by their verdict instead of ours. NEEDS NETWORK; SKIPs
                                  (exit 0) when the CDN is unreachable, so it is not part
                                  of `npm test`.
                                    node test/detectors.mjs --clean
                                  is the control and is SUPPOSED to be red: with no
                                  extension this rig scores BotD bot: true /
                                  headless_chrome, navigator.webdriver true, and one
                                  visitorId shared by both test origins.
  node test/webrtc-sdp.mjs        asks for the WAN address through every channel that
                                  carries it: the onicecandidate event, the
                                  localDescription.sdp text (candidate lines AND the c=/m=
                                  pair, which name the default candidate) and getStats()
                                  read five ways. Covers
                                  [FIX sdp-carried-the-candidate-the-event-filter-hid] and
                                  [FIX getstats-was-the-third-copy-of-the-address].
                                  NEEDS NETWORK: a srflx candidate only exists if a STUN
                                  server answered, so the CLEAN control runs first and must
                                  SEE the leak — when it does not, the suite SKIPs (exit 0)
                                  rather than reporting a green it did not earn. Not part of
                                  `npm test` for that reason.
  node test/windowchrome.mjs --headed
                                  the window chrome (outerHeight - innerHeight) the profile
                                  implies, against a real browser. Covers
                                  [FIX chrome-height-constant-matched-no-real-browser]: the
                                  constant was 85 and both Google Chrome 151 and Chromium 151
                                  measure 95 in a real window on this machine. --headed is the
                                  run that counts, exactly like test/fontpin.mjs: a headless
                                  browser invents its own frame (clean reports 98 there), so a
                                  headless control would pin the constant to a number no user
                                  has. Without --headed it checks only that the clamp stays
                                  coherent and says so. Forces a window taller than the claimed
                                  screen, the only state where the constant is observable.
                                  Not part of `npm test` for the same reason fontpin is not.
  node test/audio.mjs             checks that audio is EXACTLY what a clean browser produces -
                                  sum, uniqueness count, compressor gain, copyFromChannel and
                                  the analyser, all compared side by side rather than against
                                  a number written in the file (the sum belongs to the machine
                                  and the Chrome build, so a hardcoded one would fail on the
                                  next rig). Guards the REMOVED audio noise: it was measured as
                                  louder than the fingerprint it hid - sum off the KnownAudio
                                  table, 5000 of 5000 samples distinct where a real machine has
                                  4736 - and until now only a comment kept it out. Part of
                                  `npm run test:all`.
  node test/mediadisplay.mjs      re-runs dev-mediaparity.html on hardware and settings this
                                  machine does not have - a P3 and a rec2020 panel, a user
                                  with reduced-motion / High Contrast / prefers-contrast set,
                                  and a touch device - each emulated at ENGINE level (CDP),
                                  so the CSS side moves with it. The parity page alone could
                                  only ever ask about the dev rig, which is exactly the
                                  desktop/mouse/sRGB machine the old code forced matchMedia
                                  to describe, so it was green with three contradictions one
                                  laptop away. Each scenario checks FIRST, in a clean browser,
                                  that the emulation took - otherwise a renamed CDP feature
                                  would turn this green while testing nothing. Part of
                                  `npm run test:all`.
  node test/coldstart.mjs         loads the extension for real and checks that a
                                  brand-new tab reports the selected machine at
                                  document_start (add --headed to watch)
  node test/viewport.mjs          the CSS layout against the viewport APIs. A window cannot
                                  be wider than its monitor, and 100vw is not ours to fake:
                                  claiming a screen SMALLER than the real window made every
                                  API say 1920 while the page laid out at 2008.5 - refutable
                                  in one line, `documentElement.getBoundingClientRect().width
                                  !== innerWidth`. Forces a window bigger than the profile's
                                  screen, or the clamp never fires. Part of `npm run test:all`.
  node test/ownprops.mjs          Object.getOwnPropertyNames for ~40 objects and their
                                  prototypes, compared against a CLEAN BROWSER. A patched
                                  object grows own properties the real one has none of, and
                                  that costs a detector one line. dev-ownprops.html asks the
                                  same thing but compares against an iframe our own content
                                  scripts patch, so it can only ever report 0 - three lies of
                                  this shape shipped behind it. Part of `npm run test:all`.
  node test/ttworker.mjs          window vs worker on a trusted-types origin. The worker
                                  wrapper stands down where it cannot mint a
                                  TrustedScriptURL, and the window used to keep spoofing
                                  anyway - one document answering 8 cores / Tallinn in the
                                  window and 18 / Moscow in the worker, which is what made
                                  Cloudflare Turnstile return 600010. Now: where the CSP
                                  allowlist names `default` that policy is installed and the
                                  worker is patched; where it does not, the window drops the
                                  features a worker could contradict. The suite fails if the
                                  two scopes disagree either way. Part of
                                  `npm run test:all`.
  node test/uachshape.mjs         getHighEntropyValues must answer the low-entropy trio plus
                                  ONLY the hints asked for. Ours answered all of them on
                                  every call - 11 keys where Chrome returns 3 - which is a
                                  shape no browser produces, readable in one call. Every
                                  hint list is compared against a clean browser in the same
                                  run, in the window AND in a worker, so the expected sets
                                  are never written down and cannot go stale. Part of
                                  `npm run test:all`.

  Standalone by design — each states in its own header why it is not in `npm test`, but
  they were listed nowhere, and a suite nothing runs and nothing names is the exact shape
  the console self-checks rotted in:
  node test/canvasmode.mjs        do the two canvas noise paths (WASM and the JS fallback)
                                  produce the same pixels, and does one tab keep one seed
  node test/domrects.mjs          asks whether the clientRects noise hides entropy or mints
                                  it — which is why that flag ships OFF by default
  node test/framerealm.mjs        which surfaces reach a child realm, per frame shape, read
                                  IN the realm being measured rather than from the parent
  node test/fpro-surface.mjs      classifies the Fingerprint Pro read list against what this
                                  build answers; a diagnostic readout, not a verdict
  node tools/probe-crowd.mjs      how big the crowd is. Everything else here asks whether
                                  the build contradicts itself; this asks whether the person
                                  using it is hard to pick out, which is the actual goal and
                                  had never been measured. Arithmetic over the SHIPPED data:
                                  6 table profiles x 67 countries = 8.7 bits, of which 6.1 is
                                  the country the user picks and the exit IP already tells.
                                  The MACHINE is 2.6 bits - a site reading only the hardware
                                  sees one of six. "Эта машина" is left out of the arithmetic:
                                  it claims nothing, so its crowd is the real population.
                                  Deliberately gives no verdict: whether any of the six is a
                                  COMMON machine needs a population dataset (partly there now,
                                  tools/crowd-reference.json), and a wrong reference is worse
                                  than none.
  node tools/probe-diff.mjs       what this build CHANGES against a clean browser - not what
                                  it contradicts, which is what everything in test/ asks.
                                  Same binary both sides, same launch, the only difference
                                  being --load-extension. 119 values; every difference is
                                  either in its ACCEPTED list with a reason or in the queue,
                                  and the exit code counts the queue. Three differences had
                                  shipped without being contradictions and so without being
                                  counted anywhere: geolocation permission reading 'granted'
                                  where clean says 'prompt', the reshaped voice list, and the
                                  two window markers. Part of `npm run test:all`, so a new
                                  difference turns the suite red rather than someone's
                                  fingerprint. --all prints the accepted ones with reasons.
  node tools/probe-surface.mjs    what the browser you RUN has that the browser the suite
                                  drives does not. Branded Chrome has refused
                                  --load-extension since 136 (re-measured on 152 with a
                                  two-file extension, so it is the switch and not our
                                  manifest), so every suite in test/ is one major version
                                  behind the browser this ships to, and is green by
                                  definition for an API that does not exist over there yet.
                                  An added name that NO file here mentions is reported as a
                                  problem, and the exit code is how many — a queue that
                                  empties as names get judged (a line in the change log
                                  counts) and refills on the next browser update. It found
                                  navigator.cpuPerformance and OpaqueRange in Chrome 152,
                                  both real leaks, both invisible to the whole suite.

  Each suite also runs on its own — node test/tables.mjs, node test/tz-icu.mjs, …
  which is the way to read a failure.

Known limits (not bugs):
  - CreepJS may show residual Proxy Pattern hash (technical)
  - Fingerprint.com bot/tampering depends on automation IP/environment
  - UA-CH full version comes from real Chrome (correct)

