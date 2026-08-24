/**
 * **GABI SUGGESTS A BOOK — and asks WHICH SHELF first** (design:
 * `docs/info/gabi-suggestions-design.md`).
 *
 * Owner ask, verbatim (2026-08-18): *"I also need Gabi to give book suggestions
 * and clarify if I want audio physical or ebook. For physical I only want her to
 * suggest a physical book to a linked person who can view a book from the table
 * she's suggesting"*.
 *
 * This file is the whole contract and **holds no credential**. It reads nothing
 * and reaches nothing: every input arrives as data the caller already fetched,
 * and every decision here is arithmetic over it.
 *
 * ## ⚠️ THE THREE FORMATS ARE THREE DIFFERENT GATES, and that is the feature
 *
 * The owner's sentence contains a permission model, and it is not the same one
 * for all three:
 *
 * | Format | Who may be suggested to | Why |
 * |---|---|---|
 * | **audio** | anybody, linked or not | it is drawn from `catalog.csv`, the slice `audiobooks.heygabi.ai` publishes to the open internet — the same scope `/have` already answers at |
 * | **ebook** | linked **and** granted `vis_ebooks` | the estate's existing per-asker ebook gate, decided by the audiobook Worker and never by us |
 * | **physical** | linked **and** able to see the SHELF the row came from | ⚠️ his own words: *"a linked person who can view a book from the table she's suggesting"* |
 *
 * ⚠️ **THE PHYSICAL GATE IS THE ONE WITH TEETH, and it is a gate about a TABLE
 * rather than about a book.** `library.heygabi.ai` and `padhard.heygabi.ai` are
 * two separate deployments with two separate D1 databases. Pointing somebody at
 * a hardback that lives in a house they have no account on is not a privacy leak
 * — it is worse in the way that matters to the person: an errand that ends at a
 * shelf they cannot open.
 *
 * ## ⚠️ WHAT WAS MEASURED, 2026-08-18, and what it forces
 *
 * Read live from `https://audiobooks.heygabi.ai/catalog.csv` rather than assumed:
 *
 * | fact | measured |
 * |---|---|
 * | rows | 1,079 |
 * | rows carrying a `library_formats` join | **84** (the header's "86" is now stale by two) |
 * | the distinct format tokens | `Hardcover`, `Paperback`, `Ebook` — **pipe-separated**, e.g. `Hardcover\|Ebook` |
 * | rows with a PHYSICAL format | **64** (Hardcover and/or Paperback) |
 * | rows with an ebook format | **50** |
 * | `library_work_id` | a bare integer — `233`, `3`, `27` |
 *
 * ⚠️ **AND THE THING THAT SHAPES THE GATE: `library_work_id` NAMES NO INSTANCE.**
 * It is an integer with no prefix, no host and no discriminator, so the
 * cross-catalog join records THAT the library holds a print copy and never
 * WHICH library. There is no per-instance read available from Discord either —
 * `have.ts` measured that the index only widens for a caller holding a Firebase
 * ID token, which this Worker structurally cannot mint.
 *
 * So the provenance of a print row cannot be resolved per book today, and the
 * gate is built on the one signal that IS available and IS per-instance: the
 * delegated `whoami` call, which asks each catalog whether it knows this person.
 * See `PHYSICAL_SOURCE_INSTANCE` for which shelf that join is evidenced to point
 * at, and the limitation recorded beside it.
 *
 * ## ⚠️ ONE CLARIFYING QUESTION, NOT A MENU
 *
 * *"clarify if I want audio physical or ebook"* — asked **once**, in one
 * sentence, and skipped entirely when the question already says (or when the
 * person's tier-2 profile has learned it). A regular who always wants audio
 * should stop being asked, which is what the profile hook is for.
 */

import type { CatalogRow } from './catalog-data.js';
import type { Env } from './env.js';
import { bookIdFromTitle, type ReviewRow, type TbrRow } from './shelf.js';

/** ⚠️ Re-exported so the flow half uses the SAME persisted-key function rather
 *  than importing a second copy's worth of assumptions. */
export { bookIdFromTitle };

// ---------------------------------------------------------------------------
// The posture
// ---------------------------------------------------------------------------

/**
 * ⚠️ Affirmative-only `"on"`, the house idiom — `"true"`, `"1"`, `"yes"` and
 * every typo mean OFF.
 *
 * ⚠️ **IT SHIPS ON**, with `GABI_PERSONALITY` as the precedent rather than
 * `GABI_BOOKS`. The owner ordered the OUTCOME (*"I also need Gabi to give book
 * suggestions"*), and this lane opens no new corpus: it reads the public
 * catalogue plus the asker's own shelf, both of which are already switched on
 * and already gated by their own postures. The switch exists so there is a lever
 * — off is one line back, and off is NOT silent.
 */
