# Estate Improvement Proposals — Information Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-13** — every count below was read from the two
> production D1s that morning (library-catalog and board-game-catalog, remote,
> read-only) or from a named file at a named line. Written by **Fable 5** on the
> owner's ask: *"look into improvements and feature requests for the platforms
> we have."* Survey only — nothing here was built, deployed or migrated.
>
> **Not verified:** §7 lists what could not be assessed and why.

The rule this document follows: **a proposal with no number or incident behind
it goes in §2 or nowhere.** §1 is ranked by value-to-effort. §5 records what was
considered and rejected, so the next session does not re-propose it.

---

## 0. Already owned — build on these, do not re-propose them

These exist, are specced, and several are in flight. Listed so nothing below is
misread as new.

| Item | Where it lives | State 2026-08-13 |
|---|---|---|
| Edit-any-detail + audit log | `library_catalog/docs/info/edit-and-audit-design.md` | designed, **owner approved all four decisions**, server guard on `title`/`authors` already deployed (`7a3b749`) |
| Edition picker | `library_catalog/docs/FABLE5.md` §4.2a | specced; now **7** production works hold >1 edition of one format (was 2 known cases) |
| Cover swap UI | `library_catalog/docs/TODO.md` | claimed by the Opus run |
| Record-delete button | `library_catalog/docs/TODO.md` | claimed; route exists, all 15 FKs cascade |
| Matching thresholds + bare-series-name rule | `matching-thresholds.md` (this folder) | measured, verdict written |
| Scan history view · CI for the two Workers | `PLATFORM.md` §7 Stage 1 · `TODO.md` §1 (this repo) | scoped, not started |
| CJK `work_key` fix (Hangul strips to `""`) | `library_catalog/docs/TODO.md` Opus log | confirmed bug, assigned to the edit-and-audit migration — *do not fix piecemeal* |

---

## 1. Improvements the data argues for — ranked by value-to-effort

Production shape the ranking rests on (library, 2026-08-13): **341 works, 378
editions, 265 copies** (250 owned, 15 preordered, 11 signed), added at
**28–116 works/day** across the last four days, with ~100 physical books still
unscanned. Board games: **836 items, 1,452 components, 2 users.** The catalog is
mid-intake, so **a fix on the intake path pays daily; a data correction pays
once** — the Opus work log states the same priority and the numbers agree.

### 1.1 Enforce "one barcode, one edition, one copy" at intake — effort S · library, then games

**Evidence.** On 2026-08-13 one Space Knight barcode resolved to an Open Library
**work-level** record and the add path minted **6 editions and 6 copies** of a
phantom book; the same bug corrupted 3 works in one evening, deleted only by raw
SQL. The refusal rule is already specced in
[`matching-thresholds.md`](matching-thresholds.md) §6 — and **measured tonight
as still absent from code**: no guard on `/works/`-shaped OL records and no
editions-per-barcode cap exists anywhere under `library_catalog/packages/`.
Scanning resumes today.

**What changes for the person.** A scan can no longer claim the household owns
six copies of a book that does not exist; deletes stop being SQL jobs.

**Where.** `library_catalog` intake (`packages/` + scan path). It is a shared
wheel: the games catalog scans barcodes too — implement in the shape
`PLATFORM.md` §7 expects to port.

### 1.2 A rescan is a question, not a second copy — effort S–M · library

**Evidence.** **71 physical editions carry no ISBN**, and the standing answer in
the work log is "a barcode scan will fill it in later" (*Dungeon Born*'s
paperback, #341's second B&N copy, the six Autumn board books). **That fill-in
path does not exist.** `apps/web/src/lib/catalog-add.ts` unconditionally writes
a **new owned copy** on the existing-work path (`recordArrival` →
`createCopy({status:'owned'})`) and, when the ISBN resolved, a **second
same-format edition** — so the promised rescan would instead inflate the ×N copy
count that exists for *"giving books away"* (#29) and duplicate the printing.
The residue is already in production: work **139** (*Dinosaur Dance!*) holds an
OL hardcover `9781481480994` **beside a `manual` ISBN-less hardcover** — one
book on the shelf, two edition rows. Works **163** and **203** each hold two
different-ISBN hardcovers of one children's book (real second printings, or a
scan that resolved a sibling printing — needs the shelf, see §7).

**What changes.** Scanning a book the catalog already holds asks: *"same copy —
fill in its printing — or a second copy?"* On "same one": attach the ISBN (and
publisher/year) to the ISBN-less same-format edition, write **no** copy. The
shipped **preorder-arrival prompt** is the exact pattern to reuse — a
discriminated `ask-*` outcome raised **before the first write**, idempotent on
re-run.

**Where.** `library_catalog`. ⚠️ Overlaps the owned edition picker (§0) — both
are "several candidates exist; which is this?" and should be one surface, not
two prompts.

### 1.3 Rehost the third-party cover hotlinks into R2 — effort S · library

**Evidence.** Cover host census, production 2026-08-13:

| host | works | status |
|---|---|---|
| bundled asset (`/covers/…`) | 115 | fine — own host |
| **openlibrary.org hotlink** | **108** | third-party |
| **Google Books hotlink** | **43** | third-party |
| self-hosted R2 | 33 | `ok` |
| none | 20 | — |
| other third-party | 10 | — |
| B&N Shopify / Illumicrate | 7 / 5 | `ok` / `standin`, deliberate |

The hotlinks fetch fine server-side and **render unreliably in browsers**
(documented in the cover-swap entry), and **every new scan adds more** — the
add path stores `line.coverUrl`, which is an OL URL. The R2 bucket and
`bookcovers.heygabi.ai` have been live since `0ab1e18e`; the upload path already
content-addresses objects and verifies magic bytes.

**What changes.** One idempotent script: fetch each hotlink server-side, verify
(`MIN_COVER_BYTES`, magic bytes), store content-addressed in R2, swap
`cover_url` — ⚠️ carrying `cover_status` with it, migration 0040's rule. Then do
the same at intake so the number stops growing. Distinct from the cover-swap
**UI** (choosing which art is right); this is where the chosen art *lives*.

### 1.4 Author-string canon and a dedupe report — effort S (report) · library + this repo

**Evidence.** Production holds `Make Believe Ideas` **and** `Make Believe
Ideas  Ltd.` (double space) as two authors, and `SAMG` vs `SAMG Entertainment`
— where the spelling split is currently **the only thing preventing a full
`work_key` collision** between the two Hangul-stripped Korean works. 163
distinct author strings over 341 works; publisher-as-author is a standing
convention (Scholastic, Bendon, Autumn Publishing ×6) with **no canonical
list**. The audiobook catalog already maintains the same wheel separately
(`author_aliases.json`, 508 folders).

**What changes.** (a) A read-only near-duplicate report (case, whitespace,
containment) — cheap and safe. (b) A canonical publisher-author list in **this
repo** beside `universes.json`, same shape: reasons recorded, refusals recorded,
fixtures pinning both consumers. (c) ⚠️ **Merges are key moves** — the join to
860 reviews — so each one goes through the now-approved edit-and-audit
machinery, one at a time, never bulk (§5.3).

### 1.5 Stand up the index Worker, games first — effort M · this repo (PLATFORM §5)

**Evidence it stopped being speculative.** The estate has now hand-built **two**
point-to-point bridges between library and audiobooks — 870 review keys
backfilled by script, 71 `audiobook_holding` rows whose backfill **must be
re-run to stay true**, plus migration 0110 so the owner can patch what the
bridge cannot see — and **zero** bridges to the 836-item games catalog. Each new
cross-format question becomes another script with its own drift. Meanwhile
Stage 2's prerequisites have landed since PLATFORM.md was written: the domain
exists, the audiobook site serves from Cloudflare, covers are in R2. §7's own
sequencing points here next, and §5.1's push-on-change design retires the
re-run-to-stay-true failure class. What it unlocks that no single catalog can:
§3.

### 1.6 Refresh PLATFORM.md's measured state — effort S · this repo

**Evidence.** `PLATFORM.md` §1 is measured 2026-08-07: the Books column reads
"—" while 341 works are live at library.heygabi.ai; §8 lists *"Which domain?"*
as open while heygabi.ai serves three subdomains. The fork sequencing in §7 is
being executed against stale premises. One session, live reads, update the
tables and the open-questions list.

---

## 2. Features that merely sound good — no evidence behind them

Kept short on purpose. Nothing here should be built ahead of anything in §1.

- **Lending tracker UI.** `copy.status='lent'` exists and is counted by
  `HELD_STATUSES`; **zero copies have ever been lent**. Build it the day the
  first loan happens.
- **Play logging for board games.** The `play` table has 0 rows and no write
  path (§4.1). 836 games catalogued, nobody has asked to log a play.
- **Print-side book clubs.** Clubs thrive on the audiobook site; no ask exists
  for the library, and the review store already spans both.
- **Cross-estate stats dashboard.** This estate has removed lack-counting
  surfaces twice; a dashboard is that idea at estate scale.
- **Public browse for games/library** (`PLATFORM.md` §8 Q3). Not evidence-poor
  so much as an owner decision; nothing in the data forces it either way.

---

## 3. Cross-catalog opportunities — what three catalogs + one identity unlock

All of these ride on §1.5's index; none is worth bespoke point-to-point wiring.

1. **"Do I own this in any format?" at the shelf or store.** Today answerable
   only book↔audio, and only through scripts that drift between runs. One
   indexed `match_key` query answers it across all three — the anti-duplicate
   check the audiobook pipeline enforces with a purchase-date audit, generalised.
2. **Pledge routing.** A single crowdfunding pledge routinely spans catalogs —
   the DCC pledge was books *and* a board game; Worlds Beyond Number likewise.
   Intake could file each line against the right catalog by `match_key` instead
   of by hand and by memory.
3. **Push-on-change replaces re-run backfills.** `audiobook_holding` is only as
   fresh as its last script run (Space Knight 7 sat invisible until one). Index
   writes on change make that class of staleness structural history.
4. **Universes across formats.** `universes.json` already spans the two book
   catalogs. A `universe` column on the index row lets `/universe/:name` show
   the DCC board game beside the DCC books — the tier above a series, now above
   a format too.
