/**
 * `GabiGateway` — the one persistent WebSocket to Discord's gateway, so GABI
 * **hears** ordinary messages that @mention her instead of only being poked by
 * an HTTP interaction.
 *
 * ## Why a Durable Object at all
 *
 * Everything the bot did before this file is request/response: Discord POSTs an
 * interaction to `discord.heygabi.ai/interactions` and a stateless Worker
 * answers. A slash command works that way; a **mention does not exist as an
 * interaction at all** — it is a `MESSAGE_CREATE` event, and events only arrive
 * over a connection somebody is holding open. A Worker cannot hold one between
 * requests; a Durable Object can, because it is a single addressable instance
 * with its own storage and its own lifetime.
 *
 * ## ⚠️ THE INTENTS, AND THE MEASUREMENT THE WHOLE BUILD RESTS ON
 *
 * `IDENTIFY` asks for **`GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES` = 4609, all
 * three unprivileged**. The **Message Content privileged intent is not
 * requested and must never be** (`discord-bot-design.md` §1.5).
 *
 * The obvious objection is that without it `MESSAGE_CREATE.content` arrives
 * blank, which would make a mention unreadable. **Measured 2026-08-17 against
 * Discord's own documentation** — <https://docs.discord.com/developers/events/gateway>
 * and <https://docs.discord.com/developers/gateway/you-might-not-need-a-privileged-intent>
 * — the intent blanks content **except** for four cases, and this build answers
 * exactly three of them:
 *
 *  - *"Messages that @mention your app"*,
 *  - *"Replies to your app's messages"* — with Discord's own caveat, quoted in
 *    full in `mentions.ts`: it applies only to a reply to a **regular bot
 *    message** with **"ping on reply" enabled**, never to a reply to a slash
 *    command's answer,
 *  - *"Direct Messages sent to your app"*.
 *
 * So the exact messages this build answers are the exact messages whose content
 * still arrives. `mentions.ts` treats a blank `content` as "not for her", which
 * is both the correct reading and the correct behaviour if that ever changed.
 *
 * ## ⚠️ THE MEMORY LIVES IN THIS OBJECT'S STORAGE, AND WHY THAT IS NOT LAZY
 *
 * Continuity (the owner: *"I don't want to message GABI and then message her
 * again and she has no recollection"*) needs somewhere durable that BOTH the
 * gateway and the HTTP interactions endpoint can reach. This object is the only
 * always-on thing on the account, and `wrangler.toml` names a **second**
 * always-on Durable Object as blocking. So the rolling transcript is `conv:`
 * rows in the storage this object already had — see the §CONVERSATION MEMORY
 * block below for the write-budget arithmetic, which is the part that matters.
 *
 * ## ⚠️ COST — AND THE REAL CONSTRAINT IS NOT MONEY, IT IS A FREE-PLAN CEILING
 *
 * An outbound WebSocket **cannot hibernate**: the docs say plainly *"Hibernation
 * is only supported when a Durable Object acts as a WebSocket server. Outgoing
 * WebSockets do not hibernate."* So this object accrues **duration for as long
 * as it is connected**, at the standard 128 MB allocation:
 *
 *   0.125 GB × 86,400 s = **10,800 GB-s per day** (≈324,000/month)
 *
 * ⚠️ **MEASURED AT DEPLOY, 2026-08-17: this account is on Workers FREE, not
 * Paid.** The deploy proved it — the cron trigger this file originally relied
 * on was REFUSED with *"This account has reached the Workers Free limit of 5
 * cron triggers per account"*. That correction matters more than the arithmetic
 * did, because the free plan's Durable Object allowances are **hard daily caps,
 * not billing thresholds**:
 *
 * | Free-plan allowance | Per day | This object |
 * |---|---|---|
 * | Duration | 13,000 GB-s | **~10,800 GB-s — about 83%** |
 * | Requests | 100,000 | ~3,000 (alarms) + a handful of mentions |
 * | Rows written | 100,000 | ~2,100 (one seq write per heartbeat) |
 *
 * **So: $0.00/month, and roughly 17% headroom on a cap that stops the object
 * rather than billing for it.** ⚠️ Two things would eat that headroom and both
 * should be treated as blocking: a **second always-on Durable Object anywhere
 * on this account**, and any reconnect pattern that leaves two sockets briefly
 * overlapping. On Workers Paid the same object sits inside the 400,000
 * GB-s/month inclusion (~$4.05/month if ever billed at the full $12.50 per
 * million GB-s), so upgrading removes the constraint entirely.
 *
 * ⚠️ Every figure above is **arithmetic over a published table, not an
 * invoice** — the first week's real usage is the measurement.
 *
 * ## ⚠️ THE 15-MINUTE FACT, WHICH IS WHY THE ALARM EXISTS
 *
 * Also measured from the same page: *"an active outbound WebSocket connection
 * keeps the Durable Object alive and prevents eviction for **up to 15 minutes
 * per connection**."* An open socket is therefore **not** an indefinite lease.
 * A gateway built only on "connect once and hold it" would go quietly deaf
 * within the hour and nothing would notice.
 *
 * So the connection is treated as **something that will die and must heal**:
 *
 *  - a **DO alarm every 30 s** re-enters the object, and reconnects if the
 *    socket is gone. An alarm also re-creates an evicted object, which is the
 *    only mechanism that can, and each alarm schedules the next — so the chain
 *    is **self-sustaining once something has started it**;
 *  - **RESUME with the stored `session_id` + `seq`** on reconnect, which asks
 *    Discord to replay what was missed rather than starting deaf.
 *
 * ⚠️ **THE STARTER IS `POST /admin/gateway/start`, AND IT IS THE ONLY ONE.**
 * The original design had a 2-minute cron as a second, independent poker;
 * `index.ts` still carries the `scheduled` handler for it. **The cron could not
 * be installed** — measured at deploy 2026-08-17, this account is on Workers
 * Free and has used all 5 of its allowed cron triggers. So the alarm chain has
 * no backstop: if it is ever broken (the object hits the fatal flag, or an
 * alarm is lost), a person has to POST that route to restart it. Adding the
 * cron back is one line in `wrangler.toml` the day a trigger is freed or the
 * account moves to Workers Paid.
 *
 * ⚠️ **HONEST LIMIT: a mention that lands inside a reconnect gap can be lost.**
 * A resume replays missed events, but a session Discord has already timed out
 * cannot be resumed and a fresh `IDENTIFY` replays nothing. Phase A does not
 * promise every mention is heard; it promises she is normally listening and
 * heals herself when she is not. That is written down rather than discovered.
 *
 * ## The posture
 *
 * ⚠️ `GABI_MENTIONS` is affirmative-only, and **OFF means no socket is ever
 * opened** — not "opened and silent". The alarm stands itself down, the cron
 * returns immediately, and an off bot costs nothing at all.
 */

