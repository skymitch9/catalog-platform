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
 * `IDENTIFY` asks for **`GUILDS | GUILD_MESSAGES` = 513, both unprivileged**.
 * The **Message Content privileged intent is not requested and must never be**
 * (`discord-bot-design.md` §1.5).
 *
 * The obvious objection is that without it `MESSAGE_CREATE.content` arrives
 * blank, which would make a mention unreadable. **Measured 2026-08-17 against
 * Discord's own documentation** — <https://docs.discord.com/developers/events/gateway>
 * — the intent blanks content **except** for four cases, one of which is
 * *"Content in which the app is mentioned"*. So the exact messages this build
 * answers are the exact messages whose content still arrives. `mentions.ts`
 * treats a blank `content` as "not for her", which is both the correct reading
 * and the correct behaviour if that ever changed.
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
import { getGatewayBot, replyToMessage } from './discord-api.js';
import { indexBase } from './have.js';
import { panelBase, panelDeepLink } from './gabi.js';
import {
  capDecision,
  mentionsOn,
  mentionTrigger,
  pruneWindow,
  utcDayKey,
  type CapVerdict,
} from './mentions.js';
import { handleMention } from './mention-flow.js';

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

/** GUILDS (1 << 0) | GUILD_MESSAGES (1 << 9). ⚠️ Both UNPRIVILEGED. Adding
 * MESSAGE_CONTENT (1 << 15) here would be the design decision §1.5 forbids —
 * and Discord would answer close code 4014 for an unapproved privileged intent,
 * which this file treats as fatal rather than retrying. */
export const GATEWAY_INTENTS = (1 << 0) | (1 << 9);

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

// Storage keys. Namespaced so the caps and the session cannot collide.
const K_SESSION = 'gw:session_id';
const K_SEQ = 'gw:seq';
const K_RESUME_URL = 'gw:resume_url';
const K_FATAL = 'gw:fatal';
const K_IDENTIFIES = 'gw:identifies';
const K_LAST_READY = 'gw:last_ready_at';
const K_GLOBAL_CAP = 'cap:global';
const kUserCap = (id: string) => `cap:user:${id}`;

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
    };
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

    await handleMention(
      {
        capCheck: (userId) => this.capCheck(userId),
        recordTurn: (userId) => this.recordTurn(userId),
        reply: async (content) => {
          const res = await replyToMessage(
            botToken,
            trigger.channelId,
            trigger.messageId,
            content,
            trigger.authorId,
          );
          if (!res.ok) {
            // 403 = not allowed to post there. A fact about that channel's
            // permissions, not a failure of the answer; named, never retried.
            console.error(`GABI gateway: Discord refused the reply (HTTP ${res.status}).`);
          }
        },
      },
      trigger,
      {
        indexBaseUrl: indexBase(this.env),
        panelUrl: panelDeepLink(panelBase(this.env)),
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
