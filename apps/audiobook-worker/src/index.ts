/**
 * The audiobook-worker — Phase 0 of the audiobook auth migration
 * (docs/info/audiobook-auth-migration.md §2, §5), the FOURTH consumer of
 * the estate's proven pattern: the canonical verifier + `/seen` with a
 * per-app bearer, imported DIRECTLY from `@platform/estate-auth` (same
 * repo, no sync script — the reason §2 puts this Worker here).
 *
 * Deliberately its OWN thin Worker, not routes on auth-worker: "the estate
 * answers in/out; the apps answer what/here" — a bug in a future club
 * endpoint must never be able to take down grant/revoke for every app.
 *
 * Surface:
 *   GET  /api/health       open; liveness + the current estate-check mode.
 *   GET  /api/me           server-verified Firebase token → estate status +
 *                          audiobook ladder role (site_roles/{uid} via the
 *                          service account) + the §6 capability answer.
 *   POST /api/gate/shadow  the would-deny telemetry receiver (gate-shadow.ts;
 *                          204 always, logs only, enforces nothing).
 *   GET  /api/ebooks/manifest  the household ebook shelf, behind the estate's
 *                          `ebooks` visibility grant (ebooks.ts). ⚠️ The one
 *                          route here that gates UNCONDITIONALLY — it carries
 *                          no ESTATE_CHECK mode switch, by design: the mode
 *                          exists to shadow an existing behaviour, and a shelf
 *                          that serves in shadow mode is an ungated shelf.
 *   Phase 3 wave A writes  enforce-routes.ts — ⚠️ DORMANT: every one answers
 *                          503 not_enabled (touching nothing) unless
 *                          ESTATE_CHECK === 'enforce', which is the OWNER'S
 *                          flip on soak evidence, never a deploy side effect.
 *
 * Refusals follow the standing rule (ROLES.md §1e): never a bare status —
 * what happened, what it needs, how to get it; the causes kept distinct
 * (not signed in ≠ misconfigured ≠ the role store not answering).
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { declareAuthPosture, resolveIdentity } from '@platform/estate-auth';
import { parseServiceAccount } from '@platform/firebase-sa';
import { estateCheckMode, parseOwnerEmails, parseSiteOrigins, type Env } from './env.js';
import { ebookRoutes } from './ebooks.js';
import { enforceRoutes } from './enforce-routes.js';
import { estateStatusFor } from './estate-status.js';
import { gateShadowRoutes } from './gate-shadow.js';
import { meAnswer } from './me.js';
import { cachedStoredRole } from './roles.js';

/**
 * The per-surface posture declaration (owner decision #1): the DATA surface
 * (/api/me, and every Phase 3+ write route to come) sits behind the
 * canonical verifier, on the record. /api/health answers liveness only and
 * /api/gate/shadow answers nothing at all (204, no body) — neither returns
 * data. `defaultRole: null` because estate approval grants NO audiobook
 * ladder rung (§6: member+ are rungs "nobody migrates into"; the estate
 * answers in/out, site_roles answers what).
 */
export const AUTH_POSTURE = declareAuthPosture({
  public: false,
  app: 'audiobook',
  defaultRole: null,
});

const app = new Hono<{ Bindings: Env }>();

/**
 * Exact-origin CORS on the whole /api surface — the meCors() pattern
 * (migration design §2): the audiobook site's own origins, nothing wider.
 * Mounted BEFORE the routes so the tokenless OPTIONS preflight is answered
 * by the middleware, never by an auth check.
 */
function abCors() {
  return cors({
    origin: (origin, c) => {
      const allowed = parseSiteOrigins(c.env.SITE_ORIGINS);
      return allowed.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
}
app.use('/api/*', abCors());

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'audiobook-worker',
    time: new Date().toISOString(),
    estate_check: estateCheckMode(c.env.ESTATE_CHECK),
  }),
);

app.get('/api/me', async (c) => {
  // 1. Identity — verified LOCALLY (the canonical verifier; §5.1 no central
  //    call). A verifier misconfiguration is OUR 500, never the caller's 401.
  let identity;
  try {
    identity = await resolveIdentity(c.req.raw, c.env);
  } catch (err) {
    return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
  }
  if (!identity) {
    return c.json(
      {
        error: 'unauthenticated',
        detail:
          'You are not signed in. Sign in with Google on the audiobook site to get an answer about your own role — signed-out visitors browse as guests.',
      },
      401,
    );
  }
  const email = identity.email.trim().toLowerCase();
  const ownerEmails = parseOwnerEmails(c.env.OWNER_EMAILS);
  const mode = estateCheckMode(c.env.ESTATE_CHECK);

  // 2. Estate status — consulted (and cached) only when a mode says to.
  //    Reported alongside either way; 'off' honestly reports null.
  const estate =
    mode === 'off'
      ? { status: null, stale: false, configured: false }
      : await estateStatusFor(c.env, {
          email,
          firebaseUid: identity.uid,
          displayName: identity.name,
        });

  // 3. The stored ladder role, via the service account (site_roles/{uid} is
  //    browser-unreadable beyond own-doc gets; the SA read is the server
  //    path). Owners skip the round-trip: OWNER_EMAILS always wins.
  let storedRole: string | null = null;
  if (!ownerEmails.includes(email) && identity.uid) {
    let sa;
    try {
      sa = parseServiceAccount(c.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (err) {
      return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
    }
    if (!sa) {
      return c.json(
        { error: 'service_account_unset', fix: 'wrangler secret put FIREBASE_SERVICE_ACCOUNT' },
        503,
      );
    }
    const read = await cachedStoredRole(sa, identity.uid);
    if (!read.ok) {
      return c.json(
        {
          error: 'firestore_error',
          status: read.status,
          detail:
            'The role store did not answer, so your role cannot be resolved right now. This is an outage, not a permission decision — try again shortly.',
        },
        502,
      );
    }
    storedRole = read.role;
  }

  return c.json(
    meAnswer({
      email,
      ownerEmails,
      storedRole,
      mode,
      estateStatus: estate.status,
      estateStale: estate.stale,
    }),
  );
});

app.route('/api', gateShadowRoutes);

// The ebook shelf's gated manifest (owner directive 2026-08-17). Mounted at
// the root because the route carries its own full path; the abCors() blanket
// above already covers /api/*, so the tokenless OPTIONS preflight is answered
// by the middleware and never by the auth check.
app.route('/', ebookRoutes);

// Phase 3 wave A — the prebuilt write routes, DORMANT until the owner flips
// ESTATE_CHECK to 'enforce' (enforce-routes.ts carries its own mode gate as
// middleware; mounting here changes nothing in off/shadow by construction).
app.route('/', enforceRoutes);

export default app;
