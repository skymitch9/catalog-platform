/**
 * THE WORKER EVENT RING — GET/POST /api/estate/ops/worker-events.
 *
 * Owner, 2026-08-18, after clicking into a health check and meeting the
 * "Not wired up yet" placeholder: **"fix this."**
 *
 * ⚠️ WHAT THIS IS NOT: a log aggregator. Workers already log to Cloudflare, and
 * `wrangler tail` already shows a live stream. This exists for the one thing
 * neither can do — put the handful of events that MATTER in front of a person
 * who is looking at a red row on /status, after the fact, without a Cloudflare
 * token in a browser. It is a noticeboard, not a log.
 *
 * ⚠️ THAT DISTINCTION IS THE DESIGN CONSTRAINT, not a caveat. If Workers write
 * everything here it becomes an expensive, capped, worse copy of Workers Logs
 * and the ring evicts the one row that mattered. Writers are told: errors,
 * refusals worth a human's attention, and deploy markers. Not requests, not
 * cache misses, not "ok".
 *
 * ── WHY A TOKEN-AUTH HTTP ENDPOINT AND NOT A SERVICE BINDING ────────────────
 *
 * A service binding would be tidier: no token, no network hop, no shared
 * secret to rotate. It was rejected for one reason that outweighs all of that —
 * **service bindings only bind Workers in the SAME Cloudflare account and
 * require every writer's wrangler.toml to name this Worker**, which makes each
 * new writer a config change in a repo this one does not own (library_catalog
 * and Board_Game_Catalog are separate repos with their own deploy cycles). A
 * bearer they already hold makes adopting the ring a code-only change in the
 * writer's repo, with no coordinated deploy.
 *
 * ⚠️ THE TOKEN IS NOT THE CONDUCTOR'S — MEASURED, NOT ASSUMED. The plan said
 * "a token the workers already hold"; `wrangler secret list` on 2026-08-18 says
 * they do not. index-worker holds only its three INDEX_PUSH_TOKEN_*, and
 * audiobook-worker only ESTATE_APP_TOKEN_BOOKS + FIREBASE_SERVICE_ACCOUNT. So a
 * secret is needed either way, which makes the choice a real one: a DEDICATED
 * `ESTATE_EVENTS_TOKEN`, not the conductor's. The conductor token can also
 * rewrite the agent board — the estate's whole picture of what is running —
 * whereas an events token's entire power is writing lines to a noticeboard.
 * Spreading the larger credential across three more Workers to save minting one
 * is the wrong trade. Full reasoning: docs/info/worker-event-ring.md §4.
 *
 * This route accepts the conductor token TODAY because it is the only bearer
 * that exists and the auth Worker already validates it; the moment a dedicated
 * secret is minted, `checkConductorAuth` here should accept either.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from './env.js';
import { requireDevops } from './middleware/auth.js';
import { checkConductorAuth, conductorRefusal } from './agent-board.js';

/**
 * Rows kept PER WORKER.
 *
 * ⚠️ Per worker, not global: one Worker having a bad night must not evict every
 * other Worker's history, which is exactly when the others are worth comparing
 * against. 200 is roughly a fortnight of "significant events only" at the rate
 * these Workers actually produce them, and small enough that the trim is cheap.
 */
export const EVENTS_PER_WORKER = 200;

/** Hard ceiling on one row, so a stack trace cannot become a database. */
export const MAX_MESSAGE = 2000;
export const MAX_DETAIL = 4000;
/** Refuse absurd batches outright rather than storing a slice of them. */
export const MAX_BATCH = 50;

export const EVENT_LEVELS = ['error', 'warn', 'info', 'deploy'] as const;
export type EventLevel = (typeof EVENT_LEVELS)[number];

export interface WorkerEvent {
  worker: string;
  level: EventLevel;
  message: string;
  at: string;
  route?: string | null;
  request_id?: string | null;
  detail?: string | null;
}

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * A posted body -> events to store, or a worded refusal.
 *
 * ⚠️ IT REFUSES, IT NEVER STRIPS — the estate's standing rule, and it matters
 * more here than usual: a Worker that believes it reported an error and did not
 * is strictly worse than one that never tried, because the silence is then
 * trusted.
 */
