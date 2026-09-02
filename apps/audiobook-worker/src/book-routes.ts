/**
 * **THE BOOK-KNOWLEDGE RETRIEVAL ROUTES** — design phase 3
 * (`docs/info/gabi-book-knowledge-design.md` §9).
 *
 * ```
 *   GET /api/books/available            what is in the knowledge base RIGHT NOW
 *   GET /api/books/presence             one term, rolled up across up to 6 books
 *   GET /api/book/:bookId/search        the four modes, scoped, stitched
 *   GET /api/book/:bookId/passage       one passage by ord, stitched
 * ```
 *
 * ## Why they live on THIS Worker
 *
 * Design §3.1 recommends reusing "the existing gated-manifest binding on the
 * audiobook Worker", and that is what this is: `EBOOKS_GATED` is already bound
 * here, `ebook-gate.ts` already answers the `vis_ebooks` question here, and the
 * ebook and audio byte streams already sit behind it. A second Worker would mean
 * a second copy of the gate — the split-brain `ebook-gate.ts`'s header exists to
 * prevent.
 *
 * ⚠️ **It is also the subrequest answer.** `gabi-application-map.md` §2e records
 * that the panel's whole architecture is an argument about the 50-subrequest
 * ceiling, and `library_catalog/apps/worker/src/routes/gabi.ts` refuses a
 * server-side tool loop for the same reason. Putting the SEARCH here means a
 * search is one HTTP call for a caller and **zero** `fetch()` subrequests
 * internally: the pack comes off an R2 binding, and the scan is CPU. A design
 * that answered a book question by chaining Workers would spend its ceiling on
 * plumbing.
 *
 * ## ⚠️ TWO DOORS, ONE PREDICATE
 *
 * | Door | Caller | Proof |
 * |---|---|---|
 * | **A — browser** | a signed-in household member | Firebase ID token |
 * | **B — Discord/panel** | a Worker acting for a linked asker | `ESTATE_APP_TOKEN_BOOKS` **plus** `X-Estate-On-Behalf-Of` |
 *
 * Both end at `resolveEbookAccessForEmail()` — literally the same function the
 * shelf and the byte streams use, so revoking somebody's `vis_ebooks` in
 * `/admin` shuts every door at once. ⚠️ Door B exists only when the secret is
 * set; unset, every request falls through to door A. That is the ships-dark
 * state.
 *
 * ## ⚠️ WHAT THE GATE IS, AND WHAT IT IS NOT
 *
 * The gate is `vis_ebooks` — the SAME grant as the book files, per design
 * decision 3, because *"the text is derived from files that grant already
 * guards"*. It is **not** the ladder's `download` capability (admin+), which
 * would lock ordinary members out of a feature built for them.
 *
 * ## ⚠️ ABSENCE IS ANSWERED IN WORDS, NOT AS AN EMPTY RESULT
 *
 * Owner requirement, `docs/TODO.md` status-page item 4: GABI must serve whatever
 * packs exist and say cleanly when a book is not among them. So a missing pack
 * is a **200 with `ingested: false` and a sentence**, not a 404 and not an empty
 * passage list — because "I haven't read that one" and "that doesn't happen in
 * the book" are different facts, and a caller that cannot tell them apart will
 * eventually state the second when the first is true.
 */

import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from './env.js';
import { resolveEbookAccess, resolveEbookAccessForEmail } from './ebook-gate.js';
import {
  availableBooks,
  isBookId,
  loadPack,
  suggestBookIds,
  type AvailableBook,
} from './book-packs.js';
import {
  boundVersionRefusal,
  deriveCeiling,
  isRetrievalMode,
  MAX_PASSAGES,
  presenceInPack,
  searchPack,
  stitchPassage,
  type BookPack,
  type RetrievalMode,
  type ScopeBound,
} from './book-retrieval.js';

type Ctx = Context<{ Bindings: Env }>;

