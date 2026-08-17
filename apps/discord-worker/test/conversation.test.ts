/**
 * CONVERSATION CONTINUITY — the five ways it can be silently wrong.
 *
 *   1. **She forgets anyway.** The owner's whole ask (*"I don't want to message
 *      GABI and then message her again and she has no recollection"*) reduces to
 *      one testable claim: turn 2 must see turn 1. A store that loads and never
 *      injects would pass every unit test and fail the only requirement.
 *   2. **She remembers FOREVER.** The window and the turn cap are a privacy
 *      posture, not a performance tweak — and aged-out state must be DELETED,
 *      which is a different assertion from "not returned".
 *   3. **The DOORS drift.** A reply with the ping left on, and a DM, are the two
 *      new intent-free ways in. Each rests on one sentence of Discord's
 *      documentation, and each fails silently if the payload test is wrong.
 *   4. **A conversation LEAKS.** Two people in one channel, or one person in two
 *      channels, must not share a memory — and a component in a public channel
 *      can be pressed by anybody at all.
 *   5. **The SHAPE stops being portable.** The record is a contract with the
 *      library site's GABI panel, which does not exist yet and therefore cannot
 *      complain when a Discord-shaped field is added to its middle.
 *
 * ⚠️ Nothing here can spend money: no test supplies an Anthropic key, so every
 * path runs on the keyword router and the deterministic renderings. That is
 * also what proves the clarifying-question machinery is model-independent.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appendTurns,
  buildChoiceComponents,
  buildConvCustomId,
  buildModalCustomId,
  buildQuestionModal,
  clipTurnText,
  conversationChars,
  conversationStorageKey,
  conversationKey,
  CONVERSATION_MAX_TURNS,
  CONVERSATION_SHAPE_VERSION,
  CONVERSATION_TURN_CHARS,
  CONVERSATION_WINDOW_MS,
  MAX_CHOICE_OPTIONS,
  modalInputValue,
  newNonce,
  parseConvCustomId,
  parseModalCustomId,
  PENDING_TTL_MS,
  pruneConversation,
  type ConversationRecord,
  type ConversationTurn,
  type PendingChoice,
} from '../src/conversation.js';
import { modelMessages } from '../src/gabi-chat.js';
import {
  choiceFor,
  handleMention,
  handlePick,
  handleTypedQuestion,
  NO_MEMORY,
  type ConversationDeps,
} from '../src/mention-flow.js';
import { mentionTrigger, type GatewayMessage } from '../src/mentions.js';
import { surfaceOf } from '../src/conversation-flow.js';

const APP_ID = '1538775435880562758';
const CFG = { indexBaseUrl: 'https://index.example', panelUrl: 'https://panel.example/' };

function msg(over: Partial<GatewayMessage> = {}): GatewayMessage {
  return {
    id: '900',
    channel_id: '500',
    guild_id: '100',
    type: 0,
    content: `<@${APP_ID}> do we have Mistborn?`,
    author: { id: '42', bot: false, username: 'sam', global_name: 'Sam' },
    mentions: [{ id: APP_ID }],
    ...over,
  };
}

/** The store, in memory — exactly the shape the Durable Object implements, so
 * a whole conversation can be driven without one. */
function memoryStore(): ConversationDeps & { turns: ConversationTurn[]; pending: PendingChoice | null } {
  const state = { turns: [] as ConversationTurn[], pending: null as PendingChoice | null };
  return {
    get turns() {
      return state.turns;
    },
    get pending() {
      return state.pending;
    },
    load: async () => ({ turns: state.turns, pending: state.pending }),
    save: async (entry) => {
      const now = Date.now();
      const next = appendTurns(
        { v: CONVERSATION_SHAPE_VERSION, key: conversationKey('t', 't', 't'), turns: state.turns, updatedAt: now },
        conversationKey('t', 't', 't'),
        [
          { role: 'user', text: entry.user, at: now },
          { role: 'assistant', text: entry.assistant, at: now },
        ],
        now,
        entry.pending,
      );
      state.turns = next?.turns ?? [];
      state.pending = next?.pending ?? null;
    },
  };
}

