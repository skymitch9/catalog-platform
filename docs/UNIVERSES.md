# The Shared Universe List — Information Reference

> **Audience:** Claude sessions. **Status:** BUILT 2026-08-11 — the file is here,
> the editor works, all three catalogs' rows resolve through it. Last verified:
> **2026-08-15**.
> Data: [`../data/universes.json`](../data/universes.json).
> Editor: [`../tools/universes.mjs`](../tools/universes.mjs).

A fictional universe is flagged **only where it says something the series (or,
for board games, the title) name does not already say**. Nine universes as of
2026-08-15 (Marvel and Disney added; The Cosmere and CAL Verse extended to
cover owned board games), ~40 series, ~120 book/game overrides, and five
recorded refusals. ⚠️ **This file's own wording still says "book," but nothing
in the schema or the resolver is book-specific** — `bookOverrides`/
`bookExclusions` key on `title`, and `title`/`series` are exactly what a
board-game row carries too (see §6's third row, added 2026-08-15).

---

## 1. Where it lives, and why here

`catalog-platform/data/universes.json`. Moved 2026-08-11 from
`library_catalog/data/universes.json`, where it never belonged: it is **not
library data**. It is keyed on series + author, both catalogs need it, and the
same series exists in both collections under different rows — often in only one.

⚠️ **This makes `catalog-platform` a CODE dependency of both catalogs, not a
docs repo.** Two builds break if this file moves. Stated again in the root
[`README.md`](../README.md) and in [`PLATFORM.md`](PLATFORM.md) §5.4, because a
reader who has only ever seen `docs/` and a landing page will assume otherwise.

### A file, not a table

| | |
|---|---|
| Size | ~33 series, ~13 book overrides. Changes maybe monthly |
| Kind | Reference data. Not user data, not catalog facts |
| Value | Version control over **the decisions**, refusals included |
| Cost of a table | An export step and a second copy — `audiobook_catalog` is a Python static build and cannot reach D1 at all |
| Query story | Six universes fit in memory. "All Cosmere books" is a `Map` lookup |

The refusals are the part a table would lose. *"Will Wight — leave blank for
now"* and *"same author is not a universe"* are decisions with reasoning, and
their whole job is to stop the next pass re-litigating them.

---

## 2. ⚠️ The finding that decides the shape

**A series → universe mapping is not sufficient.** Three real counterexamples,
all fixtures in `data/universes.fixtures.json`:

| Case | Direction of failure |
|---|---|
| **Secret Projects** | A **mixed** series. Tress, Yumi, The Sunlit Man and Isles of the Emberdark are Cosmere; *The Frugal Wizard's Handbook* is not. A series-level answer is wrong for one of five |
| **The Otherlife / Selfless Hero trilogy** | **No series value at all** — the trilogy name is inside each title, so a series-keyed lookup misses all three |
| **Fires of December** | A **seriesless standalone that IS Cosmere**. Publisher copy calls it "a standalone Cosmere novel"; nothing about that is reachable from a series field |

So: per-book overrides are load-bearing, and the auto-assign-on-add path cannot
read the series and stop.

---

## 3. Resolution order

Fixed, documented in the data file's `_lookup.order`, and pinned by fixtures
that **both** catalogs run:

1. a `bookExclusions` title match → **no universe**, stop
2. a `bookOverrides` title match → that universe
3. a `series` match → that universe
4. otherwise → no universe

**Exclusions first**, so the answer never depends on which rule happened to
fire. *The Frugal Wizard's Handbook* and *Lux - A Texas Reckoners Novel* both
sit next to titles that would otherwise sweep them in.

`notSeries` never returns a universe — it records a deliberate refusal for that
universe, which is how Reckoners and Skyward stay out of the Cosmere.

### Matching

Lowercase, curly quotes folded to straight, whitespace collapsed, trimmed.

⚠️ **The curly-apostrophe fold is load-bearing.** `site/catalog.csv` stores
`The Frugal Wizard’s Handbook...` with U+2019, and that row is the single
exclusion proving series-keying cannot work. Miss the fold and the one row the
design rests on resolves to Cosmere. Both spellings are fixtures.

⚠️ **Titles match exactly after normalising — never prefix, never substring.**
Substring matching would make `Elantris` match `The Hope of Elantris`. The known
cost is recorded in the fixtures' `_knownGaps`: the audiobook row
`Isles of the Emberdark - A Cosmere Novel Secret Projects, Book 5` does not
resolve, and the fix for it belongs in `audiobook_catalog`'s corrections layer,
not in a looser match here.

---

## 4. The editor

A **local CLI**, not a web UI. A browser cannot commit to a git repo, and a web
editor would need a second representation of the list — two representations
drift, which is the failure this whole design avoids.

```bash
node tools/universes.mjs                                    # help
node tools/universes.mjs list
node tools/universes.mjs show "Cosmere"                     # aliases work
node tools/universes.mjs who --title "Fires of December"
node tools/universes.mjs validate
node tools/universes.mjs fixtures
```

Editing, all of which require `--why` and accept `--dry-run`:

| Command | Does |
|---|---|
| `add-series <u> --series S --why W` | Claims a series for a universe |
| `remove-series <u> --series S --why W` | Unclaims it — and says so loudly, because unclaimed is not the same as held out |
| `add-book <u> --title T --why W [--exclude]` | A per-book override, or an exclusion |
| `remove-book <u> --title T --why W [--exclude]` | The reverse |
| `hold-out --series S \| --title T --why W` | Removes it from every universe and records a `_refused` entry |
| `restore <u> --series S \| --title T --why W` | Overturns a refusal and puts it back |

### ⚠️ The reason is mandatory, and refusal is the point

`--why` under 10 characters is **refused**, not warned about. Every existing
entry carries evidence and a `decidedHow`; an editor that accepts a bare mapping
destroys the only property that makes this file worth keeping.

Three more refusals that matter:

- **A series already claimed by another universe** is refused — remove it there
  first, with a reason.
- **A held-out series** is refused with a pointer to `restore`, so a refusal is
  never silently contradicted by the data.
- **The CLI cannot create or delete a universe.** Six exist, each with owner
  sign-off in its `confirmed` field. A seventh is a decision to write into the
  file with its evidence, not a command to run.

Every mutation appends to `_changelog` in the file. Git records *what* changed;
a deleted line cannot say *why*, and that is exactly the case — a removal —
where the reason matters most.

---

## 5. Validation

`node tools/universes.mjs validate` — exit 1 on any error. What it catches:

| Code | Catches |
|---|---|
| `SERIES_CLAIMED_TWICE` | A series in two universes |
| `BOOK_IN_AND_OUT` | A title both overridden and excluded |
| `BOOK_CLAIMED_TWICE` | A title overridden by two universes |
| `BOOK_NO_REASON` | ⚠️ An entry with no `why` — a bare mapping |
| `UNIVERSE_NAME_NOT_CANONICAL` | `Cosmere` where `The Cosmere` is meant |
| `PINNED_NAME_BROKEN` | ⚠️ See below |
| `HELD_OUT_SERIES_IN_USE` | A refusal contradicted by the data |
| `SERIES_IN_AND_OUT` | A series in one universe's `series` **and** its `notSeries` |
| `CANON_*` | Alias-map hygiene: unnormalised keys, targets that are not universes, targets that do not map to themselves |
| `BAD_DECIDED_HOW` | Anything outside `seed` / `llm` / `human` |
| `SCHEMA_VERSION` | A shape change the consumers have not been told about |

Malformed JSON fails at load with the path in the message.

### ⚠️ Why `_pinnedCanonicalNames` exists

Alias-map hygiene is not enough. Renaming *The Cosmere* to *Cosmere* and
updating every alias to match leaves the map perfectly consistent while
reversing the owner's decision — and that diff looks clean. So the two
owner-mandated answers are **asserted** in `_pinnedCanonicalNames`:

```
cosmere          → The Cosmere
arand multiverse → Runnerverse
```

`Arand multiverse` is the name a model reaches for; `Runnerverse` is the
owner's. Both are checked as answers, not as map entries.

---

## 6. The consumers

Neither book catalog surfaces universes on screen yet — that is a separate job.
Both read the list at their own build time, so the wiring and the failure
modes are proven now rather than later.

| | `library_catalog` | `audiobook_catalog` |
|---|---|---|
| Reads it | At build: `scripts/sync-universes.mjs` materialises a **gitignored** copy under `packages/universes/generated/`, which the Worker bundle imports | At pipeline time: `app/core/universes.py` reads it from disk |
| Finds this repo | `CATALOG_PLATFORM_DIR`, else walks up from the repo root looking for a sibling `catalog-platform` | Same two rules, same env var |
| When it cannot | ⚠️ **Fails the build**, naming the env var and every path it tried | ⚠️ **Loud `[WARN]`, build continues** with no universes |
| Why different | A Worker bundled without the list would ship a silent wrong answer to production | The pipeline runs unattended 3×/day; it must not die over reference data, which is the same rule the corrections layer already follows |

Both run `data/universes.fixtures.json` in their own test suites — the mechanism
[`PLATFORM.md`](PLATFORM.md) §5.3 prescribes for a rule that has to exist in
Python and in TypeScript at once. There is no shared runtime, so there is no
shared implementation; the fixtures are what keep the two honest.

### ⚠️ A third, architecturally different consumer: `Board_Game_Catalog`, via the index Worker — found and documented 2026-08-15

`Board_Game_Catalog` never reads `data/universes.json` at all, and has no build
dependency on this repo. It pushes raw `title`/`series` strings for every item
(`packages/db/src/index-projection.ts`) to `apps/index-worker` here, which
resolves each row's universe **at push time**, server-side, using
`apps/index-worker/src/universes-data.ts` — a build-time
`import ... from '../../../data/universes.json' with { type: 'json' }`,
i.e. **the Worker bundles this file at deploy time.** Consequences that do not
apply to the two book catalogs:

- Editing `data/universes.json` changes nothing live until **`apps/index-worker`
  is redeployed** — there is no gitignored-copy sync step to forget, but there
  is a deploy to forget instead.
- Universe is resolved and stored per row in the Worker's own `entry.universe`
  column at push time (`apps/index-worker/src/rows.ts` `entryFor()`), not
  recomputed on read. After a redeploy, every source (`game`, `library`,
  `audiobook`) needs a **fresh push** for its existing rows to pick up the new
  answer — an edit here is inert for already-pushed rows until then.
- `work_fold` is `null` for every `game` row by design (a board game is never
  the same *work* as a book), so games only ever join the rest of the estate at
  the **universe** tier — `universe` is the one cross-format signal a games row
  carries at all.
- **This consumer DOES surface universes on screen**: `/universes` on
  `heygabi-home` (`sites/heygabi-home/public/universes/universes.js`) is a
  members-only page backed by `GET /api/universe/:name`. ⚠️ Its universe name
  list is **hardcoded** (`UNIVERSE_NAMES`, because `read.ts` exposes no public
  "list universe names" route) and must be kept in sync with
  `data/universes.json` `universes[].name` **by hand** — adding a universe here
  without also editing that array leaves it invisible on the page even after a
  correct data file and a correct Worker deploy.

⚠️ This repo has already shipped that class of bug once — §2.3 of `PLATFORM.md`
records `resolve_author_link` (Python) and `_resolveAuthorFolder` (JS) drifting
apart until a promote failed **silently**.

---

## 7. What was not verified

- **The library catalog's own rows.** Every `measured` note in the data cites
  `audiobook_catalog/site/catalog.csv`, a file on disk. `library_catalog`'s rows
  live in remote D1 and were not queried. The series spelling **`Cradle`** in
  the Will Wight refusal is asserted from the owner's wording, not observed.
- **`Fires of December`** has no row in the audiobook catalog; the entry rests
  on publisher copy and the owner's pledge, both cited in the file.
- Nothing was deployed and nothing was pushed.

---

## 8. A sibling file: the series canon (normalization item 4)

`data/series-canon.json`, built 2026-08-14, **not universe data** — the two
files sit beside each other because they are both small, both edited through a
local CLI, and both stop a specific kind of estate-wide drift, but they answer
different questions. `universes.json` says a series belongs to a larger
fictional continuity. `series-canon.json` says two strings name the *same*
series. Folding a series' spelling has nothing to do with whether it is ever
claimed by a universe — none of the three seeded entries below are.

### Why it exists

`library_catalog`'s audiobook-holdings backfill
(`scripts/backfill-audiobook-holdings.mjs`) builds a series-to-audio-rungs map
by folding `audiobook_catalog/site/catalog.csv`'s `series` column against its
own `work.series`. Before this file, that fold used only `normaliseTitle` —
which folds case and whitespace, not decoration — so a series spelled
`"Ascend Online [publication order]"` on the audio side and `"Ascend Online"`
on the library side folded to two different keys and produced **zero** audio
rungs, for a series the household owns on both formats. Measured 2026-08-14:
this was true of three series — **Ascend Online**, **Harry Potter**, **Fae &
Alchemy** — each spelled plainly in one catalog and with a decorative suffix in
the other.

### How the three entries were found

`audiobook_catalog/site/catalog.csv`'s `series` column (337 unique spellings,
already past *that* catalog's own `canonical_series` fold — the CSV is a build
artifact, written after corrections) was diffed against `library_catalog` D1
`work.series` (114 unique spellings, queried live via `wrangler d1 execute
library-catalog --remote`). The diff folded both lists by the canonical rule
below to find *candidate* groups, then kept every group where more than one
exact spelling survived. A separate, looser alphanumeric-only pass over both
raw lists confirmed nothing else was missed. **The Completionist Chronicles**
— the household's other well-known multi-spelling series — was checked as a
fourth candidate and excluded: both catalogs already read the identical string
`"The Completionist Chronicles"`, because `audiobook_catalog`'s own
`canonical_series` already folds its four *filename-tag* spellings before the
CSV is written. See `_completionistChroniclesCheckedAndExcluded` in the data
file.

