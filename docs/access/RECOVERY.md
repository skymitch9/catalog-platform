# Estate Recovery — the 3am runbook

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (public repo
> — env var / secret NAMES only, never values; no member emails).
> **Last verified: 2026-08-18** (second pass — §3c-drill, §4.3a, §7a, §11, §12).
>
> **Every command in §§1–10 was executed in a SANDBOX on the drill date.**
> Drill date: **2026-08-17/18** (restore drill, `target=all` snapshot of
> `20260816T0849xxZ`). Nothing in the drill wrote to a production database,
> bucket, Worker or Firestore collection — every restore landed in a local
> throwaway (`node:sqlite` files and `wrangler --local` miniflare state).
> Production was READ only (row counts, bucket info, one object per bucket).
>
> ⚠️ **THE 2026-08-18 SECOND PASS BROKE THAT SANDBOX RULE ON PURPOSE, ONCE,
> WITH THE OWNER'S APPROVAL** — §3c-drill created a real remote D1
> (`estate-auth-restore-drill`), imported into it, and deleted it. **No
> pre-existing store was written.** It also created a new Firebase project
> (`estate-restore-drill`, §4.3a) which is deliberately kept. Everything else
> below is unchanged and still sandbox-only.
>
> **This file is the "what do I actually type" companion to
> [`backup-restore.md`](backup-restore.md)**, which explains what is protected
> and why. Read this one first in an incident; read that one when deciding
> what to change about the backup system.
>
> ⚠️ **STALENESS:** every "verified" claim here has the drill date above. If
> that date is more than a few weeks old, the commands are probably still
> right and the COUNTS certainly are not. Re-run the drill rather than trusting
> the numbers.
>
> ---
>
> ## ⚠️ SEVEN OF THE TEN RECOMMENDATIONS WERE IMPLEMENTED ON 2026-08-18
>
> This file is a record of the DRILL, and the drill changed nothing by
> charter. A follow-up (commit `8c7f780`) implemented the mechanical half.
> **Every measurement below still stands as taken** — what changed is the
> system it was measuring. §9 carries the per-recommendation status; the
> short version:
>
> | | Recommendation | Status |
> |---|---|---|
> | 1 | `library-catalog-2nd` into the backup set | ✅ **done** — plus a test so the three lists cannot drift again |
> | 2 | `restore-firestore.mjs` timestamp reviver | ✅ **done** — proven offline, §4.2 |
> | 3 | Ship `reorder-d1-dump.mjs` in the restore path | ✅ **done** — mandatory step, with a replay test |
> | 4 | Give `backup.yml` a cadence | ✅ **done** — daily 09:12 UTC, cost measured at zero billable minutes |
> | 5 | One throwaway remote-import drill | ✅ **DRILLED 2026-08-18** — a real remote D1 was created, imported, count-verified and deleted (§3c) |
> | 6 | A second Firebase project to rehearse restores | 🟡 **STOOD UP 2026-08-18** — `estate-restore-drill` exists with a Firestore database; the `--commit` run needs one owner step (§4.3) |
> | 7 | A copy of `estate-backups` off Cloudflare | ✅ **done 2026-08-18** — three homes, none of them Cloudflare (§2a) |
> | 8 | A `FIREBASE_SERVICE_ACCOUNT_JSON` an incident can reach | ✅ **CLOSED 2026-08-18** — the credential is on this machine and was PROVEN to authenticate today (§7) |
> | 9 | `ebooks-gated` / `estate-docs-gated` / `estate-ebooks` into the `r2` matrix | ✅ **first two done**; `estate-ebooks` deliberately declined, reasoning recorded in `backup.yml` beside the matrix |
> | 10 | The empty stores, the day they hold data | ✅ **recorded** as a standing rule in `backup.yml` and `backup-restore.md` §8 |
>
> ⚠️ **ALL THREE REMAINING ROWS WERE WORKED 2026-08-18 (second pass).** Rows 5
> and 8 are now **closed by measurement**, not by argument; row 6 is stood up
> and one owner step short of closed. **Exactly ONE owner step remains in this
> file** — download a service-account key for the `estate-restore-drill`
> project (§4.3), which is a console click. Everything else is done.
>
> ⚠️ Row 8's old warning — *"a Firestore restore is BLOCKED from this
> machine"* — **was wrong when it was written and is corrected in §7.** The
> credential was on the machine the whole time.

---

## 0. The 60-second version

1. **D1 lost/corrupted →** try **Time Travel** first (`wrangler d1 time-travel
   restore`, §3a). It is in-place, needs no file, and is the right tool for
   "undo what just happened". Write down the bookmark it prints.
2. **Time Travel window passed →** fetch the `.sql` from `estate-backups`,
   **reorder it** (§3b — ⚠️ the raw export does NOT replay), import into a
   FRESH database, then `wrangler d1 migrations apply` to catch the schema up.
3. **Firestore →** fetch + unpack the tarball, dry-run
   `restore-firestore.mjs` (it revives timestamps itself as of 2026-08-18 —
   §4.2; the dry run prints how many it will convert), then
   `--only <collection> --commit`. ✅ **The credential is ON THIS MACHINE**
   (§7a — two working copies, both gitignored); an older version of this file
   wrongly said it was not.
4. **A cover is gone →** unpack the bucket tarball, `wrangler r2 object put`
   the one key back (§5).
5. **Before restoring `estate_auth`, read §3d.** A blind restore silently
   re-approves revoked members. `reorder-d1-dump.mjs` now prints the backup's
   membership counts and exits 3 until you acknowledge — do not paste past it.
6. **Backups run themselves now** — daily 09:12 UTC. If the newest object is
   more than ~a day old, something is wrong; check Actions for a
   *disabled scheduled workflow* banner first (`backup-restore.md` §3.0).