/** Answer the index with a fixed book list, and count how many times it was asked. */
function shelfServing(books: unknown[]): { restore: () => void; calls: () => number } {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ books }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { restore: () => void (globalThis.fetch = original), calls: () => calls };
}

const BOOK = (title: string, creator: string) => ({ title, creator, entries: [{ format: 'audiobook' }] });

// ── 1. she actually remembers ───────────────────────────────────────────────

describe("⚠️ the owner's requirement, as one assertion: turn 2 sees turn 1", () => {
  it('a second message finds the first already in the store', async () => {
    const store = memoryStore();
    const said: string[] = [];
    const serving = shelfServing([BOOK('Mistborn', 'Brandon Sanderson')]);
    try {
      const deps = {
        capCheck: async () => ({ ok: true }) as const,
        recordTurn: async () => {},
        conversation: store,
        reply: async (content: string) => void said.push(content),
      };
      const trigger = mentionTrigger(msg(), APP_ID);
      if (trigger.kind !== 'ask') return assert.fail('fixture is not a question');

      await handleMention(deps, trigger, CFG);
      assert.equal(store.turns.length, 2, 'one exchange is two turns: what they said and what she said');
      assert.equal(store.turns[0]!.role, 'user');
      assert.equal(store.turns[1]!.role, 'assistant');

      await handleMention(deps, trigger, CFG);
      assert.equal(store.turns.length, 4, 'the second exchange is APPENDED, not a fresh start');
      assert.equal(said.length, 2);
    } finally {
      serving.restore();
    }
  });

  it('⚠️ she greets on the FIRST turn only — a memory that re-introduces itself has none', async () => {
    const store = memoryStore();
    const said: string[] = [];
    const serving = shelfServing([BOOK('Mistborn', 'Brandon Sanderson')]);
    try {
      const deps = {
        capCheck: async () => ({ ok: true }) as const,
        recordTurn: async () => {},
        conversation: store,
        reply: async (content: string) => void said.push(content),
      };
      const trigger = mentionTrigger(msg(), APP_ID);
      if (trigger.kind !== 'ask') return assert.fail('fixture is not a question');
      await handleMention(deps, trigger, CFG);
      await handleMention(deps, trigger, CFG);
      assert.match(said[0]!, /<@42>/, 'the opening turn addresses the asker, as the brief asks');
      assert.doesNotMatch(said[1]!, /<@42>/, 'the follow-up must not re-ping somebody mid-conversation');
    } finally {
      serving.restore();
    }
  });

  it('⚠️ a DM is never greeted by ping — there is nobody else in the room', async () => {
    const store = memoryStore();
    const said: string[] = [];
    const serving = shelfServing([BOOK('Mistborn', 'Brandon Sanderson')]);
    try {
      const trigger = mentionTrigger(
        msg({ guild_id: undefined, mentions: [], content: 'do we have Mistborn?' }),
        APP_ID,
      );
      assert.equal(trigger.kind === 'ask' && trigger.via, 'dm');
      if (trigger.kind !== 'ask') return;
      await handleMention(
        {
          capCheck: async () => ({ ok: true }),
          recordTurn: async () => {},
          conversation: store,
          reply: async (content) => void said.push(content),
        },
        trigger,
        CFG,
      );
      assert.doesNotMatch(said[0]!, /<@42>/);
    } finally {
      serving.restore();
    }
  });

  it('a capped turn still LOADS the memory but records nothing — the fuse costs no writes', async () => {
    const store = memoryStore();
    const serving = shelfServing([]);
    try {
      const trigger = mentionTrigger(msg(), APP_ID);
      if (trigger.kind !== 'ask') return assert.fail('fixture is not a question');
      const out = await handleMention(
        {
          capCheck: async () => ({ ok: false, scope: 'user', message: 'capped, sorry' }),
          recordTurn: async () => assert.fail('a refused turn must not be counted'),
          conversation: store,
          reply: async () => {},
        },
        trigger,
        CFG,
      );
      assert.equal(out.intent, 'capped');
      assert.equal(store.turns.length, 0, 'a refused turn must not enter the transcript');
      assert.equal(serving.calls(), 0, 'the fuse blows BEFORE anything that costs');
    } finally {
      serving.restore();
    }
  });
});

