# The Combined Site — System Design

> **Audience:** Claude sessions. **Status:** PLANNING — nothing built.
> Last verified: **2026-08-07**. Measurements in §1 were taken that day against
> the live repos. Everything describing the target state is proposed, not built.
> Diagrams: [`diagrams/architecture.md`](diagrams/architecture.md).

Three catalogs, presented as one site, without merging any of them.

---

## 1. Where things actually stand

Measured 2026-08-07, not estimated.

| | Audiobooks | Board games | Books & ebooks |
|---|---|---|---|
| Repo | `bookbuddy/audiobook_catalog` | `boardbuddy/Board_Game_Catalog` | — |
| Host | GitHub Pages | Cloudflare Worker | — |
| Data | 1,073 books, `catalog.csv` | 775 items, D1 | — |
| Auth | Firebase Auth (Google) | Cloudflare Access (Google) | — |
| Dynamic | Firestore, 18 collections, ~9,600 lines JS | — | — |
| Added by | Python pipeline, 3×/day | **by hand** | **by hand** |

**The problem, in one number: `.git` is 377 MB at 378 commits.** GitHub Pages'
soft repo ceiling is ~1 GB. `site/covers/` holds 1,841 files totalling 242 MB
and is *regenerated unconditionally on every build*, so history grows with each
rebuild whether or not a cover changed. The August cleanup (768 orphans,
236 → 164 MB) bought time and it is already back to 242 MB.

This was foreseen. The standing "stay on GitHub Pages" rule from 2026-07-06
named this exact trigger — *"Pages artifact size limits (~1 GB soft ceiling;
covers already ~150 MB+)"*. The trigger has fired.

---

## 2. The four decisions this design rests on

### 2.1 Firestore and Google SSO do not change

Owner's words: *"What I'm not open to is changing Firestore and Google SSO."*

This is the decision that makes everything else cheap. The expensive half of any
migration was always rewriting 18 Firestore collections and ~9,600 lines of
hand-written Firebase-bound JS — clubs, reviews, identity, leaderboard, warning
requests. Ruling it out reduces the move to the **serving layer**, which is small.

Nothing in this document touches `site/*.js`, `firestore.rules`, or the
Firestore data model.

### 2.2 Each catalog keeps its own database

Three apps, three lifecycles, three storage systems. A shared **index** holds a
projection for cross-cutting queries. Nothing is merged.

The Board Game Catalog's `DESIGN.md` §3 already argues this for its own D1:
separate Worker and separate database *"so the projects can't collide on schema,
secrets, or deploys."* That reasoning is unchanged by adding a third catalog.

### 2.3 The index normalises once, on write

An earlier version of this plan had each catalog export a static JSON file that
the public site would join on `normalise(title)|normalise(primary_author)`. That
requires the same normalisation implemented identically in Python and two
TypeScript codebases.

**This repo has already shipped that bug.** `audit_site.resolve_author_link`
(Python) and `_resolveAuthorFolder` (JS) both split author strings on `[;,/&]`
and ` and `, and when they drifted a promote failed *silently* — no prod deploy,
no Discord ping, no error. The audiobook docs record it as a standing warning:
*"Keep the Python and JS in sync."*

Three implementations is worse than two. So the key is computed **once, by the
index, on write**, and the public site only ever compares strings it was handed.

### 2.4 Audiobooks are read-only because they are pipeline-fed

Not a temporary state. Audiobooks arrive automatically and need no editor. Games
and books are added by hand — which is precisely what the scanning features
exist for. The asymmetry is why there are two editor apps and one public site,
rather than three symmetric apps.

---

## 3. Target architecture

See [`diagrams/architecture.md`](diagrams/architecture.md) §2 for the diagram.

| Host | What | Who |
|---|---|---|
| `<domain>` | Cloudflare Pages — public read view of all three | anyone |
| `games.<domain>` | Worker + D1 — board games, manual add, scanning | owner |
| `library.<domain>` | Worker + D1 — books & ebooks, manual add, scanning | owner |
| `index.<domain>` | Worker + D1 — cross-format index | written by all three |
| `covers.<domain>` | R2 — 242 MB of cover art, out of git | anyone |
| — | Firestore — clubs, reviews, profiles | **unchanged** |

