# Shared Index Worker — Information Reference (design)

> **STATUS UPDATE 2026-08-14 (status lines only; the header below predates the
> deploy):** the Worker is **LIVE at `index.heygabi.ai`** — remote 0001 + 0002
> applied, `ESTATE_APP_TOKEN_INDEX` + all three `INDEX_PUSH_TOKEN_*` secrets
> set, and **all three sources pushed** (game 836 / library 346 / audiobook
> 1077 rows, curled that day). §7 step 4 has therefore happened. Remote
> migration 0003 (visibility cache) is pending with the in-flight
> visibility-aware-search work. Runbook:
> `library_catalog/docs/access/index-worker.md`.
>
> **Audience:** Claude sessions. **Status:** TRACKED. **BUILT games-first,
> 2026-08-13** — §7 steps 1–3 landed (`apps/index-worker/` here; pusher in
> `Board_Game_Catalog`; 836 items pushed and looked up against local dev).
> Step 4 remains out until the shape has lived with games for a while.
> **§9 Q3 is ANSWERED and WIRED, 2026-08-13**: reads are estate-members-only
> (`estate-auth-design.md` §7.1); the Worker is the estate's first auth
> consumer (canonical module + `estate_cache` migration 0002). Migration 0001
> IS applied remotely (verified live 2026-08-13); 0002 is pending the deploy.
> The Worker itself is still NOT deployed — deploy, route, remote 0002 and the
> `ESTATE_APP_TOKEN_INDEX` secret are one gated dispatcher step, not a
> forgotten one.
> Last verified: **2026-08-13** (bridge scripts and games schema read; production
> key measurements are from the 2026-08-12 threshold write-up).
> Companion: `PLATFORM.md` §5 (the sketch this refines),
> `docs/info/matching-thresholds.md` (the measurements),
> `docs/info/improvement-proposals.md` §1.5 (the case for building it now).

The cross-catalog index of `PLATFORM.md` §5, designed for real. Games wired
first, because the games catalog has zero existing bridges — nothing to
migrate, nothing to break — while the two book catalogs already share two
hand-built bridges that must not be touched until this shape is proven.

---

## 1. The problem statement is the two existing bridges

Both are library↔audiobook, both are scripts, both are **only as fresh as
their last run**:

| Bridge | What it does | The drift |
|---|---|---|
| Review-key backfill (`identity-and-reviews.md` §5) | Stamped ~870 Firestore review docs with `work_key` so print editions join audiobook reviews | Its dry run once claimed 860/860 matched while writing keys no print edition could meet; caught only by printing the rows |
| `backfill-audiobook-holdings.mjs` (+ migrations 0010, 0090, 0110) | Caches "we own this on audio" in two D1 tables | Space Knight 7 sat invisible until a re-run; 0110 exists so the owner can hand-patch what the bridge cannot see |

The second script's header says outright why it is a script: the audiobook
catalog's truth is **a CSV on disk beside the repo**, which a Worker cannot
read. The index retires that constraint — each catalog *pushes* its projection
at the moment it changes, so there is no cache that a forgotten re-run leaves
stale (`PLATFORM.md` §5.1).

What the bridges teach, kept: one matcher, never a second similarity function;
`matched_via`-style honesty about how a claim was made; zero rows from a source
means "the push failed", never "the collection is empty".

## 2. What the index is, and is not

Per `PLATFORM.md` §2.2: **pointers, never truth.** One D1 row per catalogued
thing, holding display fields and where to send the visitor. Re-pushing a
source replaces that source's rows wholesale; the owning catalog remains the
only place a fact lives. No merge, no write-back, no catalog reads another
catalog.

## 3. ⚠️ The join key — the decision, made rather than hand-waved

`PLATFORM.md` §5 sketched one `match_key = normalise(title)|normalise(primary_author)`
for everything. **Measured 2026-08-12, that key is wrong twice:**

1. **`normaliseTitle` folds any wholly non-Latin title to the empty string.**
   Two Korean works in production carry keys that are nothing but the author
   (`|samg`, `|samg entertainment`) — one author-spelling merge away from a
   full collision. An index keyed on this inherits the bug estate-wide.
2. **Games have no author, and a board game is never the same *work* as a
   book.** Title+publisher+year is a game's identity; expansions are not
   standalone. Forcing games into `title|author` pretends games are books.

So the index stores **key components, not one concatenated key**, and joins at
**two tiers**:

### 3.1 Work tier — books only

`work_fold = title_fold || '|' || creator_fold`, computed **by the index, on
write** (`PLATFORM.md` §2.3 — the sources push raw strings and never fold).
This is the "same work, different format" join: audiobook ↔ hardcover ↔ ebook.

- **Games rows have `work_fold = NULL`, by design, always.** A game never
  answers a "same work in another format" query. This is not a limitation to
  fix later; it is the design refusing to invent an identity games do not have.
