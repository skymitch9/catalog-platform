/**
 * THE T2 CONFIRM LANE — orchestration. `confirm.ts` holds the words, the MAC and
 * the rendering; `delegated-exec.ts` holds the credential; this file holds the
 * ORDER, and nothing else. Every side effect arrives injected, so the whole lane
 * — propose, press, cancel, the 409, the revoked-between, the double-press — is
 * exercised by `test/confirm.test.ts` with no network, no Durable Object and no
 * secret.
 *
 * ## The two moments, and the checks each one owns (design §1.1)
 *
 *  - **PROPOSE** — a `dry-run` on the destination reads the `before` values AND
 *    is the FIRST capability check. A proposal offered to somebody who cannot
 *    make it is a restatement that ends in a refusal, so it is refused first.
 *  - **PRESS** — the real `fix-field` apply is the SECOND capability check
 *    (revocation beats everything) AND the compare-and-set (§4). The press-time
 *    answer is the one that authorises.
 *
 * ## ⚠️ Consume the nonce BEFORE calling (design §3.5)
 *
 * The unsafe-looking choice that is correct: consume-then-call can lose the
 * outcome of an in-flight call, reported honestly as `applyUncertain`; call-
 * then-consume can apply the change TWICE. An uncertain report is recoverable;
 * a double mutation is not. The Durable Object serialises per object, so
 * clearing the pending slot first makes a second press find nothing (`stale`).
 */

import {
  DELEGATE_MSG,
  type DelegatePort,
  type FixFieldResult,
  type LibraryInstance,
} from './delegated.js';
import {
  buildConfirmProposal,
  buildRestatement,
  checkConfirmPress,
  newNonce,
  type ConfirmChangePending,
  type ConfirmSubject,
} from './conversation.js';
import { CONFIRM_MSG, renderConfirm } from './confirm.js';

/** The per-person pending slot, as this flow needs it. The caller wires it to
 * the gateway Durable Object (the same store the conversation memory uses); a
 * test wires it to an object. */
export interface ConfirmMemory {
  /** The current proposal for this person, or null. */
  loadPending(): Promise<ConfirmChangePending | null>;
  /** Store a proposal — replaces whatever pending question was there. */
  savePending(pending: ConfirmChangePending): Promise<void>;
  /** ⚠️ Consume the nonce — clear the pending slot. */
  clearPending(): Promise<void>;
}

export interface ConfirmDeps {
  port: Pick<DelegatePort, 'fixField' | 'linkedUid'>;
  memory: ConfirmMemory;
  /** The MAC key material — `ESTATE_APP_TOKEN_DISCORD`. */
  keyMaterial: string;
}

/** What a proposal or a press produces: what she says, and (on a proposal) the
 * embed and buttons to attach. */
export interface ConfirmOutcome {
  content: string;
  embeds?: unknown[];
  components?: unknown[];
}

/** What the person is asking to change — the subject already resolved to exactly
 * one book, and the fields with the values they typed. ⚠️ `before` is NOT here:
 * it comes off the dry-run, never from the model or the conversation (§4.3). */
export interface ConfirmIntent {
  subject: ConfirmSubject;
  instance: LibraryInstance;
  fields: { field: string; after: string }[];
}

const say = (content: string): ConfirmOutcome => ({ content });

// ---------------------------------------------------------------------------
// PROPOSE
// ---------------------------------------------------------------------------

/**
 * Offer a confirm. Runs the dry-run (capability check #1 + reads `before`),
 * builds the proposal, stores it, and returns the restatement to render.
 *
 * ⚠️ Never throws — it is called from a socket handler where an unhandled
 * rejection is a silent nothing.
 */
