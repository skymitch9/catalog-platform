/**
 * The conductor's AGENT BOARD — GET/POST /api/estate/ops/agent-board.
 *
 * Owner ask (2026-08-18, recorded in docs/TODO.md's "Ops IA — the /status
 * SPLIT"): a page that says which Claude agents are running, what has been
 * dispatched/landed/failed, and where the usage figures stand. None of that
 * is knowable from inside a Worker — it lives in a session on the owner's
 * home machine — so this is a PUSH surface, not a probe: the conductor POSTs
 * a JSON snapshot, and heygabi.ai/status/agents renders it with its age
 * stamped on the front.
 *
 * TWO DOORS ON ONE PATH, DELIBERATELY DIFFERENT:
 *
 *   GET   requireDevops()            — a person, in a browser, on the apex.
 *   POST  Bearer ESTATE_CONDUCTOR_TOKEN — a machine, with no Firebase identity
 *                                        and no browser to sign in with.
 *
 * ⚠️ THEY ARE NOT INTERCHANGEABLE AND MUST NOT BE MERGED. A devops person may
 * READ the board; nothing about holding devops should let a browser REWRITE
 * the estate's picture of what is running. And the conductor holds no Firebase
 * identity at all, so requiring one on the write door would mean minting a
 * service identity for a script — a much larger credential than a bearer whose
 * entire power is "overwrite one advisory JSON blob".
 *
 * ⚠️ WHAT HOLDING THE BEARER AUTHORISES: writing one row that this Worker
 * serves back to devops readers and nothing else. It reads no Firestore, mints
 * no token, grants no role, and triggers no pipeline. A leak buys the ability
 * to LIE to the owner about his own agent capacity — real, and worth rotating
 * for, but a smaller blast radius than every other secret in this Worker. The
 * page is built to make that lie visible anyway: every block is timestamped
 * and a stale push reads as stale.
 *
 * ⚠️ SHIPS DARK UNTIL THE SECRET IS SET. With ESTATE_CONDUCTOR_TOKEN unset,
 * POST answers a worded 503 naming the exact `wrangler secret put` that fixes
 * it — the estate's standing "-unset" idiom (site-roles.ts, session.ts,
 * ops.ts). It never falls back to "no token required", which is the one
 * failure mode a write door must not have.
 *
 * Storage: ONE D1 row (migration 0012), last-write-wins. D1 and not KV because
 * this Worker's D1 is already its own database and a single row read on every
 * 30-second poll is exactly what it is good at; KV's eventual consistency
 * would let a reader see the previous push after the next one landed, which on
 * a freshness-critical surface is the one property to avoid.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from './env.js';
import { requireDevops } from './middleware/auth.js';

/** The single row. See 0012's header for why the schema enforces it. */
export const AGENT_BOARD_ROW_ID = 1;

/**
 * The largest board this route will store, in BYTES of JSON text.
 *
 * Sized from the contract, not from a round number: a board is a handful of
 * running agents, a bounded event feed, three usage percentages and a
 * processing section with a page or two of books. 256 KB is roughly two
 * orders of magnitude more than that, so it can only ever be reached by
 * something that has gone wrong (an un-trimmed event feed, a whole log
 * pasted in) — which is exactly what a cap should catch. Refused in WORDS
 * naming the measured size and the limit, never a bare 413.
 */
export const AGENT_BOARD_MAX_BYTES = 256 * 1024;

export interface AgentBoardRow {
  board: string;
  pushed_at: string;
  pushed_by: string | null;
}

export interface AgentBoardAnswer {
  /** ISO instant of the last successful push, or null when nothing ever has. */
  pushed_at: string | null;
  /** Free text the pusher stamped on itself ("conductor@home-pc"), or null. */
  pushed_by: string | null;
  /** The pushed blob, whole and untouched, or null when nothing ever has. */
  board: unknown;
  /** This Worker's clock at answer time — the reader compares the two. */
  now: string;
  /** True only when a push has landed; false is a real state, not an error. */
  exists: boolean;
}

/**
 * The pushed body → a board, or a worded refusal.
 *
 * ⚠️ VALIDATES THE ENVELOPE, NOT THE CONTENTS, and that is the design. The
 * home-machine pipeline that will fill the `processing` section does not exist
 * yet (docs/info/agent-board-contract.md is the handshake it will be built
 * against), so a validator that insisted on today's field list would reject
 * tomorrow's correct push. What IS enforced is the pair of properties the page
 * cannot recover from: it must be a JSON OBJECT (an array or a bare string
 * would make every `board.agents` read undefined and the page would render an
 * empty board that looked like a quiet night), and it must be small enough to
 * store and serve.
 *
 * ⚠️ Refuses rather than strips. A validator that silently drops what it does
 * not understand is how a pusher ends up believing it published something it
 * did not — the estate has that bug on record and this is the shape that
 * avoids repeating it.
 */
