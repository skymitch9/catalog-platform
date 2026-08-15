# Estate Backup & Restore — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (no secret
> values — env var / secret NAMES only, per the estate's access-doc rule).
> Last verified: **2026-08-15** — the R2 gap named the night before (§8) is
> closed: `backup.yml`'s new `r2` job was dispatched for real (runs
> `31889683701` and `31890412775`, the second one adding `game-covers` once
> it appeared) and all three artifacts downloaded and inspected non-empty —
> `library-covers`: 208 objects/20.6 MiB, `audiobook-covers`: 1,868
> objects/240.4 MiB, `game-covers`: 922 objects/118.8 MiB (that bucket was
> created AND actively populated mid-session by a second agent working the
> covers-consolidation plan — it held 432 objects when first checked ten
> minutes earlier and 922 by the time the CI backup ran; a backup taken
> mid-migration is still an honest snapshot of what existed at that moment,
> included here rather than deferred). A sampled object from
> `library-covers` was restored via `wrangler r2 object get --remote` and
> diffed byte-identical against the backup. Everything from 2026-08-14 below
> still holds: `backup.yml`
> dispatched and its four D1 artifacts + one Firestore artifact downloaded
> and inspected non-empty; `scripts/backup-firestore.mjs` run locally against
> the live `audiobook-catalog` project (56 collections, 1,294 docs);
> `scripts/restore-firestore.mjs`'s dry-run path exercised (its live-write
> path was NOT exercised against production — see §5).

---

## 1. What's protected, and where it actually lives

