/**
 * Backup key grammar — what counts as ONE generation in `estate-backups`.
 *
 * ## Why this exists — MEASURED 2026-08-18, on a real failed backup
 *
 * Every backup object is `<kind>/<store>/<UTC-STAMP><suffix>`, and until
 * 2026-08-18 one object was always one generation, so "keep the newest 8
 * generations" and "keep the newest 8 keys" were the same sentence.
 *
 * Then `audiobook-covers` outgrew the uploader. Run 32112007920: the bucket
 * dump tarred to **328,774,189 bytes (313.5 MiB)** and
 * `wrangler r2 object put` refused it —
 *
 *     Error: Wrangler only supports uploading files up to 300 MiB in size
 *
 * — a hard ceiling (300 MiB = 314,572,800 bytes), not a blip. There is no way
 * round it with the credentials this estate has: the plain Cloudflare REST
 * `PUT .../objects/{key}` carries the same limit, and multipart upload needs
 * S3-compatible access keys that deliberately do not exist here
 * (`backup-r2.mjs`'s header explains why). ⚠️ `game-covers` was measured at
 * 178,897,690 bytes (170.6 MiB) the same day and is growing — it is 57% of the
 * way to the same wall, so this is not a one-bucket problem.
 *
 * So an oversized dump is now SPLIT into `<STAMP>.tar.gz.part-aa`,
 * `.part-ab`, … and **one generation becomes several keys.** Retention and the
 * status API must both count generations, or 8 "keys" becomes one night's
 * parts and every older backup is deleted.
 *
 * ⚠️ A partial generation is still WRONG, just not silently so: if some parts
 * of a generation are missing the archive cannot be reassembled. Retention
 * deletes whole generations together precisely so a surviving generation is
 * always complete.
 */

/**
 * The generation stamp a key belongs to — everything up to the first `.` of
 * the basename.
 *
 *   d1/estate_auth/20260818T072356Z.sql              -> 20260818T072356Z
 *   r2/game-covers/20260818T072355Z.tar.gz           -> 20260818T072355Z
 *   r2/audiobook-covers/20260818T073345Z.tar.gz.part-aa -> 20260818T073345Z
 *
 * Because the stamps are `YYYYMMDDTHHMMSSZ` with no separators but `T`/`Z`,
 * they sort lexicographically exactly as they sort chronologically — the same
 * property the old key-sort relied on, now applied one level up.
 */
export function generationOf(key) {
  const base = key.slice(key.lastIndexOf('/') + 1);
  const dot = base.indexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}

/**
 * Group keys into generations, newest generation first.
 *
 * @param {{key: string}[]} objects
 * @returns {{stamp: string, objects: {key: string}[]}[]}
 */
