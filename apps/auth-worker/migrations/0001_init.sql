-- estate_auth 0001 — the estate directory (estate-auth-design.md §4.2).
--
-- One row per person the estate has ever seen. Rows are NEVER deleted:
-- a revoked person who re-signs-in must meet their revocation, not a fresh
-- 'pending' row that an approver might wave through by mistake. (Same
-- reasoning as change_log keeping no FK on entity_id: accountability
-- survives the object.)
--
-- Status is a three-value FACT, not a role. The estate answers in/out;
-- the apps answer what/here — role vocabularies stay app-local forever
-- (design §1.2, §3). `revoked` is distinct from deletion and distinct from
-- `pending`: a revoked person re-appearing must not look like a newcomer.
CREATE TABLE estate_user (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,        -- lowercased on write; THE join key (design §1.4)
  firebase_uid   TEXT    UNIQUE,                 -- recorded when seen; nothing joins on it (§1.4)
  display_name   TEXT,
  status         TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','revoked')),
  -- Approvers manage the guest list. Deliberately a flag, not a role
  -- vocabulary: the estate answers in/out, apps answer what/here (§3).
  -- Promotion is an admin-API call, never a redeploy (owner decision #4).
  is_approver    INTEGER NOT NULL DEFAULT 0,
  -- Where this row came from: 'seed:library' | 'seed:games' | 'seed:admin'
  -- | 'seen:library' | 'seen:games' | 'seen:index' | 'manual'.
  -- The honesty column, house style (decided_how / changed_how / read_state_how).
  origin         TEXT    NOT NULL,
  note           TEXT,
  first_seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_at     TEXT,
  decided_by     INTEGER REFERENCES estate_user(id) ON DELETE SET NULL
);
