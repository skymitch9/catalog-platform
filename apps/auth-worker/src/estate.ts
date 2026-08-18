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
 *   POST /api/estate/users/:id/devops       the estate devops capability (0003)
 *   POST /api/estate/users/:id/dev-access   the /dev/ lane grant (0011) —
 *                                    ⚠️ devops implies it; curtain, not lock
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
  setDevAccess,
  setDevops,
  setVisibility,
  statusCounts,
} from './estate-db.js';
import { meAnswer } from './me.js';
import { devAccessAllows, devopsAllows, requireApprover } from './middleware/auth.js';
import { clearSiteRoleOnRevocation, type RoleClearResult } from './site-roles.js';
import { CATALOGS, effectiveVisibility, normalizeVisibility, storedVisibility } from './visibility.js';

/**
 * Bearer-token check. Length-gated `crypto.subtle.timingSafeEqual` — the
 * length itself is not a secret worth hiding, the token bytes are.
 * (Same shape as the index Worker's push tokens.)
 */
export async function tokenMatches(header: string | undefined, expected: string): Promise<boolean> {
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

const devopsBodySchema = z.object({ is_devops: z.boolean() }).strict();

/** 0011 — the dev-lane grant. Same one-boolean shape as the two flips above. */
const devAccessBodySchema = z.object({ dev_access: z.boolean() }).strict();

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
  const { vis_audiobook, vis_library, vis_games, vis_library2, vis_ebooks, ...rest } = row;
  return {
    ...rest,
    is_approver: row.is_approver === 1,
    is_devops: row.is_devops === 1,
    /*
     * 0011 — dev-lane access, reported as BOTH halves on purpose, because the
     * admin page needs to tell them apart and nothing else can:
     *
     *   dev_access            the STORED grant — "granted by hand". This is
     *                         what the Give/Remove dev access button toggles
     *                         and what the badge reports, exactly as
     *                         `is_devops` above is the raw flag.
     *   dev_access_effective  what a gate would honour — the owner's
     *                         *"devops always able to see dev envs"* OR,
     *                         computed by the one implementation
     *                         (devAccessAllows). This is what a devops row
     *                         shows as a FACT where the button would be.
     *
     * ⚠️ Two fields, ONE decision: the page must never OR them together
     * itself. `isOwner` is false here deliberately — this list is the
     * DIRECTORY's answer about a row, and the OWNER_EMAILS break-glass is a
     * property of the caller's identity, not of a stored row; the page already
     * reads the owner list separately (isOwnerEmail) and renders owner rank as
     * a fact everywhere else it appears.
     */
    dev_access: row.dev_access === 1,
    dev_access_effective: devAccessAllows(row, false),
    visibility: storedVisibility(row),
    /*
     * ⚠️ NO `download_ebooks` / `download_ebooks_granted` HERE. They existed
     * for one day (2026-08-17) and left by owner directive: *"For ebooks I
     * don't want a download check box, I want to use roles we have."* The
     * admin page therefore draws NO download control on the Ebooks row — the
     * download grant is the audiobook ROLE dropdown further up the same card
     * (`download` floors at `admin`), and this JSON has no download fact to
     * report because the estate no longer holds one.
     */
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
      { error: 'app_tokens_unset', fix: 'wrangler secret put ESTATE_APP_TOKEN_LIBRARY (and _GAMES, _INDEX, _AUDIOBOOK, _LIBRARY2)' },
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
  // rides the same rule: an owner sees EVERY catalog regardless of stored
  // flags — `library2`'s DEFAULT 0 included, deliberately: the owner is that
  // instance's operator (friend-ingest design §5), and the break-glass can
  // never be narrowed into a lockout.
  const owners = parseOwnerEmails(c.env.OWNER_EMAILS);
  const isOwner = owners.includes(row.email);
  const status = isOwner ? 'approved' : row.status;

  // §4.5: the EFFECTIVE set, already combined with status — consumers apply
  // it as-is: approved → stored; pending → {audiobook}; revoked → {}.
  const visibility = isOwner ? [...CATALOGS] : effectiveVisibility(status, row);

  // 0011: dev-lane access, EFFECTIVE and already combined with status and with
  // the owner break-glass — the same stance `visibility` takes on this answer,
  // and for the same reason: a consumer applies it as-is and never recomputes
  // the owner's *"devops always able to see dev envs"* rule for itself.
  //
  // ⚠️ CURTAIN, NOT LOCK, and this envelope is where that could most easily go
  // wrong. A consumer may use this to decide whether to DRAW a dev surface. It
  // must not be used to decide whether to serve an ebook manifest or a byte
  // range — that is `visibility` containing `ebooks` (0008), which the
  // audiobook Worker already enforces on both lanes.
  const devAccess = devAccessAllows(row, isOwner);

  // ⚠️ 0003/devops, EFFECTIVE — added 2026-08-18 with the GABI docs assistant's
  // phase 3 (design §4.4). The same stance `visibility` and `dev_access` take on
  // this answer, for the same stated reason: **a consumer applies it as-is and
  // never recomputes it.** One field, computed by the one implementation
  // (`devopsAllows`, middleware/auth.ts), already combined with `status` and
  // with the OWNER_EMAILS break-glass.
  //
  // ⚠️ **THIS IS THE OPERATOR LINE, NOT THE CURTAIN.** `dev_access` directly
  // above it means *"may see the /dev/ lane's pages draw themselves"* and is
  // deliberately wider — it includes anyone hand-granted a preview. `devops`
  // means operator standing: devops, approvers, owners, and nobody else. A
  // consumer that wants to know whether someone may read runbooks, break-glass
  // SQL or the estate docs corpus reads THIS field. Reading `dev_access` for
  // that decision would admit exactly the people the gate exists to fence out,
  // which is why the two ride side by side rather than one being derived from
  // the other at the far end.
  //
  // ⚠️ It is an ANSWER, not a gate. The estate docs corpus is gated on the
  // ROUTE (`estate-docs.ts`, door A `requireDevops()` / door B's own check),
  // never on a consumer having seen `true` here — a check the caller performs
  // is a check the caller can skip.
  const devops = devopsAllows(row, isOwner);

  // ⚠️ NO `download_ebooks` on this answer. It rode here for one day
  // (2026-08-17) and was removed the same day: downloading an ebook is a rung
  // on the consuming site's own ladder now, not an estate fact (owner: *"use
  // roles we have… match library"*). `visibility` still carries `ebooks`, which
  // is the whole of what the estate decides about the shelf — seeing it, and
  // reading in the browser viewer.
  return c.json({ status, visibility, dev_access: devAccess, devops });
});

