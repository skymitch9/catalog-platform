/**
 * The directory's routes (design §4.4, amended by owner decision #6):
 *
 *   POST /api/estate/seen            per-app bearer — answer the check AND queue newcomers
 *   GET  /api/estate/users           admin API (approver-gated, CORS: apex only)
 *   POST /api/estate/users/:id/status
 *   POST /api/estate/users/:id/approver
 *   GET  /api/health                 open; counts, no emails
 *
 * ⚠️ There is NO admin page here — the admin UI lives on the apex
 * (heygabi.ai), which is why the admin routes carry CORS for exactly that
 * origin and this host needs no Firebase authorised-domain entry.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings, ConsumerApp, EstateUserRow } from './env.js';
import { CONSUMER_APPS, appTokenFor, parseOwnerEmails } from './env.js';
import {
  decideStatus,
  getUserById,
  listUsers,
  seenUpsert,
  setApprover,
  statusCounts,
} from './estate-db.js';
import { requireApprover } from './middleware/auth.js';

/**
 * Bearer-token check. Length-gated `crypto.subtle.timingSafeEqual` — the
 * length itself is not a secret worth hiding, the token bytes are.
 * (Same shape as the index Worker's push tokens.)
 */
async function tokenMatches(header: string | undefined, expected: string): Promise<boolean> {
  if (!header?.startsWith('Bearer ')) return false;
  const given = new TextEncoder().encode(header.slice('Bearer '.length));
  const want = new TextEncoder().encode(expected);
  if (given.byteLength !== want.byteLength) return false;
  return crypto.subtle.timingSafeEqual(given, want);
}

/** Which consumer app is calling, by its bearer token. */
async function identifyApp(
  env: AppBindings['Bindings'],
  header: string | undefined,
): Promise<{ app: ConsumerApp | null; anyConfigured: boolean }> {
  let anyConfigured = false;
  for (const app of CONSUMER_APPS) {
    const expected = appTokenFor(env, app);
    if (!expected) continue;
    anyConfigured = true;
    if (await tokenMatches(header, expected)) return { app, anyConfigured };
  }
  return { app: null, anyConfigured };
}

const seenBodySchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(3)
      .max(320)
      .refine((s) => s.includes('@'), 'not an email'),
    firebase_uid: z.string().min(1).max(200).nullish(),
    display_name: z.string().min(1).max(200).nullish(),
  })
  .strict();

const statusBodySchema = z
  .object({
    // Approve or revoke — never 'pending' (a decision cannot be un-made into
    // "never decided"; re-approving is how a mistake is corrected) and never
    // a role (the estate answers in/out only).
    status: z.enum(['approved', 'revoked']),
  })
  .strict();

const approverBodySchema = z.object({ is_approver: z.boolean() }).strict();

/** What the admin API shows. Everything in the row; there are no secrets in it. */
function userJson(row: EstateUserRow) {
  return { ...row, is_approver: row.is_approver === 1 };
}

export const estateRoutes = new Hono<AppBindings>();

// ---------------------------------------------------------------------------
// POST /estate/seen — the one endpoint that does both jobs: answer the
// membership check and put newcomers in the queue. Per-app bearer, NOT the
// user's token: the app has already verified the token locally, and an
// unauthenticated check endpoint would let anyone probe membership by email.
// ---------------------------------------------------------------------------
estateRoutes.post('/estate/seen', async (c) => {
  const { app, anyConfigured } = await identifyApp(c.env, c.req.header('authorization'));
  if (!anyConfigured) {
    // A missing secret is a configuration error, not an auth failure — say
    // which, so "wrong token" and "no token was ever set" cannot be confused.
    return c.json(
      { error: 'app_tokens_unset', fix: 'wrangler secret put ESTATE_APP_TOKEN_LIBRARY (and _GAMES, _INDEX)' },
      503,
    );
  }
  if (!app) return c.json({ error: 'unauthorized' }, 401);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = seenBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.slice(0, 5) }, 400);
  }

  const row = await seenUpsert(c.env.DB, {
    email: parsed.data.email,
    firebaseUid: parsed.data.firebase_uid ?? null,
    displayName: parsed.data.display_name ?? null,
    app,
  });

  // §4.3: OWNER_EMAILS is approved regardless of table state. Computed, not
  // stored — the row keeps its honest history, the answer keeps the estate
  // recoverable when the directory is wrong about its own owner.
  const owners = parseOwnerEmails(c.env.OWNER_EMAILS);
  const status = owners.includes(row.email) ? 'approved' : row.status;

  return c.json({ status });
});

// ---------------------------------------------------------------------------
// The admin API — approver-gated. The admin PAGE lives on the apex.
// ---------------------------------------------------------------------------
estateRoutes.get('/estate/users', requireApprover(), async (c) => {
  const users = await listUsers(c.env.DB);
  return c.json({ users: users.map(userJson) });
});

estateRoutes.post('/estate/users/:id/status', requireApprover(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id' }, 400);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = statusBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.slice(0, 5) }, 400);
  }

  const existing = await getUserById(c.env.DB, id);
  if (!existing) return c.json({ error: 'not_found', id }, 404);

  const updated = await decideStatus(c.env.DB, {
    id,
    status: parsed.data.status,
    actorId: c.get('actor').id,
  });
  return c.json({ user: updated ? userJson(updated) : null });
});

estateRoutes.post('/estate/users/:id/approver', requireApprover(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id' }, 400);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = approverBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.slice(0, 5) }, 400);
  }

  const existing = await getUserById(c.env.DB, id);
  if (!existing) return c.json({ error: 'not_found', id }, 404);
  if (existing.status !== 'approved' && parsed.data.is_approver) {
    // An approver who is not themselves admitted is incoherent — approve
    // first, then promote. Two calls, both visible.
    return c.json({ error: 'not_approved', detail: 'Approve this person before making them an approver.' }, 409);
  }

  const updated = await setApprover(c.env.DB, {
    id,
    isApprover: parsed.data.is_approver,
    actorId: c.get('actor').id,
  });
  return c.json({ user: updated ? userJson(updated) : null });
});

// ---------------------------------------------------------------------------
// GET /health — open by design so a deploy can be curled. Counts, no emails.
// ---------------------------------------------------------------------------
estateRoutes.get('/health', async (c) => {
  const counts = await statusCounts(c.env.DB);
  return c.json({ ok: true, users: counts });
});
