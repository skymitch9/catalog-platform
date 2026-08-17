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
 *   POST /interactions   Ed25519-verified; PING→PONG; router
 *   GET  /api/health     open; config-presence booleans, no values
 *
 * ⚠️ NOT DEPLOYED, ON PURPOSE — nothing here is live until the owner
 * registers the Discord application and runs docs/access/discord-bot.md.
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
import { parseServiceAccount, type ServiceAccount } from './firebase-sa.js';

const app = new Hono<AppBindings>();

// ---------------------------------------------------------------------------
// Health — same open, no-PII pattern as auth.heygabi.ai / index.heygabi.ai
// (design doc §1.7). Booleans about which secrets are PRESENT, never values.
// ---------------------------------------------------------------------------
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'estate-discord',
    features: ['interactions_endpoint', 'poll_vote_component'],
    configured: {
      discord_public_key: Boolean(c.env.DISCORD_PUBLIC_KEY),
      discord_application_id: Boolean(c.env.DISCORD_APPLICATION_ID),
      discord_bot_token: Boolean(c.env.DISCORD_BOT_TOKEN),
      firebase_service_account: Boolean(c.env.FIREBASE_SERVICE_ACCOUNT),
    },
  }),
);

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