// ── 2. she does not remember forever ────────────────────────────────────────

describe('⚠️ the window and the cap — aged-out state is DELETED, not archived', () => {
  const NOW = 1_800_000_000_000;
  const rec = (turns: ConversationTurn[], pending: PendingChoice | null = null): ConversationRecord => ({
    v: CONVERSATION_SHAPE_VERSION,
    key: conversationKey('discord_channel', '500', '42'),
    turns,
    updatedAt: NOW,
    pending,
  });

  it('drops turns older than the 30-minute window and keeps the rest', () => {
    const out = pruneConversation(
      rec([
        { role: 'user', text: 'ancient', at: NOW - CONVERSATION_WINDOW_MS - 1 },
        { role: 'assistant', text: 'recent', at: NOW - 60_000 },
      ]),
      NOW,
    );
    assert.deepEqual(out?.turns.map((t) => t.text), ['recent']);
  });

  it('⚠️ returns NULL when nothing is left — which is the caller\'s instruction to DELETE', () => {
    // This is the assertion that makes "deleted, not archived" mechanical. A
    // prune that returned an empty record instead would leave a row per person
    // per channel forever, holding a key that says who talked to her and where.
    const out = pruneConversation(rec([{ role: 'user', text: 'gone', at: NOW - CONVERSATION_WINDOW_MS - 1 }]), NOW);
    assert.equal(out, null);
  });

  it('caps the transcript at 20 turns (~10 exchanges), keeping the NEWEST', () => {
    const many: ConversationTurn[] = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `turn ${i}`,
      at: NOW - 1000,
    }));
    const out = pruneConversation(rec(many), NOW);
    assert.equal(out?.turns.length, CONVERSATION_MAX_TURNS);
    assert.equal(out?.turns[out.turns.length - 1]!.text, 'turn 39', 'the newest survives, not the oldest');
  });

  it('a pending clarifying question expires sooner than the conversation does', () => {
    assert.ok(PENDING_TTL_MS < CONVERSATION_WINDOW_MS, 'a menu must not outlive the chat it belongs to');
    const stale: PendingChoice = { kind: 'book_pick', nonce: 'abc', question: 'q', options: [], at: NOW - PENDING_TTL_MS - 1 };
    const out = pruneConversation(rec([{ role: 'user', text: 'hi', at: NOW }], stale), NOW);
    assert.equal(out?.pending, null, 'the transcript survives, the stale menu does not');
  });

  it('⚠️ an unreadable or wrong-VERSION record is treated as absent, never guessed at', () => {
    assert.equal(pruneConversation(null, NOW), null);
    assert.equal(pruneConversation({ ...rec([{ role: 'user', text: 'x', at: NOW }]), v: 99 }, NOW), null);
    // A turn with a broken shape is dropped rather than poisoning the array.
    const out = pruneConversation(
      rec([{ role: 'user', text: 'good', at: NOW }, { role: 'nope', text: 1, at: 'x' } as unknown as ConversationTurn]),
      NOW,
    );
    assert.deepEqual(out?.turns.map((t) => t.text), ['good']);
  });

  it('⚠️ each turn is clipped, so the context a conversation charges for is BOUNDED', () => {
    // Context tokens are charged every turn. Without this, turn 10 of a
    // conversation costs ten times turn 1 under a cap that never noticed.
    const clipped = clipTurnText('x'.repeat(5000));
    assert.equal(clipped.length, CONVERSATION_TURN_CHARS);
    const full: ConversationTurn[] = Array.from({ length: CONVERSATION_MAX_TURNS }, () => ({
      role: 'user' as const,
      text: 'y'.repeat(CONVERSATION_TURN_CHARS),
      at: NOW,
    }));
    assert.equal(conversationChars(full), CONVERSATION_MAX_TURNS * CONVERSATION_TURN_CHARS);
    assert.ok(conversationChars(full) <= 12_000, 'a full window stays a few thousand tokens, not a document');
  });

  it('appendTurns clips on the way IN, so a long answer cannot bloat the record', () => {
    const out = appendTurns(null, conversationKey('s', 'p', 'q'), [
      { role: 'user', text: 'z'.repeat(5000), at: NOW },
    ], NOW);
    assert.equal(out?.turns[0]!.text.length, CONVERSATION_TURN_CHARS);
  });
});

