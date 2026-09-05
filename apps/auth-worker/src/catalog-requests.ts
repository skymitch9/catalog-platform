/**
 * CATALOG REQUESTS — the "+" on the heygabi.ai Books and Games cards.
 *
 * Design: docs/info/request-a-catalog-design.md (§3.6 is this file's pinned
 * route contract; §2 the flow, §3 the data model, §5 the /admin half).
 * Owner ask, 2026-09-05 06:26 Phoenix: *"Remember that doc about requesting a
 * board game or book site? Time to build that."*
 *
 * 🔴 THE ONE THING TO UNDERSTAND BEFORE EDITING: NOTHING HERE CREATES A
 * CATALOG. A catalog exists when a wrangler env block, a D1 database, an R2
 * bucket, a hostname and a deploy exist — ten manual steps across three
 * consoles, a `wrangler.toml` edit, an auth-worker `CONSUMER_APPS` + `vis_`
 * CODE AND MIGRATION change, two secret ceremonies and a guarded deploy
 * (design §7). About half of that is automatable; the two steps that must stay
 * manual are exactly the access-increasing and code-review-gated ones this
 * estate already fences. So ACCEPT NEVER DEPLOYS. It sets a status and hands
 * the owner a checklist.
 *
 * ⚠️ THEREFORE `accepted` IS NOT `live`, AND NO SURFACE MAY SAY IT IS. Between
 * the two, somebody has been told yes and nothing exists. It is the same
 * four-status honesty universe-requests.ts carries for `approved` ≠ `landed`,
 * for the same reason, and the fifth status (`cancelled`) is the requester's
 * own way out while nobody has decided yet.
 *
 * ⚠️ THE SHAPE, THE GUARDS AND THE ERROR GRAMMAR ARE universe-requests.ts's,
 * ON PURPOSE. Same three predicates from middleware/auth.ts, same
 * `{error, detail}` worded for a person, same "a Worker ahead of its migration
 * says so" 503 carrying the command that fixes it, same "one open request per
 * name, enforced in code and never as a UNIQUE index" (0018's header says why),
 * same "a decision is never un-made and a row is never deleted".
 *
 * ⚠️ UNIQUENESS IS CHECKED ACROSS BOTH KINDS, NEVER PER KIND. There is one
 * heygabi.ai DNS namespace: a books catalog at `amber.` and a games catalog at
 * `amber.` are the same hostname and cannot both exist. The per-KIND question
 * ("may this person ask for one of these?") and the per-NAMESPACE question
 * ("is this address free?") are different questions and are asked separately.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings, EstateUserRow } from './env.js';
import { parseOwnerEmails } from './env.js';
import { approverAllows, requireApprovedMember, requireApprover, requireDevops } from './middleware/auth.js';
import type { CatalogKind } from './catalog-names.js';
import { CATALOG_KINDS, checkSubdomain, isCatalogKind, normaliseSubdomain } from './catalog-names.js';
import type { MeCatalog } from './me.js';

/* ------------------------------------------------------------------ *
 * Rows and the wire shape
 * ------------------------------------------------------------------ */

export interface CatalogRequestRow {
  id: number;
  kind: string;
  requester_email: string;
  requester_uid: string | null;
  requester_display_name: string | null;
  desired_subdomain: string;
  display_name: string;
  status: string;
  extra: string | null;
  decided_by: number | null;
  decided_at: string | null;
  decline_reason: string | null;
  provisioned_instance: string | null;
  provisioned_host: string | null;
  reader_key_set: number;
  owner_key_set: number;
  created_at: string;
}

/**
 * ⚠️ `extra` IS READ TOLERANTLY AND NEVER FATALLY. A missing key is a default;
 * unreadable JSON degrades to `{}` rather than to a 500. The design's §3.4 says
 * the shape will grow, which is the whole reason it is an opaque blob — and a
 * renderer that throws on tomorrow's field would make growing it a breaking
 * change. (The same tolerance agent-board-contract.md requires of the board.)
 */
