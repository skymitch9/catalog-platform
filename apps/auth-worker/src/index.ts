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
app.use('/api/estate/site-roles', adminCors());
// Operations: "run the audiobook pipeline now" — apex-only, same as every
// other admin-page control (the status page's Operations section lives on
// the apex, not on a wider origin).
app.use('/api/estate/ops/pipeline', adminCors());
// The todo board (auth-locked 2026-08-15) — apex-only, same reasoning as
// every other admin-page surface: the shim that calls this lives on the
// apex and nowhere else.
app.use('/api/estate/todo', adminCors());
// Unlisted estate docs (0003 devops) — apex-only like /todo: the only shim
// that calls this lives on the apex (an unlisted /r/<slug>/ page).
app.use('/api/estate/docs/*', adminCors());

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
app.route('/api', docsRoutes);
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
