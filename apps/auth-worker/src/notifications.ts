/**
 * PER-PERSON NOTICES — "the thing you asked for was decided".
 *
 * Phase 4 of docs/info/universe-add-verse-design.md, whose §4 phase table says
 * only: *"Notification when a request is decided (reuse `estate_prefs` /
 * `notify-prefs.ts`)"*. That clause is honoured in the half it actually fits —
 * the OPT-OUT lives in `estate_prefs` (0014) under `notify:user:<id>`, parsed
 * with the same idioms as `notify-prefs.ts` — and departed from in the half it
 * does not: see §8 of the design and 0019's header for why a stream of dated
 * messages addressed to people is not a settings row.
 *
 * ⚠️ WHAT THIS IS, EXACTLY: IN-APP DELIVERY. A notice is written where the
 * person can read it next time they are signed in. **Nothing here buzzes a
 * phone, sends an email or DMs anybody**, and the reason is not an oversight:
 * this Worker holds no outbound channel to a member. `notify-prefs.ts` is the
 * OWNER's phone, delivered by the conductor, which reads the prefs over its own
 * bearer; there is no equivalent for anybody else. Email would need a mail
 * credential; a GABI DM would need `estate-auth` to hold a Discord bearer (and
 * `CONSUMER_APPS` to accept one, which `test/dev-access.test.ts` guards
 * against by name). Both are access-INCREASING and the owner's to mint, so the
 * queue is built and the channel is named rather than assumed. A later
 * deliverer drains these rows; until one exists the estate is honest that a
 * notice waits to be READ rather than claiming it was SENT.
 *
 * ⚠️ WHY THIS IS NOT A SECOND COPY OF THE /universes QUEUE, which the estate's
 * one-fact-one-home rule would otherwise refuse. That queue answers *"what is
 * the state of my requests"* — a list you go and look at, always current. A
 * notice answers *"what changed since I last looked"*: it is dated, it quotes
 * the decider's words AS THEY STOOD AT THE MOMENT OF THE DECISION, and it can
 * be marked read. The status is the fact; the notice is the event. Rendering
 * the notice by re-reading the row would make a message about the past change
 * when the past changes.
 *
 * ⚠️ AND IT IS NOT THE WORKER EVENT RING. `worker-events.ts`'s own header:
 * *"a noticeboard, not a log … errors, refusals worth a human's attention, and
 * deploy markers. Not requests."* It is also per-WORKER and read behind
 * `requireDevops()`, so a member could never see a line addressed to them.
 * ⚠️ The ring IS used here for exactly one thing, which is the thing it is for:
 * when writing a notice FAILS, one `warn` line goes to the ring — a silent
 * notifier is the failure this whole phase exists to prevent.
 *
 * 🔴 A FAILURE TO NOTIFY MUST NEVER FAIL THE DECISION. Every path out of
 * `notifyDecision()` is swallowed, and the write is handed to `waitUntil` —
 * the same shape as `recordOwnEvent()`, for the same reason: an approver
 * pressing "approve" must not meet a 502 because a courtesy message could not
 * be stored. The decision is the durable fact; the notice is a kindness.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from './env.js';
import { requireApprovedMember } from './middleware/auth.js';
import { recordOwnEvent } from './worker-events.js';

/* ------------------------------------------------------------------ *
 * Classes and per-person preferences — the `estate_prefs` half
 * ------------------------------------------------------------------ */

/** One row per person in `estate_prefs`, keyed by their estate id. */
export function userPrefsKey(userId: number): string {
  return `notify:user:${userId}`;
}

/**
 * The classes a MEMBER can switch, and what each means in words.
 *
 * ⚠️ Deliberately a different list from `NOTIFY_CLASSES` in `notify-prefs.ts`,
 * and deliberately not merged with it. Those four are the OWNER's operational
 * alerts (a pipeline failing, an agent landing) delivered by the conductor to a
 * phone; these are messages addressed to a person about their own requests.
 * One list would mean a member's toggle appearing on the ops card, or the
 * owner's pipeline alerts appearing on a member's page.
 *
 * ⚠️ DEFAULT ON, and that is the asymmetry `notify-prefs.ts` argues for from
 * the other side: its routine successes default OFF because a phone that buzzes
 * for everything gets silenced. Nothing here buzzes anything — a notice waits
 * quietly to be read — and the cost of missing it is a person who asked for a
 * verse never learning the answer.
 */
