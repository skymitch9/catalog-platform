/**
 * The shared index Worker — entrypoint. Wiring only; every decision lives in
 * a sibling module (fold.ts, rows.ts, push.ts, read.ts, universes.ts).
 *
 * What this is: the cross-catalog index of PLATFORM.md §5, designed for real
 * in docs/info/index-worker-design.md. One D1 row per catalogued thing across
 * the three catalogs — POINTERS, NEVER TRUTH. Sources push full snapshots of
 * a default-deny projection; the index folds join keys on write, joins at two
 * tiers (work: books only; universe: the only tier games join), and answers
 * "do I own this in any format?" without a script.
 *
 * ⚠️ NOT DEPLOYED, ON PURPOSE. Read-surface auth is an open owner question
 * (design §9 Q3) and the deploy is gated on it. Everything here is exercised
 * via `wrangler dev`.
 */

import { Hono } from 'hono';
import type { Env } from './env.js';
import { pushRoutes } from './push.js';
import { readRoutes } from './read.js';

const app = new Hono<{ Bindings: Env }>();

app.route('/api/push', pushRoutes);
app.route('/api', readRoutes);

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('unhandled', err);
  return c.json({ error: 'internal', detail: err.message }, 500);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
