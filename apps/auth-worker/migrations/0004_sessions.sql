-- estate_auth 0004 — the session service (sso-design.md §4.3/§8 Phase 2).
--
-- One row per browser session created by POST /api/session (an ID-token
-- exchange after interactive sign-in on ANY estate surface). The opaque id
-- IS the estate_session cookie value — Domain=.heygabi.ai, so any other
-- *.heygabi.ai origin that finds it can ask POST /api/session/token for a
-- freshly minted Firebase custom token (5 min, §3.3) and get a normal local
-- Firebase session there via signInWithCustomToken — the actual SSO half of
-- the design (option c). This table is purely a convenience/sign-in layer:
-- NO Worker anywhere trusts this cookie for authorization — enforcement
-- stays Firebase ID token + estate directory, exactly as before (§6, §7.1).
--
-- Rows are never deleted, only revoked (`revoked_at` stamped) — the same
-- accountability argument as estate_user (0001): a DELETE /api/session
-- sign-out, or a future admin per-device revoke (§9 Q4 / Phase 4), should
-- leave a record that a session existed and when it ended, not erase it.
--
-- `firebase_uid` is NOT NULL because it is the one thing
-- POST /api/session/token mints a custom token FOR — a session row that
-- could not name a uid could not do its one job, so it is required at
-- INSERT time rather than checked at every read.
--
-- ⚠️ 0003_devops.sql took the last number (read before writing this one) —
-- this is 0004. Applied locally by `npm run db:migrate:local`; the remote
-- apply (`wrangler d1 migrations apply estate_auth --remote`) is this
-- build's own, since this table is additive/new and touches no existing
-- table or column.
CREATE TABLE estate_session (
  id             TEXT    PRIMARY KEY,                          -- opaque 128-bit random id (base64url) — the cookie's own value
  email          TEXT    NOT NULL,                              -- lowercased; audit/display only, not a join key here
  firebase_uid   TEXT    NOT NULL,                              -- the uid POST /api/session/token mints a custom token for
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at   TEXT    NOT NULL DEFAULT (datetime('now')),    -- bumped on every successful mint — the "rolling" half of 30-day rolling (owner Q6)
  expires_at     TEXT    NOT NULL,                              -- created_at + 30d initially; rolled forward with last_used_at
  revoked_at     TEXT                                           -- stamped by DELETE /api/session; NULL = still live
);

-- Supports a future "list my sessions" / admin per-device revoke (§9 Q4,
-- Phase 4) without a table scan. Added now, not later: an index on an
-- empty table costs nothing, but one on a populated table costs a rebuild.
CREATE INDEX idx_estate_session_email ON estate_session(email);
