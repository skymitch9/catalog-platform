# Testing audit — all four repos, RUN not read (2026-09-07)

> **Audience:** the owner first (this closes his 2026-08-16 ask), future
> Claude/Kiro sessions second. **Status:** TRACKED.
> **Last verified: 2026-09-07** — every count below was produced by **running
> the suite today**, on this machine, with the command in the table. Nothing
> here is read off a previous document.
>
> **The ask being answered**, from `bookbuddy/audiobook_catalog/docs/TODO.md`
> L2058–2095 (owner, 2026-08-16): *"make sure we have useful test not just
> bulk."* Six questions, estate-wide, four repos. §3 answers them one at a
> time.
>
> **The short answer: 10,748 cases, all green, in 105 seconds — and the bulk
> is not the problem.** The problem is three specific places where a green
> tick is not evidence: an **untested privacy allowlist** in the board
> catalog (§4.1), **six tests that cannot fail** in the audiobook catalog
> (§4.2), and **two repos whose 3,915 cases have not run on a CI runner since
> 2026-08-17** (§4.3).
>
> ⚠️ **WHAT WAS NOT CHECKED, and it matters:**
> - **No coverage tool and no mutation run.** The audit's sharpest question
>   ("would it fail if the behaviour broke?") is only truly answered by
>   mutation. The estate's last mutation evidence is `mutation-run-2026-09-05.md`
>   (51 mutations, 9 survivors) and it **excluded `audiobook_catalog`**. That
>   exclusion is still open and is the single biggest hole in this document.
> - **No pipeline or live-path code was executed.** `app/ingest*`, `app/state*`,
>   `transcribe_audiobook.py` and the live-path `scripts/` were never invoked;
>   no `d1 execute`, no deploy, no Worker request.
> - **The audiobook CI-side executed count is still unknown** (§4.7). I measured
>   the LOCAL run (0 skips); I could not measure what a GitHub runner executes
>   without being one.
> - **`.env*`, `.dev.vars*`, `CREDENTIALS.md`, `docs/access/keys/` and
>   `~/.wrangler` were not opened.** No secret value appears here.
> - **Read-only on code.** No test was edited, deleted or added; nothing was
>   fixed. Every finding below is a report, not a change.
>
> ⚠️ **Concurrent agents were working in three of these repos during the run.**
> Files that appeared and vanished mid-audit are attributed in §2.1 and are
> **not** suite side effects. Nothing of theirs was touched, staged or reverted.

---

## 1. The measured run

Every suite was run from a clean-of-my-doing tree, timed, and counted from the
**runner's own summary line** — never from a screen read.

| Repo | Command | Cases | Pass | Fail | Skip | Runner time | Wall |
|---|---|---:|---:|---:|---:|---:|---:|
| `catalog-platform` | `npm test` | **3,416** | 3,416 | 0 | 0 | 29.37 s | 32 s |
| `bookbuddy/library_catalog` | `npm test` | **3,027** | 3,027 | 0 | 0 | 4.48 s | 6 s |
| `boardbuddy/Board_Game_Catalog` | `npm test` | **888** | 888 | 0 | 0 | 3.13 s | 4 s |
| `bookbuddy/audiobook_catalog` (Python) | `PYTHONIOENCODING=utf-8 python -m pytest -q` | **2,370** (+47 subtests) | 2,370 | 0 | 0 | 49.37 s | ~57 s |
| `bookbuddy/audiobook_catalog` (JS) | `npx vitest --run` | **1,047** | 1,047 | 0 | 0 | 5.10 s | 6 s |
| **TOTAL** | | **10,748** | **10,748** | **0** | **0** | | **~105 s** |

**Zero failures, zero skips, zero todos in all five runs.**

### How the counts were produced

- **`node --test` / `tsx --test` repos** — the runner prints `ℹ tests / pass /
  fail / skipped / todo / suites / duration_ms`. For `catalog-platform`, whose
  root script runs eight workspaces in sequence, the per-workspace lines were
  **summed mechanically**, not eyeballed:
  ```
  npm test > cp-test.txt 2>&1
  grep -E "^ℹ (tests|pass|fail|skipped|todo|suites|duration_ms)" cp-test.txt \
    | awk '{s[$2]+=$3} END {for (k in s) print k, s[k]}'
  ```
  → `tests 3416 · pass 3416 · fail 0 · skipped 0 · todo 0 · suites 265 ·
  duration_ms 29374.9`.