7. **⚠️ Cloudflare itself is down/gone, or you just want to BROWSE the
   backups → §2a, the mirror.** The same files are on this PC at
   `C:\Users\nbasl\OneDrive\Documents\estate-backups-mirror\`, in OneDrive,
   and in Google Drive `/GABI_backup`. Every recipe below works unchanged —
   you skip the fetch and use the local file. It is also the only way to
   *list* the backups; the bucket cannot be browsed.

---

## 1. What exists, measured on the drill date

Live account inventory taken with `wrangler d1 list` / `r2 bucket list` /
`kv namespace list` on 2026-08-18 — this is the ground truth the backup
matrices are compared against, not a copy of what `backup.yml` says it covers.

### 1a. The eight stores that ARE backed up **(eleven since 2026-08-18)**

⚠️ This table is the drill's, so it lists the eight that existed then. Three
more joined `backup.yml` on 2026-08-18 and are **NOT** in it, having never been
through a drill: D1 `library-catalog-2nd`, R2 `ebooks-gated`, R2
`estate-docs-gated`. Their restore paths are the same as their siblings' (a D1
`.sql` and two bucket tarballs), which is an inference from an identical
mechanism, **not a measurement** — the next drill should exercise them.

| Store | Backed up? | Restored OK in drill? | Snapshot age at drill | Time to restore |
|---|---|---|---|---|
| D1 `estate_auth` | yes | **yes** | ~1.9 d | fetch 2.7 s + import 3.7 s + migrate 4.9 s |
| D1 `library-catalog` | yes | **only after reordering** (§3b) | ~1.9 d | fetch 2.7 s + reorder 2 s + import **60 s** |
| D1 `board-game-catalog` | yes | **only after reordering** (§3b) | ~1.9 d | fetch 2.7 s + reorder 3 s + import **94 s** |
| D1 `index_catalog` | yes | yes (replays as-is) | ~1.9 d | fetch 2.8 s + import 37 s |
| Firestore `audiobook-catalog` | yes | **structurally yes, semantically NO** (§4.2 timestamps) | ~1.9 d | fetch 2.7 s + unpack 0.1 s |
| R2 `library-covers` | yes | yes (bytes verified vs live) | ~1.9 d | fetch 3.0 s + unpack 0.3 s |
| R2 `game-covers` | yes | yes (bytes verified vs live) | ~1.9 d | fetch 6.3 s + unpack 1.4 s |
| R2 `audiobook-covers` | yes | yes (bytes verified vs live) | ~1.9 d | fetch 6.9 s + unpack 2.5 s |

Import times are `wrangler d1 execute --local`; `node:sqlite` replays the same
files 5–8× faster (estate_auth 0.05 s, library 8.1 s, index 5.1 s, bgc 11.9 s)
and is the better tool when you only need to *read* a backup.

### 1b. ⚠️ Live stores with NO backup at all — **as measured on the drill**

Ranked by blast radius. These are not "stale" — no copy exists anywhere.

> ⚠️ **THIS TABLE IS THE DRILL'S READING, NOT TODAY'S STATE.** Since
> 2026-08-18, rows **1**, **5** and **6** are backed up (`library-catalog-2nd`,
> `ebooks-gated`, `estate-docs-gated` joined `backup.yml`), and rows **2**/**3**
> are captured automatically the moment they hold a document — the Firestore
> dump was measured to be `listCollections()` **discovery**, not a stale
> explicit list, so nothing had to change for them. What DID change is that an
> expected-but-absent collection now warns instead of vanishing silently.
> Row **10** is answered in §9 below (young system, not a prune bug). Rows
> **4**, **7**, **8**, **9** stand as written. The table is left intact because
> it is the measurement; the status is here.

| # | Store | What is in it (measured 2026-08-18) | Why it hurts |
|---|---|---|---|
| 1 | **D1 `library-catalog-2nd`** (`9dcf4af9-…`) | A live second library instance (the `padhard.heygabi.ai` shelf): 6 works, 6 editions, 6 copies, 6 `user_book` rows, 3 `app_user` rows, 34 `change_log` rows, 32 migrations | Same "user-entered catalog data with no other copy" argument that makes `library-catalog` High priority. It is simply absent from `backup.yml`'s matrix, `prune-r2-backups.mjs`'s prefix list and `backups.ts`'s `KNOWN_BACKUP_PREFIXES` |
| 2 | **Firestore `discord_links`** | Created 2026-08-17 (first write lands in `apps/discord-worker/src/link.ts`, commit `7ae9137`) — **after** the newest backup (2026-08-16T08:49Z) | Each doc is a proven Discord↔Firebase identity binding. Losing it un-links every member; each has to redo the link ceremony |
| 3 | **Firestore `readingPositions`** | **Absent from the 2026-08-16 dump's 56 collections.** Either it had no documents at snapshot time or it was created after | Everyone's place in every book. Not reconstructible from anything |
| 4 | **R2 `estate-ebooks`** | 168 objects, 1.81 GB — the ebook files | A local master exists (`audiobook_catalog/scripts/upload_ebooks_r2.py` re-uploads from disk), so this is recoverable, not lost — but only while that machine's disk survives |
| 5 | **R2 `ebooks-gated`** | 2 objects, 107 kB — `ebooks.json` and `audio_manifest.json`, the two gated manifests | Republished by the pipeline (`publish_ebooks_manifest.py`, sync step 5.8), so recoverable — but until it runs, the gate has nothing to read |
| 6 | **R2 `estate-docs-gated`** | 2 objects, 1.27 MB — the searchable docs corpus, bucket created 2026-08-18 | Rebuilt by the publisher from the three docs trees; ⚠️ that publisher runs on the owner's machine and is the only place all three trees exist together |
| 7 | **KV `estate_docs`** (`3278d5e3…`) | **0 keys today** (`wrangler kv key list` → `[]`) | Nothing to lose right now; it is a declared store with no backup path, so it becomes a hole the day it is used |
| 8 | **R2 `estate-audio`** | ⚠️ **Rewritten 2026-08-18 — no longer empty.** It now holds the **disaster-recovery ARCHIVE of the whole audiobook library**: 1,260 objects / ~685 GB under the `archive/` prefix, seeded by `audiobook_catalog/scripts/archive_audio_r2.py` (hourly task `AudiobookArchiveR2`) on the owner's order — *"we lose this data we lose it all and the server isnt ready yet"* | 🔴 **NOT a hole, and NOT a candidate for `backup.yml`.** This bucket *is* the off-site copy; its master is the owner's local disk. Backing it up would be a backup of a backup at 685 GB × 8 generations onto a 14 GB runner — an outage, not a backup. `scripts/backup-r2.mjs` now REFUSES it mechanically (`REFUSED_BUCKETS`, env escape hatch only). ⚠️ The `archive/` prefix must never be evicted or lifecycle-expired; the audio player's eviction pass refuses it in code. See `audiobook_catalog/docs/access/AUDIO_ARCHIVE.md` |
| 9 | **R2 `library-2nd-covers`**, **R2 `bgc-photos`** | 0 objects each | Nothing to lose today; both belong in the matrix the day they hold anything |
| 10 | **R2 `estate-backups` itself** | 16 objects, 917 MB — 8 stores × **2** generations | Single-copy, single-region, single-account. Retention is configured for 8 but only two `target=all` runs have ever landed, so "8 deep" is a setting, not a fact. ✅ **The 8-vs-2 question is answered — young system, not a prune bug** (§9, and `backup-restore.md` §3's retention note). ✅ **The single-copy half is closed too, 2026-08-18** — the mirror (§2a) puts every generation on the owner's PC, in OneDrive and in Google Drive `/GABI_backup`. Single-*region* and single-*account* are no longer true of the bytes, only of the bucket |

**Not a hole, confirmed:** the four git repos (distributed by git), and the
OpenAudible `.m4b` library (Google Drive sync, `sync_to_drive.py`). Both are
argued in `backup-restore.md` §8 and nothing in this drill contradicts them.

### 1c. Drift measured between the newest backup and live

Snapshot `20260816T0849xxZ` vs live reads on 2026-08-18. This is what a
restore of the newest backup would COST you, today.

| Store | Backup | Live | Delta |
|---|---|---|---|
| `estate_auth` migrations | 5 | **11** | 6 migrations, 4 columns on `estate_user` |
| `estate_auth` `estate_user` | 12 | 12 | ⚠️ same count, **different truth** — see §3d |
| `estate_auth` `estate_session` | 0 | 11 | all sessions |
| `estate_auth` `site_role_grant_log` | 0 | 14 | the whole grant audit trail |
| `library-catalog` migrations | 26 | **31** | 5 migrations (`ebook_holding`, `gabi_conversation`, `gabi_turn` did not exist yet) |
| `library-catalog` `work` / `edition` / `copy` | 351 / 394 / 272 | 435 / 471 / 366 | +84 / +77 / +94 |
| `library-catalog` `change_log` | 522 | 991 | +469 |
| `library-catalog` `research_finding` | 814 | 1059 | +245 |
| `library-catalog` `ebook_holding` | (table absent) | 126 | whole table |
| `board-game-catalog` (item/edition/copy/component/cover_check/app_user) | 837/1067/838/1454/1012/4 | identical | **no drift** |
| `index_catalog` `entry` | 2266 | 2518 | +252 (rebuildable, §6) |
| R2 `library-covers` | 208 | 208 | none |
| R2 `game-covers` | 1124 | 1125 | +1 |
| R2 `audiobook-covers` | 1869 | **1972** | +103 |

**`backup.yml` had no cron** — it was `workflow_dispatch` only. Every number in
this table is the cost of "nobody pressed the button since 2026-08-16", and it
is exactly the evidence that bought the cadence: **as of 2026-08-18 the
workflow runs daily at 09:12 UTC**, which bounds every figure above at one day.
`backup-restore.md` §3.0 has the hour, the measured cost (zero billable
minutes — public repo) and how to revert it.

---

## 2. Getting a backup file out of `estate-backups`

The bucket is private, and `wrangler r2 object` has **no `list`** (still true
at wrangler 4.123.0). So you cannot browse it. Two ways to learn the exact key:

**A. From the workflow log (works with just `gh`, no Cloudflare token) —
the one the drill used:**

```bash
gh run list --repo skymitch9/catalog-platform --workflow=backup.yml --limit 5
gh run view <run-id> --repo skymitch9/catalog-platform --log \
  | grep "Wrote estate-backups"
```

Each `::notice::Wrote estate-backups/<kind>/<store>/<STAMP>.<ext>` line is a
literal, copy-pasteable key.

**B. From the live estate worker** — `GET https://auth.heygabi.ai/api/estate/backups`
(needs a devops/approver/owner Firebase token). Returns newest timestamp +
count per prefix, deliberately NOT the keys. Good for "is the backup fresh",
useless for "give me the file".

**Then fetch it.** `--remote` is required; without it wrangler silently reads
an empty local simulator.

> ⚠️ **BEFORE YOU FETCH ANYTHING — CHECK THE MIRROR FIRST (§2a).** If the
> incident is "Cloudflare is unreachable / the account is gone", none of the
> commands below will work at all, and the files are already on this PC.

```bash
npx wrangler r2 object get "estate-backups/d1/library-catalog/<STAMP>.sql" \
  --file ./library-catalog.sql --remote
npx wrangler r2 object get "estate-backups/firestore/audiobook-catalog/<STAMP>.tar.gz" \
  --file ./firestore.tar.gz --remote
npx wrangler r2 object get "estate-backups/r2/library-covers/<STAMP>.tar.gz" \
  --file ./library-covers.tar.gz --remote
```

**Credentials the fetch needs:** an interactive `wrangler login` OAuth session
is enough (that is all the drill had). ⚠️ An OAuth session is **not** enough
for `scripts/backup-r2.mjs` / `prune-r2-backups.mjs`, which use the plain
Cloudflare REST list endpoint — that path needs the API token
(`CLOUDFLARE_API_TOKEN`, held as a repo secret; see `backup-restore.md` §1 for
the permission-group nuance). Restoring never needs the REST list; only
backing up does.

---

## 2a. ⚠️ THE MIRROR — the backups that are NOT in Cloudflare

**Built and populated 2026-08-18.** This closes owner step #7 (§9.7): until
that date, everything the estate protected *and* everything protecting it lived
in one Cloudflare account, so an account-level incident took the backups with
it. It no longer does.

Owner decision 2026-08-18, verbatim: *"Do a and b, don't store in GABI tho
store in a new folder called GABI_backup on drive"*.

### Where the copies are

