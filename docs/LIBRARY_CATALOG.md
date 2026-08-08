# library_catalog — System Design

> **Audience:** Claude sessions. **Status:** PLANNING — not built, and blocked on
> finishing the Board Game Catalog.
> Last verified: **2026-08-07**. Figures about the *existing* repos were measured
> that day. ⚠️ **Everything about external book APIs below is knowledge, not
> measurement** — §8 phase 0 exists to replace it with live calls before anything
> is built on it.

A private catalog of owned **physical books and ebooks**, built by scanning them.

> **The name.** Not "physical catalog" — ebooks are in scope. `library_catalog`
> sits beside `audiobook_catalog`, which is explicitly the audio one.

---

## 1. The headline: barcodes invert

The Board Game Catalog's central, hard-won finding is that **barcodes are a weak
primitive**. Measured 2026-08-05: GameUPC alone resolved 2 of 4 real games, and
only reached 4/4 after adding a second free rung. Kickstarter and
small-publisher editions frequently have no retail barcode anywhere.

**For books that reverses completely.** Every trade book published since roughly
2007 carries an ISBN-13 printed as a Bookland EAN-13, and the free databases
indexing ISBNs are far deeper than GameUPC.

That changes the build order. In board games, barcode was phase 5 and BGG-first
was the strategy. Here **barcode-first is the strategy**, and vision is the
fallback for pre-ISBN books, ebooks, and bulk shelf intake.

| | Board games | Books |
|---|---|---|
| Barcode coverage | patchy | near-universal since ~2007 |
| Free identity database | GameUPC (crowdsourced) | Open Library, Google Books |
| Cost of a full catalog | $50–300 of research | pennies |
| Where the LLM earns its keep | almost everywhere | the ~5% of limited editions |

---

## 2. What ports from the Board Game Catalog

| From `Board_Game_Catalog` | Verdict | Why |
|---|---|---|
| `apps/web/src/lib/camera.ts`, `scanner.ts` | **Verbatim** | Every line is a WebKit constraint, not a preference. `BarcodeDetector` is still absent on iOS; the ZXing-wasm ponyfill, `playsinline`, secure-context and the silent 16.7M px² canvas limit all apply identically |
| `docs/info/ios-camera.md` | **Copy the doc** | Saves re-learning that `@vitejs/plugin-basic-ssl` is never trusted on iOS 18+, and the cloudflared tunnel trick |
| `scan_job` queue, `scan-ownership.ts`, `withFreshView` | **Wholesale** | *Store the decision, compute the fact* — the hardest-won lesson in either repo, and it matters **more** here because every scan reconciles against physical + ebook + 1,073 audiobooks |
| Ladder architecture (`packages/barcode/src/resolve.ts`) | **Shape, not rungs** | One answer shape, per-rung try/catch with a `trace`, degrade-never-break, nothing-writes-without-a-human |
| `PHOTO_LONG_EDGE` 1500 / `SHELF_LONG_EDGE` 2400 / `PHOTO_QUALITY` 0.85 | **The numbers** | Same model, same 28×28-patch billing |
| `packages/research` incl. **`tiers.ts`** | **Keep** — see §5 | An earlier draft said delete it. That was wrong |
| `CLAUDE.md`'s Windows section | **Copy** | `git commit -F` never `-m`; no heredocs in PowerShell; the UTF-8 corruption sweep. These bit that project repeatedly |
| `matchIndexedTitle` — 60% containment, title only | ⚠️ **Must change** | Unsafe for books. See §3 |
| `classifyShelfResults` — colon prefix → base game | ⚠️ **Rewrite as series detection** | "Mistborn: The Final Empire" is a *volume*, not an expansion. `audiobook_catalog` already models series properly (`series`, `series_index_sort`, `series_index_display`) — reuse that shape |
| `SHELF_SYSTEM` prompt | ⚠️ **Rewrite** | Book spines are rotated 90° and carry author and publisher colophon alongside the title. It must return **title and author** per spine |
| `packages/bgg`, GameUPC, UPCitemdb | ❌ Replace | → Open Library, Google Books |
| Sleeve requirements, completeness | ❌ Delete | Board-game-only |

