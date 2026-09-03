/**
 * The book-knowledge routes — the gate, the two doors, and the sentence a
 * person hears when a book has not been ingested yet.
 *
 * Exercised through the REAL exported Hono app with a fake R2 bucket and the
 * estate directory stubbed at `globalThis.fetch` — the `ebooks.test.ts` idiom.
 * ⚠️ These prove the DECISIONS, not that the Worker can reach a real bucket.
 *
 * ⚠️ The load-bearing one is `⚠️ a book with no pack is answered in WORDS`.
 * Owner requirement (docs/TODO.md status-page item 4): GABI serves whatever
 * packs exist and says cleanly when a book is not among them. An empty passage
 * list would make "I haven't read that one" and "that doesn't happen in the
 * book" indistinguishable, and the second is the one that gets said out loud.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import app from '../src/index.js';
import { resetEstateCache } from '../src/estate-status.js';
import { resetPackCaches } from '../src/book-packs.js';
import type { Env } from '../src/env.js';
import type { BookPack } from '../src/book-retrieval.js';

// ---------------------------------------------------------------------------
// ⚠️ A WORKERS-RUNTIME SHIM, AND WHY IT IS NOT THE TEST LYING
//
// `crypto.subtle.timingSafeEqual` is a Cloudflare Workers EXTENSION to WebCrypto
// — it does not exist in Node's `crypto.subtle`, so door B's bearer comparison
// throws a TypeError under `node --test` and Hono turns that into a bare 500.
// Every door-B assertion below would then pass or fail for a reason that has
// nothing to do with the gate. (`auth-worker/test/estate-docs.test.ts` carries
// the identical shim and the identical reasoning.)
//
// This restores the FUNCTION, not the guarantee: same bytes, same boolean, and
// deliberately NOT constant-time, because a test process has no attacker.
// Production keeps the real one.
// ---------------------------------------------------------------------------
const webcrypto = (globalThis as unknown as { crypto: Crypto }).crypto;
if (typeof (webcrypto.subtle as { timingSafeEqual?: unknown }).timingSafeEqual !== 'function') {
  (webcrypto.subtle as unknown as Record<string, unknown>).timingSafeEqual = (
    a: ArrayBufferView,
    b: ArrayBufferView,
  ): boolean => {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (x.length !== y.length) return false;
    return x.every((byte, i) => byte === y[i]);
  };
}

const PACK: BookPack = {
  book_id: 'a-test-book',
  title: 'A Test Book',
  source: 'transcript',
  ingester_version: 1,
  chapters: [
    { index: 0, title: 'One', first_chunk: 0, last_chunk: 1 },
    { index: 1, title: 'Two', first_chunk: 2, last_chunk: 3 },
  ],
  chunks: [
    { ord: 0, chapter_index: 0, text: 'A stranger named Zephyr walks into the early chapter.' },
    { ord: 1, chapter_index: 0, text: 'Nothing else of note happens in the opening at all.' },
    { ord: 2, chapter_index: 1, text: 'The second chapter begins on a cold and ordinary morning.' },
    { ord: 3, chapter_index: 1, text: 'Zephyr returns at the end, and the book closes on that.' },
  ],
};

/**
 * A minimal R2 bucket over an in-memory key→object map. ⚠️ Packs are stored as
 * OPAQUE GZIP BYTES with NO content-encoding — measured by the ingester, which
 * found R2 transparently inflating 246,033 stored bytes into 802,920 when the
 * header was set. The reader gunzips explicitly, so the fake stores gzip too.
 */
function fakeBucket(objects: Record<string, unknown>) {
  const keys = Object.keys(objects);
  return {
    async get(key: string) {
      if (!(key in objects)) return null;
      const bytes = gzipSync(Buffer.from(JSON.stringify(objects[key]), 'utf8'));
      return {
        body: new Response(bytes).body,
      };
    },
    async list({ prefix }: { prefix?: string } = {}) {
      return {
        objects: keys
          .filter((k) => !prefix || k.startsWith(prefix))
          .map((k) => ({ key: k, size: 100, uploaded: new Date('2026-08-18T03:00:00Z') })),
        truncated: false,
      };
    },
  } as unknown as R2Bucket;
}

function stubSeen(answer: { status: string; visibility?: unknown } | 'error') {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/estate/seen')) {
      if (answer === 'error') return new Response('boom', { status: 500 });
      return Response.json(answer);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return { restore: () => void (globalThis.fetch = original) };
}

