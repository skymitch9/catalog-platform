# Estate scripts inventory — what should become a route (2026-09-05)

> **Audience:** Claude sessions first, the owner second. **Status:** TRACKED.
> **Last verified: 2026-09-05.**
>
> **Why it exists.** Owner ask 2026-09-05 16:50 Phoenix: *"Should we make all
> the scripts routes? Or at least the ones we use a lot"* → *"Do inventory and
> audiobook. Then do the scripts you think are the best for routes."* This is
> the inventory half. The audiobook half is
> [`audiobook-association-route.md`](audiobook-association-route.md).
>
> ### ✅ What WAS measured on 2026-09-05
>
> | Claim | How |
> |---|---|
> | The 9 Windows scheduled tasks, their cadences, last-run times and last results | `schtasks /query /fo list /v` on this machine |
> | Every `[triggers] crons` string in all 5 platform Workers + library + games | `grep` over each `wrangler.toml` |
> | `audiobooks.heygabi.ai/catalog.csv` is publicly served | `curl -s -D -` → **200**, `text/csv`, 1,414,828 bytes, `Access-Control-Allow-Origin: *` |
> | The live CSV equals the on-disk CSV apart from line endings | byte diff against `audiobook_catalog/site/catalog.csv` — every differing line is CRLF-vs-LF only |
> | Script counts per repo | `ls` |
> | `packages/core/src/matching.ts` imports nothing outside `core` | `grep '^import'` |
>
> ### ⚠️ What was NOT verified
>
> - **Run frequency is measured ONLY where a scheduled task, a cron string or a
>   pipeline step names it.** Everywhere else the column says **unknown** and
>   means it — no `git log` archaeology was done to guess how often a human
>   typed a command.
> - **No script was executed**, not even a dry run. Classifications are read out
>   of headers and call sites, not from behaviour.
> - **No D1 database was read**, local or remote, on either library instance.
> - `audiobook_catalog/docs/` is **gitignored**; it was read, never written.
> - **The library's dated one-off scripts are GROUPED, not row-per-file** (see
>   §3.4). Every filename is named there; each was classified from its own
>   one-line header, and none was opened in full.
> - **The audiobook repo's `app/tools/*.py` are pipeline INTERNALS**, reached
>   through `sync_to_drive.py`, not independent entry points; §5.3 covers them
>   as a group rather than one row each.

---

## 1. The headline

**186 script files across four repos** (platform 22 · library 73 · games 11 ·
audiobook 51 + 29 internals), **63 npm scripts** in the library alone, **9
Windows scheduled tasks**, and **5 cron strings across 3 Workers**.

| Class | Count | What it means |
|---|---:|---|
| **ROUTE+CRON** | **7** | Recurring, idempotent, and every input is reachable from a Worker |
| **ROUTE-ON-DEMAND** | **6** | Admin-triggered; no clock, but no reason to need a laptop either |
| **STAY-SCRIPT** | **160** | One-off, migration, needs local disk, or needs a local credential |
| **RETIRE** | **4** | Superseded or done; kept only as history |

⚠️ **The ratio is the finding.** Only **13 of 186** should move. The estate's
scripts are overwhelmingly *dated one-offs* — `fix-wandering-inn-volumes-2026-09-02.mjs`
is not a candidate for anything, and turning it into a route would be strictly
worse than the file it already is. **"Make all the scripts routes" is the wrong
shape; "make the seven recurring ones routes" is the right one.**

### ⚠️ The cron budget is NOT the constraint it used to be

`apps/discord-worker/wrangler.toml:26` records the account moving to **Workers
Paid on 2026-08-17**, raising cron triggers **5 → 250 per account**. A first
attempt at that block was refused under Free with *"This account has reached the
Workers Free limit of 5 cron triggers per account"*. **In use today: 5 strings
across 3 Workers** — so there is room, and the seven ROUTE+CRON items below can
each have one.

---

## 2. What already has a route or a cron

⚠️ **Read this before proposing anything.** Three of the four repos already run
scheduled work in a Worker, and the patterns are settled.