| Home | Location | How it gets there |
|---|---|---|
| **This PC** | `C:\Users\nbasl\OneDrive\Documents\estate-backups-mirror\` | `scripts/mirror-estate-backups.mjs` (this repo), run by the pipeline |
| **OneDrive** | the same folder — it is inside the synced tree | Microsoft's client. **No code of ours**, which is why it costs nothing |
| **Google Drive** | `/GABI_backup` (My Drive **root**, top level) | `audiobook_catalog/scripts/mirror_to_drive.py` |

**Three homes, none of them Cloudflare.** The layout under each root is the
bucket's own key grammar — `<kind>/<store>/<STAMP><suffix>` — so a mirrored
file *is* the object, byte for byte, under the name you would have fetched.

### Restoring from the mirror

**Every recipe in this file works unchanged; you simply skip the fetch.**
Wherever §3–§5 say

```bash
npx wrangler r2 object get "estate-backups/<key>" --file ./x --remote
```

use the local file instead:

```bash
cp "C:/Users/nbasl/OneDrive/Documents/estate-backups-mirror/<key>" ./x
```

⚠️ **Split archives still need reassembling** (§5) — the mirror stores the
parts exactly as the bucket does, and holds them together or not at all:

```bash
cat "C:/Users/nbasl/OneDrive/Documents/estate-backups-mirror/r2/audiobook-covers/<STAMP>.tar.gz.part-"* > ./r2-dump.tar.gz
```

**And you can browse it, which you cannot do to the bucket.** `wrangler r2
object` has no `list`, so §2 exists purely to work out a key; on the mirror,
`ls` answers that question. `mirror-manifest.json` at the root records every
key with its byte size and **sha256** — that is the file to diff against when
you need to prove a restored artefact is the backed-up one.

### ⚠️ Retention: the mirror FOLLOWS the bucket. It is not an archive.

Both halves keep the newest **N generations** per store and delete the rest,
whole generations at a time (a half-split archive cannot be untarred at all).
**N is read out of `backup.yml`'s own `--keep` argument** — 8 today — so the
mirror's depth cannot drift from the bucket's.

**A generation pruned upstream ages out of the mirror on the next run.**
Anything inside either mirror root is subject to deletion by these scripts. If
you want a copy that outlives the bucket's 8-generation retention — before a
risky migration, say — take one by hand and put it somewhere neither script
manages. The Drive half **trashes** rather than hard-deletes, so a retention
bug there has 30 days of recovery; the local half does not.

### ⚠️ What the mirror can and cannot see

It reads the keys off the **backup workflow's log** (§2 method A), not off a
bucket listing. `wrangler r2 object` has no `list`, and the REST list endpoint
needs `CLOUDFLARE_API_TOKEN`, which is a GitHub repo secret and **is not on
this machine** (§7). Every `::notice::Wrote estate-backups/<key>` line is a
literal key, and `<base> was written as N part(s).` is what makes "is this
generation COMPLETE?" decidable — a split archive missing a part is skipped
rather than mirrored, because run 32111218016 and run 32112007920 each produced
exactly that shape and an unrestorable mirror reporting success is the worst
available outcome.

**Consequence, stated plainly: the mirror sees what the workflow LOGGED, not
what the bucket HOLDS.** An object deleted out of band would not be noticed.
The day a `CLOUDFLARE_API_TOKEN` lands on this machine, swapping discovery for
a real listing is a small edit.

### When it runs, and how to run it by hand

It is **STEP 10 of `audiobook_catalog/scripts/sync_to_drive.py`**, on both the
busy and the idle path — the backup workflow runs daily at 09:12 UTC whether or
not the audiobook library gained a book, so a busy-path-only mirror would track
the backups as often as the owner buys audiobooks. Each half is its own failure
domain: a WARN, the previously mirrored generation stands, the next cycle
retries. It can never fail the pipeline.

⚠️ **It deliberately does NOT run in `backup.yml`.** A mirror running inside
the same CI, on the same account's credentials, is not an off-Cloudflare copy —
it is the same egg in the same basket with an extra step.

```bash
# half 1 — bucket -> local (from catalog-platform)
node scripts/mirror-estate-backups.mjs --dry-run     # plan, writes nothing
node scripts/mirror-estate-backups.mjs

# half 2 — local -> Drive (from audiobook_catalog)
python scripts/mirror_to_drive.py --dry-run
python scripts/mirror_to_drive.py
```

### First full run — measured 2026-08-18

| | |
|---|---|
| Stores mirrored | **11 / 11** (every prefix `backup.yml` writes) |
| Objects | **12** (audiobook-covers is 2 parts) |
| Bytes | **539,573,402** (514.6 MiB), identical on both mirrors |
| Generation | `20260818T0948xxZ`, from run `32123529431` — the first scheduled daily backup |
| Discovery cost | **one** workflow-log read; the newest run satisfied all 11 stores |
| Integrity, local | `d1/estate_auth/20260818T094855Z.sql` re-fetched from the live bucket and SHA-256'd: `dd558909…a10f9b` — **live bucket = mirror = manifest, three-way match** |
| Integrity, Drive | **all 12 objects**, Drive's server-computed `md5Checksum` vs a local MD5, on the second run — 12/12 verified. Not a spot-check: every object |
| Idempotency | second run of each half: **0 fetched / 12 skipped**, **0 uploaded / 12 skipped** |

⚠️ **NOT verified:** a restore performed *from* the mirror (the mirrored bytes
are proven identical to the bucket's, so a restore from them is the same
operation on the same bytes — but that is an inference from a byte comparison,
not an exercised restore). Nor has retention been observed deleting anything:
the mirror holds one generation, and the first prune cannot happen until nine
daily backups have accumulated.

---

## 3. D1

### 3a. Time Travel — try this first

```bash
npx wrangler d1 time-travel info    <database-id>
npx wrangler d1 time-travel info    <database-id> --timestamp="2026-08-17T12:00:00Z"
npx wrangler d1 time-travel restore <database-id> --timestamp=<ISO-or-unix>
```

⚠️ Destructive and in-place. **The command prints the prior bookmark — write it
down**; it is the only undo. Window is 30 days on Workers Paid / 7 on Free
(the account's plan tier is **NOT verified** by this drill).

### 3b. ⚠️ THE EXPORT DOES NOT REPLAY AS-IS — reorder it first

**Measured 2026-08-17, in two independent SQLite engines, on the newest
snapshot of every database:**

| Dump | `wrangler d1 execute --local --file=` | `node:sqlite` `exec()` |
|---|---|---|
| `estate_auth` | ok | ok |
| `index_catalog` | ok | ok |
| `library-catalog` | **FAILS** — `no such table: main.edition` | **FAILS** — `no such table: main.edition` |
| `board-game-catalog` | **FAILS** — `no such table: main.app_user` | **FAILS** — `FOREIGN KEY constraint failed` |

**Why.** `wrangler d1 export` interleaves `CREATE TABLE` and `INSERT` in table
order, and that order is not dependency order. When rows are inserted into a
table whose `FOREIGN KEY` points at a table the dump has not created yet,
SQLite raises `no such table` (or a plain FK violation) and the import dies
**partway through, leaving a half-populated database that looks like it
imported**. On the drill's library-catalog dump it stopped after 5 of 27
tables; on board-game-catalog after 2 of 18.

⚠️ **`PRAGMA foreign_keys=OFF` does NOT fix this through wrangler** — prepending
it was tried and both dumps failed identically. D1's API does not honour it.
The `PRAGMA defer_foreign_keys=TRUE` the dump emits itself does not help
either: deferring a constraint check cannot conjure a table that does not
exist yet.

**The fix — reorder the statements. Verified end-to-end on the drill:**

```bash
node scripts/reorder-d1-dump.mjs ./library-catalog.sql ./library-catalog.ordered.sql
# -> {"statements":3755,"create_table":26,"inserts":3668,"other_ddl":60,"estate_auth":null}
```

✅ **Since 2026-08-18 this is a TESTED step, not a drill artefact.**
`scripts/test/reorder-d1-dump.test.mjs` builds the exact interleave above and
replays both versions in `node:sqlite`: the raw dump dies at `no such table:
main.edition` having created one of four tables (the half-populated state, made
visible), and the reordered dump loads clean with every row, an empty
`foreign_key_check` and `integrity_check` = ok. The FK-enforcement nuance below
is pinned by that test too, so it cannot be "simplified" out of the runbook.
`backup-restore.md` §4b now names the step as mandatory rather than optional.

Every `CREATE TABLE` first, then every `INSERT`, then indexes/triggers/views.
After reordering, **both** dumps imported clean (`rc=0`) through
`wrangler d1 execute --local` with **full row counts matching production**
(library-catalog `work` 351 / `edition` 394 / `copy` 272 / `change_log` 522 /
`research_finding` 814 / 26 migrations; board-game-catalog `item` 837 /
`edition` 1067 / `copy` 838 / `game_component` 1454 / `cover_check` 1012 / 27
migrations — identical to the live counts for that database) and
`PRAGMA foreign_key_check` returning **zero rows** on both.

⚠️ **One nuance that matters if you inspect a dump outside D1.** Reordering
fixes the `no such table` error, but the dump still inserts child rows before
parent rows. D1/miniflare does not enforce foreign keys at insert time, so the
reordered dump loads clean there. A plain SQLite with FK enforcement ON —
which includes **`node:sqlite`, whose `DatabaseSync` enables FK constraints by
default** — will still stop at `FOREIGN KEY constraint failed` (measured on the
drill: 433 of 3,649 rows loaded for library-catalog). To read a dump in
`node:sqlite`, pass `{ enableForeignKeyConstraints: false }`; the loaded
database then passes both `integrity_check` and `foreign_key_check` with zero
violations, so the ordering is a load-time artefact, not corrupt data.

### 3c. The full D1 restore recipe

```bash
# 1. fetch (§2) and reorder (§3b)
node scripts/reorder-d1-dump.mjs ./library-catalog.sql ./library-catalog.ordered.sql

# 2. rehearse locally FIRST — free, instant, and catches a bad dump before it
#    touches anything real. Any wrangler.toml with a d1 binding of that name:
npx wrangler d1 execute <local-binding-name> --local --file=./library-catalog.ordered.sql -y

# 3. create a FRESH database — never replay into a populated one
npx wrangler d1 create library-catalog-restored

# 4. import
npx wrangler d1 execute library-catalog-restored --remote --file=./library-catalog.ordered.sql -y

# 5. ⚠️ CATCH THE SCHEMA UP — the backup is N migrations behind (§1c)
npx wrangler d1 migrations apply library-catalog-restored --remote
#    NOTE: `migrations apply` rejects -y. Do not pass it.

# 6. verify before repointing anything
npx wrangler d1 execute library-catalog-restored --remote --command \
  "SELECT count(*) FROM d1_migrations;"

