/**
 * The estate auth Worker — entrypoint. Wiring only; every decision lives in
 * a sibling module (estate.ts routes, estate-db.ts data, middleware/).
 *
 * What this is: the MEMBERSHIP layer of estate-auth-design.md — one row per
 * person, pending/approved/revoked, consulted by every consumer AFTER local
 * token verification and cached per-app with the 10-minute revocation delay.
 * The estate answers in/out; the apps answer what/here.
 *
 * ⚠️ NOT DEPLOYED, ON PURPOSE — deploy, route (auth.heygabi.ai) and the
 * remote migration are the dispatcher's (§9 step 2). Everything here is
 * exercised via `wrangler dev` against local D1 (`npm run probe`).
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { declareAuthPosture } from '@platform/estate-auth';
import type { AppBindings } from './env.js';
import { parseAdminOrigins, parseSessionOrigins } from './env.js';
import { estateRoutes } from './estate.js';
import { siteRolesRoutes } from './site-roles.js';
import { opsRoutes } from './ops.js';
import { todoRoutes } from './todo.js';
import { docsRoutes } from './docs.js';
import { estateDocsRoutes } from './estate-docs.js';
import { factsRoutes } from './facts.js';
import { backupsRoutes } from './backups.js';
import { sessionRoutes } from './session.js';
import { proxyFirebaseAuth } from './auth-proxy.js';
import { rateLimit } from './middleware/rate-limit.js';

/**
 * The greppable posture declaration (owner decision #1). Not public: every
 * route except /api/health carries a credential check. No defaultRole — the
 * directory has no role vocabulary to grant.
 */
export const AUTH_POSTURE = declareAuthPosture({
  public: false,
  app: 'auth',
  defaultRole: null,
});

const app = new Hono<AppBindings>();

// ---------------------------------------------------------------------------
// PHASE 1 (sso-design.md §4.1/§8): the Firebase auth-helper proxy. Mounted
// FIRST, before every other route (including the rate limiter and the /api
// tree below) — it must never be shadowed, and it is its own edge: Firebase
// itself, not this Worker, is the thing being reverse-proxied here, so the
// estate's own auth checks (and its rate limiter, sized for the directory's
// own traffic, not an OAuth ceremony's asset fetches) do not apply to it.
// True proxy, no redirect — see auth-proxy.ts for why that matters.
// ---------------------------------------------------------------------------
app.all('/__/auth/*', (c) => proxyFirebaseAuth(c.req.raw));

// Anti-abuse floor on the whole surface (fails open without the binding).
app.use('/api/*', rateLimit());

// CORS on the admin API only — the admin UI lives on the APEX (owner
// decision #6), so browsers on exactly ADMIN_ORIGINS may call it.
// /seen and /health are not browser surfaces and get no CORS.
app.use('/api/estate/users', adminCors());
app.use('/api/estate/users/*', adminCors());
// The audiobook site-roles federation is admin-page surface too: apex only.
// The wildcard mount covers the ladder's /tree sub-route (role-ladder.ts /
// site-roles.ts) added 2026-08-16 — without it, that route's CORS falls
// through to no match at all (Hono CORS mounts are exact-or-wildcard, never
// prefix-implicit) and a browser preflight from the apex would be refused.
app.use('/api/estate/site-roles', adminCors());
app.use('/api/estate/site-roles/*', adminCors());
// Operations: "run the audiobook pipeline now" — apex-only, same as every
// other admin-page control (the status page's Operations section lives on
// the apex, not on a wider origin). Wildcard mount added 2026-08-16 for the
// fine-grained step control (POST .../pipeline/step) and the standalone
// shelf-server force-upload (POST .../pipeline/force-upload) — Hono CORS
// mounts are exact-or-wildcard, never prefix-implicit (see the site-roles
// mount below for the same pattern), so the bare exact mount alone would
// leave those two sub-routes with no CORS at all.
app.use('/api/estate/ops/pipeline', adminCors());
app.use('/api/estate/ops/pipeline/*', adminCors());
// The todo board (auth-locked 2026-08-15) — apex-only, same reasoning as
// every other admin-page surface: the shim that calls this lives on the
// apex and nowhere else.
app.use('/api/estate/todo', adminCors());
// Unlisted estate docs (0003 devops) — apex-only like /todo: the only shim
// that calls this lives on the apex (an unlisted /r/<slug>/ page).
// ⚠️ This ONE wildcard now covers TWO different route families, and that is
// deliberate rather than accidental: docs.ts's /estate/docs/:slug (curated
// runbook pages out of KV) AND estate-docs.ts's /estate/docs/search|section|
// receipt (the searchable corpus out of R2, GABI docs assistant phase 2).
// Both are requireDevops()-gated and both have exactly one browser caller on
// the apex — /runbooks/* for the first, /docs/ for the second — so one mount
// is correct and a second would only be a list that could drift.
app.use('/api/estate/docs/*', adminCors());
// Self-service build facts (0007, 2026-08-16) — apex-only, same reasoning:
// the only callers are the migration-page form and the runbook page, both
// on the apex. requireDevops()-gated (facts.ts), same tier as /docs and /ops.
app.use('/api/estate/facts/*', adminCors());
// Backup metadata (owner ask 2026-08-16) — apex-only like the surfaces
// above: the only caller is the status page's Operations section, on the
// apex. requireDevops()-gated (backups.ts), same tier as /docs and /ops.
app.use('/api/estate/backups', adminCors());

