# Audiobook association as a route — design

> **Audience:** Claude sessions first, the owner second. **Status:** TRACKED —
> ⚠️ ~~**DESIGN ONLY. NOTHING IS BUILT.**~~ ~~**PHASE 0 IS BUILT** … **Steps
> 6–14 are still design only: there is no route, no cron, no migration and
> nothing deployed.**~~
> 🔴 **ALL OF §9 IS BUILT AND DEPLOYED TO BOTH INSTANCES — steps 1–5
> 2026-09-05 (agent W6-AUDIO-A), steps 6–14 2026-09-06 (agent W6-AUDIO-B).**
> The route, the cron, migration 0470, the on-add hook and the `/api/health`
> line are all live. 🔴 **It ships in SHADOW: it computes its whole plan and
> writes NOTHING, and STEP 11 of the audiobook pipeline is still doing all the
> writing** — so the owner's original complaint is not closed and the library
> TODO item stays open. The ✅ blocks under §9's table carry what landed, what
> was measured, and the **eight** places this design was wrong or silent when it
> met the code. **Operating it:
> `library_catalog/docs/access/audiobook-sweep.md`.**
> **Last verified: 2026-09-06.**
>
> **Why it exists.** Owner, 2026-09-05 16:37 Phoenix: *"I added battle mage
> farmer and it didn't associate the audiobook right away."* Then 16:50:
> *"Should we make all the scripts routes? Or at least the ones we use a lot"* →
> *"Do inventory and audiobook. Then do the scripts you think are the best for
> routes."* The inventory half is
> [`scripts-inventory-2026-09-05.md`](scripts-inventory-2026-09-05.md).
>
> ### ✅ Measured 2026-09-05
>
> | Claim | How |
> |---|---|
> | `https://audiobooks.heygabi.ai/catalog.csv` is publicly fetchable | `curl -s -D -` → **200**, `content-type: text/csv`, **1,414,828 bytes**, `Access-Control-Allow-Origin: *`, `ETag: "4d4d09ade4b45fb1baa48ab7880b7a34"`, `cache-control: no-cache` |
> | The live CSV equals the on-disk CSV | byte diff — **every** differing line differs in CRLF-vs-LF only |
> | Its 16 columns | `title,series,series_index_display,series_index_sort,author,narrator,year,genre,duration_hhmm,cover_href,companion_files,desc,library_work_id,library_formats,universe,series_gap` |
> | `cover_href` is a **relative** path | sample row: `covers/A. American/Avenging Home - The Survivalist Series, Book 7.jpg` |
> | The sweep already runs ≈3×/day on **both** instances | `sync_to_drive.py:3162 _run_sibling_link` → `_link_one_instance` with `--remote [--friend] --commit`, on task `AudiobookSyncPipeline` (every 8h, last run 2026-09-05 16:00, result 0) |
> | `packages/core/src/matching.ts` is already Worker-pure | its only imports are `./constants.js` and `./titles.js` |
> | The account is on **Workers Paid** — crons 5 → 250 | `apps/discord-worker/wrangler.toml:26`; **5 cron strings in use across 3 Workers** |
> | The library Worker already has `scheduled()` | `apps/worker/src/index.ts:321`, cron `"7 * * * *"` on main **and** `[env.friend]` |
> | The index's push schema carries **no narrator, no `series_index_display`** | `apps/index-worker/src/rows.ts` `pushRowSchema` is `.strict()` |
>
> ### ⚠️ NOT verified
>
> - ~~**No code was run and no database was read**~~ — ✅ **superseded
>   2026-09-05 by phase 0**: `backfill:audiobooks -- --remote` was run as a DRY
>   run against **both** instances, before and after the extraction, and the
>   outputs diffed byte for byte (both EMPTY). Still never `--commit`, and still
>   nothing local. Every claim below this line remains unverified.
> - **The CPU cost of the matcher inside a Worker is UNMEASURED.** §3.4 states
>   the budget it must be measured against before phase 3. Treat every timing
>   claim below as a *bound to prove*, not a fact.
> - **Whether the 16:00 pipeline run's STEP 11 actually reached *Battle Mage
>   Farmer*** was not checked — that needs a D1 read. §1 diagnoses the
>   *structural* gap, which holds regardless.
> - `audiobook_catalog/docs/` is **gitignored**; read, never written.

---

## 1. ⚠️ The diagnosis is not "nobody runs it"

**The sweep is already automated.** `npm run backfill:audiobooks` is **STEP 11**
of the audiobook pipeline, has been since before 2026-08-25, and runs against
**both** library instances every 8 hours.

So the owner's complaint is not a missing job. It is this:

> 🔴 **The trigger is on the wrong side of the relationship.**
> The association fires when the **audiobook** catalog changes. The owner added
> a book to the **library**. Nothing on the library side has a trigger at all.

Everything follows from that one sentence:

| | Audiobook side | Library side |
|---|---|---|
| Changes when | a book is downloaded/converted | **the owner adds a book** |
| Trigger | `AudiobookSyncPipeline`, every 8h | **none** |
| Worst-case wait | 8h | **8h, and only if the home PC is on** |

*Battle Mage Farmer*'s audiobooks were already in the CSV — `grep -c` finds
**11 rows** on disk, in a file last committed **2026-09-04 16:26**, a day before
the owner added the print book. The data was there the whole time. **The library
had no way to ask.**

⚠️ **This also means the fix is NOT "run the sweep more often".** A cron alone
still leaves a gap between the add and the next tick. **The on-add hook (§4) is
the part that answers "right away"; the cron is the backstop that catches what
the hook missed.** Building only one of the two rebuilds the same complaint at a
shorter interval.

---

## 2. One canonical implementation — what moves and what does not

### 2.1 ⚠️ The matcher does NOT move, because it is already shared

`packages/core/src/matching.ts` — `buildWorkIndex`, `matchIndexedWork`,
`matchIndexedWorkAll`, the author gate, `disambiguateByVolume`, the containment
rung — imports **only** `./constants.js` and `./titles.js`. It is pure, it is
already exported from `@lc/core`, and the Worker already bundles it.

