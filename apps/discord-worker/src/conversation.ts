/**
 * CONVERSATION CONTINUITY — the record shape, the window arithmetic, and the
 * component vocabulary. **Pure.** No I/O, no Discord types, no Durable Object.
 *
 * The owner's ask, verbatim: *"I don't want to message GABI and then message
 * her again and she has no recollection."*
 *
 * ## ⚠️ THIS SHAPE IS A CONTRACT WITH A SURFACE THAT DOES NOT EXIST YET
 *
 * Also the owner's, verbatim: *"whatever we build we need to consider for when
 * we update the chat button on GABI."* The library site's GABI panel will
 * eventually want the same rolling memory, and the failure mode to avoid is the
 * one every second surface hits: a store whose fields are secretly Discord's,
 * so the web version either re-implements it or carries dead columns.
 *
 * So the record is split **explicitly**, and the split is mechanical rather
 * than aspirational:
 *
 * | Surface-NEUTRAL — every surface reads and writes these | Surface-SPECIFIC |
 * |---|---|
 * | `v`, `updatedAt` | — |
 * | `key.surface` (an opaque label) | the label's *value* (`discord_channel`…) |
 * | `key.space` (opaque string: "the room this happened in") | a Discord channel id / a panel session id |
 * | `key.person` (opaque string: "who was talking") | a Discord user id / a Firebase uid |
 * | `turns[].role`, `turns[].text`, `turns[].at` | — |
 * | — | `turns[].ref` — an **opaque bag** the core NEVER reads |
 * | `pending.kind`, `pending.nonce`, `pending.question`, `pending.options[]` | — |
 *
 * ⚠️ **`space` and `person` are OPAQUE BY CONTRACT.** Nothing in this file or
 * any consumer may parse them, pattern-match them, or assume they are numeric.
 * A Discord snowflake and a Firebase uid must be interchangeable here, because
 * that interchangeability is the entire portability claim.
 *
 * ⚠️ **`turns[].ref` is the ONLY place a surface may stash its own ids**, and
 * the core treats it as write-only. Discord puts `{message_id, guild_id}` there
 * so a turn can be linked back to the message that produced it; the panel would
 * put something else. A reader that starts branching on `ref` has broken the
 * contract, and the doc says so (`docs/info/gabi-conversation-continuity.md`).
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

/** ⚠️ Bump this ONLY with a written migration note. A reader that finds a
 * version it does not know must treat the record as absent (start fresh) rather
 * than guess at it — `pruneConversation()` does exactly that. */
export const CONVERSATION_SHAPE_VERSION = 1;

/**
 * ⚠️ A LABEL, not an enum the core switches on. Discord contributes two values
 * today; the panel will contribute its own and needs no change here. Anything
 * that behaves differently per surface belongs in the caller, not in the store.
 */
export const CONVERSATION_SURFACES = ['discord_channel', 'discord_dm'] as const;
export type ConversationSurface = (typeof CONVERSATION_SURFACES)[number];

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
 * of a cent at Haiku 4.5's $1/MTok, and bounded rather than trending.
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
 * gateway's session keys or the caps (`gw:`, `cap:`) in the same object.
 *
 * The three parts are joined with `:` and each is length-capped, so a
 * pathological id cannot push the key past a storage limit. They are NOT
 * escaped, and they do not need to be: a Discord snowflake is digits and a
 * surface label is a fixed constant, so no separator can appear inside a part.
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
// The component vocabulary — `custom_id`s the HTTP interactions endpoint routes
// ---------------------------------------------------------------------------

/** Message components (buttons, select menus) she attaches to an answer. */
export const GABI_CONV_PREFIX = 'gc';
/** Modal SUBMITs. A separate prefix because they arrive as a different
 * interaction TYPE (5, not 3) and a shared prefix would invite a router that
 * reads the id before the type. */
export const GABI_MODAL_PREFIX = 'gcm';
/** The one text input inside the modal. */
export const GABI_MODAL_INPUT_ID = 'gcq';

