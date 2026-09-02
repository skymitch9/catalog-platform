/**
 * `/recent` — "what has arrived on the shelves lately?" (design §2c.2, the
 * on-demand half of the new-additions feed).
 *
 * ## The source, and why it is not the catalogue
 *
 * `catalog.csv` — the file every other read-only lane here loads — records what
 * the estate HOLDS and carries **no arrival date**: its columns are title,
 * series, author, narrator, year, genre, duration, library_formats, universe,
 * series_gap (`catalog-data.ts`'s `COLUMNS`), and `year` is the book's
 * publication year, not the day it reached the house. Answering "what is new"
 * from it would mean sorting by publication date and calling the result
 * *recent*, which is a different question wearing the right word.
 *
 * `additions_log.json` is the append-only, dated record the pipeline keeps for
 * exactly this question (design §2c.1: *"already the append-only, dated source
 * of truth for when did this book first arrive"*). Measured live 2026-09-02:
 *
 * ```
 * GET https://audiobooks.heygabi.ai/additions_log.json
 *   -> 200, application/json, 241,010 bytes
 *   -> { "entries": [ { key, title, author, added, source }, ... ] }
 *   -> newest first (2026-09-01, then 2026-08-27, then 2026-08-25)
 * ```
 *
 * ⚠️ **The newest-first ordering is NOT trusted.** It is what the file happened
 * to contain the day this was written, and an append-only log that is later
 * appended to in arrival order would flip it. The rows are sorted here by
 * `added` descending, which costs nothing and cannot be wrong.
 *
 * ## The scope line — inherited, stated, not re-decided
 *
 * ⚠️ **NO Authorization header, and that absence is the scope decision** — the
 * same one `/have` records (design §4 decision 4). This file is published to the
 * open internet by `audiobooks.heygabi.ai` beside `catalog.csv`, so answering
 * from it reveals nothing the web does not already show, and there is no
 * credential here to leak or widen.
 *
 * ## The wording rule, also inherited
 *
 * ⚠️ An empty answer is a statement about the **log**, never about the house:
 * books are catalogued as they are scanned, and the pipeline stamps a row when
 * it first sees one. "Nothing added" means "nothing the pipeline recorded",
 * which is why the words say so.
 */

import type { Env } from './env.js';
import { catalogBase } from './catalog-data.js';
import { editOriginalMessage } from './discord-api.js';
import { EMBED_COLOR, truncate } from './have.js';

/** Where the log lives, relative to the audiobook site root. Its base is
 * `CATALOG_BASE_URL` — the same var `catalog.csv` is read from, because the two
 * files are published side by side by the same pipeline. */
export const ADDITIONS_PATH = '/additions_log.json';

/** How many rows one answer lists by default. Ten fits an embed comfortably and
 * still spans several weeks of a household's arrivals. */
export const RECENT_DEFAULT = 10;

/** The ceiling on the `count` option. Discord's embed description caps at 4,096
 * characters and a row runs ~90; 25 leaves headroom for the footnote. */
export const RECENT_MAX = 25;

/** The log is a quarter of a megabyte and grows; a hung fetch must not hang the
 * turn (the lesson `have.ts` records for the index lookup). */
export const ADDITIONS_TIMEOUT_MS = 8_000;

/** ⚠️ A rail, not a guess: refuse a body larger than this rather than parse an
 * unbounded download into an isolate. Measured at 241 KB on 2026-09-02, so this
 * is ~17× headroom. */
export const MAX_ADDITIONS_BYTES = 4 * 1024 * 1024;

export function additionsUrl(base: string): string {
  return new URL(ADDITIONS_PATH, base).toString();
}

export function additionsBase(env: Pick<Env, 'CATALOG_BASE_URL'>): string {
  return catalogBase(env);
}

// ---------------------------------------------------------------------------
// The wire shape (the subset this command reads)
// ---------------------------------------------------------------------------

/** One arrival, as the pipeline records it. ⚠️ `key` and `source` are parsed
 * and dropped: `key` is `title|author` (a join key, not something to show a
 * person) and every row measured carried `source: "pipeline"`. */
export interface AdditionRow {
  title: string;
  author: string;
  /** `YYYY-MM-DD`, the pipeline's own spelling. Kept as the string it is — a
   * Date would invent a timezone the log does not have. */
  added: string;
}

/**
 * Rows out of the raw JSON. ⚠️ A row with no title is DROPPED rather than
 * rendered as "Untitled": an arrival log entry that cannot name its book is a
 * pipeline fault, and showing a blank line invites somebody to debug Discord.
 */
export function parseAdditions(body: unknown): AdditionRow[] {
  const entries = (body as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) return [];
  const out: AdditionRow[] = [];
  for (const raw of entries) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (!title) continue;
    out.push({
      title,
      author: typeof r.author === 'string' ? r.author.trim() : '',
      added: typeof r.added === 'string' ? r.added.trim() : '',
    });
  }
  return out;
}

/**
 * Newest first, then the requested slice.
 *
 * ⚠️ **The sort is by the STRING**, which is correct for `YYYY-MM-DD` and only
 * for it: ISO dates sort lexicographically. A row whose `added` is empty or in
 * some other spelling sorts to the bottom rather than to the top — an undated
 * row must never be presented as the newest thing in the house.
 */
export function newestFirst(rows: readonly AdditionRow[], limit: number): AdditionRow[] {
  return [...rows]
    .sort((a, b) => {
      const av = /^\d{4}-\d{2}-\d{2}$/.test(a.added) ? a.added : '';
      const bv = /^\d{4}-\d{2}-\d{2}$/.test(b.added) ? b.added : '';
      return bv.localeCompare(av);
    })
    .slice(0, Math.max(0, limit));
}

