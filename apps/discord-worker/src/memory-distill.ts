/**
 * **THE DISTILLATION — one cheap model call when a conversation goes quiet**
 * (`docs/info/gabi-memory-design.md` §3.5).
 *
 * ⚠️ **This holds no credential.** It makes a model call and is handed a
 * `MemoryPort` it cannot construct — the Firestore side stays in
 * `memory-exec.ts`, which is the fourth and last module allowed a secret.
 *
 * ## ⚠️ WHY IT RUNS ON THE CRON AND NOT ON A REPLY
 *
 * Design §2 weighs three triggers and rejects the cheap one in writing:
 * distilling lazily on the NEXT conversation's first turn is nearly free, and it
 * is stale at exactly the moment the feature exists for — the first turn after a
 * gap IS the "not a fresh bot" moment. It would also put a model call on the
 * critical path of a reply somebody is watching a typing indicator for.
 *
 * So the existing two-minute cron owns it. Worst-case staleness is two minutes
 * and nothing new was built to schedule it.
 *
 * ## ⚠️ THE ORDER IS THE WHOLE SAFETY PROPERTY
 *
 * > read → distil → **write the profile** → *then* delete the conversation.
 *
 * A record deleted before the profile write lands is a conversation lost
 * silently. Every failure below therefore LEAVES THE RECORD ALONE, so the next
 * sweep tries again — with one bounded exception (`DISTILL_GIVE_UP_MS`), because
 * a record that can never be distilled must not be retried for ever.
 */

import { chatClient, GABI_CHAT_MODEL, logNoKey } from './gabi-chat.js';
import { groqLive, viaGroq, type ModelOverrides } from './gabi-groq.js';
import {
  capProfile,
  DISTILL_SYSTEM,
  emptyProfile,
  parseProfile,
  personKey,
  type MemoryPort,
  type MemoryProfile,
} from './memory.js';
import type { ConversationTurn } from '@platform/gabi-conversation';

/** ⚠️ How many conversations one sweep may distil. The cron runs every two
 *  minutes, so three per run is 90 an hour — far more than this household
 *  produces — while bounding how long a single sweep can hold the Durable
 *  Object busy. A sweep that tried to drain a backlog in one pass would block
 *  the object whose actual job is holding a WebSocket. */
export const DISTILL_MAX_PER_SWEEP = 3;

/** ⚠️ After this long past expiry, a conversation that has repeatedly failed to
 *  distil is DELETED UNDISTILLED and logged. Retrying for ever would mean one
 *  poisonous record consuming every sweep's whole allowance and starving every
 *  later conversation — a silent, total stall of the feature. */
export const DISTILL_GIVE_UP_MS = 24 * 60 * 60 * 1000;

/** ⚠️ Output cap for the distiller. A profile is 2 KB; 600 tokens is generous
 *  headroom and stops a runaway from being expensive. */
const DISTILL_MAX_TOKENS = 600;

/** What the model is shown. ⚠️ Turns are ALREADY clipped to 600 chars each by
 *  the conversation store, so a full window is ≈12k chars ≈3k tokens — the
 *  figure the cost table is built on. */
export function distillTranscript(turns: readonly ConversationTurn[]): string {
  return turns
    .map((t) => `${t.role === 'user' ? 'THEM' : 'YOU'}: ${t.text}`)
    .join('\n');
}

export interface DistillOutcome {
  ok: boolean;
  /** ⚠️ `false` when the conversation should be KEPT for another attempt. */
  written: boolean;
  why?: string;
}

/**
 * Distil one ended conversation into that person's standing profile.
 *
 * ⚠️ **Every failure path returns `written: false` and touches nothing.** The
 * old profile stands and the conversation waits for the next sweep. A memory
 * feature whose failure mode is *forgetting* is acceptable; one whose failure
 * mode is *corruption* is not, and that asymmetry is why `parseProfile`
 * returning `null` is a no-op rather than a reset.
 */
