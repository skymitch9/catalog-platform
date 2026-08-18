/**
 * `@platform/gabi-conversation` — GABI's conversation substrate.
 *
 * ⚠️ **THE ONE IMPLEMENTATION.** Every surface GABI speaks through reads and
 * writes this record shape, applies these two window limits, and accounts for
 * the history with these numbers. Discord's gateway Durable Object was the
 * first consumer; the library site's chat panel is the second, and it reaches
 * this file through `library_catalog/scripts/sync-gabi-conversation.mjs` — the
 * same materialise-into-a-gitignored-`generated/` mechanism `@platform/estate-auth`
 * already uses, and for the same recorded reason: two repos once held two
 * copies of `auth.ts` and only one of them got a security hardening.
 *
 * **Pure.** No I/O, no Discord types, no Durable Object, no D1, no `fetch`.
 * That purity is the portability, and it is why this file could be lifted out
 * of `apps/discord-worker/src/conversation.ts` verbatim (2026-08-18) when the
 * second surface arrived. The Discord-only half — the `custom_id` vocabulary,
 * the select menu, the modal, the sentences she says — stayed behind in that
 * file, which now re-exports everything here so no importer changed.
 *
 * The owner's ask that started it, verbatim: *"I don't want to message GABI and
 * then message her again and she has no recollection."* And the constraint that
 * shaped the record, also his: *"whatever we build we need to consider for when
 * we update the chat button on GABI."*
 *
 * ## ⚠️ THE SURFACE-NEUTRAL / SURFACE-SPECIFIC SPLIT
 *
 * The split is mechanical rather than aspirational:
 *
 * | Surface-NEUTRAL — every surface reads and writes these | Surface-SPECIFIC |
 * |---|---|
 * | `v`, `updatedAt` | — |
 * | `key.surface` (an opaque label) | the label's *value* (`discord_dm`, `web_panel`…) |
 * | `key.space` (opaque string: "the room this happened in") | a Discord channel id / a catalog instance (`library`, `library2`) |
 * | `key.person` (opaque string: "who was talking") | a Discord user id / an `app_user` id |
 * | `turns[].role`, `turns[].text`, `turns[].at` | — |
 * | — | `turns[].ref` — an **opaque bag** the core NEVER reads |
 * | `pending.kind`, `pending.nonce`, `pending.question`, `pending.options[]` | — |
 *
 * ⚠️ **`space` and `person` are OPAQUE BY CONTRACT.** Nothing in this file or
 * any consumer may parse them, pattern-match them, or assume they are numeric.
 * A Discord snowflake and a library `app_user` id must be interchangeable here,
 * because that interchangeability is the entire portability claim. It is also
 * why the panel's D1 table has **no foreign key** on `person`: a foreign key is
 * a database that parses an opaque string.
 *
 * ⚠️ **`turns[].ref` is the ONLY place a surface may stash its own ids**, and
 * the core treats it as write-only. Discord puts `{message_id, guild_id}` there
 * so a turn can be linked back to the message that produced it; the panel puts
 * `{cid}` — the browser-minted conversation id — because that is what tells a
 * resumed tab which remembered turns it is already carrying. A reader **in the
 * core** that starts branching on `ref` has broken the contract; a reader in a
 * surface reading its own `ref` is exactly what the bag is for.
 *
 * ## ⚠️ AGED-OUT STATE IS DELETED, NOT ARCHIVED
 *
 * `pruneConversation()` returns **`null`** when a record has nothing left
 * inside its window, and every caller is required to answer that by DELETING
 * the key. There is no archive, no tombstone and no "expired" flag: the estate
 * keeps half an hour of what somebody said to a librarian in a chat window, and
 * then it is gone. That is a privacy posture, not an optimisation.
 *
 * ## The window, and why it is two limits rather than one
 *
 * A **30-minute sliding window** answers "is this still the same conversation?"
 * and a **20-turn (≈10 exchange) cap** answers "how much of it does the model
 * pay for?". They are different questions: a fast argument can produce forty
 * turns in ten minutes, and a slow one can produce four across an hour. One
 * limit alone gets the other case wrong.
 */

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

/** ⚠️ Bump this ONLY with a written migration note, and remember that a bump
 * now invalidates records on TWO surfaces at once. A reader that finds a
 * version it does not know must treat the record as absent (start fresh) rather
 * than guess at it — `pruneConversation()` does exactly that. */
export const CONVERSATION_SHAPE_VERSION = 1;

/**
 * ⚠️ A LABEL, not an enum the core switches on. Discord contributes two values
 * and the site panel contributes the third; a fourth surface needs no change
 * here. Anything that behaves differently per surface belongs in the caller,
 * not in the store.
 */