export const CONV_ACTIONS = ['pick', 'more'] as const;
export type ConvAction = (typeof CONV_ACTIONS)[number];

/** 8 base36 characters ≈ 41 bits. Not a secret (see `PendingChoice`), so this
 * is sized to make an ACCIDENTAL collision with the previous question in the
 * same conversation implausible — nothing more. */
export function newNonce(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}

/** `gc|pick|<nonce>` / `gc|more|<nonce>` — 16 characters, far inside Discord's
 * 100-character `custom_id` ceiling. */
export function buildConvCustomId(action: ConvAction, nonce: string): string {
  return `${GABI_CONV_PREFIX}|${action}|${nonce}`;
}

export function buildModalCustomId(nonce: string): string {
  return `${GABI_MODAL_PREFIX}|${nonce}`;
}

const SAFE_NONCE = /^[a-z0-9]{1,16}$/;

export function parseConvCustomId(customId: string): { action: ConvAction; nonce: string } | null {
  const parts = customId.split('|');
  if (parts.length !== 3 || parts[0] !== GABI_CONV_PREFIX) return null;
  const [, action, nonce] = parts as [string, string, string];
  if (!(CONV_ACTIONS as readonly string[]).includes(action)) return null;
  if (!SAFE_NONCE.test(nonce)) return null;
  return { action: action as ConvAction, nonce };
}

export function parseModalCustomId(customId: string): { nonce: string } | null {
  const parts = customId.split('|');
  if (parts.length !== 2 || parts[0] !== GABI_MODAL_PREFIX) return null;
  const nonce = parts[1] as string;
  return SAFE_NONCE.test(nonce) ? { nonce } : null;
}

// ---------------------------------------------------------------------------
// Rendering the clarifying question
// ---------------------------------------------------------------------------

const COMPONENT = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
  LABEL: 18,
} as const;

const SELECT_LABEL_MAX = 100; // Discord's ceiling on an option label
const SELECT_DESCRIPTION_MAX = 100;

const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/**
 * The clarifying question, as message components: one string select of the
 * candidates, and one button that opens a free-text modal for "none of these".
 *
 * ⚠️ Option `value`s are the plain INDEX into `pending.options`, not titles.
 * A title would have to survive Discord's 100-character option-value ceiling
 * and round-trip identically; an index cannot be truncated into a different
 * book. The index is re-checked against the stored options on the way back.
 */
export function buildChoiceComponents(pending: PendingChoice): unknown[] {
  const rows: unknown[] = [
    {
      type: COMPONENT.ACTION_ROW,
      components: [
        {
          type: COMPONENT.STRING_SELECT,
          custom_id: buildConvCustomId('pick', pending.nonce),
          placeholder:
            pending.kind === 'instance_pick' ? 'Which catalog?' : 'Which one did you mean?',
          min_values: 1,
          max_values: 1,
          options: pending.options.slice(0, MAX_CHOICE_OPTIONS).map((o, i) => ({
            label: clip(o.label, SELECT_LABEL_MAX),
            value: String(i),
            ...(o.detail ? { description: clip(o.detail.replace(/\*\*|\[|\]\([^)]*\)/g, ''), SELECT_DESCRIPTION_MAX) } : {}),
          })),
        },
      ],
    },
  ];

  // ⚠️ The free-text escape hatch is offered for a BOOK pick and withheld for an
  // INSTANCE pick, and that asymmetry is the point. "Which book did you mean?"
  // has answers that are not on the menu — the matcher may simply have missed
  // it. "Which catalog?" does not: the two rows ARE the set of shelves this
  // person may write to, computed from their own roles moments ago. A "let me
  // type it" button there would invite an answer that can only be refused, and
  // walking away is already the third option — the question ages out in fifteen
  // minutes having written nothing.
  if (pending.kind !== 'instance_pick') {
    rows.push({
      type: COMPONENT.ACTION_ROW,
      components: [
        {
          type: COMPONENT.BUTTON,
          style: 2, // secondary — this is an escape hatch, not the main action
          label: 'None of these — let me type it',
          custom_id: buildConvCustomId('more', pending.nonce),
        },
      ],
    });
  }
  return rows;
}

