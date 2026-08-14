-- estate_cache — the index's local membership cache (estate-auth-design.md
-- §5.2). The apps cache the estate's answer as two columns on their own
-- app_user row; the index HAS no app_user (no local roles — membership IS the
-- authorization for its read surface, design §7.1), so this table plays that
-- role: one row per person, holding the estate's last answer and when it
-- arrived. The TTL lives in code (REVOCATION_DELAY_MS = 10 min, the named
-- revocation delay); checked_at is compared against it on every read.
--
-- ⚠️ ADDITIVE, deliberately. Design §14.3 said to fold this into a
-- "still-unapplied" 0001 — that note went stale when 0001 was applied
-- remotely (verified live 2026-08-13: `wrangler d1 migrations list --remote`
-- shows nothing pending). An applied migration is never edited.
--
-- Rows here are a CACHE, never truth (the directory in estate_auth is the
-- truth): losing this table costs one /seen round-trip per person, nothing
-- else. It is safe next to entry's snapshot-DELETE protocol because nothing
-- ever bulk-deletes it — and even if something did, see the previous sentence.

CREATE TABLE estate_cache (
  email        TEXT PRIMARY KEY,   -- lowercased on write; THE join key (design §1.4)
  firebase_uid TEXT,               -- recorded when seen; nothing joins on it
  status       TEXT NOT NULL CHECK (status IN ('pending','approved','revoked')),
  checked_at   TEXT NOT NULL       -- ISO timestamp of the last successful /seen answer
);
