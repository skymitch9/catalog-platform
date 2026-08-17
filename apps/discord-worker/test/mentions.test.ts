/**
 * Conversational GABI in Discord, phase A — the four ways it can be silently
 * wrong, one group each.
 *
 *   1. **The POSTURE drifts.** `GABI_MENTIONS` is the answer to "is she
 *      listening at all?", and off means no WebSocket is ever opened. It is one
 *      line in `wrangler.toml` and nothing else would notice it changing, so
 *      this file reads that file — the same guard `test/moderation.test.ts` puts
 *      on `MODERATION_ENABLED` and the library puts on `GABI_PANEL`.
 *   2. **The TRIGGER widens.** A bot that answers `@everyone`, or answers other
 *      bots, is a bot that gets removed from a server. And a build that started
 *      requesting Discord's Message Content privileged intent would break
 *      `discord-bot-design.md` §1.5 without breaking anything a reader sees.
 *   3. **The LADDER breaks.** She must route sensibly with no Anthropic key and
 *      with one, and ⚠️ a missing key must NEVER produce an error in a channel.
 *   4. **The ALLOWLIST grows.** Phase A reads and talks. A write path arriving
 *      quietly beside a feature is the failure `GABI_TOOL_NAMES` exists to stop
 *      in the library; this is the same guard on this surface.
 *
 * ⚠️ Nothing here can spend money: no test supplies an Anthropic key, and the
 * only paths that could reach the model are given `undefined` for it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  capDecision,
  classifyByKeyword,
  GABI_MENTION_ACTIONS,
  GLOBAL_TURNS_PER_DAY,
  MENTION_MSG,
  mentionsOn,
  mentionTrigger,
  pruneWindow,
  questionFrom,
  USER_TURNS_PER_WINDOW,
  USER_WINDOW_MS,
  utcDayKey,
  type GatewayMessage,
} from '../src/mentions.js';
import { handleMention, NO_MEMORY } from '../src/mention-flow.js';
import { FATAL_CLOSE_CODES, GATEWAY_INTENTS } from '../src/gateway.js';
import { classifyIntent, converse, estimateCents, GABI_CHAT_MODEL } from '../src/gabi-chat.js';

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url).href), 'utf8');
}

const WRANGLER = repoFile('wrangler.toml');
const APP_ID = '1538775435880562758';

/** A plausible MESSAGE_CREATE, with only the fields the trigger reads. */
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

// ── 1. the posture ──────────────────────────────────────────────────────────

describe('⚠️ the posture: affirmative-only, and OFF means no socket at all', () => {
  it('ships OFF in wrangler.toml — flipping it is an owner decision', () => {
    const line = WRANGLER.match(/^\s*GABI_MENTIONS\s*=\s*"([^"]*)"/m);
    assert.ok(line, 'wrangler.toml does not declare GABI_MENTIONS at all');
    assert.equal(
      mentionsOn({ GABI_MENTIONS: line[1] }),
      false,
      `wrangler.toml has GABI_MENTIONS = "${line[1]}" — the conversational posture changed without ` +
        'an owner decision recorded here. The last recorded decision (2026-08-17) is OFF.',
    );
  });

  it('only the exact word "on" enables it', () => {
    assert.equal(mentionsOn({ GABI_MENTIONS: 'on' }), true);
    assert.equal(mentionsOn({ GABI_MENTIONS: ' ON ' }), true, 'trimmed and case-folded, like its siblings');
    for (const off of [undefined, '', 'off', 'true', '1', 'yes', 'enabled', 'ON!']) {
      assert.equal(
        mentionsOn({ GABI_MENTIONS: off }),
        false,
        `"${off}" must mean OFF — an affirmative-only switch is the whole point`,
      );
    }
  });

  it('the file declares it, so "is she listening?" is never an absence', () => {
    assert.match(WRANGLER, /^\s*GABI_MENTIONS\s*=/m);
  });

  it('the Durable Object is declared and migrated — without it nothing can listen', () => {
    assert.match(WRANGLER, /class_name\s*=\s*"GabiGateway"/, 'no GabiGateway binding');
    assert.match(WRANGLER, /new_sqlite_classes\s*=\s*\[\s*"GabiGateway"\s*\]/, 'no migration for the class');
  });

  it('⚠️ declares the 2-minute cron backstop — restored on Workers Paid, 2026-08-17', () => {
    // History, both halves measured the same day: the first attempt at this
    // block was REFUSED under Workers Free ("reached the Workers Free limit of
    // 5 cron triggers per account") and this test pinned its ABSENCE, because
    // a wrangler.toml that cannot fully apply makes every future deploy exit
    // with a partial-failure banner. Then the owner moved the account to
    // Workers Paid ("cloudflare upgraded", crons 5 → 250) and the block came
    // back — the deploy that shipped it succeeding IS the proof the plan
    // change took. If this assertion fails, someone removed the backstop:
    // correct only if the account regressed to Free, and worth saying so.
    assert.match(
      WRANGLER,
      /^\s*crons\s*=\s*\[\s*"\*\/2 \* \* \* \*"\s*\]/m,
      'the gateway cron backstop is gone — without it a broken alarm chain has no self-heal and ' +
        'POST /admin/gateway/start is the only starter. Removing it is correct only if the ' +
        'account went back to Workers Free (measured refusal, 2026-08-17).',
    );
  });
});

