# The Shared Universe List — Information Reference

> **Audience:** Claude sessions. **Status:** BUILT 2026-08-11 — the file is here,
> the editor works, both catalogs read it. Last verified: **2026-08-11**.
> Data: [`../data/universes.json`](../data/universes.json).
> Editor: [`../tools/universes.mjs`](../tools/universes.mjs).

A fictional universe is flagged **only where it says something the series name
does not already say**. Six universes, ~33 series, ~13 book overrides, and six
recorded refusals.

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

Neither surfaces universes on screen yet — that is a separate job. Both read the
list, so the wiring and the failure modes are proven now rather than later.

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