### 3.1 Cloudflare Pages is a near drop-in

It builds from a git branch, so the two-lane deploy survives essentially intact:
`prod` branch → production, `main` → preview. `promote.yml`, the guard checks
and the `prod-*` rollback tags all keep working. The Python pipeline still
builds `site/`, still commits, still pushes.

This is the piece that looked like it would need heavy rewiring and does not.

### 3.2 Covers move to R2

242 MB against a 10 GB free tier, with free egress.

The pipeline already has exactly the right mechanism to reuse:
`scripts/upload_manifest.json` diffs by **relative path, not mtime**, which is
how the Drive upload avoids re-sending unchanged files and why re-tagging a file
does not trigger a re-upload. Same pattern, new destination.

⚠️ **Do not rewrite git history to reclaim the 377 MB.** `git filter-repo` would
shrink it to roughly 50 MB but rewrites every hash, breaking the `prod` branch
and every `prod-*` rollback tag — the one genuinely expensive state in that
system. Simply stop committing new covers; history stops growing and stays well
under the ceiling.

⚠️ **`site/` itself still stays in git.** The existing rule — never gitignore
`site/`, a promote guard checks for exactly that after it once caused a full
outage — remains correct. Only `site/covers/` leaves, and only once R2 serves it.

### 3.3 The public site's rendering does not change

`site/index.html` is 42,115 generated lines with data embedded, and it already
performs client-side Firestore fetches. Cross-format information arrives as
**one more fetch** to `index.<domain>` — the same pattern the page already uses.
No data-layer rewrite.

---

## 4. Auth

Both editor Workers move from Cloudflare Access to verifying **Firebase ID
tokens**, so one Google sign-in covers the whole site.

Firebase ID tokens are RS256 JWTs issued by Google
(`iss: https://securetoken.google.com/<project-id>`, `aud: <project-id>`),
verifiable in a Worker against Google's published certificate endpoint, cacheable
in KV.

**What changes:** the token source and verification in
`apps/worker/src/middleware/auth.ts`.

**What survives untouched:** the `app_user` table, the `owner` / `rater` /
`pending` roles, the capability model, and the first-sign-in-claims-ownership
bootstrap. `DESIGN.md` §3.1's reasoning still holds — *Access authenticates; the
app authorizes* becomes *Firebase authenticates; the app authorizes*, and the
guest list stays on a settings page rather than in a Cloudflare policy.

### 4.1 The cost, accepted knowingly

Today Access blocks unauthenticated traffic **at the edge, before any code
runs**. `DESIGN.md` §9 leans on this: a leaked URL currently costs nothing.
Removing it makes the Worker the only gate.

Required before this ships:

- [ ] Audit every route for deny-by-default. `requireCapability` is applied
      per-route today; confirm no route is unguarded.
- [ ] Re-read the dev bypass in `middleware/auth.ts`
      (`ENVIRONMENT !== 'production'` + `DEV_EMAIL`) — it becomes the sole
      difference between dev and prod.
- [ ] Add rate limiting on the unauthenticated surface.

The *authorization* posture is unchanged: a signed-in stranger still lands as
`pending` and sees a request screen, not the collection.

---

## 5. The index

A thin Worker over a D1 database. Three writers, one reader.

One table, one row per catalogued thing:

| Column | Notes |
|---|---|
| `source` | `audiobook` / `game` / `library` |
| `source_id` | the id in the owning catalog |
| `match_key` | `normalise(title)\|normalise(primary_author)` — **computed here, on write** |
| `title`, `author`, `series`, `series_index` | display fields |
| `format` | `audiobook` / `hardcover` / `paperback` / `ebook_epub` / `ebook_kindle` / … |
| `cover_url`, `detail_url` | where to show and where to send the visitor |

"Do I own this in any format?" is `SELECT … WHERE match_key = ?` — one indexed
query across all three catalogs.

### 5.1 Writes are pushes, never pulls

Each catalog pushes on change: the pipeline after a rebuild, the two Workers
from their existing cron. No inbound request means Access-style edge protection
on the sources is irrelevant, and the index cannot stall a catalog's own deploy.

### 5.2 The projection is default-deny

**Write the allowed fields as an explicit array in code.** Never `SELECT *` with
exclusions — the exclusion form is the one that leaks when a column is added.