| What | Where | Backup mechanism | Priority |
|---|---|---|---|
| D1 `library-catalog` | `library_catalog` repo, id `6022ea5e-2510-450e-81ce-7d847fa31379` | Time Travel (always on) + `backup.yml` export | High — user-entered catalog data (locations, prices, `lent_to`), no other copy |
| D1 `board-game-catalog` | `Board_Game_Catalog` repo, id `7dd22702-f0e2-4fc7-b201-d16d60176efa` | Time Travel + `backup.yml` export | High — same shape, no other copy |
| D1 `estate_auth` | `catalog-platform/apps/auth-worker`, id `d94ffe45-4dd0-4dc2-86de-b8c4d649c1cb` | Time Travel + `backup.yml` export | **High despite being tiny** — it is the estate's membership directory (who is approved, who is revoked, who is an approver); losing it silently reopens the door to everyone it revoked, or locks out everyone it approved. §9 below covers the one mitigating fact: it is also reconstructible by re-running `scripts/seed-estate.mjs` |
| D1 `index_catalog` | `catalog-platform/apps/index-worker`, id `3004d175-3c51-4ed4-ac3e-62859319f8ac` | Time Travel + `backup.yml` export, but **treat as low priority** | **Low, deliberately** — every row is a pointer copied FROM the three source catalogs (`docs/access/index-worker.md`'s "pointers, never truth"). A push replaces a source's rows wholesale; the index is fully rebuildable at any time by re-triggering the three pushes (§7). It is backed up here anyway because the export is nearly free, not because losing it would be a real loss |
| Firestore (`audiobook-catalog` project) | shared by all three catalogs — `reviews`, `clubs` (+subcollections), `site_roles`, `users`, `profiles`, `leaderboard`, `readingLists`, `pipeline_*`, `cw_requests`, `club_seen`, each also `*_dev` | `scripts/backup-firestore.mjs` (recursive JSON dump), dispatched via `backup.yml` | High — `reviews` alone is 878 docs with no source of truth anywhere else; four review authors (`identity-and-reviews.md`) have **no account to re-derive their reviews from** if this is lost |
| R2 `library-covers` | `library_catalog` | `scripts/backup-r2.mjs` (full object dump via the Cloudflare REST API), dispatched via `backup.yml`'s `r2` job — **gap closed 2026-08-15, see §8** | Medium-high — user-uploaded photos of book covers are content-addressed and may have no copy outside the bucket |
| R2 `audiobook-covers` | `audiobook_catalog` | `scripts/backup-r2.mjs`, same job — backed up anyway even though it's independently reproducible (§8), same "the export is nearly free" reasoning as `index_catalog` | Low — every object is also a JPEG under `output_files/covers` on the OpenAudible machine (243 MB, gitignored, the actual master); `covers_manifest.json` (tracked in git) is the enumeration. Restore = re-run the upload script (§6) |
| R2 `game-covers` | `Board_Game_Catalog` (per `docs/info/covers-consolidation-plan.md`) | `scripts/backup-r2.mjs`, same job — included from the start since the bucket was already live (922 objects/118.8 MiB in the proof run, up from 432 ten minutes earlier — a migration was actively running the same night) | Medium — same content-addressed-upload shape as `library-covers`; whether a local/reproducible master exists depends on how the consolidation migration script ends up sourcing images (see that plan doc) — treated as precious until proven otherwise |
| The three catalog D1 dumps, the Firestore dump | **artifacts on `catalog-platform`'s Actions runs** | — | See §2 for why they all land in this ONE private repo regardless of which repo owns the source |
| The four git repos themselves | GitHub (`skymitch9/*`) + this machine's working copies | **Already distributed — deliberately not duplicated here.** Every repo already exists in at least two places (GitHub + local clone); a third copy of source code is not what this runbook is for | N/A |
| OpenAudible library files (`.m4b`s, the owner's local media) | `C:\Users\nbasl\OpenAudible\books\<Author>\*.m4b` on this machine | **Google Drive sync**, per-author folders — `audiobook_catalog/scripts/sync_to_drive.py`, step of the 8h pipeline (`docs/access/README.md`'s 60-second orientation, `audiobook_catalog`) | N/A here — this is the one item in the inventory that already has a real, running backup story outside git/D1/Firestore entirely. Verified 2026-08-14: `docs/access/README.md` names it explicitly (*"Local audiobook library → ... → Google Drive"*) and `docs/DRIVE_AUDIT_REPORT.md` / `scripts/audit_drive_vs_local.py` exist to check the sync is honest. Nothing new needed here |

## 2. ⚠️ Why every D1 backup lands in `catalog-platform`, not in the repo that owns the database

Evidence, gathered 2026-08-14:

```
$ gh repo view skymitch9/catalog-platform  --json isPrivate   →  true   (PRIVATE)
$ gh repo view skymitch9/library_catalog   --json isPrivate   →  true   (PRIVATE)
$ gh repo view skymitch9/Board_Game_Catalog --json isPrivate  →  false  (PUBLIC)
$ gh repo view skymitch9/audiobook_catalog  --json isPrivate  →  false  (PUBLIC)
```

`Board_Game_Catalog` — the repo whose `wrangler.toml` owns the `board-game-catalog`
D1 — is **public**. GitHub's own docs on downloading workflow artifacts say
only *"read access to the repository is required"*; on a public repo, every
authenticated GitHub account has read access, not only collaborators (this is
also the substance of long-running community complaints titled things like
*"why do public artifacts require authentication"* — the answer settled there
is "a login is the entire bar"). Concretely: a database export of
`board-game-catalog` uploaded as an artifact on `Board_Game_Catalog` would be
one free GitHub signup away from anyone on Earth. That is not acceptable for
a household database dump, and it is exactly the case the task's own
instruction called out in advance.

Rather than solve this per-repo (verify visibility today, remember to
re-verify if it ever changes, keep three separate backup workflows in sync),
this estate backs up **all four** D1 databases from `catalog-platform`
(private) in one workflow. That is possible — and cheap — because of one
fact proven interactively before building `backup.yml`:

```
$ npx wrangler d1 export d94ffe45-4dd0-4dc2-86de-b8c4d649c1cb --remote --output=./x.sql -y
🌀 Executing on remote database d94ffe45-4dd0-4dc2-86de-b8c4d649c1cb …
🌀 Downloaded to ./x.sql successfully!
```

Run from an **empty directory with no `wrangler.toml` at all** — `wrangler d1
export <database-id> --remote` is an account-level API call, not a
project-scoped one. So `catalog-platform`'s `CLOUDFLARE_API_TOKEN` (the same
token `deploy.yml` already uses, D1-edit scoped for the whole account) can
export any of the account's four D1 databases by ID, with **no sibling
checkout, no cross-repo PAT, no wrangler.toml for the target project.**
`library_catalog` and `catalog-platform` are private too, so they carry no
version of this exposure today — but keeping all four in one place means
there is exactly one artifact-visibility question to ever answer, not three
silently drifting ones.

