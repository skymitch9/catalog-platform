/**
 * The router — pure decisions over already-verified interaction payloads,
 * plus the full-request behavior of the command/component fallbacks (worded
 * ephemeral answers, never Discord's bare "This interaction failed").
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ephemeralMessage,
  EPHEMERAL,
  interactionUser,
  isInteraction,
  routeInteraction,
} from '../src/interactions.js';
import { buildPollCustomId } from '../src/poll-vote.js';
import app from '../src/index.js';
import { signedPost } from './helpers/signed-post.js';

test('isInteraction: needs an object with a numeric type', () => {
  assert.ok(isInteraction({ type: 1 }));
  assert.ok(!isInteraction(null));
  assert.ok(!isInteraction('ping'));
  assert.ok(!isInteraction({ type: 'PING' }));
});

test('PING routes to pong', () => {
  assert.deepEqual(routeInteraction({ type: 1 }), { kind: 'pong' });
});

test('APPLICATION_COMMAND: empty registry → unknown_command carrying the name', () => {
  assert.deepEqual(routeInteraction({ type: 2, data: { name: 'have' } }), {
    kind: 'unknown_command',
    name: 'have',
  });
  assert.deepEqual(routeInteraction({ type: 2 }), { kind: 'unknown_command', name: 'unknown' });
});

test('MESSAGE_COMPONENT: a well-formed pv| custom_id becomes a poll_vote decision', () => {
  const customId = buildPollCustomId({
    clubCol: 'clubs',
    clubId: 'club-A1',
    pollId: 'poll_B2',
    optionIndex: 3,
  });
  const decision = routeInteraction({
    type: 3,
    token: 'tok-123',
    application_id: 'app-1',
    data: { custom_id: customId },
    member: { user: { id: 'u42', username: 'reader' } },
  });
  assert.equal(decision.kind, 'poll_vote');
  if (decision.kind !== 'poll_vote') return;
  assert.deepEqual(decision.ref, {
    clubCol: 'clubs',
    clubId: 'club-A1',
    pollId: 'poll_B2',
    optionIndex: 3,
  });
  assert.deepEqual(decision.user, { id: 'u42', username: 'reader' });
  assert.equal(decision.token, 'tok-123');
  assert.equal(decision.applicationId, 'app-1');
});

test('MESSAGE_COMPONENT: malformed pv| ids and foreign custom_ids are bad_component', () => {
  for (const customId of [
    'pv|clubs|../etc|poll|0', //   path injection
    'pv|memberships|c|p|0', //     unknown collection
    'pv|clubs|c|p|11', //          option index past MAX_POLL_OPTIONS
    'pv|clubs|c|p', //             missing index
    'somethingelse', //            not ours at all
  ]) {
    const d = routeInteraction({ type: 3, token: 't', data: { custom_id: customId } });
    assert.equal(d.kind, 'bad_component', customId);
  }
});

test('MESSAGE_COMPONENT: a pv| id without an interaction token cannot become a vote', () => {
  const customId = buildPollCustomId({ clubCol: 'clubs', clubId: 'c', pollId: 'p', optionIndex: 0 });
  assert.equal(routeInteraction({ type: 3, data: { custom_id: customId } }).kind, 'bad_component');
});

test('unsupported interaction types are named, not guessed at', () => {
  assert.deepEqual(routeInteraction({ type: 4 }), { kind: 'unsupported', type: 4 });
  assert.deepEqual(routeInteraction({ type: 5 }), { kind: 'unsupported', type: 5 });
});

test('interactionUser: guild member.user wins, DM user is the fallback, absent is null', () => {
  const guild = { id: 'g1' };
  const dm = { id: 'd1' };
  assert.deepEqual(interactionUser({ type: 3, member: { user: guild }, user: dm }), guild);
  assert.deepEqual(interactionUser({ type: 3, user: dm }), dm);
  assert.equal(interactionUser({ type: 3 }), null);
  assert.equal(interactionUser({ type: 3, user: { id: '' } }), null);
});

test('ephemeralMessage: type 4 with the ephemeral flag', () => {
  assert.deepEqual(ephemeralMessage('hello'), {
    type: 4,
    data: { content: 'hello', flags: EPHEMERAL },
  });
});

// ---------------------------------------------------------------------------
// Full-request fallbacks — signed requests, worded answers
// ---------------------------------------------------------------------------

// The signer lives in test/helpers/ — ONE implementation, shared with
// link.test.ts. A second copy would eventually sign something subtly
// different and prove the wrong thing while still passing.

test('an unregistered slash command gets a worded ephemeral answer, not a bare failure', async () => {
  const res = await signedPost({ type: 2, data: { name: 'have' } });
  assert.equal(res.status, 200);
  const data = (await res.json()) as { type: number; data: { content: string; flags: number } };
  assert.equal(data.type, 4);
  assert.equal(data.data.flags, EPHEMERAL);
  assert.match(data.data.content, /\/have/);
});

test('a vote click with the Firestore credential unset says so in words — vote NOT recorded, no network', async () => {
  const customId = buildPollCustomId({ clubCol: 'clubs', clubId: 'c1', pollId: 'p1', optionIndex: 0 });
  const res = await signedPost({
    type: 3,
    token: 'tok',
    application_id: 'app',
    data: { custom_id: customId },
    member: { user: { id: 'u1' } },
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as { type: number; data: { content: string; flags: number } };
  assert.equal(data.type, 4); // ephemeral message, NOT a deferred ack
  assert.equal(data.data.flags, EPHEMERAL);
  assert.match(data.data.content, /NOT recorded/);
  assert.match(data.data.content, /not a permissions problem/);
});

test('health answers config-presence booleans and never values', async () => {
  const res = await app.request('/api/health', {}, { DISCORD_PUBLIC_KEY: 'abc' });
  assert.equal(res.status, 200);
  const data = (await res.json()) as {
    ok: boolean;
    service: string;
    configured: Record<string, boolean>;
  };
  assert.equal(data.ok, true);
  assert.equal(data.service, 'estate-discord');
  assert.deepEqual(data.configured, {
    discord_public_key: true,
    discord_application_id: false,
    discord_bot_token: false,
    firebase_service_account: false,
    // Added with phase 3 — same honest-false contract as the phase-2 row
    // below: the sync route's ships-dark state is visible from outside.
    poll_sync_token: false,
    // Added with phase 2. ⚠️ The honest `false` is the contract: it is how a
    // ships-dark feature is VISIBLE from outside rather than inferred.
    discord_client_secret: false,
    firebase_project_id: false,
  });
  assert.ok(!JSON.stringify(data).includes('abc'));
});

test('health: link_ready is false unless BOTH halves of the ceremony are configured', async () => {
  const read = async (env: Record<string, string>) => {
    const res = await app.request('/api/health', {}, env);
    return (await res.json()) as { link_ready: boolean };
  };
  assert.equal((await read({ DISCORD_PUBLIC_KEY: 'abc' })).link_ready, false);
  // The application id alone is not enough — the client secret is the new one.
  assert.equal(
    (await read({ DISCORD_APPLICATION_ID: 'app', FIREBASE_PROJECT_ID: 'p' })).link_ready,
    false,
  );
  assert.equal(
    (
      await read({
        DISCORD_APPLICATION_ID: 'app',
        DISCORD_CLIENT_SECRET: 'shh',
        FIREBASE_PROJECT_ID: 'p',
      })
    ).link_ready,
    true,
  );
});

test('health: poll_sync_ready needs the caller token AND the bot token AND the SA', async () => {
  const read = async (env: Record<string, string>) => {
    const res = await app.request('/api/health', {}, env);
    return (await res.json()) as { poll_sync_ready: boolean };
  };
  // Each of the three alone is not enough — a tick that could authenticate a
  // caller but not post, or post but not read polls, is not ready.
  assert.equal((await read({ POLL_SYNC_TOKEN: 't' })).poll_sync_ready, false);
  assert.equal(
    (await read({ POLL_SYNC_TOKEN: 't', DISCORD_BOT_TOKEN: 'b' })).poll_sync_ready,
    false,
  );
  assert.equal(
    (await read({ DISCORD_BOT_TOKEN: 'b', FIREBASE_SERVICE_ACCOUNT: '{}' })).poll_sync_ready,
    false,
  );
  assert.equal(
    (
      await read({
        POLL_SYNC_TOKEN: 't',
        DISCORD_BOT_TOKEN: 'b',
        FIREBASE_SERVICE_ACCOUNT: '{}',
      })
    ).poll_sync_ready,
    true,
  );
});
