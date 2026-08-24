/**
 * THE T2 CONFIRM LANE — **Discord's half.** Built **DARK** (`GABI_CONFIRM_T2`).
 *
 * Design of record: `docs/info/gabi-confirm-lanes-design.md`. The
 * surface-neutral grammar — the `confirm_change` proposal, the propose/
 * compare-and-set arithmetic, the `Restatement` structure and the MAC material
 * — lives in `@platform/gabi-conversation` (re-exported through
 * `conversation.ts`). This file is the part that was never portable: the embed
 * and buttons, the `gc2|` component vocabulary's crypto, and the sentences she
 * says on THIS surface.
 *
 * ## The kill switch is a CONTRACT (the moderation.ts precedent)
 *
 *  - `confirmT2On()` is affirmative — `"on"` and nothing else. Every typo is OFF.
 *  - OFF means no proposal is offered, no button is rendered, and a stale button
 *    from before a flip answers `CONFIRM_MSG.switchedOff` rather than acting.
 *  - ⚠️ The flip is the OWNER's evidence-gated step. Nothing in this build, this
 *    repo's scripts, or any deploy may set it to `"on"`.
 *
 * ## Why THIS button is MAC'd (design §3.3, overridden by the T2 brief)
 *
 * The clarifying-question `gc|` id is unsigned because the lane is stateful — a
 * lifted nonce resolves a different record. The confirm `gc2|` id is signed
 * anyway, at the owner's instruction: a hand-typed or lifted button is refused
 * by the MAC *before any storage is touched*, exactly as `moderation.ts`'s
 * cleanup confirm is, and the stateful per-presser check still runs behind it.
 * It is a second lock, strictly access-reducing.
 *
 * ⚠️ **The key material is `ESTATE_APP_TOKEN_DISCORD`** — the same bearer the
 * delegated door already uses. No new secret: with the token unset the whole
 * lane is dark (nothing to propose), so keying the MAC on it can never leave a
 * live button unverifiable. Domain-separated under `CONFIRM_MAC_LABEL`.
 *
 * ⚠️ **The instance is NOT bound into the Discord MAC** — it is not recoverable
 * from a pressing interaction without first reading the stored record, and
 * binding it would force the verify to touch storage, losing the "a hand-typed
 * button cannot fire at all" property. The instance is pinned in the stateful
 * record instead, where the compare-and-set reads it. The shared
 * `confirmSignedMaterial` still carries an instance slot for the panel, which
 * DOES name its instance in the press; Discord passes it empty.
 */

import { b64url, timingSafeEqual } from './link-token.js';
import type { Env } from './env.js';
import {
  CONFIRM_MAC_LABEL,
  buildRestatement,
  confirmSignedMaterial,
  formatConfirmCustomId,
  parseConfirmCustomId,
  type ConfirmAction,
  type ConfirmChangePending,
  type ParsedConfirmCustomId,
  type Restatement,
} from './conversation.js';

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