| Owner | Trigger | Handler | What it does |
|---|---|---|---|
| `library_catalog` `apps/worker` | `crons = ["7 * * * *"]` (main **and** `[env.friend]`, same string deliberately) | `src/index.ts:321 scheduled()` → `lib/details-sweep.ts` | Hourly missing-details sweep. **The precedent for everything below.** |
| `Board_Game_Catalog` `apps/worker` | `crons = ["*/30 * * * *", "41 5 * * 1", "7 * * * *"]` | `src/index.ts:244 scheduled()`, dispatching on `event.cron` | Cover check · weekly component refresh · details sweep. **The precedent for MULTI-cron dispatch on one Worker.** |
| `catalog-platform` `apps/discord-worker` | `crons = ["*/2 * * * *"]` | `src/index.ts:1607 scheduled()` | GABI gateway alarm-chain backstop |
| `library_catalog` `apps/worker` | HTTP, machine token | `src/routes/audiobook-mapping.ts` | Machine export of the audiobook join key **in the other direction** — library → audiobook pipeline |
| `library_catalog` `apps/worker` | HTTP | `src/routes/ingest.ts` | Machine-token ebook importer |
| `catalog-platform` `apps/index-worker` | HTTP, bearer | `src/push.ts` `PUT /api/push/:source` | Snapshot-replace per source (`game`/`library`/`audiobook`/`library2`) |

**Two rules both existing `scheduled()` handlers follow, and any new one must:**

1. ⚠️ **The cron string is dispatched on, and an unrecognised cron does NOTHING,
   loudly.** `DETAILS_SWEEP_CRON` / `COMPONENT_REFRESH_CRON` must match the
   `wrangler.toml` string character for character; both repos have a test that
   reads the toml and asserts it.
2. ⚠️ **Return the promise AND `ctx.waitUntil` it.** `waitUntil` alone is a bug:
   a registered task is cancelled ~30s after the handler settles, and the
   sibling project measured roughly half its runs silently cancelled that way,
   with run rows stuck at `running` for eleven hours.

---

## 3. `library_catalog` — 73 scripts, 63 npm scripts

### 3.1 The recurring / candidate set

