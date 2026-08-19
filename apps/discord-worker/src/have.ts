/**
 * `/have` — "does the estate have this book?" (design §2b, the owner's own
 * named ask: *"maybe I want a way ... for others to ask in discord if I have a
 * book"*).
 *
 * ## The scope line, which is the whole design
 *
 * Design **§4 decision 4** settles it: an unlinked Discord user, in anybody's
 * server, gets **`{audiobook}` only** — the same slice an anonymous visitor to
 * `index.heygabi.ai` already gets, and the same slice `audiobooks.heygabi.ai`
 * already publishes to the open internet. Answering `/have` at that scope
 * reveals nothing the web does not already show.
 *
 * ⚠️ **That means NO credential is needed for the default path**, and the
 * Worker deliberately holds none for it: the call to `GET /api/search` carries
 * no Authorization header at all, so the index Worker's own `searchScope()`
 * middleware resolves it to the public slice by its own §4.5 rule. There is no
 * token here to leak, misuse, or accidentally widen.
 *
 * ⚠️ **`source=audiobook` is sent anyway, and it is not redundant.** It is a
 * NARROWING param (index `search-route.ts`: "It can only ever narrow the
 * caller's own visibility, never widen it"), so it costs nothing today — but
 * if the index's anonymous default were ever widened, `/have` would NOT widen
 * with it. The scope this command answers at is stated by this command, in one
 * place, rather than inherited from somebody else's default.
 *
 * ## The wider scope for linked members — WHAT IT WAITS ON (measured, not assumed)
 *
 * Design §2b's shape 2 imagines a linked + approved member getting their own
 * visibility set. **That path does not exist today**, and this is what was
 * actually checked (2026-08-17, reading the code rather than the design):
 *
 *  1. `apps/index-worker/src/middleware/scope.ts` resolves a caller's scope
 *     from `resolveIdentity(c.req.raw, env)` — a **Firebase ID token** and
 *     nothing else. There is no app-token, no on-behalf-of header, and no
 *     server-to-server widening path on `/api/search` at all.
 *  2. This Worker cannot mint a Firebase ID token for a linked member.
 *     Discord's OAuth does not produce one, and `firebase-sa.ts` here is
 *     deliberately scoped to `datastore` ONLY — it does not carry the
 *     identitytoolkit scope that could mint a custom token, and that omission
 *     is a recorded credential decision, not an oversight.
 *  3. Even holding a `/seen` answer (which would need a NEW estate app-token
 *     pair, `ESTATE_APP_TOKEN_DISCORD`, minted on both auth-worker and here),
 *     there is nothing on the index to hand it to.
 *
 * So the honest subset is: **everyone gets the public audiobook slice**, and a
 * linked member is TOLD, in one sentence, that the wider shelves are not
 * reachable from Discord yet and what that waits on. Shipping a
 * minted-secret-name pattern for a path that has no receiving end would be
 * inventing infrastructure, not shipping dark.
 *
 * ## The wording rule
 *
 * ⚠️ Never "you don't own this". A catalog is not an inventory: ~100 books are
 * still unscanned in the estate at any time, so **absence means "not in the
 * catalogue", never "not owned"** — and the answer says so rather than
 * implying a shelf is empty.
 */

import type { Env } from './env.js';
import { INDEX_LOOKUP_MS } from './deadline.js';
import { editOriginalMessage } from './discord-api.js';
import {
  firestoreRequest,
  mintAccessToken,
  parseServiceAccount,
  type ServiceAccount,
} from './firebase-sa.js';

/** The estate index. A var override exists (env.INDEX_BASE_URL) so a test or
 * a future lane can point elsewhere; the default is the live host, which is a
 * constant, not a guess. */
export const DEFAULT_INDEX_BASE = 'https://index.heygabi.ai';

/** Design §4 decision 4, stated HERE rather than inherited: the scope `/have`
 * answers at for every caller, linked or not. */
export const HAVE_SOURCE = 'audiobook';

/** The index refuses a one-character query (422); refuse it here with words
 * instead of spending a round trip to be told. */
export const MIN_QUERY_LENGTH = 2;

/** How many works one answer lists. More than this is a wall of text in an
 * ephemeral reply; the overflow is COUNTED and stated, never dropped silently. */
export const MAX_HITS = 5;

/** club_announcements.py's COLOR_PURPLE — the estate's one embed colour, so a
 * GABI answer looks like a GABI answer wherever it appears. Exported since
 * `/gabi` (gabi.ts) renders in the same colour: two embed colours would be two
 * bots as far as a reader is concerned. */
