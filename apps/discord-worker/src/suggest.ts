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

/** ⚠️ The tokens `library_formats` actually contains — measured, not guessed.
 *  Matching is case-insensitive on the pipe-split parts. */
export const PHYSICAL_FORMAT_TOKENS = ['hardcover', 'paperback'] as const;
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
  return parseFormats(row.libraryFormats)
    .filter((t) => (PHYSICAL_FORMAT_TOKENS as readonly string[]).includes(t))
    .map((t) => (t === 'hardcover' ? 'hardcover' : 'paperback'));
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

  /** ⚠️ Never "you have read everything". An empty candidate list means the
   *  FILTER found nothing, and the filter is narrow by construction. */
  nothingLeft: (format: SuggestFormat) =>
    format === 'audio'
      ? "I couldn't find anything on the audiobook shelf I'd put in front of you that you haven't " +
        'already written about. Ask me for a different shelf, or name an author and I will look again.'
      : `I couldn't find anything on the ${format === 'ebook' ? 'ebook' : 'print'} side that fits — ` +
        'the cross-catalog join only covers part of the shelf, so this is a gap in what I can see ' +
        'rather than a verdict on what the house owns.',

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
  const reviewed = new Set(opts.reviews.map((r) => r.bookId).filter(Boolean));
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
    const bits = [`**${c.title}** — ${c.author}`];
    if (c.series) bits.push(`series: ${c.series}${c.seriesIndex ? ` #${c.seriesIndex}` : ''}`);
    if (c.narrator) bits.push(`narrator: ${c.narrator}`);
    if (c.duration) bits.push(`length: ${c.duration}`);
    if (c.universe) bits.push(`universe: ${c.universe}`);
    bits.push(`on: ${c.shelf}`);
    bits.push(`why: ${c.why}`);
    return `- ${bits.join(' · ')}`;
  });
  return [head, ...lines].join('\n');
}
