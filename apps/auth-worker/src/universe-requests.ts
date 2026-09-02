/**
 * UNIVERSE REQUESTS — "+ add a verse" on /universes.
 *
 * Design: docs/info/universe-add-verse-design.md (§3.3–§3.5 are this file).
 * Owner ask, 2026-08-24: *"in the universe page add a plus button somewhere to
 * add a verse and let it take series as an input"*
 *
 * 🔴 THE ONE THING TO UNDERSTAND BEFORE EDITING: NOTHING HERE CREATES A
 * UNIVERSE. A universe is not a row anywhere in this estate — it is a decision
 * in `data/universes.json`, in git, compiled into two catalogs at build time and
 * pinned by `library_catalog/packages/core/test/universes.test.ts`, whose own
 * comment says the assertion failing IS the file working. `tools/universes.mjs`
 * is the only writer. This module holds what somebody ASKED for, and the chain
 * from a request to a real verse runs through a person: approve here, edit the
 * JSON with the CLI, update the tripwire, rebuild both catalogs, deploy.
 *
 * ⚠️ SO `approved` IS NOT `landed`, AND THE PAGE MUST NEVER SAY IT IS. Between
 * the two the estate is in a state where a person has been told yes and nothing
 * exists — that gap is a manual deploy wide. The fourth status is what makes the
 * gap SAYABLE ("approved — waiting on the next build") instead of a lie.
 *
 * ⚠️ THE DUPLICATE CHECK IS NOT STRING EQUALITY, and the alias half is the
 * common case. `data/universes.json` carries `canonicalNames` precisely because
 * "cosmere", "the cosmere" and "Cosmere" are one verse; a naive check would let
 * the second spelling through and the owner would decline a request that was
 * never a new universe. Projected into `universe-names.generated.ts`.
 *
 * ⚠️ AND THE NEAR-MISS CHECK NEVER BLOCKS. `Marvel`, `Disney` and `Star Wars`
 * are three universes the owner deliberately split apart; a similarity check
 * with a veto would have refused two of them. A near miss is reported — to the
 * requester as a nudge and to the approver as context — and nothing else.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings, EstateUserRow } from './env.js';
import { parseOwnerEmails } from './env.js';
import { approverAllows, requireApprovedMember, requireApprover, requireDevops } from './middleware/auth.js';
import { CANONICAL_NAMES, UNIVERSE_NAMES } from './universe-names.generated.js';

/* ------------------------------------------------------------------ *
 * Normalisation and the name check — pure, so they can be tested
 * ------------------------------------------------------------------ */

/**
 * ⚠️ A VERBATIM PORT OF `normText()` in tools/lib/universes.mjs, and it has to
 * stay one. `CANONICAL_NAMES`' keys were normalised by THAT function, so a
 * server that normalises differently looks up keys that cannot match and the
 * alias check silently degrades to string equality — passing every test that
 * only feeds it exact spellings.
 *
 * The curly-apostrophe fold is load-bearing rather than cosmetic; see the
 * original's header for the row that proves it.
 */
export function normName(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Levenshtein, capped — only ever run against ~17 short strings. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((cur[j - 1] as number) + 1, (prev[j] as number) + 1, (prev[j - 1] as number) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j] as number;
  }
  return prev[b.length] as number;
}

export type NameVerdict =
  | { kind: 'empty' }
  | { kind: 'exists'; universe: string }
  | { kind: 'alias'; universe: string; typed: string }
  | { kind: 'free'; near: string[] };

/**
 * §3.3, in order. ⚠️ THE ORDER IS THE DESIGN: exact, then alias, then near-miss.
 * Steps 1–2 hard-block, step 3 never does.
 */
export function checkName(
  name: unknown,
  names: readonly string[] = UNIVERSE_NAMES,
  canonical: Readonly<Record<string, string>> = CANONICAL_NAMES,
): NameVerdict {
  const typed = String(name ?? '').trim();
  const key = normName(typed);
  if (!key) return { kind: 'empty' };

  const exact = names.find((n) => normName(n) === key);
  if (exact) return { kind: 'exists', universe: exact };

  const folded = canonical[key];
  if (typeof folded === 'string') return { kind: 'alias', universe: folded, typed };

  // ⚠️ WARNING ONLY. Substring in either direction, or an edit distance of at
  // most 2 on names long enough for that to mean something — chosen so
  // "Cosmere"/"The Cosmere" and a fat-fingered "Solariaa" surface, while
  // "Marvel"/"Disney" (distance 6) do not.
  const near = names.filter((n) => {
    const k = normName(n);
    if (k.includes(key) || key.includes(k)) return true;
    return Math.min(k.length, key.length) >= 5 && editDistance(k, key) <= 2;
  });
  return { kind: 'free', near };
}

