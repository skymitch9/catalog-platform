/**
 * `anchor → R2 object key` for AUDIOBOOK files — the one lookup between a
 * client string and `env.AUDIO.get()`. Audio player **phase 1**, 2026-08-18.
 *
 * Sibling of `ebook-manifest.ts`, deliberately not a generalisation of it: the
 * bucket differs, the row shape differs (audio rows carry `streamable`, an
 * eviction pair and a `bookId`), and the ebook index is live and load-bearing.
 * Design: `catalog-platform/docs/info/audio-player-design.md` §7.2/§7.3; the
 * ingest as-built: `audiobook_catalog/docs/info/audio-ingest.md`.
 *
 * ⚠️ **THE MAPPING IS A LOOKUP, NEVER A CONSTRUCTION** — the same rule the
 * ebook index states, and it matters more here. The `:anchor` in the URL is a
 * client-supplied string; the object keys in `estate-audio` are library-
 * relative paths verbatim (`Brandon Sanderson/Skyward.m4b`), so treating the
 * anchor as anything a key could be *built* from is a path-traversal question
 * wearing a hash. An anchor that is not in the manifest is a 404 and no
 * client-supplied byte ever reaches the bucket API.
 *
 * ## Where the manifest lives, and why it is in the EBOOKS_GATED bucket
 *
 * `audiobook_catalog/scripts/publish_audio_manifest.py` PUTs
 * `site/audio_manifest.json` to **`ebooks-gated/audio_manifest.json`** — the
 * same private bucket the ebook shelf's manifest sits in, under a second key.
 *
 * That is a deliberate choice and worth the sentence, because "audio manifest
 * in the ebooks bucket" reads like a mistake:
 *
 *   - Owner decision 1 (design §12) FUSED the two grants — *"MIRROR EBOOK if
 *     they can read an ebook they can listen to an audio."* One grant means
 *     "may consume the estate's book files", reading or listening. So this is
 *     not the ebook bucket holding an audio file; it is the ONE gated-manifest
 *     bucket for the ONE book-files grant.
 *   - Its posture is already verified private (`wrangler r2 bucket dev-url get
 *     ebooks-gated` → disabled; no custom domain) and already bound here as
 *     `EBOOKS_GATED`. A fourth bucket would be a fourth thing whose privacy
 *     someone has to keep verifying, for no separation this design needs — the
 *     two manifests are read by the same gate, by the same people.
 *   - ⚠️ The BYTES stay in their own bucket (`estate-audio`, binding `AUDIO`).
 *     That separation is the one that carries a security property and it is
 *     untouched.
 *
 * ## What is in a row, and the two states that are NOT the same
 *
 * `streamable: false` on a present row means **evicted** (or a failed upload
 * recorded), and it is a different fact from an anchor that is not in the
 * manifest at all. The route says so in two different sentences — see
 * `audio-file.ts`. Collapsing them would tell someone their link is broken
 * when the truth is "we deleted the file to save $0.009 a month and one press
 * brings it back".
 */

/** The one object key `publish_audio_manifest.py` writes and this module reads. */
export const AUDIO_MANIFEST_KEY = 'audio_manifest.json';

/**
 * How long a parsed index is reused within one isolate.
 *
 * ⚠️ Sized for a LISTENING SESSION, and that is a longer thing than the ebook
 * index's reading session — a 13.7-hour mean book (MEASURED, design §1.3) is
 * one anchor answering hundreds of range requests. Re-reading the manifest off
 * R2 for each of them would be pure waste.
 *
 * The cost of the TTL: a book the pipeline uploads takes up to this long to
 * become streamable in a warm isolate. That is invisible in practice, because
 * ingest is ON-DEMAND and 8-hourly (owner decision 3) — five minutes against a
 * wait measured in hours is not the part anybody notices.
 */
export const AUDIO_INDEX_TTL_MS = 5 * 60 * 1000;

/** What one audio manifest row must carry for these routes to use it. */
export interface AudioEntry {
  /** The R2 object key in `estate-audio`, verbatim. ⚠️ NEVER served to a client. */
  path: string;
  /** The m4b `©nam` title, or null when the book was uploaded without one. */
  title: string | null;
  /**
   * `book_id_from_title(title)` — the estate's book identity fold, and the
   * key the SITE has (it knows titles, never paths). ⚠️ null when a book was
   * uploaded by path with no `--title`: such a book is streamable but
   * invisible to the shelf, which is a named gap, not a mystery.
   */
  bookId: string | null;
  /** Bytes as the pipeline measured them — reported, never trusted over R2. */
  sizeBytes: number | null;
  /** false ⇒ recorded but NOT in the bucket (evicted). See the header. */
  streamable: boolean;
  /** ISO-Z instant this book FIRST became streamable; never moves on re-upload. */
  since: string | null;
}

interface CachedIndex {
  builtAt: number;
  index: Map<string, AudioEntry>;
}

