/**
 * HTTP `Range` parsing for the gated ebook byte stream — pure, no I/O, so
 * every edge in the table below is unit-testable without R2, a token or a
 * network (the capabilities.ts idiom).
 *
 * ⚠️ WHY THIS IS ITS OWN MODULE AND NOT FOUR LINES IN THE HANDLER. Both
 * readers this endpoint exists for are range clients, and both were MEASURED
 * to be so on 2026-08-17
 * (`library_catalog/docs/info/epub-streaming-findings-2026-08-17.md`):
 *
 *   - pdf.js probes for `Accept-Ranges: bytes` and, finding it, opens page 1
 *     of a 181 MiB handbook by fetching a few hundred KB.
 *   - foliate-js + zip.js `HttpRangeReader` opened the 393 MiB White Sand
 *     Omnibus in **15 range requests totalling 76.9 KiB — 0.019% of the file**,
 *     using the classic read-the-end-of-a-ZIP pattern (`bytes=0-0`, then the
 *     EOCD at the very end, then the central directory, then seeks).
 *
 * So `bytes=0-0`, tiny suffix reads and far-past-the-middle seeks are the
 * NORMAL traffic here, not exotica. A handler that got any of them subtly
 * wrong would fail as "the reader hangs", which is the least debuggable
 * symptom there is.
 *
 * ## The contract, stated once
 *
 * | Header | Answer |
 * |---|---|
 * | absent | `{ kind: 'full' }` — 200, whole object |
 * | `bytes=A-B`, A ≤ B < size | `{ kind: 'range', start: A, end: B }` — 206 |
 * | `bytes=A-B`, B ≥ size | clamped to `size-1` — 206 (RFC 9110 §14.1.1) |
 * | `bytes=A-` | A → `size-1` — 206 |
 * | `bytes=-N` | the last N bytes; N > size ⇒ the whole object — 206 |
 * | `bytes=A-…`, A ≥ size | `{ kind: 'unsatisfiable' }` — **416** + `Content-Range: bytes * /size` |
 * | `bytes=-0` | `{ kind: 'unsatisfiable' }` — **416** |
 * | any range against a 0-byte object | `{ kind: 'unsatisfiable' }` — **416** |
 * | malformed, or a unit we do not know | `{ kind: 'full' }` — **ignored**, 200 |
 * | multiple ranges (`bytes=0-1,4-5`) | `{ kind: 'full' }` — **ignored**, 200 |
 *
 * ⚠️ **MALFORMED IS NOT 416, AND THAT IS DELIBERATE.** 416 means *Range Not
 * Satisfiable* — the syntax was understood and the bytes do not exist. RFC 9110
 * §14.2 is explicit that a server MUST ignore a `Range` it cannot parse and
 * answer the whole representation, and refusing instead breaks a client that
 * would have coped fine with a 200. The two cases are kept apart here because
 * they are different facts about the request, and collapsing them would be the
 * indistinguishable-failure pattern this estate forbids everywhere else.
 *
 * ⚠️ **MULTI-RANGE IS IGNORED, NOT PARTIALLY HONOURED.** Answering the FIRST
 * range of a multi-range request is the tempting shortcut and it is a
 * correctness bug: the client asked for two disjoint spans and would splice a
 * single 206 into the wrong offsets. Serving the whole body is slower and
 * right. Neither pdf.js nor zip.js has ever been observed to send one.
 */

/** What the handler must do with a request, once the object's size is known. */
export type RangeIntent =
  | { kind: 'full' }
  /** Inclusive, absolute, already clamped into `[0, size-1]`. */
  | { kind: 'range'; start: number; end: number }
  | { kind: 'unsatisfiable' };

/** `bytes=` — the only unit R2 (or this endpoint) speaks. */
const BYTES_UNIT = 'bytes=';

/**
 * Parse a `Range` header against a known object size.
 *
 * @param header the raw header value, or null/undefined when absent
 * @param size   the object's total size in bytes (`R2Object.size`)
 */