- **pytest** — the `-q` summary line: `2370 passed, 47 subtests passed in
  49.37s`.
- **vitest** — `Test Files 45 passed (45) / Tests 1047 passed (1047) /
  Duration 5.10s`.

⚠️ **A grep-based count would be wrong here**, by about a thousand cases —
several suites are table-driven and generate cases in a loop. Every figure
above is the runner's own.

### Test files on disk

| Repo | Test files |
|---|---:|
| `catalog-platform` | 148 |
| `bookbuddy/library_catalog` | 142 |
| `bookbuddy/audiobook_catalog` | 136 |
| `boardbuddy/Board_Game_Catalog` | 52 |

---

## 2. Tree cleanliness — before and after each run

`git status --short` was taken immediately before and immediately after every
run. **No suite dirtied its own repo's tracked tree.** But one suite writes a
great deal to disk where `git status` cannot see it — see §4.4.

| Repo | Before | After | Verdict |
|---|---|---|---|
| `catalog-platform` | clean | clean | ✅ clean both sides |
| `library_catalog` | ` M docs/access/audiobook-sweep.md` | identical | ✅ **not mine** — present before my run |
| `Board_Game_Catalog` | clean | clean | ✅ clean both sides |
| `audiobook_catalog` | `?? frontend/`, `?? scripts/drive_rung_parity.py`, `?? tests/test_drive_rung_parity.py` | `?? frontend/` | ✅ **not a side effect** — see §2.1 |

### 2.1 Attribution of the files that moved

Two untracked files **disappeared** from `audiobook_catalog` during my pytest
run. That is the opposite of a suite side effect and it has a named cause:
another agent **committed them** mid-run as `38601e8` *"Phase 4d: the reconciler
for the new rungs"*. Both files exist on disk and are now tracked.

Two files **appeared** afterwards, neither of them mine:

- `audiobook_catalog/tests/test_uid_binding_audit.py` — appeared after the
  vitest run. A JS runner cannot create a Python test file; another agent did.
- `catalog-platform/.phase4d_cut.tmp` — appeared after my `catalog-platform`
  run, whose before **and** after status were both clean. Same agent, same
  "Phase 4d" work.

`library_catalog`'s ` M docs/access/audiobook-sweep.md` was present before I
started and was committed by another agent before I finished.

**None of these were touched, staged or reverted.** They are recorded here so
that no future reader mistakes them for suite damage — the estate rule is to
establish who wrote a dirty file before acting on it, and in each case the
writer is named.

⚠️ **One consequence for the numbers:** the audiobook Python collection moved
during the audit. My run executed **2,370**; a `--collect-only` taken ~20
minutes later reports **2,410**, the difference being the test file another
agent added. Both figures are correct for their moment.

---

## 3. The owner's six questions, answered

### Q1 — "Would it fail if the behaviour broke?"

**Partly answered, and the honest answer is that this audit cannot fully
answer it.** Only mutation testing can, and the estate's mutation evidence
(`mutation-run-2026-09-05.md`, 51 mutations / 9 survivors) **excluded
`audiobook_catalog` entirely**. That repo's 3,417 cases have never been
mutation-tested beyond the 8-mutation run of 2026-08-16.

What this audit *did* find by reading for a missing failure path is **six tests
that provably cannot fail** — §4.2. That is a direct Q1 hit, found without a
mutation harness, and it is in the one repo the mutation run skipped.

### Q2 — "Does it test BEHAVIOUR or IMPLEMENTATION?"

The 2026-08-16 candidate named in the ask — *a test pinning the exact `git pull`
argv* — **no longer exists in that form.** `audiobook_catalog/tests/
test_pipeline_sanctity_fixes.py:44` now builds a fake `subprocess.run` and
asserts the *outcome* of the git calls rather than their spelling, which is the
shape the ask asked for.

The one structural implementation-pin that remains is
`test_drive_rung_parity.py:619` — `self.assertIn("subprocess.run", body)`,
which asserts that a **string appears in a source file**. That is a spelling
pin by construction: it breaks on a harmless refactor and would not notice a
genuine behavioural regression. 🟡

### Q3 — "Is it a tautology?"

**No material tautologies found.** A scan of all 9,673 test bodies for a
missing assertion token returned 28 candidates; **every one I opened was a
false positive** — the assertion lives in a named helper (`assertExactly`,
`assertSchemaVersion`, `self.fail`). The estate does not mock the thing under
test and assert the mock.