export function groupByGeneration(objects) {
  const byStamp = new Map();
  for (const o of objects) {
    const stamp = generationOf(o.key);
    const list = byStamp.get(stamp);
    if (list) list.push(o);
    else byStamp.set(stamp, [o]);
  }
  return [...byStamp.entries()]
    .map(([stamp, objs]) => ({
      stamp,
      // Parts in order, so a caller can `cat` them without re-sorting.
      objects: [...objs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    }))
    .sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
}

/**
 * THE RETENTION DECISION ITSELF — "given this listing, which generations stay
 * and which go?" — and the ONE implementation of it in the estate.
 *
 * ⚠️ WHY IT IS ITS OWN FUNCTION, in a file both a Node script and a Worker
 * import. Until 2026-09-05 the decision lived inline in
 * `scripts/prune-r2-backups.mjs` (three lines: group, `slice(0, KEEP)`,
 * `slice(KEEP)`) and there was exactly one caller, so a function bought
 * nothing. The retention cron in `apps/auth-worker/src/r2-prune.ts` is the
 * second caller, and the estate's standing rule about second callers is
 * unambiguous — `docs/info/scripts-inventory-2026-09-05.md` §6: *"A route and
 * its script share ONE implementation in `packages/core`, or the conversion has
 * made the estate worse"*, written from three wrong-game matches the games
 * catalog shipped when a similarity function was copied instead of shared.
 * A retention rule that drifts does not mismatch a game; it deletes a backup.
 *
 * ⚠️ PURE, AND IT MUST STAY PURE: no network, no `fetch`, no bucket, no
 * `process`, no clock. It takes a listing and returns a plan. That is what lets
 * the same function run under `node --test` (`scripts/test/backup-keys.test.mjs`)
 * and inside a Worker isolate with no adapter between them, and it is what makes
 * the shadow gate meaningful — the script's `--dry-run` and the Worker's
 * `dryRun=1` are the SAME arithmetic over the same listing, so a divergence can
 * only be the listing, never the rule.
 *
 * @param {{key: string}[]} objects every object under one `<kind>/<store>/` prefix
 * @param {number} keep how many GENERATIONS to keep (never objects — see above)
 * @returns {{keep: {stamp: string, objects: {key: string}[]}[],
 *            drop: {stamp: string, objects: {key: string}[]}[],
 *            dropKeys: string[], generations: number, objects: number}}
 */
export function planRetention(objects, keep) {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`planRetention: keep must be a positive integer, got ${keep}`);
  }
  // ⚠️ GENERATIONS, not keys. An oversized bucket dump is split into
  // `<STAMP>.tar.gz.part-aa`, `.part-ab`, … so one generation can be several
  // objects — counting keys would make 8 "generations" into one night's parts
  // and delete every real backup behind it. `groupByGeneration` returns newest
  // first and keeps each generation's parts together, so a whole generation is
  // always kept or always deleted; a half-deleted generation cannot be
  // reassembled and must never exist.
  const generations = groupByGeneration(objects);
  const kept = generations.slice(0, keep);
  const drop = generations.slice(keep);
  return {
    keep: kept,
    drop,
    // Flattened, in the order they would be deleted — this array IS what the
    // shadow gate compares between the script and the Worker.
    dropKeys: drop.flatMap((g) => g.objects.map((o) => o.key)),
    generations: generations.length,
    objects: objects.length,
  };
}

/**
 * The `<kind>/<store>` prefixes the backup system actually covers, read out of
 * `.github/workflows/backup.yml`'s retention invocation.
 *
 * ⚠️ WHY PARSED AND NOT COPIED. This list already exists in three places
 * (backup.yml's job matrices, backup.yml's prune arguments, and
 * `apps/auth-worker/src/backups.ts`'s `KNOWN_BACKUP_PREFIXES`), and the restore
 * drill found `library-catalog-2nd` missing from all three at once despite a
 * header telling every reader to keep them together. `backups.test.ts` promoted
 * that advice to a mechanical guard by PARSING this same invocation; a fourth
 * hand-maintained copy for the mirror would reintroduce exactly the drift that
 * guard exists to kill. So the mirror derives its expected set instead of
 * declaring one, and a store added to backup.yml is mirrored the same night
 * with no second edit.
 *
 * The parse is deliberately identical in shape to `backups.test.ts`'s: find the
 * `node scripts/prune-r2-backups.mjs … --keep N` invocation, unfold its shell
 * line continuations, and keep the tokens containing a `/`.
 *
 * @param {string} ymlText contents of `.github/workflows/backup.yml`
 * @returns {{prefixes: string[], keep: number}}
 */
export function readWorkflowPrefixes(ymlText) {
  const invocation = ymlText.match(/node scripts\/prune-r2-backups\.mjs([\s\S]*?)--keep\s+(\d+)/);
  if (!invocation) {
    throw new Error(
      'Could not find the prune-r2-backups.mjs invocation in backup.yml. ' +
        'The mirror derives the store list from it rather than keeping a fourth copy — ' +
        'see this function’s header.',
    );
  }
  const prefixes = invocation[1]
    .replace(/\\\s*\n/g, ' ')
    .split(/\s+/)
    .filter((t) => t.includes('/'));
  if (prefixes.length === 0) {
    throw new Error('backup.yml’s retention invocation parsed to zero prefixes — refusing to mirror nothing.');
  }
  return { prefixes, keep: Number(invocation[2]) };
}
