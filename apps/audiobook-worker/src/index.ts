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
 *   GET|HEAD /api/ebook/:anchor/file
 *                          the viewer's gated BYTE STREAM (ebook-file.ts):
 *                          Range/206, Accept-Ranges, no-store, the R2 body
 *                          passed through unbuffered. Same gate as the shelf
 *                          (ebook-gate.ts), same unconditional posture. ⚠️ It
 *                          gates on the estate's `vis_ebooks` READ grant, NOT
 *                          on the ladder's `download` capability (admin+).
 *   GET  /api/audio/status the projection of what is streamable right now
 *                          (audio-status.ts) — bookId/anchor/title/size/since
 *                          and ⚠️ never `path`. Same gate.
 *   GET|HEAD /api/audio/:anchor/file
 *                          the audiobook BYTE STREAM (audio-file.ts), a
 *                          near-copy of the ebook one per design §7.2: shares
 *                          range.ts and the gate, copies the rest. ⚠️ Gated on
 *                          the SAME `vis_ebooks` grant — owner decision 1,
 *                          2026-08-17: "MIRROR EBOOK if they can read an ebook
 *                          they can listen to an audio." Its own budget
 *                          (listen-budget.ts), sized for hours of ranges
 *                          instead of one book-open.
 *   GET  /api/books/available   what is in GABI's knowledge base RIGHT NOW
 *                          (book-routes.ts) — an R2 LISTING, not a compiled-in
 *                          list, so a book ingested overnight is answerable in
 *                          the morning with no deploy.
 *   GET  /api/books/presence   one term rolled up across up to 6 books:
 *                          hits, first sighting, and ⚠️ zero as a real answer.
 *   GET  /api/book/:bookId/search   the four retrieval modes (relevant /
 *                          latest / earliest / presence), server-side scoped by
 *                          a ceiling DERIVED from the question every turn, and
 *                          returned as the hit stitched with its ±1 neighbours.
 *   GET  /api/book/:bookId/passage  one passage by ord, same gate, same ceiling.
 *                          ⚠️ All four also accept an app bearer + the asker's
 *                          proven email (door B), for GABI's two chat surfaces.
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
import { reportEvent } from '@platform/estate-events';
import { parseServiceAccount } from '@platform/firebase-sa';
import { audioFileRoutes } from './audio-file.js';
import { audioStatusRoutes } from './audio-status.js';
import { bookRoutes } from './book-routes.js';
import { estateCheckMode, parseOwnerEmails, parseSiteOrigins, type Env } from './env.js';
import { ebookFileRoutes } from './ebook-file.js';
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
 * The /status event ring (docs/info/worker-event-ring.md), wired 2026-08-18.
 *
 * ⚠️ THIS WORKER HAD NO `onError` AT ALL, so unhandled errors fell through to
 * Hono's default 500 and existed only in Workers Logs. The handler is added
 * WITH the report rather than the report being bolted onto an existing one —
 * which means the shape of the 500 body is new here, deliberately kept to the
 * same `{error, detail}` the rest of this Worker's failures use so nothing
 * downstream meets an unfamiliar envelope.
 *
 * ⚠️ ONLY unhandled errors. Not the 401s, not the gate refusals, not a listen
 * budget running out — those are this Worker working correctly, and the ring
 * is capped per Worker and evicts oldest-first, so writing them would delete
 * the crash that mattered.
 *
 * ⚠️ It cannot throw and cannot delay the response: reportEvent swallows every
 * failure and rides waitUntil. An error handler that can fail turns one 500
 * into a loop.
 */
app.onError((err, c) => {
  console.error('unhandled', err);
  reportEvent(c.executionCtx, {
    endpoint: c.env.ESTATE_AUTH_URL ?? 'https://auth.heygabi.ai',
    token: c.env.ESTATE_EVENTS_TOKEN,
    worker: 'audiobook-worker',
    level: 'error',
    message: err.message || 'unhandled error',
    route: new URL(c.req.url).pathname,
    detail: (err.stack || '').slice(0, 2000),
  });
  return c.json({ error: 'internal', detail: err.message }, 500);
});

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
    allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // ⚠️ `Range` joined 2026-08-17 with the viewer's byte stream, and it is
    // NOT optional. `Range` is not a CORS-safelisted request header, so every
    // ranged fetch — 15 of them to open one EPUB, several per PDF page turn —
    // fires a preflight, and a preflight that does not name `Range` fails as
    // an opaque NETWORK error in the browser. That is indistinguishable from
    // "the Worker is down", which is exactly the misdiagnosis the estate
    // already ate once when a CSP silently blocked a subdomain.
    allowHeaders: ['Authorization', 'Content-Type', 'Range'],
    // ⚠️ And the reader must be able to READ these back. Cross-origin
    // JavaScript sees only the safelisted response headers unless they are
    // exposed, so without this pdf.js gets a 206 whose `Content-Range` it
    // cannot see and cannot lay the document out.
    exposeHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges', 'ETag', 'Retry-After'],
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

// The viewer's gated byte stream (phase 1a, 2026-08-17). Same gate as the
// shelf above — literally the same function (ebook-gate.ts) — and the same
// unconditional posture: a byte stream that served in shadow mode would be a
// public download endpoint. ⚠️ It gates on the estate's `vis_ebooks` READ
// grant and NOT on the ladder's `download` capability (admin+), which would
// lock ordinary members out of reading; see ebook-file.ts's header.
app.route('/', ebookFileRoutes);

// The audiobook player's two routes (audio phase 1, 2026-08-18). Same gate as
// the ebook pair — literally the same function (ebook-gate.ts) — because owner
// decision 1 fused the grants: one `vis_ebooks` means "may consume the estate's
// book files", reading OR listening. ⚠️ Seeing the audiobook SITE is still
// `vis_audiobook` and is untouched; this is a gate on the BYTES.
//
// ⚠️ The status route is a PROJECTION, not the manifest — `path` never leaves
// (audio-status.ts's header). And the byte route carries its OWN budget
// (listen-budget.ts), because sharing read-budget.ts's counters would let a
// 13-hour listen exhaust a reader's page turns and vice versa.
app.route('/', audioStatusRoutes);
app.route('/', audioFileRoutes);

// The book-knowledge retrieval routes (design phase 3, 2026-08-18). Same gate as
// every route above — literally the same function (ebook-gate.ts) — because the
// derived text IS the book, chunked, and design decision 3 keeps it behind the
// grant that already guards the files it came from.
//
// ⚠️ These carry a SECOND door: an app bearer plus the asker's proven email, for
// GABI on Discord and in the site panel, which hold no Firebase token of the
// person asking. Both doors end at the same predicate — see book-routes.ts.
//
// ⚠️ They serve WHATEVER PACKS EXIST at query time, discovered by an R2 listing
// rather than compiled in, so a book ingested overnight is answerable in the
// morning with no deploy (owner requirement, docs/TODO.md status-page item 4).
app.route('/', bookRoutes);

// Phase 3 wave A — the prebuilt write routes, DORMANT until the owner flips
// ESTATE_CHECK to 'enforce' (enforce-routes.ts carries its own mode gate as
// middleware; mounting here changes nothing in off/shadow by construction).
app.route('/', enforceRoutes);

export default app;