/* ------------------------------------------------------------------ *
 * The request body
 * ------------------------------------------------------------------ */

export interface RequestPayload {
  series: string[];
  titles: string[];
  notSeries: string[];
  /**
   * ⚠️ ALWAYS 'human', ALWAYS SERVER-SET. A client-supplied `'human'` is a
   * claim, not a fact, and this field is what a later reader uses to decide how
   * much to trust an entry. A body that tries to send it is REFUSED, not
   * quietly overwritten — see BODY_KEYS.
   */
  decidedHow: 'human';
  /** Near misses at submit time, kept so the approver sees what the requester saw. */
  near?: string[];
}

export interface ParsedRequest {
  name: string;
  why: string;
  payload: RequestPayload;
}

/** ⚠️ REFUSES, NEVER STRIPS — the estate's standing rule for every write door. */
const BODY_KEYS = new Set(['name', 'why', 'series', 'titles', 'notSeries']);

/**
 * ⚠️ THE 10-CHARACTER FLOOR IS `requireReason()` FROM tools/lib/universes.mjs,
 * COPIED ON PURPOSE. The design's §3.2 says it in one line: *the form must not
 * be softer than the CLI*. A request whose `why` is "idk" arrives at the owner
 * as a decision he cannot make, and he is the scarce resource here.
 */
export const WHY_MIN = 10;

function stringList(value: unknown, field: string): string[] | { error: string; detail: string } {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { error: 'not_a_list', detail: `“${field}” must be a list of strings.` };
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') return { error: 'not_a_string', detail: `Every entry in “${field}” must be text.` };
    const t = v.trim();
    if (!t) continue; // an empty row in a repeatable field is a blank the form left behind, not an error
    if (t.length > 200) return { error: 'too_long', detail: `“${t.slice(0, 40)}…” is too long for ${field}.` };
    out.push(t);
  }
  return out;
}

export function parseRequestBody(body: unknown): ParsedRequest | { error: string; detail: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'not_an_object', detail: 'Send a JSON object describing the verse.' };
  }
  const obj = body as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!BODY_KEYS.has(k)) {
      // ⚠️ `decidedHow` lands here by design, and the message says why rather
      // than pretending the field is unknown.
      if (k === 'decidedHow') {
        return {
          error: 'server_owned_field',
          detail:
            '“decidedHow” is recorded by the estate, not by the browser — a request filled in by a ' +
            'person is always “human”, and a claim about that is not the same thing as a fact.',
        };
      }
      return {
        error: 'unknown_field',
        detail: `“${k}” is not a field this request understands. Known: ${[...BODY_KEYS].join(', ')}.`,
      };
    }
  }

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) return { error: 'no_name', detail: 'A verse needs a name.' };
  if (name.length > 120) return { error: 'name_too_long', detail: 'That name is too long for a universe.' };

  const why = typeof obj.why === 'string' ? obj.why.trim() : '';
  if (why.length < WHY_MIN) {
    return {
      error: 'no_reason',
      detail:
        `Say why this verse should exist — at least ${WHY_MIN} characters. Every entry in the estate's ` +
        'universe list records its evidence, because an unexplained one is indistinguishable from a typo.',
    };
  }
  if (why.length > 2000) return { error: 'reason_too_long', detail: 'That reason is longer than the field holds.' };

  const series = stringList(obj.series, 'series');
  if (!Array.isArray(series)) return series;
  const titles = stringList(obj.titles, 'titles');
  if (!Array.isArray(titles)) return titles;
  const notSeries = stringList(obj.notSeries, 'notSeries');
  if (!Array.isArray(notSeries)) return notSeries;

  return { name, why, payload: { series, titles, notSeries, decidedHow: 'human' } };
}

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

interface RequestRow {
  id: number;
  name: string;
  name_key: string;
  payload: string;
  why: string;
  requested_by: number;
  requested_at: string;
  status: string;
  decided_by: number | null;
  decided_at: string | null;
  decided_why: string | null;
  landed_commit: string | null;
  requester_name?: string | null;
  requester_email?: string | null;
  decider_name?: string | null;
  decider_email?: string | null;
}