## 3. Running a backup

**GitHub UI:** `skymitch9/catalog-platform` → Actions → *Backup (manual)* →
Run workflow → choose `d1`, `firestore`, `r2`, or `all`.

**CLI:**

```bash
gh workflow run backup.yml --repo skymitch9/catalog-platform -f target=all
gh run list --repo skymitch9/catalog-platform --workflow=backup.yml --limit 3
gh run view <run-id> --repo skymitch9/catalog-platform
```

**Where backups land:** Actions artifacts on that run, one per database
(`d1-library-catalog-<run-id>`, `d1-board-game-catalog-<run-id>`,
`d1-index_catalog-<run-id>`, `d1-estate_auth-<run-id>`), one per R2 bucket
(`r2-library-covers-<run-id>`, `r2-audiobook-covers-<run-id>`,
`r2-game-covers-<run-id>`), plus `firestore-<run-id>`. Download via the
Actions UI or:

```bash
gh run download <run-id> --repo skymitch9/catalog-platform --dir ./restore-work
```

**Retention: 90 days** (`retention-days: 90` in `backup.yml` — GitHub's
maximum for a repo that has not raised its org/repo retention limit further;
verified 2026-08-14 via GitHub's own docs, default AND max are both 90 days
unless a repo/org setting raises them). **This is not a long-term archive.**
For anything that must outlive 90 days, download the artifact and keep the
`.sql` / `.json` files somewhere durable (the same Drive account already
used for the audiobook library, or any offline copy) — this workflow does not
do that automatically tonight.

**Two secrets this workflow needs, both on `catalog-platform` only:**

| Secret | What | How to get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Already set (shared with `deploy.yml`) | dash.cloudflare.com/profile/api-tokens, "Edit Cloudflare Workers" template — D1 edit is already in scope. Verified 2026-08-15 it ALSO already covers R2's `objects` list/get REST endpoints (the `r2` job ran clean with no token changes) — if a future token ever needs re-creating from scratch, explicitly add the "Workers R2 Storage Read" (Account) permission group, since that one is not part of the base template |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | The **full JSON content** (not a path) of a Firebase service account key for the `audiobook-catalog` project | Firebase console → `audiobook-catalog` → Project settings → Service accounts → Generate new private key → paste the whole file as the secret value: `gh secret set FIREBASE_SERVICE_ACCOUNT_JSON --repo skymitch9/catalog-platform < path/to/key.json`. The same credential `audiobook_catalog/scripts/firebase_service_account.json` already is — reusing it rather than minting a second key with the same power |

Both guard steps in `backup.yml` fail loudly with these exact instructions if
the secret is absent, so a bad dispatch cannot silently produce an empty
artifact.

## 4. Restoring a D1 database

Two independent mechanisms — reach for Time Travel first; the export is the
fallback for anything Time Travel's window has already passed, or for moving
a snapshot somewhere else entirely (a new database, a local sqlite file for
inspection, etc).

### 4a. Time Travel — the first thing to try, no backup file needed

D1 keeps a continuous change log for every database automatically; nothing
had to be turned on for this to work.

```bash
# What bookmark is "now", or what was it at a past instant:
npx wrangler d1 time-travel info <database-id-or-name>
npx wrangler d1 time-travel info <database-id-or-name> --timestamp="2026-08-14T12:00:00Z"

# Restore — ⚠️ DESTRUCTIVE, overwrites the live database IN PLACE, cancels
# any in-flight queries against it:
npx wrangler d1 time-travel restore <database-id-or-name> --timestamp=<unix-or-ISO-timestamp>
# or, restoring to a specific prior bookmark instead of a timestamp:
npx wrangler d1 time-travel restore <database-id-or-name> --bookmark=<bookmark>
```

**Window: up to 30 days on a Workers Paid plan, 7 days on Workers Free**
(verified against Cloudflare's current D1 docs, 2026-08-14 — this account's
current plan tier was not re-verified here; check
dash.cloudflare.com → Workers & Pages → Plans before assuming which figure
applies). No cost for the storage or the restore itself.