| Script (npm) | What it does | Reads | Writes | Actually run | Route today? | Class | Conf. |
|---|---|---|---|---|---|---|---|
| `backfill-audiobook-holdings.mjs` (`backfill:audiobooks`) | Matches our works to the sibling audiobook catalog; writes `audiobook_edition_holding` + `audiobook_series_holding` | **disk** `audiobook_catalog/site/catalog.csv`; D1 (`work`, `work_alias`, both holding tables) | D1, both instances | **≈3×/day, measured** — it is audiobook pipeline **STEP 11** (`sync_to_drive.py:3162 _run_sibling_link`), run for main then padhard with `--remote [--friend] --commit`, on the `AudiobookSyncPipeline` task (every 8h, 00/08/16 local) | no | **ROUTE+CRON** | **high** — see the [design doc](audiobook-association-route.md) |
| `backfill-series-volumes.mjs` (`backfill:series-volumes`) | Asks the audiobook catalog what volumes each series has; records "never heard of it" too | same disk CSV + D1 | D1 `series_volume` | unknown (no scheduled caller found) | no | **ROUTE+CRON** | **high** — identical input to the row above; converts for free once the CSV fetch exists |
| `covers-from-audiobooks.mjs` | Borrows cover art from the audiobook catalog for print rows with none | disk CSV + `site/covers/` **files** + D1 | D1 | unknown | no | **ROUTE-ON-DEMAND** | medium — the CSV half moves; the image half needs R2 (`audiobook-covers` is public, so reachable) |
| `check-cover-health.mjs` | HEADs every cover URL, reports broken ones and placeholder-sized files | D1 + **HTTP** | nothing (report) | unknown | no | **ROUTE+CRON** | **high** — pure HTTP + D1 read, zero disk, and a report nobody remembers to run is a report that never runs |
| `check-cross-catalog-overrides.mjs` (`check:cross-links`) | Holds the DB to the hand-reviewed cross-catalog joins | D1 + `scripts/*.json` overrides | nothing (report) | ⚠️ **its report line already runs every STEP 11** (inside `backfill:audiobooks`); the *failing* form is run by hand | partially | **ROUTE-ON-DEMAND** | medium — the overrides JSON would have to be bundled at build time |
| `audit-series-aggregates.mjs` (`audit:series-aggregates`) | Standing alarm for Open Library work-level aggregates (tier 3 of the bare-series rule) | D1 + **HTTP** (Open Library) | nothing (report) | unknown — described as "the standing alarm", which implies a cadence nothing enforces | no | **ROUTE+CRON** | medium-high — a *standing alarm* with no clock is the exact failure this ask is about |
| `audit-universes.mjs` | Whole-catalog universe audit, dry run, writes nothing ever | D1 + bundled universe list | nothing | unknown | no | **ROUTE-ON-DEMAND** | medium |
| `research-queue.mjs` | Runs the details queue to the end, offline | D1 + HTTP | D1 | unknown | ⚠️ **yes, effectively** — `lib/details-sweep.ts` is the hourly cron doing this work in-Worker | — | **RETIRE** *(as a routine)* | medium — keep as an attended bulk-drain tool, stop treating it as the mechanism |
| `sweep-plan.mjs` | "What would the next details-sweep tick plan?" — read only | D1 | nothing | unknown | no | **ROUTE-ON-DEMAND** | medium — a natural `/admin/sweep/plan` preview beside the cron that executes it |
| `check-clean.mjs`, `deploy-guard.mjs`, `deploy-done.mjs`, `for-both.mjs` | Deploy ceremony: refuse a dirty tree, refuse a stale live commit, log the deploy, run both instances | local git + `deploys.log` | `deploys.log` | **every deploy** — wired as `predeploy`/`postdeploy` | no | **STAY-SCRIPT** | **high** — they exist to guard the *local* tree; a Worker has no tree to guard |
| `sync-universes.mjs`, `sync-estate-auth.mjs`, `sync-estate-theme.mjs`, `sync-estate-search.mjs`, `sync-gabi-conversation.mjs` | Materialise shared platform assets into `packages/*/generated/` | sibling repo on **disk** | repo files | **every build** — `prebuild`/`pretest`/`pretypecheck` | no | **STAY-SCRIPT** | **high** — build-time codegen across repos; a route cannot write a repo |
| `push-secrets.mjs`, `op-cli.mjs`, `op-import-dev-vars.mjs` | Push `.dev.vars` / 1Password items to deployed Workers | **`.dev.vars`**, 1Password CLI | Worker secrets | unknown; per rotation | no | **STAY-SCRIPT** | **high** — a Worker must never be able to set its own secrets |
| `provision-catalog.mjs` | Stands up a third/fourth library instance from an accepted `catalog_request` | D1 + Cloudflare API + local repo | new Worker + D1 | owner-run, rare | no | **STAY-SCRIPT** | **high** — creates infrastructure; needs an account-scoped token |
| `sync-drive-map.mjs` | Copies the author → Drive folder map out of the audiobook catalog | sibling repo on **disk** | repo file | unknown | no | **STAY-SCRIPT** | medium |
| `seed-audiobook-aliases.mjs` (`seed:audiobook-aliases`) | Asserts the other names our books answer to, so `backfill:audiobooks` can reach them | D1 | D1 `work_alias` | on demand, when a match is missing | no | **ROUTE-ON-DEMAND** | medium — the aliases route already exists (`routes/aliases.ts`); this is a bulk seeder over it |
| `import-ebooks.mjs` (`import:ebooks`), `export-ebook-rows.mjs`, `plan-ebook-retirement.mjs` | The ebook split's import / export / retirement-plan halves | manifest + D1 | D1 | phase work, not recurring | no | **STAY-SCRIPT** | **high** |
| `backfill-ebook-holdings.mjs` (`backfill:ebooks`) | Derives `ebook_holding` rows from our own ebook editions | D1 only | D1 | unknown | no | **ROUTE+CRON** | medium — ⚠️ **D1-only, so it is the cheapest conversion in the estate**; it needs no external read at all |
| `research-queue.mjs` / `probe-universes.mjs` / `find-covers-tmp.mts` | LLM probes and a temp cover finder | D1 + LLM | varies | one-off | no | **RETIRE** (`find-covers-tmp.mts` — the name says so) / **STAY-SCRIPT** | medium |

### 3.2 The backfills that are genuinely one-shot

`backfill-covers` · `backfill-series` · `backfill-edition-kinds` ·
`backfill-missing-covers` · `backfill-missing-isbns` · `backfill-omnibus-collects` ·
`backfill-openlibrary-ids` · `backfill-read-from-ratings` · `backfill-review-keys` ·
`backfill-universes` · `backfill-work-covers` · `backfill-years` · `apply-pending-findings` ·
`seed-gap-verdicts` · `assess-bn-covers` · `apply-bn-details`

