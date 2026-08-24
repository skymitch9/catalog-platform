# Why the audiobook archive panel never shows 100% — investigation

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> **Last verified: 2026-08-24.**
>
> Read-only investigation, no code changed, nothing deployed, nothing deleted.
> Triggered by the owner asking why `/status`'s blob-storage / archive row
> shows `Files uploaded 1,267 (total unknown)` and `Failures: 1 —
> KindleForPC-installer-2.9.71006.exe` instead of a verifiable 100%.

---

## TL;DR

**The archive itself is already at 100% and says so, in its own log, every
hour.** The board doesn't show that because the piece of code that builds the
board's `files_total` figure (`catalog-platform/scripts/lib/archive-board.mjs`
→ `totalFromLog()`) reads the wrong line out of the log — one that only gets
written while files are actively uploading — and the archive has had nothing
to upload for days, so that line hasn't appeared in the tailed window. The
"Failures: 1" is not a live problem either: it is a six-day-old, permanently
stale artifact from before an exclusion rule existed, for a file that no
longer exists anywhere. Both are fixable without re-running any backup.

---

## Q1 — Is the mirror actually complete? Does a total exist, and can it be emitted?

**Yes, it is complete, and yes, a real total already exists — it just isn't
where the board looks.**

`bookbuddy/audiobook_catalog/scripts/archive_audio_r2.py`'s hourly `--commit`
run appends this to `output_files/audio_archive.log` on **every** run,
including the last six in a row (2026-08-23 19:05 through 2026-08-24 00:05,
all identical):

```
On disk  : 1253 files, 686.53 GB (author folders only; zzzz_Books_to_be_Converted excluded)
Recorded : 1267 files, 686.66 GB
To upload: 0 files, 0.00 GB

Uploaded 0 / 0 (0.00 GB) in 0.0 min at 0.0 MB/s; 0 failed.
Archive now holds 1267 objects, 686.66 GB (100.0% of the library).
```

That last line is a **true, live-computed 100%** — the archiver's own
`print_status()` / commit-run summary compares the *current disk scan*
(author folders only, live) against the manifest and computes the percentage
by bytes, distinguishing "on disk but not yet archived" (Remaining) from
"archived but no longer on disk" (Orphans — expected, see Q3). This is not a
guess; `scripts/archive_audio_r2.py` lines ~824–860 (the `--commit`/status
path) and ~726–793 (`print_status()`, i.e. `--status`) both do this
computation directly against `os.stat()` results.

