-- 0020: estate_catalog — THE CATALOG REGISTRY. The one place that answers
-- "which catalogs exist, what is each one called, and who owns it".
--
-- Owner ask, 2026-09-05 15:50 Phoenix, confirmed 15:58: *"Make sure everything
-- we have that's in the estate connects to multiple libraries and make sure
-- that the libraries are designated by who owns the physical or shared with
-- digital works."* Survey: docs/info/multi-library-survey-2026-09-05.md §4
-- (what exists today), §10 dispatch 1 (this build).
--
-- ⚠️ THE NUMBER WAS RE-MEASURED, NOT TRUSTED. The survey's §10 says
-- "0020_estate_catalog.sql (new — ⚠️ re-measure the number, 0019 exists)".
-- Measured 2026-09-05: migrations/ held 0001…0019 and nothing else.
--
-- ⚠️ PURELY ADDITIVE: one CREATE TABLE IF NOT EXISTS on a NEW object, one
-- index, and five INSERT OR IGNORE seed rows. No ALTER, no DROP, nothing
-- existing touched — the property that made 0012…0019 safe to apply remotely
-- and unattended, and the one to re-check before any successor.
--
-- =====================================================================
-- 🔴 WHY THIS IS A NEW TABLE AND NOT COLUMNS ON `catalog_request` (0018)
-- =====================================================================
--
-- 0018's own header says it in red: *"A ROW HERE IS A REQUEST, NOT A CATALOG.
-- Nothing reads this table to decide what exists."* It holds ZERO rows for the
-- five catalogs that exist today, because all five predate the request queue —
-- so `GET /api/catalogs` cannot be derived from it at all without inventing
-- five synthetic `status='live'` requests that nobody ever made. That would
-- make one table mean two things, and the sentence that stops a future session
-- reading a request as a catalog would have to be deleted.
--
-- So: a REQUEST is what somebody asked for; a CATALOG is what exists. Two
-- tables, one join (`request_id`), and 0018's header stays true.
--
-- =====================================================================
-- ⚠️ `id` IS THE VISIBILITY VOCABULARY, NOT THE PUSH VOCABULARY
-- =====================================================================
--
-- The estate runs two id vocabularies for the same five things and they differ
-- in exactly one place:
--
--   visibility (`packages/estate-auth/src/visibility.ts` CATALOGS, and the
--   `vis_<id>` columns of 0002/0007/0008):  audiobook library games library2 ebooks
--   push (`index-worker/src/rows.ts` SOURCES, and `entry.source`):
--                                          audiobook library game  library2
--
-- `id` here is the VISIBILITY one, because that is what a `vis_` column, a
-- /seen answer and every scope decision are keyed on. `push_source` carries the
-- other, so the registry knows BOTH and `search-route.ts`'s SOURCE_FOR_CATALOG
-- stops being the only thing that does.
--
-- ⚠️ `push_source` IS NULL FOR `ebooks`, AND NULL IS THE ANSWER, NOT A GAP.
-- Ebooks are the one catalog with no source of its own: ebook rows ride
-- `PUT /api/push/audiobook` with `format:'ebook'` because (audiobook_catalog's
-- own app/index_push.py) *"'audiobook' the source means the household's shared
-- pool"*. A reader that treats NULL as "not filled in yet" and guesses
-- `'ebooks'` would build a scope that matches nothing while looking exactly
-- like a working one.
--
-- =====================================================================
-- ⚠️ `kind` HERE IS THE CONTENT KIND. IT IS **NOT** `CATALOG_KINDS`.
-- =====================================================================
--
-- `catalog-names.ts` CATALOG_KINDS = ('books','games') is the PROVISIONING
-- kind — which ten-step runbook and which ledger applies when somebody asks for
-- a catalog of their own (0018's `kind` column, same vocabulary). It never
-- names a catalog that exists, and the survey's §1 flags confusing the two as a
-- trap.
--
-- This column answers a different question — what is ON the shelf — and it
-- therefore needs a third value, `audio`, that no provisioning path has. The
-- two vocabularies OVERLAP by design (a provisioned books catalog is
-- kind='books' here too, which is what makes the `/live` write a straight
-- copy), and they are not the same fact.
--
-- =====================================================================
-- 🔴 `owner_name` + `holding` + `shared` — THE THREE FACTS THE ESTATE LACKED
-- =====================================================================
--
-- Survey §4 measured all three as ❌ *"the estate has NO ownership signal at
-- all"*. request-a-catalog-design.md §9 says the same in one line: ⚠️
-- *"`visibility` is what you may SEE, never what you OWN"*.
--
-- The settled model (owner, confirmed 2026-09-05 15:58) is the five seed rows
-- at the bottom of this file: `library` Skylar's physical, `library2`
-- Samantha's physical, `games` Skylar's physical, `audiobook` and `ebooks`
-- shared digital, and every future `library3…` the requester's name, physical.
--
-- ⚠️ `shared = 1` MEANS THE ESTATE POOL, AND IT IS NOT `PUBLIC_CATALOGS`.
-- `visibility.ts:52` PUBLIC_CATALOGS = ['audiobook'] answers "may the anonymous
-- internet read this", which is a different question with a different answer
-- (`ebooks` is shared AND deliberately not public — the owner directive that
-- created it was *"I don't want people scraping my books"*). Reusing one for
-- the other would open the ebook shelf.
--
-- ⚠️ `owner_name` IS NULL EXACTLY WHEN `shared = 1`, and a renderer must say
-- "shared" rather than printing an empty name. A digital pool has no one owner;
-- that is the whole distinction the owner's rule draws.
--
-- =====================================================================
-- ⚠️ WHAT IS IN THIS TABLE IS PUBLISHED, BY DESIGN
-- =====================================================================
--
-- `GET index.heygabi.ai/api/catalogs` answers the ANONYMOUS internet from these
-- rows — the apex search box needs labels before anybody signs in. Owner
-- decision 2026-09-05 16:14, asked and answered: **"yes name only"**. So a row
-- here is a public statement that a shelf exists and whose it is; it is NEVER a
-- statement about what is ON it. No counts, no titles, no freshness and nothing
-- derived from `entry` rows may ever be stored here or joined into the
-- anonymous answer. Samantha's ROWS stay `vis_library2`-gated everywhere else,
-- exactly as they were.
--
-- ⚠️ AND THEREFORE: NEVER A SECRET, NEVER AN INTERNAL HOSTNAME, NEVER AN EMAIL.
-- `owner_name` is a display name (the name a person is called on the site), not
-- an identifier and not a join key. All four estate repos are PUBLIC
-- (KNOWN_ISSUES KI-2) and this table's contents are published on top of that.

CREATE TABLE IF NOT EXISTS estate_catalog (
  id          TEXT    PRIMARY KEY,       -- VISIBILITY vocabulary: audiobook|library|games|library2|ebooks|library3…
  push_source TEXT,                      -- index push vocabulary; NULL for a catalog with no source of its own
  kind        TEXT    NOT NULL           -- CONTENT kind. NOT catalog-names.ts CATALOG_KINDS — see the header.
                      CHECK (kind IN ('books','games','audio')),
  label       TEXT    NOT NULL,          -- what a person is shown, e.g. "Skylar's library"
  owner_name  TEXT,                      -- the person who owns the physical copies; NULL iff shared = 1
  holding     TEXT    NOT NULL
                      CHECK (holding IN ('physical','digital')),
  shared      INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1)),
  host        TEXT    NOT NULL,          -- the hostname it answers on, e.g. library.heygabi.ai
  -- Render order. Deliberately a COLUMN and not `CATALOGS`' array position: a
  -- provisioned `library3` is not in that array until a migration adds it, and
  -- a registry whose order depends on a constant it can outgrow would put every
  -- new catalog first or last by accident. The five seeds take 10…50 in the
  -- canonical order §4.5 calls load-bearing; anything provisioned lands at 100.
  sort_order  INTEGER NOT NULL DEFAULT 100,
  -- The catalog_request row that produced it, or NULL for the five that predate
  -- the queue. ⚠️ DELIBERATELY NO FOREIGN KEY, for 0019's reason: a catalog
  -- outlives the request that asked for it, and a registry that could not be
  -- written without a request row would be unable to hold the five that exist.
  request_id  INTEGER,
  created_at  TEXT    NOT NULL
);

