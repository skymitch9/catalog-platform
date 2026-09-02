/**
 * THE RESOLVER — design §3.3. Pure: no D1, no fetch, no clock.
 *
 * 🔴 THE ONE RULE THIS WHOLE DESIGN RESTS ON: POLICY CAN ONLY DENY.
 *
 * This module's ONLY output is a set of DENIED feature ids. There is no
 * function here that returns "allowed", and that is structural rather than a
 * convention: a caller ANDs this set with the gate it already had
 * (`the code's gate says yes AND policy does not say no`), so there is no code
 * path in which a row in `billing_policy` can open something the capability
 * matrix, the missing secret or the env posture had closed. An `allow` row
 * means *"not denied by this rule"* — it un-denies a broader deny and nothing
 * more.
 *
 * ⚠️ THREE CALLERS, ONE RESOLVER (§3.4). `/seen` answers a Worker about a
 * person, `/me` answers a browser about itself, and
 * `GET /api/estate/billing/policy` answers a cron that has no email to send.
 * All three land here. A second implementation of "most specific wins" is a
 * second set of rules, and the two would disagree on the day it mattered.
 */

import {
  BILLING_FEATURES,
  featuresForSite,
  isBillingFeatureId,
  isBillingSite,
  type BillingSite,
} from './billing-registry.js';

