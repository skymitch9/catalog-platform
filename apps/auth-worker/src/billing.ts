/**
 * The billing-policy routes — phase 1 of docs/info/llm-billing-control-design.md.
 *
 *   GET    /api/estate/billing/policy      per-app bearer — the SYSTEM door
 *   GET    /api/estate/billing/rules       approver-gated — the admin page's read
 *   POST   /api/estate/billing/rules       approver-gated — switch a cell on/off
 *   DELETE /api/estate/billing/rules/:id   approver-gated — remove a rule
 *
 * ⚠️ THE SYSTEM DOOR EXISTS BECAUSE A CRON HAS NO EMAIL TO SEND TO `/seen`
 * (§3.4). It resolves the same rule table through the same function; there is
 * no second implementation, and a `system` rule is the only thing in the estate
 * that can stop an unattended hourly biller without a deploy.
 *
 * ⚠️ Read access follows write access here ON PURPOSE (§9 Q6): the list of who
 * has been switched off is a fact about people, so `requireApprover()` gates
 * both halves — matching every other control on `/admin`.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from './env.js';
import { parseOwnerEmails } from './env.js';
import {
  BILLING_FEATURES,
  BILLING_GROUPS,
  BILLING_GROUP_LABELS,
  BILLING_SITES,
  isBillingFeatureId,
  isBillingSite,
} from './billing-registry.js';
import {
  PRINCIPAL_KINDS,
  resolveDenied,
  unknownFeatures,
  type PolicyRule,
} from './billing-policy.js';
import { deletePolicyRule, listPolicyRules, upsertPolicyRule } from './billing-db.js';
import { getUserById } from './estate-db.js';
import { requireApprover } from './middleware/auth.js';
import { identifyApp, siteForApp } from './estate.js';

export const billingRoutes = new Hono<AppBindings>();

/**
 * ⚠️ `why` IS REQUIRED AND IT IS CHECKED AFTER TRIMMING. `' '` satisfies a
 * NOT NULL column and answers nothing; six months from now the question is
 * *"why does cover search not work on padhard?"* and this column is the only
 * cheap answer there will ever be (§5).
 */
const ruleBodySchema = z
  .object({
    feature: z.string().trim().min(1).max(64),
    site: z.string().trim().min(1).max(32),
    principal_kind: z.enum(PRINCIPAL_KINDS),
    principal_value: z.string().trim().min(1).max(200).nullish(),
    allow: z.boolean(),
    why: z.string().trim().min(3).max(500),
  })
  .strict();

function ruleJson(r: PolicyRule) {
  return { ...r, allow: r.allow === 1 };
}

// ---------------------------------------------------------------------------
// GET /estate/billing/policy — THE SYSTEM DOOR (§3.4 row 3).
//
// A cron, a GitHub Action or the Python pipeline presents its own
// ESTATE_APP_TOKEN_* and gets back the feature ids denied for
// `principal_kind = 'system'` on its site. No email, no identity, no
// person-shaped answer — the whole point is that these paths have no human.
// ---------------------------------------------------------------------------
billingRoutes.get('/estate/billing/policy', async (c) => {
  const { app, anyConfigured } = await identifyApp(c.env, c.req.header('authorization'));
  if (!anyConfigured) {
    // A missing secret is a CONFIGURATION error, not an auth failure — say
    // which, so "wrong token" and "no token was ever set" cannot be confused.
    return c.json(
      {
        error: 'app_tokens_unset',
        fix: 'wrangler secret put ESTATE_APP_TOKEN_LIBRARY (and _GAMES, _INDEX, _AUDIOBOOK, _LIBRARY2)',
      },
      503,
    );
  }
  if (!app) return c.json({ error: 'unauthorized' }, 401);

  const site = siteForApp(app);
  const rules = await listPolicyRules(c.env.DB);
  return c.json({
    site,
    system_denied: resolveDenied(rules, site, { kind: 'system' }),
    // ⚠️ Stated on the wire so a cron's own log can say how stale its copy may
    // be. §3.4: the switch-off delay is ten minutes, the same number as the
    // revocation delay, and it is the same number on purpose.
    cache_seconds: 600,
  });
});