function envWith(over: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'development',
    DEV_EMAIL: 'member@example.com',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: 'owner@example.com',
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP_TOKEN_AUDIOBOOK: 'ab-token',
    ESTATE_CHECK: 'shadow',
    EBOOKS_GATED: fakeBucket({
      'text/a-test-book.json.gz': PACK,
      'text/_index.json.gz': {
        generated_at: '2026-08-18T04:00:00Z',
        books: { 'a-test-book': { title: 'A Test Book', source: 'transcript', chunks: 4 } },
      },
    }),
    ...over,
  };
}

beforeEach(() => {
  resetEstateCache();
  resetPackCaches();
});

async function get(path: string, env: Env, headers: Record<string, string> = {}) {
  const res = await app.request(path, { headers }, env);
  const body = (await res.json().catch(() => null)) as Record<string, any> | null;
  return { res, body };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('⚠️ the book text is behind the SAME vis_ebooks grant as the book files', () => {
  // Design decision 3: the text is derived from files that grant already guards.
  // Not the ladder's `download` capability, which floors at admin and would lock
  // ordinary members out of a feature built for them.
  return (async () => {
    const stub = stubSeen({ status: 'approved', visibility: ['audiobook'] });
    try {
      const { res, body } = await get('/api/book/a-test-book/search?q=Zephyr', envWith());
      assert.equal(res.status, 403);
      assert.equal(body?.error, 'no_ebooks_grant');
      assert.match(body?.detail ?? '', /separate grant/);
    } finally {
      stub.restore();
    }
  })();
});

test('an approved member WITH the grant is served', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { res, body } = await get('/api/book/a-test-book/search?q=Zephyr', envWith());
    assert.equal(res.status, 200);
    assert.equal(body?.ingested, true);
    assert.ok((body?.passages ?? []).length > 0);
  } finally {
    stub.restore();
  }
});

test('⚠️ door B — an app bearer plus a proven email ends at the SAME predicate', async () => {
  // The Discord Worker and the site panel hold no Firebase token of the person
  // asking. They carry their own bearer and name the email `link.ts` proved.
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const env = envWith({ ESTATE_APP_TOKEN_BOOKS: 'books-token', ENVIRONMENT: 'production' });
    const { res, body } = await get('/api/books/available', env, {
      authorization: 'Bearer books-token',
      'x-estate-on-behalf-of': 'member@example.com',
    });
    assert.equal(res.status, 200);
    assert.equal(body?.count, 1);
  } finally {
    stub.restore();
  }
});

test('⚠️ door B refuses a person the estate refuses — the bearer authorises no read', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['audiobook'] });
  try {
    const env = envWith({ ESTATE_APP_TOKEN_BOOKS: 'books-token', ENVIRONMENT: 'production' });
    const { res, body } = await get('/api/books/available', env, {
      authorization: 'Bearer books-token',
      'x-estate-on-behalf-of': 'member@example.com',
    });
    assert.equal(res.status, 403);
    assert.equal(body?.error, 'no_ebooks_grant');
  } finally {
    stub.restore();
  }
});

test('door B names nobody → 400 with words, not a 401 about authentication', async () => {
  const env = envWith({ ESTATE_APP_TOKEN_BOOKS: 'books-token', ENVIRONMENT: 'production' });
  const { res, body } = await get('/api/books/available', env, {
    authorization: 'Bearer books-token',
  });
  assert.equal(res.status, 400);
  assert.equal(body?.error, 'no_proven_email');
});

// ---------------------------------------------------------------------------
// Incremental knowledge
// ---------------------------------------------------------------------------

test('⚠️ a book with no pack is answered in WORDS, at 200, never as an empty result', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { res, body } = await get('/api/book/some-other-book/search?q=Zephyr', envWith());
    assert.equal(res.status, 200);
    assert.equal(body?.ingested, false);
    assert.match(body?.detail ?? '', /haven't read that one yet/);
    assert.equal(body?.passages, undefined, 'no empty passage list to be mistaken for a miss');
  } finally {
    stub.restore();
  }
});