-- The one read this table has: "list every catalog, in order". Covering, so the
-- listing never touches the table itself.
CREATE INDEX IF NOT EXISTS idx_estate_catalog_order ON estate_catalog (sort_order, id);

-- =====================================================================
-- THE BACK-SEED — the five catalogs that exist today
-- =====================================================================
--
-- ⚠️ `INSERT OR IGNORE`, NOT `INSERT`. A migration that has been applied is
-- never edited, but a migration that is re-run (a local drill, a restore, a
-- fresh D1) must not fail on the second pass — and it must not overwrite a
-- label the owner has since corrected by hand. Ignore-on-conflict is the only
-- one of the three shapes that is both idempotent AND non-destructive.
--
-- ⚠️ THE VALUES ARE THE OWNER'S TABLE, VERBATIM, CONFIRMED 2026-09-05 15:58
-- ("Yes that is correct"). They are not inferred from any of the seven
-- disagreeing label maps the survey found (§2 F2) — those are the thing this
-- table exists to delete, so seeding from one of them would have canonised
-- whichever copy happened to be read.
--
-- ⚠️ THE HOSTS ARE MEASURED, NOT ASSUMED: each is a routed `*.heygabi.ai`
-- custom domain, cross-checked 2026-09-05 against auth-worker/src/env.ts's
-- DEFAULT_SESSION_ORIGINS and catalog-names.ts RESERVED_SUBDOMAINS, which are
-- the estate's two existing (partial) lists of the same fact.
--
-- ⚠️ `games` KEEPS ITS VISIBILITY SPELLING AND `game` ITS PUSH SPELLING. That
-- disagreement is the estate's, not a typo here — see the vocabulary note above.

