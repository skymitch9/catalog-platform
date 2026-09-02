/**
 * `/review` — the read path, the honest empty answer, and the write half that
 * is deliberately a deep link.
 *
 * The tests that matter most:
 *  - `an empty result NEVER says nobody reviewed it` — the join is by title
 *    slug, and a spelling mismatch looks identical to an absence;
 *  - `a failed read is an OUTAGE, never "no reviews"` — the estate's rule that
 *    an outage is never dressed as an answer about the thing asked about;
 *  - `no review is ever WRITTEN` — the write half is a link on purpose (the
 *    doc-id convention is unmeasured here and a service account bypasses the
 *    rules that would have refused a guess).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  averageRating,
  buildReviewAnswer,
  firstBook,
  lookupBook,
  MAX_REVIEWS_SHOWN,
  processReview,
  renderReview,
  REVIEW_MSG,
  REVIEW_SOURCE,
  reviewSearchUrl,
} from '../src/review.js';
import { bookIdFromTitle, type ShelfPort } from '../src/shelf.js';
import { BASE_COMMANDS } from '../src/commands.js';
import { EPHEMERAL, REVIEW_COMMAND_NAME, routeInteraction } from '../src/interactions.js';
import { signedPost } from './helpers/signed-post.js';

const SEARCH = {
  books: [
    {
      title: 'The Way of Kings',
      creator: 'Brandon Sanderson',
      entries: [{ detail_url: 'https://audiobooks.heygabi.ai/#the-way-of-kings', format: 'audio' }],
    },
  ],
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Sent {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(handler: (url: string) => Response): { sent: Sent[]; restore: () => void } {
  const real = globalThis.fetch;
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), init });
    return handler(String(input));
  }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = real; } };
}

/** A ShelfPort whose reviews half is scripted. The other three methods throw:
 * `/review` must touch NOTHING but the public book-reviews read. */