🔴 **Nothing about the matcher may be reimplemented, wrapped in a second
similarity function, or "adapted for the Worker".** `matching.ts` opens with
three wrong-game matches the Board Game Catalog shipped, *every one from a second
similarity function drifting from the first*. That file's existence is the whole
reason this conversion is safe; a copied matcher would make it unsafe.

### 2.2 The four pieces that DO move

Today they live only in `scripts/`, which is why only a script can do this work.

| # | New file | From | Why it must be pure |
|---|---|---|---|
| **A** | `packages/core/src/audiobook-csv.ts` — `parseAudiobookCsv(text): AudiobookRow[]` | `scripts/lib/audiobooks.mjs` lines 46–113, **verbatim** minus `node:fs`/`node:path` | The CSV parser and the row mapping (`cleanTitleWithSeries`, `parseVolumeNumber`, the `seriesIndex` duplicate field for `buildWorkIndex`) are the **row identity**. Two parsers = two different ideas of what a row is |
| **B** | `packages/core/src/series-canon.ts` — `canonicalSeries(name)` | `scripts/lib/series-canon.mjs` | Phase 2's fold. ⚠️ **A behaviour difference is unavoidable here — see §2.4** |
| **C** | `packages/core/src/audiobook-sweep.ts` — `planAudiobookSweep(input): SweepPlan` | `scripts/backfill-audiobook-holdings.mjs` lines 166–444, the whole of phases 1 and 2 | The decisions: which editions a work reaches, `VIA_RANK` tie-breaking, which rungs exist, `corroborated`, what goes stale. **This is the file the tests point at** |
| **D** | `packages/db/src/audiobook-holdings.ts` — `applyAudiobookSweepPlan(db, plan, actor)` | the `statements.push(...)` calls | The D1 write, as **prepared statements in a batch** |

### 2.3 ⚠️ The plan is DATA, not SQL

This is the hinge of the whole extraction. The script builds **SQL strings**
today (`lit(...)` interpolation, executed through `wrangler d1 execute`); a
Worker binds **prepared statements**. If `planAudiobookSweep` returned SQL, only
one of the two callers could use it.

So it returns rows:

```ts
export interface SweepPlan {
  editionUpserts: AudiobookEditionRow[];   // one per (work_id, audio_key)
  editionStales:  { workId: number; audioKey: string }[];
  rungUpserts:    AudiobookSeriesRungRow[];
  rungStales:     { series: string; indexSort: number }[];
  transitions:    AssociationTransition[]; // §6.3 — gained / lost, per work
  report:         SweepReport;             // exactly what the script prints today
}
```

- The **script** renders the plan through its existing `lit()` + `execute()` path
  and prints `report` through its existing `console.log` block. **Its output must
  not change by one character** — that is phase 0's acceptance test (§7).
- The **route** binds the plan through `applyAudiobookSweepPlan` and returns
  `report` as JSON.

### 2.4 ⚠️ The one behaviour difference, stated out loud

`scripts/lib/series-canon.mjs` reads `catalog-platform/data/series-canon.json`
**live, out of the sibling checkout**, and its header explains why: the script is
hand-run with no `pre` hook, so the generated copy could be hours stale.

**A Worker cannot reach across repos at runtime.** It must read the copy
`scripts/sync-universes.mjs` materialises into `packages/universes/generated/`,
which is refreshed by `prebuild`/`pretest`/`pretypecheck`.

**Consequence:** the route's series canon is as fresh as the **last deploy**; the
script's is as fresh as the **last `git pull` of catalog-platform**. They can
disagree, and when they do the *route* is the stale one.

**Accepted, with a guard.** The canon governs only phase 2's `fold`-vs-`work_match`
hedging (`AUDIO?` vs `AUDIO`), never phase 1's per-work matching, and a missing
canon already degrades to plain `normaliseTitle` by design. The guard: the route
reports the canon's **entry count** in its status line (§6), so a deploy that
shipped an empty or stale canon is visible in one curl rather than as a page full
of `AUDIO?` months later.

---

## 3. The data source — the published CSV, not the index Worker

## 🟢 DECISION: `GET https://audiobooks.heygabi.ai/catalog.csv`

### 3.1 Why not the index Worker, even though it holds audiobook rows

