# Test inventory — all four repos (2026-09-05)

> **Audience:** the owner first (he asked the question), future Claude/Kiro
> sessions second. **Status:** TRACKED.
> **Last verified: 2026-09-05** — every count in §1 was **measured on that date
> by running or collecting the suite**, not estimated. The commands are in the
> table so any of them can be re-run.
>
> ✅ **ONE FINDING IS ALREADY CLOSED, later the same day (2026-09-05, agent
> W9-BOARD-ROUTES): §5.2, the board catalog's 16 untested route files.** It now
> has **16 route test files / 387 cases**, one per route file, and its suite went
> **25 files / 348 cases → 41 files / 735 cases**, 59 → 125 suites, 2.6 s. The
> §1 and §5 numbers below are left AS MEASURED and each carries a dated
> correction beside it rather than being overwritten — this is an inventory of a
> moment, and editing the moment away would lose the before-figure the finding
> was argued from. ⚠️ **Writing those tests also found two real bugs**, one of
> them a live privilege bug (an `admin` can demote the last `owner`, reaching
> `countOwners() == 0`): `Board_Game_Catalog/docs/KNOWN_ISSUES.md` KI-6 and
> KI-7. That is the strongest evidence in this document for §5's argument that
> the gaps matter more than the count — **the very first tests written into the
> largest gap found a bug that had been live for weeks.**
>
> **The owner's question, verbatim (2026-09-05):** *"How many test do we have?
> Can we explore how many we have and decide if we truly need all of them"*.
> **Short answer: 9,445 test cases in 415 files. Roughly 30 cases across 5
> files are real removal candidates — about 0.3%.** The suite is not bulk; it
> is unusually well-motivated, and §2 shows why. The bigger finding cuts the
> other way — §5 lists coverage that is MISSING, including a deploy path that
> runs no tests at all.
>
> ⚠️ **WHAT WAS NOT CHECKED, and it matters:**
> - **The audiobook Python suite was never RUN**, only collected
>   (`--collect-only`). Its 2,242 cases include an unknown number that would
>   **skip** on this machine or on CI (§2.6); the pass/fail state and the wall
>   time of a real run are **unknown**.
> - **No coverage tool was run anywhere.** "What each group proves" (§2) is
>   read from the test files' own headers and from the repos' docs, not from a
>   line-coverage report.
> - **No mutation testing was performed in this survey.** The only mutation
>   evidence in the estate is the 8-mutation run of 2026-08-16 recorded in
>   `audiobook_catalog/docs/info/gotchas.md`, quoted in §2.7. That evidence is
>   **9 days old and covers 8 mutations**, not the suite.
> - **`.dev.vars`, `.env*`, `docs/access/keys/` and `CREDENTIALS.md` were not
>   opened**, per the survey rules. No secret values appear here.
> - **Nothing was changed, committed or deployed.** This is a read-only survey
>   plus this one file.
>
> ✅ **THREE OF THE FINDINGS WERE FIXED THE SAME EVENING** (owner, 22:04: *"Do
> what you suggest just build it all now"*), and the rows they belong to are
> corrected IN PLACE rather than deleted — §1's per-workspace table, §3's gate
> table, §4.4, §5.1/§5.4/§5.5 and §6. The commits: **`44e81ae`** the CI test
> gate (with `access/ci-deploy.md`, created because the deploy workflow had no
> doc at all), **`9f0c504`** `packages/estate-events` (0 → 32 cases),
> **`a6f0324`** `apps/ebooks-door` (no `test` key → 15 cases). ⚠️ **The
> catalog-platform total in §1 is therefore now 3,151, not 3,076** — of the
> +75, **47** are these two new suites and the rest is other agents' work that
> landed the same evening. ⚠️ **The CI gate is SHIPPED, NOT VERIFIED:** the
> `tests` job has never executed on a runner, and cannot without a real deploy.
>
> ⚠️ **The counts are a moving target.** Two untracked files appeared in
> `catalog-platform` DURING this survey — `scripts/lib/gabi-prompt-sync.mjs`
> and `scripts/test/predeploy-markers.test.mjs` — written by another agent
> working in the same tree. They were **left alone** (per the estate rule:
> establish who wrote a dirty file before touching it). `scripts/test/` held
> 25 files at the start of the survey and 26 at the end.

---

## 1. The count, measured

### Totals

| Repo | Test files | Test cases | Runner | Wall time of one full run |
|---|---:|---:|---|---|
| `catalog-platform` | **135** | **3,076** | `node --test` + `tsx --test`, per workspace | **~39 s** (27.3 s of it is `scripts/test`) |
| `bookbuddy/library_catalog` | **134** (133 run + 1 orphan) | **2,816** (+7 orphaned) | `tsx --test`, one glob | **~12 s** measured as 8 separate runs; ⚠️ `pretest` adds 5 sync scripts on top |
| `bookbuddy/audiobook_catalog` | **121** (82 Python + 39 JS) | **3,205** (2,242 py + 963 js) | `pytest` + `vitest` | JS **4.4 s**; ⚠️ **Python NOT RUN** — collect only, 3.2 s |
| `boardbuddy/Board_Game_Catalog` | **25** ⚠️ now **41** | **348** ⚠️ now **735** | `tsx --test`, one glob | **3.1 s** ⚠️ now **2.6 s** |
| **TOTAL** | **415** ⚠️ now **431** | **9,445** ⚠️ now **9,832** | | |

⚠️ **The "now" figures are the SAME DAY, hours later** (2026-09-05 evening, agent
W9-BOARD-ROUTES closing §5.2). The unmarked figures are the survey's own
measurement and are what §4 and §5 argue from; the marked ones are what a fresh
run would report. Only the board row moved — the other three repos were not
re-measured, so the two totals differ by exactly the board delta (+16 files,
+387 cases) and by nothing else.

⚠️ **9,445 is a count of what the runners actually collected**, which is why it
is 8–14% higher than a `grep -c "it("` of the same files: several suites are
table-driven and generate cases in a loop (`apps/worker/src/routes` greps to
191 and runs **519**). A grep-based count of this estate **undercounts by about
a thousand cases** — do not use one.

### Per package / workspace

**`catalog-platform`** — root script `npm test` = `npm run test:scripts && npm test --workspaces --if-present`

| Package | Files | Cases | Wall | Command run |
|---|---:|---:|---:|---|
| `scripts/test` | 26 | **450** | 27.3 s | `npx node --test "scripts/test/**/*.test.mjs"` |
| `apps/discord-worker` | 34 | **1,261** | 2.7 s | `npx tsx --test test/*.test.ts` |
| `apps/auth-worker` | 41 | **791** | 2.1 s | ″ |
| `apps/audiobook-worker` | 14 | **293** | 1.8 s | ″ |
| `apps/index-worker` | 12 | **200** | 1.6 s | ″ |
| `packages/estate-auth` | 5 | **42** | 1.2 s | ″ |
| `packages/gabi-conversation` | 2 | **34** | 1.0 s | ″ |
| `packages/firebase-sa` | 1 | **5** | 1.1 s | ″ |
| `apps/ebooks-door` | ~~0~~ **1** | ~~0~~ **15** | 1.0 s | ✅ **FIXED `a6f0324`** — had ⚠️ *no test script at all*; now has the key and a suite |
| `packages/estate-events` | ~~0~~ **2** | ~~0~~ **32** | 1.2 s | ✅ **FIXED `9f0c504`** — had ⚠️ *declares `"test": "tsx --test test/*.test.ts"` and `test/` does not exist*; now has both |

**`bookbuddy/library_catalog`** — root `npm test` is one `tsx --test` over eight globs

| Package | Files | Cases | Wall |
|---|---:|---:|---:|
| `packages/core/test` | 27 | **804** | 1.5 s |
| `apps/worker/src/routes` | 13 | **519** | 2.1 s |
| `apps/web/test` | 31 | **464** | 1.5 s |
| `scripts/test` | 16 | **386** | 1.6 s |
| `apps/worker/src/lib` | 20 | **368** | 1.7 s |
| `packages/db/test` | 18 | **148** | 1.3 s |
| `packages/isbn/test` | 5 | **68** | 1.1 s |
| `packages/estate-auth/test` | 3 | **59** | 1.2 s |
| `apps/web/src/lib` | 1 | **7** | — | ⚠️ **NOT in the glob — never runs** (candidate 2) |

**`bookbuddy/audiobook_catalog`**

| Suite | Files | Cases | Wall | Command |
|---|---:|---:|---:|---|
| `tests/` (Python) | 82 | **2,242** | ⚠️ **not run** | `python -m pytest --collect-only -q` (3.2 s to collect) |
| `site/__tests__` (JS) | 39 | **963** | 4.4 s | `npx vitest --run` — 39/39 files, 963/963 passed |

**`boardbuddy/Board_Game_Catalog`** — one `tsx --test`, **348 tests / 59 suites / 3.1 s, all green**

| Package | Files | Cases |
|---|---:|---:|
| `apps/worker/src/lib` | 18 | **185** |
| `scripts/test` | 2 | **77** |
| `apps/web/test` | 3 | **47** |
| `packages/db/test` | 2 | **25** |
| `apps/worker/src/routes` | **0** | **0** | ⚠️ 16 route files, no route tests (§5) |

**Green at the time of measurement:** every suite that was run passed —
catalog-platform 3,076/3,076, library_catalog 2,816/2,816, board 348/348,
audiobook JS 963/963. **Zero failures, zero skips, zero todos** in all four
JS/TS runs. Both trees were `git status`-clean of my own doing before and after
(the two new catalog-platform files were another agent's, see the header).

---

## 2. What each group proves

### 2.1 The subject map (approximate)

Files were bucketed by name with a regex, first match wins, so this is a **rough
shape, not a measurement** — "audio/ebook/reader" in particular absorbs every
file under `audiobook-worker` regardless of subject. Case counts here are the
static grep counts, which undercount (§1).

| Subject | Files | ~Cases |
|---|---:|---:|
| audio / ebook / reader | 78 | 1,474 |
| auth, roles, gates, tokens, capabilities | 77 | 1,382 |
| GABI / LLM (conversation, personality, memory, tools, Groq) | 32 | 1,067 |
| ingestion / pipeline / Drive / locks | 26 | 731 |
| clubs / community / reviews / polls | 25 | 660 |
| routes & contracts / health / search / index | 37 | 574 |
| UI & render (pages, shelves, TBR, escaping) | 15 | 348 |
| keys / series / universes | 23 | 347 |
| ISBN & lookup ladder | 5 | 68 |
| backup / restore / R2 | 6 | 55 |
| billing / usage | 2 | 55 |
| other | 88 | 1,760 |

### 2.2 Classification, by the categories the question asks for

Measured by grepping the test files' own header comments across all four repos
(a file can land in more than one bucket):

| Category | Files | How counted |
|---|---:|---|
| **(c) drift pin** — a literal that must equal another file's literal | **114** | header matches `must equal/match`, `parity`, `in sync`, `drift`, `byte-identical`, `copy of` |
| **(b) invariant on a persisted key or migration** | **97** | mentions `work_key` / `series_key` / `title_key` / `change_log` / `migration` |
| **(a) regression for a real shipped bug** | **68** | header names a bug, an incident, a dated failure or a prod symptom |
| **(f) dead / skipped** | **~5** | see §2.6 — and almost all "skips" turn out to be environment guards, not dead code |
| **(d) contract/shape restating the code** | small, and mostly deliberate | the `*-contract.test.ts` family: `me-contract`, `search-contract`, `health-contract`, `work-detail-contract`, `item-detail-contract`, `book-modal-contract`, `agent-board-contract` — each pins a **cross-repo** shape, so it restates a contract, not the code |
| **(e) duplicate coverage** | **~0 found** | every apparent duplicate I opened was a deliberate split; see §2.4 |

**The headline: 68 files exist because something actually broke.** That is
16% of the tree carrying an explicit incident in its header, which is a far
higher ratio than typical — and 114 files exist to stop two hand-kept copies
of a literal from drifting, which is a class of bug this estate has been bitten
by repeatedly and which nothing else catches.

### 2.3 Category (a), the regression tests — quoted, not summarised

Examples read in full, to show what the class looks like:

- `catalog-platform/scripts/test/universe-names-parity.test.mjs` — *"`DotHack`
  was added to data/universes.json on 2026-08-25 and the page stayed one
  universe short until 2026-08-26, silently. Nothing failed. The page served a
  200 with 16 rows for a data file holding 17."*
- `library_catalog/packages/estate-auth/test/instance-estate-app.test.ts` —
  *"`padhard.heygabi.ai` — a SECOND household's catalog — knocked on the estate
  directory wearing the main library's badge"*, invisible for a day.
- `library_catalog/packages/estate-auth/test/billing-denied-shape.test.ts` —
  written when a pretest sync from `catalog-platform 644338d` turned five pins
  red, *"because widening a pin because it went red is how a repo stops
  noticing what its dependency does to it."*
- `catalog-platform/scripts/test/backup-r2-exclusions.test.mjs` — spawns the
  **real** `backup-r2.mjs` against a fake Cloudflare API because *"the bug
  class these tests exist for ('the exclusion looked right and matched
  nothing') is only ever found by running the code, never by reasoning about
  it."*

These are keep-by-default and none of them is a candidate.

### 2.4 Category (e) — the duplicates that are not duplicates

Four pairs looked like redundant coverage on their filenames. **All four were
opened and all four are deliberate splits**, each stating so in its own header:

| Looks like a duplicate | Actually |
|---|---|
| board: `packages/db/test/family-score.test.ts` + `apps/worker/src/lib/family-score.test.ts` | The **QUERY half** (real SQLite, every migration applied, recursive CTE) and the **ARITHMETIC half** (base-weighted mean, null ≠ zero). Each header names the other. |
| cp: `backup-exclusions.test.mjs` + `backup-r2-exclusions.test.mjs` | The **pure half** and the **end-to-end half** (spawns the real script). |
| cp: `universe-names-parity` + `universe-names-generated-parity` | Two **different** hand-kept copies of the universe list — the home page's regex-extracted literal, and the auth Worker's checked-in generated file. |
| audiobook: `test_title_key_fixtures.py` + `site/__tests__/title-key-fixtures.test.js` + library's `packages/core/test/title-key-fixtures.test.ts` | **Three languages, one key.** The title key is persisted in three systems; each side pins the same fixture file. This is category (b)+(c) and is the most load-bearing triple in the estate. |

**Conclusion: I could not find a single genuine duplicate-coverage pair.** If
the owner's intuition was that a suite this size must contain redundancy, the
measurement says otherwise for this estate.

### 2.5 Category (c), the drift pins — the largest group, and the least
obviously necessary

114 files. They exist because the estate is four repos that **vendor copies of
each other's code**: `sync-estate-auth.mjs`, `sync-estate-theme.mjs`,
`sync-estate-search.mjs`, `sync-universes.mjs`, `sync-gabi-conversation.mjs`
all copy a canonical file into a consumer repo, and the copy is then a
hand-kept file the moment nothing proves it current.

⚠️ **These are the tests most likely to be proposed for deletion by someone
who does not know why they exist, and they are exactly the ones to keep.**
Each is the mechanical guard the estate's own "mechanical guards beat written
advice" rule asks for; each replaces a comment saying "keep in sync by hand"
that was measured to be insufficient.

### 2.6 Category (f), dead or skipped — the honest picture

There is **almost no dead test code**. A repo-wide grep for `it.skip`,
`test.skip`, `xit`, `describe.skip`, `@pytest.mark.skip` and `self.skipTest`
returns:

- **JS/TS across all four repos: zero unconditional skips.** The only hits are
  `describeOrSkip = platformDir ? describe : describe.skip` (two audiobook
  fixture files, skipping only when the sibling repo is absent) and four
  `it.skipIf(!generated)` cases in `universe-filter-wiring.test.js`.
- **Python: ~30 skip guards, all environment-conditional** — "no library found",
  "`catalog.csv` not present", "gitignored; present only on the pipeline
  machine".

⚠️ **But the conditional skips have a cost that a green tick hides.**
`tests/test_catalog_completeness.py` collects **11 tests and every one of them
begins with `self.skipTest("No library found (expected in CI environment)")`**.
On the GitHub runner that file proves **nothing**, and it reports as green.
Same shape, smaller share, in `test_ebook_covers.py` (84 collected, several
manifest-gated), `test_shelf_map.py` (34, gated on a generated file) and
`test_cross_catalog_overrides.py` (8, gated on `catalog.csv`).

**Two genuinely orphaned artefacts:**

1. `library_catalog/apps/web/src/lib/gabi-confirm.test.ts` — 7 cases, **not in
   the `npm test` glob**, so it has never gated anything. Its header says
   *"apps/web has no standing test runner"* — which is **stale**: `apps/web/test/`
   holds 31 files and 464 cases that do run.
2. `audiobook_catalog/run_tests.py` — a second, blind test runner (see
   candidate 1).

Also not-run-but-not-dead: `apps/auth-worker/test/live-probes.ts` and
`apps/index-worker/test/live-probes.ts` are named `.ts`, not `.test.ts`, so the
`test/*.test.ts` glob skips them. They are live-probe helpers and this is
correct — noted only so nobody "fixes" the filename and starts hitting live
services from `npm test`.

### 2.7 The prior art on this exact question — read it before acting

⚠️ **The owner already asked this once.** From
`bookbuddy/audiobook_catalog/docs/info/gotchas.md`, section *"A test count is
not evidence — mutate the code and watch"*, recorded **2026-08-16** from the
ask *"make sure we have useful test not just bulk"*:

> Size says nothing about whether a test would **fail if the behaviour broke**,
> which is the only question that matters.

Eight mutations were introduced and the suite was run. **Seven were KILLED**
(stale-lock hours, dropping `O_EXCL` from the lock, two additions-log
mutations, three role-ladder mutations). **One SURVIVED** — `requireDevops()`
opened to anyone not banned — and chasing it *"led to a live
privilege-retention bug in the sibling repo's approver gate (a revoked
approver still passed it)."*

That entry also carries a standing instruction: **"The lock and the additions
log are genuinely well tested — do not 'improve' their tests without re-running
the mutations above."**

**The method to answer "do we need all of them" properly is mutation testing,
not counting.** A file-count survey (this document) can find orphans and
duplicates; only a mutation run can find tests that pass no matter what.

---

## 3. Cost — what gates on what, and where the time goes

### What the suites block

| Gate | Runs | Consequence |
|---|---|---|
| `library_catalog` `predeploy` / `predeploy:friend` | `check-clean` → `deploy-guard` → **`npm run test`** (which fires `pretest`: 5 sync scripts) | ✅ no deploy of either instance without a green suite |
| `Board_Game_Catalog` `predeploy` / `predeploy:games2` | 3 sync scripts → `check-clean` → `deploy-guard` → `npm run typecheck` → **`npm test`** | ✅ same |
| `catalog-platform` `deploy:home` | **`npm test`** → `check:home` → `wrangler pages deploy` → `verify:home` | ✅ the home site cannot ship a universe-list divergence |
| `audiobook_catalog` CI `tests.yml` | `python -m pytest -q` on every push/PR to main | ✅ |
| `audiobook_catalog` CI `js-tests.yml` | `npm test` (vitest) on every push/PR, and `deploy.yml` needs it | ✅ *"the ONLY guard for client-side regressions"* per its own comment |
| `library_catalog` / `Board_Game_Catalog` CI `deploy.yml` | `npm run deploy` → fires `predeploy` → tests | ✅ |
| ✅ **`catalog-platform` CI `deploy.yml`** | **`npm ci` → `npm test` (job `tests`)** → then, per target, `npm ci` → `db:migrate` → `npx wrangler deploy` | ✅ **FIXED `44e81ae`** (2026-09-05). Was 🔴 *"NO TEST GATE — the auth Worker, the index Worker and the home Pages site all deploy from CI without running one test."* All three jobs now carry `needs: tests`; a red suite skips them. ⚠️ **Not yet exercised on a runner** — see §5.1 |

### Where the slowness is

Nothing in this estate is slow. The whole measured surface is **under a minute**.

- **`catalog-platform/scripts/test` is 27.3 s — 70% of that repo's whole
  runtime, for 450 of its 3,076 cases (15%).** The reason is architectural and
  mostly correct: several of those files **spawn real scripts as child
  processes** (`backup-r2-exclusions.test.mjs` says so explicitly) because the
  scripts run their work at import time and there is nothing to import. That
  is the right call for a data-absence bug class, but it is the one place where
  the estate pays real seconds.
- Every other workspace is 1–3 s.
- The audiobook JS suite is 4.4 s for 963 cases.
- ⚠️ **The audiobook Python suite's runtime is UNKNOWN.** It was not run.
  2,242 cases including filesystem, EPUB and pipeline work; it is the only
  suite that could plausibly be slow, and nobody has written its wall time
  down.
- ⚠️ `pretest` in `library_catalog` and `Board_Game_Catalog` runs 3–5 sync
  scripts before a single test executes, and per that repo's
  `docs/info/gotchas.md` those scripts **fail outright inside a git worktree** —
  so `npm test` cannot run in a worktree at all.

**There is no cost case for deleting tests here.** Nothing is gated on a slow
suite; a full four-repo run is well under two minutes.

---

## 4. Candidates — removals and merges

Ordered by confidence. Categories (a) regression and (b) key/migration
invariant are keep-by-default and none appear below.

### 1. `audiobook_catalog/run_tests.py` — RETIRE the runner (not a test)

- **Repo/file:** `bookbuddy/audiobook_catalog/run_tests.py` (+ the reference in
  `scripts/update_author_map_from_csv.py:113`).
- **Cases affected:** 0 tests deleted — it is a *second runner* over the same
  `tests/` directory.
- **What it proves:** nothing that `pytest` does not. It uses `unittest`
  discovery.
- **Why unnecessary:** `.github/workflows/tests.yml` carries the finding in a
  comment: *"run_tests.py uses unittest discovery, which collects 135 tests and
  CANNOT run the pytest-style modules in tests/ — it reported them as import
  errors."* Against today's **2,242** collected tests, this runner sees a small
  fraction and **reports green on a suite it never ran**. A human told to
  "run the tests" by `update_author_map_from_csv.py` gets a false pass.
- **Recommendation:** **DELETE `run_tests.py`**; change the printed hint to
  `python -m pytest tests/test_catalog_completeness.py -v`. If the pretty
  report is wanted, keep the file but make it `exec` pytest.
- **Risk if wrong:** near zero — nothing in CI or any script invokes it.
- **Confidence:** high. This is the clearest single item in the survey.

### 2. `library_catalog/apps/web/src/lib/gabi-confirm.test.ts` — ADOPT or DELETE

- **Repo/file:** `bookbuddy/library_catalog/apps/web/src/lib/gabi-confirm.test.ts`
- **Cases:** 7 (static count; never collected by a runner).
- **What it proves:** the GABI T2 confirm lane's panel apply logic — the flag,
  the client-side compare-and-set, the outcome mapping.
- **Why it is a candidate:** it is **outside the `npm test` glob** and has never
  gated a deploy. Its header's justification (*"apps/web has no standing test
  runner"*) is stale — `apps/web/test/` runs 464 cases today.
- **Recommendation:** **MERGE — move it to `apps/web/test/gabi-confirm.test.ts`
  so the existing glob picks it up.** Delete only if it turns out it cannot run
  without `CATALOG_PLATFORM_DIR` even after `pretest` syncs `@lc/gabi-conv`; in
  that case give it the same `describeOrSkip` guard the audiobook fixture tests
  use, so it skips *visibly* instead of being silently absent.
- **Risk if wrong:** low, but note the direction — this candidate **adds**
  coverage. If it fails once adopted, that failure is information.
- **Confidence:** high that the status quo is wrong; medium on which fix.

### 3. `audiobook_catalog/tests/test_catalog_completeness.py` — MAKE THE SKIP VISIBLE

- **Repo/file:** `bookbuddy/audiobook_catalog/tests/test_catalog_completeness.py`
- **Cases:** 11 — **all 11 guarded by `self.skipTest("No library found
  (expected in CI environment)")`.**
- **What it proves:** on the pipeline box, real completeness of the library.
  **On CI, nothing at all** — and it reports green.
- **Why it is a candidate:** a file that is structurally incapable of failing
  where it gates is category (f) in effect, even though the code is live.
- **Recommendation:** **KEEP the tests, FIX the reporting.** Convert
  `self.skipTest` to a module-level `pytest.mark.skipif` with a named reason so
  the CI summary says *"11 skipped: no audio library"* out loud, and add one
  assertion that runs everywhere (e.g. the parser handles a fixture row).
  ⚠️ **Do not delete** — this is the only check on library completeness.
- **Risk if wrong:** deleting would remove the only completeness guard; the
  recommended change removes nothing.
- **Confidence:** high on the diagnosis, medium on the fix shape.

### 4. `catalog-platform/packages/estate-events` — the phantom test script

- **Repo/file:** `catalog-platform/packages/estate-events/package.json`
- **Cases:** 0. It declares `"test": "tsx --test test/*.test.ts"` and **there is
  no `test/` directory.**
- **Why it is a candidate:** `npm test --workspaces --if-present` will invoke
  it. `tsx --test` on a glob matching nothing is a silent no-op, so the
  workspace reports success for a suite that does not exist. This is the same
  vacuous-pass failure mode `universe-names-parity.test.mjs` warns about.
- **Recommendation:** **either write the tests or delete the script line.** The
  package is the estate event ring, which is referenced in
  `docs/info/worker-event-ring.md` and in `KNOWN_ISSUES.md` KI-10 — it is not
  trivial code, so the honest fix is tests, not deletion of the line.
- ✅ **DONE `9f0c504`** (2026-09-05): tests, not deletion. 32 cases in
  `test/estate-events.test.ts` + `test/event-ring-contract.test.ts`. See §5.5.
- **Risk if wrong:** none from the diagnosis. Deleting the script line loses
  nothing; leaving it as-is keeps a false green.
- **Confidence:** high.

### 5. The `*-contract.test.ts` family — REVIEW, do not delete

- **Repo/files:** `auth-worker/test/me-contract.test.ts`,
  `index-worker/test/search-contract.test.ts`,
  `discord-worker/test/health-contract.test.ts`,
  `library_catalog/apps/worker/src/lib/work-detail-contract.test.ts`,
  `Board_Game_Catalog/apps/worker/src/lib/item-detail-contract.test.ts`,
  `audiobook_catalog/tests/test_book_modal_contract.py`,
  `catalog-platform/apps/auth-worker/test/agent-board.test.ts`.
- **Cases:** ~7 files; individual counts not separately measured.
- **What they prove:** the shape of a payload **as it crosses a repo boundary**.
- **Why they look like candidates:** category (d) on the surface — they restate
  a type that TypeScript already checks.
- **Recommendation:** **KEEP ALL.** The type check is intra-repo; the consumer
  is in a *different* repo and compiles separately, so nothing but these files
  notices a field being renamed. `docs/info/agent-board-contract.md` exists for
  exactly this reason. Listed here only so a future reader does not have to
  re-derive why they survived a cull.
- **Risk if wrong:** deleting these is how a cross-repo field rename ships.
- **Confidence:** high.

### Explicitly considered and REJECTED as candidates

| Rejected | Why |
|---|---|
| The 8 TBR files in `library_catalog` (`tbr`, `tbr-fold`, `tbr-picker`, `tbr-media-fold`, `tbr-elsewhere`, `tbr-picker-formats`, `tbr-search`, `tbr-stage-anim`) | Four different layers (core fold, db clause, web view, animation). No two assert the same fact. |
| The 8 `test_pipeline_*.py` files | Lock, single-flight wiring, schedule, steps, watcher steps, status steps, sanctity fixes, real-book run — different subjects, and §2.7 names the lock and additions log as **not to be touched** without re-running mutations. |
| The 3 copies of the title-key fixture pin | Deliberate cross-language pin on a **persisted key** — category (b), the highest-value class here. |
| `revoke-clears-powers` + `revoke-clears-site-role` | Two different revocation surfaces; the mutation run of 2026-08-16 found a live privilege-retention bug in exactly this area. |
| The 114 drift pins | Each replaces a "keep in sync by hand" note that was measured insufficient. |

**Net: 5 candidates, of which only one (`run_tests.py`) is a deletion, and it
deletes zero test cases.** Three of the five *increase* what the suite proves.

---

## 5. The other half of the question — what is MISSING

*"Do we truly need all of them"* cuts both ways, and this is the larger finding.

1. ✅ **FIXED in `44e81ae`** (2026-09-05) — *"`catalog-platform`'s CI deploy runs
   no tests."* `.github/workflows/deploy.yml` deployed `index-worker`,
   `auth-worker` and the `heygabi-home` Pages site with `npx wrangler deploy` /
   `wrangler pages deploy` and **never invoked `npm test`** — while
   `library_catalog` and `Board_Game_Catalog` both gate their CI deploys
   through `predeploy`. The 3,076 tests in this repo protected the *local*
   deploy path only. This was named the single highest-value change in this
   document. A `tests` job now runs the root `npm test` and all three deploy
   jobs carry `needs: tests`; the workflow is documented for the first time in
   [`../access/ci-deploy.md`](../access/ci-deploy.md), which did not exist
   either. ⚠️ **Shipped is not verified: the job has never run on a runner.**
   Every target is live and the only trigger is `workflow_dispatch`, so there
   is no dry run — the first dispatch is the measurement, and `ci-deploy.md` §4
   says exactly what it will show.
2. ✅ **CLOSED the same day** (2026-09-05 evening, agent W9-BOARD-ROUTES) — was:
   🔴 *"`Board_Game_Catalog` has 16 route files and zero route tests.
   `apps/worker/src/routes/` holds `admin.ts`, `users.ts`, `scan-jobs.ts`,
   `export.ts`, `covers.ts`, `vision.ts` and ten more. `library_catalog` tests
   its routes with 13 files / **519 cases**; the board repo tests its `lib/`
   thoroughly (185 cases) and its routes not at all. `users.ts` and `admin.ts`
   are role-bearing surfaces."*

   **Now 16 route test files / 387 cases**, one per route file, using
   `library_catalog`'s own harness (a real `Request` through a bare Hono app, a
   fake `requireAuth` planting a role, `requireCapability` left real, the
   refusal read off the wire) — the two repos share lineage and the board tests
   now look like the library's on purpose. Commits `231d1da`, `d335ed1`,
   `47fb45c`, `975386c`, `a61a51e`; the write-up is that repo's `DONE.md`.

   🔴 **And this is the single best piece of evidence in this whole document for
   §6's claim that the GAPS matter more than the count: the first tests ever
   written into the largest gap found TWO REAL BUGS**, one of them live and
   role-bearing — an `admin` can demote the last `owner`, `countOwners()`
   reaches 0, and after that no role in the app can mint an `owner` again.
   `library_catalog` had the identical bug as its 2026-08 audit HIGH and fixed
   it; the board repo never took the fix. Filed as
   `Board_Game_Catalog/docs/KNOWN_ISSUES.md` **KI-7** (and **KI-6**, a 401 that
   leaves as a bare code — which the library's Worker shares). Neither was
   fixed by the agent that found them: role-bearing changes are the conductor's
   call.
3. ⚠️ **`Board_Game_Catalog` scripts: 10 `.mjs`, 2 tested.**
   `provision-catalog` and `push-secrets-instance` are covered (77 cases);
   the other eight are not. `catalog-platform` tests 26 of 22 scripts (more
   test files than scripts) and `library_catalog` 16 — the board repo is the
   outlier.
4. ✅ **FIXED in `a6f0324`** (2026-09-05) — *"`catalog-platform/apps/ebooks-door`
   has no test script at all"*: no `"test"` key in its `package.json`, so
   `npm test --workspaces` skipped it silently, and the state was invisible
   rather than decided. It now has the key and **15 cases**. ⚠️ **The judgement
   call, now made and written down:** the door has **no auth or refusal path of
   its own** — its own header says *"THIS DOOR IS NOT THE LOCK"*, the gate is
   `apps/audiobook-worker`'s `GET /api/ebooks/manifest`, and no rule added
   there would protect anything. So the suite pins what the door does decide:
   the 2026-08-17 `/` → `/ebooks` redirect escape, the PROD-only origin, and
   verbatim pass-through — including that a refusal arrives with the origin's
   WORDS rather than a bare status this door invented, and that 401/500/503
   stay distinguishable from one another.
5. ✅ **FIXED in `9f0c504`** (2026-09-05) — *"`packages/estate-events` declares a
   suite that does not exist"* (§4.4): the event ring is the subject of
   `KNOWN_ISSUES.md` KI-10 and it reported green on nothing. **32 cases** now,
   in two files: the three properties from the module's own header made
   mechanical, and a contract pin **derived from the receiver's source** in
   another workspace (`apps/auth-worker/src/worker-events.ts`) — which
   includes the KI-10 assertion that what goes on the wire is a bare event
   object and never an `events` wrapper.
6. ⚠️ **No mutation run since 2026-08-16, and it covered 8 mutations.** The one
   survivor found a live security bug. The estate's own doc says a test count
   is not evidence; nine days later, the only evidence we have is still those
   eight. **A fresh mutation pass over the auth/role/gate group (77 files,
   ~1,382 cases — the largest and most security-bearing group) would answer the
   owner's question far better than this inventory does.**
7. ⚠️ **`test_catalog_completeness.py` proves nothing on CI** (§4.3), and
   several other Python files skip large fractions there. Nobody has measured
   how many of the 2,242 collected cases actually **execute** on the runner.
   That number is unknown and should be measured.

---

## 6. The answer, in one paragraph

**9,445 cases in 415 files, and the honest verdict is that the estate does need
substantially all of them.** 68 files carry a named incident in their header,
114 exist to stop hand-kept copies of a literal drifting across four repos, and
97 guard a persisted key or a migration — three categories that are
keep-by-default and account for most of the tree. I found **no genuine
duplicate coverage**: every pair that looked redundant turned out to be a
documented split (pure vs end-to-end, arithmetic vs query, two different
hand-kept copies). The removal list is **one file that contains no tests**
(`run_tests.py`, a blind second runner), and four items that *increase* what
the suite proves. The suite is also cheap — the entire measured surface runs in
under a minute, so there is no cost argument for cutting it. **The real
findings are the gaps:** `catalog-platform` deploys from CI with no test gate
(✅ **fixed the same evening, `44e81ae`** — §5.1, though the job has not yet run
on a runner), the board catalog has 16 untested routes (✅ **also closed the
same evening** — §5.2, 387 new cases), and the estate's own
standing advice
— *"a test count is not evidence — mutate the code and watch"* — has not been
re-run since 2026-08-16, when 1 of 8 mutations survived and led straight to a
live privilege-retention bug.

🔴 **Postscript, 2026-09-05 evening — the paragraph above understated its own
conclusion.** Closing §5.2 did not merely add 387 cases; **the first tests
written into that gap found a live privilege bug** (an `admin` can demote the
last `owner` — board `KNOWN_ISSUES.md` KI-7) that had been shipping for weeks,
and a second, smaller refusal defect beside it. That is the same shape as the
2026-08-16 mutation run cited at the end of this paragraph: **both times, the
cheapest possible probe into an untested area found a real privilege bug on the
first try.** Two data points is not a rate, but it is two more than the count
of 9,445 provides, and it points the same way — the answer to *"do we need all
of them"* is that the estate needs the ones it does not have yet.

---

## Provenance of every number here

| Claim | How measured, 2026-09-05 |
|---|---|
| catalog-platform 3,076 | `npx node --test "scripts/test/**/*.test.mjs"` + `npx tsx --test test/*.test.ts` in each of 7 workspaces; summed the runners' own `ℹ tests` lines |
| library_catalog 2,816 | `npx tsx --test <glob>` for each of the 8 globs in the root `test` script; summed `ℹ tests` |
| audiobook Python 2,242 | `PYTHONIOENCODING=utf-8 python -m pytest --collect-only -q` → *"2242 tests collected in 3.17s"*. ⚠️ **collected, not run** |
| audiobook JS 963 | `npx vitest --run --reporter=dot` → *"39 passed (39) / 963 passed (963) / Duration 4.44s"* |
| board 348 | `npx tsx --test <the root script's globs>` → *"tests 348 / suites 59 / pass 348 / duration_ms 2251"* |
| File counts | `find <repo> -name "*.test.*" -o -name "test_*.py"`, excluding `node_modules`, `.venv`, `dist`, `__pycache__` |
| Category counts (68 / 114 / 97) | `grep -rli` over test-file headers for the phrase sets named in §2.2 |
| Skip inventory | `grep -rnE "(it\|test\|describe)\.(skip\|todo)\|xit\(\|@pytest.mark.skip\|self.skipTest"` |
| Gate table | read `package.json` `pre*` scripts and all 13 `.github/workflows/*.yml` |
| Mutation evidence | quoted from `bookbuddy/audiobook_catalog/docs/info/gotchas.md`, dated 2026-08-16 — **not re-run** |
