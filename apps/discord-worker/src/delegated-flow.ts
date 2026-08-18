/**
 * **What happens between "she noticed an ISBN" and "the book is on the shelf".**
 *
 * The orchestration half of Tier 1. `delegated.ts` holds the contract and the
 * words; `delegated-exec.ts` holds the credentials; this file holds the ORDER,
 * and it deliberately holds nothing else — every side effect arrives as an
 * injected dependency, so the whole ladder (linked and unlinked, one shelf and
 * two, capped and not, reachable and not) is exercised by `test/delegated.test.ts`
 * with no network, no Durable Object and no secret.
 *
 * ## The order, and why each step is where it is
 *
 * 1. **The write cap, first.** Before the link read, before any site is
 *    dialled. A fuse that blows after the thing it was protecting has already
 *    happened is decoration — the same reasoning `handleMention` puts its turn
 *    cap ahead of the classifier.
 * 2. **Who is this?** The `/link` document, and *only* the document. A Discord
 *    display name is not evidence of anything (`link.ts` rule 1), and an
 *    unlinked person is told how to link rather than guessed at.
 * 3. **Where can they do this?** Both shelves are asked *in parallel* — two
 *    subrequests, and they cannot depend on each other. One → go. Two → **ask**,
 *    never guess. None-with-the-capability but known somewhere → call that
 *    shelf anyway and relay ITS refusal, because the destination is the
 *    authority on why. None at all → worded, and an outage is worded as an
 *    outage rather than as "you have no account".
 * 4. **Do it, and say what happened** — in the destination's own words.
 *
 * ## ⚠️ The slow verb says "on it" FIRST
 *
 * `run-details` runs a real sweep: 20–90 s per book, up to two books. Nothing
 * here waits silently — the caller gets a `followUp` it must await *after*
 * replying, and the report arrives as a second message that pings the asker,
 * which is exactly the shape the owner described: *"Hey @Sam i went ahead and
 * fixed all your missing stuff."*
 *
 * ⚠️ It is a returned CLOSURE rather than a fire-and-forget, because a promise
 * nobody awaits inside a Worker is a promise the runtime may cancel — the
 * failure this estate has already paid for twice (`waitUntil` cancels ~30 s
 * after the handler settles, silently).
 */

import {
  DELEGATE_MSG,
  capabilityFor,
  chooseInstances,
  type DelegatePort,
  type DelegatedIntent,
  type LibraryInstance,
  type WriteCapVerdict,
} from './delegated.js';
import {
  MAX_CHOICE_OPTIONS,
  newNonce,
  type PendingChoice,
  type PendingOption,
} from './conversation.js';

/** The injected world. ⚠️ No env, no secret, no fetch — see the header. */
export interface DelegatedDeps {
  delegate: DelegatePort;
  /** The per-person daily WRITE fuse. Separate from the turn cap on purpose. */
  writeCapCheck(discordUserId: string): Promise<WriteCapVerdict>;
  /** Counted once per call that REACHED a destination, refusals included. */
  recordWrite(discordUserId: string): Promise<void>;
}

/**
 * What she says, and what (if anything) is still to come.
 *
 * `followUp` present means: reply with `content` NOW, then await it and post
 * what it returns as a second message. Absent means the answer is complete.
 */
export interface DelegatedOutcome {
  content: string;
  pending: PendingChoice | null;
  components: unknown[] | null;
  followUp?: () => Promise<string>;
}

const plain = (content: string): DelegatedOutcome => ({ content, pending: null, components: null });

/**
 * Run one delegated verb from a message.
 *
 * ⚠️ Never throws. It is called from inside a Durable Object's socket handler,
 * where an unhandled rejection is a silent nothing — the worst possible failure
 * for a bot somebody just asked to do something.
 */
export async function runDelegated(
  intent: NonNullable<DelegatedIntent>,
  who: { discordUserId: string },
  deps: DelegatedDeps,
  instances: readonly LibraryInstance[],
  now: number = Date.now(),
): Promise<DelegatedOutcome> {
  try {
    // 1. The fuse, before anything that writes or costs.
    const cap = await deps.writeCapCheck(who.discordUserId);
    if (!cap.ok) return plain(cap.message);

    // 2. Who is this? Never guessed from a Discord name.
    const link = await deps.delegate.linkedUid(who.discordUserId);
    if (!link.ok) {
      return plain(link.reason === 'unlinked' ? DELEGATE_MSG.unlinked : DELEGATE_MSG.linkOutage);
    }

    // 3. Where may they do it? Both shelves asked at once — independent
    //    questions, and serialising them would double the wait for nothing.
    const capability = capabilityFor(intent.verb);
    const answers = await Promise.all(
      instances.map(async (instance) => ({
        instance,
        who: await deps.delegate.whoami(instance, link.uid),
      })),
    );
    const routing = chooseInstances(answers, capability);

    if (routing.kind === 'none') {
      return plain(
        routing.unreachable
          ? DELEGATE_MSG.siteUnreachable('the catalogs')
          : DELEGATE_MSG.noAccountAnywhere,
      );
    }

    if (routing.kind === 'ask') {
      // ⚠️ NOTHING is written, nothing is counted, and no site is called. The
      // question is the whole answer; the verb is stored so the press performs
      // the request that was offered rather than one re-parsed later.
      const pending = instancePick(intent, routing.instances, now);
      return {
        content: DELEGATE_MSG.whichShelf(
          intent.verb === 'add-isbn' ? 'a book' : 'a sweep of missing details',
        ),
        pending,
        components: null, // filled in by the caller, which owns the renderer
      };
    }

    return execute(intent, routing.instance, link.uid, who, deps);
  } catch (err) {
    console.error('GABI delegated: the flow failed:', err instanceof Error ? err.message : err);
    return plain(DELEGATE_MSG.siteUnreachable('the catalogs'));
  }
}