# 7. only then repoint the Worker's database_id, or copy specific rows across
```

**Step 5 is verified**, on `estate_auth`: the restored 2026-08-16 backup came
in at 5 migrations / 15 columns on `estate_user`; `migrations apply` ran the
six outstanding files clean and left it at **11 migrations / 19 columns —
exactly matching production — with all 12 user rows intact.**

✅ **STEP 4 IS NOW VERIFIED TOO — REMOTE, ON A REAL D1, 2026-08-18.** See
§3c-drill immediately below. The paragraph that used to sit here said a remote
import was an inference rather than a measurement; it is a measurement now.

### 3c-drill. ⚠️ THE REMOTE IMPORT DRILL — executed 2026-08-18, every command

**Owner-approved production-side write, scoped to a throwaway.** The only
database touched was created by this drill and deleted by it. No existing
store, bucket, Worker or collection was written.

**Store chosen:** `estate_auth` — the smallest (18,305 bytes), and the one whose
restore is a security event (§3d), so the membership gate got exercised too.

**Step 0 — take the dump from the MIRROR, not the bucket (§2a), and prove it is
the right bytes:**

```bash
cp "C:/Users/nbasl/OneDrive/Documents/estate-backups-mirror/d1/estate_auth/20260818T094855Z.sql" ./estate_auth.sql
sha256sum estate_auth.sql
# -> dd5589092f64ab66dc6b6dc33c14aada87920948443586f4a1e1931ba7a10f9b
```

⚠️ **That hash equals `mirror-manifest.json`'s recorded sha256 for the key, and
equals the live-bucket hash recorded in §2a's first-run table.** So this drill
also closes half of §8's "a restore performed *from* the mirror was never
exercised": **the file this remote import replayed came off the mirror, not out
of Cloudflare.**

**Step 1 — reorder, and watch the `estate_auth` gate fire:**

```bash
node scripts/reorder-d1-dump.mjs ./estate_auth.sql ./estate_auth.ordered.sql
# -> {"statements":61,"pragmas":1,"create_table":4,"inserts":52,"other_ddl":4,
#     "estate_auth":{"rows":12,"by_status":{"approved":11,"revoked":1},
#                    "approvers":2,"devops":3,"parsed":true}}
# -> prints the security block, EXIT=3, and the reordered file IS written
```

✅ **The §3d gate works exactly as documented** — exit 3, counts printed, file
still written. ⚠️ And note what the counts say: this 2026-08-18 backup holds
**11 approved / 1 revoked**, where the 2026-08-16 backup held 12/0. The
revocation the drill warned about **is now inside the backup**, so the specific
trap in §3d is not armed on this generation. It will arm again on the next
revocation.

**Step 2 — establish the dump's OWN row counts, which are the thing the remote
import gets compared against** (`node:sqlite`, FK enforcement off per §3b):

| Table | Rows in the dump |
|---|---|
| `d1_migrations` | 11 |
| `estate_session` | 12 |
| `estate_user` | 12 |
| `site_role_grant_log` | 14 |

`PRAGMA foreign_key_check` → **zero rows**; `PRAGMA integrity_check` → **ok**.

**Step 3 — create the throwaway:**

```bash
npx wrangler d1 create estate-auth-restore-drill
# -> ✅ Successfully created DB 'estate-auth-restore-drill' in region WNAM
# -> database_id 62e5f0f7-cb61-4248-9743-7a7d1505c2fe
```

**Step 4 — THE STEP THAT HAD NEVER BEEN RUN. Import, remote:**

```bash
npx wrangler d1 execute estate-auth-restore-drill --remote --file=./estate_auth.ordered.sql -y
```

```
"Total queries executed": 61,
"Rows read": 240,
"Rows written": 199,
"Database size (MB)": "0.06",
"success": true,
"finalBookmark": "00000000-00000014-000050cb-8ce68c073b2205c8262b5a44b79fa2f2",
"served_by_region": "WNAM", "served_by_colo": "LAX",
"timings": {"sql_duration_ms": 12.4846}, "num_tables": 4, "total_attempts": 1
```

**Measured: 3 s wall clock, 12.48 ms of SQL.** It replayed clean on the first
attempt — no partial import, no FK error, no retry.

**Step 5 — verify row counts REMOTELY against step 2's table:**

```bash
npx wrangler d1 execute estate-auth-restore-drill --remote --json --command \
  "SELECT 'd1_migrations' AS t, count(*) AS n FROM d1_migrations
   UNION ALL SELECT 'estate_session', count(*) FROM estate_session
   UNION ALL SELECT 'estate_user', count(*) FROM estate_user
   UNION ALL SELECT 'site_role_grant_log', count(*) FROM site_role_grant_log ORDER BY t;"
```

| Table | Dump | Remote after import | Match |
|---|---|---|---|
| `d1_migrations` | 11 | **11** | ✅ |
| `estate_session` | 12 | **12** | ✅ |
| `estate_user` | 12 | **12** | ✅ |
| `site_role_grant_log` | 14 | **14** | ✅ |

**4 of 4 tables, exact.** `PRAGMA foreign_key_check` on the remote database
returned **zero rows**.

**Step 6 — delete it, and prove it is gone:**

```bash
npx wrangler d1 delete estate-auth-restore-drill -y
# -> Deleted 'estate-auth-restore-drill' successfully.
npx wrangler d1 list --json
# -> exactly 5 databases: library-catalog-2nd, estate_auth, index_catalog,
#    library-catalog, board-game-catalog. No drill database.
```

✅ **The account is back to its five real databases.** Verified by listing, not
by assuming the delete's own success message.

**Credential it ran on:** the interactive `wrangler login` OAuth session
(§7 row 1), whose scopes include `d1 (write)`. **No API token was needed** — so
the remote-restore path does not depend on `CLOUDFLARE_API_TOKEN`, which is the
one credential §7 says is not on this machine.

⚠️ **What this drill did NOT do, stated plainly:**

- **`wrangler d1 migrations apply` against the remote drill database was not
  run.** It needs a `wrangler.toml` naming the throwaway, and the 2026-08-18
  backup is already at 11 migrations — the same count production held at the
  first drill — so there was nothing outstanding to apply. The schema catch-up
  step remains verified **`--local` only** (§3c step 5).
- **No Worker was pointed at the restored database** — §8 item 7 still stands.
- **Only `estate_auth` was exercised remotely.** The two dumps that need
  reordering (`library-catalog`, `board-game-catalog`) were proven `--local`
  only; that they behave identically remotely is now a much better-founded
  inference — the remote engine accepted the same reordered-dump shape — but it
  is still an inference for those two files.
- ⚠️ **The `SELECT id, status, is_approver, is_devops FROM estate_user` capture
  that §3d prescribes was NOT run.** The session's own sandbox declined the
  production read, and the drill did not need it: the import target was a
  throwaway, so there was no live membership state at risk of being overwritten.
  **That capture is still mandatory before any real `estate_auth` restore.**

### 3d. ⚠️ Read before restoring `estate_auth`

✅ **Since 2026-08-18 the TOOL says this too, so it cannot be walked past.**
`reorder-d1-dump.mjs` detects an `estate_user` table in the dump, prints the
BACKUP's own counts (rows, per-status, `is_approver = 1`, `is_devops = 1` —
**counts only, never a name**), prints the incident below and the capture
command, and **exits 3** unless `--yes-i-checked-membership` is passed. The
reordered file is still written; the non-zero exit exists so an automated chain
stops and a human looks. See `backup-restore.md` §4c for the worked sequence.
It is still a human judgement — the script makes the trap visible, it does not
make the decision.

**Measured on the drill, and this is not hypothetical:**

| | Backup 2026-08-16 | Live 2026-08-18 |
|---|---|---|
| approved | **12** | 11 |
| revoked | **0** | **1** |
| approvers | 2 | 2 |
| devops | 3 | 3 |

The two `estate_user` row counts are both 12, so a count-based check passes —
and a blind restore of that backup **silently re-approves a member who has
since been revoked**. `restore` here is a security event, not a data event.

**Before restoring `estate_auth`, always:**

```bash
# capture the CURRENT revocation/authority state first — it is the thing the
# restore will overwrite and the thing that exists nowhere else
npx wrangler d1 execute d94ffe45-4dd0-4dc2-86de-b8c4d649c1cb --remote --command \
  "SELECT id, status, is_approver, is_devops FROM estate_user ORDER BY id;"