**All STAY-SCRIPT, confidence high.** Each fills a column that, once filled, is
maintained by the write path rather than by a sweep. `backfill-universes`'s own
header says *"re-run whenever the list grows"* — a real cadence, but one whose
trigger is **a human editing `data/universes.json`**, not a clock, so it belongs
in the platform repo's build, not in a cron.

### 3.3 Sweeps that already ran and are now historical

`sweep-signed-editions` · `sweep-special-editions` · `strip-mm-suffix` ·
`split-edition-note` · `fix-scanned-formats` · `fix-title-case` ·
`merge-ebook-import-duplicates` · `create-pledge-editions` · `add-pledge-copies`

**STAY-SCRIPT** (kept as history / re-runnable if the data regresses), except
**`add-space-knight-alias.mjs`** whose own header says **"⚠️ SUPERSEDED
2026-08-14 — kept for history, not for re-running"** → **RETIRE**, confidence
high (self-declared).

### 3.4 ⚠️ The dated one-offs — 20 files, all STAY-SCRIPT, all for one reason

`add-audio-corroboration-aliases` · `add-crowdfunded-works` ·
`add-crowdfunding-rescan-books` · `add-dcc-kickstarter` · `add-dcc-v1-hardcovers` ·
`add-dragoneye-realmkeeper-set` · `add-sweep-aliases` ·
`blank-cosmere-series-2026-08-15` · `fix-battle-mage-farmer-title-2026-09-05` ·
`fix-retailer-publishers-2026-09-02` · `fix-series-spelling-2026-08-15` ·
`fix-wandering-inn-volumes-2026-09-02` · `fix-worlds-beyond-number` ·
`import-crowdfunding` · `import-illumicrate-percy-jackson` · `import-shop-orders` ·
`mark-divine-dungeon-omnibus` · `backfill-omnibus-collects` ·
`add-crowdfunding-rescan-books` · `find-covers-tmp.mts`

**Every one is a dated, hand-reviewed data correction against production.**
A route would give each an *endpoint that can be called twice* — which is
exactly the property a one-off correction must not have. **They are correct as
files, confidence high.** ⚠️ Classified from one-line headers only; none was
opened in full.

---

## 4. `catalog-platform` — 22 scripts