/** ⚠️ Pinned at BOTH ends. A rename on one side alone is a silent 400 on every
 *  book question. The auth Worker's docs door uses the identical string. */
export const ON_BEHALF_OF_HEADER = 'x-estate-on-behalf-of';

/** ⚠️ How many books one presence roll-up may span. Each is one R2 GET, and a
 *  fourteen-book series asked in one call is how a bounded feature becomes an
 *  unbounded one. Six is a series arc; more is a different question. */
export const MAX_PRESENCE_BOOKS = 6;

/** The sentences this route says. ⚠️ Never a bare status: what happened, what it
 *  needs, and how to get it — and the causes kept distinct, because the fixes
 *  differ (ROLES.md §1e). */
export const BOOK_MSG = {
  notIngested:
    "I haven't read that one yet — it isn't in my knowledge base. I can still tell you what the " +
    'catalogue knows about it (narrator, length, series order), just not what happens in it.',
  storeUnbound:
    'The book-text store is not wired up on this Worker — that is our configuration, not your access.',
  storeUnreachable:
    'The book-text store did not answer, so I cannot read anything right now. That is an outage on ' +
    'our side, not a permissions problem — try again in a minute.',
  packUnreadable:
    'I have a copy of that book but it is damaged and I will not guess at what it says. That is a ' +
    'problem with the ingest, not with your question — it needs re-ingesting.',
  badBookId:
    'That is not a book id I can look up. Book ids come from the knowledge-base listing; do not ' +
    'construct one.',
  noQuery: 'Ask me something to look for — an empty search has no honest answer.',
  noProvenEmail:
    'The caller proved it is the estate but named nobody, so there is no reader to answer for.',
} as const;

/**
 * ⚠️ **DOOR B FIRST, DOOR A OTHERWISE — and door B only when the secret is set.**
 * A bearer that is neither the app token nor a valid Firebase token falls through
 * to door A and is refused there with the worded 401, so a wrong guess learns
 * nothing about which door it missed.
 */
function booksGate(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const appToken = c.env.ESTATE_APP_TOKEN_BOOKS;
    if (appToken && (await bearerMatches(c.req.header('authorization'), appToken))) {
      const email = (c.req.header(ON_BEHALF_OF_HEADER) ?? '').trim().toLowerCase();
      if (email.length < 3 || email.length > 320 || !email.includes('@')) {
        // 400, not 401: the caller authenticated fine, the request is incomplete.
        return c.json({ error: 'no_proven_email', detail: BOOK_MSG.noProvenEmail }, 400);
      }
      const gate = await resolveEbookAccessForEmail(c.env, email, null);
      if (!gate.ok) return gate.response;
      // ⚠️ One line, no email, no query, no token. The corpus is the household's
      // books; an access log naming who asked what about which novel is a second
      // copy of the thing the gate protects.
      console.log(
        JSON.stringify({ evt: 'book_text_door_b', route: c.req.path, at: new Date().toISOString() }),
      );
      c.set('bookAccessEmail' as never, gate.access.email as never);
      return next();
    }

    const gate = await resolveEbookAccess(c);
    if (!gate.ok) return gate.response;
    c.set('bookAccessEmail' as never, gate.access.email as never);
    return next();
  };
}

/** Length-gated `crypto.subtle.timingSafeEqual`, the estate's one bearer idiom
 *  (`auth-worker/src/estate.ts`). The length is not a secret; the bytes are. */
export async function bearerMatches(header: string | undefined, expected: string): Promise<boolean> {
  if (!header?.startsWith('Bearer ')) return false;
  const given = new TextEncoder().encode(header.slice('Bearer '.length));
  const want = new TextEncoder().encode(expected);
  if (given.byteLength !== want.byteLength) return false;
  return crypto.subtle.timingSafeEqual(given, want);
}

/** Resolve the bucket, or the WORDED config failure — the `ebooks.ts` idiom.
 *  "Our setup is wrong" and "you may not read this" never wear the same clothes. */
