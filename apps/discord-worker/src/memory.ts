/**
 * **GABI REMEMBERS YOU — tier 2's contract** (`docs/info/gabi-memory-design.md`).
 *
 * Owner ask, verbatim (2026-08-18): *"i think we need to reconsider her memory,
 * do we need to save gabi's memory somewhere else for conversations so its not a
 * fresh bot to talk to each time, I think context is what makes a bot more
 * useful but we also dont want to blow scope."*
 *
 * Both halves of that sentence are in this file: the profile exists so she is
 * not a fresh bot, and **every constant here is the scope fence**.
 *
 * This file is the whole contract and **holds no credential** — the fourth
 * application of the seam `delegated.ts`, `estate-docs.ts` and
 * `book-knowledge.ts` established. `memory-exec.ts` is the only module here that
 * touches a secret, and it arrives as an injected port this file cannot build.
 *
 * ## ⚠️ THE TWO RULES THAT MAKE A DURABLE MEMORY SAFE
 *
 * 1. **A profile is what somebody SAID, never what was looked up.** It is
 *    colour, never evidence. Availability ("what have you read?") and spoiler
 *    scope are re-derived from a call in the turn that needs them — every turn,
 *    exactly as they are today.
 * 2. **A remembered wrong claim is worse than a fresh one.** It is wrong every
 *    turn instead of once, and it looks more authoritative for having been
 *    remembered. That is why `DISTILL_SYSTEM` forbids availability claims from
 *    entering a profile at all, rather than trusting them to be caught later.
 */

import type { Env } from './env.js';

// ---------------------------------------------------------------------------
// The posture
// ---------------------------------------------------------------------------

/**
 * ⚠️ **AFFIRMATIVE-ONLY**, the idiom of `mentionsOn`, `docsOn` and `booksOn`.
 * `"on"` and nothing else.
 *
 * ⚠️ **IT SHIPS OFF.** A feature that writes down what people say about
 * themselves is not one to enable as a side effect of a deploy — design §9 owner
 * step 1, and the `GABI_BOOKS` precedent.
 *
 * ⚠️ OFF means she is exactly the bot she was yesterday: the 30-minute window
 * still works, nothing is written, nothing is read, and no prompt changes.
 * Unlike the books posture there is no "switched off" sentence to say, because
 * nobody asks a question that only memory could answer — they simply notice she
 * does not remember, which is the pre-feature behaviour.
 */