export function parseExtra(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * The wire shape (§3.6).
 *
 * 🔴 A REQUESTER'S EMAIL AND NAME ARE ONLY EVER SHOWN TO AN APPROVER. A member
 * sees their own rows, whose identity they already have; a member must never
 * learn who else asked for what, or which addresses other people wanted.
 *
 * ⚠️ `mine` IS COMPUTED HERE, NOT INFERRED ON THE PAGE FROM THE ABSENCE OF A
 * REQUESTER NAME. That inference is the bug universe-requests.ts found the hard
 * way: an approver's OWN row carries a requester name like every other row, so
 * "no name means mine" quietly takes the withdraw control away from the one
 * person entitled to press it. The server knows who is asking; it says so.
 *
 * ⚠️ THE TWO KEY FIELDS ARE BOOLEANS AND NOTHING ELSE — no ciphertext, no
 * value, no hint, no prefix. Design §6: the requester's sealed key never
 * reaches D1, and there is no decrypt-to-read path anywhere.
 */
export function toWire(row: CatalogRequestRow, forApprover: boolean, viewerEmail?: string) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    desired_subdomain: row.desired_subdomain,
    display_name: row.display_name,
    extra: parseExtra(row.extra),
    created_at: row.created_at,
    decided_at: row.decided_at,
    decline_reason: row.decline_reason,
    provisioned_host: row.provisioned_host,
    reader_key_set: row.reader_key_set === 1,
    owner_key_set: row.owner_key_set === 1,
    mine: viewerEmail !== undefined && row.requester_email === viewerEmail,
    ...(forApprover
      ? {
          requester_email: row.requester_email,
          requester_display_name: row.requester_display_name,
          provisioned_instance: row.provisioned_instance,
        }
      : {}),
  };
}

/* ------------------------------------------------------------------ *
 * The migration-lag branch
 * ------------------------------------------------------------------ */

/**
 * ⚠️ A WORKER AHEAD OF ITS MIGRATION SAYS SO, IN WORDS, WITH THE COMMAND THAT
 * FIXES IT. The alternative — a 500 — is indistinguishable from an outage, and
 * this is the one failure whose cause is exactly knowable from the error.
 */
const TABLE_MISSING = {
  error: 'catalog_request_table_missing',
  detail:
    'The catalog-request table does not exist in this database — the Worker shipped ahead of its ' +
    'migration. Nothing is broken and nothing was lost; no request has been recorded.',
  fix: 'npm run db:migrate (from apps/auth-worker) applies 0018_catalog_requests.sql remotely',
} as const;

function tableMissing(err: unknown): boolean {
  return /no such table/i.test((err as Error)?.message || '');
}

const SELECT_COLS =
  'id, kind, requester_email, requester_uid, requester_display_name, desired_subdomain, display_name, ' +
  'status, extra, decided_by, decided_at, decline_reason, provisioned_instance, provisioned_host, ' +
  'reader_key_set, owner_key_set, created_at';

/**
 * The statuses that HOLD a name, and the statuses a person's own "+" is hidden
 * by. Deliberately the same three, and deliberately NOT the same query:
 * `OPEN_OR_LIVE` is asked of the whole NAMESPACE (either kind), the "+" is
 * asked per KIND. Design §3.3 and §4.3.
 */
export const OPEN_OR_LIVE = ['pending', 'accepted', 'live'] as const;

/* ------------------------------------------------------------------ *
 * Availability — the one place shape, reservation and D1 are composed
 * ------------------------------------------------------------------ */

export type Availability =
  | { available: true; name: string; reason: null; detail: string }
  | { available: false; name: string; reason: 'shape' | 'reserved' | 'taken'; detail: string };

/**
 * ⚠️ `excludeId` EXISTS FOR THE ACCEPT PANEL AND FOR NOTHING ELSE. The owner may
 * edit the address before granting (owner, 2026-08-24 23:48Z), and the edited
 * value is re-checked exactly as submit checks it — but the row being decided
 * holds its OWN name, so without the exclusion an owner who edits the display
 * name and leaves the address alone would be told the address is taken by
 * himself.
 */
async function availability(db: D1Database, input: unknown, excludeId?: number): Promise<Availability> {
  const verdict = checkSubdomain(input);
  if (!verdict.ok) return { available: false, name: verdict.name, reason: verdict.reason, detail: verdict.detail };

  const held = await db
    .prepare(
      `SELECT id FROM catalog_request WHERE desired_subdomain = ?1 AND status IN ('pending','accepted','live') ` +
        'AND (?2 IS NULL OR id <> ?2) LIMIT 1',
    )
    .bind(verdict.name, excludeId ?? null)
    .first<{ id: number }>();

  if (held) {
    return {
      available: false,
      name: verdict.name,
      reason: 'taken',
      // ⚠️ It names the ADDRESS and nothing about who holds it. A refusal that
      // said "Amber asked for that" would leak the queue to every member with a
      // form and a word list.
      detail: `${verdict.name}.heygabi.ai is already in use — pick another.`,
    };
  }
  return {
    available: true,
    name: verdict.name,
    reason: null,
    detail: `${verdict.name}.heygabi.ai is free.`,
  };
}