INSERT OR IGNORE INTO estate_catalog
  (id, push_source, kind, label, owner_name, holding, shared, host, sort_order, request_id, created_at)
VALUES
  -- The public slice, and the household's shared audio pool. `shared = 1`, so
  -- no owner_name: an audiobook is nobody's physical copy.
  ('audiobook', 'audiobook', 'audio', 'Shared audiobooks', NULL,      'digital',  1,
   'audiobooks.heygabi.ai', 10, NULL, '2026-09-05T00:00:00.000Z'),

  -- Skylar's physical shelf. ⚠️ The apex front door calls this one "!Sky"
  -- today (survey F5, a live-confirmed defect); the registry's label is what
  -- dispatch 2 replaces it with.
  ('library',   'library',   'books', 'Skylar''s library', 'Skylar',  'physical', 0,
   'library.heygabi.ai', 20, NULL, '2026-09-05T00:00:00.000Z'),

  -- Skylar's physical board games. ⚠️ NO SURFACE IN THE ESTATE DESIGNATES THIS
  -- ONE TODAY (survey F3) — it reads as an unowned estate facility on all three
  -- label maps. This row is the first place it is written down.
  ('games',     'game',      'games', 'Skylar''s board games', 'Skylar', 'physical', 0,
   'boardgames.heygabi.ai', 30, NULL, '2026-09-05T00:00:00.000Z'),

  -- Samantha's physical shelf — padhard, library_catalog's [env.friend].
  -- ⚠️ Its EXISTENCE and its OWNER are published by this row (owner decision
  -- 16:14, "yes name only"); its ROWS remain behind vis_library2, which is
  -- DEFAULT 0 and hand-granted (0007).
  ('library2',  'library2',  'books', 'Samantha''s library', 'Samantha', 'physical', 0,
   'padhard.heygabi.ai', 40, NULL, '2026-09-05T00:00:00.000Z'),

  -- The shared ebook pool. ⚠️ push_source NULL — see the header; ebook rows
  -- ride the `audiobook` source with format='ebook'. `shared = 1` and NOT
  -- public: the grant is vis_ebooks, DEFAULT 0 (0008).
  ('ebooks',    NULL,        'books', 'Shared ebooks', NULL,          'digital',  1,
   'ebooks.heygabi.ai', 50, NULL, '2026-09-05T00:00:00.000Z');