export type RecentLoad =
  | { ok: true; rows: AdditionRow[] }
  | { ok: false; reason: 'unreachable' | 'refused' | 'too_big'; status: number };

/**
 * Fetch the log. NO Authorization header — see the header; that absence is the
 * scope decision, not an oversight.
 */
export async function loadAdditions(
  base: string,
  overrides?: { fetch?: typeof fetch },
): Promise<RecentLoad> {
  const doFetch = overrides?.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(additionsUrl(base), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(ADDITIONS_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'unreachable', status: 0 };
  }
  if (!res.ok) return { ok: false, reason: 'refused', status: res.status };
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_ADDITIONS_BYTES) {
    return { ok: false, reason: 'too_big', status: res.status };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'refused', status: res.status };
  }
  return { ok: true, rows: parseAdditions(body) };
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/** ⚠️ Every string obeys the same two rules the rest of this Worker obeys: an
 * empty log is never phrased as an empty house, and an outage is never phrased
 * as an answer about books. */
export const RECENT_MSG = {
  badCount: (max: number) =>
    `That number is outside what one message can carry — ask for between 1 and ${max}. ` +
    'Nothing went wrong; try the command again with a smaller number.',
  empty:
    "The estate's arrivals log has no entries in it at all.\n\n" +
    '⚠️ That is a statement about the **log**, not about the house — the log is stamped when the ' +
    'pipeline first sees a book, so a shelf full of books that predate the log looks exactly like ' +
    'this.',
  unreachable:
    "GABI could not reach the estate's arrivals log just now, so this is a service problem on the " +
    'estate side and NOT an answer about what has arrived — try again in a minute. Nothing was read.',
  refused: (status: number) =>
    `The estate's arrivals log refused the read (HTTP ${status}) — a service problem on the estate ` +
    'side, NOT an answer about what has arrived. Try again shortly.',
  tooBig:
    "The estate's arrivals log came back far larger than it has ever been, so GABI stopped rather " +
    'than reading an unbounded file. This is a rail on our side, not a problem with your command — ' +
    'it is worth someone looking at the pipeline.',
  footer: (shown: number, total: number) =>
    `\n\n_The ${shown} newest of ${total} recorded arrivals — the same public shelf ` +
    'audiobooks.heygabi.ai already shows the world._',
} as const;

/** One rendered line per arrival: title, author, and the date it landed. */
export function renderAddition(row: AdditionRow): string {
  const head = `**${truncate(row.title, 120)}**${row.author ? ` — ${truncate(row.author, 80)}` : ''}`;
  // ⚠️ An undated row says so rather than borrowing the date of the row above
  // it, which is what dropping the clause would look like to a reader.
  return row.added ? `${head} · ${row.added}` : `${head} · _date not recorded_`;
}

/** The whole answer, as a message payload. Pure — the flow decides only WHEN. */
export function buildRecentAnswer(rows: readonly AdditionRow[], limit: number): { embeds: unknown[] } {
  const shown = newestFirst(rows, limit);
  const description =
    shown.length === 0
      ? RECENT_MSG.empty
      : shown.map(renderAddition).join('\n') + RECENT_MSG.footer(shown.length, rows.length);
  return {
    embeds: [
      {
        title:
          shown.length === 0
            ? 'Nothing recorded in the arrivals log'
            : `Newest on the shelves — ${shown.length} arrival${shown.length === 1 ? '' : 's'}`,
        description: truncate(description, 4000),
        color: EMBED_COLOR,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The flow — runs in waitUntil after the deferred ephemeral ack
// ---------------------------------------------------------------------------

export interface RecentContext {
  count: number | undefined;
  applicationId: string;
  interactionToken: string;
  catalogBaseUrl: string;
  fetchOverride?: typeof fetch;
}

/**
 * Answer `/recent`. Never throws: every outcome ends as an edit of the deferred
 * ephemeral message, because a thrown error leaves Discord's "thinking…"
 * spinner up forever with no explanation.
 */
export async function processRecent(ctx: RecentContext): Promise<void> {
  const say = async (payload: unknown) => {
    await editOriginalMessage(ctx.applicationId, ctx.interactionToken, payload);
  };
  try {
    // ⚠️ REJECTED, NEVER CLAMPED. Discord's own `min_value`/`max_value` on the
    // option means a well-behaved client cannot send an out-of-range number at
    // all; a hand-crafted interaction can, and silently clamping it would
    // answer a question nobody asked. The repo's rule: reject invalid input.
    const requested = ctx.count;
    if (requested !== undefined && (!Number.isInteger(requested) || requested < 1 || requested > RECENT_MAX)) {
      await say({ content: RECENT_MSG.badCount(RECENT_MAX) });
      return;
    }
    const limit = requested ?? RECENT_DEFAULT;

    const load = await loadAdditions(
      ctx.catalogBaseUrl,
      ctx.fetchOverride ? { fetch: ctx.fetchOverride } : undefined,
    );
    if (!load.ok) {
      if (load.reason === 'unreachable') await say({ content: RECENT_MSG.unreachable });
      else if (load.reason === 'too_big') await say({ content: RECENT_MSG.tooBig });
      else await say({ content: RECENT_MSG.refused(load.status) });
      return;
    }
    await say(buildRecentAnswer(load.rows, limit));
  } catch (err) {
    console.error('/recent failed:', err instanceof Error ? err.message : err);
    try {
      await editOriginalMessage(ctx.applicationId, ctx.interactionToken, {
        content: RECENT_MSG.unreachable,
      });
    } catch {
      // The interaction token expired or Discord is down. Nothing further is
      // possible, and no estate state changed.
    }
  }
}