export const EMBED_COLOR = 10181046;

/** Exported for the same reason: `/gabi` truncates the same way, and a second
 * copy would drift into eliding differently in one of the two commands. */
export const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

// ---------------------------------------------------------------------------
// The wire shapes (the subset this command reads)
// ---------------------------------------------------------------------------

export interface SearchEntry {
  source?: string;
  title?: string;
  creator?: string | null;
  format?: string;
  detail_url?: string | null;
}

export interface SearchBookHit {
  title?: string;
  creator?: string | null;
  entries?: SearchEntry[];
}

export interface SearchAnswer {
  query?: string;
  scope?: string[];
  books?: SearchBookHit[];
  games?: unknown[];
}

export type HaveLookup =
  | { ok: true; answer: SearchAnswer }
  | { ok: false; reason: 'too_short' | 'refused' | 'unreachable'; status: number };

/** The search URL — one place that knows the scope narrowing is sent. */
export function searchUrl(base: string, query: string): string {
  const url = new URL('/api/search', base);
  url.searchParams.set('q', query);
  url.searchParams.set('source', HAVE_SOURCE);
  return url.toString();
}

export function indexBase(env: Pick<Env, 'INDEX_BASE_URL'>): string {
  const configured = (env.INDEX_BASE_URL ?? '').trim();
  return configured.length > 0 ? configured : DEFAULT_INDEX_BASE;
}

/**
 * Ask the index. NO Authorization header — that absence IS the scope decision
 * (design §4 decision 4), not an oversight, and it is why this path needs no
 * credential of its own.
 */