The exception is not a tautology but its cousin: tests that assert *nothing at
all* on the path that matters — §4.2.

### Q4 — "Would it have caught a bug we ACTUALLY had?"

Checked against the six historical bugs the ask names:

| Historical bug | Covered today? |
|---|---|
| validator silently STRIPPING instead of rejecting | 🟡 **partial** — `library_catalog` KI-10 records the CREATE schemas are still not `.strict()`, i.e. the bug class is `WATCHING`, not closed |
| a threshold that matched nothing | ✅ `catalog-platform/scripts/test/backup-r2-exclusions.test.mjs` spawns the real script for exactly this class |
| apex removed from Firebase authorised domains | ✅ `tools/estate-probes/authorized-domains.mjs` exists — ⚠️ but it is a **probe, not a test**, and is never run by `npm test` |
| ebook row colouring on the wrong signal | ✅ covered in the audiobook JS suite |
| games' `defaultRole` writing an INVALID role | ✅ `Board_Game_Catalog/apps/worker/src/lib/capabilities.test.ts` pins the ladder and the matrix row by row |
| `/api/scan-jobs` photo route gated on wrong capability | ✅ closed by the 16 board route-test files added 2026-09-05 |

### Q5 — "Are the DANGEROUS paths covered, or only the easy ones?"

**This is where the audit found the most.** Grants, escalation and revocation
are genuinely well covered — the board's role ladder is pinned row by row, and
the 2026-09-05 route tests found and closed a live privilege bug (that repo's
KI-7). But two dangerous classes are **not** covered:

1. **The privacy allowlist that decides what leaves the board catalog for a
   public surface has no test at all** — §4.1. This is the headline finding.
2. **One-off scripts that write to production are untested as a class** —
   §4.5. 106 script modules across four repos are never named in any test.

### Q6 — "Name the honest gaps rather than papering over them"

The ask's own biggest named gap — ***every signed-in 200-path is untested
estate-wide*** — **is still open.** No test identity fixture exists in any of
the four repos. The technique proven on 2026-08-16 (service account → custom
token → real ID token) has not been turned into the reusable fixture the ask
asked for.

⚠️ The ask also records that the probe list once included a live
`POST /api/estate/ops/pipeline` which **queued an actual pipeline run**. The
separation it demanded now exists structurally: the live probes are
`live-probes.ts`, deliberately **not** named `*.test.ts`, so `npm test` cannot
reach them. That is the right shape and it should not be "fixed".

---

## 4. Findings, ranked

### 🔴 4.1 — The board catalog's public projection allowlist has no test

**`boardbuddy/Board_Game_Catalog/packages/db/src/index-projection.ts:63`**

This module builds the rows this catalog pushes to the shared, public index
Worker. Its own header, at line 6, states the rule:

> ⚠️ DEFAULT-DENY, BY EXPLICIT ALLOW-LIST — never `SELECT *` minus exclusions.
> […] NEVER exported: prices, vendors, conditions, locations, `lent_to`,
> completeness notes, per-person ratings, emails, acquisition dates.

**Nothing enforces that sentence.** The module is named in no test file in the
repo. Its only consumer, `apps/worker/src/lib/index-push.ts`, does have
`index-push.test.ts` — but that file is 144 lines and contains **zero**
references to `projection`, `source_id`, `SELECT`, `price` or `lent_to`. The
column list at line 63 is unpinned.

**Why this is 🔴 and not 🟠 — it is a gate that passes while wrong.** Adding one
column to the `SELECT` at line 63 ships private data to a public surface with
**all 888 tests green**. There is no red anywhere.

**And the estate already knows how to do this** — the board is the only one of
the three catalogs that does not:

| Catalog | Projection pinned by |
|---|---|
| `library_catalog` | `packages/db/test/index-projection-origin.test.ts` ✅ |
| `audiobook_catalog` | `tests/test_index_push.py` ✅ |
| `Board_Game_Catalog` | **nothing** 🔴 |

**Recommended:** one test that asserts the exact allowlist at line 63, in the
shape the library's already uses. This is the highest-value single test in this
document.

### 🔴 4.2 — Six audiobook tests cannot fail, and they guard library completeness

**`bookbuddy/audiobook_catalog/tests/test_catalog_completeness.py`**