**The restore command itself returns the database's prior bookmark** — write
it down before you run it. If the restore turns out to be wrong, that
bookmark is how you undo it (restore again, to that bookmark).

### 4b. From a `backup.yml` export (`.sql` file)

For when Time Travel's window has passed, or you want the snapshot in a new
database rather than overwritten in place:

```bash
# Download the artifact first (§3), then:
npx wrangler d1 execute <database-id-or-name> --remote --file=./library-catalog-20260814T...Z.sql
```

⚠️ This runs the exported `CREATE TABLE` + `INSERT` statements against a live
database — on a database that already has data, expect `UNIQUE constraint
failed` on every table unless it is genuinely empty first. The realistic use
of this path is: create a **fresh** D1 database (`wrangler d1 create
<name>-restored`), import into that, verify it, then either point the Worker
at the new database id or copy specific rows back — not a blind replay
against the live one. Time Travel (§4a) is almost always the right tool for
"undo what just happened to the live database"; the export is for "get the
data out and somewhere else."

## 5. Restoring Firestore

`scripts/restore-firestore.mjs` is the companion to `backup-firestore.mjs` —
it reads the same JSON files back and writes them into Firestore with
`set()` (full field overwrite per document, not a merge). **Dry run is the
default; nothing is written until `--commit` is also passed.**

```bash
# From catalog-platform/, with the same secret as the backup:
export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat path/to/key.json)"

# See what it WOULD touch — safe, read-only:
node scripts/restore-firestore.mjs --dir ./restore-work/firestore-<run-id>

# Targeted restore of one collection (recommended over a full restore for
# almost every real incident — e.g. "reviews got corrupted by a bad script"):
node scripts/restore-firestore.mjs --dir <dir> --only reviews --commit

# A club subcollection (paths match exactly what backup-firestore.mjs
# printed and named its files after, `__` decoded back to `/`):
node scripts/restore-firestore.mjs --dir <dir> --only "clubs/2IiyOxEhsWn1Zy2a81NW/reads/bdhIUQDB4R0MA3IbnPar/comments" --commit

# Full disaster recovery — every collection in the dump, one at a time:
node scripts/restore-firestore.mjs --dir <dir> --commit
```

⚠️ **What it does NOT do:** delete documents that exist now but did not exist
in the backup. A targeted restore of one collection cannot destroy data
outside that collection, and restoring `reviews` today does not remove a
review written after the backup was taken unless that review's own document
ID happens to collide with a restored one.

