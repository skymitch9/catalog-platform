/**
 * MODERATION — the kill-switch contract first, because it is the reason this
 * build exists in the shape it does, and everything else second.
 *
 * ⚠️ The switch tests are written to fail if anybody ever makes
 * `MODERATION_ENABLED` permissive ("true", "1", "yes"), and to fail if a
 * moderation path ever performs I/O while it is off. Both are the exact
 * mistakes that would turn a dark build into a live one without anyone
 * deciding to.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditDocId,
  auditFields,
  buildConfirmCustomId,
  BULK_DELETE_MAX_AGE_MS,
  CLEANUP_CONTAINS_MAX,
  CLEANUP_CONTAINS_MAX_BYTES,
  CLEANUP_MAX,
  CONFIRM_TTL_MS,
  hasPermission,
  humanizeSeconds,
  MAX_TIMEOUT_SECONDS,
  MOD_AUDIT_COLLECTION,
  MOD_CONFIRM_PREFIX,
  MOD_MSG,
  moderationOn,
  parseCleanupArgs,
  parseDuration,
  parsePermissions,
  PERMISSION,
  selectForCleanup,
  verifyConfirmCustomId,
  type ChannelMessage,
  type CleanupPlan,
  type ModAuditEntry,
} from '../src/moderation.js';
import {
  describeSelection,
  messageFromDiscord,
  planCleanup,
  planTimeout,
  runCleanupConfirm,
  runCleanupPreview,
  runTimeout,
  type DiscordCallResult,
  type ModCallContext,
  type ModDeps,
} from '../src/mod-actions.js';
import { commandNames, commandsFor, MODERATION_COMMANDS } from '../src/commands.js';
import {
  CLEANUP_COMMAND_NAME,
  EPHEMERAL,
  routeInteraction,
  TIMEOUT_COMMAND_NAME,
} from '../src/interactions.js';
import { app } from '../src/index.js';
import { signedPost } from './helpers/signed-post.js';

const MOD_BITS = (PERMISSION.MODERATE_MEMBERS | PERMISSION.MANAGE_MESSAGES).toString();
const NO_BITS = '0';

/** Real Discord ids are numeric snowflakes; using them here is what makes the
 * self-target and bot-target tests exercise the branch they name. */
const ACTOR_ID = '111222333444555666';
const GABI_ID = '1538775435880562758';

const ctxWith = (over: Partial<ModCallContext> = {}): ModCallContext => ({
  enabled: true,
  permissionsRaw: MOD_BITS,
  guildId: 'g1',
  channelId: 'c1',
  actorId: ACTOR_ID,
  actorName: 'Mod Person',
  applicationId: GABI_ID,
  ...over,
});

// ===========================================================================
// 1. THE KILL SWITCH — wrangler.toml's deployed contract
// ===========================================================================

test('moderationOn is affirmative: only "on" (trimmed, any case) turns it on', () => {
  for (const value of ['on', 'ON', ' on ', 'On']) {
    assert.equal(moderationOn({ MODERATION_ENABLED: value }), true, value);
  }
  // ⚠️ Every one of these is OFF on purpose. A typo, a truthy-looking string,
  // or an absent var all fail CLOSED.
  for (const value of [undefined, '', 'off', 'true', '1', 'yes', 'enabled', 'onn', 'no']) {
    assert.equal(moderationOn({ MODERATION_ENABLED: value }), false, String(value));
  }
});

test('/api/health reports the switch honestly — the dark state is visible from outside', async () => {
  const read = async (env: Record<string, string>) => {
    const res = await app.request('/api/health', {}, env);
    return (await res.json()) as { moderation_enabled: boolean; have_scope: string; features: string[] };
  };
  assert.equal((await read({})).moderation_enabled, false);
  assert.equal((await read({ MODERATION_ENABLED: 'off' })).moderation_enabled, false);
  assert.equal((await read({ MODERATION_ENABLED: 'true' })).moderation_enabled, false);
  assert.equal((await read({ MODERATION_ENABLED: 'on' })).moderation_enabled, true);
  // And the /have scope is STATED, so a change to the privacy line is visible
  // rather than something a reader has to infer from a search result.
  assert.equal((await read({})).have_scope, 'audiobook');
  assert.ok((await read({})).features.includes('moderation_dark'));
  assert.ok((await read({})).features.includes('have_command'));
});

