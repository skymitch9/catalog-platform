# Edit Any Detail & the Audit Log — Cross-Catalog Contract — Information Reference

> **Audience:** Claude sessions, and the owner deciding the remaining phases.
> **Status:** TRACKED. Last verified: **2026-08-14** against:
> `library_catalog` — `docs/info/edit-and-audit-design.md`,
> `migrations/0001_init.sql`, `migrations/0120_change_log_and_authorless.sql`,
> `packages/db/src/changes.ts`, `packages/core/src/capabilities.ts`,
> `packages/core/src/titles.ts` (sentinel branch present),
> `apps/worker/src/routes/catalog.ts` (key-move gate present, `editCatalog`),
> `scripts/backfill-review-keys.mjs` (matching logic read), `docs/TODO.md`
> (deploy log), `docs/info/identity-and-reviews.md`;
> `audiobook_catalog` — `docs/info/catalog-corrections.md`, `docs/TODO.md`;
> `Board_Game_Catalog` — `migrations/` (all 26), `packages/core/src/capabilities.ts`,
> `apps/worker/src/routes/admin.ts`; this repo — `PLATFORM.md` §2.2/§2.4/§4a.
> **NOT verified:** nothing was executed. No fresh read of production D1,
> Firestore, or the live site — deploy claims (version `8433e561`, first real
> `change_log` rows) are taken from `library_catalog/docs/TODO.md`'s work log,
> not re-observed. Whether any *title* override has already been applied on the
> audiobook side was not checked against `scripts/catalog_overrides.json`.

The owner's ask, verbatim, from one scanning session (2026-08-13):

> *"we need a way to edit basically any detail about a book except core details
> like ISBN. We'd also need an audit log and stuff. **Audiobook catalog will
> need this as well.**"*

---

## 0. Where this stands, in one paragraph

**The library half of this feature is BUILT and DEPLOYED** (2026-08-13, version
`8433e561`, per its work log): migration 0120 (`change_log` + the authorless
sentinel + the evidence floor) is in production, all work/edition/copy mutations
write audit rows atomically, the key-move ceremony gates `PATCH /works/:id`, and
the web surface shipped. The deep design lives in
`library_catalog/docs/info/edit-and-audit-design.md` and is **not repeated
here**. What *this* document adds is the piece both repos' TODOs asked for and
neither owns: the **cross-catalog contract** — which parts of that design cross
the repo boundary, what "edit any detail except core identifiers" means in each
catalog's own vocabulary, how the audiobook catalog's overrides-and-rebuild
model satisfies the same audit contract **without inventing a database it does
not have**, and the build order for what remains.

---

## 1. The contract: what crosses the boundary, what stays home

`PLATFORM.md` §2.2 governs: each catalog keeps its own database; nothing is
merged. The library design's §8 already drew this line; it is promoted here to
the estate-level statement both sides point at.

| Crosses the boundary (shape & semantics) | Stays home (storage & enforcement) |
|---|---|
| **The audit contract** (§4): every catalog answers *who / what / when / how / before / after* the same way, with machine writes forever distinguishable from human ones and the record surviving the row it describes | the `change_log` **table** — each catalog that has a DB applies the 0120 DDL as its own migration in its own store; tables are never shared or joined |
| **The core-identifier freeze** (§2): identifiers of the physical/purchased object are never edited in place — correction is delete-and-recreate (library) or out of scope (audiobook), and the trail records both halves | which fields are frozen — each catalog names its own (ISBN/ASIN vs CDEK atom vs barcode) |
| **The key-move rules** (§3): a `work_key` never moves without its reviews; restamp-first ordering; a failed check is never a zero; provisional (sentinel) keys are free to move by construction | the evidence floor (`reviews_seen_*`), the ceremony route, the sentinel itself — `?unknown` never leaves the library's D1 *by construction*, so no other catalog ever needs to learn it |
| `workKeyFor` semantics — already the shared review-join contract (`identity-and-reviews.md`) | each side's implementation (TS in the library, derivation-at-backfill for the audiobook CSV) |
| **The role rule** (§5): catalog editing is `editCatalog` = owner + manager; guest-list changes are owner-only and are themselves audited | each app's capability matrix and role names |

