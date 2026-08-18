-- 0015: the worker event ring — a capped, structured log every estate Worker
-- can write to and /status can render.
--
-- Owner, 2026-08-18, clicking into a health check and finding the placeholder:
-- **"fix this."** The plan had been on file since the /status split; this is it.
--
-- ⚠️ WHY D1 AND NOT "JUST USE WRANGLER TAIL". `wrangler tail` is live-only: it
-- shows what happens while you are watching, and the whole point of this
-- surface is the thing that happened at 3am when nobody was. Cloudflare's
-- Workers Logs retains more, but it cannot be read from a static page without
-- an account token, which is exactly the credential /status must not hold.
--
-- ⚠️ PURELY ADDITIVE: one CREATE TABLE IF NOT EXISTS on a new object, plus its
-- index. No ALTER, no DROP, nothing existing touched — the property that made
-- 0012/0013/0014 safe to apply remotely and unattended.
--
-- ⚠️ CAPPED PER WORKER, TRIMMED ON WRITE. An unbounded log table on a shared
-- ops database is a slow-motion outage: it grows until D1's limits bite, and it
-- takes the estate directory down with it. The cap is per WORKER rather than
-- global on purpose — one noisy Worker having a bad night must not evict every
-- other Worker's history, which is precisely when you need the others to
-- compare against.
--
-- ⚠️ `at` IS THE WORKER'S OWN CLOCK AT THE MOMENT OF THE EVENT, and the write
-- door stamps `received_at` from ITS clock. They can differ, and keeping both
-- is what lets a reader tell "this happened a while ago and was only just
-- reported" from "this happened just now" — the same two-clock discipline the
-- agent board uses for `pushed_at` versus each section's own timestamps.
CREATE TABLE IF NOT EXISTS worker_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  worker       TEXT    NOT NULL,
  level        TEXT    NOT NULL,
  message      TEXT    NOT NULL,
  at           TEXT    NOT NULL,
  received_at  TEXT    NOT NULL,
  route        TEXT,
  request_id   TEXT,
  detail       TEXT
);

-- The read is always "newest N for this worker" and the trim is "everything
-- past N for this worker", so both want the same index.
CREATE INDEX IF NOT EXISTS worker_events_by_worker_id ON worker_events (worker, id DESC);
