/**
 * The Phase 2 session routes (sso-design.md §4.3/§8):
 *
 *   POST   /api/session         Firebase ID token → estate_session row + Set-Cookie
 *   POST   /api/session/token   estate_session cookie → freshly minted Firebase custom token
 *   DELETE /api/session         clear the cookie + soft-revoke the row
 *
 * ⚠️ This is a SIGN-IN CONVENIENCE layer only — §6 of estate-auth-design.md
 * and §7.1 of sso-design.md are explicit that no Worker anywhere trusts this
 * cookie for authorization. All it can produce is a custom token for the
 * SAME uid the cookie's owner already proved with their own Firebase ID
 * token at /api/session time. Enforcement stays exactly where it always
 * was: ID token verification + the estate directory (estate.ts, every
 * app's own middleware).
 *
 * CORS is mounted in index.ts (sessionCors(), credentialed, exactly the
 * four estate origins) — BEFORE these routes, same tokenless-preflight
 * reasoning as every other CORS mount in this Worker.
 */

import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { resolveIdentity } from '@platform/estate-auth';
import type { AppBindings } from './env.js';
import { parseOwnerEmails } from './env.js';
import { getUserByEmail } from './estate-db.js';
import { b64url } from './firebase-sa.js';
import { createSession, getSession, revokeSession, sessionIsLive, touchSession, SESSION_TTL_SECONDS } from './session-db.js';
import { mintCustomToken, tokenSignerOrUnset, CUSTOM_TOKEN_TTL_SECONDS } from './token-signer.js';

/** The cookie name (design §4.3). */
export const SESSION_COOKIE = 'estate_session';

/** design §4.3's exact attribute list, minus Domain (env-driven, see cookieOptions below). */
function cookieOptions(env: AppBindings['Bindings'], maxAgeSeconds: number) {
  return {
    domain: env.COOKIE_DOMAIN ?? '.heygabi.ai',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax' as const,
    maxAge: maxAgeSeconds,
  };
}

/** A 128-bit opaque id, base64url — nothing to decode offline (§7.1). */
function newSessionId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * The worded refusal for a token that verified but names no account id.
 *
 * ⚠️ **It is a named export because it is the only way it can be TESTED.**
 * Reaching the branch through the route needs a Firebase ID token that passes
 * a real JWKS verification and yet carries no `sub` — this suite has no such
 * token and will not mint one, so a test that drove the route could only ever
 * cover the branches it can already reach. Pinning the sentence here is the
 * honest instrument: it asserts the wording contract, and `session.test.ts`
 * says out loud that the branch itself is unexercised.
 *
 * Three clauses, in the order the estate's refusal rule names them — what
 * happened / what it needs / how to get it — and no `uid`, `sub` or `token`,
 * because none of those is a thing the reader can go and fix.
 */
export const SESSION_NO_UID_DETAIL =
  'Your sign-in was verified but came back without the account id the estate uses to ' +
  'identify you, so no estate session was created. It needs a Google account this estate ' +
  'can name — signing in again from the front door at https://heygabi.ai usually settles ' +
  'it. If it happens twice, ask the estate owner to check your account rather than ' +
  'retrying, because nothing you can change in this browser will fix it.';

export const sessionRoutes = new Hono<AppBindings>();

// ---------------------------------------------------------------------------
// POST /api/session — the ID-token → cookie exchange. Runs once, after an
// interactive sign-in on ANY estate surface (design's flow diagram, §4.3).
// ---------------------------------------------------------------------------
sessionRoutes.post('/session', async (c) => {
  let identity;
  try {
    identity = await resolveIdentity(c.req.raw, c.env);
  } catch (err) {
    return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
  }
  // ⚠️ The `error` CODE stays exactly `unauthenticated` — tools/estate-probes
  // asserts it across this Worker's whole unauthenticated edge and every page's
  // failure wording branches on it. The `detail` is ADDITIVE (2026-09-05), and
  // the audience is a BROWSER MID-SIGN-IN: whoever meets this has a half-
  // finished sign-in, so the sentence says where to start it again rather than
  // naming a header they cannot set.
  if (!identity)
    return c.json(
      {
        error: 'unauthenticated',
        detail:
          'Your sign-in did not carry a verified Google identity, so no estate session was ' +
          'created. Sign in again from the front door at https://heygabi.ai and let it finish; ' +
          'if it keeps stopping here, sign out of Google in this browser and sign in once more.',
      },
      401,
    );
  // A token verified by the canonical module always carries a `sub` (uid) —
  // guarded here anyway because a session that could name no uid could mint
  // nothing later (session-db.ts's NOT NULL), so failing loudly now beats a
  // confusing failure at mint time.
  //
  // ⚠️ The `error` CODE stays exactly `unauthenticated`, for the same reason as
  // the branch above: tools/estate-probes asserts it across this Worker's whole
  // unauthenticated edge and every page's failure wording branches on it.
  // ⚠️ The `detail` was the technical `'token carries no uid'` until 2026-09-05,
  // which is a sentence for whoever wrote this file and nobody else. The person
  // who meets it is a BROWSER MID-SIGN-IN, exactly as above, so it says what
  // happened, what it needs, and how to get it — in that order — and it does
  // NOT name `uid`, `sub` or the token, because none of those is a thing the
  // reader can go and fix. It is deliberately NOT the same sentence as the
  // branch above: this one survived verification and still cannot be used, so
  // "sign in again" alone would loop them, and the escalation matters.
  if (!identity.uid) return c.json({ error: 'unauthenticated', detail: SESSION_NO_UID_DETAIL }, 401);

  const email = identity.email.trim().toLowerCase();
  const id = newSessionId();
  const row = await createSession(c.env.DB, { id, email, firebaseUid: identity.uid });

  setCookie(c, SESSION_COOKIE, id, cookieOptions(c.env, SESSION_TTL_SECONDS));

  return c.json({ ok: true, expires_at: row.expires_at });
});