// CORS on /me alone — the one deliberately WIDER surface (ME_ORIGINS: apex +
// audiobook site). ⚠️ Mounted BEFORE the route so the tokenless OPTIONS
// preflight is answered by the middleware, never by the auth check — and
// confined to exactly this path so the admin API stays apex-only.
app.use('/api/estate/me', meCors());
// /hello (browser self-enrollment, 2026-08-15 — the audiobook-signup pipe)
// shares /me's origins EXACTLY: the same static sites allowed to ask "who am
// I?" are the ones whose sign-ins must reach the directory. Same middleware,
// so the two lists can never drift apart.
app.use('/api/estate/hello', meCors());

// CORS on /api/health alone — apex only, GET-only. The route itself
// (estate.ts) is already open by design; this only lets a BROWSER on
// heygabi.ai/status read it. Mounted before estateRoutes for the same
// preflight reasoning as adminCors/meCors above.
app.use('/api/health', healthCors());

// PHASE 2 (sso-design.md §4.3/§8): the session routes — CREDENTIALED CORS
// (Access-Control-Allow-Credentials, so Set-Cookie/cookie survive a
// cross-origin fetch) for exactly the four estate origins, never wider.
// Deliberately its OWN list, not ADMIN_ORIGINS (apex-only) or ME_ORIGINS
// (apex + audiobook): every estate surface must be able to POST its ID
// token here and later ask for a custom token, including library and games,
// which neither existing list admits. Mounted before sessionRoutes for the
// same tokenless-preflight reasoning as every CORS mount above.
app.use('/api/session', sessionCors());
app.use('/api/session/token', sessionCors());

app.route('/api', estateRoutes);
app.route('/api', siteRolesRoutes);
app.route('/api', opsRoutes);
app.route('/api', todoRoutes);
// ⚠️ ORDER IS LOAD-BEARING: estateDocsRoutes BEFORE docsRoutes.
// docsRoutes owns GET /estate/docs/:slug, and its slug pattern
// ([a-z0-9-]{1,64}) matches "search", "section" and "receipt" perfectly well.
// If it were mounted first, the three corpus routes below would be swallowed
// and answer 404 not_found — a KV miss, which reads as "that document has not
// been written yet" and nothing at all like a routing bug. Pinned by
// test/estate-docs.test.ts, which composes these two mounts in THIS order and
// asserts a real request reaches the corpus handler.
app.route('/api', estateDocsRoutes);
app.route('/api', docsRoutes);
app.route('/api', factsRoutes);
app.route('/api', backupsRoutes);
app.route('/api', sessionRoutes);

function adminCors() {
  return cors({
    origin: (origin, c) => {
      const allowed = parseAdminOrigins(c.env.ADMIN_ORIGINS);
      return allowed.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
}

/** The estate status page — apex only, GET-only, no Authorization needed. */
function healthCors() {
  return cors({
    origin: 'https://heygabi.ai',
    allowMethods: ['GET', 'OPTIONS'],
    maxAge: 600,
  });
}

function meCors() {
  return cors({
    origin: (origin, c) => {
      // Falls back to ADMIN_ORIGINS when ME_ORIGINS is unset (a fresh .dev.vars),
      // which fails in the NARROW direction — never wider than the apex.
      const allowed = parseAdminOrigins(c.env.ME_ORIGINS ?? c.env.ADMIN_ORIGINS);
      return allowed.includes(origin) ? origin : null;
    },
    // POST is /hello's (self-enrollment); /me itself only ever answers GET.
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
}

/**
 * Credentialed CORS for the three session routes (design §4.3/§7) — the
 * ONE credentialed surface in this Worker. `credentials: true` sets
 * Access-Control-Allow-Credentials so a cross-origin `fetch(..., {
 * credentials: 'include' })` can both receive the Set-Cookie on
 * POST /api/session and send the cookie back on POST /api/session/token.
 * Hono's cors() refuses `origin: '*'` together with credentials by
 * construction — an exact-origin allow-list is required either way, which
 * is what SESSION_ORIGINS already is (env.ts).
 */
function sessionCors() {
  return cors({
    origin: (origin, c) => {
      const allowed = parseSessionOrigins(c.env.SESSION_ORIGINS);
      return allowed.includes(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
}

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('unhandled', err);
  return c.json({ error: 'internal', detail: err.message }, 500);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<AppBindings['Bindings']>;
