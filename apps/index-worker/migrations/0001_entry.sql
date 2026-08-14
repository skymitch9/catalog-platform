-- index_catalog — the shared cross-catalog index. Schema from
-- docs/info/index-worker-design.md §4, verbatim in the columns and the
-- reasoning; read that before changing a character here.
--
-- One table. POINTERS, NEVER TRUTH (PLATFORM.md §2.2): display fields and
-- where to send the visitor. Re-pushing a source replaces that source's rows
-- wholesale, so there is no per-row staleness machinery — freshness travels
-- with the push protocol (pushed_at, surfaced per source by /api/health).
--
-- The join key is COMPONENTS, not one concatenated string, joined at two
-- tiers:
--   * work_fold  — books only ("same work, another format"). Games rows carry
--                  NULL permanently: a board game is never the same WORK as a
--                  book, and this is the design refusing to invent an identity
--                  games do not have, not a gap.
--   * universe   — the only cross-format join games participate in, resolved
--                  on write from data/universes.json.
-- A fold that comes back empty (wholly non-Latin titles — the '|samg'
-- production bug) is stored as NULL: a refusal, and the partial indexes below
-- keep refused rows out of the join indexes entirely. Such a row is reachable
-- only by (source, source_id) or display-title search — never by key.

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

-- Partial indexes so the NULL-fold rows (the refusals) never even enter the
-- join indexes.
CREATE INDEX ix_entry_title_fold ON entry(title_fold) WHERE title_fold IS NOT NULL;
CREATE INDEX ix_entry_work_fold  ON entry(work_fold)  WHERE work_fold  IS NOT NULL;
CREATE INDEX ix_entry_universe   ON entry(universe)   WHERE universe   IS NOT NULL;