export async function distillConversation(
  apiKey: string | undefined,
  port: MemoryPort,
  who: { discordUserId: string },
  turns: readonly ConversationTurn[],
  overrides?: ModelOverrides,
  now: number = Date.now(),
): Promise<DistillOutcome> {
  const key = personKey({ discordUserId: who.discordUserId });
  if (!key) return { ok: false, written: false, why: 'no_person_key' };

  // ⚠️ Nothing said, nothing to learn. A conversation of one "hi" must not cost
  // a model call, and must not bump `sources` as though it had taught her
  // something.
  const said = turns.filter((t) => t.role === 'user');
  if (said.length === 0) return { ok: true, written: false, why: 'nothing_said' };

  // ⚠️ **"NO MODEL AT ALL" IS THE CHECK, NOT "NO ANTHROPIC KEY".** With the Groq
  // rung live this sweep can distil without an Anthropic key, so the early
  // return has to ask about both — otherwise the cheaper transport would be
  // switched off by the absence of the expensive one it exists to precede.
  if (!apiKey && !groqLive(overrides?.groq)) {
    logNoKey('the memory distillation');
    return { ok: false, written: false, why: 'no_key' };
  }

  const current = (await port.load(key)) ?? emptyProfile(key, now);
  const asked =
    `The note you have so far:\n${JSON.stringify({
      callMe: current.callMe,
      notes: current.notes,
      reading: current.reading.map((r) => ({ book: r.book, said: r.said })),
      threads: current.threads.map((t) => ({ what: t.what })),
    })}\n\nThe conversation that just ended:\n${distillTranscript(turns)}`;

  /**
   * ⚠️ **THE SHARED VALIDATOR — one schema, two transports.** Un-fence, then
   * `parseProfile`, which is the memory feature's own schema and the only thing
   * allowed to decide what a profile is. A Groq reply that fails it is a
   * FAILURE (the rung falls through to Haiku), never a half-parsed profile that
   * overwrites what she already knew: design's asymmetry is that forgetting is
   * acceptable and corruption is not, and that holds for both transports.
   *
   * ⚠️ Models fence JSON even when told not to. Stripping a fence is not the
   * same as tolerating malformed output — anything still unparseable is a no-op.
   */
  const asProfile = (raw: string): MemoryProfile | null =>
    parseProfile(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''), key, now);

  /** Which failure the caller is told about, when nothing parsed. Set by
   *  whichever transport actually ran; `unparseable` is the default because a
   *  reply that arrived and did not parse is the commoner case. */
  let why: 'model_failed' | 'unparseable' | 'no_key' = 'unparseable';

  const viaHaiku = async (): Promise<MemoryProfile | null> => {
    if (!apiKey) {
      logNoKey('the memory distillation');
      why = 'no_key';
      return null;
    }
    try {
      const res = await chatClient(apiKey, overrides).messages.create({
        model: GABI_CHAT_MODEL,
        max_tokens: DISTILL_MAX_TOKENS,
        system: DISTILL_SYSTEM,
        messages: [{ role: 'user', content: asked }],
      });
      const text = (res.content as readonly unknown[])
        .map((b) => b as { type?: string; text?: unknown })
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('')
        .trim();
      why = 'unparseable';
      return asProfile(text);
    } catch (err) {
      console.error('GABI memory: the distillation call failed:', err instanceof Error ? err.message : err);
      why = 'model_failed';
      return null;
    }
  };

  const parsed = await viaGroq<MemoryProfile>({
    ...(overrides?.groq ? { rung: overrides.groq } : { rung: undefined }),
    purpose: 'distill',
    turn: () => ({
      system: DISTILL_SYSTEM,
      messages: [{ role: 'user', content: asked }],
      maxTokens: DISTILL_MAX_TOKENS,
      // ⚠️ Strict JSON out, so ask for it. `DISTILL_SYSTEM` says "JSON" in
      // words, which is what `json_object` requires; `test/gabi-groq.test.ts`
      // pins that it still does.
      json: true,
    }),
    validate: asProfile,
    haiku: viaHaiku,
    ...(overrides?.fetch ? { fetchImpl: overrides.fetch } : {}),
    who: { discordUserId: who.discordUserId },
    size: (p) => JSON.stringify(p).length,
  });

  if (!parsed) {
    // ⚠️ NOT an error the person ever sees, and NOT a reason to drop what she
    // already knew. Logged so a bad prompt is visible in `wrangler tail` rather
    // than only as a memory that never grows.
    if (why === 'unparseable') {
      console.error('GABI memory: the distiller returned something unparseable; the profile stands.');
    }
    return { ok: false, written: false, why };
  }

  const next: MemoryProfile = capProfile({
    ...parsed,
    person: key,
    updatedAt: now,
    // ⚠️ Counted here rather than by the model. A model asked to increment its
    // own counter will eventually decide the number should be something else.
    sources: current.sources + 1,
  });

  const written = await port.save(next);
  return { ok: written, written, ...(written ? {} : { why: 'write_failed' }) };
}
