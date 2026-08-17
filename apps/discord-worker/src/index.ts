/**
 * The estate Discord Worker — entrypoint. Wiring only; the decisions live
 * in sibling modules (verify.ts signatures, interactions.ts routing,
 * poll-vote.ts the vote flow, firebase-sa.ts the Firestore credential).
 *
 * Slash commands, and what each answers:
 *   /link      the identity-link ceremony (link.ts, commands.ts)
 *   /have      "is this book on the estate's shelves?" — the PUBLIC audiobook
 *              slice for everyone, no credential on the call (have.ts)
 *   /gabi      the fixer's Discord surface, shape (b) propose-and-deep-link
 *              (gabi.ts): a best-effort answer from the same public slice, plus
 *              a link into the real GABI panel. ⚠️ It runs NO tool loop, calls
 *              NO model, holds NO new secret and writes NOTHING — that is what
 *              lets it ship without any of gabi-fixer-design.md §10.2's four
 *              blockers being solved
 *   /timeout   ⚠️ DARK. Answers "moderation is switched off" while
 *   /cleanup   ⚠️ DARK.  MODERATION_ENABLED is anything but "on"
 *              (moderation.ts / mod-actions.ts), and is not even published to
 *              Discord until it is.
 *
 * What this is: the bot's single HTTP interactions endpoint
 * (discord-bot-design.md §1.3 — a dedicated Worker, deliberately apart from
 * auth-worker so the bot token and the estate directory stay separately
 * rotatable and separately auditable). Discord POSTs every interaction —
 * the PING handshake, buttons, slash commands — to the one URL configured
 * in the Developer Portal; there is no gateway connection.
 *
 *   POST /interactions               Ed25519-verified; PING→PONG; router
 *   GET  /api/health                 open; config-presence booleans, no values
 *   GET  /link, /link/callback       the identity-link ceremony (link.ts)
 *   POST /link/confirm, /link/unlink  — mounted, not implemented here
 *   POST /admin/commands/register    publish the slash-command registry
 *   POST /polls/sync                 post/refresh/close the votable poll
 *                                    messages (phase 3, poll-sync.ts)
 *
 * LIVE since 2026-08-16 at discord.heygabi.ai; the runbook remains
 * docs/access/discord-bot.md.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppBindings, Env } from './env.js';
import { verifyDiscordSignature } from './verify.js';
import {
  deferredEphemeral,
  displayNameOf,
  ephemeralMessage,
  isInteraction,
  ResponseType,
  routeInteraction,
  type InteractionActor,
} from './interactions.js';
import { processPollVote } from './poll-vote.js';
import { pollSyncRoutes } from './poll-sync.js';
import { parseServiceAccount, type ServiceAccount } from './firebase-sa.js';
import { linkConfigured, linkRoutes, LINK_MSG } from './link.js';
import {
  commandNames,
  commandsFor,
  isOwnerEmail,
  linkCommandMessage,
  putGlobalCommands,
  readLadderRole,
  roleIsAdmin,
} from './commands.js';
import { indexBase, processHave } from './have.js';
import { panelBase, panelDeepLink, processGabi } from './gabi.js';
import { mentionsOn } from './mentions.js';
import { gatewayStub } from './gateway.js';
import {
  moderationOn,
  MOD_MSG,
  verifyConfirmCustomId,
  type CleanupPlan,
} from './moderation.js';
import {
  planCleanup,
  planTimeout,
  realModDeps,
  runCleanupConfirm,
  runCleanupPreview,
  runTimeout,
  type ModCallContext,
} from './mod-actions.js';
import { resolveIdentity } from '@platform/estate-auth';

const app = new Hono<AppBindings>();

// ---------------------------------------------------------------------------
// Health — same open, no-PII pattern as auth.heygabi.ai / index.heygabi.ai
// (design doc §1.7). Booleans about which secrets are PRESENT, never values.
// ---------------------------------------------------------------------------
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'estate-discord',
    features: [
      'interactions_endpoint',
      'poll_vote_component',
      'identity_link',
      'poll_message_sync',
      'have_command',
      'gabi_command',
      'moderation_dark',
      'gabi_mentions',
    ],
    configured: {
      discord_public_key: Boolean(c.env.DISCORD_PUBLIC_KEY),
      discord_application_id: Boolean(c.env.DISCORD_APPLICATION_ID),
      discord_bot_token: Boolean(c.env.DISCORD_BOT_TOKEN),
      firebase_service_account: Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
      // ⚠️ Reports FALSE until the conductor mints it and gives the SAME value
      // to the audiobook pipeline. Same honest-false discipline as the row
      // below: the ships-dark state of phase 3's sync route is VISIBLE here
      // rather than inferred from a POST nobody made.
      poll_sync_token: Boolean(c.env.POLL_SYNC_TOKEN),
      // ⚠️ Reports FALSE until the owner sets it (docs/access/discord-bot.md
      // §3 step 7). An honest false is the point of this row: it is how the
      // ships-dark state is VISIBLE rather than inferred from a page nobody
      // loaded. Not a value, not a prefix — a boolean, like every row here.
      discord_client_secret: Boolean(c.env.DISCORD_CLIENT_SECRET),
      firebase_project_id: Boolean(c.env.FIREBASE_PROJECT_ID),
      // ⚠️ Reports FALSE until the owner mints and pastes it. Same honest-false
      // discipline as every row here — and its absence is a LADDER, not a
      // fault: without it GABI still answers mentions from the keyword router
      // (src/mentions.ts), she just has no conversational half. A missing key
      // never produces an error message in a channel.
      anthropic_key_gabi: Boolean(c.env.ANTHROPIC_API_KEY_GABI),
    },
    // The one derived answer: both halves present, so /link can actually run.
    link_ready: linkConfigured(c.env) && Boolean(c.env.FIREBASE_PROJECT_ID),
    // The same question for phase 3: a sync tick needs the caller's token,
    // the bot token to post with, and the service account to read polls.
    // All three or it is dark — reported as one honest boolean, not three
    // rows a reader has to AND together themselves.
    poll_sync_ready:
      Boolean(c.env.POLL_SYNC_TOKEN) &&
      Boolean(c.env.DISCORD_BOT_TOKEN) &&
      Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
    // ⚠️ The kill switch, VISIBLE from outside — the same honest-false
    // discipline as the two rows above. A var, not a secret, so reporting the
    // derived boolean leaks nothing; and `false` here is the whole state of
    // the moderation build, checkable without pressing anything.
    moderation_enabled: moderationOn(c.env),
    // What scope /have answers at, for everyone (design §4 decision 4). Stated
    // rather than inferred: if this ever reads anything but `audiobook`, the
    // privacy line moved and somebody should know why.
    have_scope: 'audiobook',
    // ⚠️ `/gabi`'s SHAPE, stated from outside rather than inferred from a
    // command nobody ran. `propose_and_deep_link` is the design's shape (b):
    // the bot reads the public slice and links to the panel; it runs no tool
    // loop and calls no model. If this ever reads anything else, the token
    // custody question (§10.2 blocker 2) was answered by somebody and that is
    // a decision worth finding in one curl. The URL is a var and public —
    // reporting it leaks nothing and makes a misconfigured link visible.
    gabi_surface: 'propose_and_deep_link',
    gabi_panel_url: panelDeepLink(panelBase(c.env)),
    // ⚠️ The conversational kill switch, VISIBLE from outside — same reasoning
    // as `moderation_enabled` above. `false` here is the whole state of the
    // phase-A mention build, checkable in one curl, and it means no gateway
    // WebSocket is open at all rather than "open but quiet".
    gabi_mentions_enabled: mentionsOn(c.env),
    // Stated rather than inferred, because it is the claim the whole design
    // rests on: she is reachable by an @mention and by nothing else, on
    // unprivileged intents. If this ever reads otherwise, somebody requested
    // Discord's Message Content intent and that is a decision worth finding.
    gabi_mentions_trigger: 'at_mention_only',
    gabi_mentions_privileged_intent: false,
  }),
);

// ---------------------------------------------------------------------------
// The identity-link ceremony (design §1.6, phase 2). Everything about it —
// the OAuth trip, the two proofs, the write, the revoke, the pages — is in
// link.ts; this file only wires it, per the estate's thin-entrypoint rule.
// ---------------------------------------------------------------------------
app.route('/', linkRoutes);

// ---------------------------------------------------------------------------
// POST /polls/sync — phase 3. The audiobook pipeline's club_announcements.py
// pokes this on its existing cadence; the Worker then posts/edits the votable
// poll messages with the bot token. Token-gated, ships dark, and reads every
// fact it acts on from Firestore itself (poll-sync.ts's header explains why
// the trigger carries no club data).
// ---------------------------------------------------------------------------
app.route('/', pollSyncRoutes);

// ---------------------------------------------------------------------------
// POST /admin/commands/register — publish the slash-command registry to
// Discord. Estate admin only; see commands.ts for why this is a route rather
// than a script (the credentials live in the Worker and nowhere else).
//
// CORS locked to the apex (2026-08-17): the registration is performed from
// the /admin page with the admin's own bearer, and that page's CSP names this
// Worker — the auth-worker's adminCors idiom, origin pinned rather than
// env-configurable because exactly one page legitimately calls this.
// ---------------------------------------------------------------------------
app.use(
  '/admin/commands/register',
  cors({
    origin: 'https://heygabi.ai',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }),
);
/**
 * The estate-admin gate, in ONE place — extracted 2026-08-17 when the gateway
 * poke became a second route needing it. Returns `null` when the caller may
 * proceed and a fully-worded refusal otherwise; ⚠️ every refusal says what
 * happened, what it needs and how to get it, and an OUTAGE is never dressed up
 * as a permissions problem (the estate's no-bare-status rule).
 */