/* ------------------------------------------------------------------ *
 * Body parsing — refuses, never strips
 * ------------------------------------------------------------------ */

export const DISPLAY_NAME_MAX = 80;
export const EXTRA_MAX = 4000;

/**
 * ⚠️ THE 10-CHARACTER FLOOR ON A DECLINE REASON IS universe-requests.ts's
 * `WHY_MIN`, COPIED ON PURPOSE. The requester is shown the reason VERBATIM, so
 * the page is allowed to rely on there being one — which is only safe because
 * this check is at the route. "Somewhere else in the estate already" answers
 * the question; a bare no starts an argument.
 */
export const REASON_MIN = 10;

export interface ParsedSubmit {
  kind: CatalogKind;
  desired_subdomain: string;
  display_name: string;
  extra: Record<string, unknown> | null;
}

export type ParseError = { error: string; detail: string };

/** ⚠️ REFUSES, NEVER STRIPS — the estate's standing rule for every write door. */
const SUBMIT_KEYS = new Set(['kind', 'desired_subdomain', 'display_name', 'extra']);

export function parseSubmitBody(body: unknown): ParsedSubmit | ParseError {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'not_an_object', detail: 'Send a JSON object describing the catalog you want.' };
  }
  const obj = body as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!SUBMIT_KEYS.has(k)) {
      return {
        error: 'unknown_field',
        detail:
          `“${k}” is not a field this request understands. Known: ${[...SUBMIT_KEYS].join(', ')}. ` +
          'Your identity is taken from the sign-in, never from the body — there is no email field.',
      };
    }
  }

  // ⚠️ `kind` IS REQUIRED AND HAS NO DEFAULT ON THE WIRE. It is browser-supplied
  // (nothing server-side knows which card was pressed), so it is validated
  // against the closed list and anything else is a 400. The COLUMN's
  // `DEFAULT 'books'` is the migration's own safety net, not a route behaviour:
  // silently defaulting here would file a books request for somebody who asked
  // for games, and the two have different provisioning stories entirely.
  if (!isCatalogKind(obj.kind)) {
    return {
      error: 'bad_kind',
      detail:
        `A catalog request has to say which kind it is — ${CATALOG_KINDS.join(' or ')}. ` +
        'That comes from which card the “+” was pressed on, so a request without it is a request ' +
        'nobody can provision.',
    };
  }

  const verdict = checkSubdomain(obj.desired_subdomain);
  if (!verdict.ok) {
    return { error: verdict.reason === 'reserved' ? 'reserved' : 'bad_subdomain', detail: verdict.detail };
  }

  const displayName = typeof obj.display_name === 'string' ? obj.display_name.trim() : '';
  if (!displayName) {
    return {
      error: 'no_display_name',
      detail: 'Give the catalog a name — it is what shows on heygabi.ai beside the address.',
    };
  }
  if (displayName.length > DISPLAY_NAME_MAX) {
    return {
      error: 'display_name_too_long',
      detail: `That name is longer than the ${DISPLAY_NAME_MAX} characters the field holds.`,
    };
  }

  let extra: Record<string, unknown> | null = null;
  if (obj.extra !== undefined && obj.extra !== null) {
    if (typeof obj.extra !== 'object' || Array.isArray(obj.extra)) {
      return { error: 'bad_extra', detail: '“extra” must be a JSON object, or left out.' };
    }
    const serialised = JSON.stringify(obj.extra);
    if (serialised.length > EXTRA_MAX) {
      return { error: 'extra_too_big', detail: 'That request carries more extra detail than the field holds.' };
    }
    extra = obj.extra as Record<string, unknown>;
  }

  return { kind: obj.kind, desired_subdomain: verdict.name, display_name: displayName, extra };
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

export const catalogRequestRoutes = new Hono<AppBindings>();

function isOwnerActor(c: Context<AppBindings>, row: EstateUserRow): boolean {
  return parseOwnerEmails(c.env.OWNER_EMAILS).includes(row.email.trim().toLowerCase());
}