export const MEMBER_NOTICE_CLASSES = [
  {
    key: 'verse_decided',
    label: 'A verse I asked for is decided',
    detail: 'The owner approves, declines, or a build finally lands the universe you requested.',
    default: true,
  },
] as const;

export type MemberNoticeClass = (typeof MEMBER_NOTICE_CLASSES)[number]['key'];

export interface MemberPrefs {
  [key: string]: boolean;
}

export function defaultMemberPrefs(): MemberPrefs {
  const out: MemberPrefs = {};
  for (const c of MEMBER_NOTICE_CLASSES) out[c.key] = c.default;
  return out;
}

/**
 * Stored JSON -> prefs, defaults filled in.
 *
 * ⚠️ AN UNREADABLE ROW FALLS BACK TO DEFAULTS RATHER THAN TO SILENCE — copied
 * from `parsePrefs()` in `notify-prefs.ts` along with its reasoning: a corrupted
 * value turning every notice off without saying so is experienced as "the estate
 * went quiet", which is indistinguishable from "nothing happened".
 */
export function parseMemberPrefs(raw: string | null | undefined): MemberPrefs {
  const out = defaultMemberPrefs();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'boolean' && MEMBER_NOTICE_CLASSES.some((c) => c.key === k)) out[k] = v;
  }
  return out;
}

/** ⚠️ REFUSES, NEVER STRIPS — the estate's standing rule for every write door. */
export function parseMemberPrefsBody(body: unknown): { prefs: MemberPrefs } | { error: string; detail: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'not_an_object', detail: 'Send a JSON object of { "<class>": true | false }.' };
  }
  const known = new Set<string>(MEMBER_NOTICE_CLASSES.map((c) => c.key));
  const out = defaultMemberPrefs();
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!known.has(k)) {
      return {
        error: 'unknown_class',
        detail: `“${k}” is not a notice this estate knows. Known: ${[...known].join(', ')}.`,
      };
    }
    if (typeof v !== 'boolean') {
      return { error: 'not_a_boolean', detail: `“${k}” must be true or false, not ${typeof v}.` };
    }
    out[k] = v;
  }
  return { prefs: out };
}

/**
 * Read one person's prefs.
 *
 * ⚠️ A MISSING `estate_prefs` TABLE READS AS "THE DEFAULTS", NOT AS "OFF". The
 * failure being avoided is a Worker deployed ahead of 0014 silently notifying
 * nobody; defaults-on means the estate degrades to telling people things.
 */
export async function readMemberPrefs(db: D1Database, userId: number): Promise<MemberPrefs> {
  try {
    const row = await db
      .prepare('SELECT value FROM estate_prefs WHERE key = ?1')
      .bind(userPrefsKey(userId))
      .first<{ value: string }>();
    return parseMemberPrefs(row?.value ?? null);
  } catch {
    return defaultMemberPrefs();
  }
}

/* ------------------------------------------------------------------ *
 * Composing a notice — pure, so the words are testable
 * ------------------------------------------------------------------ */

