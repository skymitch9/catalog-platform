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
 * ⚠️ **THE DEEP LINK NOW CARRIES THE QUESTION, AND POINTS AT THE ASKER'S OWN
 * SHELF.** Both halves were false until 2026-08-18 and both are fixed in
 * `panel.ts`, which this file's link functions are re-exported from:
 *
 *   - the panel half landed in `library_catalog` (`8745191`, both instances):
 *     `?gabi=<text>` prefills the box and opens the panel without sending, so
 *     the question is no longer retyped in the browser. The question is still
 *     **quoted back in the message** — a person reading Discord on a phone
 *     should be able to see what was asked without opening anything;
 *   - the destination is resolved from the asker's linked identity rather than
 *     from the pilot-era `GABI_PANEL_URL` constant, which the owner hit live:
 *     *"why is it showing padhard and not the generic site"*.
 *
 * ⚠️ Asker-awareness needs an identity port, so `/gabi` is asker-aware only on
 * a Worker where Tier 1's wiring exists. Without it this command behaves
 * exactly as it did — static link, same words. See `GabiContext.panel`.
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
import type { LibraryInstance } from './delegated.js';
import {
  DEFAULT_PANEL_BASE,
  panelBase,
  panelDeepLink,
  resolveAskerPanelBase,
  type PanelIdentityPort,
} from './panel.js';

/**
 * ⚠️ Re-exported rather than re-implemented. They MOVED to `panel.ts` on
 * 2026-08-18 when the destination stopped being a constant; every existing
 * importer keeps working, and the one place that decides where a link points is
 * still one place.
 */
export { DEFAULT_PANEL_BASE, panelBase, panelDeepLink };

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
  // ⚠️ `as` joined 2026-09-02 with the format-word strip below: "…as an
  // audiobook" sheds `audiobook` at the tail and would otherwise leave `as`
  // stranded there. It is the same family as `about`/`from`/`with`, which have
  // always been here; its absence was an oversight rather than a decision.
  'a', 'about', 'an', 'and', 'any', 'anything', 'are', 'as', 'ask', 'book', 'books',
  'can', 'could', 'did', 'do', 'does', 'estate', 'find', 'for', 'from', 'gabi',
  'get', 'has', 'have', 'her', 'his', 'how', 'i', 'in', 'is', 'it', 'know',
  'me', 'my', 'of', 'on', 'our', 'please', 'sam', 'she', 'tell', 'that',
  'the', 'their', 'there', 'they', 'this', 'to', 'us', 'was', 'we', 'were',
  'what', 'whats', 'which', 'will', 'with', 'would', 'you', 'your',
]);

/** How many words of a reduced question are worth sending to the index. */
const MAX_TERM_WORDS = 8;

/**
 * ⚠️ **FORMAT WORDS — the decoration that cost the owner a live answer, and the
 * measurement that proves it.**
 *
 * Measured 2026-09-02, in the channel: *"do we have Jake's Magical Market on
 * audio?"* → **"Catalog's got nothing on that one yet."** About a series with
 * **three volumes in the catalogue**.
 *
 * The reduction is the whole of it. `on` is a stopword and `audio` was not, so
 * this function produced `Jake's Magical Market audio` and the have lane sent
 * that to the index verbatim:
 *
 * ```
 * GET index.heygabi.ai/api/search?q=Jake%27s+Magical+Market&source=audiobook  → 3 books
 * GET index.heygabi.ai/api/search?q=Jake%27s+Magical+Market+audio&…           → 0 books
 * ```
 *
 * (both measured live, 2026-09-02 17:54 UTC). ⚠️ **The 2026-08-31 scorer fix
 * did not cover this**, and that is the trap worth naming: that fix taught
 * `catalog-data.ts` to ask *"does the QUERY contain the row?"* as well as the
 * other way round — which handles exactly this shape — but the have lane does
 * not read the CSV at all. It queries the INDEX, whose scorer is another
 * Worker's and has no such rule. A fixture test on the right function passed
 * all week while the live path missed.
 *
 * So: a **closed list**, stripped from the TAIL of the reduced term and nowhere
 * else, in the same idiom `searchCatalog`'s trailing `series|saga|trilogy`
 * strip already uses — whose own test is titled *"only at the tail"*.
 *
 * ⚠️ **A LEADING strip was written, measured and REMOVED.** It would have
 * helped *"is the audiobook of Dungeon Born any good"* → and it broke *"The
 * Audio Vault Chronicles"*, because `The` is already a stopword and that makes
 * a title's own first word leading. Trading a measured miss for an unmeasured
 * one is not a fix; the tail is where the evidence is.
 *
 * Format NOUNS only — nothing that could be a plot word — and a strip that
 * would empty the term is refused, so a book genuinely called *Print* is still
 * findable.
 */
const FORMAT_WORDS = new Set([
  'audio', 'audiobook', 'audiobooks', 'audible', 'ebook', 'ebooks', 'e-book',
  'kindle', 'epub', 'print', 'paperback', 'hardcover', 'hardback', 'physical',
]);

/** Strip trailing format decoration. ⚠️ Never empties the term: a term reduced
 *  to nothing is a search for everything. Repeated, so "on audio audiobook"
 *  sheds both. */