import type { Env } from './env.js';
import { createChannelMessage, getGatewayBot, replyToMessage } from './discord-api.js';
import { delegatedWritesOn, libraryInstances, writeCapDecision } from './delegated.js';
import { makeDelegate } from './delegated-exec.js';
import { docsCapDecision, docsOn } from './estate-docs.js';
import { makeDocsPort } from './estate-docs-exec.js';
import { booksCapDecision, booksOn } from './book-knowledge.js';
import { makeBooksPort } from './book-knowledge-exec.js';
import { memoryOn } from './memory.js';
import {
  advancePersona,
  freshPersona,
  isTrope,
  personalityOn,
  personaBlock,
  PERSON_SPACE,
  PERSON_SURFACE,
  pickTrope,
  type PersonaState,
  type Trope,
} from './personality.js';
import { makeMemoryPort } from './memory-exec.js';
import { shelfOn } from './shelf.js';
import { makeShelfPort } from './shelf-exec.js';
import {
  distillConversation,
  DISTILL_GIVE_UP_MS,
  DISTILL_MAX_PER_SWEEP,
} from './memory-distill.js';
import { indexBase } from './have.js';
import { panelBase, panelDeepLink } from './gabi.js';
import { catalogBase } from './catalog-data.js';
import {
  capDecision,
  mentionsOn,
  mentionTrigger,
  pruneWindow,
  utcDayKey,
  type CapVerdict,
} from './mentions.js';
import { handleMention, type ConversationDeps } from './mention-flow.js';
import {
  appendTurns,
  conversationKey,
  conversationStorageKey,
  CONVERSATION_MAX_TURNS,
  CONVERSATION_WINDOW_MS,
  pruneConversation,
  type ConversationKey,
  type ConversationRecord,
  type ConversationTurn,
  type PendingChoice,
} from './conversation.js';

// ---------------------------------------------------------------------------
// The protocol, as named constants (Discord "Gateway", API v10)
// ---------------------------------------------------------------------------

const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

/**
 * `GUILDS (1 << 0) | GUILD_MESSAGES (1 << 9) | DIRECT_MESSAGES (1 << 12)` = **4609**.
 *
 * ⚠️ **ALL THREE UNPRIVILEGED.** Discord's intent table lists exactly three
 * privileged intents — `GUILD_PRESENCES`, `GUILD_MEMBERS`, `MESSAGE_CONTENT` —
 * and `DIRECT_MESSAGES` is not among them (read 2026-08-17,
 * <https://docs.discord.com/developers/events/gateway> §Privileged Intents).
 * It needs no portal toggle, no app verification and no review.
 *
 * ⚠️ **`DIRECT_MESSAGES` was ADDED 2026-08-17 with the continuity layer**, to
 * make the DM the zero-@ surface: in a one-to-one channel every message is
 * addressed to her, so nothing has to be typed to reach her. Content arrives
 * there without `MESSAGE_CONTENT` under the same page's exception list —
 * *"Content in DMs with the app"* — and it is not a widening of what she can
 * see: a DM to her is, definitionally, a message somebody sent her.
 *
 * ⚠️ **`DIRECT_MESSAGE_TYPING` (1 << 14) is deliberately NOT requested** (owner:
 * messages, not typing). It would buy a "GABI is typing…" affordance and cost a
 * `TYPING_START` event for every keystroke burst in every DM — traffic on an
 * always-on object with a measured 17% headroom, in exchange for a flourish.
 *
 * ⚠️ Adding MESSAGE_CONTENT (1 << 15) here would be the design decision §1.5
 * forbids — and Discord would answer close code 4014 for an unapproved
 * privileged intent, which this file treats as fatal rather than retrying.
 */
export const GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 12);

/**
 * ⚠️ Close codes after which reconnecting is pointless and a retry loop is
 * actively harmful — a bad token or an unapproved intent will not fix itself,
 * and hammering identify burns the daily session-start budget. Read off
 * Discord's "Gateway Close Event Codes" table (reconnect: false), 2026-08-17.
 */
export const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

/** Codes that invalidate the SESSION but not the bot: drop the session and
 * IDENTIFY afresh rather than RESUMEing into a refusal. */
const SESSION_DEAD_CODES = new Set([4007, 4009, 1000, 1001]);

/** How often the object re-enters itself to check it is still connected. Set
 * against the 15-minute eviction ceiling above: short enough that a dead socket
 * is measured in seconds, long enough to be free. */
export const ALARM_MS = 30_000;

/**
 * ⚠️ A daily ceiling on IDENTIFYs, because a flapping connection is the one way
 * this design could hurt: Discord grants a bounded number of session starts per
 * day, and an alarm that reconnects every 30 s could spend 2,880 of them. At
 * this ceiling the object stands down until the UTC day rolls over and says so
 * in the log.
 */
export const MAX_IDENTIFIES_PER_DAY = 400;

// Storage keys. Namespaced so the caps, the session and the conversations
// cannot collide: `gw:` the connection, `cap:` the fuses, `conv:` the memory
// (`conversation.ts` owns that third prefix and its key construction).
const K_SESSION = 'gw:session_id';
const K_SEQ = 'gw:seq';
const K_RESUME_URL = 'gw:resume_url';
const K_FATAL = 'gw:fatal';
const K_IDENTIFIES = 'gw:identifies';
const K_LAST_READY = 'gw:last_ready_at';
const K_GLOBAL_CAP = 'cap:global';
const kUserCap = (id: string) => `cap:user:${id}`;
/** ⚠️ Its OWN prefix, not a field inside `cap:user:` — see `writeCapCheck`.
 * Two fuses with different horizons must not share a record that one of them
 * prunes on a schedule the other does not want. */
const kUserWriteCap = (id: string) => `wcap:user:${id}`;
/** ⚠️ Its OWN prefix again, for the third time and the same reason. Three fuses
 * protect three different things over three different horizons: a TURN is
 * fractions of a cent and forgiven in a rolling hour; a WRITE is a row in
 * somebody's catalog and ~2¢ of research on their key; a DOCS turn is ≈6k input
 * tokens of retrieved runbook. A record one of them prunes on a schedule the
 * others do not want is a record that makes two of them lie. */
const kUserDocsCap = (id: string) => `dcap:user:${id}`;
/** ⚠️ Its OWN prefix for the FOURTH time, and the reason is the sharpest yet: a
 * BOOK turn is ≈6k input tokens of somebody's NOVEL. It costs the same as a docs
 * turn and means nothing like it, and it is the one the owner's *"I don't want
 * people scraping my books"* is about. Folding it into `dcap:` would let forty
 * runbook questions spend the book allowance, or forty book questions spend the
 * runbook one, and neither counter would describe what it protects. */
const kUserBooksCap = (id: string) => `bcap:user:${id}`;
/** ⚠️ ITS OWN KEY, not a field on the conversation record. That record's shape
 *  lives in `packages/gabi-conversation`, which the SITE PANEL also imports —
 *  growing it with a Discord-only concern would be a shared-package change for a
 *  single-surface feature. And it must OUTLIVE the conversation: a pin that
 *  evaporated after thirty minutes would not be a pin. */
const kUserPersona = (id: string) => `pers:user:${id}`;

interface IdentifyBudget {
  day: string;
  count: number;
}
interface GlobalCap {
  day: string;
  count: number;
}

