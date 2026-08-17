/**
 * The estate Discord Worker — entrypoint. Wiring only; the decisions live
 * in sibling modules (verify.ts signatures, interactions.ts routing,
 * poll-vote.ts the vote flow, firebase-sa.ts the Firestore credential).
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
import type { AppBindings } from './env.js';
import { verifyDiscordSignature } from './verify.js';
import {
  ephemeralMessage,
  isInteraction,
  ResponseType,
  routeInteraction,
} from './interactions.js';
import { processPollVote } from './poll-vote.js';
import { pollSyncRoutes } from './poll-sync.js';
import { parseServiceAccount, type ServiceAccount } from './firebase-sa.js';
import { linkConfigured, linkRoutes, LINK_MSG } from './link.js';
import {
  ESTATE_COMMANDS,
  isOwnerEmail,
  linkCommandMessage,
  putGlobalCommands,
  readLadderRole,
  roleIsAdmin,
} from './commands.js';
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
// ---------------------------------------------------------------------------
app.post('/admin/commands/register', async (c) => {
  let identity;
  try {
    identity = await resolveIdentity(c.req.raw, c.env);
  } catch (err) {
    console.error('command registration verifier misconfigured:', err instanceof Error ? err.message : err);
    return c.json({ ok: false, message: LINK_MSG.misconfigured }, 503);
  }
  if (!identity || !identity.uid) {
    return c.json(
      {
        ok: false,
        message:
          'You are not signed in to the estate, so nothing was published. Send a Firebase ID ' +
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
            '(a service problem, NOT a permissions one). Nothing was published — try again shortly.',
        },
        502,
      );
    }
    if (!roleIsAdmin(role)) {
      return c.json(
        {
          ok: false,
          message:
            'Publishing GABI’s slash commands needs the estate `admin` role, and this account ' +
            `holds ${role ?? 'no role'}. Ask an estate admin to run it, or to grant the role from ` +
            'the audiobook site’s admin page.',
        },
        403,
      );
    }
  }

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

  const result = await putGlobalCommands(applicationId, botToken, ESTATE_COMMANDS);
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
      'appear the first time; updates show up almost immediately.',
    commands: ESTATE_COMMANDS.map((cmd) => cmd.name),
  });
});

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
      let sa: ServiceAccount | null;
      try {
        sa = parseServiceAccount(c.env.FIREBASE_SERVICE_ACCOUNT);
      } catch (err) {
        console.error('FIREBASE_SERVICE_ACCOUNT malformed:', err instanceof Error ? err.message : err);
        sa = null;
      }
      if (!sa) {
        return c.json(
          ephemeralMessage(
            'Voting from Discord is not fully set up on the server yet (a configuration gap, ' +
              'not a permissions problem). Your vote was NOT recorded — vote on the club page.',
          ),
        );
      }
      const work = processPollVote({
        sa,
        ref: decision.ref,
        discordUserId: decision.user.id,
        applicationId: c.env.DISCORD_APPLICATION_ID || decision.applicationId,
        interactionToken: decision.token,
      });
      // Tests run the app without an execution context; production always
      // has one. processPollVote never rejects, so floating is safe there.
      try {
        c.executionCtx.waitUntil(work);
      } catch {
        void work;
      }
      return c.json({ type: ResponseType.DEFERRED_UPDATE_MESSAGE });
    }
  }
});

export default app;
