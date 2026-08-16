-- estate_auth 0005 — the audit trail for the audiobook site-roles LADDER
-- (ROLES.md §1 in audiobook_catalog, read-only reference there; the ladder
-- itself is implemented in src/role-ladder.ts and lives entirely in
-- Firestore `site_roles/{uid}` docs — this table adds NOTHING to that
-- storage and changes NO existing table or column).
--
-- WHY A D1 TABLE FOR A FIRESTORE-BACKED FEATURE: the Firestore doc only
-- ever holds the CURRENT grant's stamp (`grantedAt`/`grantedBy`) — a PATCH
-- overwrites the previous grant with no history, and a REFUSED attempt
-- (someone trying to escalate past their own rank) leaves no record at
-- all. This table is that missing history: every attempt POST
-- /api/estate/site-roles makes, granted, revoked, or denied, who tried it,
-- what role was at stake, and — on a denial — why. Same "3am rollback
-- source of truth" instinct as deploys.log; never load-bearing (a write
-- failure here must never fail the real Firestore grant — see
-- src/site-roles-db.ts).
--
-- `actor_role` / `previous_role` / `requested_role` store LADDER role
-- strings ('guest' through 'owner') as free text, not a foreign key into
-- anything — the ladder's vocabulary lives in role-ladder.ts, not the
-- database schema, exactly like `estate_user.status` (0001) is a CHECK
-- constraint rather than a lookup table at this household's scale. ⚠️ The
-- bottom two role names were renamed mid-build (viewer→guest, reader→
-- member, owner decision 2026-08-16) AFTER this migration had already run
-- (both local and --remote) but BEFORE any real grant/revoke ever POSTed
-- to production — the table was still empty (checked; see the build
-- report), so this is a comment-only wording fix, not a data migration.
-- The DDL itself never named a role string (free text, no CHECK on these
-- columns), so the schema needed no change either way.
--
-- ⚠️ 0004_sessions.sql took the last number (read before writing this one)
-- — this is 0005. Applied locally by `npm run db:migrate:local`; the
-- remote apply (`wrangler d1 migrations apply estate_auth --remote`) is
-- this build's own, since this table is additive/new and touches no
-- existing table or column.
CREATE TABLE site_role_grant_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  actor_email    TEXT    NOT NULL,                                    -- who attempted the change
  actor_role     TEXT    NOT NULL,                                    -- the actor's OWN ladder role at the time, computed (owner via OWNER_EMAILS or their stored site_roles doc)
  target_email   TEXT    NOT NULL,                                    -- whose role was being changed
  target_uid     TEXT,                                                -- the audiobook site's Firebase uid for target_email, when resolvable
  previous_role  TEXT,                                                -- the role target_email held before this call; NULL = viewer (no doc)
  requested_role TEXT,                                                -- the role requested; NULL = a revoke request
  outcome        TEXT    NOT NULL CHECK (outcome IN ('granted', 'revoked', 'denied')),
  reason         TEXT                                                 -- populated on 'denied' — the same detail string the 403 response carried
);

-- The read this table exists to answer: "what happened to this person's
-- audiobook role over time" / "who has ever tried to touch this person".
CREATE INDEX idx_site_role_grant_log_target ON site_role_grant_log(target_email);

-- The other read: "what has this actor been doing" — including denied
-- escalation attempts, the one thing Firestore's overwrite-in-place
-- doc can never show.
CREATE INDEX idx_site_role_grant_log_actor ON site_role_grant_log(actor_email);
