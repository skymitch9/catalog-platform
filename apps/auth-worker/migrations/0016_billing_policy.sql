-- 0016: billing policy — "who and what is ALLOWED to bill" (design
-- docs/info/llm-billing-control-design.md §3.4).
--
-- Owner ask, 2026-08-24: *"we need a way to toggle what can bill the LLM and
-- what can't inside the admin page somewhere. and even finer than that, i want
-- to be able to determine which features can bill and which can't per site per
-- user etc"*
--
-- ⚠️ PURELY ADDITIVE: one CREATE TABLE IF NOT EXISTS on a new object plus its
-- unique index. No ALTER, no DROP, nothing existing touched — the property that
-- made 0012/0013/0014/0015 safe to apply remotely and unattended, and the one
-- to re-check before any successor.
--
-- 🔴 AN EMPTY TABLE IS EXACTLY TODAY'S BEHAVIOUR (§3.3 rank 17: no rule =
-- allow). The estate ships with this table empty and nothing changes anywhere
-- until the owner switches something off. That is what makes the migration safe
-- to apply ahead of the Worker that reads it, per the estate's own
-- migrate-before-deploy guard.
--
-- 🔴 POLICY CAN ONLY DENY, and `allow` being a column does not weaken that.
-- An `allow = 1` row means *"not denied by THIS rule"* — it can un-deny a
-- broader deny (switch `sweep.details` off estate-wide, then back on for
-- `games` alone) and it can NEVER open a call the code's own gate closes. The
-- resolver returns a set of DENIED ids and every call site ANDs it with the
-- gate it already had, so there is no code path where a row here grants
-- anything. The reason is the estate's standing rule: access-REDUCING orders
-- act immediately, access-INCREASING ones get confirmed — and this table is
-- reachable through a browser.
--
-- ⚠️ `why` IS NOT NULL ON PURPOSE (§5). A switched-off feature is INVISIBLE:
-- six months from now, *"why does cover search not work on padhard?"* has
-- exactly one cheap answer and it is this column. Without it the answer is a
-- bisect. The same discipline `tools/universes.mjs --why` already enforces.
-- ⚠️ It is the owner's INTERNAL note and may name people — no refusal shown to
-- a person ever quotes it (§6 is what a person sees).
--
-- ⚠️ `principal_kind = 'system'` IS THE FOURTH PRINCIPAL AND IT IS NOT
-- OPTIONAL. L8, G7, A4, A5, A8 and A9 have no human at all. Modelling them as
-- `everyone` would mean switching a cron off also switches the whole household
-- off, which is the opposite of what the owner would mean — so `system`
-- resolves alone (§3.1), through its own door
-- (GET /api/estate/billing/policy), on the app's own token.
CREATE TABLE IF NOT EXISTS billing_policy (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  feature         TEXT    NOT NULL,           -- a registry id, or '*'
  site            TEXT    NOT NULL,           -- a site id, or '*'
  principal_kind  TEXT    NOT NULL
                          CHECK (principal_kind IN ('everyone','role','user','system')),
  principal_value TEXT,                       -- rung name | estate_user id | NULL
  allow           INTEGER NOT NULL CHECK (allow IN (0, 1)),
  why             TEXT    NOT NULL,
  updated_by      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One rule per cell. `IFNULL(principal_value, '')` is what makes the
-- `everyone` rows (whose principal_value is NULL) collide with each other —
-- without it SQLite treats every NULL as distinct and the table would happily
-- hold two contradictory `everyone` rules for the same cell.
CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_policy
  ON billing_policy(feature, site, principal_kind, IFNULL(principal_value, ''));