// ── 2. the trigger ──────────────────────────────────────────────────────────

describe('⚠️ the intents stay UNPRIVILEGED — §1.5, mechanically', () => {
  it('is exactly GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES, and never MESSAGE_CONTENT', () => {
    // ⚠️ CHANGED 2026-08-17 from 513 to 4609 with the continuity layer.
    // DIRECT_MESSAGES (1 << 12) makes the DM the zero-@ surface, and it is
    // UNPRIVILEGED: Discord's own list of privileged intents is exactly
    // GUILD_PRESENCES, GUILD_MEMBERS and MESSAGE_CONTENT. No portal toggle, no
    // app verification, no review — which is the whole reason this was
    // available to add and bare-text triggers still are not.
    assert.equal(GATEWAY_INTENTS, 4609, 'GUILDS (1) | GUILD_MESSAGES (512) | DIRECT_MESSAGES (4096)');
    assert.equal(GATEWAY_INTENTS & (1 << 0), 1 << 0, 'GUILDS');
    assert.equal(GATEWAY_INTENTS & (1 << 9), 1 << 9, 'GUILD_MESSAGES');
    assert.equal(GATEWAY_INTENTS & (1 << 12), 1 << 12, 'DIRECT_MESSAGES');
  });

  it('⚠️ MESSAGE_CONTENT (1 << 15) is NEVER set — the line the whole design rests on', () => {
    // Requesting it is the decision the design forbids, and Discord answers
    // close code 4014 for an unapproved one. This assertion is the mechanical
    // half of §1.5 and it must survive every future widening of the surface.
    assert.equal(GATEWAY_INTENTS & (1 << 15), 0, 'the Message Content privileged intent was requested');
  });

  it('⚠️ DM TYPING (1 << 14) is not requested either — the owner asked for messages, not typing', () => {
    // It would buy a "GABI is typing…" flourish and cost a TYPING_START event
    // per keystroke burst in every DM, on an always-on object measured at 83%
    // of a hard free-plan duration cap.
    assert.equal(GATEWAY_INTENTS & (1 << 14), 0, 'DIRECT_MESSAGE_TYPING was requested');
    assert.equal(GATEWAY_INTENTS & (1 << 11), 0, 'GUILD_MESSAGE_TYPING was requested');
  });

  it('an unapproved-intent close is FATAL, not retried — no hot loop on a bad ask', () => {
    assert.ok(FATAL_CLOSE_CODES.has(4014), '4014 (disallowed intents) must stop the reconnect loop');
    assert.ok(FATAL_CLOSE_CODES.has(4004), '4004 (bad token) must stop the reconnect loop');
    assert.ok(!FATAL_CLOSE_CODES.has(4009), '4009 (session timed out) IS recoverable and must reconnect');
  });
});

