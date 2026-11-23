/**
 * The estate MEMBER ROSTER — a machine door for the two library Workers.
 *
 *   GET /api/estate/members   per-app bearer, LIBRARY / LIBRARY2 ONLY
 *
 * Why it exists (owner, 2026-11-22): *"I want you to write code to allow me to
 * lend books to estate members even if they can't view it. Pulling accounts
 * from estate is fine for assignment"*. A library records a loan against a
 * person; a person who has never signed into that library has no `app_user`
 * row there, so the library asks the estate who its approved members are.
 * The consumer half lives in `bookbuddy/library_catalog`.
 *
 * ⚠️ THIS ANSWER CARRIES EMAIL ADDRESSES, so three things are deliberate:
 *
 *   1. **Default-deny by an explicit allowlist of TWO apps.** Not "any app
 *      token": the games, index and audiobook Workers hold valid estate
 *      bearers too, and none of them has a reason to read the roster. A new
 *      consumer app joining `CONSUMER_APPS` gets nothing here until someone
 *      adds it to `ROSTER_APPS` on purpose.
 *   2. **An explicit three-field projection** — in the SELECT and again in the
 *      mapper. Never `SELECT *` minus exclusions: that form leaks the day a
 *      column is added (roles, flags, visibility, timestamps, photo).
 *   3. **No CORS mount** (index.ts). Nothing in a browser calls this; a CORS
 *      line would make a browser-reachable copy of the estate's email list.
 *
 * The bearer comparison is `tokenMatches()` from estate.ts and the secret
 * lookup is `appTokenFor()` from env.ts — one implementation of each. The
 * refusal shapes follow `GET /api/estate/billing/policy` and
 * `GET /api/estate/catalogs`.
 */

import { Hono } from 'hono';
import type { AppBindings, ConsumerApp } from './env.js';
import { appTokenFor } from './env.js';
import { tokenMatches } from './estate.js';

export const estateMembersRoutes = new Hono<AppBindings>();

/** ⚠️ The ONLY apps that may read the roster. Default-deny for every other. */
export const ROSTER_APPS = ['library', 'library2'] as const satisfies readonly ConsumerApp[];

/** The wire shape. Exactly these three keys, nothing else, ever. */
export interface RosterMember {
  id: number;
  email: string;
  display_name: string | null;
}

/** The columns read. Kept beside the mapper so the two cannot drift apart. */
const ROSTER_COLUMNS = ['id', 'email', 'display_name'] as const;

/**
 * Approved rows only — `estate_user.status` is `pending | approved | revoked`
 * (0001_init.sql's CHECK). Pending and revoked people are never returned.
 */
export async function listApprovedMembers(db: D1Database): Promise<RosterMember[]> {
  const { results } = await db
    .prepare(`SELECT ${ROSTER_COLUMNS.join(', ')} FROM estate_user WHERE status = 'approved'`)
    .all<{ id: number; email: string; display_name: string | null }>();
  return sortRoster(results.map(toMember));
}

/** Explicit field-by-field copy — a row with extra columns cannot pass them through. */
export function toMember(r: { id: number; email: string; display_name: string | null }): RosterMember {
  return {
    id: Number(r.id),
    // Stored lower-cased already (estate-db.ts normalizeEmail); done again here
    // because the contract promises it and a hand-edited row would break it.
    email: String(r.email).trim().toLowerCase(),
    display_name: typeof r.display_name === 'string' ? r.display_name : null,
  };
}

/**
 * Display name case-insensitively, then email. ⚠️ A member with NO display
 * name sorts AFTER every named one (SQLite would put NULLs first), so a
 * picker's top rows are the people it can show a name for.
 *
 * Plain code-unit comparison of the lower-cased strings, not `localeCompare`:
 * the order must not depend on the runtime's locale data.
 */
export function sortRoster(members: RosterMember[]): RosterMember[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...members].sort((a, b) => {
    const an = a.display_name?.toLowerCase() ?? null;
    const bn = b.display_name?.toLowerCase() ?? null;
    if (an !== bn) {
      if (an === null) return 1;
      if (bn === null) return -1;
      const byName = cmp(an, bn);
      if (byName !== 0) return byName;
    }
    return cmp(a.email, b.email);
  });
}

estateMembersRoutes.get('/estate/members', async (c) => {
  const header = c.req.header('authorization');

  let anyConfigured = false;
  let allowed = false;
  for (const app of ROSTER_APPS) {
    const expected = appTokenFor(c.env, app);
    if (!expected) continue;
    anyConfigured = true;
    if (await tokenMatches(header, expected)) {
      allowed = true;
      break;
    }
  }

  if (!anyConfigured) {
    // A missing secret is a CONFIGURATION error, not an auth decision — say
    // which, so "wrong token" and "no token was ever set" cannot be confused.
    // ⚠️ Judged on the TWO roster secrets only: GAMES or INDEX being set says
    // nothing about whether a library could ever be let in.
    return c.json(
      {
        error: 'app_tokens_unset',
        detail:
          'This Worker holds neither library app token, so it cannot check yours. ' +
          'That is our configuration, not a decision about your token.',
        fix: 'wrangler secret put ESTATE_APP_TOKEN_LIBRARY (and/or ESTATE_APP_TOKEN_LIBRARY2) on estate-auth',
      },
      503,
    );
  }

  if (!allowed) {
    return c.json(
      {
        error: 'unauthorized',
        detail:
          'The estate member roster is read only by the two library Workers, with their own app token. ' +
          'That bearer is not one of them — other estate apps are refused here on purpose, because the ' +
          'roster carries email addresses.',
        fix: 'present ESTATE_APP_TOKEN_LIBRARY or ESTATE_APP_TOKEN_LIBRARY2 as Authorization: Bearer <token>',
      },
      401,
    );
  }

  const members = await listApprovedMembers(c.env.DB);
  return c.json({ members });
});