**Not live-tested tonight, stated plainly:** the dry-run path (argument
parsing, path decoding, listing what would be touched) was run against the
real backup and is proven. The actual `--commit` write path uses the
standard Firestore Admin SDK `batch().set()` call — the same primitive
`backup-firestore.mjs`'s read path and every other service-account script in
this estate already trusts — but was not exercised against the live
`audiobook-catalog` project tonight (the session's own safety guard declined
to write throwaway test data to the shared production project, correctly:
this project has no sandbox/staging Firestore instance, so there is no
target to rehearse a live write against that isn't the real thing). Rehearse
it for real the first time it is needed for something that is not an
emergency, or stand up a second Firebase project as a rehearsal target if
that ever feels worth the cost.

## 6. Restoring R2

**One object, from a `backup.yml` `r2` artifact or any local copy:**

```bash
npx wrangler r2 object get library-covers/<key> --file=./restored-cover.jpg --remote   # fetch (verify first)
npx wrangler r2 object put library-covers/<key> --file=./restored-cover.jpg --remote   # write it back
```

`--remote` is required on both — `wrangler r2 object` defaults to the local
Miniflare simulator, not the live bucket, and silently "succeeds" against an
empty local store if you forget it.

**Bulk restore from a `backup-r2.mjs` artifact** (`manifest.json` +
`objects/<key>` — download the artifact first, §3): loop the manifest and
`put` every file back:

```bash
node -e '
  const fs = require("fs");
  const { execFileSync } = require("child_process");
  const dir = process.argv[1];             // e.g. ./restore-work/r2-library-covers-<run-id>
  const bucket = process.argv[2];           // e.g. library-covers
  const { objects } = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));
  for (const o of objects) {
    execFileSync("npx", ["wrangler", "r2", "object", "put", `${bucket}/${o.key}`,
      "--file", `${dir}/objects/${o.key}`, "--remote", "-y"], { stdio: "inherit" });
  }
' ./restore-work/r2-library-covers-<run-id> library-covers
```

This overwrites matching keys in place and does not delete anything that
exists in the live bucket but not in the manifest — same non-destructive
shape as the Firestore restore (§5).

**Where the backup itself comes from, and why the runbook used to say this
was impossible:** `wrangler r2 object` has `get`/`put`/`delete` but still no
`list` as of wrangler 4.123.0 (checked 2026-08-15 via `npx wrangler r2
object --help` — still open as `cloudflare/workers-sdk#13008`). But the
**plain Cloudflare REST API** (`api.cloudflare.com/client/v4`, Bearer-token
auth — NOT the S3-compatible endpoint) has always had list + get for R2
objects:

```
GET /accounts/{account_id}/r2/buckets/{bucket}/objects            # paginated list, cursor-based
GET /accounts/{account_id}/r2/buckets/{bucket}/objects/{key}      # object body + metadata
```

`scripts/backup-r2.mjs` is exactly that — two `fetch()` calls, no
dependencies, no S3 access key/secret pair. It needs the account-level
**"Workers R2 Storage Read"** permission group on the token; verified
2026-08-15 that the existing `CLOUDFLARE_API_TOKEN` (created from the "Edit
Cloudflare Workers" template, per §3) already carries enough to run this
successfully in CI — no token edit turned out to be necessary. (If a future
token rotation ever drops this and `backup.yml`'s `r2` job starts failing
with a 401/403/9109, re-adding "Workers R2 Storage Read" — dash.cloudflare.com
→ My Profile → API Tokens → edit the token — is the fix; still no S3 keys
needed.)

- **`audiobook-covers`**: prefer NOT restoring individual objects from the R2
  backup — re-run the upload script from the actual master copy instead:
  `python -m scripts.upload_covers_r2 --force` (from `audiobook_catalog/`).
  It reads `output_files/covers` (the local master, 243 MB, gitignored) and
  `site/covers_manifest.json` (tracked) and re-uploads everything. This is
  strictly better than restoring from any R2-level backup because the master
  copy is more current than any snapshot could be. The R2 backup is still
  useful as a fallback if that master is ever unavailable.
- **`library-covers`** and **`game-covers`**: no local master exists for
  either (household uploads / a migration script respectively) — the
  `backup-r2.mjs` artifact from `backup.yml` is the only path back for an
  object with no other copy. Restore via the bulk loop above, or a single
  `wrangler r2 object put --remote` for one file.

## 7. "Restoring" `index_catalog` — usually don't; re-push instead

Per `docs/access/index-worker.md`, every row in `index_catalog` is a pointer
copied FROM one of the three catalogs on their own schedule, and a push
**replaces** that source's rows wholesale. So the fastest, most correct fix
for a corrupted or lost index is almost never Time Travel or an import — it's
making the sources push again:

```bash
# library and games: any API request triggers their own staleness backstop
# (re-pushes if their source is empty or >24h stale) — just use the app, or:
curl -s https://library.heygabi.ai/api/health >/dev/null   # nudges the backstop

# audiobook: no backstop timer, push by hand
cd audiobook_catalog
INDEX_URL=https://index.heygabi.ai INDEX_PUSH_TOKEN=<audiobook's push token> \
  python -m app.index_push
```

Time Travel / the export are still there for `index_catalog` (§1's table) —
mainly useful if the Worker itself needs to come back up fast before the
sources have had a chance to re-push, not because the data is precious.

## 8. What's deliberately NOT backed up here, and why

| Not backed up | Why that's the right call | The real exception |
|---|---|---|
| `index_catalog` (as data worth protecting) | Rebuildable from the three sources at any time (§7); backed up anyway because the export is nearly free, not because it matters | None |
| The four git repos | Already exist in ≥2 places (GitHub + every local clone) the moment they're pushed; a third copy inside a "backup" system duplicates distribution git already provides | None |
| OpenAudible `.m4b` library files | Already synced to Google Drive, per-author folders, as a running step of the existing 8h pipeline (`sync_to_drive.py`) — a genuinely separate, already-working backup story that predates this runbook | None — this is the one item that needed no new work tonight, only verifying its docs said so (they do) |
| `audiobook-covers` (R2) — as a REASON not to back it up | Superseded 2026-08-15 — it's still reproducible from the local master, but it's backed up anyway now because the `r2` job makes doing all three buckets together cheaper than special-casing one out | Backed up in §1's table; restore still prefers the master copy (§6) |
| `bgc-photos` (R2) | Exists in the account (`Board_Game_Catalog`) but is **unbound and holds 0 objects** as of 2026-08-15 (confirmed both via that repo's own `docs/HANDOFF.md` and a live listing) — feature not live yet, nothing to back up | Add a `bgc-photos` matrix entry to `backup.yml`'s `r2` job the day it goes live and starts holding real uploads |
| ~~R2 object listing is impossible without S3 keys~~ | **This claim from 2026-08-14 was wrong — corrected 2026-08-15.** `wrangler r2 object list` genuinely still doesn't exist, but the plain Cloudflare REST API (`api.cloudflare.com`, Bearer-token auth, the same style of credential `CLOUDFLARE_API_TOKEN` already is) has list AND get for R2 objects, gated behind the "Workers R2 Storage Read" permission group — not an S3-compatible access key/secret pair. The existing token already carried it; no new credential was needed. See §6 | The gap that drove this whole section is closed — `library-covers`, `audiobook-covers`, and `game-covers` are all now covered by `scripts/backup-r2.mjs` via `backup.yml`'s `r2` job |
| R2 bucket-level versioning / cross-bucket replication | **Does not exist as a native R2 feature** (checked 2026-08-14: R2's object-lifecycle docs cover retention/storage-class transitions only; the only replication-shaped feature, Super Slurper, is a one-way *inbound* migration tool from other clouds, not a backup mechanism; a community feature request for object versioning/replication is open and unimplemented). A DIY version could be built with R2 event notifications + Queues + a second bucket, but that's a project of its own | Time Travel-style "any point in the last N days" simply isn't available for R2 the way it is for D1 |
| A GCS-bucket-backed Firestore export (the `gcloud`/managed path) | Needs a Cloud Storage bucket in the same GCP project plus Storage Admin granted to the Firestore service agent — real new billed infrastructure for a household backup, when the Admin SDK can already read every document with the credential this estate already trusts and uses elsewhere | Worth building later if point-in-time GCS-native Firestore restore ever becomes worth the infrastructure; `scripts/backup-firestore.mjs`'s doc comment names this trade explicitly |

## 9. `estate_auth`'s second life raft

Beyond Time Travel and the export, `estate_auth` has a **third** recovery
path unique to it: `scripts/seed-estate.mjs` rebuilds the directory from
first principles (both catalogs' `app_user` tables + the audiobook
`ADMIN_EMAILS` list + `OWNER_EMAILS`), idempotently. A total loss of the
`estate_auth` database is recoverable by re-running the seed — the one thing
that does NOT come back automatically is anyone's **revoked** status or
**approver** flag granted after the original seed, since those live nowhere
else. Note who currently holds either before relying on this path.

## 10. Files this runbook is describing

| File | Role |
|---|---|
| `.github/workflows/backup.yml` | The manual-dispatch workflow — §2's reasoning, §3's usage, `r2` job added 2026-08-15 |
| `scripts/backup-firestore.mjs` | The Firestore dump tool §3/§5 use |
| `scripts/restore-firestore.mjs` | The Firestore restore tool §5 uses |
| `scripts/backup-r2.mjs` | The R2 object dump tool §6 uses — REST API list+get, added 2026-08-15 to close the gap this runbook named the night before |
| `scripts/seed-estate.mjs` | `estate_auth`'s independent rebuild path, §9 |
| `docs/access/index-worker.md` (in `library_catalog`) | The push protocol §7 restores by re-triggering |
