/**
 * Site-roles federation for the AUDIOBOOK catalog (three-tier model,
 * 2026-08-14) — the estate /admin page's audiobook role cell.
 *
 * The audiobook site's roles live in ITS OWN system: Firestore
 * `site_roles/{uid}` docs that firestore.rules consults (role 'admin' =
 * everything incl. site-wide review removal; role 'moderator' = the
 * operational club subset). Browsers can neither list nor write that
 * collection — so this Worker, holding the Firebase service account as a
 * secret, is the ONLY UI-reachable grant path (scripts/seed_site_admin.py
 * in the audiobook repo remains the break-glass).
 *
 * Same federation shape as the library/games role cells (design §1.2):
 * per-app vocabulary verbatim — 'admin' | 'moderator', granted/revoked by
 * email, uid resolved via identitytoolkit accounts:lookup at write time so
 * a typo'd uid can never be granted.
 *
 *   GET  /api/estate/site-roles   approver-gated — list current holders
 *                                 (browsers can't; the service account can)
 *   POST /api/estate/site-roles   approver-gated — {email, role} where role
 *                                 is 'admin' | 'moderator' | null (revoke)
 *
 * Both answer 503 `service_account_unset` until the secret is configured —
 * a missing secret is a configuration error, not an auth failure (the
 * /seen app_tokens_unset idiom).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppBindings } from './env.js';
import { requireApprover } from './middleware/auth.js';
import {
  firestoreRequest,
  lookupUidByEmail,
  mintAccessToken,
  parseServiceAccount,
} from './firebase-sa.js';

export const SITE_ROLES = ['admin', 'moderator'] as const;
export type SiteRole = (typeof SITE_ROLES)[number];

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

siteRolesRoutes.get('/estate/site-roles', requireApprover(), async (c) => {
  const { sa, unset } = credentials(c);
  if (!sa) return unset!;

  const token = await mintAccessToken(sa);
  // The whole roster is a handful of docs; one unpaged read is honest here.
  const res = await firestoreRequest(sa, token, 'GET', 'site_roles?pageSize=300');
  if (!res.ok) {
    return c.json({ error: 'firestore_error', status: res.status }, 502);
  }
  const data = (await res.json()) as { documents?: FirestoreDoc[] };
  return c.json({ roles: SITE_ROLES, holders: (data.documents ?? []).map(rowFromDoc) });
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

  const actor = c.get('actor');
  if (role === null) {
    const res = await firestoreRequest(sa, token, 'DELETE', `site_roles/${user.uid}`);
    if (!res.ok) return c.json({ error: 'firestore_error', status: res.status }, 502);
    // The audit line: who revoked what. Log emails/uids, never key material.
    console.log(
      JSON.stringify({ evt: 'site_role_revoked', actor: actor.email, email, uid: user.uid }),
    );
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
    JSON.stringify({ evt: 'site_role_granted', actor: actor.email, email, uid: user.uid, role }),
  );
  return c.json({ email, uid: user.uid, role, displayName: user.displayName });
});
