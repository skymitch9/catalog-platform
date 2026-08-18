-- 0014: estate preferences — small, owner-set settings the CONDUCTOR reads.
--
-- Owner ask, 2026-08-18 (item 7): choose which event classes are worth a
-- notification on his phone — an agent landing, a nightly window completing,
-- anything going red, the archive finishing.
--
-- ⚠️ WHY THIS IS NOT A SECTION OF THE AGENT BOARD, which was the obvious place.
-- The board flows ONE WAY: machines push, people read. Preferences flow the
-- other way — a person sets them in a browser and a machine obeys. Putting them
-- in the board would mean either (a) the browser holding the conductor's push
-- token, which is a machine credential that must never reach a page, or (b) the
-- next push from the home machine silently overwriting whatever he just
-- toggled, because the board is one last-write-wins blob. Both are worse than a
-- table.
--
-- ⚠️ PURELY ADDITIVE: one CREATE TABLE IF NOT EXISTS on a new object. No ALTER,
-- no DROP, nothing existing touched — the same property that made 0012 and 0013
-- safe to apply remotely and unattended, and the one to re-check before any
-- successor.
--
-- ⚠️ ONE ROW PER KEY, VALUE IS JSON TEXT, stored whole and unparsed — the same
-- decision as the agent board's `board` column and for the same reason: the set
-- of notification classes will grow, and a schema naming today's four would
-- need a migration the day a fifth is wanted. The contract lives in a doc and
-- in the renderer's tolerance.
CREATE TABLE IF NOT EXISTS estate_prefs (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