/** Affirmative, trimmed, case-insensitive — `"on"` or it is off. */
export function confirmT2On(env: Pick<Env, 'GABI_CONFIRM_T2'>): boolean {
  return (env.GABI_CONFIRM_T2 ?? '').trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// The MAC — mirrors moderation.ts; 64 bits, hex, truncated safely
// ---------------------------------------------------------------------------

/** 64 bits of MAC, hex. Truncated deliberately and safely: the token is bound
 * to one nonce and one presser, ten minutes long, and every press is re-checked
 * against the live stateful record AND the destination's live capability. */
const SIG_HEX_CHARS = 16;

async function confirmMacKey(keyMaterial: string): Promise<CryptoKey> {
  const seed = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyMaterial),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  // One extra hash under the label, so the key in use is not the bearer itself
  // and a fourth MAC use gets a fourth label.
  const derived = await crypto.subtle.sign('HMAC', seed, enc.encode(CONFIRM_MAC_LABEL));
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function signConfirm(keyMaterial: string, nonce: string, askerId: string, expSeconds: number): Promise<string> {
  const key = await confirmMacKey(keyMaterial);
  // Discord binds nonce + presser + expiry; the instance slot is empty here (see header).
  const material = confirmSignedMaterial({ nonce, askerId, instance: '', expSeconds });
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(material)));
  return Array.from(mac.slice(0, SIG_HEX_CHARS / 2), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The `custom_id` for one confirm button, signed. `expSeconds` is the
 * proposal's own absolute `expiresAt`, in seconds. */
export async function buildConfirmButtonId(
  keyMaterial: string,
  action: ConfirmAction,
  nonce: string,
  askerId: string,
  expSeconds: number,
): Promise<string> {
  const sig = await signConfirm(keyMaterial, nonce, askerId, expSeconds);
  return formatConfirmCustomId(action, nonce, expSeconds, sig);
}

export type ConfirmVerify =
  | { ok: true; action: ConfirmAction; nonce: string }
  /** `expired` and `invalid` are answered by different words (design §8): an
   *  expired button tells an honest person to ask again; an invalid one means
   *  the id did not come from GABI. Neither reveals which half of a forgery to
   *  fix — a bad MAC and a past expiry are checked in that order. */
  | { ok: false; reason: 'expired' | 'invalid' };

/**
 * Verify a `gc2|` press — the MAC first, then the expiry — using ONLY what the
 * interaction carries (the custom_id) and the presser's own id. No storage is
 * touched here, so a forged or hand-typed button cannot fire at all.
 */
export async function verifyConfirmPress(
  keyMaterial: string,
  customId: string,
  presserId: string,
  nowMs: number,
): Promise<ConfirmVerify> {
  const parsed: ParsedConfirmCustomId | null = parseConfirmCustomId(customId);
  if (!parsed) return { ok: false, reason: 'invalid' };

  const expected = await signConfirm(keyMaterial, parsed.nonce, presserId, parsed.expSeconds);
  if (!timingSafeEqual(parsed.sig, expected)) return { ok: false, reason: 'invalid' };

  // Expiry AFTER the MAC — an unsigned id is never called "expired", which would
  // tell a forger their signature was otherwise fine.
  if (parsed.expSeconds * 1000 <= nowMs) return { ok: false, reason: 'expired' };

  return { ok: true, action: parsed.action, nonce: parsed.nonce };
}

// ---------------------------------------------------------------------------
// Rendering the restatement (design §5.1 — the four mandatory elements)
// ---------------------------------------------------------------------------

const COMPONENT = { ACTION_ROW: 1, BUTTON: 2 } as const;
const BUTTON_STYLE = { PRIMARY: 1, SECONDARY: 2, DANGER: 4 } as const;

/** The authority sentence — element 4: the borrowed authority, in words the
 * person owns. This is the sentence that makes the borrowed-authority model
 * visible to the person it belongs to. */
export function authoritySentence(rest: Restatement): string {
  return (
    `I'll do this **as you**, using your ${rest.authority.capability} access on ` +
    `${rest.authority.instanceLabel} — I hold no permissions of my own.`
  );
}

/**
 * The confirm message: an embed carrying the subject, per-field before→after,
 * the instance and the authority sentence, plus an OK/Cancel button pair.
 *
 * ⚠️ A Cancel button is mandatory (design §5.3): without it the only way to
 * decline is silence, indistinguishable from not having seen it, and it leaves
 * the pending slot occupied until the TTL.
 */
export async function renderConfirm(
  keyMaterial: string,
  pending: ConfirmChangePending,
  rest: Restatement,
): Promise<{ content: string; embeds: unknown[]; components: unknown[] }> {
  const expSeconds = Math.floor(pending.expiresAt / 1000);
  const [okId, noId] = await Promise.all([
    buildConfirmButtonId(keyMaterial, 'ok', pending.nonce, pending.askerId, expSeconds),
    buildConfirmButtonId(keyMaterial, 'no', pending.nonce, pending.askerId, expSeconds),
  ]);

  const fields = rest.changes.map((c) => ({
    name: c.label,
    // ⚠️ Both values shown — a restatement showing only `after` asks somebody to
    // approve a diff they cannot see (design §5.1 element 2).
    value: `${fmt(c.before)} → **${fmt(c.after)}**`,
  }));

  return {
    content: `Here's exactly what I'll change on ${rest.subject.instance}. ${authoritySentence(rest)}`,
    embeds: [
      {
        title: rest.subject.label,
        description: `on **${rest.subject.instance}**`,
        fields,
        // T2 primary-coloured; T3 (excluded from this build) would be danger.
        color: 0x4f46e5,
      },
    ],
    components: [
      {
        type: COMPONENT.ACTION_ROW,
        components: [
          {
            type: COMPONENT.BUTTON,
            style: BUTTON_STYLE.PRIMARY,
            label: 'Yes, make this change',
            custom_id: okId,
          },
          {
            type: COMPONENT.BUTTON,
            style: BUTTON_STYLE.SECONDARY,
            label: 'Cancel',
            custom_id: noId,
          },
        ],
      },
    ],
  };
}

/** Re-exported so the flow can build a restatement without importing two files. */
export { buildRestatement };

/** An empty value reads as `(none)` rather than a blank — a diff from nothing to
 * something must not look like a diff from something to nothing. */
function fmt(v: string): string {
  const t = v.trim();
  return t.length === 0 ? '_(none)_' : t.length > 300 ? `${t.slice(0, 299)}…` : t;
}

// ---------------------------------------------------------------------------
// The words — every refusal says what happened, whether anything changed, and
// what to do (the no-bare-status rule; design §8)
// ---------------------------------------------------------------------------

export const CONFIRM_MSG = {
  /** ⚠️ THE KILL-SWITCH ANSWER. What is happening, that nothing was done, whose
   *  step turns it on. */
  switchedOff:
    "GABI's confirm-and-fix lane is **switched off**, so nothing happened — no book was changed. " +
    'This is a deliberate estate setting (`GABI_CONFIRM_T2`), not a problem with your account. ' +
    'The site can still edit anything, and I can still look things up. Turning it on is the estate ' +
    "owner's decision.",

  notConfigured:
    "I'm not wired up to change the catalogs yet — that's a setup step on the estate's side, not " +
    'anything to do with your account, and nothing was changed. I can still look things up.',

  /** No such live proposal for this presser: aged out, or somebody else's. */
  stale:
    "I can't pick that up — either that button was for whoever asked, or it has aged out. Nothing " +
    "was changed. Ask me again and I'll offer it fresh.",

  expired:
    "That confirm aged out, so **nothing was changed** — I only hold a proposed edit for about ten " +
    'minutes, because a button describing a change nobody remembers asking for is its own problem. ' +
    'Ask me again and I\'ll offer it fresh.',

  /** design §8 confirmInvalid — the MAC rejected it. */
  invalid:
    'That button is not one GABI can act on, so nothing was changed. It may belong to an older ' +
    'message or to somebody else. Ask me again and I\'ll offer a fresh one.',

  /** §4.2's 409, worded. `nowIs` is what the field says now. */
  changedUnderneath: (label: string, nowIs: string) =>
    `Someone changed the ${label} while we were talking — it now says «${nowIs || '(nothing)'}», not ` +
    "what I showed you. I **haven't touched it**. Want me to look again?",

  /** propose said yes, press said no — said as a change, not a flat refusal. */
  capabilityLost:
    "You could do this when I offered it and can't now — **nothing was changed**. That usually " +
    'means your access was updated in the last few minutes. Nothing you did wrong.',

  /** consume-then-call lost the outcome (design §3.5 / §8). Honest uncertainty. */
  applyUncertain:
    "I'm not certain that landed — the change may or may not have gone through. **Check the book's " +
    'Changes panel on the site** to see, rather than trusting me either way on this one.',

  cancelled:
    "Okay — I've dropped that, and **nothing was changed**. I'm still here if you want something else.",

  /** a second proposal displaced the first (design §2.1 cost 1). */
  replaced:
    'That replaces the change I offered a moment ago, which I\'ve dropped — I only hold one proposed ' +
    'edit at a time, so a plain "yes" is never ambiguous.',

  /** the outcome message when a Cancel/OK arrives with no interaction token, etc. */
  noToken:
    'Discord sent no interaction token, so GABI has no way to reply. Nothing went wrong on the ' +
    'estate side — ask her again.',
} as const;