Eleven tests. **Six of them have no failure path of any kind** — no `assert`,
no `self.fail`, no raise. They walk the real ~1,080-book library (the slowest
setup in the whole estate at 4.04 s), build a list of problems, `print()` a
`[REPORT]` block, and pass unconditionally.

| Test | Line | Can it fail? |
|---|---:|---|
| `test_all_books_have_covers` | 133 | 🟡 only on *extraction errors*; **missing covers are explicitly "not a failure, just informational"** (L152) |
| `test_all_authors_have_drive_links` | 171 | 🔴 **never** |
| `test_author_drive_links_are_valid` | 207 | ✅ yes |
| `test_all_books_have_authors` | 240 | 🔴 **never** |
| `test_all_books_have_descriptions` | 259 | 🔴 **never** |
| `test_all_books_have_titles` | 281 | ✅ yes |
| `test_all_books_have_narrators` | 297 | 🔴 **never** |
| `test_all_books_have_duration` | 313 | 🔴 **never** |
| `test_all_books_have_genre` | 329 | 🔴 **never** |
| `test_catalog_has_books` | 345 | ✅ yes |
| `test_author_map_exists` | 350 | ✅ yes |

**This is exactly the ask's question 1**, and it is the sharpest instance in the
estate: a test named `test_all_books_have_narrators` that does not check that
all books have narrators.

⚠️ **It is also a correction to prior art.** `test-inventory-2026-09-05.md` §4.3
examined this same file, called it *"the only check on library completeness"*,
and recommended **KEEP the tests, FIX the reporting**. That fix was made — the
skip is now a visible module-level `skipif`. But the inventory measured only
whether the file *runs*; nobody measured whether the tests that run can *fail*.
**Making a hollow test's skip visible does not make the test real.**

**Recommended:** give the six a failure path, or an explicit, documented
threshold if the owner wants "83% of books have a genre" to be a report rather
than a gate. What must not stand is a name that promises a check that does not
exist.

### 🔴 4.3 — Two repos have run no tests on a CI runner since 2026-08-17

`library_catalog` (3,027 cases) and `Board_Game_Catalog` (888 cases) each have
**exactly one** GitHub workflow — `deploy.yml` — and its trigger is:

```yaml
on:
  workflow_dispatch:
```

There is no push trigger, no pull-request trigger, and no test workflow. Their
suites gate only the **local** `predeploy` chain. Measured with `gh run list`:

| Repo | Most recent CI run of any kind |
|---|---|
| `library_catalog` | **2026-08-17** — `Deploy Worker (manual)` |
| `Board_Game_Catalog` | **2026-08-17** — `Deploy Worker (manual)` |

**Three weeks, and 3,915 cases that have not executed on a runner in that
time.** Every green tick those repos have earned since is from a developer's
own machine.

**The contrast makes it a gap rather than a policy.** Both sibling repos fixed
this:

- `catalog-platform` added `tests.yml` on 2026-09-05 (push + PR + `workflow_call`,
  reused by `deploy.yml` as its gate).
- `audiobook_catalog` has had `tests.yml`, `js-tests.yml` and `lint.yml` on
  push/PR, with `deploy.yml` declaring `needs: [test, js-test, lint]`.

✅ **And the 2026-09-05 caveat is now closed by measurement.** That document
recorded the catalog-platform gate as *"SHIPPED, NOT VERIFIED — the job has
never executed on a runner."* It has now: `gh run list --workflow=tests.yml`
shows **five green push runs today**, 1m02s–1m18s, most recent
`34150102648` at 18:03Z. The gate is real.

**Recommended:** give `library_catalog` and `Board_Game_Catalog` the same
`tests.yml` the other two have. It is a copy of a file that already works
twice.

### 🟠 4.4 — The audiobook Python suite is not read-only, and `git status` cannot see it

`tests/test_catalog_completeness.py`'s own header says so plainly:

> ⚠️ Running these tests is NOT free and NOT read-only: `extract_metadata()`
> writes extracted cover art into `output_files/covers/`. Do not run this file
> on the pipeline box while an ingestion run is in flight.

**Measured, this run:** `find output_files -newermt <run start> ! -newermt <run
end>` → **1,090 cover JPEGs rewritten** inside my 57-second window (sample:
`output_files/covers/A. American/Conflicted Home.jpg`, mtime 11:07:01.55, run
window 11:06:50–11:07:47).

