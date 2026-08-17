/**
 * `anchor → R2 object key` — the ONE lookup that stands between a client
 * string and `env.EBOOKS.get()`.
 *
 * ⚠️ **THE MAPPING IS A LOOKUP, NEVER A CONSTRUCTION** (viewer design §3.4).
 * The `:anchor` in the URL is a client-supplied string; treating it as
 * anything from which a key could be *built* is a path-traversal question
 * wearing a hash. An anchor that is not in the manifest is a 404 and no
 * client-supplied byte ever reaches the bucket API.
 *
 * ## Where the manifest comes from — a deliberate deviation from §3.4
 *
 * The design said to `fetch('https://audiobooks.heygabi.ai/ebooks.json')`,
 * "the manifest is already public". ⚠️ **It is not, since 2026-08-17.** Owner
 * directive that day — *"I don't want people scraping my books"* — took
 * `ebooks.json` out of the Pages deployment AND out of git, and it now lives
 * only in the private `ebooks-gated` bucket behind
 * `GET /api/ebooks/manifest`. So this reads the SAME object the shelf route
 * reads, through the same binding: `EBOOKS_GATED` / `ebooks.json`.
 *
 * That is strictly better than the design's plan and worth saying why: the
 * shelf and the reader now resolve a book from one byte-identical source, so
 * they cannot disagree about which file an anchor names, and no subrequest
 * leaves the Worker to do it.
 *
 * ## The key scheme, pinned
 *
 * The object key is the manifest row's **`path`, verbatim** — no prefix, no
 * hash, no encoding (`audiobook_catalog/docs/info/ebooks-r2-ingest.md` §1).
 * 1.4 GB of objects are stored under it, so ⚠️ **changing that is a migration,
 * not an edit**, and the ingest script's own suite
 * (`tests/test_upload_ebooks_r2.py::test_key_scheme_mutations_fail`) fails on
 * every plausible "improvement". `test/ebook-file.test.ts` pins the same rule
 * from this side.
 */

/** The one object key the pipeline writes and both ebook routes read. */
export const MANIFEST_KEY = 'ebooks.json';

/**
 * How long a parsed index is reused within one isolate.
 *
 * ⚠️ Sized for a READING SESSION, not for freshness. Opening one EPUB is ~15
 * range GETs (measured), and re-reading a 200 KB JSON off R2 fifteen times to
 * answer fifteen questions about the same book is pure waste. The cost of the
 * TTL is that a book added by the pipeline can take up to this long to become
 * readable in a warm isolate — which is invisible, because the shelf that
 * offers the Read button is fetched fresh on every page load anyway.
 */
export const INDEX_TTL_MS = 5 * 60 * 1000;

/** What one manifest row must carry for this endpoint to serve it. */
export interface EbookEntry {
  /** The R2 object key, verbatim. */
  path: string;
  format: string;
  title: string;
  /** Bytes as the pipeline measured them — reported, never trusted over R2. */
  sizeBytes: number | null;
}

interface CachedIndex {
  builtAt: number;
  index: Map<string, EbookEntry>;
}

let cached: CachedIndex | null = null;

/** Tests only — per-isolate state the suite must be able to drop. */
export function resetManifestIndex(): void {
  cached = null;
}

export type IndexResult =
  | { ok: true; index: Map<string, EbookEntry> }
  | { ok: false; reason: 'absent' | 'unreadable' };

/**
 * The anchor index, cached per isolate for `INDEX_TTL_MS`.
 *
 * ⚠️ Only a SUCCESSFUL read is cached. Caching "absent" would keep a Worker
 * answering "no such book" for five minutes after the pipeline healed itself,
 * and a stale refusal is far more expensive than a repeated read.
 */
export async function ebookIndex(
  bucket: R2Bucket,
  nowMs: number = Date.now(),
): Promise<IndexResult> {
  if (cached && nowMs - cached.builtAt < INDEX_TTL_MS) {
    return { ok: true, index: cached.index };
  }

  const obj = await bucket.get(MANIFEST_KEY);
  if (!obj) return { ok: false, reason: 'absent' };

  let parsed: unknown;
  try {
    parsed = await obj.json();
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  const index = buildIndex(parsed);
  if (!index) return { ok: false, reason: 'unreadable' };

  cached = { builtAt: nowMs, index };
  return { ok: true, index };
}

/**
 * Pure — exported so the suite can pin the shape rules without a bucket.
 *
 * Returns null when the payload is not a manifest at all (no `ebooks` array),
 * which is "unreadable"; an EMPTY manifest is a legitimate, if alarming,
 * answer and produces an empty index rather than an error.
 */
export function buildIndex(parsed: unknown): Map<string, EbookEntry> | null {
  const rows = (parsed as { ebooks?: unknown } | null)?.ebooks;
  if (!Array.isArray(rows)) return null;

  const index = new Map<string, EbookEntry>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const anchor = typeof r.anchor === 'string' ? r.anchor.trim() : '';
    const path = typeof r.path === 'string' ? r.path : '';
    // ⚠️ A row missing either half is SKIPPED, not defaulted. An entry with an
    // empty key would resolve to a bucket-root object; an entry with no anchor
    // is unreachable anyway. Both are pipeline bugs and must not become a
    // surprising 200.
    if (!anchor || !path) continue;
    index.set(anchor, {
      path,
      format: typeof r.format === 'string' ? r.format.toLowerCase() : '',
      title: typeof r.title === 'string' ? r.title : '',
      sizeBytes: typeof r.size_bytes === 'number' ? r.size_bytes : null,
    });
  }
  return index;
}
