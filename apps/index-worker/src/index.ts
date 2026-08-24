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
 * ✅ LIVE at `index.heygabi.ai`. (This header said "⚠️ NOT DEPLOYED YET" until
 * 2026-08-23 — stale by six days and counting: `docs/deploys.log` records
 * index-worker deploys from 2026-08-17T06:41Z onward, and the design doc's own
 * status note has it live with all three sources pushed since 2026-08-14. A
 * banner that says a live Worker is unshipped is worse than no banner, because
 * it is the first thing a session reads and it argues against deploying.)
 * Local exercise is still `wrangler dev` + `npm run probe`; the live suite is
 * `npm run probe:estate` from the repo root.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { reportEvent } from '@platform/estate-events';
import type { Env } from './env.js';
import { machineRoutes } from './machine-route.js';
import { pushRoutes } from './push.js';
import { readRoutes } from './read.js';
import { scanRoutes } from './scan.js';
import { searchRoutes } from './search-route.js';
import { seriesRoutes } from './series-route.js';
import { healthRoutes } from './health.js';
import { requireEstateMember } from './middleware/auth.js';
import type { ScopeVariables } from './middleware/scope.js';

const app = new Hono<{ Bindings: Env; Variables: ScopeVariables }>();

// Machine route, BEFORE the blanket by name: pushers are machines with their
// own per-source bearer tokens (push.ts), not people — §8.2 #3's named
// exception, the library's ingest-route precedent.
app.route('/api/push', pushRoutes);

// The machine READ exception, also BEFORE the blanket by name (2026-08-23,
// owner-approved widening of design §9 Q3). A sibling Worker holds no
// Firebase ID token and cannot mint one, so requireEstateMember() refuses it
// by construction — and the push tokens authenticate writes only. These two
// routes take a per-app `INDEX_READ_TOKEN_*` bearer, resolve the caller to an
// APPROVED MEMBER's visibility set, and delegate to the very same handlers the
// human routes mount. The full argument, and what slice it resolves to, is
// machine-route.ts's header.
//
// ⚠️ Mounted ABOVE readCors() deliberately: no CORS headers, so no browser can
// call these cross-origin. A machine `fetch` never preflights, and the read
// token must never be somewhere a browser could hold it.
app.route('/api/machine', machineRoutes);

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

// The series registry (migration 0004 / series-route.ts). Mounted HERE, below
// the blanket and unnamed above it, on purpose: it is /api/universe's sibling
// — a browse of one name across every catalog — so it takes /api/universe's
// stance (members-only, scoped to the member's visibility set) rather than
// /api/search's anonymous carve-out, which §4.5 grants to search alone. The
// confirm queue inside it carries its own approver gate on top.
app.route('/api', seriesRoutes);

// Shelf/cover-photo identify (docs/info/estate-scan-adoption.md, the
// barcode build's deferred second deploy). Mounted here, not named above the
// blanket: unlike /api/search this read has no anonymous carve-out — vision
// costs money, so a tokenless caller must get the sign-in prompt like every
// other route in this block, not a free shot at the model.
app.route('/api', scanRoutes);

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
    // ⚠️ POST belongs here: two write routes sit under `/api/*` — /api/scan/shelf
    // (scan.ts) and /api/series/pending/:fold (series-route.ts) — and the apex
    // already calls /api/scan/shelf cross-origin with an Authorization header,
    // which makes the browser PREFLIGHT. With GET,OPTIONS only, the preflight
    // answered without POST and the browser refused the POST before sending it,
    // surfacing as a bare "network" error (audit F5; the same CORS-mount class
    // as the 2026-08-14 search preflight bug above).
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
}

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('unhandled', err);
  // ⚠️ LOG *AND* REPORT — never report instead of logging. Workers Logs still
  // has everything; the ring carries the handful of lines that should be in
  // front of someone looking at a red row on /status after the fact, with no
  // Cloudflare token in a browser (docs/info/worker-event-ring.md §1).
  //
  // ⚠️ ONLY unhandled errors are reported from here. Not 4xx refusals, not
  // cache misses, not "ok": the ring is capped PER WORKER and evicts
  // oldest-first, so a chatty writer deletes its own history and the row that
  // mattered is the one that goes. Widening this is an Opus-tier judgement
  // call (§"Model guidance"), not a convenience edit.
  //
  // ⚠️ It cannot throw and cannot delay the response — reportEvent swallows
  // every failure and rides waitUntil. An error handler that can fail turns
  // one 500 into a loop.
  reportEvent(c.executionCtx, {
    endpoint: c.env.ESTATE_AUTH_URL ?? 'https://auth.heygabi.ai',
    token: c.env.ESTATE_EVENTS_TOKEN,
    worker: 'catalog-index',
    level: 'error',
    message: err.message || 'unhandled error',
    route: new URL(c.req.url).pathname,
    detail: (err.stack || '').slice(0, 2000),
  });
  return c.json({ error: 'internal', detail: err.message }, 500);
});

// Exported for the wiring tests (test/auth.test.ts), which exercise THIS app
// object — mounting order included — rather than a reconstruction of it.
export { app };

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