**Dependency recorded elsewhere, load-bearing here:** `PLATFORM.md` §4a — the
Firestore `reviews` collection **stays shape-only (no `request.auth`) by owner
decision, 2026-08-13**, because the key-move carry restamps `workKey` onto other
people's review documents from the browser. Harden those rules and the carry
breaks silently. Any future hardening must move the carry server-side behind the
service account this estate has so far refused to hold — a trade-off to argue
that day, not a rules edit.

---

## 2. Field inventory: what "any detail except core identifiers" means, per catalog

The library design's three-tier split (free / key-moving / frozen) generalises.
The estate rule: **frozen = other data hangs off it** (self-healing scan
write-back, UNIQUE indexes, purchase identity). A pointer into somebody else's
catalog is *editable* — a wrong pointer is a wrong fact to correct, not a
different object.

### 2.1 library_catalog (D1) — BUILT, enforcing

| Tier | Fields | Enforcement |
|---|---|---|
| **Free** | `work`: subtitle, sort_title, series, series_index_sort/display, first_published, description, cover_url, openlibrary_work_id, illustrator (0130), universe; `edition`: format, edition_name, publisher, published_year, pages, language, cover_url, source, source_url; `copy`: everything (status, location, acquired_on, price, vendor, condition, is_signed, notes, lent_to) | ordinary `editCatalog` PATCH, audited |
| **Key-moving** | `work.title`, `work.authors` | the §3 ceremony: 409 without a resolved `keyMove` attestation |
| **Frozen** | `edition.isbn13`, `edition.isbn10`, `edition.asin` | schema-level 400 (strict refusal, not silent strip) + no UI control; correction = delete-and-recreate, logged as two `__row__` audit entries |

Derived columns (`primary_author`, `work_key`, `sort_title` when derived) are
not directly editable; `work_key` is recomputed server-side only — a
caller-supplied key is ignored.

### 2.2 audiobook_catalog (no DB — overrides + rebuild) — partially built

Its "row" is an m4b file's tags; its "table" is the generated `site/catalog.csv`.
The edit surface is `scripts/catalog_overrides.json` via
`app/tools/edit_overrides.py` (built 2026-08-12), applied at build time by
`app/core/catalog_overrides.py`.

| Tier | Fields | Enforcement |
|---|---|---|
| **Free** | `CORRECTABLE_FIELDS`: title, author, narrator, year, genre, series, series_index — plus `canonical_series` spellings | the overrides layer; unknown fields in a `set` block are ignored, so a typo cannot invent a column |
| **Key-moving** | `title`, `author` | ⚠️ **exists but is currently unguarded** — see §3.3. The gap on this side |
| **Frozen** | the ASIN (`CDEK` atom) — the Audible product identity and the preferred override *key*; the audio itself; every tag on purchased media except `SRNM`/`SRSQ` (which only the sweep writes, backup-first) | by construction: `edit_overrides` never opens an m4b for writing; the sweep's uncurated write path stays disarmed |

### 2.3 Board_Game_Catalog (D1) — no audit, deliberately, for now

