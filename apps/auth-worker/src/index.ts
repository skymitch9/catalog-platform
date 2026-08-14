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
import { parseAdminOrigins } from './env.js';
import { estateRoutes } from './estate.js';
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

// Anti-abuse floor on the whole surface (fails open without the binding).
app.use('/api/*', rateLimit());

// CORS on the admin API only — the admin UI lives on the APEX (owner
// decision #6), so browsers on exactly ADMIN_ORIGINS may call it.
// /seen and /health are not browser surfaces and get no CORS.
app.use('/api/estate/users', adminCors());
app.use('/api/estate/users/*', adminCors());

// CORS on /me alone — the one deliberately WIDER surface (ME_ORIGINS: apex +
// audiobook site). ⚠️ Mounted BEFORE the route so the tokenless OPTIONS
// preflight is answered by the middleware, never by the auth check — and
// confined to exactly this path so the admin API stays apex-only.
app.use('/api/estate/me', meCors());

app.route('/api', estateRoutes);

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

function meCors() {
  return cors({
    origin: (origin, c) => {
      // Falls back to ADMIN_ORIGINS when ME_ORIGINS is unset (a fresh .dev.vars),
      // which fails in the NARROW direction — never wider than the apex.
      const allowed = parseAdminOrigins(c.env.ME_ORIGINS ?? c.env.ADMIN_ORIGINS);
      return allowed.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'OPTIONS'],
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