async function adminGate(c: {
  req: { raw: Request };
  env: Env;
  json: (body: unknown, status?: number) => Response;
}): Promise<Response | null> {
  let identity;
  try {
    identity = await resolveIdentity(c.req.raw, c.env);
  } catch (err) {
    console.error('estate admin verifier misconfigured:', err instanceof Error ? err.message : err);
    return c.json({ ok: false, message: LINK_MSG.misconfigured }, 503);
  }
  if (!identity || !identity.uid) {
    return c.json(
      {
        ok: false,
        message:
          'You are not signed in to the estate, so nothing was done. Send a Firebase ID ' +
          'token as `Authorization: Bearer <token>` from an estate admin account.',
      },
      401,
    );
  }

  if (!isOwnerEmail(c.env, identity.email)) {
    let role: string | null;
    try {
      role = await readLadderRole(c.env, identity.uid);
    } catch (err) {
      // An outage is NEVER reported as a permissions refusal.
      console.error('ladder role read failed:', err instanceof Error ? err.message : err);
      return c.json(
        {
          ok: false,
          message:
            'Your permissions could not be checked because the estate directory did not answer ' +
            '(a service problem, NOT a permissions one). Nothing was done — try again shortly.',
        },
        502,
      );
    }
    if (!roleIsAdmin(role)) {
      return c.json(
        {
          ok: false,
          message:
            'This is an estate `admin` action, and this account ' +
            `holds ${role ?? 'no role'}. Ask an estate admin to run it, or to grant the role from ` +
            'the audiobook site’s admin page.',
        },
        403,
      );
    }
  }
  return null;
}

