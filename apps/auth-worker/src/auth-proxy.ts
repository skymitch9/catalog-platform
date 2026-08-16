/**
 * The `/__/auth/*` reverse proxy — sso-design.md §4.1 (option a), Phase 1
 * (§8). Firebase's documented fix for the 2026 third-party-storage breakage
 * (§3.2): `signInWithRedirect()` stores flow state on a hidden iframe at
 * `authDomain`, which is cross-site from `*.heygabi.ai` once storage is
 * partitioned. Firebase's own Option 3 is to reverse-proxy the default
 * `<project>.firebaseapp.com` auth helper under a same-site host — here,
 * `auth.heygabi.ai/__/auth/*` — so the helper origin becomes same-site and
 * its storage stops being partitioned.
 *
 * ⚠️ This is ONLY the plumbing. Flipping any surface's `authDomain` to
 * `auth.heygabi.ai` is a LATER, owner-gated step (two 🔴 console entries —
 * Firebase authorised domains, the OAuth client's redirect URI — must exist
 * first, §8's one ordering hazard: flip before the proxy is live and that
 * surface's sign-in breaks). This module and its mount point are additive
 * and inert until a surface actually points its authDomain here.
 *
 * A TRUE proxy, not a redirect: the client never sees a 3xx pointing at
 * `firebaseapp.com` for the request itself (the whole reason this exists —
 * a redirect would just re-run into the third-party-storage problem at the
 * far end). What DOES pass through verbatim is any 3xx *Firebase itself*
 * emits as part of the auth ceremony (e.g. bouncing to
 * `accounts.google.com` and back) — `redirect: 'manual'` on the upstream
 * fetch is what keeps those visible to the browser instead of being
 * silently followed and swallowed here, which would break the OAuth dance.
 *
 * Method, headers (minus hop-by-hop noise) and body stream straight through
 * in both directions; response status and headers are forwarded unchanged.
 */

const FIREBASE_AUTH_HOST = 'audiobook-catalog.firebaseapp.com';

/** Headers that must never be forwarded verbatim — either hop-by-hop or Worker-added, meaningless (or misleading) on the far side. */
const STRIP_REQUEST_HEADERS = [
  'host',
  'content-length',
  'cf-connecting-ip',
  'cf-ray',
  'cf-visitor',
  'cf-ipcountry',
  'x-forwarded-proto',
  'x-forwarded-for',
];

export async function proxyFirebaseAuth(req: Request): Promise<Response> {
  const incoming = new URL(req.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, `https://${FIREBASE_AUTH_HOST}`);

  const headers = new Headers(req.headers);
  for (const name of STRIP_REQUEST_HEADERS) headers.delete(name);

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    // Preserve Firebase's own 3xx responses instead of following them here —
    // see the file header. Without this, a bounce to accounts.google.com
    // would be resolved server-side and the browser would never navigate.
    redirect: 'manual',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
    init.body = req.body;
    // Required by the Workers runtime whenever a request body is a stream.
    init.duplex = 'half';
  }

  const upstream = await fetch(target, init);

  // Stream the body straight through; status and headers are forwarded
  // exactly as Firebase sent them — no rewriting, per the design's ask.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