export async function proposeConfirm(
  intent: ConfirmIntent,
  who: { discordUserId: string },
  deps: ConfirmDeps,
  now: number = Date.now(),
): Promise<ConfirmOutcome> {
  try {
    const link = await deps.port.linkedUid(who.discordUserId);
    if (!link.ok) {
      return say(link.reason === 'unlinked' ? DELEGATE_MSG.unlinked : DELEGATE_MSG.linkOutage);
    }

    // The dry-run: capability check #1 AND the source of `before`.
    const dry = await deps.port.fixField(intent.instance, link.uid, {
      subject: intent.subject,
      changes: intent.fields.map((f) => ({ field: f.field })),
      dryRun: true,
    });
    if (dry.kind === 'unreachable') return say(DELEGATE_MSG.siteUnreachable(intent.instance.label));
    if (dry.kind === 'refused') return say(dry.message); // relayed verbatim
    if (dry.kind !== 'dryrun') {
      // 'applied'/'changed' from a dry-run is a destination bug — never act on it.
      return say(CONFIRM_MSG.notConfigured);
    }

    const built = buildConfirmProposal({
      askerId: who.discordUserId,
      instance: intent.instance.app,
      subject: intent.subject,
      fields: intent.fields.map((f) => ({
        field: f.field,
        before: dry.before[f.field] ?? '',
        after: f.after,
      })),
      nonce: newNonce(),
      now,
    });
    if (!built.ok) {
      if (built.reason === 'no_change') {
        return say(
          `Nothing to change — ${intent.subject.label} already reads exactly that. Nothing was touched.`,
        );
      }
      if (built.reason === 'field_not_allowed') {
        return say(
          `I can't change **${built.field ?? 'that'}** from here — I only do a book's own display ` +
            'fields this way, never the title or author (those move the review link and need the ' +
            "site's own careful edit). Nothing was changed.",
        );
      }
      return say('There was nothing in that to change. Nothing was touched.');
    }

    // ⚠️ One pending at a time (design §2.1 cost 1): note the displacement.
    const prior = await deps.memory.loadPending();
    await deps.memory.savePending(built.pending);

    const rest = buildRestatement(built.pending, {
      capability: 'editCatalog',
      instanceLabel: intent.instance.label,
    });
    const render = await renderConfirm(deps.keyMaterial, built.pending, rest);
    const content = prior ? `${CONFIRM_MSG.replaced}\n\n${render.content}` : render.content;
    return { content, embeds: render.embeds, components: render.components };
  } catch (err) {
    console.error('GABI confirm: propose failed:', err instanceof Error ? err.message : err);
    return say(DELEGATE_MSG.siteUnreachable('the catalogs'));
  }
}

// ---------------------------------------------------------------------------
// PRESS
// ---------------------------------------------------------------------------

/**
 * Answer a confirm press. The MAC has already been verified by the caller
 * (`confirm.ts`'s `verifyConfirmCustomId`); this owns the stateful checks and
 * the apply.
 */
export async function pressConfirm(
  press: { action: 'ok' | 'no'; nonce: string },
  who: { discordUserId: string },
  deps: ConfirmDeps,
  instances: readonly LibraryInstance[],
  now: number = Date.now(),
): Promise<ConfirmOutcome> {
  try {
    const pending = await deps.memory.loadPending();
    const check = checkConfirmPress(pending, press.nonce, who.discordUserId, now);
    if (!check.ok) {
      return say(check.reason === 'expired' ? CONFIRM_MSG.expired : CONFIRM_MSG.stale);
    }
    const proposal = check.pending;

    // Cancel — clear the slot and say so. Nothing was ever going to change.
    if (press.action === 'no') {
      await deps.memory.clearPending();
      return say(CONFIRM_MSG.cancelled);
    }

    const instance = instances.find((i) => i.app === proposal.instance);
    if (!instance) {
      // The proposal names a shelf this deployment no longer offers.
      await deps.memory.clearPending();
      return say(CONFIRM_MSG.stale);
    }

    const link = await deps.port.linkedUid(who.discordUserId);
    if (!link.ok) {
      return say(link.reason === 'unlinked' ? DELEGATE_MSG.unlinked : DELEGATE_MSG.linkOutage);
    }

    // ⚠️ Consume the nonce BEFORE the call (design §3.5). A second press now
    // finds nothing and is `stale`; and a lost-in-flight outcome is reported as
    // uncertain rather than risking a double apply.
    await deps.memory.clearPending();

    const result: FixFieldResult = await deps.port.fixField(instance, link.uid, {
      subject: proposal.subject,
      changes: proposal.changes.map((c) => ({ field: c.field, before: c.before, after: c.after })),
      dryRun: false,
    });

    switch (result.kind) {
      case 'applied':
        return say(`${result.message}\n${changesLink(instance, proposal.subject)}`);
      case 'changed': {
        // §4.2's 409 — the destination refused; nothing was written. She
        // re-proposes on the next ask rather than auto-retrying.
        const label = proposal.changes.find((c) => c.field === result.field)?.label ?? 'that';
        return say(CONFIRM_MSG.changedUnderneath(label, result.nowIs));
      }
      case 'refused':
        // Propose said yes, press said no — access changed in between.
        return say(CONFIRM_MSG.capabilityLost);
      case 'unreachable':
      default:
        // The nonce is already spent and we do not know if the write landed.
        return say(CONFIRM_MSG.applyUncertain);
    }
  } catch (err) {
    console.error('GABI confirm: press failed:', err instanceof Error ? err.message : err);
    // The nonce may or may not be spent, the write may or may not have landed.
    return say(CONFIRM_MSG.applyUncertain);
  }
}

/** The deep link to the entity's own Changes panel — the review-link rule and
 * the undo path in one (design §7.3). */
function changesLink(instance: LibraryInstance, subject: ConfirmSubject): string {
  return `Review or undo it here: ${instance.baseUrl}/work/${subject.id}`;
}
