/**
 * The **fourth door**: somebody pressed a component GABI attached to an earlier
 * answer, or submitted the modal that component opened.
 *
 * ## ⚠️ THIS PATH INVOLVES NO GATEWAY AT ALL
 *
 * That is the whole reason clarifying questions are cheap here. A message needs
 * a held-open WebSocket to hear; a **button press is an ordinary HTTPS POST**
 * from Discord to `discord.heygabi.ai/interactions` — the endpoint that has
 * been live since 2026-08-16, already Ed25519-verified, already routed. So the
 * continuity layer's interactive half rides infrastructure that predates it and
 * adds **no second always-on object, no cron, and no new credential**.
 *
 * The one thing it must reach out for is the memory, which lives in the gateway
 * Durable Object's storage (`gateway.ts` §CONVERSATION MEMORY explains why
 * there and not somewhere new). That is a stub `fetch` to an object that
 * already exists — three of them per press:
 *
 *   1. `POST /conv/load`  — the transcript, the pending question, AND the cap
 *      verdict, in one round trip because they live one field apart;
 *   2. `POST /conv/save`  — the two new turns, one row write;
 *   3. `POST /conv/count` — the turn against the rolling caps.
 *
 * ⚠️ The split between 2 and 3 is deliberate. Folding the count into the save
 * would couple "she said something" to "it counted", and the day somebody adds
 * a save that should *not* count, the cap would silently start lying.
 *
 * ## ⚠️ THE KEY IS DERIVED FROM THE PRESSER, WHICH IS THE SECURITY MODEL
 *
 * The `custom_id` carries a bare nonce and nothing else — no user id, no channel
 * id, no MAC. It does not need them: the conversation key is rebuilt here from
 * **who pressed it** (`interactionUser`, proved by Discord's signature) and
 * **where they pressed it** (`channel_id`, likewise). Somebody else clicking the
 * same public menu therefore resolves a DIFFERENT record, finds no pending
 * question with that nonce, and is answered `CONV_MSG.stale`.
 *
 * Compare `moderation.ts`, whose confirm id IS signed — because that one
 * authorises a message deletion, so the id itself is a capability. This one
 * carries no authority at all.
 */

import { editOriginalMessage } from './discord-api.js';
import { indexBase } from './have.js';
import { panelBase, panelDeepLink } from './gabi.js';
import { catalogBase } from './catalog-data.js';
import type { Env } from './env.js';
import { gatewayStub } from './gateway.js';
import {
  conversationKey,
  CONV_MSG,
  type ConversationKey,
  type ConversationTurn,
  type PendingChoice,
} from './conversation.js';
import type { CapVerdict } from './mentions.js';
import { delegatedWritesOn, libraryInstances, type WriteCapVerdict } from './delegated.js';
import { makeDelegate } from './delegated-exec.js';
import {
  handlePick,
  handleTypedQuestion,
  type ConversationDeps,
  type ResumeOutcome,
} from './mention-flow.js';
import type { InteractionActor } from './interactions.js';

/**
 * The conversation SURFACE for an interaction — the same test `mentions.ts`
 * applies to a gateway message, so a button pressed inside a DM resumes the DM's
 * memory rather than opening a second, parallel one.
 */
export function surfaceOf(guildId: string): 'discord_channel' | 'discord_dm' {
  return guildId ? 'discord_channel' : 'discord_dm';
}

export function keyForActor(actor: InteractionActor): ConversationKey | null {
  const person = actor.user?.id ?? '';
  if (!person || !actor.channelId) return null;
  return conversationKey(surfaceOf(actor.guildId), actor.channelId, person);
}

// ---------------------------------------------------------------------------
// The store, over a Durable Object stub
// ---------------------------------------------------------------------------

interface LoadedMemory {
  turns: ConversationTurn[];
  pending: PendingChoice | null;
  cap: CapVerdict;
  /** ⚠️ TIER 1: the per-person daily WRITE fuse, answered in the same load. */
  writeCap: WriteCapVerdict;
}

/**
 * ⚠️ Memoised on purpose. `handlePick` calls `load()` and then `capCheck()`, and
 * without this they would be two round trips for one answer that the Durable
 * Object composed in a single read.
 */
class StubMemory {
  private loaded: LoadedMemory | null = null;

  constructor(
    private readonly stub: DurableObjectStub,
    private readonly key: ConversationKey,
  ) {}