/**
 * 🔴 THE SECOND BARRIER FOR OWNER DECISION §9 ROW 2 — *"only approved people"*
 * may request (owner, 2026-09-05 ~06:58 Phoenix).
 *
 * ⚠️ `requireApprovedMember()` IS MEASURABLY LOOSER THAN ITS NAME, and this is
 * the check that closes the gap. `memberAllows(row, isOwner)` returns TRUE for
 * an OWNER_EMAILS actor **regardless of table state** — that is the deliberate
 * break-glass — and `materializeOwnerRow()` only inserts an approved row when
 * none exists (`ON CONFLICT(email) DO UPDATE SET email = estate_user.email`
 * deliberately does NOT promote an existing one). So an owner whose directory
 * row happens to read `pending` or `revoked` reaches the handler with
 * `actor.status !== 'approved'`.
 *
 * That is not a hole to plug by refusing the owner — the estate's own §4.3
 * defines an OWNER_EMAILS actor as approved regardless of the table, and
 * `meAnswer()` reports exactly that. It is a hole to plug by writing the rule
 * down where it can be read: EFFECTIVE status is `owner ? 'approved' : the
 * row's`, and everything else is refused with the four causes kept distinct.
 */
function refuseIfNotApproved(c: Context<AppBindings>, actor: EstateUserRow) {
  if (isOwnerActor(c, actor) || actor.status === 'approved') return null;
  if (actor.status === 'revoked') {
    return c.json(
      {
        error: 'estate_revoked',
        detail:
          'Your estate access was revoked, so a catalog cannot be requested from this account. ' +
          'Ask the owner if that was not meant.',
      },
      403,
    );
  }
  return c.json(
    {
      error: 'estate_pending',
      detail:
        'Your estate membership is still awaiting approval, and a catalog can only be asked for by an ' +
        'approved member. The owner sees your name on /admin; there is nothing more for you to do.',
    },
    403,
  );
}

/**
 * GET /estate/catalogs/availability?name= — the ONE availability answer.
 *
 * ⚠️ THE HOME SITE MUST NOT KEEP A COPY OF THE RESERVED LIST. It asks here and
 * renders what comes back. §3.3's whole argument is that two copies of a
 * hostname list drift and the drifted one is always the check that mattered;
 * this route is what makes one copy sufficient.
 *
 * Member-gated because the answer leaks which names the estate holds, and
 * because only an approved member can act on it anyway.
 */
catalogRequestRoutes.get('/estate/catalogs/availability', requireApprovedMember(), async (c) => {
  const raw = c.req.query('name') ?? '';
  try {
    const answer = await availability(c.env.DB, raw);
    return c.json({ ok: true, ...answer });
  } catch (err) {
    // ⚠️ NO GUESSING TO UNBLOCK. If the table is missing, availability is
    // UNKNOWN — and "unknown" must never be rendered as "free", which is what a
    // tolerant fallback here would produce, one keystroke before somebody files
    // a request for a name the estate already routes.
    if (tableMissing(err)) return c.json(TABLE_MISSING, 503);
    return c.json(
      {
        error: 'availability_unreadable',
        detail: 'Couldn’t reach the estate directory — that’s an outage, not a permissions problem. Try again.',
      },
      502,
    );
  }
});

/**
 * POST /estate/catalogs/requests — file one.
 *
 * ⚠️ EVERY CHECK THE FORM MAKES RUNS AGAIN HERE. The browser's copy is a
 * convenience; the row that lands in D1 is the one that matters, and a form is
 * a thing anybody can skip.
 */