test('the switched-off answer says what happened, that nothing was done, and whose step it is', () => {
  assert.match(MOD_MSG.switchedOff, /switched off/i);
  assert.match(MOD_MSG.switchedOff, /nothing happened/i);
  assert.match(MOD_MSG.switchedOff, /MODERATION_ENABLED/);
  assert.match(MOD_MSG.switchedOff, /not a problem with your permissions/i);
});

test('OFF: /timeout, /cleanup and a confirm press all answer the off-switch — and do NO I/O', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('a switched-off moderation path must never reach the network');
  }) as typeof fetch;
  try {
    // Every falsy spelling of the switch, including the var being absent —
    // and including "true", which must NOT enable it.
    for (const MODERATION_ENABLED of [undefined, 'off', 'true', '1']) {
      const env: Record<string, string> =
        MODERATION_ENABLED === undefined ? {} : { MODERATION_ENABLED };
      const payloads = [
        {
          type: 2,
          token: 't',
          application_id: 'app',
          guild_id: 'g1',
          channel_id: 'c1',
          data: {
            name: TIMEOUT_COMMAND_NAME,
            options: [
              { name: 'user', type: 6, value: '123' },
              { name: 'duration', type: 3, value: '10m' },
            ],
          },
          member: { user: { id: 'u-mod' }, permissions: MOD_BITS },
        },
        {
          type: 2,
          token: 't',
          application_id: 'app',
          guild_id: 'g1',
          channel_id: 'c1',
          data: { name: CLEANUP_COMMAND_NAME, options: [{ name: 'count', type: 4, value: 10 }] },
          member: { user: { id: 'u-mod' }, permissions: MOD_BITS },
        },
        {
          type: 3,
          token: 't',
          application_id: 'app',
          guild_id: 'g1',
          channel_id: 'c1',
          data: { custom_id: `${MOD_CONFIRM_PREFIX}|zzzz|10||ffffffffffffffff` },
          member: { user: { id: 'u-mod' }, permissions: MOD_BITS },
        },
      ];
      for (const payload of payloads) {
        const res = await signedPost(payload, { ...env, DISCORD_BOT_TOKEN: 'bot-token' });
        assert.equal(res.status, 200);
        const data = (await res.json()) as { type: number; data: { content: string; flags: number } };
        assert.equal(data.type, 4, 'an immediate ephemeral, never a deferral');
        assert.equal(data.data.flags, EPHEMERAL);
        assert.equal(data.data.content, MOD_MSG.switchedOff);
      }
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('OFF beats everything else: a caller with NO permissions still hears only the off-switch', () => {
  const off = ctxWith({ enabled: false, permissionsRaw: NO_BITS });
  const timeout = planTimeout(off, { targetUserId: '123', targetName: 'X', duration: 'nonsense', reason: '' });
  const cleanup = planCleanup(off, { count: 9999 });
  assert.equal(timeout.kind, 'refuse');
  assert.equal(cleanup.kind, 'refuse');
  if (timeout.kind === 'refuse') assert.equal(timeout.message, MOD_MSG.switchedOff);
  // ⚠️ Not the "over the cap" message: an off bot reveals nothing about the
  // request it was handed, including whether it was valid.
  if (cleanup.kind === 'refuse') assert.equal(cleanup.message, MOD_MSG.switchedOff);
});

test('the flows re-check the switch themselves, even when the router already did', async () => {
  const seen: string[] = [];
  const deps = spyDeps({ respond: async (p) => { seen.push(JSON.stringify(p)); } });
  const off = ctxWith({ enabled: false });
  await runTimeout(deps, off, { targetUserId: '1', targetName: 'X', seconds: 60, label: '1 minute', reason: '' });
  await runCleanupPreview(deps, off, { count: 5, targetUserId: '', contains: '' });
  await runCleanupConfirm(deps, off, { count: 5, targetUserId: '', contains: '' });
  assert.equal(seen.length, 3);
  for (const s of seen) assert.ok(s.includes('switched off'));
  assert.equal(deps.log.timeouts.length, 0);
  assert.equal(deps.log.lists.length, 0);
  assert.equal(deps.log.deletes.length, 0);
  assert.equal(deps.log.audits.length, 0, 'a switched-off path writes no audit line');
});

// ===========================================================================
// 2. MIRRORING THE CALLER'S AUTHORITY
// ===========================================================================

test('parsePermissions: a decimal string, or null for absent/garbage (the DM case)', () => {
  assert.equal(parsePermissions('8192'), 8192n);
  assert.equal(parsePermissions(' 1099511627776 '), 1099511627776n);
  assert.equal(parsePermissions(undefined), null);
  assert.equal(parsePermissions(''), null);
  assert.equal(parsePermissions('0x2000'), null);
  assert.equal(parsePermissions(8192), null); // Discord always sends a STRING
});

test('hasPermission: the exact bit, or ADMINISTRATOR which implies everything', () => {
  assert.ok(hasPermission(PERMISSION.MODERATE_MEMBERS, PERMISSION.MODERATE_MEMBERS));
  assert.ok(!hasPermission(PERMISSION.MANAGE_MESSAGES, PERMISSION.MODERATE_MEMBERS));
  assert.ok(hasPermission(PERMISSION.ADMINISTRATOR, PERMISSION.MODERATE_MEMBERS));
  assert.ok(hasPermission(PERMISSION.ADMINISTRATOR, PERMISSION.MANAGE_MESSAGES));
  assert.ok(!hasPermission(null, PERMISSION.MANAGE_MESSAGES));
  assert.ok(!hasPermission(0n, PERMISSION.MANAGE_MESSAGES));
});

test('/timeout WITHOUT Moderate Members: refused, and the refusal NAMES the permission', () => {
  const decision = planTimeout(ctxWith({ permissionsRaw: PERMISSION.MANAGE_MESSAGES.toString() }), {
    targetUserId: '123',
    targetName: 'X',
    duration: '10m',
    reason: '',
  });
  assert.equal(decision.kind, 'refuse');
  if (decision.kind !== 'refuse') return;
  assert.match(decision.message, /Moderate Members/);
  assert.match(decision.message, /Nothing happened/);
  assert.match(decision.message, /mirrors \*\*your\*\* authority/);
});

test('/cleanup WITHOUT Manage Messages: refused, naming that permission', () => {
  const decision = planCleanup(ctxWith({ permissionsRaw: PERMISSION.MODERATE_MEMBERS.toString() }), {
    count: 5,
  });
  assert.equal(decision.kind, 'refuse');
  if (decision.kind !== 'refuse') return;
  assert.match(decision.message, /Manage Messages/);
  assert.match(decision.message, /Nothing was deleted/);
});

test('WITH the permission bit, both commands proceed', () => {
  const t = planTimeout(ctxWith({ permissionsRaw: PERMISSION.MODERATE_MEMBERS.toString() }), {
    targetUserId: '123',
    targetName: 'Sam',
    duration: '1h',
    reason: 'spam',
  });
  assert.equal(t.kind, 'proceed');
  if (t.kind === 'proceed') {
    assert.equal(t.plan.seconds, 3600);
    assert.equal(t.plan.targetName, 'Sam');
    assert.equal(t.plan.reason, 'spam');
  }
  const c = planCleanup(ctxWith({ permissionsRaw: PERMISSION.MANAGE_MESSAGES.toString() }), { count: 5 });
  assert.equal(c.kind, 'proceed');
});

test('a DM (no permissions, no guild) is answered as "not here", NOT as a permissions refusal', () => {
  const decision = planTimeout(ctxWith({ permissionsRaw: undefined, guildId: '' }), {
    targetUserId: '123',
    targetName: 'X',
    duration: '10m',
    reason: '',
  });
  assert.equal(decision.kind, 'refuse');
  if (decision.kind === 'refuse') assert.equal(decision.message, MOD_MSG.dmOnly);
});

test('GABI refuses to time out the caller or herself, and refuses a missing target', () => {
  const self = planTimeout(ctxWith(), { targetUserId: ACTOR_ID, targetName: 'Me', duration: '10m', reason: '' });
  const bot = planTimeout(ctxWith(), { targetUserId: GABI_ID, targetName: 'GABI', duration: '10m', reason: '' });
  const none = planTimeout(ctxWith(), { targetUserId: '', targetName: '', duration: '10m', reason: '' });
  assert.equal((self as { message: string }).message, MOD_MSG.selfTarget);
  assert.equal((bot as { message: string }).message, MOD_MSG.botTarget);
  assert.equal((none as { message: string }).message, MOD_MSG.noTarget);
});

// ===========================================================================
// 3. DURATION PARSING
// ===========================================================================

test('parseDuration: the documented shapes', () => {
  const cases: Array<[string, number]> = [
    ['30s', 30],
    ['10m', 600],
    ['1h', 3600],
    ['1d', 86400],
    ['1w', 604800],
    ['1h30m', 5400],
    [' 1H 30M ', 5400],
    ['28d', MAX_TIMEOUT_SECONDS],
  ];
  for (const [raw, seconds] of cases) {
    const parsed = parseDuration(raw);
    assert.ok(parsed.ok, raw);
    if (parsed.ok) assert.equal(parsed.seconds, seconds, raw);
  }
});

test('parseDuration: every refusal is worded, names the shapes, and NEVER guesses a unit', () => {
  const bare = parseDuration('10');
  assert.ok(!bare.ok);
  if (!bare.ok) {
    assert.match(bare.message, /no unit/);
    assert.match(bare.message, /will not guess/);
    assert.match(bare.message, /nobody was timed out/i);
  }
  for (const raw of ['soon', '10x', '', 'm10', '1h30']) {
    const parsed = parseDuration(raw);
    assert.ok(!parsed.ok, raw);
    if (!parsed.ok) assert.match(parsed.message, /nobody was timed out/i, raw);
  }
});

test('parseDuration: Discord\'s 28-day ceiling is enforced and NAMED', () => {
  for (const raw of ['29d', '5w', '700h']) {
    const parsed = parseDuration(raw);
    assert.ok(!parsed.ok, raw);
    if (!parsed.ok) assert.match(parsed.message, /28 days/, raw);
  }
  assert.equal(MAX_TIMEOUT_SECONDS, 28 * 24 * 3600);
});

test('humanizeSeconds words the confirmation instead of printing a number', () => {
  assert.equal(humanizeSeconds(5400), '1 hour 30 minutes');
  assert.equal(humanizeSeconds(60), '1 minute');
  assert.equal(humanizeSeconds(86400), '1 day');
});

// ===========================================================================
// 4. CLEANUP RAILS
// ===========================================================================

test('parseCleanupArgs: the hard cap is refused in words, never silently clamped', () => {
  const over = parseCleanupArgs({ count: CLEANUP_MAX + 1 });
  assert.ok(!over.ok);
  if (!over.ok) {
    assert.match(over.message, new RegExp(String(CLEANUP_MAX)));
    assert.match(over.message, /Nothing was deleted/);
    assert.match(over.message, /cannot be undone/);
  }
  for (const count of [0, -3, 1.5, 'twelve']) {
    assert.equal(parseCleanupArgs({ count }).ok, false, String(count));
  }
  assert.equal(parseCleanupArgs({ count: CLEANUP_MAX }).ok, true);
});

test('parseCleanupArgs: an over-long text filter is REFUSED, never truncated', () => {
  const long = 'x'.repeat(CLEANUP_CONTAINS_MAX + 1);
  const parsed = parseCleanupArgs({ count: 5, contains: long });
  assert.ok(!parsed.ok);
  // Truncating would delete a different set than the preview showed.
  if (!parsed.ok) assert.match(parsed.message, new RegExp(String(CLEANUP_CONTAINS_MAX)));
  assert.equal(parseCleanupArgs({ count: 5, contains: 'x'.repeat(CLEANUP_CONTAINS_MAX) }).ok, true);
});

const msg = (over: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id: 'm1',
  content: 'hello',
  timestampMs: Date.now(),
  authorId: 'a1',
  authorName: 'Someone',
  ...over,
});

test('selectForCleanup: the 14-day line, pins, and both filters', () => {
  const now = Date.now();
  const messages = [
    msg({ id: 'young', timestampMs: now - 1000 }),
    msg({ id: 'old', timestampMs: now - BULK_DELETE_MAX_AGE_MS - 1000 }),
    msg({ id: 'pinned', pinned: true }),
    msg({ id: 'other-author', authorId: 'a2' }),
    msg({ id: 'no-match', content: 'nothing here' }),
  ];
  const all = selectForCleanup(messages, { count: 50, targetUserId: '', contains: '' }, now);
  assert.deepEqual(all.deletable.map((m) => m.id), ['young', 'other-author', 'no-match']);
  assert.deepEqual(all.tooOld.map((m) => m.id), ['old']);
  assert.deepEqual(all.pinned.map((m) => m.id), ['pinned']);

  const byAuthor = selectForCleanup(messages, { count: 50, targetUserId: 'a2', contains: '' }, now);
  assert.deepEqual(byAuthor.deletable.map((m) => m.id), ['other-author']);

  const byText = selectForCleanup(messages, { count: 50, targetUserId: '', contains: 'HELLO' }, now);
  assert.ok(byText.deletable.every((m) => m.content?.includes('hello')));
});

test('the preview surfaces the 14-day limit and the pins IN WORDS, never a silent partial', () => {
  const now = Date.now();
  const selection = selectForCleanup(
    [
      msg({ id: 'a', timestampMs: now - 1000 }),
      msg({ id: 'b', timestampMs: now - BULK_DELETE_MAX_AGE_MS - 1 }),
      msg({ id: 'c', pinned: true }),
    ],
    { count: 10, targetUserId: '', contains: '' },
    now,
  );
  const text = describeSelection(selection, { count: 10, targetUserId: '', contains: '' });
  assert.match(text, /Nothing has been deleted yet/);
  assert.match(text, /14 days old/);
  assert.match(text, /pinned/);
  assert.match(text, /two minutes/);
  assert.match(text, /cannot be undone/);
});

test('messageFromDiscord: an unreadable timestamp lands on the SAFE side of the 14-day line', () => {
  const parsed = messageFromDiscord({ id: 'x', timestamp: 'not-a-date', author: { id: 'a' } });
  assert.ok(parsed);
  const selection = selectForCleanup([parsed!], { count: 5, targetUserId: '', contains: '' }, Date.now());
  assert.equal(selection.deletable.length, 0);
  assert.equal(selection.tooOld.length, 1);
});

// ===========================================================================
// 5. THE CONFIRM BUTTON'S LIFECYCLE
// ===========================================================================

const KEY = 'a-bot-token-standing-in-for-the-real-one';
const PLAN: CleanupPlan = { count: 12, targetUserId: '987654321098765432', contains: 'spam link' };
const BINDING = { invokerId: '111222333444555666', channelId: '777888999000111222' };

test('a fresh confirm id verifies, and fits inside Discord\'s 100-character ceiling', async () => {
  const now = Date.now();
  const id = await buildConfirmCustomId(KEY, PLAN, BINDING, now + CONFIRM_TTL_MS);
  assert.ok(id.length <= 100, `custom_id was ${id.length} characters`);
  const parsed = await verifyConfirmCustomId(KEY, id, BINDING, now);
  assert.ok(parsed.ok);
  if (parsed.ok) assert.deepEqual(parsed.plan, PLAN);
});

test('the longest legal plan still fits the 100-character ceiling — measured in BYTES', async () => {
  // ⚠️ This test found a real bug: the cap was written in CHARACTERS while the
  // custom_id carries base64 of BYTES, so a 32-character accented filter
  // produced a 115-character custom_id — a confirm button that would not have
  // rendered at all, for exactly the people whose language uses accents.
  const worst: CleanupPlan = {
    count: CLEANUP_MAX,
    targetUserId: '9'.repeat(20),
    contains: 'é'.repeat(CLEANUP_CONTAINS_MAX_BYTES / 2), // 32 bytes, 16 characters
  };
  assert.equal(new TextEncoder().encode(worst.contains).length, CLEANUP_CONTAINS_MAX_BYTES);
  assert.equal(parseCleanupArgs({ count: worst.count, contains: worst.contains }).ok, true);
  const id = await buildConfirmCustomId(KEY, worst, BINDING, Date.now() + CONFIRM_TTL_MS);
  assert.ok(id.length <= 100, `worst-case custom_id was ${id.length} characters`);

  // One byte over is REFUSED in words rather than truncated.
  const over = parseCleanupArgs({ count: 5, contains: 'é'.repeat(CLEANUP_CONTAINS_MAX_BYTES / 2) + 'x' });
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.message, /accented letters/);
});

