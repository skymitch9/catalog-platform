/**
 * **THE PACK STORE — one book's chunk pack out of `ebooks-gated`, and the list
 * of which books have one at all.**
 *
 * `docs/info/gabi-book-knowledge-design.md` §3.1. The ingester
 * (`audiobook_catalog/app/core/ingest_pack.py`) writes `text/{bookId}.json.gz`
 * and, when a run finishes a full pass, `text/_index.json.gz`. This module is the
 * only thing in the Worker that touches either.
 *
 * ## ⚠️ INCREMENTAL KNOWLEDGE IS A HARD REQUIREMENT, NOT A NICE-TO-HAVE
 *
 * Owner, 2026-08-18 (`catalog-platform/docs/TODO.md`, status-page section item
 * 4), verbatim: *"I don't want to wait until every book is processed to use
 * Gabi's knowledge. I want to use her while the knowledge base grows."*
 *
 * Three consequences, and each is a line of code rather than an intention:
 *
 * 1. **Availability is DISCOVERED, never compiled in.** `availableBooks()` does
 *    an `R2.list({ prefix: 'text/' })` — so a pack that lands at 3am is servable
 *    at 3am, with no deploy, no config change and no redeploy of anything.
 *    ⚠️ `wrangler` has no `r2 object list` subcommand; the in-Worker binding's
 *    `list()` does, which is why discovery lives here and not in a build step.
 * 2. **`text/_index.json.gz` is an ENRICHMENT, never the authority.** It carries
 *    titles and counts and it may be absent, stale, or mid-write — it is written
 *    once at the end of a run while packs are written one at a time throughout.
 *    Trusting it would make a book invisible for hours after it became readable,
 *    which is precisely the wait the owner refused. The listing decides what
 *    exists; the index only decorates it.
 * 3. **A book with no pack is answered in WORDS**, by the route, and never as an
 *    empty result. "That one isn't in my knowledge base yet" and "that doesn't
 *    happen in the book" are different facts and must never wear the same
 *    clothes.
 *
 * ## The cache, per book rather than global (design §3.1)
 *
 * A module-scope map keyed by `bookId`, capped at 8 books, least-recently-used
 * evicted, five-minute lease. ⚠️ The cap is the point: an isolate that has served
 * eight different books must not be holding eight megabytes. The listing gets its
 * own, much shorter, lease — sixty seconds — because it is the thing that decides
 * whether a newly-ingested book is visible, and staleness there is exactly the
 * defect requirement 1 exists to prevent.
 *
 * ⚠️ **Only successful reads are cached.** Caching "absent" would keep a Worker
 * answering "I haven't read that one" for five minutes after the ingester healed
 * itself — the `ebook-manifest.ts` rule, and it matters more here.
 */

import type { BookPack } from './book-retrieval.js';

export const PACK_PREFIX = 'text/';
export const PACK_INDEX_KEY = 'text/_index.json.gz';

/** How long one parsed pack is reused within an isolate. */
export const PACK_TTL_MS = 5 * 60 * 1000;
/** ⚠️ How long the AVAILABILITY listing is reused. Deliberately short — see the
 *  header's requirement 1. Sixty seconds is the worst-case delay between a pack
 *  landing and GABI knowing about it, on a warm isolate. */
export const AVAILABILITY_TTL_MS = 60 * 1000;
/** Packs held per isolate. Median pack is ~200 KB gzipped and several MB parsed. */
export const PACK_CACHE_MAX = 8;

interface CachedPack {
  pack: BookPack;
  at: number;
}

const packCache = new Map<string, CachedPack>();

interface CachedAvailability {
  at: number;
  books: AvailableBook[];
  indexGeneratedAt: string | null;
  indexPresent: boolean;
}

let availability: CachedAvailability | null = null;

/** Tests only — per-isolate state the suite must be able to drop. */
export function resetPackCaches(): void {
  packCache.clear();
  availability = null;
}

export interface AvailableBook {
  book_id: string;
  /** From `_index.json.gz` when it has caught up; absent otherwise. ⚠️ Its
   *  absence is normal for a freshly-ingested book and is not an error. */
  title?: string;
  source?: string;
  chunks?: number;
  chapters?: number;
  ingester_version?: number;
  /** When the pack object itself was written — always known, because it comes
   *  from the listing rather than from the index. */
  packed_at: string;
  size_bytes: number;
}

