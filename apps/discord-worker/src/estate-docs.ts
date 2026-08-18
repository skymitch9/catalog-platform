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