5. **Author identity as the second shared list.** Three author-string systems
   exist today (library `work.authors`, audiobook `author_aliases.json`, games
   designers). §1.4's canon belongs in this repo for the same reason
   `universes.json` does — one file, two fixtures, no drift.

---

## 4. Remove or simplify — weight not earned

Measured, not felt. This estate has form here (the gaps chip, the m4b repair
path, `boughtTwice`), and these are the next candidates.

### 4.1 Board games: the `play` table — dead schema

**0 rows**, and **no write path exists anywhere in the repo** — grep for
`INSERT INTO play`, `logPlay`, `addPlay` returns nothing; the only reference is
a `SELECT` in `routes/export.ts`. Schema for a feature never built. Drop the
table (attended migration) or at minimum stop exporting it.

### 4.2 Board games: `sleeve_requirement` — same shape

**0 rows**, no write path, read only by `export.ts:25`. Same remedy.

### 4.3 Board games: `user_item` ratings — live code, zero use. Watch, don't cut yet

A real write path exists (`packages/db/src/ratings.ts`) and after months, 836
items and 2 users it holds **0 rows**. Not dead code — but if it is still empty
once the index/public-browse questions settle, retire it per the gaps-chip
precedent rather than carrying it indefinitely.

### 4.4 Not simplifiable, despite appearances: the research accept gate

All **798** production findings are `accepted` — 0 rejected, 0 pending — which
*looks* like a rubber stamp ripe for automation. It is not: see §5.2.

---

## 5. Do not build — considered and rejected

1. **Any lack-count on a what-you-have surface.** Removed twice already (top-bar
   Series button, the gaps chip) and argued down a third time (book-page gap
   line) — the full record is
   `library_catalog/docs/info/completeness-wishlist-relations.md` §1.7. This
   document's §2 dashboard entry is the same idea at larger scale. Do not.
2. **Auto-accept / auto-apply research findings.** The 798/798 acceptance
   record tempts it, but the accept tap costs seconds while the failure it
   guards against is measured twice — *Firefight* and *Unsouled* both returned a
   different book scoring **1.00 on title and 1.00 on author**. Removing the
   only human glance saves nothing measurable and re-opens a measured hole.
3. **Bulk author auto-merge.** Every merge moves `work_key`, the join to 860
   reviews. One at a time, behind the audit ceremony, with the report from
   §1.4 as the worklist — never a sweep.
4. **Shelf-photo splitting for books.** `PLATFORM.md` §7 already says measure
   first; the books true-spine-read corpus is **n=6** (one 7-spine job). Nothing
   to design against yet.
5. **Merging catalog databases, or moving game ratings to Firestore.**
   `PLATFORM.md` §6 refuses the merge with reasons that still hold; the ratings
   table is empty, so there is also nothing to move.
6. **Serper/search-API swap.** Already deprioritised in `PLATFORM.md` §7 — its
   value was killing a slow barcode rung that free ISBN lookups already killed.
7. **An ISBN field in the research queue.** The strongest refusal in
   `library_catalog/docs/info/research-and-gaps.md` §2: a model asked for an
   ISBN returns a checksum-valid one for a printing nobody owns. §1.2's scan
   flow is the only honest ISBN source.
8. **Stamping `cover_status='ok'` in bulk.** 296 works are NULL = *nobody
   looked*. Writing `ok` without looking is precisely what migration 0040 and
   the covers doc refuse; the swap UI fills it organically, one look at a time.

---

## 6. Where the evidence came from

Read-only `wrangler d1 execute … --remote --json` against both production
databases, 2026-08-13 morning: field-coverage one-rows, cover host census,
`research_finding` review states, same-format multi-edition works, author
LIKE-sweeps, per-day `work.created_at` counts, games table census (`play`,
`user_item`, `sleeve_requirement`, `scan_job`, `research_finding`). Code claims
were verified by grep against the working trees the same morning (the missing
aggregate guard, the missing `play`/`sleeve_requirement` write paths,
`catalog-add.ts`'s unconditional copy write).

## 7. Not assessed, and why

- **Firestore contents** (review counts per person, club activity): no service
  account is held on this machine by deliberate policy; figures quoted (860/870)
  are from repo docs, not live reads.
- **Whether works 163/203's twin hardcovers are both real printings**: needs the
  shelf, not a query. Listed under §1.2 rather than "fixed".
- **Games ratings UI reachability**: the write path exists in code; no browser
  was driven to confirm the control is actually offered. §4.3's "watch" hedges
  on this.
- **R2 cache rules for `bookcovers.heygabi.ai`**: the Cloudflare dashboard was
  not opened; the covers doc recommends a 1-year edge TTL and it is unverified
  whether that was ever applied.
- **`scan_job.enriched` blob completeness** (both catalogs) for the history
  view: rows counted (32 library / 30 games), blobs not sampled.
- **Audiobook catalog beyond its docs**: pipeline-fed and healthy by its own
  work log; its gitignored `docs/TODO.md` was read locally, not re-verified
  against the live site.
