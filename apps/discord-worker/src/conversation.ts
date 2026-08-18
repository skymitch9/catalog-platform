/**
 * CONVERSATION CONTINUITY, **Discord's half**.
 *
 * ⚠️ **THE SHAPE, THE WINDOW AND THE ARITHMETIC MOVED OUT** on 2026-08-18, into
 * `@platform/gabi-conversation` — the shared substrate the site's GABI panel now
 * reads and writes too. This file re-exports every one of them, so nothing that
 * imported from here changed by a character; what it *keeps* is the part that
 * was never portable in the first place.
 *
 * The split is the one this file's own header predicted:
 *
 * > *"⚠️ THIS SHAPE IS A CONTRACT WITH A SURFACE THAT DOES NOT EXIST YET …
 * > The library site's GABI panel will eventually want the same rolling memory,
 * > and the failure mode to avoid is the one every second surface hits: a store
 * > whose fields are secretly Discord's, so the web version either re-implements
 * > it or carries dead columns."*
 *
 * | Moved to `@platform/gabi-conversation` | Stayed here |
 * |---|---|
 * | `ConversationRecord` / `Key` / `Turn` / `PendingChoice` | — |
 * | the 30-minute window, the 20-turn cap, the 600-char clip | — |
 * | `pruneConversation` / `appendTurns` / `conversationChars` | — |
 * | `conversationStorageKey` | — |
 * | `modelMessages` / `withRemembered` (alternation) | — |
 * | — | the `custom_id` vocabulary (`gc\|…`, `gcm\|…`) |
 * | — | `buildChoiceComponents`, `buildQuestionModal`, `modalInputValue` |
 * | — | `CONV_MSG` — the sentences she says on THIS surface |
 *
 * Nothing below is reusable by a chat panel: a select menu, a modal and a
 * Discord component `custom_id` are Discord's, and the panel's clarifying
 * question is prose in a chat box. Keeping them here is what stops the shared
 * package acquiring dead Discord columns — the exact failure the header warned
 * about, arriving from the other direction.
 *
 * ⚠️ **Do not add fields, limits or window logic to this file.** They belong
 * upstream, where both surfaces get them; a constant added here is a constant
 * the panel silently does not have.
 */

// The whole surface-neutral substrate, re-exported so this module's import path
// is unchanged for `gateway.ts`, `mention-flow.ts`, `interactions.ts`,
// `conversation-flow.ts`, `delegated-flow.ts`, `gabi-chat.ts` and `index.ts`.
export * from '@platform/gabi-conversation';

import { MAX_CHOICE_OPTIONS, type PendingChoice } from '@platform/gabi-conversation';

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