export function memoryOn(env: Pick<Env, 'GABI_MEMORY'>): boolean {
  return (env.GABI_MEMORY ?? '').trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// The shape, and the caps that ARE the shape
// ---------------------------------------------------------------------------

/** ⚠️ Bump when the stored shape changes incompatibly. A profile whose `v` this
 *  code does not understand is IGNORED, not migrated in place — see
 *  `parseProfile`. Forgetting is an acceptable failure; corrupting is not. */
export const PROFILE_SHAPE_VERSION = 1;

/**
 * ⚠️ **2 KB, AND THIS IS THE NUMBER THE WHOLE TIER IS PRICED BY.**
 *
 * ≈500 input tokens at bytes÷4, on EVERY turn of every conversation for ever.
 * It is the only new continuously-paid cost in the design, and a profile allowed
 * to grow would quietly become a second verbatim window — the exact thing tier 1
 * is capped to prevent.
 */
export const PROFILE_MAX_BYTES = 2048;

export const PROFILE_MAX_NOTES = 6;
export const PROFILE_NOTE_CHARS = 120;
export const PROFILE_MAX_READING = 8;
export const PROFILE_MAX_THREADS = 5;
export const PROFILE_CALL_ME_CHARS = 40;

/**
 * ⚠️ **A SOFT CLAIM, AND THE PROVENANCE FIELDS ARE WHY IT IS SAFE.**
 *
 * `said` is what the PERSON said, and `at` is when. Neither is a position store
 * and neither may act like one — see the header rule 1 and design §3.4. When
 * `readingPositions/{uid}_{bookId}` is consulted for a real position, it
 * SUPERSEDES this without a merge rule, because this was never claiming to be
 * the same kind of fact.
 */
export interface ProfileReading {
  book: string;
  said: string;
  at: number;
}

export interface ProfileThread {
  what: string;
  at: number;
}

export interface MemoryProfile {
  v: number;
  person: string;
  callMe?: string;
  notes: string[];
  reading: ProfileReading[];
  threads: ProfileThread[];
  updatedAt: number;
  /** How many conversations have fed this. Shown to the person, so they can see
   *  it is built from many small distillations rather than one guess. */
  sources: number;
}

export function emptyProfile(person: string, now: number = Date.now()): MemoryProfile {
  return { v: PROFILE_SHAPE_VERSION, person, notes: [], reading: [], threads: [], updatedAt: now, sources: 0 };
}

const clip = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/**
 * ⚠️ **THE CAPS ARE ENFORCED BY DROPPING OLDEST-FIRST, NEVER BY TRUNCATING A
 * DOCUMENT MID-VALUE** (design §3.2).
 *
 * A half-written preference — *"prefers full stat sh"* — is worse than no
 * preference: it is unreadable to a model, it is invisible to a reviewer
 * skimming a profile, and it will be acted on anyway. Whole entries go or they
 * stay.
 *
 * ⚠️ The byte ceiling is applied LAST and by the same rule, because the per-list
 * caps alone do not bound the document: six 120-character notes plus eight books
 * plus five threads can still exceed 2 KB once keys and JSON punctuation are
 * counted.
 */
export function capProfile(profile: MemoryProfile): MemoryProfile {
  const capped: MemoryProfile = {
    v: PROFILE_SHAPE_VERSION,
    person: profile.person,
    ...(profile.callMe ? { callMe: clip(profile.callMe, PROFILE_CALL_ME_CHARS) } : {}),
    notes: profile.notes.map((n) => clip(n, PROFILE_NOTE_CHARS)).filter(Boolean).slice(-PROFILE_MAX_NOTES),
    reading: profile.reading.slice(-PROFILE_MAX_READING),
    threads: profile.threads.slice(-PROFILE_MAX_THREADS),
    updatedAt: profile.updatedAt,
    sources: profile.sources,
  };
  // ⚠️ Drop whole entries, cheapest-signal first, until it fits. `notes` is the
  // last to go because a preference is the thing the owner actually asked for
  // ("wants full sheets, no permission questions").
  while (profileBytes(capped) > PROFILE_MAX_BYTES && capped.threads.length > 0) capped.threads.shift();
  while (profileBytes(capped) > PROFILE_MAX_BYTES && capped.reading.length > 0) capped.reading.shift();
  while (profileBytes(capped) > PROFILE_MAX_BYTES && capped.notes.length > 0) capped.notes.shift();
  return capped;
}

export function profileBytes(profile: MemoryProfile): number {
  return JSON.stringify(profile).length;
}

/** True when there is genuinely nothing to say about this person yet. ⚠️ An
 *  empty profile is a CORRECT profile and must never be injected — a prompt
 *  block saying "here is what you know: nothing" spends tokens teaching her she
 *  is ignorant. */
export function profileIsEmpty(profile: MemoryProfile | null): boolean {
  if (!profile) return true;
  return !profile.callMe && profile.notes.length === 0 && profile.reading.length === 0 && profile.threads.length === 0;
}

/**
 * Parse a stored or model-produced profile. ⚠️ **Returns `null` on anything it
 * does not fully understand**, including a `v` from the future — and the caller
 * treats `null` as "keep what you had". Forgetting is acceptable; corrupting is
 * not, and a memory feature that half-parses is a memory feature that invents.
 */
export function parseProfile(raw: unknown, person: string, now: number = Date.now()): MemoryProfile | null {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  // ⚠️ A version we do not know is not a version we may guess at.
  if (o.v !== undefined && o.v !== PROFILE_SHAPE_VERSION) return null;

  const notes = Array.isArray(o.notes) ? o.notes.map((n) => clip(n, PROFILE_NOTE_CHARS)).filter(Boolean) : [];
  const reading = Array.isArray(o.reading)
    ? o.reading
        .map((r) => {
          const x = (r ?? {}) as Record<string, unknown>;
          const book = clip(x.book, 120);
          const said = clip(x.said, 80);
          if (!book || !said) return null;
          return { book, said, at: typeof x.at === 'number' ? x.at : now };
        })
        .filter((x): x is ProfileReading => x !== null)
    : [];
  const threads = Array.isArray(o.threads)
    ? o.threads
        .map((t) => {
          const x = (t ?? {}) as Record<string, unknown>;
          const what = clip(x.what, 160);
          if (!what) return null;
          return { what, at: typeof x.at === 'number' ? x.at : now };
        })
        .filter((x): x is ProfileThread => x !== null)
    : [];

  return capProfile({
    v: PROFILE_SHAPE_VERSION,
    person,
    ...(clip(o.callMe, PROFILE_CALL_ME_CHARS) ? { callMe: clip(o.callMe, PROFILE_CALL_ME_CHARS) } : {}),
    notes,
    reading,
    threads,
    updatedAt: now,
    sources: typeof o.sources === 'number' && o.sources >= 0 ? Math.floor(o.sources) : 0,
  });
}

// ---------------------------------------------------------------------------
// ⚠️ WHO a profile belongs to
// ---------------------------------------------------------------------------

/**
 * ⚠️ **PER-PERSON GLOBAL — one profile across DM, every channel and the site
 * panel.** A profile that reset per channel would be tier 1 with extra steps,
 * and the owner asked for the opposite.
 *
 * ⚠️ **The estate EMAIL is the key where a link exists**, because that is the
 * key the panel and the estate directory share — the same chain the docs and
 * book lanes use. A Discord snowflake is the fallback for somebody who has never
 * run `/link`, and the two are namespaced apart so they can never collide.
 *
 * ⚠️ Merging an unlinked profile into a linked one when somebody links later is
 * a MIGRATION, not an edit (a function that produces a persisted key), and it is
 * deliberately phase 4 — the riskiest piece, because two people sharing one
 * profile comes from a wrong key rather than a wrong merge.
 */
export function personKey(who: { email?: string | null; discordUserId?: string | null }): string | null {
  const email = (who.email ?? '').trim().toLowerCase();
  if (email.length >= 3 && email.includes('@')) return `estate:${email}`;
  const id = (who.discordUserId ?? '').trim();
  return id ? `discord:${id}` : null;
}

// ---------------------------------------------------------------------------
// What the model is told
// ---------------------------------------------------------------------------

/**
 * The block appended to the system prompt when a profile exists.
 *
 * ⚠️ **The second bullet is the entire safety story of tier 2**, and it is the
 * 2026-08-18 confabulation rule (book design §10d) extended to a durable
 * substrate. She already contradicted herself across two adjacent turns about
 * what she had read; a profile is that same claim given somewhere permanent to
 * live.
 */
export function profilePromptBlock(profile: MemoryProfile): string {
  const lines: string[] = [];
  if (profile.callMe) lines.push(`They go by ${profile.callMe}.`);
  for (const n of profile.notes) lines.push(`- ${n}`);
  for (const r of profile.reading) lines.push(`- On ${r.book}, they said: ${r.said}`);
  for (const t of profile.threads) lines.push(`- Left open: ${t.what}`);
  return `
What you already know about the person you are talking to, from earlier conversations. They can see this and clear it at any time.
${lines.join('\n')}

- Use it so you do not ask what they have already told you, and so you can pick up where you left off.
- ⚠️ This is a memory of what they SAID, not a fact you checked. Never state anything from here as verified, and never let it decide what you have or have not read — a listing call in THIS turn decides that, always.
- ⚠️ Never let it decide how far into a book they are for spoiler purposes. That comes from the sentence in front of you, every turn, and from nothing else.`;
}

/**
 * ⚠️ **THE DISTILLATION PROMPT. Every rule in it is a failure this estate has
 * already had.**
 *
 *  1. **Only this person** — she can quote a channel-mate in her own reply, and
 *     that must not become a fact about the asker. (Cross-contamination is
 *     impossible structurally, since the conversation key includes the author;
 *     this covers the one hole that leaves.)
 *  2. **Preferences, not content** — the stat sheet belongs to tier 3.
 *  3. ⚠️ **No availability claims** — *"she has read up to book 9"* in a durable
 *     profile is the 2026-08-18 confabulation with a permanent home.
 *  4. **Drop, do not guess** — an empty profile is a correct profile.
 */
export const DISTILL_SYSTEM = `You are updating a short, durable note-to-self about ONE person, so that next time they talk to you it is not like meeting them for the first time.

You will be given the current note (may be empty) and the transcript of one conversation that has just ended. Return the WHOLE updated note as JSON and nothing else — no prose, no code fence.

Shape:
{"callMe": "<what they go by, or omit>",
 "notes": ["<a durable preference or fact ABOUT THEM, <=120 chars>"],
 "reading": [{"book":"<title>","said":"<what THEY said about where they are>"}],
 "threads": [{"what":"<something left unfinished that they would want picked up>"}]}

Rules — each of these has been got wrong before:
1. ONLY this person. The transcript may mention other people; nothing about anybody else goes in this note, ever.
2. PREFERENCES AND STANDING FACTS, not content. "Wants the full stat sheet, no permission questions" belongs here. The stat sheet itself does not.
3. ⚠️ NEVER record what YOU have or have not read, or how far through a series your knowledge goes. That is looked up fresh every time and a remembered version of it would be wrong for ever. Nothing about your own knowledge base goes in this note.
4. Keep what is still true, drop what is stale, and prefer dropping to guessing. An empty note is a correct note.
5. Be brief. Six notes at most, and short ones. This is read on every single turn.`;

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

export const MEMORY_MSG = {
  /** ⚠️ Shown when a person asks what she knows and there is nothing yet. It has
   *  to be reassuring rather than sound broken — the honest state on day one. */
  none:
    "I haven't written anything down about you yet. I keep a short note between conversations so I'm " +
    'not starting from scratch every time; it fills in as we talk.',

  /** ⚠️ It names the OTHER thing that still exists, and how to clear it. A
   *  narrow delete that lets somebody believe it was a wide one is the trap the
   *  four-verb split exists to avoid — the caution only works if it is said. */
  cleared:
    "Done — I've forgotten all of that. The note is empty again.\n\n" +
    "One thing worth knowing: I also keep the conversations themselves for 90 days, and that's " +
    "separate from the note. Say **forget my history** and I'll delete those too.",

  /** ⚠️ The same clear where the archive is NOT live. It must not mention a
   *  90-day store she cannot reach — a disclosure that is also a lie is worse
   *  than no disclosure. */
  clearedNoArchive: "Done — I've forgotten all of that. The note is empty again.",

  /** Somebody asked to clear a history that is not being kept. Reassuring and
   *  TRUE: there is nothing to delete because nothing is stored. */
  historyNotKept:
    "There's nothing to delete — I'm not keeping our past conversations at the moment, only the " +
    'last half hour while we are talking, and that goes on its own.',

  /** ⚠️ The note went and the archive delete FAILED. Says exactly which half
   *  happened; "done" here would be a lie about the more sensitive half. */
  bothPartial:
    "The note about you is cleared. ⚠️ I could NOT delete our saved conversations just then — the " +
    "store didn't answer, so those are still there. Say **forget my history** again in a minute " +
    'and I will finish the job.',

  /** Cleared the archive, kept the note. Says the count, because "done" over an
   *  unknown quantity is not something anybody can check. */
  historyCleared: (deleted: number) =>
    deleted === 0
      ? "There was nothing stored — I have no saved conversations for you to delete. Nothing has " +
        'been kept.'
      : `Done — I've deleted ${deleted} saved message${deleted === 1 ? '' : 's'} of ours. They're ` +
        "gone, not hidden.\n\nThe short note I keep about you is separate and is still there; say " +
        '**forget what you know about me** if you want that gone as well.',

  /** ⚠️ THE BOUND WAS HIT. Said plainly rather than rounded up to "done" —
   *  somebody who asked to be forgotten is owed the truth about how much of them
   *  is actually gone, and telling them it finished when it did not is the worst
   *  lie this feature could tell. */
  historyPartlyCleared: (deleted: number) =>
    `I've deleted ${deleted} of our saved messages, but there were more than I can remove in one ` +
    "go and I'd rather say so than let you think it's all gone. Ask me again and I'll carry on " +
    'from where I stopped.',

  /** ⚠️ Said when a DELETE FAILED on the archive. Same rule as `trouble`: never
   *  a cheerful confirmation over a delete that did not happen. */
  historyTrouble:
    "I couldn't delete those just now — the store didn't answer, so nothing has been removed. " +
    "Please try again in a minute rather than assuming it's gone.",

  bothCleared: (deleted: number) =>
    `Done — the note about you is empty and ${deleted} saved message${deleted === 1 ? '' : 's'} ` +
    "of ours have been deleted. That's everything I keep.",

  /** ⚠️ Shown at the end of a profile so nobody learns about a 90-day archive
   *  from somewhere other than her. A store somebody cannot see is a dossier,
   *  and that rule does not stop applying at tier 2. */
  archiveNote:
    "_I also keep our conversations themselves for 90 days, so I can look back if you ask me what " +
    'we talked about. Say **forget my history** to delete those, or **forget what you know about ' +
    'me** for the note above._',

  /** The same fact for somebody whose note is empty — they still have an archive
   *  and are still owed the disclosure. */
  archiveNoteOnly:
    "I haven't written anything down about you yet. I do keep our conversations themselves for 90 " +
    'days, so I can look back if you ask what we talked about — say **forget my history** to ' +
    'delete those.',

  /** ⚠️ Said when a DELETE FAILED. A cheerful "done!" over a failed delete is
   *  the worst possible lie this feature could tell: somebody asked to be
   *  forgotten and would walk away believing they had been. */
  trouble:
    "I couldn't clear that just now — something on our side didn't answer. Nothing has been " +
    'deleted, so please try again in a minute rather than assuming it is gone.',

  /** ⚠️ The heading over a shown profile. It says WHERE it came from and that it
   *  is editable, because a profile somebody cannot see is a dossier. */
  heading:
    "Here's the short note I keep about you between conversations. It comes from what you've told " +
    'me — you can clear it any time with `/gabi memory forget`.',

  off:
    "I don't keep notes between conversations at the moment — that's a switch on our side. Within a " +
    'conversation I still remember what we just said.',
} as const;

/** How a profile is shown to the person who owns it. ⚠️ Plain sentences, not the
 *  stored JSON: somebody checking what she knows about them should not have to
 *  read a document shape to do it. */
export function profileForDisplay(
  profile: MemoryProfile | null,
  /** ⚠️ Whether the 90-day archive is live for this surface. When it is, the
   *  display SAYS SO — a person asking what she keeps about them must be told
   *  about both stores, not just the one that happens to be rendered. */
  archiveOn = false,
): string {
  if (profileIsEmpty(profile) || !profile) {
    return archiveOn ? MEMORY_MSG.archiveNoteOnly : MEMORY_MSG.none;
  }
  const lines: string[] = [MEMORY_MSG.heading, ''];
  if (profile.callMe) lines.push(`**You go by:** ${profile.callMe}`);
  if (profile.notes.length) {
    lines.push('**What I have noted:**');
    for (const n of profile.notes) lines.push(`• ${n}`);
  }
  if (profile.reading.length) {
    lines.push('**Reading:**');
    for (const r of profile.reading) lines.push(`• ${r.book} — you said: ${r.said}`);
  }
  if (profile.threads.length) {
    lines.push('**Left open:**');
    for (const t of profile.threads) lines.push(`• ${t.what}`);
  }
  lines.push('', `_From ${profile.sources} conversation${profile.sources === 1 ? '' : 's'}._`);
  if (archiveOn) lines.push('', MEMORY_MSG.archiveNote);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// ⚠️ SEEING AND CLEARING IT — a detector, not a slash command
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE TRANSPARENCY AFFORDANCE SHIPS WITH THE WRITING, NOT AFTER IT** — the
 * owner's requirement, and design §3.6. A profile somebody cannot see is a
 * dossier.
 *
 * It is a DETECTOR rather than a new slash command on purpose:
 *
 *  - `/gabi` already takes a free-text `question`, so `/gabi memory` needs no
 *    Discord command registration — which would be an owner step in the
 *    developer portal, and would make the see-it affordance land *after* the
 *    writing rather than with it;
 *  - it therefore works identically on every surface she has — a DM, an
 *    @mention in a channel, and `/gabi` — instead of only where a command was
 *    registered;
 *  - and it is deterministic, so *"forget what you know about me"* can never be
 *    answered by a model deciding it probably meant something else.
 *
 * ⚠️ **`forget` is checked BEFORE `show`.** *"forget what you remember about
 * me"* contains both; reading it as a request to display would be the worst
 * possible misreading of a privacy control.
 */
/**
 * ⚠️ **FOUR VERBS, BECAUSE THERE ARE NOW TWO DIFFERENT THINGS TO FORGET.**
 *
 * Tier 2 is a ≤2 KB NOTE distilled from what somebody said. Tier 3 is a 90-day
 * ARCHIVE of the turns themselves. They differ in kind, and a single "forget"
 * that cleared one while silently leaving the other is the failure this split
 * exists to prevent — in either direction:
 *
 * | verb | clears | typical phrasing |
 * |---|---|---|
 * | `forget` | ⚠️ the NOTE only | *"forget what you know about me"* |
 * | `forget_history` | ⚠️ the ARCHIVE only | *"forget my history"*, *"delete our conversations"* |
 * | `forget_all` | both | *"forget everything about me and our conversations"* |
 * | `show` | — | *"what do you know about me"* |
 *
 * ⚠️ **`forget` STAYS NOTE-ONLY, AND ITS CONFIRMATION NAMES THE OTHER LEVER.**
 * Widening the existing words to also wipe 90 days of conversation would delete
 * far more than the person asked for, using phrasings they had already learned
 * meant something smaller. Under-deleting is recoverable by saying one more
 * sentence; over-deleting is not recoverable at all. So the narrow reading wins
 * **and the answer tells them the wider one exists** — which is what stops the
 * caution becoming a trap.
 */
export type MemoryCommand = 'show' | 'forget' | 'forget_history' | 'forget_all' | null;

/** The words that mean the ARCHIVE rather than the note: a conversation, a
 *  history, a transcript — the record of what was SAID rather than what was
 *  concluded from it. */
const HISTORY_NOUN = /\b(history|conversations?|chats?|transcripts?|messages?|what we (talked|said|discussed))\b/i;

const MEMORY_FORGET_HISTORY = [
  /\b(forget|clear|delete|wipe|erase|drop)\b[^?]*\b(my|our|the)\b[^?]*\b(history|conversations?|chats?|transcripts?|messages?)\b/i,
  /\b(forget|clear|delete|wipe|erase)\b[^?]*\bwhat we (talked about|said|discussed)\b/i,
  /^\s*(?:\/gabi\s+)?memory\s+(forget|clear|delete|wipe)\s+(history|conversations?|chats?)\s*$/i,
];

/** ⚠️ Requires BOTH an everything-word AND a history-word. *"forget everything
 *  you know about me"* has been the NOTE verb since tier 2 shipped and stays it;
 *  promoting it to a 90-day wipe would silently widen a control people already
 *  use. Clearing both is available — it just has to be asked for. */
const MEMORY_FORGET_ALL = [
  /\b(forget|clear|delete|wipe|erase)\b[^?]*\b(everything|all of it|it all|the lot)\b[^?]*\b(history|conversations?|chats?|transcripts?|messages?)\b/i,
  /\b(forget|clear|delete|wipe|erase)\b[^?]*\b(everything|all)\b[^?]*\b(you (have|hold|keep|know))\b[^?]*\b(on|about) me\b[^?]*\b(history|conversations?|chats?)\b/i,
  /^\s*(?:\/gabi\s+)?memory\s+(forget|clear|delete|wipe)\s+(all|everything)\s*$/i,
];

const MEMORY_FORGET = [
  /\bforget (what|everything|all|it|me|that)\b/i,
  /\bforget\b[^?]*\b(about me|you know|you remember|my (profile|memory|notes?))\b/i,
  /\b(clear|delete|wipe|erase|reset)\b[^?]*\b(my|your)\b[^?]*\b(memory|profile|notes?|note)\b/i,
  /^\s*(?:\/gabi\s+)?memory\s+(forget|clear|delete|wipe|reset)\s*$/i,
];

const MEMORY_SHOW = [
  /^\s*(?:\/gabi\s+)?memory\s*$/i,
  /^\s*(?:\/gabi\s+)?memory\s+(show|what|list)\s*$/i,
  /\bwhat do you (know|remember)\b[^?]*\babout me\b/i,
  /\bwhat have you (written down|noted|remembered)\b[^?]*\b(about|on) me\b/i,
  /\b(show|see) (me )?(my|your) (profile|memory|notes?)\b/i,
  /\bwhat('s| is) in my (profile|memory)\b/i,
];

export function memoryCommand(text: string): MemoryCommand {
  const q = (text ?? '').trim();
  if (!q) return null;
  // ⚠️ WIDEST FIRST, THEN NARROWER, THEN SHOW.
  //
  // `forget_all` before `forget_history` before `forget`, because each later
  // pattern is a subset of the sentence the earlier one matches: "delete
  // everything you know about me and our conversations" satisfies all three, and
  // running them the other way round would clear the note and quietly leave the
  // 90 days somebody just asked to have deleted.
  //
  // ⚠️ And every forget is checked before SHOW, unchanged: "forget what you
  // remember about me" contains both, and reading a deletion request as a
  // request to display is the worst possible misreading of a privacy control.
  if (MEMORY_FORGET_ALL.some((re) => re.test(q))) return 'forget_all';
  if (MEMORY_FORGET_HISTORY.some((re) => re.test(q))) return 'forget_history';
  // ⚠️ A history NOUN with a forget verb goes to the archive even if the
  // note-shaped pattern also matches — "delete my memory of our chats" is about
  // the chats. The note-only reading is the DEFAULT, not the greedy one.
  if (MEMORY_FORGET.some((re) => re.test(q))) {
    return HISTORY_NOUN.test(q) ? 'forget_history' : 'forget';
  }
  if (MEMORY_SHOW.some((re) => re.test(q))) return 'show';
  return null;
}

// ---------------------------------------------------------------------------
// The wire — an interface, and that is the credential seam
// ---------------------------------------------------------------------------

/**
 * Everything tier 2 needs from the outside world.
 *
 * ⚠️ **An interface rather than an import, and that is the credential seam** —
 * the fourth application of it. `mention-flow.ts`, `gabi-chat.ts` and this file
 * can call these; they cannot construct one and name no secret.
 */
export interface MemoryPort {
  load(person: string): Promise<MemoryProfile | null>;
  save(profile: MemoryProfile): Promise<boolean>;
  /** ⚠️ DELETES. Not a flag, not a tombstone — "forget it" has to mean the row
   *  is gone, and there is a test that it is. */
  clear(person: string): Promise<boolean>;
}