// ── 3. the doors ────────────────────────────────────────────────────────────

describe('⚠️ door 2: a REPLY to one of her own messages, ping left on', () => {
  const reply = (over: Partial<GatewayMessage> = {}) =>
    msg({
      type: 19,
      content: 'what about the second one?',
      // The ping populates `mentions` with the replied-to author (her).
      mentions: [{ id: APP_ID }],
      referenced_message: { author: { id: APP_ID } },
      ...over,
    });

  it('is a question, tagged via:"reply"', () => {
    const t = mentionTrigger(reply(), APP_ID);
    assert.equal(t.kind, 'ask');
    assert.equal(t.kind === 'ask' && t.via, 'reply');
    assert.equal(t.kind === 'ask' && t.question, 'what about the second one?');
  });

  it('⚠️ a reply with the PING REMOVED is invisible to her, and that is Discord\'s rule', () => {
    // Discord delivers the content of a reply without the Message Content
    // intent ONLY when "ping on reply" is enabled. With it off, the app is not
    // in `mentions` and `content` arrives blank. There is no way for her to
    // know it happened — hence the runbook says so out loud.
    const t = mentionTrigger(reply({ mentions: [], content: '' }), APP_ID);
    assert.equal(t.kind, 'ignore');
    assert.equal(t.kind === 'ignore' && t.why, 'not_mentioned');
  });

  it('⚠️ a reply to SOMEBODY ELSE is never picked up, even when she is listed', () => {
    const t = mentionTrigger(reply({ referenced_message: { author: { id: '999' } } }), APP_ID);
    assert.equal(t.kind === 'ignore' && t.why, 'no_mention_token');
  });

  it('⚠️ a reply whose original was DELETED carries no proof and is refused', () => {
    const t = mentionTrigger(reply({ referenced_message: null }), APP_ID);
    assert.equal(t.kind === 'ignore' && t.why, 'no_mention_token');
  });

  it('a bare "thanks!" reply still counts — stripping it to nothing would look broken', () => {
    const t = mentionTrigger(reply({ content: 'thanks!' }), APP_ID);
    assert.equal(t.kind, 'ask');
    assert.equal(t.kind === 'ask' && t.question, 'thanks!');
  });
});

describe('⚠️ door 3: a DM is the zero-@ surface', () => {
  const dm = (over: Partial<GatewayMessage> = {}) =>
    msg({ guild_id: undefined, mentions: [], content: 'do we have Mistborn?', ...over });

  it('needs no mention at all, and lands on the discord_dm surface', () => {
    const t = mentionTrigger(dm(), APP_ID);
    assert.equal(t.kind, 'ask');
    assert.equal(t.kind === 'ask' && t.via, 'dm');
    assert.equal(t.kind === 'ask' && t.surface, 'discord_dm');
    assert.equal(t.kind === 'ask' && t.guildId, null);
  });

  it('a bare "hi" is answered rather than stripped into silence', () => {
    const t = mentionTrigger(dm({ content: 'hi' }), APP_ID);
    assert.equal(t.kind, 'ask');
    assert.equal(t.kind === 'ask' && t.question, 'hi');
  });

  it('⚠️ another BOT in a DM is still never answered — the money loop does not care where it is', () => {
    const t = mentionTrigger(dm({ author: { id: '7', bot: true } }), APP_ID);
    assert.equal(t.kind === 'ignore' && t.why, 'author_is_bot');
  });

  it('a system message in a DM is not a question', () => {
    assert.equal(mentionTrigger(dm({ type: 6 }), APP_ID).kind, 'ignore');
  });

  it('the component surface is decided the same way — no guild id means the DM memory', () => {
    assert.equal(surfaceOf(''), 'discord_dm');
    assert.equal(surfaceOf('100'), 'discord_channel');
  });
});