export function parseRange(header: string | null | undefined, size: number): RangeIntent {
  if (header == null) return { kind: 'full' };
  const raw = header.trim();
  if (raw === '') return { kind: 'full' };

  // Unit check is case-insensitive per RFC 9110; anything else is a unit we do
  // not understand, which the RFC says to ignore rather than refuse.
  if (raw.slice(0, BYTES_UNIT.length).toLowerCase() !== BYTES_UNIT) return { kind: 'full' };

  const specs = raw.slice(BYTES_UNIT.length).split(',');
  // Multi-range: understood, deliberately unsupported, answered whole.
  if (specs.length !== 1) return { kind: 'full' };

  const spec = (specs[0] ?? '').trim();
  const dash = spec.indexOf('-');
  if (dash < 0) return { kind: 'full' };

  // ⚠️ NOT trimmed individually. The whole spec was trimmed above, which is
  // the optional whitespace RFC 9110's list rule actually permits (`bytes= 1-3`
  // is legal). Whitespace INSIDE a spec — `bytes=1 -3` — is not, and trimming
  // the halves would silently accept it as `1-3`. Being generous about a
  // malformed offset is how a reader gets bytes it did not ask for.
  const firstRaw = spec.slice(0, dash);
  const lastRaw = spec.slice(dash + 1);

  // A zero-length object can satisfy no range at all — there is no byte 0.
  // Checked before the arms below so `bytes=0-` on an empty object is a 416
  // rather than a 206 of nothing.
  const emptyObject = !(size > 0);

  // ── suffix form: bytes=-N, "the last N bytes" ──────────────────────────
  if (firstRaw === '') {
    if (!isNonNegativeInt(lastRaw)) return { kind: 'full' };
    const suffix = Number(lastRaw);
    // ⚠️ `bytes=-0` asks for the last zero bytes. RFC 9110 §14.1.1 says that
    // is unsatisfiable — NOT an empty 206, which some clients would read as
    // end-of-file and stop.
    if (suffix === 0 || emptyObject) return { kind: 'unsatisfiable' };
    const start = Math.max(0, size - suffix);
    return { kind: 'range', start, end: size - 1 };
  }

  // ── prefix / closed form: bytes=A- and bytes=A-B ───────────────────────
  if (!isNonNegativeInt(firstRaw)) return { kind: 'full' };
  const start = Number(firstRaw);

  if (lastRaw === '') {
    if (emptyObject || start >= size) return { kind: 'unsatisfiable' };
    return { kind: 'range', start, end: size - 1 };
  }

  if (!isNonNegativeInt(lastRaw)) return { kind: 'full' };
  const last = Number(lastRaw);
  // last < first is an INVALID byte-range-spec, not an unsatisfiable one
  // (RFC 9110 §14.1.1) — so it is ignored, like any other malformed value.
  if (last < start) return { kind: 'full' };
  if (emptyObject || start >= size) return { kind: 'unsatisfiable' };
  // A last-byte-pos past the end is explicitly legal and clamps. zip.js does
  // this when it guesses how far back the end-of-central-directory record is.
  return { kind: 'range', start, end: Math.min(last, size - 1) };
}

/**
 * The `Content-Range` value for a 206 — `bytes <start>-<end>/<size>`.
 * One implementation, because an off-by-one here corrupts a PDF silently.
 */
export function contentRange(start: number, end: number, size: number): string {
  return `bytes ${start}-${end}/${size}`;
}

/** The `Content-Range` value that MUST accompany a 416: `bytes * /<size>`. */
export function unsatisfiedContentRange(size: number): string {
  return `bytes */${size}`;
}

/**
 * Digits only. ⚠️ Deliberately NOT `Number.isInteger(Number(s))`: that accepts
 * `" 12"`, `"1e3"`, `"+5"`, `"0x10"` and `""`, every one of which would turn a
 * malformed header into a plausible-looking offset instead of an ignored one.
 */
function isNonNegativeInt(s: string): boolean {
  return /^[0-9]+$/.test(s) && Number.isSafeInteger(Number(s));
}