`index.heygabi.ai` really does carry the audiobook rows (pushed by pipeline STEP
7, and it is the index's only writer). It is still the wrong source, for three
measured reasons:

| # | Problem | Evidence |
|---|---|---|
| **1** | 🔴 **It has no `narrator` and no `series_index_display`.** `pushRowSchema` is `.strict()` and its full vocabulary is `source_id, title, creator, series, series_index, year, publisher, format, kind, parent_source_id, cover_url, detail_url` | `apps/index-worker/src/rows.ts`. `app/index_push.py`'s header states the omission is **policy**: *"Ownership does not travel — no purchase data, **narrators**, durations, descriptions, progress, or personal fields."* |
| **2** | `audiobook_edition_holding` **stores both**, and `narrator` is migration 0390's entire point — the field that tells the household's two *Elantris* recordings apart at a glance ("a fourteen-name full cast against 'Jack Garrett'") | the table's columns; the script's `multiEdition` report block |
| **3** | The index stores a **canonicalised absolute** `cover_url`; the holding table stores the CSV's **relative** `cover_href` (`covers/<Author>/<file>.jpg`) | `canonical_cover_url()` in `index_push.py`; the sample row in the header above |

⚠️ **Using the index would mean widening the estate's default-deny privacy
projection to carry narrators — a policy change, made to solve a plumbing
problem.** That is the wrong trade in the wrong direction. The projection is
default-deny on purpose (`index-worker-design.md` §4.1); a leaked index token
should not hand out who reads what.

There is a fourth, subtler reason: the index **folds and refuses on write** — a
row whose fold is degenerate stores `NULL` and drops out of key joins. Matching
against a *projection with its own refusals* means the two catalogs can disagree
about which rows exist. The CSV is the source of truth; the index is a view of it.

### 3.2 Why the published CSV is right

1. **It is the same file.** `site/catalog.csv` is git-tracked in
   `audiobook_catalog` precisely so its Pages deploy ships it. Measured today:
   the live bytes equal the disk bytes apart from line endings, and
   `parseCsv` already skips `\r` (`else if (c !== '\r') cur += c`), so **the
   shared parser sees identical rows over both transports.** That is what makes
   "one canonical implementation" true rather than aspirational.
2. **Every column the table needs is present**, including `narrator` and
   `series_index_display`.
3. **It is served with CORS `*` and an `ETag`** — so the Worker can
   conditional-GET and skip the 1.4 MB body when nothing changed (§3.3).
4. **The disk path survives unchanged.** `scripts/lib/audiobooks.mjs` keeps
   `LC_AUDIOBOOK_ROOT` and `existsSync`; it just hands the text to
   `parseAudiobookCsv` instead of parsing it itself. **An offline run, a run
   before a deploy, and a recovery run all still work** — which is exactly why
   the script is not retired (§7).

### 3.3 Freshness, honestly

The live CSV is only as fresh as the last pipeline **STEP 6** commit plus its
Pages deploy. Measured: last commit touching it is `f78dede 2026-09-04 16:26`.
**So the route's view of the audiobook catalog can lag the home PC's disk by up
to one pipeline cycle.**

**That is acceptable, and it is not the bug being fixed.** The audiobook side
changes ≈3×/day *and already has its own trigger*. The side with no trigger is
the library. A route reacting to library adds against a ≤8h-old audiobook
snapshot closes the owner's gap completely; STEP 11 continues to cover the
reverse direction on its own clock.

**Caching:** store `etag` + `fetched_at` + the parsed row count in a small
`audiobook_snapshot` table (or KV). Send `If-None-Match`; a `304` means reuse the
last plan's inputs and record a `skipped: unchanged` run. ⚠️ The **on-add hook
must never fetch 1.4 MB** — it reads the cached snapshot, and if there is none it
records `deferred: no snapshot` and lets the cron do it. Warming the cache is the
cron's job, not the add's.

---

## 4. Cadence and the on-add hook

### 4.1 The cron — a SECOND string on the library Worker

Follow the **games** Worker's shape (`Board_Game_Catalog/apps/worker/src/index.ts:244`),
which already dispatches three crons through one `scheduled()` on `event.cron`.
The library Worker has one; it gains a second.

```toml
# apps/worker/wrangler.toml
[triggers]
crons = ["7 * * * *", "23 */4 * * *"]
```

- **`*/4` hours, not hourly.** The CSV changes ≈3×/day. An hourly tick would
  conditional-GET 24×/day for ~3 real changes; every extra tick is cost with no
  freshness. Six ticks/day comfortably covers three writes.
- **Minute 23.** Not `:00` (the whole world fires there — the existing sweep's
  own comment says so) and **not `:07`**, where the details sweep already lives:
  the games repo's comment records that two cron invocations in the same minute
  *compete for the same subrequest budget*.
- ⚠️ **`AUDIOBOOK_SWEEP_CRON` in `lib/audiobook-sweep-run.ts` must match this
  string character for character**, and a test must read the toml and assert it —
  both existing sweeps have exactly that test, and both wrangler files warn that
  a drift makes the sweep stop firing while both files still look correct.
- ⚠️ **An unrecognised cron does NOTHING, loudly.** Keep `index.ts`'s existing
  `console.error('cron fired that nothing handles', ...)` as the else branch. Do
  not let a new cron fall through to the details sweep — the games Worker's
  comment records that its sibling did exactly that "because it had a schedule
  before it had a dispatcher".
- ⚠️ **Return the promise AND `ctx.waitUntil` it**, as `scheduled()` already
  does. `waitUntil` alone silently cancels ~30s in; roughly half the sibling
  project's runs died that way with run rows stuck at `running` for eleven hours.

### 4.2 The on-add hook — where a work is created

`packages/db/src/works.ts:213 createWork` is **the one insert site** (`grep`
finds a single `INSERT INTO work`). It has **three** callers:

| Caller | What it is | Hook? |
|---|---|---|
| `apps/worker/src/routes/catalog.ts:600` — `POST /api/works` | a person adding a book | ✅ **yes** — this is the owner's path |
| `apps/worker/src/routes/gabi-delegated.ts:686` | GABI adding a book on request | ✅ **yes** |
| `apps/worker/src/routes/ingest.ts:227` | the machine-token bulk ebook importer | 🔴 **NO — see §4.4** |

🔴 **Put the hook in the ROUTES, never inside `createWork`.** Two reasons, both
structural: `createWork` receives a `D1Database`, not an `ExecutionContext`, so
it *cannot* schedule background work; and it is called in bulk by the importer,
where one hook per row is the wrong behaviour.

### 4.3 `ctx.waitUntil`, not a queue, not inline

| Option | Verdict |
|---|---|
| **Inline** (await before responding) | 🔴 **No.** The add would wait on a snapshot read, an index build and a match. That is precisely "slowing the add" |
| **Cloudflare Queues** | 🔴 **No.** A new binding, a producer, a consumer and a new failure domain — for one row. Both instances would need it. Revisit only if §4.4's batching proves insufficient |
| **`ctx.waitUntil`** | 🟢 **Yes** |

⚠️ **And `waitUntil` is safe *here* precisely because of what it is not doing.**
The 30-second cancellation that bit the details sweep bit it because a details
lookup takes 20–90 seconds against a third party. The per-work association does
**one D1 read of the cached snapshot, one index build, one `lookupAll`, and one
upsert** — no external call at all when the snapshot is warm. It must stay that
way: 🔴 **if the per-work path ever needs to fetch the CSV, it must defer to the
cron instead of fetching.**

The full sweep in `scheduled()` keeps the return-and-register belt-and-braces,
because it *is* long.

### 4.4 🔴 The bulk-import guard — the one that will bite

`routes/ingest.ts` creates works in a loop. One hook per row against a
1,000-book import is 1,000 index builds.

**The rule:** the per-work hook takes an explicit `{ association: 'per-work' | 'defer' }`
and the importer passes `'defer'`, collecting work ids and firing **one**
`associateWorks(ids)` in `ctx.waitUntil` at the end of the batch. `buildWorkIndex`
runs once for the whole batch either way — the index is over the *audiobook*
rows, not ours, so it is the same index for every work in the run.

---

## 5. Both instances

**Nothing new is needed, and that is the point.**

- **Same cron string on `[env.friend].triggers`.** The existing block already
  does this for `"7 * * * *"`, with the comment: *"Same cron STRING as the main
  instance, deliberately — `scheduled()` dispatches on `DETAILS_SWEEP_CRON` and
  an unrecognised cron does nothing. A different minute here would silently
  disable her details sweep."* ⚠️ **The same trap, verbatim, applies to the new
  string.** Add both strings to both `[triggers]` blocks in the same edit.
- **Same hook.** One codebase, one bundle, both instances — per the estate rule
  that every catalog change lands on both catalogs, and there is no
  instance-specific branch here to write.
- **Samantha's rows come from the SAME CSV.** The owner decided 2026-08-25 that
  he and padhard share **one** audio/ebook pool — which is exactly why STEP 11
  already runs `--friend`, and why `catalog-platform/docs/TODO.md`'s
  owner-confirmed ownership table lists `audiobook` as **digital · shared (estate
  pool)**. Her instance fetches the same URL and matches it against **her own**
  `work` rows. There is no second source and there must not be one.
- ⚠️ **Two D1s are two failure domains.** `_run_sibling_link` already models
  this correctly — each instance reports its own line, a mixed outcome is a named
  `partial`, and a friend failure never fails main. **In the route this is free**:
  each instance's cron fires in its own invocation against its own database, so
  there is no combined result to get wrong. Do not build a cross-instance
  reporter.
- **Migrations are a pair** (`db:migrate` **and** `db:migrate:friend`), before
  the deploy pair (`deploy` **and** `deploy:friend`).

---

## 6. Idempotency, the stale rule, and the change log

### 6.1 Idempotency — unchanged

`ON CONFLICT(work_id, audio_key) DO UPDATE SET … last_seen_at = datetime('now'),
stale_at = NULL` is already idempotent and already the right shape. The route
uses the **same statement**, bound rather than interpolated. A second run inside
one minute produces the same rows.

### 6.2 🔴 The stale rule is where a route can do damage a script cannot

The script's guard:

```js
if (audiobooks.length === 0) {
  console.error('No audiobook rows were read. That is a missing file, not an
    empty catalog — running on would mark every existing holding stale.');
  process.exit(1);
}
```

⚠️ **A Worker's failure mode is worse than a missing file, because it looks like
success.** A Pages deploy mid-flight, a truncated body, an origin error page
served with a `200` — each yields a parse that "worked" and returned few or zero
rows. The stale sweep would then mark **every holding in the catalog** stale, on
both instances, silently.

**Three guards, all required:**

| # | Guard | Rule |
|---|---|---|
| **1** | **Zero rows is a failure** | Port the script's check exactly. `0` rows → abort the run, record `failed: empty snapshot`, write nothing. This is also the index Worker's own rule: *"zero rows is a failed export, not an empty catalog"* |
| **2** | 🔴 **Mass-drift cap** | Compare the parsed row count against the last **successful** run's count. A drop of more than **3%** aborts the run and records `failed: drift` with both numbers. Precedent: `drive_role_parity.py`'s `MASS_DRIFT_CAP=3`. A catalog does not lose 3% of its rows between ticks; a broken fetch does |
| **3** | 🔴 **The per-work hook NEVER stales anything** | It has looked at exactly one work, so it has no standing to say any *other* row is gone. `planAudiobookSweep` takes a `scope: { kind: 'all' } \| { kind: 'works', ids: number[] }`, and the stale phases run **only** under `kind: 'all'`. This must be a type-level distinction, not a flag somebody remembers |

Also unchanged: **marked, never deleted** — migration 0010's rule. A row
vanishing looks identical to the audiobook having gone away.

### 6.3 The change_log rows — transitions only

Today the script writes these tables with **no audit rows at all**.

🔴 **Do not log every upsert.** The sweep touches every live row every run; at
six runs/day that is thousands of rows/day in a table a person is meant to read.

**Log transitions.** One row per work whose association *changed state*:

| Field | Value |
|---|---|
| `batch_id` | one `crypto.randomUUID()` per sweep run — so a run's rows are one group, exactly as `createWork` groups its own |
| `entity` | `'audiobook_holding'` |
| `entity_id` | the `work_id` |
| `field` | `__row__` (the existing whole-row sentinel `createWork` uses) |
| `old_json` / `new_json` | the edition keys + `matched_via` before and after — `null` → `{…}` on gain, `{…}` → `null` on loss |
| `changed_by` | `NULL` |
| `changed_how` | `'auto'` |
| `note` | `'audiobook sweep (cron)'` / `'audiobook sweep (on add)'` / `'audiobook sweep (admin)'` — ⚠️ **which trigger fired is the fact worth keeping**, because it is the only way to tell later whether the hook is working or the cron is quietly carrying it |

⚠️ **Reuse `changeLogInsert` from `packages/db/src/changes.ts`.** It is the one
implementation, it already handles the `last_insert_rowid()` case, and its
`note` semantics (`undefined` inherits, explicit `null` suppresses) are already
settled. Write the audit rows **in the same batch** as the upserts — atomically
or not at all, the rule `createWork` already follows.

---

## 7. Admin route and the status line

### 7.1 Routes

| Route | Who | Does |
|---|---|---|
| `POST /api/admin/audiobooks/sweep` | admin | Full sweep, now. Body `{ dryRun?: boolean }`. Returns the `SweepReport` verbatim — the same numbers the script prints |
| `GET /api/admin/audiobooks/sweep` | admin | Last run: trigger, started/finished, snapshot `etag` + row count + `fetched_at`, editions live/stale, rungs live/stale, `via` breakdown, drift verdict, canon entry count (§2.4) |

⚠️ **`dryRun` must produce the plan and write nothing** — that is the phase-2
shadow mechanism (§8) and the instrument that proves the route equals the script.

⚠️ **Never a bare status.** Per the estate rule, an admin route refusing a
non-admin says *what happened, what it needs, and how to get it* — and the
control is not rendered for someone who cannot use it, rather than rendered and
refusing.

### 7.2 The status line — extend `/api/health`, do NOT build a page

🔴 **One fact, one home applies to surfaces.** `apps/worker/src/routes/health.ts`
already answers `{ ok, service, version, time, detail }`, is **unauthenticated on
purpose**, and the apex `/status` page reads it. Add **one key** to `detail`:

```jsonc
"audiobookSweep": {
  "lastRunAt": "2026-09-05T23:23:00Z",
  "trigger": "cron",
  "state": "applied",          // applied | in-sync | skipped | failed | drift
  "snapshotRows": 1088,
  "snapshotFetchedAt": "2026-09-05T20:23:00Z",
  "editionsLive": 412,
  "rungsLive": 780,
  "seriesCanonEntries": 31
}
```

Counts and timestamps only — the same posture `universes`, `gabi.panel` and
`estate` already have there: *"names and booleans, never a value"*. Both
instances answer independently, which is how `/status` gets to show main and
padhard side by side for free.

🟡 **A second reporter already exists** — STEP 11's `_link_report` renders on the
audiobook status page. Once the route lands, **the route's row is authoritative**
and STEP 11's line becomes a cross-check. Say so on both pages, in one line each,
rather than letting two numbers quietly disagree.

---

## 8. Migration path — the script does not get retired

⚠️ **Shadow-first, per the estate's own enforcement rule: off → shadow → enforce,
flipped only on measured equality, never as a side effect of an unrelated
deploy.**

| Phase | What ships | Gate to the next phase |
|---|---|---|
| **0 — extract** | The four modules (§2.2); the script rewired to call them. **No route, no cron.** | 🔴 **The script's dry-run output is BYTE-IDENTICAL before and after.** Capture `npm run backfill:audiobooks -- --remote` to a file on the current code, re-run after the extraction, `diff` must be empty. The report block was written to be read line by line; that is what makes it the diff instrument |
| **1 — route, dark** | `POST …/sweep` with `dryRun` only. No cron string. | The route's plan on the live snapshot equals the script's plan on the same CSV — same edition keys, same `matched_via`, same rung set, same stale set |
| **2 — shadow** | Cron string added; handler computes the plan and **writes nothing**, logging what it would have done. STEP 11 still does the writing. 🔴 **A shadow tick fetches UNCONDITIONALLY** — see the correction under this table. | **Zero divergences over a week** (≥42 ticks), read off `/api/health` → `detail.audiobookSweep.gate` on **both** instances: `cronPlanTicks ≥ 42` and `seriesVolumeTicks ≥ 42`. ⚠️ `divergences` there is always `null` and `null` means NOT MEASURED — the comparison against the script's dry run is a person's, and stays one. A divergence is almost certainly the §2.4 canon skew — diagnose it, do not wave it through |
| **3 — enforce** | The cron writes. The on-add hook goes live. **STEP 11 keeps running unchanged.** | STEP 11 finds **nothing to do** on consecutive runs — which is itself the proof the route is working, and costs nothing since the sweep is idempotent |
| **4 — steady state** | STEP 11 becomes a **verifier**: it runs, and *reports* if it found work to do, because that means the route is failing. | — |

### 🔴 Correction, 2026-09-06 — "a week (≥42 ticks)" was arithmetic that did not hold

**Measured after a day of phase 2: 3 run rows per instance, 1 with a plan, 0
carrying `seriesVolumes`.** The tick sent `If-None-Match` from the stored
snapshot and the sibling CSV's etag had not moved since `04:23Z`, so five of six
ticks returned `304` — and the `304` return sits upstream of the parse, the D1
read and **both** planners. The mode whose entire purpose is evidence produced
none while its input was quiet, and at ≈3 CSV changes a day *"a week at
four-hourly"* was really **~14 days**. A flip to `enforce` was attempted on the
belief that the evidence was in, and refused on the reading.

Fixed in `library_catalog` `c19fbbf`, deployed to both instances the same day:

1. **A full-scope `shadow` tick sends no `If-None-Match`**, so it cannot be
   `304`'d and always computes both halves. `enforce` and `off` keep the
   conditional GET and the short-circuit — there, nothing changed genuinely means
   nothing to write. The on-add hook keeps it too: a scoped run plans no series
   volumes at all (guard 3), so 1.4 MB per book added would buy no evidence.
   Cost: ~17 MB/day across the pair, for as long as shadow lasts.
2. **`POST …/sweep` takes `force`**, which skips `If-None-Match`. ⚠️ §7.1 calls
   `dryRun` *"the ONLY way to answer the phase-1 gate"* and **for a day it could
   not** — it `304`'d like everything else and returned `plan: null`. The two
   flags are independent: `force` decides what is fetched, `dryRun` and the mode
   decide what is written.
3. **`/api/health` publishes the gate's own counters** (§7.2's key gains
   `gate`), because every other field there reads only the LATEST run row — which
   is exactly how one `304` hid every plan before it.