**None of it appears in `git status`,** because `.gitignore:4` ignores
`output_files/`. This is the finding behind the finding: **a clean
`git status --short` is not proof that a suite is side-effect free.** The
audit's own required instrument would have missed this; only an mtime sweep
caught it.

⚠️ **The warning in the header is advice, and nothing enforces it.** `pytest -q`
— the exact command in `.github/workflows/tests.yml`, and the command any
human runs — fires this file unconditionally. Had I run this audit inside the
12am–8am Phoenix ingestion window with a run in flight, the collision the
header warns about would have happened. I checked first: no `pipeline.lock`
existed and the run was at 11:06 Phoenix, outside the window.

**Correctly attributed as NOT mine:** seven other `output_files/` artefacts
(`fs_watcher_state.json` 11:10:02, `ingest_nightly.log` 11:00:07,
`processing_push.log` 11:00:27, `purchase_audit.log` 11:01:19,
`audio_archive.log` 11:05:02, and two others) all carry mtimes **outside** my
run window. They are live watcher/scheduled processes, not the suite. The
archive test correctly monkeypatches its paths to `tmp_path`
(`test_archive_audio_r2.py:432`).

**Recommended:** point `extract_metadata()` at a temp directory under test, or
gate the file behind an explicit opt-in env var. A suite that mutates the
pipeline machine's real output is one scheduling accident from a real incident.

### 🟠 4.5 — The real pipeline lock is taken by the test suite

`bookbuddy/audiobook_catalog/tests/test_pipeline_lock.py:165` spawns a genuine
second OS process that holds **`pl.LOCK_PATH`** — the real
`output_files/pipeline.lock`, not a fixture path — for 5 seconds, then calls
the real `pl.acquire("manual")` in-process.

This is *excellent* testing — it is the one place in the estate that proves
lock behaviour against real processes and real dead pids, and the 2026-08-16
mutation run named the lock as **not to be touched** without re-running those
mutations. **Keep it.**

The finding is narrower: it means `pytest -q` **contends for the production
pipeline lock**. It is the slowest single case in the suite (5.12 s) and, run
during an ingestion window, it would either be refused or refuse the pipeline.
Same root cause as §4.4 and the same fix shape: the suite needs an explicit
"this machine is the pipeline box" guard, not a comment.

### 🟠 4.6 — Untested one-off scripts that write to production

Measured by an import-reference scan (a module counts as tested if its stem is
named in **any** test file, or a same-named test file exists — the intersection
of two heuristics, to avoid the false positives noted below):

| Repo | Modules named in no test | of which one-off `scripts/`/`tools/` | of which APP or PACKAGE code |
|---|---:|---:|---:|
| `catalog-platform` | 24 of 232 | 18 | **6** |
| `library_catalog` | 70 of 283 | 55 | **15** |
| `audiobook_catalog` | 28 of 132 | 27 | **1** |
| `Board_Game_Catalog` | 15 of 120 | 6 | **9** |

**The mass is one-off scripts** — `backfill-openlibrary-ids.mjs` (987 loc),
`fix-foreign-isbns-2026-09-05.mjs` (816), `import-ebooks.mjs` (562),
`mirror_to_drive.py` (391), `drive_dedup.py` (353). These write to production
D1, Drive and R2, and none is covered. That is the ask's question 5 —
*migrations, deletes, anything that writes to prod* — answered honestly: **not
covered.**

⚠️ **`Board_Game_Catalog` is the proportional outlier on APP code** — 9
untested app/package modules against a 120-module repo, including
`index-projection.ts` (§4.1), `packages/db/src/copy-events.ts`,
`apps/worker/src/lib/scan-classify.ts` and `resolve-title.ts`. It also carries
`KNOWN_ISSUES.md` **KI-8** — *"Nothing in `scripts/` is ever type-checked —
ACCEPTED"* — so that repo has both no tests and no typecheck on its scripts.

⚠️ **A methodological warning for whoever re-runs this.** My first pass used a
same-filename heuristic and reported *"119 untested modules"* in
`catalog-platform` alone. **That figure was wrong and I discarded it.** Every
large module it flagged (`mention-flow.ts`, `gateway.ts`, `works.ts`,
`items.ts`) is in fact imported by tests under a different filename — this
estate tests by behaviour topic, not by file mirror. A second pass keyed on
content references was *also* wrong in the other direction, flagging
`library_catalog/packages/core/src/gabi-tools.ts` as untested when
`packages/core/test/gabi-tools.test.ts` exists and imports it through the
package barrel. **Only the intersection of the two is defensible**, and even it
should be spot-checked before anyone acts on a row.