test('a STALE confirm cannot fire — and is told so distinctly from a forged one', async () => {
  const now = Date.now();
  const id = await buildConfirmCustomId(KEY, PLAN, BINDING, now + CONFIRM_TTL_MS);
  const parsed = await verifyConfirmCustomId(KEY, id, BINDING, now + CONFIRM_TTL_MS + 1);
  assert.ok(!parsed.ok);
  if (!parsed.ok) assert.equal(parsed.reason, 'expired');
  assert.match(MOD_MSG.confirmExpired, /nothing was deleted/i);
  assert.match(MOD_MSG.confirmExpired, /two minutes/);
});

test('the MAC binds the invoker AND the channel, without transmitting either', async () => {
  const now = Date.now();
  const id = await buildConfirmCustomId(KEY, PLAN, BINDING, now + CONFIRM_TTL_MS);
  assert.ok(!id.includes(BINDING.invokerId), 'the invoker is associated data, not payload');
  assert.ok(!id.includes(BINDING.channelId), 'the channel is associated data, not payload');

  const otherUser = await verifyConfirmCustomId(KEY, id, { ...BINDING, invokerId: '999' }, now);
  const otherChannel = await verifyConfirmCustomId(KEY, id, { ...BINDING, channelId: '999' }, now);
  const otherKey = await verifyConfirmCustomId('a-different-bot-token', id, BINDING, now);
  for (const parsed of [otherUser, otherChannel, otherKey]) {
    assert.ok(!parsed.ok);
    if (!parsed.ok) assert.equal(parsed.reason, 'invalid');
  }
});