app.post('/admin/commands/register', async (c) => {
  const refusal = await adminGate(c);
  if (refusal) return refusal;

  const applicationId = c.env.DISCORD_APPLICATION_ID;
  const botToken = c.env.DISCORD_BOT_TOKEN;
  if (!applicationId || !botToken) {
    return c.json(
      {
        ok: false,
        message:
          'The bot credentials needed to publish commands are not set on the Worker (a ' +
          'configuration gap, NOT a permissions problem). Nothing was published — see ' +
          'docs/access/discord-bot.md §2.',
      },
      503,
    );
  }

  // ⚠️ The registry is a FUNCTION of MODERATION_ENABLED (commands.ts explains
  // the choice in full): while the switch is off, Discord is told about /link
  // and /have only, and the moderation pair is published by re-running this
  // route AFTER the owner flips it.
  const registry = commandsFor(c.env);
  const result = await putGlobalCommands(applicationId, botToken, registry);
  if (!result.ok) {
    console.error('slash command registration failed:', result.status, result.detail);
    return c.json(
      {
        ok: false,
        message:
          'Discord refused the command registration (a problem between the estate and Discord, ' +
          'NOT a permissions problem with your account). Nothing was published — try again shortly.',
        discord_status: result.status,
      },
      502,
    );
  }
  return c.json({
    ok: true,
    message:
      `Published ${result.count} global command(s). Global commands can take up to an hour to ` +
      'appear the first time; updates show up almost immediately.' +
      (moderationOn(c.env)
        ? ' Moderation is ON, so /timeout and /cleanup were published too.'
        : ' Moderation is switched off, so /timeout and /cleanup were deliberately NOT published — ' +
          're-run this route after MODERATION_ENABLED is flipped to "on" and they will appear.'),
    commands: commandNames(registry),
    moderation_enabled: moderationOn(c.env),
  });
});

