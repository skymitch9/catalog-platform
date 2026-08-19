/**
 * **TIER 3 + TIER 4 — THE CONVERSATION ARCHIVE AND THE RECALL TOOL.**
 * `docs/info/gabi-memory-design.md` §4, phases 2 and 3 of §9.
 *
 * Tier 2 (the distilled profile) is a paragraph she carries into every turn.
 * This is the opposite trade, and the design's table says why both exist:
 *
 * | Tier | Cost per turn | Lives for |
 * |---|---|---|
 * | 1 verbatim window | ≈3k input tokens | 30 minutes |
 * | 2 durable profile | ≈500 input tokens | until corrected |
 * | **3 archive + 4 recall** | **zero** | **90 days** |
 *
 * ⚠️ **ZERO PER-TURN COST IS THE WHOLE POINT.** Nothing here is injected into a
 * prompt. The archive is written after an answer has already been posted, and
 * the recall tool costs something only on a turn that actually asks about the
 * past. A tier that charged every conversation for a capability used weekly
 * would be the scope blow-out the owner's own sentence fenced off — *"we also
 * dont want to blow scope"*.
 *
 * This file is the whole contract and **holds no credential** — the same seam
 * `delegated.ts`, `estate-docs.ts`, `book-knowledge.ts`, `memory.ts` and
 * `shelf.ts` established. The implementation lives in `memory-exec.ts`, beside
 * the profile store, and the reason it is not a sixth exec module is recorded
 * there.
 *
 * ## ⚠️ THE THREE RULES THAT MAKE A 90-DAY ARCHIVE SAFE
 *
 * 1. **PRIVACY IS A `where` CLAUSE, NOT A PROMPT INSTRUCTION** (design §4.4).
 *    The person key is built server-side from the asker's own identity. There is
 *    no tool parameter that could carry somebody else's, so *"search Sam's
 *    conversations"* is not refused — it is **unrepresentable**.
 * 2. **A REMEMBERED WRONG CLAIM IS WORSE THAN A FRESH ONE.** It is wrong every
 *    turn instead of once and it looks more authoritative for having been
 *    remembered. So a recall result is QUOTED WITH ITS DATE and never absorbed
 *    into a present-tense claim — `renderRecall` puts the date on every line and
 *    says so in words the model cannot miss.
 * 3. **NOTHING RECALLED IS EVIDENCE OF ANYTHING BUT THAT IT WAS SAID.**
 *    Availability ("have you read book 10?") and the spoiler bound are re-derived
 *    from a call in the turn that needs them, every turn, exactly as they are
 *    today. The archive is a record of a CONVERSATION, not of the world.
 */

import { CONVERSATION_TURN_CHARS } from './conversation.js';

// ---------------------------------------------------------------------------
// Retention — ONE constant, and everything derives from it
// ---------------------------------------------------------------------------

/**
 * ⚠️ **ONE CONSTANT, AND EVERYTHING DERIVES FROM IT** (design §4.3). The
 * owner-accepted starting number; §9 owner step 3 is to confirm it after a week
 * of measured size rather than of arithmetic.
 */
export const ARCHIVE_RETENTION_DAYS = 90;

export const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * ⚠️ **CHANGING THE NUMBER DOES NOT RETRO-DELETE.** `expiresAt` is stamped at
 * WRITE time, so lowering retention affects new turns only and a real purge is a
 * separate deliberate job. Written down because *"we changed it to 30 days"* will
 * otherwise be believed to have shortened the past.
 */
export function expiresAtFor(at: number): number {
  return at + ARCHIVE_RETENTION_MS;
}

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

/** ⚠️ Bump when the stored shape changes incompatibly. A row whose `v` this code
 *  does not understand is IGNORED rather than guessed at — `memory.ts`'s rule,
 *  and for the same reason: forgetting is acceptable, inventing is not. */
export const ARCHIVE_SHAPE_VERSION = 1;