test('⚠️ availability comes from the LISTING, so a pack the index has not seen still serves', async () => {
  // The index is written once at the end of a run; packs are written one at a
  // time throughout. Trusting the index would hide a book for hours after it
  // became readable — precisely the wait the owner refused.
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const env = envWith({
      EBOOKS_GATED: fakeBucket({
        'text/a-test-book.json.gz': PACK,
        'text/brand-new-book.json.gz': { ...PACK, book_id: 'brand-new-book' },
        'text/_index.json.gz': {
          generated_at: '2026-08-18T04:00:00Z',
          books: { 'a-test-book': { title: 'A Test Book' } },
        },
      }),
    });
    const { body } = await get('/api/books/available', env);
    assert.equal(body?.count, 2);
    const ids = (body?.books ?? []).map((b: { book_id: string }) => b.book_id);
    assert.ok(ids.includes('brand-new-book'));
  } finally {
    stub.restore();
  }
});

test('the index decorates the listing with titles when it has caught up', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { body } = await get('/api/books/available', envWith());
    assert.equal(body?.index_present, true);
    assert.equal(body?.books?.[0]?.title, 'A Test Book');
  } finally {
    stub.restore();
  }
});

test('a presence roll-up over an un-ingested book reports the HOLE, never absence', async () => {
  // A book nobody has read cannot testify that somebody never appears in it.
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { body } = await get(
      '/api/books/presence?q=Zephyr&books=a-test-book,not-ingested-yet&scope=whole_book',
      envWith(),
    );
    assert.equal(body?.books?.[0]?.chunk_hits, 2);
    assert.equal(body?.books?.[1]?.ingested, false);
    assert.match(body?.books?.[1]?.detail ?? '', /haven't read that one yet/);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// Scope, at the route
// ---------------------------------------------------------------------------

test('⚠️ the ceiling applies to a direct passage read, not only to a search', async () => {
  // A route that scoped its search and not its reads would hand the whole book
  // to anyone willing to guess ordinals.
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { body } = await get(
      '/api/book/a-test-book/passage?ord=3&scope=through_chapter&chapter=0',
      envWith(),
    );
    assert.equal(body?.passage, null);
    assert.match(body?.detail ?? '', /past the point you asked me to stop at/);
  } finally {
    stub.restore();
  }
});

test('⚠️ an ord bound at another ingester_version is a 409, not a warning', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { res, body } = await get(
      '/api/book/a-test-book/search?q=Zephyr&scope=through_ord&ord=1&iv=2',
      envWith(),
    );
    assert.equal(res.status, 409);
    assert.equal(body?.error, 'bound_version_mismatch');
  } finally {
    stub.restore();
  }
});

test('a book id that is not a slug never reaches the bucket', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { res, body } = await get('/api/book/..%2F..%2Fsecret/search?q=x', envWith());
    assert.equal(res.status, 400);
    assert.equal(body?.error, 'bad_book_id');
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// ⚠️ THE PHRASE COUNT ROUTES
//
// `docs/info/gabi-phrase-count-and-read-state.md` §4. The pair exists because
// no route on this Worker could answer "how often" — `/presence` counted words
// (17), `/search` counted chunks behind a top-6 cap (13), the truth was 14.
//
// The load-bearing one below is `⚠️ 0 is not "not ingested"`. A count is a
// single number and both facts render as a small integer to anyone who is not
// looking; keeping them in two DIFFERENT SHAPES is what stops "he never says
// it" being said about a book nobody has packed.
// ---------------------------------------------------------------------------

test('a phrase count answers with counts and anchors, never with the book', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { res, body } = await get(
      '/api/book/a-test-book/count?q=Zephyr&scope=whole_book&quotes=1',
      envWith(),
    );
    assert.equal(res.status, 200);
    assert.equal(body?.ingested, true);
    assert.equal(body?.total, 2);
    assert.deepEqual(
      (body?.by_chapter ?? []).map((c: { index: number; n: number }) => [c.index, c.n]),
      [[0, 1], [1, 1]],
    );
    assert.equal(body?.quotes?.length, 1);
    assert.equal(body?.passages, undefined, 'a count is not a way to read the book');
    assert.match(body?.matcher ?? '', /case-insensitive/);
    assert.equal(body?.limits?.max_quotes, 3);
  } finally {
    stub.restore();
  }
});