/**
 * Somebody answered "which catalog?".
 *
 * ⚠️ **The write cap is checked AGAIN here**, and that is not belt-and-braces:
 * offering the menu deliberately costs nothing, so the fuse has genuinely not
 * been spent yet — and a menu can sit in a channel for fifteen minutes while
 * other writes happen.
 */
export async function resumeDelegated(
  pending: Extract<PendingChoice, { kind: 'instance_pick' }>,
  chosen: PendingOption,
  who: { discordUserId: string },
  deps: DelegatedDeps,
  instances: readonly LibraryInstance[],
): Promise<DelegatedOutcome> {
  try {
    const instance = instances.find((i) => i.app === chosen.instance);
    // The menu named a shelf this deployment no longer offers — a config change
    // between the offer and the press. Stale, not an error the person caused.
    if (!instance) return plain(DELEGATE_MSG.shelfChoiceStale);

    const cap = await deps.writeCapCheck(who.discordUserId);
    if (!cap.ok) return plain(cap.message);

    const link = await deps.delegate.linkedUid(who.discordUserId);
    if (!link.ok) {
      return plain(link.reason === 'unlinked' ? DELEGATE_MSG.unlinked : DELEGATE_MSG.linkOutage);
    }

    const intent: NonNullable<DelegatedIntent> =
      pending.verb === 'add-isbn'
        ? { verb: 'add-isbn', isbn: pending.isbn ?? '' }
        : { verb: 'run-details' };

    // ⚠️ An `add-isbn` pending record with no ISBN cannot happen through
    // `instancePick`, but a stored record is data and data can be wrong.
    // Refusing beats sending an empty string to a write endpoint.
    if (intent.verb === 'add-isbn' && !intent.isbn) return plain(DELEGATE_MSG.shelfChoiceStale);

    return await execute(intent, instance, link.uid, who, deps);
  } catch (err) {
    console.error('GABI delegated: the resumed choice failed:', err instanceof Error ? err.message : err);
    return plain(DELEGATE_MSG.siteUnreachable('the catalogs'));
  }
}

// ---------------------------------------------------------------------------
// The two verbs
// ---------------------------------------------------------------------------

async function execute(
  intent: NonNullable<DelegatedIntent>,
  instance: LibraryInstance,
  uid: string,
  who: { discordUserId: string },
  deps: DelegatedDeps,
): Promise<DelegatedOutcome> {
  if (intent.verb === 'add-isbn') {
    // ⚠️ Counted BEFORE the call, so a call that lands and then fails to be
    // reported still spent its allowance. The cap protects the destination's
    // rows, and those are written whether or not we hear about it.
    await deps.recordWrite(who.discordUserId);
    const result = await deps.delegate.call(instance, 'add-isbn', uid, { isbn: intent.isbn });
    return plain(result.message);
  }

  // The sweep. She answers immediately and reports when it lands.
  await deps.recordWrite(who.discordUserId);
  return {
    content: DELEGATE_MSG.onIt(instance.label),
    pending: null,
    components: null,
    followUp: async () => {
      try {
        const result = await deps.delegate.call(instance, 'run-details', uid);
        return `${DELEGATE_MSG.reportBack(who.discordUserId)}\n${result.message}`;
      } catch (err) {
        console.error('GABI delegated: the sweep follow-up failed:', err instanceof Error ? err.message : err);
        return DELEGATE_MSG.sweepFailed(instance.label);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The "which shelf?" question
// ---------------------------------------------------------------------------

/**
 * ⚠️ Options carry the instance's `app` id rather than its index, so a menu
 * offered to somebody with two shelves and a menu offered to somebody with one
 * cannot be confused by position (`conversation.ts` on `PendingOption.instance`).
 */
export function instancePick(
  intent: NonNullable<DelegatedIntent>,
  instances: readonly LibraryInstance[],
  now: number,
): Extract<PendingChoice, { kind: 'instance_pick' }> {
  return {
    kind: 'instance_pick',
    nonce: newNonce(),
    question:
      intent.verb === 'add-isbn' ? `Add ${intent.isbn} — which catalog?` : 'Fix missing details — which catalog?',
    verb: intent.verb,
    ...(intent.verb === 'add-isbn' ? { isbn: intent.isbn } : {}),
    options: instances.slice(0, MAX_CHOICE_OPTIONS).map((i) => ({
      label: i.label,
      detail: i.baseUrl.replace(/^https?:\/\//, ''),
      instance: i.app,
    })),
    at: now,
  };
}