/**
 * One archived turn. ⚠️ **ONE DOCUMENT PER TURN, ATTRIBUTED PER AUTHOR** —
 * design §4.2, and it is not a storage preference. Shared-channel turns are
 * therefore already separated by person, which is what lets §4.4's privacy rule
 * be a `where` clause instead of a filter somebody has to remember to apply.
 */
export interface ArchiveTurn {
  /** `estate:<email>` or `discord:<snowflake>` — `memory.ts`'s `personKey`. */
  person: string;
  surface: string;
  space: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  /** Opaque provenance (the Discord message id), never read by anything here. */
  ref?: Record<string, string>;
}

/** One row coming back out, with the date that makes it quotable. */
export interface RecallHit extends ArchiveTurn {
  /** ISO day, precomputed so the renderer cannot forget it. */
  day: string;
}

export type RecallOutcome =
  | {
      ok: true;
      hits: readonly RecallHit[];
      /** How many rows were actually examined — the honest denominator. */
      scanned: number;
      /** ⚠️ The oldest turn the scan REACHED, or null when nothing was stored.
       *  This is what stops "I have nothing about that" being said about a
       *  period the scan never got to. */
      reachedBack: number | null;
      /** True when the scan filled its page, so older turns exist unexamined. */
      truncated: boolean;
    }
  | { ok: false; message: string };

// ---------------------------------------------------------------------------
// Caps — the scope fence, again
// ---------------------------------------------------------------------------

/** Same 600-char clip tier 1 already applies. Imported rather than restated so
 *  the archive can never hold more of a turn than the window did. */
export const ARCHIVE_TURN_CHARS = CONVERSATION_TURN_CHARS;

/**
 * ⚠️ **HOW MANY ROWS ONE RECALL MAY EXAMINE.**
 *
 * The archive is searched LEXICALLY in this Worker, not by Firestore, because
 * Firestore has no substring predicate. That makes this number the real bound on
 * a recall's cost: 200 rows × 600 chars ≈ 120 KB of response, read once, on a
 * turn somebody explicitly asked a question about the past.
 *
 * ⚠️ **AND IT IS WHY `reachedBack` EXISTS.** A scan that fills its page has NOT
 * searched the whole 90 days, and a result that said *"I have nothing about
 * that"* would be a false negative wearing a fact's clothes. Every rendered
 * answer says how far back it actually looked.
 */
export const RECALL_SCAN_ROWS = 200;

/** How many matching turns are handed to the model. Enough to quote two or three
 *  moments; not enough to reconstitute a conversation into the prompt, which
 *  would make tier 4 an expensive tier 1. */
export const RECALL_HITS = 8;

/** Per-hit characters in the rendered block. The stored clip is 600; this is
 *  what a QUOTE needs, and eight of them at 300 is ≈600 input tokens on the one
 *  turn that asked. */
export const RECALL_HIT_CHARS = 300;

// ---------------------------------------------------------------------------
// ⚠️ The document id IS the sort order, and that is an index decision
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE ID SORTS NEWEST-FIRST, SO THE QUERY NEEDS NO COMPOSITE INDEX.**
 *
 * Design §4.1 assumed *"one composite index"* for `where(person) + orderBy(at)`.
 * That is true — and a composite index is an **owner console step**, which means
 * the feature would ship looking built and answer 400 to every question until
 * somebody clicked something. The failure mode of a missing index is a broken
 * feature that reads as a bug, which is the class this estate keeps paying for.
 *
 * So the ordering is moved into the KEY: a zero-padded DESCENDING timestamp
 * prefix means `__name__` ascending IS newest-first. An equality filter plus
 * `orderBy __name__` is served by Firestore's automatic single-field index, so
 * **there is nothing to create and nothing to forget.**
 *
 * ⚠️ The cost of that choice, stated: a `since` bound cannot be a Firestore
 * range filter (that WOULD need the composite index), so it is applied in this
 * Worker over the scanned page. `reachedBack` is how the answer stays honest
 * about it.
 *
 * The suffix is a random tiebreaker: two turns in the same millisecond must not
 * collide, and the user/assistant pair of one turn genuinely shares an `at`.
 */