export function parseAgentBoard(text: string): { board: unknown } | { error: string; detail: string } {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes === 0) {
    return {
      error: 'empty_body',
      detail: 'The push carried no body. Send the board as a JSON object.',
    };
  }
  if (bytes > AGENT_BOARD_MAX_BYTES) {
    return {
      error: 'board_too_large',
      detail:
        `That board is ${bytes} bytes and the limit is ${AGENT_BOARD_MAX_BYTES}. ` +
        'Trim the event feed (it is the part that grows) and push again.',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      error: 'invalid_json',
      detail: 'That body is not valid JSON. Push the file exactly as written, with no wrapper.',
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      error: 'not_an_object',
      detail:
        'The board must be a JSON object with named sections (agents, events, usage, processing) — ' +
        'an array or a bare value has nowhere for the page to look.',
    };
  }
  return { board: parsed };
}

/**
 * A stored row → the answer shape the page reads. Pure, so "never pushed"
 * and "pushed but unreadable" can be pinned by tests without a database.
 *
 * ⚠️ A row whose `board` no longer parses answers `board: null` WITH its
 * `pushed_at` intact rather than throwing. That combination is what tells the
 * page "something did land, and it cannot be read" — which is a different
 * sentence from "nothing has ever been pushed", and the two must never
 * collapse into one on a freshness surface.
 */
export function readAgentBoard(row: AgentBoardRow | null, nowIso: string): AgentBoardAnswer {
  if (!row) {
    return { pushed_at: null, pushed_by: null, board: null, now: nowIso, exists: false };
  }
  let board: unknown = null;
  try {
    board = JSON.parse(row.board);
  } catch {
    board = null;
  }
  return {
    pushed_at: row.pushed_at,
    pushed_by: row.pushed_by ?? null,
    board,
    now: nowIso,
    exists: true,
  };
}

/**
 * Bearer comparison, in constant time and with the four causes kept apart —
 * they have four different fixes and a page that says "unauthorized" to all of
 * them sends someone hunting the wrong one (the estate's standing rule: never
 * a bare status, always what happened / what it needs / how to get it).
 */
export type ConductorAuth = 'ok' | 'secret_unset' | 'no_header' | 'bad_token';

/** Length-independent compare — a short-circuit on the first byte would leak
 *  the prefix a guess got right, one request at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function checkConductorAuth(secret: string | undefined, header: string | null): ConductorAuth {
  if (!secret) return 'secret_unset';
  const raw = (header ?? '').trim();
  if (!raw) return 'no_header';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  if (!m) return 'no_header';
  return timingSafeEqual((m[1] ?? '').trim(), secret) ? 'ok' : 'bad_token';
}

/** Each cause → its own status, its own words, and its own fix. */
export function conductorRefusal(auth: Exclude<ConductorAuth, 'ok'>): {
  status: 401 | 503;
  body: { error: string; detail: string; fix?: string };
} {
  switch (auth) {
    case 'secret_unset':
      return {
        status: 503,
        body: {
          error: 'conductor_token_unset',
          detail:
            'The agent board cannot accept pushes yet — this Worker holds no conductor token, ' +
            'so it has no way to tell a real push from anyone else’s.',
          fix: 'wrangler secret put ESTATE_CONDUCTOR_TOKEN (from apps/auth-worker)',
        },
      };
    case 'no_header':
      return {
        status: 401,
        body: {
          error: 'unauthenticated',
          detail:
            'This push needs the conductor bearer token. Send it as ' +
            '“Authorization: Bearer <ESTATE_CONDUCTOR_TOKEN>”. Custody: docs/access/agent-board.md.',
        },
      };
    case 'bad_token':
      return {
        status: 401,
        body: {
          error: 'bad_token',
          detail:
            'That bearer is not the conductor token this Worker holds. If it was rotated, ' +
            're-read it from the custody file named in docs/access/agent-board.md.',
        },
      };
  }
}

export const agentBoardRoutes = new Hono<AppBindings>();