// ---------------------------------------------------------------------------
// GET /estate/billing/rules — everything the Spending panel needs in ONE call:
// the registry (so the page never holds a second copy of the feature list) and
// the rules. ⚠️ The page must not build its own registry — that is exactly the
// `research.cover` drift the pin test exists to catch, one layer up.
// ---------------------------------------------------------------------------
billingRoutes.get('/estate/billing/rules', requireApprover(), async (c) => {
  const rules = await listPolicyRules(c.env.DB);
  const unknown = unknownFeatures(rules);
  return c.json({
    features: BILLING_FEATURES,
    sites: BILLING_SITES,
    groups: BILLING_GROUPS.map((g) => ({ id: g, label: BILLING_GROUP_LABELS[g] })),
    rules: rules.map(ruleJson),
    // Rows pointing at an id the registry no longer knows. Reported, never
    // enforced and never auto-deleted (§3.5 row 4) — silently dropping one
    // would show a feature as ON while a row says otherwise.
    unknown: unknown.map(ruleJson),
    /**
     * ⚠️ The page MUST say this out loud. A panel that implies "instantly"
     * invites the owner to press it twice (§3.4).
     */
    effect_delay_note: 'A change takes effect within 10 minutes — the same delay as a revocation.',
  });
});

// ---------------------------------------------------------------------------
// POST /estate/billing/rules — switch a cell on or off.
// ---------------------------------------------------------------------------
billingRoutes.post('/estate/billing/rules', requireApprover(), async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = ruleBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.slice(0, 5) }, 400);
  }
  const { feature, site, principal_kind, allow, why } = parsed.data;
  const principal_value = parsed.data.principal_value ?? null;

  if (feature !== '*' && !isBillingFeatureId(feature)) {
    // ⚠️ Refused at the DOOR rather than stored and ignored. A rule naming an
    // unknown id is tolerated when it is already in the table (a registry that
    // moved on must not brick a Worker), but writing a fresh one is a typo, and
    // a typo'd deny is a switch the owner believes he pressed.
    return c.json(
      {
        error: 'unknown_feature',
        detail: `There is no money path called “${feature}”. Pick one from the panel, or use * for every feature on this site.`,
      },
      400,
    );
  }
  if (site !== '*' && !isBillingSite(site)) {
    return c.json(
      { error: 'unknown_site', detail: `There is no site called “${site}”. Sites are: ${BILLING_SITES.join(', ')}, or * for all.` },
      400,
    );
  }

  // Principal coherence. `everyone` and `system` resolve alone and carry no
  // value; `role` and `user` are meaningless without one.
  if ((principal_kind === 'everyone' || principal_kind === 'system') && principal_value !== null) {
    return c.json(
      { error: 'invalid_body', detail: `A ${principal_kind} rule names nobody — leave principal_value null.` },
      400,
    );
  }
  if ((principal_kind === 'role' || principal_kind === 'user') && principal_value === null) {
    return c.json(
      { error: 'invalid_body', detail: `A ${principal_kind} rule needs a principal_value (${principal_kind === 'role' ? 'a rung name' : 'an estate user id'}).` },
      400,
    );
  }

  if (principal_kind === 'user') {
    const id = Number(principal_value);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'invalid_body', detail: 'A user rule’s principal_value must be an estate user id.' }, 400);
    }
    const target = await getUserById(c.env.DB, id);
    if (!target) return c.json({ error: 'not_found', detail: `No estate member with id ${id}.` }, 404);
    // 🔴 THE BREAK-GLASS CANNOT BE NARROWED INTO A LOCKOUT. `OWNER_EMAILS` is
    // approved-and-approver regardless of table state (§4.3), and §7.2 says the
    // owner's row draws every control disabled. That is a UI rule; this is the
    // one that actually holds, because a UI rule is one fetch away from being
    // bypassed. A spend switch is not the place to start locking out the owner.
    if (!allow && parseOwnerEmails(c.env.OWNER_EMAILS).includes(target.email)) {
      return c.json(
        {
          error: 'owner_not_deniable',
          detail:
            'That account is an estate owner, and an owner’s spending cannot be switched off — the break-glass must never be narrowable into a lockout. Switch the feature off for the site instead.',
        },
        409,
      );
    }
  }

  const row = await upsertPolicyRule(c.env.DB, {
    feature,
    site,
    principal_kind,
    principal_value,
    allow,
    why,
    actor: c.get('actor').email,
  });
  return c.json({ rule: row ? ruleJson(row) : null });
});

// ---------------------------------------------------------------------------
// DELETE /estate/billing/rules/:id — remove a rule. "No rule" is the default
// state (§3.3 rank 17), so removing one and never having had one must be
// indistinguishable; a tombstone here would be a row that means nothing.
// ---------------------------------------------------------------------------
billingRoutes.delete('/estate/billing/rules/:id', requireApprover(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id' }, 400);
  const row = await deletePolicyRule(c.env.DB, id);
  if (!row) return c.json({ error: 'not_found', id }, 404);
  return c.json({ removed: ruleJson(row) });
});
