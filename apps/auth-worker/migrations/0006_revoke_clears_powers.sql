-- estate_auth 0006 — a revoked row must carry no live-looking power.
--
-- WHY (owner decision 2026-08-16, decisions 1 and 2 of the demotion/revocation
-- design). `decideStatus()` used to revoke by setting `status = 'revoked'` and
-- deliberately leaving `is_approver` / `is_devops` alone. A mutation-based
-- testing audit found what that cost: `requireApprover()` checked only the
-- flag, with no status check, so a REVOKED approver kept passing the gate that
-- grants and revokes everyone else — and could re-approve themselves.
--
-- Three things now stand between that and happening again, on purpose:
--   1. the gate checks status          (src/middleware/auth.ts, approverAllows)
--   2. revoking clears the flags       (src/estate-db.ts, decideStatus)
--   3. this migration, for rows revoked BEFORE either of those existed
--
-- The audit's own lesson is why all three exist rather than one: the gate had
-- no test, so its silence was mistaken for correctness for as long as it took
-- someone to deliberately break it and look.
--
-- ⚠️ MEASURED BEFORE WRITING, and this is the safest possible moment to run it:
-- the live directory holds 12 approved / 0 pending / 0 REVOKED rows, and the
-- three flagged accounts (both owner accounts + Justin) are all 'approved'.
-- So this statement matches NOTHING today. It exists for the rows that would
-- otherwise be created by a revoke between this migration being written and
-- the code fix reaching production, and as the record of the decision.
--
-- Re-measure before running rather than trusting the paragraph above:
--   wrangler d1 execute estate_auth --remote --command \
--     "SELECT email, status, is_approver, is_devops FROM estate_user \
--      WHERE status = 'revoked' AND (is_approver = 1 OR is_devops = 1)"
--
-- ⚠️ Access-REDUCING, which is why it may run unattended: it can only ever
-- take power away from an account already marked revoked. The reverse
-- direction — restoring a flag — is never done by migration, and re-approval
-- deliberately does NOT restore anything (owner: "they need to reearn all
-- rights"). If this statement over-reaches, the repair is a human granting the
-- flag again through the UI, which is the correct, audited path anyway.
--
-- ⚠️ NOT covered here: the ladder role, which lives in Firestore
-- `site_roles/{uid}` and is untouchable from D1. See site-roles.ts.

UPDATE estate_user
SET is_approver = 0,
    is_devops = 0
WHERE status = 'revoked'
  AND (is_approver = 1 OR is_devops = 1);