| Script | What it does | Reads | Writes | Actually run | Route today? | Class | Conf. |
|---|---|---|---|---|---|---|---|
| `backup-docs.mjs` | Backs up the four `docs/` trees git does not carry | **local docs trees** | R2 `estate-backups` | **daily 03:00, measured** — task `EstateDocsBackupR2`, last run 2026-09-05 03:00, result 0 | no | **STAY-SCRIPT** | **high** — its whole input is files on this machine |
| `backup-firestore.mjs` (`backup:firestore`) | Recursive per-collection Firestore JSON dump via a service account | Firestore | disk + R2 | unknown cadence | no | **STAY-SCRIPT** | medium — a Worker *can* sign a service-account JWT, but the dump lands on disk today and the recovery doc depends on that |
| `backup-r2.mjs` | Full object dump of R2 buckets via the Cloudflare REST API | R2 (HTTP) | **disk** | unknown | no | **STAY-SCRIPT** | **high** — disk is the point; an R2 backup stored in R2 is not a backup |
| `mirror-estate-backups.mjs` | Copies `estate-backups` somewhere that is not Cloudflare | R2 | **disk** | **≈3×/day** — audiobook pipeline **STEP 10** | no | **STAY-SCRIPT** | **high** — same reason |
| `prune-r2-backups.mjs` | Keeps the newest N objects per `<kind>/<store>/` prefix, deletes the rest | R2 (HTTP/binding) | R2 | unknown | no | **ROUTE+CRON** | **high** — ⚠️ **pure R2 list + delete, no disk, no local credential.** Retention that depends on a human remembering is not retention |
| `push-storage-board.mjs` | Measures every R2 bucket, merges a `storage` section into the agent board | Cloudflare API | board draft → auth Worker | **every 15 min, measured** — task `EstateProcessingBoardPush` runs it alongside `push-processing-board.mjs` | no | **ROUTE+CRON** | **high** — the measurement half is pure API; only the *draft merge* is local, and that is a design choice, not a constraint |
| `push-processing-board.mjs` | The home machine's half of the agent board — local job state | **local logs, local processes** | auth Worker | **every 15 min, measured** (same task) | no | **STAY-SCRIPT** | **high** — it reports *about this machine*; a Worker cannot see it, by definition |
| `push-logs-board.mjs` | Tails the home-machine job logs into the board draft | **local logs** | board draft | with the task above | no | **STAY-SCRIPT** | **high** — same |
| `push-agent-board.mjs` | POSTs the conductor's board JSON to the auth Worker | local draft file | auth Worker | per conductor run | no | **STAY-SCRIPT** | **high** |
| `report-claude-usage.mjs` | Posts a Claude usage reading to the status page | a reading taken by browser automation | auth Worker | per reading | no | **STAY-SCRIPT** | **high** — the *measurement* is a browser session, which no Worker has |
| `predeploy-check.mjs` (`check:home`/`verify:home`) | The mechanical guard on the heygabi.ai front door | local tree + live site | nothing | **every `deploy:home`** | no | **STAY-SCRIPT** | **high** |
| `deploy-auth.mjs` (`deploy:auth`) | Clean tree → typecheck → tests → **migrate** → deploy → log line | local tree | `deploys.log`, Cloudflare | per deploy | no | **STAY-SCRIPT** | **high** |
| `gen-universe-names.mjs` | Projects `data/universes.json` into a TS module for the auth Worker | repo data | repo file | build time | no | **STAY-SCRIPT** | **high** |
| `tools/universes.mjs`, `tools/series-canon.mjs` (`universes`, `series-canon`, `validate`) | Edit + validate the shared universe list and series canon | repo data | repo data | per edit; `validate` in CI | no | **STAY-SCRIPT** | **high** |
| `tools/estate-probes/run.mjs` (`probe:estate`) | Estate-wide live probes (incl. Firebase authorized domains) | live hosts (HTTP) | report | unknown | no | **ROUTE+CRON** | **high** — ⚠️ this is the tool that would have caught the *2026-08-16 authorised-domain incident* recorded in the global rules, where a 40-minute-old reading was quoted as current. A probe suite with no clock is a stale reading generator |
| `catalog-key-mint.mjs`, `op-import-keys.mjs`, `op-rotate-pair.mjs`, `push-discord-secret.mjs` | Key ceremony: mint the provisioning keypair, import raw key files into 1Password, rotate a master-less pair, push one named secret | **`docs/access/keys/`, `.dev.vars`, 1Password CLI** | Worker secrets, vault | owner ceremony | no | **STAY-SCRIPT** | **high** — ⚠️ **never a route.** These read secret VALUES from local files; a route form would be an exfiltration endpoint |
| `reorder-d1-dump.mjs`, `restore-docs.mjs`, `restore-firestore.mjs` | Disaster-recovery tooling (`docs/access/RECOVERY.md` calls them) | local dumps | Firestore / disk | drill only | no | **STAY-SCRIPT** | **high** — recovery runs when the platform is *down*; it must not need the platform |
| `seed-estate.mjs` | Seeds the estate directory, dry-run by default | data | auth D1 | one-off | no | **STAY-SCRIPT** | **high** |
| `scripts/audit/estate-audit.workflow.mjs` | The estate audit workflow | four repos on **disk** | report | per audit | no | **STAY-SCRIPT** | **high** |
| `onedrive-exclude.ps1` | Stops OneDrive syncing `node_modules` / `.claude` | local filesystem | local filesystem | machine setup | no | **STAY-SCRIPT** | **high** |

⚠️ `scripts/lib/*.mjs` (10 files) are **helper modules, not entry points**, and
carry no row.

---

## 5. `Board_Game_Catalog` — 11 scripts, and `audiobook_catalog` — 51 + 29

### 5.1 Games

| Script | Class | Why |
|---|---|---|
| `check-clean.mjs`, `deploy-guard.mjs`, `deploy-done.mjs`, `instance-guard.mjs` | **STAY-SCRIPT** (high) | Local-tree deploy ceremony, identical to the library's |
| `sync-estate-auth.mjs`, `sync-estate-search.mjs`, `sync-estate-theme.mjs` | **STAY-SCRIPT** (high) | Build-time codegen from the platform repo on disk |
| `push-secrets.mjs` | **STAY-SCRIPT** (high) | Reads `.dev.vars` |
| `provision-catalog.mjs` | **STAY-SCRIPT** (high) | Creates infrastructure |
| `rehost-covers.mjs` | **RETIRE** (high) | Its own header says **"the one-time games cover rehost"** — done |
| `measure-matcher.ts` | **STAY-SCRIPT** (high) | A measurement harness for the containment floor; a research instrument, not an operation |