export function stripFormatWords(words: readonly string[]): string[] {
  const out = [...words];
  const isFormat = (w: string | undefined): boolean =>
    w !== undefined && FORMAT_WORDS.has(w.toLowerCase().replace(/[^a-z-]/g, ''));
  while (out.length > 1 && isFormat(out[out.length - 1])) out.pop();
  return out;
}

/**
 * A spoken question reduced to something `/api/search` can match.
 *
 * Best-effort by design and never load-bearing: it decides only which nibble
 * appears beside a link that is correct regardless.
 */
export function searchTermFor(question: string): string {
  const cleaned = question.replace(/[?!.,;:"“”]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const kept = stripFormatWords(
    cleaned
      .split(' ')
      .filter((w) => w.length > 0 && !STOPWORDS.has(w.toLowerCase().replace(/^'|'$/g, '')))
      .slice(0, MAX_TERM_WORDS),
  );
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
    '_The panel opens with your question already in the box — it does not send until you do._',

  /** Your question, quoted. ⚠️ Kept AFTER the link learned to carry it
   * (2026-08-18): somebody reading Discord on a phone should be able to see
   * what was asked without opening a browser tab to find out. */
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
  /** ⚠️ The STATIC fallback link, and still the whole answer on a Worker with
   * no identity port. It doubles as a base — `panelDeepLink` normalises a
   * trailing slash — so the two shapes cannot drift apart. */
  panelUrl: string;
  serviceAccountJson?: string;
  discordUserId: string | null;
  /**
   * ⚠️ **OPTIONAL, and its absence is a real production state**, not just a
   * test one: it is `null` on any Worker where Tier 1's app token or service
   * account is unset. Present, it makes the link point at the ASKER'S shelf
   * instead of the pilot default (`panel.ts` holds the whole decision table).
   */
  panel?: { port: PanelIdentityPort; instances: readonly LibraryInstance[] };
}

/**
 * Who is asking, and therefore where their panel is — answered in ONE Firestore
 * read either way.
 *
 * ⚠️ **The subrequest discipline, stated because the command is the zero-token
 * path and must stay cheap.** Today `/gabi` spends a mint + a link GET + the
 * index search. With an identity port it spends the SAME mint + link GET (the
 * port reads the identical document `readLinkState` reads, so nothing is read
 * twice) plus **two `whoami` calls** — two more subrequests, issued in
 * parallel, on a path that is already deferred and has fifteen minutes to
 * answer in. Without a port it spends exactly what it always did.
 *
 * ⚠️ **One behaviour moved, on purpose.** With a port, a link document that
 * carries no `firebaseUid` — a pre-uid link — now reads as `not_linked` rather
 * than `linked`, because that is what it is: it cannot prove an estate account,
 * and re-running `/link` is the fix. It is what the delegated path already
 * tells that same person, and one surface contradicting another about whether
 * somebody is linked is worse than either answer.
 */
async function askerIdentity(ctx: GabiContext): Promise<{ link: LinkState; base: string }> {
  const base = ctx.panelUrl;
  if (!ctx.panel || !ctx.discordUserId || ctx.panel.instances.length === 0) {
    return { link: await readLinkState(ctx.serviceAccountJson, ctx.discordUserId), base };
  }
  try {
    const link = await ctx.panel.port.linkedUid(ctx.discordUserId);
    if (!link.ok) return { link: link.reason === 'unlinked' ? 'not_linked' : 'unknown', base };
    return {
      link: 'linked',
      base: await resolveAskerPanelBase(ctx.panel.port, ctx.panel.instances, link.uid, base),
    };
  } catch (err) {
    // ⚠️ `unknown`, never `not_linked`: telling an already-linked person to
    // link again because Firestore blinked is telling them something false.
    console.error('/gabi: the asker could not be resolved:', err instanceof Error ? err.message : err);
    return { link: 'unknown', base };
  }
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

    // Independent reads, raced together: the identity read decides one sentence
    // and one hostname, and must never delay or break the answer.
    const [lookup, identity] = await Promise.all([
      lookupHave(ctx.indexBaseUrl, term),
      askerIdentity(ctx),
    ]);

    await say(
      buildGabiAnswer(question, nibbleFrom(term, lookup), {
        link: identity.link,
        // ⚠️ THE QUESTION, carried. The panel prefills and opens itself; it
        // does not send. `panel.ts` caps and encodes it.
        panelUrl: panelDeepLink(identity.base, question),
      }),
    );
  } catch (err) {
    console.error('/gabi failed:', err instanceof Error ? err.message : err);
    try {
      // Even the catch-all keeps the useful half: the link is what this command
      // is FOR, and an internal fault is not a reason to withhold it. ⚠️ The
      // STATIC base — whatever failed may have been the identity read, and this
      // path must not be able to fail twice.
      await editOriginalMessage(ctx.applicationId, ctx.interactionToken, {
        content: `${GABI_MSG.unreachable}\n\n${GABI_MSG.deepLink(panelDeepLink(ctx.panelUrl, ctx.question))}`,
      });
    } catch {
      // The interaction token expired or Discord is down. Nothing further is
      // possible, and there is nothing to record — no estate state changed.
    }
  }
}
