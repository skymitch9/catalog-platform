> **MOVED BACK 2026-08-15 (later the same day):** the backup WORKFLOW lives
> in THIS repo again. The 2026-08-15-morning move to the private
> skymitch9/estate-backups repo (⚠️ **DELETED 2026-08-16** — it was a
> pointer-only tombstone by then; every script and the workflow live here,
> verified byte-identical before deletion. ⚠️ Do NOT confuse it with the
> **R2 bucket of the same name**, which is live and holds every backup)
> was to keep export ARTIFACTS off a public
> repo — but the real fix was to stop using artifacts at all. Every job in
> `backup.yml` now writes straight into the **private** `estate-backups` R2
> bucket via `wrangler r2 object put ... --remote` (no public access, no
> custom domain — verified at bucket creation). That makes the artifact
> exposure moot regardless of which repo the workflow lives in, so the
> workflow moved back to `catalog-platform` (one repo, zero new owner
> secrets — `CLOUDFLARE_API_TOKEN` already existed here and, unexpectedly,
> already had enough permission to write objects too — see §1). The
> estate-backups repo is now SUPERSEDED — its own README says so; it is kept
> only as a pointer back here, or the owner may delete it.

# Estate Backup & Restore — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (no secret
> values — env var / secret NAMES only, per the estate's access-doc rule).
>
> ### 🔴 2026-08-19 — the `ebooks-gated` dump is now PARTIAL, on purpose
>
> `transcripts/` is **excluded** from the nightly `ebooks-gated` backup (owner
> decision, option "a": exclude the prefix, keep the bucket). Those objects are
> themselves the third copy of data on the owner's disk and in his Drive
> mirror; the `text/` packs and the two gate manifests, which have no other
> copy, keep **full** nightly cover.
>
> ⚠️ **A restore of `ebooks-gated` from these dumps does not contain
> transcripts.** Where they come from instead, in order: [§6](#6-restoring-r2).
> The rule and its reasoning: `scripts/lib/backup-exclusions.mjs`. Why it is not
> the same thing as the `estate-audio` refusal: [§8](#8-whats-deliberately-not-backed-up-here-and-why).
>
> **Last verified: 2026-08-18** — the restore drill's mechanical
> recommendations were implemented (commit `8c7f780`, following the drill's own
> `8522b7c`). What changed, and where each is described in full:
>
> | Change | Where |
> |---|---|
> | **`backup.yml` now runs DAILY at 09:12 UTC**, plus the manual button | §3 |
> | **`library-catalog-2nd` joins the backup set** — it had none at all | §1, §3 |
> | **`ebooks-gated` + `estate-docs-gated` join the `r2` matrix** | §1, §8 |
> | **`restore-firestore.mjs` revives timestamps** — the §5 corruption is fixed | §5 |
> | **`reorder-d1-dump.mjs` is a tested, mandatory step of the D1 restore** | §4b |
> | **An `estate_auth` dump now PRINTS its membership counts and a warning** | §4c |
> | **The three store lists are now guarded by a test**, not by a comment | §3 |
> | **"8 generations" was 2 because the system is young**, not a prune bug | §3 |
>
> ✅ **ALL THREE OF THOSE ARE NOW CLOSED OR ONE CLICK AWAY (2026-08-18, second
> pass).** This paragraph used to read *"NOT changed, and still open — these
> need the owner's hands"* and listed three items. Current state, all argued in
> [`RECOVERY.md`](RECOVERY.md) §9:
>
> | Was open | Now |
> |---|---|
> | A `FIREBASE_SERVICE_ACCOUNT_JSON` an incident can reach | ✅ **CLOSED — and the premise was wrong.** ⚠️ The claim that *"a Firestore restore is blocked from this machine"* was **false**: two working copies were already here, gitignored, and one authenticated a live Firestore read on 2026-08-18. RECOVERY.md §7a |
> | An off-Cloudflare copy of `estate-backups` | ✅ **CLOSED 2026-08-18** — the mirror, RECOVERY.md §2a |
> | One throwaway remote-import drill | ✅ **DRILLED 2026-08-18** — a real remote D1 created, imported from the mirror's own bytes, verified 4/4 tables, deleted. RECOVERY.md §3c-drill |
>
> ⏳ **What genuinely remains** is one console click: a service-account key for
> the new `estate-restore-drill` Firebase project, which turns the Firestore
> `--commit` path (§5 below) from unrehearsed into rehearsed. RECOVERY.md §4.3b
> has the clicks and the commands.
>
> **Proof run for all of the above** (`target=all`, run
> [`32111218016`](https://github.com/skymitch9/catalog-platform/actions/runs/32111218016),
> 2026-08-18T07:23Z). **Ten of eleven stores landed**, including all three new
> ones on their first ever run:
>
> ```
> estate-backups/d1/library-catalog-2nd/20260818T072359Z.sql      <- NEW, first copy ever
> estate-backups/r2/ebooks-gated/20260818T072354Z.tar.gz          <- NEW, first copy ever
> estate-backups/r2/estate-docs-gated/20260818T072357Z.tar.gz     <- NEW, first copy ever
> estate-backups/d1/library-catalog/20260818T072356Z.sql
> estate-backups/d1/board-game-catalog/20260818T072400Z.sql
> estate-backups/d1/index_catalog/20260818T072357Z.sql
> estate-backups/d1/estate_auth/20260818T072356Z.sql
> estate-backups/firestore/audiobook-catalog/20260818T072358Z.tar.gz
> estate-backups/r2/library-covers/20260818T072357Z.tar.gz
> estate-backups/r2/game-covers/20260818T072355Z.tar.gz
> ```
>
> `retention` then listed **11 prefixes** (was 8) and logged
> `Deleted 0 object(s) total across 11 prefix(es), keeping up to 8 each` — the
> three new stores at 1 generation, the eight existing ones at 3.
>
> **Two things this run MEASURED that nothing else could have:**
>
> 1. **The Firestore dump is now 58 collections / 1,331 documents** (was 56 /
>    1,303) and the new expected-collection check fired for exactly one name.
>    So: `discord_links` **is present and backed up** — discovery caught it
>    with no code change, as predicted — and `readingPositions` **holds no
>    documents today**, which is why it is absent. That closes RECOVERY.md
>    §8's unverified item 4 without needing a local Firebase credential.
> 2. ⚠️ **`r2 (audiobook-covers)` FAILED on a transient Cloudflare HTTP 500**
>    (`code 10001`, *"We encountered an internal error. Please try again."*)
>    one object into ~1,972, three minutes in. Not caused by any change here —
>    it is a pre-existing fragility the daily cadence would have hit
>    unattended. Fixed by a narrow retry in `backup-r2.mjs` (§3.2) and
>    re-proven by run
>    [`32112803753`](https://github.com/skymitch9/catalog-platform/actions/runs/32112803753)
>    — but the retry only got it as far as a SECOND, harder failure: the
>    archive had outgrown `wrangler r2 object put`'s 300 MiB cap (§3.3). Both
>    are fixed and both are proven below.
>
> **Split-path proof** (`target=r2`, run
> [`32112803753`](https://github.com/skymitch9/catalog-platform/actions/runs/32112803753)):
> all five buckets green. `audiobook-covers` tarred to 328,773,109 bytes and
> was written as **two parts** —
> `20260818T074352Z.tar.gz.part-aa` / `.part-ab` — and ⚠️ **retention counted
> them as ONE generation**, which is the assertion that matters:
>
> ```
> === r2/audiobook-covers — 3 generation(s) / 4 object(s), keeping 3, deleting 0 ===
> Done. Deleted 0 object(s) total across 11 prefix(es), keeping up to 8 GENERATION(s) each.
> ```
>
> Had it counted keys, a future split night would have consumed the allowance
> and deleted real backups behind it.
>
> **FINAL PROOF — the exact shape the nightly cron runs** (`target=all`, run
> [`32113993309`](https://github.com/skymitch9/catalog-platform/actions/runs/32113993309),
> 2026-08-18T07:58Z): **12/12 jobs green, all eleven stores written.**
> Retention closed with
> `Done. Deleted 0 object(s) total across 11 prefix(es), keeping up to 8
> GENERATION(s) each`, and `r2/audiobook-covers` read
> **`4 generation(s) / 6 object(s)`** — two split nights of two parts plus two
> single-object nights, grouped correctly. The Firestore dump came back
> `58 collections, 1331 documents` with `⚠️ Expected but absent:
> readingPositions` and nothing else, so the expected-collection check is
> working and `discord_links` is protected.
>
> ⚠️ **NOT verified:** that any of the three new stores RESTORES. Their paths
> are identical to their siblings' (a D1 `.sql`, two bucket tarballs), which is
> an inference from an identical mechanism, not a measurement. The next drill
> should exercise them.
>
> Previously verified **2026-08-15** — `backup.yml` rewired to write into the
> private `estate-backups` R2 bucket instead of workflow artifacts (this
> banner and §1/§3/§6/§8 below). Bucket created fresh this session, confirmed
> private (no r2.dev public access, no custom domain — both checked via
> `wrangler r2 bucket dev-url get` / `domain list`). `CLOUDFLARE_API_TOKEN`'s
> write permission was proven BEFORE the rewrite with a throwaway smoke-test
> workflow (put one object, confirm success, delete it) — it succeeded with
> **no owner-side token change**, so the R2-object-write permission the
> token needed was already present (see §1 for the "which permission group,
> exactly" nuance — it doesn't neatly match the "Workers R2 Storage Read"
> story §8 told on 2026-08-15 morning).
>
> **Full proof run** (`target=all`, run
> [`31903443263`](https://github.com/skymitch9/catalog-platform/actions/runs/31903443263)):
> all 8 jobs (4× d1, firestore, 3× r2) plus the new `retention` job
> succeeded. Objects landed at `estate-backups/<kind>/<store>/<UTC
> timestamp>.<ext>` — `d1/library-catalog` 2,231,222 bytes,
> `d1/board-game-catalog` 3,756,553 bytes, `d1/index_catalog` 1,397,634
> bytes, `d1/estate_auth` 5,835 bytes, `firestore/audiobook-catalog` 98,205
> bytes (tar.gz of 56 collections / 1,297 docs), `r2/library-covers`
> 21,349,661 bytes (208 objects), `r2/audiobook-covers` 250,584,316 bytes
> (1,868 objects), `r2/game-covers` 178,883,877 bytes (1,123 objects — grew
> again since the 922-object reading two paragraphs above; still an honest
> snapshot of that moment). The `d1/library-catalog` export and the
> `firestore/audiobook-catalog` dump were each downloaded from the bucket
> TWICE independently via `wrangler r2 object get --remote` and diffed
> byte-identical both times; the D1 file opens with real `CREATE TABLE`/
> migration SQL, the Firestore tarball extracts to 58 entries (56 collection
> JSON files + `_summary.json` + the directory entry) matching the run's own
> "56 collections, 1,297 documents" log line. `retention` (new,
> `scripts/prune-r2-backups.mjs`) listed all 8 `<kind>/<store>` prefixes via
> the Cloudflare REST API and logged `keep:`/`delete:` per key — first run,
> so it kept the one object per prefix and deleted nothing, exactly as
> expected for an empty-until-now bucket.
>
> Everything from 2026-08-15 morning and 2026-08-14 below still holds as
> history (the artifact-based flow it describes no longer exists, but the
> reasoning about WHY all four D1s + Firestore + all three covers buckets
> get backed up from here is unchanged): `scripts/backup-firestore.mjs` run
> locally against the live `audiobook-catalog` project (56 collections,
> 1,294 docs then); `scripts/restore-firestore.mjs`'s dry-run path exercised
> (its live-write path was NOT exercised against production — see §5).

---

## 1. What's protected, and where it actually lives

| What | Where | Backup mechanism | Priority |
|---|---|---|---|
| D1 `library-catalog` | `library_catalog` repo, id `6022ea5e-2510-450e-81ce-7d847fa31379` | Time Travel (always on) + `backup.yml` export | High — user-entered catalog data (locations, prices, `lent_to`), no other copy |
| D1 `library-catalog-2nd` | `library_catalog` repo (`apps/worker`, env `friend`), id `9dcf4af9-d1a2-4de4-adcf-ac7eea77f1c8` — the `padhard.heygabi.ai` shelf | Time Travel + `backup.yml` export, **added 2026-08-18** | High — same "user-entered catalog data, no other copy" argument as `library-catalog`. ⚠️ It had **no backup of any kind** until 2026-08-18: the restore drill found it live (6 works / 6 editions / 6 copies / 34 `change_log` rows / 32 migrations) and absent from all three store lists at once ([`RECOVERY.md`](RECOVERY.md) §1b hole #1) |
| D1 `board-game-catalog` | `Board_Game_Catalog` repo, id `7dd22702-f0e2-4fc7-b201-d16d60176efa` | Time Travel + `backup.yml` export | High — same shape, no other copy |
| D1 `estate_auth` | `catalog-platform/apps/auth-worker`, id `d94ffe45-4dd0-4dc2-86de-b8c4d649c1cb` | Time Travel + `backup.yml` export | **High despite being tiny** — it is the estate's membership directory (who is approved, who is revoked, who is an approver); losing it silently reopens the door to everyone it revoked, or locks out everyone it approved. §9 below covers the one mitigating fact: it is also reconstructible by re-running `scripts/seed-estate.mjs` |
| D1 `index_catalog` | `catalog-platform/apps/index-worker`, id `3004d175-3c51-4ed4-ac3e-62859319f8ac` | Time Travel + `backup.yml` export, but **treat as low priority** | **Low, deliberately** — every row is a pointer copied FROM the three source catalogs (`docs/access/index-worker.md`'s "pointers, never truth"). A push replaces a source's rows wholesale; the index is fully rebuildable at any time by re-triggering the three pushes (§7). It is backed up here anyway because the export is nearly free, not because losing it would be a real loss |
| Firestore (`audiobook-catalog` project) | shared by all three catalogs — `reviews`, `clubs` (+subcollections), `site_roles`, `users`, `profiles`, `leaderboard`, `readingLists`, `pipeline_*`, `cw_requests`, `club_seen`, each also `*_dev` | `scripts/backup-firestore.mjs` (recursive JSON dump), dispatched via `backup.yml` | High — `reviews` alone is 878 docs with no source of truth anywhere else; four review authors (`identity-and-reviews.md`) have **no account to re-derive their reviews from** if this is lost |
| R2 `library-covers` | `library_catalog` | `scripts/backup-r2.mjs` (full object dump via the Cloudflare REST API) → tar.gz → `wrangler r2 object put` into `estate-backups/r2/library-covers/<timestamp>.tar.gz`, dispatched via `backup.yml`'s `r2` job | Medium-high — user-uploaded photos of book covers are content-addressed and may have no copy outside the bucket |
| R2 `audiobook-covers` | `audiobook_catalog` | Same mechanism → `estate-backups/r2/audiobook-covers/<timestamp>.tar.gz` — backed up anyway even though it's independently reproducible (§8), same "the export is nearly free" reasoning as `index_catalog` | Low — every object is also a JPEG under `output_files/covers` on the OpenAudible machine (243 MB, gitignored, the actual master); `covers_manifest.json` (tracked in git) is the enumeration. Restore = re-run the upload script (§6) |
| R2 `game-covers` | `Board_Game_Catalog` (per `docs/info/covers-consolidation-plan.md`) | Same mechanism → `estate-backups/r2/game-covers/<timestamp>.tar.gz` — included from the start since the bucket was already live (1,123 objects/170.6 MiB in the 2026-08-15 proof run, still growing from the consolidation migration) | Medium — same content-addressed-upload shape as `library-covers`; whether a local/reproducible master exists depends on how the consolidation migration script ends up sourcing images (see that plan doc) — treated as precious until proven otherwise |
| R2 `ebooks-gated` — **`text/` packs + the two gate manifests only** | the ebooks gate (`apps/ebooks-door`) and the GABI packs | Same mechanism → `estate-backups/r2/ebooks-gated/<timestamp>.tar.gz`, **added 2026-08-18**; ⚠️ **`transcripts/` EXCLUDED at listing time since 2026-08-19** (`scripts/lib/backup-exclusions.mjs`) | **⚠️ THIS IS A PARTIAL-BUCKET BACKUP AND THE ROW SAYS SO ON PURPOSE.** MEASURED 2026-08-18: 2 gate objects (107 kB) **+ 183 GABI packs under `text/` (36.08 MB) + 16 transcripts under `transcripts/` (38.7 MB gz, from 195.30 MB raw)**. ✅ **DECIDED 2026-08-19 (owner, option "a" of the two this row used to list): exclude the prefix, keep the bucket.** What is COVERED: the gate manifests — cheap, republished by `publish_ebooks_manifest.py` (sync step 5.8) — and the `text/` packs, whose only publisher runs on the owner's machine. 🔴 What is NOT covered: `transcripts/`, because those objects **are themselves the third copy** — Whisper wrote them to the owner's disk, `sync_to_drive.py` mirrors that disk to Google Drive, and `app/core/ingest_transcripts.py` (in `audiobook_catalog`) uploaded them here as copy three. Re-tarring copy three nightly, 8 generations deep, on a corpus heading for ~13 GB raw / **~2.6 GB stored** at the measured 5× ratio, onto a **14 GB runner disk**, is the `estate-audio` argument arriving by a slower road. ⚠️ **A restore from these dumps does NOT contain transcripts — §6 says where they come from instead.** The rule is pinned by `apps/auth-worker/test/backups.test.ts`, so it can be neither deleted nor widened silently, and the bucket must NOT be dropped from the matrix to solve a future size problem: that would lose the half with no other copy and keep the half with three |
| R2 `estate-docs-gated` | the estate docs corpus (`docs.ts` / `estate-docs.md`) | Same mechanism → `estate-backups/r2/estate-docs-gated/<timestamp>.tar.gz`, **added 2026-08-18** | **Medium** — 2 objects / 1.27 MB, and ⚠️ the publisher that rebuilds it runs on the OWNER'S MACHINE and is the only place all three docs trees exist together. That is the whole reason it is worth a copy that does not depend on that machine |
| The five D1 exports, the Firestore dump, the five R2 dumps | **objects in the PRIVATE `estate-backups` R2 bucket**, one object per store per run at `<kind>/<store>/<UTC-timestamp>.<ext>`, retained 8 deep per store (`scripts/prune-r2-backups.mjs`, §3) | — | See §2 for why the D1 exports all land here regardless of which repo owns the source; see this file's top banner for why R2-not-artifacts as of 2026-08-15 |
| The four git repos themselves | GitHub (`skymitch9/*`) + this machine's working copies | **Already distributed — deliberately not duplicated here.** Every repo already exists in at least two places (GitHub + local clone); a third copy of source code is not what this runbook is for | N/A |
| OpenAudible library files (`.m4b`s, the owner's local media) | `C:\Users\nbasl\OpenAudible\books\<Author>\*.m4b` on this machine | **Google Drive sync**, per-author folders — `audiobook_catalog/scripts/sync_to_drive.py`, step of the 8h pipeline (`docs/access/README.md`'s 60-second orientation, `audiobook_catalog`) | N/A here — this is the one item in the inventory that already has a real, running backup story outside git/D1/Firestore entirely. Verified 2026-08-14: `docs/access/README.md` names it explicitly (*"Local audiobook library → ... → Google Drive"*) and `docs/DRIVE_AUDIT_REPORT.md` / `scripts/audit_drive_vs_local.py` exist to check the sync is honest. Nothing new needed here |

## 2. ⚠️ Why every D1 backup lands in `catalog-platform`, not in the repo that owns the database

> 🔴 **STALE EVIDENCE WARNING — RE-MEASURED 2026-08-18.** The visibility table
> below is from 2026-08-14 and **three of its four rows are now wrong**. All
> four repos are **PUBLIC** today:
>
> ```
> $ gh repo view skymitch9/<repo> --json visibility -q .visibility   # 2026-08-18
> catalog-platform    PUBLIC      (was private on 2026-08-14)
> library_catalog     PUBLIC      (was private on 2026-08-14)
> Board_Game_Catalog  PUBLIC
> audiobook_catalog   PUBLIC
> ```
>
> **This does NOT break anything**, and the reason is worth stating: the
> argument below is about *workflow artifacts*, and **no job in `backup.yml`
> uses artifacts any more** — every one writes into the **private
> `estate-backups` R2 bucket** (see this file's top banner). The bucket's
> privacy, not the repo's, is what protects a dump today.
>
> ⚠️ **What it DOES change is the docs rule:** *"back it up from the private
> repo"* is no longer a true sentence about any repo here, so **every tracked
> doc in every repo must be names-only, with no secret values** — there is no
> longer a private repo to relax that in. The one deliberately gitignored docs
> tree (`audiobook_catalog/docs/`) exists precisely because of this, and
> `docs/access/keys/*` is ignored for the same reason.
>
> The reasoning below is kept as history because the *conclusion* — one
> workflow, in one place, backing up all five D1 databases — is still right,
> and for a second reason it already gives: one visibility question to answer
> instead of four drifting ones. It just no longer rests on a privacy claim.

Evidence, gathered 2026-08-14 **(⚠️ two rows since falsified — see above)**:

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

### 3.0 ⚠️ It runs itself now — daily at 09:12 UTC (added 2026-08-18)

`backup.yml` was `workflow_dispatch`-only from 2026-08-14 to 2026-08-18. It now
also carries `schedule: - cron: '12 9 * * *'`. **A scheduled run always backs
up EVERYTHING** — a cron tick has no `inputs`, so each job's condition is
`github.event_name == 'schedule' || inputs.target == …`, and a partial
unattended backup would leave stores silently stale while the summary read
fresh.

**Why the posture changed.** The old comment said "same posture as deploy.yml —
a backup is a deliberate button-press, never a schedule". The owner decision
that inherited from (2026-08-14, now in [`DONE.md`](../DONE.md)) is about the
**deploy** workflows: *"these Workers have no dev lane, so the trigger stays a
deliberate human button-press."* That argument is about live blast radius — a
deploy changes what the estate serves. A backup writes new objects into one
private bucket and changes nothing anyone can reach. The credential objection is
answered rather than ignored: a scheduled run reaches the same two secrets by
the same GitHub-hosted path a dispatched run does, and never prints them.

**What the dispatch-only posture cost, measured** ([`RECOVERY.md`](RECOVERY.md)
§1c) over **under two days** of nobody pressing the button: `estate_auth` 6
migrations behind with every session and the whole 14-row grant audit trail
missing; `library-catalog` 5 migrations behind, +469 `change_log`, +245
`research_finding`, and the entire `ebook_holding` table (126 rows) absent;
`audiobook-covers` +103 objects.

**Why 09:12 UTC, and what it costs:**

| Question | Answer, measured 2026-08-18 |
|---|---|
| Actions minutes | **Zero billable.** `catalog-platform` is PUBLIC (`gh api repos/skymitch9/catalog-platform --jq .visibility` → `public`) and GitHub does not meter public-repo minutes. The API's own timing endpoint reports `total_ms: 0` for all 9 jobs of run `31937416822` |
| Wall clock | **144 s** for `target=all` (run `31937416822`); ~458 s of runner time across 9 jobs. Slowest jobs: `firestore` 124 s, `r2 game-covers` 128 s |
| Storage | The only real cost, bounded by the `retention` job at 8 generations/store |
| Why not on the hour | GitHub queues scheduled workflows in a burst at `:00`; the delay can run to tens of minutes. `:12` avoids it |
| Why that hour | ≈04:12 America/Chicago — after the household's day, so the snapshot catches it whole |

⚠️ **GitHub disables scheduled workflows on a repo after 60 days of no
activity** (it emails the owner first). If backups quietly stop, check
Actions → *Backup (daily + manual)* for the disabled banner **before**
suspecting the credentials.

⚠️ **Reverting is one block.** Delete the `schedule:` key from `backup.yml` and
the workflow is dispatch-only again; the `github.event_name == 'schedule'`
clauses become dead but harmless.

### 3.1 Running one by hand

**GitHub UI:** `skymitch9/catalog-platform` → Actions → *Backup (daily +
manual)* → Run workflow → choose `d1`, `firestore`, `r2`, or `all`.

**CLI:**

```bash
gh workflow run backup.yml --repo skymitch9/catalog-platform -f target=all
gh run list --repo skymitch9/catalog-platform --workflow=backup.yml --limit 3
gh run view <run-id> --repo skymitch9/catalog-platform
```

**Where backups land:** objects in the **private** `estate-backups` R2
bucket (no public access, no custom domain), one object per store per run,
named `<kind>/<store>/<UTC-timestamp>.<ext>`:

```
estate-backups/d1/library-catalog/20260815T191630Z.sql
estate-backups/d1/library-catalog-2nd/<timestamp>.sql        # added 2026-08-18
estate-backups/d1/board-game-catalog/20260815T191632Z.sql
estate-backups/d1/index_catalog/20260815T191634Z.sql
estate-backups/d1/estate_auth/20260815T191634Z.sql
estate-backups/firestore/audiobook-catalog/20260815T191635Z.tar.gz
estate-backups/r2/library-covers/20260815T191634Z.tar.gz
estate-backups/r2/audiobook-covers/20260815T191631Z.tar.gz
estate-backups/r2/game-covers/20260815T191634Z.tar.gz
estate-backups/r2/ebooks-gated/<timestamp>.tar.gz            # added 2026-08-18
estate-backups/r2/estate-docs-gated/<timestamp>.tar.gz       # added 2026-08-18
```

⚠️ **THE STORE LIST LIVES IN THREE PLACES AND THEY MUST AGREE** —
`backup.yml`'s job matrices (which WRITE), its `retention` step's argument list
(which PRUNES), and `KNOWN_BACKUP_PREFIXES` in
`apps/auth-worker/src/backups.ts` (which REPORTS staleness on `/status`). That
file's header had always *said* to update all three together, and the drill
found `library-catalog-2nd` missing from all three anyway. As of 2026-08-18 the
advice is a **mechanical guard**: `apps/auth-worker/test/backups.test.ts` parses
`backup.yml` and fails if any of the three lists differs from the others. Add a
store to one place, `npm test`, and the test tells you the other two.

D1 exports are the raw `.sql` file as-is. Firestore and R2-bucket dumps are
each a directory of many small files (a JSON per Firestore collection; a
`manifest.json` + one file per object for an R2 bucket dump) — `backup.yml`
tars+gzips each into a single `.tar.gz` before the `wrangler r2 object put`,
since R2 objects are written one key at a time and one archive beats
thousands of individual puts. Fetch any object directly:

```bash
npx wrangler r2 object get "estate-backups/d1/library-catalog/<timestamp>.sql" --file ./restored.sql --remote
npx wrangler r2 object get "estate-backups/firestore/audiobook-catalog/<timestamp>.tar.gz" --file ./fs.tar.gz --remote
tar xzf ./fs.tar.gz -C ./restore-work/firestore   # unpack before using restore-firestore.mjs (§5)
```

(`wrangler r2 object get` has no `-y`/`--force` flag — omit it, unlike `put`.)

**Retention: newest 8 objects per `<kind>/<store>` prefix**, pruned by the
workflow's own `retention` job (`scripts/prune-r2-backups.mjs`) on **every**
dispatch, regardless of `target` — it lists each prefix via the Cloudflare
REST API, keeps the 8 lexicographically-last keys (the UTC-timestamp keys
sort chronologically), and deletes the rest, logging every `keep:`/`delete:`
decision. This is deliberately much shorter-lived than the old 90-day
artifact retention — R2 storage isn't free the way artifacts nominally were.
At the new daily cadence 8 generations is **eight days** of history, not the
weeks-to-months a manual cadence gave; that is the deliberate trade for
bounding drift to a day rather than to whenever someone remembers.

⚠️ **"8 deep" was a SETTING and not yet a FACT — resolved 2026-08-18.** The
drill found the bucket holding **2** generations per store against a configured
8 and flagged it as possibly a prune bug. **It is not a bug: the system is
young.** This workflow only began writing into R2 (rather than uploading
artifacts) on 2026-08-15 evening, and exactly two runs had used that path —
`31903443263` (2026-08-15T19:16Z) and `31937416822` (2026-08-16T08:49Z). The
retention job's own log on the second reads `2 object(s), keeping 2, deleting
0` for all eight prefixes and `Deleted 0 object(s) total` — correct behaviour
for a bucket that has never held more than 8. **The daily cron is what makes 8
real:** it fills to depth in eight days, and the first genuine deletion is
expected on day nine. If the count is still stuck at 2 a week from now, *then*
suspect the prune.

**This is still not a long-term archive.** For anything that must
outlive the newest-8 window, download the object and keep it somewhere
durable (the same Drive account already used for the audiobook library, or
any offline copy).

### 3.2 ⚠️ One transient Cloudflare 500 used to lose a whole bucket

**Measured 2026-08-18, on the first run after the daily cron landed** (run
`32111218016`): `audiobook-covers` listed 1,972 objects, spent ~3 minutes
downloading them, and died on ONE object with

```
GET audiobook-covers/<key> failed (HTTP 500):
{"code":10001,"message":"We encountered an internal error. Please try again."}
```

Cloudflare's own error text says *"please try again"* and `backup-r2.mjs` did
not. Survivable while a backup was a button-press somebody watched; **not**
survivable unattended, where the failure mode is a bucket quietly missing from
a night's backup. `backup-r2.mjs` now retries — **narrowly, on purpose**:

- **5xx and 429 only.** A 401/403/404 is a real answer about permissions or a
  vanished key; retrying it turns a clear failure into a slow one.
- **4 attempts**, exponential backoff with jitter (~0.5 s / 1 s / 2 s). A
  dropped socket counts as the same class of problem as a 500.
- **Every retry is logged.** A bucket that only succeeds by retrying must read
  differently in the log from one that succeeded first time — a silent retry
  would hide a degrading bucket.
- **It still fails after the last attempt**, and the byte-size check and the
  zero-object rule are untouched. This survives a blip; it does not tolerate a
  broken bucket.

⚠️ **A failed job does NOT poison the others.** `fail-fast: false` on both
matrices means one bucket dying leaves the other four (and every D1 export, and
Firestore) landing normally — which is exactly what happened on that run: ten
of eleven stores were written and only `audiobook-covers` was missed. Check the
run's job list, not just its overall red/green.

### 3.3 ⚠️ `audiobook-covers` outgrew the uploader — dumps over 250 MiB are SPLIT

**Measured 2026-08-18** (run `32112007920`, immediately after §3.2's retry made
the download succeed): the archive built fine and the *upload* failed.

```
r2-audiobook-covers-<STAMP>.tar.gz is 328774189 bytes.     # 313.5 MiB
Error: Wrangler only supports uploading files up to 300 MiB in size
```

A hard ceiling (300 MiB = 314,572,800 bytes), not a blip, and **there is no way
round it with the credentials this estate has**: the plain Cloudflare REST
`PUT .../objects/{key}` carries the same limit, and multipart upload needs
S3-compatible access keys that deliberately do not exist here (§6's reasoning).

⚠️ **This is not a one-bucket problem.** `game-covers` measured **178,897,690
bytes (170.6 MiB)** the same day and is growing — 57% of the way to the same
wall. So the fix is generic, not special-cased: **any archive over 250 MiB**
(threshold set below the cap so there is headroom rather than a cliff) is split
into 200 MiB parts and uploaded as `<STAMP>.tar.gz.part-aa`, `.part-ab`, …
Restore concatenates them (§6, `RECOVERY.md` §5).

⚠️ **RETENTION HAD TO LEARN ABOUT THIS FIRST, AND IT IS THE DANGEROUS HALF.**
One generation is now potentially several keys. "Keep the newest 8 **keys**"
would let one split night fill the whole allowance and **delete every real
backup behind it**. `scripts/prune-r2-backups.mjs` therefore groups by
generation stamp (`scripts/lib/backup-keys.mjs`) and keeps the newest 8
**generations**, deleting a generation's parts *together* — a half-deleted
generation cannot be reassembled and must never exist.
`scripts/test/backup-keys.test.mjs` builds exactly that losing fixture and
asserts the new behaviour drops only the oldest night. `backups.ts`'s per-prefix
`count` counts generations for the same reason, less harshly: counting objects
would report one split night as nine backups and read healthier than the estate
is.

⚠️ **The last GOOD `audiobook-covers` backup before this fix was 2026-08-16.**
Two runs failed in between — one on §3.2's transient 500, one on this ceiling.

**Two secrets this workflow needs, both on `catalog-platform` only:**

| Secret | What | How to get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Already set (shared with `deploy.yml`) | dash.cloudflare.com/profile/api-tokens, "Edit Cloudflare Workers" template — D1 edit is already in scope. Verified 2026-08-15 (morning) it ALSO already covers R2's `objects` list/get REST endpoints. Verified again 2026-08-15 (this rewrite, via a throwaway smoke-test workflow) that it can also **write** R2 objects via `wrangler r2 object put --remote` — no dashboard change was needed. ⚠️ Nuance worth flagging, not fully resolved: `wrangler r2 object put`/`get` appear to go through a different auth path than the plain REST `GET .../objects` list endpoint (attempting the REST list locally with this session's own *OAuth* token failed with a generic "Authentication error", while `wrangler r2 object get/put` succeeded fine with that same OAuth session — and separately, the CI *API* token succeeds at both the REST list, per the `retention` job's logs, and at `wrangler put`). So "R2 write" and "REST list" may be gated by permission groups that don't map 1:1 to wrangler's read/write split the way §8's 2026-08-15-morning note assumed — if a future token rotation ever breaks ONE of these two paths and not the other, that's why, and the fix is still "add the missing R2 permission group to the token in the dash," just verify which one by testing both paths, not by assuming |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | The **full JSON content** (not a path) of a Firebase service account key for the `audiobook-catalog` project | Firebase console → `audiobook-catalog` → Project settings → Service accounts → Generate new private key → paste the whole file as the secret value: `gh secret set FIREBASE_SERVICE_ACCOUNT_JSON --repo skymitch9/catalog-platform < path/to/key.json`. The same credential `audiobook_catalog/scripts/firebase_service_account.json` already is — reusing it rather than minting a second key with the same power |

Both guard steps in `backup.yml` fail loudly with these exact instructions if
the secret is absent, so a bad dispatch cannot silently produce an empty
backup. No step in the workflow ever `cat`s a dump's contents to the log —
only paths, byte counts, and collection/object counts are printed; secret
VALUES are never printed and would be auto-masked by Actions even if they
were.

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

⚠️ **THE EXPORT DOES NOT REPLAY AS-IS FOR TWO OF THE FOUR DATABASES.**
Measured by the restore drill 2026-08-17 in two independent SQLite engines:
`library-catalog` dies at `no such table: main.edition` (after 5 of 27 tables)
and `board-game-catalog` at `no such table: main.app_user` (after 2 of 18) —
`wrangler d1 export` interleaves `CREATE TABLE` with `INSERT` in an order that
is not dependency order, so the import stops **half-populated while looking
like it worked**. `estate_auth` and `index_catalog` replay fine, which is
exactly why nobody noticed.

⚠️ **`node scripts/reorder-d1-dump.mjs <in> <out>` IS A MANDATORY STEP OF THIS
RECIPE, not an optional tidy-up** — and it is no longer only a drill artefact.
It has a regression test (`scripts/test/reorder-d1-dump.test.mjs`, run by
`npm run test:scripts` and by the root `npm test`) that feeds it the drill's
exact CREATE/INSERT interleave and **replays both versions in `node:sqlite`**:
the raw dump dies at `no such table: main.edition` having created exactly one
of four tables, and the reordered dump loads clean with every row present,
`PRAGMA foreign_key_check` empty and `integrity_check` = ok.
**[RECOVERY.md](RECOVERY.md) §3b** has the original evidence, the failed
`PRAGMA foreign_keys=OFF` workaround, and the FK-enforcement nuance (which that
test also pins).

For when Time Travel's window has passed, or you want the snapshot in a new
database rather than overwritten in place:

```bash
# Fetch the object from estate-backups first (§3), then:
npx wrangler r2 object get "estate-backups/d1/library-catalog/20260815T...Z.sql" --file ./library-catalog-restore.sql --remote
node scripts/reorder-d1-dump.mjs ./library-catalog-restore.sql ./library-catalog-restore.ordered.sql
npx wrangler d1 execute <database-id-or-name> --remote --file=./library-catalog-restore.ordered.sql
# then catch the schema up — a backup is N migrations behind by definition:
npx wrangler d1 migrations apply <database-name> --remote     # NB: rejects -y
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

### 4c. ⚠️ Restoring `estate_auth` is a SECURITY event — the tool now says so

`reorder-d1-dump.mjs` detects an `estate_user` table in the dump and, before
anything is imported, prints **the backup's own membership counts** (rows,
per-status totals, `is_approver = 1`, `is_devops = 1` — counts only, never a
name), the measured incident below, and the command that captures current
state. It then **exits 3** unless you pass `--yes-i-checked-membership`. The
reordered file is still written, so nothing is blocked; the non-zero exit only
stops an automated chain from walking straight into an import.

**The incident it exists for**, measured on the drill:

| | Backup 2026-08-16 | Live 2026-08-18 |
|---|---|---|
| approved | **12** | 11 |
| revoked | **0** | **1** |

Both `estate_user` row counts are 12 — so a count-based check passes, and a
blind restore silently **re-approves a member who has since been revoked**.
Revocation and post-seed authority live in this database and nowhere else, so
nothing in the estate can tell you afterwards that they were lost.

```bash
node scripts/reorder-d1-dump.mjs ./estate_auth.sql ./estate_auth.ordered.sql
# -> reads the warning block, exits 3

# capture what the restore will OVERWRITE (RECOVERY.md §3d):
npx wrangler d1 execute d94ffe45-4dd0-4dc2-86de-b8c4d649c1cb --remote --command \
  "SELECT id, status, is_approver, is_devops FROM estate_user ORDER BY id;"

# then acknowledge and proceed
node scripts/reorder-d1-dump.mjs ./estate_auth.sql ./estate_auth.ordered.sql \
  --yes-i-checked-membership
```

Re-apply every `revoked` status and every approver/devops flag by hand after
the import. `scripts/seed-estate.mjs` (§9) has the same blind spot for the same
reason.

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

✅ **THE TIMESTAMP CORRUPTION IS FIXED (2026-08-18).** It was real: this script
used to hand `backup-firestore.mjs`'s `{"_seconds":…,"_nanoseconds":…}` straight
to `batch.set()`, which wrote it back as a **map, not a timestamp** —
**2,139 timestamp-valued fields across all 56 collections**, every
`createdAt`/`updatedAt`/`addedAt`, breaking every `orderBy('createdAt')` and
every date rendering. Every document now passes through
`scripts/lib/firestore-timestamps.mjs` first, and **both** the dry run and the
commit PRINT how many values will be converted, per collection, so the scope is
never silent:

```
Targets (2):
  reviews  (878 docs, 1731 timestamps to revive)
  clubs    (3 docs, 6 timestamps to revive)

1737 serialized timestamp(s) will be written back as real Firestore
Timestamps, not maps (scripts/lib/firestore-timestamps.mjs — RECOVERY.md §4.2).
```

**Proven offline, with no Firestore write and no credential**, by
`scripts/test/firestore-timestamps.test.mjs`: dump → `JSON.stringify` →
reviver → the Firestore SDK's **own wire serializer** yields an identical
`{"timestampValue":{"seconds":"1782327950","nanos":558000000}}`, where the raw
round-trip yields a `mapValue`. The old broken behaviour is pinned as a test
too, so it cannot come back unnoticed. ⚠️ **The DUMP format did not change** —
it is lossless, merely not self-describing, and changing it would invalidate
every backup already in `estate-backups`. The one ambiguity accepted (a genuine
map whose only two keys are `_seconds`/`_nanoseconds`) is argued in that
module's header. **[RECOVERY.md](RECOVERY.md) §4.2** has the original evidence.

🟡 **UPDATE 2026-08-18 — there IS a rehearsal target now.** The paragraph below
says *"this project has no sandbox/staging Firestore instance, so there is no
target to rehearse a live write against that isn't the real thing."* That was
true when written and is not any more: **`estate-restore-drill`** exists, with
its own `(default)` Firestore database, created entirely from the CLI
([`RECOVERY.md`](RECOVERY.md) §4.3a). The `--commit` path is still unrehearsed,
but it is now blocked on one service-account key download (§4.3b of that file),
not on the absence of anywhere safe to point it.

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

**One object, from an unpacked `estate-backups` R2 dump or any local copy
(§3):**

```bash
npx wrangler r2 object get library-covers/<key> --file=./restored-cover.jpg --remote   # fetch (verify first)
npx wrangler r2 object put library-covers/<key> --file=./restored-cover.jpg --remote   # write it back
```

`--remote` is required on both — `wrangler r2 object` defaults to the local
Miniflare simulator, not the live bucket, and silently "succeeds" against an
empty local store if you forget it.

**Bulk restore from a `backup-r2.mjs` dump** (`manifest.json` +
`objects/<key>`, now stored as one `.tar.gz` object in `estate-backups` —
§3): fetch and unpack it, then loop the manifest and `put` every file back:

```bash
npx wrangler r2 object get "estate-backups/r2/library-covers/<timestamp>.tar.gz" --file ./r2-dump.tar.gz --remote
mkdir -p ./restore-work/library-covers && tar xzf ./r2-dump.tar.gz -C ./restore-work/library-covers

# ⚠️ audiobook-covers is SPLIT (§3.3) — fetch every part and concatenate first:
#   cat ./r2-dump.tar.gz.part-* > ./r2-dump.tar.gz
# A dump missing any part cannot be untarred at all. RECOVERY.md §5 has the loop.

node -e '
  const fs = require("fs");
  const { execFileSync } = require("child_process");
  const dir = process.argv[1];             // e.g. ./restore-work/library-covers
  const bucket = process.argv[2];           // e.g. library-covers
  const { objects } = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));
  for (const o of objects) {
    execFileSync("npx", ["wrangler", "r2", "object", "put", `${bucket}/${o.key}`,
      "--file", `${dir}/objects/${o.key}`, "--remote", "-y"], { stdio: "inherit" });
  }
' ./restore-work/library-covers library-covers
```

(This restores INTO the live `library-covers`/`audiobook-covers`/
`game-covers` bucket that content actually serves from — not into
`estate-backups`, which only ever holds the dump objects themselves.)

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
  `backup-r2.mjs` dump written by `backup.yml` into `estate-backups` is the
  only path back for an object with no other copy. Restore via the bulk loop
  above, or a single `wrangler r2 object put --remote` for one file.

### 🔴 `ebooks-gated`: the dump **does NOT contain the transcripts** (2026-08-19)

⚠️ **Read this before you go looking for `objects/transcripts/` in an
`ebooks-gated` tarball and conclude the backup is broken.** It is not there,
deliberately, by owner decision 2026-08-19. `scripts/backup-r2.mjs` drops the
`transcripts/` prefix at listing time (`scripts/lib/backup-exclusions.mjs`), so
every dump written from that date holds:

| In the dump | Not in the dump |
|---|---|
| `objects/ebooks.json`, `objects/audio_manifest.json` — the two gate manifests | `objects/transcripts/…` — every Whisper transcript |
| `objects/text/…` — the GABI chunk packs and `text/_index.json.gz` | |
| `manifest.json`, whose `objects` array lists **exactly** what `objects/` holds | |

**It is not silent, in either place.** The run log prints one line per rule per
run — matched or not — and this is the REAL line from the first run that carried
the change (`target=r2`, run
[`32262173445`](https://github.com/skymitch9/catalog-platform/actions/runs/32262173445),
2026-08-19T14:08Z, commit `dd1f960`):

```
Listed 295 object(s) in ebooks-gated.
ebooks-gated: SKIPPING prefix "transcripts/" — 72 object(s), 151282288 bytes NOT backed up. transcripts/ excluded by owner decision 2026-08-19 — triple-copied elsewhere; see backup-restore.md (…)
ebooks-gated: downloaded 223 object(s), 60329917 bytes total, …
::notice::r2-ebooks-gated-20260819T140806Z.tar.gz is 60295853 bytes.
::notice::Wrote estate-backups/r2/ebooks-gated/20260819T140806Z.tar.gz
```

⚠️ **MEASURED BEFORE AND AFTER, FOUR HOURS APART THE SAME DAY — and the growth
number is the part to read twice.** That morning's scheduled run
([`32239505996`](https://github.com/skymitch9/catalog-platform/actions/runs/32239505996),
09:48Z, the last one before the change) dumped the bucket whole: **249 objects,
155,253,227 bytes, a 155,031,041-byte (147.9 MiB) tarball.** The 14:08Z run,
with the exclusion, wrote **57.5 MiB — 61% smaller.**

🔴 **The transcript corpus went from 16 objects / 38.7 MB (2026-08-18) to 72
objects / 151.3 MB (2026-08-19). Roughly 4× in ONE DAY.** The §1 row's estimate
of "~2.6 GB eventually" was not pessimistic enough about the *rate*: at 147.9
MiB the whole-bucket tarball was already 59% of the way to the 250 MiB split
threshold (§3.3) and would have crossed it within days, then kept going toward
`wrangler`'s 300 MiB hard cap. This decision was made about a month away and
arrived with about a week to spare.

and the same statement is written into the dump's own `manifest.json` as an
`excluded` array, so a tarball opened at 3am declares its own cap without
needing this file. ⚠️ The bulk-restore loop above is therefore still correct:
`manifest.objects` never promises a file the dump lacks.

#### Where the transcripts DO come from in a disaster — in this order

1. **The owner's machine, first.** This is the master: Whisper wrote each
   transcript there, and `audiobook_catalog`'s ingest is what uploaded copies
   elsewhere. Re-running `app/core/ingest_transcripts.py` (in
   `audiobook_catalog`) re-publishes the prefix from disk — the same shape as
   `upload_ebooks_r2.py`'s relationship to `estate-ebooks` (§8).
2. **The Google Drive mirror of that machine**, if the disk is what was lost —
   the per-author sync (`sync_to_drive.py`) that already protects the `.m4b`
   library (§1's last row), which is why "the disk dies" is not the same event
   as "the transcripts are gone".
3. **`ebooks-gated/transcripts/` itself**, if the incident was anywhere else.
   This is the ordinary case and the reason the exclusion is safe: an incident
   that loses a D1 database, a Firestore collection or another bucket does not
   touch this prefix, and it is still sitting there.

🔴 **The residual risk, named rather than hidden** — exactly as `estate-ebooks`
names its own (§8): all three copies fail together only if the owner's disk,
his Drive **and** this R2 bucket are lost in one event. If that ceases to be an
acceptable bet — or if the transcripts stop being reproducible from the
machine — the fix is to give them their own bucket with its own backup, **not**
to re-enable a nightly whole-bucket tar that the 14 GB runner cannot carry.

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
| **`estate-ebooks` (R2)** — the ebook FILES, 168 objects / **1.81 GB** | ⚠️ **A judgement call, made 2026-08-18 and worth re-making if the facts change.** A local master exists and is authoritative: `audiobook_catalog/scripts/upload_ebooks_r2.py` re-uploads the whole bucket from disk, so this is *recoverable*, not lost. Backing it up would cost ~1.8 GB **per generation × 8 generations** to protect something a script already rebuilds. ⚠️ The residual risk is named rather than hidden: **that protection lasts exactly as long as the owner's disk.** | Add it to `backup.yml`'s `r2` matrix the day the local master stops being a safe assumption — or the day an off-Cloudflare copy exists to put it in (RECOVERY.md §9 item 7) |
| **`estate-audio` (R2)** | 🔴 **DECIDED 2026-08-18 — NEVER back this one up, and the old "add it the day it holds anything" line has been retired.** It filled: it now holds the **disaster-recovery ARCHIVE of the whole audiobook library**, 1,260 objects / **~685 GB** under the `archive/` prefix, seeded by `audiobook_catalog/scripts/archive_audio_r2.py` (hourly task `AudiobookArchiveR2`) on the owner's order — *"we lose this data we lose it all and the server isnt ready yet"*. ⚠️ **This bucket IS the backup.** Its master is the owner's local library disk; the whole point of the archive is to be the second copy. Tarring it into `estate-backups` would be a backup of a backup, 685 GB × 8 generations, on a runner with 14 GB of disk — **a 685 GB daily tar is not a backup, it is an outage**, and it would redden every other store's nightly run alongside it | **Nothing to add — ever.** `scripts/backup-r2.mjs` refuses it mechanically (`REFUSED_BUCKETS`; escape hatch is `BACKUP_R2_ALLOW_REFUSED=estate-audio`, deliberately awkward), because this exact table said "add it the day it holds anything" for months and prose does not stop a matrix edit. ⚠️ Separately: the `archive/` prefix must **never** be evicted or lifecycle-expired — `fulfill_audio_requests.evict_candidates()` refuses it in code. Restore procedure (rclone / boto3, free egress) is in `audiobook_catalog/docs/access/AUDIO_ARCHIVE.md` |
| **`ebooks-gated/transcripts/` (an R2 PREFIX, not a bucket)** | ✅ **OWNER DECISION 2026-08-19**, option "a" of the two `§1`'s row had been carrying: exclude the prefix, keep the bucket. ⚠️ **The deciding fact is the copy count, not the size.** Each transcript already exists three times before this job runs — the owner's disk (where Whisper wrote it), the Google Drive mirror of that disk, and this prefix, which `app/core/ingest_transcripts.py` created *as* the third copy. A nightly tar would make it the fourth through eleventh, on a corpus heading for ~13 GB raw / **~2.6 GB stored**, on a **14 GB runner** — the `estate-audio` argument at a prefix's scale. The rest of the bucket (`text/` packs, the two gate manifests) has **no other estate-side copy** and keeps full nightly cover, which is why this is an exclusion and not a refusal | **Give the transcripts their own bucket with its own backup** the day three copies stops being an acceptable bet, or the day they stop being reproducible from the owner's machine. ⚠️ **Never** by re-enabling a whole-bucket tar. Mechanically: `scripts/lib/backup-exclusions.mjs`, logged every run and written into every dump's `manifest.json`; pinned by `apps/auth-worker/test/backups.test.ts`. Restore-side consequences: §6 |
| **`estate-backups` (R2) — itself** | Backing the backup bucket up *into itself* is not a copy. It is 16 objects / 917 MB in one bucket, one account, one region | ⚠️ **This is an OPEN HOLE, not a settled call** — RECOVERY.md §9 item 7. An off-Cloudflare copy needs an owner decision about where it goes |
| **KV `estate_docs`** | **0 keys** (`wrangler kv key list` → `[]`, 2026-08-18). Nothing to lose today | Becomes a hole the day it is used; no backup path exists for it |
| `library-2nd-covers` (R2) | 0 objects as of 2026-08-18 | Same rule as `bgc-photos` below |
| `bgc-photos` (R2) | Exists in the account (`Board_Game_Catalog`) but is **unbound and holds 0 objects** as of 2026-08-15 (confirmed both via that repo's own `docs/HANDOFF.md` and a live listing) — feature not live yet, nothing to back up | Add a `bgc-photos` matrix entry to `backup.yml`'s `r2` job the day it goes live and starts holding real uploads |
| ~~R2 object listing is impossible without S3 keys~~ | **This claim from 2026-08-14 was wrong — corrected 2026-08-15.** `wrangler r2 object list` genuinely still doesn't exist, but the plain Cloudflare REST API (`api.cloudflare.com`, Bearer-token auth, the same style of credential `CLOUDFLARE_API_TOKEN` already is) has list AND get for R2 objects, gated behind the "Workers R2 Storage Read" permission group — not an S3-compatible access key/secret pair. The existing token already carried it; no new credential was needed. See §6 | The gap that drove this whole section is closed — `library-covers`, `audiobook-covers`, and `game-covers` are all now covered by `scripts/backup-r2.mjs` via `backup.yml`'s `r2` job |
| R2 bucket-level versioning / cross-bucket replication | **Does not exist as a native R2 feature** (checked 2026-08-14: R2's object-lifecycle docs cover retention/storage-class transitions only; the only replication-shaped feature, Super Slurper, is a one-way *inbound* migration tool from other clouds, not a backup mechanism; a community feature request for object versioning/replication is open and unimplemented). A DIY version could be built with R2 event notifications + Queues + a second bucket, but that's a project of its own | Time Travel-style "any point in the last N days" simply isn't available for R2 the way it is for D1 |
| A GCS-bucket-backed Firestore export (the `gcloud`/managed path) | Needs a Cloud Storage bucket in the same GCP project plus Storage Admin granted to the Firestore service agent — real new billed infrastructure for a household backup, when the Admin SDK can already read every document with the credential this estate already trusts and uses elsewhere | Worth building later if point-in-time GCS-native Firestore restore ever becomes worth the infrastructure; `scripts/backup-firestore.mjs`'s doc comment names this trade explicitly |
| ~~GitHub Actions workflow artifacts, as the backup destination~~ | **Retired 2026-08-15.** Artifacts on a public repo are one anonymous GitHub login away from anyone (§2's reasoning, generalized to every job not just D1) — and `catalog-platform` is public. Rather than keep the workflow parked on the private `estate-backups` repo forever (a second repo to keep scripts in sync with), every job now writes into the private `estate-backups` **R2 bucket** instead, so the workflow itself can live anywhere, including back here | None — no job in `backup.yml` uses `actions/upload-artifact` any more; grep for it and it is not there |
| A "last backup age" row on `/status` | Would read the `estate-backups` bucket's object listing (via a small Worker, since the status page has no server-side Cloudflare-API access today) and show how stale the newest object per store is | **Not built** — sized as a nice-to-have v2, logged in `docs/TODO.md` rather than built speculatively this session |

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
| `.github/workflows/backup.yml` | The workflow — §2's reasoning, §3's usage. `r2` job added 2026-08-15 morning; rewritten 2026-08-15 to write every job's output into R2 instead of artifacts, plus a `retention` job; **daily cron + `library-catalog-2nd` + `ebooks-gated` + `estate-docs-gated` added 2026-08-18** (§3.0). Its header carries the "which buckets are deliberately skipped, and why" list, beside the matrix it explains |
| `scripts/backup-firestore.mjs` | The Firestore dump tool §3/§5 use. ⚠️ Its collection list is `listCollections()` **discovery**, not an explicit list — measured 2026-08-18, which is why `readingPositions`/`discord_links` need no code change to be captured. What it gained is `EXPECTED_COLLECTIONS`: an expected-but-absent root collection now emits a `::warning::` and lands in `_summary.json` as `missingExpected`, so the next silent gap is visible in the run log instead of needing a drill |
| `scripts/restore-firestore.mjs` | The Firestore restore tool §5 uses — **revives timestamps as of 2026-08-18** |
| `scripts/lib/firestore-timestamps.mjs` | The reviver itself: pure, dependency-free, with the one accepted ambiguity argued in its header |
| `scripts/lib/d1-dump.mjs` | The dump splitter/reorderer + the `estate_auth` membership reader §4c prints from |
| `scripts/test/*.test.mjs` | The offline proofs for both of the above — `npm run test:scripts`, also run by the root `npm test`. No network, no credential, no write |
| `scripts/backup-r2.mjs` | The R2-bucket-content dump tool §6 uses — REST API list+get, added 2026-08-15 morning to close the gap this runbook named the night before. ⚠️ **Retries 5xx/429 with backoff as of 2026-08-18** — see §3.2. ⚠️ **Applies per-bucket prefix exclusions as of 2026-08-19** (§6's `ebooks-gated` block), and gained a `--dry-run` flag that lists + reports the exclusion accounting without downloading anything |
| `scripts/lib/backup-exclusions.mjs` | **The prefix exclusions themselves** — which prefixes inside an otherwise-backed-up bucket are skipped, and why. One entry today: `ebooks-gated/transcripts/`. Logged on every run whether it matched or not, and written into every dump's `manifest.json`; an exclusion that swallowed a whole bucket FAILS the backup rather than reporting an empty success. ⚠️ Not the same mechanism as `backup-r2.mjs`'s `REFUSED_BUCKETS` (whole-bucket refusal, `estate-audio`) — its header argues the difference |
| `scripts/prune-r2-backups.mjs` | Retention for the `estate-backups` bucket itself — REST API list+delete, keeps newest 8 per `<kind>/<store>` prefix, added 2026-08-15 (this rewrite) |
| `scripts/reorder-d1-dump.mjs` | Makes a `wrangler d1 export` dump replayable (§4b) — added 2026-08-17 by the restore drill, which found two of four exports die half-imported. **A mandatory step of the D1 restore path, with a regression test** (2026-08-18), and the place §4c's `estate_auth` warning is printed |
| `scripts/seed-estate.mjs` | `estate_auth`'s independent rebuild path, §9 |
| `docs/access/RECOVERY.md` | The drill-verified 3am runbook: per-store commands with measured times, the live stores with NO backup (`library-catalog-2nd`, `discord_links`, `readingPositions`, four R2 buckets, one KV), and an explicit NOT-verified list |
| `docs/access/index-worker.md` (in `library_catalog`) | The push protocol §7 restores by re-triggering |
