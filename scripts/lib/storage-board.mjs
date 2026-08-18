/**
 * storage-board.mjs — the `storage` section of the agent board.
 *
 * Owner ask, 2026-08-18: a blob-storage panel on /status — per bucket, how many
 * objects, how big, when it was last written, and what it costs a month.
 *
 * ⚠️ WHY THIS IS A PUSHED SECTION AND NOT A WORKER ENDPOINT. Both were on the
 * table. The Worker route was rejected on two measured grounds:
 *
 *   1. **Only five of the eight buckets are bound to a Worker in this repo.**
 *      auth-worker binds `estate-backups` and `estate-docs-gated`;
 *      audiobook-worker binds `ebooks-gated`, `estate-ebooks` and
 *      `estate-audio`. The three COVER buckets live behind other repos'
 *      Workers. Covering them from here would mean binding another repo's data
 *      store into the auth Worker — an access-WIDENING change (an auth-worker
 *      bug could then delete cover images), which is not mine to make quietly.
 *   2. **A Worker can only measure a bucket by LISTING it**, which is O(objects)
 *      and costs Class A operations on every page load. `wrangler r2 bucket
 *      info` answers the same question in ONE call per bucket, from the
 *      machine's existing login, with no API token and no pagination.
 *
 * The home machine already pushes every 15 minutes and the board already stamps
 * per section, so this rides that. The cost is that the panel is only as fresh
 * as the home machine — which the freshness strip already states out loud.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT ANSWER: **last write.** `bucket info` does
 * not carry it, and this module refuses to invent it. Last-write belongs to
 * whatever WROTE the bucket and is reported by that job: `estate-backups` has
 * it already from the Worker's own `/api/estate/backups` (which lists, because
 * it must grade generations anyway), and `estate-audio`'s comes from the
 * archive log. A bucket with no writer reporting in says its last write is
 * unknown, and says it in words.
 */

/** R2 Standard storage, US$/GB-month. Cloudflare's published rate. */
export const R2_USD_PER_GB_MONTH = 0.015;

/**
 * The buckets the panel covers, in the order the owner named them, each with
 * what it HOLDS in plain words — the labels rule from 2026-08-18: a row has to
 * say what it is to someone who does not know the codebase.
 *
 * ⚠️ `reachable_from` is recorded because it is the fact that decides whether a
 * Worker could ever serve this instead. Do not quietly drop a bucket from this
 * list: an absent bucket is invisible, and invisible is how `library-catalog-2nd`
 * went un-backed-up for months.
 */
export const STORAGE_BUCKETS = [
  { name: 'estate-audio', label: 'Audiobook masters', holds: 'the m4b files GABI transcribes from, plus the archive/ seed', reachable_from: 'audiobook-worker (AUDIO)' },
  { name: 'ebooks-gated', label: 'GABI knowledge packs', holds: 'the packed text GABI answers from; transcripts land here too', reachable_from: 'audiobook-worker (EBOOKS_GATED)' },
  { name: 'estate-ebooks', label: 'Ebook shelf files', holds: 'the epub/pdf files behind the gated shelf', reachable_from: 'audiobook-worker (EBOOKS)' },
  { name: 'estate-backups', label: 'Estate backups', holds: 'every database, bucket and Firestore dump, in dated generations', reachable_from: 'auth-worker (ESTATE_BACKUPS)' },
  { name: 'estate-docs-gated', label: 'Estate documents', holds: 'the docs GABI reads to answer questions about the estate', reachable_from: 'auth-worker (ESTATE_DOCS)' },
  { name: 'audiobook-covers', label: 'Audiobook cover art', holds: 'cover images for the audiobook catalog', reachable_from: 'audiobook_catalog repo' },
  { name: 'library-covers', label: 'Book cover art', holds: 'cover images for the book library', reachable_from: 'library_catalog repo' },
  { name: 'game-covers', label: 'Board game cover art', holds: 'box art for the board game catalog', reachable_from: 'Board_Game_Catalog repo' },
];