export const CONVERSATION_SURFACES = ['discord_channel', 'discord_dm', 'web_panel'] as const;
export type ConversationSurface = (typeof CONVERSATION_SURFACES)[number];

/**
 * The site chat panel's label.
 *
 * ⚠️ Named as a constant rather than spelled at each call site because it is
 * half of a storage key: a typo would not fail, it would silently give somebody
 * a second, empty memory. `docs/info/gabi-conversation-continuity.md` §1.3
 * wrote this value down before the panel existed; this is that promise kept.
 */
export const SURFACE_WEB_PANEL = 'web_panel';

/** Who was talking, and where. All three are opaque strings by contract. */
export interface ConversationKey {
  surface: string;
  space: string;
  person: string;
}

/** One thing that was said. ⚠️ `ref` is the surface's private bag. */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Epoch ms. The window is computed from this and nothing else. */
  at: number;
  ref?: Record<string, string>;
}

/** One option she offered when she had to ask a clarifying question. */
export interface PendingOption {
  /** What the person sees on the menu row. */
  label: string;
  /** The full rendering she answers with once it is chosen. */
  detail: string;
  /**
   * ⚠️ **`instance_pick` ONLY** — which catalog this row means (`library` /
   * `library2`). Absent on a `book_pick`, whose rows are books.
   *
   * It is stored rather than re-derived from the row's position, because the
   * offered set depends on where the person actually holds a role: a menu built
   * for somebody with one account and a menu built for somebody with two are
   * different menus, and an index into "the instances" would silently mean a
   * different shelf for a different person.
   */
  instance?: string;
}

/**
 * A clarifying question waiting for an answer.
 *
 * ⚠️ **`nonce` IS NOT A CAPABILITY, and that is a deliberate design choice.**
 * It is not signed and it is not secret, because it does not need to be: the
 * conversation key is recomputed from **who pressed the button and where**, so
 * a nonce lifted from somebody else's menu resolves to a *different* record
 * that has no such pending question. Nothing is transmitted that needs
 * protecting, so nothing is MAC'd — unlike `moderation.ts`'s confirm id, which
 * authorises a DELETION and therefore is.
 */
interface PendingBase {
  nonce: string;
  /** What she asked, so a resumed answer can restate it rather than assume. */
  question: string;
  options: PendingOption[];
  at: number;
}

/**
 * ⚠️ **TWO kinds, and the second one RESUMES AN ACTION rather than an answer**
 * (added 2026-08-18 with Tier 1).
 *
 * `book_pick` is the original: several books matched, she does not know which
 * was meant, and pressing a row makes her *say* something. Nothing is at stake
 * in a wrong press but a wrong sentence.
 *
 * `instance_pick` is *"your shelf or the main library?"*, offered only when the
 * asker holds the needed capability on **both** catalogs. Pressing a row makes
 * her **write** to that one. Two consequences, both deliberate:
 *
 *  1. **The verb and its ISBN are stored on the pending record**, not re-parsed
 *     from the conversation. The message that asked may have aged out of the
 *     window, and re-reading it later is how a press ends up performing a
 *     different request than the one it was offered for.
 *  2. **The stakes are still not a capability question**, so the nonce stays
 *     unsigned exactly as `PendingBase` describes: a press is resolved against
 *     the PRESSER's own conversation record, so somebody else clicking the same
 *     public menu finds no such pending question — and even if they did, the
 *     destination site checks *their* role before writing anything.
 *
 * ⚠️ The site panel writes **no** pending record today: its clarifying question
 * is prose in a chat box, not a component somebody presses, so there is nothing
 * to resume and nothing to age out. The field stays neutral rather than
 * Discord-only because a T2 confirm on the panel is the same shape.
 */
export type PendingChoice =
  | ({ kind: 'book_pick' } & PendingBase)
  | ({
      kind: 'instance_pick';
      /** ⚠️ Pinned to the delegated allowlist's names by the delegated flow. */
      verb: 'add-isbn' | 'run-details';
      /** Present for `add-isbn` and for nothing else. */
      isbn?: string;
    } & PendingBase);

export interface ConversationRecord {
  v: number;
  key: ConversationKey;
  turns: ConversationTurn[];
  updatedAt: number;
  pending?: PendingChoice | null;
}

// ---------------------------------------------------------------------------
// The limits
// ---------------------------------------------------------------------------

/** ⚠️ The sliding window. Thirty minutes after somebody's last word, the
 * conversation is over and the record is deleted. */
export const CONVERSATION_WINDOW_MS = 30 * 60 * 1000;

/** ~10 exchanges. A "turn" is one thing said by one side, so an exchange is
 * two — the owner's "last ~10 exchanges", stated in the unit the code counts. */
export const CONVERSATION_MAX_EXCHANGES = 10;
export const CONVERSATION_MAX_TURNS = CONVERSATION_MAX_EXCHANGES * 2;

