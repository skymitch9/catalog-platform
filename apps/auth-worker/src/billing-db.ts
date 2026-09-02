/**
 * Every statement that touches `billing_policy` (0016). The invariants live
 * here so no route can miss one:
 *
 *   - `why` is never empty — the column is NOT NULL and this layer refuses
 *     whitespace too, because `' '` satisfies a NOT NULL and answers nothing
 *   - a rule is upserted on its natural key, never duplicated (ux_billing_policy)
 *   - `updated_by` and `updated_at` are stamped on EVERY write, like every
 *     other decision in this Worker
 *   - ⚠️ rows are DELETED rather than tombstoned, and that is the one place
 *     this table differs from `estate_user`. A membership revocation must
 *     survive re-sign-in, so those rows are immortal; a spending switch has no
 *     such duty — "no rule" IS the default state (§3.3 rank 17), so removing a
 *     rule and never having had one must be indistinguishable, or the table
 *     would slowly fill with allow-rows that mean nothing.
 */

import type { PolicyRule, PrincipalKind } from './billing-policy.js';

const COLS =
  'id, feature, site, principal_kind, principal_value, allow, why, updated_by, updated_at';

/**
 * Every rule in the table. ⚠️ Read WHOLE, not filtered by site, because the
 * resolver needs the `*` wildcards too and a `WHERE site = ?` would silently
 * drop them. The household's table is a handful of rows; the day it is not,
 * the fix is a cache, not a narrower query that changes the answer.
 */
export async function listPolicyRules(db: D1Database): Promise<PolicyRule[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLS} FROM billing_policy
       ORDER BY feature, site, principal_kind, IFNULL(principal_value, ''), id`,
    )
    .all<PolicyRule>();
  return results;
}

export interface PolicyRuleInput {
  feature: string;
  site: string;
  principal_kind: PrincipalKind;
  principal_value: string | null;
  allow: boolean;
  why: string;
  actor: string;
}

/**
 * Create or update the rule for one cell. ⚠️ ON CONFLICT on the natural key,
 * matching `ux_billing_policy` exactly — including the `IFNULL(principal_value,
 * '')` term, without which two contradictory `everyone` rules (both with a NULL
 * principal_value) would both be stored and the resolver would pick one by
 * whatever order D1 happened to return.
 */
export async function upsertPolicyRule(
  db: D1Database,
  input: PolicyRuleInput,
): Promise<PolicyRule | null> {
  const why = input.why.trim();
  if (!why) throw new Error('why is required');
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `INSERT INTO billing_policy
         (feature, site, principal_kind, principal_value, allow, why, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(feature, site, principal_kind, IFNULL(principal_value, '')) DO UPDATE SET
         allow = excluded.allow,
         why = excluded.why,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at
       RETURNING ${COLS}`,
    )
    .bind(
      input.feature,
      input.site,
      input.principal_kind,
      input.principal_value,
      input.allow ? 1 : 0,
      why,
      input.actor,
      now,
    )
    .first<PolicyRule>();
  return row ?? null;
}

/** Remove a rule by id. Returns the row that was removed, or null. */
export async function deletePolicyRule(db: D1Database, id: number): Promise<PolicyRule | null> {
  const row = await db
    .prepare(`DELETE FROM billing_policy WHERE id = ? RETURNING ${COLS}`)
    .bind(id)
    .first<PolicyRule>();
  return row ?? null;
}