// ── 4. conversations do not leak ────────────────────────────────────────────

describe('⚠️ one memory per (surface, space, person) — nothing bleeds', () => {
  it('two people in one channel, and one person in two channels, are four different keys', () => {
    const keys = new Set(
      [
        ['discord_channel', 'chanA', 'sam'],
        ['discord_channel', 'chanA', 'alex'],
        ['discord_channel', 'chanB', 'sam'],
        ['discord_dm', 'chanA', 'sam'],
      ].map(([s, p, q]) => conversationStorageKey(conversationKey(s!, p!, q!))),
    );
    assert.equal(keys.size, 4);
  });

  it('the prefix is namespaced so it cannot collide with the gateway session or the caps', () => {
    const k = conversationStorageKey(conversationKey('discord_dm', '500', '42'));
    assert.ok(k.startsWith('conv:'), k);
    assert.ok(!k.startsWith('gw:') && !k.startsWith('cap:'));
  });

  it('a separator smuggled into an id cannot merge two people into one memory', () => {
    const a = conversationStorageKey(conversationKey('discord_channel', 'x', 'a:b'));
    const b = conversationStorageKey(conversationKey('discord_channel', 'x:a', 'b'));
    assert.notEqual(a, b);
  });
});

// ── 5. the clarifying question ──────────────────────────────────────────────