const ID_EPOCH_CEILING = 9_999_999_999_999; // ~year 2286, 13 digits

export function archiveDocId(at: number, rand: string): string {
  const desc = Math.max(0, ID_EPOCH_CEILING - Math.floor(at));
  return `${String(desc).padStart(13, '0')}_${rand}`;
}

/** Six base36 characters ≈ 31 bits. Not a secret — a collision tiebreaker. */
export function archiveRand(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 6);
}

// ---------------------------------------------------------------------------
// ⚠️ THE DETECTOR — the fifth of this family, and the narrowest
// ---------------------------------------------------------------------------

/**
 * ⚠️ **OFFERING A TOOL IS NOT ROUTING TO IT; ENTERING A LANE IS NOT CALLING THE
 * TOOL.** Three separate incidents on 2026-08-18 taught that ladder — the docs
 * lane answered from the book shelf, the shelf lane was never entered, and then
 * the shelf lane was entered and the tool was never called. This detector is the
 * first rung and `recall-flow.ts` is the second: the search runs AHEAD of the
 * model, so there is nothing left for her to confabulate an answer about.
 *
 * ⚠️ **IT IS DELIBERATELY THE NARROWEST DETECTOR ON THIS SURFACE**, and that is
 * a routing decision rather than caution. *"What did I think of Mistborn"* is a
 * REVIEW question the shelf lane answers exactly; *"what haven't I read"* is a
 * shelf question; *"what happens in book 9"* is a book question. Every one of
 * those is first-person and about the past in some sense, and none of them is a
 * question about a CONVERSATION. So the phrases below all name the conversation
 * itself — *we talked*, *I told you*, *you said*, *do you remember* — and a
 * sentence that merely looks backwards does not match.
 */
const RECALL_PATTERNS: readonly RegExp[] = [
  // "did we talk about X" / "have we discussed X" / "did we ever chat about"
  /\b(did|have|had)\s+we\s+(ever\s+)?(talk(ed)?|discuss(ed)?|chat(ted)?|go\s+over|cover(ed)?)\b/i,
  /\bwhat\s+(did|have)\s+we\s+(talk(ed)?|discuss(ed)?|chat(ted)?)\b/i,
  // "what did I tell you" / "did I ever mention" / "remind me what I said"
  /\bwhat\s+did\s+i\s+(tell|say\s+to|ask)\s+you\b/i,
  /\b(did|have)\s+i\s+(ever\s+)?(told|tell|mention(ed)?|said|say)\s+(you|to\s+you)\b/i,
  /\bremind\s+me\s+what\s+i\s+(said|told\s+you|asked)\b/i,
  // "what did you say about X earlier" / "you said ... last time"
  /\bwhat\s+did\s+you\s+(say|tell\s+me)\b[^?]*\b(earlier|before|last\s+time|the\s+other\s+day|yesterday|last\s+week)\b/i,
  /\b(earlier|last\s+time|the\s+other\s+day)\s+you\s+(said|told\s+me|mentioned)\b/i,
  // "do you remember when/what/me saying"
  /\bdo\s+you\s+remember\s+(when|what|me|us|our|that\s+time)\b/i,
  // explicit references to the conversation as an object
  /\b(our|the)\s+(last|previous|earlier)\s+(chat|conversation|talk)\b/i,
  /\b(last\s+time|the\s+last\s+time)\s+we\s+(spoke|talked|chatted)\b/i,
  /\bwhat\s+have\s+i\s+asked\s+you\b/i,
  /\blook\s+(back\s+)?(through|in|at)\s+our\s+(chat|conversation|history)\b/i,
];

export function recallIntent(text: string): boolean {
  const q = (text ?? '').trim();
  if (q.length < 6) return false;
  return RECALL_PATTERNS.some((re) => re.test(q));
}

