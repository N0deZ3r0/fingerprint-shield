/**
 * WAIT FOR THE INSTALL TO SETTLE, rather than counting loads and hoping.
 *
 * Four loads plus a reload is what tools/probe-diff.mjs has always used, and it is what a
 * developer machine needs. The first CI browser run showed it is not what every machine
 * needs: on a Windows runner the install window was still open afterwards, and a suite
 * measured inside it while reporting something else entirely —
 *
 *   uad.hev.platformVersion       "10.0.0" -> "15.0.0"     the fallback literal, then the profile
 *   webgl.param.MAX_TEXTURE_SIZE   8192    -> 16384        the host's limit, then the profile's
 *
 * test/stealth.mjs was fixed to wait for those two to stop moving. The two probe tools were
 * left counting loads, which meant the same trap sat under both of them — they are run by
 * hand, usually on a fast machine, so it had simply never fired. This is that wait, shared,
 * so the three agree by construction instead of by anyone remembering.
 *
 * WHAT IT WAITS FOR, and why these two. Both are answered from the profile once it lands and
 * from somewhere else before that, and both were seen moving on the runner. The platform
 * version additionally has a literal fallback — '10.0.0' in mw-navigator's _forceUAD — so it
 * says "not settled" outright rather than only by changing, which is what lets a single
 * reading be conclusive when nothing has moved yet.
 *
 * It is deliberately cheap: one client-hint call and one GL parameter per load, with the
 * context released each time. A settling check that costs as much as the measurement would
 * change what it is measuring — see the header of tools/probe-collect.mjs for the version of
 * that mistake this project already made.
 */

/** The two values, read as one string. Cheap enough to poll. */
export const SETTLE_PROBE = `(async () => {
  let pv = '?';
  try { pv = (await navigator.userAgentData.getHighEntropyValues(['platformVersion'])).platformVersion; } catch (e) {}
  let tex = 0;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    tex = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
    try { gl.getExtension('WEBGL_lose_context').loseContext(); } catch (e2) {}
  } catch (e) {}
  return pv + '/' + tex;
})()`;

/**
 * Load `url` until the profile has landed and stopped moving, then return how many loads it
 * took. `max` bounds it so a genuinely broken build reports rather than hangs.
 *
 * The caller does its own warm-up first if it wants one; this only adds what that was short
 * of. Returns { loads, value, settled } — `settled` false means the bound was hit, which is
 * a finding rather than an error and is left to the caller to report.
 */
export async function settle(page, url, max = 30) {
  let prev = null;
  for (let i = 0; i < max; i++) {
    const now = await page.evaluate(SETTLE_PROBE);
    if (prev !== null && now === prev && !String(now).startsWith('10.0.0/')) {
      return { loads: i, value: now, settled: true };
    }
    prev = now;
    await page.goto(url + (url.indexOf('?') === -1 ? '?' : '&') + 'settle=' + i,
      { waitUntil: 'load' });
  }
  return { loads: max, value: prev, settled: false };
}
