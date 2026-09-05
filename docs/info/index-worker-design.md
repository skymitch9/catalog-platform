# Shared Index Worker — Information Reference (design)

> **STATUS UPDATE 2026-08-23:** **§10 is new** — a named MACHINE READ exception
> (`/api/machine/lookup`, `/api/machine/search`), the owner-approved widening of
> §9 Q3 that lets a sibling **Worker** read the index at all. Built and tested;
> ⚠️ **NOT deployed, and its secret is not minted** — see §10.8 for what is and
> is not verified. Nothing about the human read surface changed.
>
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
                                 + `pending_open` / `pending_detail`  (approver only)
GET  /api/series/:slug           grouped by medium (the row's own `format`)
GET  /api/series/pending         the confirm queue                (approver)
POST /api/series/pending/:fold   {"action":"merge","into":…} | {"action":"separate"}  (approver)
```

⚠️ **`pending_open` exists because a queue nobody is told about is a queue
nobody resolves** (added 2026-08-17). The registry's first real near miss sat
unnoticed: nothing in a browser called `/api/series/pending`, so learning that
a decision was waiting meant remembering the endpoint. The list an approver
already loads now says how many are open, in a sentence rather than a bare
number ("Nothing was merged — these series stay separate until you resolve
them"), with the URL to act on. **Approver-only and ABSENT rather than zeroed
for everyone else** — a count of near misses spans every catalog, so it is
estate-wide information the way the `series` table itself is — and it is a
COUNT, never the rows.

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

### 8.5.1 The universe join reads the SERIES, not one spelling of it (2026-08-17)

The registry's own follow-up, done. `universes.json` lists each series in ONE
spelling ("The Stormlight Archive"), and `normaliseUniverseText` keeps leading
articles **on purpose**, so a source pushing any other spelling of the same
series missed the universe join outright: one book could sit in the Cosmere on
the audiobook shelf and in no universe at all on the library shelf.

The registry knows those spellings are one series, so `applySeriesPlan`
(`src/push.ts`) asks again. The rule, in the order it applies:

1. `entryFor` resolves the universe from the **pushed** spelling, unchanged.
2. A row that came back with NOTHING is asked again with every **other**
   spelling of its series **in the same snapshot** — canonical first, the rest
   sorted, so the answer never depends on the order a source listed its rows.
3. Two spellings that answer with DIFFERENT universes: the row's own spelling
   wins, and the row is **counted as a conflict with samples**. One series in
   two universes is a fault in `data/universes.json`; picking a winner here
   would hide it behind a guess.

⚠️ **Asking with the canonical display alone is NOT enough, and the live probe
found that rather than the design predicting it.** The canonical display is
"first writer wins" in fold order, so it is just as likely to *be* the unlisted
spelling — "Stormlight Archive" sorts before "The Stormlight Archive". A
canonical-only attempt gains nothing exactly when both spellings arrive in one
push, which is the case that leaves one series holding two answers.

⚠️ **Still exact, still additive, still no second matcher.** Every attempt is
the same `universeFor` lookup on a string a source really pushed; nothing is
folded and nothing is guessed. The pushed spelling is never overridden, so no
row can LOSE a universe. Exclusions cannot be smuggled past (`universeFor`
refuses by TITLE before it looks at any series). And a near miss lends nothing:
only spellings that RESOLVED to the same slug are tried, and a near miss has
its own slug — the queue's "never merged, only asked" rule holds here too.

⚠️ **This does NOT mean `universes.json` may now list one spelling per series
and drop the variants** — the hope recorded when the follow-up was logged. The
index gains registry-backed spelling tolerance; `library_catalog` and
`audiobook_catalog` resolve the same list with **their own** implementations
and have no registry, so a variant removed from the list goes missing on their
sites. The list's variants stay.

**Measured per push:** the response gained a `universe` block —
`rows` (carrying a universe), `gained_from_registry` (owed to a sibling
spelling), `conflicts` (+ up to three samples).

**Measured over the live index, 2026-08-17** (`scripts/backfill-universe.ts`,
dry run, remote): 2,434 rows / **445 carry a universe** / **0 would change** /
0 rows whose stored universe disagrees with today's list / 0 series naming two
universes. The estate had no rows to fix — the same "mostly PREVENTATIVE"
headline the registry itself earned, and for the same reason.

⚠️ **The backfill's sibling report is REPORT-ONLY, and the measurement is why.**
The tempting version — fill a universe-less row from a sibling row of the same
series that has one — resolves MORE than the push does, because a sibling's
universe may have come from a bookOverride TITLE. Against the real index it
would have written **207 rows: 108 D&D games into Middle-earth** (one
LOTR-branded D&D product), **76 Dice Throne boxes into Marvel**, 22 Ascension,
1 Little Golden Book. Every one is a crossover product, not a universe member,
and the next snapshot replace would have recomputed them NULL and silently
undone it — a backfill that resolves differently from the push re-creates
design §1's drift class. It prints them and names the honest fix: an edit to
`data/universes.json`.

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
   *Widened 2026-08-23 by a THIRD named case — a machine. See §10.*

---

## 10. The machine read (`/api/machine/*`) — BUILT 2026-08-23, NOT deployed

⚠️ **This is an OWNER-APPROVED WIDENING of §9 Q3, recorded as one.** §9 Q3
answered "auth for reads" with **estate members only**, and its 2026-08-13
amendment carved out `/api/search` alone for the anonymous internet. This adds
a **third named case — a machine** — and the reasoning above is not retracted:
the read surface still aggregates titles across the two private catalogs, and
that is still why no human reaches it without an estate membership.

### 10.1 The gap was total, not awkward

| Credential | Authenticates | Reaches the read surface? |
|---|---|---|
| Firebase ID token (`requireEstateMember`) | a **human** | yes — and no Worker holds or can mint one |
| `INDEX_PUSH_TOKEN_*` (`push.ts`) | a **pushing machine** | no — `/api/push` only, writes only |
| — | a **reading machine** | ⚠️ **nothing existed** |

So the library Worker's free-details ladder — which needs `/api/lookup` for
exact identity and `/api/search?source=library` for series — had no way in at
all. Not an inconvenient path: no credential.

### 10.2 The shape

```
GET /api/machine/lookup?title=…          Authorization: Bearer <INDEX_READ_TOKEN_LIBRARY>
GET /api/machine/search?q=… [&source=…]  Authorization: Bearer <INDEX_READ_TOKEN_LIBRARY>
```

Mounted **above the `requireEstateMember()` blanket, BY NAME**, with its reason
in a comment — conformance §8.2 #3's named-exception rule, the `/api/push`
precedent exactly. ⚠️ **And above `readCors()` too, on purpose: these routes
carry NO CORS headers**, so no browser can call them cross-origin even from the
apex, which `/api/search` does admit. A machine `fetch` never preflights, and
the read token must never be anywhere a browser could hold it.

⚠️ **The human routes are untouched.** `/api/lookup` and `/api/universe` stay
below the blanket, members-only; presenting a machine read token to them
answers the same `401 unauthenticated` as presenting nothing. There is a test
for that specific confusion.

### 10.3 One token per app, and the pairing that goes wrong

The push tokens' idiom, reused wholesale — *one secret per calling app, so one
leaked token revokes one app's read access rather than every app's.*

| Secret | Index Worker holds | Calling app holds |
|---|---|---|
| machine read, library | `INDEX_READ_TOKEN_LIBRARY` | library Worker: **`INDEX_READ_TOKEN`** (one un-suffixed name per repo) |

⚠️ **The suffixed name lives here; the un-suffixed name lives there** — the same
shape as `INDEX_PUSH_TOKEN_LIBRARY` ↔ `INDEX_PUSH_TOKEN`. ⚠️ **Read and push
tokens are different credentials and must never share a value**: push writes
one source's whole snapshot, read sees across every catalog. The refusal for a
push token presented here says so in words.

**The caller is identified by the token VALUE, never by anything it says about
itself** — there is no `app` field on the wire to lie in. That is the estate's
standing `identifyApp` pattern, and `estate-auth-design.md` §4.5's `library2`
note records what happens when it is skipped. `library` is the only app
configured; a second is one `Env` field, one `MACHINE_APPS` entry, and one
`wrangler secret put`.

### 10.4 What slice a machine resolves to — an APPROVED MEMBER's

`MACHINE_VISIBILITY = {audiobook, library, games}`, per `estate-auth-design.md`
§4.5.

| Candidate | Verdict |
|---|---|
| **`{audiobook, library, games}`** | ✅ **chosen** — `0002_visibility.sql`'s `DEFAULT 1` trio, i.e. §4.5's *"every already-approved member holds all three"*. That IS the approved-member default |
| `CATALOGS` (all five) | ❌ `OWNER_EMAILS`' **computed break-glass** set (§4.3). A leaked machine token must not be worth more than a leaked member session |
| `PUBLIC_CATALOGS` (`{audiobook}`) | ❌ the private library shelf is the entire reason this surface exists |

⚠️ **`library2` (0007) and `ebooks` (0008) are `DEFAULT 0` on purpose** — another
household's shelf, and *"the estate's most copyable asset"* under an explicit
owner directive about scraping. People are switched on there **by hand**, so a
machine nobody switched on by hand gets neither. Adding either is a fresh owner
decision, not a config tweak.

**Per route, concretely:**

- **`/api/machine/search`** scopes its SQL to those three sources, so the
  private library and games shelves are readable and `library2` rows never are.
  `scopeSeesEbooks()` is FALSE for this set, so the `format='ebook'` carve-out
  (the measured hole in `search-route.ts`) subtracts every ebook row **before
  the ranker**.
- ⚠️ **`/api/machine/lookup` is UNSCOPED**, because `lookupHandler` is unscoped
  for humans too — recorded in `read.ts` as an explicit owner call, *"lookup
  stays membership-gated, unscoped"*. The machine **inherits that stance
  verbatim** rather than inventing a stricter or looser one. This is not the
  ebook-enumeration hole: lookup answers ONE exact folded title and cannot
  enumerate a shelf, which is why the carve-out lives on the ranked scan. If
  lookup's scoping ever changes for members it changes here for free.

### 10.5 One code path, not a parallel one

`lookupHandler` and `searchHandler` are exported and mounted by **both** the
human and the machine routes. The gates differ; the read does not. Two lookup
endpoints that could disagree about what *"do I own this?"* means is §8's
second-matcher failure wearing a different hat.

⚠️ `searchScope()` stays mounted on `searchRoutes` only — re-mounting that
router for machines would overwrite the stamped visibility with the anonymous
public slice, which is exactly why the machine mount takes the **handler**.

### 10.6 Three distinct refusals, each worded

The estate rule: never a bare status — *what happened / what it needs / how to
get it.*

| | Answer | When |
|---|---|---|
| config | **503** `machine_read_unconfigured` | no read token minted. ⚠️ **Never 404** — 404 reads as *"not built"* and sends an operator hunting a feature that exists and is merely unkeyed. Names the secret, since only the owner can mint it |
| credential absent | **401** `machine_token_missing` | no bearer offered at all |
| credential wrong | **401** `machine_token_invalid` | offered and not one we hold — says outright that a **push** token will not work here |

⚠️ **The configuration question is asked BEFORE the credential question**
(`push.ts`'s order), so a fault of ours is never reported as the caller's.

### 10.7 🔴 A gap this found: no test had EVER presented a correct token

`crypto.subtle.timingSafeEqual` is a **Cloudflare Workers extension**; Node's
WebCrypto has no such method. `test/auth.test.ts`'s push case sends
`Bearer wrong`, which differs in **length** and returns false at the length
gate — so the one line that can say *"yes, this credential is valid"* had never
been executed under `npm test`. The first test to present a **matching** token
threw `TypeError` on all seven of its cases.

`src/bearer.ts` (the check, lifted out of `push.ts` unchanged so there is one
canonical copy) now falls back to a constant-time XOR accumulation on Node
while the Workers runtime keeps using the platform primitive.

### 10.8 State — shipped ≠ verified

| | |
|---|---|
| **Built** | ✅ `apps/index-worker/src/machine-route.ts`, `bearer.ts`; `env.ts`; mount in `index.ts` |
| **Tested** | ✅ `test/machine-read.test.ts`, 16 tests — mount order, the three refusals, delegation per route. `npm test` 145/145; `npm run typecheck` clean |
| **Probed** | ⚠️ rows added (`I9`–`I11`, `tools/estate-probes/probes/index-worker.mjs`) but **never executed live** — they will 404 until the deploy |
| **Secret minted** | ❌ owner only — `INDEX_READ_TOKEN_LIBRARY` here, `INDEX_READ_TOKEN` on the library Worker: one value, both holders, one sitting |
| **Deployed** | ❌ |
| **Verified live** | ❌ nothing has been called against `index.heygabi.ai` |
| **Consumer wired** | ❌ the library Worker's free-details ladder does not call this yet |

⚠️ Order: **deploy the index first** — the route answers a worded 503 while
unkeyed, which is safe and names the missing secret — then mint and set the
secret on **both** holders, then re-run `npm run probe:estate` and expect
`I9`/`I10` to report the **401** rather than the 503.

---

## 11. The FOURTH source — `library2` (padhard), federated 2026-09-05

> **Last verified: 2026-09-05.** Measured that day: the live remote
> `sqlite_master` (the `entry.source` CHECK constraint quoted below), the local
> migration drill (row counts before and after the rebuild), and the
> test/typecheck figures. ⚠️ **NOT verified:** nothing has pushed a real
> `library2` row — padhard's own side is a sibling agent's work and the secret
> is the owner's, so every claim about what the two tabs SHOW is still
> inference. See §11.5.

`library2` is padhard — `library_catalog`'s `[env.friend]`, Samantha's
instance: the same build as the main library Worker, running a different
collection. It had been a **visibility** value since auth-worker migration 0007
and an **app** name since §10.3, but never a **source**, so nothing could put a
row into this index under it. That gap surfaced as the owner's bug report —
*"in the universe and series tab it's not pulling Padhard library"*. Both tabs
were rendering an empty truth.

### 11.1 A fourth source id, not a flavour of `library`

The write protocol is a **snapshot replace keyed on `entry.source`** (§5):
`PUT /api/push/library` deletes every `library` row and re-inserts the body. Two
instances sharing one source id would therefore **delete each other's catalogue
on every push** — whichever pushed last would be the whole shelf. One id per
pushing instance makes that structurally impossible rather than merely
discouraged, which is the argument §5 already makes for snapshot-replace itself.

It is a **book** source: the only branch in `rows.ts` that reads the value is
`source === 'game'`, so `library2` inherits `work_fold`, the creator rules and
the series registry with no extra case — and Samantha's copy of a book lands on
the same Series page as the household's, joined by the key rather than by a
guess.

### 11.2 Its own credential, for the reason §10.3 gives

`INDEX_PUSH_TOKEN_LIBRARY2`, **a different value** from
`INDEX_PUSH_TOKEN_LIBRARY` — exactly the `INDEX_READ_TOKEN_LIBRARY2`
precedent and for the same reason: the two instances are two callers, so one
leaked value revokes one instance's write access. The pairing rule holds too —
the index holds the **suffixed** name, padhard holds it **un-suffixed** as
`INDEX_PUSH_TOKEN` on `[env.friend]`. Unset is a worded **503** naming the
secret, never a 404; a wrong value is a **401**. Three distinct refusals, same
vocabulary as §10.6.

### 11.3 🔴 The migration is the half that is easy to miss

⚠️ **`npx wrangler d1 migrations list --remote` said "No migrations to apply",
and that was true and not the question.** Nothing was *pending*; a new migration
was *required*. Migration 0001 wrote the push vocabulary into the **schema** —
verified against the live remote `sqlite_master`, 2026-09-05:

```sql
source TEXT NOT NULL CHECK (source IN ('game','library','audiobook'))
```

A Worker that knows `library2` while the database does not passes every check in
`push.ts` — known source, matching token, valid snapshot, whole series plan
computed — and then dies inside `db.batch` on a CHECK constraint failure the
pusher sees as a **bare 500**. **Migrate before deploy** is the estate's
standing rule, and this is precisely the case it exists for.

`0006_entry_source_library2.sql` **widens** the constraint rather than dropping
it: it is a second fence behind `isSource`, and it is the fence that turned this
into a loud failure instead of a table quietly accumulating rows under a source
id nothing would ever read. SQLite cannot `ALTER` a CHECK, so it is the standard
table rebuild — new table, **column-named** copy (a `SELECT *` would silently
reorder if a column were ever added mid-table), drop, rename, and all four
**partial** indexes re-created from 0001 and 0004. No foreign keys, triggers or
views point at `entry`.

**Drilled locally before going near the remote:** 0006 applied clean, an insert
the old schema rejected was accepted, and the three existing sources came
through the rebuild intact — audiobook 1,077 / game 836 / library 346, the same
figures as before. The data here is a **projection, not truth** (`PLATFORM.md`
§2.2), re-creatable by re-pushing each source, which is what makes rebuilding
this table an ordinary migration rather than a risk.

`push.ts` also stops answering a bare 500 in that half-applied state: a CHECK
failure is now a worded 503 `source_not_in_schema` naming the cause and the
command that fixes it. It **narrows rather than swallows** — any other database
failure keeps its own words, so nobody is sent to run a migration that is
already applied.

### 11.4 🔴 Federation would have opened a hole in `/api/lookup`

⚠️ **The leak would have been a side effect of an unrelated change rather than a
decision anybody made** — the most dangerous shape an access change can take.

`/api/lookup` is membership-gated and **deliberately not visibility-scoped** (an
owner call; `read.ts`'s header). That was defensible while every source it could
return belonged to the owner's own household. `library2` is **somebody else's
collection**, and `vis_library2` is `DEFAULT 0`, hand-granted to the owner
alone. Without a fence, padhard's first push would have meant:

- every **approved member** could enumerate her shelf by title through
  `/api/lookup` while holding no `library2` grant at all; and
- every **machine token** could do the same through `/api/machine/lookup`, which
  mounts that exact handler (§10.5's one-code-path rule) — straight past a
  `MACHINE_VISIBILITY` that excludes `library2` **on purpose** (§10.4).

So `read.ts` carries `UNSCOPED_LOOKUP_EXCLUDED` and subtracts it **in the SQL**,
for the same reason the scoped routes put their scope there: a row that must not
be returned is a row that is never fetched, so no later refactor can leak it
back by forgetting a filter. **Fail closed** — widening is one line and an
owner's decision, whereas a shelf enumerated by everyone cannot be
un-enumerated.

The fence is on the **lane, not the caller**: not even the owner gets `library2`
from `/api/lookup`, because a per-caller exception would be a second visibility
implementation living in the one route that deliberately has none. He sees her
rows on the **scoped** surfaces, which is where scoping lives.

⚠️ **`MACHINE_VISIBILITY` did NOT gain `library2`**, and `machine-read.test.ts`
is untouched. §10.4's stance is unchanged by federation: padhard the **app**
still cannot read padhard the **shelf**.

### 11.5 State — shipped ≠ verified

| | |
|---|---|
| **Built** | ✅ `rows.ts` SOURCES · `env.ts` token + `pushTokenFor` · `push.ts` (`known` read from SOURCES; worded CHECK refusal) · `search-route.ts` preset · `read.ts` fence · migration 0006 |
| **Health** | ✅ needed no code — `SOURCES` drives it, so `library2` lists as `{rows: 0, pushed_at: null}` (the "never pushed" idiom) and cannot turn the route red: `ok` is a constant and the figures are reported, not judged |
| **Tested** | ✅ index-worker **175/175** (was 162); typecheck clean; root `npm test` **2,866** across the nine workspaces, 0 fail (348 + 293 + 723 + 1,246 + 175 + 42 + 0 + 5 + 34 — re-run and re-added at the final state, because the first figure written here was a bad sum, not a bad run). `machine-read.test.ts` deliberately unchanged and green |
| **Apex** | ✅ `universes.js` (games-vs-complement, so a future source can land in the wrong GROUP but never in no group) · `series.js` already named it · `estate-search.js` label |
| **Secret set** | ❌ owner only — `INDEX_PUSH_TOKEN_LIBRARY2` here, `INDEX_PUSH_TOKEN` on padhard's `[env.friend]`: one value, both holders, one sitting |
| **Consumer wired** | ❌ the library Worker's push source comes from `ESTATE_APP` — a sibling agent's work, in `library_catalog` |
| **Rows pushed** | ❌ nothing has ever pushed a `library2` row |
| **Verified live** | ⚠️ see this federation's line in [`../deploys.log`](../deploys.log) |

⚠️ **A gap this found and did NOT close:** `/status`'s index section iterates
its **own** list — `INDEX_SOURCE_ORDER = ['audiobook', 'library', 'game']` in
`sites/heygabi-home/public/status/status.js`. It ignores an unknown extra key,
so adding `library2` to `/api/health` cannot break that page; but it also means
**the Health page will not show padhard's source once she pushes.** Adding it
there needs an `INDEX_THRESHOLDS` entry (a push cadence nobody has measured
yet), and the row would sit amber or red for as long as she has never pushed —
so it is deliberately a separate decision rather than a side effect of
federation.
