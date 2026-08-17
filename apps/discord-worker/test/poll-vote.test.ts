/**
 * Poll-vote plumbing — the pure halves of the Discord→Firestore vote path:
 * custom_id round-trip and strictness, Firestore doc decoding for the
 * EXISTING audiobook poll schema (plain-string and book-ref options),
 * the vote doc shape validPollVote() accepts, tallying, and message
 * rendering (10 options → two rows of five, labels within Discord's cap).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPollCustomId,
  buildPollMessage,
  clubVotingEnabled,
  linkFromDoc,
  MSG,
  optionText,
  parsePollCustomId,
  pollFromDoc,
  tallyVotes,
  voteDocFields,
} from '../src/poll-vote.js';

// ---------------------------------------------------------------------------
// custom_id — round-trip and strictness
// ---------------------------------------------------------------------------

test('custom_id round-trips through build → parse for both club lanes', () => {
  for (const clubCol of ['clubs', 'clubs_dev'] as const) {
    const ref = { clubCol, clubId: 'AbC-123_x', pollId: 'p0_-Z', optionIndex: 9 };
    assert.deepEqual(parsePollCustomId(buildPollCustomId(ref)), ref);
  }
});

test('custom_id stays comfortably inside Discord\'s 100-char cap at worst case', () => {
  const ref = {
    clubCol: 'clubs_dev' as const,
    clubId: 'a'.repeat(28), // Firestore auto-ids are 20 chars; headroom
    pollId: 'b'.repeat(28),
    optionIndex: 9,
  };
  assert.ok(buildPollCustomId(ref).length <= 100);
});

test('parse refuses: wrong prefix, unknown collection, unsafe ids, bad indices', () => {
  for (const bad of [
    'xx|clubs|c|p|0', //             wrong prefix
    'pv|memberships|c|p|0', //       not a club lane
    'pv|clubs|has/slash|p|0', //     path separator
    'pv|clubs|..|p|0', //            traversal
    'pv|clubs|c|p|-1', //            negative
    'pv|clubs|c|p|10', //            past MAX_POLL_OPTIONS
    'pv|clubs|c|p|1.5', //           non-integer
    'pv|clubs|c|p|0|extra', //       extra segment
    'pv|clubs||p|0', //              empty id
    `pv|clubs|${'a'.repeat(65)}|p|0`, // over-long id
  ]) {
    assert.equal(parsePollCustomId(bad), null, bad);
  }
});

// ---------------------------------------------------------------------------
// Firestore decoding — the existing audiobook schema, both option shapes
// ---------------------------------------------------------------------------

test('optionText: plain strings pass through; book refs render "Title — Author"', () => {
  assert.equal(optionText({ stringValue: 'Tuesday 7pm' }), 'Tuesday 7pm');
  assert.equal(
    optionText({
      mapValue: {
        fields: { title: { stringValue: 'Dungeon Crawler Carl' }, author: { stringValue: 'Matt Dinniman' } },
      },
    }),
    'Dungeon Crawler Carl — Matt Dinniman',
  );
  assert.equal(
    optionText({ mapValue: { fields: { title: { stringValue: 'Solo Title' } } } }),
    'Solo Title',
  );
  assert.equal(optionText({ mapValue: { fields: {} } }), '(unreadable option)');
});

test('pollFromDoc: decodes question/status/options; refuses missing fields', () => {
  const doc = {
    fields: {
      question: { stringValue: 'Next book?' },
      status: { stringValue: 'open' },
      options: {
        arrayValue: {
          values: [
            { stringValue: 'Option A' },
            { mapValue: { fields: { title: { stringValue: 'B' }, author: { stringValue: 'C' } } } },
          ],
        },
      },
    },
  };
  assert.deepEqual(pollFromDoc(doc), {
    question: 'Next book?',
    status: 'open',
    options: ['Option A', 'B — C'],
  });
  assert.equal(pollFromDoc({}), null);
  assert.equal(pollFromDoc({ fields: { question: { stringValue: 'q' } } }), null);
});

test('linkFromDoc: slug required and slug-shaped; displayName falls back to slug', () => {
  assert.deepEqual(
    linkFromDoc({
      fields: { slug: { stringValue: 'gabi' }, displayName: { stringValue: 'Gabi' } },
    }),
    { slug: 'gabi', displayName: 'Gabi' },
  );
  assert.deepEqual(linkFromDoc({ fields: { slug: { stringValue: 'gabi' } } }), {
    slug: 'gabi',
    displayName: 'gabi',
  });
  assert.equal(linkFromDoc({ fields: { displayName: { stringValue: 'x' } } }), null);
  assert.equal(linkFromDoc({ fields: { slug: { stringValue: 'not/safe' } } }), null);
});

test('clubVotingEnabled: only an affirmative features.discordPollVoting=true counts', () => {
  const on = {
    fields: { features: { mapValue: { fields: { discordPollVoting: { booleanValue: true } } } } },
  };
  const off = {
    fields: { features: { mapValue: { fields: { discordPollVoting: { booleanValue: false } } } } },
  };
  assert.equal(clubVotingEnabled(on), true);
  assert.equal(clubVotingEnabled(off), false);
  assert.equal(clubVotingEnabled({ fields: {} }), false); // absent → default OFF
  assert.equal(clubVotingEnabled({}), false);
});

test('voteDocFields: exactly the shape validPollVote() accepts from a browser', () => {
  assert.deepEqual(voteDocFields(2, 'Gabi'), {
    optionIndex: { integerValue: '2' },
    displayName: { stringValue: 'Gabi' },
  });
});

// ---------------------------------------------------------------------------
// Tallying and rendering
// ---------------------------------------------------------------------------

test('tallyVotes: counts per option, ignores out-of-range and unreadable votes', () => {
  assert.deepEqual(tallyVotes([0, 1, 1, 2, 7, -1, null], 3), [1, 2, 1]);
  assert.deepEqual(tallyVotes([], 2), [0, 0]);
});

test('buildPollMessage: 10 options → two rows of five, parseable custom_ids, capped labels', () => {
  const ref = { clubCol: 'clubs' as const, clubId: 'c1', pollId: 'p1' };
  const poll = {
    question: 'Q?',
    status: 'open',
    options: Array.from({ length: 10 }, (_, i) => `Option ${i} ${'x'.repeat(100)}`),
  };
  const { embeds, components } = buildPollMessage(ref, poll, new Array(10).fill(0));
  assert.equal(components.length, 2);
  for (const row of components as Array<{ type: number; components: unknown[] }>) {
    assert.equal(row.type, 1);
    assert.equal(row.components.length, 5);
  }
  const buttons = (components as Array<{ components: Array<{ label: string; custom_id: string; type: number }> }>)
    .flatMap((r) => r.components);
  buttons.forEach((b, i) => {
    assert.equal(b.type, 2);
    assert.ok(b.label.length <= 80, `label ${i} over Discord's cap`);
    assert.deepEqual(parsePollCustomId(b.custom_id), { ...ref, optionIndex: i });
  });
  assert.equal((embeds as Array<{ title: string }>).length, 1);
});

test('buildPollMessage: tallies and total render into the embed', () => {
  const ref = { clubCol: 'clubs' as const, clubId: 'c', pollId: 'p' };
  const poll = { question: 'Next book?', status: 'open', options: ['A', 'B'] };
  const { embeds } = buildPollMessage(ref, poll, [2, 1]);
  const embed = (embeds as Array<{ description: string; footer: { text: string } }>)[0]!;
  assert.match(embed.description, /\*\*1\.\*\* A — 2 votes/);
  assert.match(embed.description, /\*\*2\.\*\* B — 1 vote\b/);
  assert.match(embed.footer.text, /3 votes/);
});

// ---------------------------------------------------------------------------
// The rejection copy itself is contract: what happened, what it needs, where
// to go — and an outage is never dressed as a permissions problem.
// ---------------------------------------------------------------------------

test('every rejection message says NOT counted/recorded or names the frozen state', () => {
  assert.match(MSG.unlinked, /NOT counted/);
  assert.match(MSG.unlinked, /club page/);
  assert.match(MSG.votingOff, /club manager/i);
  assert.match(MSG.pollClosed, /frozen/);
  assert.match(MSG.outage, /NOT a permissions one/);
  assert.match(MSG.editFailed, /WAS counted/);
});
