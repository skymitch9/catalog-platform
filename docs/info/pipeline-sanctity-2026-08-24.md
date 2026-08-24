# Pipeline sanctity review — OpenAudible → sort → upload, and the nightly ingester

> **Audience:** Claude sessions + the owner.
> **Status:** TRACKED.
> **Last verified:** 2026-08-24.
>
> ⚠️ **This is a READ-ONLY code review. Nothing was run, deployed, or exercised.**
> A live `AudiobookSyncPipeline` run was in flight during the review (manually
> kicked ~22:27) and was deliberately not touched. Every claim below is from
> reading source in `bookbuddy/audiobook_catalog`, not from observing behaviour.
> Line numbers are against the files as read on 2026-08-24. Where I say a thing
> "has never fired", that is the target repo's own docs saying so
> (`docs/info/book-ingestion.md` §10), re-stated, not re-measured here.
>
> Files read in full: `scripts/sync_to_drive.py` (all 2919 lines),
> `app/core/pipeline_lock.py`, `app/core/pipeline_schedule.py`,
> `app/pipeline_status.py`, `app/tools/ingest_books.py`,
> `app/tools/pipeline_watcher.py`, `app/author_names.py`,
> `app/metadata.py:296` (COMPANION_EXTS), plus `docs/info/book-ingestion.md`,
> `docs/access/PIPELINE.md`, `docs/KNOWN_ISSUES.md`.

---

## Verdict in one line

The pipeline is **soundly engineered and unusually well-defended** — the
single-flight lock, the fail-loud/defer split, the four honest upload classes,
the "named skip never silence" discipline, and the estate steps' own-failure-
domain isolation are all correct and battle-tested. The gaps are at the
**edges**: one lock that is weaker than its sibling, a stale-reclaim window that
a genuinely long run can cross, a Drive-duplicate path on shelf re-file, and a
large surface of **shipped-but-never-exercised** new code.

---

## 1. Correctness

**The sort (`sort_books`, `sort_companion_files`) is correct and idempotent for
the normal cases**, with every skip named rather than silent:

| Edge case | Handling | Verdict |
|---|---|---|
| Missing author tag | `[SKIP] No author metadata` (`sync_to_drive.py:276`); file left in the OpenAudible root | Correct, but see the limbo note below |
| Already-filed book | `dest.exists()` → `[EXISTS]` (`:286`) | Idempotent ✅ |
| Companion files | `sort_companion_files` matches loose PDF/EPUB/MOBI/AZW3 to an audiobook by normalised stem (`:313-369`); unmatched are left as standalone ebooks and **counted** (`:366`) | Correct ✅ |
| Non-book files (the KindleForPC installer) | Filtered by extension — only `.m4b/.m4a/.mp4` sort, only `COMPANION_EXTS={.pdf,.epub,.mobi,.azw3}` file as companions (`app/metadata.py:296`); a `.exe` matches neither | Correct ✅ |
| Container sample book | `"welcome to openaudible"` excluded by name (`:257`) | Correct ✅ |
| Multi-author tags | `get_author_name` splits on `[;,/&]| and `, then ranks by `priority_authors.json`, else first (`author_names.py:95-127`) | Correct ✅ |
| Shelf vs Drive identity | Two deliberately-separate maps — `author_shelf_aliases.json` (shelving) vs `author_aliases.json` (Drive routing); the 2026-08-09 merge incident is guarded against by keeping them apart and rejecting `__FOLDER_ID__` rows in the shelf map (`author_names.py:152-161`) | Correct, and the right design ✅ |

**Idempotency of the whole run is genuine** and largely rests on two things:
(a) `dest.exists()` in the sorters, and (b) `check_file_exists_on_drive`
deduping by filename before every upload (`:673-697`), so a crash that loses the
manifest self-heals — the next run re-detects the files, finds them on Drive
(`already_on_drive`, not `uploaded`), and re-records them. The four upload
classes (`uploaded` / `already_on_drive` / `misplaced` / `failed`) are kept
honestly distinct and only `failed` moves a run to `partial`
(`UploadOutcome.run_state()`, `:827-832`) — this is correct and was a real past
bug-fix.