test('tampering with the plan invalidates the id — the count cannot be edited upward', async () => {
  const now = Date.now();
  const id = await buildConfirmCustomId(KEY, { count: 5, targetUserId: '', contains: '' }, BINDING, now + CONFIRM_TTL_MS);
  const parts = id.split('|');
  parts[2] = String(CLEANUP_MAX);
  const parsed = await verifyConfirmCustomId(KEY, parts.join('|'), BINDING, now);
  assert.ok(!parsed.ok);
  if (!parsed.ok) assert.equal(parsed.reason, 'invalid');
});

test('a garbage custom_id is "invalid", never "expired" — a forger learns nothing', async () => {
  for (const id of [`${MOD_CONFIRM_PREFIX}|zz|1||dead`, 'mc|', 'pv|clubs|a|b|0', 'mc|1|2|3|4|5']) {
    const parsed = await verifyConfirmCustomId(KEY, id, BINDING, Date.now());
    assert.ok(!parsed.ok, id);
    if (!parsed.ok) assert.equal(parsed.reason, 'invalid', id);
  }
});

// ===========================================================================
// 6. THE FLOWS (with the switch ON, which production is NOT)
// ===========================================================================

interface SpyLog {
  timeouts: Array<{ guildId: string; userId: string; untilIso: string; reason: string }>;
  lists: Array<{ channelId: string; limit: number }>;
  deletes: Array<{ kind: 'bulk' | 'one'; ids: string[] }>;
  audits: ModAuditEntry[];
  responses: unknown[];
}