export function parseEvents(body: unknown, nowIso: string): { events: WorkerEvent[] } | { error: string; detail: string } {
  const list = Array.isArray(body) ? body : [body];
  if (!list.length) return { error: 'empty_batch', detail: 'Send one event object, or an array of them.' };
  if (list.length > MAX_BATCH) {
    return { error: 'batch_too_large', detail: `That batch has ${list.length} events and the limit is ${MAX_BATCH}.` };
  }

  const out: WorkerEvent[] = [];
  for (const raw of list) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: 'not_an_object', detail: 'Each event must be a JSON object with at least worker, level and message.' };
    }
    const e = raw as Record<string, unknown>;
    const worker = clean(e.worker, 64);
    const message = clean(e.message, MAX_MESSAGE);
    const level = clean(e.level, 16);
    if (!worker) return { error: 'missing_worker', detail: 'Every event must name the `worker` that produced it.' };
    if (!message) return { error: 'missing_message', detail: `An event from “${worker}” carried no \`message\`.` };
    if (!level || !EVENT_LEVELS.includes(level as EventLevel)) {
      return {
        error: 'bad_level',
        detail: `“${level ?? 'none'}” is not a level this ring understands. Use one of: ${EVENT_LEVELS.join(', ')}.`,
      };
    }
    // ⚠️ A missing or unreadable `at` falls back to the SERVER'S clock rather
    // than being refused: losing the event because a writer's clock is broken
    // would be the worse trade, and `received_at` records what actually
    // happened either way.
    const at = clean(e.at, 40);
    out.push({
      worker,
      level: level as EventLevel,
      message,
      at: at && Number.isFinite(Date.parse(at)) ? at : nowIso,
      route: clean(e.route, 200),
      request_id: clean(e.request_id, 100),
      detail: clean(e.detail, MAX_DETAIL),
    });
  }
  return { events: out };
}

export const workerEventsRoutes = new Hono<AppBindings>();

const TABLE_MISSING = {
  error: 'worker_events_table_missing',
  detail:
    'The worker event ring does not exist in this database — the Worker shipped ahead of its migration. ' +
    'Nothing is broken; no events are being recorded.',
  fix: 'npm run db:migrate (from apps/auth-worker) applies 0015_worker_events.sql remotely',
} as const;

/**
 * POST — a Worker reporting something worth seeing. Bearer only.
 *
 * ⚠️ THE TRIM RUNS ON WRITE, in the same request, and that is deliberate: a
 * separate cleanup job is a thing that can stop running without anyone
 * noticing, and the failure mode is a table that grows until it takes the
 * estate directory down with it. Trimming here costs one extra statement on an
 * indexed column and cannot be forgotten.
 */
workerEventsRoutes.post('/estate/ops/worker-events', async (c: Context<AppBindings>) => {
  const auth = checkConductorAuth(c.env.ESTATE_CONDUCTOR_TOKEN, c.req.header('Authorization') ?? null);
  if (auth !== 'ok') {
    const refusal = conductorRefusal(auth);
    return c.json(refusal.body, refusal.status);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', detail: 'That body is not valid JSON.' }, 400);
  }
  const nowIso = new Date().toISOString();
  const parsed = parseEvents(body, nowIso);
  if ('error' in parsed) return c.json(parsed, 400);

  try {
    const inserts = parsed.events.map((e) =>
      c.env.DB.prepare(
        'INSERT INTO worker_events (worker, level, message, at, received_at, route, request_id, detail) ' +
          'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
      ).bind(e.worker, e.level, e.message, e.at, nowIso, e.route, e.request_id, e.detail),
    );
    await c.env.DB.batch(inserts);

    // Trim each worker this batch touched, back to the cap.
    const touched = [...new Set(parsed.events.map((e) => e.worker))];
    await c.env.DB.batch(
      touched.map((w) =>
        c.env.DB.prepare(
          'DELETE FROM worker_events WHERE worker = ?1 AND id NOT IN ' +
            '(SELECT id FROM worker_events WHERE worker = ?1 ORDER BY id DESC LIMIT ?2)',
        ).bind(w, EVENTS_PER_WORKER),
      ),
    );
  } catch (err) {
    if (/no such table/i.test((err as Error).message || '')) return c.json(TABLE_MISSING, 503);
    return c.json({ error: 'worker_events_write_failed', detail: 'The estate database refused the write — nothing was stored.' }, 502);
  }
  return c.json({ ok: true, stored: parsed.events.length, received_at: nowIso });
});