export async function lookupHave(base: string, query: string): Promise<HaveLookup> {
  let res: Response;
  try {
    res = await fetch(searchUrl(base, query), {
      method: 'GET',
      headers: { accept: 'application/json' },
      // ⚠️ ADDED 2026-08-18. This was the ONE outbound call on the ordinary
      // question path with no deadline of its own — the books port, the
      // catalogue CSV, the docs port and the delegated verbs all had one, and
      // nothing at a call site marked the difference. A hung index means a hung
      // TURN, and a hung turn is the silence a real person met in a channel:
      // no answer, no error, no log, nothing. `unreachable` is already worded
      // and already handled; an abort simply reaches it.
      signal: AbortSignal.timeout(INDEX_LOOKUP_MS),
    });
  } catch {
    return { ok: false, reason: 'unreachable', status: 0 };
  }
  if (res.status === 422) return { ok: false, reason: 'too_short', status: 422 };
  if (!res.ok) return { ok: false, reason: 'refused', status: res.status };
  try {
    return { ok: true, answer: (await res.json()) as SearchAnswer };
  } catch {
    return { ok: false, reason: 'refused', status: res.status };
  }
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/** ⚠️ Every string here obeys the two wording rules: a catalogue absence is
 * never phrased as "not owned", and an outage is never phrased as a refusal. */
export const HAVE_MSG = {
  tooShort:
    'That search is too short to be useful — type at least two characters and GABI will look again. ' +
    'Nothing went wrong.',
  noMatch: (query: string) =>
    `Nothing in the estate's shelves matches **${query}** — no title, author or series in the ` +
    'catalogued audiobook shelf comes close.\n\n' +
    '⚠️ That is a statement about the **catalogue**, not about the house: books are catalogued as ' +
    'they are scanned, and a real book that has not been scanned yet looks exactly like this.',
  unreachable:
    "GABI could not reach the estate's catalogue just now, so this is a service problem on the " +
    'estate side and NOT an answer about the book — try again in a minute. Nothing was searched.',
  refused: (status: number) =>
    `The estate's catalogue refused the search (HTTP ${status}) — a service problem on the estate ` +
    'side, NOT an answer about the book. Nothing was searched; try again shortly.',
  /** The scope footnote. Both branches are honest about the SAME public slice;
   * the linked branch adds what the wider shelves actually wait on. */
  scopeNote: (linked: boolean) =>
    linked
      ? '\n\n_Searched the public audiobook shelf. Your Discord account is linked — but the wider ' +
        'library and games shelves are not reachable from Discord yet: the index only widens for a ' +
        'caller holding a Firebase sign-in, which Discord cannot produce. That is estate ' +
        'infrastructure, not a permission you are missing._'
      : '\n\n_Searched the public audiobook shelf — the same slice audiobooks.heygabi.ai already ' +
        'shows the world._',
  overflow: (shown: number, total: number) => `\n\n_Showing the closest ${shown} of ${total} matches._`,
} as const;

/** One rendered line per work: title, creator, the formats found, and a link. */
export function renderHit(hit: SearchBookHit): string {
  const title = (hit.title ?? '').trim() || 'Untitled';
  const creator = (hit.creator ?? '').trim();
  const entries = Array.isArray(hit.entries) ? hit.entries : [];
  const formats = [...new Set(entries.map((e) => (e.format ?? '').trim()).filter(Boolean))];
  const link = entries.map((e) => (e.detail_url ?? '').trim()).find((u) => u.length > 0);

  const head = `**${truncate(title, 120)}**${creator ? ` — ${truncate(creator, 80)}` : ''}`;
  const tail = formats.length > 0 ? ` · ${formats.join(', ')}` : '';
  return link ? `${head}${tail} · [details](${link})` : `${head}${tail}`;
}

/** The whole ephemeral answer, as a message payload. Pure — the flow below
 * only decides WHEN to send it. */
export function buildHaveAnswer(
  query: string,
  answer: SearchAnswer,
  opts: { linked: boolean },
): { embeds: unknown[] } {
  const books = Array.isArray(answer.books) ? answer.books : [];
  const shown = books.slice(0, MAX_HITS);
  const description =
    shown.length === 0
      ? HAVE_MSG.noMatch(truncate(query, 100)) + HAVE_MSG.scopeNote(opts.linked)
      : shown.map(renderHit).join('\n') +
        (books.length > shown.length ? HAVE_MSG.overflow(shown.length, books.length) : '') +
        HAVE_MSG.scopeNote(opts.linked);

  return {
    embeds: [
      {
        title: truncate(
          shown.length === 0 ? `No match for “${query}”` : `“${query}” — ${books.length} match${books.length === 1 ? '' : 'es'}`,
          256,
        ),
        description: truncate(description, 4000),
        color: EMBED_COLOR,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The flow — runs in waitUntil after the deferred ephemeral ack
// ---------------------------------------------------------------------------

/**
 * Is this Discord account linked? Read with the Worker's own service account
 * (the same `discord_links/{id}` doc the vote path reads, access §6).
 *
 * ⚠️ It changes ONE SENTENCE of the answer and nothing else — the scope is the
 * same either way — so every failure mode degrades to `false` rather than
 * costing the person their answer. An unset service account is the normal
 * local/test state, not an error.
 */
export async function isLinked(saJson: string | undefined, discordUserId: string): Promise<boolean> {
  let sa: ServiceAccount | null;
  try {
    sa = parseServiceAccount(saJson);
  } catch {
    return false;
  }
  if (!sa) return false;
  try {
    const token = await mintAccessToken(sa);
    const res = await firestoreRequest(sa, token, 'GET', `discord_links/${encodeURIComponent(discordUserId)}`);
    return res.ok;
  } catch {
    return false;
  }
}

export interface HaveContext {
  query: string;
  applicationId: string;
  interactionToken: string;
  indexBaseUrl: string;
  serviceAccountJson?: string;
  discordUserId: string | null;
}

/**
 * Answer `/have`. Never throws: every outcome ends as an edit of the deferred
 * ephemeral message, and a thrown error would leave Discord's "thinking…"
 * spinner up forever with no explanation.
 */
export async function processHave(ctx: HaveContext): Promise<void> {
  const say = async (payload: unknown) => {
    await editOriginalMessage(ctx.applicationId, ctx.interactionToken, payload);
  };
  try {
    const query = ctx.query.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      await say({ content: HAVE_MSG.tooShort });
      return;
    }

    // The two reads are independent, and the link read must never delay or
    // break the answer — so they race together and the link half is allowed
    // to lose.
    const [lookup, linked] = await Promise.all([
      lookupHave(ctx.indexBaseUrl, query),
      ctx.discordUserId ? isLinked(ctx.serviceAccountJson, ctx.discordUserId) : Promise.resolve(false),
    ]);

    if (!lookup.ok) {
      if (lookup.reason === 'too_short') await say({ content: HAVE_MSG.tooShort });
      else if (lookup.reason === 'unreachable') await say({ content: HAVE_MSG.unreachable });
      else await say({ content: HAVE_MSG.refused(lookup.status) });
      return;
    }

    await say(buildHaveAnswer(query, lookup.answer, { linked }));
  } catch (err) {
    console.error('/have failed:', err instanceof Error ? err.message : err);
    try {
      await editOriginalMessage(ctx.applicationId, ctx.interactionToken, {
        content: HAVE_MSG.unreachable,
      });
    } catch {
      // The interaction token expired or Discord is down. Nothing further is
      // possible, and there is nothing to record — no estate state changed.
    }
  }
}