catalogRequestRoutes.post('/estate/catalogs/requests', requireApprovedMember(), async (c) => {
  const actor = c.get('actor');
  const refusal = refuseIfNotApproved(c, actor);
  if (refusal) return refusal;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', detail: 'That body is not valid JSON.' }, 400);
  }
  const parsed = parseSubmitBody(body);
  if ('error' in parsed) return c.json(parsed, 400);

  // ⚠️ IDENTITY IS SNAPSHOTTED FROM THE ACTOR, NEVER TAKEN FROM THE BODY. There
  // is no email field on the wire (parseSubmitBody refuses one), so a request
  // cannot be filed on somebody else's behalf. The uid and display name are
  // recorded as they were AT SUBMIT — a later rename must not silently rewrite
  // who asked, and nothing joins on the uid (design §3.2).
  const email = actor.email.trim().toLowerCase();

  try {
    // ⚠️ ONE OPEN REQUEST PER PERSON PER KIND, enforced in code and never as a
    // UNIQUE index (0018's header says why: a DB constraint would hold a
    // declined request's address hostage forever). Per KIND, because a person
    // who owns a books catalog may still ask for a games one — §4.3.
    const open = await c.env.DB.prepare(
      "SELECT id, status FROM catalog_request WHERE requester_email = ?1 AND kind = ?2 " +
        "AND status IN ('pending','accepted','live') LIMIT 1",
    )
      .bind(email, parsed.kind)
      .first<{ id: number; status: string }>();
    if (open) {
      return c.json(
        {
          error: 'already_requested',
          request_id: open.id,
          status: open.status,
          detail:
            open.status === 'live'
              ? `You already have a ${parsed.kind} catalog — request #${open.id} is live.`
              : open.status === 'accepted'
                ? `Your ${parsed.kind} catalog request is accepted and being set up — request #${open.id}. ` +
                  'It is not live yet; standing one up is a manual job.'
                : `You already asked for a ${parsed.kind} catalog — request #${open.id}, still waiting on a decision.`,
        },
        409,
      );
    }

    const free = await availability(c.env.DB, parsed.desired_subdomain);
    if (!free.available) {
      return c.json(
        { error: free.reason === 'taken' ? 'taken' : free.reason === 'reserved' ? 'reserved' : 'bad_subdomain', detail: free.detail },
        free.reason === 'taken' ? 409 : 400,
      );
    }

    const row = await c.env.DB.prepare(
      'INSERT INTO catalog_request (kind, requester_email, requester_uid, requester_display_name, ' +
        'desired_subdomain, display_name, extra, status) ' +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending') RETURNING id",
    )
      .bind(
        parsed.kind,
        email,
        actor.firebase_uid ?? null,
        actor.display_name ?? null,
        parsed.desired_subdomain,
        parsed.display_name,
        parsed.extra ? JSON.stringify(parsed.extra) : null,
      )
      .first<{ id: number }>();

    return c.json(
      {
        ok: true,
        id: row?.id ?? null,
        kind: parsed.kind,
        desired_subdomain: parsed.desired_subdomain,
        display_name: parsed.display_name,
        status: 'pending',
        // ⚠️ SAID AT THE MOMENT OF ASKING, not discovered later. The requester
        // must not walk away believing a catalog now exists, or is minutes away.
        detail:
          'Asked. The owner reviews every request, and even a yes is not immediate — standing up a catalog ' +
          'is a manual job across several consoles, so there is a wait between “accepted” and “live”.',
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
 * GET /estate/catalogs/requests — own rows, or every row for an approver.
 *
 * ⚠️ THE TWO ANSWERS DIFFER IN WHAT THEY CONTAIN, not just in how many rows.
 * See toWire(): only an approver's copy names the requester.
 */
catalogRequestRoutes.get('/estate/catalogs/requests', requireApprovedMember(), async (c) => {
  const actor = c.get('actor');
  const canSeeAll = approverAllows(actor, isOwnerActor(c, actor));
  const email = actor.email.trim().toLowerCase();
  try {
    const stmt = canSeeAll
      ? c.env.DB.prepare(`SELECT ${SELECT_COLS} FROM catalog_request ORDER BY id DESC`)
      : c.env.DB.prepare(
          `SELECT ${SELECT_COLS} FROM catalog_request WHERE requester_email = ?1 ORDER BY id DESC`,
        ).bind(email);
    const { results } = await stmt.all<CatalogRequestRow>();
    return c.json({
      requests: (results ?? []).map((r) => toWire(r, canSeeAll, email)),
      scope: canSeeAll ? 'all' : 'mine',
      is_approver: canSeeAll,
      kinds: [...CATALOG_KINDS],
    });
  } catch (err) {
    // The READ degrades to an empty queue with an explanation — the /admin
    // panel must still render, per the degrade-alone rule the verse queue set.
    if (tableMissing(err)) {
      return c.json({ ...TABLE_MISSING, requests: [], scope: canSeeAll ? 'all' : 'mine', is_approver: canSeeAll }, 200);
    }
    return c.json(
      {
        error: 'requests_unreadable',
        detail: 'Couldn’t reach the estate directory — that’s an outage, not a permissions problem.',
      },
      502,
    );
  }
});

/**
 * POST /estate/catalogs/requests/:id/decide — the owner's call.
 *
 * ⚠️ ACCEPTING RUNS NOTHING. It does not create a D1, a bucket, a hostname or a
 * Worker, and it does not deploy. It sets a status and unlocks the runbook;
 * design §7 is the rest, done by a person at a dev machine. A button that
 * pretended otherwise would be the shipped-≠-verified failure with a catalog's
 * worth of blast radius behind it.
 *
 * ⚠️ THE OWNER MAY EDIT THE ADDRESS AND THE DISPLAY NAME BEFORE GRANTING
 * (owner, 2026-08-24 23:48Z — *"You're not locked to what they typed"*). Both
 * edited values go through the SAME validator submit used, and the address is
 * re-checked for availability excluding this row. A field the owner may edit at
 * the last moment is a field that must be re-validated at the last moment.
 *
 * ⚠️ A DECLINE WITHOUT A REASON IS REFUSED AT THE ROUTE, not just in the form —
 * the requester is shown `decline_reason` verbatim.
 */
catalogRequestRoutes.post('/estate/catalogs/requests/:id/decide', requireApprover(), async (c) => {
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
  if (decision !== 'accept' && decision !== 'decline') {
    return c.json({ error: 'bad_decision', detail: 'A decision is either “accept” or “decline”.' }, 400);
  }
  const reason = typeof obj.reason === 'string' ? obj.reason.trim() : '';
  if (decision === 'decline' && reason.length < REASON_MIN) {
    return c.json(
      {
        error: 'no_reason',
        detail:
          `A decline needs a reason of at least ${REASON_MIN} characters — the requester is shown it ` +
          'verbatim, and their “+” comes back so they can ask again. A bare no starts an argument.',
      },
      400,
    );
  }

  const actor = c.get('actor');
  try {
    const existing = await c.env.DB.prepare(`SELECT ${SELECT_COLS} FROM catalog_request WHERE id = ?1`)
      .bind(id)
      .first<CatalogRequestRow>();
    if (!existing) return c.json({ error: 'not_found', detail: `There is no catalog request #${id}.` }, 404);
    // ⚠️ A DECISION IS NEVER UN-MADE. Not into pending, not into the other
    // decision — an accepted request whose provisioning has begun cannot be
    // declined out from under the person doing it, and a declined one is
    // re-requested as a NEW row rather than resurrected.
    if (existing.status !== 'pending') {
      return c.json(
        {
          error: 'not_pending',
          status: existing.status,
          detail: `Catalog request #${id} is already ${existing.status} — it is not waiting on a decision.`,
        },
        409,
      );
    }

    let subdomain = existing.desired_subdomain;
    let displayName = existing.display_name;

    if (obj.desired_subdomain !== undefined) {
      const edited = await availability(c.env.DB, obj.desired_subdomain, id);
      if (!edited.available) {
        return c.json(
          {
            error: edited.reason === 'taken' ? 'taken' : edited.reason === 'reserved' ? 'reserved' : 'bad_subdomain',
            detail: edited.detail,
          },
          edited.reason === 'taken' ? 409 : 400,
        );
      }
      subdomain = edited.name;
    }
    if (obj.display_name !== undefined) {
      const edited = typeof obj.display_name === 'string' ? obj.display_name.trim() : '';
      if (!edited) {
        return c.json({ error: 'no_display_name', detail: 'A catalog needs a name to show on heygabi.ai.' }, 400);
      }
      if (edited.length > DISPLAY_NAME_MAX) {
        return c.json(
          { error: 'display_name_too_long', detail: `That name is longer than the ${DISPLAY_NAME_MAX} characters the field holds.` },
          400,
        );
      }
      displayName = edited;
    }

    const status = decision === 'accept' ? 'accepted' : 'declined';
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE catalog_request SET status = ?1, desired_subdomain = ?2, display_name = ?3, ' +
        "decided_by = ?4, decided_at = ?5, decline_reason = ?6 WHERE id = ?7 AND status = 'pending'",
    )
      .bind(status, subdomain, displayName, actor.id, now, decision === 'decline' ? reason : null, id)
      .run();

    return c.json({
      ok: true,
      id,
      status,
      kind: existing.kind,
      // ⚠️ THE ANSWER ECHOES THE FINAL VALUES, not the submitted ones. The owner
      // may have changed them a line ago, and every surface downstream — the
      // panel, the runbook, the requester's own row — must agree on which
      // address was actually granted.
      desired_subdomain: subdomain,
      display_name: displayName,
      decided_at: now,
      detail:
        decision === 'accept'
          ? `Accepted as ${subdomain}.heygabi.ai. Nothing has been created — accepting sets a status and ` +
            'hands over the provisioning runbook; the catalog exists when those steps have been run by hand.'
          : 'Declined, with the reason recorded. The requester sees it, and their “+” comes back so they can ask again.',
    });
  } catch (err) {
    if (tableMissing(err)) return c.json(TABLE_MISSING, 503);
    return c.json({ error: 'decide_failed', detail: 'The estate directory refused the write — nothing changed.' }, 502);
  }
});

/**
 * POST /estate/catalogs/requests/:id/live — close the loop.
 *
 * The session or person who actually PROVISIONED the catalog says so, naming
 * the wrangler env and the real hostname. `requireDevops()` and not
 * `requireApprover()`: this is a statement about a DEPLOY, made by whoever ran
 * it, and it grants nobody anything.
 *
 * ⚠️ ONLY FROM `accepted`. Marking a pending or declined request live would put
 * a catalog in the estate's ownership record that nobody said yes to — and this
 * table is what §4.3's per-card show/hide reads.
 */
catalogRequestRoutes.post('/estate/catalogs/requests/:id/live', requireDevops(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id', detail: 'That is not a request id.' }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', detail: 'That body is not valid JSON.' }, 400);
  }
  const obj = (body ?? {}) as Record<string, unknown>;
  const instance = typeof obj.provisioned_instance === 'string' ? obj.provisioned_instance.trim() : '';
  const host = typeof obj.provisioned_host === 'string' ? obj.provisioned_host.trim().toLowerCase() : '';

  // ⚠️ BOTH ARE REQUIRED, and they are the whole point of the route. "It is
  // live" with nothing to point at is exactly the unverifiable claim this
  // status exists to replace — the same argument 0017's `landed_commit` makes.
  if (!instance) {
    return c.json(
      {
        error: 'no_instance',
        detail:
          'Name the wrangler environment that was actually created (the `[env.<name>]` block). A live row ' +
          'with no instance cannot be traced back to anything.',
      },
      400,
    );
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
    return c.json(
      {
        error: 'bad_host',
        detail: 'Send the real hostname the catalog answers on, e.g. amber.heygabi.ai.',
      },
      400,
    );
  }

  const bool = (v: unknown): number | null => {
    if (v === undefined) return null;
    if (v === true || v === 1) return 1;
    if (v === false || v === 0) return 0;
    return -1; // a sentinel the caller turns into a 400
  };
  const readerKey = bool(obj.reader_key_set);
  const ownerKey = bool(obj.owner_key_set);
  if (readerKey === -1 || ownerKey === -1) {
    return c.json(
      {
        error: 'bad_key_flag',
        // ⚠️ Said out loud because it is the one field somebody will eventually
        // try to be helpful with.
        detail:
          '`reader_key_set` and `owner_key_set` are true/false only. They record WHETHER a key was set, ' +
          'never anything about the key itself — no value, no hint, no prefix ever goes in this table.',
      },
      400,
    );
  }

  try {
    const existing = await c.env.DB.prepare('SELECT id, status FROM catalog_request WHERE id = ?1')
      .bind(id)
      .first<{ id: number; status: string }>();
    if (!existing) return c.json({ error: 'not_found', detail: `There is no catalog request #${id}.` }, 404);
    if (existing.status !== 'accepted') {
      return c.json(
        {
          error: 'not_accepted',
          status: existing.status,
          detail:
            `Catalog request #${id} is ${existing.status}, not accepted. Only an accepted request can be ` +
            'marked live — this row is what the estate reads to decide who owns a catalog.',
        },
        409,
      );
    }
    await c.env.DB.prepare(
      "UPDATE catalog_request SET status = 'live', provisioned_instance = ?1, provisioned_host = ?2, " +
        'reader_key_set = COALESCE(?3, reader_key_set), owner_key_set = COALESCE(?4, owner_key_set) ' +
        "WHERE id = ?5 AND status = 'accepted'",
    )
      .bind(instance, host, readerKey, ownerKey, id)
      .run();
    return c.json({ ok: true, id, status: 'live', provisioned_instance: instance, provisioned_host: host });
  } catch (err) {
    if (tableMissing(err)) return c.json(TABLE_MISSING, 503);
    return c.json({ error: 'live_failed', detail: 'The estate directory refused the write — nothing changed.' }, 502);
  }
});