function resolveBucket(c: Ctx): { bucket: R2Bucket } | { response: Response } {
  const bucket = c.env.EBOOKS_GATED;
  if (!bucket) {
    return {
      response: c.json(
        {
          error: 'book_text_store_unbound',
          detail: BOOK_MSG.storeUnbound,
          fix: 'add the EBOOKS_GATED r2_buckets binding (bucket ebooks-gated)',
        },
        503,
      ),
    };
  }
  return { bucket };
}

/**
 * ⚠️ **THE SCOPE BOUND IS PARSED FROM THE REQUEST AND DERIVED AGAINST THE PACK,
 * EVERY TURN. Nothing here stores one and nothing accepts a stored one**
 * (design §4.3 — the 28-chapter leak). `iv` is the `ingester_version` the caller
 * derived an `ord` bound at; a mismatch is refused rather than warned about.
 */
function parseBound(c: Ctx): { bound: ScopeBound } | { response: Response } {
  const scope = (c.req.query('scope') ?? 'unknown').trim();
  if (scope === 'whole_book') return { bound: { kind: 'whole_book' } };
  if (scope === 'unknown' || scope === '') return { bound: { kind: 'unknown' } };
  if (scope === 'through_chapter') {
    const n = Number(c.req.query('chapter'));
    if (!Number.isFinite(n)) {
      return {
        response: c.json(
          {
            error: 'bad_scope',
            detail: 'scope=through_chapter needs a numeric chapter, and I will not guess one.',
          },
          400,
        ),
      };
    }
    return { bound: { kind: 'through_chapter', chapter: Math.floor(n) } };
  }
  if (scope === 'through_ord') {
    const n = Number(c.req.query('ord'));
    const iv = Number(c.req.query('iv'));
    if (!Number.isFinite(n) || !Number.isFinite(iv)) {
      return {
        response: c.json(
          {
            error: 'bad_scope',
            detail:
              'scope=through_ord needs both ord and iv (the ingester_version the ord was derived ' +
              'at). An ord without its version is the one input that can silently spoil a book.',
          },
          400,
        ),
      };
    }
    return { bound: { kind: 'through_ord', ord: Math.floor(n), ingesterVersion: Math.floor(iv) } };
  }
  return {
    response: c.json(
      {
        error: 'bad_scope',
        detail: 'scope must be one of whole_book, through_chapter, through_ord, unknown.',
      },
      400,
    ),
  };
}

/** The pack, or the finished worded response. ⚠️ `absent` is a 200 — see the
 *  header's absence rule. */
async function packOrAnswer(
  c: Ctx,
  bucket: R2Bucket,
  bookId: string,
): Promise<{ pack: BookPack } | { response: Response }> {
  const result = await loadPack(bucket, bookId);
  if (result.ok) return { pack: result.pack };

  if (result.reason === 'absent') {
    const listed = await availableBooks(bucket);
    const suggestions = listed.ok ? suggestBookIds(listed.books, bookId, 5) : [];
    return {
      response: c.json({
        ok: true,
        ingested: false,
        book_id: bookId,
        detail: BOOK_MSG.notIngested,
        // ⚠️ An honest absence with a way forward, not a dead end.
        did_you_mean: suggestions.map((b) => ({ book_id: b.book_id, title: b.title })),
        knowledge_base_size: listed.ok ? listed.books.length : null,
      }),
    };
  }
  if (result.reason === 'unreadable') {
    return { response: c.json({ error: 'pack_unreadable', detail: BOOK_MSG.packUnreadable }, 502) };
  }
  return {
    response: c.json({ error: 'book_text_store_unreachable', detail: BOOK_MSG.storeUnreachable }, 502),
  };
}

export const bookRoutes = new Hono<{ Bindings: Env }>();

/**
 * **What is in the knowledge base right now.**
 *
 * ⚠️ This is the route that makes "incremental knowledge" checkable rather than
 * claimed. It reads an R2 LISTING on every cold call and caches it for sixty
 * seconds, so a pack written at 3am is in this answer by 3:01am with no deploy.
 */
