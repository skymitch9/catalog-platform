-- 0017: universe requests — "+ add a verse" on /universes (design
-- docs/info/universe-add-verse-design.md §3.4).
--
-- Owner ask, 2026-08-24: *"in the universe page add a plus button somewhere to
-- add a verse and let it take series as an input"*
--
-- ⚠️ THE DESIGN CALLED THIS 0016 AND 0016 WAS TAKEN by billing_policy while
-- this sat unbuilt. The number is the only thing that moved; the shape below is
-- the design's, verbatim.
--
-- ⚠️ PURELY ADDITIVE: one CREATE TABLE IF NOT EXISTS on a new object plus its
-- index. No ALTER, no DROP, nothing existing touched — the property that made
-- 0012/0013/0014/0015/0016 safe to apply remotely and unattended, and the one to
-- re-check before any successor.
--
-- 🔴 A ROW HERE IS A REQUEST, NOT A UNIVERSE. The one copy of the universe list
-- is `data/universes.json` in git, compiled into both catalogs at build time and
-- pinned by library_catalog/packages/core/test/universes.test.ts. This table
-- holds what somebody ASKED for; nothing reads it to decide what a universe is,
-- and `universes-single-writer.test.ts` keeps it that way. Making the list
-- runtime-writable was considered and rejected (design §1) — it would delete the
-- git history that is the entire value of the file.
--
-- ⚠️ `why` IS NOT NULL ON PURPOSE. It mirrors `tools/universes.mjs --why`,
-- whose own header says *"an entry that cannot say why it exists is refused"*.
-- The form must not be softer than the CLI, and the column is what makes that
-- true even if a future caller forgets.
--
-- ⚠️ `payload` IS JSON TEXT, STORED WHOLE AND UNPARSED — the same decision
-- estate_prefs (0014) made, for the same stated reason: the shape will grow, and
-- a schema naming today's three lists needs a migration the day a fourth is
-- wanted.
--
-- ⚠️ FOUR STATUSES, NOT THREE, AND THE FOURTH IS THE HONEST ONE. `approved`
-- means the owner said yes. `landed` means the JSON change, the tripwire edit
-- and both catalog deploys are done. Collapsing them would let the page tell a
-- member their verse exists while data/universes.json has not been touched —
-- the shipped-≠-verified failure the estate's own rules name. `withdrawn` is the
-- requester's own exit (design §6 Q4): access-reducing, reversible, costs
-- nothing.
CREATE TABLE IF NOT EXISTS universe_request (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,          -- as typed; never folded on write
  name_key      TEXT    NOT NULL,          -- normalised, for the dup check
  payload       TEXT    NOT NULL,          -- JSON: series[], titles[], notSeries[]
  why           TEXT    NOT NULL,          -- ⚠️ NOT NULL — the CLI's --why, kept
  requested_by  INTEGER NOT NULL REFERENCES estate_user(id),
  requested_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  status        TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','declined','landed','withdrawn')),
  decided_by    INTEGER REFERENCES estate_user(id) ON DELETE SET NULL,
  decided_at    TEXT,
  decided_why   TEXT,                      -- ⚠️ the named reason, back to the requester
  landed_commit TEXT                       -- filled when the git change actually ships
);

CREATE INDEX IF NOT EXISTS ix_universe_request_status ON universe_request(status);

-- ⚠️ NO UNIQUE INDEX ON name_key, DELIBERATELY. A declined request and a later
-- second attempt at the same name are two different facts and both belong in the
-- history; uniqueness here would make the second attempt fail with a database
-- error instead of the worded 409 the route already gives for a name that is
-- ALREADY A UNIVERSE. The open-duplicate check is in the route (one pending row
-- per name), where it can say why in words.
