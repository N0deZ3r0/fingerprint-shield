/**
 * The WAN address, asked for through every channel that carries it.
 *
 *   node test/webrtc-sdp.mjs             headless
 *   node test/webrtc-sdp.mjs --headed    watch it
 *
 * mw/mw-misc.js hides ICE candidates that carry an address. It used to do that in ONE
 * place — RTCPeerConnectionIceEvent.prototype.candidate — and Chrome publishes the same
 * candidates in two others, neither of which needs a subscription:
 *
 *   pc.localDescription.sdp    a string, one `a=candidate:... typ srflx <WAN IP>` line
 *   pc.getStats()              a local-candidate entry with .address
 *
 * Measured before the fix, one connection, all three read side by side: the event said
 * null while the other two named the real public address. So this suite exists to keep the
 * three channels telling the SAME story, which is the one the event already told —
 * a browser behind a firewall whose STUN attempt produced nothing.
 *
 * NEEDS NETWORK, and says so honestly: a srflx candidate only exists if a STUN server
 * answered. The CLEAN control runs first and must SEE the leak; if it does not, the rig has
 * no STUN reachable and the suite SKIPs (exit 0) instead of reporting a green it did not
 * earn. That control is the whole reason this file can be trusted — an assertion that "no
 * public IP is visible" passes trivially in a browser that never learned one.
 *
 * WHY EACH ASSERTION IS HERE:
 *   sdp has no srflx line     the headline leak; a page reads it with one property access.
 *   no public IP in the SDP   checked against the address the CONTROL saw, so it is the
 *                             real one and not a pattern that might match something else.
 *   getStats has no srflx     the third copy. Filtered by hiding the whole entry.
 *   every iteration path      forEach / values() / entries() / [...rep] / keys()+get() must
 *     agrees                  agree. A filter that misses one of them is bypassed by one
 *                             line and is worse than none, because it reads as protection.
 *   instanceof survives       localDescription must stay an RTCSessionDescription and the
 *                             report an RTCStatsReport. Both are one-line checks, and a
 *                             plain object here would be a stronger signal than the IP.
 *   method identity stable    native `rep.forEach === rep.forEach`. Rebuilding the methods
 *                             on every property access is its own tell.
 *   host candidates still     the mDNS `.local` names are Chrome's own way of hiding the
 *     delivered               private address; blocking them too would break WebRTC for no
 *                             privacy gain, so the count must stay non-zero.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER, root } from './harness.mjs';
const headed = process.argv.includes('--headed');
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { console.error('FAIL:', m); failed++; } };
const eq = (got, want, m) => ok(Object.is(got, want), `${m} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const PAGE = `<!doctype html><html><body><script>
window.__run = (async () => {
  const out = { evented: [], sdpCandidates: [], stats: [], err: null };
  try {
    try { out.marker = !!window.__r0; } catch (e) { out.marker = 'ERR'; }
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.createDataChannel('probe');
    pc.onicecandidate = (e) => out.evented.push(e.candidate ? e.candidate.candidate : null);
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, 10000);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); }
      };
    });

    const desc = pc.localDescription;
    out.descIsNative = desc instanceof RTCSessionDescription;
    const sdp = (desc && desc.sdp) || '';
    out.sdpRaw = sdp;
    out.sdpCandidates = sdp.split(/\\r?\\n/).filter((l) => l.indexOf('a=candidate') === 0);

    const rep = await pc.getStats();
    out.repIsNative = rep instanceof RTCStatsReport;
    out.methodIdentityStable = (rep.forEach === rep.forEach) && (rep.get === rep.get);
    out.size = rep.size;

    // Every way of reading the report, gathered separately so a filter that misses one
    // is named rather than averaged away.
    const viaForEach = [];  rep.forEach((s) => viaForEach.push(s));
    const viaValues  = [...rep.values()];
    const viaEntries = [...rep.entries()].map(([, s]) => s);
    const viaSpread  = [...rep].map(([, s]) => s);
    const viaKeys    = [...rep.keys()].map((id) => rep.get(id)).filter(Boolean);
    const srflxIn = (list) => list.filter((s) => s && s.type === 'local-candidate' &&
      (s.candidateType === 'srflx' || s.candidateType === 'prflx')).length;
    out.srflx = {
      forEach: srflxIn(viaForEach), values: srflxIn(viaValues), entries: srflxIn(viaEntries),
      spread: srflxIn(viaSpread), keys: srflxIn(viaKeys)
    };
    out.counts = {
      forEach: viaForEach.length, values: viaValues.length, entries: viaEntries.length,
      spread: viaSpread.length, keys: viaKeys.length
    };
    out.hostCandidates = viaForEach.filter((s) => s && s.type === 'local-candidate' &&
      s.candidateType === 'host').length;
    // Every address the report is willing to name, whatever the path.
    out.statAddresses = viaForEach.concat(viaValues, viaEntries, viaSpread, viaKeys)
      .filter((s) => s && s.address).map((s) => s.address);
    pc.close();
  } catch (e) { out.err = String(e); }
  return out;
})();
</script></body></html>`;

const server = createServer((q, r) =>
  r.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/**
 * `storage` is written into chrome.storage.local from the service worker before the page
 * opens — that is where the per-site exception list and the mode live.
 *
 * `stealth: true` also loads the page TWICE. Stealth is decided as mw-core.js loads, from
 * `v.ui.m` in sessionStorage, and that key does not exist before a first load — so a
 * single-load stealth check measures NORMAL mode and would pass on a build where stealth
 * is broken. The second load is waited for by VALUE, not by timeout.
 */