function spyDeps(
  over: Partial<ModDeps> & { messages?: ChannelMessage[]; result?: DiscordCallResult } = {},
): ModDeps & { log: SpyLog } {
  const log: SpyLog = { timeouts: [], lists: [], deletes: [], audits: [], responses: [] };
  const result = over.result ?? { ok: true, status: 200 };
  const deps: ModDeps & { log: SpyLog } = {
    log,
    confirmKey: KEY,
    now: () => 1_760_000_000_000,
    async timeoutMember(guildId, userId, untilIso, reason) {
      log.timeouts.push({ guildId, userId, untilIso, reason });
      return result;
    },
    async listMessages(channelId, limit) {
      log.lists.push({ channelId, limit });
      return over.messages ?? [];
    },
    async bulkDelete(_channelId, ids) {
      log.deletes.push({ kind: 'bulk', ids: [...ids] });
      return result;
    },
    async deleteOne(_channelId, id) {
      log.deletes.push({ kind: 'one', ids: [id] });
      return result;
    },
    async writeAudit(entry) {
      log.audits.push(entry);
    },
    async respond(payload) {
      log.responses.push(payload);
    },
  };
  return Object.assign(deps, over) as ModDeps & { log: SpyLog };
}

test('runTimeout: applies the timeout, words the confirmation, and writes ONE audit line', async () => {
  const deps = spyDeps();
  await runTimeout(deps, ctxWith(), {
    targetUserId: '123',
    targetName: 'Sam',
    seconds: 3600,
    label: '1 hour',
    reason: 'spam',
  });
  assert.equal(deps.log.timeouts.length, 1);
  assert.equal(deps.log.timeouts[0]!.userId, '123');
  assert.equal(
    deps.log.timeouts[0]!.untilIso,
    new Date(1_760_000_000_000 + 3_600_000).toISOString(),
  );
  assert.match(deps.log.timeouts[0]!.reason, /Mod Person/);
  assert.equal(deps.log.audits.length, 1);
  assert.equal(deps.log.audits[0]!.outcome, 'applied');
  assert.match(JSON.stringify(deps.log.responses[0]), /Sam/);
  assert.match(JSON.stringify(deps.log.responses[0]), /1 hour/);
});

