/**
 * NOTIFICATION PREFERENCES — GET/PUT /api/estate/ops/notify-prefs.
 *
 * Owner ask, 2026-08-18 (item 7): which event classes are worth a buzz on his
 * phone — an agent landing, a nightly window completing, anything going red,
 * the archive finishing. He sets them; the conductor honours them.
 *
 * ⚠️ THE TWO DOORS ARE DELIBERATELY DIFFERENT, AND NOT IN THE WAY THE AGENT
 * BOARD'S ARE:
 *
 *   PUT  requireDevops()                    — a PERSON, in a browser. Only a
 *                                             human decides what interrupts a
 *                                             human.
 *   GET  requireDevops() OR the conductor   — a person to render the toggles,
 *        bearer                               AND the conductor to obey them.
 *
 * ⚠️ THE GET ACCEPTING A MACHINE BEARER IS THE WHOLE POINT, and it is the
 * mistake the agent board already made in the other direction. That board's read
 * door is `requireDevops()` only, which is why contract §9 has to warn that "you
 * cannot recover a section you did not write" — no script can read it back. A
 * preference nothing can READ is a preference nothing can OBEY, so this door
 * admits the conductor's existing token rather than minting a second
 * credential.
 *
 * ⚠️ WHAT LEAKS IF THAT BEARER LEAKS: the names of four toggles and whether
 * they are on. That is a smaller blast radius than the board it already writes,
 * and the alternative — a Firebase service identity for a script — is a much
 * larger credential for a much smaller job.
 *
 * ⚠️ THE WRITE DOOR IS NEVER THE CONDUCTOR'S. A machine must not be able to
 * quietly turn off the alert that would have told the owner it was
 * misbehaving.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from './env.js';
import { requireDevops } from './middleware/auth.js';
import { checkConductorAuth } from './agent-board.js';

/** The one row this module owns. */
export const NOTIFY_PREFS_KEY = 'notify';

/**
 * The event classes, and what each one MEANS in words.
 *
 * ⚠️ THE PAGE RENDERS THIS LIST, NOT A HARD-CODED COPY. A toggle whose label
 * lives on the page and whose behaviour lives in the conductor is two things
 * that drift; the owner then switches off something that does not do what its
 * label says. One definition, served.
 *
 * ⚠️ DEFAULTS ARE DELIBERATE AND ASYMMETRIC. `red` defaults ON because the cost
 * of missing a failure is the whole reason the estate has a status page at all;
 * the rest default OFF, because a phone that buzzes for every routine success
 * is a phone that gets silenced, and a silenced phone misses the red one too.
 */
export const NOTIFY_CLASSES = [
  {
    key: 'red',
    label: 'Anything goes red',
    detail: 'A health check fails, a pipeline run fails, or a backup goes past its limit.',
    default: true,
  },
  {
    key: 'agent_landed',
    label: 'An agent finishes',
    detail: 'A dispatched Claude agent lands or fails — useful when a long build is running.',
    default: false,
  },
  {
    key: 'window_complete',
    label: 'A nightly window completes',
    detail: 'The overnight ingestion window finishes its run.',
    default: false,
  },
  {
    key: 'archive_done',
    label: 'The archive upload finishes',
    detail: 'The audiobook archive finishes seeding or completes a batch to blob storage.',
    default: false,
  },
] as const;

export interface NotifyPrefs {
  [key: string]: boolean;
}

/** The defaults, as a plain object. */
export function defaultPrefs(): NotifyPrefs {
  const out: NotifyPrefs = {};
  for (const c of NOTIFY_CLASSES) out[c.key] = c.default;
  return out;
}

/**
 * Stored JSON -> prefs, defaults filled in.
 *
 * ⚠️ AN UNREADABLE ROW FALLS BACK TO DEFAULTS RATHER THAN TO SILENCE. The
 * failure mode to avoid is a corrupted value turning every notification off
 * without saying so — the owner would experience that as "the estate went
 * quiet", which is indistinguishable from "nothing went wrong".
 */
export function parsePrefs(raw: string | null | undefined): NotifyPrefs {
  const out = defaultPrefs();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    // Only booleans, and only keys the estate actually understands — an unknown
    // key is stored history from an older shape, not a new feature.
    if (typeof v === 'boolean' && NOTIFY_CLASSES.some((c) => c.key === k)) out[k] = v;
  }
  return out;
}

/**
 * A submitted body -> prefs to store, or a worded refusal.
 *
 * ⚠️ REFUSES, NEVER STRIPS — the estate's standing rule. A body carrying a key
 * this Worker does not understand is a mistake worth reporting, because the
 * alternative is the owner toggling something, getting a 200, and finding it had
 * no effect.
 */
