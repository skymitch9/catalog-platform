/**
 * ebooks-door — ebooks.heygabi.ai, the shared pool's own address.
 *
 * `/` -> the audiobook site's /ebooks.html (served, not redirected, so the
 * URL in the bar stays ebooks.heygabi.ai). Everything else proxies to the
 * same origin the page was built for, so its relative fetches — ebooks.json,
 * fb-env.js, identity.js, estate/estate-search.js — resolve same-origin here
 * and stay in lockstep with every promote. No caching beyond what the origin
 * says; no rewriting of content.
 *
 * ⚠️ The pool page exists on PROD only after ebook-split phase 2 (the
 * promote). Until then `/` returns whatever prod serves for /ebooks.html —
 * the catalog SPA fallback — which is why the domain "goes live" the moment
 * the owner says promote, with no change here.
 *
 * ⚠️ Origin is the PROD host on purpose, never /dev/ — a lane is not a
 * hostname, and this door must never quietly serve the dev lane as if it
 * were the product.
 */
const ORIGIN = 'https://audiobooks.heygabi.ai';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname === '/' ? '/ebooks.html' : url.pathname;
    const upstream = new Request(ORIGIN + path + url.search, request);
    const res = await fetch(upstream);
    // Pass through verbatim — headers, status, body. The origin's caching
    // and CSP decisions stay the origin's.
    return new Response(res.body, res);
  },
} satisfies ExportedHandler;
