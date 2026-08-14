# Shared Index Worker — Information Reference (design)

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