⚠️ **The design's assumption worth naming, since it is what made a replay
impossible:** §3.3 and §4.3 both assume the parsed rows are cached somewhere, and
migration 0470 caches an `etag`, a `fetched_at` and a `row_count` — *"neither
table is a cache of the CSV"*, in its own words. There are no rows in the
database to re-plan over, so re-fetching is the smallest honest way to get a plan
out of a quiet input. A tick that re-fetches an unchanged body is marked
`unchanged-replayed` and does **not** re-stamp `fetched_at`, or the freshness
number would peg at zero and stop being able to say the sibling pipeline had
died.

Operating it: `library_catalog/docs/access/audiobook-sweep.md` §2, §3 and §6.

🔴 **The script is NEVER retired, and the disk path stays.** Three reasons:
1. It is the **only** path that works when the Worker is down — which is exactly
   when you need it.
2. It is the recovery tool. `docs/access/RECOVERY.md`'s posture is that recovery
   must not depend on the thing being recovered.
3. It runs **before** a deploy and **offline**, against a checkout, which the
   route structurally cannot.

At phase 4 the script becomes a **thin caller** of the same `packages/core`
planner — which it already is from phase 0. Nothing further to do.

---

## 9. Build plan for the builder agent

⚠️ **Read first:** `scripts/backfill-audiobook-holdings.mjs` (all 632 lines — the
header carries the *why* for every rule below), `scripts/lib/audiobooks.mjs`,
`packages/core/src/matching.ts`'s header, `apps/worker/src/lib/details-sweep.ts`
(the pattern to copy), and `Board_Game_Catalog/apps/worker/src/index.ts:244`
(multi-cron dispatch). ⚠️ **Every change is a PAIR** — both instances, migrations
before deploys. **Commit at each numbered step.**

