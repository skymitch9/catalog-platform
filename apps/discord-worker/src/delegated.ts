/**
 * **TIER 1 — GABI does something, using the asker's own standing.**
 *
 * Owner ask 2026-08-17, verbatim: *"Can I dm her an isbn or a photo and she
 * adds it to the catalog?"* and *"Hey Gabi, fix all my missing details… Hey
 * @Sam i went ahead and fixed all your missing stuff."* Approved as Tier 1 of
 * the T0–T4 ladder (`docs/info/gabi-application-map.md`): **additive writes
 * with easy undo — auto-apply, then report.**
 *
 * This file is the whole contract and **holds no credential**. Detection,
 * routing, the caps and every sentence live here; the one module that touches a
 * secret is `delegated-exec.ts`, which implements `DelegatePort` and is wired in
 * by `gateway.ts` and `conversation-flow.ts`. `test/delegated.test.ts` pins that
 * split by reading the sources.
 *
 * ## ⚠️ THE DELEGATION SEAM, in one paragraph
 *
 * GABI holds nothing. She asserts an **identity** — proved by the
 * `discord_links/{discordUserId}` document the person created themselves,
 * through their own Discord OAuth *and* their own Firebase sign-in (`link.ts`)
 * — and the **destination site** decides what that identity may do, against its
 * own `app_user` row, with the same capability the equivalent button is gated
 * on. Two independent facts must both be true: the caller is the bot (a shared
 * bearer), and the asker holds the capability (a role on that instance). Losing
 * either one refuses in words.
 *
 * ⚠️ **The refusals are the DESTINATION'S OWN WORDS, relayed verbatim.** That
 * is not laziness: the site is the authority, so it is the only thing that can
 * honestly say *why* — and it is the thing that knows whether the answer is
 * "no account here", "awaiting approval", "role too low" or "the estate
 * switched you off". Four causes, four fixes, four sentences (the estate's
 * no-bare-status rule). GABI adds nothing to them and never guesses one.
 *
 * ## ⚠️ WHAT ENDED HERE, DELIBERATELY
 *
 * Until 2026-08-18 the mention path was **100% credential-free**, and
 * `test/mentions.test.ts` asserted it against `mention-flow.ts`'s source.
 * `docs/TODO.md` recorded that shipping any write *"means deciding to give up
 * that property on purpose"*. **The owner's Tier-1 approval is that decision**
 * — *"that looks good, start with that"* (2026-08-17), then *"all of it"*.
 *
 * The property that replaces it is narrower, mechanical, and pinned by the same
 * kind of source-reading test:
 *
 * > **Credentials appear ONLY in `delegated-exec.ts`.** The lookup and chat
 * > paths — `mention-flow.ts`, `gabi-chat.ts`, `tool-exec.ts`, `catalog-data.ts`
 * > and `have.ts` — name no Firestore client, no service account, no app token
 * > and no bot-write verb, and they reach the write path only through an
 * > INJECTED port they cannot construct.
 *
 * ## ⚠️ THE MODEL CHOOSES NOTHING HERE
 *
 * A delegated verb is triggered by a **checksummed ISBN** or by a **pattern**,
 * before any model call, and the verbs are never described to the model
 * (`gabi-tools.ts` explains why the two allowlists are two arrays). So a
 * misread sentence cannot add a book: the number either passes its check digit
 * or it does not.
 *
 * ## Bounded steps
 *
 * One delegated turn spends at most: 1 link read + 2 `whoami` calls + 1 verb =
 * **4 subrequests**, and nothing loops. `run-details` is the slow one (the
 * sweep takes 20–90 s per book, by design — see the library's own
 * `research-run.ts` on why answering fast and finishing in the background is
 * the failure mode), so she says *"on it"* first and reports afterwards.
 */

import type { Env } from './env.js';
import {
  GABI_DELEGATED_VERB_NAMES,
  gabiDelegatedVerbByName,
  type GabiDelegatedVerbName,
} from './gabi-tools.js';