/**
 * ⚠️ Per-turn character ceiling, and it is a SPEND control, not a display one.
 * Context tokens are charged on every turn of a conversation, so an unbounded
 * history makes turn 10 cost ten times turn 1 under a cap that never noticed.
 * 600 chars ≈ 150 tokens, so a full window is ≈3k input tokens — about a third
 * of a cent at Haiku 4.5's $1/MTok, and roughly a tenth of that as a cache read
 * on the panel's Opus 5. Bounded rather than trending, on both surfaces.
 */
export const CONVERSATION_TURN_CHARS = 600;

/** How long a clarifying question stays answerable. A select menu sitting in a
 * channel for hours describes a search nobody remembers running. Shorter than
 * the conversation window on purpose. */
export const PENDING_TTL_MS = 15 * 60 * 1000;

/** Discord's select menu allows 25; five is what a chat message can carry
 * without becoming a form. The overflow is COUNTED and stated, never dropped. */
export const MAX_CHOICE_OPTIONS = 5;

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export function conversationKey(surface: string, space: string, person: string): ConversationKey {
  return { surface, space, person };
}

/**
 * The storage key. ⚠️ Namespaced `conv:` so it cannot collide with the
 * gateway's session keys or the caps (`gw:`, `cap:`) in the same object — and
 * so a D1 table holding it reads as a conversation store at a glance.
 *
 * The three parts are joined with `:` and each is length-capped, so a
 * pathological id cannot push the key past a storage limit. Separators and
 * whitespace inside a part are replaced with `_` rather than escaped, which is
 * safe for the ids in use — a Discord snowflake is digits, an `app_user` id is
 * digits, and a surface label is a fixed constant.
 * ⚠️ A future surface whose `person` could contain a colon must hash it before
 * calling this — that is written here rather than discovered as two people
 * sharing one memory.
 */