No `change_log`; `apps/worker/src/routes/admin.ts` states it in as many words
(*"No change_log here — this catalog has no audit table… The library twin of
this file additionally audits, because there the table exists."*). Nothing joins
its rows to the shared review store — **there is no key-move problem for
games**, which is why it can wait (§7).

| Tier | Fields (when it adopts the contract) |
|---|---|
| **Free** | `item`: name, sort_name, kind, year_published, publisher(+url), designers, player counts, playtime, weight, description, series (0019), ttrpg fields (0015); `edition`: name, year, publisher, language, image_url; `copy`: everything |
| **Key-moving** | none — no external join hangs off a name |
| **Frozen** | `edition.barcode` (UNIQUE since 0003; scan write-back self-heals onto it — the exact ISBN analogue). `bgg_id` is a pointer, so editable |

---

## 3. The `work_key` move problem

### 3.1 What a title/author edit actually does

`work.work_key = normaliseTitle(title)|normaliseTitle(primaryAuthor)` is the
join to the shared Firestore `reviews` collection (~870 documents, both
catalogs' reviews, backfilled 2026-08-12). Review doc **ids** are
`bookIdFromTitle(title)_{name}` — title-only, never changed; the join is the
`workKey` **field** on each document. Consequences of moving the key without
ceremony, on either side:

1. Every review carrying the old `workKey` stops joining this work — on the
   library side the book page shows nothing (the legacy `bookId` fallback only
   matches when both catalogs spell the title identically, which for series
   titles they never do).
2. The read-state sweep (`identity-and-reviews.md` §7.7) starts from the
   person's review docs and joins `doc.workKey = work.work_key` — orphaned docs
   silently stop marking books read.
3. Nothing reports any of it. Orphaning is invisible until someone notices a
   missing review.

### 3.2 The chosen mechanism — carry-with-attestation (BUILT), estate-wide

**Recommendation, and what the library already ships: keys stay derived from
title+author, and a key move is a ceremony that carries the reviews or does not
happen.** The browser (the only party with Firestore access — no service
account, deliberately) restamps `workKey: newKey` onto every doc the live check
found, **Firestore first**, then PATCHes D1 with a `keyMove` attestation
(`expectedOldKey`, `reviewsFound`, `restamped`); the server refuses a claimed
zero that contradicts its D1 evidence floor (`reviews_seen_*`, cached ratings,
prior carried moves) and writes the audit row `note: 'reviews restamped: N'` in
the same batch. Firestore-first ordering is load-bearing: a crash between the
two steps degrades to legacy-query visibility and the ceremony is idempotent on
re-run. A provisional (`?unknown`-sentinel) key is free to move *by
construction* — no doc can ever carry it. Full argument:
`library_catalog/docs/info/edit-and-audit-design.md` §5.

**This mechanism is the estate contract**: any writer, in any repo, that ever
moves a stored or derived `work_key` must either carry the reviews to the new
key or refuse the move. Today the writers are the library's PATCH route
(guarded) and the audiobook build pipeline (not guarded — §3.3).

### 3.3 Rejected alternatives, with reasons

| Option | Why rejected |
|---|---|
| **Key-stable surrogate ids** (join reviews on an opaque id, not title+author) | The audiobook site has no DB to hold one and its ~9,600 lines of Firestore JS are owner-frozen (`PLATFORM.md` §2.1); every existing doc id was minted by `bookIdFromTitle` and would need a rewrite of other people's documents. The composite key is the only key both catalogs can *compute* |
| **Alias rows** (keep old keys in a `work_key_alias` table; query reviews by all of them) | Reads multiply (N Firestore queries per book, and the sweep's single-key join breaks); the alias table exists only on the library side, so the audiobook backfill and any future estate reader would need to replicate it — a second copy of truth, the drift shape this estate keeps refusing. Aliases also *accumulate*: nothing ever retires them, and every reader forever pays for every rename |
| **Re-key review docs** (rewrite doc ids to the new title slug) | Delete+create of *other people's* documents; breaks the audiobook site's own `getReviews(db, bookId)` for its spelling; strictly worse than a field merge |
| **Server-side carry** (Worker restamps via a service account) | Requires the most powerful credential in the household behind the least important endpoint — refused deliberately (`identity-and-reviews.md` §3); also contradicted by the owner's §4a decision, which keeps the browser-side carry viable instead |
| **Forbid title/author edits outright** | Was the pre-2026-08-13 state (the `WorkFields` guard) and is what the owner explicitly asked to end; also left `PATCH /works/:id` unguarded at the API layer — the ceremony *closed* a live gap the freeze had only papered over |

### 3.4 ⚠️ The audiobook side has its own key move, and it is currently silent

A title/author **override** changes the *published* `catalog.csv` on the next
build. Verified against `scripts/backfill-review-keys.mjs`: the backfill builds
its map as `bookIdFromTitle(current CSV title) → row` and matches review docs by
their stored `bookId`. So a retitle on the audiobook side:

- changes the doc id the site derives for **future** reviews of that book
  (old reviews sit under the old slug forever — same drift the library design
  §5.4 records for its own titles);
- **breaks the backfill's match for the existing docs** — their stored `bookId`
  no longer equals the slug of the new title, so they go `unmatched` and are
  never restamped to the new derived `workKey`;
- moves the derived `workKey`, so the library-side join and read-state sweep
  quietly lose those reviews. The same orphaning as §3.1, reached through a CSV.

Nothing in `edit_overrides.py` warns about any of this today. The fix is
Phase A2 (§7): the overrides file itself records the **pre**-correction values
(`match.title`/`match.author` — the editor already keys on pre-correction tags
precisely so entries fire), so the backfill can derive the *old* slug from the
overrides file and match both spellings. That makes re-running the backfill the
audiobook side's carry ceremony — no site JS touched, no new store.

---

## 4. The audit contract, and where it lives per catalog

### 4.1 One schema, one semantics

The shared shape is the library's `change_log` (migration 0120 — read that
file; its comments are the spec). The contract every catalog must satisfy,
however it stores it:

| Question | Contract |
|---|---|
| **who** | a stable actor identity, surviving account deletion (`changed_by` FK `ON DELETE SET NULL` / git author) |
| **what** | one record **per field**, named as the API spells it; whole-row create/delete under `__row__`, with a deletion storing the entire old row — the undo material |
| **when** | server/commit timestamp, never client-supplied |
| **how** | `'human'` vs `'auto'` (`DECISION_MODES`) — a machine write is distinguishable from a person's *forever* |
| **before/after** | both values, JSON-encoded, NOT NULL — `'null'` (the literal) means "was NULL"; "not recorded" is unrepresentable, on purpose |
| **grouping** | `batch_id`: one save = one event |
| **append-only** | no update/delete path exists; an audit log something can edit is not an audit log |
| **atomic** | the record lands in the same transaction/commit as the change, or neither does |
| **note** | one free-text fact worth keeping beside the diff (`'reviews restamped: 3'`, `'ebook ingest'`) |

### 4.2 What the library's `change_log` already gives (BUILT)

Everything in §4.1, in production since 2026-08-13: entities `work`, `edition`,
`copy`, **and `app_user`** (role changes audit too — joined 2026-08-13);
creation rows from scan/import paths stamped `'auto'`; the first real deletion
(#284) captured whole-row, per the work log; `keyMoveEvidence` reads the log
back as evidence (`field='work_key'` + restamp note), which is the first proof
the table is load-bearing and not write-only. Reads: per-entity Changes panel
(capability `read`); deliberately **no** unscoped all-changes view yet.

### 4.3 The audiobook mapping — git history *is* the audit log

No database is invented. The overrides file is git-tracked, edited only through
a validating CLI with an atomic save; the mapping:

| Contract | Overrides-layer equivalent | Honest gaps |
|---|---|---|
| who | git author of the commit touching `catalog_overrides.json` | one machine, effectively always the owner — acceptable at household scale, and exactly the §5 role mapping |
| what | the `set` block, field by field; entry creation/removal = `__row__` | — |
| when | commit date, plus the entry's `added`/`updated` fields | `updated` only appears on amend; fine |
| how | always `'human'` — the CLI demands a per-field reason and refuses to skip it | there is no `'auto'` writer of this file, and the sweep (the only machine writer of anything) writes *tags*, with its own backup.jsonl trail |
| before | `tags_read` (the pre-correction tag values) + `filename_said` | ⚠️ **amending an entry REPLACES `tags_read` with a fresh read** (`catalog-corrections.md` §10) — the in-file "before" erodes on amend. The durable before-record is **git history**, which retains every prior version of the entry. Accept this; do not double-store (§8 Q4) |
| after | the `set` values | — |
| grouping | the commit | — |
| append-only | git history — the file is mutable, the *history* is not | requires the branch to be pushed; `feat/editable-listings` was recorded as un-pushed 2026-08-13 (not re-verified today). An un-pushed audit log is one disk failure from not existing |
| atomic | one commit = entry + evidence together; `save()` validates before writing | correction reaches the site only on the next `python -m app.main` — the audit record can *precede* the visible change. That ordering is the safe direction (record first, effect second) |
| note | `evidence` + `sources` — **stronger** than `change_log.note`: citable URLs are mandatory per field, test-enforced | — |

**Verdict: the overrides+rebuild model already satisfies the contract** once
two small things are fixed: commits of the file get pushed routinely, and the
key-move guard (§3.4) exists. When (if ever) that catalog gains a real
web editor or moves onto a platform D1, it applies the 0120 DDL as its own
migration and the CLI keeps working unchanged underneath — the contract was
designed so that day is a migration, not a redesign.

### 4.4 Board games

Nothing today, on purpose (§2.3). When first needed, apply the 0120 DDL
verbatim (rename nothing; `entity` values become `item`/`edition`/`copy`/
`app_user`) and port `changes.ts` — it is dependency-light and D1-generic.

---

## 5. Who may edit what

Both D1 catalogs already share the same capability architecture (routes gate on
capabilities, not roles; verified identical `editCatalog`/`manageUsers` split in
both `capabilities.ts` files):

| Action | library_catalog | Board_Game_Catalog | audiobook_catalog |
|---|---|---|---|
| see the catalog | `read`: owner, manager, reader | `read`: owner, manager, rater, viewer | public site |
| free-tier edits | `editCatalog`: owner, manager | `editCatalog`: owner, manager | whoever can run the CLI on this machine and push — the owner, in practice |
| **key-moving edits** | `editCatalog` **plus** the resolved `keyMove` attestation (verified: the PATCH route gates on `editCatalog`, the ceremony is the extra guard — no separate capability) | n/a | owner (CLI); gains the §3.4 warning, not a permission gate |
| frozen fields | nobody — 400 | nobody (on adoption) | nobody — CLI never writes m4bs |
| read the audit trail | `read` — it is a household | same on adoption | `git log` |
| role changes (audited) | `manageUsers`: owner only | `manageUsers`: owner only | n/a |

**Recommendation (already the built state): no new role and no new capability.**
The ceremony is a *procedural* gate on top of `editCatalog`, not a permission —
a manager who can edit the catalog can also retitle a book, because the
attestation + evidence floor is what makes the move safe, not seniority. Making
key moves owner-only would re-create the "manager quietly stops meaning what it
is called" failure the capability files warn about in identical words.

---

## 6. The audiobook path, spelled out

The constraint stack: read-only pipeline-fed catalog (`PLATFORM.md` §2.4), no
backend, owner-frozen site JS (§2.1), no DB — and the owner's "Audiobook
catalog will need this as well." The resolution: **its edit-any-detail surface
already exists** (`edit_overrides`, §2.2) and **its audit log already exists**
(git, §4.3). What it lacks is not machinery but the *cross-catalog safety
rules*. So its path is three small steps, none of which invent a store:

1. **Push discipline** — the overrides branch merges to main and pushes like
   any other work; an audit log that exists only locally is not one.
2. **The key-move guard in `edit_overrides.py`** — when `set` touches `title`
   or `author`, print what it means (*"this moves the review join for N
   existing reviews"* — N knowable from a Firestore read, or stated as
   unknowable), and print the carry procedure: run the library's
   `backfill-review-keys.mjs` after the next site build.
3. **Override-aware backfill** — `backfill-review-keys.mjs` also derives each
   book's *pre-correction* slug from `catalog_overrides.json` (`match.title`)
   so retitled books' existing docs still match and get restamped (§3.4). This
   is the audiobook side's entire carry ceremony, and it lives in the library
   repo, which already reads the audiobook checkout (`LC_AUDIOBOOK_ROOT`).

Explicitly **not** proposed: an audiobook D1, a web editor, touching
`site/reviews.js` to stamp `workKey` on new reviews (see §8 Q1 — recommended,
but it is the owner's frozen zone), or hardening Firestore rules (decided
against, §4a).

---

## 7. Build order

**Library first — and it already happened.** Recorded so the reasoning survives:
the library had the schema with the hard cases mapped (NOT-NULL constraints,
the D1-rebuild trap, the review join), the only *live* gap (an unguarded PATCH
that could silently move a key), and the only place the ceremony's server half
could live. Both repos' TODOs independently said "design once, library first";
the audiobook TODO explicitly defers here. Done: design 2026-08-12/13, owner
approved all four decisions 2026-08-13 ("do them all"), built and deployed the
same day.

| Phase | Repo | Ships | Size |
|---|---|---|---|
| **L1 — DONE** (2026-08-13) | library | 0120 migration, three-tier guard, key-move ceremony + evidence floor, atomic audit writes on all mutations, Changes panel, authorless add + sentinel | shipped, 335 tests |
| **A1 — push discipline** | audiobook | merge/push the overrides branch; note in its TODO that the audit trail is the *remote* git history | minutes; do with the next touch of that repo |
| **A2 — key-move guard** | audiobook | the §6.2 warning in `edit_overrides.py` + tests | small; single-file |
| **A3 — override-aware backfill** | library (reads audiobook checkout) | §6.3 aliasing in `backfill-review-keys.mjs`; re-run after any audiobook retitle build | small; one script + fixture |
| **G1 — games adoption** | board games | 0120 DDL + `changes.ts` port + audit writes on mutations. **Trigger: first real need** (first destructive mistake, or the estate-wide changes view) — not before | medium; no ceremony needed (no key join) |

A2/A3 are ordered before any *title/author* override is applied to a reviewed
book; free-tier overrides (narrator, year, genre, series numbering) need
nothing and are safe today.

---

## 8. Open questions for the owner

1. **Should the audiobook site's `reviews.js` start writing `workKey` on new
   reviews?** Every review written there since the 2026-08-12 backfill carries
   only `bookId`; the library's sweep cannot see it until the backfill is
   re-run, forever. One additive line in the write path ends the treadmill —
   but it is inside the ~9,600 frozen lines you ruled out touching for the
   migration. **Recommendation: yes, as a deliberate one-line exception** —
   it is additive, `validReview()` ignores unknown fields, no rules change —
   with the backfill kept as the safety net either way. Your call because the
   freeze is yours.
2. **When A2/A3 land, who runs the carry?** The backfill re-run after a
   retitle build is a maintainer command with `--commit` against live review
   data. **Recommendation:** it stays a deliberate manual step printed by the
   CLI warning — no automation; same posture as every other `--commit` in that
   repo.
3. **Games audit now or on first need?** **Recommendation: on first need**
   (G1's trigger). The precedent comment in `admin.ts` already marks the seam;
   adopting early buys rows nobody reads.
4. **Accept git-history-as-"before" for amended override entries** (the
   `tags_read` replacement, §4.3)? **Recommendation: yes** — double-storing
   the before-value in the file is a second copy of what git already holds;
   document it (done, in `catalog-corrections.md` §10) rather than build it.
5. **An estate-wide "what changed lately" view** (all catalogs, one page) —
   the one read the per-entity Changes panel deliberately does not serve.
   **Recommendation: defer** until the index Worker grows a natural home for
   it; it needs G1 first to be estate-wide at all, and nothing today asks the
   question.

---

*Cross-references: the deep library design —
`library_catalog/docs/info/edit-and-audit-design.md`; the review join —
`library_catalog/docs/info/identity-and-reviews.md`; the boundary rule —
`PLATFORM.md` §2.2; the Firestore-rules decision this depends on —
`PLATFORM.md` §4a; the audiobook corrections layer —
`audiobook_catalog/docs/info/catalog-corrections.md` (local-only).*
