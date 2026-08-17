# Ebook Split — Information Reference (design)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-16** — every number in §1 was measured that day
> (remote D1 SELECTs, a read-only Firestore REST sweep of the live `reviews`
> collection, and file reads of both repos). §"Not verified" lists what was
> not. This is a DESIGN DOC: nothing below is built, and no code, data, or
> other doc was changed alongside it.
>
> **The decision it designs** (owner, 2026-08-16, recorded in
> `docs/TODO.md` §"Ebooks may want to be their OWN site"):
> *"we might need to now make ebooks its own site because we all share ebooks
> like we do audiobooks but physical books obviously belong to someone."*
> **Ebooks join audiobooks.** The split that matters is the OWNERSHIP MODEL,
> not the medium: audiobooks and ebooks are a shared household pool;
> physical books and games belong to someone.

---

## 0. The design in one paragraph

The ebooks surface moves to the shared-pool side: **the audiobook site grows
an ebooks page rendered from `site/ebooks.json`, which its own pipeline
already builds and publishes** (sync step 1b — the producer does not change).
The pipeline's index pusher additionally pushes ebook rows so the estate
index knows the shared pool holds them. `library_catalog` then demotes its
ebook-derived rows from `work`/`edition` truth to a **holding-style cache**
— the exact shape migration 0010 (`audiobook_holding`) already established
for "the household has this in a shared-pool format" — and finally retires
its ebook ingest (unset `EBOOK_INGEST_TOKEN`; the route 404s by design) and
prunes the file-sourced editions with its existing `--prune` tooling.
Firestore reviews are never touched: they key on `workKey`
(title|author), which is catalog-independent, and every review currently
matching an ebook work is audiobook-sourced. Six phases, each shippable and
reversible alone, shadow-first where anything is user-visible.

---

## 1. What is true today (all measured 2026-08-16)

| Fact | Value | How measured |
|---|---|---|
| Ebook files in the library | **168** (`site/ebooks.json` `count`, generated 2026-08-16T23:00:40Z) | file read; root is `C:/Users/nbasl/OpenAudible/books` — the SAME tree `sync_to_drive.py` mirrors |
| Ebook editions in library D1 | **127** `ebook_epub` — 126 `source='file'`, 1 `'manual'` | remote D1 SELECT |
| Works carrying an ebook edition | **126** of 351 total works | remote D1 SELECT |
| **Ebook-ONLY works** (no non-ebook edition, no copy) | **94** | remote D1 SELECT |
| Works with ebook + physical presence | 32 (= 126 − 94) | arithmetic on the above |
| Live review docs (Firestore `reviews`) | **878**, of which **870** carry `workKey` | REST list, world-readable rules |
| Review docs whose `workKey` matches an ebook-carrying work | **63** docs across **26** works | REST sweep ∩ D1 keys |
| Review docs matching an ebook-ONLY work | **7** docs across **5** works (All the Skills ×3; Captain, Engineer, Knight, Uncapped ×1 each) | same |
| `user_book` (read state) rows on ebook-only works | **1** — "All the Skills", `read_state='read'`, `read_state_how='rating'` (derived, re-derivable) | remote D1 SELECT |
| `audiobook_holding` rows (the 0010 precedent) | 92 | remote D1 SELECT |
| What the library pushes to the estate index per work | `format: 'book'` — **hardcoded for all 351 works, ebooks included** | `packages/db/src/index-projection.ts:107` |
| What the audiobook pusher pushes | `site/catalog.csv` rows only — **no ebooks** | `app/index_push.py` read |
| Ebook ingest kill switch | unset `EBOOK_INGEST_TOKEN` ⇒ the whole route **404s** | `apps/worker/src/routes/ingest.ts` middleware |
| Index row counts | game 836 / library 346 / audiobook 1077 | **NOT re-measured** — quoted from `index-worker-design.md` status line, 2026-08-14 |

Two facts worth stating out loud because the plan leans on them:

1. **Every review matching an ebook work is an audiobook review.** The
   2026-08-12 backfill stamped all 870 keyed docs `source: 'audio'`
   (`library_catalog/docs/info/identity-and-reviews.md` §7.6), and the 5
   reviewed ebook-only works are titles the household holds on audio. No
   review anywhere depends on a library D1 row existing — `workKey` is
   derived from title|author, not from any row id.
