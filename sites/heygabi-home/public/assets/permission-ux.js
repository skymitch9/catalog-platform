/**
 * permission-ux.js — turn a failed fetch response into a human sentence.
 * ES module, browser-native (no build step) — same "no bundler" precedent as
 * estate-auth.js and estate-search.js.
 *
 * Owner requirement 2026-08-16 (audiobook_catalog/docs/info/ROLES.md §1e —
 * the estate-wide standard, not just that repo's): "make sure if any one
 * gets permission blocked they get a warning message and not a https only
 * error. make it a good ux." Nobody sees a bare HTTP status, a raw JSON
 * error body, or a silent dead control. A refusal says three things: what
 * happened, what it needs, and how to get it. A network/server failure is
 * NOT a permission failure (§1e point 5) — mislabelling an outage sends
 * people to ask for access they already have, so the two are told apart
 * here in one place instead of in every fetch call that surfaces an error.
 *
 * This is presentation only. It does not decide who can do what — the gate
 * is the Worker's own auth check. This module only decides the sentence
 * shown when a gate that was already going to refuse, refuses.
 */

/** True for the two status codes that mean "a permission gate refused this", as opposed to a broken request or a dead server. */
export function isPermissionStatus(status) {
  return status === 401 || status === 403;
}

/**
 * Build the sentence for a non-ok fetch Response, given its (already
 * consumed) status and parsed body.
 *
 * @param {number} status        res.status
 * @param {{detail?: string, error?: string}|null} body  parsed JSON body, or null if unreadable/absent
 * @param {{ unauthenticated?: string, need?: string, forbidden?: string, fallback?: string }} [opts]
 *   unauthenticated: message for 401 (default: a lapsed-session prompt)
 *   need: named in the 403 sentence — e.g. "the contributor role". Omit when
 *     the exact role isn't known here; the generic "ask an admin" still
 *     satisfies the standard.
 *   forbidden: full override for the 403 sentence (skips `need` composition)
 *   fallback: message for any other non-ok status, when the body gave no
 *     detail/error of its own. Defaults to a generic retry sentence — never
 *     the raw status code.
 * @returns {string}
 */
export function describeHttpFailure(status, body, opts) {
  const o = opts || {};
  if (status === 401) {
    return o.unauthenticated || 'Your sign-in has lapsed — sign in again.';
  }
  if (status === 403) {
    if (o.forbidden) return o.forbidden;
    const need = o.need ? ` That needs ${o.need}.` : '';
    return `You don't have permission to do that.${need} Ask an admin.`;
  }
  const serverSaid = body && (body.detail || body.error);
  if (serverSaid) return o.fallback ? `${o.fallback} (${serverSaid})` : String(serverSaid);
  return o.fallback || 'Something went wrong on the server. Try again shortly.';
}