// ---------------------------------------------------------------------------
// POST /admin/gateway/start — wake the conversational gateway (phase A).
//
// The Durable Object in src/gateway.ts holds the one outbound WebSocket that
// lets GABI HEAR @mentions. It needs somebody to exist before it can connect,
// and there are exactly two pokers: the cron below (every two minutes, so the
// connection exists without traffic) and this route, for a person who has just
// flipped the posture and does not want to wait.
//
// ⚠️ Estate admin only, same gate as the command registry — the poke costs
// money in the sense that it opens a billable Durable Object.
// ⚠️ It is also the ONLY way to clear the object's fatal flag: after a 4004
// (bad token) or 4014 (unapproved intent) the object deliberately stops
// reconnecting, and a person has to fix the cause and say so.
// ---------------------------------------------------------------------------
app.use(
  '/admin/gateway/start',
  cors({
    origin: 'https://heygabi.ai',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }),
);
app.post('/admin/gateway/start', async (c) => {
  const refusal = await adminGate(c);
  if (refusal) return refusal;

  const stub = gatewayStub(c.env);
  if (!stub) {
    return c.json(
      {
        ok: false,
        message:
          'The gateway Durable Object is not bound on this Worker (a configuration gap, NOT a ' +
          'permissions problem). Nothing was started — check the [[durable_objects.bindings]] ' +
          'entry for GABI_GATEWAY in wrangler.toml and redeploy.',
      },
      503,
    );
  }
  if (!mentionsOn(c.env)) {
    return c.json({
      ok: true,
      started: false,
      message:
        'GABI_MENTIONS is not "on", so no gateway connection was opened and none will be. That is ' +
        'the shipped posture, not a fault — flipping it is an owner decision in wrangler.toml, ' +
        'followed by a deploy and then this route.',
    });
  }
  const res = await stub.fetch('https://gateway.internal/start', { method: 'POST' });
  return c.json({ ok: true, started: true, gateway: await res.json() });
});

// ---------------------------------------------------------------------------
// Three small wiring helpers. Everything they touch is decided elsewhere —
// this file stays an orchestrator (the estate's thin-entrypoint rule).
// ---------------------------------------------------------------------------

/** Run the slow half after the ack. Tests drive the app without an execution
 * context; production always has one, and none of these flows rejects. */
function defer(
  c: { executionCtx: { waitUntil(promise: Promise<unknown>): void } },
  work: Promise<unknown>,
): void {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    void work;
  }
}