/**
 * GET — a devops reader, in a browser, on the apex.
 *
 * Answers 200 with `exists: false` when nothing has ever been pushed. That is
 * an ordinary state ("the conductor has not published yet"), not an error, and
 * the page words it as such — a 404 here would be indistinguishable from a
 * mis-routed URL, which is precisely the confusion the estate-docs mount-order
 * gotcha already cost a day to.
 */
agentBoardRoutes.get('/estate/ops/agent-board', requireDevops(), async (c: Context<AppBindings>) => {
  const nowIso = new Date().toISOString();
  let row: AgentBoardRow | null = null;
  try {
    row = await c.env.DB.prepare(
      'SELECT board, pushed_at, pushed_by FROM agent_board WHERE id = ?1',
    )
      .bind(AGENT_BOARD_ROW_ID)
      .first<AgentBoardRow>();
  } catch (err) {
    // ⚠️ A MISSING TABLE IS A DEPLOY-SKEW FACT, NOT AN OUTAGE, and it gets its
    // own words: the migration is applied by hand at deploy time, so "the code
    // shipped and the migration did not" is a real, expected, fixable state.
    const message = (err as Error).message || '';
    if (/no such table/i.test(message)) {
      return c.json(
        {
          error: 'agent_board_table_missing',
          detail:
            'The agent board table does not exist in this database — the Worker shipped ahead of ' +
            'its migration. Nothing is broken and nothing was lost.',
          fix: 'npm run db:migrate (from apps/auth-worker) applies 0012_agent_board.sql remotely',
        },
        503,
      );
    }
    return c.json(
      {
        error: 'agent_board_unreadable',
        detail: 'The estate database did not answer, so the agent board cannot be read right now.',
      },
      502,
    );
  }
  return c.json(readAgentBoard(row, nowIso));
});

/**
 * POST — the conductor's push. Bearer only; no Firebase identity involved.
 *
 * Last-write-wins by construction (`INSERT … ON CONFLICT DO UPDATE` on the one
 * row), so a push can never fail for "a board already exists" and a retry is
 * always safe. `pushed_at` is stamped HERE, from this Worker's clock — see
 * 0012's header for why the pusher's own timestamp is not trusted for the age
 * the page displays.
 */
agentBoardRoutes.post('/estate/ops/agent-board', async (c: Context<AppBindings>) => {
  const auth = checkConductorAuth(c.env.ESTATE_CONDUCTOR_TOKEN, c.req.header('Authorization') ?? null);
  if (auth !== 'ok') {
    const refusal = conductorRefusal(auth);
    return c.json(refusal.body, refusal.status);
  }

  const text = await c.req.text().catch(() => '');
  const parsed = parseAgentBoard(text);
  if ('error' in parsed) return c.json(parsed, 400);

  const pushedBy = (c.req.header('X-Estate-Pushed-By') ?? '').slice(0, 120) || null;
  const pushedAt = new Date().toISOString();

  try {
    await c.env.DB.prepare(
      'INSERT INTO agent_board (id, board, pushed_at, pushed_by) VALUES (?1, ?2, ?3, ?4) ' +
        'ON CONFLICT(id) DO UPDATE SET board = excluded.board, pushed_at = excluded.pushed_at, ' +
        'pushed_by = excluded.pushed_by',
    )
      .bind(AGENT_BOARD_ROW_ID, JSON.stringify(parsed.board), pushedAt, pushedBy)
      .run();
  } catch (err) {
    const message = (err as Error).message || '';
    if (/no such table/i.test(message)) {
      return c.json(
        {
          error: 'agent_board_table_missing',
          detail:
            'The agent board table does not exist in this database — the Worker shipped ahead of ' +
            'its migration, so this push was NOT stored.',
          fix: 'npm run db:migrate (from apps/auth-worker) applies 0012_agent_board.sql remotely',
        },
        503,
      );
    }
    return c.json(
      { error: 'agent_board_write_failed', detail: 'The estate database refused the write — nothing was stored.' },
      502,
    );
  }

  // The audit line — WHO pushed and HOW BIG, never the board's contents (it
  // names in-flight work and can carry a task description). Same shape and
  // role as ops.ts's pipeline_step_requested line.
  console.log(
    JSON.stringify({
      evt: 'agent_board_pushed',
      pushed_by: pushedBy,
      bytes: new TextEncoder().encode(text).length,
      at: pushedAt,
    }),
  );

  return c.json({ ok: true, pushed_at: pushedAt, pushed_by: pushedBy });
});