/**
 * The words to search for, taken from the question with the conversational
 * scaffolding removed. ⚠️ Returns `[]` when nothing substantial is left — a
 * recall for *"do you remember me?"* has no subject, and searching for nothing
 * would return the most recent turns and present them as MATCHES, which is the
 * confabulation this whole lane exists to prevent.
 */
const RECALL_STOPWORDS = new Set([
  'about', 'again', 'and', 'anything', 'ask', 'asked', 'chat', 'chatted', 'conversation',
  'could', 'did', 'discuss', 'discussed', 'do', 'does', 'earlier', 'ever', 'for', 'from',
  'had', 'have', 'here', 'how', 'i', 'if', 'in', 'is', 'it', 'last', 'like', 'me', 'mention',
  'mentioned', 'my', 'of', 'on', 'once', 'or', 'our', 'previous', 'remember', 'remind',
  'said', 'say', 'talk', 'talked', 'tell', 'that', 'the', 'their', 'them', 'then', 'there',
  'they', 'thing', 'this', 'time', 'to', 'told', 'us', 'was', 'we', 'were', 'what', 'when',
  'where', 'whether', 'which', 'who', 'why', 'with', 'yesterday', 'you', 'your',
]);

export function recallTerms(question: string): string[] {
  const words = (question ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 3 && !RECALL_STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 8);
}

// ---------------------------------------------------------------------------
// Ranking — lexical, bounded, and it says so
// ---------------------------------------------------------------------------

/**
 * Score a row against the terms. ⚠️ **Lexical, and the design says so out loud**
 * (§8: *"No semantic/embedding search over the archive"*). A term that is absent
 * is absent; there is no fuzzy matching, and a row that scores zero is dropped
 * rather than returned as a weak match — a weak match rendered with a date is a
 * quote she will stand behind.
 */
export function scoreRecall(text: string, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const hay = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    let from = 0;
    let n = 0;
    for (;;) {
      const i = hay.indexOf(term, from);
      if (i < 0) break;
      n += 1;
      from = i + term.length;
      if (n >= 3) break; // one row cannot dominate by repetition
    }
    if (n > 0) score += 1 + (n - 1) * 0.25;
  }
  return score;
}

export function rankRecall(
  rows: readonly ArchiveTurn[],
  terms: readonly string[],
  limit = RECALL_HITS,
): RecallHit[] {
  const scored = rows
    .map((r) => ({ r, s: scoreRecall(r.text, terms) }))
    .filter((x) => x.s > 0)
    // Best first, and newest wins a tie — a later mention of the same thing is
    // the one somebody means by "what did I say about X".
    .sort((a, b) => (b.s - a.s) || (b.r.at - a.r.at))
    .slice(0, limit);
  return scored.map(({ r }) => ({ ...r, day: new Date(r.at).toISOString().slice(0, 10) }));
}

// ---------------------------------------------------------------------------
// ⚠️ The rendered block — every line carries its date
// ---------------------------------------------------------------------------

const clip = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

/**
 * What the model receives. ⚠️ **THE DATE IS ON EVERY LINE AND THE RULE IS IN THE
 * TEXT**, because this is the exact substrate on which a remembered wrong claim
 * becomes wrong for ever. She may say *"on the 12th you said X"*; she may not say
 * *"you like X"*, and she may never treat a quoted line as a checked fact.
 */
