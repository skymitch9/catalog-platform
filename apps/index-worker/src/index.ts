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
import type { Env } from './env.js';
import { pushRoutes } from './push.js';
import { readRoutes } from './read.js';
import { healthRoutes } from './health.js';
import { requireEstateMember } from './middleware/auth.js';

const app = new Hono<{ Bindings: Env }>();

// Machine route, BEFORE the blanket by name: pushers are machines with their
// own per-source bearer tokens (push.ts), not people — §8.2 #3's named
// exception, the library's ingest-route precedent.
app.route('/api/push', pushRoutes);

// Open by design: counts and timestamps only (health.ts says why).
app.route('/api/health', healthRoutes);

// The blanket. Every /api route below this line is estate-members-only.
app.use('/api/*', requireEstateMember());

app.route('/api', readRoutes);

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
