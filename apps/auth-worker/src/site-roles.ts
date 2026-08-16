/**
 * Site-roles federation for the AUDIOBOOK catalog — the estate /admin
 * page's audiobook role cell. Extended 2026-08-16 (ROLES.md §1 in
 * audiobook_catalog, read-only reference there) from the original
 * admin|moderator two-tier model to the full cumulative LADDER:
 *
 *   guest < member < contributor < moderator < admin < owner
 *
 * ⚠️ Renamed mid-build (owner decision, 2026-08-16) from the original
 * viewer/reader naming — see role-ladder.ts's module doc for why, and for
 * the "estate member" (approved in the directory) vs. the `member` ROLE
 * clash that naming deliberately accepted and how to word around it.
 *
 * The decisions (rank, who may grant what) live in role-ladder.ts, pure
 * and unit-tested; this file does the I/O — resolving a uid, reading/
 * writing the Firestore doc — and enforces what role-ladder.ts decides.
 *
 * The audiobook site's roles live in ITS OWN system: Firestore
 * `site_roles/{uid}` docs that firestore.rules consults. Browsers can
 * neither list nor write that collection — so this Worker, holding the
 * Firebase service account as a secret, is the ONLY UI-reachable grant
 * path (scripts/seed_site_admin.py in the audiobook repo remains the
 * break-glass, alongside direct Firestore console edits for 'owner').
 *
 * ⚠️ RULES-ENFORCEMENT LIMITATION (stated here, in role-ladder.ts, and in
 * the build's report — loudly, more than once): firestore.rules is a
 * DIFFERENT repo and is NOT touched by this build. Today those rules
 * understand exactly 'admin' and 'moderator'. Granting 'member' or
 * 'contributor' through this API is fully real — stored, visible, subject
 * to the same escalation rules — but grants NOTHING beyond what an
 * unlisted visitor already has until a firestore.rules change (owner-
 * gated, a separate deliberate deploy) adds clauses for them. See
 * role-ladder.ts's ROLE_CAPABILITIES doc comment for exactly what those
 * clauses would need to cover.
 *
 * Same federation shape as the library/games role cells (design §1.2):
 * per-app vocabulary verbatim, granted/revoked by email, uid resolved via
 * identitytoolkit accounts:lookup at write time so a typo'd uid can never
 * be granted.
 *
 *   GET  /api/estate/site-roles        approver-gated — list current
 *                                       holders + the CALLER's own ladder
 *                                       role + what they may currently
 *                                       grant (browsers can't read
 *                                       Firestore directly; the service
 *                                       account can)
 *   POST /api/estate/site-roles        approver-gated — {email, role}
 *                                       where role is one of SITE_ROLES or
 *                                       null (revoke). Refused (403) unless
 *                                       the CALLER's own ladder role
 *                                       outranks both the role being
 *                                       removed and the role being granted
 *                                       — role-ladder.ts's canGrant().
 *   GET  /api/estate/site-roles/tree   approver-gated — the role ladder +
 *                                       capability map (owner ask: "see a
 *                                       role tree map"). Static data, no
 *                                       Firestore round-trip, so it works
 *                                       even before FIREBASE_SERVICE_ACCOUNT
 *                                       is configured.
 *
 * The two Firestore-backed routes answer 503 `service_account_unset` until
 * the secret is configured — a missing secret is a configuration error,
 * not an auth failure (the /seen app_tokens_unset idiom). /tree does not
 * need the secret at all.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppBindings } from './env.js';
import { parseOwnerEmails } from './env.js';
import { requireApprover } from './middleware/auth.js';
import {
  firestoreRequest,
  lookupUidByEmail,
  mintAccessToken,
  parseServiceAccount,
  type ServiceAccount,
} from './firebase-sa.js';
import {
  canGrant,
  effectiveLadderRole,
  GRANT_FLOOR,
  ROLE_CAPABILITIES,
  ROLE_LADDER,
  SITE_ROLES,
  type LadderRole,
  type SiteRole,
} from './role-ladder.js';
import { logSiteRoleGrant } from './site-roles-db.js';

// Re-exported for backward compatibility — test/site-roles.test.ts and
// anything else importing the vocabulary from this file (its original
// home) keeps working; role-ladder.ts is the one true source now.
export { SITE_ROLES, type SiteRole };

export const roleBodySchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(320)
      .refine((s) => s.includes('@'), 'not an email'),
    // null = revoke. Never free-form: the vocabulary IS the contract with
    // the audiobook site's firestore.rules.
    role: z.enum(SITE_ROLES).nullable(),
  })
  .strict();

/** A site_roles row as the admin page consumes it. */
export interface SiteRoleRow {
  uid: string;
  email: string;
  role: string;
  displayName: string;
  grantedAt: string | null;
  grantedBy: string | null;
}