⚠️ **The games Worker is the estate's best-developed `scheduled()`** — three
crons, one handler, dispatched on `event.cron`, with the minute deliberately
staggered (`41 5 * * 1`, not `:00`/`:30`) so two invocations never compete for
the same subrequest budget. **Copy this file's shape, not the library's**, when
a Worker needs its second cron.

### 5.2 Audiobook — the scheduled surface (all measured 2026-09-05)

| Task | Cadence (measured) | Last run / result | Entry | Class |
|---|---|---|---|---|
| `AudiobookSyncPipeline` | every **8h** from 00:00 | 2026-09-05 16:00, **0** | `sync_pipeline_8h_hidden.vbs` → `sync_to_drive.py` | **STAY-SCRIPT** — it moves files on this machine and on Drive |
| `AudiobookIngestNightly` | every **30 min** | 2026-09-05 16:30, **0** | `app.tools.ingest_books --run --opportunistic` | **STAY-SCRIPT** — Whisper on the local GPU |
| `AudiobookPipelineWatcher` | every **3 min** | 2026-09-05 16:57, **0** | `app.tools.pipeline_watcher` | **STAY-SCRIPT** — it exists *because* there is no inbound port |
| `AudiobookDrivePoll` | every **15 min** | 2026-09-05 16:59, **0** | `app.tools.drive_poll` | **STAY-SCRIPT** — Drive changes API + a persisted `startPageToken` |
| `AudiobookFsWatcher` | every **1 min** | 2026-09-05 16:59, **0** | `app.tools.fs_watcher` | **STAY-SCRIPT** — watches the local filesystem |
| `AudiobookArchiveR2` | **hourly** | 2026-09-05 16:05, **0** | `scripts.archive_audio_r2 --commit` | **STAY-SCRIPT** — uploads local audio bytes |
| `AudiobookDriveAudit` | **weekly, Sun 02:00** | 2026-08-30 02:00, **0** | `scripts/drive_audit.py` | **ROUTE+CRON** *(medium)* — Drive-side duplicate detection is a pure API question; ⚠️ it needs the Drive OAuth refresh token to move to a Worker secret first |
| `EstateDocsBackupR2` | **daily 03:00** | 2026-09-05 03:00, **0** | `catalog-platform/scripts/backup-docs.mjs` | **STAY-SCRIPT** |
| `EstateProcessingBoardPush` | every **15 min** | 2026-09-05 16:45, **0** | `push-processing-board.mjs` + `push-storage-board.mjs` | split — see §4 |

🔴 **Two findings the audiobook repo's own `docs/info/pipeline.md` contradicts.**
That doc (Phase A) lists **`AudiobookFsWatcher`** and **`AudiobookDrivePoll`** as
*"built, NOT registered"* and *"inert until the owner registers the task"*.
**Both are registered and both ran at 16:59 today with result 0.** The doc is
stale by at least one owner action. ⚠️ That repo's `docs/` is gitignored and
read-only to this agent — the correction is listed as an action in
[`../TODO.md`](../TODO.md), not made here.

🟡 **`scripts/run_purchase_audit.bat` exists with no scheduled task.** Eight of
the nine `.bat`/`.vbs` pairs have a registered task; `run_purchase_audit` does
not. Either it was retired or its task was lost. **Unknown which** — an owner
question, not a classification.

### 5.3 Audiobook — the rest

- **`scripts/*.py` (51).** Dominated by Drive/OAuth operations
  (`drive_pull`, `drive_dedup`, `drive_role_parity`, `reclaim_drive_files`,
  `reclaim_others`, `check_drive_links`, `merge_author_maps`,
  `update_drive_map`), local-file operations (`rename_epubs`, `sort_ebooks`,
  `fix_epub_titles`, `transcribe_audiobook`, `generate_test_book`), R2 uploads of
  **local bytes** (`upload_audio_r2`, `upload_covers_r2`, `upload_ebooks_r2`,
  `upload_transcripts_r2`, `publish_*_manifest`), and dated migrations
  (`migrate_folder_names`, `migrate_tbr_to_uid`, `revert_author_moves`,
  `backfill_pack_titles`, `backfill_club_claims`).
  **All STAY-SCRIPT, confidence high** — every one either touches the local
  library on disk, holds a Google OAuth refresh token, or is a dated migration.