/**
 * §6 Q3: an `approved` row that nobody has shipped. ⚠️ THIS DOES NOT FIX THE
 * GAP — a page cannot deploy somebody else's catalog. It makes the gap VISIBLE,
 * which is the only honest thing available, and it is the same instrument the
 * estate already trusts (`claude-usage.ts`'s STALE_AFTER_MS, `shelf-parity.ts`).
 * Server-side so one number answers for every surface.
 */
export const APPROVED_STALE_DAYS = 7;

function ageDays(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

function parsePayload(raw: string): RequestPayload {
  // ⚠️ An unreadable payload degrades to "we know a request exists and who asked
  // and why" rather than to a 500. The three lists are the soft part; `name` and
  // `why` are columns and always survive.
  try {
    const parsed = JSON.parse(raw) as Partial<RequestPayload>;
    return {
      series: Array.isArray(parsed.series) ? parsed.series.filter((s) => typeof s === 'string') : [],
      titles: Array.isArray(parsed.titles) ? parsed.titles.filter((s) => typeof s === 'string') : [],
      notSeries: Array.isArray(parsed.notSeries) ? parsed.notSeries.filter((s) => typeof s === 'string') : [],
      decidedHow: 'human',
      near: Array.isArray(parsed.near) ? parsed.near.filter((s) => typeof s === 'string') : undefined,
    };
  } catch {
    return { series: [], titles: [], notSeries: [], decidedHow: 'human' };
  }
}

/**
 * The wire shape. ⚠️ A REQUESTER'S EMAIL IS ONLY EVER SHOWN TO AN APPROVER —
 * `mine` rows carry the viewer's own identity, which they already have, and a
 * member must never learn who else asked for what.
 */
export function toWire(row: RequestRow, now: number, forApprover: boolean) {
  const age = ageDays(row.decided_at, now);
  return {
    id: row.id,
    name: row.name,
    why: row.why,
    payload: parsePayload(row.payload),
    status: row.status,
    requested_at: row.requested_at,
    decided_at: row.decided_at,
    decided_why: row.decided_why,
    landed_commit: row.landed_commit,
    ...(forApprover
      ? {
          requested_by: row.requester_name || row.requester_email || `member #${row.requested_by}`,
          decided_by: row.decider_name || row.decider_email || null,
        }
      : {}),
    // Only ever true on an `approved` row: a pending one is waiting on a person,
    // which is not the same failure and must not wear the same warning.
    stale: row.status === 'approved' && age !== null && age > APPROVED_STALE_DAYS,
    age_days: age,
  };
}

const TABLE_MISSING = {
  error: 'universe_request_table_missing',
  detail:
    'The universe-request table does not exist in this database — the Worker shipped ahead of its ' +
    'migration. Nothing is broken and nothing was lost; no request has been recorded.',
  fix: 'npm run db:migrate (from apps/auth-worker) applies 0017_universe_requests.sql remotely',
} as const;

function tableMissing(err: unknown): boolean {
  return /no such table/i.test((err as Error)?.message || '');
}

const SELECT_COLS =
  'r.id, r.name, r.name_key, r.payload, r.why, r.requested_by, r.requested_at, r.status, ' +
  'r.decided_by, r.decided_at, r.decided_why, r.landed_commit, ' +
  'u.display_name AS requester_name, u.email AS requester_email, ' +
  'd.display_name AS decider_name, d.email AS decider_email';
const FROM_JOINED =
  'FROM universe_request r ' +
  'LEFT JOIN estate_user u ON u.id = r.requested_by ' +
  'LEFT JOIN estate_user d ON d.id = r.decided_by';

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

export const universeRequestRoutes = new Hono<AppBindings>();

function isOwnerActor(c: Context<AppBindings>, row: EstateUserRow): boolean {
  return parseOwnerEmails(c.env.OWNER_EMAILS).includes(row.email.trim().toLowerCase());
}

/**
 * GET /estate/universes/names — the canonical list, served.
 *
 * ⚠️ THIS ROUTE IS THE FIX FOR A REAL, MEASURED BUG, not a convenience. The
 * /universes page hardcodes its list because nothing served one, and it was
 * silently one universe short for a day. The page still ships a hardcoded copy
 * as its SIGNED-OUT fallback (a members-only route cannot render the browse list
 * for a visitor), tripwired by scripts/test/universe-names-parity.test.mjs — but
 * a signed-in member now sees what the data file actually says.
 *
 * Member-gated rather than public because /api/universe/:name already is, and a
 * list of the estate's private fiction interests is the same kind of fact.
 */
universeRequestRoutes.get('/estate/universes/names', requireApprovedMember(), (c) =>
  c.json({
    names: [...UNIVERSE_NAMES],
    canonical_names: CANONICAL_NAMES,
    // So the page can say where the list came from rather than implying it is
    // live-editable. It is not: this is a build artifact of a git file.
    source: 'data/universes.json',
  }),
);

/**
 * POST /estate/universes/requests — file one.
 *
 * ⚠️ THE DUPLICATE CHECK RUNS HERE AS WELL AS IN THE FORM. The browser's copy is
 * a convenience; the row that lands in D1 is the one that matters, and a form is
 * a thing anybody can skip.
 */
universeRequestRoutes.post('/estate/universes/requests', requireApprovedMember(), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', detail: 'That body is not valid JSON.' }, 400);
  }
  const parsed = parseRequestBody(body);
  if ('error' in parsed) return c.json(parsed, 400);

  const verdict = checkName(parsed.name);
  if (verdict.kind === 'empty') return c.json({ error: 'no_name', detail: 'A verse needs a name.' }, 400);
  if (verdict.kind === 'exists') {
    return c.json(
      {
        error: 'already_exists',
        universe: verdict.universe,
        detail: `${verdict.universe} already exists — it is on this page. Nothing to ask for.`,
      },
      409,
    );
  }
  if (verdict.kind === 'alias') {
    return c.json(
      {
        error: 'known_alias',
        universe: verdict.universe,
        detail:
          `“${verdict.typed}” is a spelling of ${verdict.universe} — the estate already has it under ` +
          'that name. If you mean something genuinely different, ask under a name that is not one of its aliases.',
      },
      409,
    );
  }

  const actor = c.get('actor');
  const nameKey = normName(parsed.name);
  const payload: RequestPayload = { ...parsed.payload, ...(verdict.near.length ? { near: verdict.near } : {}) };

  try {
    // ⚠️ ONE OPEN REQUEST PER NAME. A DECLINED one does not block a second
    // attempt — a decline plus a better argument is a legitimate sequence, and
    // the history of both is worth keeping (which is also why 0017 has no unique
    // index; the rule lives here, where it can say why in words).
    const open = await c.env.DB.prepare(
      "SELECT id, requested_by, status FROM universe_request WHERE name_key = ?1 AND status IN ('pending','approved')",
    )
      .bind(nameKey)
      .first<{ id: number; requested_by: number; status: string }>();
    if (open) {
      const mine = open.requested_by === actor.id;
      return c.json(
        {
          error: 'already_requested',
          request_id: open.id,
          detail:
            open.status === 'approved'
              ? `That verse is already approved and waiting on the next build — request #${open.id}.`
              : mine
                ? `You already asked for that — request #${open.id}, still waiting on a decision.`
                : `Somebody already asked for that — request #${open.id}, still waiting on a decision.`,
        },
        409,
      );
    }

    const now = new Date().toISOString();
    const row = await c.env.DB.prepare(
      'INSERT INTO universe_request (name, name_key, payload, why, requested_by, requested_at, status) ' +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending') RETURNING id",
    )
      .bind(parsed.name, nameKey, JSON.stringify(payload), parsed.why, actor.id, now)
      .first<{ id: number }>();

    return c.json(
      {
        ok: true,
        id: row?.id ?? null,
        name: parsed.name,
        status: 'pending',
        near: verdict.near,
        // ⚠️ Said at the moment of asking, not discovered later. The requester
        // must not walk away believing a verse now exists.
        detail:
          'Asked. The owner decides, and even a yes is not immediate — a new verse is a change to a file in ' +
          'git that both catalogs have to be rebuilt from.',
      },
      201,
    );
  } catch (err) {
    if (tableMissing(err)) return c.json(TABLE_MISSING, 503);
    return c.json(
      { error: 'request_write_failed', detail: 'The estate directory refused the write — nothing was recorded.' },
      502,
    );
  }
});