interface FirestoreDoc {
  name: string;
  fields?: Record<string, { stringValue?: string; timestampValue?: string }>;
}

/** Firestore REST document → row. Pure, so the mapping is testable. */
export function rowFromDoc(doc: FirestoreDoc): SiteRoleRow {
  const f = doc.fields ?? {};
  const s = (key: string): string => f[key]?.stringValue ?? '';
  return {
    uid: doc.name.split('/').pop() ?? '',
    email: s('email'),
    role: s('role'),
    displayName: s('displayName'),
    grantedAt: f['grantedAt']?.timestampValue ?? f['grantedAt']?.stringValue ?? null,
    grantedBy: f['grantedBy']?.stringValue || null,
  };
}

/**
 * The document a grant writes — the same shape seed_site_admin.py seeds
 * (role/email/displayName/grantedAt/grantedBy), so the two grant paths are
 * indistinguishable to the audiobook site. Pure, for tests.
 */
export function siteRoleDocFields(input: {
  role: SiteRole;
  email: string;
  displayName: string;
  actorEmail: string;
  nowIso: string;
}) {
  return {
    role: { stringValue: input.role },
    email: { stringValue: input.email },
    displayName: { stringValue: input.displayName },
    grantedAt: { timestampValue: input.nowIso },
    grantedBy: { stringValue: `estate-admin:${input.actorEmail}` },
  };
}

export const siteRolesRoutes = new Hono<AppBindings>();

/** 503-or-credentials: the one branch both routes share. */
function credentials(c: Context<AppBindings>) {
  const sa = parseServiceAccount(c.env.FIREBASE_SERVICE_ACCOUNT);
  if (!sa) {
    return {
      sa: null,
      unset: c.json(
        { error: 'service_account_unset', fix: 'wrangler secret put FIREBASE_SERVICE_ACCOUNT' },
        503,
      ),
    };
  }
  return { sa, unset: null };
}

/**
 * Read the raw stored `role` string for a uid's site_roles doc — null when
 * there is no doc (a legal, common state: nobody has ever granted this
 * person anything). A real Firestore failure is never swallowed into
 * "no doc"; it comes back as a discriminated failure so the caller answers
 * 502 honestly instead of silently treating an outage as "guest".
 */
async function readStoredRole(
  sa: ServiceAccount,
  token: string,
  uid: string,
): Promise<{ ok: true; role: string | null } | { ok: false; status: number }> {
  const res = await firestoreRequest(sa, token, 'GET', `site_roles/${uid}`);
  if (res.status === 404) return { ok: true, role: null };
  if (!res.ok) return { ok: false, status: res.status };
  const doc = (await res.json()) as FirestoreDoc;
  return { ok: true, role: doc.fields?.role?.stringValue ?? null };
}

/**
 * The CALLER's own ladder role on this ladder — the thing every grant/
 * revoke decision (canGrant, role-ladder.ts) is measured against.
 * OWNER_EMAILS short-circuits without a Firestore round-trip (owner always
 * wins, regardless of any stored doc — role-ladder.ts's effectiveLadderRole
 * doc explains why). Otherwise this resolves the actor's own uid + stored
 * role exactly the way a grant TARGET's is resolved below — an approver
 * who has never signed into the audiobook site with Google has no uid
 * there and so holds no role there either: 'guest', which the grant floor
 * (role-ladder.ts's GRANT_FLOOR) then correctly refuses any grant power to.
 */