function serviceAccountOrNull(json: string | undefined): ServiceAccount | null {
  try {
    return parseServiceAccount(json);
  } catch (err) {
    console.error('FIREBASE_SERVICE_ACCOUNT malformed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Everything a moderation path needs about WHO asked and WHERE — including
 * the kill switch, read once, here, from the environment. */
function modContext(env: Env, actor: InteractionActor): ModCallContext {
  return {
    enabled: moderationOn(env),
    permissionsRaw: actor.permissions,
    guildId: actor.guildId,
    channelId: actor.channelId,
    actorId: actor.user?.id ?? '',
    actorName: displayNameOf(actor.user),
    applicationId: env.DISCORD_APPLICATION_ID || actor.applicationId,
  };
}

// ---------------------------------------------------------------------------
// The interactions endpoint. Order is load-bearing: config check → signature
// (Discord probes with deliberately BAD signatures and silently drops the
// URL if they aren't 401'd — verify.ts header) → parse → route → respond
// inside the 3-second window (vote work is deferred into waitUntil).
// ---------------------------------------------------------------------------
app.post('/interactions', async (c) => {
  const publicKeyHex = c.env.DISCORD_PUBLIC_KEY;
  if (!publicKeyHex) {
    return c.json(
      { error: 'discord_public_key_unset', fix: 'wrangler secret put DISCORD_PUBLIC_KEY' },
      503,
    );
  }

  const signature = c.req.header('x-signature-ed25519');
  const timestamp = c.req.header('x-signature-timestamp');
  if (!signature || !timestamp) return c.json({ error: 'missing_signature_headers' }, 401);

  const rawBody = await c.req.text();
  let valid: boolean;
  try {
    valid = await verifyDiscordSignature(publicKeyHex, signature, timestamp, rawBody);
  } catch (err) {
    // importDiscordPublicKey threw: the SECRET is malformed — a config bug,
    // loud and distinct from an attacker's bad signature.
    console.error('DISCORD_PUBLIC_KEY malformed:', err instanceof Error ? err.message : err);
    return c.json({ error: 'discord_public_key_invalid', fix: 'must be 64 hex chars' }, 500);
  }
  if (!valid) return c.json({ error: 'bad_signature' }, 401);

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!isInteraction(body)) return c.json({ error: 'not_an_interaction' }, 400);

  const decision = routeInteraction(body);
  switch (decision.kind) {
    case 'pong':
      return c.json({ type: ResponseType.PONG });

    case 'link_command':
      // Ephemeral by design: a link ceremony is personal, and a
      // channel-visible message would invite the wrong person to press it.
      return c.json(
        ephemeralMessage(
          linkCommandMessage(
            new URL(c.req.url).origin,
            linkConfigured(c.env) && Boolean(c.env.FIREBASE_PROJECT_ID),
          ),
        ),
      );

    case 'have_command': {
      // Design §2b / §4 decision 4: the PUBLIC audiobook slice, for everyone,
      // with no credential on the call. Deferred because it asks the index —
      // a round trip must never race Discord's 3-second window (§1.7).
      if (!decision.actor.token) {
        return c.json(
          ephemeralMessage(
            'Discord sent no interaction token, so GABI has no way to reply with the answer. ' +
              'Nothing went wrong on the estate side — try the command again.',
          ),
        );
      }
      defer(
        c,
        processHave({
          query: decision.query,
          applicationId: c.env.DISCORD_APPLICATION_ID || decision.actor.applicationId,
          interactionToken: decision.actor.token,
          indexBaseUrl: indexBase(c.env),
          serviceAccountJson: c.env.FIREBASE_SERVICE_ACCOUNT,
          discordUserId: decision.actor.user?.id ?? null,
        }),
      );
      return c.json(deferredEphemeral());
    }

    case 'gabi_command': {
      // Shape (b), propose-and-deep-link (gabi.ts's header has the full
      // reasoning). Deferred for the same reason as /have: it asks the index,
      // and a round trip must never race Discord's 3-second window.
      if (!decision.actor.token) {
        return c.json(
          ephemeralMessage(
            'Discord sent no interaction token, so GABI has no way to reply with the answer. ' +
              'Nothing went wrong on the estate side — try the command again.',
          ),
        );
      }
      defer(
        c,
        processGabi({
          question: decision.question,
          applicationId: c.env.DISCORD_APPLICATION_ID || decision.actor.applicationId,
          interactionToken: decision.actor.token,
          indexBaseUrl: indexBase(c.env),
          panelUrl: panelDeepLink(panelBase(c.env)),
          serviceAccountJson: c.env.FIREBASE_SERVICE_ACCOUNT,
          discordUserId: decision.actor.user?.id ?? null,
        }),
      );
      return c.json(deferredEphemeral());
    }

    // -----------------------------------------------------------------------
    // MODERATION — dark. Each of the three paths checks MODERATION_ENABLED
    // itself (via the planners' shared gate, and again inside the flows), and
    // while it is off every one of them answers MOD_MSG.switchedOff having
    // performed no I/O at all.
    // -----------------------------------------------------------------------

    case 'timeout_command': {
      const ctx = modContext(c.env, decision.actor);
      const planned = planTimeout(ctx, {
        targetUserId: decision.target.id,
        targetName: decision.target.name,
        duration: decision.duration,
        reason: decision.reason,
      });
      if (planned.kind === 'refuse') return c.json(ephemeralMessage(planned.message));
      const botToken = c.env.DISCORD_BOT_TOKEN;
      if (!botToken || !decision.actor.token) {
        return c.json(ephemeralMessage(MOD_MSG.botTokenMissing));
      }
      defer(
        c,
        runTimeout(
          realModDeps({
            botToken,
            serviceAccount: serviceAccountOrNull(c.env.FIREBASE_SERVICE_ACCOUNT),
            applicationId: ctx.applicationId,
            interactionToken: decision.actor.token,
          }),
          ctx,
          planned.plan,
        ),
      );
      return c.json(deferredEphemeral());
    }

    case 'cleanup_command': {
      const ctx = modContext(c.env, decision.actor);
      const planned = planCleanup(ctx, {
        count: decision.count,
        user: decision.userId,
        contains: decision.contains,
      });
      if (planned.kind === 'refuse') return c.json(ephemeralMessage(planned.message));
      const botToken = c.env.DISCORD_BOT_TOKEN;
      if (!botToken || !decision.actor.token) {
        return c.json(ephemeralMessage(MOD_MSG.botTokenMissing));
      }
      defer(
        c,
        runCleanupPreview(
          realModDeps({
            botToken,
            serviceAccount: serviceAccountOrNull(c.env.FIREBASE_SERVICE_ACCOUNT),
            applicationId: ctx.applicationId,
            interactionToken: decision.actor.token,
          }),
          ctx,
          planned.plan,
        ),
      );
      return c.json(deferredEphemeral());
    }

    case 'mod_confirm': {
      const ctx = modContext(c.env, decision.actor);
      // The switch, before the signature: an off bot does not even reveal
      // whether a confirm id was valid.
      if (!ctx.enabled) return c.json(ephemeralMessage(MOD_MSG.switchedOff));
      const botToken = c.env.DISCORD_BOT_TOKEN;
      if (!botToken || !decision.actor.token) {
        return c.json(ephemeralMessage(MOD_MSG.botTokenMissing));
      }
      const parsed = await verifyConfirmCustomId(
        botToken,
        decision.customId,
        { invokerId: ctx.actorId, channelId: ctx.channelId },
        Date.now(),
      );
      if (!parsed.ok) {
        return c.json(
          ephemeralMessage(parsed.reason === 'expired' ? MOD_MSG.confirmExpired : MOD_MSG.confirmInvalid),
        );
      }
      const plan: CleanupPlan = parsed.plan;
      defer(
        c,
        runCleanupConfirm(
          realModDeps({
            botToken,
            serviceAccount: serviceAccountOrNull(c.env.FIREBASE_SERVICE_ACCOUNT),
            applicationId: ctx.applicationId,
            interactionToken: decision.actor.token,
          }),
          ctx,
          plan,
        ),
      );
      return c.json({ type: ResponseType.DEFERRED_UPDATE_MESSAGE });
    }

    case 'unknown_command':
      return c.json(
        ephemeralMessage(
          `Nothing answers /${decision.name} yet — the estate bot does not have that command wired up.`,
        ),
      );

    case 'bad_component':
      return c.json(
        ephemeralMessage(
          'This button is not one the estate bot recognises — it may belong to an older message. ' +
            'Nothing was recorded.',
        ),
      );

    case 'unsupported':
      return c.json({ error: 'unsupported_interaction_type', type: decision.type }, 400);

    case 'poll_vote': {
      if (!decision.user) {
        return c.json(
          ephemeralMessage(
            'Discord sent no user on this interaction, so the vote could not be attributed ' +
              'and was NOT counted. Vote on the club page instead.',
          ),
        );
      }
      const sa: ServiceAccount | null = serviceAccountOrNull(c.env.FIREBASE_SERVICE_ACCOUNT);
      if (!sa) {
        return c.json(
          ephemeralMessage(
            'Voting from Discord is not fully set up on the server yet (a configuration gap, ' +
              'not a permissions problem). Your vote was NOT recorded — vote on the club page.',
          ),
        );
      }
      defer(
        c,
        processPollVote({
          sa,
          ref: decision.ref,
          discordUserId: decision.user.id,
          applicationId: c.env.DISCORD_APPLICATION_ID || decision.applicationId,
          interactionToken: decision.token,
        }),
      );
      return c.json({ type: ResponseType.DEFERRED_UPDATE_MESSAGE });
    }
  }
});

// ---------------------------------------------------------------------------
// The cron — the heartbeat OUTSIDE the Durable Object.
//
// ⚠️ A gateway connection that only exists while somebody is talking to it is
// not a gateway connection. The object's own alarm heals it from the inside,
// but an alarm cannot fire on an object nobody has ever created, and (measured
// 2026-08-17) an outbound WebSocket only prevents eviction "for up to 15
// minutes per connection". So something outside has to poke it on a cadence —
// this is that something, and it is deliberately dumber than the object it
// wakes: one conditional, one subrequest, no state.
//
// ⚠️ With the posture off it does NOTHING — no object is created, no Durable
// Object duration is billed, and the cost of shipping this dark is zero.
// ---------------------------------------------------------------------------
async function scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  if (!mentionsOn(env)) return;
  const stub = gatewayStub(env);
  if (!stub) {
    console.error(
      'GABI mentions are on but the GABI_GATEWAY Durable Object is not bound; nothing can listen. ' +
        'Check wrangler.toml.',
    );
    return;
  }
  ctx.waitUntil(
    stub
      .fetch('https://gateway.internal/start', { method: 'POST' })
      .then(() => undefined)
      .catch((err) => console.error('GABI gateway poke failed:', err instanceof Error ? err.message : err)),
  );
}

// ⚠️ The Durable Object class must be exported from the Worker's entrypoint or
// Cloudflare cannot construct it — a binding alone is not enough, and the
// failure reads as "class not found" at deploy rather than at runtime.
export { GabiGateway } from './gateway.js';

/**
 * ⚠️ The Hono app is now a NAMED export and the default is a handler object.
 *
 * A Worker with a cron needs a `scheduled` handler beside `fetch`, and a bare
 * Hono instance has no place to put one. Nothing about HTTP behaviour changed —
 * `app.fetch` below is the same handler that used to be the default export —
 * but tests drive the app through `app.request(...)`, which only exists on the
 * Hono instance, so both shapes are exported rather than one being faked.
 */
export { app };

export default { fetch: app.fetch, scheduled };