### The choosing rule

The plain, undecorated form always wins — no bracketed reading-order note, no
descriptive parenthetical, no redundant `"The … Series"` wrapper — applied
identically regardless of which catalog happens to hold it. In today's three
entries the plain form is always `library_catalog`'s spelling, which is a fact
about Audible's naming conventions (it favours disambiguating suffixes like
`"(Full-Cast Editions)"`), not a rule that one catalog always wins.

### Matching: exact, never the decoration-stripping rule itself

The rule above is a **discovery** tool, used once to find candidate groups. A
consumer never runs it at match time — that would need reproducing identically
in Python and in two separate places in JavaScript with no shared runtime to
keep them honest, the exact trap §6 above already names for
`resolve_author_link`. Instead each entry lists every known spelling
explicitly, and lookup is an exact match after the same `normText` fold
`universes.json` uses (lowercase, curly quotes folded, whitespace collapsed).
An unknown spelling passes through **unchanged** — unlike `canonicalName()`
above, which returns `null` for an unknown universe name. Different default on
purpose: a series with no cross-catalog drift is still a series, correctly
spelled, and the fold must hand it back rather than erase it.

### The consumers

| | `library_catalog` | `audiobook_catalog` |
|---|---|---|
| Reads it | Live, at backfill time: `scripts/lib/series-canon.mjs` resolves the sibling checkout the same way `scripts/lib/audiobooks.mjs` reads `site/catalog.csv` — direct, no build step | Once, by hand: `python -m app.tools.sync_series_canon` merges every entry into `scripts/catalog_overrides.json` `canonical_series`, additively, then is not consulted again until re-run |
| When it cannot find this repo | ⚠️ **Warns and continues** with an identity fold (unlike `universes.json`, which fails the *build*) — this file feeds a hand-run, dry-run-then-commit backfill script, not the deployed Worker, so a missing checkout should degrade the fold quality, not stop the whole backfill | The sync tool exits with an error naming `CATALOG_PLATFORM_DIR` and every path tried; nothing is silently skipped, but nothing else in the pipeline depends on it either |
| Used by | `scripts/backfill-audiobook-holdings.mjs`, folding both the audiobook CSV's series column and this catalog's own `work.series` before the `normaliseTitle` key that joins them | `app.core.catalog_overrides.canonicalize_series()` — the sync tool's output lands in the SAME file and code path every other `canonical_series` entry already goes through |

### How to add an entry

```bash
node tools/series-canon.mjs add --canonical "Name" --variant "Other Spelling" --why "..."
```

`--why` under 10 characters is refused, same rule as `universes.mjs`. After
adding: `node tools/series-canon.mjs validate`, then re-run
`python -m app.tools.sync_series_canon --commit` in `audiobook_catalog` so its
own corrections layer picks up the new fold (`library_catalog` needs nothing —
it reads this file live). Commit `data/series-canon.json` here and
`scripts/catalog_overrides.json` there as two separate commits, one per repo.