```

Reapply every `revoked` status and every approver/devops flag by hand
afterwards. `scripts/seed-estate.mjs` (the third life raft,
`backup-restore.md` §9) has the same blind spot for the same reason: revocation
and post-seed authority live in this database and nowhere else.

---

## 4. Firestore

### 4.1 What the backup actually contains — verified

The `20260816T084924Z` tarball unpacks to **57 files** (56 collection JSONs +
`_summary.json`). Every file's document count matches `_summary.json` exactly,
every document has the `{id, data}` shape, **1,303 documents across 56
collection paths, zero mismatches.** 16 root collections (`reviews` 878,
`readingLists` 234 — of which 66 `tbr` / 168 `read` —, `profiles` 11,
`leaderboard` 9, `club_seen` 7, `clubs` 3, `users` 3, `site_roles` 2,
`pipeline_runs` 40, plus the `_dev` twins) and 40 subcollection paths under
`clubs`/`clubs_dev`.

⚠️ **`readingPositions` and `discord_links` are NOT in it** (§1b). The dump
walks every root collection via `listCollections()`, so their absence means
they held no documents at 2026-08-16T08:49Z — `discord_links` provably so, its
writer landed 2026-08-17. **Whether they hold documents today was NOT verified:
no Firebase service-account credential exists on this machine.**

✅ **Resolved 2026-08-18 — and the resolution is "nothing to fix, everything to
say out loud".** The question the drill raised was whether the collection list
was an explicit list that had gone stale. **Measured: it is not.** It is
`listCollections()` discovery at the root and `doc.ref.listCollections()`
recursion below it, so **both collections are captured automatically the moment
they hold a document** — no code change was needed and none was made to the
walk.

What WAS wrong is that the absence was **silent**. Firestore's
`listCollections()` returns only collections that currently hold at least one
document, so "expected but empty", "never created" and "its writer broke" are
indistinguishable in a dump. `backup-firestore.mjs` now carries
`EXPECTED_COLLECTIONS` — a **warning** list, not a target list — and any
expected root collection absent from a run emits a `::warning::` (visible on
the Actions run summary) and lands in `_summary.json` as `missingExpected`.
Never fatal: an empty collection is a legitimate state. The next gap of this
shape shows up in a run log instead of needing another drill.

✅ **AND THE OPEN QUESTION IS NOW ANSWERED — MEASURED 2026-08-18T07:23Z**, on
the first backup run after the change (run `32111218016`). The dump came back
**58 collections / 1,331 documents**, up from 56 / 1,303:

| Collection | Drill (2026-08-16) | Measured 2026-08-18 |
|---|---|---|
| `discord_links` | absent | ✅ **present and backed up** — it holds documents now, so discovery caught it with no code change, exactly as predicted |
| `readingPositions` | absent | ⚠️ **still absent, and now we know WHY**: the expected-collection check fired for it and only it. It holds **no documents today** — it is empty, not missing from the dump by accident |

That closes §8's unverified item 4 ("whether they hold documents today"). ⚠️ The
answer for `readingPositions` is *"nothing has written to it yet"*, which means
it is not a backup hole today and becomes one the moment it is used — and the
warning will keep saying so on every run until then.

⚠️ The `_dev` twins are deliberately **not** in that list: the drill counted 16
root collections — nine named with counts plus seven `_dev` twins — but did not
record *which* seven, and listing a twin that does not exist would print a
warning that is simply wrong. Add each when a run confirms it.

### 4.2 ✅ FIXED 2026-08-18 — the restore used to corrupt every timestamp

> **The bug below was real and is now fixed.** `restore-firestore.mjs` runs
> every document through `scripts/lib/firestore-timestamps.mjs` before
> `batch.set()`, and BOTH the dry run and the commit print how many values will
> be converted, per collection, so the scope is never silent.
> `scripts/test/firestore-timestamps.test.mjs` proves the round trip **offline
> — no network, no credential, no write**: dump → `JSON.stringify` → reviver →
> the SDK's own wire serializer yields an identical
> `{"timestampValue":{"seconds":"1782327950","nanos":558000000}}`, where the raw
> round-trip yields a `mapValue`. The old broken encoding is pinned as a test of
> its own so it cannot return unnoticed.
>
> ⚠️ **The DUMP format did NOT change and must not.** It is lossless, merely
> not self-describing; changing it would invalidate every backup already sitting
> in `estate-backups`. The type is re-attached on the way IN.
>
> ⚠️ **The manual reviver at the end of this section is now REDUNDANT** for a
> restore. Keep it only for inspecting a dump by hand.
>
> The measurement below stands exactly as taken.

`backup-firestore.mjs` writes `JSON.stringify(doc.data())`. A Firestore
`Timestamp` serialises to a plain object:

```json
"createdAt": {"_seconds":1782327950,"_nanoseconds":558000000}
```

`restore-firestore.mjs` hands that parsed object straight to `batch.set()`,
which writes it back as a **map, not a timestamp**. Proven offline with the
Firestore SDK's own serializer on the drill (no writes, no network):

```
encode(real Timestamp)     -> {"timestampValue":{"seconds":"1782327950","nanos":558000000}}
encode(backup round-trip)  -> {"mapValue":{"fields":{"_seconds":{...},"_nanoseconds":{...}}}}
```

**Scope: 2,139 timestamp-valued fields across the 56 collections** — every
`createdAt`, `updatedAt`, `addedAt`. A restore would leave every
`orderBy('createdAt')`, every date rendering and every timestamp-based rule
looking at a map. (No `GeoPoint`, `DocumentReference` or `Bytes` values exist
in the dump — timestamps are the only affected type.)

**Until `restore-firestore.mjs` grows a reviver, revive the values first:**

```bash
node -e '
const fs=require("fs"), path=require("path");
const dir=process.argv[1];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".json") || f==="_summary.json") continue;
  const p=path.join(dir,f);
  const revive=v=>{
    if (v===null||typeof v!=="object") return v;
    if (Array.isArray(v)) return v.map(revive);
    const k=Object.keys(v).sort().join(",");
    if (k==="_nanoseconds,_seconds")
      return {__ts:true, seconds:v._seconds, nanoseconds:v._nanoseconds};
    return Object.fromEntries(Object.entries(v).map(([a,b])=>[a,revive(b)]));
  };
  console.log(f, "would revive", JSON.stringify(revive(JSON.parse(fs.readFileSync(p,"utf8")))).match(/__ts/g)?.length ?? 0, "timestamps");
}' <unpacked-dir>
```

(That prints the count per file so the scope is visible. The real fix belongs
in `restore-firestore.mjs`: map `{_seconds,_nanoseconds}` →
`Timestamp.fromMillis(...)` on the way in — logged as a recommendation, not
applied by the drill.)

### 4.3 The Firestore restore recipe

```bash
npx wrangler r2 object get "estate-backups/firestore/audiobook-catalog/<STAMP>.tar.gz" \
  --file ./firestore.tar.gz --remote
mkdir -p ./restore-work/firestore && tar xzf ./firestore.tar.gz -C ./restore-work/firestore

export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat <path-to-key.json>)"   # NEVER commit this

# dry run — safe, writes nothing, and does not even initialise the SDK
node scripts/restore-firestore.mjs --dir ./restore-work/firestore
node scripts/restore-firestore.mjs --dir ./restore-work/firestore --only reviews

# after fixing timestamps (§4.2), narrow to ONE collection and commit
node scripts/restore-firestore.mjs --dir ./restore-work/firestore --only reviews --commit
```

**Verified on the drill:** the dry-run path, against the real unpacked dump,
with a placeholder credential. It listed all 56 targets, decoded every `__`
back to `/` correctly (`clubs_dev/…/reads/…/progress`), and exited 0 having
touched nothing — the SDK is only initialised *after* the dry-run exit, so a
dry run genuinely needs no working credential.

🟡 **"There is no staging Firestore project" STOPPED BEING TRUE ON 2026-08-18.**
There is one now — see §4.3a. The `--commit` path is still unexercised, but it
is one console click from being exercised, not architecturally impossible.

### 4.3a. The rehearsal project — `estate-restore-drill` (created 2026-08-18)

**Stood up entirely from the CLI**, with the auth already on this machine. Keep
it: it is free-tier, empty, and reusable for every future drill.

| | |
|---|---|
| Project ID | **`estate-restore-drill`** |
| Console | https://console.firebase.google.com/project/estate-restore-drill/overview |
| Firestore | `(default)`, **nam5**, `FIRESTORE_NATIVE`, `STANDARD` edition |
| Owning account | **`mitchlandtv@gmail.com`** — the same account that owns `audiobook-catalog` |
| Cost | Free tier (Spark). Nothing in it, nothing scheduled against it |

⚠️ **It is a DIFFERENT Google account from the Cloudflare one**
(`nbaslamking@gmail.com` owns the Cloudflare estate; `mitchlandtv@gmail.com`
owns the Firebase projects). That split is pre-existing and is worth knowing
before anyone hunts for the project under the wrong login.

**Exactly how it was made, for when it needs remaking:**

```bash
npx firebase-tools projects:create estate-restore-drill \
  --display-name "Estate Restore Drill" --non-interactive
# -> ✅ Your Firebase project is ready!

# ⚠️ A NEW PROJECT HAS THE FIRESTORE API DISABLED, and the CLI does NOT
# auto-enable it — it returns a bare 403 with a console link:
npx firebase-tools firestore:databases:create "(default)" --location nam5 \
  --project estate-restore-drill
# -> Error: HTTP 403, Cloud Firestore API has not been used in project … before

# Enable it without a console visit, using the gcloud ADC already on this
# machine (mitchlandtv@gmail.com, cloud-platform scope):
TOKEN=$(gcloud auth application-default print-access-token)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' \
  "https://serviceusage.googleapis.com/v1/projects/estate-restore-drill/services/firestore.googleapis.com:enable"
# -> {"name":"operations/acat.p2-…"} ; poll the same URL without :enable until state=ENABLED

# ⚠️ THEN WAIT — the enable takes a minute or two to propagate. The retry that
# came immediately after failed with the identical 403; the next one succeeded.
npx firebase-tools firestore:databases:create "(default)" --location nam5 \
  --project estate-restore-drill
# -> Successfully created projects/estate-restore-drill/databases/(default)
```

⚠️ **`gcloud auth list` says "No credentialed accounts" and that is a red
herring** — the gcloud CLI's own account store is empty, but
`application_default_credentials.json` exists and works. They are two different
credential stores; check ADC before concluding there is no Google auth here.

### 4.3b. ⏳ THE ONE OWNER STEP LEFT IN THIS FILE

**What is missing:** a service-account key for `estate-restore-drill`. The
restore tool takes `FIREBASE_SERVICE_ACCOUNT_JSON` and calls
`cert(serviceAccount)`, which requires a real `type: "service_account"` key —
ADC's `authorized_user` JSON is not accepted by that call.

A service account **has already been created** for it —
`restore-drill@estate-restore-drill.iam.gserviceaccount.com` — but this
session's sandbox declined both the IAM role-binding call and the key mint,
correctly: minting credentials and granting roles are access-INCREASING acts,
and the estate's rule is that those get confirmed rather than assumed.

**The console route (2 minutes):**

1. https://console.firebase.google.com/project/estate-restore-drill/settings/serviceaccounts/adminsdk
2. **Generate new private key** → **Generate key** → it downloads a `.json`.
3. Save it somewhere gitignored — the estate's convention is
   `audiobook_catalog/docs/access/keys/` (that whole docs tree is gitignored).
   ⚠️ **Do not** put it in a tracked repo.

*(The Firebase-console route uses that project's own auto-provisioned
`firebase-adminsdk` account, which already carries the Firestore roles. The
`restore-drill@…` account created above needs `roles/datastore.user` granted
before its key would work — the console route avoids that step entirely, which
is why it is the recommended one.)*

**Then the rehearsal is three commands. `reviews_dev` is the collection to use
— it is 4 documents and 8 timestamps, small enough to eyeball and it exercises
the §4.2 reviver:**

```bash
# unpack the newest dump from the MIRROR (no Cloudflare needed):
cp "C:/Users/nbasl/OneDrive/Documents/estate-backups-mirror/firestore/audiobook-catalog/20260818T094843Z.tar.gz" ./fs.tar.gz
mkdir -p ./fs && tar xzf ./fs.tar.gz -C ./fs

export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat <the-drill-key>.json)"

# dry run — must print "Project: estate-restore-drill":
node scripts/restore-firestore.mjs --dir ./fs --only reviews_dev