export class GabiGateway {
  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private awaitingAck = false;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private connecting = false;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  // -------------------------------------------------------------------------
  // The door. Three verbs, all worded, none of them a bare status.
  // -------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    // ⚠️ THE CONVERSATION DOOR COMES FIRST, BEFORE THE POSTURE CHECK AND BEFORE
    // THE "anything else is /start" FALLTHROUGH BELOW. A component click
    // arrives on the HTTP interactions endpoint and needs the memory that lives
    // in here; if these paths fell through to /start they would OPEN A GATEWAY
    // WEBSOCKET as a side effect of somebody pressing a button, which is both
    // surprising and, on a free plan at 83% of the duration cap, expensive.
    // They read and write storage and touch the socket not at all.
    //
    // ⚠️ **`/conv/dcount` AND `/conv/bcount` WERE MISSING FROM THIS LIST**, found
    // 2026-08-18 while wiring tier 2. `conversationDoor` has handled both for a
    // while, but `fetch` never routed them here — so they fell through to the
    // `/start` poke below, which means: (a) on the component/modal lane the DOCS
    // and BOOK daily fuses were never incremented and therefore never capped,
    // and (b) charging a fuse could OPEN A GATEWAY WEBSOCKET, which is the exact
    // side effect the paragraph above exists to prevent. The gateway's own lane
    // was unaffected — it calls `this.recordDocsTurn(...)` directly rather than
    // over HTTP — which is why nothing looked wrong.
    if (
      path === '/conv/load' ||
      path === '/conv/save' ||
      path === '/conv/count' ||
      path === '/conv/wcount' ||
      path === '/conv/dcount' ||
      path === '/conv/bcount'
    ) {
      return this.conversationDoor(path, request);
    }

    // ⚠️ TIER 2. The distillation sweep — its own path, and NOT part of the
    // conversation door, because it carries no conversation key: it goes looking
    // for whichever conversations have gone quiet. Like the door above it must
    // sit ahead of the `/start` fallthrough, or the cron's sweep would open a
    // socket every two minutes as a side effect.
    if (path === '/conv/sweep') return Response.json(await this.distillSweep());

    if (path === '/status') return Response.json(await this.status());

    if (path === '/stop') {
      await this.disconnect('asked to stop');
      await this.state.storage.deleteAlarm();
      return Response.json({ ok: true, message: 'The gateway connection was closed and the self-heal alarm cleared.' });
    }

    // '/start' and anything else: the poke. Idempotent by design — the cron
    // sends it every couple of minutes and it must be free when all is well.
    if (!mentionsOn(this.env)) {
      await this.disconnect('posture is off');
      await this.state.storage.deleteAlarm();
      return Response.json({
        ok: true,
        connected: false,
        message:
          'GABI_MENTIONS is not "on", so no gateway connection was opened. That is the shipped ' +
          'posture; flipping it is an owner decision (wrangler.toml).',
      });
    }