/**
 * GET /estate/universes/requests — own rows, or every row for an approver.
 *
 * ⚠️ THE TWO ANSWERS DIFFER IN WHAT THEY CONTAIN, not just in how many rows.
 * See toWire(): only an approver's copy names the requester.
 */
universeRequestRoutes.get('/estate/universes/requests', requireApprovedMember(), async (c) => {
  const actor = c.get('actor');
  const canSeeAll = approverAllows(actor, isOwnerActor(c, actor));
  const now = Date.now();
  try {
    const stmt = canSeeAll
      ? c.env.DB.prepare(`SELECT ${SELECT_COLS} ${FROM_JOINED} ORDER BY r.id DESC`)
      : c.env.DB.prepare(`SELECT ${SELECT_COLS} ${FROM_JOINED} WHERE r.requested_by = ?1 ORDER BY r.id DESC`).bind(
          actor.id,
        );
    const { results } = await stmt.all<RequestRow>();
    return c.json({
      requests: (results ?? []).map((r) => toWire(r, now, canSeeAll)),
      scope: canSeeAll ? 'all' : 'mine',
      is_approver: canSeeAll,
      approved_stale_days: APPROVED_STALE_DAYS,
    });
  } catch (err) {
    if (tableMissing(err)) return c.json({ ...TABLE_MISSING, requests: [], scope: canSeeAll ? 'all' : 'mine' }, 200);
    return c.json({ error: 'requests_unreadable', detail: 'The estate directory did not answer.' }, 502);
  }
});

