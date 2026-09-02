/**
 * THE CALL-SITE GATE for this Worker's one money path — E6, the apex shelf
 * scanner (`scan.ts` → `vision.ts`), which `scan.ts`'s own header calls *"the
 * one endpoint that spends real money per call"*.
 *
 * Design: docs/info/llm-billing-control-design.md §4 (enforcement) and §6
 * (what a refusal says). Phase 3, and it ships INERT.
 *
 * ⚠️ IT SHIPS `BILLING_POLICY = "off"` AND MUST. The estate's shadow-first
 * rule is not decoration here: `off` → nothing resolves and nothing is logged;
 * `shadow` → the decision is logged WITH ITS OUTCOME and the call proceeds and
 * bills; `enforce` → a deny refuses, in words. A site is flipped one at a time
 * and never as a side effect of an unrelated deploy (§4.2).
 *
 * ⚠️ THE SHADOW LINE CARRIES `proceeded`, AND THAT FIELD IS THE WHOLE POINT.
 * The estate paid for this lesson once already (`info/audiobook-auth-soak-2026-08-16.md`):
 * `reportGate()` fired from a `finally` with no outcome field, so the tail could
 * not separate a true regression from the gate merely agreeing with today's
 * rules, and the verdict was *NOT ENOUGH EVIDENCE, do not flip*. A soak whose
 * criterion cannot be falsified is not a soak.
 *
 * 🔴 THIS NEVER GRANTS. It answers "does policy say no", and the caller ANDs
 * that with the gate it already had — here `requireEstateMember()`, mounted in
 * index.ts before this route ever runs. Removing that gate because this one
 * exists would be exactly backwards.
 */

import type { Context } from 'hono';
import type { Env } from './env.js';
import type { ScopeVariables } from './middleware/scope.js';

export const BILLING_POSTURES = ['off', 'shadow', 'enforce'] as const;
export type BillingPosture = (typeof BILLING_POSTURES)[number];

/**
 * ⚠️ ANYTHING UNRECOGNISED FALLS TO `off` AND LOGS. Copied deliberately from
 * `Board_Game_Catalog`'s `ESTATE_CHECK` coercion rather than reinvented — a
 * typo in a wrangler var must not silently half-enable a money gate, and must
 * not be silent about it either.
 */
export function billingPosture(raw: string | undefined): BillingPosture {
  if (raw === undefined || raw === '') return 'off';
  const v = raw.trim().toLowerCase();
  if ((BILLING_POSTURES as readonly string[]).includes(v)) return v as BillingPosture;
  console.warn(`BILLING_POLICY is "${raw}", which is not off|shadow|enforce — treating it as "off"`);
  return 'off';
}

/** The estate's site id for this Worker. E6 is an ESTATE path, not a catalog one. */
export const BILLING_SITE = 'estate';

/**
 * Decide, log, and hand back a refusal body when one is owed.
 *
 * Returns `null` to proceed. Returns a body + status when the caller must be
 * refused — never a bare status, per the estate's standing rule: the body says
 * what happened, what it needs and how to get it.
 */
export function billingRefusal(
  c: Context<{ Bindings: Env; Variables: ScopeVariables }>,
  feature: string,
  label: string,
  estCents: string,
): { body: Record<string, unknown>; status: 403 } | null {
  const posture = billingPosture(c.env.BILLING_POLICY);
  if (posture === 'off') return null;

  const denied = c.get('billingDenied');
  // ⚠️ NULL IS "UNKNOWN", AND UNKNOWN PROCEEDS. §3.5 row 3, chosen out loud:
  // denying every paid feature when the directory is unreachable turns an auth
  // outage into a household-wide "everything is broken", which is the failure
  // the estate's wording rule exists to prevent. The exposure is bounded by the
  // ceilings that already exist here — the 5 MB photo cap, the model's own
  // token limits — not by this switch.
  const wouldDeny = Array.isArray(denied) && denied.includes(feature);
  const proceeded = posture !== 'enforce' || !wouldDeny;

  if (wouldDeny || posture === 'shadow') {
    // One JSON line per decision, with every field §4.1 names — `rule_id` is
    // the exception and is deliberately absent: this consumer is handed a
    // resolved SET, not the rules, so it cannot name the row. "Why was I
    // denied" is answerable on the admin page, which holds both.
    console.log(
      JSON.stringify({
        evt: 'billing_policy',
        posture,
        feature,
        site: BILLING_SITE,
        principal_kind: 'person',
        principal_value: c.get('email'),
        would_deny: wouldDeny,
        proceeded,
        est_cents: estCents,
      }),
    );
  }

  if (proceeded) return null;

  return {
    status: 403,
    body: {
      error: 'billing_denied',
      // §6: the SITE sentence, not the person one. This Worker is handed a
      // resolved set and cannot tell which rule produced it — and guessing
      // "switched off for you" when it was switched off for the whole estate
      // would send somebody to ask the owner for something nobody there can
      // grant. When in doubt, say the one that does not waste an evening.
      detail: `${label} is switched off for this catalogue. The owner can turn it back on.`,
      feature,
      needs: 'the estate owner',
      how: 'Ask the owner to switch it back on from the Spending panel on heygabi.ai/admin/. A change takes effect within 10 minutes.',
    },
  };
}