bookRoutes.get('/api/books/available', booksGate(), async (c) => {
  const resolved = resolveBucket(c);
  if ('response' in resolved) return resolved.response;

  const listed = await availableBooks(resolved.bucket);
  if (!listed.ok) {
    return c.json({ error: 'book_text_store_unreachable', detail: BOOK_MSG.storeUnreachable }, 502);
  }

  const q = (c.req.query('q') ?? '').trim();
  const rows: AvailableBook[] = q ? suggestBookIds(listed.books, q, 25) : listed.books;
  const limit = Math.min(Math.max(1, Number(c.req.query('limit') ?? 40) || 40), 200);

  return c.json({
    ok: true,
    count: listed.books.length,
    matched: rows.length,
    // ⚠️ The index is a DECORATION and its absence is reported rather than
    // hidden — titles may be missing for a book that is nonetheless readable.
    index_present: listed.index_present,
    index_generated_at: listed.index_generated_at,
    books: rows.slice(0, limit),
    truncated: rows.length > limit,
  });
});

/**
 * **Presence — the mode whose answer is a roll-up, not passages** (design §6.2).
 *
 * ⚠️ Top-K is the WRONG data structure for "which books mention X": asked about a
 * character, it returned six book-3 passages and silently omitted book 2, where
 * she is introduced. This returns counts and a first sighting per book, and
 * **`chunk_hits: 0` is the most valuable answer it gives**.
 */
bookRoutes.get('/api/books/presence', booksGate(), async (c) => {
  const resolved = resolveBucket(c);
  if ('response' in resolved) return resolved.response;

  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ error: 'empty_query', detail: BOOK_MSG.noQuery }, 400);

  const ids = (c.req.query('books') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return c.json(
      {
        error: 'no_books',
        detail:
          'Name the books to check, in reading order, as book ids from the knowledge-base listing. ' +
          'I will not scan the whole shelf for one word.',
      },
      400,
    );
  }
  if (ids.length > MAX_PRESENCE_BOOKS) {
    return c.json(
      {
        error: 'too_many_books',
        detail: `I can check ${MAX_PRESENCE_BOOKS} books at a time, and I would rather refuse than quietly check the first few.`,
      },
      400,
    );
  }
  for (const id of ids) {
    if (!isBookId(id)) return c.json({ error: 'bad_book_id', detail: BOOK_MSG.badBookId }, 400);
  }

  const parsedBound = parseBound(c);
  if ('response' in parsedBound) return parsedBound.response;

  const books: unknown[] = [];
  for (const id of ids) {
    const result = await loadPack(resolved.bucket, id);
    if (!result.ok) {
      // ⚠️ NOT a silent omission. A book that is not ingested is a HOLE in this
      // answer, and a hole reported as absence is how "she never appears" gets
      // said about a book nobody has read yet.
      books.push({
        book_id: id,
        ingested: false,
        detail: result.reason === 'absent' ? BOOK_MSG.notIngested : BOOK_MSG.storeUnreachable,
      });
      continue;
    }
    const refusal = boundVersionRefusal(result.pack, parsedBound.bound);
    if (refusal) return c.json({ error: 'bound_version_mismatch', detail: refusal }, 409);
    books.push({ ingested: true, ...presenceInPack(result.pack, q, parsedBound.bound) });
  }

  return c.json({ ok: true, mode: 'presence', query: q, books });
});