test('runTimeout: a Discord refusal is worded as ROLE ORDER, audited, and never claimed as done', async () => {
  const deps = spyDeps({ result: { ok: false, status: 403 } });
  await runTimeout(deps, ctxWith(), {
    targetUserId: '123',
    targetName: 'Sam',
    seconds: 60,
    label: '1 minute',
    reason: '',
  });
  const said = JSON.stringify(deps.log.responses[0]);
  assert.match(said, /nobody was timed out/i);
  assert.match(said, /role order/i);
  assert.equal(deps.log.audits[0]!.outcome, 'refused_by_discord');
});

test('runCleanupPreview: previews with a DANGER confirm button and deletes nothing', async () => {
  const now = 1_760_000_000_000;
  const deps = spyDeps({ messages: [msg({ id: 'a', timestampMs: now - 1000 })] });
  await runCleanupPreview(deps, ctxWith(), { count: 5, targetUserId: '', contains: '' });
  assert.equal(deps.log.deletes.length, 0);
  const payload = deps.log.responses[0] as {
    content: string;
    components: Array<{ components: Array<{ style: number; custom_id: string }> }>;
  };
  assert.match(payload.content, /Nothing has been deleted yet/);
  assert.equal(payload.components[0]!.components[0]!.style, 4);
  assert.ok(payload.components[0]!.components[0]!.custom_id.startsWith(`${MOD_CONFIRM_PREFIX}|`));
});

