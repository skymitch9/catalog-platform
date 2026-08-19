/**
 * Per-bucket PREFIX exclusions for `scripts/backup-r2.mjs`.
 *
 * ## This is a DIFFERENT mechanism from REFUSED_BUCKETS — do not merge them
 *
 * `backup-r2.mjs`'s `REFUSED_BUCKETS` answers *"may this bucket be dumped at
 * all?"* and answers it with **no** (`estate-audio`, ~685 GB, itself the
 * off-site archive). This file answers a narrower question about a bucket that
 * IS backed up and must stay backed up: *"which prefixes inside it are already
 * protected somewhere else, well enough that a ninth nightly copy buys
 * nothing?"*
 *
 * A refusal is all-or-nothing. An exclusion is surgical, and the surgery is the
 * point — `ebooks-gated` holds three unrelated things whose backup arguments
 * differ completely, and the only alternative on the table was to give the
 * transcripts their own bucket (owner decision 2026-08-19, option "a": exclude
 * the prefix, keep the bucket).
 *
 * ## ⚠️ NO SILENT CAPS — the rule this file exists to keep
 *
 * Every run LOGS every rule that is in force, including rules that matched
 * ZERO objects, and every dump WRITES the same statement into its own
 * `manifest.json` as an `excluded` array. Two consequences, both deliberate:
 *
 *   1. A backup that quietly stopped covering something is impossible to
 *      mistake for a backup that covers everything — the log says what was
 *      left out, how much of it there was, and why.
 *   2. A rule that stops matching (someone renames `transcripts/` to
 *      `transcript/`) shows up as `0 object(s)` next to a prefix that used to
 *      have thousands, rather than as nothing at all.
 *
 * ## ⚠️ AND NO EMPTY DUMPS — an exclusion may never swallow a whole bucket
 *
 * `backup-r2.mjs` treats "listed 0 objects" as a failed backup rather than an
 * empty bucket. An exclusion that removed every object would sail past that
 * check with a cheerful "0 objects backed up", which is the same lie one
 * layer down. The caller therefore fails when a non-empty listing is reduced
 * to nothing; see `applyExclusions()`'s callers in `backup-r2.mjs`.
 */

/**
 * `bucket -> [{ prefix, reason }]`.
 *
 * ⚠️ **Adding an entry here removes data from every future backup.** The bar is
 * an owner decision plus a written answer to *"where does this come back from
 * in a disaster?"* recorded in `docs/access/backup-restore.md` and
 * `docs/access/RECOVERY.md`, because a restore from these dumps will NOT
 * contain it. `apps/auth-worker/test/backups.test.ts` pins each entry's
 * existence and its reason string so neither can be deleted, weakened, or
 * "fixed" into a whole-bucket refusal by a later session that only sees a size
 * problem.
 */
export const EXCLUDED_PREFIXES = {
  'ebooks-gated': [
    {
      prefix: 'transcripts/',
      // ⚠️ This string is asserted on by the pinning test. If it is reworded,
      // reword the test in the same commit — never delete either.
      reason:
        'transcripts/ excluded by owner decision 2026-08-19 — triple-copied elsewhere; ' +
        'see backup-restore.md',
      /**
       * The long form, for the run log and for anyone reading the manifest.
       *
       * MEASURED 2026-08-18: 16 transcripts, 38.7 MB stored (195.30 MB raw),
       * on a corpus heading for ~13 GB raw / **~2.6 GB stored** at the measured
       * 5× compression ratio. This job tars a WHOLE bucket onto a runner with
       * 14 GB of disk and keeps 8 generations of the result — the same mechanic
       * the `estate-audio` refusal is written about, arriving by a slower road.
       *
       * ⚠️ THE DECIDING FACT IS NOT THE SIZE, IT IS THE COPY COUNT. A
       * transcript already exists in THREE places before this job runs: the
       * owner's disk (where Whisper wrote it), the Google Drive mirror of that
       * disk, and `ebooks-gated/transcripts/` itself — which was CREATED as the
       * third copy (`audiobook_catalog/app/core/ingest_transcripts.py`, the
       * owner's *"we lose this data we lose it all"*). Backing the third copy
       * up nightly, eight generations deep, is backups-of-backups; it is the
       * `estate-audio` argument applied to a prefix instead of a bucket.
       *
       * ⚠️ WHAT KEEPS FULL NIGHTLY COVER, and why the bucket is NOT refused:
       * the gate manifests (`ebooks.json`, `audio_manifest.json`) and the GABI
       * chunk packs under `text/` have no other estate-side copy — their
       * publishers run on the owner's machine — so they are exactly the case
       * this backup exists for.
       */
      detail:
        'already the THIRD copy (owner disk -> Google Drive mirror -> this prefix), ' +
        'heading for ~2.6 GB stored per generation x 8 generations on a 14 GB runner. ' +
        'text/ packs and the gate manifests KEEP full nightly cover — they have no other copy.',
    },
  ],
};

/** The rules in force for one bucket (never null). */
export function exclusionsFor(bucket) {
  return EXCLUDED_PREFIXES[bucket] ?? [];
}

/**
 * Split a bucket listing into what will be backed up and what will not.
 *
 * ⚠️ Returns a `skipped` entry for EVERY rule, matched or not — a rule that
 * matched nothing is information (see the header), not something to omit.
 *
 * @param {string} bucket
 * @param {{key: string, size?: number}[]} objects the full listing
 * @returns {{
 *   kept: {key: string, size?: number}[],
 *   skipped: {prefix: string, reason: string, detail?: string, count: number, bytes: number}[],
 * }}
 */
export function applyExclusions(bucket, objects) {
  const rules = exclusionsFor(bucket);
  if (rules.length === 0) return { kept: objects, skipped: [] };

  const skipped = rules.map((r) => ({ ...r, count: 0, bytes: 0 }));
  const kept = [];
  for (const obj of objects) {
    const hit = skipped.find((r) => obj.key.startsWith(r.prefix));
    if (hit) {
      hit.count += 1;
      hit.bytes += obj.size ?? 0;
    } else {
      kept.push(obj);
    }
  }
  return { kept, skipped };
}

/**
 * The lines a run prints, and the same words the manifest carries. One line per
 * rule, always, so `grep -c 'excluded by owner decision'` over a run log is a
 * real answer to "what did tonight's backup deliberately leave out?".
 *
 * @param {string} bucket
 * @param {{prefix: string, reason: string, detail?: string, count: number, bytes: number}[]} skipped
 * @returns {string[]}
 */
export function exclusionLogLines(bucket, skipped) {
  return skipped.map(
    (s) =>
      `${bucket}: SKIPPING prefix "${s.prefix}" — ${s.count} object(s), ${s.bytes} bytes NOT backed up. ` +
      `${s.reason}${s.detail ? ` (${s.detail})` : ''}`,
  );
}
