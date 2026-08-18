# Estate Recovery — the 3am runbook

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (public repo
> — env var / secret NAMES only, never values; no member emails).
> **Every command below was executed in a SANDBOX on the drill date.**
> Drill date: **2026-08-17/18** (restore drill, `target=all` snapshot of
> `20260816T0849xxZ`). Nothing in the drill wrote to a production database,
> bucket, Worker or Firestore collection — every restore landed in a local
> throwaway (`node:sqlite` files and `wrangler --local` miniflare state).
> Production was READ only (row counts, bucket info, one object per bucket).
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
> | 5 | One throwaway remote-import drill | ⏳ **OWNER STEP** — still the largest unverified thing here (§3c) |
> | 6 | A second Firebase project to rehearse restores | ⏳ **OWNER STEP** — the `--commit` path remains untested (§4.3) |
> | 7 | A copy of `estate-backups` off Cloudflare | ⏳ **OWNER STEP** — single bucket, single account, still true |
> | 8 | A `FIREBASE_SERVICE_ACCOUNT_JSON` an incident can reach | ⏳ **OWNER STEP** — ⚠️ a Firestore restore is still BLOCKED from this machine (§7) |
> | 9 | `ebooks-gated` / `estate-docs-gated` / `estate-ebooks` into the `r2` matrix | ✅ **first two done**; `estate-ebooks` deliberately declined, reasoning recorded in `backup.yml` beside the matrix |
> | 10 | The empty stores, the day they hold data | ✅ **recorded** as a standing rule in `backup.yml` and `backup-restore.md` §8 |
>
> ⚠️ **The four ⏳ rows are the whole of what is left, and all four need the
> owner's hands** — a console visit, a second project, a decision about where
> an off-Cloudflare copy lives, and permission to create-and-delete a throwaway
> remote database. None can be closed by a code change.

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
   `--only <collection> --commit`.
4. **A cover is gone →** unpack the bucket tarball, `wrangler r2 object put`
   the one key back (§5).
5. **Before restoring `estate_auth`, read §3d.** A blind restore silently
   re-approves revoked members. `reorder-d1-dump.mjs` now prints the backup's
   membership counts and exits 3 until you acknowledge — do not paste past it.
6. **Backups run themselves now** — daily 09:12 UTC. If the newest object is
   more than ~a day old, something is wrong; check Actions for a
   *disabled scheduled workflow* banner first (`backup-restore.md` §3.0).

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
| 8 | **R2 `estate-audio`** | 0 objects — empty by design (on-request fulfilment) | Nothing to lose; would become hole #4's twin at 630 GB scale if it ever filled |
| 9 | **R2 `library-2nd-covers`**, **R2 `bgc-photos`** | 0 objects each | Nothing to lose today; both belong in the matrix the day they hold anything |
| 10 | **R2 `estate-backups` itself** | 16 objects, 917 MB — 8 stores × **2** generations | Single-copy, single-region, single-account. Retention is configured for 8 but only two `target=all` runs have ever landed, so "8 deep" is a setting, not a fact. ✅ **The 8-vs-2 question is answered — young system, not a prune bug** (§9, and `backup-restore.md` §3's retention note). ⏳ The single-copy half is still open and is owner step #2 |

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

⚠️ **NOT verified by this drill:** step 4 against a real remote D1. Creating a
remote database is a production-side write, which the drill's charter forbade.
The statement stream is identical to the `--local` path that was proven, but
"identical stream, therefore identical result" is an inference, not a
measurement. **Close this by creating a throwaway `*-restore-drill` D1 once,
importing, checking counts, and deleting it.**

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

⚠️ **NOT verified, and cannot be:** the `--commit` write path. There is no
staging Firestore project; the only target is production. `backup-restore.md`
§5 already said this and it is still true. **A second Firebase project is the
only way to close it.**

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
| Any Firestore restore | `FIREBASE_SERVICE_ACCOUNT_JSON` | GitHub repo secret; the same key as `audiobook_catalog/scripts/firebase_service_account.json` | **no — ⚠️ this credential is NOT present on the owner's machine.** Dry runs work without it; a real Firestore restore is blocked until it is re-downloaded from the Firebase console |

⚠️ **That last row is the one that bites at 3am.** A Firestore incident cannot
be fixed from this machine as it stands; the first step would be a Firebase
console visit to generate a new private key.

---

## 8. What this drill did NOT verify

Stated plainly so nobody reads a green table as more than it is.

1. **Any remote D1 import.** `--local` only; a remote import is a write.
2. **Any Firestore `--commit` write.** No non-production Firestore exists.
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
8. **`estate-backups` durability itself** — single bucket, single account, and
   the drill made no off-Cloudflare copy.

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
5. ⏳ **OWNER STEP — still open.** **Do one throwaway remote-import drill** (§3c) to close the largest
   unverified step.
6. ⏳ **OWNER STEP — still open.** **Stand up a second Firebase project** as a Firestore rehearsal target, or
   accept permanently that the Firestore restore path is untested.
7. ⏳ **OWNER STEP — still open.** **Get a copy of `estate-backups` off Cloudflare.** Everything protected and
   everything protecting it live in one account.
8. ⏳ **OWNER STEP — still open, and this is the one that bites at 3am.** **Put a `FIREBASE_SERVICE_ACCOUNT_JSON` key where an incident can reach it**
   (§7) — today the restore credential exists only as a GitHub secret, which
   cannot be read back out.
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
    **Add `bgc-photos`, `library-2nd-covers`, `estate-audio` and the
    `estate_docs` KV the day any of them holds data.** All four are empty
    today; three of them are already named as future work elsewhere.

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