test('runCleanupPreview: nothing to delete means NO button — a confirm that does nothing is a trap', async () => {
  const deps = spyDeps({ messages: [] });
  await runCleanupPreview(deps, ctxWith(), { count: 5, targetUserId: '', contains: '' });
  const payload = deps.log.responses[0] as { content: string; components?: unknown };
  assert.equal(payload.components, undefined);
  assert.match(payload.content, /0 messages/);
});

test('runCleanupConfirm: bulk-deletes, states the 14-day leftovers, audits the count', async () => {
  const now = 1_760_000_000_000;
  const deps = spyDeps({
    messages: [
      msg({ id: 'a', timestampMs: now - 1000 }),
      msg({ id: 'b', timestampMs: now - 2000 }),
      msg({ id: 'old', timestampMs: now - BULK_DELETE_MAX_AGE_MS - 1 }),
    ],
  });
  await runCleanupConfirm(deps, ctxWith(), { count: 10, targetUserId: '', contains: '' });
  assert.deepEqual(deps.log.deletes, [{ kind: 'bulk', ids: ['a', 'b'] }]);
  const said = JSON.stringify(deps.log.responses[0]);
  assert.match(said, /Deleted \*\*2 messages\*\*/);
  assert.match(said, /14 days/);
  assert.equal(deps.log.audits[0]!.messagesDeleted, 2);
  assert.equal(deps.log.audits[0]!.action, 'cleanup');
});

test('runCleanupConfirm: exactly one message uses the single-delete door (bulk refuses one)', async () => {
  const now = 1_760_000_000_000;
  const deps = spyDeps({ messages: [msg({ id: 'only', timestampMs: now - 1000 })] });
  await runCleanupConfirm(deps, ctxWith(), { count: 10, targetUserId: '', contains: '' });
  assert.deepEqual(deps.log.deletes, [{ kind: 'one', ids: ['only'] }]);
});

test('runCleanupConfirm: the permission is re-checked AT PRESS TIME, not just at preview', async () => {
  const deps = spyDeps({ messages: [msg()] });
  await runCleanupConfirm(deps, ctxWith({ permissionsRaw: NO_BITS }), {
    count: 10,
    targetUserId: '',
    contains: '',
  });
  assert.equal(deps.log.deletes.length, 0);
  assert.match(JSON.stringify(deps.log.responses[0]), /Manage Messages/);
});

test('runCleanupConfirm: a window that no longer matches deletes nothing and says so', async () => {
  const deps = spyDeps({ messages: [] });
  await runCleanupConfirm(deps, ctxWith(), { count: 10, targetUserId: '', contains: '' });
  assert.equal(deps.log.deletes.length, 0);
  assert.match(JSON.stringify(deps.log.responses[0]), /Nothing was deleted/);
});

// ===========================================================================
// 7. THE AUDIT CONTRACT (pinned the way discord_poll_messages is)
// ===========================================================================

test('the audit collection is the Worker-owned one, needing no firestore.rules change', () => {
  assert.equal(MOD_AUDIT_COLLECTION, 'discord_mod_audit');
});

