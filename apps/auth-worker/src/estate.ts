/**
 * The directory's routes (design §4.4, amended by owner decision #6):
 *
 *   POST /api/estate/seen            per-app bearer — answer the check AND queue newcomers
 *   GET  /api/estate/me              the caller's own answer (Firebase ID token,
 *                                    CORS: apex + audiobook site — see index.ts)
 *   GET  /api/estate/users           admin API (approver-gated, CORS: apex only)
 *   POST /api/estate/users           manual pre-seed by email (origin 'manual')
 *   POST /api/estate/users/:id/status
 *   POST /api/estate/users/:id/approver
 *   POST /api/estate/users/:id/visibility   which catalogs the member may SEE (§4.5)
 *   GET/POST /api/estate/site-roles  audiobook site_roles federation (site-roles.ts)
 *   GET  /api/health                 open; counts, no emails
 *
 * ⚠️ There is NO admin page here — the admin UI lives on the apex
 * (heygabi.ai), which is why the admin routes carry CORS for exactly that
 * origin and this host needs no Firebase authorised-domain entry.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { resolveIdentity } from '@platform/estate-auth';
import type { AppBindings, ConsumerApp, EstateUserRow } from './env.js';
import { CONSUMER_APPS, appTokenFor, parseOwnerEmails } from './env.js';
import {
  decideStatus,
  getUserByEmail,
  getUserById,
  listUsers,
  manualCreate,
  seenUpsert,
  setApprover,
  setVisibility,
  statusCounts,
} from './estate-db.js';
import { meAnswer } from './me.js';
import { requireApprover } from './middleware/auth.js';
import { CATALOGS, effectiveVisibility, normalizeVisibility, storedVisibility } from './visibility.js';

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

/**
 * The visibility set as the API speaks it (§4.5): an array of catalog names,
 * normalized to canonical order + deduped on the way in. Empty is legal —
 * an approver may narrow to nothing (the estate's surfaces then show
 * nothing, mirroring the revoked rule).
 */
const visibilitySchema = z.array(z.enum(CATALOGS)).max(20).transform((v) => normalizeVisibility(v));

const statusBodySchema = z
  .object({
    // Approve or revoke — never 'pending' (a decision cannot be un-made into
    // "never decided"; re-approving is how a mistake is corrected) and never
    // a role (the estate answers in/out only).
    status: z.enum(['approved', 'revoked']),
    // Approval-time narrowing (§4.5). Omitted = the stored set stands (all
    // three by default). Meaningless with 'revoked' — refused below, because
    // a revoked person's effective set is {} regardless and a stored narrow
    // set on a revocation would only mislead a later re-approval.
    visibility: visibilitySchema.optional(),
  })
  .strict();

const approverBodySchema = z.object({ is_approver: z.boolean() }).strict();

/** POST /estate/users (manual pre-seed): lowercased, must look like an email. */
const createBodySchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(320)
      .refine((s) => s.includes('@'), 'not an email'),
  })
  .strict();

const visibilityBodySchema = z.object({ visibility: visibilitySchema }).strict();

/**
 * What the admin API shows: the row plus `visibility` — the STORED set (for
 * a pending row, what approval would grant). The raw vis_ flags stay out of
 * the JSON so the array is the one representation consumers see.
 */
function userJson(row: EstateUserRow) {
  const { vis_audiobook, vis_library, vis_games, ...rest } = row;
  return {
    ...rest,
    is_approver: row.is_approver === 1,
    visibility: storedVisibility(row),
  };
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
  // recoverable when the directory is wrong about its own owner. Visibility
  // rides the same rule: an owner sees all three regardless of stored flags,
  // so the break-glass can never be narrowed into a lockout.
  const owners = parseOwnerEmails(c.env.OWNER_EMAILS);
  const isOwner = owners.includes(row.email);
  const status = isOwner ? 'approved' : row.status;

  // §4.5: the EFFECTIVE set, already combined with status — consumers apply
  // it as-is: approved → stored; pending → {audiobook}; revoked → {}.
  const visibility = isOwner ? [...CATALOGS] : effectiveVisibility(status, row);

  return c.json({ status, visibility });
});