**Why the board shows "total unknown" anyway:**
`catalog-platform/scripts/push-storage-board.mjs` never calls `--status` or
reads the archiver's summary line. It tails the last 200 lines of
`audio_archive.log` and hands that text to
`scripts/lib/archive-board.mjs::totalFromLog()`, which looks **only** for
brackets in the shape `[i/N]` — the per-file progress line
(`print(f"  [{i}/{len(pending)}] {rel} …")`) that the archiver emits only
while `pending` (files it intends to upload *this run*) is non-empty. Since
the archive has been caught up (`To upload: 0 files`) for the last six-plus
hourly runs, **no `[i/N]` line exists anywhere in the tailed window**, so
`totalFromLog()` correctly returns `null` per its own contract ("a percentage
with no denominator is not a percentage") — but the denominator it's looking
for was never the right one to begin with.

**A second, deeper problem, not just a missing line:** even when `[i/N]`
lines *do* appear, `N` is `len(pending)` — the count of files queued **in
that one run** (e.g. a handful of newly-purchased books) — not the size of
the library. `archive-board.mjs` then divides the manifest's all-time
cumulative count (`files_done`, currently 1,267) by that run-sized `N`,
clamped to 100 via `Math.min(100, …)`. On a run with anything pending this
would silently show a **false 100%** (any ratio > 1 gets clamped), and in the
current steady state it shows nothing at all. Either way the number rendered
was never actually "fraction of the library archived."

**What a real fix looks like** (not applied — read-only task): have
`push-storage-board.mjs` read `On disk` / `Recorded` counts the same way
`print_status()` already computes them — either by adding a `--json` flag to
`archive_audio_r2.py` that emits `{on_disk_files, on_disk_bytes,
recorded_files, recorded_bytes, remaining, orphans}`, or by parsing the
`On disk  : N files` / `Recorded : N files` lines (which — unlike `[i/N]` —
are written on **every** run, commit or dry-run, pending or not). Either
gives `files_total = on_disk_files` (currently 1,253) as a stable denominator
that survives steady state, instead of one that vanishes exactly when the
system is healthiest.

## Q2 — Is the KindleForPC-installer failure genuine, or junk that shouldn't be backed up?

**Neither, precisely — it's a stale, permanently un-retriable artifact from
before today's exclusion rule existed, and the file is gone (confirmed).**

From `output_files/audio_archive_manifest.json` (`generated:
2026-08-24T07:05:03Z`):

```json
"failures": {
  "KindleForPC-installer-2.9.71006.exe": {
    "attempts": 1,
    "error": "upload failed: FileNotFoundError: [WinError 2] The system cannot find the file specified: 'C:\\Users\\nbasl\\OpenAudible\\books\\KindleForPC-installer-2.9.71006.exe'",
    "last_try": "2026-08-18T20:10:59Z",
    "size": 298583688
  }
}
```

- `last_try` is **2026-08-18** — six days before this investigation, and it
  has not moved since (`attempts: 1`, never incremented).
- Confirmed by direct check: `C:\Users\nbasl\OpenAudible\books\KindleForPC-installer-2.9.71006.exe`
  **does not exist** on disk today (checked via `ls`, "No such file or
  directory").
- `docs/access/AUDIO_ARCHIVE.md` documents that this file was one of 15
  loose, unsorted files sitting directly in the library root (depth 0, no
  author folder) during the very first seed run, before the
  author-folders-only exclusion rule (`is_unsorted()`) was added the same
  day. 14 of the 15 uploaded successfully before the file left disk; this one
  (the largest, at 298 MB) hit the file mid-transfer-attempt after it had
  already been removed from disk — hence `FileNotFoundError`, not a real
  upload/network failure.
- **Why it can never clear itself:** `scan_local()` now splits every scan
  into `(archivable, unsorted)`, and only `archivable` (files inside an
  author folder) ever enters the `pending` upload queue (`archive_audio_r2.py`
  ~line 852). A root-level loose file is never attempted again — the code
  path that would clear `failures[key]` on a subsequent success
  (`failures.pop(rel, None)`, line ~917) can only run for keys that get
  re-attempted, and this key structurally never does, whether or not the
  file ever reappears on disk. The entry is inert forever unless someone
  edits the manifest by hand.

**Recommendation:** This is not a backup defect and not something to
"exclude" via a new rule (the root-loose-file exclusion already covers it
going forward). It's stale bookkeeping. The safe, minimal fix is to manually
drop this one dead key from `failures` in
`output_files/audio_archive_manifest.json` (a plain JSON edit, not a code
change) so the board's "Failures: 1" clears and doesn't get treated as a
live warning by a future session. Confirm first that the file is genuinely
gone from disk everywhere it might live (checked above: it is, from the
`ROOT_DIR` books folder) before removing the entry.

## Q3 — Is 1,267 files / 687 GB plausibly the whole set, or is data missing?

**Plausibly complete — cross-checked directly against a live disk scan
recorded in the archiver's own log, not just the manifest talking to
itself.**

From the same hourly log lines (2026-08-24 00:05:01, and five runs before
it, all consistent):

| | Files | Bytes |
|---|---|---|
| On disk right now (author folders only) | 1,253 | 686.53 GB |
| Recorded in the archive (manifest, cumulative) | 1,267 | 686.66 GB |
| To upload (i.e. present on disk, not yet archived) | **0** | **0.00 GB** |

`To upload: 0 files` on six consecutive hourly runs means: **every file
currently on disk has already been verified into the archive** (the
decide-to-upload check is sha256/mtime-based, not a guess). The manifest
holding *more* files (1,267) than the live disk scan (1,253) — a gap of
exactly 14 — matches `docs/access/AUDIO_ARCHIVE.md`'s own prior finding
(measured 2026-08-21: "Recorded is higher than on disk… Fourteen files exist
in the archive that are no longer on the local disk") and the owner's own
explanation there (deleted EPUBs that had already been uploaded). This
mismatch is **by design** — the archive is deliberately cumulative
(disaster-recovery), not a live mirror; deleting a file locally does not
(and must not) delete its backup copy. So the 1,267/687GB figure is not
under-counting anything on disk; if anything it is *ahead* of disk by 14
already-safe files.

I could not independently re-derive the 1,253-on-disk figure from a fresh
filesystem walk in this session (a full stat-scan of ~685 GB across
`C:\Users\nbasl\OpenAudible\books` was judged out of scope for a read-only,
time-bounded investigation and risks the OneDrive-dehydration trap documented
in `catalog-platform`'s `KI-9`). I'm relying on the archiver's own six most
recent, mutually-consistent hourly log entries instead of re-running the scan
myself.

---

## Recommended action for the owner

1. **No backup work is needed.** The archive is functionally at 100% of the
   current library, has been for at least the last six hourly runs, and
   restore was proven 2026-08-18 (sha256-identical round trip — 5–6 days
   before this check, matching the board's "restore proven 5d ago").
2. **The board is misreporting a healthy system, not detecting an unhealthy
   one.** Two real, small code fixes would make the panel trustworthy:
   - Change `push-storage-board.mjs` / `archive-board.mjs` to read the
     archiver's `On disk` / `Recorded` line counts (present on every run) as
     `files_total` / `files_done`, instead of the transient `[i/N]`
     per-file-upload progress marker that disappears once the backlog is
     clear.
   - Clear the single dead `KindleForPC-installer-2.9.71006.exe` entry out of
     `failures` in `audio_archive_manifest.json` — it is a six-day-old,
     structurally un-retriable leftover for a file confirmed gone from disk,
     not a live failure.
3. Neither fix was made in this session (read-only investigation as
   instructed). Both are small, well-scoped edits if the owner wants them
   done next.

---

## What was NOT verified

- I did not re-run `archive_audio_r2.py --status` or any backup/mirror
  command — read-only per the task brief.
- I did not independently re-scan the ~685 GB library on disk; I relied on
  the archiver's own six most recent, self-consistent hourly log summaries
  (2026-08-23 19:05 through 2026-08-24 00:05) rather than performing my own
  filesystem walk, to avoid the time cost and the OneDrive-dehydration
  false-negative risk documented in `KI-9`.
- I did not check Windows Task Scheduler directly (`schtasks` was not
  available in this session's shell) to independently confirm the "next run
  10:05 PM" figure on the board — I'm relying on
  `push-storage-board.mjs`'s documented method (`Get-ScheduledTaskInfo` on
  `AudiobookArchiveR2`), which is designed to read it live, never compute it.
- I did not verify whether other loose/root-level files besides
  `KindleForPC-installer-2.9.71006.exe` and the other 14 pre-rule strays
  currently sit unsorted in the library root — `docs/access/AUDIO_ARCHIVE.md`
  says the root held 0 loose files as of 2026-08-18; I did not re-check the
  root directory's current contents beyond a directory listing that showed
  only author-name folders at the top of the truncated output.
- I did not confirm the literal identity "board-push-task@home-pc" (the
  owner's phrasing) against a specific Windows Scheduled Task name — the
  code's own actor label for this push is `storage-board@home-pc`
  (`push-storage-board.mjs`'s default `--by` value). This doesn't change any
  finding above; I just couldn't verify the exact scheduler task name in this
  session.