export const NOTICE_KINDS = ['verse_approved', 'verse_declined', 'verse_landed'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/**
 * Which switch governs which kind.
 *
 * ⚠️ EXHAUSTIVE ON PURPOSE — a `switch` and not a lookup with a default, so that
 * adding a kind without giving it a class is a COMPILE error rather than a
 * notice nobody can turn off.
 */
export function classOf(kind: NoticeKind): MemberNoticeClass {
  switch (kind) {
    case 'verse_approved':
    case 'verse_declined':
    case 'verse_landed':
      return 'verse_decided';
  }
}

export interface Notice {
  kind: NoticeKind;
  subject: string;
  body: string;
  link: string | null;
  source: string;
  source_id: number;
}

/** ⚠️ Kept per-notice rather than hardcoded in the page: a page cannot be the record of where a notice pointed. */
export const UNIVERSES_LINK = 'https://heygabi.ai/universes/';

/**
 * The words a requester reads, composed at decision time.
 *
 * ⚠️ THE DECIDER'S NOTE IS QUOTED VERBATIM AND NEVER PARAPHRASED — the same
 * rule the /universes page follows for `decided_why`, and for the same reason:
 * a decline the requester can argue with is a decline in the owner's own words.
 *
 * ⚠️ `approved` NEVER READS AS DONE. Between a yes and a build the estate is in
 * a state where a person has been told yes and nothing exists (design §3.4), and
 * a notice saying "your verse now exists" would be the exact lie the fourth
 * status was invented to prevent.
 */
export function verseNotice(args: {
  kind: NoticeKind;
  requestId: number;
  name: string;
  note?: string | null;
  commit?: string | null;
}): Notice {
  const { kind, requestId, name } = args;
  const note = typeof args.note === 'string' && args.note.trim() ? args.note.trim() : null;
  const quoted = note ? `\n\nThey said: “${note}”` : '';

  if (kind === 'verse_approved') {
    return {
      kind,
      subject: `“${name}” was approved`,
      body:
        `Your request for the ${name} universe was approved.\n\n` +
        'It is not live yet, and that is normal: a universe is a change to a file in git that both catalogs ' +
        'have to be rebuilt from, so the list will not show it until the next build.' +
        quoted,
      link: UNIVERSES_LINK,
      source: 'universe_request',
      source_id: requestId,
    };
  }
  if (kind === 'verse_declined') {
    return {
      kind,
      subject: `“${name}” was declined`,
      body:
        `Your request for the ${name} universe was declined.` +
        quoted +
        '\n\nA decline is not final: a better argument, or a name that is genuinely a different verse, can be ' +
        'asked for again.',
      link: UNIVERSES_LINK,
      source: 'universe_request',
      source_id: requestId,
    };
  }
  const commit = typeof args.commit === 'string' && args.commit.trim() ? args.commit.trim() : null;
  return {
    kind,
    subject: `“${name}” is live`,
    body:
      `${name} is now in the estate's universe list — the file change shipped and both catalogs were rebuilt` +
      (commit ? ` (commit ${commit})` : '') +
      '.\n\nIt is on the universes page with the rest of them.' +
      quoted,
    link: UNIVERSES_LINK,
    source: 'universe_request',
    source_id: requestId,
  };
}

/* ------------------------------------------------------------------ *
 * Writing one — the part that must never throw
 * ------------------------------------------------------------------ */

/** Per person, so one busy requester cannot evict another's unread notice. */
export const NOTICES_PER_USER = 100;
export const MAX_SUBJECT = 200;
export const MAX_BODY = 4000;

export type NotifyOutcome = 'written' | 'no_recipient' | 'opted_out' | 'failed';

/**
 * The one place a notice is written. ⚠️ ONE NOTIFIER, NOT TWO — a second copy
 * of this logic anywhere is how "opted out" stops being honoured on one path.
 *
 * Returns its outcome so tests can assert it; callers ignore it, because there
 * is nothing a caller could usefully do about it.
 */
export async function writeNotice(
  db: D1Database,
  userId: number | null | undefined,
  notice: Notice,
  nowIso: string,
): Promise<NotifyOutcome> {
  // ⚠️ NOTHING IS SENT WHEN THERE IS NO PERSON TO SEND IT TO. A row authored by
  // a seed, a script or a `system` principal has no requester, and inventing a
  // recipient for it would write a message nobody is owed into somebody's inbox.
  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) return 'no_recipient';

  const prefs = await readMemberPrefs(db, userId);
  if (prefs[classOf(notice.kind)] === false) return 'opted_out';

  try {
    await db
      .prepare(
        'INSERT INTO estate_notification (user_id, kind, subject, body, link, source, source_id, created_at) ' +
          'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
      )
      .bind(
        userId,
        notice.kind,
        notice.subject.slice(0, MAX_SUBJECT),
        notice.body.slice(0, MAX_BODY),
        notice.link,
        notice.source,
        notice.source_id,
        nowIso,
      )
      .run();
    // Trim, exactly as the event ring does: a queue that grows for ever is a
    // database nobody meant to keep.
    await db
      .prepare(
        'DELETE FROM estate_notification WHERE user_id = ?1 AND id NOT IN ' +
          '(SELECT id FROM estate_notification WHERE user_id = ?1 ORDER BY id DESC LIMIT ?2)',
      )
      .bind(userId, NOTICES_PER_USER)
      .run();
    return 'written';
  } catch {
    return 'failed';
  }
}

