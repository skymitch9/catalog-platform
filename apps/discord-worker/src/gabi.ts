/**
 * `/gabi` — the fixer's Discord surface, **shape (b): propose-and-deep-link**
 * (`library_catalog/docs/info/gabi-fixer-design.md` §10.2, owner-sequenced
 * *"we can do discord right after"* phase 0).
 *
 * ## What this is NOT, and why that is the whole point
 *
 * The full shape — GABI's tool loop running over Discord — is blocked by four
 * things the design names and phase 0 solved none of:
 *
 *   1. no join from a Discord id to an `app_user` row (the link lives in
 *      Firestore; the roles live in the library's own D1, and her Worker holds
 *      no service account — deliberately);
 *   2. **token custody** — minting a Firebase ID token *as her* from this
 *      Worker's service account is exactly the "an actor that is not her,
 *      writing as her" the design refuses (shape (c), REFUSED);
 *   3. no deferred-response path for a conversational turn;
 *   4. no persisted conversation state (the browser tab provides it free).
 *
 * Shape (b) needs **none** of them, because a proposing bot is a read-only bot
 * with a link on the end. So this file, by construction:
 *
 *   - **writes nothing, anywhere.** No Firestore write, no catalog write, no
 *     `change_log` row. The only Firestore call is a single GET of the
 *     caller's own `discord_links/{id}` doc, and it changes ONE SENTENCE.
 *   - **never calls Anthropic.** No model runs here, no `ANTHROPIC_API_KEY`
 *     exists in this Worker, and none is added — zero new custody was the
 *     reason shape (b) was chosen over shape (a).
 *   - **needs no new secret.** The one new binding is `GABI_PANEL_URL`, a
 *     public hostname in `[vars]`, present only so a test can point elsewhere.
 *
 * ## The two halves of an answer
 *
 * **(a) A factual nibble**, from the only estate surface this Worker can
 * already reach: the index's PUBLIC slice, via `/have`'s own `lookupHave`
 * (reused, not reimplemented — same URL builder, same explicit `source`
 * narrowing, same no-Authorization-header decision, `have.ts` header §"The
 * scope line"). A Discord question is prose, so `searchTermFor()` reduces it
 * to something the index can match, and the answer **states the term it
 * searched** — a wrong reduction is then visible rather than mysterious.
 *
 * **(b) A deep link into the real GABI panel**, where the tool loop, her
 * Firebase session and her authority all actually live.
 *
 * ⚠️ **THE DEEP LINK CARRIES NO QUERY STRING, AND THAT IS MEASURED.** Read
 * 2026-08-17 in `library_catalog/apps/web`: `App.tsx` holds the panel open/shut
 * in `useState(false)` and `GabiPanel.tsx` parses no location at all — there is
 * no `?q=`, no `?gabi=1`, nothing. Appending a param the panel does not read
 * would be a link that silently lies about carrying the question. So the link
 * opens the site plainly, the question is **quoted back in the message for
 * copy-paste**, and a `?q=` prefill is recorded in the design doc as PANEL
 * work. If that lands, this is the one function to change.
 *
 * ## What the bot can and cannot determine about panel access
 *
 * The panel renders when `me.gabiPanel && me.capabilities.includes(
 * 'runResearch')` — i.e. the per-instance `GABI_PANEL` posture AND a
 * moderator-or-above role **on that instance**. This Worker can determine the
 * FIRST half of the caller's identity only: whether a `discord_links/{id}` doc
 * exists. It **cannot** resolve the second half — that is blocker 1, and no
 * amount of care changes it. So the answer says which it knows and which it
 * does not, in words, and never promises the panel will be there.
 *
 * ## The wording rules, inherited from `/have` and non-negotiable
 *
 * ⚠️ Never "you don't own this": ~100 books are unscanned at any time, so a
 * catalogue absence is a statement about the CATALOGUE, never about the house.
 * ⚠️ An outage is never phrased as a refusal, and never as an answer about the
 * book. ⚠️ And a search failure never costs the person the deep link — the
 * useful half of this command is the link, and it is unconditional.
 */