---

## 3. The matcher is the load-bearing change

`matchIndexedTitle` matches on a normalised **title alone**, accepting
containment when the shorter string is ≥60% of the longer. Two reasons that
cannot survive contact with books:

1. **Titles collide across authors constantly.** Board games have near-unique
   names; books do not.
2. **Kindle rows have no ISBN.** Kindle-native titles carry `B0…` ASINs that no
   ISBN database knows, so they can *only* reach a work by name.

The Board Game Catalog's own TODO already flags the weakness — on 86 items it
matched 44 of 73 shelf titles, but `BOSS MONSTER` → `Super Boss Monster 2` is
"the kind of fragment match that files a genuinely new game under *already
yours*, where it is lost rather than merely wrong."

**Therefore:** re-measure and fix it *in the Board Game Catalog first*, so this
fork inherits a correct matcher. That is the single strongest reason to finish
that project before starting this one.

⚠️ **Do not write a second similarity function.** `isConfidentMatch` carries the
0.7 spine floor and the fragment rule; the three wrong-game matches that project
shipped — Brink, Iliad, Moon — all came from that kind of drift.

---

## 4. Book-specific traps

Cheap to get right up front, expensive later. The equivalents of *"never strip
the publisher name."*

| # | Trap | Handling |
|---|---|---|
| 1 | **Books usually carry two barcodes** — the Bookland EAN-13 plus a 5-digit price add-on, and mass-market paperbacks often a separate retail UPC | Accept only 978/979-prefixed EAN-13 with a valid checksum. On anything else **keep scanning**, do not look it up |
| 2 | **ISBN-10 on pre-2007 books** | Convert at the edge — prefix 978, recompute the check digit — so nothing downstream sees two formats |
| 3 | **One work, many ISBNs** — hardcover, paperback, book-club, reissue | ISBN belongs on `edition`, **never** on `work`. Open Library's own work↔edition graph maps straight onto this |
| 4 | **No barcode at all** — pre-1970, library discards, every ebook | Vision is a first-class path, not a fallback |
| 5 | **ASIN ≠ ISBN** | `edition` needs a nullable `asin` alongside nullable `isbn13` |

---

## 5. The research pipeline stays

An earlier draft of this design recommended deleting `packages/research/tiers.ts`
because "Open Library gives it away free." **That was wrong**, and the owner
corrected it: the scraper needs to reach crowdfunded sources the way the game one
did.

**Limited editions are to books what Kickstarter exclusives are to board games.**
Open Library will tell you "The Way of Kings, Tor, 2010". It will not tell you
yours is the Broken Binding signed sprayed-edge run of 1,000 with an exclusive
cover. That is exactly the "no single database has it" gap the tiered pipeline
was built for.

The `allowed_domains` mechanism ports unchanged — it is what makes tier ordering
*real* rather than a prompt preference. Only the domain lists change:

| Tier | Board games | Books |
|---|---|---|
| 1 · OFFICIAL | publisher domain from BGG | publisher (Tor, Orbit, Gollancz) + the author's own site |
| 2 · CROWDFUNDING & LIMITED | kickstarter, gamefound | kickstarter, backerkit, indiegogo, **thebrokenbinding, illumicrate, fairyloot, subterraneanpress, grimoakpress, goldsborobooks**, and **bookfunnel** |
| 3 · RETAIL | amazon, sleeve vendors | amazon, bookshop.org, **abebooks** (unusually good at distinguishing printings) |

`bookfunnel` is already known to this household — `audiobook_catalog` tracks
BookFunnel-sourced books in `scripts/bookfunnel_books.json` and excludes them
from completeness checks precisely because their metadata is thin. The same
books, in ebook form, are the ones this tier exists to research.