/**
 * POST /estate/catalogs/requests/:id/withdraw — the requester's own way out.
 *
 * ⚠️ REQUESTER-ONLY, AND ONLY WHILE PENDING. Access-reducing, reversible (ask
 * again), and it keeps the queue honest. An APPROVER wanting a row gone uses
 * `decide` with a reason — a queue that can be silently emptied by somebody
 * other than the person who filled it is a queue with no record.
 *
 * ⚠️ And NOT from `accepted`: by then the owner has begun a ten-step manual job
 * on the requester's behalf, and cancelling it from a browser would leave real
 * infrastructure behind a row that says it was never wanted.
 */
catalogRequestRoutes.post('/estate/catalogs/requests/:id/withdraw', requireApprovedMember(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id', detail: 'That is not a request id.' }, 400);
  const actor = c.get('actor');
  const email = actor.email.trim().toLowerCase();
  try {
    const existing = await c.env.DB.prepare('SELECT id, status, requester_email FROM catalog_request WHERE id = ?1')
      .bind(id)
      .first<{ id: number; status: string; requester_email: string }>();
    if (!existing) return c.json({ error: 'not_found', detail: `There is no catalog request #${id}.` }, 404);
    if (existing.requester_email !== email) {
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
          detail:
            existing.status === 'accepted'
              ? `Catalog request #${id} has already been accepted and is being set up — ask the owner to stop.`
              : `Catalog request #${id} is already ${existing.status}, so there is nothing to withdraw.`,
        },
        409,
      );
    }
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      "UPDATE catalog_request SET status = 'cancelled', decided_at = ?1 WHERE id = ?2 AND status = 'pending'",
    )
      .bind(now, id)
      .run();
    return c.json({ ok: true, id, status: 'cancelled' });
  } catch (err) {
    if (tableMissing(err)) return c.json(TABLE_MISSING, 503);
    return c.json({ error: 'withdraw_failed', detail: 'The estate directory refused the write — nothing changed.' }, 502);
  }
});