import type { Env } from './env.js';
import { editOriginalMessage } from './discord-api.js';
import {
  EMBED_COLOR,
  lookupHave,
  renderHit,
  truncate,
  type HaveLookup,
  type SearchBookHit,
} from './have.js';
import { firestoreRequest, mintAccessToken, parseServiceAccount } from './firebase-sa.js';

/** Where the real GABI panel lives — Samantha's instance (design decision 8:
 * the panel posture is ON for `friend` and OFF for the main library, so this
 * host is the only one where a GABI conversation is possible at all). */
export const DEFAULT_PANEL_BASE = 'https://padhard.heygabi.ai';

/** Shorter than `/have`'s: a one-word "gabi" is not a question. Still small,
 * because refusing a real question is worse than searching a vague one. */
export const MIN_QUESTION_LENGTH = 4;

/** How many works the nibble lists. Deliberately fewer than `/have`'s five —
 * this answer's *point* is the link, and a wall of hits buries it. Overflow is
 * COUNTED and stated, never dropped silently. */
export const MAX_GABI_HITS = 3;

/**
 * Words dropped when turning a spoken question into an index query. Small on
 * purpose: an over-eager list mangles titles, and the answer states the term it
 * used so a bad reduction is visible. If everything is dropped, the original
 * question is searched unchanged.
 */
const STOPWORDS = new Set([
  'a', 'about', 'an', 'and', 'any', 'anything', 'are', 'ask', 'book', 'books',
  'can', 'could', 'did', 'do', 'does', 'estate', 'find', 'for', 'from', 'gabi',
  'get', 'has', 'have', 'her', 'his', 'how', 'i', 'in', 'is', 'it', 'know',
  'me', 'my', 'of', 'on', 'our', 'please', 'sam', 'she', 'tell', 'that',
  'the', 'their', 'there', 'they', 'this', 'to', 'us', 'was', 'we', 'were',
  'what', 'whats', 'which', 'will', 'with', 'would', 'you', 'your',
]);

/** How many words of a reduced question are worth sending to the index. */
const MAX_TERM_WORDS = 8;

/**
 * A spoken question reduced to something `/api/search` can match.
 *
 * Best-effort by design and never load-bearing: it decides only which nibble
 * appears beside a link that is correct regardless.
 */