| Exported | Never exported |
|---|---|
| title, author, series, kind, year, publisher, cover, formats owned | purchase prices, `lent_to`, condition notes, per-person ratings, email addresses, ASINs, read-state, acquisition dates |

`apps/worker/src/routes/export.ts` already exists in the Board Game Catalog but
is **the wrong wheel to reuse** — it is a full backup gated on `editCatalog`
that joins `user_item` ratings to email addresses. The public projection is a
different artifact.

### 5.3 The keys must agree

Three exporters still compute `match_key`'s inputs, even though only the index
normalises. Pin them with a **shared fixture file** of ~50 awkward author
strings — `Broccoli Lion, Matthew Jackson - Translator` and friends — that all
three must reduce identically, checked in each repo's CI.

This is the direct answer to the drift bug in §2.3, and it is cheap.

---

## 6. What this does *not* do

Stated so nobody re-opens them expecting a win:

| Not doing | Why |
|---|---|
| Merging the three databases | Different lifecycles. Catalog facts get overwritten by re-sync; collection facts are yours forever |
| Moving Firestore to D1 | Explicitly ruled out by the owner |
| Making the audiobook site dynamic | 42,115 generated lines render fine; one extra fetch is enough |
| Unifying the three repos | Three deploy lanes that work. The index is the only coupling |
| Rewriting git history | Breaks `prod` and every rollback tag |

**Migration stays optional and incremental.** With one queryable surface in
place, individual pieces could move later on their own merits — or never. That
optionality is worth more than any big-bang.

---

## 7. Sequencing

Diagram: [`diagrams/architecture.md`](diagrams/architecture.md) §5.

### Stage 1 — Finish the Board Game Catalog · **blocks the fork**

Owner's instruction: *"let's finish the board game catalog and all its bugs so
we don't reinvent wheels."* Current state is healthy — 775 items, clean tree,
everything deployed, no blank covers, details queue empty.

Only three items are shared wheels:

| Item | Ports? | Why |
|---|---|---|
| Re-measure the two thresholds (`matchExistingTitle`, the 0.7 spine floor) | ✅ **Critical** | Books need a (title, author) key regardless — titles collide across authors constantly, and Kindle rows carry ASINs not ISBNs so they can only be matched by name. `BOSS MONSTER` → `Super Boss Monster 2` is the exact failure mode. Fix once, or fix twice differently |
| Scan history view | ✅ | Pure scan-queue infrastructure. `scan_job.enriched`, the mode/timestamp columns, the paging `listScanJobs` will need — all ports |
| Splitting a shelf photograph | ⚠️ Re-argue | TODO says measure first, and games evidence was "vision read all 73 titles fine". Book spines are narrower and denser, so the accuracy case is stronger. Don't build for games; re-measure for books |
| Component backfill · Dice Throne playmats · Excursion Tiles year · HELLDIVERS rename | ❌ | Board-game data judgement calls |
| Serper search-API swap | ❌ Deprioritise | Its value was killing the 74–137s barcode rung. Free ISBN lookups mean that rung barely fires |

### Stage 2 — Platform · **independent, can start today**

1. Register a domain, point it at Cloudflare (~$10/yr)
2. Move the audiobook site to Cloudflare Pages, keeping the two-lane branches
3. Covers to R2; pipeline uploads changed covers instead of committing them
4. Stand up the index Worker and wire the **board game catalog** to it first

Doing (4) against an existing catalog de-risks the pattern before there are two
consumers of it.

### Stage 3 — `library_catalog`

Phase 0 verification, then phases 1–5. See
[`LIBRARY_CATALOG.md`](LIBRARY_CATALOG.md).

### Stage 4 — Combined

Shared theme, cross-format view, one nav.

---

## 8. Open questions

| # | Question | Blocks |
|---|---|---|
| 1 | Which domain? | Stage 2 |
| 2 | Does the public site get its own repo, or is it the audiobook repo re-pointed? | Stage 2 step 2 |
| 3 | Do games and books get public *browse*, or only the cross-format signal? §5.2's field list assumes browse | Stage 2 step 4 |
| 4 | Is the rebuild-to-fix-metadata friction actually a problem worth solving? If so it changes the audiobook design independently of any of this | — |
