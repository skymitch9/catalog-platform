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
  PERSONA_ROSTER_MAX,
  type PersonaRosterRow,
  type PersonaWriter,
  isTrope,
  personalityOn,
  personaBlock,
  PERSON_SPACE,
  PERSON_SURFACE,
  pickTrope,
  type PersonaState,
  type Trope,
} from './personality.js';
import { makeArchivePort, makeMemoryPort } from './memory-exec.js';
import { shelfOn } from './shelf.js';
import { suggestOn } from './suggest.js';
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
  MENTION_MSG,
  mentionsOn,
  mentionTrigger,
  pruneWindow,
  utcDayKey,
  type CapVerdict,
} from './mentions.js';
import { TURN_WATCHDOG_MS, withDeadline } from './deadline.js';
import {
  newTurnTrace,
  pushTurnLog,
  turnLogForDisplay,
  TURN_LOG_ROWS,
  type TurnLogEntry,
} from './turnlog.js';
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
 * ⚠️ **HOW LONG A FATAL CLOSE HOLDS BEFORE ONE MORE TRY.**
 *
 * One hour: long enough that a genuinely bad token costs 24 attempts a day
 * rather than a hot loop, short enough that a transient — a deploy-race
 * handshake, a Discord hiccup — heals itself before anybody has to be woken.
 * See `fatalHold()` for why "for ever" was the wrong number.
 */
export const FATAL_RETRY_MS = 60 * 60 * 1000;

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
/** When the last post-fatal reconnect was ATTEMPTED — the backoff's clock. */
const K_FATAL_AT = 'gw:fatal_at';
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

/**
 * ⚠️ **THE RECENT TURN RING — ONE key, one row, rewritten per taken turn.**
 * `turnlog.ts` carries the incident it was built for and the write-budget
 * arithmetic. A prefix of many keys was rejected: forty small rows would be
 * forty deletes to prune, where one bounded array is one write.
 */