### 5.1 Gate it before you build it

⚠️ Apply `docs/info/cost-reduction.md`'s lesson **first**. Its finding was that
the expensive question is not *"what does this row not know"* but *"what is
worth **buying** for this row"* — and getting that backwards put 616 dice trays
in front of a web-search model at a cost of $8.30.

For 500 trade paperbacks, Open Library is complete and research must never fire.
It fires on the signed, numbered, Kickstarted and BookFunnel-delivered minority.
**Build the gate before the pipeline.**

A LitRPG-heavy library (Dakota Krout, CAL Universe, Murderhobo — all present in
the audiobook catalog) is disproportionately that kind of book, so tier 2's hit
rate should exceed the board game equivalent.

---

## 6. Data model

The Board Game Catalog's shape with one axis renamed. The catalog/collection
split from its `DESIGN.md` §2.1 carries over unchanged and matters just as much:
Open Library facts get overwritten on re-sync; your shelf location and read-state
never do.

```
work     title · author(s) · series · series_index · first_published
  └─ edition   isbn13? · asin? · format · publisher · year · pages · cover
       └─ copy   condition · location · acquired · lent_to · read_state · notes
```

`edition.format` ∈ `hardcover | paperback | mass_market | ebook_epub |
ebook_kindle`. That one column is what makes *"I own this in audio and paperback
but not ebook"* a query rather than a feature.

**Joining to the audiobooks** happens through the index (`PLATFORM.md` §5), on
`normalise(title)|normalise(primary_author)` — `catalog.csv` has no ISBN column,
so that is the only bridge available today. Design `work` with a nullable
`openlibrary_work_id` so the join can be hardened to an identifier later.

⚠️ **Reuse the author-splitting rule, do not rewrite it.** `audiobook_catalog`
splits on `[;,/&]` and ` and ` in two places already, and its docs record that
keeping those in sync was a real, silent bug. A third implementation in a third
language is how that bug returns.

---

## 7. Ebook sources

Three, per the owner. None is a clean API.

| Source | Path | Confidence |
|---|---|---|
| **Kindle / Amazon** | No public API. See §7.1 | ⚠️ Unresolved — phase 0 decides |
| **Loose files on disk / Drive** | Walk for `.epub/.mobi/.azw3/.pdf`; parse OPF Dublin Core (`dc:title`, `dc:creator`, `dc:identifier`, Calibre series meta) and MOBI EXTH headers | Good |
| **Companion files** | The EPUBs already beside the audiobooks | Known quantity — see §7.2 |

Drive reuses an auth path that already exists: `scripts/sync_to_drive.py` and
the folders cache already talk to this Drive account.

### 7.1 Kindle — three options, ranked

Phase 0 must establish which is actually available **before any code is written**.