// ---------------------------------------------------------------------------
// POST /estate/hello — BROWSER self-enrollment (added 2026-08-15; incident:
// "someone just signed up on the audiobook site and it didn't pipe into the
// main GABI sso page"). The audiobook site is STATIC — it has no server to
// hold an app token, so unlike library/games (whose Workers call /seen on
// their own sign-in path) its sign-ins never reached the directory; the
// 2026-08-14 migration was a one-time backfill wearing the pipe's clothes,
// and the first post-migration signup (backfilled by hand, origin
// 'seen:audiobook-backfill') proved it.
//
// This is the ongoing pipe. The caller proves who they are with their OWN
// Firebase ID token — the same canonical verifier as /me — and the write is
// seenUpsert, the §4.4 single statement that can NEVER touch status. It can
// enrol only the verified caller, never an arbitrary email, so the
// probe-by-email risk that makes /seen app-token-gated does not exist here:
// you cannot learn anything about anyone but yourself, and about yourself
// /me already answers. Returns the same MeAnswer as /me so a browser needs
// one call, not two. The `app` stamp comes from the request Origin (an
// allow-listed CORS origin, so it is one of ours), giving rows an honest
// 'seen:web:<host>' provenance.
// ---------------------------------------------------------------------------
estateRoutes.post('/estate/hello', async (c) => {
  let identity;
  try {
    identity = await resolveIdentity(c.req.raw, c.env);
  } catch (err) {
    return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
  }
  if (!identity) return c.json({ error: 'unauthenticated' }, 401);

  const email = identity.email.trim().toLowerCase();
  const originHost = (() => {
    try {
      return new URL(c.req.header('origin') ?? '').hostname;
    } catch {
      return 'unknown';
    }
  })();

  const row = await seenUpsert(c.env.DB, {
    email,
    firebaseUid: identity.uid ?? null,
    displayName: identity.name ?? null,
    app: `web:${originHost}`,
  });

  const owners = parseOwnerEmails(c.env.OWNER_EMAILS);
  return c.json(meAnswer(row, owners.includes(email)));
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

  // ── D1 FIRST, ALWAYS. This is the gate that actually admits people:
  // status + is_approver + is_devops, cleared in one statement (estate-db.ts).
  const updated = await decideStatus(c.env.DB, {
    id,
    status: parsed.data.status,
    actorId: c.get('actor').id,
    visibility: parsed.data.visibility,
  });

  // ── THEN THE FIRESTORE HALF, best-effort (owner decision 2026-08-16,
  // ROLES.md §1f). The audiobook site's LADDER role lives in Firestore
  // `site_roles/{uid}`, which its firestore.rules reads directly from the
  // browser — D1 has no say in that check, so revoking without this left a
  // revoked site 'admin' able to delete any review site-wide and to
  // administer claimed clubs, indefinitely.
  //
  // ⚠️ Wired HERE, at the decision, and not inside decideStatus(): that
  // function is one D1 statement and must stay one. There is no transaction
  // across D1 and Firestore, so the order is the design — D1 is cleared
  // first and its success never depends on this landing.
  // clearSiteRoleOnRevocation() never throws; a failure comes back as a
  // sentence in `site_role`, which the admin page shows. The revocation
  // itself has already happened either way.
  let siteRole: RoleClearResult | null = null;
  if (parsed.data.status === 'revoked' && updated) {
    siteRole = await clearSiteRoleOnRevocation(c.env, {
      targetEmail: updated.email,
      actorEmail: c.get('actor').email,
    });
  }

  return c.json({ user: updated ? userJson(updated) : null, ...(siteRole ? { site_role: siteRole } : {}) });
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
// POST /estate/users/:id/devops — flip the estate DEVOPS capability (0003;
// owner order 2026-08-15: the unlisted-runbook + status-page role,
// "associated with the heygabi.ai home page"). Approver-gated like every
// grant; same approve-first coherence rule as the approver flip. What the
// flag UNLOCKS is decided by requireDevops() (middleware/auth.ts): the
// estate docs endpoint and the status page's Operations controls —
// approvers hold both implicitly.
// ---------------------------------------------------------------------------
estateRoutes.post('/estate/users/:id/devops', requireApprover(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id' }, 400);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = devopsBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.slice(0, 5) }, 400);
  }

  const existing = await getUserById(c.env.DB, id);
  if (!existing) return c.json({ error: 'not_found', id }, 404);
  if (existing.status !== 'approved' && parsed.data.is_devops) {
    return c.json({ error: 'not_approved', detail: 'Approve this person before granting devops.' }, 409);
  }

  const updated = await setDevops(c.env.DB, {
    id,
    isDevops: parsed.data.is_devops,
    actorId: c.get('actor').id,
  });
  return c.json({ user: updated ? userJson(updated) : null });
});

// ---------------------------------------------------------------------------
// POST /estate/users/:id/dev-access — flip the estate DEV-LANE grant (0011;
// owner order 2026-08-17: *"i need a way in the estate to manage dev access for
// ebook, add a button for give dev access also make devops always able to see
// dev envs"*).
//
// ⚠️ Written in the /devops route's EXACT shape — approver-gated, one boolean,
// same approve-first coherence rule, same stamped write — because it is the
// same class of decision and a second idiom for it would be one more thing to
// know. `requireApprover()` is the authorization, mirroring the devops flip
// exactly: whoever may make someone devops may grant the dev lane, and nobody
// else. (An APPROVED APPROVER, or OWNER_EMAILS — approverAllows(),
// middleware/auth.ts. A revoked approver is refused by that gate's status
// check, so a revoked person can neither grant this to themselves nor to
// anyone else.)
//
// ⚠️ THIS ROUTE WRITES ONLY THE HAND-GRANTED FLAG. It never materializes the
// devops implication: `dev_access = 0` on a devops row is the CORRECT state,
// and the answer is still true. Granting it to a devops row is legal but
// pointless, so the admin page draws no button there (it renders the fact) —
// the estate's standing rule that a control which cannot change the outcome
// must not be drawn.
//
// ⚠️ Curtain, not lock: what this unlocks is the /dev/ lane's UI. `vis_ebooks`
// (0008) is still the only thing gating ebook bytes, on both lanes.
// ---------------------------------------------------------------------------
estateRoutes.post('/estate/users/:id/dev-access', requireApprover(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id' }, 400);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = devAccessBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues.slice(0, 5) }, 400);
  }

  const existing = await getUserById(c.env.DB, id);
  if (!existing) return c.json({ error: 'not_found', id }, 404);
  if (existing.status !== 'approved' && parsed.data.dev_access) {
    return c.json(
      { error: 'not_approved', detail: 'Approve this person before granting dev access.' },
      409,
    );
  }

  const updated = await setDevAccess(c.env.DB, {
    id,
    devAccess: parsed.data.dev_access,
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
// ⚠️ POST /estate/users/:id/download-ebooks IS GONE — deleted 2026-08-17, one
// day after it shipped, by owner directive: *"For ebooks I don't want a
// download check box, I want to use roles we have. Set up the roles to match
// library."*
//
// There is no replacement route here and there must not be one. Downloading an
// ebook file is a RUNG, not a per-person estate flag: the audiobook Worker's
// `download` capability floors at `admin` (`apps/audiobook-worker/src/
// capabilities.ts`), the same shape the library uses for every capability it
// grants. To let someone download, PROMOTE them on the admin page's audiobook
// role dropdown — the control that already exists — and to take it away,
// demote them. One grant mechanism, one place to look, and a demotion cannot
// leave a stray capability behind.
//
// The estate keeps the half that is genuinely its own: `vis_ebooks`, which
// admits a person to the shelf and to reading in the browser viewer. That
// checkbox is UNCHANGED.
// ---------------------------------------------------------------------------

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