- ⚠️ **The empty-fold guard:** if `normaliseTitle(title)` folds to `''`, the
  index stores `title_fold = NULL` and therefore `work_fold = NULL`. Same for
  an empty creator fold. A row with a NULL fold **can never match by key** —
  reachable only via `(source, source_id)` or display-title search. That is an
  honest refusal in this estate's house style (`cover_status`, `openEnded`,
  `'at least N'`): a degenerate key is a guess, and the fix for the Korean
  works is *not joining*, not joining on the author alone.

### 3.2 Universe tier — the only cross-format join games participate in

A `universe` column, resolved on write from `data/universes.json` (already this
repo's file, already read by both book catalogs). This is what puts the DCC
board game beside the DCC books — the real cross-format ask in the proposals
(§3.2, §3.4 there). Games join *here*, where the shared fact ("these are one
fiction") actually exists, instead of at a work tier where no shared fact does.

### 3.3 "Do I own this in any format?" at the store

`GET /api/lookup?title=…` folds the query once (same fold) and returns
candidate rows across all sources — including games matched on `title_fold`
alone. Title-only matching is safe **here and only here** because the reader
is a human looking at a result list with covers and publishers; nothing
machine-actionable hangs off it. The 0.34/0.7 threshold lessons apply to
*auto-acting* matchers; the index read surface never auto-acts.

## 4. Schema

One table, plus D1's own migrations bookkeeping. `source`-scoped snapshot
replace means no per-row staleness machinery — the push protocol (§5) carries
freshness per source instead.

```sql
CREATE TABLE entry (
  source          TEXT NOT NULL CHECK (source IN ('game','library','audiobook')),
  source_id       TEXT NOT NULL,           -- id in the owning catalog
  title           TEXT NOT NULL,           -- display, the source's spelling
  creator         TEXT,                    -- author (books); NULL for games
  title_fold      TEXT,                    -- computed HERE on write; NULL when the fold is empty
  work_fold       TEXT,                    -- books only; NULL for games and degenerate folds
  universe        TEXT,                    -- from universes.json, resolved on write
  series          TEXT,
  series_index    REAL,
  year            INTEGER,                 -- identity component for games
  publisher       TEXT,                    -- identity component for games
  format          TEXT NOT NULL,           -- 'boardgame' / 'audiobook' / 'hardcover' / …
  kind            TEXT,                    -- games: base/expansion/accessory/promo/upgrade
  parent_source_id TEXT,                   -- expansions point at their base game
  cover_url       TEXT,
  detail_url      TEXT,
  pushed_at       TEXT NOT NULL,
  PRIMARY KEY (source, source_id)
);
CREATE INDEX ix_entry_title_fold ON entry(title_fold) WHERE title_fold IS NOT NULL;
CREATE INDEX ix_entry_work_fold  ON entry(work_fold)  WHERE work_fold  IS NOT NULL;
CREATE INDEX ix_entry_universe   ON entry(universe)   WHERE universe   IS NOT NULL;
```

Partial indexes so the NULL-fold rows (the refusals) never even enter the join
indexes.

### 4.1 The projection is default-deny (`PLATFORM.md` §5.2, unchanged)

The pusher builds rows from an **explicit column allow-list in code** — never
`SELECT *` minus exclusions. Never exported: prices, `lent_to`, condition
notes, per-person ratings, emails, ASINs, read-state, acquisition dates.
`export.ts` in the games repo is the wrong wheel (full backup, joins ratings
to emails); the projection is written fresh.

## 5. Write protocol — snapshot push, replace by source

`PUT /api/push/:source` with a JSON array of that source's complete
projection, authenticated by a per-source bearer token (Worker secret;
`INDEX_PUSH_TOKEN_GAME` etc.). The Worker:

1. rejects an empty array with 422 — *"zero rows is a failed export, not an
   empty catalog"* (the bridge script's own loud-failure rule, kept);
2. folds `title_fold` / `work_fold` (books only) and resolves `universe`,
   once, here;
3. in one batch: `DELETE FROM entry WHERE source = ?` then inserts the
   snapshot, recording `pushed_at`.

Full snapshot rather than diffs because the projection is small (≤ a few
thousand rows per source) and **snapshot-replace is what makes drift
structurally impossible** — there is no incremental state to fall behind.
`GET /api/health` reports rows and `MAX(pushed_at)` per source, so a stale
source is visible instead of silent.

Pushes come from each catalog's existing machinery on change (games: after
mutations via a debounced `waitUntil` or its existing cron; later, the
audiobook pipeline after a rebuild, the library Worker likewise). **No inbound
pull, ever** — the index cannot stall a catalog's deploy.

## 6. Where the fold lives, and how three repos stay agreed

- **One runtime implementation:** the index Worker's, in this repo. Sources
  push raw display strings and contain **no fold code at all** — this beats
  even `PLATFORM.md` §5.3's "three exporters compute the inputs", because the
  inputs are just columns.
- The index's fold must equal `library_catalog`'s `normaliseTitle` /
  `splitAuthors`-derived `primaryAuthor` fold — otherwise "same book" would
  mean two different things in the estate (the index's work tier replicates
  what `work_key` means). **Pinned by a fixture file in this repo**
  (`data/match-fold.fixtures.json`, the §5.3/UNIVERSES mechanism applied
  again): awkward author strings, the Korean-title empty-fold cases, leading
  articles. The library repo gains a CI test asserting its `normaliseTitle`
  reproduces the fixtures; this repo's index tests assert the same. Drift
  breaks a build loudly instead of a join silently.
- The empty-fold **refusal wrapper is index-only** and is a wrapper, not a
  second fold: `fold(s) === '' ? null : fold(s)`.

## 7. Games-first build plan

| Step | Where | What |
|---|---|---|
| 1 | this repo, `apps/index-worker/` | Worker + D1 (`index_catalog` DB), migration above, `PUT /api/push/:source`, `GET /api/lookup`, `GET /api/universe/:name`, `GET /api/health`. Own wrangler.toml — `DESIGN.md` §3's separate-blast-radius rule |
| 2 | `Board_Game_Catalog` | `buildIndexProjection()` — allow-listed columns from `item` (all kinds, with `kind` and `parent_item_id` → `parent_source_id`); push on cron + after mutations. ⚠️ No `test` script there — typecheck is the only verification, and reports must say so |
| 3 | proof | Push 836 items, then `lookup?title=…` answers "do I own this in any format?" for a game — the first cross-catalog query the estate has ever answered without a script |
| 4 | later, not now | Library pusher, audiobook pusher (pipeline-side, Python — pushes raw strings so no Python fold needed), then retire the two bridges *only* when the index provably answers what they answer |

Step 4 is deliberately out of scope until the shape survives contact with
games. The two bridges keep running untouched meanwhile.

## 8. Not doing, so nobody reopens them

- **No auto-merge, no machine action on any index match.** Reader surfaces are
  human-facing lists.
- **No second matcher** — *scoped, 2026-08-14, to what it always meant.* The
  rule exists so the estate never grows a second IDENTITY function: a
  similarity score whose thresholds could disagree with the catalogs'
  `matching.ts` about what is the same work, feeding an auto-acting join.
  `/api/lookup` stays exact fold-joins only, and containment/thresholds stay
  in the catalogs. The carve-out: **`/api/search` (src/search.ts) is a ranked
  partial-match search for humans typing** — exact > prefix >
  all-tokens-prefix > substring across title/creator/series, reasons carried
  matched_via-style, nothing machine-actionable downstream (§3.3's own
  test). It claims resemblance, never identity; anything that needs an
  identity claim uses `/api/lookup`. Owner-forced, 2026-08-14: "it needed an
  exact match … we need a much better search algorithm" — the rule was never
  meant to make a human's search box require exact titles.
- **No public browse decision.** `PLATFORM.md` §8 Q3 stays open; the
  projection's field list is browse-safe either way because it is default-deny.
- **No games `work_fold` "for consistency".** NULL is the design.

## 8.5 The series registry (migration 0004, BUILT + DEPLOYED 2026-08-17)

The owner's order, 2026-08-16: **"I don't want duplicate series."** `entry.series`
is free text in whichever spelling the owning catalog holds, so an m4b tag
saying "The Stormlight Archive" and a library row saying "Stormlight Archive"
are two series to anything that groups by that string. The registry gives a
series what §3.1 gave a book: **a key.**

| Table | Holds |
|---|---|
| `series` | slug → canonical `display_name`, **first writer wins**, `first_source` on the record |
| `series_alias` | a fold → a slug it does NOT fold to on its own (`canon` / `human` merges) |
| `series_pending` | the confirm queue: near misses, kept AFTER resolution so a decision is never re-asked |
| `entry.series_slug` | which registry entry a row belongs to; NULL for no series and for the empty-fold refusal |

**The fold is `normaliseTitle` (§6's pinned port), hyphenated — not a new
normaliser.** It already strips a leading article, so the owner's own example
merges mechanically. `src/series.ts` is wrappers over it in the house style of
`titleFoldOrNull`, empty-fold refusal included (two Korean series names fold to
`''` and take NULL rather than a shared degenerate key). ⚠️ `normaliseUniverseText`
is deliberately not used: it KEEPS leading articles on purpose, which is the
opposite of what a de-duplicating key needs.

**The split the owner approved:**

- **Exact fold equality → AUTO-MERGE.** No score, no threshold. `entry.series`
  is REWRITTEN to the canonical display, so a consumer that never learns about
  the registry also stops seeing two.
- **Near miss (folds differ) → NEVER merged.** It registers as its own slug and
  a row lands in the queue. Silence leaves two series — the honest default.

⚠️ **This does not breach §8's "no second matcher".** The near key gates no
write, ranks nothing, and its only consumer is a human's queue. The rule is not
even invented here: it is the decoration fold `data/series-canon.json`'s
`_measured` used to FIND the estate's three real drift groups, which that file
states is "a DISCOVERY tool only, never a runtime rule". Reused as one.

The canon itself is consulted (`src/series-canon-data.ts`): three folds a human
already decided WITH EVIDENCE. Re-asking the queue for a decision already on
record would be the queue asking a question it has the answer to.

**API** — members-only and visibility-scoped, i.e. `/api/universe`'s stance, NOT
`/api/search`'s anonymous carve-out (§9 Q3's amendment names search alone):

```
GET  /api/series                 per-source counts, scoped
GET  /api/series/:slug           grouped by medium (the row's own `format`)
GET  /api/series/pending         the confirm queue                (approver)
POST /api/series/pending/:fold   {"action":"merge","into":…} | {"action":"separate"}  (approver)
```

⚠️ **The list is derived from SCOPED ENTRY ROWS, never from the `series`
table.** The registry is estate-wide; listing it would tell an audiobook-only
member the series NAMES held in the two private catalogs. For the same reason
`/api/series/:slug` answers `unknown_series` for a slug that is real but wholly
out of scope — a 404 that only fired for the absent would confirm the private.

**Approver = `OWNER_EMAILS`.** The index has no local roles and
`@platform/estate-auth` does not expose the estate's `is_approver` to
consumers, so the gate stays narrow; `requireOwnerStanding()` is the one place
to widen it if /seen ever carries the flag.

**Measured on the live index, 2026-08-17** (backfill via
`scripts/backfill-series.ts`, which calls the SAME `planSeries` the push does):
1,590 rows carry a series / **443 distinct raw spellings → 441 slugs** / 2
unfoldable (NULL, by design) / **1 confirm-queue row** ("The Survivalist Series"
~ "The Survivalist", both audiobook) / 0 exact merges. ⚠️ **Zero exact merges is
the honest headline**: the estate's cross-catalog spellings had already been
straightened by the series canon and the audiobook corrections layer, so this
registry is mostly PREVENTATIVE — it makes the regression structurally
impossible rather than cleaning up a mess that was still there.

**Known follow-up, deliberately not smuggled in:** `entry.universe` is still
resolved from the SOURCE's spelling, not from the canonical display the push
now writes. Re-pointing that join is its own verifiable step.

## 9. Open questions

1. **Push trigger granularity for games** — per-mutation `waitUntil` vs cron
   only. Cron-only is one line and loses at most a day of freshness; start
   there, add per-mutation later if staleness ever bites.
2. **Does `universe` resolution belong on write or on read?** On write (chosen)
   means a `universes.json` edit needs a re-push to propagate. Acceptable:
   the file changes "maybe monthly" (`PLATFORM.md` §5.4) and every source
   pushes at least daily once wired.
3. **Auth for reads** — ~~the lookup surface leaks titles owned. Public-read is
   probably fine for the same reason the audiobook site is public, but it is
   an owner call before the domain route (`index.heygabi.ai`) goes live.~~
   **ANSWERED 2026-08-13** by `estate-auth-design.md` §7.1: reads are
   **estate-members-only** — the surface aggregates titles across all three
   catalogs including the two private ones, so it does not inherit the
   audiobook site's public rationale. Wired the same day (`middleware/auth.ts`
   + `estate_cache` migration 0002); the index is deliberately the estate's
   FIRST auth consumer (zero users — the protocol is proven where nobody can
   be locked out). `/api/health` stays open; push keeps its per-source
   bearers.
   *Amended 2026-08-13, when §4.5 (visibility) landed:* **`/api/search` is
   the one named carve-out** — it answers everyone, scoped by the caller's
   effective **visibility set** per `estate-auth-design.md` §4.5's anonymous
   rule: absent/invalid token ⇒ the public slice (`{audiobook}`, the one
   catalog that is world-readable anyway), member ⇒ their `/seen` visibility
   verbatim, revoked ⇒ `{}` (an honest empty answer, not a 401). The scope
   is the SQL (`WHERE source IN (…)`, `search-route.ts`), so out-of-scope
   titles never reach the ranker, the universe counts, or the wire — the
   members-only rationale ("aggregates titles across the private catalogs")
   is preserved because the private catalogs are exactly what an unscoped
   caller never gets. `/api/lookup` stays members-only and unscoped;
   `/api/universe` stays members-only and is scoped to the member's set.