describe('⚠️ components: a lookup with several matches asks WHICH, deterministically', () => {
  const three = [BOOK('Mistborn', 'Brandon Sanderson'), BOOK('Mistborn: The Well of Ascension', 'Brandon Sanderson'), BOOK('Mistborn: Secret History', 'Brandon Sanderson')];

  it('one match asks nothing; several matches offer a menu — with NO model consulted', async () => {
    // ⚠️ No Anthropic key anywhere in this file. If offering components needed
    // one, this test could not exist — which is exactly why the trigger is
    // "more than one book matched" rather than a model's opinion.
    assert.equal(choiceFor('q', [BOOK('Only One', 'A')], 1), null);
    const pending = choiceFor('do we have Mistborn?', three, 1);
    assert.ok(pending);
    assert.equal(pending!.kind, 'book_pick');
    assert.equal(pending!.options.length, 3);
    assert.match(pending!.options[0]!.label, /Mistborn — Brandon Sanderson/);
  });

  it('never offers more rows than a chat message can carry, and counts the overflow', () => {
    const many = Array.from({ length: 12 }, (_, i) => BOOK(`Book ${i}`, 'Someone'));
    const pending = choiceFor('q', many, 1)!;
    assert.equal(pending.options.length, MAX_CHOICE_OPTIONS);
  });

  it('renders a select whose option VALUES are indices, not truncatable titles', () => {
    const pending = choiceFor('q', three, 1)!;
    const rows = buildChoiceComponents(pending) as Array<{ components: Array<Record<string, unknown>> }>;
    const select = rows[0]!.components[0]!;
    assert.equal(select['type'], 3, 'string select');
    assert.equal(select['custom_id'], buildConvCustomId('pick', pending.nonce));
    assert.deepEqual((select['options'] as Array<{ value: string }>).map((o) => o.value), ['0', '1', '2']);
    const button = rows[1]!.components[0]!;
    assert.equal(button['type'], 2, 'the free-text escape hatch is a button');
    assert.equal(button['custom_id'], buildConvCustomId('more', pending.nonce));
  });

  it('every custom_id stays inside Discord\'s 100-character ceiling', () => {
    for (const id of [buildConvCustomId('pick', newNonce()), buildConvCustomId('more', newNonce()), buildModalCustomId(newNonce())]) {
      assert.ok(id.length <= 100, `${id} is ${id.length} chars`);
      assert.ok(id.length >= 6);
    }
  });

  it('the modal wraps its text input in a Label (18), the shape Discord now documents', () => {
    const modal = buildQuestionModal('abc123', 'Ask GABI') as {
      type: number;
      data: { custom_id: string; components: Array<{ type: number; component: { type: number; custom_id: string } }> };
    };
    assert.equal(modal.type, 9, 'MODAL callback type');
    assert.equal(modal.data.custom_id, buildModalCustomId('abc123'));
    assert.equal(modal.data.components[0]!.type, 18, 'Action Row for a Text Input is deprecated in modals');
    assert.equal(modal.data.components[0]!.component.type, 4);
  });

  it('the custom_id round-trips, and anything this build never issued parses to null', () => {
    const n = newNonce();
    assert.deepEqual(parseConvCustomId(buildConvCustomId('pick', n)), { action: 'pick', nonce: n });
    assert.deepEqual(parseModalCustomId(buildModalCustomId(n)), { nonce: n });
    for (const bad of ['', 'gc|', 'gc|pick', 'gc|drop|abc', 'pv|clubs|a|b|0', `gc|pick|${'x'.repeat(40)}`]) {
      assert.equal(parseConvCustomId(bad), null, bad);
    }
    assert.equal(parseModalCustomId('gcm|'), null);
  });

  it('reads the typed value out of BOTH modal shapes, and returns "" when there is none', () => {
    assert.equal(
      modalInputValue({ components: [{ type: 18, component: { custom_id: 'gcq', value: ' hi ' } }] }),
      'hi',
    );
    assert.equal(
      modalInputValue({ components: [{ type: 1, components: [{ custom_id: 'gcq', value: 'hi' }] }] }),
      'hi',
    );
    assert.equal(modalInputValue({ components: [] }), '');
    assert.equal(modalInputValue(null), '');
    assert.equal(modalInputValue({ components: [{ component: { custom_id: 'other', value: 'x' } }] }), '');
  });
});