/**
 * POST /estate/universes/requests/:id/decide — the owner's call.
 *
 * ⚠️ A DECLINE WITHOUT A REASON IS REFUSED AT THE ROUTE, not just in the form.
 * The requester is shown `decided_why` verbatim, so the UI is allowed to rely on
 * there being one — which is only safe because this check is here.
 *
 * ⚠️ APPROVING RUNS NOTHING. It does not touch data/universes.json, does not
 * commit and does not deploy. It sets a status; §4 of the design is the rest,
 * done by a person. Anything else would need this Worker to hold a git
 * credential, which is the second representation the whole design refuses.
 */
universeRequestRoutes.post('/estate/universes/requests/:id/decide', requireApprover(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id', detail: 'That is not a request id.' }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', detail: 'That body is not valid JSON.' }, 400);
  }
  const obj = (body ?? {}) as Record<string, unknown>;
  const decision = obj.decision;
  if (decision !== 'approved' && decision !== 'declined') {
    return c.json({ error: 'bad_decision', detail: 'A decision is either “approved” or “declined”.' }, 400);
  }
  const why = typeof obj.why === 'string' ? obj.why.trim() : '';
  if (decision === 'declined' && why.length < WHY_MIN) {
    return c.json(
      {
        error: 'no_reason',
        detail:
          `A decline needs a reason of at least ${WHY_MIN} characters — the requester is shown it verbatim. ` +
          '“That’s The Cosmere under another name” answers the question; a bare no starts an argument.',
      },
      400,
    );
  }

  const actor = c.get('actor');
  try {
    const existing = await c.env.DB.prepare('SELECT id, status FROM universe_request WHERE id = ?1')
      .bind(id)
      .first<{ id: number; status: string }>();
    if (!existing) return c.json({ error: 'not_found', detail: `There is no request #${id}.` }, 404);
    if (existing.status !== 'pending') {
      return c.json(
        {
          error: 'already_decided',
          status: existing.status,
          detail: `Request #${id} is already ${existing.status} — it is not waiting on a decision.`,
        },
        409,
      );
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE universe_request SET status = ?1, decided_by = ?2, decided_at = ?3, decided_why = ?4 ' +
        "WHERE id = ?5 AND status = 'pending'",
    )
      .bind(decision, actor.id, now, why || null, id)
      .run();

    return c.json({
      ok: true,
      id,
      status: decision,
      decided_at: now,
      // ⚠️ The honest sentence, in the API rather than only in the page, so
      // every caller says the same thing.
      detail:
        decision === 'approved'
          ? 'Approved. It is not live yet — a session has to edit data/universes.json, update the tripwire ' +
            'test and rebuild both catalogs before the verse exists.'
          : 'Declined, with the reason recorded. The requester sees it on /universes.',
    });
  } catch (err) {
    if (tableMissing(err)) return c.json(TABLE_MISSING, 503);
    return c.json({ error: 'decide_failed', detail: 'The estate directory refused the write — nothing changed.' }, 502);
  }
});