async function resolveActorRole(
  sa: ServiceAccount,
  token: string,
  ownerEmails: readonly string[],
  actorEmail: string,
): Promise<{ ok: true; role: LadderRole } | { ok: false; status: number }> {
  if (ownerEmails.includes(actorEmail.trim().toLowerCase())) {
    return { ok: true, role: 'owner' };
  }
  const user = await lookupUidByEmail(sa, token, actorEmail);
  if (!user) return { ok: true, role: 'guest' };
  const stored = await readStoredRole(sa, token, user.uid);
  if (!stored.ok) return stored;
  return {
    ok: true,
    role: effectiveLadderRole({ email: actorEmail, ownerEmails, storedRole: stored.role }),
  };
}

/**
 * Best-effort write to the D1 audit trail (0005, site-roles-db.ts) — every
 * outcome this route reaches: granted, revoked, or denied. NEVER
 * load-bearing: a failure here is logged and swallowed, because by the
 * time this is called the real decision (the Firestore write, or the
 * refusal) has already happened and must not be undone by a logging bug.
 */
async function auditGrant(
  db: D1Database,
  input: {
    actorEmail: string;
    actorRole: LadderRole;
    email: string;
    uid: string | null;
    currentRole: LadderRole;
    role: SiteRole | null;
    outcome: 'granted' | 'revoked' | 'denied';
    reason?: string;
  },
): Promise<void> {
  try {
    await logSiteRoleGrant(db, {
      actorEmail: input.actorEmail,
      actorRole: input.actorRole,
      targetEmail: input.email,
      targetUid: input.uid,
      previousRole: input.currentRole === 'guest' ? null : input.currentRole,
      requestedRole: input.role,
      outcome: input.outcome,
      reason: input.reason ?? null,
    });
  } catch (err) {
    console.error('site_role_grant_log write failed', (err as Error).message);
  }
}

siteRolesRoutes.get('/estate/site-roles', requireApprover(), async (c) => {
  const { sa, unset } = credentials(c);
  if (!sa) return unset!;

  const token = await mintAccessToken(sa);
  const owners = parseOwnerEmails(c.env.OWNER_EMAILS);
  const actor = c.get('actor');

  const actorResolved = await resolveActorRole(sa, token, owners, actor.email);
  if (!actorResolved.ok) return c.json({ error: 'firestore_error', status: actorResolved.status }, 502);
  const actorRole = actorResolved.role;
  // What THIS caller may currently grant/revoke — role-ladder.ts's canGrant,
  // run once per SITE_ROLES entry. The admin UI filters its dropdown to
  // exactly this list rather than re-deriving the ladder client-side.
  const grantable = SITE_ROLES.filter((r) => canGrant(actorRole, r).ok);

  // The whole roster is a handful of docs; one unpaged read is honest here.
  const res = await firestoreRequest(sa, token, 'GET', 'site_roles?pageSize=300');
  if (!res.ok) {
    return c.json({ error: 'firestore_error', status: res.status }, 502);
  }
  const data = (await res.json()) as { documents?: FirestoreDoc[] };
  return c.json({
    roles: SITE_ROLES,
    holders: (data.documents ?? []).map(rowFromDoc),
    actorRole,
    grantable,
  });
});

