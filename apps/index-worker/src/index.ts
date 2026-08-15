/**
 * The shared index Worker — entrypoint. Wiring only; every decision lives in
 * a sibling module (fold.ts, rows.ts, push.ts, read.ts, health.ts,
 * middleware/auth.ts, universes.ts).
 *
 * What this is: the cross-catalog index of PLATFORM.md §5, designed for real
 * in docs/info/index-worker-design.md. One D1 row per catalogued thing across
 * the three catalogs — POINTERS, NEVER TRUTH. Sources push full snapshots of
 * a default-deny projection; the index folds join keys on write, joins at two
 * tiers (work: books only; universe: the only tier games join), and answers
 * "do I own this in any format?" without a script.
 *
 * Auth (estate-auth-design.md §7.1, closing this Worker's §9 Q3): reads are
 * ESTATE MEMBERS ONLY — the first consumer of the canonical estate-auth
 * module, adopted first because it has zero users (§9 step 3). Mounting order
 * IS the auth design (conformance §8.2 #3): machine and open routes sit
 * before the blanket, BY NAME, each with its reason; everything mounted after
 * the blanket is members-only automatically.
 *
 * ⚠️ NOT DEPLOYED YET — deploy, the remote 0002 migration, and the
 * ESTATE_APP_TOKEN_INDEX secret are the dispatcher's (§9 step 3's second
 * half). Everything here is exercised via `wrangler dev` + `npm run probe`.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env.js';
import { pushRoutes } from './push.js';
import { readRoutes } from './read.js';
import { searchRoutes } from './search-route.js';
import { healthRoutes } from './health.js';
import { requireEstateMember } from './middleware/auth.js';
import type { ScopeVariables } from './middleware/scope.js';

const app = new Hono<{ Bindings: Env; Variables: ScopeVariables }>();

// Machine route, BEFORE the blanket by name: pushers are machines with their
// own per-source bearer tokens (push.ts), not people — §8.2 #3's named
// exception, the library's ingest-route precedent.
app.route('/api/push', pushRoutes);

// CORS for the estate status page (heygabi.ai/status), GET-only, no auth
// header needed — health.ts is already public, this only lets a BROWSER on
// the apex read it. Mounted before the route (same preflight reasoning as
// readCors below): an OPTIONS preflight carries no token and must not fall
// through to anything that could 401 it. Health has no other CORS-bearing
// mount ahead of it, so this is the one place to add it.
app.use('/api/health', healthCors());
// Open by design: counts and timestamps only (health.ts says why).
app.route('/api/health', healthRoutes);

// ⚠️ CORS BEFORE the auth blanket, and the ordering is the whole bug it fixes.
// The apex search page fetches these reads cross-origin with an Authorization
// header, which makes the browser send a PREFLIGHT — an OPTIONS request that
// deliberately carries no token. With auth mounted first, the preflight was
// answered 401, the browser reported a bare "network" error, and the first
// real user's first real search failed (found live, 2026-08-14, by the owner).
// hono/cors short-circuits OPTIONS itself, so mounting it here lets the
// preflight succeed while every actual GET still hits requireEstateMember.
// Origin allow-list mirrors the auth Worker's adminCors: the apex only.
app.use('/api/*', readCors());

// Scoped-not-gated, BEFORE the blanket by name (§8.2 #3's named-exception
// rule): /api/search is the ONE read the anonymous internet may use —
// estate design §4.5 resolves an absent/invalid token to the public slice
// ({audiobook}), a member to their effective visibility set, the revoked to
// {} — so its middleware (searchScope, in search-route.ts) never answers
// 401; the visibility set IS the answer. Lookup and universe stay below the
// blanket, members-only.
app.route('/api/search', searchRoutes);

// The blanket. Every /api route below this line is estate-members-only.
app.use('/api/*', requireEstateMember());

app.route('/api', readRoutes);

/** Locked to the apex — the estate status page is the only browser caller. */
function healthCors() {
  return cors({
    origin: 'https://heygabi.ai',
    allowMethods: ['GET', 'OPTIONS'],
    maxAge: 600,
  });
}

function readCors() {
  return cors({
    origin: (origin, c) => {
      const allowed = (c.env.READ_ORIGINS ?? 'https://heygabi.ai')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
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

// Exported for the wiring tests (test/auth.test.ts), which exercise THIS app
// object — mounting order included — rather than a reconstruction of it.
export { app };

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