export function searchTermFor(question: string): string {
  const cleaned = question.replace(/[?!.,;:"“”]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const kept = cleaned
    .split(' ')
    .filter((w) => w.length > 0 && !STOPWORDS.has(w.toLowerCase().replace(/^'|'$/g, '')))
    .slice(0, MAX_TERM_WORDS);
  return kept.length > 0 ? kept.join(' ') : cleaned;
}

// ---------------------------------------------------------------------------
// What the bot knows about the caller — honestly three-valued
// ---------------------------------------------------------------------------

/**
 * ⚠️ THREE states, not two, and the third is why this does not reuse `/have`'s
 * `isLinked()`. That one folds every failure into `false`, which is right there
 * (it changes a footnote about scope) and wrong here: `/gabi`'s unlinked branch
 * *nudges someone to run `/link`*, and telling an already-linked person to link
 * again because Firestore blinked is telling them something false. A read that
 * could not be performed answers `unknown` and the message says nothing about
 * linking at all.
 */
export type LinkState = 'linked' | 'not_linked' | 'unknown';

export async function readLinkState(
  saJson: string | undefined,
  discordUserId: string | null,
): Promise<LinkState> {
  if (!discordUserId) return 'unknown';
  let sa;
  try {
    sa = parseServiceAccount(saJson);
  } catch {
    return 'unknown';
  }
  // An unset service account is the normal local/test state, not an error —
  // and it is not evidence that the account is unlinked.
  if (!sa) return 'unknown';
  try {
    const token = await mintAccessToken(sa);
    const res = await firestoreRequest(
      sa,
      token,
      'GET',
      `discord_links/${encodeURIComponent(discordUserId)}`,
    );
    if (res.ok) return 'linked';
    if (res.status === 404) return 'not_linked';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// The deep link
// ---------------------------------------------------------------------------

export function panelBase(env: Pick<Env, 'GABI_PANEL_URL'>): string {
  const configured = (env.GABI_PANEL_URL ?? '').trim();
  return configured.length > 0 ? configured : DEFAULT_PANEL_BASE;
}

/**
 * The link into the panel. ⚠️ Deliberately **bare** — see this file's header:
 * the panel reads no URL parameter, so a `?q=` would be a promise the page
 * cannot keep. Pinned by a test that asserts the URL has no query string, so
 * adding one is a decision somebody makes on purpose.
 */
export function panelDeepLink(base: string): string {
  return `${base.replace(/\/+$/, '')}/`;
}

// ---------------------------------------------------------------------------
// The nibble
// ---------------------------------------------------------------------------

export type GabiNibble =
  | { kind: 'hits'; term: string; shown: SearchBookHit[]; total: number }
  | { kind: 'none'; term: string }
  | { kind: 'unavailable'; term: string; sentence: string };

export function nibbleFrom(term: string, lookup: HaveLookup): GabiNibble {
  if (!lookup.ok) {
    return {
      kind: 'unavailable',
      term,
      sentence: lookup.reason === 'unreachable' ? GABI_MSG.unreachable : GABI_MSG.refused(lookup.status),
    };
  }
  const books = Array.isArray(lookup.answer.books) ? lookup.answer.books : [];
  if (books.length === 0) return { kind: 'none', term };
  return { kind: 'hits', term, shown: books.slice(0, MAX_GABI_HITS), total: books.length };
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

export const GABI_MSG = {
  tooShort:
    'Ask GABI a whole question — a few words at least — and she will have something to go on. ' +
    'Nothing went wrong; there was just not enough to search.',

  /** The nibble's own heading, always naming the term actually searched. */
  searched: (term: string) => `_Looked on the estate's public shelf for **${term}**._`,

  none:
    "Nothing on the estate's public shelf matches that — no title, author or series in the " +
    'catalogued audiobook shelf comes close.\n\n' +
    '⚠️ That is a statement about the **catalogue**, not about the house: books are catalogued as ' +
    'they are scanned, and a real book that has not been scanned yet looks exactly like this.',

  overflow: (shown: number, total: number) => `\n\n_Showing the closest ${shown} of ${total} matches._`,

  unreachable:
    "GABI could not reach the estate's catalogue just now — a service problem on the estate side, " +
    'NOT an answer about the book. Nothing was searched.',
  refused: (status: number) =>
    `The estate's catalogue refused the search (HTTP ${status}) — a service problem on the estate ` +
    'side, NOT an answer about the book. Nothing was searched.',

  /**
   * The half that matters. ⚠️ Unconditional: it is appended whether the search
   * hit, missed, or never happened, because the search failing says nothing
   * about whether GABI can help on the site.
   */
  deepLink: (url: string) =>
    `**GABI can dig deeper and propose fixes on the site** — she can read the actual catalogue rows, ` +
    `look at what is missing, and put changes in front of you to approve there:\n${url}\n` +
    '_Open the speech-bubble button in the top bar and paste your question in._',

  /** Your question, quoted so it can be copied into the panel — the deep link
   * cannot carry it (this file's header explains why). */
  quoted: (question: string) => `> ${question}`,

  /**
   * ⚠️ What this Worker can and cannot determine, said plainly. It knows
   * whether the Discord account is LINKED. It cannot know whether the linked
   * person may open the panel — that is a role on the library's own database,
   * which this Worker has no path to (design §10.2 blocker 1).
   */
  identity: (state: LinkState) => {
    const cannotSee =
      'Whether the panel actually opens for you is decided by your role on that site (it needs ' +
      '`runResearch` — moderator or above), and this bot genuinely cannot see that: the Discord ' +
      'link lives in Firestore and the library roles live in the library’s own database, with no ' +
      'path between them. If the panel is not there, that is a role, not a fault.';
    if (state === 'linked') {
      return `\n\n_Your Discord account is linked to an estate identity, so GABI knows who you are here. ${cannotSee}_`;
    }
    if (state === 'not_linked') {
      return (
        '\n\n_This Discord account is not linked to an estate identity — `/link` connects them ' +
        '(opt-in, revocable), and GABI never guesses who you are from a username. The link below ' +
        `works either way; it just asks you to sign in on the site. ${cannotSee}_`
      );
    }
    // 'unknown' — the read failed or was not possible. Say nothing about
    // linking rather than nudging someone who may already be linked.
    return `\n\n_${cannotSee}_`;
  },
} as const;

/**
 * The whole ephemeral answer. Pure — the flow below only decides WHEN to send
 * it — and it always contains the deep link.
 */
export function buildGabiAnswer(
  question: string,
  nibble: GabiNibble,
  opts: { link: LinkState; panelUrl: string },
): { embeds: unknown[] } {
  let body: string;
  if (nibble.kind === 'hits') {
    body =
      GABI_MSG.searched(truncate(nibble.term, 80)) +
      '\n' +
      nibble.shown.map(renderHit).join('\n') +
      (nibble.total > nibble.shown.length ? GABI_MSG.overflow(nibble.shown.length, nibble.total) : '');
  } else if (nibble.kind === 'none') {
    body = GABI_MSG.searched(truncate(nibble.term, 80)) + '\n' + GABI_MSG.none;
  } else {
    body = nibble.sentence;
  }

  const description = [
    GABI_MSG.quoted(truncate(question, 300)),
    '',
    body,
    '',
    GABI_MSG.deepLink(opts.panelUrl),
  ].join('\n') + GABI_MSG.identity(opts.link);

  return {
    embeds: [
      {
        title: truncate(`GABI — “${question}”`, 256),
        description: truncate(description, 4000),
        color: EMBED_COLOR,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The flow — runs in waitUntil after the deferred ephemeral ack
// ---------------------------------------------------------------------------

export interface GabiContext {
  question: string;
  applicationId: string;
  interactionToken: string;
  indexBaseUrl: string;
  panelUrl: string;
  serviceAccountJson?: string;
  discordUserId: string | null;
}

/**
 * Answer `/gabi`. Never throws: every outcome ends as an edit of the deferred
 * ephemeral message, because a thrown error leaves Discord's "thinking…"
 * spinner up forever with nothing said.
 */
export async function processGabi(ctx: GabiContext): Promise<void> {
  const say = async (payload: unknown) => {
    await editOriginalMessage(ctx.applicationId, ctx.interactionToken, payload);
  };
  try {
    const question = ctx.question.trim();
    if (question.length < MIN_QUESTION_LENGTH) {
      await say({ content: GABI_MSG.tooShort });
      return;
    }

    const term = searchTermFor(question);

    // Independent reads, raced together: the link read decides one sentence and
    // must never delay or break the answer.
    const [lookup, link] = await Promise.all([
      lookupHave(ctx.indexBaseUrl, term),
      readLinkState(ctx.serviceAccountJson, ctx.discordUserId),
    ]);

    await say(
      buildGabiAnswer(question, nibbleFrom(term, lookup), { link, panelUrl: ctx.panelUrl }),
    );
  } catch (err) {
    console.error('/gabi failed:', err instanceof Error ? err.message : err);
    try {
      // Even the catch-all keeps the useful half: the link is what this command
      // is FOR, and an internal fault is not a reason to withhold it.
      await editOriginalMessage(ctx.applicationId, ctx.interactionToken, {
        content: `${GABI_MSG.unreachable}\n\n${GABI_MSG.deepLink(ctx.panelUrl)}`,
      });
    } catch {
      // The interaction token expired or Discord is down. Nothing further is
      // possible, and there is nothing to record — no estate state changed.
    }
  }
}