  private async post(path: string, body: unknown): Promise<Response> {
    return this.stub.fetch(`https://gateway.internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...this.key, ...(body as object) }),
    });
  }

  private async ensure(): Promise<LoadedMemory> {
    if (this.loaded) return this.loaded;
    const res = await this.post('/conv/load', {});
    if (!res.ok) throw new Error(`conversation load failed (${res.status})`);
    const body = (await res.json()) as Partial<LoadedMemory>;
    this.loaded = {
      turns: Array.isArray(body.turns) ? body.turns : [],
      pending: body.pending ?? null,
      cap: body.cap ?? { ok: true },
      writeCap: body.writeCap ?? { ok: true },
    };
    return this.loaded;
  }

  conversation(): ConversationDeps {
    return {
      load: async () => {
        const m = await this.ensure();
        return { turns: m.turns, pending: m.pending };
      },
      save: async (entry) => {
        await this.post('/conv/save', {
          user: entry.user,
          assistant: entry.assistant,
          pending: entry.pending,
        });
      },
    };
  }

  async capCheck(): Promise<CapVerdict> {
    return (await this.ensure()).cap;
  }

  async recordTurn(): Promise<void> {
    await this.post('/conv/count', {});
  }

  /** ⚠️ Read from the memoised load — the DO answered both fuses at once. */
  async writeCapCheck(): Promise<WriteCapVerdict> {
    return (await this.ensure()).writeCap;
  }

  async recordWrite(): Promise<void> {
    await this.post('/conv/wcount', {});
  }
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

export type ResumeKind =
  | { kind: 'pick'; nonce: string; choice: string }
  | { kind: 'typed'; nonce: string; text: string };

/**
 * Resume a stored conversation from a component press, and edit the deferred
 * interaction response with whatever she says next.
 *
 * ⚠️ Never throws, and never leaves the "thinking…" spinner up: every branch
 * ends in an edit, including the ones where nothing could be found. A component
 * that acknowledges and then goes quiet is the exact failure the estate's
 * no-bare-status rule exists to prevent, wearing a spinner.
 */
export async function resumeConversation(
  env: Env,
  actor: InteractionActor,
  input: ResumeKind,
): Promise<void> {
  const applicationId = env.DISCORD_APPLICATION_ID || actor.applicationId;
  const say = async (content: string) => {
    await editOriginalMessage(applicationId, actor.token, {
      content,
      // Her own answer can carry a book title containing anything at all.
      // Resolve NOTHING: a select menu must not become a way to ping a server.
      allowed_mentions: { parse: [] },
    });
  };

  try {
    const key = keyForActor(actor);
    const stub = gatewayStub(env);
    if (!key || !stub) {
      // A configuration gap or a payload with no user — named as an estate-side
      // problem, never as something the person did wrong.
      console.error(
        'GABI continuity: no conversation key or no GABI_GATEWAY binding; the press was answered ' +
          'in words and nothing was recorded.',
      );
      await say(CONV_MSG.noStore);
      return;
    }

    const memory = new StubMemory(stub, key);
    // ⚠️ TIER 1. A press can be the answer to "your shelf or the main
    // library?", which WRITES — so this path needs the same port the gateway
    // has, built from the same env, and it is `null` on the same ships-dark
    // condition. The write cap lives in the Durable Object beside the turn cap
    // (one counter per person, wherever they were reached from), so it is read
    // and written over the same stub the memory uses.
    const delegate = makeDelegate(env);
    const deps = {
      capCheck: () => memory.capCheck(),
      recordTurn: () => memory.recordTurn(),
      conversation: memory.conversation(),
      ...(delegate
        ? {
            delegated: {
              delegate,
              writeCapCheck: () => memory.writeCapCheck(),
              recordWrite: () => memory.recordWrite(),
            },
          }
        : {}),
    };
    const cfg = {
      indexBaseUrl: indexBase(env),
      panelUrl: panelDeepLink(panelBase(env)),
      catalogBaseUrl: catalogBase(env),
      instances: libraryInstances(env),
      delegatedWrites: delegatedWritesOn(env),
      ...(env.ANTHROPIC_API_KEY_GABI ? { anthropicKey: env.ANTHROPIC_API_KEY_GABI } : {}),
    };
    const who = {
      discordUserId: key.person,
      guildId: actor.guildId || null,
      authorName: actor.user?.global_name || actor.user?.username || 'there',
    };

    const outcome: ResumeOutcome =
      input.kind === 'pick'
        ? await handlePick(deps, { nonce: input.nonce, choice: input.choice }, who, cfg)
        : await handleTypedQuestion(deps, { nonce: input.nonce, text: input.text }, who, cfg);

    await say(outcome.content);

    // ⚠️ A slow verb was started by the press. The SAME message is edited a
    // second time when it lands — not a new one — because the interaction token
    // is good for fifteen minutes and an edit keeps the report attached to the
    // question it answers. Awaited rather than registered: a promise nobody
    // awaits inside a Worker may be cancelled, and this one is the whole point.
    if (outcome.kind === 'answered' && outcome.followUp) {
      await say(await outcome.followUp());
    }
  } catch (err) {
    console.error('GABI continuity: the resume failed:', err instanceof Error ? err.message : err);
    try {
      await say(CONV_MSG.noStore);
    } catch {
      // The interaction token expired or Discord is down. Nothing further is
      // possible, and no estate state changed — there is nothing to roll back.
    }
  }
}
