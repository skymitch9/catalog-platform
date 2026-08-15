# The Shared Universe List — Information Reference

> **Audience:** Claude sessions. **Status:** BUILT 2026-08-11 — the file is here,
> the editor works, all three catalogs' rows resolve through it. Last verified:
> **2026-08-15**.
> Data: [`../data/universes.json`](../data/universes.json).
> Editor: [`../tools/universes.mjs`](../tools/universes.mjs).

A fictional universe is flagged **only where it says something the series (or,
for board games, the title) name does not already say**. **Sixteen** universes
as of 2026-08-15 — Marvel, Disney, Star Wars, Alliances, Cytoverse, Reckoners,
Middle-earth, Dungeon Crawler Carl and Innworld all added that day; The Cosmere
and CAL Verse extended to cover owned board games — **51 series, 155 book/game
overrides, 5 exclusions**, and six recorded refusals. ⚠️ **This file's own
wording still says "book," but nothing in the schema or the resolver is
book-specific** — `bookOverrides`/`bookExclusions` key on `title`, and
`title`/`series` are exactly what a board-game row carries too (see §6's third
row, added 2026-08-15).

**Same-day revisions, in order, all 2026-08-15:** (1) Disney and Marvel added.
(2) Owner supplied the actual test for what belongs in Disney — **crossover
potential** ("Star Wars and Toy Story would never cross over, but games like
Kingdom Hearts would cross over with Toy Story") — so Star Wars was split back
out into its own universe; Toy Story and the Disney Books imprint titles stay,
because they're the pool that Kingdom-Hearts-style crossovers actually draw
from. (3) Alliances created, owner-approved, for the two Stan Lee's Alliances
audiobooks (confirmed NOT Marvel canon — an independent POW! Entertainment
property). (4) Two library_catalog works that carried the universe's own name
("Cosmere" / "The Cosmere") as their SERIES value had that field blanked
**non-destructively** (old value preserved in `change_log`) and caught by a
title override instead — the series-masquerading-as-universe problem this
file has flagged since day one. (5) Arcanum Unbounded's series was corrected
(it collects stories from every Cosmere sub-series, so no single one is true)
via the audiobook corrections layer, and it too is now a title override.

### The estate-wide orphan sweep — 2026-08-15, later the same day

The Cosmere treatment above was generalised to **every** universe: all 2,265
rows in the estate (1,078 audiobook CSV, 351 library D1 `work`, 836 board-game
D1 `item`) were pulled and read by author, by franchise keyword, and by the
`library_work_id` join between the two book catalogs, looking for anything that
belongs in a universe but resolves to none. **Across the whole day's work,
membership went 322 → 352 rows** (audiobook 181 → 206, library 45 → 50, games
96 unchanged) across 11 → 13 universes. The first phase — placing orphans in
the universes that already existed — accounts for 15 of those, in four shapes
worth knowing:

| Add | Universe | The shape it hid in |
|---|---|---|
| series **White Sand** (library #90) | The Cosmere | ⚠️ **An author-keyed scan cannot find this one.** `work.authors` reads "Julius Gopez Rik Hoskin" — the artist and scripter of the graphic novels — so the word "Sanderson" appears nowhere on the row. It was the only Cosmere row in any catalog resolving to nothing |
| series **Darth Vader and Family** (library #190) | Star Wars | Jeffrey Brown's licensed picture books. The series name says "Darth Vader", which a keyword scan catches, but nothing had claimed it |
| series **Lady and the Tramp** | Disney | A real series value, so it needed a series claim rather than the title override the other Disney rows get |
| **9 title overrides** — 3 Frozen, 2 Minnie, Mickey/Minnie, Peter Pan, The Lion King, The Nightmare Before Christmas (library #197) | Disney | ⚠️ The 2026-08-15 first pass keyed on the literal word **"Disney" in the title** and stopped. Half the imprint's rows do not carry it. Re-run by **author = Disney Books** instead and the set closes: 22 rows, all now placed |
| **Panther Patience - Spidey and His Amazing Friends** | Marvel | Disney Junior imprint, Marvel characters — goes to Marvel, not Disney, like the Age of Ultron tie-ins already there |

Every Disney add was tested against the owner's crossover-potential criterion
individually, not swept: Arendelle, the Pride Lands, Neverland, Halloween Town
and Mickey himself are all Kingdom Hearts material, which is the pool the
criterion names.

**The method that found the most, and should be the first thing run next
time:** `site/catalog.csv`'s `library_work_id` column is a join between the two
book catalogs, and diffing `series` across it surfaces rows where one catalog
knows the series and the other does not. It found the whole **Secret Projects**
ladder missing from the audio side — five rows the library had numbered 1–5 —
plus **World's Only Hero**, which `universes.json` had been describing in prose
under CAL Verse `notThisSeries` since 2026-08-11.

Three further candidates came out of the sweep and went to the owner rather
than being created, because §4's rule stands: the CLI cannot create a universe,
and a new one is a decision written into the file with its evidence. **The owner
ruled on all of them the same day** — see "The owner's rulings" below.

### Two more universes, owner-approved the same day: Cytoverse and Reckoners

Approved by the owner via the coordinator during the sweep, so **13** now.
Both are Sanderson continuities that are *not* the Cosmere, and both earn a
shelf on this file's ordinary rule rather than as an exception — in each case
the universe name says something no series name can:

| | Claims | The row that makes it a universe rather than a series |
|---|---|---|
| **Cytoverse** | series `The Skyward Series` (7 audiobooks) + title `Firstborn / Defending Elysium` | **Defending Elysium is not a Skyward book and carries no series value at all.** Its own ebook edition is titled *Defending Elysium: A Cytoverse Novella*. Same shape as *Fires of December* in The Cosmere |
| **Reckoners** | series `Reckoners` + series `Texas Reckoners series` + title `Snapshot` | Two of them. The spin-off (*Lux*) carries a **different series value**, and *Snapshot* carries **none at all** in either catalog — Sanderson has confirmed it shares the Reckoners world, with links slight enough that no series field will ever say so |

⚠️ **Creating them forced three `bookExclusions` out of The Cosmere** —
*Snapshot*, *Lux - A Texas Reckoners Novel*, and *Firstborn / Defending
Elysium* — and the reason is §3's own resolution order, not a change of mind.
An exclusion is a **global stop**: rule 1 returns "no universe" and halts, so
leaving those titles excluded would have made the new universes' claims on
those exact rows permanently unreachable. Every fact the exclusions carried is
preserved — The Cosmere's `notSeries` still refuses Reckoners and The Skyward
Series, the omnibus reasoning on *Firstborn / Defending Elysium* is copied into
its new entry verbatim, and each removal records why in `_changelog`.

⚠️ **Four canary assertions across three repos had to be rewritten**, and each
one was rewritten to keep testing what it was built to test rather than to
match the new numbers:

| Was | Now | Why it moved |
|---|---|---|
| *"an exclusion beats a series"* — Lux + `Reckoners` | The Frugal Wizard + `The Mistborn Saga` | Lux is legitimately Reckoners now. The replacement is **stronger**: it pairs an exclusion with a series The Cosmere really claims, so rule 3 would fire if rule 1 did not run first. The old pair had both rules saying no anyway |
| *"same author is not a universe"* — Steelheart + `Reckoners` | Legion + `Legion` | Legion carries the identical property (Sanderson's, in `notSeries`, claimed by nothing). The refusal did **not** weaken: Reckoners earning a shelf is a continuity spanning a renamed spin-off and a seriesless novella, not the author being read as a universe |
| `canonicalName("Cytoverse") → null` | `→ "Cytoverse"` | Flipped by the approval, the same shape as the Willverse flip of 2026-08-12 |
| — | `canonicalName("Skyward universe") → null` **added** | Replaces the property the Cytoverse case used to carry. It is the most temptingly guessable name in the file, because `The Skyward Series` is Cytoverse's only claim |

### Propagation

`data/universes.json` is read at three different times by three consumers
(§6), so "changed the file" is not "changed the answer" anywhere:

| Consumer | What was done |
|---|---|
| `library_catalog` | `sync-universes.mjs` + `backfill:universes --remote --commit`. **45 → 50 rows** carry a universe (White Sand, Goodnight Darth Vader, The Nightmare Before Christmas, then Firstborn / Defending Elysium and Snapshot) |
| `audiobook_catalog` | `python -m app.main`. **181 → 206 rows** resolve |
| `apps/index-worker` | ⚠️ **Bundles this file at build time** — until it is redeployed *and* each source pushes again, `/universes` serves the answers stored at the last push. This is also why library work #272 (*Star Wars: The Fight to Survive*) rendered "Part of Disney" after the split: `universes.json` had resolved it to Star Wars since that moment and D1 stored `universe='Star Wars'`, but the index row was written before. **The only lever on a stale library row is a mutation through `/api/*` or the 24-hour backstop** — there is no cron and no manual push in that repo |

### The owner's rulings on the sweep's verdict table — 2026-08-15

All of it ruled the same day, taking the estate to **16 universes**.

| Ruling | Result |
|---|---|
| **Middle-earth — approved** | 18 rows. ⚠️ **The clearest case in the file** of a universe saying what no series name says: 5 audiobooks under `The Lord of the Rings`, but the 13 board-game rows are filed under **`Ascension`** (a deckbuilder line) and **`D&D`** (a rules system). Claimed as 1 series + **13 exact title overrides**, because `Ascension` also holds non-Tolkien products (ids 383, 388) and cannot be claimed wholesale — the same mixed-series shape as *Secret Projects* and *Dice Throne* |
| **Dungeon Crawler Carl — approved** | 43 rows (8 audio + 6 library + 29 games). It exists for a **structural** reason no other single-series universe has: `work_fold` is null for every game row by design, so **universe is the only tier at which a games row can join the estate**. Without it the 29 owned game products can never sit beside the 14 books |
| **D&D — refused, recorded** | 113 board-game rows, and the largest single block in that catalog — which makes the refusal worth more than the entry would have been. `D&D` names a **rules system**, not a continuity: the same series value holds six third-party 5e lines with their own settings, Critical Role's Exandria (id 634 *Frozen Sick*), and **Middle-earth itself** (id 665). A universe there would have swept four unrelated continuities onto one shelf. A *setting* universe (Forgotten Realms, Exandria) stays a live and defensible question — recorded in `_refused.whatWouldChangeIt` |
| **Innworld — approved** | 22 rows. The qualifying fact was verified before writing: the household owns *Gravesong* **and** *Huntsong* = `Singer of Terandria Series` 1–2, and Terandria is a **continent of the same world** as The Wandering Inn (pirateaba's own store copy calls *Gravesong* "an Innverse story") |
| **Winnie-the-Pooh — include in Disney** | And, more valuable than the row, it **settled a criterion**: Disney here is **franchise-inclusive**, so a kid-recognisable Disney property belongs even where the row's own provenance is not Disney's. Written into Disney's new `criterion` field, which explicitly supersedes the produced-vs-franchise question. It does **not** loosen the crossover test, and it does **not** reach a name collision — *Betrayed! (Aladdin Historical Fiction)* stays out, because S&S's Aladdin imprint is not the franchise |

**Two naming calls, both made on this file's existing conventions rather than invented:**

- **Innworld**, not "The Wandering Inn" — naming it after the flagship series would elevate one of its two series over the other, which is exactly the trap Solaria's `naming` note records ("the same reason Divine Dungeon became CAL Verse"). *Innworld* is the author's and fandom's own word. `canonicalNames` folds `the wandering inn universe` and `innverse` onto it so the obvious spellings still resolve.
- **Dungeon Crawler Carl** *is* named for its series — following the Reckoners precedent set the same day: where no in-world or fandom name is in general use, use the franchise's own rather than inventing one.

⚠️ **One entry depends on a write in another repo.** The Dungeon Crawler Carl universe claims **one series** instead of 29 title overrides, and that only works because `series = 'Dungeon Crawler Carl'` was set on board-game D1 ids 570–598 the same day (audit trail: `Board_Game_Catalog/docs/dcc-series-and-lotr-parent-2026-08-15-snapshot.json` + `.sql`, since that repo has no `change_log`). This is the deliberate **opposite** of the Brotherwise Cosmere line, whose rows carry a null series with no obvious product-line name and so get 21 exact title overrides. The cost is recorded in the entry's `seriesReachesGames` field: if those game rows ever lose their series value, 29 rows fall out of the universe silently.

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