// ---------------------------------------------------------------------------
// POST /api/session/token — cookie → freshly minted custom token. Any OTHER
// estate origin calls this on load when it has no local Firebase session
// (design's flow diagram). Session validity is checked BEFORE the signer
// key so a caller with no session learns nothing about whether the key is
// configured — the same "auth gate outranks config-error" ordering as
// requireApprover()/requireDevops() vs the 503-unset routes elsewhere.
// ---------------------------------------------------------------------------
sessionRoutes.post('/session/token', async (c) => {
  const id = getCookie(c, SESSION_COOKIE);
  if (!id) return c.json({ error: 'no_session' }, 401);

  const row = await getSession(c.env.DB, id);
  if (!row) return c.json({ error: 'no_session' }, 401);
  if (row.revoked_at !== null) return c.json({ error: 'session_revoked' }, 401);
  if (!sessionIsLive(row)) return c.json({ error: 'session_expired' }, 401);

  // ⚠️ THE ESTATE-REVOCATION CHECK — design §4.3's flow names it explicitly
  // ("cookie → session row live? → estate_user.status ≠ revoked? → mint")
  // and it was missing from the Phase 2 build; added 2026-08-18 with Phase 3,
  // BEFORE any surface could call this for real.
  //
  // Why it matters even though no Worker trusts this cookie for authority:
  // the estate's revocation promise is "every door shuts within minutes".
  // Without this check a revoked member kept minting sign-in sessions on
  // every estate surface for up to the cookie's 30 days. Their API calls
  // would still have been refused (every consumer verifies the ID token and
  // consults the directory with the §3.1 10-minute TTL — that enforcement is
  // untouched by this design and was never the hole), but they would have
  // gone on being SIGNED IN estate-wide, name on the audiobook UI included,
  // long after the estate said otherwise. That is a revocation promise the
  // owner would reasonably believe was kept and that was not being kept.
  //
  // Deliberately refuses ONLY an explicit `revoked` row. A MISSING row is not
  // a revocation — it is a person the directory has not met yet (enrollment
  // is the /hello and /seen pipes' job, not this route's), and failing closed
  // on absence would turn a directory hiccup into an estate-wide sign-out.
  // The owner break-glass comes first for the same reason it does everywhere
  // else: an incident that corrupts the directory must never lock the owner
  // out of the admin page he would fix it from.
  const email = row.email.trim().toLowerCase();
  if (!parseOwnerEmails(c.env.OWNER_EMAILS).includes(email)) {
    const member = await getUserByEmail(c.env.DB, email);
    if (member && member.status === 'revoked') {
      // Kill the session row too, so a revoked member stops re-asking every
      // page load: the estate said no once, and that answer is durable.
      await revokeSession(c.env.DB, id);
      return c.json({ error: 'estate_revoked' }, 403);
    }
  }

  const { sa, unset } = tokenSignerOrUnset(c.env.TOKEN_SIGNER_KEY);
  if (!sa) return c.json(unset, 503);

  const token = await mintCustomToken(sa, row.firebase_uid);

  // 30-day ROLLING (owner Q6): an active device's session and its cookie
  // both roll forward on every successful mint, never just the D1 row alone.
  const expiresAt = await touchSession(c.env.DB, id);
  setCookie(c, SESSION_COOKIE, id, cookieOptions(c.env, SESSION_TTL_SECONDS));

  return c.json({ token, expires_in: CUSTOM_TOKEN_TTL_SECONDS, session_expires_at: expiresAt });
});

// ---------------------------------------------------------------------------
// DELETE /api/session — sign-out: LOCAL + cookie-clear (owner Q4). Never
// requires the ID token — possessing the cookie is sufficient to end the
// very session it identifies, which is strictly less powerful than what
// possessing it already grants (minting a token for that same uid).
// Idempotent: no cookie, an unknown id, or an already-revoked row all
// answer the same { ok: true } rather than leaking which case it was.
// ---------------------------------------------------------------------------
sessionRoutes.delete('/session', async (c) => {
  const id = getCookie(c, SESSION_COOKIE);
  if (id) {
    await revokeSession(c.env.DB, id);
  }
  deleteCookie(c, SESSION_COOKIE, { domain: c.env.COOKIE_DOMAIN ?? '.heygabi.ai', path: '/' });
  return c.json({ ok: true });
});