export function suggestOn(env: Pick<Env, 'GABI_SUGGEST'>): boolean {
  return (env.GABI_SUGGEST ?? '').trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// The three formats
// ---------------------------------------------------------------------------

export type SuggestFormat = 'audio' | 'ebook' | 'physical';

/**
 * ⚠️ The tokens the estate's format labels actually contain — measured, not
 * guessed. Matching is case-insensitive on the pipe-split parts.
 *
 * ⚠️ **`mass market` WAS MISSING UNTIL 2026-08-19, and a mass-market paperback
 * SILENTLY DROPPED.** Found by the library agent reading this file rather than
 * by anything here noticing: all four labels — `Hardcover`, `Paperback`,
 * `Mass market`, `Ebook` — come from ONE function on the other side
 * (`library_catalog/apps/worker/src/lib/format-labels.ts`), are stored verbatim
 * in `catalog.csv`'s `library_formats`, and are matched lower-cased HERE.
 *
 * ⚠️ **THREE REPOS SHARE THESE WORDS AND NOTHING ENFORCES THAT.** Renaming a
 * label there un-matches rows in code nobody was editing, and the failure is a
 * book quietly missing from a suggestion — never an error. A drop is invisible
 * by construction, which is why the list is written out in full rather than
 * derived.
 */
export const PHYSICAL_FORMAT_TOKENS = ['hardcover', 'paperback', 'mass market'] as const;
export const EBOOK_FORMAT_TOKENS = ['ebook'] as const;

/**
 * ⚠️ **WHICH SHELF A PRINT ROW IS ON — MEASURED 2026-08-18 by reading the
 * pipeline that writes the column, not inferred from the column itself.**
 *
 * The row value names no instance (an integer, measured above), so the question
 * was answered one level up, at the writer:
 *
 * | step | measured |
 * |---|---|
 * | `audiobook_catalog/app/library_link.py` | stamps `library_formats` / `library_work_id` from `GET <LIBRARY_MAPPING_URL>/api/machine/audiobook-mapping` |
 * | `audiobook_catalog/.env` | **`LIBRARY_MAPPING_URL=https://library.heygabi.ai`** |
 * | the route's home | `library_catalog/apps/worker/src/routes/audiobook-mapping.ts` — the MAIN library's Worker |
 * | `padhard` | the **friend** instance, a separate deployment with its own D1; the pipeline never reads it (`CREDENTIALS.md` §4.4 calls it "the friend library instance") |
 *
 * So a print row in `catalog.csv` is **the main library's copy**, and the gate is
 * "can this person open the main library" — which the delegated `whoami` answers
 * per instance.
 *
 * ⚠️ **IF `LIBRARY_MAPPING_URL` EVER POINTS SOMEWHERE ELSE, THIS CONSTANT IS
 * WRONG.** It is one env var in another repo, so the failure is silent from
 * here. The safe re-derivation, if the join ever spans both: require the asker
 * to be known on EVERY instance — the default-deny form — because an
 * unattributable row could then come from a shelf they cannot open.
 */
export const PHYSICAL_SOURCE_INSTANCE = 'library' as const;

const parseFormats = (raw: readonly string[]): string[] =>
  raw.flatMap((f) => f.split('|')).map((f) => f.trim().toLowerCase()).filter(Boolean);

export function rowHasFormat(row: CatalogRow, format: SuggestFormat): boolean {
  if (format === 'audio') {
    // ⚠️ Every row of `catalog.csv` IS an audiobook the house holds. There is no
    // per-row audio flag to check and inventing one would be a filter that
    // silently removed real books.
    return true;
  }
  const tokens = parseFormats(row.libraryFormats);
  const wanted = format === 'ebook' ? EBOOK_FORMAT_TOKENS : PHYSICAL_FORMAT_TOKENS;
  return tokens.some((t) => (wanted as readonly string[]).includes(t));
}

/** The print formats a row actually carries, for the WHY clause — never
 *  generalised to "print", because "we have it in paperback" is the useful half. */
export function physicalFormatsOf(row: CatalogRow): string[] {
  // ⚠️ The token is returned AS MATCHED rather than mapped onto one of two
  // words. The old form collapsed everything that was not `hardcover` into
  // "paperback", which would have renamed a mass-market copy in her own
  // sentence the moment the token was added.
  return parseFormats(row.libraryFormats).filter((t) =>
    (PHYSICAL_FORMAT_TOKENS as readonly string[]).includes(t),
  );
}

// ---------------------------------------------------------------------------
// ⚠️ THE SUGGEST INTENT ROUTER — deterministic, and NEVER a model's decision
// ---------------------------------------------------------------------------

/**
 * ⚠️ **The fourth member of the family `docsIntent`, `booksIntent` and
 * `shelfIntent` belong to**, built to the same shape for the reason all three
 * exist: offering a tool is not routing to it, and a suggestion answered from
 * the public catalogue's first match is not a suggestion.
 *
 * ⚠️ It runs BEFORE the shelf router, because *"what should I read next"* is
 * first-person and shelf-shaped and is nonetheless a request for a
 * RECOMMENDATION rather than a reading list. The shelf lane would answer it by
 * reading the TBR back — which is a fine answer to a different question.
 */
const SUGGEST_STRONG = [
  // ⚠️ The PLURALS are spelled out. `\bsuggestion\b` does not match
  // "suggestions" — the word boundary fails against the trailing s — and "got
  // any suggestions?" is the commonest phrasing there is.
  /\b(?:recommends?|recommended|recommendations?|suggestions?|suggests?)\b/i,
  /\bwhat should i (?:read|listen to|start)\b/i,
  /\bwhat (?:do|would) you (?:recommend|suggest)\b/i,
  /\bwhat (?:should|shall) i (?:pick|read) next\b/i,
  /\bwhat(?:'|’)?s (?:good|worth reading)\b/i,
  /\bgive me (?:a|some|something) (?:book|read|to read)\b/i,
  /\bwhat next\b/i,
  /\bsomething (?:new |else )?to (?:read|listen to)\b/i,
  /\bpick (?:me )?(?:a|something)\b/i,
  /\bfind me (?:a|something) (?:book|read)\b/i,
  /\bwhat (?:book )?should i (?:get|grab|try)\b/i,

  // ── ⚠️ THE CONVERSATIONAL SHAPES — added 2026-08-18 after the FIRST REAL
  //    NON-OWNER USER hit this lane and missed it entirely. See §10f of
  //    `docs/info/gabi-suggestions-design.md` for the transcript.
  //
  //    ⚠️ **NOBODY ASKS FOR A "RECOMMENDATION". THEY ASK FOR SOMETHING GOOD.**
  //    Every pattern above needs one of a small set of LIBRARY words —
  //    recommend, suggest, read, listen. A stranger's first sentence carried
  //    none of them: *"Find me something entertaining"*. It fell past this
  //    router, past the shelf router, into a public-index grep, and came back
  //    "nothing on the estate's public shelf matches that" — to which his reply
  //    was *"Gabi sucks what the heck."* He was right.
  //
  //    The shapes below are the ordinary human ones. They are still deliberate
  //    ASKS — every one has an imperative or a "what/anything" question in it —
  //    so this stays a router and does not become "any sentence about books".

  // "find me something…", "give me something…", "pick me something…" — the
  // owner-facing lesson: the OBJECT is "something", not "a book". Requiring
  // "book" or "read" after it is what lost the real user.
  /\b(?:find|get|give|pick|throw|send|hit|show)\s+me\s+(?:some|something|anything)\b/i,
  // "I need / I'm looking for / I'm after / in the mood for something"
  /\b(?:i\s+(?:need|want)|i(?:'|’)?m\s+(?:looking\s+for|after|in\s+the\s+mood\s+for)|looking\s+for)\s+(?:a|an|some|something|anything)\b/i,
  /\bin\s+the\s+mood\s+for\b/i,
  // "I'm bored", "entertain me", "keep me entertained"
  /\b(?:i(?:'|’)?m|i\s+am)\s+bored\b/i,
  /\bentertain\s+me\b/i,
  // "something entertaining / funny / light / gripping / that won't put me to
  // sleep". ⚠️ THE NEGATIVE FORM IS DELIBERATE: "something that won't put me to
  // sleep" is a PREFERENCE, not noise — it says audio, and it says fast-moving.
  /\bsomething\s+(?:really\s+|actually\s+|pretty\s+)?(?:entertaining|fun|funny|interesting|exciting|gripping|engaging|light|easy|short|quick|good|new|different|wild|dark|cosy|cozy)\b/i,
  /\bsomething\s+that\s+(?:won(?:'|’)?t|wont|does\s?n(?:'|’)?t|doesnt|will|would|keeps?|holds?|grabs?)\b/i,
  // "what should I listen to / pick up / check out / try / go with"
  /\bwhat\s+(?:should|can|could|would)\s+i\s+(?:read|listen\s+to|start|pick\s+up|check\s+out|try|go\s+with|put\s+on)\b/i,
  // "anything good", "got anything good", "any good ones"
  /\b(?:any(?:thing)?|got\s+any(?:thing)?)\s+(?:good|fun|decent|worth\s+it|worth\s+a\s+listen)\b/i,
  /\bany\s+good\s+ones\b/i,
  // "what would I like / enjoy", "what do you think I'd like"
  /\bwhat\s+(?:would|do\s+you\s+think)\s+i(?:'|’)?d?\s+(?:like|enjoy|be\s+into)\b/i,
  // "surprise me"
  /\bsurprise\s+me\b/i,
];

export function suggestIntent(text: string): boolean {
  const q = (text ?? '').trim();
  if (!q) return false;
  return SUGGEST_STRONG.some((re) => re.test(q));
}

/**
 * ⚠️ **SHE ASKED THE CLARIFYING QUESTION AND THEN COULD NOT HEAR THE ANSWER.**
 *
 * Live, 2026-08-19. She asked *"audiobook, ebook, or a physical copy?"*, the
 * owner answered **"physical please"** — and that message fell straight out of
 * this lane, because `suggestIntent('physical please')` is `false`. The words
 * that make a message a suggestion request are all in the message BEFORE it.
 *
 * The turn landed in the generic question path instead, was grounded on a
 * public-shelf miss that had nothing to do with physical books, and she
 * improvised: *"Nothing's come through the scanner yet in that direction."*
 *
 * ⚠️ **BOTH REPORTED FAILURES HAVE THIS ONE CAUSE.** The "empty data" was not a
 * source returning nothing — the source was never consulted, because the lane
 * was never re-entered. The fabrication was a model filling the gap that left.
 *
 * ## ⚠️ IT IS THE BOOK LANE'S §10c INCIDENT, VERBATIM, IN A NEW LANE
 *
 * > *"She invited a follow-up and then routed it to the shelf."*
 *
 * Same defect, same shape, same fix: **a lane belongs to the CONVERSATION, not
 * to one sentence.**
 *
 * ⚠️ **AND THIS ONE IS SHARPER THAN §10c's, because SHE asked the question.**
 * The book lane's follow-up was volunteered by the person; here the elliptical
 * message exists *only because she requested it*. Failing to hear it is failing
 * to hear a reply she solicited — which is why a clarifying question is a
 * promise, and why `SUGGEST_MSG.clarify` may not exist without this function.
 */
const SUGGEST_FOLLOW_UP_MAX_WORDS = 8;

/** ⚠️ Openers people use when ANSWERING the format question, none of which
 *  contain a suggestion word. Stripped before the format is read. */
const FORMAT_ANSWER_OPENER =
  /^(?:@?[\w-]+[,:]?\s+)?(?:just|maybe|probably|let'?s (?:go|do|say)|i'?(?:ll|d) (?:take|like|go with)|make it|go with|go for)\s+/i;

/**
 * Is this short message the ANSWER to the format question she just asked?
 * Returns the format to re-enter the lane with, or `null`.
 *
 * ⚠️ **Narrow three ways, exactly as `booksFollowUp` is** — a prior suggest-lane
 * USER turn inside the remembered window, a SHORT message, and a format word it
 * can actually resolve. Without the third it would capture every "yes" in every
 * conversation that had once mentioned a recommendation.
 *
 * ⚠️ **Only USER messages are consulted**, for the reason the book lane gives:
 * her own replies are model prose with no reliable marker, and matching on her
 * wording would make the router depend on what a model happened to say.
 */
export function suggestFollowUp(
  text: string,
  history: readonly { role: string; text: string }[],
): SuggestFormat | null {
  const q = (text ?? '').trim();
  if (!q) return null;
  // ⚠️ Already unambiguous alone — the strong half decides, not this.
  if (suggestIntent(q)) return null;
  if (q.split(/\s+/).filter(Boolean).length > SUGGEST_FOLLOW_UP_MAX_WORDS) return null;

  // ⚠️ It must name exactly ONE format. "audiobook or paperback?" is the person
  // asking the question BACK, and re-entering on it would pick a shelf nobody
  // chose — the rule `formatAsked` already enforces, inherited rather than
  // re-implemented.
  const format = formatAsked(q.replace(FORMAT_ANSWER_OPENER, ''));
  if (!format) return null;

  const priorAsk = (history ?? []).some((t) => t.role === 'user' && suggestIntent(t.text));
  return priorAsk ? format : null;
}

// ---------------------------------------------------------------------------
// ⚠️ SHE OFFERED IT. HE ACCEPTED. SHE SEARCHED THE SHELF FOR HIS ACCEPTANCE.
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE 22:24 TRANSCRIPT — the "say the word" lesson aimed at her OWN
 * invitations.**
 *
 * > **GABI:** *"…would you rather I dig up something good to read?"*
 * > **Sky:** *"soemthing good to read i suppose"*
 * > **GABI:** *"I looked on the estate's public shelf for **soemthing good read
 * > suppose**. Nothing on the estate's public shelf matches that…"*
 *
 * She proposed a specific action, he accepted it in the plainest English
 * available, and the acceptance was routed to a public-index grep.
 * `booksFollowUp` learned this exact shape once already (design §10c: *she
 * invited a retry, he said the word, and the stateless detector sent it to the
 * catalogue*). This is the same defect one lane over, and the generalisation is
 * worth stating plainly:
 *
 * > ⚠️ **AN ACCEPTANCE CARRIES NONE OF THE WORDS THAT MADE THE OFFER.** It
 * > cannot — "yes", "sure", "go on", "i suppose" are content-free by design. The
 * > lane has to come from what SHE said, not from what THEY said.
 *
 * ⚠️ **THIS IS ALSO THE REAL CURE FOR THE TYPO, which is why it is built first.**
 * *"soemthing"* defeated every pattern above. A fuzzy matcher for one transposed
 * word would be a fuzzy matcher on the whole router — a permanent cost on every
 * message and a fresh class of false positives — to solve a case that this fixes
 * for free: with her offer in context, his reply did not have to match anything
 * at all. Spelling stops mattering the moment the lane is carried by the
 * conversation instead of by the sentence.
 */
const SUGGEST_OFFER = [
  /\b(?:dig up|find|pick|grab|pull|line up)\b[^.?!]{0,40}\b(?:something|a few|some)\b/i,
  /\b(?:would you (?:rather|like)|want me to|shall i|should i|do you want me to)\b[^.?!]{0,60}\b(?:recommend|suggest|pick|find|dig)\b/i,
  /\bsomething (?:good |new |else )?to (?:read|listen to)\b/i,
  /\b(?:recommend|suggest)\s+(?:you\s+)?(?:something|a book|a few)\b/i,
  /\bwant (?:a|some) (?:recommendation|suggestions?|ideas?)\b/i,
];

/** ⚠️ Content-free acceptances — every one means nothing on its own, which is
 *  exactly why the OFFER has to supply the lane. */
const ACCEPTANCE = [
  /^\s*(?:yes|yeah|yep|yup|sure|ok|okay|please|go on|go ahead|do it|why not|sounds good|alright)\b/i,
  /\b(?:i suppose|i guess|if you (?:like|want)|go for it|hit me|let'?s do it|sure thing)\b/i,
  /^\s*(?:that one|the first|the second|either|both)\b/i,
];

/** Beyond this it is a new question rather than an acceptance of an old offer.
 *  Mirrors `booksFollowUp`'s own word bound, for the same reason. */
export const SUGGEST_OFFER_MAX_WORDS = 12;

/** ⚠️ The ECHO path is tighter than the bare-acceptance one. "yes" can stand
 *  alone at any length because it means nothing else; an echo is recognised by
 *  repeating the offer's words, and the longer it gets the more likely it is a
 *  new sentence that merely happens to contain "book". */
export const SUGGEST_ECHO_MAX_WORDS = 8;

/** ⚠️ They asked something else, or said no. Either way the offer is over, and
 *  claiming the turn would be a stale invitation hijacking a real question. */
const ECHO_DISQUALIFIER =
  /\b(?:what|which|who|when|where|why|how|whose)\b|\?|\bno(?:pe)?\b|\bnot?\s+(?:thanks|now)\b|\bactually\b|\binstead\b/i;

/**
 * True when HER last turn offered to pick something and THIS turn accepts it.
 *
 * ⚠️ **Only her MOST RECENT turn counts.** An offer made six exchanges ago has
 * been overtaken by everything discussed since, and treating it as live would let
 * a stale invitation hijack an unrelated question — the mirror image of the bug
 * being fixed here.
 */
export function suggestOfferAccepted(
  text: string,
  history: readonly { role: string; text: string }[],
): boolean {
  const q = (text ?? '').trim();
  if (!q) return false;
  // ⚠️ Already unambiguous alone. Returning true here would hide which half of
  // the router decided, and the two are debugged separately.
  if (suggestIntent(q)) return false;
  if (q.split(/\s+/).filter(Boolean).length > SUGGEST_OFFER_MAX_WORDS) return false;

  const hers = [...(history ?? [])].reverse().find((t) => t.role === 'assistant');
  if (!hers || !SUGGEST_OFFER.some((re) => re.test(hers.text))) return false;

  // ⚠️ A bare acceptance is enough — and so is an ECHO of her own offer's words,
  // because "soemthing good to read i suppose" is not a bare "yes": it repeats
  // the offer back. Both are acceptances, and neither is a new question.
  if (ACCEPTANCE.some((re) => re.test(q))) return true;

  // ⚠️ **AN ECHO IS SHORT AND IS NOT A QUESTION**, and both halves are
  // load-bearing. *"no thanks, what is the fourth Dungeon Crawler Carl book we
  // own"* contains the word "book" and would otherwise be swallowed by an offer
  // made one turn earlier — a stale invitation hijacking a real question, which
  // is the exact mirror of the bug this function exists to fix. An interrogative
  // or a refusal means they moved on.
  if (ECHO_DISQUALIFIER.test(q)) return false;
  if (q.split(/\s+/).filter(Boolean).length > SUGGEST_ECHO_MAX_WORDS) return false;
  return /\b(?:something|book|read|listen|audiobook)\b/i.test(q);
}

/**
 * Which format the question already names, if any.
 *
 * ⚠️ **Only an EXPLICIT word counts.** Inferring "physical" from *"something to
 * take on the plane"* would be a guess dressed as an understanding, and the cost
 * of guessing wrong here is the gate being applied to the wrong shelf.
 */
const FORMAT_WORDS: [RegExp, SuggestFormat][] = [
  [/\b(?:audio\s?books?|audio|listen(?:ing)?|narrat(?:ed|or)|on audible)\b/i, 'audio'],
  [/\b(?:e-?books?|kindle|epub|digital(?:ly)?|on my (?:kindle|tablet|e-?reader))\b/i, 'ebook'],
  [/\b(?:physical|print(?:ed)?|paper(?:back)?|hard\s?(?:cover|back)|real book|actual book|off the shelf|hold in my hands?)\b/i, 'physical'],
];

export function formatAsked(text: string): SuggestFormat | null {
  const q = (text ?? '').trim();
  if (!q) return null;
  const hits = FORMAT_WORDS.filter(([re]) => re.test(q)).map(([, f]) => f);
  // ⚠️ TWO named formats is not a preference, it is a comparison — "audiobook or
  // paperback?" is the person asking the clarifying question back. Answering it
  // by silently picking the first is how a gate gets applied to a shelf nobody
  // chose, so an ambiguous message falls through to the one clarifying question.
  return hits.length === 1 ? (hits[0] as SuggestFormat) : null;
}

/**
 * ⚠️ **THE REGULAR WHO SHOULD STOP BEING ASKED** — the owner's *"clarify"* is a
 * courtesy, and a courtesy repeated every time is an obstacle.
 *
 * Tier 2 records what people say about themselves as free-text NOTES (there is
 * no typed preference field, and adding one would be a shared-package change for
 * a single-surface nicety), so this reads the notes for a stated format
 * preference. ⚠️ **It requires a PREFERENCE verb, not merely a format word** —
 * "listened to PH 9 last night" is a reading claim, not a standing preference,
 * and treating it as one would silently stop asking somebody who never chose.
 */
const PREFERENCE_VERB =
  /\b(?:prefers?|prefer(?:red|ence)|always|usually|only|likes? to|tends? to|reads? on|listens? to|wants?)\b/i;

export function formatFromProfileNotes(notes: readonly string[] | undefined): SuggestFormat | null {
  for (const note of notes ?? []) {
    if (!PREFERENCE_VERB.test(note)) continue;
    const found = formatAsked(note);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ⚠️ MOOD — a PREFERENCE SIGNAL, and deliberately NOT an input to the gate
// ---------------------------------------------------------------------------

/**
 * ⚠️ **"IT MAKES ME FALL ASLEEP" IS A REQUIREMENT, NOT SMALL TALK** — the whole
 * of the 2026-08-18 first-stranger transcript, in one line. He said *"I can't sit
 * and read a book it makes me fall asleep"* before he said *"find me something
 * entertaining"*, and the first half is the more useful half: it names the shelf
 * (audio), the pace (fast) and the failure mode (anything worthy).
 *
 * ⚠️ **THESE HINTS NEVER TOUCH `formatAsked`, AND THAT SEPARATION IS LOAD-BEARING.**
 * `formatAsked` decides which PERMISSION GATE is applied — the ebook grant, the
 * physical shelf's `known` check — and its own header pins the rule: *"Only an
 * EXPLICIT word counts. Inferring 'physical' from 'something to take on the
 * plane' would be a guess dressed as an understanding."* That still holds. A mood
 * hint is prose handed to the composer so the PICKS are better; it can never
 * open a shelf, because it is not a format and it never becomes one.
 */
const MOOD_HINTS: [RegExp, string][] = [
  [
    /\b(?:falls?|falling|fell)\s+asleep\b|\bputs?\s+me\s+to\s+sleep\b|\bsend\s+me\s+to\s+sleep\b|\bcan(?:'|’)?t\s+(?:sit|stay\s+awake)\b|\bnod\s+off\b/i,
    'reading on the page sends them to sleep — they are almost certainly after AUDIO, and after ' +
      'something fast-moving rather than something worthy',
  ],
  [
    /\b(?:entertaining|entertain|fun|funny|hilarious|laugh|comedy|light[-\s]?hearted)\b/i,
    'they want it ENTERTAINING — lead with pace and humour, not with prestige',
  ],
  [
    /\b(?:gripping|page[-\s]?turner|exciting|thrill(?:er|ing)|action|fast[-\s]?paced|can(?:'|’)?t\s+put\s+it\s+down)\b/i,
    'they want it GRIPPING — pick for pace and a strong hook',
  ],
  [
    /\b(?:short|quick|not\s+too\s+long|under\s+\d+\s+hours?|bite[-\s]?size)\b/i,
    'they want something SHORT — prefer the lower running times and say the length',
  ],
  [
    /\b(?:cosy|cozy|comforting|gentle|relaxing|wind\s+down|before\s+bed)\b/i,
    'they want something GENTLE — pick for comfort rather than tension',
  ],
  [
    /\b(?:dark|grim(?:dark)?|serious|heavy|bleak)\b/i,
    'they want something DARKER — do not soften the picks',
  ],
  [
    /\b(?:i\s+don(?:'|’)?t\s+(?:really\s+)?read|not\s+much\s+of\s+a\s+reader|hate\s+reading|no\s+time\s+to\s+read|too\s+busy\s+to\s+read)\b/i,
    'they have said they do not really READ — AUDIO is the shelf that fits, and this is not the ' +
      'moment to suggest a doorstopper',
  ],
];

/**
 * The readable hints this message carries, at most three. ⚠️ **Returns `[]` far
 * more often than not, and that is correct** — an empty list means the composer
 * behaves exactly as it did before this existed. A hint invented from a sentence
 * that carried none would be a preference nobody stated, applied to real picks.
 */
export function suggestMoodHints(text: string): string[] {
  const q = (text ?? '').trim();
  if (!q) return [];
  const out: string[] = [];
  for (const [re, hint] of MOOD_HINTS) {
    if (re.test(q)) out.push(hint);
    if (out.length >= 3) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

export const SUGGEST_MSG = {
  /**
   * ⚠️ **ONE QUESTION, ONE SENTENCE, ASKED ONCE.** It names all three because
   * the estate genuinely has three different shelves, and it says WHY it is
   * asking so the question does not read as pedantry.
   */
  clarify:
    'Happy to — audiobook, ebook, or a physical copy? They live on different shelves here, so the ' +
    'answer genuinely changes.',

  switchedOff:
    'Picking books for people is switched off at the moment — that is a lever on our side rather ' +
    'than anything to do with your account. I can still tell you what the catalogue holds.',

  notConfigured:
    "I'm not wired up to pick books yet — that's a setup step on our side, not a permissions problem.",

  /**
   * ⚠️ **AN EMPTY LOOKUP IS A FACT ABOUT MY LOOKUP, NEVER ABOUT YOUR SHELVES.**
   *
   * Live defect 2026-08-19: an empty physical result reached the owner as
   * *"Nothing's come through the scanner yet in that direction, so the catalogue
   * won't show me what you've got on the shelves."* ⚠️ **She had read nothing
   * about the scanner, the ingestion queue, or the state of the physical
   * catalogue** — every one of those is an invented claim about the world, and
   * the estate's physical catalogue in fact holds **448 works**.
   *
   * This is the availability-grounding rule on a new lane: **a claim about data
   * comes from a tool call made THAT TURN, or it is not made.** "I looked and
   * got nothing back" is checkable and true; "nothing has been scanned" is a
   * statement about a pipeline she cannot see.
   *
   * ⚠️ So each of these says **what was looked at, what came back, and what she
   * can do instead** — and none of them says anything about scanning,
   * cataloguing, ingestion, or what the house does or does not own.
   */
  nothingLeft: (format: SuggestFormat) =>
    format === 'audio'
      ? "I looked at the audiobook shelf and couldn't find one to put in front of you that you " +
        "haven't already written about — that's my lookup coming back empty, not a verdict on the " +
        'shelf. Name an author and I will look again, or ask me for a different format.'
      : format === 'ebook'
        ? "My ebook lookup came back empty — that's what I can see from here rather than what the " +
          'house holds. The library site itself is the honest place to browse; ask me for an ' +
          'audiobook meanwhile and I can suggest properly.'
        : // ⚠️ THE ONE THAT WAS FABRICATED. It now names the LIMIT precisely
          // rather than inventing a reason for it.
          "My physical lookup came back empty — and I want to be straight about why that's my " +
          'limit rather than your shelves: from here I can only see print copies that the audiobook ' +
          "catalogue has cross-linked, which is a small slice of what's actually on them. Browse " +
          '<https://library.heygabi.ai> for the real shelf, or ask me for an audiobook and I can ' +
          'suggest properly.',

  estateUnreachable:
    "I couldn't reach the estate to see what you've already got to — that's a problem on our side, " +
    'not your account. Try me again in a minute.',

  // ── the EBOOK gate ─────────────────────────────────────────────────────────

  ebookNotLinked:
    "I can't tell who you are on the estate yet, and the ebooks are behind the household's own " +
    'grant — so I need the link first. Run **/link** once and ask me again. ' +
    "If you'd rather not, ask me for an audiobook and I'll suggest from the shelf everybody can see.",

  ebookLinkIncomplete:
    'Your link was made before I could check estate access. Re-run **/link** once and I will be able ' +
    'to suggest ebooks for you.',

  /**
   * ⚠️ **THE RELAYED REFUSAL IS THE ESTATE'S OWN SENTENCE**, exactly as the book
   * lane's is: the audiobook Worker resolves `vis_ebooks` and is the only thing
   * that can honestly say why. This is the fallback for a refusal that arrived
   * with no sentence in it.
   */
  ebookNotGranted:
    "The ebooks are behind the household's own grant and yours isn't switched on — that's a " +
    "deliberate line rather than a glitch, and an approver in /admin can change it. I can suggest " +
    'you an audiobook meanwhile.',

  // ── the PHYSICAL gate — the owner's own sentence, enforced ─────────────────

  /**
   * ⚠️ **"a linked person who can view a book from the table she's suggesting."**
   * Not linked means she does not know which shelves this person can open, and a
   * physical suggestion is an ERRAND: pointing somebody at a hardback in a house
   * they have no account on wastes their trip.
   */
  physicalNotLinked:
    "I can't tell who you are on the catalogs yet, so I don't know which shelves you can actually " +
    "open — and a physical book is no use to you if it's sitting in a house you can't see into. " +
    'Run **/link** once and ask me again. ' +
    "Ask me for an audiobook instead and I'll suggest from the shelf everybody can see.",

  physicalLinkIncomplete:
    'Your link was made before I could check the catalogs. Re-run **/link** once and I will be able ' +
    'to see which shelves you can open.',

  /** ⚠️ The shelf is NAMED, and so is the fix, because "you can't see it" with no
   *  noun in it is indistinguishable from a bug. */
  physicalNotShared: (label: string, url: string) =>
    `I only suggest a physical book from a shelf you can actually open, and I can't find an account ` +
    `for you on ${label}. Sign in once at <${url}> with the same Google account you linked — ` +
    'signing in is what creates the account I look for — and ask me again. ' +
    "Or ask me for an audiobook and I'll suggest from the shelf everybody can see.",

  /** ⚠️ AN OUTAGE IS NOT A PERMISSION FAILURE. Mislabelling one sends somebody
   *  asking for access they already have. */
  physicalUnreachable: (label: string) =>
    `I couldn't reach ${label} just now to check which shelves you can open, so I'm not going to ` +
    "guess — that's an outage on our side and NOT a verdict about your account. Try me again in a " +
    'minute.',

  physicalNotConfigured:
    "I'm not wired up to check which catalogs you can open, so I won't point you at a physical book " +
    "I can't promise you can reach — that's a setup step on our side, not a permissions problem. " +
    'I can suggest an audiobook.',
} as const;

// ---------------------------------------------------------------------------
// ⚠️ WHAT THE MODEL IS TOLD — the grounding contract
// ---------------------------------------------------------------------------

/**
 * ⚠️ **EVERY SUGGESTED ROW CAME FROM A LOOKUP MADE THIS TURN**, and that is a
 * property of the DATA rather than a hope about the prompt: the candidate list
 * below is composed from the catalogue fetched this turn and the asker's own
 * reviews and reading list read this turn. A model shown a closed list of real
 * rows cannot invent a twelfth Stormlight book, because the row is not there to
 * pick.
 *
 * ⚠️ **AND THE SHELF LANE'S HONESTY RULE RIDES ALONG.** "Not reviewed" is not
 * "unread" — the estate has no read-state store on the audiobook side — so a WHY
 * clause may never say "you haven't read this".
 */
export const SUGGEST_NOTE =
  '⚠️ SUGGEST ONLY FROM THE ROWS BELOW. They were looked up in THIS turn from the estate catalogue ' +
  "and this person's own shelf. Do not add a book from your own memory, do not invent a volume, and " +
  'do not name a book that is not in this list — if the list is short, a short answer is the right ' +
  'answer. If you want more than is here, call a tool and get it in this turn. ' +
  '⚠️ GIVE EACH ONE A REASON, one clause, drawn from the `why` on its row — a suggestion with no ' +
  'reason is a random book. ' +
  '⚠️ NEVER SAY THEY HAVE NOT READ SOMETHING. The estate records what people have REVIEWED and not ' +
  'what they have finished, so "you haven\'t written about this one" is honest and "you haven\'t ' +
  'read this" is not. Never call it a backlog and never call it unread. ' +
  '⚠️ Name the SHELF each one is on (audiobook, ebook, or which print formats), because the estate ' +
  'has three and they are not the same shelf.';

/**
 * ⚠️ **THE NO-FABRICATION RULE, on the path where it was broken.**
 *
 * Live 2026-08-19: an empty physical lookup became *"Nothing's come through the
 * scanner yet in that direction."* She had read nothing about a scanner. That is
 * the availability-grounding rule violated on a new lane — and the physical
 * catalogue really holds 448 works, so the invented explanation was also false.
 *
 * ⚠️ It rides the EMPTY path specifically, because that is the path with nothing
 * in front of the model and therefore the one where a plausible story is the
 * cheapest thing to produce.
 */
export const SUGGEST_NO_FABRICATION_NOTE =
  '⚠️ SAY WHAT YOU LOOKED AT AND WHAT CAME BACK — NOTHING ELSE. You may say your lookup returned ' +
  'nothing and that it is a limit of what you can see from here. You may NOT explain WHY it is ' +
  'empty: you have not read anything about scanning, cataloguing, ingestion queues, what has been ' +
  'processed, or what the house does or does not own, and any sentence about those is invented. ' +
  '⚠️ "Nothing has been scanned yet" is the exact sentence that broke this rule — an empty result ' +
  'is a fact about YOUR LOOKUP and never about their shelves. Point them at the site and offer a ' +
  'format you can actually answer.';

/** ⚠️ Said when the format was chosen FOR them rather than by them, so the
 *  person can correct a preference she learned rather than one they stated. */
export const SUGGEST_ASSUMED_NOTE = (format: SuggestFormat): string =>
  `⚠️ They did not say which format they wanted this time; you are going on the ${format} preference ` +
  'their profile has recorded. Mention that in passing in one short clause, so they can correct you ' +
  'if it has changed.';

// ---------------------------------------------------------------------------
// The candidates — composed, ranked, and each carrying its own WHY
// ---------------------------------------------------------------------------

export interface SuggestCandidate {
  title: string;
  author: string;
  bookId: string;
  series?: string;
  seriesIndex?: string;
  narrator?: string;
  duration?: string;
  universe?: string;
  /** Which shelf this row can be had on, for the format the person asked for. */
  shelf: string;
  /** ⚠️ ONE CLAUSE, and it names the evidence rather than asserting a taste. */
  why: string;
  /** Which rule produced it. Kept so a reviewer can see the ladder ran in order
   *  and so a test can assert the star move fires first. */
  basis: 'tbr' | 'series_next' | 'same_author' | 'same_universe' | 'shelf';
  /** ⚠️ Present only for a library row, and used VERBATIM as the site gave it.
   *  Assembling a URL here would be a second implementation of that site's
   *  routing, in a repo that does not deploy it. */
  url?: string;
}

/** How many go in one answer. Design: lists of 3–5; auto-continue carries more. */
export const SUGGEST_ROWS = 5;

/** ⚠️ What counts as "they liked it". Four of five stars, because a three is
 *  somebody being polite and building a recommendation on it is how she ends up
 *  suggesting more of something they merely tolerated. */
export const LIKED_RATING = 4;

const shelfLabel = (row: CatalogRow, format: SuggestFormat): string => {
  if (format === 'audio') return 'the audiobook shelf';
  if (format === 'ebook') return 'the library, as an ebook';
  const formats = physicalFormatsOf(row);
  return formats.length > 0 ? `the library, in ${formats.join(' and ')}` : 'the library, in print';
};

const indexOf = (row: CatalogRow): number => {
  const n = Number.parseFloat(row.seriesIndex ?? '');
  return Number.isFinite(n) ? n : Number.NaN;
};

/**
 * Build the candidate list.
 *
 * ⚠️ **PURE, and that is what makes the ladder testable.** Every input is data
 * the caller fetched; nothing here reaches the network, so "does the star move
 * fire first" is a unit test rather than a live experiment.
 *
 * The ladder, in order, and the order is the design:
 *
 *  1. ⚠️ **Their own TBR** — they already told the house they wanted this. Any
 *     other suggestion made while an unmet intention sits on the list is her
 *     talking over them.
 *  2. ⚠️ **THE SERIES CONTINUATION — the star move.** Somebody who gave volume 3
 *     four stars wants volume 4, and it is the one recommendation that needs no
 *     taste model at all: the evidence is their own rating and the shelf's own
 *     ordering.
 *  3. **Same author** as something they rated well.
 *  4. **Same universe** — the estate's own cross-series canon.
 *  5. **The shelf**, when there is no signal at all. ⚠️ Its WHY says exactly that
 *     rather than implying a personalisation that did not happen.
 */
export function buildSuggestions(opts: {
  rows: readonly CatalogRow[];
  reviews: readonly ReviewRow[];
  /**
   * ⚠️ The FULL, uncapped set of reviewed bookIds (audit F7). `reviews` is only
   * the capped display slice and still feeds the ratings heuristic, but the
   * exclusion set MUST key off this — otherwise a shelf with more than 15
   * reviews has its older-reviewed books suggested back. Falls back to the ids
   * in `reviews` when absent, so existing callers keep working.
   */
  reviewedIds?: readonly string[];
  tbr: readonly TbrRow[];
  format: SuggestFormat;
  limit?: number;
}): SuggestCandidate[] {
  const limit = opts.limit ?? SUGGEST_ROWS;
  const byId = new Map<string, CatalogRow>();
  for (const row of opts.rows) {
    const id = bookIdFromTitle(row.title);
    if (id && !byId.has(id)) byId.set(id, row);
  }

  // ⚠️ EXCLUDE WHAT THEY HAVE ALREADY WRITTEN ABOUT. Not "already read" — the
  // estate has no such record — but a book somebody reviewed is a book they have
  // finished with, and suggesting it back is the single most obviously wrong
  // thing this feature could do.
  const reviewed = new Set(
    (opts.reviewedIds ?? opts.reviews.map((r) => r.bookId)).filter(Boolean),
  );
  const ratings = new Map<string, number>();
  for (const r of opts.reviews) {
    if (r.bookId && typeof r.rating === 'number') ratings.set(r.bookId, r.rating);
  }

  const eligible = (id: string): CatalogRow | null => {
    if (reviewed.has(id)) return null;
    const row = byId.get(id);
    if (!row) return null;
    return rowHasFormat(row, opts.format) ? row : null;
  };

  const out: SuggestCandidate[] = [];
  const taken = new Set<string>();
  const push = (row: CatalogRow, id: string, why: string, basis: SuggestCandidate['basis']) => {
    if (taken.has(id) || out.length >= limit) return;
    taken.add(id);
    out.push({
      title: row.title,
      author: row.author,
      bookId: id,
      ...(row.series ? { series: row.series } : {}),
      ...(row.seriesIndex ? { seriesIndex: row.seriesIndex } : {}),
      ...(row.narrator ? { narrator: row.narrator } : {}),
      ...(row.duration ? { duration: row.duration } : {}),
      ...(row.universe ? { universe: row.universe } : {}),
      shelf: shelfLabel(row, opts.format),
      why,
      basis,
    });
  };

  // ── 1. their own reading list ────────────────────────────────────────────
  for (const item of opts.tbr) {
    const row = eligible(item.bookId);
    if (row) push(row, item.bookId, 'it is already on your own reading list', 'tbr');
  }

  // ── 2. ⚠️ the series continuation — the star move ────────────────────────
  const liked = [...ratings.entries()].filter(([, r]) => r >= LIKED_RATING);
  // ⚠️ Highest rating first, so a five-star series beats a four-star one when
  // only a few slots are left.
  liked.sort((a, b) => b[1] - a[1]);
  for (const [likedId, rating] of liked) {
    const likedRow = byId.get(likedId);
    if (!likedRow?.series) continue;
    const from = indexOf(likedRow);
    const next = opts.rows
      .filter((r) => r.series === likedRow.series)
      .filter((r) => (Number.isNaN(from) ? true : indexOf(r) > from))
      .filter((r) => {
        const id = bookIdFromTitle(r.title);
        return !!id && !!eligible(id);
      })
      .sort((a, b) => indexOf(a) - indexOf(b))[0];
    if (!next) continue;
    const id = bookIdFromTitle(next.title);
    const volume = next.seriesIndex ? ` (${likedRow.series} #${next.seriesIndex})` : '';
    push(
      next,
      id,
      `you gave ${likedRow.title} ${rating} stars and this is the next one${volume}`,
      'series_next',
    );
  }

  // ── 3. same author as something they rated well ──────────────────────────
  for (const [likedId, rating] of liked) {
    const likedRow = byId.get(likedId);
    if (!likedRow?.author) continue;
    for (const r of opts.rows) {
      if (r.author !== likedRow.author) continue;
      const id = bookIdFromTitle(r.title);
      if (!id || !eligible(id)) continue;
      push(r, id, `you rated ${likedRow.title} ${rating} stars, and this is ${r.author} too`, 'same_author');
    }
  }

  // ── 4. same universe ─────────────────────────────────────────────────────
  for (const [likedId, rating] of liked) {
    const likedRow = byId.get(likedId);
    if (!likedRow?.universe) continue;
    for (const r of opts.rows) {
      if (r.universe !== likedRow.universe) continue;
      const id = bookIdFromTitle(r.title);
      if (!id || !eligible(id)) continue;
      push(
        r,
        id,
        `same universe as ${likedRow.title}, which you rated ${rating} stars`,
        'same_universe',
      );
    }
  }

  // ── 5. ⚠️ no signal at all, and the WHY says so ──────────────────────────
  if (out.length === 0) {
    for (const r of opts.rows) {
      const id = bookIdFromTitle(r.title);
      if (!id || !eligible(id)) continue;
      push(
        r,
        id,
        'it is on the shelf and you have not written about it — I have nothing else to go on yet',
        'shelf',
      );
    }
  }

  return out.slice(0, limit);
}

/**
 * The candidate list as the model receives it.
 *
 * ⚠️ A missing field is OMITTED rather than nulled, for `gabi-tools.ts`'s
 * measured reason: a model shown `narrator: null` will sometimes fill it in; a
 * model shown no narrator line at all has nothing to fill.
 */
export function renderSuggestions(
  candidates: readonly SuggestCandidate[],
  format: SuggestFormat,
): string {
  const head =
    `Candidates for a ${format} suggestion, looked up this turn (${candidates.length}):`;
  const lines = candidates.map((c) => {
    // ⚠️ An absent author is OMITTED, never printed as an empty dash or as
    // "Unknown" — the verb returns null when it does not know, and a sentinel
    // here would become an author in her sentence.
    const bits = [c.author ? `**${c.title}** — ${c.author}` : `**${c.title}**`];
    if (c.series) bits.push(`series: ${c.series}${c.seriesIndex ? ` #${c.seriesIndex}` : ''}`);
    if (c.narrator) bits.push(`narrator: ${c.narrator}`);
    if (c.duration) bits.push(`length: ${c.duration}`);
    if (c.universe) bits.push(`universe: ${c.universe}`);
    bits.push(`on: ${c.shelf}`);
    if (c.url) bits.push(`link: ${c.url}`);
    bits.push(`why: ${c.why}`);
    return `- ${bits.join(' · ')}`;
  });
  return [head, ...lines].join('\n');
}
