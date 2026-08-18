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
  /** JSON map of section name → ISO instant. NULL on rows written before
   *  migration 0013, which the reader treats as "fall back to pushed_at". */
  section_pushed_at?: string | null;
}

/** Section name → the ISO instant that section last CHANGED, by this Worker's
 *  clock. Never a pusher's clock — see stampSections(). */
export type SectionStamps = Record<string, string>;

export interface AgentBoardAnswer {
  /** ISO instant of the last successful push, or null when nothing ever has. */
  pushed_at: string | null;
  /** Free text the pusher stamped on itself ("conductor@home-pc"), or null. */
  pushed_by: string | null;
  /** The pushed blob, whole and untouched, or null when nothing ever has. */
  board: unknown;
  /**
   * Per-section stamps — {"agents": ISO, "processing": ISO, …}.
   *
   * ⚠️ THE POINT OF THE WHOLE THING: /status/agents must measure its freshness
   * against `agents`, not against whenever the processing pusher last ran. An
   * EMPTY object means the row predates migration 0013 and the page must fall
   * back to `pushed_at` — it must never read a missing stamp as "just now".
   */
  section_pushed_at: SectionStamps;
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
    return { pushed_at: null, pushed_by: null, board: null, section_pushed_at: {}, now: nowIso, exists: false };
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
    section_pushed_at: parseSectionStamps(row.section_pushed_at),
    now: nowIso,
    exists: true,
  };
}

/**
 * The stored stamp map → a usable one.
 *
 * ⚠️ AN UNREADABLE OR ABSENT MAP RETURNS {}, NEVER A GUESS. Empty means "this
 * row has no per-section stamps" and the pages fall back to the board-wide
 * `pushed_at` and SAY they are doing so. Inventing `now` here would be the
 * original bug wearing the fix's clothes: a section that has not been written
 * for hours would read as fresh, which is exactly what 0013 exists to stop.
 */
export function parseSectionStamps(raw: string | null | undefined): SectionStamps {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: SectionStamps = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    // Only keep values that are actually readable instants. A stamp nobody can
    // parse is not better than no stamp — it is a stamp that renders as an age.
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) out[key] = value;
  }
  return out;
}

/**
 * Key-ordering-independent JSON, so "did this section change" is a question
 * about CONTENT and not about how a pusher happened to serialise it. Without
 * this, a pusher that re-emitted the same data with keys in a different order
 * would restamp a section that did not move — which is the very false-freshness
 * this file is closing.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

/**
 * Which sections this push moves, and what their stamps become.
 *
 * ⚠️ THE PROBLEM, in one sentence: two pushers share one row, each writes the
 * board WHOLE (contract §9 — a partial push would delete the other's section),
 * and so the board-wide `pushed_at` only ever tells you when SOMEBODY last
 * pushed. /status/agents read that and said "as of 2 minutes ago" about agent
 * rows the conductor had not touched since breakfast.
 *
 * ⚠️ THE SERVER IS THE SINGLE CLOCK AND THAT IS NOT NEGOTIABLE. The contract's
 * §2 already forbids trusting a pusher's timestamp for the age a page displays
 * — a pusher's clock can be wrong, stale, or missing, and an age built on it is
 * worth nothing. So the alternative design (each pusher stamping its own
 * section inside the blob) was rejected: it would put the estate's freshness
 * display back on clocks nobody controls, and it would need BOTH pushers
 * changed in lockstep to be correct.
 *
 * ⚠️ WHAT DECIDES A RESTAMP, in order:
 *
 *   1. The pusher DECLARED the section (the optional `X-Estate-Sections`
 *      header). "I am authoritative for this and I just wrote it" is the
 *      strongest signal available, and it is the one case where re-pushing
 *      identical content SHOULD move the clock — the conductor saying "still
 *      true, as of now".
 *   2. Otherwise, the section's CONTENT changed. This needs no pusher change at
 *      all, which is why it is the default: both pushers already read-modify-
 *      write the shared draft and push it whole, and neither had to be touched
 *      for this to be correct today.
 *
 * ⚠️ THE HONEST COST OF THE DEFAULT, stated rather than hidden: a section
 * re-pushed byte-identical by an UNDECLARING pusher keeps its earlier stamp, so
 * the strip can read older than the last push. That is the safe direction and
 * it is deliberate — "this information has not changed since 09:12" is true,
 * whereas the bug being fixed said "fresh" about data nobody had refreshed. A
 * freshness surface may err toward saying stale; it may never err toward saying
 * fresh. The header above is the seam for a pusher that wants the sharper
 * answer, and adopting it later needs no further migration.
 *
 * A section that DISAPPEARS from the board loses its stamp — there is nothing
 * left for it to be the age of.
 */
export function stampSections(
  previousBoard: unknown,
  nextBoard: unknown,
  previousStamps: SectionStamps,
  nowIso: string,
  declared: string[] = [],
): SectionStamps {
  const next = nextBoard && typeof nextBoard === 'object' && !Array.isArray(nextBoard)
    ? (nextBoard as Record<string, unknown>)
    : {};
  const prev = previousBoard && typeof previousBoard === 'object' && !Array.isArray(previousBoard)
    ? (previousBoard as Record<string, unknown>)
    : {};
  const declaredSet = new Set(declared);

  const stamps: SectionStamps = {};
  for (const key of Object.keys(next)) {
    const changed = !(key in prev) || stableStringify(prev[key]) !== stableStringify(next[key]);
    const carried = previousStamps[key];
    stamps[key] = declaredSet.has(key) || changed || !carried ? nowIso : carried;
  }
  return stamps;
}