/**
 * The modal, as an interaction RESPONSE (callback type 9).
 *
 * ⚠️ Built with a **Label (type 18) wrapping the Text Input**, not an Action
 * Row. Discord's own component reference, read 2026-08-17: *"We no longer
 * recommend using Text Input within an Action Row in modals. Going forward all
 * Text Inputs should be placed inside a Label component."* — the Action Row
 * form is documented as deprecated.
 */
export function buildQuestionModal(nonce: string, title: string): unknown {
  return {
    type: 9, // MODAL
    data: {
      custom_id: buildModalCustomId(nonce),
      title: clip(title, 45),
      components: [
        {
          type: COMPONENT.LABEL,
          label: 'What did you mean?',
          description: 'Tell me in your own words and I will pick it up from here.',
          component: {
            type: COMPONENT.TEXT_INPUT,
            custom_id: GABI_MODAL_INPUT_ID,
            style: 2, // paragraph
            max_length: 400,
            required: true,
            placeholder: 'e.g. the second Mistborn one, the audiobook',
          },
        },
      ],
    },
  };
}

/**
 * Pull the typed text out of a modal submit's `data`.
 *
 * ⚠️ **Deliberately a RECURSIVE walk rather than a fixed path**, because
 * Discord has two live shapes for this: the legacy Action Row
 * (`components[].components[]`) and the current Label
 * (`components[].component`). Both were read off the docs 2026-08-17. Hard-
 * coding either one is a build that breaks on a submit somebody made from a
 * client rendering the other, with no error anywhere — just an empty question.
 */
export function modalInputValue(data: unknown, customId = GABI_MODAL_INPUT_ID): string {
  let found = '';
  const walk = (node: unknown, depth: number): void => {
    if (found || depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj['custom_id'] === customId && typeof obj['value'] === 'string') {
      found = obj['value'];
      return;
    }
    for (const child of [obj['components'], obj['component']]) walk(child, depth + 1);
  };
  walk((data as { components?: unknown } | null)?.components, 0);
  return found.trim();
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/** ⚠️ Same rules as `MENTION_MSG`: never a bare status, never an outage dressed
 * as a refusal, and never a configuration gap shown to a person. */
export const CONV_MSG = {
  chooseOne: (shown: number, total: number) =>
    total > shown
      ? `\n\nA few of those could be it — here are the closest ${shown} of ${total}. Which one did you mean?`
      : '\n\nA few of those could be it — which one did you mean?',

  /**
   * ⚠️ ONE message for two causes, on purpose. A component in a public channel
   * can be clicked by anybody, so a press that finds no pending question is
   * either somebody else's menu or a conversation that has aged out — and the
   * person pressing cannot tell those apart either. Naming both is honest;
   * picking one would be a guess presented as a fact.
   */
  stale:
    "I can't pick that up — either that question was for whoever asked it, or the conversation it " +
    'belonged to has moved on. I only keep the last half hour of a chat, and then it is gone. ' +
    'Ask me again and I will start fresh.',

  /** The posture is off and somebody pressed a button from before it was. */
  notListening:
    "I'm not listening in Discord at the moment — that's a deliberate estate setting, not a fault " +
    'and nothing to do with your permissions. Nothing happened. The estate owner turns it back on.',

  /** The gateway object is not bound: a configuration gap, never blamed on the person. */
  noStore:
    "I lost my place in that conversation — that's a problem on the estate's side, not anything you " +
    'did, and nothing was recorded. Ask me the whole question again and I will answer it fresh.',

  picked: (label: string) => `You meant **${label}** —`,

  /** She was asked to remember, and there was nothing to remember. */
  modalTitle: 'Ask GABI',
} as const;
