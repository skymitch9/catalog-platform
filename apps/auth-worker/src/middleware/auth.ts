import type { MiddlewareHandler } from 'hono';
import { resolveIdentity } from '@platform/estate-auth';
import type { AppBindings, EstateUserRow } from '../env.js';
import { parseOwnerEmails } from '../env.js';
import { getUserByEmail, materializeOwnerRow } from '../estate-db.js';

/**
 * The admin gate: a verified Firebase ID token (the same canonical verifier
 * every consumer uses — this Worker eats its own dog food, design §4.4)
 * PLUS `is_approver` on the directory row or membership of `OWNER_EMAILS`.
 *
 * ⚠️ No first-sign-in-claims bootstrap, deliberately unlike the apps
 * (design §4.3): an empty table admits NOBODY except `OWNER_EMAILS`. The
 * way in never depends on the thing being changed.
 */
export function requireApprover(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    let identity;
    try {
      identity = await resolveIdentity(c.req.raw, c.env);
    } catch (err) {
      return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
    }
    if (!identity) return c.json({ error: 'unauthenticated' }, 401);

    const email = identity.email.trim().toLowerCase();
    const ownerEmails = parseOwnerEmails(c.env.OWNER_EMAILS);
    const isOwner = ownerEmails.includes(email);

    let row: EstateUserRow | null = await getUserByEmail(c.env.DB, email);

    if (!row?.is_approver && !isOwner) {
      return c.json(
        {
          error: 'forbidden',
          detail: 'Approving estate members requires an approver account.',
        },
        403,
      );
    }

    // An OWNER_EMAILS actor may have no row yet (fresh directory, or the
    // break-glass path during an incident). Materialize one so decided_by
    // has an id to stamp — the bootstrap becoming a fact in the table.
    if (!row) {
      row = await materializeOwnerRow(c.env.DB, {
        email,
        firebaseUid: identity.uid,
        displayName: identity.name,
      });
    }

    c.set('actor', row);
    await next();
  };
}