/**
 * GET — a devops reader, in a browser.
 *
 * ⚠️ IT ALWAYS ANSWERS `since`, EVEN WHEN THE RING IS EMPTY, and the page is
 * required to render it. "No events recorded since <when the ring started>" is
 * a completely different sentence from "no errors", and an empty list with no
 * date attached will be read as the second one. That is the single most
 * dangerous thing this surface could imply, and it is why the placeholder it
 * replaces refused to show an empty box in the first place.
 */
workerEventsRoutes.get('/estate/ops/worker-events', requireDevops(), async (c: Context<AppBindings>) => {
  const limit = Math.min(Number(c.req.query('limit') || 100) || 100, 500);
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT worker, level, message, at, received_at, route, request_id, detail ' +
        'FROM worker_events ORDER BY id DESC LIMIT ?1',
    )
      .bind(limit)
      .all<Omit<WorkerEvent, 'level'> & { level: string; received_at: string }>();

    const oldest = await c.env.DB.prepare('SELECT MIN(received_at) AS since FROM worker_events')
      .first<{ since: string | null }>();

    return c.json({
      events: results ?? [],
      // ⚠️ `since` is when the ring first received ANYTHING. Null means nothing
      // has ever been written, which the page words as "the ring is live and no
      // Worker has reported yet" — not as silence.
      since: oldest?.since ?? null,
      per_worker_cap: EVENTS_PER_WORKER,
      now: new Date().toISOString(),
    });
  } catch (err) {
    if (/no such table/i.test((err as Error).message || '')) {
      return c.json({ ...TABLE_MISSING, events: [], since: null, per_worker_cap: EVENTS_PER_WORKER }, 503);
    }
    return c.json({ error: 'worker_events_unreadable', detail: 'The estate database did not answer.' }, 502);
  }
});

/**
 * The auth Worker writing to its OWN ring, with no token and no network hop.
 *
 * ⚠️ THIS WORKER IS THE ONE WRITER THAT NEEDS NO CREDENTIAL, because the ring
 * lives in the D1 it already binds. Every other Worker has to come through the
 * POST door above; this one would be posting to itself, which would cost a
 * subrequest and a secret for nothing.
 *
 * ⚠️ IT NEVER THROWS AND NEVER AWAITS ON THE HOT PATH. The rule from
 * `@platform/estate-events` applies with more force here: this is called from
 * the unhandled-error handler, so a failure inside it would turn one 500 into a
 * loop. Every path ends in a swallowed promise.
 */
export function recordOwnEvent(
  c: Context<AppBindings>,
  event: Omit<WorkerEvent, 'worker' | 'at'> & { worker?: string; at?: string },
): void {
  const nowIso = new Date().toISOString();
  const p = (async () => {
    try {
      await c.env.DB.prepare(
        'INSERT INTO worker_events (worker, level, message, at, received_at, route, request_id, detail) ' +
          'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
      )
        .bind(
          event.worker ?? 'estate-auth',
          event.level,
          String(event.message).slice(0, MAX_MESSAGE),
          event.at ?? nowIso,
          nowIso,
          event.route ?? null,
          event.request_id ?? null,
          event.detail ? String(event.detail).slice(0, MAX_DETAIL) : null,
        )
        .run();
      await c.env.DB.prepare(
        'DELETE FROM worker_events WHERE worker = ?1 AND id NOT IN ' +
          '(SELECT id FROM worker_events WHERE worker = ?1 ORDER BY id DESC LIMIT ?2)',
      )
        .bind(event.worker ?? 'estate-auth', EVENTS_PER_WORKER)
        .run();
    } catch {
      // Swallowed: the ring going quiet is a bad day; the error handler
      // throwing is an incident.
    }
  })();
  try {
    c.executionCtx?.waitUntil(p);
  } catch {
    /* no execution context (tests) — the write still runs, un-awaited */
  }
}

