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
  BARE_MENTION_GREETING,
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
  /**
   * ⚠️ **THE RECORDED OWNER DECISION IS NOW *ON*, AND THIS TEST MOVED WITH IT.**
   *
   * It pinned OFF from the build until 2026-08-17, when the owner gave the
   * wake-up order, his key was piped to `ANTHROPIC_API_KEY_GABI`, and the
   * conductor flipped the var (commit `13d3d37`). ⚠️ The correct response to
   * this test going red was never to flip `wrangler.toml` back — the file is
   * the posture of record and the test is its witness, not the other way round.
   *
   * Pinned BOTH ways deliberately, mirroring the library's `GABI_PANEL`
   * precedent: the assertion below fails if the var stops saying "on", so
   * turning her back off is exactly as deliberate an act as turning her on was,
   * and the next person to do it has to come here and say why.
   */
  it('⚠️ is ON in wrangler.toml — the owner\'s wake-up order, 2026-08-17', () => {
    const line = WRANGLER.match(/^\s*GABI_MENTIONS\s*=\s*"([^"]*)"/m);
    assert.ok(line, 'wrangler.toml does not declare GABI_MENTIONS at all');
    assert.equal(
      mentionsOn({ GABI_MENTIONS: line[1] }),
      true,
      `wrangler.toml has GABI_MENTIONS = "${line[1]}" — the conversational posture changed without ` +
        'an owner decision recorded here. The last recorded decision (2026-08-17, commit 13d3d37) ' +
        'is ON: the owner asked for her to be woken up and his Anthropic key was set the same ' +
        'minute. If she has been turned OFF on purpose, record the new decision here rather than ' +
        '"fixing" wrangler.toml back — she is live in a real server and the switch is the only ' +
        'thing that stops the gateway opening a socket.',
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

  it('⚠️ a mention with nothing after it is ANSWERED, not ignored', () => {
    // ⚠️ REVERSED 2026-08-19 on tape evidence. This used to assert
    // `empty_question` — and that exit dropped "@GABI hi" in total silence,
    // because the greeting stripper removes "hi" as a courtesy prefix, leaving
    // "", which then failed the floor. The friendliest thing anybody can say to
    // a bot was the one message she deleted.
    //
    // The mention IS the address. A wordless ping is read as the greeting it is
    // and answered in voice.
    const t = mentionTrigger(msg({ content: `<@${APP_ID}>` }), APP_ID);
    assert.equal(t.kind, 'ask');
    assert.equal(t.kind === 'ask' && t.question, BARE_MENTION_GREETING);
  });

  it('⚠️ REGRESSION — "@GABI hi" is answered (the tape, 2026-08-19 00:25)', () => {
    // The exact shape from the raw tail line that caught it:
    //   {"evt":"gabi_ignored","why":"empty_question","content_len":25,
    //    "mentions_count":1,"msg_type":0,"is_reply":false,"replied_to_me":false}
    const content = `<@${APP_ID}> hi`;
    assert.equal(content.length, 25, 'the tail line reported 25 characters');
    const t = mentionTrigger(msg({ content }), APP_ID);
    assert.equal(t.kind, 'ask', 'an addressed greeting must never be silence');
    // ⚠️ The greeting SURVIVES, so the classifier sees small talk and she
    // answers in voice instead of being handed an empty string.
    assert.equal(t.kind === 'ask' && t.question, 'hi');
  });

  it('every greeting-only address survives, on the mention and DM doors', () => {
    for (const word of ['hi', 'hey', 'hello', 'yo', 'heygabi']) {
      const mention = mentionTrigger(msg({ content: `<@${APP_ID}> ${word}` }), APP_ID);
      assert.equal(mention.kind, 'ask', `mention: ${word}`);
      assert.ok(mention.kind === 'ask' && mention.question.length > 0, `mention empty: ${word}`);
    }
  });

  it('⚠️ and a real question is still stripped exactly as before', () => {
    // The greeting stripper's own reason for existing is untouched: this must
    // NOT search the index for "hey gabi".
    const t = mentionTrigger(msg({ content: `<@${APP_ID}> hey gabi do we have Mistborn?` }), APP_ID);
    assert.equal(t.kind === 'ask' && t.question, 'do we have Mistborn?');
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
  it('is exactly these sixteen things', () => {
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
      // ⚠️ TWO MORE ADDED 2026-08-18 with the Tier-0 catalogue tools, and both
      // are READS of an already-public surface. She may now read the audiobook
      // site's published `catalog.csv` — measured 2026-08-18 as the ONLY estate
      // surface holding a narrator, a running time or a genre, because the
      // index's `entry` table has none of the three — and may let the model
      // call the read-only tools in `gabi-tools.ts` during a turn.
      // Note what is STILL absent and cannot arrive without failing this line:
      // no catalogue write, no Firestore write, no GATED ebook/audio read, no
      // change_log row, no timeout, no message delete, no role change.
      'lookup_catalog_metadata',
      'call_catalog_tools',
      // ⚠️⚠️ THREE MORE ADDED 2026-08-18 WITH TIER 1, and they are the FIRST
      // THREE ROWS IN THIS ARRAY THAT ARE NOT READS. Adding them was an owner
      // decision, made in these words: "Can I dm her an isbn or a photo and she
      // adds it to the catalog?" → the T0–T4 ladder → "that looks good, start
      // with that" → "all of it".
      //
      // What makes them safe is not that they are small. It is that GABI holds
      // NOTHING: she asserts an identity the person proved themselves (the
      // /link document), and the DESTINATION CATALOG checks that person's own
      // role — `editCatalog` to add, `runResearch` to sweep — before it acts.
      // Every write is stamped `gabi-discord`, auto-applied, and revertible in
      // the app.
      //
      // Note what is STILL absent and cannot arrive without failing this line:
      // no edit of an existing value, no delete, no role change, no approval,
      // no estate grant or revoke, no deploy, no secret, no moderation verb, no
      // club operation. Those are T2+ and T4, and this build has neither.
      'resolve_link_identity',
      'delegate_add_isbn',
      'delegate_run_details',
      // ⚠️⚠️ THREE MORE ADDED 2026-08-18 WITH TIER 0b, and they are the FIRST
      // ROWS IN THIS ARRAY THAT READ A GATED SURFACE. Every read above this
      // point is of something already published to the open internet — the
      // index's public slice, the audiobook site's `catalog.csv`. These reach
      // the estate's own docs corpus: break-glass SQL, deploy levers, secret
      // NAMES and where they live, the /admin grant grammar, and household
      // members' emails and role assignments.
      //
      // Adding them answers the owner's ORIGINAL ask, which the browser page
      // did not: "let's make sure GABI can read all of our docs and stuff so
      // she can even help me if needed for let's say I don't have a Claude code
      // session open."
      //
      // What makes them safe is the same thing that makes Tier 1 safe, applied
      // to a read: GABI HOLDS NOTHING. She asserts an email the person proved
      // themselves (the /link document, verified server-side by the canonical
      // Firebase verifier), and the AUTH WORKER resolves that email against the
      // estate directory and applies `devopsAllows()` — the same predicate the
      // browser door uses. A non-devops household member gets a worded refusal
      // and she never sees a byte of the corpus on their behalf. Revoke someone
      // in /admin and their next question is refused, with no deploy.
      //
      // ⚠️ And they ship OFF, behind `GABI_DOCS`, unlike Tier 1 which the owner
      // approved switched on. Flipping this one is design §7's owner step 4.
      //
      // Note what is STILL absent and cannot arrive without failing this line:
      // no docs WRITE, no publish trigger, no TODO append, no edit of an
      // existing value, no delete, no role change, no approval, no estate grant
      // or revoke, no deploy, no secret, no moderation verb.
      'resolve_link_email',
      'search_estate_docs',
      'read_estate_doc',
    ]);
  });

  it('⚠️ the allowlist still contains nothing that WRITES to the estate docs', () => {
    // A docs *assistant*, not a docs editor. If "GABI writes to docs/TODO.md"
    // is ever wanted it is a T1/T2 verb with its own design and its own confirm
    // lane — not a fourth row in the Tier-0b block above.
    for (const name of GABI_MENTION_ACTIONS) {
      assert.doesNotMatch(
        name,
        /^(write|edit|publish|append|update|delete|remove)_.*doc/,
        `'${name}' would let a Discord message change the estate's documentation`,
      );
    }
    assert.equal(GABI_MENTION_ACTIONS.filter((n) => n.includes('doc')).length, 2);
  });

  it('the flow source still contains no moderation, admin or Firestore verb', () => {
    // ⚠️ REWORDED 2026-08-18, and the change is the point. This test used to
    // pin that the mention path was 100% CREDENTIAL-FREE, and `docs/TODO.md`
    // recorded that shipping any write "means deciding to give up that property
    // on purpose". The owner's Tier-1 approval IS that decision — quoted in the
    // allowlist above and at length in `src/delegated.ts`'s header.
    //
    // ⚠️ Never worked around: the assertion is not deleted, it is REPOINTED at
    // the narrower property that replaced it, and the next test pins the half
    // that gives it teeth.
    const source = repoFile('src/mention-flow.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const forbidden of [
      /firestoreRequest/,
      /mintAccessToken/,
      /ESTATE_APP_TOKEN/,
      /timeoutGuildMember/,
      /bulkDeleteMessages/,
      /deleteChannelMessage/,
      /putGlobalCommands/,
      /method:\s*'(?:PATCH|PUT|DELETE)'/,
    ]) {
      assert.doesNotMatch(source, forbidden, `mention-flow.ts now reaches for ${forbidden}`);
    }
  });

  it('⚠️ THE NEW PROPERTY: credentials live in TWO modules, and the read paths name none', () => {
    // The half that makes the repointed assertion above mean something. Any
    // credential moving out of the executors — into the chat path, the tool
    // executor, or the public-catalogue reader — fails the build here.
    //
    // ⚠️ **WIDENED 2026-08-18 FROM ONE MODULE TO TWO, DELIBERATELY.** Tier 0b
    // (GABI reads the estate docs) added a SECOND trust edge with its own
    // secret — `ESTATE_APP_TOKEN_DISCORD_DOCS`, two holders, distinct from the
    // Tier-1 token that is shared with both library Workers. It gets its own
    // executor, `src/estate-docs-exec.ts`, for exactly the reason
    // `delegated-exec.ts` exists.
    //
    // ⚠️ Widening a mechanical guard is a decision somebody makes on purpose
    // and writes down — never a quiet relaxation. The property is now "TWO
    // named modules, each one trust edge", not "credentials are allowed in the
    // chat path". `test/estate-docs.test.ts` pins the other half: that neither
    // executor reaches for the other's secret.
    const CREDENTIALS = [/firestoreRequest/, /mintAccessToken/, /parseServiceAccount/, /ESTATE_APP_TOKEN/];
    for (const file of [
      'src/mention-flow.ts',
      'src/delegated.ts',
      'src/delegated-flow.ts',
      'src/gabi-chat.ts',
      'src/tool-exec.ts',
      'src/catalog-data.ts',
      'src/gabi-tools.ts',
      // ⚠️ `src/have.ts` is NOT on this list, and pretending otherwise would
      // make the test a lie. It has held `isLinked` — a service-account read of
      // the same /link document — since long before Tier 1, for the `/have`
      // slash command's scope note. The mention path imports three pure things
      // from it (`lookupHave`, `renderHit`, `truncate`) and never `isLinked`,
      // so the property being pinned here is about what these modules NAME, in
      // their own source, which is exactly what the assertion this one replaced
      // measured too.
    ]) {
      const source = repoFile(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const cred of CREDENTIALS) {
        assert.doesNotMatch(source, cred, `${file} now names a credential — it must not`);
      }
    }
    // And the one module that DOES hold them still does, so this test cannot
    // pass by the credentials having quietly moved somewhere unlisted.
    const exec = repoFile('src/delegated-exec.ts');
    assert.match(exec, /firestoreRequest/);
    assert.match(exec, /ESTATE_APP_TOKEN_DISCORD/);
    // …and so does the second one, so the widening cannot pass by the docs
    // credential having quietly moved somewhere unlisted either.
    const docsExec = repoFile('src/estate-docs-exec.ts');
    assert.match(docsExec, /firestoreRequest/);
    assert.match(docsExec, /ESTATE_APP_TOKEN_DISCORD_DOCS/);
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
      // ⚠️ REWORDED 2026-08-18 with Tier 1. The old sentence — "I can't
      // actually change anything in Discord yet" — became a LIE the day she
      // could add a book, and an overstated limit is as wrong as an overstated
      // power. What is pinned now is the line that is still true and still the
      // point: editing a value already recorded is a T2 mutation, it needs a
      // confirm lane this build does not have, and she says so plainly instead
      // of guessing.
      assert.match(said[0]!, /changing something already recorded is a job for the site/i);
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

describe('⚠️ the voicing pass — the owner: "no personality on that message"', () => {
  const flow = repoFile('src/mention-flow.ts');

  it('the have_lookup lane speaks through the model instead of returning a template', () => {
    const lane = flow.slice(flow.indexOf("if (intent === 'have_lookup')"));
    const body = lane.slice(0, lane.indexOf("if (intent === 'fix_request')"));
    assert.match(body, /await converse\(/, 'the flat lane still has no model call');
    assert.match(body, /extraBlock/, 'the persona/memory block must reach it');
  });

  it('⚠️ the facts still come from the lookup — she re-voices a result, never recalls one', () => {
    const lane = flow.slice(flow.indexOf("if (intent === 'have_lookup')"));
    const body = lane.slice(0, lane.indexOf("if (intent === 'fix_request')"));
    const facts = body.indexOf('const facts = shelfAnswer(');
    const call = body.indexOf('await converse(');
    assert.ok(facts > 0 && call > facts, 'the lookup must run before the voicing');
    assert.match(body, /voiced \?\? facts/, 'no key must fall back to the template, not to silence');
  });

  it('⚠️ the clarifying MENU stays deterministic — a re-worded menu can lose its options', () => {
    const lane = flow.slice(flow.indexOf("if (intent === 'have_lookup')"));
    const menu = lane.slice(lane.indexOf('if (pending)'), lane.indexOf('const facts = shelfAnswer('));
    assert.doesNotMatch(menu, /await converse/, 'the menu path must not be re-phrased by a model');
    assert.match(menu, /buildChoiceComponents\(pending\)/);
  });
});