describe('the mention test — she answers people who addressed her, and nobody else', () => {
  it('a genuine mention is a question', () => {
    const t = mentionTrigger(msg(), APP_ID);
    assert.equal(t.kind, 'ask');
    assert.equal(t.kind === 'ask' && t.question, 'do we have Mistborn?');
    assert.equal(t.kind === 'ask' && t.authorId, '42');
  });

  it('⚠️ no mention at all is ignored — this is the phase-A boundary', () => {
    // The owner asked for bare "heygabi" too. That needs the privileged intent,
    // so phase A must NOT answer it — and if it ever does, this test says so.
    const t = mentionTrigger(msg({ content: 'heygabi do we have Mistborn?', mentions: [] }), APP_ID);
    assert.equal(t.kind, 'ignore');
    assert.equal(t.kind === 'ignore' && t.why, 'not_mentioned');
  });

  it('⚠️ a bot is never answered — two bots mentioning each other is a money loop', () => {
    const t = mentionTrigger(msg({ author: { id: '7', bot: true } }), APP_ID);
    assert.equal(t.kind === 'ignore' && t.why, 'author_is_bot');
  });

  it('a webhook post is never answered, for the same reason', () => {
    assert.equal(mentionTrigger(msg({ webhook_id: '55' }), APP_ID).kind, 'ignore');
  });

  it('her own message is never answered, even if Discord omits the bot flag', () => {
    const t = mentionTrigger(msg({ author: { id: APP_ID, bot: false } }), APP_ID);
    assert.equal(t.kind === 'ignore' && t.why, 'own_message');
  });

  it('a plain question keeps its first word — "hi-fi" is not a greeting', () => {
    assert.equal(questionFrom(`<@${APP_ID}> hi-fi audiobooks?`, APP_ID), 'hi-fi audiobooks?');
  });

  it('⚠️ being LISTED in mentions with no token AND no proof of whose message it replies to', () => {
    // Discord adds the replied-to author to `mentions` automatically, so the
    // array alone never establishes that SHE was the one replied to. Without a
    // `referenced_message` naming her as the author this is a message about
    // her, not to her — and a reply whose original was deleted looks exactly
    // like this, which is why it is refused rather than guessed at.
    const t = mentionTrigger(msg({ content: 'that was useful, thanks' }), APP_ID);
    assert.equal(t.kind === 'ignore' && t.why, 'no_mention_token');
  });

  it('a genuine mention is tagged via:"mention" on the channel surface', () => {
    const t = mentionTrigger(msg(), APP_ID);
    assert.equal(t.kind === 'ask' && t.via, 'mention');
    assert.equal(t.kind === 'ask' && t.surface, 'discord_channel');
  });

  it('@everyone does not reach her', () => {
    const t = mentionTrigger(msg({ content: '@everyone reading tonight?', mentions: [] }), APP_ID);
    assert.equal(t.kind, 'ignore');
  });

  it('a system message carrying a mention is not a question', () => {
    assert.equal(mentionTrigger(msg({ type: 6 }), APP_ID).kind, 'ignore');
  });

  it('a mention with nothing after it is ignored rather than searched for ""', () => {
    const t = mentionTrigger(msg({ content: `<@${APP_ID}>` }), APP_ID);
    assert.equal(t.kind === 'ignore' && t.why, 'empty_question');
  });

  it("the owner's greeting forms all come off the front", () => {
    for (const said of [
      `<@${APP_ID}> hey gabi do we have Mistborn?`,
      `hey <@${APP_ID}>, do we have Mistborn?`,
      `<@!${APP_ID}> heygabi — do we have Mistborn?`,
      `<@${APP_ID}> Gabi: do we have Mistborn?`,
    ]) {
      assert.equal(questionFrom(said, APP_ID), 'do we have Mistborn?', said);
    }
  });

  it('a trailing address comes off too', () => {
    assert.equal(questionFrom(`<@${APP_ID}> do we have Mistborn, gabi?`, APP_ID), 'do we have Mistborn');
  });
});

// ── 3. the ladder ───────────────────────────────────────────────────────────

describe('the keyword router — the no-key half, which must be a real router', () => {
  it('routes lookups', () => {
    for (const q of ['do we have Mistborn?', 'have you got any Sanderson', 'can I listen to Dune']) {
      assert.equal(classifyByKeyword(q), 'have_lookup', q);
    }
  });

  it('routes fixes, and a fix about a book is a fix first', () => {
    for (const q of ['can you fix the author on Mistborn', "the series is wrong", 'please update the cover']) {
      assert.equal(classifyByKeyword(q), 'fix_request', q);
    }
  });

  it('routes small talk', () => {
    for (const q of ['hey!', 'thanks GABI', 'who are you']) {
      assert.equal(classifyByKeyword(q), 'smalltalk', q);
    }
  });

  it('⚠️ falls through to `question`, NOT to a lookup', () => {
    // Guessing "lookup" would answer "nothing on the shelf matches that" to
    // "what can you do?" — a statement about the catalogue in reply to a
    // question that was not about the catalogue.
    assert.equal(classifyByKeyword('what can you actually do from here?'), 'question');
  });
});