| # | Step | Files |
|---|---|---|
| ✅ **1** | Lift the CSV parser + row mapping into core, **verbatim**. Export `parseAudiobookCsv`, `AudiobookRow`. — **DONE `965d226`** | ✚ `packages/core/src/audiobook-csv.ts`; ✎ `packages/core/src/index.ts`; ✚ `packages/core/test/audiobook-csv.test.ts` (12) |
| ✅ **2** | Rewire the script's loader to call it. **Nothing else changes.** — **DONE `e307bc3`** | ✎ `scripts/lib/audiobooks.mjs` (keeps `existsSync`, `LC_AUDIOBOOK_ROOT`, `AUDIOBOOK_CSV`, `audiobookIndex`, `audiobookCoverPath`) |
| ✅ **3** | Port `canonicalSeries` to TS. **Keep the warn-and-degrade posture** — a missing canon falls back to plain `normaliseTitle` and is reported once, loudly. — **DONE `bb7af18`**, ⚠️ **split in two, see the note below** | ✚ `packages/core/src/series-canon.ts` (the RULE); ✚ `packages/universes/src/series-canon.ts` (the generated DATA); ✎ `scripts/lib/series-canon.mjs` → thin wrapper |
| ✅ **4** | Extract the planner. Phases 1 and 2 move whole. Add `scope`. **Return data, never SQL.** — **DONE `e2f4aee`** | ✚ `packages/core/src/audiobook-sweep.ts`; ✚ `audiobook-sweep.test.ts` (19) + `audiobook-sweep-scope.test.ts` (10) |
| ✅ **5** | Rewire the script to `planAudiobookSweep` + render the plan through `lit()`. 🔴 **Prove byte-identical dry-run output** (phase 0 gate). — **DONE `8f38125`; GATE PASSED, both instances, diffs EMPTY** | ✎ `scripts/backfill-audiobook-holdings.mjs`; ✚ `scripts/lib/audiobook-sql.mjs` (⚠️ see below); ✚ `scripts/test/backfill-audiobook-holdings.test.mjs` (9) |
| ✅ **6** | Migration **0470**: `audiobook_snapshot` (`etag`, `fetched_at`, `row_count`) + `audiobook_sweep_run` (`id`, `trigger`, `started_at`, `finished_at`, `state`, `detail_json`). ⚠️ **Migrate both instances before any deploy.** — **DONE `3d2d62e`; APPLIED to `library-catalog` AND `library-catalog-2nd` 2026-09-06, before the deploy pair** | ✚ `migrations/0470_audiobook_sweep_state.sql` |
| ✅ **7** | The D1 writer: batch of prepared statements + `changeLogInsert` transition rows, in **one** batch. — **DONE `9ba4beb`**, ⚠️ **and it went further than this line, see note 5 below** | ✚ `packages/db/src/audiobook-holdings.ts`; ✎ `packages/db/src/index.ts`, `changes.ts`, `scripts/lib/audiobook-sql.mjs`; ✚ `packages/db/test/audiobook-holdings.test.ts` (17) |
| ✅ **8** | The run wrapper: fetch with `If-None-Match`, the **three guards** of §6.2, run-row bookkeeping. Export `AUDIOBOOK_SWEEP_CRON`. **Never throws.** — **DONE `a37153b`**; ⚠️ **FOUR guards — the zero-WORKS read of note 4 is now one of them** | ✚ `apps/worker/src/lib/audiobook-sweep-run.ts` + `.test.ts` (28) |
| ✅ **9** | Admin routes (§7.1), `dryRun` supported. — **DONE `ce281a9`** | ✚ `apps/worker/src/routes/audiobook-sweep.ts` + `.test.ts` (15); ✎ `apps/worker/src/index.ts`, `routes/mount-order.test.ts` |
| ✅ **10** | `detail.audiobookSweep` on `/api/health`. **Additive only.** — **DONE `42a0024`**; a test pins that an un-migrated instance still answers `ok` | ✎ `apps/worker/src/routes/health.ts` |
| ✅ **11** | Second cron string on **both** `[triggers]` blocks; dispatch on `event.cron` in `scheduled()`, unrecognised cron still errors. — **DONE `b378a27`**, `"23 */4 * * *"` | ✎ `apps/worker/wrangler.toml`, `apps/worker/src/index.ts`; ✚ `apps/worker/src/lib/audiobook-cron.test.ts` (13) |
| ✅ **12** | The on-add hook in the two person-facing callers; **`'defer'` + one batched call** in the importer (§4.4). — **DONE `1d4a80e`**; ⚠️ **the batched call is not implementable there, see note 6** | ✎ `routes/catalog.ts`, `routes/gabi-delegated.ts`, `routes/ingest.ts`; ✎ the run wrapper (`associateWorkAfterAdd`) |
| ✅ **13** | Shadow flag (`AUDIOBOOK_SWEEP_MODE = off \| shadow \| enforce`), shipped **`shadow`**. — **DONE `235010f`**, both `[vars]` blocks; ⚠️ it **fails CLOSED**, and `scripts/provision-catalog.mjs` had to learn both the var and the cron | ✎ `apps/worker/wrangler.toml` (both blocks), `env.ts`, the run wrapper, `scripts/provision-catalog.mjs` |
| ✅ **14** | Docs: `library_catalog/docs/info/series-formats-and-audiobooks.md` + `docs/access/` runbook; ~~move the TODO item WHOLE to `DONE.md` at completion~~. — **DONE `85082f2`**: §4.12 written, ✚ `docs/access/audiobook-sweep.md`, both index READMEs, `deploys.log`. 🔴 **The TODO item STAYS OPEN and did NOT move** — see the gate below | ✎ per the docs standard — §4.11 was `c62b22a`, §4.12 is `85082f2` |