export function renderRecall(
  outcome: Extract<RecallOutcome, { ok: true }>,
  terms: readonly string[],
): string {
  const looked =
    outcome.reachedBack === null
      ? 'There is nothing archived for this person yet.'
      : `Searched their own past turns back to ${new Date(outcome.reachedBack).toISOString().slice(0, 10)}` +
        (outcome.truncated
          ? ` (the newest ${outcome.scanned}; anything older than that was NOT searched).`
          : ' — that is everything kept.');

  if (outcome.hits.length === 0) {
    return (
      `Looked through this person's own earlier conversations with you for ` +
      `${terms.length ? terms.map((t) => `"${t}"`).join(', ') : 'the subject they named'}. ` +
      `NOTHING MATCHED. ${looked}\n\n` +
      '⚠️ Say plainly that you have no record of it — and say WHAT you searched and HOW FAR BACK, ' +
      'because "I have nothing about that" is not the same as "it never happened". ' +
      'Do NOT reconstruct what they might have said, and do NOT offer a plausible memory. ' +
      'An empty result is a real answer.'
    );
  }

  const lines = outcome.hits.map(
    (h) =>
      `- **${h.day}** — ${h.role === 'user' ? 'THEY said' : 'YOU said'}: ` +
      `"${clip(h.text, RECALL_HIT_CHARS)}"`,
  );

  return (
    `From this person's OWN earlier conversations with you (${looked}):\n${lines.join('\n')}\n\n` +
    '⚠️ QUOTE THESE WITH THEIR DATES. Say "back on <date> you said …", never "you like …" or "you ' +
    'are reading …" — a line here is a record of something SAID on a day, not a fact about how ' +
    'things are now, and stating it in the present tense turns one old sentence into a standing ' +
    'claim that is wrong every time you repeat it.\n' +
    '⚠️ Nothing here tells you what you have READ or what is in your knowledge base. If the answer ' +
    'needs that, look it up in this turn — an archived sentence is never evidence about the world, ' +
    'only about the conversation.'
  );
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

export const RECALL_MSG = {
  /** ⚠️ The posture is off. Unlike tier 2's silence there IS a sentence here,
   *  because somebody who asked "what did we talk about last week" asked a
   *  question only this lane could answer, and a fall-through to a catalogue
   *  search reads as broken — the `GABI_BOOKS` rule applied once more. */
  switchedOff:
    "I don't keep a record of our past conversations at the moment — that's a switch on our side, " +
    'not anything to do with you. Within a conversation I still remember what we just said.',

  /** The posture is on and no port was built: a SETUP gap, never a permissions
   *  one, and never phrased as though the person did something wrong. */
  notConfigured:
    "I can't get at my record of our past conversations just now — that's a setup gap on the " +
    'estate\'s side rather than anything about you. Ask me again once someone has had a look.',

  /** A real outage on the read. ⚠️ Distinct from "nothing matched", because
   *  telling somebody you have no record when you simply could not look is the
   *  one answer this lane must never give. */
  unreachable:
    "I couldn't search our earlier conversations just then — the store didn't answer. That's not " +
    'the same as there being nothing there, so please try again in a minute rather than taking it ' +
    'as a no.',

  /** Nothing substantial to search for. */
  noSubject:
    "I can look back through our earlier conversations, but I need something to look FOR — a name, " +
    'a book, a subject. Tell me roughly what it was about and I will go and find it.',
} as const;

// ---------------------------------------------------------------------------
// The wire — an interface, and that is the credential seam
// ---------------------------------------------------------------------------

/**
 * Everything tiers 3 and 4 need from the outside world.
 *
 * ⚠️ **An interface rather than an import, and that IS the credential seam.**
 * This file can call these; it cannot construct one and it names no secret.
 *
 * ⚠️ **`recall` takes the person key as an ARGUMENT the caller builds** — and the
 * caller builds it from the asker's own identity, server-side. There is
 * deliberately no `recall(query)` overload that would let the person key come
 * from anywhere else, because *"scoped to the asker"* enforced by wording is one
 * prompt injection away from a household member reading another's history.
 */
export interface ArchivePort {
  /** ⚠️ Returns false on failure and NEVER throws: a failed archive write must
   *  not turn a delivered answer into an error message. Losing one turn from a
   *  90-day record is a bad day; speaking after the answer is a lie about it. */
  write(turns: readonly ArchiveTurn[]): Promise<boolean>;
  recall(input: {
    person: string;
    terms: readonly string[];
    since?: number;
    scan?: number;
    limit?: number;
  }): Promise<RecallOutcome>;
}
