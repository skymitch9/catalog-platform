/**
 * THE T2 CONFIRM PRESS — the credential + Durable Object wiring, mirroring
 * `conversation-flow.ts`. `confirm-flow.ts` holds the pure order; this file is
 * the one that reaches the gateway object's storage and the delegated door, and
 * then edits the deferred interaction response with whatever she says.
 *
 * ⚠️ Like a continuity press, this involves NO gateway WebSocket: a button press
 * is an ordinary signed HTTPS interaction on the endpoint that predates the
 * confirm lane. The one thing it reaches for is the per-person pending slot,
 * which lives in the gateway Durable Object's storage exactly where the
 * conversation memory does — so the confirm proposal costs no new store.
 */

import { editOriginalMessage } from './discord-api.js';
import type { Env } from './env.js';
import { gatewayStub } from './gateway.js';
import {
  conversationKey,
  type ConfirmChangePending,
  type ConversationKey,
} from './conversation.js';
import { PERSON_SPACE, PERSON_SURFACE } from './personality.js';
import { libraryInstances } from './delegated.js';
import { makeDelegate } from './delegated-exec.js';
import { pressConfirm, type ConfirmMemory } from './confirm-flow.js';
import { CONFIRM_MSG } from './confirm.js';
import type { InteractionActor } from './interactions.js';

/** Same person-keying as the continuity layer: a confirm press resumes the same
 * per-person thread the proposal was stored under. */
function keyForActor(actor: InteractionActor): ConversationKey | null {
  const person = actor.user?.id ?? '';
  if (!person || !actor.channelId) return null;
  return conversationKey(PERSON_SURFACE, PERSON_SPACE, person);
}

/** The pending slot over the gateway stub. `savePending`/`clearPending` ride the
 * same `/conv/save` the memory uses: empty turn text is filtered by
 * `appendTurns`, so a save with no words writes only the pending slot, and a
 * clear with `pending: null` keeps the transcript while dropping the proposal. */
function confirmMemory(stub: DurableObjectStub, key: ConversationKey): ConfirmMemory {
  const post = (path: string, body: unknown) =>
    stub.fetch(`https://gateway.internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...key, ...(body as object) }),
    });
  return {
    async loadPending() {
      const res = await post('/conv/load', {});
      if (!res.ok) throw new Error(`conversation load failed (${res.status})`);
      const body = (await res.json()) as { pending?: unknown };
      const p = body.pending as ConfirmChangePending | null | undefined;
      return p && p.kind === 'confirm_change' ? p : null;
    },
    async savePending(pending) {
      await post('/conv/save', { user: '', assistant: '', pending });
    },
    async clearPending() {
      await post('/conv/save', { user: '', assistant: '', pending: null });
    },
  };
}

/**
 * Resume a verified confirm press (the MAC is already checked by the caller) and
 * edit the deferred response. Never throws, and never leaves the spinner up.
 */
export async function resumeConfirm(
  env: Env,
  actor: InteractionActor,
  press: { action: 'ok' | 'no'; nonce: string },
): Promise<void> {
  const applicationId = env.DISCORD_APPLICATION_ID || actor.applicationId;
  const say = async (content: string) => {
    await editOriginalMessage(applicationId, actor.token, {
      content,
      // Her answer can echo a book title containing anything at all — resolve
      // no mentions, so a confirm can never become a way to ping a server.
      allowed_mentions: { parse: [] },
    });
  };

  try {
    const key = keyForActor(actor);
    const stub = gatewayStub(env);
    const delegate = makeDelegate(env);
    if (!key || !stub || !delegate) {
      console.error('GABI confirm: no key, no gateway binding, or no delegate port; answered in words.');
      await say(CONFIRM_MSG.notConfigured);
      return;
    }
    const token = env.ESTATE_APP_TOKEN_DISCORD ?? '';
    const outcome = await pressConfirm(
      press,
      { discordUserId: key.person },
      { port: delegate, memory: confirmMemory(stub, key), keyMaterial: token },
      libraryInstances(env),
    );
    await say(outcome.content);
  } catch (err) {
    console.error('GABI confirm: resume failed:', err instanceof Error ? err.message : err);
    try {
      await say(CONFIRM_MSG.applyUncertain);
    } catch {
      // The interaction token expired or Discord is down; nothing further is possible.
    }
  }
}