/**
 * `"2.94 GB"` -> bytes.
 *
 * ⚠️ THIS PARSES A HUMAN STRING AND THAT IS THE WEAK POINT OF THE WHOLE
 * MODULE, so it is isolated here and tested hard. `wrangler r2 bucket info
 * --json` returns `bucket_size` already formatted to three significant figures
 * ("79.1 GB"), not raw bytes — there is no raw-bytes field to prefer. So:
 *
 *   · the result is an APPROXIMATION to ~3 s.f. and is labelled as one
 *     wherever it is rendered;
 *   · units are DECIMAL (kB = 1000), matching how Cloudflare bills and
 *     displays. Using 1024 here would quietly inflate every figure by 2.4% at
 *     GB scale and make the cost estimate wrong in the same direction;
 *   · anything unparseable returns **null**, never 0. A bucket whose size
 *     could not be read is unknown, and a zero would render as "empty" — which
 *     for a backup bucket is the single most alarming wrong answer available.
 */
export function parseSize(text) {
  if (typeof text !== 'string') return null;
  const m = /^\s*([\d.,]+)\s*([KMGTP]?)B\s*$/i.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = { '': 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 }[m[2].toUpperCase()];
  return mult === undefined ? null : Math.round(n * mult);
}

/** An integer that may arrive as a string (`object_count: "60"`), or null. */
export function parseCount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Monthly storage cost in USD, or null when the size is unknown.
 *
 * ⚠️ STORAGE ONLY, AND THE RENDERER MUST SAY SO. R2 bills storage plus Class A
 * and Class B operations; this estimates the first and cannot see the other
 * two. Presenting it as "the bill" would understate it. Egress is free on R2,
 * which is the reason the estate is on R2 at all, so the omission is smaller
 * than it would be elsewhere — but it is not zero.
 */
export function monthlyCostUsd(bytes) {
  if (!Number.isFinite(bytes)) return null;
  return (bytes / 1e9) * R2_USD_PER_GB_MONTH;
}

/**
 * One `wrangler r2 bucket info --json` payload -> one bucket row.
 * `info` may be null when the call failed — that is a STATE, not a zero.
 */
export function bucketRow(spec, info, error) {
  const bytes = info ? parseSize(info.bucket_size) : null;
  return {
    name: spec.name,
    label: spec.label,
    holds: spec.holds,
    objects: info ? parseCount(info.object_count) : null,
    bytes,
    size_text: info?.bucket_size ?? null,
    cost_usd_month: monthlyCostUsd(bytes),
    created: info?.created ?? null,
    location: info?.location ?? null,
    // ⚠️ Carried so the page can say WHY a bucket it cannot measure is still
    // listed, instead of dropping it and leaving a silent hole.
    reachable_from: spec.reachable_from,
    error: error ? String(error).slice(0, 300) : null,
  };
}

/**
 * The whole section, given a function that fetches one bucket's info.
 *
 * ⚠️ ONE BUCKET FAILING MUST NOT BLANK THE PANEL. Each is caught on its own and
 * renders its own error line, for the same reason every /status section is
 * independent: one unreachable thing should cost one row, not the page.
 */
export async function buildStorageSection(fetchInfo, buckets = STORAGE_BUCKETS, nowIso = new Date().toISOString()) {
  const rows = [];
  for (const spec of buckets) {
    try {
      rows.push(bucketRow(spec, await fetchInfo(spec.name), null));
    } catch (err) {
      rows.push(bucketRow(spec, null, err?.message || err));
    }
  }
  const known = rows.filter((r) => Number.isFinite(r.bytes));
  return {
    buckets: rows,
    // Totals are over the buckets that ANSWERED, and say how many that was —
    // a total presented as complete while three buckets failed is a lie that
    // looks like arithmetic.
    total_bytes: known.length ? known.reduce((a, r) => a + r.bytes, 0) : null,
    total_objects: rows.some((r) => Number.isFinite(r.objects))
      ? rows.reduce((a, r) => a + (Number.isFinite(r.objects) ? r.objects : 0), 0)
      : null,
    total_cost_usd_month: known.length ? monthlyCostUsd(known.reduce((a, r) => a + r.bytes, 0)) : null,
    measured: known.length,
    of: rows.length,
    rate_usd_per_gb_month: R2_USD_PER_GB_MONTH,
    as_of: nowIso,
    note: 'Sizes are Cloudflare’s own rounded figures (~3 significant figures); cost is storage only, not operations.',
  };
}
