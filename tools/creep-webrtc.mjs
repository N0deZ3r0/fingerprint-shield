/**
 * What does CreepJS actually print for WebRTC, per mode and per switch?
 *
 *   node tools/creep-webrtc.mjs          WAIT=32000 by default
 *
 * Lived in the project root as `_creep.mjs` until Chrome refused the whole unpacked
 * extension over it: filenames starting with `_` are reserved for the browser, and one of
 * them anywhere in the directory fails the load with "Не удалось загрузить манифест" —
 * a scratch file taking the extension down with it. Only `_locales`, `_metadata` and
 * `_platform_specific` are allowed. test/parity-static.mjs now fails on any other one.
 */
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root as ROOT } from '../test/harness.mjs';
const URL = 'https://abrahamjuliot.github.io/creepjs/index.html';
const WAIT = Number(process.env.WAIT || 32000);

const BASE = { canvas: true, webgl: true, navigator: true, screen: true, timezone: true,
  geolocation: true, battery: true, fonts: true, clientRects: true, plugins: true,
  network: true, hideAdBlocker: true };

const CASES = [
  { name: 'normal + webrtc ON',  mode: 'normal',  webrtc: true },
  { name: 'normal + webrtc OFF', mode: 'normal',  webrtc: false },
  { name: 'stealth + webrtc ON', mode: 'stealth', webrtc: true }
];

const dir = mkdtempSync(join(tmpdir(), 'afp-creep-'));
const ctx = await chromium.launchPersistentContext(dir, {
  ...BROWSER, headless: true,
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 2500));

for (const c of CASES) {
  await sw.evaluate(async (d) => { await chrome.storage.local.set(d); },
    { afp_mode: c.mode, afp_features: { ...BASE, webrtc: c.webrtc } });
  await new Promise((r) => setTimeout(r, 1500));

  const page = await ctx.newPage();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // second load: the flags only reach the page after its first script
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, WAIT));

    const info = await page.evaluate(() => {
      const flags = (() => { try { return sessionStorage.getItem('v.ui.f'); } catch (e) { return 'ERR'; } })();
      const mode = (() => { try { return sessionStorage.getItem('v.ui.m'); } catch (e) { return 'ERR'; } })();
      const text = document.body ? document.body.innerText : '';
      // every line that mentions webrtc / rtc / ip, with a little context
      const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
      const hits = [];
      lines.forEach((l, i) => {
        if (/webrtc|rtc |ice |candidate|blocked/i.test(l)) {
          hits.push(lines.slice(Math.max(0, i - 1), i + 3).join('  |  '));
        }
      });
      return { flags, mode, hits: [...new Set(hits)].slice(0, 14) };
    });

    console.log(`\n===== ${c.name} =====`);
    console.log(`   v.ui.m=${info.mode}  v.ui.f=${info.flags}`);
    if (!info.hits.length) console.log('   (no webrtc/blocked line found on the page)');
    info.hits.forEach((h) => console.log('   ' + h));
  } catch (e) {
    console.log(`\n===== ${c.name} =====\n   ERROR: ${e.message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
}

await ctx.close();
try { rmSync(dir, { recursive: true, force: true }); } catch {}