export function parsePrefsBody(body: unknown): { prefs: NotifyPrefs } | { error: string; detail: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'not_an_object', detail: 'Send a JSON object of { "<class>": true | false }.' };
  }
  const known: Set<string> = new Set(NOTIFY_CLASSES.map((c) => c.key));
  const out = defaultPrefs();
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!known.has(k)) {
      return {
        error: 'unknown_class',
        detail: `“${k}” is not a notification class this estate knows. Known: ${[...known].join(', ')}.`,
      };
    }
    if (typeof v !== 'boolean') {
      return { error: 'not_a_boolean', detail: `“${k}” must be true or false, not ${typeof v}.` };
    }
    out[k] = v;
  }
  return { prefs: out };
}

export const notifyPrefsRoutes = new Hono<AppBindings>();

/** Shared reader — used by both doors. */
async function readPrefs(c: Context<AppBindings>) {
  try {
    const row = await c.env.DB.prepare('SELECT value, updated_at, updated_by FROM estate_prefs WHERE key = ?1')
      .bind(NOTIFY_PREFS_KEY)
      .first<{ value: string; updated_at: string; updated_by: string | null }>();
    return {
      prefs: parsePrefs(row?.value ?? null),
      updated_at: row?.updated_at ?? null,
      updated_by: row?.updated_by ?? null,
      // ⚠️ `configured` separates "he chose these" from "nobody has chosen yet
      // and these are the defaults" — the page says which, because a default
      // presented as a decision is a decision nobody made.
      configured: Boolean(row),
      classes: NOTIFY_CLASSES,
    };
  } catch (err) {
    if (/no such table/i.test((err as Error).message || '')) return null;
    throw err;
  }
}

const TABLE_MISSING = {
  error: 'estate_prefs_table_missing',
  detail:
    'The preferences table does not exist in this database — the Worker shipped ahead of its migration. ' +
    'Nothing is broken and nothing was lost; the estate is using its defaults.',
  fix: 'npm run db:migrate (from apps/auth-worker) applies 0014_estate_prefs.sql remotely',
} as const;

/**
 * GET — a devops person in a browser, OR the conductor with its bearer.
 *
 * The conductor is checked FIRST and only when a bearer that is not a Firebase
 * token is present, so an ordinary signed-in request never touches the
 * constant-time compare.
 */
notifyPrefsRoutes.get('/estate/ops/notify-prefs', async (c: Context<AppBindings>, next) => {
  const header = c.req.header('Authorization') ?? null;
  const auth = checkConductorAuth(c.env.ESTATE_CONDUCTOR_TOKEN, header);
  if (auth === 'ok') {
    const answer = await readPrefs(c).catch(() => undefined);
    if (answer === undefined) return c.json({ error: 'prefs_unreadable', detail: 'The estate database did not answer.' }, 502);
    if (answer === null) return c.json({ ...TABLE_MISSING, prefs: defaultPrefs(), configured: false, classes: NOTIFY_CLASSES }, 200);
    return c.json(answer);
  }
  // Not the conductor — fall through to the human gate.
  return requireDevops()(c, next as never) as never;
}, async (c: Context<AppBindings>) => {
  const answer = await readPrefs(c).catch(() => undefined);
  if (answer === undefined) return c.json({ error: 'prefs_unreadable', detail: 'The estate database did not answer.' }, 502);
  if (answer === null) return c.json({ ...TABLE_MISSING, prefs: defaultPrefs(), configured: false, classes: NOTIFY_CLASSES }, 200);
  return c.json(answer);
});

/** PUT — a person, and only a person. */
notifyPrefsRoutes.put('/estate/ops/notify-prefs', requireDevops(), async (c: Context<AppBindings>) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', detail: 'That body is not valid JSON.' }, 400);
  }
  const parsed = parsePrefsBody(body);
  if ('error' in parsed) return c.json(parsed, 400);

  const now = new Date().toISOString();
  // requireDevops() puts the verified row on the context as `actor`.
  const who = c.get('actor')?.email ?? null;
  try {
    await c.env.DB.prepare(
      'INSERT INTO estate_prefs (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, ' +
        'updated_by = excluded.updated_by',
    )
      .bind(NOTIFY_PREFS_KEY, JSON.stringify(parsed.prefs), now, who)
      .run();
  } catch (err) {
    if (/no such table/i.test((err as Error).message || '')) return c.json(TABLE_MISSING, 503);
    return c.json({ error: 'prefs_write_failed', detail: 'The estate database refused the write — nothing was stored.' }, 502);
  }
  return c.json({ ok: true, prefs: parsed.prefs, updated_at: now, updated_by: who, configured: true, classes: NOTIFY_CLASSES });
});