function shelfStub(
  result: Awaited<ReturnType<ShelfPort['bookReviews']>>,
  seen: string[] = [],
): ShelfPort {
  return {
    asker: async () => {
      throw new Error('/review must not read the asker — reviews are public content');
    },
    myTbr: async () => {
      throw new Error('/review must not read anybody’s TBR');
    },
    myReviews: async () => {
      throw new Error('/review must not read the asker’s own reviews');
    },
    bookReviews: async (bookId: string) => {
      seen.push(bookId);
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// The lookup
// ---------------------------------------------------------------------------

test('⚠️ the search narrows to the audiobook source and sends NO Authorization header', async () => {
  const stub = stubFetch(() => json(SEARCH));
  try {
    await lookupBook('https://index.example', 'way of kings');
    const url = new URL(stub.sent[0]!.url);
    assert.equal(url.searchParams.get('source'), REVIEW_SOURCE);
    const headers = (stub.sent[0]!.init?.headers ?? {}) as Record<string, string>;
    assert.equal(Object.keys(headers).some((k) => k.toLowerCase() === 'authorization'), false);
  } finally {
    stub.restore();
  }
  assert.match(reviewSearchUrl('https://index.example', 'x'), /source=audiobook/);
});

test('the FIRST hit and nothing cleverer — a second ranking would disagree with the index', () => {
  const book = firstBook(SEARCH);
  assert.equal(book?.title, 'The Way of Kings');
  assert.equal(book?.url, 'https://audiobooks.heygabi.ai/#the-way-of-kings');
  assert.equal(firstBook({ books: [] }), null);
  assert.equal(firstBook({}), null);
});

test('a hit with no detail_url yields a null url rather than an invented one', () => {
  const book = firstBook({ books: [{ title: 'T', entries: [{ format: 'audio' }] }] });
  assert.equal(book?.url, null);
});

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

test('⚠️ reviews are looked up by the MIRRORED slug of the catalogue’s own title', async () => {
  const seen: string[] = [];
  const stub = stubFetch((url) => (url.includes('/webhooks/') ? json({}) : json(SEARCH)));
  try {
    await processReview({
      book: 'way of kings',
      applicationId: 'app',
      interactionToken: 'tok',
      indexBaseUrl: 'https://index.example',
      shelf: shelfStub({ ok: true, rows: [], total: 0 }, seen),
      shelfOn: true,
    });
  } finally {
    stub.restore();
  }
  assert.deepEqual(seen, [bookIdFromTitle('The Way of Kings')]);
  assert.equal(seen[0], 'the-way-of-kings');
});

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

test('⚠️ an empty result NEVER says nobody reviewed it — it names what it looked under', () => {
  const answer = buildReviewAnswer(
    { title: 'The Way of Kings', creator: 'B.S.', url: 'https://x.example/b' },
    [],
    0,
  ) as { embeds: { description: string }[] };
  const d = answer.embeds[0]!.description;
  assert.match(d, /No reviews are recorded under \*\*The Way of Kings\*\*/);
  assert.match(d, /joined by the slug of the title/);
  assert.doesNotMatch(d, /nobody has|no one has/i);
});

test('the write half is a LINK, and it is offered whether or not there are reviews', () => {
  const url = 'https://x.example/b';
  const empty = buildReviewAnswer({ title: 'T', creator: '', url }, [], 0) as {
    embeds: { description: string }[];
  };
  assert.match(empty.embeds[0]!.description, /Be the first/);
  const some = buildReviewAnswer({ title: 'T', creator: '', url }, [{ displayName: 'A', rating: 5 }], 1) as {
    embeds: { description: string }[];
  };
  assert.match(some.embeds[0]!.description, /Write your own/);
  assert.ok(some.embeds[0]!.description.includes(url));
});

test('a review is ATTRIBUTED, never absorbed — and a rating with no words is still a review', () => {
  assert.match(renderReview({ displayName: 'Sam', rating: 4, text: 'Loved it' }), /\*\*Sam\*\*/);
  assert.match(renderReview({ displayName: 'Sam', rating: 4, text: 'Loved it' }), /★★★★☆/);
  assert.equal(renderReview({ displayName: 'Sam', rating: 5 }).includes('>'), false);
});

test('⚠️ the average excludes unrated reviews rather than counting them as zero', () => {
  assert.deepEqual(averageRating([{ displayName: 'a', rating: 5 }, { displayName: 'b' }]), {
    avg: 5,
    of: 1,
  });
  assert.equal(averageRating([{ displayName: 'a' }]), null);
  assert.deepEqual(averageRating([{ displayName: 'a', rating: 4 }, { displayName: 'b', rating: 5 }]), {
    avg: 4.5,
    of: 2,
  });
});

test('the overflow is counted and stated', () => {
  const rows = Array.from({ length: MAX_REVIEWS_SHOWN + 3 }, (_, i) => ({ displayName: `p${i}`, rating: 4 }));
  const answer = buildReviewAnswer({ title: 'T', creator: '', url: null }, rows, rows.length) as {
    embeds: { description: string }[];
  };
  assert.match(answer.embeds[0]!.description, new RegExp(`Showing ${MAX_REVIEWS_SHOWN} of ${rows.length}`));
});

// ---------------------------------------------------------------------------
// The refusals — four causes, four sentences
// ---------------------------------------------------------------------------

test('⚠️ a failed reviews read is an OUTAGE, never "no reviews"', async () => {
  const stub = stubFetch((url) => (url.includes('/webhooks/') ? json({}) : json(SEARCH)));
  try {
    await processReview({
      book: 'way of kings',
      applicationId: 'app',
      interactionToken: 'tok',
      indexBaseUrl: 'https://index.example',
      shelf: shelfStub({ ok: false, rows: [], total: 0, message: 'estate unreachable' }),
      shelfOn: true,
    });
    const body = JSON.parse(String(stub.sent.at(-1)?.init?.body ?? '{}')) as { content?: string };
    assert.equal(body.content, 'estate unreachable');
  } finally {
    stub.restore();
  }
});

test('a SWITCH and a SETUP GAP are two different sentences, and neither is a permission refusal', async () => {
  for (const [ctx, expected] of [
    [{ shelfOn: false, shelf: null }, REVIEW_MSG.reviewsOff],
    [{ shelfOn: true, shelf: null }, REVIEW_MSG.notConfigured],
  ] as const) {
    const stub = stubFetch((url) => {
      if (url.includes('/webhooks/')) return json({});
      throw new Error('nothing should be looked up before the posture is checked');
    });
    try {
      await processReview({
        book: 'anything',
        applicationId: 'app',
        interactionToken: 'tok',
        indexBaseUrl: 'https://index.example',
        shelf: ctx.shelf,
        shelfOn: ctx.shelfOn,
      });
      const body = JSON.parse(String(stub.sent.at(-1)?.init?.body ?? '{}')) as { content?: string };
      assert.equal(body.content, expected);
      // ⚠️ Each says outright that it is NOT a permissions problem — the
      // estate's four-causes rule: a switch and a setup gap must not be
      // mistaken for "you are not allowed", because the fixes differ.
      assert.match(body.content!, /not a permissions problem|lever on our side/i);
    } finally {
      stub.restore();
    }
  }
});

test('a one-character query is refused with words rather than a wasted round trip', async () => {
  const stub = stubFetch((url) => {
    if (url.includes('/webhooks/')) return json({});
    throw new Error('the index must not be asked about a one-character query');
  });
  try {
    await processReview({
      book: 'x',
      applicationId: 'app',
      interactionToken: 'tok',
      indexBaseUrl: 'https://index.example',
      shelf: shelfStub({ ok: true, rows: [], total: 0 }),
      shelfOn: true,
    });
    const body = JSON.parse(String(stub.sent.at(-1)?.init?.body ?? '{}')) as { content?: string };
    assert.equal(body.content, REVIEW_MSG.tooShort);
  } finally {
    stub.restore();
  }
});

test('a catalogue miss is a statement about the CATALOGUE, not about the house', async () => {
  const stub = stubFetch((url) => (url.includes('/webhooks/') ? json({}) : json({ books: [] })));
  try {
    await processReview({
      book: 'a book nobody has',
      applicationId: 'app',
      interactionToken: 'tok',
      indexBaseUrl: 'https://index.example',
      shelf: shelfStub({ ok: true, rows: [], total: 0 }),
      shelfOn: true,
    });
    const body = JSON.parse(String(stub.sent.at(-1)?.init?.body ?? '{}')) as { content?: string };
    assert.match(body.content!, /statement about the \*\*catalogue\*\*/);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// ⚠️ NOTHING IS WRITTEN
// ---------------------------------------------------------------------------

test('⚠️ /review never issues a Firestore write — the write half is a deep link on purpose', async () => {
  const stub = stubFetch((url) => (url.includes('/webhooks/') ? json({}) : json(SEARCH)));
  try {
    await processReview({
      book: 'way of kings',
      applicationId: 'app',
      interactionToken: 'tok',
      indexBaseUrl: 'https://index.example',
      shelf: shelfStub({ ok: true, rows: [{ bookId: 'b', displayName: 'Sam', rating: 5 }], total: 1 }),
      shelfOn: true,
    });
    for (const s of stub.sent) {
      assert.equal(s.url.includes('firestore.googleapis.com'), false, 'no Firestore call');
      if (!s.url.includes('/webhooks/')) assert.equal((s.init?.method ?? 'GET'), 'GET');
    }
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// The registry and the router
// ---------------------------------------------------------------------------

test('/review is registered with a REQUIRED book title', () => {
  const cmd = BASE_COMMANDS.find((c) => c.name === REVIEW_COMMAND_NAME) as
    | { options?: { name: string; required?: boolean }[] }
    | undefined;
  assert.ok(cmd);
  assert.equal(cmd!.options?.find((o) => o.name === 'book')?.required, true);
});

test('the router carries the book through', () => {
  const decision = routeInteraction({
    type: 2,
    data: { name: REVIEW_COMMAND_NAME, options: [{ name: 'book', type: 3, value: 'Mistborn' }] },
  });
  assert.equal(decision.kind === 'review_command' && decision.book, 'Mistborn');
});

test('the full request defers privately', async () => {
  const res = await signedPost({
    type: 2,
    token: 'tok',
    application_id: 'app',
    data: { name: REVIEW_COMMAND_NAME, options: [{ name: 'book', type: 3, value: 'x' }] },
    member: { user: { id: 'u1' } },
  });
  const data = (await res.json()) as { type: number; data: { flags?: number } };
  assert.equal(data.type, 5);
  assert.equal(data.data.flags, EPHEMERAL);
});