/** **Search one book.** Four modes, the ±1 stitch, the derived ceiling. */
bookRoutes.get('/api/book/:bookId/search', booksGate(), async (c) => {
  const resolved = resolveBucket(c);
  if ('response' in resolved) return resolved.response;

  const bookId = c.req.param('bookId');
  if (!isBookId(bookId)) return c.json({ error: 'bad_book_id', detail: BOOK_MSG.badBookId }, 400);

  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ error: 'empty_query', detail: BOOK_MSG.noQuery }, 400);

  const modeRaw = (c.req.query('mode') ?? 'relevant').trim();
  if (!isRetrievalMode(modeRaw)) {
    return c.json(
      {
        error: 'bad_mode',
        detail:
          'mode must be relevant, latest, earliest or presence. They are four different questions, ' +
          'not four sorts of one.',
      },
      400,
    );
  }
  const mode: RetrievalMode = modeRaw;

  const parsedBound = parseBound(c);
  if ('response' in parsedBound) return parsedBound.response;

  const got = await packOrAnswer(c, resolved.bucket, bookId);
  if ('response' in got) return got.response;

  const refusal = boundVersionRefusal(got.pack, parsedBound.bound);
  if (refusal) return c.json({ error: 'bound_version_mismatch', detail: refusal }, 409);

  if (mode === 'presence') {
    return c.json({
      ok: true,
      ingested: true,
      mode: 'presence',
      query: q,
      books: [{ ingested: true, ...presenceInPack(got.pack, q, parsedBound.bound) }],
    });
  }

  const statBlockRaw = c.req.query('stat_block');
  const limit = Number(c.req.query('limit') ?? MAX_PASSAGES);
  const answer = searchPack(got.pack, {
    query: q,
    mode,
    limit: Number.isFinite(limit) ? limit : MAX_PASSAGES,
    bound: parsedBound.bound,
    ...(statBlockRaw === 'true' ? { statBlock: true } : {}),
    ...(statBlockRaw === 'false' ? { statBlock: false } : {}),
  });
  return c.json({ ingested: true, ...answer });
});

/** **One passage by ord**, stitched with its ±1 neighbours inside its chapter. */
bookRoutes.get('/api/book/:bookId/passage', booksGate(), async (c) => {
  const resolved = resolveBucket(c);
  if ('response' in resolved) return resolved.response;

  const bookId = c.req.param('bookId');
  if (!isBookId(bookId)) return c.json({ error: 'bad_book_id', detail: BOOK_MSG.badBookId }, 400);

  const ord = Number(c.req.query('ord'));
  if (!Number.isFinite(ord) || ord < 0) {
    return c.json(
      { error: 'bad_ord', detail: 'Pass the ord a search result gave you. Do not construct one.' },
      400,
    );
  }

  const parsedBound = parseBound(c);
  if ('response' in parsedBound) return parsedBound.response;

  const got = await packOrAnswer(c, resolved.bucket, bookId);
  if ('response' in got) return got.response;

  const refusal = boundVersionRefusal(got.pack, parsedBound.bound);
  if (refusal) return c.json({ error: 'bound_version_mismatch', detail: refusal }, 409);

  // ⚠️ The ceiling applies to a direct read exactly as it applies to a search.
  // A route that scoped its search and not its reads would hand the whole book
  // to anyone willing to guess ordinals.
  const { ceiling, ...scope } = deriveCeiling(got.pack, parsedBound.bound);
  if (ceiling !== null && Math.floor(ord) > ceiling) {
    return c.json(
      {
        ok: true,
        ingested: true,
        book_id: bookId,
        passage: null,
        scope: { ceiling, ...scope },
        detail:
          "That passage is past the point you asked me to stop at, so I haven't read it. Say you " +
          'want it anyway and I will.',
      },
      200,
    );
  }

  const passage = stitchPassage(got.pack, Math.floor(ord));
  if (!passage) {
    return c.json(
      {
        ok: true,
        ingested: true,
        book_id: bookId,
        passage: null,
        detail: 'There is no passage at that position in this book.',
      },
      200,
    );
  }

  return c.json({
    ok: true,
    ingested: true,
    book_id: bookId,
    title: got.pack.title,
    source: got.pack.source,
    ingester_version: got.pack.ingester_version,
    scope: { ceiling, ...scope },
    passage,
  });
});