# ⚠️ CHECK THAT LINE BEFORE ADDING --commit. It is the only thing standing
# between a rehearsal and a write to production.
node scripts/restore-firestore.mjs --dir ./fs --only reviews_dev --commit
```

**What to verify afterwards** (Firestore console → `reviews_dev`): 4 documents,
and every `createdAt`/`updatedAt` rendering as a **timestamp**, not as a map
with `_seconds`/`_nanoseconds` keys. That map is the §4.2 bug; seeing real
timestamps is the proof the reviver works end to end.

✅ **VERIFIED 2026-08-18 without a credential — the dry run against the drill
project:**

```
Project: estate-restore-drill
Mode: DRY RUN — pass --commit to write
Targets (1):
  reviews_dev  (4 docs, 8 timestamps to revive)

8 serialized timestamp(s) will be written back as real Firestore Timestamps, not maps
```

A dry run genuinely needs no working credential — `initializeApp` is called
only *after* the dry-run `process.exit(0)` (read the script's control flow if
you doubt it), so the above ran on a placeholder. ⚠️ **The production key was
deliberately NOT used even for the dry run**, so that no invocation of a restore
tool in this drill named the production project at all.

⚠️ **STILL NOT VERIFIED:** the `--commit` write path. It is now blocked on one
key download rather than on the absence of a target.

⚠️ `restore-firestore.mjs` **overwrites** each restored document wholesale and
**never deletes** documents absent from the backup. A targeted restore cannot
damage collections you did not name.

---

## 5. R2 covers

**Verified on the drill.** All three dumps unpacked and checked against their
own `manifest.json`: **3,201 objects, 453 MB, zero missing files, zero size
mismatches** (library-covers 208 / 21.6 MB, game-covers 1,124 / 179.6 MB,
audiobook-covers 1,869 / 252.1 MB). Then one object per bucket was fetched
from the **live** bucket and SHA-256'd against the backup's copy — **all three
matched byte-for-byte.** The dumps are faithful to production, not merely
internally consistent.

⚠️ **A BIG BUCKET'S DUMP IS SPLIT INTO PARTS — REASSEMBLE FIRST (2026-08-18).**
`wrangler r2 object put` refuses anything over **300 MiB**, and the
`audiobook-covers` tarball measured **328,774,189 bytes (313.5 MiB)** on
2026-08-18. Oversized archives are therefore written as
`<STAMP>.tar.gz.part-aa`, `.part-ab`, … — fetch every part and `cat` them back
together **in order** before untarring. The parts are plain byte slices of one
archive; no part is independently useful.

```bash
# a SPLIT dump (audiobook-covers, as of 2026-08-18) — fetch each part, then cat:
for p in aa ab; do
  npx wrangler r2 object get "estate-backups/r2/audiobook-covers/<STAMP>.tar.gz.part-$p"     --file "./r2-dump.tar.gz.part-$p" --remote
done
cat ./r2-dump.tar.gz.part-* > ./r2-dump.tar.gz     # alphabetical order IS cat order
```

⚠️ **How to know whether it is split, and how many parts** — `wrangler r2
object` has no `list`, so read the run log (§2 method A): each part logs its own
`Wrote estate-backups/…part-XX` line, and the job prints `<key> was written as
N part(s)`. ⚠️ **A dump missing any part cannot be untarred at all.** Retention
deletes a generation's parts together, so a surviving generation is always
complete.

Everything else is a single object:

```bash
npx wrangler r2 object get "estate-backups/r2/library-covers/<STAMP>.tar.gz" \
  --file ./r2-dump.tar.gz --remote
mkdir -p ./restore-work/library-covers && tar xzf ./r2-dump.tar.gz -C ./restore-work/library-covers

# one object back:
npx wrangler r2 object put "library-covers/<key>" \
  --file ./restore-work/library-covers/objects/<key> --remote -y

# whole bucket back (loops the manifest):
node -e '
  const fs=require("fs"); const {execFileSync}=require("child_process");
  const [dir,bucket]=process.argv.slice(1);
  const {objects}=JSON.parse(fs.readFileSync(`${dir}/manifest.json`,"utf8"));
  for (const o of objects)
    execFileSync("npx",["wrangler","r2","object","put",`${bucket}/${o.key}`,
      "--file",`${dir}/objects/${o.key}`,"--remote","-y"],{stdio:"inherit"});
' ./restore-work/library-covers library-covers
```

⚠️ `--remote` on both `get` and `put`, always. Without it wrangler talks to an
empty local simulator and reports success.

⚠️ **NOT verified:** the `put` half (it is a production write). Only `get` and
the byte-level comparison were exercised.

**`audiobook-covers` prefers a different path:** re-run
`python -m scripts.upload_covers_r2 --force` from `audiobook_catalog/`, which
uploads from the 243 MB local master — more current than any snapshot. The R2
dump is the fallback for when that machine is unavailable. `library-covers` and
`game-covers` have **no local master**; the dump is the only way back.

---

## 6. `index_catalog` — don't restore, re-push

Every row is a pointer copied from one of the three catalogs, and a push
replaces that source's rows wholesale.

```bash
curl -s https://library.heygabi.ai/api/health >/dev/null   # nudges library+games backstop
# audiobook has no backstop timer — push by hand from audiobook_catalog:
INDEX_URL=https://index.heygabi.ai INDEX_PUSH_TOKEN=<audiobook push token> \
  python -m app.index_push
