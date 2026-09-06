/**
 * WINDOW AND WORKER MUST NOT DISAGREE ON A TRUSTED-TYPES ORIGIN.
 *
 *   node test/ttworker.mjs             headless
 *   node test/ttworker.mjs --headed    watch it
 *
 * Where a CSP declares `require-trusted-types-for 'script'`, mw-workers used to stand its
 * wrapper down — creating a policy would emit a violation naming the extension, the
 * un-catchable C++-built report of [FIX csp-reports-are-a-second-stack-channel]. The
 * stand-down was quiet, and it was worse than the noise it avoided: the worker then ran
 * UNPATCHED and answered with the real machine while the window went on answering the
 * profile. Measured on a real Chrome, one document:
 *
 *              window          worker
 *   cores      8               18
 *   memory     8               16
 *   timezone   Europe/Tallinn  Europe/Moscow
 *   language   et-EE           ru-RU
 *
 * Four contradictions, and a site needs one `new Worker()` to read them. Cloudflare's
 * Turnstile challenge frame is this origin exactly — `worker-src blob:` together with
 * `trusted-types Kssz2 default; require-trusted-types-for 'script'` — and it answered
 * `TurnstileError 600010` on every load until the `navigator` feature was switched off.
 *
 * The fix is the COHERENT STAND-DOWN: where the document enforces trusted types the worker
 * cannot be patched, so the window stops spoofing what a worker can see. Borrowing the
 * page's own policy was implemented instead, passed every suite, and broke Cloudflare
 * Turnstile on the real site — see the long note in mw/mw-workers.js before trying it again.
 *
 * What this suite pins is the invariant, not the mechanism: on every page, whatever the
 * extension decides to do, window and worker must give the SAME answers. The control page
 * proves the spoofing is still happening where it can be done coherently.
 *
 * WHY EACH PAGE IS LOADED TWICE. The allowlist is learned by background.js from the
 * response HEADER, which is invisible to JS, and reaches the page through storage — so on
 * the very first load of an origin the flag can arrive after the document. That is the
 * documented shape of every per-site flag here; see [FIX per-site-flags-need-live-reads].
 * The second load is the one that carries a verdict.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root, bootSettled } from './harness.mjs';
const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };

// The worker reports the same four values the split was measured on.
const WORKER = `self.postMessage({
  cores: navigator.hardwareConcurrency,
  mem: navigator.deviceMemory,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  lang: navigator.language
});`;

// Built through a Trusted Types policy, the way a site under such a CSP has to build it —
// `new Worker('<string>')` is refused there for the page as much as for us, so a probe that
// passes a bare string measures its own mistake rather than the extension.
const PAGE = `<!doctype html><meta charset=utf-8><title>tt</title><body><script>
(async () => {
  const win = { cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory,
                tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: navigator.language };
  let url = '/worker.js';
  if (window.trustedTypes && trustedTypes.createPolicy) {
    try { const p = trustedTypes.createPolicy('sitepol', { createScriptURL: (x) => x });
          url = p.createScriptURL('/worker.js'); } catch (e) { window.__polErr = String(e); }
  }
  const worker = await new Promise((res) => {
    try {
      const w = new Worker(url);
      const t = setTimeout(() => res({ error: 'timeout' }), 8000);
      w.onmessage = (e) => { clearTimeout(t); res(e.data); };
      w.onerror = (e) => { clearTimeout(t); res({ error: 'onerror ' + (e.message || '?') }); };
    } catch (e) { res({ error: String(e).slice(0, 140) }); }
  });
  let flags = {};
  try { flags = { tt: sessionStorage.getItem('v.ui.tt'), tte: sessionStorage.getItem('v.ui.tte'),
                  tts: sessionStorage.getItem('v.ui.tts'), wb: sessionStorage.getItem('v.ui.wb'),
                  defPol: !!(window.trustedTypes && trustedTypes.defaultPolicy) }; } catch (e) {}
  window.__scope = { win, worker, polErr: window.__polErr || null, flags };
})();
</script>`;

/** name -> the CSP that page is served with (null = none). */
const CASES = {
  // The control: no trusted-types at all, so the wrapper takes its normal path.
  plain: null,
  // Cloudflare's exact shape, `default` among the permitted names.
  'tt-allowlist-with-default': "require-trusted-types-for 'script'; trusted-types sitepol default",
  // The strict variant: only the site's own policy name is permitted, so there is no name
  // this extension could create even if it wanted to. Borrowing the page's policy has to
  // carry both, which is the point of running them side by side.
  'tt-allowlist-strict': "require-trusted-types-for 'script'; trusted-types sitepol"
};

const server = createServer((q, r) => {
  const path = (q.url || '').split('?')[0];
  if (path === '/worker.js') {
    r.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(WORKER);
    return;
  }
  const name = path.replace(/^\//, '') || 'plain';
  const h = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  const csp = CASES[name];
  if (csp) h['content-security-policy'] = csp;
  r.writeHead(200, h).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const dir = mkdtempSync(join(tmpdir(), 'afp-tt-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: !headed,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});

const readCase = async (name) => {
  const page = await ctx.newPage();
  const url = `http://127.0.0.1:${port}/${name}`;
  // Twice: the first load is what TEACHES background.js this origin's CSP.
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.goto(url + '?second=1', { waitUntil: 'load' });
  const got = await page.evaluate(async () => {
    for (let i = 0; i < 40 && !window.__scope; i++) await new Promise((r) => setTimeout(r, 250));
    return window.__scope || { win: null, worker: { error: 'probe never ran' } };
  });
  await page.close();
  return got;
};

try {
  try { ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch { /* up */ }
  await bootSettled(ctx);

  const results = {};
  for (const name of Object.keys(CASES)) results[name] = await readCase(name);

  // The guard without which every comparison below passes for the wrong reason: if the
  // extension is not actually spoofing, window and worker agree natively and this suite
  // reports a green it did not earn.
  const plain = results.plain;
  ok(plain.win && plain.worker && !plain.worker.error,
    `control page: both scopes answered — worker ${JSON.stringify(plain.worker)}`);

  console.log('');
  for (const name of Object.keys(CASES)) {
    const { win, worker, polErr, flags } = results[name];
    console.log(`  ${name}`);
    console.log(`     window: ${JSON.stringify(win)}`);
    console.log(`     worker: ${JSON.stringify(worker)}${polErr ? '  (page policy: ' + polErr + ')' : ''}`);
    console.log(`     flags : ${JSON.stringify(flags)}`);

    ok(worker && !worker.error, `${name}: the worker ran at all — ${worker && worker.error}`);
    if (!worker || worker.error) continue;

    for (const key of ['cores', 'mem', 'tz', 'lang']) {
      ok(win[key] === worker[key],
        `${name}: window and worker agree on ${key} — window ${JSON.stringify(win[key])}, worker ${JSON.stringify(worker[key])}`);
    }
  }

  // And the control must still be SPOOFED, or "the two scopes agree" is being satisfied by
  // an extension that does nothing anywhere. The trusted-types pages agree on the host's own
  // values by design — that is the stand-down — so the proof that spoofing still happens has
  // to come from the plain page.
  if (plain.win && plain.worker && !plain.worker.error) {
    ok(plain.win.cores !== results['tt-allowlist-strict'].win.cores,
      `the control page is spoofed while the trusted-types page stands down — ` +
      `plain ${plain.win.cores}, trusted-types ${results['tt-allowlist-strict'].win.cores}`);
  }
} finally {
  await ctx.close().catch(() => {});
  server.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds the profile */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