### Two correctness edges worth naming

- **🟡 Cross-folder Drive duplicate on a shelf re-file.** The manifest is keyed
  by **relative path** (`detect_new_books`, `:425-427`). If a book is re-shelved
  from `Author A/` to `Author B/` (an alias change, exactly the "shelf map
  rewrites the library" behaviour the sorter docstring warns about at `:234`),
  its rel-path key changes, so it is re-detected as new. `check_file_exists_on_drive`
  only queries the **target** folder (`:681-690`), so it uploads a second copy
  into `Author B/` on Drive while the `Author A/` copy remains. It self-corrects
  only at the weekly `AudiobookDriveAudit` (duplicate detection). Not silent, but
  not free either.
- **🟡 No-author limbo.** A file with no `©ART` tag can never be sorted (no
  author) and is reported `misplaced` on every subsequent run (`_file_is_misplaced`,
  `:835-841`) — it is surfaced by name each cycle, never uploaded, never filed.
  This is the intended "human judgment" boundary and is correctly *loud*, but a
  no-author file has no human-fixable path short of re-tagging; it will warn
  forever until someone tags it.

---

## 2. Robustness

**Failure surfacing is excellent.** Every estate step (5.5–5.11, 7–11) is an
independent failure domain that WARNs and continues; the previous published
artifact keeps serving; the next cycle retries. Upload retries are resumable
with exponential backoff (`upload_file_to_drive`, `:731-776`). `pipeline_status`
can **never** raise (every function swallows; no-op without credentials). This
is the right stance throughout.

**Atomicity / partial-state map:**

| Failure point | State left behind | Self-heals? |
|---|---|---|
| Upload fails after N retries | That file → `failed`, run → `partial`; manifest not written for it | ✅ next run retries |
| Crash mid-upload-batch | Manifest for already-uploaded files this run is lost (saved once at end, `:1269`) | ✅ Drive dedup re-records them next run (costs a full re-scan) |
| Crash between steps | Soft steps re-run; catalog/index are replace-semantics | ✅ |
| A step raises | Caught → WARN; run continues | ✅ |
| Lock left held by a **clean** exception | `try/finally` releases it (`:996`, `:1650`) | ✅ |
| Lock left held by a **hard kill** of the sync pipeline | `pipeline_lock` PID-liveness reclaims instantly (`pipeline_lock.py:121-155`) | ✅ |

### 🔴 The one robustness hole that matters: the ingest lock is weaker than the pipeline lock

`app/tools/ingest_books.py`'s `_Lock` (`:81-114`) is **time-only, 12 h stale, no
PID-liveness check**. Compare `app/core/pipeline_lock.py`, which reclaims the
instant a holder's PID is dead via `OpenProcess`+`GetExitCodeProcess`
(`:121-155`), *precisely* to cover crash/kill/reboot.

Consequence: a **hard** loss of the ingester process (power blip, Task-Manager
kill, OOM-kill of the parent, reboot) at, say, 00:20 leaves
`output_files/ingest_books.lock` present for up to **12 h** — so every one of the
30-minute invocations for the rest of the 00:00–08:00 window sees the lock and
exits. That is *exactly* the "a crash at 00:20 costs the whole night" failure the
30-minute cadence is documented to prevent (`PIPELINE.md:114`,
`book-ingestion.md:796`). The cadence self-heals a **soft** crash (a Python
exception runs `__exit__`; a Whisper *subprocess* segfault doesn't kill the
parent) but NOT a hard one — and 12 h being deliberately "longer than the 8 h
window" is what defeats the recovery for the whole window. The fix already
exists one module over.

### Other robustness notes

- **🟡 `pipeline_lock` STALE_LOCK_HOURS = 4 can reclaim a live, honest run.**
  `_is_stale` returns True on age alone when the PID is still alive
  (`pipeline_lock.py:200-207`). A large upload backlog over a home uplink can
  cross 4 h (≈100 books × 60–90 s ≈ 2.5 h; ≈200 ≈ 5 h, using PIPELINE.md's own
  "~1 GB ≈ 60–90 s"), at which point the next 8 h scheduled trigger reclaims the
  lock and runs **concurrently** with the still-working run — the single-flight
  guarantee the lock exists for. Latent (observed runs are seconds-to-minutes per
  the lock's own comment, `:44-49`), not active, but there is no heartbeat that
  refreshes `started_at` during a long upload, so the ceiling is the only
  defence. A wedge-vs-working run cannot be told apart by age.
- **🟡 Two pipelines share `ROOT_DIR` under independent locks.** The 8 h
  `AudiobookSyncPipeline` (moves files) and the 30 min `AudiobookIngestNightly`
  (reads/transcribes files) use *different* locks and can run at the same time.
  Real risk is low — the sorter only moves *loose new* files and skips
  already-filed books (`dest.exists()`), and a book being ingested is already
  filed — but the interaction is undocumented and the two systems have no shared
  exclusion.
- **🟢 Manifest never prunes.** Stale keys for moved/deleted files accumulate in
  `upload_manifest.json` forever. Harmless (membership test only), untidy.
- **🟢 Drive OAuth failure is surfaced correctly** as a hard `finish_run("failed")`
  with an actionable message (`:1227-1232`) — a scheduled run can't silently
  stall on it.

---

## 3. The window + pause + trigger-deferral — coherent

The three sub-systems fit together correctly:

- **The 12am–8am window** is computed explicitly from UTC (`phoenix_now()`),
  never from local time, so re-homing the machine can't silently move it
  (`book-ingestion.md` §2.1). 07:45 soft no-new-starts + 08:00 hard close, with
  the deadline gate spending the buffer between them. Coherent.
- **`pause_mode` (built this session)** is well-designed: **fail-closed** —
  absent or unrecognised means `"all"` (stop everything), the only unlocking
  value is the exact string `manual_only`, and three independent readers
  implement the same rule. `--now` is treated as a manual start (`window_ok=False`
  passed *explicitly*, `ingest_books.py:593` + comment) so `manual_only` never
  lets a hand-run at 2am through. The scope limits are right: it governs `paused`
  / `paused_until` only, never `pause_windows` / `dont_check_until` / the
  unreadable-control branch. Resume/Start-now reset it. This is careful work.
- **`dont_check_until` vs `paused`** are correctly kept as *different*
  instructions (spend-nothing vs considered-refusal), not stronger/weaker
  versions of one.
- **Scheduled-vs-manual deferral** is coherent: only `PIPELINE_TRIGGER=scheduled`
  defers (up to 2 h, non-stacking, capped so it can't drift into the next 8 h
  slot — `pipeline_schedule.py`); every other trigger fails loud and immediately.
  The default flipped from `scheduled` → `manual` (`:2881-2894`) so a human's
  blocked run tells them now instead of silently waiting 2 h. Correct.

### ⚠️ The coherence caveat is verification, not design

`book-ingestion.md` §10 and its own header state plainly that **`pause_mode` has
never been exercised live**, its three deploys had not shipped at write time,
and neither new ingest gate (CPU, deadline), the GPU refusal, a real
failed-book requeue, the `priority_front` reorder, nor the browser control path
has ever fired in production. The **design** is coherent; the **behaviour** is
largely unproven. Shipped ≠ verified, by the repo's own admission.

---

## 4. Improvements — ranked

### Quick wins (small, high-confidence)

1. **🔴 Give the ingest lock PID-liveness.** Replace `ingest_books.py`'s
   time-only `_Lock` (`:81-114`) with the same `OpenProcess`+`GetExitCodeProcess`
   reclaim `pipeline_lock.py:121-155` already implements (or just import/reuse
   it). This closes the "hard crash at 00:20 strands the whole ingestion window
   for 12 h" hole — the exact failure the 30-min cadence claims to prevent.
   *Biggest robustness gain for the least code.*

2. **🟡 Add a heartbeat (or split the check) to `pipeline_lock`.** Either refresh
   the lockfile's `started_at`/mtime periodically during long uploads, or don't
   let age alone reclaim a **live** PID (`:200-207`). Prevents a genuinely long
   backlog run from being reclaimed and run concurrently by the next 8 h
   trigger. Pair with raising `STALE_LOCK_HOURS` only if a heartbeat is *not*
   added.

3. **🟡 Close the cross-folder Drive duplicate on re-file.** When a book's
   author folder changes, either reconcile the old Drive copy or check the whole
   parent (not just the target folder) before uploading. Today it double-uploads
   and waits for the weekly audit. Evidence: `detect_new_books` keys on rel path
   (`:425-427`) vs `check_file_exists_on_drive` scoping to one folder (`:681-690`).

4. **🟢 Prune dead manifest keys** for files no longer on disk, so
   `upload_manifest.json` doesn't grow without bound. Trivial, low value.

### Bigger changes (worth a design conversation, one at a time)

5. **🟡 Run the live drill the docs keep deferring.** A scripted exercise of
   `pause_mode` against the real control document, a forced failed-book →
   requeue round trip, and a `priority_front` reorder of the live queue would
   convert a large "unverified" surface (`book-ingestion.md` §10) into measured
   fact. This is the single highest-value *non-code* item.

6. **🟠 Decouple the five estate-wide steps from the book pipeline.** STEPs 7–11
   (index push, Drive⇄role parity, docs snapshot, backup mirror, sibling link)
   all ride the 8 h `AudiobookSyncPipeline`. The in-code comments repeatedly
   wrestle with this — each one argues at length why it must also run on the
   *idle* path (`:1151-1199`, and each step's header). That reasoning is correct
   *given* the coupling, but the coupling itself means **five unrelated estate
   subsystems' freshness depends on one Windows task's health**: disable or break
   that task (the `PIPELINE.md:133` "pausing the TASK is the blunt instrument"
   warning is about exactly this) and role-parity, backups, docs, and the
   sibling link all silently stale together. A dedicated estate-maintenance
   scheduled task would separate "move books" from "reconcile the estate."

7. **🟠 Thin the entrypoint.** `scripts/sync_to_drive.py` is **2919 lines** doing
   lock orchestration, sort, companion filing, detect, upload, 11 numbered steps,
   three cross-repo subprocess integrations, and commit/push. Per the global
   thin-entrypoint rule, the estate integrations (STEPs 7–11) and the
   sort/upload core are natural modules. Purely maintainability; no behaviour
   change. (Note the file is a `scripts/` entry, not an `app.py`, but the same
   orchestrator-not-monolith argument applies at this size.)

---

## What was NOT verified

- **Nothing was executed.** No pipeline run, no `--dry-run`, no `--status`, no
  test suite. A live sync run was in flight and left alone.
- **No live behaviour** of `pause_mode`, the CPU/deadline/GPU gates, requeue, or
  `priority_front` — the report re-states the target repo's own "never fired in
  prod" claims (`book-ingestion.md` §10) rather than confirming them.
- **The duplicate-on-re-file and no-author-limbo edges (§1) are reasoned from
  code, not reproduced.** I did not construct a re-file to watch a second Drive
  copy appear; the claim rests on the manifest-key vs dedup-scope mismatch.
- **The 4 h stale-reclaim overlap (§2) is latent and unmeasured** — I did not
  produce a >4 h run. It depends on backlog size and uplink speed I did not test.
- **I did not read** the deeper `app/core/` modules the ingester imports
  (`ingest_control`, `ingest_queue`, `book_text`, `book_chunker`, `ingest_pack`)
  beyond their call sites; the window/gate/pause assessment leans on
  `book-ingestion.md` plus the orchestrator, not on those internals.
- **`author_aliases.json`, `author_shelf_aliases.json`, `priority_authors.json`
  contents** were not read — only the code that consumes them.