export type PackResult =
  | { ok: true; pack: BookPack }
  /** ⚠️ `absent` is a book nobody has ingested yet — a WORDED answer, not a 500. */
  | { ok: false; reason: 'absent' | 'unreadable' | 'store_unreachable' };

/** ⚠️ Key construction is the ONE place a client string meets the bucket, so it
 *  is validated to a conservative shape rather than escaped. Book ids are
 *  slugs produced by `bookIdFromTitle()`; anything else is not a book id. */
const BOOK_ID_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

export function isBookId(v: unknown): v is string {
  return typeof v === 'string' && BOOK_ID_RE.test(v);
}

export function packKey(bookId: string): string {
  return `${PACK_PREFIX}${bookId}.json.gz`;
}

/** Gunzip an R2 body. ⚠️ The ingester stores packs as OPAQUE gzip bytes with NO
 *  `content-encoding: gzip` — measured there, because setting it made a GET
 *  transparently inflate 246,033 stored bytes into 802,920 with nothing saying a
 *  transform had happened. One explicit gunzip, on both ends, no ambiguity. */
async function gunzipJson(body: ReadableStream): Promise<unknown> {
  const stream = body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}

/**
 * One book's pack, cached per isolate.
 *
 * ⚠️ Returns a REASON rather than throwing, because the three failures need
 * three different sentences: nobody has ingested it, the object is corrupt, and
 * the bucket did not answer are not the same news.
 */
export async function loadPack(
  bucket: R2Bucket,
  bookId: string,
  nowMs: number = Date.now(),
): Promise<PackResult> {
  const cached = packCache.get(bookId);
  if (cached && nowMs - cached.at < PACK_TTL_MS) {
    // Refresh recency for the LRU eviction below.
    packCache.delete(bookId);
    packCache.set(bookId, cached);
    return { ok: true, pack: cached.pack };
  }

  let obj: R2ObjectBody | null;
  try {
    obj = await bucket.get(packKey(bookId));
  } catch {
    return { ok: false, reason: 'store_unreachable' };
  }
  if (!obj) return { ok: false, reason: 'absent' };

  let parsed: unknown;
  try {
    parsed = await gunzipJson(obj.body);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  const pack = asPack(parsed);
  if (!pack) return { ok: false, reason: 'unreadable' };

  packCache.set(bookId, { pack, at: nowMs });
  while (packCache.size > PACK_CACHE_MAX) {
    const oldest = packCache.keys().next().value;
    if (oldest === undefined) break;
    packCache.delete(oldest);
  }
  return { ok: true, pack };
}

/** Shape-check a parsed pack. ⚠️ A row missing either half of the contract is
 *  `unreadable`, never defaulted — a pack with no chunks would answer every
 *  question "not in the book", which is the confidently-wrong direction. */
export function asPack(parsed: unknown): BookPack | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.book_id !== 'string' || !Array.isArray(p.chunks) || !Array.isArray(p.chapters)) {
    return null;
  }
  if (typeof p.ingester_version !== 'number') return null;
  return {
    book_id: p.book_id,
    title: typeof p.title === 'string' ? p.title : p.book_id,
    source: typeof p.source === 'string' ? p.source : 'unknown',
    ingested_at: typeof p.ingested_at === 'string' ? p.ingested_at : undefined,
    ingester_version: p.ingester_version,
    chunk_chars: typeof p.chunk_chars === 'number' ? p.chunk_chars : undefined,
    chunk_overlap: typeof p.chunk_overlap === 'number' ? p.chunk_overlap : undefined,
    text_bytes: typeof p.text_bytes === 'number' ? p.text_bytes : undefined,
    text_sha256: typeof p.text_sha256 === 'string' ? p.text_sha256 : undefined,
    chapters: p.chapters as BookPack['chapters'],
    chunks: p.chunks as BookPack['chunks'],
    notes: Array.isArray(p.notes) ? (p.notes as string[]) : undefined,
    alias_candidates:
      p.alias_candidates && typeof p.alias_candidates === 'object'
        ? (p.alias_candidates as Record<string, number>)
        : undefined,
  };
}