test('⚠️ 0 is not "not ingested" — the two facts have two different shapes', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const zero = await get('/api/book/a-test-book/count?q=Miranda&scope=whole_book', envWith());
    assert.equal(zero.res.status, 200);
    assert.equal(zero.body?.ingested, true);
    assert.equal(zero.body?.total, 0, 'a book that WAS read can testify to a zero');

    const absent = await get('/api/book/some-other-book/count?q=Miranda', envWith());
    assert.equal(absent.res.status, 200);
    assert.equal(absent.body?.ingested, false);
    assert.equal(absent.body?.total, undefined, 'no zero to be mistaken for an answer');
    assert.match(absent.body?.detail ?? '', /haven't read that one yet/);
  } finally {
    stub.restore();
  }
});

test('⚠️ the count route refuses an ord bound from another ingester_version too', async () => {
  // It matters MORE here than on /search: a count is one number, and a wrong
  // ceiling makes it wrong with nothing in the answer looking odd.
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { res, body } = await get(
      '/api/book/a-test-book/count?q=Zephyr&scope=through_ord&ord=1&iv=2',
      envWith(),
    );
    assert.equal(res.status, 409);
    assert.equal(body?.error, 'bound_version_mismatch');
  } finally {
    stub.restore();
  }
});

test('the count route sits behind the SAME vis_ebooks gate as every other one', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['audiobook'] });
  try {
    const one = await get('/api/book/a-test-book/count?q=Zephyr', envWith());
    assert.equal(one.res.status, 403);
    assert.equal(one.body?.error, 'no_ebooks_grant');
    const many = await get('/api/books/count?q=Zephyr&books=a-test-book', envWith());
    assert.equal(many.res.status, 403);
    assert.equal(many.body?.error, 'no_ebooks_grant');
  } finally {
    stub.restore();
  }
});

test('a phrase with no words in it is refused in WORDS, not answered with 0', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const empty = await get('/api/book/a-test-book/count?q=', envWith());
    assert.equal(empty.res.status, 400);
    assert.equal(empty.body?.error, 'empty_query');
    const punctuation = await get('/api/book/a-test-book/count?q=%2C%20.%20!', envWith());
    assert.equal(punctuation.res.status, 400);
    assert.equal(punctuation.body?.error, 'empty_phrase');
    const bad = await get('/api/book/..%2F..%2Fsecret/count?q=x', envWith());
    assert.equal(bad.res.status, 400);
    assert.equal(bad.body?.error, 'bad_book_id');
  } finally {
    stub.restore();
  }
});

test('variants and quotes are clamped at the route, and the answer shows the clamp', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { body } = await get(
      '/api/book/a-test-book/count?q=Zephyr&scope=whole_book' +
        '&variants=one|two|three|four|five|six|seven&quotes=99',
      envWith(),
    );
    assert.equal(body?.variants?.length, 6, 'q counts as one of the six');
    assert.equal(body?.variants?.[0], 'Zephyr');
    assert.ok((body?.quotes ?? []).length <= 3, String(body?.quotes?.length));
  } finally {
    stub.restore();
  }
});

test('the multi-book count keeps reading order and reports a HOLE, never a zero', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { body } = await get(
      '/api/books/count?q=Zephyr&books=a-test-book,not-ingested-yet',
      envWith(),
    );
    assert.equal(body?.scope, 'whole_book', 'the roll-up is whole-book only, and says so');
    assert.equal(body?.books?.[0]?.book_id, 'a-test-book');
    assert.equal(body?.books?.[0]?.total, 2);
    assert.equal(body?.books?.[1]?.ingested, false);
    assert.equal(body?.books?.[1]?.total, undefined);
    assert.match(body?.books?.[1]?.detail ?? '', /haven't read that one yet/);
  } finally {
    stub.restore();
  }
});

test('the multi-book count refuses more books than it will honestly count', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { res, body } = await get('/api/books/count?q=x&books=a,b,c,d,e,f,g', envWith());
    assert.equal(res.status, 400);
    assert.equal(body?.error, 'too_many_books');
    const none = await get('/api/books/count?q=x', envWith());
    assert.equal(none.res.status, 400);
    assert.equal(none.body?.error, 'no_books');
  } finally {
    stub.restore();
  }
});

test('presence refuses more books than it will honestly check', async () => {
  const stub = stubSeen({ status: 'approved', visibility: ['ebooks'] });
  try {
    const { res, body } = await get(
      '/api/books/presence?q=x&books=a,b,c,d,e,f,g',
      envWith(),
    );
    assert.equal(res.status, 400);
    assert.equal(body?.error, 'too_many_books');
  } finally {
    stub.restore();
  }
});