/**
 * Fire-and-forget from a request handler.
 *
 * ⚠️ IT NEVER THROWS AND NEVER AWAITS ON THE HOT PATH — `recordOwnEvent()`'s
 * shape, for a stronger reason: this is called from inside a decision that has
 * ALREADY been written to D1. Throwing here would turn a completed approval
 * into a 502 the approver would reasonably retry, and the retry would meet
 * `already_decided`.
 *
 * ⚠️ A FAILURE IS NOT SWALLOWED SILENTLY — it posts one `warn` to the event
 * ring. A notifier that fails quietly is worse than no notifier, because the
 * silence is then trusted.
 */
export function notify(c: Context<AppBindings>, userId: number | null | undefined, notice: Notice): void {
  const nowIso = new Date().toISOString();
  const p = (async () => {
    const outcome = await writeNotice(c.env.DB, userId, notice, nowIso).catch(() => 'failed' as const);
    if (outcome === 'failed') {
      recordOwnEvent(c, {
        level: 'warn',
        message: `A ${notice.kind} notice for ${notice.source} #${notice.source_id} could not be stored.`,
        route: c.req.path,
        detail:
          'The decision itself was written and is not at risk; the person it concerns has not been told, and ' +
          'will only learn of it by visiting the page. Check that migration 0019_estate_notification.sql has ' +
          'been applied to this database.',
      });
    }
  })();
  try {
    c.executionCtx?.waitUntil(p);
  } catch {
    /* no execution context (tests) — the write still runs, un-awaited */
  }
}

/* ------------------------------------------------------------------ *
 * The doors
 * ------------------------------------------------------------------ */

const TABLE_MISSING = {
  error: 'estate_notification_table_missing',
  detail:
    'The notices table does not exist in this database — the Worker shipped ahead of its migration. Nothing is ' +
    'broken and nothing was lost; no notice has been recorded, and every decision is still visible on the page ' +
    'it concerns.',
  fix: 'npm run db:migrate (from apps/auth-worker) applies 0019_estate_notification.sql remotely',
} as const;

function tableMissing(err: unknown): boolean {
  return /no such table/i.test((err as Error)?.message || '');
}

interface NoticeRow {
  id: number;
  kind: string;
  subject: string;
  body: string;
  link: string | null;
  source: string | null;
  source_id: number | null;
  created_at: string;
  read_at: string | null;
}

export const notificationRoutes = new Hono<AppBindings>();

/**
 * GET /estate/notifications — YOUR notices. There is no "everybody's" answer,
 * for anybody, including an approver: a notice is addressed mail, and an
 * approver reading the queue on /admin is a different question with its own
 * door. `requireApprovedMember()` because only an approved member can file the
 * request a notice is about.
 */
notificationRoutes.get('/estate/notifications', requireApprovedMember(), async (c) => {
  const actor = c.get('actor');
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, kind, subject, body, link, source, source_id, created_at, read_at ' +
        'FROM estate_notification WHERE user_id = ?1 ORDER BY id DESC LIMIT ?2',
    )
      .bind(actor.id, NOTICES_PER_USER)
      .all<NoticeRow>();
    const notices = results ?? [];
    return c.json({
      notices,
      unread: notices.filter((n) => !n.read_at).length,
      classes: MEMBER_NOTICE_CLASSES,
    });
  } catch (err) {
    // ⚠️ 200 with an empty list and the fix, not a 500: a page with no notices
    // and a page whose Worker is ahead of its migration look identical to a
    // person, and only one of them is worth a word.
    if (tableMissing(err)) return c.json({ ...TABLE_MISSING, notices: [], unread: 0, classes: MEMBER_NOTICE_CLASSES }, 200);
    return c.json({ error: 'notices_unreadable', detail: 'The estate directory did not answer.' }, 502);
  }
});

/**
 * POST /estate/notifications/:id/read — mark one read.
 *
 * ⚠️ SOMEBODY ELSE'S NOTICE IS A 404, NOT A 403. A 403 would confirm that
 * notice #12 exists and is addressed to a person who is not you; there is no
 * reason for that fact to leave the estate, and the correct answer to "may I
 * see this" is the same as to "does this exist" when neither is yours.
 */