```

The drill measured 2,266 rows in the backup against 2,518 live — a re-push
closes that gap correctly and instantly, where a restore would install a stale
index.

---

## 7. Credentials a restore needs

Names and where they live. **No values, ever, in this file or in any log.**

| Need | Name | Where it lives | Verified in the drill |
|---|---|---|---|
| Fetch backup objects from `estate-backups` | interactive `wrangler login` OAuth session | `~/.wrangler/config/default.toml` (Windows: `%APPDATA%\xdg.config\.wrangler\config\default.toml`) | **yes** — the whole fetch ran on it |
| Read live D1 row counts | same OAuth session (`d1` scope) | as above | **yes** |
| `r2 bucket info` / `kv key list` | same OAuth session | as above | **yes** |
| Find the backup keys | `gh` login, `repo` scope | `gh auth status` | **yes** |
| REST `objects` list (backup + retention only, NOT restore) | `CLOUDFLARE_API_TOKEN` | GitHub repo secret on `skymitch9/catalog-platform` | **no** — ⚠️ the OAuth session does NOT cover this endpoint |
| Any Firestore restore | `FIREBASE_SERVICE_ACCOUNT_JSON` | ⚠️ **THREE copies, two of them on this machine** — see §7a | ✅ **YES — MEASURED 2026-08-18.** A live Firestore read authenticated on this machine with the local key. The old "NOT present" claim was wrong |
| Mirror half 1 — discover the keys (§2a) | `gh` login, `repo` scope | `gh auth status` | **yes** — 2026-08-18, the first mirror run |
| Mirror half 1 — fetch the objects (§2a) | the same `wrangler login` OAuth session as row 1 | as row 1 | **yes** — 2026-08-18, all 12 objects |
| Mirror half 2 — upload to Drive `/GABI_backup` (§2a) | the estate's Drive OAuth token, `audiobook_catalog/scripts/token.json` (refreshed by `scripts/drive_auth.py`; its client secret is `scripts/credentials.json`) | that machine only, gitignored | **yes** — 2026-08-18, all 12 objects, MD5-verified |
| **Restoring FROM the mirror** | **none** | — | ⚠️ **and that is the point.** The local mirror needs no Cloudflare credential, no `gh`, and no network. It is the one recovery path that still works when the account is gone |

⚠️ **The MIRROR row is the one that saves you at 3am** — it is the only recovery
path that needs no credential and no network.

## 7a. ✅ THE FIRESTORE RESTORE CREDENTIAL — corrected 2026-08-18

> ⚠️ **THIS SECTION EXISTS TO CORRECT THIS FILE.** Until 2026-08-18 the table
> above said *"this credential is NOT present on the owner's machine"* and the
> §0 summary said a Firestore restore was **BLOCKED** from here. **Both were
> false, and had been false the whole time.** The key was sitting in the
> audiobook repo, gitignored, and had authenticated Firestore control-doc
> writes all day. The drill inferred its absence from never having looked;
> that is precisely the failure mode the rest of this file is written against.

**Measured 2026-08-18** — a read-only probe through the repo's own code path
(`audiobook_catalog/app/core/ingest_control.py` → `read_control()`, which is a
single `.get()` on one control document and writes nothing):

```
readable   = True
error      = None
paused     = False
updated_by = owner-daytime-run-until-1830-20260818
updated_at = 2026-08-18T14:06:21.753982-07:00
```

**That is a live, authenticated Firestore round trip**, returning a document
written earlier the same day. The credential works.

### The three copies, and who holds each

| # | Copy | Custody | State |
|---|---|---|---|
| 1 | `audiobook_catalog/scripts/firebase_service_account.json` | **This machine**, gitignored at `audiobook_catalog/.gitignore:353` | ✅ **PROVEN WORKING 2026-08-18** — the probe above ran on it. This is the one the pipeline uses daily |
| 2 | `audiobook_catalog/docs/access/keys/firebase-sa-restore.json` | **This machine**, inside the gitignored `docs/` tree (`.gitignore:7`) | ✅ **PROVEN WORKING 2026-08-18** — authenticates and round-trips independently. Placed 2026-08-18 as a restore-purpose copy |
| 3 | `FIREBASE_SERVICE_ACCOUNT_JSON` | **GitHub repo secret** on `skymitch9/catalog-platform` | Write-only — the value **cannot be read back out**. Fine for CI, useless in an incident |

⚠️ **Copies 1 and 2 are TWO DIFFERENT KEYS on the SAME service account**
(`firebase-adminsdk-fbsvc@audiobook-catalog.iam.gserviceaccount.com`) — verified
by comparing `private_key_id` (`98961ca3…` vs `1d5a76d7…`). Both authenticate.
That matters two ways: **revoking one does not revoke the other** (so a rotation
must deal with both), and **either one alone is sufficient** for a restore.

### What this changes about a 3am Firestore incident

**Nothing is blocked.** Fetch the dump (or take it off the mirror), then:

```bash
export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat audiobook_catalog/docs/access/keys/firebase-sa-restore.json)"
node scripts/restore-firestore.mjs --dir ./restore-work/firestore --only <collection>
# then --commit, per §4.3
```

⚠️ **The `--commit` path is still unrehearsed** (§4.3b) — that is a separate
gap, about the *tool*, not about the *credential*. Do not read "the credential
works" as "the restore is proven".

### ⏳ The one thing left, and it is the owner's call, not this file's

**Every copy that can actually be READ lives on ONE machine.** Copies 1 and 2
are both on this PC; copy 3 is write-only. So the credential survives a Firebase
console problem and survives a GitHub problem — but **if this machine is the
casualty, the only route back is minting a fresh key from the Firebase console**
(which is fine, and is genuinely available: Firebase console →
`audiobook-catalog` → Project settings → Service accounts → Generate new private
key).

**Recommendation, one line, his decision:** keep **one sealed offline copy** of
the key in the password manager, so a dead machine does not force a re-mint
during an incident. ⚠️ Not urgent and not a blocker — re-minting works and costs
minutes; this only buys back those minutes at the worst possible time.

---

## 8. What this drill did NOT verify

Stated plainly so nobody reads a green table as more than it is.

1. ~~**Any remote D1 import.** `--local` only; a remote import is a write.~~ —
   ✅ **CLOSED 2026-08-18** (§3c-drill): a real remote D1 was created, imported
   from the mirror's own bytes, count-verified 4/4 tables, and deleted. ⚠️ Two
   things stayed local-only even so: `migrations apply --remote`, and the two
   dumps that need reordering (`library-catalog`, `board-game-catalog`).
2. **Any Firestore `--commit` write.** ⚠️ **The reason changed 2026-08-18**: it
   is no longer "no non-production Firestore exists" — one does now
   (`estate-restore-drill`, §4.3a). It is one service-account key download away
   (§4.3b). Still unverified.
3. **Any R2 `put`.** Only `get` and byte comparison.
4. ~~**Whether `readingPositions` / `discord_links` hold documents today**~~ —
   ✅ **CLOSED 2026-08-18** by the backup job itself rather than by a local
   credential (§4.1): `discord_links` is present and backed up;
   `readingPositions` holds no documents. The dump is 58 collections / 1,331
   documents.
5. **Cloudflare plan tier**, so the Time Travel window is 7 or 30 days —
   unknown.
6. **Restore of the second library instance** (`library-catalog-2nd`) — there
   is no backup to restore.
7. **That a restored database actually serves traffic.** Row counts and schema
   were compared; no Worker was pointed at a restored database.
8. ~~**`estate-backups` durability itself** — single bucket, single account, and
   the drill made no off-Cloudflare copy.~~ — ✅ **CLOSED 2026-08-18** by the
   mirror (§2a): three homes, none of them Cloudflare, checksum-verified.
   ⚠️ What is **still** unverified is a restore performed *from* the mirror —
   the bytes are proven identical to the bucket's, so it is the same operation
   on the same bytes, but that is an inference from a byte comparison rather
   than an exercised restore. Retention has also never been observed deleting
   anything: the mirror holds one generation and the first prune cannot happen
   until nine daily backups have accumulated.

---

## 9. Recommendations (drill output) — with what happened to each

Ordered by blast radius. **None were applied by the drill itself**; seven were
implemented on 2026-08-18 in commit `8c7f780`. Status is marked per item.

1. ✅ **DONE 2026-08-18.** **Add `library-catalog-2nd` to the backup matrix** — `backup.yml`'s `d1`
   matrix, `prune-r2-backups.mjs`'s prefix arguments, and `backups.ts`'s
   `KNOWN_BACKUP_PREFIXES` (all three, in one change, as that file's header
   already warns).
2. ✅ **DONE 2026-08-18** (§4.2 above). **Fix `restore-firestore.mjs` to revive timestamps** (§4.2). The dump does
   not need to change — it is lossless, just not self-describing.
3. ✅ **DONE 2026-08-18** (§3b above). **Ship `scripts/reorder-d1-dump.mjs` alongside the backup scripts** and
   reference it from `backup-restore.md` §4b, whose current "just run
   `wrangler d1 execute --file`" recipe does not work for two of four
   databases.
4. ✅ **DONE 2026-08-18 — daily 09:12 UTC.** **Give `backup.yml` a cadence.** It is dispatch-only by deliberate design,
   and the cost of that is measured in §1c: 6 unbacked-up `estate_auth`
   migrations, +469 `change_log` rows and a whole `ebook_holding` table in
   under two days. Even a weekly cron would bound it. (If the "no cron touches
   credentials" objection stands, a calendar reminder is still better than
   nothing — and `backups.ts` already grades staleness at 14/45 days.)
5. ✅ **DRILLED 2026-08-18 — §3c-drill.** **Do one throwaway remote-import drill** (§3c) to close the largest
   unverified step. `estate-auth-restore-drill` was created, imported from the
   mirror's own file (sha256-matched), verified 4/4 tables exact, and deleted;
   the account is back to its five real databases. Every command and output is
   recorded in §3c-drill.
6. 🟡 **STOOD UP 2026-08-18 — §4.3a; one owner step short.** **Stand up a second Firebase project** as a Firestore rehearsal target, or
   accept permanently that the Firestore restore path is untested.
   `estate-restore-drill` exists with a `(default)` Firestore database in nam5,
   created entirely from the CLI. ⏳ **Remaining: download a service-account key
   for it** (§4.3b) — a console click — then run the `--commit` rehearsal on
   `reviews_dev` (4 docs / 8 timestamps). Keep the project; it is free and
   reusable for every future drill.
7. ✅ **DONE 2026-08-18 — §2a.** **Get a copy of `estate-backups` off Cloudflare.** Everything protected and
   everything protecting it live in one account. **They no longer do:** the
   backups now also sit on the owner's PC, in OneDrive, and in Google Drive
   `/GABI_backup` — 11/11 stores, 12 objects, 539,573,402 bytes, mirrored and
   checksum-verified on the first run. Owner decision, verbatim: *"Do a and b,
   don't store in GABI tho store in a new folder called GABI_backup on drive"*.
   ⚠️ The mirror follows the bucket's retention; it is not an archive.
8. ✅ **CLOSED 2026-08-18 — §7a, and the premise was wrong.** **Put a `FIREBASE_SERVICE_ACCOUNT_JSON` key where an incident can reach it**
   (§7) — ~~today the restore credential exists only as a GitHub secret, which
   cannot be read back out.~~ **It never existed only as a GitHub secret.** Two
   working copies were already on this machine, both gitignored, and a live
   Firestore read authenticated on one of them on 2026-08-18. Nothing had to be
   put anywhere. ⏳ The only residual — **his call, not a blocker** — is one
   sealed offline copy in the password manager, for the case where this machine
   is itself the casualty.
9. ✅ **PARTLY DONE 2026-08-18** — the two tiny buckets joined the matrix;
   `estate-ebooks` was DECLINED on the judgement below, with the reasoning
   (and the named residual risk: it lasts as long as the owner's disk)
   recorded in `backup.yml` beside the matrix it explains.
   **Add `ebooks-gated`, `estate-docs-gated` and `estate-ebooks` to the `r2`
   matrix** — the first two are tiny (107 kB / 1.27 MB) and cost nothing;
   `estate-ebooks` is 1.81 GB and has a local master, so it is a judgement
   call.
10. ✅ **RECORDED 2026-08-18** as a standing rule in `backup.yml`'s header and
    `backup-restore.md` §8, so the day one fills, the reason it was skipped is
    beside the matrix.
    **Add `bgc-photos`, `library-2nd-covers` and the `estate_docs` KV the day
    any of them holds data.** All three are empty today and are already named
    as future work elsewhere.

    🔴 **`estate-audio` was on that list and has been REMOVED from it,
    2026-08-18 — it filled, and the rule was wrong for it.** It now holds the
    ~685 GB disaster-recovery archive of the audiobook library (`archive/`
    prefix, hourly task `AudiobookArchiveR2`). The "add it the day it holds
    data" rule would have enrolled 685 GB into a nightly tar on a 14 GB
    runner. It is excluded **on its merits, not on its emptiness**: the bucket
    *is* the backup, whose master is the owner's local disk, so a copy of it
    would be a backup of a backup. `scripts/backup-r2.mjs` now refuses it
    mechanically rather than relying on anyone reading this paragraph.

---

## 10. Re-running this drill

Everything above is reproducible in a sandbox with no production writes:

```bash
gh run view <newest-backup-run> --repo skymitch9/catalog-platform --log | grep "Wrote estate-backups"
npx wrangler r2 object get "estate-backups/<key>" --file ./x --remote      # fetch
node scripts/reorder-d1-dump.mjs ./x.sql ./x.ordered.sql                   # §3b
npx wrangler d1 execute <local-binding> --local --file=./x.ordered.sql -y  # sandbox import
npx wrangler d1 migrations apply <local-binding> --local                   # schema catch-up
npx wrangler d1 execute <db-id> --remote --command "SELECT count(*) FROM <t>;"  # live read
npx wrangler r2 bucket info <bucket>                                       # live object count
```

Update the drill date in this file's header when you do, and re-measure §1c —
those counts go stale within days.

---

## 11. FULL REBUILD FROM NOTHING BUT GIT + THE BLOB BACKUPS

> **Added 2026-08-18** under the estate-wide rule that every app carries a
> rebuild doc answering *"from nothing but git + blob backups, how do I rebuild
> this?"*. §§1–10 answer **"one store broke"**; this section answers **"the
> Cloudflare account is gone and I am starting from a git clone and the
> mirror."**
>
> ⚠️ **This section is INFERENCE unless a line says otherwise.** No full rebuild
> has ever been performed. Its individual steps are drilled to the degree §12's
> table records; the *sequence* is not.

### 11.1 What this repo owns

**Five Workers.** Each is `apps/<name>/wrangler.toml` and deploys with
`npx wrangler deploy --config apps/<name>/wrangler.toml`.

| Worker (`name =`) | Hostname | Durable state it binds |
|---|---|---|
| `estate-auth` | `auth.heygabi.ai` | D1 `estate_auth`, R2 `estate-backups`, R2 `estate-docs-gated`, KV `estate_docs` |
| `catalog-index` | `index.heygabi.ai` | D1 `index_catalog` |
| `audiobook-worker` | `audiobook-api.heygabi.ai` | R2 `ebooks-gated`, R2 `estate-ebooks`, R2 `estate-audio` |
| `estate-discord` | `discord.heygabi.ai` | Firestore (via SA); cron `*/2 * * * *` |
| `ebooks-door` | `ebooks.heygabi.ai` | — (gate in front of `ebooks-gated`) |

**Two D1 databases of its own:** `estate_auth`
(`d94ffe45-4dd0-4dc2-86de-b8c4d649c1cb`) and `index_catalog`
(`3004d175-3c51-4ed4-ac3e-62859319f8ac`).

⚠️ **This repo also OWNS THE BACKUP SYSTEM FOR THE WHOLE ESTATE** — `backup.yml`
plus `scripts/backup-*.mjs`, `restore-*.mjs`, `prune-r2-backups.mjs`,
`reorder-d1-dump.mjs`, `mirror-estate-backups.mjs`. **Rebuild this repo before
the other three**, because it is the repo that can read their backups.

### 11.2 The order, and why it is this order

1. **Clone the four repos.** Nothing else can start; every `wrangler.toml`,
   migration and script lives here. Git is the only part of the estate with no
   restore procedure at all — it is already distributed (`backup-restore.md` §8).
2. **Re-mint `CLOUDFLARE_API_TOKEN`** and log wrangler in. Until this exists you
   cannot create a database or a bucket.
3. **Create the D1 databases**, then **import from the mirror** (§3b/§3c — and
   ⚠️ **reorder first**; two of five dumps do not replay raw). ⚠️ **New database
   IDs come out of this**, and every `database_id` in every `wrangler.toml` must
   be edited to match. That edit is the single most forgettable step in this
   section.
4. **Run `wrangler d1 migrations apply`** on each — a backup is always N
   migrations behind (§1c).
5. **Create the R2 buckets and restore their objects** (§5). ⚠️ `estate-audio`
   and `estate-ebooks` are **not** in the backup set on purpose — they are
   re-uploaded from the owner's local disk (`archive_audio_r2.py`,
   `upload_ebooks_r2.py`), which is slow (~685 GB) but authoritative.
6. **Restore Firestore** (§4.3) — the credential is on this machine (§7a).
7. **Re-create every Worker secret** (§11.3). ⚠️ Worker secrets are
   **write-only**; none of them can be read out of the old estate, so all are
   re-minted, and every *paired* secret must be set on **both** sides in the
   same sitting.
8. **Deploy the five Workers**, then the three catalog repos' Workers.
9. **Re-push `index_catalog` rather than restoring it** (§6) — a restore
   installs a stale index; a push is instant and correct.
10. **Re-check `estate_auth` membership by hand** (§3d). Revocations and
    post-seed authority exist nowhere else, and a restore silently re-approves
    anyone revoked since the snapshot.

### 11.3 Secrets, by name, with custody and re-mint point

⚠️ **No values here, ever.** ⚠️ **Every Cloudflare Worker secret is write-only —
there is no "look it up".** A rebuild re-mints all of them.

| Secret | Held by | Custody today | Re-mint at |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub Actions, all 4 repos | GH repo secret; ⚠️ **not on this machine** | dash.cloudflare.com → My Profile → API Tokens ("Edit Cloudflare Workers" template) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | GH secret (`catalog-platform`) | ✅ **also 2 working local copies** — §7a | Firebase console → `audiobook-catalog` → Service accounts |
| `TOKEN_SIGNER_KEY` | `estate-auth` | Worker secret (write-only) | Google Cloud Console → IAM → Service Accounts |
| `FIREBASE_SERVICE_ACCOUNT` | `estate-auth` | Worker secret (write-only) | same as above |
| `ESTATE_CONDUCTOR_TOKEN` | `estate-auth` | Worker secret **+** `docs/access/keys/estate-conductor-token.txt` (gitignored) | self-generated random |
| `ESTATE_EVENTS_TOKEN` | `estate-auth` | Worker secret (write-only) | self-generated random |
| `ESTATE_APP_TOKEN_LIBRARY` / `_INDEX` / `_DISCORD` | ⚠️ **PAIRED** — `estate-auth` + the app | Worker secrets both sides | self-generated; ⚠️ **set both sides together or the failure is a silent 401** |
| `ANTHROPIC_API_KEY_GABI` | `estate-auth` | Worker secret | console.anthropic.com |
| `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` | `estate-discord` | Worker secret | discord.com/developers |
| `POLL_SYNC_TOKEN` | ⚠️ **PAIRED** — `estate-discord` + audiobook pipeline `.env` | Worker secret + local `.env` | self-generated |
| `CATALOG_PLATFORM_TOKEN` | GH Actions (library + BGC repos) | GH repo secret | github.com → Settings → Developer settings → PAT |

📖 **The complete, cross-repo credential map is
`audiobook_catalog/docs/access/CREDENTIALS.md`** — 7 Workers, 8 environments, 6
custody stores, with rotation rituals. ⚠️ It is **gitignored on purpose** (the
aggregation is the sensitive artifact, not any single name), so it survives only
on this machine. **In a machine-loss rebuild that file is gone**, and this table
plus `wrangler secret list` per Worker is what you have. That is a real, named
weakness of the current custody design.

### 11.4 What a rebuild CANNOT recover

- **Anyone revoked since the last snapshot** (§3d) — restore re-approves them.
- **Worker secret values** — all re-minted, never recovered.
- **Data written after the newest backup** — bounded at ~1 day by the daily cron
  (§1c), except `estate-audio`/`estate-ebooks`, which are re-uploaded from the
  local master and are therefore *more* current than any snapshot.
- **`readingPositions`** if it ever fills — it holds no documents today, so it
  is absent from the dump and the expected-collection check warns on every run
  (§4.1).
- ⚠️ **`CREDENTIALS.md` itself**, if the machine is the casualty (§11.3).

---

## 12. Drilled vs inference — the honest status table

**"Drilled" means executed and measured on the date shown. "Inference" means the
mechanism is identical to something that was drilled — a real reason to expect
it works, and not a measurement.**

| Capability | Status | Evidence |
|---|---|---|
| Fetch a backup object from `estate-backups` | ✅ **Drilled** 2026-08-17 | §2, every store |
| Restore from the **mirror** instead of the bucket | ✅ **Drilled** 2026-08-18 | §3c-drill — the remote import replayed a file copied from the mirror, sha256-matched |
| Reorder a D1 dump so it replays | ✅ **Drilled** 2026-08-17 + regression test | §3b |
| D1 import — **local** | ✅ **Drilled** 2026-08-17 | §1a, all four stores |
| D1 import — **remote** | ✅ **Drilled** 2026-08-18 | §3c-drill, `estate_auth`, 4/4 tables exact |
| D1 remote import of a **reordering-required** dump | ⚠️ **Inference** | only `estate_auth` went remote; same statement stream |
| `d1 migrations apply` — local | ✅ **Drilled** 2026-08-17 | §3c step 5 |
| `d1 migrations apply` — **remote** | ⚠️ **Inference** | §3c-drill's "did NOT do" list |
| `estate_auth` membership gate fires | ✅ **Drilled** 2026-08-18 | §3c-drill step 1, exit 3 |
| Firestore dump is faithful | ✅ **Drilled** 2026-08-17 | §4.1, 58 collections / 1,331 docs |
| Firestore timestamp reviver | ✅ **Drilled offline** 2026-08-18 | §4.2, SDK's own serializer |
| Firestore restore — **dry run** | ✅ **Drilled** 2026-08-18 | §4.3b, against `estate-restore-drill` |
| Firestore restore — **`--commit`** | ❌ **NOT verified** | ⏳ one key download away, §4.3b |
| Firestore restore **credential** works | ✅ **Drilled** 2026-08-18 | §7a, live authenticated read |
| R2 dump is faithful to live bytes | ✅ **Drilled** 2026-08-17 | §5, sha256 per bucket |
| R2 `put` (restore an object) | ❌ **NOT verified** | production write, §8 item 3 |
| A restored DB actually serves traffic | ❌ **NOT verified** | §8 item 7 |
| **Full rebuild from git + blobs (§11)** | ❌ **NOT verified** | the sequence has never been run |

---

## Model guidance (read me if you are Kiro)

> Kiro: stay on AUTO - it saves the owner credits. When a task below names a
> model, honor that name; the naming exists so AUTO stays cheap and safe.
> Labels (verified against Kiro pricing: Auto = 1.0x credits, pinned Sonnet =
> 1.3x, pinned Opus = 2.2x): "Kiro Claude Sonnet 5" = STAY ON AUTO, do not pin
> (standard build). "Kiro Claude Opus 4.8" = actually pin Opus - the 2.2x is
> worth it (design judgment or trust-critical). "Codex (GPT-5.3-Codex)" = tell
> the owner; he runs Codex himself.

| Task on this document | Model |
|---|---|
| Keeping this file current — re-measuring counts, updating dates, adding a store | **Kiro Claude Sonnet 5** |
| Re-running the drill in a sandbox (§10) | **Kiro Claude Sonnet 5** |
| ⚠️ **Executing an actual restore** — any `--commit`, any `--remote` import, any `r2 object put`, any Time Travel restore | **Kiro Claude Opus 4.8** |
| ⚠️ **Anything touching `estate_auth` membership** (§3d) | **Kiro Claude Opus 4.8** |

⚠️ A real restore is Opus-pinned because it is irreversible and because §3d
makes it a *security* decision, not a data one. Doc upkeep is not.