export const PRINCIPAL_KINDS = ['everyone', 'role', 'user', 'system'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export function isPrincipalKind(v: unknown): v is PrincipalKind {
  return typeof v === 'string' && (PRINCIPAL_KINDS as readonly string[]).includes(v);
}

/** A row of `billing_policy`, as D1 hands it back. */
export interface PolicyRule {
  id: number;
  /** A registry id, or `*` for every feature. */
  feature: string;
  /** A site id, or `*` for every site. */
  site: string;
  principal_kind: PrincipalKind;
  /** A rung name, an estate_user id as text, or null for `everyone`/`system`. */
  principal_value: string | null;
  /** 1 = not denied by this rule; 0 = denied. */
  allow: number;
  why: string;
  updated_by: string;
  updated_at: string;
}

/**
 * Who we are resolving for.
 *
 * ⚠️ `system` RESOLVES ALONE (§3.1), and a person never matches a `system`
 * rule. The design's rank table lists all sixteen rungs in one column for
 * completeness, but §3.1 states the separation outright and gives the reason:
 * a cron modelled as `everyone` means switching the cron off also switches the
 * whole household off, which is the opposite of what the owner would mean. The
 * converse holds for the same reason — an `everyone` deny is a statement about
 * PEOPLE, and letting it silently stop an unattended sweep would make the
 * matrix's clock-icon row a lie.
 *
 * ⚠️ This reading is written down rather than inferred because it is the one
 * place a later session could reasonably choose differently, and choosing
 * differently changes what a click does.
 */
export type Principal =
  | {
      kind: 'person';
      /** The estate_user id, as text. Null when the person is not in the directory. */
      userId: string | null;
      /**
       * The app's claim about its OWN user's rung (§3.4) — `local_role` on the
       * `/seen` body. ⚠️ A CLAIM, and exactly the right trust level: the app is
       * the authority on its own ladder, it already holds an app token, and the
       * value is used only to PICK A DENY ROW, never to grant anything. Absent
       * ⇒ `role` rules are skipped and `user`/`everyone` rules still apply, so
       * an old consumer mid-deploy keeps working (§3.5 row 5).
       */
      localRole: string | null;
    }
  | { kind: 'system' };

/**
 * The specificity ladder (§3.3). Lower is more specific; the FIRST match
 * decides. Returns null when the rule cannot apply to this principal at all.
 */
function rank(rule: PolicyRule, site: BillingSite, principal: Principal): number | null {
  // Site and feature must match, exactly or by wildcard.
  const siteExact = rule.site === site;
  if (!siteExact && rule.site !== '*') return null;

  let base: number;
  if (principal.kind === 'system') {
    // ⚠️ system resolves ALONE — a cron matches system rules and nothing else.
    if (rule.principal_kind !== 'system') return null;
    base = 9;
  } else if (rule.principal_kind === 'user') {
    if (principal.userId === null) return null;
    if (rule.principal_value !== principal.userId) return null;
    base = 1;
  } else if (rule.principal_kind === 'role') {
    // Absent local_role ⇒ role rules are unresolvable, so they are SKIPPED,
    // never guessed at. Guessing would deny (or fail to deny) the wrong person.
    if (principal.localRole === null) return null;
    if (rule.principal_value !== principal.localRole) return null;
    base = 5;
  } else if (rule.principal_kind === 'everyone') {
    base = 13;
  } else {
    // A `system` rule facing a person.
    return null;
  }

  const featureExact = rule.feature !== '*';
  // Within a principal rung: exact/exact, exact/*, */exact, */*.
  const offset = featureExact ? (siteExact ? 0 : 1) : siteExact ? 2 : 3;
  return base + offset;
}

/**
 * THE ANSWER: the feature ids denied for this principal on this site.
 *
 * ⚠️ Only features that EXIST on the site are considered — a deny naming a
 * feature that site does not implement is not an error and not reported; it is
 * simply nothing. That keeps `feature = '*'` honest (it means "everything here",
 * not "everything anywhere") and keeps the answer a consumer can trust as a
 * complete list for its own surface.
 *
 * ⚠️ A rule naming an UNKNOWN feature id is IGNORED, not fatal (§3.5 row 4).
 * A registry that has moved on must never brick a Worker. The caller may log
 * it; `unknownFeatures()` below is how the admin page surfaces it.
 */
export function resolveDenied(
  rules: readonly PolicyRule[],
  site: BillingSite,
  principal: Principal,
): string[] {
  const out: string[] = [];
  for (const [id, decision] of resolveDecisions(rules, site, principal)) {
    if (decision.denied) out.push(id);
  }
  return out;
}

export interface BillingDecision {
  denied: boolean;
  /**
   * The exact row that decided, or null when NO rule matched (rank 17 —
   * today's behaviour). ⚠️ Carried because "why was I denied" is otherwise
   * unanswerable, and because the shadow line (§4.1) is worthless without it.
   */
  rule: PolicyRule | null;
}

/**
 * The full per-feature decision for one site and one principal — what
 * `resolveDenied` is a projection of, and what the shadow log and the admin
 * drawer need. Keyed by feature id, in registry order.
 */
export function resolveDecisions(
  rules: readonly PolicyRule[],
  site: BillingSite,
  principal: Principal,
): Map<string, BillingDecision> {
  const out = new Map<string, BillingDecision>();
  for (const feature of featuresForSite(site)) {
    let best: { rank: number; rule: PolicyRule } | null = null;
    for (const rule of rules) {
      if (rule.feature !== '*' && rule.feature !== feature.id) continue;
      const r = rank(rule, site, principal);
      if (r === null) continue;
      // ⚠️ Strictly-less-than, so on a rank TIE the FIRST rule wins. A tie can
      // only happen if the unique index has been bypassed (a hand-edited D1);
      // picking deterministically beats picking by whatever order D1 returned.
      if (best === null || r < best.rank) best = { rank: r, rule };
    }
    // Rank 17 — no rule — is ALLOW, and that is what "default = today's
    // behaviour" means. An empty table changes nothing anywhere.
    out.set(feature.id, { denied: best !== null && best.rule.allow === 0, rule: best?.rule ?? null });
  }
  return out;
}

/**
 * The `/me` answer (§3.4 row 2): the same resolution, for every site at once.
 *
 * ⚠️ A DEPARTURE FROM §3.4's LITERAL WORDING, stated rather than hidden. The
 * design says `/me` gains *"the same array"*, but `/me` has no site — its
 * origins are the apex AND the audiobook site, and a control being drawn on a
 * library page is a different question from one on a games page. A flat union
 * would hide a control on a site where it is allowed; a per-site map answers
 * both callers with no guessing. It is a CURTAIN either way (§3.4: it decides
 * whether a button is drawn, never whether a call is served), so the extra
 * detail costs nothing and removes an ambiguity.
 */
export function resolveDeniedBySite(
  rules: readonly PolicyRule[],
  principal: Principal,
): Record<BillingSite, string[]> {
  const out = {} as Record<BillingSite, string[]>;
  for (const site of ['library', 'library2', 'games', 'audiobook', 'estate'] as const) {
    out[site] = resolveDenied(rules, site, principal);
  }
  return out;
}

/**
 * Rules pointing at a feature id or site the registry no longer knows.
 *
 * ⚠️ Reported, never enforced and never deleted. A row that has drifted out of
 * the registry is a fact the owner should see on the admin page — silently
 * dropping it would mean the panel shows a feature as ON while a row in the
 * table says otherwise, and silently applying it would mean guessing.
 */
export function unknownFeatures(rules: readonly PolicyRule[]): PolicyRule[] {
  return rules.filter(
    (r) => (r.feature !== '*' && !isBillingFeatureId(r.feature)) || (r.site !== '*' && !isBillingSite(r.site)),
  );
}

/** Every feature that names `system` among its principals — the clock-icon rows. */
export function systemFeatureIds(): string[] {
  return BILLING_FEATURES.filter((f) => f.principals.includes('system')).map((f) => f.id);
}

/**
 * THE ENFORCEMENT POSTURE (§4), in the exact idiom of `ESTATE_CHECK`.
 *
 * ⚠️ ANYTHING UNRECOGNISED FALLS TO `off` AND SAYS SO. A typo in a wrangler
 * var must not silently half-enable a money gate; the pattern is
 * `Board_Game_Catalog/apps/worker/src/middleware/estate.ts:86` and it is copied
 * deliberately rather than reinvented.
 *
 *   off      no resolution, no log line, no cost
 *   shadow   resolve, LOG the decision, act on nothing — the call proceeds and bills
 *   enforce  a deny refuses, worded per §6
 *
 * It ships `"off"` everywhere, and a site is flipped one at a time, never as a
 * side effect of an unrelated deploy (§4.2).
 */
export const BILLING_POSTURES = ['off', 'shadow', 'enforce'] as const;
export type BillingPosture = (typeof BILLING_POSTURES)[number];

export function parseBillingPosture(
  raw: string | undefined,
  onUnrecognised?: (value: string) => void,
): BillingPosture {
  if (raw === undefined || raw === '') return 'off';
  const v = raw.trim().toLowerCase();
  if ((BILLING_POSTURES as readonly string[]).includes(v)) return v as BillingPosture;
  onUnrecognised?.(raw);
  return 'off';
}

/**
 * ⚠️ THE SHADOW LINE MUST CARRY AN OUTCOME, OR THE FLIP CRITERION IS
 * UNFALSIFIABLE (§4.1). This is the lesson the estate already paid for once:
 * `reportGate()` fired from a `finally` block with NO outcome field, so the
 * tail could not separate a true regression from the gate merely agreeing with
 * today's rules — and the verdict was *NOT ENOUGH EVIDENCE, do not flip*.
 *
 * `proceeded` is the bit that soak lacked. `est_cents` is what makes a soak
 * measure money that WOULD have been saved rather than a count of events.
 */
export interface BillingDecisionLine {
  evt: 'billing_policy';
  posture: BillingPosture;
  feature: string;
  site: BillingSite;
  principal_kind: PrincipalKind | 'person';
  principal_value: string | null;
  /** ⚠️ The exact row, so "why was I denied" is answerable at all. */
  rule_id: number | null;
  would_deny: boolean;
  /** ⚠️ Whether the call actually happened — the outcome bit. */
  proceeded: boolean;
  /** The code's own estimate for this feature, from the registry. */
  est_cents: string;
}