### 🟡 4.7 — Local run ≠ CI run for the audiobook Python suite, and CI's number is still unknown

My run reported **0 skipped**. That is not the CI result — it is the result of
running on the **pipeline machine**, where every environment guard opens: the
audio library is present, the sibling `catalog-platform` checkout is present,
`catalog.csv` and the published manifests are present.

Ten files carry environment guards. Their collected sizes bound what a CI
runner does not execute:

| File | Cases collected |
|---|---:|
| `test_ebook_covers.py` | 84 |
| `test_drive_rung_parity.py` | 36 |
| `test_shelf_map.py` | 34 |
| `test_upload_ebooks_r2.py` | 22 |
| `test_catalog_twins.py` | 19 |
| `test_catalog_completeness.py` | **11 — all 11 skip on CI** |
| `test_estate_theme_vendor.py` | 9 |
| `test_estate_search_vendor.py` | 9 |
| `test_publish_audio_manifest.py` | 9 |
| `test_cross_catalog_overrides.py` | 8 |
| **Upper bound** | **241** |

**241 of 2,410 cases (10%) sit behind an environment guard.** Not all skip on
CI — most files are only partly gated — but `test_catalog_completeness.py`'s
11 skip in full, and that is the file §4.2 shows is six-elevenths hollow even
when it runs. **On CI it proves nothing; on the pipeline box it proves less
than its names claim.**

The exact CI-executed count remains **unmeasured**, as it was on 2026-09-05.
It is cheaply obtainable — the `tests.yml` run summary already prints it — and
nobody has read it off a run.

### 🟡 4.8 — The route-test harness is copy-pasted 35 times and has already drifted

`Board_Game_Catalog`'s 16 route test files (added 2026-09-05) each define their
own harness rather than importing a shared one:

| Helper | Files defining it | Repos |
|---|---:|---|
| `body` | 70 | 3 |
| `row` | 38 | 4 |
| `envWith` | 35 | 3 |
| `stubFetch` | 30 | 4 (audiobook `site/__tests__`) |
| `stubDb` | 29 | 3 |
| `appAs` | 17 | 2 |

**And the copies are not identical, which is the actual risk.** Measured:

- `apps/worker/src/routes/admin.test.ts` — `function envWith(db, extra) { return { DB: db, ESTATE_APP: 'games', ...extra } }`
- `apps/worker/src/routes/aliases.test.ts` — `const envWith = (db, extra) => ({ DB: db, ...extra })`

One plants `ESTATE_APP: 'games'` and the other does not. That is a divergence
in the *environment the route sees*, hidden in a helper nobody reads, two days
after the files were written in a single sitting.

⚠️ **There is no shared test-helper module anywhere in the four repos** — no
`conftest.py`, no `test-utils`, no harness package. A search for one returns
only `.venv` site-packages. Every harness in the estate is per-file.

**Recommended:** one `test/harness.ts` per worker package, imported by the
route tests. This is hygiene, not a bug — but the estate's own "one fact, one
home" rule applies to test fixtures too, and 35 copies of an environment
builder is how a route gets tested against an environment it never runs in.

### 🟡 4.9 — One implementation-pin remains

`bookbuddy/audiobook_catalog/tests/test_drive_rung_parity.py:619` —
`self.assertIn("subprocess.run", body)` asserts that a literal string appears
in a source file. It locks a spelling, not a behaviour: a refactor that
replaced `subprocess.run` with an equivalent helper would go red for no reason,
and a genuine regression that kept the string would go green. This is the same
class the ask flagged in 2026-08-16 (the `git pull` argv pin) — and, to the
repo's credit, **that original one has since been rewritten to assert the
outcome** (`test_pipeline_sanctity_fixes.py:44`).

---

## 5. What is worth keeping — explicitly

So that no future cull mistakes these for bulk:

- **The 114 drift pins.** Four repos vendor copies of each other's code; each
  pin replaces a "keep in sync by hand" note that was measured insufficient.
  `test_estate_theme_vendor.py` and `test_estate_search_vendor.py` each caught
  a real divergence — the search copy was **23 lines and four divergences**
  behind, two of them user-visible.
