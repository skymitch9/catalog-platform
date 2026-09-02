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
import { buildConvCustomId, buildModalCustomId } from '../src/conversation.js';
import { app } from '../src/index.js';
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

test('APPLICATION_COMMAND: a name outside the registry → unknown_command carrying it', () => {
  // ⚠️ CHANGED 2026-09-02. This test used `/recent` as its stand-in for
  // "anything the router does not know" — and `/recent` was BUILT that day, so
  // the stand-in became a real command and the test started asserting the
  // opposite of its own name. The lesson is worth keeping: a placeholder named
  // after a DESIGNED-but-unbuilt feature has an expiry date. `nonesuch` is not
  // a command anybody intends to build.
  assert.deepEqual(routeInteraction({ type: 2, data: { name: 'nonesuch' } }), {
    kind: 'unknown_command',
    name: 'nonesuch',
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
  // ⚠️ Type 5 used to be here and is now MODAL_SUBMIT — routed since the
  // continuity layer landed (2026-08-17). Autocomplete (4) and the ping-adjacent
  // higher numbers stand in for "anything the router does not know".
  assert.deepEqual(routeInteraction({ type: 4 }), { kind: 'unsupported', type: 4 });
  assert.deepEqual(routeInteraction({ type: 6 }), { kind: 'unsupported', type: 6 });
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
  const res = await signedPost({ type: 2, data: { name: 'nonesuch' } });
  assert.equal(res.status, 200);
  const data = (await res.json()) as { type: number; data: { content: string; flags: number } };
  assert.equal(data.type, 4);
  assert.equal(data.data.flags, EPHEMERAL);
  assert.match(data.data.content, /\/nonesuch/);
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

// ---------------------------------------------------------------------------
// ⚠️ CONTINUITY — the fourth door. These are ROUTER tests: they prove a press
// becomes a decision, and that a press this build never produced does not.
// ---------------------------------------------------------------------------

test('MESSAGE_COMPONENT: a gc| select press becomes a gabi_component carrying the choice', () => {
  const decision = routeInteraction({
    type: 3,
    token: 'tok',
    application_id: 'app',
    guild_id: 'g1',
    channel_id: 'ch1',
    data: { custom_id: buildConvCustomId('pick', 'ab12cd34'), values: ['2'] },
    member: { user: { id: 'u42' } },
  });
  assert.equal(decision.kind, 'gabi_component');
  if (decision.kind !== 'gabi_component') return;
  assert.equal(decision.action, 'pick');
  assert.equal(decision.nonce, 'ab12cd34');
  assert.equal(decision.choice, '2');
  assert.equal(decision.actor.channelId, 'ch1');
});

test('MESSAGE_COMPONENT: the "none of these" button becomes the modal-opening action', () => {
  const d = routeInteraction({
    type: 3,
    token: 'tok',
    data: { custom_id: buildConvCustomId('more', 'ab12cd34') },
    member: { user: { id: 'u42' } },
  });
  assert.equal(d.kind === 'gabi_component' && d.action, 'more');
});

test('MESSAGE_COMPONENT: malformed gc| ids fall through to bad_component, never a guess', () => {
  for (const customId of [
    'gc|pick', //          missing nonce
    'gc|delete|abc', //    an action this build never emits
    'gc|pick|../etc', //   not a nonce
    'gc|pick|a|b', //      too many parts
  ]) {
    assert.equal(routeInteraction({ type: 3, token: 't', data: { custom_id: customId } }).kind, 'bad_component', customId);
  }
});

test('⚠️ a component press in a DM carries no guild_id, which is how the DM memory is found', () => {
  const d = routeInteraction({
    type: 3,
    token: 'tok',
    channel_id: 'dm1',
    data: { custom_id: buildConvCustomId('pick', 'zz99'), values: ['0'] },
    user: { id: 'u42' },
  });
  assert.equal(d.kind === 'gabi_component' && d.actor.guildId, '');
  assert.equal(d.kind === 'gabi_component' && d.actor.channelId, 'dm1');
});

test('MODAL_SUBMIT: the typed text is read out of the Label (18) shape Discord now sends', () => {
  const d = routeInteraction({
    type: 5,
    token: 'tok',
    channel_id: 'ch1',
    guild_id: 'g1',
    data: {
      custom_id: buildModalCustomId('ab12cd34'),
      components: [
        { type: 18, component: { type: 4, custom_id: 'gcq', value: '  the second Mistborn one  ' } },
      ],
    },
    member: { user: { id: 'u42' } },
  });
  assert.equal(d.kind, 'gabi_modal');
  assert.equal(d.kind === 'gabi_modal' && d.nonce, 'ab12cd34');
  assert.equal(d.kind === 'gabi_modal' && d.text, 'the second Mistborn one');
});

test('MODAL_SUBMIT: the DEPRECATED Action Row shape is read too — both are live', () => {
  // Discord's component reference (2026-08-17) says Text Input inside an Action
  // Row is deprecated in modals, not removed. A build that only understood the
  // new shape would silently receive an EMPTY question from an older client.
  const d = routeInteraction({
    type: 5,
    token: 'tok',
    data: {
      custom_id: buildModalCustomId('ab12cd34'),
      components: [{ type: 1, components: [{ type: 4, custom_id: 'gcq', value: 'hello' }] }],
    },
    member: { user: { id: 'u42' } },
  });
  assert.equal(d.kind === 'gabi_modal' && d.text, 'hello');
});

test('MODAL_SUBMIT: a custom_id this build never issued is bad_component, not an answer', () => {
  assert.equal(routeInteraction({ type: 5, data: { custom_id: 'someone-elses-modal' } }).kind, 'bad_component');
});

test('⚠️ a continuity press while the posture is OFF is answered in words, and touches nothing', async () => {
  // GABI_MENTIONS off means she is not connected at all. A button from before
  // the flip must say so rather than wake the Durable Object, which is the
  // account's most expensive resource. (It was 83% of a hard free-plan daily
  // cap when this was written; the account has since moved to Workers Paid per
  // docs/TODO.md, which makes it cheaper, not free — and the posture answer is
  // about the SWITCH, not the money, so it holds on either plan.)
  const res = await signedPost({
    type: 3,
    token: 'tok',
    application_id: 'app',
    channel_id: 'ch1',
    data: { custom_id: buildConvCustomId('pick', 'ab12cd34'), values: ['0'] },
    member: { user: { id: 'u42' } },
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as { type: number; data: { content: string; flags: number } };
  assert.equal(data.type, 4);
  assert.equal(data.data.flags, EPHEMERAL);
  assert.match(data.data.content, /not listening/i);
  assert.match(data.data.content, /Nothing happened/i);
  // ⚠️ It must SAY it is not a permissions problem, not merely avoid the word.
  // A silent refusal sends people asking for access they already have — the
  // estate's no-bare-status rule applied to a switch rather than to a role.
  assert.match(data.data.content, /nothing to do with your permissions/i);
  assert.match(data.data.content, /estate setting/i, 'it names WHAT happened, not just that it did');
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
    // Added with phase A of conversational GABI (2026-08-17), same honest-false
    // contract as every row above. ⚠️ Its `false` is a LADDER rather than a
    // ships-dark gate: with no key she still answers @mentions from the keyword
    // router, so this row means "duller", not "broken".
    anthropic_key_gabi: false,
    // Added with the GROQ FIRST-LINE RUNG (2026-09-01), and its `false` is a
    // LADDER exactly as its Anthropic neighbour's is: with no key `viaGroq` is
    // a straight call to the existing Haiku path whatever `GABI_GROQ` says, so
    // this row means "no cheap first line", never "broken". ⚠️ A boolean about a
    // NAME — it is not proof the value works; only a `gabi_groq` log line with
    // `outcome: "groq"` is that. The POSTURE is its own top-level `gabi_groq`
    // row, deliberately not folded in here: the key and the switch are two
    // independent owner steps and neither alone changes an answer.
    groq_key_gabi: false,
    // Added with TIER 1 (2026-08-18) — the delegated write door's bearer, and
    // the same honest-false contract as every row above. ⚠️ Its `false` is a
    // ships-dark gate rather than a ladder: with it unset she says "I'm not
    // wired up to write yet" in words, and every read-only answer is unchanged.
    estate_app_token_discord: false,
    // Added with TIER 0b (2026-08-18) — the DOCS door's bearer, and ⚠️ a
    // DIFFERENT secret from the row above rather than a reuse of it. That one
    // is shared with both library Workers; this one has exactly two holders
    // (this Worker and the auth Worker), because the estate docs corpus carries
    // break-glass SQL, secret names and household emails and must not be opened
    // by a leak from a catalog. Same honest-false, ships-dark contract.
    estate_app_token_discord_docs: false,
  });
  assert.ok(!JSON.stringify(data).includes('abc'));
});

test('health: gabi_delegated_ready needs the switch AND the app token AND the SA', async () => {
  // ⚠️ Three things, ANDed here rather than left for a reader to AND themselves
  // — the same shape as `poll_sync_ready` below, and for the same reason: a
  // half-configured write door must be visibly not-ready from outside.
  const read = async (env: Record<string, string>) => {
    const res = await app.request('/api/health', {}, env);
    return (await res.json()) as {
      gabi_delegated_enabled: boolean;
      gabi_delegated_ready: boolean;
      gabi_delegated_verbs: string[];
    };
  };
  assert.equal((await read({})).gabi_delegated_ready, false, 'unset is OFF, never open');
  assert.equal(
    (await read({ GABI_DELEGATED_WRITES: 'true' })).gabi_delegated_enabled,
    false,
    '"true" is not "on" — affirmative-only, exactly like MODERATION_ENABLED',
  );
  assert.equal(
    (await read({ GABI_DELEGATED_WRITES: 'on', ESTATE_APP_TOKEN_DISCORD: 't' })).gabi_delegated_ready,
    false,
    'no service account means no way to answer "who is this?" — not ready',
  );
  const live = await read({
    GABI_DELEGATED_WRITES: 'on',
    ESTATE_APP_TOKEN_DISCORD: 't',
    FIREBASE_SERVICE_ACCOUNT: '{}',
  });
  assert.equal(live.gabi_delegated_ready, true);
  // ⚠️ The write surface, stated from outside. A verb that mutates existing
  // data, deletes anything or touches a role appearing here would mean the
  // T0–T4 ladder moved, and this is where that becomes visible in one curl.
  // ⚠️ `browse-works` joined 2026-08-19 and is a READ — it lists the library's
  // print shelf on the asker's behalf. The property this pins is unchanged: a
  // verb that MUTATES existing data, deletes anything or touches a role
  // appearing here still means the ladder moved.
  assert.deepEqual(live.gabi_delegated_verbs, [
    'whoami', 'add-isbn', 'run-details', 'browse-works',
  ]);
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