const K_TURN_LOG = 'gw:turnlog';

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

    // ⚠️ THE RECENT TURN RING — read-only, and it sits with the routes above
    // rather than below the `/start` fallthrough for exactly their reason: a
    // devops reader opening a diagnostic page must not OPEN A GATEWAY WEBSOCKET
    // as a side effect of looking. (`/conv/dcount` and `/conv/bcount` were
    // missing from that list once already; this is the same trap.)
    //
    // ⚠️ **THE AUTHORITY CHECK IS NOT HERE.** A Durable Object stub is reachable
    // only from this Worker's own code, and the gate belongs on the HTTP route
    // in `index.ts` — a check performed by the thing being protected is a check
    // that can be skipped.
    if (path === '/turnlog') {
      const ring = (await this.state.storage.get<TurnLogEntry[]>(K_TURN_LOG)) ?? [];
      return Response.json({
        ok: true,
        rows: turnLogForDisplay(ring),
        kept: TURN_LOG_ROWS,
        // ⚠️ **"CHANNELS I HAVE ACTUALLY HEARD FROM" — the 2026-08-18 lesson.**
        //
        // An entire evening went into hunting a bug that did not exist: the
        // silent questions were asked in a channel **the bot is not a member
        // of**, so Discord never delivered them and every instrument in the
        // estate correctly saw nothing. From inside that channel it is
        // indistinguishable from a dead bot, unless somebody thinks to ask *"is
        // she even in that room?"*.
        //
        // This is the cheapest honest answer to that question. ⚠️ It is NOT a
        // membership list — it cannot be, without asking Discord — and
        // `channels_note` says so, because a list that looked authoritative
        // would only replace one wrong conclusion with another.
        channels_heard: [
          ...new Set(ring.map((r) => r.channel).filter((c): c is string => Boolean(c))),
        ],
        channels_note:
          'These are channels this ring has HEARD a turn from — not a membership list. ⚠️ If a ' +
          'channel is missing, the likeliest explanation is that the bot is not in it: without the ' +
          'Message Content intent Discord delivers only messages that mention her, and it delivers ' +
          'nothing at all from a channel she has not been added to. That looks exactly like a ' +
          'broken bot from inside the channel, and the fix is a server setting rather than code.',
        // ⚠️ Said out loud, because an empty list must never be read as "she has
        // answered nobody". A fresh deploy looks exactly the same — the ring
        // lives in this object and starts empty.
        note:
          ring.length === 0
            ? 'The ring is live and holds nothing yet. That is not the same as "no turns have ' +
              'happened": it is also what the first minutes after a deploy look like, because the ' +
              'ring lives in the gateway object and starts empty.'
            : null,
      });
    }

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
   *  reply next time.
   *
   *  ⚠️ **`writer` is recorded with the pin** (2026-08-18, the devops set/clear
   *  order). `self` is somebody choosing their own voice; `devops:<id>` is an
   *  operator setting somebody else's. The ROSTER prints the difference, which
   *  is the only reason it is stored — and a CLEAR drops it, because a drifting
   *  persona has no author.
   *
   *  ⚠️ **Last-write-wins, deliberately and identically to a self-pin.** A
   *  devops pin is not a stronger kind of pin: the owner's semantics are "the
   *  same as if they had done it themselves", so a person may un-pin what an
   *  operator set, exactly as they could un-pin their own. */
  private async personaPin(
    userId: string,
    trope: Trope | null,
    writer: PersonaWriter = 'self',
  ): Promise<PersonaState | null> {
    if (!personalityOn(this.env)) return null;
    const now = Date.now();
    const stored = (await this.state.storage.get<PersonaState>(kUserPersona(userId))) ?? null;
    const next: PersonaState = trope
      ? { trope, exchanges: stored?.exchanges ?? 0, since: now, pinned: trope, writer, pinnedAt: now }
      : { trope: stored?.trope ?? pickTrope(), exchanges: stored?.exchanges ?? 0, since: stored?.since ?? now };
    await this.state.storage.put(kUserPersona(userId), next);
    return next;
  }

  /**
   * ⚠️ **THE PERSONA AS STORED, READ IN THE TURN THAT ANSWERS.**
   *
   * She must never say what she is being from what she said earlier in the
   * conversation — the same availability-grounding rule the book listing carries
   * in capitals, applied to herself. This is one storage read on a turn that
   * has already made several.
   */
  private async personaRead(userId: string): Promise<PersonaState | null> {
    if (!personalityOn(this.env)) return null;
    return (await this.state.storage.get<PersonaState>(kUserPersona(userId))) ?? null;
  }

  /**
   * ⚠️ **EVERY PERSONA ON RECORD** — the devops roster, read live from state.
   *
   * ⚠️ **NO AUTHORITY CHECK HAPPENS HERE.** The caller has already asked the
   * estate whether this person is devops-class, and a check performed by the
   * thing being protected is a check that can be skipped. This method's whole
   * contract is "list what is stored".
   *
   * ⚠️ **BOUNDED.** A `list()` with no cap is an unbounded read on an object
   * whose storage grows with the server's membership; the roster is a human
   * artefact and a hundred rows is already more than anybody reads. A truncated
   * list would lie by omission, so the CAP IS STATED where it bites — the caller
   * shows the count it received beside the rows.
   */
  private async personaRoster(): Promise<PersonaRosterRow[]> {
    if (!personalityOn(this.env)) return [];
    const prefix = kUserPersona('');
    const found = await this.state.storage.list<PersonaState>({ prefix, limit: PERSONA_ROSTER_MAX });
    const rows: PersonaRosterRow[] = [];
    for (const [key, state] of found) {
      const discordUserId = key.slice(prefix.length);
      // ⚠️ A stored shape from an older version must not throw. An unreadable
      // row is SKIPPED rather than guessed at — a roster with an invented trope
      // in it is worse than a roster one line short.
      if (!discordUserId || !state || !isTrope(state.trope)) continue;
      rows.push({ discordUserId, state });
    }
    return rows;
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
    // ⚠️ **THE FATAL FLAG BACKS OFF; IT NO LONGER GIVES UP FOR EVER.**
    // `fatalHold()` decides, and its header carries the reasoning.
    const hold = await this.fatalHold();
    if (hold.holding) {
      console.error(
        `GABI gateway: holding after a fatal close — ${hold.why}. Next attempt in about ` +
          `${Math.max(1, Math.round(hold.retryInMs / 60_000))} minute(s). If this repeats hourly it ` +
          'is a real configuration break: check DISCORD_BOT_TOKEN and that the portal still grants ' +
          `intents ${GATEWAY_INTENTS}.`,
      );
      // ⚠️ RESCHEDULED, unlike before. The alarm chain is what carries the retry,
      // so standing down WITHOUT one is precisely what made "wait for a human"
      // permanent — the object had nothing left to wake it.
      await this.state.storage.setAlarm(Date.now() + Math.min(hold.retryInMs, FATAL_RETRY_MS));
      return;
    }
    await this.ensureConnected();
    await this.ensureAlarm();
  }

  /**
   * ⚠️ **WHY THE FATAL FLAG STOPPED BEING PERMANENT (2026-08-18).**
   *
   * The old contract: a 4004/4014-class close set a flag, the object stopped
   * reconnecting **for ever**, and only `POST /admin/gateway/start` — which needs
   * an estate admin's Firebase ID token — could clear it. That is a reasonable
   * design for a service with an on-call rota. It is the wrong design for a
   * **household bot**, and tonight demonstrated why: the household watched her be
   * unreachable while every restart path required a credential nobody awake could
   * mint.
   *
   * ⚠️ **THE HAMMERING PROTECTION IS KEPT; THE PERMANENCE IS NOT.** A genuinely
   * broken token now costs **24 gentle attempts a day** against this object's own
   * ceiling of 400 identifies — noise — while a transient self-heals within the
   * hour with nobody involved. A bot that retries once an hour is strictly better
   * than a bot that stays dead until somebody with credentials wakes up.
   *
   * ⚠️ The cause is KEPT and re-reported on every attempt, so a real break still
   * reaches a person — in words, on a schedule, instead of as silence.
   */
  private async fatalHold(): Promise<
    { holding: false } | { holding: true; why: string; retryInMs: number }
  > {
    const why = await this.state.storage.get<string>(K_FATAL);
    if (!why) return { holding: false };
    const lastAt = (await this.state.storage.get<number>(K_FATAL_AT)) ?? 0;
    const due = lastAt + FATAL_RETRY_MS;
    const now = Date.now();
    if (now >= due) {
      // ⚠️ The attempt is STAMPED BEFORE it is made, never after. Stamping after
      // would let a connect that hangs leave the object retrying in a tight loop
      // — trading a bot that never retries for one that never stops.
      await this.state.storage.put(K_FATAL_AT, now);
      console.error(
        `GABI gateway: retrying after a fatal close — ${why}. This is the hourly backoff, not a ` +
          'clean state; the flag clears only when a connection actually succeeds.',
      );
      return { holding: false };
    }
    return { holding: true, why, retryInMs: due - now };
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

  /**
   * ⚠️ **NO TAKEN TURN MAY END IN SILENCE — the 2026-08-18 rule.**
   *
   * `onFrame` catches whatever escapes this method and LOGS it, and a log is
   * not a channel. So everything from the moment a message is recognised as a
   * question is wrapped: a throw anywhere in the setup (a malformed service
   * account, a storage blip, a port constructor) now produces a worded line in
   * the channel and a `silent`/`error` row in the ring, instead of a person
   * staring at nothing and asking *"did you turn her off?"*.
   */
  private async onDispatch(type: string, data: unknown, botToken: string): Promise<void> {
    try {
      await this.dispatchInner(type, data, botToken);
    } catch (err) {
      console.error(
        'GABI gateway: a dispatch threw OUTSIDE the mention handler — this is the silent-turn class:',
        err instanceof Error ? err.message : err,
      );
      const channelId = (((data ?? {}) as { channel_id?: unknown }).channel_id ?? '') as string;
      const authorId = ((((data ?? {}) as { author?: { id?: unknown } }).author ?? {}).id ?? '') as string;
      await this.recordTurnLog({
        at: Date.now(),
        person: typeof authorId === 'string' ? authorId : '',
        via: 'mention',
        outcome: 'error',
        ...(typeof channelId === 'string' && channelId ? { channel: channelId } : {}),
        why: 'dispatch_threw',
      }).catch(() => {});
      // ⚠️ Only for a message that was actually addressed to her. Speaking into
      // a channel because an unrelated frame threw would be worse than silence.
      if (type === 'MESSAGE_CREATE' && typeof channelId === 'string' && channelId) {
        const trigger = mentionTrigger(
          (data ?? {}) as Record<string, unknown>,
          this.env.DISCORD_APPLICATION_ID ?? '',
        );
        if (trigger.kind === 'ask') {
          await createChannelMessage(botToken, channelId, {
            content: MENTION_MSG.unreachable,
            allowed_mentions: { parse: [], users: [trigger.authorId] },
          }).catch(() => {});
        }
      }
    }
  }

  private async dispatchInner(type: string, data: unknown, botToken: string): Promise<void> {
    if (type === 'READY') {
      const d = (data ?? {}) as { session_id?: unknown; resume_gateway_url?: unknown };
      this.sessionId = typeof d.session_id === 'string' ? d.session_id : null;
      this.resumeUrl = typeof d.resume_gateway_url === 'string' ? d.resume_gateway_url : null;
      await this.state.storage.put(K_LAST_READY, new Date().toISOString());
      // ⚠️ **A SUCCESSFUL HANDSHAKE IS THE ONLY THING THAT CLEARS THE FLAG.**
      // Not a deploy, not the passage of time, not somebody pressing a button —
      // the one event that actually proves the cause is gone. This is what makes
      // the hourly backoff self-healing rather than merely quieter.
      if (await this.state.storage.get<string>(K_FATAL)) {
        console.log('GABI gateway: connected after a fatal close — clearing the flag.');
        await this.state.storage.delete(K_FATAL);
        await this.state.storage.delete(K_FATAL_AT);
      }
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
    if (trigger.kind === 'ignore') {
      // ⚠️ **THE `why` USED TO BE COMPUTED AND THROWN AWAY**, and that is half of
      // why the 7:28 PM silence could not be investigated. `mentionTrigger`
      // names its reason precisely — `empty_question`, `message_type_21`,
      // `author_is_bot` — and this line dropped it on the floor.
      //
      // ⚠️ **`not_mentioned` IS THE ONE THAT MUST STAY SILENT.** It is every
      // ordinary message in every channel she sits in; recording it would put
      // the whole server's traffic pattern into a ring, which is the opposite of
      // this estate's posture and would evict the forty rows that matter within
      // seconds. Every OTHER reason means *she was addressed and declined*,
      // which is exactly the thing somebody will one day need to see.
      // ⚠️ **AND `not_mentioned` IS LOGGED TOO WHEN THE MESSAGE LOOKS ADDRESSED
      // TO HER** — added 2026-08-19, because the blanket exemption above was
      // hiding the exact turns under investigation.
      //
      // Four asks of one question died with NO trace at all, including two AFTER
      // the watchdog deploy — so the death is UPSTREAM of `gabi_dispatch_taken`,
      // and this branch is the only silent thing upstream of it.
      //
      // ⚠️ **THE FILTER IS FREE, BECAUSE THIS BOT HAS NO MESSAGE CONTENT
      // INTENT.** Discord sends `content` ONLY for messages that mention her,
      // replies with the ping on, and DMs — so a non-empty `content` already
      // means *she was addressed*. Every ordinary channel message arrives with
      // an empty string and stays unlogged, which is what keeps this a
      // diagnostic rather than a transcript of the server's traffic.
      //
      // ⚠️ **SHAPE ONLY — NEVER THE TEXT.** Lengths, counts and booleans. The
      // content promise in `gabi-bare-text-triggers-memo.md` §6.2 is not spent
      // on debugging, however badly we want the answer.
      const raw = (data ?? {}) as {
        content?: unknown;
        mentions?: unknown;
        type?: unknown;
        message_reference?: unknown;
        referenced_message?: { author?: { id?: unknown } };
      };
      const contentLen = typeof raw.content === 'string' ? raw.content.length : 0;
      const looksAddressed =
        contentLen > 0 || Boolean(raw.message_reference) || trigger.why !== 'not_mentioned';
      if (looksAddressed) {
        console.log(
          JSON.stringify({
            evt: 'gabi_ignored',
            why: trigger.why,
            // ⚠️ These five fields are the whole hypothesis space for a silent
            // ignore: she was not in `mentions`, the token was missing from the
            // text, the message type was unanswerable, or it was a reply whose
            // ping had been removed (in which case Discord delivers NO content
            // and she is structurally blind to it — wrangler.toml documents that
            // as a known limit, and this is how it stops being invisible).
            content_len: contentLen,
            mentions_count: Array.isArray(raw.mentions) ? raw.mentions.length : 0,
            msg_type: typeof raw.type === 'number' ? raw.type : null,
            is_reply: Boolean(raw.message_reference),
            replied_to_me:
              String((raw.referenced_message?.author?.id as string | undefined) ?? '') === appId,
            at: new Date().toISOString(),
          }),
        );
        await this.recordTurnLog({
          at: Date.now(),
          person: '',
          via: 'ignored',
          outcome: 'ignored',
          why: trigger.why,
        });
      }
      return;
    }

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
    // ⚠️ TIER 3 + 4. Built per message like the others, and `null` with no
    // service account — the ships-dark state. It shares `GABI_MEMORY`'s posture
    // by the design's own choice (§9), so nothing new has to be switched on.
    const archivePort = makeArchivePort(this.env);
    // ⚠️ TIER 0d. `null` with no service account — the ships-dark state. Built
    // per message because it memoises the asker's link lookup FOR ONE TURN, and
    // a port that outlived its turn would read the wrong person's shelf.
    const shelfPort = makeShelfPort(this.env);

    // ⚠️ **THE VOICE FOR THIS TURN**, resolved here because this is the only
    // place with storage. A conversation with no remembered turns is a FRESH one
    // and gets a new roll (or the pin); otherwise the existing trope is advanced
    // and may drift one step.
    //
    // ⚠️ **BOTH READS DEGRADE RATHER THAN THROW, AND THAT IS A SILENCE FIX.**
    // These two awaits sit OUTSIDE `handleMention`'s own try/catch, and
    // `onFrame` only logs what escapes — so before 2026-08-18 a transient
    // storage error in either one produced **no reply at all**, which is exactly
    // the shape of the 7:28 PM complaint. Neither is load-bearing: without the
    // history she starts the conversation fresh, and without the persona she
    // talks in her default voice. An answer in the wrong voice beats no answer.
    const existing = await this.convLoad(key).catch((err) => {
      console.error(
        'GABI gateway: the conversation could not be read; answering WITHOUT history rather than ' +
          'not answering:',
        err instanceof Error ? err.message : err,
      );
      return { turns: [], pending: null } as Awaited<ReturnType<GabiGateway['convLoad']>>;
    });
    const persona = await this.personaTurn(trigger.authorId, existing.turns.length === 0).catch(
      (err) => {
        console.error(
          'GABI gateway: the persona could not be resolved; answering in the default voice:',
          err instanceof Error ? err.message : err,
        );
        return null;
      },
    );

    // ⚠️ ONE BAG PER TURN. Everything the ring records comes from here, and
    // nothing in it can fail a turn — see `turnlog.ts`.
    const trace = newTurnTrace();
    const startedAt = Date.now();

    // ── ⚠️ THE WIRE-TAP LINE — one log, at the moment the turn is TAKEN ──────
    //
    // ⚠️ **TONIGHT'S TAIL FAILED BECAUSE THE HAPPY PATH LOGS NOTHING UNTIL THE
    // FIRST MODEL CALL.** A `wrangler tail` across the window of a reproducible
    // silent turn showed only alarm cycles — and that could not distinguish
    // between "the frame never arrived", "the handler ran and died early" and
    // "the tail cannot see this handler at all". Those are three different bugs
    // with three different fixes, and no instrument separated them.
    //
    // This line is emitted BEFORE anything that can throw, spend or block, so
    // its ABSENCE in a tail is now itself a finding: it means the frame did not
    // reach here. The `gabi_dispatch_done` line at the bottom of this method is
    // its pair — a `taken` with no `done` is a turn that died in between, and
    // the elapsed time says where to look.
    //
    // ⚠️ Log lines are free; Durable Object row writes are not. This is a
    // `console.log`, not a storage write — the ring is written ONCE at the end.
    // ⚠️ And it carries NO message text: an id, a door, a channel. The content
    // promise in `gabi-bare-text-triggers-memo.md` §6.2 is not spent on
    // debugging.
    console.log(
      JSON.stringify({
        evt: 'gabi_dispatch_taken',
        message_id: trigger.messageId,
        channel_id: trigger.channelId,
        via: trigger.via,
        chars: trigger.question.length,
        at: new Date(startedAt).toISOString(),
      }),
    );
    /** Set by `reply` when Discord actually accepted something. ⚠️ This, not
     *  "we produced an answer", is what makes the outcome `answered` — the two
     *  came apart on the night this was built. */
    let delivered = false;

    // ── ⚠️ THE WATCHDOG — the backstop for a cause nobody proved ────────────
    //
    // ⚠️ **THIS EXISTS BECAUSE THE ROOT CAUSE OF THE 2026-08-18 SILENCE WAS
    // NEVER FOUND.** Its evidence is gone for ever: the ring did not exist and
    // this Worker had no retained logs. Every hypothesis about it is reasoning,
    // and reasoning does not stop a person being ignored a second time.
    //
    // So instead of fixing the call that hung, this makes a hang — in ANY call,
    // known or not — end in words. `deadline.ts` explains why a hang is the one
    // failure mode that says nothing: every other outcome on this surface has a
    // sentence written for it, and a hang is the case where the code that writes
    // the sentence never runs.
    //
    // ⚠️ **IT DOES NOT CANCEL THE TURN.** If the real answer lands afterwards it
    // is posted too, which is why `stillThinking` is worded as a follow-through
    // rather than as a failure. Two messages beats nothing; and the fired
    // watchdog is recorded, so a pattern of them is visible instead of being
    // rediscovered by another user's complaint.
    const watched = handleMention(
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
        ...(archivePort ? { archive: archivePort } : {}),
        ...(shelfPort ? { shelf: shelfPort } : {}),
        persona: {
          pin: async (userId: string, trope: Trope, writer?: PersonaWriter) => {
            await this.personaPin(userId, trope, writer ?? 'self');
          },
          clear: async (userId: string, writer?: PersonaWriter) => {
            await this.personaPin(userId, null, writer ?? 'self');
          },
          read: (userId: string) => this.personaRead(userId),
          roster: () => this.personaRoster(),
        },
        /**
         * ⚠️ **A REFUSED REPLY IS RETRIED AS A PLAIN MESSAGE — 2026-08-18.**
         *
         * This used to log the status and return, which meant `say()` believed
         * it had spoken while the channel stayed empty. That is one of the four
         * paths that can produce the prohibited outcome, and it is the only one
         * with a cheap remedy: **the commonest reason a REPLY fails is the
         * referenced message being gone** (deleted, or edited into a form
         * Discord will not thread onto), and a plain channel message lands fine
         * in that case.
         *
         * ⚠️ It does NOT paper over a 403. If the bot cannot post in that
         * channel the retry fails too, and then the failure is logged as the
         * genuinely undeliverable answer it is and the ring records `silent` —
         * which is how somebody finds out, instead of nobody finding out.
         */
        reply: async (content, extra) => {
          const res = await replyToMessage(
            botToken,
            trigger.channelId,
            trigger.messageId,
            content,
            trigger.authorId,
            extra?.components ? { components: extra.components } : {},
          );
          if (res.ok) {
            delivered = true;
            return;
          }
          console.error(
            `GABI gateway: Discord refused the reply (HTTP ${res.status}); trying a plain message.`,
          );
          const retry = await createChannelMessage(botToken, trigger.channelId, {
            content,
            ...(extra?.components ? { components: extra.components } : {}),
            allowed_mentions: { parse: [], users: [trigger.authorId] },
          });
          if (retry.ok) {
            delivered = true;
            return;
          }
          // ⚠️ LOUD, and named as the thing it is. An answer was composed, money
          // was spent, and a person is looking at nothing.
          console.error(
            `GABI gateway: THE ANSWER WAS NEVER DELIVERED — reply ${res.status}, plain message ` +
              `${retry.status}, channel ${trigger.channelId}. Check the bot's Send Messages ` +
              'permission in that channel; this is what "she ignored me" looks like from inside.',
          );
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
        // ⚠️ ONE POSTURE ACROSS TIERS 2-4, by design §9. Passed as its own field
        // rather than reusing `memoryEnabled` so the two are separable the day
        // somebody wants them to be — and so `/api/health` can report the
        // archive's state as its own row rather than leaving it inferred.
        archiveEnabled: memoryOn(this.env),
        shelfEnabled: shelfOn(this.env),
        suggestEnabled: suggestOn(this.env),
        // ⚠️ The POSTURE as well as the rendered block, because the visibility
        // lane must be able to say "I'm not running personalities at the
        // moment". `personaBlock`'s absence cannot carry that: it is ambiguous
        // between "switched off" and "this surface never had one".
        personalityEnabled: personalityOn(this.env),
        ...(persona ? { personaBlock: personaBlock(persona.trope) } : {}),
        ...(this.env.ANTHROPIC_API_KEY_GABI ? { anthropicKey: this.env.ANTHROPIC_API_KEY_GABI } : {}),
        trace,
      },
    );

    const raced = await withDeadline(watched, TURN_WATCHDOG_MS, null);
    if (raced.timedOut) {
      console.error(
        `GABI gateway: A TURN PASSED ${TURN_WATCHDOG_MS}ms WITH NOTHING POSTED — message ` +
          `${trigger.messageId}, channel ${trigger.channelId}. This is the silent-turn class; the ` +
          'watchdog spoke in its place. Check what the tools/model were doing at this timestamp.',
      );
      trace.hid('turn_timed_out');
      await createChannelMessage(botToken, trigger.channelId, {
        content: MENTION_MSG.stillThinking,
        allowed_mentions: { parse: [], users: [trigger.authorId] },
      }).catch(() => {});
      await this.recordTurnLog({
        at: startedAt,
        person: trigger.authorId,
        via: trigger.via,
        outcome: 'silent',
        channel: trigger.channelId,
        why: 'watchdog',
        ...(trace.read().lane ? { lane: trace.read().lane as string } : {}),
        ...(trace.read().tools.length ? { tools: trace.read().tools } : {}),
        ms: Date.now() - startedAt,
      });
      // ⚠️ The turn is still running and may yet deliver. Nothing here waits for
      // it: the frame handler returning is what frees the socket to take the
      // next message, and holding it open behind a stuck turn would turn one
      // silence into a queue of them.
      return;
    }
    const outcome = raced.value ?? { answered: false, intent: 'error' as const };

    // ── ⚠️ THE RING, WRITTEN ONCE PER TAKEN TURN ────────────────────────────
    //
    // ⚠️ **`delivered` DECIDES, NOT `answered`.** `handleMention` reports whether
    // it produced an answer; this reports whether Discord took one. On the night
    // this was built those two were assumed to be the same thing, and the whole
    // reason the ring exists is that they can come apart without anybody
    // noticing.
    const seen = trace.read();

    // ⚠️ THE PAIR OF `gabi_dispatch_taken`. A `taken` with no `done` is a turn
    // that died in between, and `ms` on the ones that DO finish is the baseline
    // that says whether "died" means "threw" or "ran out of time".
    console.log(
      JSON.stringify({
        evt: 'gabi_dispatch_done',
        message_id: trigger.messageId,
        lane: seen.lane ?? null,
        tools: seen.tools,
        hid: seen.hid,
        intent: outcome.intent,
        delivered,
        ms: Date.now() - startedAt,
      }),
    );

    await this.recordTurnLog({
      at: startedAt,
      person: trigger.authorId,
      via: trigger.via,
      outcome: !delivered
        ? 'silent'
        : outcome.intent === 'capped'
          ? 'capped'
          : outcome.intent === 'error'
            ? 'error'
            : 'answered',
      channel: trigger.channelId,
      ...(outcome.intent ? { intent: String(outcome.intent) } : {}),
      ...(seen.lane ? { lane: seen.lane } : {}),
      ...(seen.tools.length ? { tools: seen.tools } : {}),
      ...(seen.hid.length ? { hid: seen.hid } : {}),
      ms: Date.now() - startedAt,
    });
  }

  /**
   * ⚠️ **ONE ROW WRITE, AND IT CAN NEVER FAIL A TURN.**
   *
   * Every failure is swallowed with a log line, for the reason
   * `@platform/estate-events` gives about itself: *a Worker reporting a problem
   * must not be able to turn that problem into a second, worse one.* A ring that
   * threw would convert "she gave a slightly odd answer" into "she said
   * nothing", which is the exact defect it was built to catch.
   */
  private async recordTurnLog(entry: TurnLogEntry): Promise<void> {
    try {
      const ring = (await this.state.storage.get<TurnLogEntry[]>(K_TURN_LOG)) ?? [];
      await this.state.storage.put(K_TURN_LOG, pushTurnLog(ring, entry));
    } catch (err) {
      console.error(
        'GABI gateway: the turn ring could not be written (the turn itself is unaffected):',
        err instanceof Error ? err.message : err,
      );
    }
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