notificationRoutes.post('/estate/notifications/:id/read', requireApprovedMember(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id', detail: 'That is not a notice id.' }, 400);
  const actor = c.get('actor');
  const now = new Date().toISOString();
  try {
    const row = await c.env.DB.prepare('SELECT id, read_at FROM estate_notification WHERE id = ?1 AND user_id = ?2')
      .bind(id, actor.id)
      .first<{ id: number; read_at: string | null }>();
    if (!row) return c.json({ error: 'not_found', detail: `There is no notice #${id} addressed to you.` }, 404);
    if (row.read_at) return c.json({ ok: true, id, read_at: row.read_at });
    await c.env.DB.prepare('UPDATE estate_notification SET read_at = ?1 WHERE id = ?2 AND user_id = ?3')
      .bind(now, id, actor.id)
      .run();
    return c.json({ ok: true, id, read_at: now });
  } catch (err) {
    if (tableMissing(err)) return c.json(TABLE_MISSING, 503);
    return c.json({ error: 'read_failed', detail: 'The estate directory refused the write — nothing changed.' }, 502);
  }
});

/** POST /estate/notifications/read-all — clear the badge in one call rather than N. */
notificationRoutes.post('/estate/notifications/read-all', requireApprovedMember(), async (c) => {
  const actor = c.get('actor');
  const now = new Date().toISOString();
  try {
    await c.env.DB.prepare('UPDATE estate_notification SET read_at = ?1 WHERE user_id = ?2 AND read_at IS NULL')
      .bind(now, actor.id)
      .run();
    return c.json({ ok: true, read_at: now });
  } catch (err) {
    if (tableMissing(err)) return c.json(TABLE_MISSING, 503);
    return c.json({ error: 'read_failed', detail: 'The estate directory refused the write — nothing changed.' }, 502);
  }
});

/**
 * GET/POST /estate/notifications/prefs — YOUR switches, in `estate_prefs`.
 *
 * ⚠️ THIS IS THE OTHER HALF OF `notify-prefs.ts`, NOT A COPY OF IT. That door
 * is `requireDevops()` and its GET also admits the conductor's bearer, because
 * a machine has to OBEY the owner's phone settings. Nothing machine-shaped
 * reads these, so nothing machine-shaped may open this door: a member's own
 * preference is read by the code that writes the notice, in this Worker, off
 * the same D1.
 *
 * Switching your own notices off is access-REDUCING and needs nobody's
 * permission; switching them on restores a default.
 */
notificationRoutes.get('/estate/notifications/prefs', requireApprovedMember(), async (c) => {
  const actor = c.get('actor');
  const prefs = await readMemberPrefs(c.env.DB, actor.id);
  return c.json({ prefs, classes: MEMBER_NOTICE_CLASSES });
});

notificationRoutes.post('/estate/notifications/prefs', requireApprovedMember(), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', detail: 'That body is not valid JSON.' }, 400);
  }
  const parsed = parseMemberPrefsBody(body);
  if ('error' in parsed) return c.json(parsed, 400);

  const actor = c.get('actor');
  const now = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      'INSERT INTO estate_prefs (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, ' +
        'updated_by = excluded.updated_by',
    )
      .bind(userPrefsKey(actor.id), JSON.stringify(parsed.prefs), now, actor.email)
      .run();
  } catch (err) {
    if (/no such table/i.test((err as Error)?.message || '')) {
      return c.json(
        {
          error: 'estate_prefs_table_missing',
          detail:
            'The preferences table does not exist in this database — the Worker shipped ahead of its migration. ' +
            'Nothing is broken and nothing was lost; the estate is using its defaults, which is notices ON.',
          fix: 'npm run db:migrate (from apps/auth-worker) applies 0014_estate_prefs.sql remotely',
        },
        503,
      );
    }
    return c.json(
      { error: 'prefs_write_failed', detail: 'The estate directory refused the write — nothing was stored.' },
      502,
    );
  }
  return c.json({ ok: true, prefs: parsed.prefs, updated_at: now, classes: MEMBER_NOTICE_CLASSES });
});