/**
 * `X-Estate-Sections: agents, events,usage` → ['agents','events','usage'].
 * Bounded and shape-checked because it arrives from outside; an unparseable
 * header simply declares nothing and the content check still runs.
 */
export function parseDeclaredSections(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 64)
    .slice(0, 32);
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

/** True for the D1/SQLite error that means "this column has not been added yet". */
function isMissingColumn(err: unknown): boolean {
  return /no such column/i.test((err as Error)?.message || '');
}

/**
 * Read the one row, tolerating a database that has not had 0013 applied.
 *
 * ⚠️ THE ORDER IS STILL MIGRATE-THEN-DEPLOY. This fallback is not permission to
 * skip it — it is what keeps the surface WORKING during the seconds between the
 * two, and what makes a rollback to the previous Worker safe. Without it, a
 * Worker deployed a minute ahead of its migration would answer 502 on the read
 * door for every devops reader, turning a harmless ordering slip into an outage
 * on the page people check when they suspect an outage.
 */
async function readRow(db: AppBindings['Bindings']['DB']): Promise<AgentBoardRow | null> {
  try {
    return await db
      .prepare('SELECT board, pushed_at, pushed_by, section_pushed_at FROM agent_board WHERE id = ?1')
      .bind(AGENT_BOARD_ROW_ID)
      .first<AgentBoardRow>();
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    // Pre-0013: no per-section stamps exist, so the answer carries none and the
    // pages fall back to the board-wide push age, saying so in words.
    return await db
      .prepare('SELECT board, pushed_at, pushed_by FROM agent_board WHERE id = ?1')
      .bind(AGENT_BOARD_ROW_ID)
      .first<AgentBoardRow>();
  }
}

/**
 * Write the one row, with the same pre-0013 tolerance as readRow().
 *
 * ⚠️ THE FALLBACK STORES THE BOARD AND DROPS THE STAMPS — deliberately, and in
 * that order of preference. Losing a push because a column is missing would be
 * a worse failure than losing the per-section ages for one cycle: the board is
 * the data, the stamps are metadata about it, and the pages already know how to
 * say "this row carries no per-section stamps".
 */
async function writeRow(
  db: AppBindings['Bindings']['DB'],
  board: string,
  pushedAt: string,
  pushedBy: string | null,
  sectionStamps: string,
): Promise<void> {
  try {
    await db
      .prepare(
        'INSERT INTO agent_board (id, board, pushed_at, pushed_by, section_pushed_at) VALUES (?1, ?2, ?3, ?4, ?5) ' +
          'ON CONFLICT(id) DO UPDATE SET board = excluded.board, pushed_at = excluded.pushed_at, ' +
          'pushed_by = excluded.pushed_by, section_pushed_at = excluded.section_pushed_at',
      )
      .bind(AGENT_BOARD_ROW_ID, board, pushedAt, pushedBy, sectionStamps)
      .run();
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    await db
      .prepare(
        'INSERT INTO agent_board (id, board, pushed_at, pushed_by) VALUES (?1, ?2, ?3, ?4) ' +
          'ON CONFLICT(id) DO UPDATE SET board = excluded.board, pushed_at = excluded.pushed_at, ' +
          'pushed_by = excluded.pushed_by',
      )
      .bind(AGENT_BOARD_ROW_ID, board, pushedAt, pushedBy)
      .run();
  }
}

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
    row = await readRow(c.env.DB);
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

  // ⚠️ READ BEFORE WRITE, so the stamps can be per-SECTION. The previous board
  // is what tells us which sections this push actually moved; without it every
  // push would restamp everything, which is the bug (contract §9). A read that
  // FAILS is not fatal — treat it as "no previous board", which stamps every
  // section now. That errs toward saying fresh for one push only, and the
  // alternative (refusing the write) would lose the push entirely.
  let previous: AgentBoardRow | null = null;
  try {
    previous = await readRow(c.env.DB);
  } catch {
    previous = null;
  }
  let previousBoard: unknown = null;
  try {
    previousBoard = previous ? JSON.parse(previous.board) : null;
  } catch {
    previousBoard = null;
  }
  const sectionStamps = stampSections(
    previousBoard,
    parsed.board,
    parseSectionStamps(previous?.section_pushed_at),
    pushedAt,
    parseDeclaredSections(c.req.header('X-Estate-Sections')),
  );

  try {
    await writeRow(c.env.DB, JSON.stringify(parsed.board), pushedAt, pushedBy, JSON.stringify(sectionStamps));
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

  // ⚠️ `sections` names which sections THIS push moved the clock on, so a pusher
  // can see at a glance that it preserved the other one's work rather than
  // silently restamping it. It is the machine-readable half of contract §9's
  // "you cannot recover a section you did not write".
  return c.json({
    ok: true,
    pushed_at: pushedAt,
    pushed_by: pushedBy,
    section_pushed_at: sectionStamps,
    sections_moved: Object.keys(sectionStamps).filter((k) => sectionStamps[k] === pushedAt),
  });
});