/* ------------------------------------------------------------------ *
 * The ownership signal `/api/estate/me` grew (§4.2)
 * ------------------------------------------------------------------ */

/**
 * The caller's own catalog rows for GET /api/estate/me — `pending`, `accepted`
 * and `live`, newest first.
 *
 * 🔴 THIS IS THE OWNERSHIP FACT THE ESTATE GENUINELY LACKED. `visibility` is
 * which catalogs you may SEE, never which you OWN, and nothing else answers the
 * second question. Every entry carries its `kind`, because §4.3's show/hide is a
 * PER-CARD question and a flat list of hostnames cannot answer it.
 *
 * ⚠️ RETURNS `undefined`, NOT `[]`, WHEN THE TABLE IS MISSING — and the two
 * mean opposite things. `[]` is "you own nothing", which draws the "+";
 * `undefined` is "this Worker cannot answer", which must leave the affordance
 * HIDDEN (the fail-quiet posture apex-admin-link.js already models). Collapsing
 * them would draw a button whose route answers 503, on a page that promises the
 * opposite.
 *
 * ⚠️ IT DOES NOT THROW ON A BROKEN DATABASE EITHER — /me answers six fields
 * that have nothing to do with catalogs, and a catalog table hiccup must not
 * take down the answer every page's sign-in path depends on. It degrades to
 * `undefined`, which is already the "cannot answer" signal.
 */
export async function catalogsForMe(db: D1Database, email: string | null): Promise<MeCatalog[] | undefined> {
  if (!email) return [];
  try {
    const { results } = await db
      .prepare(
        'SELECT id, kind, status, desired_subdomain, display_name, provisioned_host FROM catalog_request ' +
          "WHERE requester_email = ?1 AND status IN ('pending','accepted','live') ORDER BY id DESC",
      )
      .bind(email.trim().toLowerCase())
      .all<{
        id: number;
        kind: string;
        status: string;
        desired_subdomain: string;
        display_name: string;
        provisioned_host: string | null;
      }>();
    return (results ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      desired_subdomain: r.desired_subdomain,
      display_name: r.display_name,
      provisioned_host: r.provisioned_host,
    }));
  } catch {
    return undefined;
  }
}
