/**
 * **GABI READS THE ESTATE DOCS — the Discord half** (design phase 4).
 *
 * Owner brief, verbatim (2026-08-17): *"let's make sure GABI can read all of
 * our docs and stuff so she can even help me if needed for let's say I don't
 * have a Claude code session open."* ⚠️ **This file and its executor are the
 * half that actually answers that ask.** Phases 1/2/5/6 put the corpus behind
 * `heygabi.ai/docs/`, which is a browser — the thing the owner asked for was an
 * answer when no Claude session is open, i.e. from his phone, in Discord.
 *
 * This file is the whole contract and **holds no credential**. The caps, the
 * posture, the per-turn budget and every sentence live here;
 * `estate-docs-exec.ts` is the only module that touches a secret, and it is
 * wired in as an injected port the conversational path cannot construct — the
 * exact seam `delegated.ts` / `delegated-exec.ts` established for Tier 1.
 *
 * ## ⚠️ GABI HOLDS NO PERMISSION OF HER OWN
 *
 * She asserts an **identity** — the email on the `discord_links/{id}` document
 * the person created themselves, through their own Discord OAuth *and* their
 * own Firebase sign-in (`link.ts`) — and the **auth Worker** decides what that
 * identity may read, against the estate directory, with `devopsAllows()`: the
 * same predicate the browser door uses. Two independent facts must both be
 * true: the caller is this Worker (a shared bearer), and the asker is
 * devops-class (a directory row). Losing either refuses in words.
 *
 * ⚠️ **A NON-DEVOPS HOUSEHOLD MEMBER GETS THE WORDED GATE AND SHE NEVER SEES A
 * BYTE OF CORPUS ON THEIR BEHALF.** That is not a client-side check she could
 * skip — it is the auth Worker answering 403 before any document is read. This
 * end relays; it never decides.
 *
 * ## The four refusals, and why they are COPIED rather than imported
 *
 * `DOCS_REFUSALS` below is a verbatim copy of `apps/auth-worker/src/
 * estate-docs.ts`'s export of the same name. The auth Worker is the SOURCE OF
 * RECORD; this is a second holder, and `test/estate-docs.test.ts` reads that
 * file and fails the build if the two ever drift. A cross-app import would
 * couple two separately-deployable Workers at the module level for five
 * strings; two pinned copies is the estate's own idiom (`GABI_DELEGATED_VERB_
 * NAMES` is mirrored at both ends of the delegated door for the same reason).
 *
 * ⚠️ Which end says which sentence is not arbitrary — it is *who can know*:
 *
 * | Cause | Worded by | Because |
 * |---|---|---|
 * | Not linked | **here** | only this end can read `discord_links` |
 * | Linked, no email (pre-upgrade) | **here** | same document, a different absence |
 * | Linked, approved, NOT devops | **the auth Worker**, relayed | only the directory knows |
 * | Estate unreachable | **here** | the auth Worker cannot word its own outage |
 */

import type { Env } from './env.js';

// ---------------------------------------------------------------------------
// The posture
// ---------------------------------------------------------------------------

/**
 * ⚠️ **AFFIRMATIVE-ONLY**, the exact idiom of `mentionsOn`, `moderationOn` and
 * `delegatedWritesOn`. `"on"` and nothing else; `"true"`, `"1"`, `"yes"` and
 * every typo mean OFF.
 *
 * ⚠️ **IT SHIPS OFF**, unlike `GABI_DELEGATED_WRITES` — and the difference is
 * deliberate. Tier 1 shipped `"on"` because the owner approved that capability
 * in words. This one reaches PII plus an operations runbook (break-glass SQL,
 * deploy levers, secret names, household members' emails and role
 * assignments), so flipping it is design §7's owner step 4: *"a deliberate act,
 * never a side effect of a deploy."*
 *
 * ⚠️ OFF does not mean silent. With this off she still says, in words, that the
 * docs are switched off — a docs question must never fall through to a shelf
 * search that returns nothing and reads as broken.
 */
