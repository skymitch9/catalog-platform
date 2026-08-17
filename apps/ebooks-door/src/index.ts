/**
 * ebooks-door — ebooks.heygabi.ai, the shared pool's own address.
 *
 * `/` -> the audiobook site's /ebooks.html (served, not redirected, so the
 * URL in the bar stays ebooks.heygabi.ai). Everything else proxies to the
 * same origin the page was built for, so its relative fetches — fb-env.js,
 * identity.js, account-modal.js, static/js/theme.js — resolve same-origin
 * here and stay in lockstep with every promote. No caching beyond what the
 * origin says; no rewriting of content.
 *
 * ⚠️ WHAT CHANGED 2026-08-17, and why this file barely did. Owner directive:
 * "ebooks should be like the other site where we grant permission to view it.
 * I don't want people scraping my books." The page this door serves is now an
 * AUTH-LOCKED SHIM — its markup, theme and bookshelf are unchanged, but the
 * book data no longer travels with it. `ebooks.json` left the deployment AND
 * left git (the audiobook repo is public), and the shelf fetches a bearer-
 * gated manifest from audiobook-api.heygabi.ai instead.
 *
 * ⚠️ SO THIS DOOR IS NOT THE LOCK, AND MUST NEVER BE TREATED AS ONE. It is a
 * dumb proxy; the gate is server-side, in apps/audiobook-worker's
 * GET /api/ebooks/manifest, which verifies a Firebase ID token and requires
 * the estate's `ebooks` visibility grant on every request. Deleting this
 * Worker closes the pretty address and changes nothing about who can read the
 * shelf. Conversely, no rule added here would protect anything — the manifest
 * is not on this path at all.
 *
 * ⚠️ `ebooks.json` is deliberately NOT in the list of proxied fetches above
 * any more. If a request for it ever starts succeeding through this door, the
 * manifest is back in the public deployment and the gate has been undone.
 *
 * ⚠️ Origin is the PROD host on purpose, never /dev/ — a lane is not a
 * hostname, and this door must never quietly serve the dev lane as if it
 * were the product. The consequence for the gate: the shim reaches
 * ebooks.heygabi.ai only once the removal is PROMOTED to prod; until then
 * prod still serves the pre-gate page, whose relative manifest fetch 404s
 * (the deploy workflow strips the file from both lanes on every publish).
 */
const ORIGIN = 'https://audiobooks.heygabi.ai';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // ⚠️ `/ebooks`, NOT `/ebooks.html` — MEASURED 2026-08-17. Cloudflare Pages
    // 308s the `.html` form to the extensionless one, and this door passes
    // responses through VERBATIM, so the redirect escaped with a Location on
    // the audiobook host: every visitor to ebooks.heygabi.ai was bounced to
    // audiobooks.heygabi.ai/ebooks and the pool never appeared on its own
    // address at all. Asking for the canonical path in the first place is the
    // fix; nothing about the pass-through needed to change.
    const path = url.pathname === '/' ? '/ebooks' : url.pathname;
    const upstream = new Request(ORIGIN + path + url.search, request);
    const res = await fetch(upstream);
    // Pass through verbatim — headers, status, body. The origin's caching
    // and CSP decisions stay the origin's.
    return new Response(res.body, res);
  },
} satisfies ExportedHandler;
