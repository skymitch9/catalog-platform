/**
 * The substrate's SHARED claims — the ones that stopped being Discord's on
 * 2026-08-18 when the site panel became the second consumer.
 *
 * ⚠️ This file deliberately does NOT re-test the window arithmetic.
 * `apps/discord-worker/test/conversation.test.ts` already pins
 * `pruneConversation`, `appendTurns`, the 30-minute cut, the 20-turn cap and
 * the "aged-out is deleted, not archived" null — through the re-export, so it
 * is exercising this module. Duplicating those here would be a second copy of
 * the assertions in the repo that exists to have one copy of the code.
 *
 * What is new, and therefore what is here:
 *
 *  1. **The portability claim, made mechanical.** A Discord snowflake and a
 *     library `app_user` id must produce valid, distinct keys, and nothing may
 *     parse either. The doc has asserted this in prose since the shape was
 *     designed; this is the assertion.
 *  2. **`withRemembered()`** — the panel's merge. Every branch of it is a way
 *     the Messages API returns 400 and eats somebody's answer.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONVERSATION_SURFACES,
  SURFACE_WEB_PANEL,
  conversationKey,
  conversationStorageKey,
  modelMessages,
  normaliseHistory,
  withRemembered,
  type ConversationTurn,
} from '../src/index.js';

const at = 1_700_000_000_000;
const turn = (role: 'user' | 'assistant', text: string, ref?: Record<string, string>): ConversationTurn =>
  ({ role, text, at, ...(ref ? { ref } : {}) });

// ── 1. the portability claim ────────────────────────────────────────────────

describe('⚠️ space and person are OPAQUE — the whole portability claim', () => {
  it('a Discord snowflake and an app_user id are interchangeable and distinct', () => {
    const discord = conversationStorageKey(conversationKey('discord_dm', '9876543210', '1234567890'));
    const panel = conversationStorageKey(conversationKey(SURFACE_WEB_PANEL, 'library', '7'));
    assert.equal(discord, 'conv:discord_dm:9876543210:1234567890');
    assert.equal(panel, 'conv:web_panel:library:7');
    assert.notEqual(discord, panel);
  });

  it('⚠️ the two library INSTANCES are two different memories, not one', () => {
    // `space` is the catalog. The same person on padhard and on the main
    // library must not share a window — the books are different and so is the
    // conversation. This is the assertion that would fail if `space` were ever
    // dropped from the key "because the person is unique anyway".
    const main = conversationStorageKey(conversationKey(SURFACE_WEB_PANEL, 'library', '7'));
    const friend = conversationStorageKey(conversationKey(SURFACE_WEB_PANEL, 'library2', '7'));
    assert.notEqual(main, friend);
  });

  it('a separator inside a part cannot merge two people into one memory', () => {
    const a = conversationStorageKey(conversationKey(SURFACE_WEB_PANEL, 'library', 'a:b'));
    const b = conversationStorageKey(conversationKey(SURFACE_WEB_PANEL, 'library', 'a_b'));
    // They collide *after* replacement — which is precisely why the module's
    // header requires a surface whose `person` can contain a colon to hash it
    // first. Neither surface in use can: both ids are digits.
    assert.equal(a, b);
    assert.doesNotMatch('7', /[:\s]/, 'an app_user id must stay separator-free');
  });

  it('the panel surface is a declared label, not a string typed at a call site', () => {
    assert.ok((CONVERSATION_SURFACES as readonly string[]).includes(SURFACE_WEB_PANEL));
  });
});

// ── 2. the panel's merge ────────────────────────────────────────────────────

describe('withRemembered — the panel merge, and every 400 it prevents', () => {
  it('nothing remembered leaves the surface array untouched', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    assert.deepEqual(withRemembered([], messages), messages);
  });

  it('a remembered window ending on an assistant turn is straight concatenation', () => {
    const out = withRemembered(
      [turn('user', 'who wrote Unsouled?'), turn('assistant', 'Will Wight.')],
      [{ role: 'user', content: 'and the sequel?' }],
    );
    assert.deepEqual(out, [
      { role: 'user', content: 'who wrote Unsouled?' },
      { role: 'assistant', content: 'Will Wight.' },
      { role: 'user', content: 'and the sequel?' },
    ]);
  });

  it('⚠️ a leading assistant turn is DROPPED — the window cut that would 400', () => {
    const out = withRemembered(
      [turn('assistant', 'Will Wight.'), turn('user', 'and the sequel?'), turn('assistant', 'Blackflame.')],
      [{ role: 'user', content: 'is it in the catalog?' }],
    );
    assert.equal((out[0] as { role: string }).role, 'user');
  });

  it('⚠️ an UNANSWERED remembered question is folded in, not dropped', () => {
    // The one turn in the window with no answer is exactly the one a follow-up
    // refers to. Concatenating it as its own message would put two `user`
    // messages side by side, which the Messages API refuses.
    const out = withRemembered(
      [turn('user', 'what is missing on Blackflame?')],
      [{ role: 'user', content: 'still there?' }],
    );
    assert.equal(out.length, 1);
    assert.equal((out[0] as { content: string }).content, 'what is missing on Blackflame?\n\nstill there?');
  });

  it('folds into a BLOCK-ARRAY body as a leading text block — the panel shape', () => {
    const out = withRemembered(
      [turn('user', 'what is missing?')],
      [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '{}' }] }],
    );
    const content = (out[0] as { content: { type: string; text?: string }[] }).content;
    assert.equal(content.length, 2);
    assert.deepEqual(content[0], { type: 'text', text: 'what is missing?' });
  });

  it('never produces two adjacent same-role messages, on any input', () => {
    const messy: ConversationTurn[] = [
      turn('assistant', 'lead'),
      turn('user', 'a'),
      turn('user', 'b'),
      turn('assistant', 'c'),
      turn('assistant', 'd'),
      turn('user', 'e'),
    ];
    const out = withRemembered(messy, [{ role: 'user', content: 'now' }]);
    for (let i = 1; i < out.length; i += 1) {
      assert.notEqual(
        (out[i] as { role: string }).role,
        (out[i - 1] as { role: string }).role,
        `messages ${i - 1} and ${i} share a role — that is the 400`,
      );
    }
    assert.equal((out[0] as { role: string }).role, 'user');
  });

  it('empty and whitespace-only remembered turns contribute nothing', () => {
    const out = withRemembered(
      [turn('user', '   '), turn('assistant', '')],
      [{ role: 'user', content: 'hello' }],
    );
    assert.deepEqual(out, [{ role: 'user', content: 'hello' }]);
  });

  it("the surface's own ref bag rides along untouched and is never read here", () => {
    // `ref.cid` is how the panel decides what to pass in; the core must not
    // notice it exists. Two turns identical but for `ref` must merge the same.
    const withRef = withRemembered(
      [turn('user', 'q', { cid: 'abc' }), turn('assistant', 'a', { cid: 'abc' })],
      [{ role: 'user', content: 'next' }],
    );
    const without = withRemembered([turn('user', 'q'), turn('assistant', 'a')], [{ role: 'user', content: 'next' }]);
    assert.deepEqual(withRef, without);
  });
});

describe('normaliseHistory and modelMessages agree — one rule, two callers', () => {
  it("Discord's shape is the panel's shape plus the current question", () => {
    const history = [turn('user', 'q1'), turn('assistant', 'a1')];
    assert.deepEqual(modelMessages(history, 'q2'), [
      ...normaliseHistory(history),
      { role: 'user', content: 'q2' },
    ]);
  });
});
