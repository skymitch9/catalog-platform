-- 0012: the conductor's agent board — ONE row, last-write-wins.
--
-- The estate's Claude capacity, pushed from the conductor session on the home
-- machine and rendered by heygabi.ai/status/agents (and /status/processing,
-- which reads the same blob's `processing` section). Design + the JSON
-- contract: docs/info/agent-board-contract.md. Custody of the push secret:
-- docs/access/agent-board.md.
--
-- ⚠️ ONE ROW, ENFORCED BY THE SCHEMA (`CHECK (id = 1)`), not by convention.
-- This is a live snapshot of "what is running right now", never a history
-- table: a second row would mean two answers to a question that has one, and
-- the page would have to pick — which is exactly the kind of silent choice
-- that makes a status surface untrustworthy. The event FEED inside the blob is
-- where history lives, and it is the pusher's job to trim it.
--
-- ⚠️ `board` is the pushed JSON, stored WHOLE and unparsed. The Worker
-- validates that it is an object and that it is not absurdly large, and
-- otherwise stores it byte for byte. That is deliberate: the pipeline that
-- pushes `processing` does not exist yet, so a schema that named today's
-- fields would have to be migrated the day the other side ships. The contract
-- lives in a doc and in the renderer's tolerance, not in D1.
--
-- ⚠️ `pushed_at` is the WORKER'S clock, not the pusher's. A pusher's own
-- timestamp inside the blob can be wrong, stale, or missing; the age this page
-- shows ("as of 2 min ago") must be a fact about when the write actually
-- landed, or the freshness display is worth nothing.
CREATE TABLE IF NOT EXISTS agent_board (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  board      TEXT    NOT NULL,
  pushed_at  TEXT    NOT NULL,
  pushed_by  TEXT
);
