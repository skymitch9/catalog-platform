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