- **`test_pipeline_lock.py` and the additions log.** Named by the 2026-08-16
  mutation run as *not to be improved* without re-running the mutations. §4.5
  is a note about where it runs, not an argument against it.
- **The `*-contract.test.ts` family.** They pin payload shapes across repo
  boundaries, where TypeScript cannot see. Deleting these is how a cross-repo
  field rename ships.
- **The three-language title-key fixture pin** (`test_title_key_fixtures.py` +
  `title-key-fixtures.test.js` + `packages/core/test/title-key-fixtures.test.ts`).
  One persisted key, three systems, three pins. Not duplication.
- **The board's 16 route test files.** Two days old, and writing them found two
  real bugs including a live privilege bug (that repo's KI-7, now resolved).

---

## 6. The answer, in one paragraph

**10,748 cases across four repos, every one green, in 105 seconds — and the
owner's suspicion that the suite might be bulk is not what the measurement
shows.** No genuine tautologies, no material duplicate coverage, and 28
assertion-free candidates that all turned out to be helper-based false
positives. **The suite's problem is not size, it is three places where green
is not evidence:** the board catalog's public projection allowlist has no test
at all, so a leaked column ships with 888 tests passing (§4.1); six audiobook
completeness tests have no failure path, including one named
`test_all_books_have_narrators` that never checks narrators (§4.2); and two
repos have not run a single test on a CI runner since 2026-08-17, so 3,915
cases gate nothing but a developer's own machine (§4.3). Beneath those, two
structural notes: the audiobook Python suite **writes 1,090 files into the
pipeline machine's real output directory** where `git status` cannot see it
(§4.4), and 106 production-writing one-off scripts are untested as a class
(§4.5). ⚠️ **The one question this audit could not answer is the ask's
sharpest** — *would it fail if the behaviour broke?* — because no mutation run
has ever covered `audiobook_catalog`, which is precisely the repo where reading
for a missing failure path found six tests that cannot fail. **A mutation pass
over `audiobook_catalog` is the single highest-value follow-up**, and the
2026-09-05 mutation run's own method transplants directly.

---

## Provenance of every number here

| Claim | How measured, 2026-09-07 |
|---|---|
| catalog-platform 3,416 / 265 suites / 29.37 s | `npm test`, summed from the runner's `ℹ` lines with `grep ... \| awk` (§1) |
| library_catalog 3,027 / 515 suites / 4.48 s | `npm test` → `ℹ tests 3027 / pass 3027 / fail 0 / skipped 0` |
| Board_Game_Catalog 888 / 152 suites / 3.13 s | `npm test` → `ℹ tests 888 / pass 888 / fail 0 / skipped 0` |
| audiobook Python 2,370 (+47 subtests) / 49.37 s | `PYTHONIOENCODING=utf-8 python -m pytest -q --durations=10` → *"2370 passed, 47 subtests passed in 49.37s"* |
| audiobook JS 1,047 / 45 files / 5.10 s | `npx vitest --run --reporter=dot` |
| audiobook collection 2,410 | `python -m pytest --collect-only -q`, ~20 min after the run (§2.1) |
| Tree clean before/after | `git status --short` immediately before and after each run |
| 1,090 files written by the suite | `find output_files -newermt "2026-09-07 11:06:50" ! -newermt "2026-09-07 11:07:50" -type f \| wc -l` |
| Non-suite `output_files` writes | `stat -c '%y'` on each — all outside the run window |
| CI triggers and gates | read all 13 `.github/workflows/*.yml` across the four repos |
| Last CI run per repo | `gh run list --limit 5` in each repo |
| catalog-platform gate exercised | `gh run list --workflow=tests.yml --limit 5` — 5 green push runs |
| Six tests with no failure path | per-body regex for `self.fail\|self.assert\|assert \|raise AssertionError`, then each body read in full |
| 28 assertion-free candidates | per-body scan of all 9,673 test bodies; every hit opened and classified |
| Untested-module counts | intersection of a same-filename scan and a content-reference scan; spot-checked (§4.5) |
| Helper duplication counts | regex over `function`/`const`/`def` definitions inside test files only |
| Guarded-file case counts | `python -m pytest --collect-only -q tests/<file>.py` per file |
| `[tool.pytest]` config | **hypothesis disproven** — `pytest --co` reports `configfile: pyproject.toml` / `testpaths: tests`; the table IS honored |