1. **Local Kindle for PC cache** — cheapest by far if present. Check
   `C:\Users\nbasl\Documents\My Kindle Content\`. Older versions wrote a
   `KindleSyncMetadataCache.xml` listing the whole library with ASIN, title,
   authors and publication date — a direct parse, no network, no auth. Newer 2.x
   changed the store, so this needs verifying on the actual install.
2. **Amazon "Request My Data"** — the privacy-centre export includes a digital
   content dataset with titles and ASINs. Takes days to arrive but is complete
   and structured. **Kick this off during phase 0** so it lands before phase 3.
3. **Browser automation against Content & Devices** — the owner's own account in
   their own browser, manually triggered. Page-structure-fragile and paginated.
   The fallback, not the plan.

### 7.2 What the companion files actually are

Measured 2026-08-07, because the raw figure is misleading.

`app/metadata.py:_find_companion_files` scans for `.pdf/.epub/.mobi/.azw3`
**beside** each audiobook and writes them as a pipe-separated filename string in
the `companion_files` CSV column. It is **per-directory, not per-book** — all 26
Sanderson files are listed on every Sanderson audiobook row.

| Raw mentions | Distinct files |
|---|---|
| 1,302 EPUB + 432 PDF | **45 EPUB + 30 PDF across 23 authors** |

None are catalogued as books — no title, author, ISBN or cover, just filenames
on another book's row. A real starting inventory, but small, and not an ebook
library.

---

## 8. Build plan

| Phase | Ships | Gate |
|---|---|---|
| **0 · Verify** | Live calls to Open Library and Google Books on 10 real ISBNs off the shelf. Check whether `My Kindle Content` holds a parseable cache. Kick off the Amazon data request. Write `docs/info/isbn-ladder.md` with **measured** hit rates | Everything in §1 and §7 is knowledge, not measurement. The Board Game Catalog's discipline is *verified by live calls* — honour it before committing to a ladder |
| **1 · Scaffold + manual** | Worker + D1 + Firebase auth + React shell. Add/edit works, editions, copies by hand. Series-rooted browse | Useful with zero external dependencies — the same bar as board game phase 1 |
| **2 · ISBN scan** | EAN-13 filter (978/979 + checksum) → rungs 0–2 → confirm → write back to `edition.isbn13` | The 80%, free and fast |
| **3 · Ebook ingest** | CLI: Drive/disk walk, OPF and EXTH parse; Kindle import by whichever phase-0 path won; the new (title, author) matcher | Depends on phase 0's Kindle answer |
| **4 · Shelf photo** | Rewritten spine prompt returning title **and** author; scan-job queue; review screen | Should outperform the games version — book spines are denser and more uniform |
| **5 · Research + index** | Gated tiered research for limited editions; push projection to the index | |

Phases 2 and 3 are independent — physical scanning does not wait on the Kindle
question resolving.

### Repo layout

```
library_catalog/
├── packages/
│   ├── core/      zod schemas, (title, author) matching, vision types — no I/O
│   ├── db/        D1 queries + migrations
│   ├── isbn/      ← replaces packages/barcode: Open Library + Google Books
│   ├── ingest/    ← new: EPUB OPF, MOBI/AZW3 EXTH, Kindle library
│   └── research/  tiers.ts retargeted + vision.ts + client.ts
├── apps/
│   ├── worker/    Hono routes, thin
│   ├── web/       React PWA — camera.ts and scanner.ts copied verbatim
│   └── cli/       bulk ebook ingest, runs locally
└── docs/{access,info}/
```

Entry points stay thin per the global rule and the Board Game Catalog's
precedent: `apps/worker/src/index.ts` mounts routes and delegates to `packages/`.

⚠️ **`packages/core` has a load-bearing import order** in the source project —
`constants.ts` is a leaf, `schemas.ts` imports it, `index.ts` re-exports both,
and nothing under `src/` may import from `index.ts`. Reintroducing that cycle
makes `z.enum()` receive `undefined` and every write endpoint return 500 with a
misleading message, and **typecheck does not catch it**. Carry the rule across
with the code.

---

## 9. Cost

Using the Board Game Catalog's measured figures (2026-08-05): vision at 2400 px
is ~$0.003–0.005 per photo; ISBN lookups are free.

| | |
|---|---|
| A 500-book house at ~25 spines per photo | ~20 photos ≈ **$0.10** |
| ISBN lookups | £0 |
| Gated research on ~5% limited editions | the only real spend |

There is no equivalent of the $50–300 research pass the board game design
budgeted for, because Open Library gives away what that pipeline had to buy.

---

## 10. Open questions

| # | Question | Blocks |
|---|---|---|
| 1 | Does `My Kindle Content` hold a parseable metadata cache on this machine? | Phase 3 |
| 2 | What are Open Library's and Google Books' **measured** hit rates on this shelf? | Phase 2's ladder shape |
| 3 | Where do the loose ebook files live — local disk, Drive, or both? | Phase 3 |
| 4 | Should read-state and ratings live here, or in Firestore beside the audiobook reviews? | Phase 1 schema |
