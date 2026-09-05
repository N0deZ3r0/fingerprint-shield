// Serves the sweep page — and remembers the DOCUMENT request's headers so the page can
// hold them against what JS says. The header side is invisible from inside the page, and
// it is where this project has already had a real bug (a stale DNR rule claiming Windows
// 10 while JS said 11), so the sweep is blind without it.
const http = require('http');
const fs = require('fs');
const path = require('path');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

// Asking for the high-entropy hints. They are NOT sent on the first request — the browser
// learns the list from this response — so the page says "reload" rather than reporting a
// mismatch it cannot have measured yet.
const ACCEPT_CH = [
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-platform-version',
  'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-model', 'sec-ch-ua-full-version-list',
  'sec-ch-ua-wow64', 'sec-ch-ua-form-factors'
].join(', ');

let lastDocHeaders = null;
let lastDocOrder = [];

http.createServer((q, r) => {
  let name = (q.url || '/').split('?')[0];
  if (name === '/headers.json') {
    r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    r.end(JSON.stringify({ headers: lastDocHeaders, order: lastDocOrder }));
    return;
  }
  // The verify page carries the policy that used to make our worker wrapper print a
  // violation, so loading it is itself half the regression test.
  if (name === '/verify') {
    lastDocHeaders = q.headers;
    let v = fs.readFileSync(path.join(__dirname, 'verify.html'), 'utf8');
    v = v.replace('/*__HEADERS__*/', 'const AFP_REQ_HEADERS = ' + JSON.stringify({ headers: q.headers }) + ';');
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
                       'permissions-policy': 'sync-xhr=()' }).end(v);
    return;
  }
  if (name === '/sw-normal.js' || name === '/creepjs-sw.js') {
    r.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
     .end('self.addEventListener("install", function () {});');
    return;
  }
  if (name === '/' || name === '') {
    name = '/sweep.html';
    lastDocHeaders = q.headers;
    // Order and count, not just values — see the note on unsolicited client hints.
    lastDocOrder = [];
    for (let i = 0; i < q.rawHeaders.length; i += 2) lastDocOrder.push(q.rawHeaders[i].toLowerCase());
  }
  // [FIX local-subresources-can-be-blocked] Measured in a real browser with AdGuard on:
  // the NAVIGATION to 127.0.0.1 arrives, every subresource from that page (fetch, XHR,
  // even an <img>) is refused before it leaves Chrome — the blocker's protection against
  // pages scanning the local network. The harness used to fetch /headers.json and the
  // worker source, so it simply hung there. The request headers are inlined into the
  // document instead: the one request that IS allowed carries everything the page needs.
  const f = path.join(__dirname, path.basename(name));
  if (!fs.existsSync(f)) { r.writeHead(404).end('no'); return; }
  r.writeHead(200, {
    'content-type': types[path.extname(f)] || 'text/plain',
    'cache-control': 'no-store',
    'accept-ch': ACCEPT_CH
  });
  let body = fs.readFileSync(f, 'utf8');
  if (path.extname(f) === '.html') {
    // `const`, not a window property: a top-level `var` in a classic script lands on
    // window and the page's own "no extension globals" check would flag the harness.
    body = body.replace('/*__HEADERS__*/', 'const AFP_REQ_HEADERS = ' +
      JSON.stringify({ headers: q.headers, order: (() => {
        const o = []; for (let i = 0; i < q.rawHeaders.length; i += 2) o.push(q.rawHeaders[i].toLowerCase()); return o;
      })() }) + ';');
  }
  r.end(body);
}).listen(8732, '127.0.0.1', () => console.log('sweep on http://127.0.0.1:8732/'));