    await this.ensureAlarm();
    await this.ensureConnected();
    return Response.json(await this.status());
  }

  /** ⚠️ Booleans and counts only — no token, no session id, no message text.
   * The same no-PII line `/api/health` draws. */
  private async status(): Promise<Record<string, unknown>> {
    const budget = (await this.state.storage.get<IdentifyBudget>(K_IDENTIFIES)) ?? null;
    return {
      ok: true,
      posture_on: mentionsOn(this.env),
      connected: this.ws !== null,
      has_session: Boolean(this.sessionId ?? (await this.state.storage.get<string>(K_SESSION))),
      fatal: Boolean(await this.state.storage.get<string>(K_FATAL)),
      fatal_reason: (await this.state.storage.get<string>(K_FATAL)) ?? null,
      identifies_today: budget?.day === utcDayKey(Date.now()) ? budget.count : 0,
      last_ready_at: (await this.state.storage.get<string>(K_LAST_READY)) ?? null,
      intents: GATEWAY_INTENTS,
      privileged_intents_requested: false,
      anthropic_key_configured: Boolean(this.env.ANTHROPIC_API_KEY_GABI),
      // ⚠️ A COUNT, never a key and never a word of what anybody said. It is
      // the one number that says whether the memory layer is doing anything at
      // all, and it is checkable without reading a single conversation.
      conversations_held: (await this.state.storage.list({ prefix: 'conv:', limit: 1000 })).size,
      conversation_window_minutes: CONVERSATION_WINDOW_MS / 60_000,
      conversation_max_turns: CONVERSATION_MAX_TURNS,
    };
  }

  // -------------------------------------------------------------------------
  // CONVERSATION MEMORY — the rolling per-person transcript
  //
  // ⚠️ IT LIVES HERE BECAUSE THIS OBJECT ALREADY EXISTS, and adding a second
  // always-on Durable Object anywhere on this account was named as BLOCKING in
  // wrangler.toml (the outbound socket cannot hibernate and accrues ~10,800 of
  // the FREE plan's 13,000 GB-s/day — about 83%, leaving ~17%).
  // Continuity therefore adds NO new object, no D1 binding, no Firestore
  // collection and no cron. It adds rows to storage this object already had.
  //
  // ⚠️ docs/TODO.md records the account moving to **Workers Paid 2026-08-17**,
  // after the sentence above was written and NOT measured by this build. The
  // decision was deliberately not revisited: reusing the object was correct
  // under the tighter ceiling and is still correct under the looser one.
  //
  // ⚠️ THE WRITE BUDGET, AND THE DEFECT CLASS THIS DOES NOT REPEAT.
  // An earlier version of this file wrote the gateway sequence number on EVERY
  // FRAME — a Durable Object row write per message in every channel of every
  // guild, against a 100,000 rows/day free-plan ceiling — and was corrected to
  // once per heartbeat (~2,100/day). Nothing here writes per frame:
  //
  //   * `convLoad()`  — ZERO writes on the normal path. The prune is in memory.
  //                     Its ONE write is a DELETE, and only when a record has
  //                     aged out entirely, which is the "deleted, not archived"
  //                     requirement doing its own garbage collection.
  //   * `convSave()`  — exactly ONE write, and only on an ANSWERED turn.
  //
  // So conversation writes are bounded by the SAME fuse that bounds the
  // answers: GLOBAL_TURNS_PER_DAY = 200. Worst case ≈ 200 saves + 200 loads
  // that happen to garbage-collect = **≤400 row writes/day**, on top of the
  // ~2,100 already accrued. New total ≈ 2,500/day of 100,000 — **2.5%**.
  // ⚠️ That bound is not a hope: it is arithmetic over an existing cap, and if
  // the cap is ever raised this paragraph is what has to be recomputed.
  //
  // Size: a full record is 20 turns x 600 chars ≈ 12 KB, inside the 128 KiB
  // per-value ceiling with an order of magnitude to spare.
  // -------------------------------------------------------------------------

  /** ⚠️ Reads and prunes. The ONLY write it can perform is the delete of a
   * record with nothing left inside the window — never a rewrite, never a
   * touch of `updatedAt`. */
  private async convLoad(
    key: ConversationKey,
  ): Promise<{ turns: ConversationTurn[]; pending: PendingChoice | null }> {
    const sk = conversationStorageKey(key);
    const stored = (await this.state.storage.get<ConversationRecord>(sk)) ?? null;
    const pruned = pruneConversation(stored, Date.now());
    if (stored && !pruned) {
      // Aged out. DELETED, not archived — the estate keeps half an hour of what
      // somebody said to a librarian and then it is gone.
      //
      // ⚠️ **UNLESS MEMORY IS ON, IN WHICH CASE THE SWEEP OWNS THE DELETION.**
      // Found while building tier 2: this read path deletes an expired record,
      // so somebody returning at 30m01s would destroy the conversation before
      // the cron had distilled it — silently, and precisely for the person who
      // came back, which is the one the profile is for. Distilling HERE instead
      // was rejected in the design: it puts a model call on the critical path of
      // a reply somebody is waiting for. So the record simply stays, the sweep
      // collects it within two minutes, and `DISTILL_GIVE_UP_MS` stops it
      // lingering for ever if it can never be distilled.
      //
      // ⚠️ Either way this returns NO TURNS, so what the person experiences is
      // identical: the conversation is over.
      if (!memoryOn(this.env)) await this.state.storage.delete(sk);
      return { turns: [], pending: null };
    }
    return { turns: pruned?.turns ?? [], pending: pruned?.pending ?? null };
  }

  /** Exactly one write, on an answered turn. */
  private async convSave(
    key: ConversationKey,
    entry: {
      user: string;
      assistant: string;
      pending: PendingChoice | null;
      ref?: Record<string, string>;
    },
  ): Promise<void> {
    const sk = conversationStorageKey(key);
    const now = Date.now();
    const stored = (await this.state.storage.get<ConversationRecord>(sk)) ?? null;
    const added: ConversationTurn[] = [
      { role: 'user', text: entry.user, at: now, ...(entry.ref ? { ref: entry.ref } : {}) },
      { role: 'assistant', text: entry.assistant, at: now },
    ];
    const next = appendTurns(stored, key, added, now, entry.pending);
    if (!next) {
      await this.state.storage.delete(sk);
      return;
    }
    await this.state.storage.put(sk, next);
  }

  /**
   * ⚠️ **THE DISTILLATION SWEEP — tier 2's trigger** (design §2).
   *
   * The cron pokes this every two minutes. It finds conversations that have gone
   * quiet, distils each into that person's standing profile, and only THEN
   * deletes the record.
   *
   * ⚠️ **The order is the safety property**: read → distil → write → delete. A
   * record deleted before the profile write lands is a conversation lost
   * silently, so every failure leaves the record for the next sweep.
   *
   * ⚠️ **Bounded twice.** `DISTILL_MAX_PER_SWEEP` stops one pass holding this
   * object — whose actual job is a WebSocket — busy draining a backlog.
   * `DISTILL_GIVE_UP_MS` stops a record that can NEVER be distilled from
   * consuming every sweep's allowance for ever and silently stalling the whole
   * feature.
   *
   * ⚠️ With the posture off it does nothing at all and costs nothing.
   */
  private async distillSweep(): Promise<{ ok: boolean; considered: number; distilled: number; gaveUp: number }> {
    const out = { ok: true, considered: 0, distilled: 0, gaveUp: 0 };
    // ⚠️ **THE SWEEP RUNS IN BOTH POSTURES, and only the DISTILLING is gated.**
    //
    // It became the migration for the person-keying change (memory design §11):
    // the old channel-scoped records are never read again, and the lazy prune
    // that used to delete expired conversations fired on the READ path — so
    // nothing would ever have collected them. Deleting an expired conversation
    // is honest housekeeping either way: it is data nobody can reach.
    const port = memoryOn(this.env) ? makeMemoryPort(this.env) : null;

    const now = Date.now();
    const all = await this.state.storage.list<ConversationRecord>({ prefix: 'conv:', limit: 1000 });

    for (const [sk, record] of all) {
      if (out.distilled >= DISTILL_MAX_PER_SWEEP) break;
      const updatedAt = typeof record?.updatedAt === 'number' ? record.updatedAt : 0;
      const age = now - updatedAt;
      // Still live — tier 1 owns it and it is none of this sweep's business.
      if (age <= CONVERSATION_WINDOW_MS) continue;
      out.considered += 1;

      // ⚠️ Repeatedly undistillable. Deleted UNDISTILLED and said out loud: a
      // silent stall is the failure mode this bound exists to make impossible.
      if (age > CONVERSATION_WINDOW_MS + DISTILL_GIVE_UP_MS) {
        await this.state.storage.delete(sk);
        out.gaveUp += 1;
        console.error(
          `GABI memory: gave up distilling a conversation after ${Math.round(age / 3600000)}h and deleted it.`,
        );
        continue;
      }

      const person = record?.key?.person ?? '';
      if (!person) {
        await this.state.storage.delete(sk);
        continue;
      }

      // ⚠️ With memory off there is nothing to distil INTO, so the record is
      // simply collected. That is the pre-memory behaviour restored, just moved
      // from the read path to here.
      if (!port) {
        await this.state.storage.delete(sk);
        continue;
      }

      const result = await distillConversation(
        this.env.ANTHROPIC_API_KEY_GABI,
        port,
        { discordUserId: person },
        record.turns ?? [],
      );
      if (result.written) {
        // ⚠️ ONLY NOW. The profile is durable, so the conversation may go.
        await this.state.storage.delete(sk);
        out.distilled += 1;
      } else if (result.why === 'nothing_said') {
        // Nothing was ever going to come of it — a greeting and no question.
        // Deleting is correct and costs no model call next time.
        await this.state.storage.delete(sk);
      } else {
        // ⚠️ KEPT. The next sweep tries again.
        out.ok = false;
      }
    }
    return out;
  }

  /**
   * ⚠️ **THE PERSONA FOR THIS TURN** — picked on a fresh conversation, advanced
   * (and occasionally drifted one step) on every turn after.
   *
   * ⚠️ Resolved and PERSISTED here rather than in `mention-flow.ts` because this
   * is the only place with storage. It rides the same round trip as everything
   * else the turn needs, so personality costs one storage read and at most one
   * write.
   *
   * ⚠️ A PIN short-circuits both the pick and the drift — `advancePersona` and
   * `pickTrope` each check it — so "pinned means pinned" is enforced in the
   * arithmetic rather than by a branch here that could be forgotten.
   */
  private async personaTurn(userId: string, freshConversation: boolean): Promise<PersonaState | null> {
    if (!personalityOn(this.env)) return null;
    const stored = (await this.state.storage.get<PersonaState>(kUserPersona(userId))) ?? null;
    const pinned = stored?.pinned && isTrope(stored.pinned) ? stored.pinned : undefined;
    const now = Date.now();

    const next =
      !stored || freshConversation
        ? freshPersona(pickTrope({ pinned }), now, pinned)
        : advancePersona(stored, Math.random, now);

    // ⚠️ Written only when something actually changed. A turn that neither
    // re-picked nor drifted still bumps `exchanges`, which is a change worth
    // one small write — the drift counter is the whole gradualness mechanism
    // and an uncounted exchange would stall it.
    await this.state.storage.put(kUserPersona(userId), next);
    return next;
  }

  /** Set or clear the hidden pin. ⚠️ Applying a pin takes effect IMMEDIATELY —
   *  the trope becomes the pinned one on the same turn, because somebody who
   *  just asked her to be tsundere should get a tsundere reply, not a tsundere
   *  reply next time. */
  private async personaPin(userId: string, trope: Trope | null): Promise<PersonaState | null> {
    if (!personalityOn(this.env)) return null;
    const now = Date.now();
    const stored = (await this.state.storage.get<PersonaState>(kUserPersona(userId))) ?? null;
    const next: PersonaState = trope
      ? { trope, exchanges: stored?.exchanges ?? 0, since: now, pinned: trope }
      : { trope: stored?.trope ?? pickTrope(), exchanges: stored?.exchanges ?? 0, since: stored?.since ?? now };
    await this.state.storage.put(kUserPersona(userId), next);
    return next;
  }

  /** The store, as `mention-flow.ts` wants it — bound to one key. */
  private conversationFor(key: ConversationKey): ConversationDeps {
    return {
      load: () => this.convLoad(key),
      save: (entry) => this.convSave(key, entry),
    };
  }

  /**
   * `POST /conv/load` and `POST /conv/save`, for the HTTP interactions endpoint
   * — the ONE path that needs this memory from outside the object.
   *
   * ⚠️ `/conv/load` answers the CAP VERDICT too, in the same round trip. Two
   * stub fetches to decide one button press would be two subrequests for facts
   * that live one field apart in the same storage.
   */
  private async conversationDoor(path: string, request: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ ok: false, why: 'unreadable_body' }, { status: 400 });
    }
    const s = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
    const key = conversationKey(s('surface'), s('space'), s('person'));
    if (!key.surface || !key.space || !key.person) {
      return Response.json({ ok: false, why: 'incomplete_key' }, { status: 400 });
    }

    if (path === '/conv/load') {
      const memory = await this.convLoad(key);
      return Response.json({
        ok: true,
        ...memory,
        cap: await this.capCheck(key.person),
        // ⚠️ TIER 1: the WRITE fuse rides the same round trip as the turn fuse,
        // for the same reason the turn fuse rides the load — they live one key
        // apart in the same storage, and a press that may write needs both.
        writeCap: await this.writeCapCheck(key.person),
        // ⚠️ TIER 0b: the DOCS fuse rides the same round trip as the other two,
        // for the same reason — all three live a key apart in the same storage,
        // and a press that may read the corpus needs all three.
        docsCap: await this.docsCapCheck(key.person),
        // ⚠️ TIER 0c: the BOOK fuse rides the same round trip as the other
        // three, for the fourth time and the same reason — four keys, one read.
        booksCap: await this.booksCapCheck(key.person),
      });
    }

    // ⚠️ Counting is its OWN route, not a flag on the save. Folding them
    // together would couple "she said something" to "it counted against the
    // cap", and the first save that should not count would make the fuse lie.
    if (path === '/conv/count') {
      await this.recordTurn(key.person);
      return Response.json({ ok: true });
    }

    // ⚠️ And the write counter is its own route again, for the same reason
    // once more: a turn and a write are different events, and a press that
    // writes is exactly one of each.
    if (path === '/conv/wcount') {
      await this.recordWrite(key.person);
      return Response.json({ ok: true });
    }

    // ⚠️ And the docs counter is its own route again, for the third time and the
    // same reason: a turn, a write and a docs read are three different events,
    // and a turn that answered from the corpus is one of each of two of them.
    if (path === '/conv/dcount') {
      await this.recordDocsTurn(key.person);
      return Response.json({ ok: true });
    }

    // ⚠️ And the book counter is its own route for the fourth time. A turn, a
    // write, a docs read and a book read are four different events.
    if (path === '/conv/bcount') {
      await this.recordBooksTurn(key.person);
      return Response.json({ ok: true });
    }

    await this.convSave(key, {
      user: s('user'),
      assistant: s('assistant'),
      pending: (body['pending'] as PendingChoice | null) ?? null,
    });
    return Response.json({ ok: true });
  }

  // -------------------------------------------------------------------------
  // The self-heal. This, not the constructor, is what makes the bot durable.
  // -------------------------------------------------------------------------

  async alarm(): Promise<void> {
    if (!mentionsOn(this.env)) {
      // Posture flipped off under a live alarm: stand down completely rather
      // than looping forever on a switch somebody turned off deliberately.
      await this.disconnect('posture is off');
      return;
    }
    const fatal = await this.state.storage.get<string>(K_FATAL);
    if (fatal) {
      console.error(
        `GABI gateway: standing down and NOT reconnecting — ${fatal}. This needs a person: check ` +
          'DISCORD_BOT_TOKEN and the requested intents, then POST /admin/gateway/start to clear it.',
      );
      return; // ⚠️ deliberately no reschedule: a hot loop on a bad token helps nobody.
    }
    await this.ensureConnected();
    await this.ensureAlarm();
  }

  private async ensureAlarm(): Promise<void> {
    const existing = await this.state.storage.getAlarm();
    if (existing === null) await this.state.storage.setAlarm(Date.now() + ALARM_MS);
  }

  // -------------------------------------------------------------------------
  // The connection
  // -------------------------------------------------------------------------

  private async ensureConnected(): Promise<void> {
    if (this.ws || this.connecting) return;
    this.connecting = true;
    try {
      await this.connect();
    } catch (err) {
      console.error('GABI gateway: connect failed:', err instanceof Error ? err.message : err);
      this.teardown();
    } finally {
      this.connecting = false;
    }
  }

  private async connect(): Promise<void> {
    const botToken = this.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      console.error(
        'GABI gateway: DISCORD_BOT_TOKEN is not set on the Worker, so no connection was attempted. ' +
          'A configuration gap, not a Discord problem — see docs/access/discord-bot.md §2.',
      );
      return;
    }

    if (!(await this.spendIdentifyBudget())) return;

    this.sessionId ??= (await this.state.storage.get<string>(K_SESSION)) ?? null;
    this.seq ??= (await this.state.storage.get<number>(K_SEQ)) ?? null;
    this.resumeUrl ??= (await this.state.storage.get<string>(K_RESUME_URL)) ?? null;

    // Resuming uses the URL READY handed back; a fresh identify asks Discord
    // where to go. `/gateway/bot` also reports the remaining session starts,
    // which is worth a log line when it gets low.
    let base = this.sessionId ? this.resumeUrl : null;
    if (!base) {
      const info = await getGatewayBot(botToken);
      if (!info) {
        console.error('GABI gateway: Discord would not tell us the gateway URL; will retry on the next alarm.');
        return;
      }
      if (info.remainingStarts !== null && info.remainingStarts < 50) {
        console.error(`GABI gateway: only ${info.remainingStarts} Discord session starts left today.`);
      }
      base = info.url;
    }

    // ⚠️ Workers open an OUTBOUND socket with a fetch upgrade, and that fetch
    // needs an http(s) scheme. Discord hands back `wss://`. Do not "fix" this
    // back to wss — it fails with a scheme error that reads like a network fault.
    const url = `${base.replace(/^ws/, 'http').replace(/\/+$/, '')}/?v=10&encoding=json`;
    const res = await fetch(url, { headers: { Upgrade: 'websocket' } });
    const socket = res.webSocket;
    if (!socket) {
      console.error(`GABI gateway: Discord refused the WebSocket upgrade (HTTP ${res.status}).`);
      return;
    }
    socket.accept();
    this.ws = socket;
    this.awaitingAck = false;

    socket.addEventListener('message', (event: MessageEvent) => {
      void this.onFrame(event.data, botToken).catch((err) =>
        console.error('GABI gateway: frame handling failed:', err instanceof Error ? err.message : err),
      );
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      void this.onClose(event.code, event.reason);
    });
    socket.addEventListener('error', () => {
      console.error('GABI gateway: socket error; treating as a disconnect.');
      this.teardown();
    });
  }

  /** ⚠️ The flap guard. Identifies are a bounded daily resource; spending them
   * on a loop is how a self-healing design becomes a self-harming one. */
  private async spendIdentifyBudget(): Promise<boolean> {
    const today = utcDayKey(Date.now());
    const stored = (await this.state.storage.get<IdentifyBudget>(K_IDENTIFIES)) ?? { day: today, count: 0 };
    const budget: IdentifyBudget = stored.day === today ? stored : { day: today, count: 0 };
    if (budget.count >= MAX_IDENTIFIES_PER_DAY) {
      console.error(
        `GABI gateway: ${budget.count} connection attempts today has hit the self-imposed ceiling of ` +
          `${MAX_IDENTIFIES_PER_DAY}. Standing down until the UTC day rolls over — something is flapping.`,
      );
      return false;
    }
    budget.count += 1;
    await this.state.storage.put(K_IDENTIFIES, budget);
    return true;
  }

  private send(payload: unknown): void {
    try {
      this.ws?.send(JSON.stringify(payload));
    } catch (err) {
      console.error('GABI gateway: send failed:', err instanceof Error ? err.message : err);
      this.teardown();
    }
  }

  private async onFrame(raw: unknown, botToken: string): Promise<void> {
    if (typeof raw !== 'string') return;
    let frame: { op?: unknown; d?: unknown; s?: unknown; t?: unknown };
    try {
      frame = JSON.parse(raw) as typeof frame;
    } catch {
      return;
    }
    // ⚠️ The sequence number is held in MEMORY on every frame and written to
    // storage only on a heartbeat (~41 s) — see `beat()`. Writing it per frame
    // was the first implementation and it is a real defect on this account:
    // every message in every channel of every guild the bot is in would be a
    // Durable Object row write, against a **100,000 rows/day** free-plan
    // ceiling, for a value that is only ever READ after an eviction. The cost
    // of the cheaper version is bounded and stated: after an eviction the
    // resume replays from a seq up to one heartbeat stale, so a handful of
    // already-answered messages can be replayed.
    if (typeof frame.s === 'number') this.seq = frame.s;

    switch (frame.op) {
      case OP.HELLO: {
        const interval = (frame.d as { heartbeat_interval?: unknown } | null)?.heartbeat_interval;
        const ms = typeof interval === 'number' && interval > 1000 ? interval : 41_250;
        // Documented contract: the FIRST heartbeat waits interval × jitter, so
        // every bot on the planet does not beat in lockstep.
        setTimeout(() => this.beat(), Math.floor(ms * Math.random()));
        this.heartbeat = setInterval(() => this.beat(), ms);
        if (this.sessionId && this.seq !== null) {
          this.send({ op: OP.RESUME, d: { token: botToken, session_id: this.sessionId, seq: this.seq } });
        } else {
          this.send({
            op: OP.IDENTIFY,
            d: {
              token: botToken,
              intents: GATEWAY_INTENTS,
              properties: { os: 'cloudflare', browser: 'estate-discord', device: 'estate-discord' },
            },
          });
        }
        return;
      }

      case OP.HEARTBEAT:
        // Discord may ask for one out of band; answering is the contract.
        this.beat();
        return;

      case OP.HEARTBEAT_ACK:
        this.awaitingAck = false;
        return;

      case OP.RECONNECT:
        await this.onClose(4000, 'Discord asked us to reconnect');
        return;

      case OP.INVALID_SESSION:
        // `d: true` means the session is resumable after a short wait; anything
        // else means start over. Either way the socket is finished.
        if (frame.d !== true) await this.forgetSession();
        await this.onClose(4009, 'invalid session');
        return;

      case OP.DISPATCH:
        await this.onDispatch(String(frame.t ?? ''), frame.d, botToken);
        return;

      default:
        return;
    }
  }

  private beat(): void {
    if (!this.ws) return;
    if (this.awaitingAck) {
      // A missed ACK is a zombie connection — the documented response is to
      // close and reconnect rather than keep talking into a dead pipe.
      console.error('GABI gateway: no heartbeat ACK; recycling the connection.');
      void this.onClose(4000, 'heartbeat not acknowledged');
      return;
    }
    this.awaitingAck = true;
    this.send({ op: OP.HEARTBEAT, d: this.seq });
    // The one place the sequence is persisted — once per heartbeat rather than
    // once per frame (see `onFrame`). Fire-and-forget: a failed write costs a
    // slightly staler resume, never a missed heartbeat.
    if (this.seq !== null) void this.state.storage.put(K_SEQ, this.seq).catch(() => {});
  }

  private async onDispatch(type: string, data: unknown, botToken: string): Promise<void> {
    if (type === 'READY') {
      const d = (data ?? {}) as { session_id?: unknown; resume_gateway_url?: unknown };
      this.sessionId = typeof d.session_id === 'string' ? d.session_id : null;
      this.resumeUrl = typeof d.resume_gateway_url === 'string' ? d.resume_gateway_url : null;
      await this.state.storage.put(K_LAST_READY, new Date().toISOString());
      if (this.sessionId) await this.state.storage.put(K_SESSION, this.sessionId);
      if (this.resumeUrl) await this.state.storage.put(K_RESUME_URL, this.resumeUrl);
      console.log(
        `GABI gateway: READY. Listening on unprivileged intents ${GATEWAY_INTENTS} ` +
          '(GUILDS | GUILD_MESSAGES); Message Content is NOT requested.',
      );
      return;
    }
    if (type === 'RESUMED') {
      console.log('GABI gateway: RESUMED — Discord replayed whatever was missed.');
      return;
    }
    if (type !== 'MESSAGE_CREATE') return;

    const appId = this.env.DISCORD_APPLICATION_ID ?? '';
    const trigger = mentionTrigger((data ?? {}) as Record<string, unknown>, appId);
    if (trigger.kind === 'ignore') return;

    // ⚠️ The conversation key: (surface, space, person). The SPACE is the
    // channel, not the guild — two channels in one server are two
    // conversations, and a DM is its own space by construction. The PERSON is
    // the Discord user id, so two people talking to her in the same channel
    // never see each other's memory.
    // ⚠️ **PERSON-KEYED, NOT CHANNEL-KEYED** (owner order 2026-08-18; memory
    // design §11). One thread per person, wherever they talk to her — a DM and
    // every channel are the same conversation, so her memory and her personality
    // follow them instead of resetting at every door.
    //
    // ⚠️ The old channel-scoped records are simply never read again. With a
    // 30-minute window they are dead data within half an hour of this deploy,
    // and the distillation sweep deletes them — see `distillSweep`, which is the
    // whole migration.
    const key = conversationKey(PERSON_SURFACE, PERSON_SPACE, trigger.authorId);

    // ⚠️ TIER 1. `null` when the estate has not finished the wiring (no service
    // account, or no app token) — which is how "ships dark" is expressed here:
    // `mention-flow.ts` says a worded line and the read-only ladder is
    // untouched. The port is built per message rather than held on the object
    // because it closes over nothing worth keeping and a stale one would
    // outlive a secret rotation.
    const delegate = makeDelegate(this.env);

    // ⚠️ TIER 0b. `null` when the estate has not finished the wiring — no
    // service account, or no docs app token — which is how "ships dark" is
    // expressed here: the docs tools are never described to the model and every
    // other answer is untouched. Built per message rather than held on the
    // object because it memoises the asker's link lookup FOR ONE TURN, and a
    // port that outlived its turn would answer for the wrong person.
    const docsPort = makeDocsPort(this.env);

    // ⚠️ TIER 0c. `null` when the estate has not finished the wiring — no
    // service account, or no BOOK app token — which is how "ships dark" is
    // expressed here. Built per message for the same reason the docs port is:
    // it memoises the asker's link lookup FOR ONE TURN, and a port that outlived
    // its turn would answer for the wrong person.
    const booksPort = makeBooksPort(this.env);

    // ⚠️ TIER 2. `null` with no service account — the ships-dark state. Built per
    // message like the others; it holds no per-turn state worth keeping and a
    // cached OAuth token that outlived a secret rotation would fail every
    // profile read with no obvious cause.
    const memoryPort = makeMemoryPort(this.env);
    // ⚠️ TIER 0d. `null` with no service account — the ships-dark state. Built
    // per message because it memoises the asker's link lookup FOR ONE TURN, and
    // a port that outlived its turn would read the wrong person's shelf.
    const shelfPort = makeShelfPort(this.env);

    // ⚠️ **THE VOICE FOR THIS TURN**, resolved here because this is the only
    // place with storage. A conversation with no remembered turns is a FRESH one
    // and gets a new roll (or the pin); otherwise the existing trope is advanced
    // and may drift one step.
    const existing = await this.convLoad(key);
    const persona = await this.personaTurn(trigger.authorId, existing.turns.length === 0);

    await handleMention(
      {
        capCheck: (userId) => this.capCheck(userId),
        recordTurn: (userId) => this.recordTurn(userId),
        conversation: this.conversationFor(key),
        ...(delegate
          ? {
              delegated: {
                delegate,
                writeCapCheck: (userId: string) => this.writeCapCheck(userId),
                recordWrite: (userId: string) => this.recordWrite(userId),
              },
            }
          : {}),
        ...(docsPort
          ? {
              docs: {
                port: docsPort,
                capCheck: (userId: string) => this.docsCapCheck(userId),
                record: (userId: string) => this.recordDocsTurn(userId),
              },
            }
          : {}),
        ...(booksPort
          ? {
              books: {
                port: booksPort,
                capCheck: (userId: string) => this.booksCapCheck(userId),
                record: (userId: string) => this.recordBooksTurn(userId),
              },
            }
          : {}),
        ...(memoryPort ? { memory: memoryPort } : {}),
        ...(shelfPort ? { shelf: shelfPort } : {}),
        persona: {
          pin: async (userId: string, trope: Trope) => {
            await this.personaPin(userId, trope);
          },
          clear: async (userId: string) => {
            await this.personaPin(userId, null);
          },
        },
        reply: async (content, extra) => {
          const res = await replyToMessage(
            botToken,
            trigger.channelId,
            trigger.messageId,
            content,
            trigger.authorId,
            extra?.components ? { components: extra.components } : {},
          );
          if (!res.ok) {
            // 403 = not allowed to post there. A fact about that channel's
            // permissions, not a failure of the answer; named, never retried.
            console.error(`GABI gateway: Discord refused the reply (HTTP ${res.status}).`);
          }
        },
        // ⚠️ A NEW message rather than a reply to the original: the sweep's
        // report can land minutes later, and threading it onto a message that
        // has scrolled away is how a report goes unread. It pings the asker by
        // mention instead — the owner's own shape for it ("Hey @Sam i went
        // ahead and fixed all your missing stuff").
        followUp: async (content) => {
          const res = await createChannelMessage(botToken, trigger.channelId, {
            content,
            // Resolve ONLY the person who asked. Her report can carry a book
            // title containing anything at all, and a title must never become
            // a way to ping a server.
            allowed_mentions: { parse: [], users: [trigger.authorId] },
          });
          if (!res.ok) {
            console.error(`GABI gateway: Discord refused the follow-up (HTTP ${res.status}).`);
          }
        },
      },
      trigger,
      {
        indexBaseUrl: indexBase(this.env),
        panelUrl: panelDeepLink(panelBase(this.env)),
        catalogBaseUrl: catalogBase(this.env),
        instances: libraryInstances(this.env),
        delegatedWrites: delegatedWritesOn(this.env),
        docsEnabled: docsOn(this.env),
        booksEnabled: booksOn(this.env),
        memoryEnabled: memoryOn(this.env),
        shelfEnabled: shelfOn(this.env),
        ...(persona ? { personaBlock: personaBlock(persona.trope) } : {}),
        ...(this.env.ANTHROPIC_API_KEY_GABI ? { anthropicKey: this.env.ANTHROPIC_API_KEY_GABI } : {}),
      },
    );
  }

  private async onClose(code: number, reason: string): Promise<void> {
    this.teardown();
    if (FATAL_CLOSE_CODES.has(code)) {
      const why = `Discord closed the gateway with ${code} (${reason || 'no reason given'}), which is not retryable`;
      await this.state.storage.put(K_FATAL, why);
      await this.forgetSession();
      console.error(`GABI gateway: ${why}. NOT reconnecting.`);
      return;
    }
    if (SESSION_DEAD_CODES.has(code)) await this.forgetSession();
    console.log(`GABI gateway: closed with ${code} (${reason || 'no reason'}); the alarm will reconnect.`);
    await this.ensureAlarm();
  }

  private async forgetSession(): Promise<void> {
    this.sessionId = null;
    this.seq = null;
    this.resumeUrl = null;
    await this.state.storage.delete([K_SESSION, K_SEQ, K_RESUME_URL]);
  }

  /** In-memory only. Storage keeps whatever should survive an eviction. */
  private teardown(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    try {
      this.ws?.close(1000, 'estate gateway recycling');
    } catch {
      // Already closed. Nothing to do and nothing to report.
    }
    this.ws = null;
    this.awaitingAck = false;
  }

  private async disconnect(why: string): Promise<void> {
    if (this.ws) console.log(`GABI gateway: disconnecting — ${why}.`);
    this.teardown();
    await this.forgetSession();
  }

  // -------------------------------------------------------------------------
  // The caps live here because this object is the ONE place every mention
  // passes through — which is exactly what makes a rolling window possible
  // without a database.
  // -------------------------------------------------------------------------

  private async capCheck(userId: string): Promise<CapVerdict> {
    const now = Date.now();
    const times = pruneWindow((await this.state.storage.get<number[]>(kUserCap(userId))) ?? [], now);
    const global = (await this.state.storage.get<GlobalCap>(K_GLOBAL_CAP)) ?? { day: utcDayKey(now), count: 0 };
    const todayCount = global.day === utcDayKey(now) ? global.count : 0;
    return capDecision({ userInWindow: times.length, globalToday: todayCount });
  }

  private async recordTurn(userId: string): Promise<void> {
    const now = Date.now();
    const times = pruneWindow((await this.state.storage.get<number[]>(kUserCap(userId))) ?? [], now);
    times.push(now);
    await this.state.storage.put(kUserCap(userId), times);

    const day = utcDayKey(now);
    const global = (await this.state.storage.get<GlobalCap>(K_GLOBAL_CAP)) ?? { day, count: 0 };
    const next: GlobalCap = global.day === day ? { day, count: global.count + 1 } : { day, count: 1 };
    await this.state.storage.put(K_GLOBAL_CAP, next);
  }

  /**
   * ⚠️ **THE SECOND FUSE — writes, not turns** (Tier 1, 2026-08-18).
   *
   * A separate counter in a separate key namespace (`wcap:`), because the two
   * caps protect different things over different horizons: a turn is fractions
   * of a cent and forgiven in an hour, while a write is a row in somebody's
   * catalog and ~2¢ of research on their key, neither of which an hour undoes.
   * A single shared counter would either make twenty answers cost the write
   * budget or make twenty writes cheap — both wrong.
   *
   * ⚠️ **A day KEY rather than a rolling window**, deliberately unlike
   * `pruneWindow` above: a rolling list of write timestamps would grow one row
   * write per delegated call to store, and `{day, count}` is two numbers. UTC,
   * for `utcDayKey`'s stated reason — a DST-shifting reset is a bug waiting to
   * be filed.
   *
   * ⚠️ Storage adds at most **one row write per delegated call**, on top of the
   * ~2,500/day this object already accrues against 100,000 — and delegated
   * calls are themselves capped at 20 per person per day by this very counter.
   */
  private async writeCapCheck(userId: string): Promise<ReturnType<typeof writeCapDecision>> {
    const day = utcDayKey(Date.now());
    const stored = (await this.state.storage.get<GlobalCap>(kUserWriteCap(userId))) ?? { day, count: 0 };
    return writeCapDecision(stored.day === day ? stored.count : 0);
  }

  private async recordWrite(userId: string): Promise<void> {
    const day = utcDayKey(Date.now());
    const key = kUserWriteCap(userId);
    const stored = (await this.state.storage.get<GlobalCap>(key)) ?? { day, count: 0 };
    await this.state.storage.put(
      key,
      stored.day === day ? { day, count: stored.count + 1 } : { day, count: 1 },
    );
  }

  /**
   * ⚠️ **THE THIRD FUSE — docs turns, not turns and not writes** (Tier 0b,
   * 2026-08-18).
   *
   * Same `{day, count}` shape and same UTC day key as the write cap above,
   * deliberately: a rolling list of timestamps would cost a row write per docs
   * call to store, and two numbers do not. It is a separate counter because it
   * protects a separate thing — ≈6k input tokens of retrieved documentation per
   * turn, which an hour does not forgive and which has nothing to do with how
   * many books somebody looked up.
   *
   * ⚠️ Storage cost is at most **one row write per DOCS turn**, and docs turns
   * are themselves capped at 40 per person per day by this very counter. On top
   * of the ~2,500/day this object already accrues against 100,000, that is
   * noise. A turn that never touched the corpus performs no write at all —
   * `mention-flow.ts` only charges when the budget was actually used.
   */
  private async docsCapCheck(userId: string): Promise<ReturnType<typeof docsCapDecision>> {
    const day = utcDayKey(Date.now());
    const stored = (await this.state.storage.get<GlobalCap>(kUserDocsCap(userId))) ?? { day, count: 0 };
    return docsCapDecision(stored.day === day ? stored.count : 0);
  }

  private async recordDocsTurn(userId: string): Promise<void> {
    const day = utcDayKey(Date.now());
    const key = kUserDocsCap(userId);
    const stored = (await this.state.storage.get<GlobalCap>(key)) ?? { day, count: 0 };
    await this.state.storage.put(
      key,
      stored.day === day ? { day, count: stored.count + 1 } : { day, count: 1 },
    );
  }

  /**
   * ⚠️ **THE FOURTH FUSE — book turns, and it is not the docs fuse** (Tier 0c,
   * 2026-08-18).
   *
   * Same `{day, count}` shape and same UTC day key as the three above. It is a
   * separate counter because it protects a separate thing: ≈6k input tokens of
   * somebody's NOVEL per turn, which is the surface the estate's *"I don't want
   * people scraping my books"* directive is about. A turn that never opened a
   * book performs no write at all — `mention-flow.ts` charges only when the
   * per-turn budget was actually used.
   */
  private async booksCapCheck(userId: string): Promise<ReturnType<typeof booksCapDecision>> {
    const day = utcDayKey(Date.now());
    const stored = (await this.state.storage.get<GlobalCap>(kUserBooksCap(userId))) ?? { day, count: 0 };
    return booksCapDecision(stored.day === day ? stored.count : 0);
  }

  private async recordBooksTurn(userId: string): Promise<void> {
    const day = utcDayKey(Date.now());
    const key = kUserBooksCap(userId);
    const stored = (await this.state.storage.get<GlobalCap>(key)) ?? { day, count: 0 };
    await this.state.storage.put(
      key,
      stored.day === day ? { day, count: stored.count + 1 } : { day, count: 1 },
    );
  }
}

// ---------------------------------------------------------------------------
// The one address
// ---------------------------------------------------------------------------

/** ⚠️ A SINGLE named instance, deliberately. Discord's gateway is one
 * connection per bot (per shard, and one shard is ample at estate scale); a
 * per-guild or per-request object would open one socket per caller and get the
 * bot rate-limited into a ban. Everything routes through this name. */
export const GATEWAY_OBJECT_NAME = 'discord-gateway';

export function gatewayStub(env: Pick<Env, 'GABI_GATEWAY'>): DurableObjectStub | null {
  if (!env.GABI_GATEWAY) return null;
  return env.GABI_GATEWAY.get(env.GABI_GATEWAY.idFromName(GATEWAY_OBJECT_NAME));
}