siteRolesRoutes.post('/estate/site-roles', requireApprover(), async (c) => {
  const { sa, unset } = credentials(c);
  if (!sa) return unset!;

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = roleBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.slice(0, 5) }, 400);
  }
  const { email, role } = parsed.data;

  const token = await mintAccessToken(sa);
  const owners = parseOwnerEmails(c.env.OWNER_EMAILS);
  const actor = c.get('actor');

  const actorResolved = await resolveActorRole(sa, token, owners, actor.email);
  if (!actorResolved.ok) return c.json({ error: 'firestore_error', status: actorResolved.status }, 502);
  const actorRole = actorResolved.role;

  const user = await lookupUidByEmail(sa, token, email);
  if (!user) {
    return c.json(
      {
        error: 'no_firebase_user',
        detail:
          'No Firebase Auth user for that email — they must sign in to the audiobook site with Google once before a role can bind to their account.',
      },
      404,
    );
  }

  const storedTarget = await readStoredRole(sa, token, user.uid);
  if (!storedTarget.ok) return c.json({ error: 'firestore_error', status: storedTarget.status }, 502);
  const currentRole = effectiveLadderRole({ email, ownerEmails: owners, storedRole: storedTarget.role });

  // The escalation gate (role-ladder.ts's canGrant). Checked against BOTH:
  //   1. currentRole — the role being taken away. This alone makes an
  //      'owner' row (via OWNER_EMAILS OR a stray Firestore doc) immune to
  //      ANY grant call, including one from another owner: nothing outranks
  //      'owner', so canGrant always refuses when currentRole is 'owner'.
  //   2. the requested role, for a grant — no self-escalation, no
  //      peer-promotion, and 'owner' is never even reachable here because
  //      roleBodySchema's SITE_ROLES enum does not include it.
  const currentCheck = canGrant(actorRole, currentRole);
  if (!currentCheck.ok) {
    await auditGrant(c.env.DB, {
      actorEmail: actor.email, actorRole, email, uid: user.uid, currentRole, role,
      outcome: 'denied', reason: currentCheck.reason,
    });
    return c.json({ error: 'forbidden', detail: currentCheck.reason }, 403);
  }
  if (role !== null) {
    const newCheck = canGrant(actorRole, role);
    if (!newCheck.ok) {
      await auditGrant(c.env.DB, {
        actorEmail: actor.email, actorRole, email, uid: user.uid, currentRole, role,
        outcome: 'denied', reason: newCheck.reason,
      });
      return c.json({ error: 'forbidden', detail: newCheck.reason }, 403);
    }
  }

  if (role === null) {
    const res = await firestoreRequest(sa, token, 'DELETE', `site_roles/${user.uid}`);
    if (!res.ok) return c.json({ error: 'firestore_error', status: res.status }, 502);
    // The audit line: who revoked what. Log emails/uids, never key material.
    console.log(
      JSON.stringify({
        evt: 'site_role_revoked', actor: actor.email, actorRole, email, uid: user.uid, previousRole: currentRole,
      }),
    );
    await auditGrant(c.env.DB, {
      actorEmail: actor.email, actorRole, email, uid: user.uid, currentRole, role: null, outcome: 'revoked',
    });
    return c.json({ email, uid: user.uid, role: null });
  }

  const fields = siteRoleDocFields({
    role,
    email,
    displayName: user.displayName,
    actorEmail: actor.email,
    nowIso: new Date().toISOString(),
  });
  const res = await firestoreRequest(
    sa,
    token,
    'PATCH',
    `site_roles/${user.uid}`,
    { fields },
  );
  if (!res.ok) return c.json({ error: 'firestore_error', status: res.status }, 502);
  console.log(
    JSON.stringify({
      evt: 'site_role_granted', actor: actor.email, actorRole, email, uid: user.uid, previousRole: currentRole, role,
    }),
  );
  await auditGrant(c.env.DB, {
    actorEmail: actor.email, actorRole, email, uid: user.uid, currentRole, role, outcome: 'granted',
  });
  return c.json({ email, uid: user.uid, role, displayName: user.displayName });
});

/**
 * The role ladder + capability map (owner ask: "see a role tree map").
 * Static data from role-ladder.ts — no Firestore round-trip, so this works
 * even before FIREBASE_SERVICE_ACCOUNT is configured (unlike the two
 * routes above). Approver-gated like every admin-page surface; the admin
 * UI renders this instead of hardcoding the ladder client-side.
 */
siteRolesRoutes.get('/estate/site-roles/tree', requireApprover(), async (c) => {
  return c.json({
    ladder: ROLE_LADDER,
    grantFloor: GRANT_FLOOR,
    capabilities: ROLE_CAPABILITIES,
  });
});