test('auditFields: every value is a Firestore-typed value, and absent facts are ABSENT', () => {
  const at = '2026-08-17T12:00:00.000Z';
  const full = auditFields({
    action: 'timeout',
    outcome: 'applied',
    actorId: 'u1',
    actorName: 'Mod',
    guildId: 'g1',
    channelId: 'c1',
    targetUserId: 't1',
    durationSeconds: 600,
    reason: 'spam',
    at,
  });
  assert.deepEqual(full, {
    action: { stringValue: 'timeout' },
    outcome: { stringValue: 'applied' },
    actorId: { stringValue: 'u1' },
    actorName: { stringValue: 'Mod' },
    guildId: { stringValue: 'g1' },
    channelId: { stringValue: 'c1' },
    at: { timestampValue: at },
    targetUserId: { stringValue: 't1' },
    durationSeconds: { integerValue: '600' },
    reason: { stringValue: 'spam' },
  });
  // A cleanup has no target and no duration — those keys must not appear as
  // empty strings, which would read as "recorded, blank" rather than "n/a".
  const cleanup = auditFields({
    action: 'cleanup',
    outcome: 'applied',
    actorId: 'u1',
    actorName: 'Mod',
    guildId: 'g1',
    channelId: 'c1',
    messagesDeleted: 3,
    at,
  });
  assert.ok(!('targetUserId' in cleanup));
  assert.ok(!('durationSeconds' in cleanup));
  assert.deepEqual(cleanup.messagesDeleted, { integerValue: '3' });
});

test('auditDocId is sortable, path-safe, and collision-resistant', () => {
  const id = auditDocId('2026-08-17T12:00:00.000Z', 'abcd1234');
  assert.ok(!id.includes(':'));
  assert.ok(!id.includes('/'));
  assert.match(id, /^2026-08-17T12-00-00-000Z__abcd1234$/);
  assert.ok(auditDocId('2026-08-17T12:00:00.000Z', 'a') < auditDocId('2026-08-17T12:00:01.000Z', 'a'));
});

// ===========================================================================
// 8. REGISTRATION — the registry is a function of the switch
// ===========================================================================

// ⚠️ These two pin the WHOLE list, not just the moderation pair, and that is
// deliberate: the assertion that matters is "the switch adds exactly two names
// and removes exactly two", which a subset check cannot make. The base list
// grew to three when `/gabi` shipped (2026-08-17) — a base command being added
// SHOULD land here, as a one-line decision, rather than passing silently.
const BASE = ['link', 'have', 'gabi'];

test('while the switch is off, /timeout and /cleanup are NOT published to Discord', () => {
  const off = commandNames(commandsFor({ MODERATION_ENABLED: 'off' }));
  assert.deepEqual(off, BASE);
  assert.deepEqual(commandNames(commandsFor({})), BASE);
});

test('flipping the switch adds them — one re-run of the registration route', () => {
  const on = commandNames(commandsFor({ MODERATION_ENABLED: 'on' }));
  assert.deepEqual(on, [...BASE, TIMEOUT_COMMAND_NAME, CLEANUP_COMMAND_NAME]);
});

test('the moderation commands declare Discord\'s own permission gate as a second rail', () => {
  const byName = Object.fromEntries(MODERATION_COMMANDS.map((c) => [c.name, c]));
  assert.equal(
    byName[TIMEOUT_COMMAND_NAME]!.default_member_permissions,
    PERMISSION.MODERATE_MEMBERS.toString(),
  );
  assert.equal(
    byName[CLEANUP_COMMAND_NAME]!.default_member_permissions,
    PERMISSION.MANAGE_MESSAGES.toString(),
  );
  for (const command of MODERATION_COMMANDS) assert.equal(command.dm_permission, false);
});

test('the router answers /timeout and /cleanup even though they are unpublished', () => {
  // ⚠️ Visibility and behaviour are separate: a stale global command, or the
  // minutes after a flip, must land on the switched-off answer rather than on
  // "nothing answers /timeout".
  const t = routeInteraction({ type: 2, data: { name: TIMEOUT_COMMAND_NAME } });
  const c = routeInteraction({ type: 2, data: { name: CLEANUP_COMMAND_NAME } });
  assert.equal(t.kind, 'timeout_command');
  assert.equal(c.kind, 'cleanup_command');
});

test('a confirm press routes as mod_confirm, and a poll vote is untouched by any of this', () => {
  const confirm = routeInteraction({
    type: 3,
    token: 't',
    data: { custom_id: `${MOD_CONFIRM_PREFIX}|abc|5||deadbeefdeadbeef` },
  });
  assert.equal(confirm.kind, 'mod_confirm');
  const vote = routeInteraction({
    type: 3,
    token: 't',
    data: { custom_id: 'pv|clubs|club-A1|poll_B2|3' },
  });
  assert.equal(vote.kind, 'poll_vote');
});