describe('⚠️ resuming from a press — the machinery, end to end, with no key', () => {
  const three = [BOOK('Mistborn', 'Brandon Sanderson'), BOOK('The Well of Ascension', 'Brandon Sanderson')];

  async function conversationWithAPendingChoice() {
    const store = memoryStore();
    const said: Array<{ content: string; components?: unknown[] }> = [];
    const serving = shelfServing(three);
    const trigger = mentionTrigger(msg(), APP_ID);
    if (trigger.kind !== 'ask') throw new Error('fixture is not a question');
    await handleMention(
      {
        capCheck: async () => ({ ok: true }),
        recordTurn: async () => {},
        conversation: store,
        reply: async (content, extra) => void said.push({ content, ...(extra ?? {}) }),
      },
      trigger,
      CFG,
    );
    serving.restore();
    return { store, said };
  }

  it('a multi-match lookup ships the menu AND stores the pending question', async () => {
    const { store, said } = await conversationWithAPendingChoice();
    assert.ok(said[0]!.components, 'the answer carried components');
    assert.ok(store.pending, 'and the choice was written down, or the press could never resolve');
    assert.match(said[0]!.content, /which one did you mean/i);
  });

  it('pressing a row answers with THAT book and clears the pending question', async () => {
    const { store } = await conversationWithAPendingChoice();
    const nonce = store.pending!.nonce;
    const out = await handlePick(
      { capCheck: async () => ({ ok: true }), recordTurn: async () => {}, conversation: store },
      { nonce, choice: '1' },
      { discordUserId: '42', guildId: '100', authorName: 'Sam' },
      CFG,
    );
    assert.equal(out.kind, 'answered');
    assert.match(out.content, /Well of Ascension/);
    assert.equal(store.pending, null, 'a menu that has been answered must not stay pressable');
    assert.equal(store.turns.length, 4, 'the pick is a turn of the conversation, not a side channel');
  });

  it('⚠️ SOMEBODY ELSE pressing the same public menu gets the worded stale answer', async () => {
    // Their key resolves a different (empty) record, so there is no pending
    // question with that nonce. Nothing is leaked and nothing is answered.
    const { store } = await conversationWithAPendingChoice();
    const strangersMemory = memoryStore();
    const out = await handlePick(
      { capCheck: async () => ({ ok: true }), recordTurn: async () => {}, conversation: strangersMemory },
      { nonce: store.pending!.nonce, choice: '0' },
      { discordUserId: '999', guildId: '100', authorName: 'Nobody' },
      CFG,
    );
    assert.equal(out.kind, 'stale');
    assert.match(out.content, /moved on|was for whoever asked/i);
    assert.equal(strangersMemory.turns.length, 0, 'a stranger\'s press must write nothing');
  });

  it('a nonce from an older question, and an out-of-range row, are both stale not wrong', async () => {
    const { store } = await conversationWithAPendingChoice();
    const deps = { capCheck: async () => ({ ok: true }) as const, recordTurn: async () => {}, conversation: store };
    const who = { discordUserId: '42', guildId: '100', authorName: 'Sam' };
    assert.equal((await handlePick(deps, { nonce: 'stalenonce', choice: '0' }, who, CFG)).kind, 'stale');
    assert.equal((await handlePick(deps, { nonce: store.pending!.nonce, choice: '9' }, who, CFG)).kind, 'stale');
    assert.equal((await handlePick(deps, { nonce: store.pending!.nonce, choice: 'x' }, who, CFG)).kind, 'stale');
  });

  it('the cap applies to a press exactly as it does to a message', async () => {
    const { store } = await conversationWithAPendingChoice();
    const out = await handlePick(
      {
        capCheck: async () => ({ ok: false, scope: 'user', message: "that's a cap on my side, not anything you did" }),
        recordTurn: async () => assert.fail('a capped press must not be counted'),
        conversation: store,
      },
      { nonce: store.pending!.nonce, choice: '0' },
      { discordUserId: '42', guildId: '100', authorName: 'Sam' },
      CFG,
    );
    assert.equal(out.kind, 'capped');
    assert.match(out.content, /cap on my side/i);
    assert.ok(store.pending, 'a refused press leaves the question still answerable');
  });

  it('typed free text resumes the SAME conversation and runs the whole ladder', async () => {
    const { store } = await conversationWithAPendingChoice();
    const before = store.turns.length;
    const serving = shelfServing([BOOK('Elantris', 'Brandon Sanderson')]);
    try {
      const out = await handleTypedQuestion(
        { capCheck: async () => ({ ok: true }), recordTurn: async () => {}, conversation: store },
        { nonce: store.pending!.nonce, text: 'do we have Elantris?' },
        { discordUserId: '42', guildId: '100', authorName: 'Sam' },
        CFG,
      );
      assert.equal(out.kind, 'answered');
      assert.match(out.content, /Elantris/);
      assert.equal(store.turns.length, before + 2, 'appended to the existing conversation, not a new one');
      assert.equal(store.pending, null, 'declining the menu answers it');
    } finally {
      serving.restore();
    }
  });

  it('an empty modal submit is stale rather than an empty search', async () => {
    const { store } = await conversationWithAPendingChoice();
    const out = await handleTypedQuestion(
      { capCheck: async () => assert.fail('nothing should be spent'), recordTurn: async () => {}, conversation: store },
      { nonce: store.pending!.nonce, text: '   ' },
      { discordUserId: '42', guildId: '100', authorName: 'Sam' },
      CFG,
    );
    assert.equal(out.kind, 'stale');
  });
});