// ---------------------------------------------------------------------------
// The posture
// ---------------------------------------------------------------------------

/**
 * ⚠️ **AFFIRMATIVE-ONLY**, exactly like `mentionsOn` and `moderationOn`. `"on"`
 * and nothing else; every typo means OFF, and OFF means she behaves precisely as
 * she did before Tier 1 existed.
 */
export function delegatedWritesOn(env: Pick<Env, 'GABI_DELEGATED_WRITES'>): boolean {
  return (env.GABI_DELEGATED_WRITES ?? '').trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// The two instances
// ---------------------------------------------------------------------------

/**
 * One catalog GABI can be asked to write to.
 *
 * ⚠️ `app` is the estate consumer id the destination Worker asserts for itself
 * (`ESTATE_APP`), and it is what the *site* reports back — not something this
 * end decides. Recorded here so a reply can say WHICH shelf changed, which is
 * the whole reason routing exists.
 */
export interface LibraryInstance {
  app: 'library' | 'library2';
  /** What she calls it in a sentence. Not a hostname — a place. */
  label: string;
  baseUrl: string;
}

export const DEFAULT_LIBRARY_MAIN = 'https://library.heygabi.ai';
export const DEFAULT_LIBRARY_FRIEND = 'https://padhard.heygabi.ai';

const trimBase = (raw: string | undefined, fallback: string): string =>
  (raw ?? '').trim().replace(/\/+$/, '') || fallback;

/**
 * The instances this deployment may reach, in the order she offers them.
 *
 * ⚠️ **The main library first**, because on a tie the menu's first row is the
 * one people press without reading. That is a wording decision, not an
 * authority one: nothing here decides anything about permission.
 */
export function libraryInstances(
  env: Pick<Env, 'LIBRARY_MAIN_URL' | 'LIBRARY_FRIEND_URL'>,
): LibraryInstance[] {
  return [
    { app: 'library', label: 'the main library', baseUrl: trimBase(env.LIBRARY_MAIN_URL, DEFAULT_LIBRARY_MAIN) },
    { app: 'library2', label: 'your own shelf', baseUrl: trimBase(env.LIBRARY_FRIEND_URL, DEFAULT_LIBRARY_FRIEND) },
  ];
}

// ---------------------------------------------------------------------------
// Detection — deterministic, and never a model's decision
// ---------------------------------------------------------------------------

/**
 * ISBN-13 check digit (EAN-13 mod 10, alternating 1/3 weights).
 *
 * ⚠️ **The checksum is what makes DM-an-ISBN safe to auto-detect at all.** A
 * bare 13-digit run also matches a phone number, an order id and a timestamp;
 * requiring the check digit takes the false-positive rate to about 1 in 10 of
 * those, and requiring the 978/979 prefix as well takes it to roughly nothing.
 * ⚠️ It says the number is WELL-FORMED, never that it is the right book — three
 * of ten ISBNs typed from memory resolved to entirely different books, with
 * covers (`library_catalog/docs/info/isbn-ladder.md` §2). Nothing here can
 * defend against that and nothing here pretends to.
 */
export function isbn13Valid(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}

/** ISBN-10 check digit (mod 11, trailing `X` = 10). */
export function isbn10Valid(code: string): boolean {
  if (!/^\d{9}[\dXx]$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(code[i]) * (10 - i);
  const last = code[9] as string;
  sum += last.toUpperCase() === 'X' ? 10 : Number(last);
  return sum % 11 === 0;
}

/**
 * The first ISBN-shaped, checksum-passing token in a message, folded to its
 * bare characters — or `null`.
 *
 * ⚠️ **Hyphens and spaces INSIDE a run are tolerated**, because that is how
 * ISBNs are printed and typed (`978-0-7653-1178-8`). They are tolerated only
 * *inside* a candidate run, so *"chapter 9 - 780765311788"* does not become one
 * by accident: the run must be bounded by non-token characters and must contain
 * no other digits.
 *
 * ⚠️ An ISBN-10 is accepted only when it PASSES ITS OWN mod-11 check, which a
 * ten-digit phone number effectively never does. No "the word ISBN appeared
 * nearby" heuristic: a sentence with the right number in it is the same request
 * whether or not somebody labelled it.
 */
export function findIsbn(text: string): string | null {
  // Candidate runs: digits with optional single separators, 10+ chars, possibly
  // ending in X. Bounded by anything that is not a token character.
  const runs = text.match(/(?<![\w-])[\dXx][\dXx\s-]{8,20}[\dXx](?![\w-])/g) ?? [];
  for (const run of runs) {
    const folded = run.replace(/[\s-]/g, '').toUpperCase();
    if (folded.length === 13 && /^97[89]/.test(folded) && isbn13Valid(folded)) return folded;
    if (folded.length === 10 && isbn10Valid(folded)) return folded;
  }
  return null;
}

/**
 * *"Fix all my missing details."*
 *
 * ⚠️ **Deliberately narrow, and it must stay narrower than `FIX_PATTERNS` in
 * `mentions.ts`.** That router already turns *"fix the author on Mistborn"* into
 * a propose-and-deep-link answer, which is still right: editing one wrong value
 * is a **T2 mutation** and needs a confirm button this build does not have.
 * What this matches is only the SWEEP — a request to fill in blanks, which is
 * additive by construction and therefore the thing T1 is allowed to do.
 *
 * So it requires a repairing verb AND the idea of something missing:
 *   fix / fill / sort out / complete / chase / clean up
 *   × missing / blank / empty / gaps / incomplete
 * plus the two ways people ask for the job by name.
 */
const DETAILS_VERB = /\b(fix|fill|sort|complete|chase|clean|finish|patch|update)\b/i;
const DETAILS_GAP = /\b(missing|blank|empty|gaps?|incomplete|unfinished|holes?)\b/i;
const DETAILS_BY_NAME =
  /\b(details? sweep|missing details?|details? queue|missing (?:stuff|info|information|fields|data))\b/i;

export function wantsDetailsSweep(text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  if (DETAILS_BY_NAME.test(q) && DETAILS_VERB.test(q)) return true;
  return DETAILS_VERB.test(q) && DETAILS_GAP.test(q);
}

/** What a message is asking her to DO, if anything. `null` is the ordinary
 * case and means "carry on down the read-only ladder unchanged". */
export type DelegatedIntent =
  | { verb: 'add-isbn'; isbn: string }
  | { verb: 'run-details' }
  | null;

/**
 * ⚠️ **The order is load-bearing.** An ISBN wins, because a message carrying a
 * valid ISBN is unambiguously about that book — including *"can you fix my
 * missing 9780765311788"*, where the sweep reading would do the wrong job on
 * the whole catalog.
 */
export function delegatedIntent(text: string): DelegatedIntent {
  const isbn = findIsbn(text);
  if (isbn) return { verb: 'add-isbn', isbn };
  if (wantsDetailsSweep(text)) return { verb: 'run-details' };
  return null;
}

// ---------------------------------------------------------------------------
// The write cap — a SECOND fuse, beside the turn cap
// ---------------------------------------------------------------------------

/**
 * ⚠️ **Twenty writes per person per UTC day**, and it is deliberately not the
 * same fuse as `USER_TURNS_PER_WINDOW`.
 *
 * The turn cap protects a MODEL SPEND that is fractions of a cent and resets
 * hourly. This one protects **rows in somebody's catalog** and **~2¢ per book of
 * research on their key**, neither of which is undone by waiting an hour. A day
 * is the right window because the damage is persistent; twenty is the number
 * because a genuine shelf-stocking session is a handful of books and a runaway
 * is not.
 *
 * It counts ATTEMPTED writes that reached the destination, refusals included —
 * counting only successes would let a loop of refused calls run for ever.
 */
export const USER_WRITES_PER_DAY = 20;

export type WriteCapVerdict = { ok: true } | { ok: false; message: string };

export function writeCapDecision(writesToday: number): WriteCapVerdict {
  if (writesToday >= USER_WRITES_PER_DAY) {
    return { ok: false, message: DELEGATE_MSG.writeCapped };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

/** What one instance says about one person. `known: false` is an ORDINARY
 * answer, not an error — see `chooseInstances`. */
export interface WhoAmI {
  app: string;
  site: string;
  known: boolean;
  role?: string;
  pending?: boolean;
  capabilities?: { editCatalog?: boolean; runResearch?: boolean; scanPhoto?: boolean };
}

/**
 * One delegated call's outcome. ⚠️ `message` is ALWAYS present and is always
 * the thing she says: on success it is the destination's own report, on refusal
 * it is the destination's own worded refusal, and on an outage it is this
 * file's — because an outage is the one case the destination cannot word.
 */
export interface DelegatedCallResult {
  ok: boolean;
  /** 0 means the site could not be reached at all. */
  status: number;
  message: string;
  outcome?: string;
  /** The instance that answered, so a reply can name the shelf. */
  instance: LibraryInstance;
}

/**
 * Everything the delegated flow needs from the outside world.
 *
 * ⚠️ **An interface rather than an import, and that is the credential seam.**
 * `mention-flow.ts` can call these; it cannot construct one, cannot reach a
 * service account through one, and names no secret. The implementation
 * (`delegated-exec.ts`) is built by the two composition roots that already hold
 * `env` — the gateway object and the interactions endpoint.
 */
export interface DelegatePort {
  /** The `discord_links` document's `firebaseUid`, or why there is none. */
  linkedUid(
    discordUserId: string,
  ): Promise<{ ok: true; uid: string } | { ok: false; reason: 'unlinked' | 'outage' }>;
  /** Ask ONE instance about this person. `null` = that site was unreachable. */
  whoami(instance: LibraryInstance, uid: string): Promise<WhoAmI | null>;
  /** Do the thing. Never throws — an outage comes back as `status: 0`. */
  call(
    instance: LibraryInstance,
    verb: GabiDelegatedVerbName,
    uid: string,
    body?: Record<string, unknown>,
  ): Promise<DelegatedCallResult>;
}

// ---------------------------------------------------------------------------
// Routing — one shelf, two, or none
// ---------------------------------------------------------------------------

export type InstanceRouting =
  /** Exactly one instance where they hold the capability. Go. */
  | { kind: 'one'; instance: LibraryInstance }
  /** Both. ⚠️ ASK — never pick, because picking wrong writes to the wrong
   * household's catalog and the person cannot see that it happened. */
  | { kind: 'ask'; instances: LibraryInstance[] }
  /**
   * Nobody has the capability, but at least one instance KNOWS them. Call that
   * one anyway and relay ITS refusal: the destination is the authority on why,
   * and a bot-authored "you can't" would be a second copy of a role matrix.
   */
  | { kind: 'relay'; instance: LibraryInstance }
  /** No account on any shelf, or no shelf could be reached. */
  | { kind: 'none'; unreachable: boolean };

/**
 * Decide where a verb goes.
 *
 * ⚠️ **An unreachable instance is NOT the same as one that does not know you**,
 * and conflating them is how an outage becomes "you have no account" — the
 * exact mislabelling the estate's rule forbids. A `null` answer is carried
 * through to `{ kind: 'none', unreachable: true }`, which is worded as our
 * problem.
 */
export function chooseInstances(
  answers: { instance: LibraryInstance; who: WhoAmI | null }[],
  capability: 'editCatalog' | 'runResearch',
): InstanceRouting {
  const reachable = answers.filter((a) => a.who !== null);
  const known = reachable.filter((a) => a.who!.known);
  const able = known.filter((a) => a.who!.capabilities?.[capability] === true);

  if (able.length === 1) return { kind: 'one', instance: able[0]!.instance };
  if (able.length > 1) return { kind: 'ask', instances: able.map((a) => a.instance) };
  if (known.length > 0) return { kind: 'relay', instance: known[0]!.instance };
  return { kind: 'none', unreachable: reachable.length < answers.length };
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/**
 * ⚠️ Only the sentences the DESTINATION cannot say: an outage, an unlinked
 * account, a cap on GABI's side, and the "which shelf?" question. Everything
 * about authority is the destination's own wording, relayed.
 */
export const DELEGATE_MSG = {
  notConfigured:
    "I'm not wired up to write to the catalogs yet — that's a setup step on the estate's side, " +
    'not anything to do with your account, and nothing was changed. I can still look things up.',

  switchedOff:
    "Adding books from Discord is switched off at the moment, so I haven't changed anything. " +
    'That is a lever on our side rather than a permissions problem — the site can still do it, ' +
    'and I can still look things up from here.',

  unlinked:
    "I don't know who you are on the catalog side yet, so I haven't changed anything — I never " +
    'guess that from a Discord name. Run **/link** once (about twenty seconds, and you can ' +
    'unlink whenever you like) and then ask me again.',

  linkOutage:
    "I couldn't check who you are just then — that's a problem on the estate's side, NOT a " +
    'permissions one, and nothing was changed. Try me again in a minute.',

  siteUnreachable: (label: string) =>
    `I couldn't reach ${label} just then, so nothing was changed. That's an outage on our side ` +
    'rather than an answer about your account or the book.',

  noAccountAnywhere:
    "I couldn't find an account for you on either catalog, so I haven't changed anything. Sign " +
    'in once at <https://library.heygabi.ai> (or <https://padhard.heygabi.ai>) with the same ' +
    'Google account you linked to Discord — signing in is what creates the account I look for — ' +
    'and then ask me again.',

  writeCapped:
    "I've made a lot of changes for you today, so I'm going to stop there — that's a cap on my " +
    'side, not anything you did, and nothing was changed just now. It resets overnight, and the ' +
    'site has no such cap.',

  /** The "which shelf?" question, worded as the owner asked it. */
  whichShelf: (what: string) =>
    `You can do that on both catalogs, and I'm not going to guess which one you meant — ` +
    `${what} on the wrong shelf is a tidy-up somebody has to notice first. Which is it?`,

  shelfChoiceStale:
    "That question has aged out, so I haven't done anything. Ask me again and I'll offer the " +
    'choice fresh.',

  /** Said BEFORE the sweep runs, because the sweep takes minutes. */
  onIt: (label: string) =>
    `On it — I'll go through what ${label} is missing and report back here in a minute or two. ` +
    'Two books an hour is the ceiling, so this is a dent rather than the whole backlog.',

  /** The async follow-up's opening, addressed by mention as the owner asked. */
  reportBack: (userId: string) => `Hey <@${userId}> — I went and filled in what I could.`,

  sweepFailed: (label: string) =>
    `I started on ${label}'s missing details and it fell over partway — that's a failure on our ` +
    'side, not a verdict about any book. Whatever it managed to fill is saved and undoable on ' +
    'the site; nothing is half-written.',
} as const;

/** The verb's required capability, read off the allowlist rather than repeated.
 * ⚠️ `whoami` needs none, so callers of the two WRITING verbs use this and the
 * type makes the third case impossible to forget. */
export function capabilityFor(verb: 'add-isbn' | 'run-details'): 'editCatalog' | 'runResearch' {
  const found = gabiDelegatedVerbByName(verb);
  // Unreachable while the allowlist and this union agree — which the test pins.
  if (!found || found.requiredCapability === 'none') {
    throw new Error(`delegated verb ${verb} has no required capability`);
  }
  return found.requiredCapability;
}

/** Re-exported so a reader of this file sees the allowlist it is bound to. */
export { GABI_DELEGATED_VERB_NAMES };