export function docsOn(env: Pick<Env, 'GABI_DOCS'>): boolean {
  return (env.GABI_DOCS ?? '').trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// ⚠️ THE DOCS INTENT ROUTER — deterministic, and NEVER a model's decision
// ---------------------------------------------------------------------------

/**
 * ⚠️ **WHY THIS EXISTS: the acceptance test it was written against.**
 *
 * Minutes after `GABI_DOCS` was flipped on (2026-08-18), the owner DM'd the
 * exact question this feature was built for — *"how do I promote the audiobook
 * site?"* — and got, verbatim:
 *
 * > I looked on the estate's public shelf for **promote audiobook site**.
 * > Nothing on the estate's public shelf matches that. ⚠️ That's a statement
 * > about the **catalogue**, not about the house — books get catalogued as they
 * > are scanned…
 * > I can dig into the actual rows and put a change in front of you to approve
 * > here: https://padhard.heygabi.ai/
 *
 * **Reproduced exactly**, and the cause was routing, not the docs plumbing:
 * `classifyByKeyword` returns `question` for that sentence (no FIX pattern
 * matches it), and the `question` branch *unconditionally* runs a public-shelf
 * lookup, grounds the model on the miss, and falls back to **that miss plus the
 * FIXER panel link** when the model turn yields no text. So a runbook question
 * was answered as a book question — a statement about the catalogue in reply to
 * something that was never about the catalogue, which is the precise wording
 * failure `/have` exists to prevent — and whether any docs tool was consulted
 * at all was left entirely to the model.
 *
 * ⚠️ **Offering the tools is not the same as routing to them.** That was the
 * design error: phase 4 made the docs tools *available* on `question` turns and
 * assumed a model would reach for them. This makes the reach deterministic for
 * the questions that are unambiguously operational, exactly as `delegated.ts`
 * makes an ISBN deterministic rather than trusting a model to notice one.
 *
 * ## The shape of the rule
 *
 * An **operations vocabulary**, split by how ambiguous each term is in a
 * household that mostly talks about books:
 *
 *  - **STRONG** terms fire on their own. Nobody DMs a librarian about
 *    "wrangler" or "the rollback procedure" meaning a novel.
 *  - **WEAK** terms fire only alongside an operational question SHAPE, because
 *    each of them is also a book. ⚠️ `secret` is the worked example: *The Secret
 *    History*, *The Secret Garden*. `token`, `gate`, `worker`, `backup` and
 *    `config` are the same class of trap.
 *
 * ⚠️ A WEAK term additionally loses to a shelf-shaped question, so *"do we have
 * The Secret History"* stays a book lookup. A STRONG term wins even then,
 * because *"do we have a runbook for promoting?"* is a docs question wearing a
 * shelf question's grammar.
 */

/** ⚠️ Unambiguous here. Each of these was chosen because it appears in this
 *  estate's runbooks and does not appear in its catalogue. */
const DOCS_STRONG = [
  /\bpromot(e|ing|ion)\b/i,
  /\bdeploy(s|ed|ing|ment)?\b/i,
  /\broll\s*backs?\b/i,
  /\broll(ing)?\s+(it|this|that|them)?\s*back\b/i,
  /\brunbooks?\b/i,
  /\bwrangler\b/i,
  /\bcloudflare\b/i,
  /\bbreak[-\s]?glass\b/i,
  /\bmigrat(e|ion|ions)\b/i,
  /\bkill[-\s]?switch\b/i,
  /\bdev\s?ops\b/i,
  /\bcron\b/i,
  /\bscheduled task\b/i,
  /\br2 bucket\b/i,
  /\bkv namespace\b/i,
  /\bfirestore rules\b/i,
  /\bd1\b/i,
  /\bestate docs\b/i,
  /\/admin\b/i,
  /\/dev\/\b/i,
  /\bdev lane\b/i,
  /\bgithub actions?\b/i,
  /\bworkflow file\b/i,
  /\bprod(uction)?\b/i,
  /\brevocation\b/i,
  /\brotate (the )?(secret|token|key)\b/i,
  /\benv(ironment)? var(iable)?s?\b/i,
  /\bpipelines?\b/i,
  /\bsnapshots?\b/i,
];

/** ⚠️ Also book words. These need an operational question shape AND must lose
 *  to a shelf-shaped question. */
const DOCS_WEAK = [
  /\bsecrets?\b/i,
  /\btokens?\b/i,
  /\bgates?\b/i,
  /\bworkers?\b/i,
  /\bbackups?\b/i,
  /\brestore\b/i,
  /\bconfig(uration)?\b/i,
  /\bdocs?\b/i,
  /\barchitecture\b/i,
];

/** The grammar of somebody asking how a THING IS DONE, rather than what a book
 *  is. ⚠️ Deliberately excludes "how many", which is a catalogue count. */
const DOCS_SHAPE = [
  /\bhow (do|can|would|should) (i|we|you)\b/i,
  /\bhow does .*\bwork\b/i,
  /\bhow is .*\b(set up|configured|deployed|wired)\b/i,
  /\bwhat('s| is| are) the (process|procedure|steps?|command|way|lever)/i,
  /\bwhere (is|are|do|does|should) /i,
  /\bwhich .*\b(do|does) (i|we) need\b/i,
  /\bwhy (did|do) we\b/i,
  /\bsteps? to\b/i,
  /\bhow to\b/i,
];

/** A question about the SHELF. ⚠️ Kept local rather than imported from
 *  `mentions.ts`: the docs detector owns its own exclusions, and a shared list
 *  would make one feature's tuning silently move the other's boundary. */
const DOCS_SHELF_SHAPED = [
  /\bdo (we|you|i) (have|own)\b/i,
  /\bhave (we|you|i) got\b/i,
  /\bon the (shelf|shelves)\b/i,
  /\bin the (catalogue|catalog|library|collection)\b/i,
  /\b(narrat|author|series|audiobook|paperback|hardcover)/i,
];

/**
 * Does this message want the estate's DOCUMENTATION rather than its catalogue?
 *
 * ⚠️ **Narrow on purpose.** A false positive answers a book question with "the
 * docs do not cover it", which is worse than the miss it replaces. A false
 * negative merely leaves the model to reach for the tools itself, which is the
 * pre-fix behaviour and is still available — the tools stay offered on ordinary
 * `question` turns either way.
 */
export function docsIntent(text: string): boolean {
  const q = (text ?? '').trim();
  if (!q) return false;
  if (DOCS_STRONG.some((re) => re.test(q))) return true;
  if (DOCS_SHELF_SHAPED.some((re) => re.test(q))) return false;
  return DOCS_WEAK.some((re) => re.test(q)) && DOCS_SHAPE.some((re) => re.test(q));
}

// ---------------------------------------------------------------------------
// The caps — design §5.3. Each is its own fuse; none replaces another.
// ---------------------------------------------------------------------------

/**
 * ⚠️ **A DOCS TURN IS ROUGHLY AN ORDER OF MAGNITUDE HEAVIER THAN AN ORDINARY
 * GABI TURN, WHICH IS WHY THESE EXIST AT ALL.** Continuity clips remembered
 * messages at 600 characters and a full window is ≈3k input tokens
 * (`gabi-conversation-continuity.md`). A docs answer carries retrieved
 * *documentation*. Reusing the existing 20/hour + 200/day fuses unchanged would
 * let this feature quietly cost 10× the whole rest of GABI.
 */

/** Hits one search may return. ⚠️ The AUTH WORKER's default (8) — the browser
 *  page may ask for up to 25 because a person scrolls; a model does not. */
export const DOCS_SEARCH_HITS = 8;

/**
 * ⚠️ **THE PER-TURN RETRIEVAL CEILING — 24 KB and at most 4 sections.**
 *
 * ≈6k input tokens at bytes÷4. This is the fuse that actually bounds a turn's
 * cost, because the iteration cap alone does not: one assistant turn may emit
 * several `tool_use` blocks at once, and four parallel 8 KB section reads is a
 * perfectly reasonable thing for a model to try.
 *
 * ⚠️ Counted across the WHOLE turn, not per call — a budget that reset between
 * tool-loop iterations would not be a budget.
 */
export const DOCS_BYTES_PER_TURN = 24 * 1024;
export const DOCS_SECTIONS_PER_TURN = 4;

/**
 * ⚠️ **THE THIRD FUSE — docs turns per person per UTC day.** Deliberately its
 * own counter in its own key namespace, exactly as the Tier-1 write cap is:
 * the three protect different things over different horizons. A turn is
 * fractions of a cent and forgiven in an hour; a docs turn is ~6k input tokens
 * of retrieved runbook; a write is a row in somebody's catalog. One shared
 * counter would make forty answers cost the docs budget or make forty docs
 * questions cheap — both wrong.
 *
 * ⚠️ It is ADDITIONAL to the existing 20/hour and 200/day, never a replacement.
 * A docs turn burns one of each.
 */
export const DOCS_TURNS_PER_DAY = 40;

export type DocsCapVerdict = { ok: true } | { ok: false; message: string };

export function docsCapDecision(turnsToday: number): DocsCapVerdict {
  if (turnsToday >= DOCS_TURNS_PER_DAY) return { ok: false, message: DOCS_MSG.capped };
  return { ok: true };
}

/**
 * ⚠️ **THE PER-TURN BUDGET, as an object rather than two loose counters.**
 *
 * Constructed once per turn and threaded into the tool context, so every tool
 * call in the loop draws on the same pool. `take()` is called BEFORE a result
 * is handed to the model, and a refusal is worded rather than silent — a tool
 * that quietly returned nothing would teach the model that "the budget ran out"
 * and "the corpus has nothing" are the same fact, which is the same defect
 * `tool-exec.ts`'s header names about outages.
 */
export interface DocsBudget {
  /** Ask for room. Returns false when the turn has spent its ceiling. */
  take(bytes: number, sections: number): boolean;
  /** What has been spent — the two numbers `gabi_turn` records. */
  spent(): { bytes: number; sections: number };
  /** Whether this turn touched the corpus at all — what decides if the daily
   *  fuse is charged. A turn where she never reached for docs is not a docs
   *  turn, and charging it would make the fuse lie. */
  used(): boolean;
}

export function makeDocsBudget(): DocsBudget {
  let bytes = 0;
  let sections = 0;
  let calls = 0;
  return {
    take(b, s) {
      if (bytes + b > DOCS_BYTES_PER_TURN) return false;
      if (sections + s > DOCS_SECTIONS_PER_TURN) return false;
      bytes += b;
      sections += s;
      calls += 1;
      return true;
    },
    spent: () => ({ bytes, sections }),
    used: () => calls > 0,
  };
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/**
 * ⚠️ **A VERBATIM COPY OF THE AUTH WORKER'S `DOCS_REFUSALS`** (design §4.5).
 * That file is the source of record; `test/estate-docs.test.ts` reads it and
 * fails the build on any drift, so this is a mirrored allowlist rather than a
 * fork. Four causes, four sentences, because the FIXES differ — and the last
 * one is the one that gets mislabelled.
 */
export const DOCS_REFUSALS = {
  unauthenticated:
    "The estate docs are devops-only, so I need to know who you are first. Sign in and try again.",
  not_devops:
    "The estate docs are limited to devops-class members, and your account isn’t one. Ask an approver in /admin if you need it — that’s a deliberate line, not a glitch.",
  not_linked:
    "I can’t tell who you are on the estate yet — the docs are devops-only, so I need the link first. Run /link and try me again.",
  link_has_no_email:
    "Your link was made before I could check estate roles. Re-run /link once and I’ll be able to answer this.",
  estate_unreachable:
    "I couldn’t reach the estate to check your access — that’s a problem on our side, not your permissions. Try again in a minute.",
} as const;

/**
 * The sentences only THIS end can say. ⚠️ Everything about AUTHORITY is the
 * auth Worker's own wording, relayed verbatim — the same stance `delegated.ts`
 * takes toward the destination catalogs, and for the same reason: the authority
 * is the only thing that can honestly say *why*.
 */
export const DOCS_MSG = {
  /** Not linked / pre-upgrade link — ours, because only we read the document. */
  notLinked: DOCS_REFUSALS.not_linked,
  linkHasNoEmail: DOCS_REFUSALS.link_has_no_email,
  /** ⚠️ An outage, worded as an outage. The auth Worker cannot word its own
   *  silence, and calling this a permission failure sends the owner hunting for
   *  a grant he already holds. */
  estateUnreachable: DOCS_REFUSALS.estate_unreachable,

  switchedOff:
    "Reading the estate docs from Discord is switched off at the moment. That's a lever on our side " +
    'rather than anything to do with your account — the docs are still at https://heygabi.ai/docs/ ' +
    'if you can get to a browser, and I can still look books up from here.',

  notConfigured:
    "I'm not wired up to read the estate docs yet — that's a setup step on our side, not a " +
    'permissions problem. I can still look books up.',

  capped:
    "I've been through a lot of the docs for you today, so I'm going to stop there — that's a cap on " +
    'my side, not anything you did. It resets overnight, and https://heygabi.ai/docs/ has no such cap.',

  /**
   * ⚠️ **The fallback when the docs path produced no sentence** — the model
   * turn failed, or ran out of output tokens mid-thought.
   *
   * It exists because the OLD fallback for this shape of question was a
   * public-shelf miss plus the fixer panel link, which is what the owner
   * actually received on 2026-08-18. A docs question that goes wrong must fail
   * as a DOCS question: never a statement about the book catalogue, and never
   * an offer to put a catalogue change in front of him.
   */
  noAnswer:
    "I went looking in the estate's docs and couldn't put an answer together just then — that's a " +
    'wobble on my side, not a sign the docs are missing it. Ask me again, or narrow it down a bit ' +
    'and I will have another go.',

  /** ⚠️ The per-turn ceiling, worded for the MODEL to relay. It must be able to
   *  tell the person it ran out of room rather than implying the corpus did. */
  turnBudgetSpent:
    'I have already pulled as much documentation as I can carry in one answer. Say what you want ' +
    'me to dig into and I will go again with a fresh budget.',
} as const;

/**
 * ⚠️ **THE SENTENCE THAT MAKES A STALE SNAPSHOT VISIBLE (design §6).**
 *
 * Every answer carries the publish date. That is not a footer she sometimes
 * remembers — it is part of the tool RESULT, so dropping it is a visible defect
 * rather than an invisible one. The publisher rides the 8-hourly audiobook
 * pipeline and that pipeline can be paused, disabled or exit early on a quiet
 * cycle; when it does, the corpus silently stops refreshing and **the reply is
 * the only place anybody would notice.**
 *
 * The auth Worker computes `stale` and the worded `warning` against its own
 * clock and we relay them; recomputing staleness here would be a second
 * implementation of a fact that already has one.
 */
export interface DocsSnapshotMeta {
  generated_at?: unknown;
  age_hours?: unknown;
  stale?: unknown;
  files?: unknown;
  sections?: unknown;
  warning?: unknown;
}

export function snapshotNote(snapshot: DocsSnapshotMeta | null | undefined): string {
  const at = typeof snapshot?.generated_at === 'string' ? snapshot.generated_at : null;
  if (!at) {
    // ⚠️ Absence of a date is itself reportable. Answering with no date at all
    // would be the one outcome §6 exists to prevent.
    return 'I could not tell how old this docs snapshot is — say so rather than implying it is current.';
  }
  const date = at.slice(0, 10);
  const warning = typeof snapshot?.warning === 'string' ? snapshot.warning : null;
  return warning
    ? `${warning} Say this out loud — do not present the answer as current.`
    : `This comes from the estate docs snapshot published ${date}. Say that date in your answer; ` +
        'anything written since then is not in it.';
}

// ---------------------------------------------------------------------------
// The wire — an interface, and that is the credential seam
// ---------------------------------------------------------------------------

/** Why a Discord account has no usable estate identity. Three reasons, three
 *  sentences, because the fixes differ — `unlinked` runs /link, `no_email`
 *  re-runs it, `outage` waits a minute. ⚠️ Collapsing them is how "the estate
 *  is down" becomes "you never linked". */
export type DocsIdentityFailure = 'unlinked' | 'no_email' | 'outage';

/** One call's outcome. ⚠️ `ok:false` ALWAYS carries a `message` — the sentence
 *  she relays. `status: 0` means the auth Worker could not be reached at all. */
export interface DocsCallResult {
  ok: boolean;
  status: number;
  /** The parsed body on success; `null` when there was nothing readable. */
  body: Record<string, unknown> | null;
  /** Present whenever `ok` is false. Never a bare status. */
  message?: string;
}

/**
 * Everything the docs tools need from the outside world.
 *
 * ⚠️ **An interface rather than an import, and that is the credential seam** —
 * the same one `DelegatePort` established. `tool-exec.ts`, `gabi-chat.ts` and
 * `mention-flow.ts` can call these; they cannot construct one, cannot reach a
 * service account or an app token through one, and name no secret.
 * `test/estate-docs.test.ts` reads those sources and fails the build if that
 * stops being true.
 */
export interface DocsPort {
  /**
   * Who is asking, on the estate. ⚠️ Memoised per port instance (one per
   * message), so a turn that makes four docs tool calls still reads the link
   * document once.
   */
  askerEmail(
    discordUserId: string,
  ): Promise<{ ok: true; email: string } | { ok: false; reason: DocsIdentityFailure }>;
  /** Ask the corpus. The auth Worker decides whether this email may read it. */
  search(email: string, query: string, limit: number): Promise<DocsCallResult>;
  section(email: string, id: string): Promise<DocsCallResult>;
}

/** The identity failure, as the sentence she says. */
export function identityMessage(reason: DocsIdentityFailure): string {
  switch (reason) {
    case 'unlinked':
      return DOCS_MSG.notLinked;
    case 'no_email':
      return DOCS_MSG.linkHasNoEmail;
    case 'outage':
      return DOCS_MSG.estateUnreachable;
  }
}

/**
 * What the tool layer is handed for one turn. ⚠️ Assembled by `mention-flow.ts`
 * per turn — the port is shared, the BUDGET is not, and the asker is fixed for
 * the turn so no tool call can ask on somebody else's behalf.
 */
export interface DocsToolContext {
  port: DocsPort;
  discordUserId: string;
  budget: DocsBudget;
  /** ⚠️ The daily fuse, read ONCE before the turn rather than per tool call.
   *  A capped person still gets the tools offered and a worded refusal from the
   *  executor — withholding the tools would make her answer a docs question
   *  from general knowledge, which is the one thing this feature must not do. */
  capped: boolean;
}