// ── 6. the prompt the memory becomes ────────────────────────────────────────

describe('⚠️ modelMessages: the alternation the API requires, ENFORCED not assumed', () => {
  const t = (role: 'user' | 'assistant', text: string): ConversationTurn => ({ role, text, at: 1 });

  it('a clean transcript becomes a clean messages array ending in the new question', () => {
    assert.deepEqual(modelMessages([t('user', 'a'), t('assistant', 'b')], 'c'), [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
  });

  it('⚠️ a window that cut mid-exchange cannot start with an assistant turn', () => {
    // The 30-minute window slices wherever it lands. The Messages API requires
    // the first message to be `user`; violating it is a 400 that would eat
    // somebody's answer over a bookkeeping detail.
    assert.deepEqual(modelMessages([t('assistant', 'orphan'), t('user', 'a')], 'b'), [
      { role: 'user', content: 'a\n\nb' },
    ]);
  });

  it('⚠️ two adjacent user turns (a reply Discord refused to post) are MERGED', () => {
    assert.deepEqual(modelMessages([t('user', 'a'), t('user', 'b')], 'c'), [
      { role: 'user', content: 'a\n\nb\n\nc' },
    ]);
  });

  it('an empty history is just the question', () => {
    assert.deepEqual(modelMessages([], 'hello'), [{ role: 'user', content: 'hello' }]);
  });

  it('blank turns are skipped rather than sent as empty content', () => {
    assert.deepEqual(modelMessages([t('user', '   ')], 'q'), [{ role: 'user', content: 'q' }]);
  });
});

// ── 7. the portability contract ─────────────────────────────────────────────

describe('⚠️ the record shape is a CONTRACT with a surface that does not exist yet', () => {
  it('a turn carries only surface-neutral fields, plus one opaque bag', () => {
    // ⚠️ If this list ever grows a Discord-shaped field at the TOP level, the
    // library site's GABI panel inherits a column it cannot fill. Discord's own
    // ids belong in `ref`, which the core never reads.
    const out = appendTurns(null, conversationKey('discord_channel', 'c', 'p'), [
      { role: 'user', text: 'hi', at: 1, ref: { message_id: '900', guild_id: '100' } },
    ], 1)!;
    assert.deepEqual(Object.keys(out.turns[0]!).sort(), ['at', 'ref', 'role', 'text']);
    assert.deepEqual(Object.keys(out).sort(), ['key', 'pending', 'turns', 'updatedAt', 'v']);
    assert.deepEqual(Object.keys(out.key).sort(), ['person', 'space', 'surface']);
  });

  it('the key parts are OPAQUE — a Firebase uid works exactly as well as a snowflake', () => {
    // The whole portability claim in one assertion: nothing parses these.
    const discord = conversationStorageKey(conversationKey('discord_channel', '1234567890', '987654321'));
    const panel = conversationStorageKey(conversationKey('web_panel', 'session-abc', 'firebase-uid-xyz'));
    assert.ok(discord.startsWith('conv:') && panel.startsWith('conv:'));
    assert.notEqual(discord, panel);
  });

  it('the version is pinned, so a future shape change is a decision and not a surprise', () => {
    assert.equal(CONVERSATION_SHAPE_VERSION, 1);
    const out = appendTurns(null, conversationKey('s', 'p', 'q'), [{ role: 'user', text: 'x', at: 1 }], 1);
    assert.equal(out?.v, CONVERSATION_SHAPE_VERSION);
  });

  it('NO_MEMORY is a real, written-down memoryless store rather than an inline stub', () => {
    // Surfaces genuinely without state exist. What must never exist is a
    // storage FAILURE quietly degrading into one, which would turn an outage
    // into a silent personality change.
    assert.equal(typeof NO_MEMORY.load, 'function');
    assert.equal(typeof NO_MEMORY.save, 'function');
  });
});