### ✅ Phase 0 landed 2026-09-05 — what the code said that this design did not

> **Measured:** `npm run backfill:audiobooks -- --remote` captured before step 1
> and re-run after step 5, on **both** instances. **Both diffs EMPTY** — byte
> identical, not "identical apart from timestamps", because the report block
> prints no clock. Main: 561 lines, 411 works, 122 matched, 127 editions, 31
> series, 317 statements. padhard: 843 lines, 677 works, 263 statements. Dry
> runs only; `--commit` was never passed. `npm run test` 2610 pass / 0 fail,
> `npm run typecheck` green. ⚠️ **NOT verified: anything rendered, anything
> deployed, any Worker behaviour** — phase 0 ships no route, no cron and no
> migration, and nothing under `apps/worker` was touched.

Three things in §9 turned out to be under-specified or wrong against the code.
Phase B should read these before starting step 6.

**1. 🔴 Step 3 cannot be one file.** §2.2 B says "port `canonicalSeries` to TS
over `packages/universes/generated/`", and that is two incompatible requirements
in one line. `@lc/core` promises *"no I/O — safe to import anywhere"*, and
`@lc/universes`' own header states that a build-generated file with a cross-repo
provenance does not belong inside that promise; `@lc/core` also cannot import
`@lc/universes`, which depends on it. **And binding core to the generated copy
would have changed the SCRIPT's canon from live to build-time — the exact §2.4
skew this design says the script must NOT have**, which would have broken the
phase-0 gate. So: the RULE is `packages/core/src/series-canon.ts` (`normText`,
`buildSeriesCanonMap`, `canonicalSeriesIn(map, name)` — data-free, both callers
share it) and the generated BINDING is `packages/universes/src/series-canon.ts`
(`seriesCanonMap`, `canonicalSeries`, `seriesCanonEntryCount`). `planAudiobookSweep`
takes `canonicalSeries` as an INPUT. **Phase B imports it from `@lc/universes`,
not from `@lc/core`.** `seriesCanonEntryCount` already exists for §7.2's status
line.