- **The six `smoke_*_rules.py`** smoke the **live** `firestore.rules` gates via
  the REST API. **ROUTE-ON-DEMAND, medium** — they are pure HTTP and would make a
  good post-deploy check, but they assert *security rules*, and a permanently
  reachable endpoint that exercises auth gates is a worse idea than a command
  somebody runs.
- **`health_check.py`** — pipeline status summary. **ROUTE-ON-DEMAND, medium**:
  the estate already has `/api/health` envelopes and a `/status` page; this is a
  candidate to *feed* them rather than to become a second surface (⚠️ see the
  global rule — *one fact, one home, applies to surfaces too*).
- **`promote_and_verify.py`** — the whole "Promote to Prod" ceremony as one
  command. **STAY-SCRIPT, high** — it deploys.
- **`app/tools/*.py` (29)** are **pipeline internals** reached through
  `sync_to_drive.py`, not independent entry points, and carry no rows.
  The four with their own task are in §5.2.

---

## 6. The rule this inventory produces

**A script should become a route when all four are true.** Every ROUTE+CRON row
above passes all four; every STAY-SCRIPT row fails at least one.

| # | Test | The row it kills |
|---|---|---|
| 1 | **It recurs.** There is a real cadence, not a date. | Every §3.4 one-off |
| 2 | **Every input is reachable from a Worker** — HTTP, D1, R2, or a bundled file. Not local disk, not a local process, not a local git tree. | `push-processing-board`, every `sync-*`, the deploy ceremony |
| 3 | **It needs no credential that must not leave this machine.** | The key ceremony, `push-secrets`, `provision-catalog` |
| 4 | **It is idempotent, and a second run is cheap.** | Every dated correction — an endpoint that can be called twice is exactly wrong for them |

⚠️ **And one rule about what a conversion must NOT do:** *the matcher, the fold,
the threshold does not get copied.* `packages/core/src/matching.ts` opens with
three wrong-game matches the games catalog shipped, **every one from a second
similarity function drifting from the first.** A route and its script share ONE
implementation in `packages/core`, or the conversion has made the estate worse.

---

## 7. Ranked next candidates, after the audiobook route

| # | Convert | Why it is next |
|---|---|---|
| **1** | `backfill:audiobooks` → library Worker cron + on-add hook | The owner's actual complaint. Design: [`audiobook-association-route.md`](audiobook-association-route.md) |
| **2** | `backfill:series-volumes` → the same cron | **Same input, same fetch, same instance pair** — once the CSV fetch and the shared parser exist, this costs one function. Two audiobook-derived tables that fall out of step is a worse bug than either being stale |
| **3** | `prune-r2-backups.mjs` → platform Worker cron | Pure R2 list+delete, no disk, no local key. **Retention that depends on somebody remembering is not retention**, and the estate's backup docs already treat retention as a promise |
| **4** | `tools/estate-probes/run.mjs` → platform Worker cron + `/status` line | Pure HTTP against live hosts. This is the suite that catches an authorised-domain change *before* somebody quotes a 40-minute-old reading as current — the exact 2026-08-16 incident in the global rules |
| **5** | `check-cover-health.mjs` → library Worker cron | D1 read + HTTP HEAD, nothing else. Broken covers are the estate's most visible silent rot, and both instances need it |

Honourable mention, not ranked: **`backfill:ebooks`** is **D1-only** and so is
mechanically the cheapest conversion available — but it derives one internal
table from another, so nothing goes stale between runs and the payoff is small.

---

## 8. What this inventory refuses to recommend

- **Turning the deploy ceremony into routes.** `check-clean`, `deploy-guard`,
  `deploy-done` and `predeploy-check` exist to guard a *local working tree*
  against a deploy. A Worker has no tree. Converting them would delete the
  guard and keep the ritual.
- **Turning any key script into a route.** `catalog-key-mint`, `op-import-keys`,
  `op-rotate-pair`, `push-discord-secret` and `push-secrets` read secret VALUES
  off local disk. A route form is an exfiltration endpoint with a nice name.
- **Turning the dated corrections into routes.** See §3.4.
- **Adding a second status surface** for anything already on `/status` or
  `/api/health`. A number worth showing twice is a number that will eventually
  disagree with itself.
