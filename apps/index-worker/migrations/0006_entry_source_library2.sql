-- 0006 — widen `entry.source`'s CHECK to admit `library2` (padhard, the
-- `[env.friend]` instance of library_catalog). Federation day, 2026-09-05.
--
-- ⚠️ THIS MIGRATION IS THE HALF THAT IS EASY TO MISS, and skipping it does not
-- fail politely. 0001 wrote the push vocabulary into the SCHEMA:
--
--     source TEXT NOT NULL CHECK (source IN ('game','library','audiobook'))
--
-- (verified against the LIVE remote `sqlite_master` on 2026-09-05, not just
-- read out of the migration file). So a Worker that knows about `library2`
-- while the database does not gets all the way through `isSource`, the bearer
-- check, zod, the snapshot rules and the whole series plan — and then throws a
-- CHECK constraint failure inside `db.batch`, which reaches the pusher as a
-- BARE 500 with nothing in it naming the cause. Migrate BEFORE deploy, which
-- is the estate's standing rule and exactly the case it was written for.
--
-- ⚠️ THE CONSTRAINT IS KEPT, WIDENED — not dropped. It is a second fence
-- behind `isSource` (src/rows.ts), and it is the fence that made this a loud
-- failure instead of a table quietly accumulating rows under a typo'd source
-- id that nothing would ever read. One list in TypeScript, one in the schema,
-- and they must be changed together; a source id is not free text.
--
-- SQLite cannot ALTER a CHECK constraint, so this is the standard 12-step
-- table rebuild, narrowed to what this table needs (no foreign keys point at
-- `entry`, no triggers, no views — checked in sqlite_master the same day).
--
-- ⚠️ THE DATA HERE IS A PROJECTION, NOT TRUTH (PLATFORM.md §2.2). Every row is
-- re-creatable by re-running each source's push, because the write protocol is
-- a full-snapshot replace — that is what makes a rebuild of this table an
-- ordinary migration rather than a risk. The copy below is still exhaustive
-- and column-named on purpose: a `SELECT *` would silently reorder if a future
-- column were added mid-table.
--
-- Column order matches the live schema exactly: 0001's seventeen, then
-- `series_slug`, which 0004's ALTER appended.

CREATE TABLE entry_new (
  source          TEXT NOT NULL CHECK (source IN ('game','library','audiobook','library2')),
  source_id       TEXT NOT NULL,           -- id in the owning catalog
  title           TEXT NOT NULL,           -- display, the source's spelling
  creator         TEXT,                    -- author (books); NULL for games
  title_fold      TEXT,                    -- computed on write; NULL when the fold is empty
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
  series_slug     TEXT,                    -- 0004's registry key; NULL is a real answer
  PRIMARY KEY (source, source_id)
);

INSERT INTO entry_new (
  source, source_id, title, creator, title_fold, work_fold, universe,
  series, series_index, year, publisher, format, kind, parent_source_id,
  cover_url, detail_url, pushed_at, series_slug
)
SELECT
  source, source_id, title, creator, title_fold, work_fold, universe,
  series, series_index, year, publisher, format, kind, parent_source_id,
  cover_url, detail_url, pushed_at, series_slug
FROM entry;

DROP TABLE entry;

ALTER TABLE entry_new RENAME TO entry;

-- The indexes went with the dropped table. Re-created verbatim from 0001 and
-- 0004 — all four PARTIAL, so the NULL-fold refusals stay out of the join
-- indexes entirely, which is 0001's own point and not a detail to re-derive.
CREATE INDEX ix_entry_title_fold  ON entry(title_fold)  WHERE title_fold  IS NOT NULL;
CREATE INDEX ix_entry_work_fold   ON entry(work_fold)   WHERE work_fold   IS NOT NULL;
CREATE INDEX ix_entry_universe    ON entry(universe)    WHERE universe    IS NOT NULL;
CREATE INDEX ix_entry_series_slug ON entry(series_slug) WHERE series_slug IS NOT NULL;
