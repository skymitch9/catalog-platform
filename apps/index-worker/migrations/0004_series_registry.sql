-- 0004 — the estate SERIES REGISTRY. The owner's order, 2026-08-16: "I don't
-- want duplicate series."
--
-- The problem in one line: `entry.series` is FREE TEXT, one string per row, in
-- whichever spelling the owning catalog happens to hold. An m4b tag says "The
-- Stormlight Archive", a library row says "Stormlight Archive", and every
-- consumer that groups by that string sees TWO series. This migration gives a
-- series a KEY — the same thing `work_fold` gave a book — so grouping stops
-- depending on spelling.
--
-- ⚠️ THE FOLD IS NOT A NEW NORMALISER. The slug is derived from
-- `normaliseTitle` (src/fold.ts, the pinned port), spaces to hyphens: it is
-- the fold that already strips a leading article, so "The Stormlight Archive"
-- and "Stormlight Archive" fold to the SAME key and merge with no judgement
-- call at all. src/series.ts is a wrapper over that fold in the house style of
-- `titleFoldOrNull`, never a second fold. (`normaliseUniverseText` is
-- deliberately NOT used: it KEEPS leading articles on purpose — "The Cosmere"
-- and "Cosmere" are two different strings in universes.json by design — which
-- is the exact opposite of what a de-duplicating key needs.)
--
-- ⚠️ THE SPLIT THE OWNER APPROVED, and the reason there are three tables:
--   * EXACT fold equality  → AUTO-MERGE. No threshold, no score, no judgement:
--                            two strings that fold identically are the same
--                            series. The alias row records what merged.
--   * NEAR (folds differ)  → NEVER auto-merged. The candidate registers as its
--                            OWN slug and a row lands in `series_pending` for a
--                            human. Confirm-first, exactly as approved.
-- This keeps design §8's "no second matcher" intact: the near rule scores
-- nothing and gates no write — it only fills a human's queue, which is what
-- data/series-canon.json's own `_measured` methodology calls a DISCOVERY tool
-- ("never a runtime rule"). It is reused here as one, and nowhere else.

-- Which registry entry a row belongs to. NULL is a real answer, twice over:
-- the row carries no series at all, or its series folds to the empty string
-- (the two Korean series titles measured live 2026-08-16) — the same
-- empty-fold refusal `title_fold` already makes, for the same reason: a
-- degenerate key would make every such row the same series as every other.
ALTER TABLE entry ADD COLUMN series_slug TEXT;
CREATE INDEX ix_entry_series_slug ON entry(series_slug) WHERE series_slug IS NOT NULL;

-- The registry: one row per SERIES IDENTITY, estate-wide.
--
-- `display_name` is FIRST WRITER WINS — the spelling of whichever catalog
-- pushed the series first becomes the canonical display, and every later row
-- that folds to the same slug has its `entry.series` REWRITTEN to it. That is
-- a deliberate refusal to rank the catalogs: no source is "more right" about
-- spelling, and a rule ("prefer the longest", "prefer library") would be a
-- judgement the data cannot support. A wrong canonical display is fixed by a
-- human, and `first_source` records who set it so that conversation has facts.
CREATE TABLE series (
  slug         TEXT PRIMARY KEY,   -- normaliseTitle(display) with spaces as hyphens
  display_name TEXT NOT NULL,      -- the canonical spelling; first writer wins
  first_source TEXT NOT NULL,      -- who created it (audiobook/library/game/backfill)
  created_at   TEXT NOT NULL
);

-- Folds that resolve to a slug they do NOT fold to on their own — the record
-- of every merge a mechanism other than the fold decided.
--   decided_how = 'canon'  data/series-canon.json already recorded this fold,
--                          with evidence, decided by a human (three entries as
--                          of 2026-08-16). Honouring it is not a new judgement.
--               = 'human'  resolved out of series_pending by an approver
--
-- ⚠️ An EXACT-fold merge gets NO row here, deliberately: its two spellings
-- share one fold, so an alias keyed on that fold would be a second key for a
-- match the fold already makes — and the table has one row per fold. What
-- merged exactly is visible where it matters (the rewritten `entry.series`)
-- and counted in the push response, not duplicated into a key space that
-- cannot hold it.
CREATE TABLE series_alias (
  alias_fold    TEXT PRIMARY KEY,  -- normaliseTitle(spelling); never empty
  slug          TEXT NOT NULL,     -- the slug it resolves to; never its own fold's slug
  alias_display TEXT NOT NULL,     -- the spelling as it was seen in the wild
  decided_how   TEXT NOT NULL CHECK (decided_how IN ('canon','human')),
  created_at    TEXT NOT NULL
);
CREATE INDEX ix_series_alias_slug ON series_alias(slug);

-- The confirm queue. A near-miss lands here INSTEAD of being merged, and the
-- candidate is already registered as its own slug — so an unresolved row costs
-- nothing and decides nothing. Silence leaves two series, which is the honest
-- default: an unreviewed guess would be the failure this table exists to
-- prevent.
--
-- ⚠️ Resolved rows STAY, with `resolved_at` set. That is what makes
-- "keep separate" STICKY: the insert is INSERT OR IGNORE on candidate_fold, so
-- a decision already taken is never re-queued on the next push. A queue that
-- re-asks a question a human already answered is a queue nobody reads.
CREATE TABLE series_pending (
  candidate_fold    TEXT PRIMARY KEY,
  candidate_display TEXT NOT NULL,
  candidate_slug    TEXT NOT NULL,   -- it IS registered — near never auto-merges
  closest_slug      TEXT NOT NULL,
  closest_display   TEXT NOT NULL,
  near_key          TEXT NOT NULL,   -- the shared discovery key: evidence, not a score
  sample_titles     TEXT NOT NULL,   -- JSON [{source,title}] — what a human needs to decide
  sources           TEXT NOT NULL,   -- JSON [source] the candidate was seen in
  created_at        TEXT NOT NULL,
  resolved_at       TEXT,
  resolved_as       TEXT CHECK (resolved_as IN ('merged','separate')),
  resolved_by       TEXT             -- the approver's email; NULL while open
);
CREATE INDEX ix_series_pending_open ON series_pending(created_at) WHERE resolved_at IS NULL;