// ---------------------------------------------------------------------------
// GET /estate/me — a BROWSER endpoint: the caller asks about THEMSELF with
// their own Firebase ID token (the canonical verifier — iss/aud pinned to the
// shared project). Unlike /seen it enrols nobody, and unlike the admin API it
// gates nothing: an unknown user is answered { status: null }, never an
// error. CORS (apex + audiobook site, ME_ORIGINS) is mounted in index.ts
// BEFORE this handler runs, so the tokenless OPTIONS preflight succeeds —
// the estate learned that ordering the hard way.
// ---------------------------------------------------------------------------
estateRoutes.get('/estate/me', async (c) => {
  let identity;
  try {
    identity = await resolveIdentity(c.req.raw, c.env);
  } catch (err) {
    return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
  }
  if (!identity) return c.json({ error: 'unauthenticated' }, 401);

  const email = identity.email.trim().toLowerCase();
  const owners = parseOwnerEmails(c.env.OWNER_EMAILS);
  const row = await getUserByEmail(c.env.DB, email);
  return c.json(meAnswer(row, owners.includes(email)));
});

// ---------------------------------------------------------------------------
// The admin API — approver-gated. The admin PAGE lives on the apex.
// ---------------------------------------------------------------------------
estateRoutes.get('/estate/users', requireApprover(), async (c) => {
  const users = await listUsers(c.env.DB);
  return c.json({ users: users.map(userJson) });
});

// ---------------------------------------------------------------------------
// POST /estate/users — manual pre-seed by email (owner UI-first rule,
// 2026-08-14): adding a person before their first sign-in never needs a
// script. Creates origin 'manual', status pending; idempotent — an existing
// row (any status) comes back untouched with created:false, so pre-seeding
// can never resurrect a revocation.
// ---------------------------------------------------------------------------
estateRoutes.post('/estate/users', requireApprover(), async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = createBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.slice(0, 5) }, 400);
  }
  const { row, created } = await manualCreate(c.env.DB, {
    email: parsed.data.email,
    actorId: c.get('actor').id,
  });
  return c.json({ user: userJson(row), created }, created ? 201 : 200);
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

  if (parsed.data.visibility && parsed.data.status !== 'approved') {
    return c.json(
      { error: 'invalid_body', detail: 'visibility may only accompany an approval — a revoked person sees {} regardless (§4.5).' },
      400,
    );
  }

  const existing = await getUserById(c.env.DB, id);
  if (!existing) return c.json({ error: 'not_found', id }, 404);

  const updated = await decideStatus(c.env.DB, {
    id,
    status: parsed.data.status,
    actorId: c.get('actor').id,
    visibility: parsed.data.visibility,
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
// POST /estate/users/:id/visibility — set which catalogs the member may SEE
// (§4.5). Narrowing or re-widening after approval; stamps decided_at /
// decided_by like every decision. Status and is_approver are untouched —
// visibility is deliberately NOT a role: apps own what a person may DO.
// ---------------------------------------------------------------------------
estateRoutes.post('/estate/users/:id/visibility', requireApprover(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id' }, 400);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = visibilityBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.slice(0, 5) }, 400);
  }

  const existing = await getUserById(c.env.DB, id);
  if (!existing) return c.json({ error: 'not_found', id }, 404);

  const updated = await setVisibility(c.env.DB, {
    id,
    visibility: parsed.data.visibility,
    actorId: c.get('actor').id,
  });
  return c.json({ user: updated ? userJson(updated) : null });
});

// ---------------------------------------------------------------------------
// GET /health — open by design so a deploy can be curled. Counts, no emails.
//
// ⚠️ Envelope normalization (estate item 5, 2026-08-14): also answers
// `{ ok, service, time, detail }`, `detail` holding this route's pre-existing
// shape verbatim. `users` stays at the top level too — additive only,
// nothing removed this pass; see docs/info/health-envelope.md.
// ---------------------------------------------------------------------------
estateRoutes.get('/health', async (c) => {
  const counts = await statusCounts(c.env.DB);
  // The pre-envelope shape, unchanged — nested under `detail` AND kept at
  // the top level (additive transition, see comment above). Spread FIRST so
  // the explicit envelope fields after it are an intentional override, not
  // a silently-shadowed duplicate (tsc flags the reverse order, TS2783).
  const legacy = { ok: true, users: counts };
  return c.json({
    ...legacy,
    service: 'estate-auth',
    time: new Date().toISOString(),
    detail: legacy,
  });
});