let cached: CachedIndex | null = null;

/** Tests only — per-isolate state the suite must be able to drop. */
export function resetAudioManifestIndex(): void {
  cached = null;
}

export type AudioIndexResult =
  | { ok: true; index: Map<string, AudioEntry> }
  | { ok: false; reason: 'absent' | 'unreadable' };

/**
 * The audio anchor index, cached per isolate for `AUDIO_INDEX_TTL_MS`.
 *
 * ⚠️ Only a SUCCESSFUL read is cached — the ebook index's rule, for the same
 * reason: caching "absent" would keep a Worker answering "no such book" for
 * five minutes after the pipeline healed itself, and a stale refusal costs far
 * more than a repeated read.
 */
export async function audioIndex(
  bucket: R2Bucket,
  nowMs: number = Date.now(),
): Promise<AudioIndexResult> {
  if (cached && nowMs - cached.builtAt < AUDIO_INDEX_TTL_MS) {
    return { ok: true, index: cached.index };
  }

  const obj = await bucket.get(AUDIO_MANIFEST_KEY);
  if (!obj) return { ok: false, reason: 'absent' };

  let parsed: unknown;
  try {
    parsed = await obj.json();
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  const index = buildAudioIndex(parsed);
  if (!index) return { ok: false, reason: 'unreadable' };

  cached = { builtAt: nowMs, index };
  return { ok: true, index };
}

/**
 * Pure — exported so the suite can pin the shape rules without a bucket.
 *
 * Returns null when the payload is not an audio manifest at all (no `files`
 * OBJECT), which is "unreadable". An EMPTY `files` map is a legitimate answer
 * — indeed it is the CORRECT answer today, because on-demand ingest starts
 * with an empty bucket — and produces an empty index rather than an error.
 * ⚠️ A future session must not "fix" the empty case into a failure: "nobody
 * has requested a book yet" is not a broken pipeline.
 */
export function buildAudioIndex(parsed: unknown): Map<string, AudioEntry> | null {
  const files = (parsed as { files?: unknown } | null)?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null;

  const index = new Map<string, AudioEntry>();
  for (const [path, row] of Object.entries(files as Record<string, unknown>)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const anchor = typeof r.anchor === 'string' ? r.anchor.trim() : '';
    // ⚠️ A row with no anchor is SKIPPED, not defaulted — it is unreachable
    // anyway, and an empty key would resolve to a bucket-root object. The
    // manifest's own key IS the path, so `path` cannot be missing.
    if (!anchor || !path) continue;
    index.set(anchor, {
      path,
      title: typeof r.title === 'string' && r.title ? r.title : null,
      bookId: typeof r.bookId === 'string' && r.bookId ? r.bookId : null,
      sizeBytes: typeof r.size === 'number' ? r.size : null,
      // ⚠️ Affirmative: anything that is not exactly `true` is not streamable.
      // A missing field on a hand-edited row must fail CLOSED into a worded
      // "request it" rather than into an R2 miss.
      streamable: r.streamable === true,
      since: typeof r.since === 'string' && r.since ? r.since : null,
    });
  }
  return index;
}

/** One row of `GET /api/audio/status` — the ONLY audio fields that leave. */
export interface StreamableBook {
  bookId: string | null;
  anchor: string;
  title: string | null;
  sizeBytes: number | null;
  since: string | null;
}

/**
 * The status projection — ⚠️ **DEFAULT-DENY, AN EXPLICIT ALLOWLIST.**
 *
 * Five fields go out and they are named here, individually. This is NOT a
 * spread-minus-exclusions, and the difference is the whole point: the estate's
 * rule is that an export surface built by subtraction leaks the day a field is
 * added, and the field this one would leak is **`path`** — the library-
 * relative object key, i.e. a filename-by-filename map of the household's
 * 630 GB. `site/audio_manifest.json` is gitignored for exactly that reason
 * (audio-ingest.md §2); handing it out through an API would reopen the surface
 * from the other end.
 *
 * ⚠️ Also deliberately absent: `sha256`, `mtime_ns`, `last_stream_at`,
 * `last_position_at`. The last two are per-person-ish access facts; nothing
 * outside the evictor has any business reading them.
 *
 * Evicted rows (`streamable: false`) are omitted — the answer is "what can you
 * play right now", and a row that names a book we no longer hold would make
 * the shelf offer a play button that 404s.
 */
export function streamableBooks(index: Map<string, AudioEntry>): StreamableBook[] {
  const out: StreamableBook[] = [];
  for (const [anchor, entry] of index) {
    if (!entry.streamable) continue;
    out.push({
      bookId: entry.bookId,
      anchor,
      title: entry.title,
      sizeBytes: entry.sizeBytes,
      since: entry.since,
    });
  }
  // Stable order so a diff between two calls is a real change, not a hash walk.
  out.sort((a, b) => a.anchor.localeCompare(b.anchor));
  return out;
}