2. **The library's ebook rows never became ownership claims.** The ingest
   route and importer both refuse to create `copy` rows on principle ("a
   file existing is good evidence of a licence, but 'we own this' is a claim
   about us"). So the one thing the physical catalog is FOR — whose copy,
   which shelf — was never engaged for ebooks. They are pool inventory
   parked in a per-person ledger.

### 1.1 This supersedes HEYGABI_LAYOUT.md §0's ebook rows

`docs/HEYGABI_LAYOUT.md` §0 (2026-08-09) decided "library.heygabi.ai — one
host, print *and* ebook" and "ebooks.heygabi.ai is not an app; option (c): a
view over the library". Its one-line reason was that `edition.format` makes
"I own this in audio and paperback but not ebook" a query. **Measured
reality undercuts the premise:** ebooks never got `copy` rows, so the
ownership query the schema bought never actually engages for them — and the
owner's 2026-08-16 insight replaces the frame entirely (ownership model, not
medium). A later session should add a supersede pointer to that section;
this design deliberately touches no other file.

---

## 2. Q1 — Where ebooks live after the split

**Recommendation: (A) the audiobook site grows an ebooks surface**, at
`audiobooks.heygabi.ai/ebooks.html` (dev lane first: `/dev/ebooks.html`),
rendered from the `ebooks.json` the site already publishes alongside its
other JSONs (`sync_to_drive.py` upload list includes it).

**Why A:** the audiobook site *is* the shared-pool surface, and its whole
trust model already matches what ebooks need — household-shared, no
per-person ownership, presentation-only identity, the shared world-readable
review store. The data is already there: the site origin already serves the
manifest, `/status` already reports `ebookManifestAt`/`ebookCount`, and the
pipeline that walks the ebook tree three times a day is this site's own
pipeline. The build cost is one template page (⚠️ in
`app/web/templates/` — `site/*.html` is generated and rebuilds wipe edits)
plus a client-side fetch, and the two-lane deploy gives shadow-first for
free.

**The alternatives, costed:**

| Option | What it costs | Verdict |
|---|---|---|
| **(B) a third shared-pool site** (`ebooks.heygabi.ai`, own Worker + D1) | A fourth deployable: new D1, new auth origin (Firebase authorised-domain addition), new index source, new deploy lane, new runbooks — for 168 files that already have a pipeline, a manifest, and a mirror. Buys a hostname and an ongoing operational surface. | Rejected — same reasoning HEYGABI_LAYOUT §5 used against forking ("the cheap moment to fork, and forking is still wrong"). A cosmetic `ebooks.heygabi.ai` → `/ebooks.html` 301 remains available later, never as an auth origin. |
| **(C) a view over the shared index only** | The index cannot express it yet — the library pushes `format:'book'` for every work (measured), so ebooks are invisible *as ebooks*; fixing that is the same push change A's phase 3 needs anyway. Index reads are estate-members-gated, so a family-facing browse would force a gate redesign; and `detail_url` has nowhere to point without a surface. | Not actually an alternative — C is A's phase 3 without A's phase 1. The index gets its ebook rows either way. |

---

## 3. Q2 — The existing library rows: **demote to holdings, then prune**

Not move (there is no row-level move between D1s worth doing), not mirror
(two truths drift — this estate's measured lesson), not tombstone-in-place
(the `work` table has no `stale_at`, and 94 zombie works would haunt every
count and filter). **Leave-and-repoint, made concrete:**

1. **The 32 works with physical presence keep their `work` rows** —
   they are genuinely the library's. Their 32-ish ebook editions are
   replaced by holding rows (below), then pruned.
2. **The 94 ebook-only works are deleted** in the final phase, after
   export. They exist only because the importer had nowhere else to put
   pool inventory. Before deletion, their rows (work + edition, with keys
   and source paths) are exported to a dated JSON committed to the repo —
   that file is the reversal path, and re-import via the same ingest route
   is the mechanism.
3. **"The household has this as an ebook" stays visible in the library UI**
   the way "we own this on audio" already is: a holding cache. Migration
   0010's header is practically a spec for this — *"an audiobook is not a
   printing of a work we hold — it is a different object, in a different
   catalog, that happens to be the same book"*. After the split that
   sentence is true of ebooks verbatim. Either widen
   `audiobook_holding.source`'s CHECK (the column comment anticipates a
   second source) or mint a sibling `ebook_holding`; the migration decides,
   with the same rules: cache never truth, one backfill script is the only
   writer, `stale_at` marks rather than deletes.