async function run({ extension, storage, stealth }) {
  const dir = mkdtempSync(join(tmpdir(), 'afp-rtc-'));
  let browser = null;
  const ctx = extension
    ? await chromium.launchPersistentContext(dir, {
      ...BROWSER, headless: !headed,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    })
    : await (browser = await chromium.launch({ ...BROWSER, headless: !headed })).newContext();
  try {
    if (extension) {
      let sw = ctx.serviceWorkers()[0];
      try { sw = sw || await ctx.waitForEvent('serviceworker', { timeout: 20000 }); } catch { /* up */ }
      await new Promise((r) => setTimeout(r, 3000));
      if (storage && sw) {
        await sw.evaluate(async (v) => { await chrome.storage.local.set(v); }, storage);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    let mode = null;
    if (stealth) {
      for (let i = 0; i < 40; i++) {
        mode = await p.evaluate(() => { try { return sessionStorage.getItem('v.ui.m'); } catch (e) { return null; } });
        if (mode === 'stealth') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await p.reload({ waitUntil: 'load' });
    }
    const out = await p.evaluate(async () => await window.__run);
    // The popup counts this page's active modules by reading window.__t0 in the page's own
    // realm; what it reports has to agree with what the page can actually see.
    out.statusMark = await p.evaluate(() => { try { return !!(window.__t0 && window.__t0.webrtc); } catch (e) { return null; } });
    out.mode = mode;
    return out;
  } finally {
    await ctx.close();
    if (browser) await browser.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps a handle */ }
  }
}

const IPV4 = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;

try {
  // ── The control, first: this rig must be able to SEE the leak ──────────────────
  const clean = await run({ extension: false });
  const cleanSrflxSdp = clean.sdpCandidates.filter((l) => l.indexOf(' srflx ') !== -1);
  // The WAN address is taken from the srflx line itself, not from the SDP at large: a
  // clean browser also lists host candidates, and on this rig the first address in the
  // document is 127.0.0.1. `raddr 0.0.0.0` on the same line is excluded for the same
  // reason — the point is to hold the extension against the ONE address that only a STUN
  // answer could have produced.
  const cleanAddrs = (cleanSrflxSdp.join(' ').match(IPV4) || [])
    .filter((ip) => ip !== '0.0.0.0' && ip !== '127.0.0.1');

  if (clean.err || !cleanSrflxSdp.length || !cleanAddrs.length) {
    console.log(`SKIP — no STUN answer in the control run${clean.err ? ' (' + clean.err + ')' : ''}.`);
    console.log('A srflx candidate needs a reachable STUN server; nothing is asserted without one.');
    server.close();
    process.exit(0);
  }
  const wanIp = cleanAddrs[0];
  console.log(`control (no extension): SDP names ${wanIp}, getStats srflx entries: ${clean.srflx.forEach}`);
  ok(clean.srflx.forEach > 0, 'control sees the address through getStats too — the rig can observe both channels');

  // ── The extension ─────────────────────────────────────────────────────────────
  const v = await run({ extension: true });
  ok(!v.err, `probe ran without throwing (${v.err})`);

  // 1. the event path, which was already covered — re-checked so a regression there
  //    cannot hide behind the two new assertions.
  eq(v.evented.filter((c) => c && c.indexOf(' srflx ') !== -1).length, 0,
    'no srflx candidate is delivered through onicecandidate');

  // 2. the SDP
  eq(v.sdpCandidates.filter((l) => l.indexOf(' srflx ') !== -1).length, 0,
    'localDescription.sdp carries no srflx candidate line');
  ok(v.sdpRaw.indexOf(wanIp) === -1,
    `localDescription.sdp does not name the real WAN address (${wanIp})`);
  eq(v.descIsNative, true, 'localDescription is still a real RTCSessionDescription');
  // The connection line is the second place the address lives, and removing the candidate
  // lines alone left it standing — that is what this assertion caught the first time it
  // ran. The target values are not invented: a clean Chrome given NO STUN server writes
  // `c=IN IP4 0.0.0.0` and port 9, which is the state being imitated.
  const cLines = v.sdpRaw.split(/\r?\n/).filter((l) => l.indexOf('c=') === 0);
  ok(cLines.length > 0 && cLines.every((l) => / (0\.0\.0\.0|::)$/.test(l)),
    `every c= line offers nothing to connect to (${cLines.join(' | ') || 'none'})`);
  const mPorts = v.sdpRaw.split(/\r?\n/).filter((l) => l.indexOf('m=') === 0)
    .map((l) => l.split(' ')[1]);
  ok(mPorts.every((p) => p === '9'),
    `every m= line carries the discard port 9, as it does with no STUN (${mPorts.join(', ')})`);

  // 3. getStats, through every reading path
  eq(v.repIsNative, true, 'getStats returns something that is still an RTCStatsReport');
  eq(v.methodIdentityStable, true, 'report methods keep their identity across property reads');
  for (const path of ['forEach', 'values', 'entries', 'spread', 'keys']) {
    eq(v.srflx[path], 0, `no srflx candidate reachable via ${path}`);
  }
  ok(!v.statAddresses.some((a) => a === wanIp),
    `no stats entry names the real WAN address (${v.statAddresses.join(', ') || 'no addresses at all'})`);
  const counts = Object.values(v.counts);
  ok(counts.every((c) => c === counts[0]),
    `every iteration path reports the same number of entries (${JSON.stringify(v.counts)})`);
  eq(v.size, v.counts.forEach, 'report.size matches what iteration yields');

  // 4. and WebRTC still works for the candidates that carry nothing
  ok(v.hostCandidates > 0,
    `mDNS host candidates are still delivered (${v.hostCandidates}) — the filter is not a kill switch`);

  console.log(`\nextension: SDP candidates ${v.sdpCandidates.length}, stats entries ${v.size}, srflx 0 everywhere`);
  eq(v.statusMark, true, 'the popup status marker reports WebRTC active on a protected host');

  // ── the per-site switch, in both modes ────────────────────────────────────────
  // [FIX per-site-switch-was-decided-before-the-flag-existed] and
  // [FIX stealth-turned-the-webrtc-switch-into-a-decoration]. Both bugs passed every
  // assertion above, because both left the address HIDDEN in the default state that the
  // block above measures. What neither of them did was answer to the switch: the exception
  // never reached the patch (it is computed per host in background.js and arrives ~100-300
  // ms after document_start, while the gate was read once, at install time), and stealth
  // dropped the whole block regardless of it. So the switch is measured here in both
  // positions and in both modes — an assertion that protection is ON is worth little
  // without one that it can be turned OFF.
  const off = await run({ extension: true, storage: { afp_webrtc_exceptions: ['127.0.0.1'] } });
  const offSrflx = off.sdpCandidates.filter((l) => l.indexOf(' srflx ') !== -1).length;
  ok(offSrflx > 0 && off.sdpRaw.indexOf(wanIp) !== -1,
    'switch OFF (host in afp_webrtc_exceptions): the page sees the srflx candidate again ' +
    `(${offSrflx} srflx lines, WAN ${off.sdpRaw.indexOf(wanIp) !== -1 ? 'present' : 'ABSENT'})`);
  ok(off.statAddresses.includes(wanIp),
    'switch OFF: getStats names the address too — no channel stays filtered behind the switch');
  // [FIX the-per-site-flag-arrived-320ms-late] The three channels must agree WITHIN one
  // connection. They did not: the profile carrying the exception lands ~320 ms in, and the
  // srflx candidate is offered at the event before that, so the event was filtered while
  // the SDP read afterwards was not — measured in a real browser, on a real excepted host.
  // rtc-off.js is registered for the excepted hosts and answers at document_start, which
  // is what makes the event agree with the other two.
  eq(off.marker, true, 'switch OFF: the document_start marker (__r0) is present on an excepted host');
  ok(off.evented.filter((c) => c && c.indexOf(' srflx ') !== -1).length > 0,
    'switch OFF: onicecandidate delivers the srflx candidate too — no half-applied switch');
  eq(v.marker, false, 'switch ON: no marker, so nothing is registered for a protected host');
  eq(off.statusMark, false, 'switch OFF: the popup does not count WebRTC among the active modules');

  const st = await run({ extension: true, storage: { afp_mode: 'stealth' }, stealth: true });
  eq(st.mode, 'stealth', 'the stealth run really was in stealth (v.ui.m)');
  eq(st.sdpCandidates.filter((l) => l.indexOf(' srflx ') !== -1).length, 0,
    'stealth, switch ON: the SDP still carries no srflx candidate');
  ok(st.sdpRaw.indexOf(wanIp) === -1 && !st.statAddresses.includes(wanIp),
    `stealth, switch ON: the WAN address (${wanIp}) is hidden in stealth too`);
  eq(st.statusMark, true, 'stealth, switch ON: the popup reports WebRTC active');
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