/**
 * POST /estate/universes/requests/:id/landed — close the loop.
 *
 * The session that actually ships the change says so, with the commit that did
 * it. `requireDevops()` and not `requireApprover()`: this is a statement about a
 * DEPLOY, made by whoever ran it, and it grants nobody anything.
 */
universeRequestRoutes.post('/estate/universes/requests/:id/landed', requireDevops(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id', detail: 'That is not a request id.' }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', detail: 'That body is not valid JSON.' }, 400);
  }
  const commit = typeof (body as Record<string, unknown>)?.commit === 'string'
    ? String((body as Record<string, unknown>).commit).trim()
    : '';
  // ⚠️ A COMMIT IS REQUIRED, and it is the whole point of the route. "It
  // shipped" with nothing to check is the claim this status exists to replace.
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
    return c.json(
      {
        error: 'bad_commit',
        detail: 'Send the commit that landed the change — 7 to 40 hex characters. Marking a verse landed with ' +
          'nothing to point at is exactly the unverifiable claim this status replaced.',
      },
      400,
    );
  }

  try {
    const existing = await c.env.DB.prepare('SELECT id, status FROM universe_request WHERE id = ?1')
      .bind(id)
      .first<{ id: number; status: string }>();
    if (!existing) return c.json({ error: 'not_found', detail: `There is no request #${id}.` }, 404);
    if (existing.status !== 'approved') {
      return c.json(
        {
          error: 'not_approved',
          status: existing.status,
          detail:
            `Request #${id} is ${existing.status}, not approved. Only an approved verse can land — marking a ` +
            'declined or withdrawn one shipped would put a universe in the catalogs that nobody said yes to.',
        },
        409,
      );
    }
    await c.env.DB.prepare(
      "UPDATE universe_request SET status = 'landed', landed_commit = ?1 WHERE id = ?2 AND status = 'approved'",
    )
      .bind(commit.toLowerCase(), id)
      .run();
    return c.json({ ok: true, id, status: 'landed', landed_commit: commit.toLowerCase() });
  } catch (err) {
    if (tableMissing(err)) return c.json(TABLE_MISSING, 503);
    return c.json({ error: 'landed_failed', detail: 'The estate directory refused the write — nothing changed.' }, 502);
  }
});

/**
 * POST /estate/universes/requests/:id/withdraw — §6 Q4.
 *
 * ⚠️ REQUESTER-ONLY, AND ONLY WHILE PENDING. Access-reducing, reversible (ask
 * again), and it keeps the queue honest. An APPROVER wanting a row gone uses
 * `decide` with a reason — a queue that can be silently emptied by somebody
 * other than the person who filled it is a queue with no record.
 */
universeRequestRoutes.post('/estate/universes/requests/:id/withdraw', requireApprovedMember(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id', detail: 'That is not a request id.' }, 400);
  const actor = c.get('actor');
  try {
    const existing = await c.env.DB.prepare('SELECT id, status, requested_by FROM universe_request WHERE id = ?1')
      .bind(id)
      .first<{ id: number; status: string; requested_by: number }>();
    if (!existing) return c.json({ error: 'not_found', detail: `There is no request #${id}.` }, 404);
    if (existing.requested_by !== actor.id) {
      return c.json(
        {
          error: 'not_yours',
          detail:
            'Only the person who asked can withdraw a request. If you are deciding it, decline it with a ' +
            'reason instead — that leaves a record; a withdrawal by somebody else would not.',
        },
        403,
      );
    }
    if (existing.status !== 'pending') {
      return c.json(
        {
          error: 'not_pending',
          status: existing.status,
          detail: `Request #${id} is already ${existing.status}, so there is nothing to withdraw.`,
        },
        409,
      );
    }
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      "UPDATE universe_request SET status = 'withdrawn', decided_at = ?1 WHERE id = ?2 AND status = 'pending'",
    )
      .bind(now, id)
      .run();
    return c.json({ ok: true, id, status: 'withdrawn' });
  } catch (err) {
    if (tableMissing(err)) return c.json(TABLE_MISSING, 503);
    return c.json(
      { error: 'withdraw_failed', detail: 'The estate directory refused the write — nothing changed.' },
      502,
    );
  }
});
