-- 0021 — the estate probe suite's run history (owner ask 2026-09-05 16:50
-- Phoenix, "then do the scripts you think are the best for routes"; candidate
-- #4 of docs/info/scripts-inventory-2026-09-05.md §7).
--
-- `tools/estate-probes` now runs on an hourly cron in this Worker as well as
-- from a terminal. A run that nobody reads is a run that did not happen, so
-- each one leaves a row here and GET /api/health reports the newest under
-- `detail.estateProbes`; the apex /status page renders one line from it.
--
-- ⚠️ ONE ROW PER RUN, NOT ONE PER PROBE. 145 assertions × 24 runs a day is
-- 3,480 rows a day for a surface that only ever shows the newest run and its
-- first few failures. The failures are stored as a small JSON array on the run
-- row instead — capped when it is written (estate-probes.ts), so a total
-- outage cannot write a megabyte of identical "did not answer" strings.
--
-- ⚠️ `total` IS STORED, not derived from passed+failed at read time. A
-- truncated run (the wall-clock deadline fired between areas) has a smaller
-- total than a whole one, and "9 of 145" versus "145 of 145" is the difference
-- between an outage and a clean bill of health. Deriving it would quietly turn
-- the first into the second.

CREATE TABLE IF NOT EXISTS estate_probe_run (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   TEXT    NOT NULL,
  finished_at  TEXT    NOT NULL,
  passed       INTEGER NOT NULL,
  failed       INTEGER NOT NULL,
  total        INTEGER NOT NULL,
  -- 1 when the deadline stopped the run before every area was asked.
  -- ⚠️ A truncated run must never be rendered as green: the checks that were
  -- not asked are UNKNOWN, and unknown is not a pass.
  truncated    INTEGER NOT NULL DEFAULT 0,
  areas_run    INTEGER NOT NULL DEFAULT 0,
  areas_total  INTEGER NOT NULL DEFAULT 0,
  -- JSON array of the first N failures: [{area, id, endpoint, assertion, observed}]
  failures     TEXT    NOT NULL DEFAULT '[]',
  -- 'cron' | 'manual' — how this run was started, so a hand-triggered run
  -- cannot be mistaken for evidence that the clock is still ticking.
  trigger      TEXT    NOT NULL DEFAULT 'cron',
  -- Set when the run itself threw rather than merely failing probes. NULL on a
  -- normal run. ⚠️ "the suite crashed" and "every probe failed" are different
  -- sentences with different fixes and must stay distinguishable.
  error        TEXT
);

-- The only query the read path makes is "the newest run", and the only query
-- the write path makes is "delete everything older than the newest N".
CREATE INDEX IF NOT EXISTS idx_estate_probe_run_id_desc ON estate_probe_run(id DESC);