export function conversationStorageKey(key: ConversationKey): string {
  const part = (s: string) => s.slice(0, 64).replace(/[:\s]/g, '_');
  return `conv:${part(key.surface)}:${part(key.space)}:${part(key.person)}`;
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

const isTurn = (v: unknown): v is ConversationTurn => {
  const t = v as ConversationTurn | null;
  return (
    !!t &&
    (t.role === 'user' || t.role === 'assistant') &&
    typeof t.text === 'string' &&
    typeof t.at === 'number' &&
    Number.isFinite(t.at)
  );
};

/** Clip one turn's text to the per-turn ceiling, marking the elision. */
export function clipTurnText(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= CONVERSATION_TURN_CHARS
    ? clean
    : `${clean.slice(0, CONVERSATION_TURN_CHARS - 1)}…`;
}

/**
 * Drop everything outside the window and everything past the turn cap.
 *
 * ⚠️ Returns **`null` when nothing is left**, and the caller MUST answer that
 * by deleting the key — "aged-out state is deleted, not archived" is the whole
 * privacy posture and it cannot be enforced from in here.
 *
 * An unreadable or wrong-version record is treated as absent for the same
 * reason: guessing at a shape you do not recognise is how one bad write becomes
 * a permanent wrong answer.
 */
export function pruneConversation(
  record: ConversationRecord | null | undefined,
  now: number,
): ConversationRecord | null {
  if (!record || record.v !== CONVERSATION_SHAPE_VERSION) return null;
  const floor = now - CONVERSATION_WINDOW_MS;
  const kept = (Array.isArray(record.turns) ? record.turns : [])
    .filter(isTurn)
    .filter((t) => t.at > floor)
    .slice(-CONVERSATION_MAX_TURNS);

  const pending =
    record.pending && typeof record.pending.at === 'number' && record.pending.at > now - PENDING_TTL_MS
      ? record.pending
      : null;

  if (kept.length === 0 && !pending) return null;
  return { v: record.v, key: record.key, turns: kept, updatedAt: record.updatedAt, pending };
}

/** Append what was just said and re-apply both limits. Pure — the caller
 * writes the result, or deletes the key when this returns `null`. */
export function appendTurns(
  record: ConversationRecord | null,
  key: ConversationKey,
  added: readonly ConversationTurn[],
  now: number,
  pending: PendingChoice | null = null,
): ConversationRecord | null {
  const base = pruneConversation(record, now);
  const turns = [...(base?.turns ?? []), ...added.filter(isTurn).map((t) => ({ ...t, text: clipTurnText(t.text) }))]
    .filter((t) => t.text.length > 0)
    .slice(-CONVERSATION_MAX_TURNS);
  if (turns.length === 0 && !pending) return null;
  return { v: CONVERSATION_SHAPE_VERSION, key, turns, updatedAt: now, pending };
}

/** Total characters a history would contribute to a prompt. Logged beside the
 * token counts so continuity's share of the spend is MEASURED, not assumed. */
export function conversationChars(turns: readonly ConversationTurn[]): number {
  return turns.reduce((n, t) => n + t.text.length, 0);
}

// ---------------------------------------------------------------------------
// Turning a stored transcript into a prompt
// ---------------------------------------------------------------------------

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * ⚠️ **THE ALTERNATION RULE, IN ONE PLACE FOR EVERY SURFACE.**
 *
 * The store appends user-then-assistant pairs, so a healthy record already
 * alternates — but the 30-minute window cuts wherever it lands, which can leave
 * an `assistant` turn first, and a reply the surface failed to deliver (Discord
 * answered 403 for that channel; a browser tab closed mid-answer) can leave two
 * `user` turns adjacent. The Messages API requires an array that starts with
 * `user` and alternates; violating it is a 400 that eats somebody's answer over
 * a bookkeeping detail.
 *
 * So: leading assistant turns are DROPPED and consecutive same-role turns are
 * MERGED. Both callers get the same treatment, because the defect is the
 * store's, not Discord's.
 */
export function normaliseHistory(history: readonly ConversationTurn[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const turn of history) {
    const text = turn.text.trim();
    if (text.length === 0) continue;
    if (out.length === 0 && turn.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${text}`;
    else out.push({ role: turn.role, content: text });
  }
  return out;
}

/**
 * The stored transcript plus what was just said, as a `messages` array.
 *
 * The **Discord** shape: the surface holds no transcript of its own, so the
 * current question is a bare string appended to the remembered window.
 */
export function modelMessages(
  history: readonly ConversationTurn[],
  current: string,
): ModelMessage[] {
  const out = normaliseHistory(history);
  const last = out[out.length - 1];
  if (last && last.role === 'user') last.content = `${last.content}\n\n${current}`;
  else out.push({ role: 'user', content: current });
  return out;
}

/** The minimum a surface's own message needs to look like for the merge below. */
export interface RoledMessage {
  role: string;
  content: unknown;
}

/**
 * The stored transcript prepended to a surface that **holds its own transcript**.
 *
 * ⚠️ **THE PANEL'S SHAPE, AND THE ASYMMETRY IS THE WHOLE POINT.** Discord keeps
 * nothing between messages, so the store *is* the conversation. The site panel
 * keeps the live tab's transcript in React state — complete with `tool_use` and
 * `tool_result` blocks the store deliberately never holds — so the store's job
 * there is narrower: supply the part of the conversation this tab was not
 * present for.
 *
 * Which is why `remembered` must be the turns the caller has already decided it
 * is NOT carrying. The panel decides that by reading its own `turns[].ref.cid`;
 * that decision is a surface's business and stays out of here. What is in here
 * is the alternation arithmetic, because getting it wrong is the same 400 on
 * both surfaces.
 *
 * The merge, in order:
 *  - nothing remembered → the surface's array, untouched;
 *  - remembered ends on an `assistant` turn → straight concatenation, because
 *    the surface's array always begins with a `user` message;
 *  - remembered ends on a `user` turn (she was asked something she never
 *    answered) → that text is folded INTO the surface's first user message
 *    rather than dropped: as a prefix for a string body, as a leading `text`
 *    block for a block-array body. Dropping it would lose the only turn in the
 *    window that has no answer, which is exactly the one a follow-up refers to.
 */
export function withRemembered<T extends RoledMessage>(
  remembered: readonly ConversationTurn[],
  messages: readonly T[],
): (ModelMessage | T)[] {
  const prefix = normaliseHistory(remembered);
  if (prefix.length === 0) return [...messages];
  if (messages.length === 0) return [...prefix];

  const tail = prefix[prefix.length - 1]!;
  const head = messages[0]!;
  if (tail.role !== 'user' || head.role !== 'user') return [...prefix, ...messages];

  // Fold the unanswered question into the surface's first message.
  const rest = prefix.slice(0, -1);
  const merged: T =
    typeof head.content === 'string'
      ? ({ ...head, content: `${tail.content}\n\n${head.content}` } as T)
      : Array.isArray(head.content)
        ? ({ ...head, content: [{ type: 'text', text: tail.content }, ...head.content] } as T)
        : head;
  // A body that is neither a string nor an array is one this core does not
  // understand; keeping the remembered turn separate is wrong (two adjacent
  // user messages) so it is dropped, and the caller's own validation is what
  // should have refused the message in the first place.
  return [...rest, merged, ...messages.slice(1)];
}

/** How many characters of remembered conversation a turn is about to pay for. */
export function historyCost(history: readonly ConversationTurn[]): {
  historyTurns: number;
  historyChars: number;
} {
  return { historyTurns: history.length, historyChars: conversationChars(history) };
}