describe('⚠️ a missing Anthropic key is a LADDER, never an error in a channel', () => {
  it('classification returns null and makes no request', async () => {
    let calls = 0;
    const counted: typeof fetch = async () => {
      calls += 1;
      return new Response('{}');
    };
    const out = await classifyIntent(undefined, 'do we have Mistborn?', { discordUserId: '42', guildId: '1' }, {
      fetch: counted,
    });
    assert.equal(out, null, 'no key must mean "the caller falls back", not a guess');
    assert.equal(calls, 0, 'a missing key must not produce a request');
  });

  it('conversation returns null and makes no request', async () => {
    let calls = 0;
    const counted: typeof fetch = async () => {
      calls += 1;
      return new Response('{}');
    };
    const out = await converse(
      undefined,
      'what can you do?',
      null,
      { discordUserId: '42', guildId: '1', authorName: 'Sam' },
      { fetch: counted },
    );
    assert.equal(out, null);
    assert.equal(calls, 0);
  });

  it('and the whole flow still ANSWERS — with a lookup, no model, and no mention of a key', async () => {
    const said: string[] = [];
    const trigger = mentionTrigger(msg(), APP_ID);
    assert.equal(trigger.kind, 'ask');
    if (trigger.kind !== 'ask') return;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ books: [{ title: 'Mistborn', creator: 'Brandon Sanderson' }] }), {
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      const out = await handleMention(
        {
          capCheck: async () => ({ ok: true }),
          recordTurn: async () => {},
          conversation: NO_MEMORY,
          reply: async (content) => void said.push(content),
        },
        trigger,
        { indexBaseUrl: 'https://index.example', panelUrl: 'https://panel.example/' },
      );
      assert.equal(out.intent, 'have_lookup');
      assert.equal(said.length, 1, 'exactly one reply per mention');
      assert.match(said[0]!, /Mistborn/);
      assert.match(said[0]!, /<@42>/, 'the asker is addressed by mention, as asked for');
      assert.doesNotMatch(
        said[0]!,
        /ANTHROPIC|API key|not configured|secret/i,
        '⚠️ a configuration gap must never reach a Discord channel',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('the catalogue-absence wording is about the CATALOGUE, never the house', () => {
    assert.match(MENTION_MSG.none, /catalogue/i);
    assert.doesNotMatch(MENTION_MSG.none, /you (do not|don't) own/i);
  });

  it('an outage is never phrased as an answer about the book', () => {
    assert.match(MENTION_MSG.unreachable, /not an answer about the book/i);
    assert.match(MENTION_MSG.refused(502), /502/);
  });
});

// ── 4. the caps ─────────────────────────────────────────────────────────────

describe('spend caps — a fuse with words on it', () => {
  it('lets a normal conversation through', () => {
    assert.deepEqual(capDecision({ userInWindow: 3, globalToday: 10 }), { ok: true });
  });

  it('refuses at the per-user hourly cap, and says it is GABI’s cap', () => {
    const v = capDecision({ userInWindow: USER_TURNS_PER_WINDOW, globalToday: 0 });
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.scope, 'user');
    assert.match(v.ok === false ? v.message : '', /cap on my side/i);
    assert.match(v.ok === false ? v.message : '', /not anything you did/i);
  });

  it('the global daily cap outranks the per-user one', () => {
    const v = capDecision({ userInWindow: 0, globalToday: GLOBAL_TURNS_PER_DAY });
    assert.equal(v.ok === false && v.scope, 'global');
  });

  it('the rolling window actually rolls', () => {
    const now = 1_000_000_000_000;
    const times = [now - USER_WINDOW_MS - 1, now - 60_000, now];
    assert.deepEqual(pruneWindow(times, now), [now - 60_000, now]);
  });

  it('the global bucket is keyed by UTC day, so a DST shift cannot move the reset', () => {
    assert.equal(utcDayKey(Date.UTC(2026, 7, 17, 23, 59)), '2026-08-17');
    assert.equal(utcDayKey(Date.UTC(2026, 7, 18, 0, 1)), '2026-08-18');
  });

  it('a capped person is still REPLIED to, and no lookup or model call happens', async () => {
    const said: string[] = [];
    const trigger = mentionTrigger(msg(), APP_ID);
    if (trigger.kind !== 'ask') return assert.fail('fixture is not a question');

    let requests = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response('{}');
    }) as typeof fetch;
    try {
      const out = await handleMention(
        {
          capCheck: async () => capDecision({ userInWindow: USER_TURNS_PER_WINDOW, globalToday: 0 }),
          recordTurn: async () => assert.fail('a refused turn must not be counted against the cap'),
          conversation: NO_MEMORY,
          reply: async (content) => void said.push(content),
        },
        trigger,
        { indexBaseUrl: 'https://index.example', panelUrl: 'https://panel.example/' },
      );
      assert.equal(out.intent, 'capped');
      assert.equal(requests, 0, 'the fuse must blow BEFORE anything that costs');
      assert.match(said[0]!, /cap on my side/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── 5. the allowlist ────────────────────────────────────────────────────────

describe('⚠️ what a mention can cause, as an explicit array', () => {
  it('is exactly these eight things', () => {
    // Adding a row is a design decision somebody makes on purpose. This
    // assertion is the same guard the library puts on GABI_TOOL_NAMES, and it
    // is what makes "she writes nothing to the estate" a mechanism rather than
    // a promise.
    //
    // ⚠️ FOUR WERE ADDED 2026-08-17 with the continuity layer, and every one of
    // them was a decision: she may now READ BACK and WRITE a half-hour rolling
    // transcript in the bot's own Durable Object storage, attach components to
    // her own reply, and open a modal. Note what is STILL absent and cannot
    // arrive without failing this line: no catalogue write, no Firestore write,
    // no change_log row, no timeout, no message delete, no role change.
    assert.deepEqual([...GABI_MENTION_ACTIONS], [
      'lookup_public_shelf',
      'classify_intent',
      'converse',
      'reply_in_channel',
      'recall_conversation',
      'remember_conversation',
      'offer_choice_components',
      'open_question_modal',
    ]);
  });

  it('and the flow source contains no write, moderation or admin verb', () => {
    const source = repoFile('src/mention-flow.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const forbidden of [
      /firestoreRequest/,
      /mintAccessToken/,
      /timeoutGuildMember/,
      /bulkDeleteMessages/,
      /deleteChannelMessage/,
      /putGlobalCommands/,
      /method:\s*'(?:PATCH|PUT|DELETE)'/,
    ]) {
      assert.doesNotMatch(source, forbidden, `mention-flow.ts now reaches for ${forbidden}`);
    }
  });

  it('a fix request proposes and deep-links — it never claims to have changed anything', async () => {
    const said: string[] = [];
    const trigger = mentionTrigger(msg({ content: `<@${APP_ID}> please fix the author on Mistborn` }), APP_ID);
    if (trigger.kind !== 'ask') return assert.fail('fixture is not a question');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ books: [] }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      const out = await handleMention(
        {
          capCheck: async () => ({ ok: true }),
          recordTurn: async () => {},
          conversation: NO_MEMORY,
          reply: async (content) => void said.push(content),
        },
        trigger,
        { indexBaseUrl: 'https://index.example', panelUrl: 'https://panel.example/' },
      );
      assert.equal(out.intent, 'fix_request');
      assert.match(said[0]!, /can't actually change anything/i);
      assert.match(said[0]!, /https:\/\/panel\.example\//, 'the deep link is the useful half');
      assert.doesNotMatch(said[0]!, /I(?:'ve| have) (?:updated|changed|fixed)/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── 6. the accounting ───────────────────────────────────────────────────────

describe('accounting — a number that is measured, not asserted', () => {
  it('prices Haiku 4.5 off the published table', () => {
    // 1M in + 1M out = $1.00 + $5.00 = 600 cents.
    assert.equal(estimateCents({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), 600);
  });

  it('pins the model, so a silent upgrade cannot change what a cap means', () => {
    assert.equal(GABI_CHAT_MODEL, 'claude-haiku-4-5-20251001');
  });
});