**Reviews:** untouched, by construction. Firestore is never written in this
plan. The 63 matching docs keep working on the audiobook site exactly as
today; the library keeps rendering reviews for its remaining works via the
same `workKey` join. The 7 docs on the 94 deleted works lose only their
library-side rendering — their books' real home (the audiobook site, and
later the ebooks page) still serves them. **Read state:** the single
affected `user_book` row is `'rating'`-derived; the §7.7 sweep re-derives it
if its work survives, and if the work is deleted there is nothing left for
a read state to be about. Zero `'human'`-asserted rows are affected
(measured — that is the number that had to be zero for deletion to be
allowed; if it is nonzero at execution time, re-measure and preserve those
works).

---

## 4. Q3 — Ingest ownership: **step 1b stays the producer; the consumer moves home**

The manifest is the contract and nothing about its production changes:
`build_ebook_manifest.py`, wired as sync step 1b, unconditional, reporting
`ebookManifestAt` to `/status`. Its own header already argues why ("one
pipeline, one source of data" — the consumer reads, never re-derives).

What changes is who consumes it:

| Consumer | Today | After |
|---|---|---|
| `library_catalog/scripts/import-ebooks.mjs` → `POST /api/ingest/ebook` | the only consumer | **retired** (phase 5): stop running the importer, unset `EBOOK_INGEST_TOKEN` so the route 404s. The route code can stay — it is the reversal mechanism and the re-import path for the exported rows |
| The audiobook site's ebooks page | — | reads `ebooks.json` client-side (phase 1) — same-repo, zero new plumbing |
| `app/index_push.py` | pushes catalog.csv only | also projects ebook rows from `ebooks.json` (phase 3) |
| library holding backfill | — | one script, the only writer of the holding rows (phase 4) |

The manifest's `source` field (`opf` vs `filename`) keeps its meaning:
consumers must go on treating `filename` rows as provisional, exactly as the
importer does today.

## 5. Q4 — Shelf server: **almost nothing; one line in the runbook**

The ebooks already ride the mirror: `ebooks.json`'s root **is** the tree
`sync_to_drive.py` mirrors to Drive, which rclone pulls to
`/srv/shelf/library`. So the shelf server will hold every ebook file on day
one with zero extra configuration, and §8's phase-2 push spec
(`sync_to_server.py`, same-tree rclone over the tailnet) is **unchanged** —
same walk, same failure semantics, no new lane, no new secret.

Runbook (`SHELF_SERVER.md`) changes, when next edited (not here):

- §3 scan-verification line: the library scan will see epub/pdf files
  beside the m4bs; Audiobookshelf treats ebook files as supplementary
  ebooks / e-reader items (**unverified claim** — confirm against the ABS
  version actually deployed during §6's checks, and note the result).
- §6 optionally gains one checkbox: an epub opens or downloads through
  `shelf.heygabi.ai` from a family account.
- Later, the ebooks page MAY deep-link `shelf.heygabi.ai/item/<id>` per
  book — that is a post-§6 nicety, not part of this design.

---

## 6. Q5 — The phased plan

Ordering constraints, stated once: **3 before 5** (the index must learn
ebooks from the pool side before the library rows that currently represent
them leave, or estate search forgets ebooks exist) and **4 before 5**
(holding rows exist before the editions they replace are pruned). 1–2 are
independent of 3–5.

| # | Phase | Ship | Verify | Reverse |
|---|---|---|---|---|
| 0 | **Measure + record** | this document | §1's queries re-runnable as written | n/a — read-only |
| 1 | **Ebooks page, dev lane (shadow)** — new template in `app/web/templates/`, client-fetches `/ebooks.json`; shows title/author/format/size and the `opf`/`filename` provenance; no reviews UI yet | push main → `/dev/ebooks.html` | page count == manifest `count` (168 at design time); `filename` rows visibly provisional; prod untouched | delete the template; never promoted |
| 2 | **Promote to prod** after owner review (explicit "prod" ask — the standing rule) | promote.yml | live URL renders; count matches; `/status` unchanged | `prod-*` tag rollback, the existing lane mechanism |
| 3 | **Index learns ebooks** — `app/index_push.py` appends rows projected from `ebooks.json` to the audiobook snapshot: `format:'ebook'`, `source_id` path-derived, `detail_url` → the ebooks page; `filename`-sourced rows either withheld or pushed title-only (the index's empty-fold guard already refuses degenerate keys honestly) | pipeline change only | `/api/health` audiobook rows ≈ 1077 + pushed ebook count; `/api/lookup` on an ebook-only title returns an `ebook` row; dry-run flag first (`--dry-run` exists) | revert the pusher — snapshot-replace heals wholesale on the next push |
| 4 | **Library holdings (shadow)** — migration (widen `audiobook_holding.source` CHECK or sibling table) + backfill script reading `ebooks.json`; UI grows the "household has this as ebook" chip beside the audio chip. Editions still present: **both representations live side by side** | migrate → deploy, the standing order | holding rows == 126 works; chip agrees with today's edition-derived display for every work (that agreement is the shadow verification); zero writes anywhere else | drop the rows (cache — one script rebuilds), hide the chip |
| 5 | **Retire ingest + prune** — stop running `import-ebooks.mjs`; unset `EBOOK_INGEST_TOKEN` (route 404s); export the 94 ebook-only works + all 127 ebook editions to a dated JSON committed to `library_catalog`; prune `source='file'` ebook editions via the existing `--prune` (⚠️ deleting all of them exceeds its 20% guard **by design** — `--force-prune` after a person reads the list, which is exactly the ceremony the guard exists to force); delete the 94 works | scripts + one secret unset | works 351 → 257; ebook editions 0; Firestore doc count unchanged (878 at design time — **never touched**); audiobook-site reviews render as before; the 5 formerly-reviewed titles still show reviews on the audiobook site; re-measure `user_book` for `'human'` rows before deleting (must be 0) | re-set the token; re-import the exported JSON through the same ingest route (idempotent on work and edition by construction) |
| 6 | **(Deferred, out of scope)** reviews/TBR on the ebooks surface — requires computing `workKey` on the shared-pool side (a JS port of the `normaliseTitle`/`workKeyFor` fold, which is a persisted-key implementation and therefore a migration-grade decision, not an edit) | — | — | — |

## 7. Q6 — What explicitly does NOT change

- **The Drive pipe** — owner order 2026-08-15: permanent until he says
  otherwise. No pipeline step is touched except the additive pusher change
  in phase 3.
- **Every pipeline step** — step 0/1/1a/1b/… run exactly as today; step 1b
  remains the manifest's sole producer, unconditional.
- **The promote lanes** — main → `/dev/`, prod only via promote.yml on an
  explicit "prod" ask; phase 2 uses the lane, it does not alter it.
- **Firestore** — no rules deploy, no document writes, no schema change.
  `reviews` remains the one shared store; `bookIdFromTitle` and `workKeyFor`
  remain the one implementation each, unchanged.
- **The friend's catalog** — physical-only "sort her books". Her instance
  never sets `EBOOK_INGEST_TOKEN`, so her ingest surface is a 404 today and
  stays one; no phase touches her ingest story, and phase 5 makes the
  shared codebase's ebook lane strictly smaller, not larger.
- **OpenAudible acquisition** and `catalog.csv` — untouched.

## 8. The TBR seam (how it would key — not designed here)

`docs/TODO.md`'s TBR entry names the same seam. After this split, a
spanning TBR keys **on `workKey` (title|author — the index's `work_fold`
inputs), never on any catalog's row id**, and lives in ONE shared store —
the Firestore project beside `reviews` is the working precedent (870 docs
already carry the key; the read-state sweep already joins on it). "I want to
read *Wintersteel*" is then one document that the pool site (audio + ebook)
and the shelves site both read, and finishing it in any format clears it
everywhere. The ebook split helps precisely because it leaves only two
surfaces to span — the shared pool and the per-person shelves — instead of
three. Whether TBR/wishlist/read collapse into one per-person state machine
is the open question the TODO already poses; nothing here forecloses it.

## 9. Not verified (stated per the estate rule)

- **Index row counts** (836/346/1077) — quoted from the 2026-08-14 status
  line, not re-measured against `/api/health`.
- **That `audiobooks.heygabi.ai/ebooks.json` serves live** — the upload
  list in `sync_to_drive.py` includes it (code read), but the URL was not
  fetched.
- **That each of the 5 reviewed ebook-only works exists in `catalog.csv`** —
  inferred from the universal `source:'audio'` stamping (§7.6 of the
  identity doc) and recognisable audiobook titles; not row-checked.
- **Audiobookshelf's ebook handling** — from general knowledge, not
  exercised; §5 marks it for verification during the shelf build.
- **The 8 review docs without `workKey`** (878 − 870) — presumed
  post-backfill audiobook-site writes; not inspected individually.