export type AvailabilityResult =
  | {
      ok: true;
      books: AvailableBook[];
      /** ⚠️ Whether the decorating index was found, so a caller can say "counts
       *  are missing" rather than implying the books are. */
      index_present: boolean;
      index_generated_at: string | null;
    }
  | { ok: false; reason: 'store_unreachable' };

/**
 * **Which books are in GABI's knowledge base RIGHT NOW.**
 *
 * ⚠️ The listing is the authority (header, requirement 1). `_index.json.gz` is
 * consulted only to decorate the rows it happens to know about, and a pack that
 * the index has never heard of still appears — with its id, its size and its
 * write time, which is enough to answer "yes, I've read that one".
 */
export async function availableBooks(
  bucket: R2Bucket,
  nowMs: number = Date.now(),
): Promise<AvailabilityResult> {
  if (availability && nowMs - availability.at < AVAILABILITY_TTL_MS) {
    return {
      ok: true,
      books: availability.books,
      index_present: availability.indexPresent,
      index_generated_at: availability.indexGeneratedAt,
    };
  }

  const rows: AvailableBook[] = [];
  try {
    let cursor: string | undefined;
    // ⚠️ Bounded. 148 packs today and 1,079 books at the ceiling; five pages of
    // 1,000 is headroom without an unbounded loop against a paginating API.
    for (let page = 0; page < 5; page++) {
      const listed = await bucket.list({ prefix: PACK_PREFIX, limit: 1000, cursor });
      for (const obj of listed.objects) {
        const id = obj.key.slice(PACK_PREFIX.length).replace(/\.json\.gz$/, '');
        if (!id || id.startsWith('_')) continue;
        rows.push({
          book_id: id,
          packed_at: obj.uploaded.toISOString(),
          size_bytes: obj.size,
        });
      }
      if (!listed.truncated) break;
      cursor = listed.cursor;
    }
  } catch {
    return { ok: false, reason: 'store_unreachable' };
  }

  let indexPresent = false;
  let indexGeneratedAt: string | null = null;
  try {
    const obj = await bucket.get(PACK_INDEX_KEY);
    if (obj) {
      const parsed = (await gunzipJson(obj.body)) as {
        generated_at?: unknown;
        books?: Record<string, Record<string, unknown>>;
      };
      indexPresent = true;
      indexGeneratedAt = typeof parsed.generated_at === 'string' ? parsed.generated_at : null;
      const byId = parsed.books ?? {};
      for (const row of rows) {
        const entry = byId[row.book_id];
        if (!entry) continue;
        if (typeof entry.title === 'string') row.title = entry.title;
        if (typeof entry.source === 'string') row.source = entry.source;
        if (typeof entry.chunks === 'number') row.chunks = entry.chunks;
        if (typeof entry.chapters === 'number') row.chapters = entry.chapters;
        if (typeof entry.ingester_version === 'number') {
          row.ingester_version = entry.ingester_version;
        }
      }
    }
  } catch {
    // ⚠️ An unreadable index is NOT a failure of availability. The listing
    // already answered the question; the index only decorates.
    indexPresent = false;
  }

  rows.sort((a, b) => a.book_id.localeCompare(b.book_id));
  availability = { at: nowMs, books: rows, indexGeneratedAt, indexPresent };
  return { ok: true, books: rows, index_present: indexPresent, index_generated_at: indexGeneratedAt };
}

/**
 * Fuzzy-match a spoken title against the ids that exist.
 *
 * ⚠️ **A SUGGESTION SURFACE, NOT A RESOLVER.** The estate already has one
 * canonical identity for a book (`bookIdFromTitle()`, the key
 * `readingPositions` uses) and this design adds none. This exists so that
 * "I haven't read that one yet" can be followed by "did you mean …", which is
 * the difference between an honest absence and a dead end.
 */
export function suggestBookIds(books: AvailableBook[], query: string, limit = 8): AvailableBook[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (words.length === 0) return [];
  const scored = books.map((b) => {
    const hay = `${b.book_id} ${(b.title ?? '').toLowerCase()}`;
    let hits = 0;
    for (const w of words) if (hay.includes(w)) hits += 1;
    return { book: b, hits };
  });
  return scored
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.book.book_id.localeCompare(b.book.book_id))
    .slice(0, limit)
    .map((s) => s.book);
}