**2. ⚠️ §6.2 guard 3 scopes the STALE phases and says nothing about phase 2's
UPSERTS — and the obvious reading is unsafe.** A scoped run holds a fraction of
the evidence, so its `fold` verdict is an *absence* of proof rather than a weaker
proof; since every rung upsert sets `series_matched_via = excluded.series_matched_via`,
writing it would **downgrade a `work_match` rung a full sweep had already
earned**. So under `{ kind: 'works' }` the planner emits a rung only where that
run itself corroborated the series, and names the rest in
`report.foldSeriesDeferred` for the cron. Decided in phase 0 because it could not
be deferred; revisit it deliberately if phase B disagrees.

**3. The step-8 table's test needed a file §9 does not list.**
`scripts/backfill-audiobook-holdings.mjs` reads two databases at import time, so
nothing can import it — and the test §9 asks for ("the script's rendered SQL for
a fixture plan is unchanged") therefore had nothing to call. The rendering is now
`scripts/lib/audiobook-sql.mjs` (`renderSweepStatements(plan)`), the script-side
twin of the `packages/db/src/audiobook-holdings.ts` binder step 7 will build.
**Both must be written from the same plan and neither may re-derive anything.**

**4. ⚠️ A hazard for step 8 that §6.2's three guards do not cover.** One
`--remote` run mid-way returned `0 work(s) in the REMOTE database` and **exited
0** — wrangler handed back an empty result set with no error. The script's
zero-AUDIOBOOK-ROWS path refuses loudly; its zero-WORKS path is a silent
`process.exit(0)`. Re-running gave the full 411. In a Worker the same empty read
of `work` would reach the stale sweep with nothing to reproduce. **Guard the
zero-works read the way §6.2 guards the zero-rows fetch.**

### ✅ Phase B landed 2026-09-06 — steps 6–14, deployed to BOTH instances in SHADOW

> **Measured.** Migration 0470 applied to `library-catalog` **and**
> `library-catalog-2nd` before the deploy pair. Deployed: MAIN version
> `b547095d` (rollback `c73b0406`), friend `9b2b64d2` (rollback `82da5112`).
> Both hosts answer `detail.audiobookSweep.mode = "shadow"`, `editionsLive`
> 127/123, `rungsLive` 190/140, `seriesCanonEntries` 6. `npm run test` **2697
> pass / 0 fail**, `npm run typecheck` green.
>
> ⚠️ **NOT verified: no `audiobook_sweep_run` row exists on either instance
> yet.** No cron tick observed (`:23` past every fourth hour, UTC), no on-add
> hook seen to fire, and the admin route never called with a real bearer — the
> building session had no Firebase token. Operating it, and the query that
> settles it: `library_catalog/docs/access/audiobook-sweep.md` §5.

#### ✅ The phase-1 gate is MEASURED and PASSED, on both instances

The gate is *"the route's plan on the live snapshot equals the script's plan on
the same CSV"*. It did not need a token: both were planned over the live D1s —
the script's inputs (disk CSV + the LIVE cross-repo canon) against the route's
(the published URL + the BUILD-GENERATED canon):

| | MAIN | padhard |
|---|---|---|
| works / audiobook rows | 411 / 1089 | 677 / 1089 |
| matched | 122 (114 exact, 8 containment) | 119 (119 exact) |
| edition upserts / stales | **127 / 0** | **123 / 0** |
| rung upserts / stales | **190 / 0** | **140 / 0** |
| statements | 317 | 263 |
| **script plan vs route plan** | 🟢 **byte-identical** | 🟢 **byte-identical** |

Both halves of §3.2's transport claim re-measured the same day: the live CSV
(**1,408,735 bytes**, `ETag "4d4d09ade4b45fb1baa48ab7880b7a34"`) and
`audiobook_catalog/site/catalog.csv` both parse to **1089 rows**, with
**deep-identical row arrays**. And §2.4's skew is **zero today** — both canons
hold the same 6 spellings across 3 entries.

⚠️ **What that equality does NOT prove is that the deployed Worker ran.** It
removes every variable except the Worker's own D1 reads and the guards.

#### 🔴 It is in SHADOW and the TODO item stayed OPEN

The cron and the hook compute the whole plan and **write nothing**; STEP 11 is
still doing all the writing, so **a book added today still waits for it** and
the owner's complaint is not closed. §8's phase 2 → 3 gate, as written into
`library_catalog/docs/TODO.md`: **≥42 shadow ticks (a week at four-hourly) with
zero divergences vs STEP 11**, measured against
`npm run backfill:audiobooks -- --remote`. Rollback at any point is one word:
mode `off`.

#### Four more things the code said that this design did not

**5. §2.3 was read one step too literally, and phase B undid it.** *"The plan is
DATA, not SQL"* is right about why the planner returns rows — the two callers
BIND differently. It does **not** follow that each caller should keep its own
copy of *which columns a sweep writes and in what order*, which is what phase 0
built (`scripts/lib/audiobook-sql.mjs` beside the step-7 binder). That is the
shape `matching.ts` opens by warning about, and a drift in it would mean the
cron and the recovery script quietly disagreeing about what the catalog says.
There is now **one statement list** — `audiobookSweepStatements` in `@lc/db`, as
`{ sql, binds }[]` — which the Worker binds and the script renders by
substituting `lit()` for each `?`. ⚠️ The script's rendered bytes did not move,
and the whole-string test in `scripts/test/backfill-audiobook-holdings.test.mjs`
passing unchanged is what proves it.

**6. 🔴 §3.3 and §4.3 assume the parsed ROWS are cached; §9 step 6 does not
provide for that.** *"The on-add hook must never fetch 1.4 MB — it reads the
cached snapshot"* and *"no external call at all when the snapshot is warm"* both
need a row store, and `audiobook_snapshot` — exactly as step 6 specifies it —
holds the `etag`, the `fetched_at` and the `row_count`. There is nothing warm to
read. **The scoped run therefore fetches, conditionally, like the cron.** §4.3's
objection was that fetching would slow the add; `ctx.waitUntil` already answers
that, because the response has gone out first. The real cost is one conditional
GET per book added, against a cron that fetches six times a day regardless. **A
KV row cache is the follow-up**, deliberately not built: a new binding on both
instances is its own change and shadow had to land first.

**7. §4.4's batched call is not implementable in `routes/ingest.ts`.** Measured:
that file has exactly **one** route and it creates **one** work per REQUEST, so
the loop lives in the external importer and a Worker invocation never sees a
batch begin or end. The `'defer'` is real — no fetch, no run row, no index build,
pinned by a test — and the batching is the cron's. If that route ever grows a
multi-row body, that is where the batched call belongs.

**8. §6.3's transitions are not on the phase-0 `SweepPlan`.** The interface here
lists `transitions: AssociationTransition[]`, and the planner that shipped has no
such field (phase 0 could not have known what the writer would need). The step-7
writer derives them instead, by diffing the live `(audio_key, matched_via)` set
per work against the rows the plan was made from — so a **gain** is `null → {…}`,
a **loss** is `{…} → null`, and a run that reproduced what was already there
writes **nothing**. `change_log` gained the entity `'audiobook_holding'`; 0120
carries no CHECK, so widening the union was the whole migration.

### Tests to add

| File | Asserts |
|---|---|
| `packages/core/test/audiobook-csv.test.ts` | Quoted fields, doubled quotes, embedded newlines, **CRLF and LF produce identical rows** (the transport equivalence §3.2 rests on); a header-only file yields `[]` |
| `packages/core/test/audiobook-sweep.test.ts` | `VIA_RANK` — an alias-route containment never displaces an exact; **two editions of one work both survive** (the Elantris case); the printed pair wins ties; `corroborated` needs series **and** volume agreeing; phase 2 does **no** title comparison |
| `packages/core/test/audiobook-sweep-scope.test.ts` | 🔴 **`scope: {kind:'works'}` produces ZERO stale entries** — the §6.2 guard 3, as a test, not a convention |
| `apps/worker/src/lib/audiobook-sweep-run.test.ts` | Zero rows → `failed`, nothing written; a **>3% drop** → `failed: drift`, nothing written; `304` → `skipped: unchanged`; a non-2xx is a recorded failure, **not a thrown exception**; **the function never rejects** |
| `apps/worker/src/lib/audiobook-cron.test.ts` | ⚠️ **Reads `wrangler.toml` and asserts both cron strings are present in BOTH `[triggers]` blocks** and that `AUDIOBOOK_SWEEP_CRON` matches character for character — the test both sibling sweeps already have |
| `apps/worker/src/routes/audiobook-sweep.test.ts` | Non-admin gets a **worded** refusal naming the role, never a bare status; `dryRun` writes nothing |
| `packages/db/test/audiobook-holdings.test.ts` | The upsert is idempotent across two runs; a transition writes **one** change_log row and a no-op writes **none**; audit rows land in the **same batch** |
| `scripts/test/backfill-audiobook-holdings.test.mjs` | The script's rendered SQL for a fixture plan is unchanged (the phase-0 regression net) |

---

## 10. Next candidates after this one

Full reasoning in [`scripts-inventory-2026-09-05.md`](scripts-inventory-2026-09-05.md) §7.

| # | Convert | One line |
|---|---|---|
| **1** | `backfill:series-volumes` → the **same** cron | Same CSV, same fetch, same parser, same instance pair — it costs one function once this lands, and two audiobook-derived tables falling out of step is worse than either being stale |
| **2** | `prune-r2-backups.mjs` → platform Worker cron | Pure R2 list + delete, no disk, no local credential. Retention that depends on somebody remembering is not retention |
| **3** | `tools/estate-probes/run.mjs` → platform Worker cron + a `/status` line | Pure HTTP against live hosts; the suite that catches an authorised-domain change before a 40-minute-old reading gets quoted as current |
| **4** | `check-cover-health.mjs` → library Worker cron | D1 read + HTTP HEAD. Broken covers are the estate's most visible silent rot, and both instances need the check |
| **5** | `audit-series-aggregates.mjs` → library Worker cron | Its own header calls it *"the standing alarm"*. A standing alarm with no clock is not an alarm |
