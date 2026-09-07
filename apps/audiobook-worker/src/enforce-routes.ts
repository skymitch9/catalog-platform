/**
 * Phase 3 wave A — the destructive/role-gated write routes (migration design
 * §1's "worker" rows, §5 Phase 3a), PREBUILT WHILE THE SHADOW SOAKS and
 * ⚠️ DORMANT BY CONSTRUCTION: every route here is mounted behind
 * `requireEnforceMode` (enforce-gate.ts) — in 'off'/'shadow' the answer is
 * 503 not_enabled and NOTHING below the gate runs. Only the owner's flip of
 * ESTATE_CHECK to 'enforce' (an explicit, deliberate act — never a deploy
 * side effect) makes these handlers reachable.
 *
 * ## What each handler writes — the SAME writes rules let browsers do today
 *
 * The service account bypasses firestore.rules, so each handler mirrors the
 * exact Firestore mutations the site's own JS performs under today's rules
 * (cited per route: the clubs.js/club-reads.js/reviews.js function and the
 * firestore.rules clause that currently admits it). That mirroring is what
 * lets rules deploy #1 (§5 Phase 3b, owner-gated, NOT part of this build)
 * later close those clauses without the site losing a single behaviour: the
 * worker is the second door to the same rooms, becoming the only door when
 * the rules close.
 *
 * Two deliberate, documented deltas from the browser paths:
 *  - `serverTimestamp()` becomes the worker's own clock (`new Date()`): the
 *    worker IS the server; the field shape (timestampValue) is identical.
 *  - removeRead's blind-ratings cleanup is COMPLETE here (the SA can list
 *    the subcollection rules hide from browsers), where the client's is
 *    best-effort — strictly less orphan data, same end state.
 *  - `refreshClubAvatar` (a member-open presentation write) stays with the
 *    client, exactly as §1 keeps every member-open surface browser-direct.
 *
 * ## Route inventory (ENFORCE_ROUTES below is the machine-readable copy)
 *
 * reviews:            DELETE /api/reviews/:docId                    removeAnyReview
 * club doc:           PATCH  /api/clubs/:clubId                     manageClub / operateClub (per field tier)
 *                     DELETE /api/clubs/:clubId                     manageClub
 * webhook:            PUT    /api/clubs/:clubId/webhook             administerClub (island ON since 2026-08-17)
 *                     DELETE /api/clubs/:clubId/webhook             administerClub (island ON since 2026-08-17)
 * manager claim:      POST   /api/clubs/:clubId/managers/claim      the claimManager rule (unclaimed: any session; claimed: moderator+)
 * member ops:         PUT    /api/clubs/:clubId/members/:slug/role  operateClub
 *                     DELETE /api/clubs/:clubId/members/:slug       operateClub
 *                     POST   /api/clubs/:clubId/requests/:slug/accept  operateClub
 *                     DELETE /api/clubs/:clubId/requests/:slug      operateClub
 *                     POST   /api/clubs/:clubId/invites             operateClub
 * read lifecycle:     PUT    /api/clubs/:clubId/reads/:readId/schedule        operateClub
 *                     POST   /api/clubs/:clubId/reads/:readId/finish          operateClub (MANAGECLUB SPLIT, 2026-08-17)
 *                     DELETE /api/clubs/:clubId/reads/:readId                 operateClub (MANAGECLUB SPLIT, 2026-08-17)
 *                     POST   /api/clubs/:clubId/reads/:readId/reveal-ratings  operateClub (MANAGECLUB SPLIT, 2026-08-17)
 * polls:              POST   /api/clubs/:clubId/polls               operateClub
 *                     PUT    /api/clubs/:clubId/polls/:pollId/status  operateClub
 *                     DELETE /api/clubs/:clubId/polls/:pollId       operateClub
 * discussion mod:     DELETE /api/clubs/:clubId/reads/:readId/comments/:commentId  operateClub
 *                     DELETE /api/clubs/:clubId/reads/:readId/quotes/:quoteId      operateClub
 * content notes:      DELETE /api/warnings/:docId            the note's OWN author (warning.selfDelete)
 *                     DELETE /api/warnings/:docId/moderate   operateClub (warning.modDelete)
 *
 * ## The 2026-09-07 gap close (agent W15-AB-ENFORCE) — the last four
 *
 * The bottom four rows are new. They close a gap Phase 3a RECORDED rather than
 * invented: `comment.modDelete`, `quote.modDelete`, `warning.selfDelete` and
 * `warning.modDelete` each had an entry in `ACTION_GATES` (gate-shadow.ts) and
 * NO enforce route, so the soak was measuring a surface enforcement could not
 * reach. ⚠️ NOT ONE FLOOR MOVED to build them — every route runs the gate the
 * shadow has been logging, unchanged, exactly as the other eighteen do.
 *
 * ⚠️ `review.submit`/`review.update` stay absent, deliberately. They are
 * `{kind:'signedIn'}` — Phase 5's measurement of the tokenless population, not
 * a role gate — so a route for them would enforce nothing a browser does not
 * already have to prove.
 *
 * ⚠️ The two DISCUSSION routes are the MODERATION half ONLY, which is what
 * their action names say. An author deleting their OWN comment or quote is a
 * member-open write with no shadow action and no rules clause to mirror; it
 * stays browser-direct on both paths. `user-warnings.js` makes the same split
 * explicit by carrying two actions, and here it is two routes.
 *
 * (§1 also names `read.setSlot` in the shadow vocabulary; no client write
 * path exists for it today — measured against club-reads.js 2026-08-16 — so
 * there is deliberately no route to mirror. Every lane is `?lane=dev`-aware.)
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from './env.js';
import {
  createFsDoc,
  deleteFsDoc,
  fsScalar,
  fsString,
  fsStringArray,
  getFsDoc,
  laneFrom,
  listFsDocIds,
  mapValueFields,
  patchFsDoc,
  quoteFieldPath,
  rawArrayValues,
  readModifyWrite,
  reviewsCollectionFor,
  toFsFields,
  toFsValue,
  userWarningsCollectionFor,
  type FsValue,
  type JsValue,
  type RmwResult,
} from './fs-docs.js';
import { requireEnforceMode, runEnforceGate } from './enforce-gate.js';
import { clubCollectionFor } from './roles.js';

/* ── the machine-readable route table (the dormancy tests iterate it) ──── */

export interface EnforceRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** The ACTION_GATES vocabulary entry the gate runs (gate-shadow.ts). */
  action: string;
}

export const ENFORCE_ROUTES: readonly EnforceRoute[] = [
  { method: 'DELETE', path: '/api/reviews/:docId', action: 'review.delete' },
  { method: 'PATCH', path: '/api/clubs/:clubId', action: 'club.updateStructural' },
  { method: 'DELETE', path: '/api/clubs/:clubId', action: 'club.delete' },
  { method: 'PUT', path: '/api/clubs/:clubId/webhook', action: 'club.setWebhook' },
  { method: 'DELETE', path: '/api/clubs/:clubId/webhook', action: 'club.clearWebhook' },
  { method: 'POST', path: '/api/clubs/:clubId/managers/claim', action: 'club.claimManager' },
  { method: 'PUT', path: '/api/clubs/:clubId/members/:slug/role', action: 'club.setMemberRole' },
  { method: 'DELETE', path: '/api/clubs/:clubId/members/:slug', action: 'club.removeMember' },
  { method: 'POST', path: '/api/clubs/:clubId/requests/:slug/accept', action: 'club.acceptRequest' },
  { method: 'DELETE', path: '/api/clubs/:clubId/requests/:slug', action: 'club.rejectRequest' },
  { method: 'POST', path: '/api/clubs/:clubId/invites', action: 'club.inviteMember' },
  { method: 'PUT', path: '/api/clubs/:clubId/reads/:readId/schedule', action: 'club.setSchedule' },
  { method: 'POST', path: '/api/clubs/:clubId/reads/:readId/finish', action: 'read.finish' },
  { method: 'DELETE', path: '/api/clubs/:clubId/reads/:readId', action: 'read.remove' },
  { method: 'POST', path: '/api/clubs/:clubId/reads/:readId/reveal-ratings', action: 'read.revealRatings' },
  { method: 'POST', path: '/api/clubs/:clubId/polls', action: 'poll.create' },
  { method: 'PUT', path: '/api/clubs/:clubId/polls/:pollId/status', action: 'poll.setStatus' },
  { method: 'DELETE', path: '/api/clubs/:clubId/polls/:pollId', action: 'poll.delete' },
  // The 2026-09-07 gap close — see the module doc.
  {
    method: 'DELETE',
    path: '/api/clubs/:clubId/reads/:readId/comments/:commentId',
    action: 'comment.modDelete',
  },
  {
    method: 'DELETE',
    path: '/api/clubs/:clubId/reads/:readId/quotes/:quoteId',
    action: 'quote.modDelete',
  },
  { method: 'DELETE', path: '/api/warnings/:docId', action: 'warning.selfDelete' },
  { method: 'DELETE', path: '/api/warnings/:docId/moderate', action: 'warning.modDelete' },
] as const;

/* ── shared vocabulary and small helpers ──────────────────────────────── */

/**
 * ⚠️ Keep in step with FEATURE_DEFAULTS in audiobook_catalog/site/clubs.js —
 * the same allow-list that keeps a stale client from stuffing arbitrary data
 * under `features` (updateClubDetails drops unknown keys; so do we).
 *
 * ⚠️ AND THE DRIFT IS SILENT IN THE WORST DIRECTION, which is why this note
 * now exists: a key present on the client and MISSING here is not refused, it
 * is DROPPED — the manager unticks a box, the PATCH succeeds, and the setting
 * comes back on the next render. Measured 2026-09-06, wiring Phase 3a's
 * client half: `discordQuestions` (added to the client 2026-08-18 with GABI's
 * Discord questions, and a live checkbox at club.html:2003) was absent here
 * and would have silently vanished the first time a manager saved the Edit
 * Club modal on the Worker path. Added below.
 *
 * The list is 8 keys and the site's `FEATURE_DEFAULTS` is 8 keys; a test in
 * enforce-routes.test.ts pins both the membership and the count, so the next
 * feature key added on one side fails here rather than in somebody's club.
 */
export const CLUB_FEATURE_KEYS = [
  'readingSchedule',
  'discordAnnouncements',
  'discordPollAnnouncements',
  'polls',
  'blindRatings',
  'meetingRsvp',
  'paceGraph',
  // Added 2026-09-06 — see the drift note above. `app/club_announcements.py`
  // and club.html have both read/written it since 2026-08-18.
  'discordQuestions',
] as const;

/** clubs.js isValidDiscordWebhook / rules validClubSettings, one regex. */
const DISCORD_WEBHOOK_RE =
  /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;

/** clubs.js maskWebhookUrl: display-safe last-4 tail. */
export function maskWebhookUrl(url: string): string {
  const u = (url || '').trim();
  return u ? `…${u.slice(-4)}` : '';
}

/** identity.js slugifyName — display name → doc id, verbatim. */
const slugifyName = (displayName: string): string => displayName.toLowerCase();

type Ctx = Context<{ Bindings: Env }>;

/** A Firestore failure mid-write is an OUTAGE answer, never a permission one. */
function writeOutage(c: Ctx, status: number): Response {
  return c.json(
    {
      error: 'firestore_error',
      status,
      detail:
        'Firestore did not accept the write. This is an outage, not a permission ' +
        'decision — the action may be partially applied; retry shortly.',
    },
    502,
  );
}

function invalid(c: Ctx, detail: string): Response {
  return c.json({ error: 'invalid_request', detail }, 400);
}

function notFound(c: Ctx, what: string): Response {
  return c.json({ error: 'not_found', detail: `${what} not found.` }, 404);
}

async function jsonBody(c: Ctx): Promise<Record<string, unknown> | null> {
  try {
    const raw = (await c.req.json()) as unknown;
    return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Unwrap a readModifyWrite outcome into a Response, or null on success. */
function rmwResponse(c: Ctx, result: RmwResult): Response | null {
  if (!result.ok) return writeOutage(c, result.status);
  if (result.refused) {
    return c.json(
      { error: result.refused.error, detail: result.refused.detail },
      result.refused.status as 404 | 409,
    );
  }
  return null;
}

/* ── the router ───────────────────────────────────────────────────────── */

export const enforceRoutes = new Hono<{ Bindings: Env }>();

// ⚠️ THE DORMANCY GATE — mounted on EVERY write prefix, before anything
// that could touch Firestore. Deliberately NOT `use('*')`: this router is
// merged into the main app, and a wildcard here would swallow /api/me and
// /api/health into the 503 (breaking Phases 0–2 while dormant). Every route
// below lives under one of these three prefixes; the per-route dormancy tests
// pin that (a route added outside them fails its 503 test immediately).
//
// ⚠️ `/api/warnings/*` joined 2026-09-07 WITH the two content-note routes, and
// that pairing is the whole discipline: a new prefix added without its line
// here is a route that WRITES IN SHADOW MODE — the one failure the dormancy
// gate exists to prevent. The dormancy suite catches it, per route, per mode.
enforceRoutes.use('/api/reviews/*', requireEnforceMode);
enforceRoutes.use('/api/clubs/*', requireEnforceMode);
enforceRoutes.use('/api/warnings/*', requireEnforceMode);

/* ── reviews ──────────────────────────────────────────────────────────── */

/**
 * DELETE /api/reviews/:docId — the highest-value gate: the write a revoked
 * admin could still exercise via rules (the 2026-08-16 incident). Mirrors
 * reviews.js deleteReview (deleteDoc on `{bookId}_{displayNameLower}`),
 * admitted today by firestore.rules `allow delete: if isSiteAdmin()`
 * (/reviews line 475; /reviews_dev line 682). Capability: removeAnyReview
 * (admin+), estate-checked — the revoked-admin hole, closed.
 */
enforceRoutes.delete('/api/reviews/:docId', async (c) => {
  const gate = await runEnforceGate(c, 'review.delete', null);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const docId = c.req.param('docId');
  const del = await deleteFsDoc(
    sa,
    saToken,
    `${reviewsCollectionFor(lane)}/${encodeURIComponent(docId)}`,
  );
  if (!del.ok) return writeOutage(c, del.status);
  return c.json({ success: true });
});

/* ── club doc: tiered field update + delete ───────────────────────────── */

/**
 * PATCH /api/clubs/:clubId — the gated tiers of clubs.js updateClubDetails.
 * Accepts ONLY the rules-gated fields (member-editable name/description/
 * emoji/… stay browser-direct per §1): STRUCTURAL joinMode/features
 * (clubStructuralFieldsChanged → canManageClub, rules 534–535) and
 * OPERATIONAL nextMeetingAt/nextMeetingNotes (clubOperationalFieldsChanged →
 * canOperateClub, rules 536). RESTRICTED fields are refused here — they have
 * their own doors (webhook routes, claim route), mirroring rules 537.
 *
 * One gate decision: when any structural field is present the action is
 * club.updateStructural (manageClub); otherwise club.setNextMeeting
 * (operateClub). Passing manageClub implies operateClub for every holder
 * (floors admin ≥ moderator; club managers hold both), so the single
 * strictest check covers a mixed update exactly as rules' per-tier AND does.
 */
enforceRoutes.patch('/api/clubs/:clubId', async (c) => {
  const body = await jsonBody(c);
  if (!body) return invalid(c, 'A JSON object body is required.');

  const STRUCTURAL = ['joinMode', 'features'];
  const OPERATIONAL = ['nextMeetingAt', 'nextMeetingNotes'];
  const RESTRICTED = ['discordWebhookMask', 'managerUids'];
  const keys = Object.keys(body);
  if (keys.length === 0) return invalid(c, 'No fields to update.');
  for (const k of keys) {
    if (RESTRICTED.includes(k)) {
      return invalid(
        c,
        `"${k}" is a RESTRICTED field with its own endpoint (webhook: PUT/DELETE ` +
          '/api/clubs/:clubId/webhook; managers: POST /api/clubs/:clubId/managers/claim).',
      );
    }
    if (!STRUCTURAL.includes(k) && !OPERATIONAL.includes(k)) {
      return invalid(
        c,
        `"${k}" is not a worker-gated club field — member-editable fields stay ` +
          'browser-direct (migration design §1).',
      );
    }
  }

  // Validation mirrors updateClubDetails clause by clause.
  const updates: Record<string, JsValue> = {};
  if ('joinMode' in body) {
    if (body['joinMode'] !== 'open' && body['joinMode'] !== 'application') {
      return invalid(c, 'Invalid join mode.');
    }
    updates['joinMode'] = body['joinMode'];
  }
  if ('features' in body) {
    const f = body['features'];
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      return invalid(c, 'Invalid features map.');
    }
    const cleaned: Record<string, JsValue> = {};
    for (const key of CLUB_FEATURE_KEYS) {
      if (key in (f as Record<string, unknown>)) {
        cleaned[key] = Boolean((f as Record<string, unknown>)[key]);
      }
    }
    updates['features'] = cleaned;
  }
  if ('nextMeetingAt' in body) {
    const v = body['nextMeetingAt'];
    if (v !== null && !(typeof v === 'number' && Number.isFinite(v))) {
      return invalid(c, 'Invalid meeting time.');
    }
    updates['nextMeetingAt'] = v as number | null;
  }
  if ('nextMeetingNotes' in body) {
    const notes = String(body['nextMeetingNotes'] ?? '').trim();
    if (notes.length > 500) {
      return invalid(c, 'Meeting notes must be 500 characters or less.');
    }
    updates['nextMeetingNotes'] = notes;
  }

  const structural = STRUCTURAL.some((k) => k in updates);
  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(
    c,
    structural ? 'club.updateStructural' : 'club.setNextMeeting',
    clubId,
  );
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;

  const clubPath = `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}`;
  const existing = await getFsDoc(sa, saToken, clubPath);
  if (!existing.ok) return writeOutage(c, existing.status);
  if (existing.value === null) return notFound(c, 'Club');

  const patched = await patchFsDoc(sa, saToken, clubPath, toFsFields(updates), {
    fieldPaths: Object.keys(updates),
  });
  if (!patched.ok) return writeOutage(c, patched.status);
  return c.json({ success: true });
});

/**
 * DELETE /api/clubs/:clubId — clubs.js deleteClub verbatim: delete every
 * members/{slug} doc, then the club doc (subcollections beyond members are
 * left exactly as the client leaves them). Admitted today by rules
 * `allow delete: if canManageClub(resource.data)` (line 541; dev 727).
 */
enforceRoutes.delete('/api/clubs/:clubId', async (c) => {
  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'club.delete', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const clubPath = `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}`;

  const existing = await getFsDoc(sa, saToken, clubPath);
  if (!existing.ok) return writeOutage(c, existing.status);
  if (existing.value === null) return notFound(c, 'Club');

  const members = await listFsDocIds(sa, saToken, `${clubPath}/members`);
  if (!members.ok) return writeOutage(c, members.status);
  for (const id of members.value) {
    const del = await deleteFsDoc(sa, saToken, `${clubPath}/members/${encodeURIComponent(id)}`);
    if (!del.ok) return writeOutage(c, del.status);
  }
  const del = await deleteFsDoc(sa, saToken, clubPath);
  if (!del.ok) return writeOutage(c, del.status);
  return c.json({ success: true });
});

/* ── club administration: webhook (island-held) + the roster claim ────── */

/**
 * PUT /api/clubs/:clubId/webhook — clubs.js setClubDiscordWebhook: the full
 * URL into the browser-unreadable settings/discord doc (rules: `allow
 * create, update: if validClubSettings() && canAdministerClub(...)`, lines
 * 582–583; the doc's `read: if false` is the security control and the URL
 * never returns to a browser), then the masked tail onto the club doc
 * (clubWebhookFieldChanged → canAdministerClub). Gate: administerClub, which
 * since 2026-08-17 the CLUB ISLAND holds — a bound manager of THIS club may
 * set its webhook without site-wide rank, and moderator+ overrides anywhere.
 * A manager of a DIFFERENT club is refused: the island is one club wide.
 */
enforceRoutes.put('/api/clubs/:clubId/webhook', async (c) => {
  const body = await jsonBody(c);
  if (!body) return invalid(c, 'A JSON object body is required.');
  const url = String(body['url'] ?? '').trim();
  if (!DISCORD_WEBHOOK_RE.test(url) || url.length > 300) {
    return invalid(
      c,
      'That does not look like a Discord webhook URL (https://discord.com/api/webhooks/...).',
    );
  }

  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'club.setWebhook', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane, email } = gate.ctx;
  const clubPath = `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}`;

  const existing = await getFsDoc(sa, saToken, clubPath);
  if (!existing.ok) return writeOutage(c, existing.status);
  if (existing.value === null) return notFound(c, 'Club');

  const displayName = typeof body['displayName'] === 'string' ? body['displayName'] : email;
  // Full replace, like the client's setDoc — validClubSettings' exact shape.
  const settings = await patchFsDoc(sa, saToken, `${clubPath}/settings/discord`, toFsFields({
    webhookUrl: url,
    updatedBy: displayName,
    updatedAt: new Date(),
  }));
  if (!settings.ok) return writeOutage(c, settings.status);

  const mask = await patchFsDoc(sa, saToken, clubPath, toFsFields({
    discordWebhookMask: maskWebhookUrl(url),
  }), { fieldPaths: ['discordWebhookMask'] });
  if (!mask.ok) return writeOutage(c, mask.status);
  // The mask is the only thing a browser ever sees — never the URL.
  return c.json({ success: true, mask: maskWebhookUrl(url) });
});

/**
 * DELETE /api/clubs/:clubId/webhook — clubs.js clearClubDiscordWebhook:
 * delete settings/discord (rules `allow delete: if canAdministerClub(...)`,
 * line 584), blank the mask (RESTRICTED field, rules 537).
 */
enforceRoutes.delete('/api/clubs/:clubId/webhook', async (c) => {
  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'club.clearWebhook', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const clubPath = `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}`;

  const existing = await getFsDoc(sa, saToken, clubPath);
  if (!existing.ok) return writeOutage(c, existing.status);
  if (existing.value === null) return notFound(c, 'Club');

  const del = await deleteFsDoc(sa, saToken, `${clubPath}/settings/discord`);
  if (!del.ok) return writeOutage(c, del.status);
  const mask = await patchFsDoc(sa, saToken, clubPath, toFsFields({ discordWebhookMask: '' }), {
    fieldPaths: ['discordWebhookMask'],
  });
  if (!mask.ok) return writeOutage(c, mask.status);
  return c.json({ success: true });
});

/**
 * POST /api/clubs/:clubId/managers/claim — the design's "claiming becomes an
 * explicit endpoint with audit" (§1). Mirrors clubs.js claimManagerRole:
 * stamp the CALLER's own uid (never a third party's — the client never could
 * either) into managerUids as {role, displayName, claimedAt}.
 *
 * Gate (rewritten 2026-08-17, CLUB MANAGER package): the `claimManager` rule,
 * not a capability floor — an UNCLAIMED club is first-come-first-served to
 * any live session, a CLAIMED one is moderator+ (never its own managers:
 * peer-escalation). firestore.rules enforces the identical shape today
 * (`canWriteManagerRoster` / `selfOnlyManagerClaim`), so this route is a
 * mirror again rather than a stricter twin.
 *
 * ⚠️ The claim is written under an updateTime PRECONDITION, which is what
 * makes "first-come-first-served" true rather than merely intended: two
 * members claiming the same unclaimed club within the same second cannot
 * both pass the gate and both land — the second write loses the precondition
 * and is answered as a conflict, not silently merged into a two-manager
 * roster nobody chose.
 *
 * The audit is the ab_gate line plus the claimedAt/displayName in the entry.
 */
enforceRoutes.post('/api/clubs/:clubId/managers/claim', async (c) => {
  const body = (await jsonBody(c)) ?? {};
  const role = body['role'] === 'moderator' ? 'moderator' : 'host';

  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'club.claimManager', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane, uid, email } = gate.ctx;
  const clubPath = `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}`;

  const existing = await getFsDoc(sa, saToken, clubPath);
  if (!existing.ok) return writeOutage(c, existing.status);
  if (existing.value === null) return notFound(c, 'Club');

  const displayName = typeof body['displayName'] === 'string' ? body['displayName'] : email;
  const entry: JsValue = { role, displayName, claimedAt: Date.now() };
  const patched = await patchFsDoc(
    sa,
    saToken,
    clubPath,
    { managerUids: { mapValue: { fields: { [uid]: toFsValue(entry) } } } as FsValue },
    {
      fieldPaths: [quoteFieldPath(['managerUids', uid])],
      ifUpdateTime: existing.value.updateTime,
    },
  );
  if (!patched.ok) {
    if (patched.status === 400 || patched.status === 409) {
      return c.json(
        {
          error: 'conflict',
          detail:
            'This club changed while the claim was being written — most likely ' +
            'somebody else claimed it first. Reload the club and look at who ' +
            'manages it now.',
        },
        409,
      );
    }
    return writeOutage(c, patched.status);
  }
  return c.json({ success: true });
});

/* ── mod-tier member ops (worker-added enforcement — rules are shape-only
 *    on members/requests, §1: "shape-only (presentation roles)"; the gate
 *    here is the §6 matrix the shadow has been measuring, not a rules
 *    mirror, because there is no rules clause to mirror) ────────────────── */

/**
 * PUT /api/clubs/:clubId/members/:slug/role — clubs.js setMemberRole: the
 * host's role is immutable; otherwise patch the member doc's presentation
 * `role` field (rules: members writes are open shape, validClubMember).
 */
enforceRoutes.put('/api/clubs/:clubId/members/:slug/role', async (c) => {
  const body = await jsonBody(c);
  const role = body?.['role'];
  if (role !== 'moderator' && role !== 'member') return invalid(c, 'Invalid role.');

  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'club.setMemberRole', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const clubPath = `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}`;
  const slug = c.req.param('slug');

  const club = await getFsDoc(sa, saToken, clubPath);
  if (!club.ok) return writeOutage(c, club.status);
  if (club.value === null) return notFound(c, 'Club');
  if (fsString(club.value.fields, 'hostSlug') === slug) {
    return c.json(
      { error: 'host_immutable', detail: "The host's role cannot be changed." },
      409,
    );
  }

  const memberPath = `${clubPath}/members/${encodeURIComponent(slug)}`;
  const member = await getFsDoc(sa, saToken, memberPath);
  if (!member.ok) return writeOutage(c, member.status);
  if (member.value === null) return notFound(c, 'Member');

  const patched = await patchFsDoc(sa, saToken, memberPath, toFsFields({ role }), {
    fieldPaths: ['role'],
    ifUpdateTime: member.value.updateTime,
  });
  if (!patched.ok) return writeOutage(c, patched.status);
  return c.json({ success: true });
});

/**
 * DELETE /api/clubs/:clubId/members/:slug — clubs.js removeMemberBySlug:
 * refuse the host; transactionally (updateTime precondition) drop the slug
 * from memberSlugs/invitedSlugs and re-count; then delete the member doc.
 */
enforceRoutes.delete('/api/clubs/:clubId/members/:slug', async (c) => {
  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'club.removeMember', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const clubPath = `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}`;
  const slug = c.req.param('slug');

  const rmw = await readModifyWrite(sa, saToken, clubPath, (doc) => {
    if (doc === null) {
      return { refuse: { status: 404, error: 'not_found', detail: 'Club not found.' } };
    }
    if (fsString(doc.fields, 'hostSlug') === slug) {
      return {
        refuse: { status: 409, error: 'host_immutable', detail: 'The host cannot be removed.' },
      };
    }
    const slugs = fsStringArray(doc.fields, 'memberSlugs').filter((s) => s !== slug);
    const invited = fsStringArray(doc.fields, 'invitedSlugs').filter((s) => s !== slug);
    return {
      patch: {
        fields: toFsFields({ memberSlugs: slugs, invitedSlugs: invited, memberCount: slugs.length }),
        fieldPaths: ['memberSlugs', 'invitedSlugs', 'memberCount'],
      },
    };
  });
  const refusal = rmwResponse(c, rmw);
  if (refusal) return refusal;

  const del = await deleteFsDoc(sa, saToken, `${clubPath}/members/${encodeURIComponent(slug)}`);
  if (!del.ok) return writeOutage(c, del.status);
  return c.json({ success: true });
});

/**
 * POST /api/clubs/:clubId/requests/:slug/accept — clubs.js acceptRequest:
 * the requester becomes an active member (slug into memberSlugs + count,
 * member doc {displayName, role:'member', status:'active', joinedAt}), and
 * the request doc is deleted.
 */
enforceRoutes.post('/api/clubs/:clubId/requests/:slug/accept', async (c) => {
  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'club.acceptRequest', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const clubPath = `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}`;
  const slug = c.req.param('slug');
  const requestPath = `${clubPath}/requests/${encodeURIComponent(slug)}`;

  const request = await getFsDoc(sa, saToken, requestPath);
  if (!request.ok) return writeOutage(c, request.status);
  if (request.value === null) return notFound(c, 'Request');
  const displayName = fsString(request.value.fields, 'displayName') ?? slug;

  const rmw = await readModifyWrite(sa, saToken, clubPath, (doc) => {
    if (doc === null) {
      return { refuse: { status: 404, error: 'not_found', detail: 'Club not found.' } };
    }
    const slugs = fsStringArray(doc.fields, 'memberSlugs');
    if (slugs.includes(slug)) return { noop: true };
    return {
      patch: {
        fields: toFsFields({ memberSlugs: [...slugs, slug], memberCount: slugs.length + 1 }),
        fieldPaths: ['memberSlugs', 'memberCount'],
      },
    };
  });
  const refusal = rmwResponse(c, rmw);
  if (refusal) return refusal;

  const member = await patchFsDoc(
    sa,
    saToken,
    `${clubPath}/members/${encodeURIComponent(slug)}`,
    toFsFields({ displayName, role: 'member', status: 'active', joinedAt: new Date() }),
  );
  if (!member.ok) return writeOutage(c, member.status);
  const del = await deleteFsDoc(sa, saToken, requestPath);
  if (!del.ok) return writeOutage(c, del.status);
  return c.json({ success: true });
});

/**
 * DELETE /api/clubs/:clubId/requests/:slug — clubs.js rejectRequest: delete
 * the request doc (idempotent, like the client's deleteDoc).
 */
enforceRoutes.delete('/api/clubs/:clubId/requests/:slug', async (c) => {
  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'club.rejectRequest', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const clubPath = `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}`;
  const del = await deleteFsDoc(
    sa,
    saToken,
    `${clubPath}/requests/${encodeURIComponent(c.req.param('slug'))}`,
  );
  if (!del.ok) return writeOutage(c, del.status);
  return c.json({ success: true });
});

/**
 * POST /api/clubs/:clubId/invites — clubs.js inviteMember: refuse existing
 * members/invitees, add the slug to invitedSlugs (updateTime precondition),
 * write the member doc in 'invited' state.
 */
enforceRoutes.post('/api/clubs/:clubId/invites', async (c) => {
  const body = await jsonBody(c);
  const name = String(body?.['displayName'] ?? '').trim();
  if (name.length < 2) return invalid(c, 'Enter a display name.');
  const slug = slugifyName(name);

  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'club.inviteMember', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const clubPath = `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}`;

  const rmw = await readModifyWrite(sa, saToken, clubPath, (doc) => {
    if (doc === null) {
      return { refuse: { status: 404, error: 'not_found', detail: 'Club not found.' } };
    }
    if (fsStringArray(doc.fields, 'memberSlugs').includes(slug)) {
      return {
        refuse: { status: 409, error: 'already_member', detail: `${name} is already a member.` },
      };
    }
    const invited = fsStringArray(doc.fields, 'invitedSlugs');
    if (invited.includes(slug)) {
      return {
        refuse: { status: 409, error: 'already_invited', detail: `${name} has already been invited.` },
      };
    }
    return {
      patch: {
        fields: toFsFields({ invitedSlugs: [...invited, slug] }),
        fieldPaths: ['invitedSlugs'],
      },
    };
  });
  const refusal = rmwResponse(c, rmw);
  if (refusal) return refusal;

  const member = await patchFsDoc(
    sa,
    saToken,
    `${clubPath}/members/${encodeURIComponent(slug)}`,
    toFsFields({ displayName: name, role: 'member', status: 'invited', invitedAt: new Date() }),
  );
  if (!member.ok) return writeOutage(c, member.status);
  return c.json({ success: true, slug });
});

/* ── read lifecycle + schedule ────────────────────────────────────────── */

/**
 * PUT /api/clubs/:clubId/reads/:readId/schedule — club-reads.js
 * setReadSchedule: re-stamp each milestone's dueAt positionally (delete the
 * key where the slot is empty) + scheduleUpdatedAt. OPERATIONAL per rules
 * readOperationalFieldsChanged → canOperateClub (lines 633–634). Milestones
 * are handled as RAW wire values — only dueAt is touched, every other
 * milestone field survives byte-identical (fs-docs.ts round-trip rule).
 */
enforceRoutes.put('/api/clubs/:clubId/reads/:readId/schedule', async (c) => {
  const body = await jsonBody(c);
  const dueAts = body?.['dueAts'];
  if (!Array.isArray(dueAts)) return invalid(c, 'dueAts must be an array (null clears a slot).');

  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'club.setSchedule', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const readPath =
    `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}` +
    `/reads/${encodeURIComponent(c.req.param('readId'))}`;

  const read = await getFsDoc(sa, saToken, readPath);
  if (!read.ok) return writeOutage(c, read.status);
  if (read.value === null) return notFound(c, 'Read');

  const ordered = [...rawArrayValues(read.value.fields, 'milestones')].sort((a, b) => {
    const pa = fsScalar(mapValueFields(a)?.['position']);
    const pb = fsScalar(mapValueFields(b)?.['position']);
    return (typeof pa === 'number' ? pa : 0) - (typeof pb === 'number' ? pb : 0);
  });
  const milestones = ordered.map((m, i) => {
    const fields = { ...(mapValueFields(m) ?? {}) };
    const due = dueAts[i];
    if (typeof due === 'number' && Number.isFinite(due)) {
      fields['dueAt'] = toFsValue(due);
    } else {
      delete fields['dueAt'];
    }
    return { mapValue: { fields } } as FsValue;
  });

  const patched = await patchFsDoc(
    sa,
    saToken,
    readPath,
    {
      milestones: { arrayValue: { values: milestones } } as FsValue,
      scheduleUpdatedAt: toFsValue(new Date()),
    },
    { fieldPaths: ['milestones', 'scheduleUpdatedAt'], ifUpdateTime: read.value.updateTime },
  );
  if (!patched.ok) return writeOutage(c, patched.status);
  return c.json({ success: true });
});

/**
 * POST /api/clubs/:clubId/reads/:readId/finish — club-reads.js finishRead:
 * status → finished|abandoned + finishedAt, and the read's slot leaves the
 * club's activeSlots. LIFECYCLE per rules readLifecycleFieldsChanged →
 * canOperateClub since the 2026-08-17 MANAGECLUB SPLIT (it was STRUCTURAL /
 * canManageClub before). The client's two-doc transaction becomes two
 * preconditioned writes (read first — it carries the state check).
 */
enforceRoutes.post('/api/clubs/:clubId/reads/:readId/finish', async (c) => {
  const body = await jsonBody(c);
  const status = body?.['status'];
  if (status !== 'finished' && status !== 'abandoned') return invalid(c, 'Invalid status.');

  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'read.finish', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const clubPath = `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}`;
  const readPath = `${clubPath}/reads/${encodeURIComponent(c.req.param('readId'))}`;

  const read = await getFsDoc(sa, saToken, readPath);
  if (!read.ok) return writeOutage(c, read.status);
  if (read.value === null) return notFound(c, 'Read');
  if (fsString(read.value.fields, 'status') !== 'active') {
    return c.json({ error: 'already_archived', detail: 'This read is already archived.' }, 409);
  }
  const slot = fsScalar(read.value.fields['slot']);

  const patched = await patchFsDoc(
    sa,
    saToken,
    readPath,
    toFsFields({ status, finishedAt: new Date() }),
    { fieldPaths: ['status', 'finishedAt'], ifUpdateTime: read.value.updateTime },
  );
  if (!patched.ok) {
    // A lost race with another finisher lands here (precondition) — worded,
    // not a bare status; anything else is an outage.
    if (patched.status === 400 || patched.status === 409) {
      return c.json({ error: 'conflict', detail: 'This read was just changed by someone else — reload and try again.' }, 409);
    }
    return writeOutage(c, patched.status);
  }

  const rmw = await readModifyWrite(sa, saToken, clubPath, (doc) => {
    if (doc === null) return { noop: true }; // club gone: nothing to un-slot
    const values = rawArrayValues(doc.fields, 'activeSlots');
    const kept = values.filter((v) => fsScalar(v) !== slot);
    if (kept.length === values.length) return { noop: true };
    return {
      patch: {
        fields: { activeSlots: { arrayValue: { values: kept } } as FsValue },
        fieldPaths: ['activeSlots'],
      },
    };
  });
  const refusal = rmwResponse(c, rmw);
  if (refusal) return refusal;
  return c.json({ success: true });
});

/**
 * DELETE /api/clubs/:clubId/reads/:readId — club-reads.js removeRead: free
 * the active slot, delete comments/progress/ratings subdocs, delete the
 * read. LIFECYCLE — rules `allow delete: if canOperateClub(...)` since the
 * 2026-08-17 MANAGECLUB SPLIT; it was canManageClub with the comment "read
 * deletes are structural", which the owner's option B overruled: removing a
 * read is running the club, not destroying it (the CLUB delete is the
 * destructive row, and that one did not move). The ratings sweep is complete
 * here (module doc: the SA reads what rules hide).
 */
enforceRoutes.delete('/api/clubs/:clubId/reads/:readId', async (c) => {
  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'read.remove', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const clubPath = `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}`;
  const readPath = `${clubPath}/reads/${encodeURIComponent(c.req.param('readId'))}`;

  const read = await getFsDoc(sa, saToken, readPath);
  if (!read.ok) return writeOutage(c, read.status);
  if (read.value === null) return notFound(c, 'Read');
  const slot = fsScalar(read.value.fields['slot']);

  if (fsString(read.value.fields, 'status') === 'active') {
    const rmw = await readModifyWrite(sa, saToken, clubPath, (doc) => {
      if (doc === null) return { noop: true };
      const values = rawArrayValues(doc.fields, 'activeSlots');
      const kept = values.filter((v) => fsScalar(v) !== slot);
      if (kept.length === values.length) return { noop: true };
      return {
        patch: {
          fields: { activeSlots: { arrayValue: { values: kept } } as FsValue },
          fieldPaths: ['activeSlots'],
        },
      };
    });
    const refusal = rmwResponse(c, rmw);
    if (refusal) return refusal;
  }

  for (const sub of ['comments', 'progress', 'ratings']) {
    const ids = await listFsDocIds(sa, saToken, `${readPath}/${sub}`);
    if (!ids.ok) return writeOutage(c, ids.status);
    for (const id of ids.value) {
      const del = await deleteFsDoc(sa, saToken, `${readPath}/${sub}/${encodeURIComponent(id)}`);
      if (!del.ok) return writeOutage(c, del.status);
    }
  }
  const del = await deleteFsDoc(sa, saToken, readPath);
  if (!del.ok) return writeOutage(c, del.status);
  // refreshClubAvatar stays a browser-direct member write (module doc).
  return c.json({ success: true });
});

/**
 * POST /api/clubs/:clubId/reads/:readId/reveal-ratings — club-reads.js
 * revealRatings: ratingsRevealed + revealedAt. LIFECYCLE per rules
 * readLifecycleFieldsChanged → canOperateClub since the 2026-08-17 MANAGECLUB
 * SPLIT (both reveal fields moved out of the structural list with it). The
 * blind-ratings READ gate itself stays in rules, untouched — design §7.
 */
enforceRoutes.post('/api/clubs/:clubId/reads/:readId/reveal-ratings', async (c) => {
  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'read.revealRatings', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const readPath =
    `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}` +
    `/reads/${encodeURIComponent(c.req.param('readId'))}`;

  const read = await getFsDoc(sa, saToken, readPath);
  if (!read.ok) return writeOutage(c, read.status);
  if (read.value === null) return notFound(c, 'Read');

  const patched = await patchFsDoc(
    sa,
    saToken,
    readPath,
    toFsFields({ ratingsRevealed: true, revealedAt: new Date() }),
    { fieldPaths: ['ratingsRevealed', 'revealedAt'], ifUpdateTime: read.value.updateTime },
  );
  if (!patched.ok) return writeOutage(c, patched.status);
  return c.json({ success: true });
});

/* ── polls (OPERATIONAL — rules canOperateClub, lines 594–596) ────────── */

const MAX_POLL_OPTIONS = 10;

/**
 * POST /api/clubs/:clubId/polls — club-reads.js createPoll. Shape mirrors
 * rules validPoll (question 1–200, options 2–10, status enum, nextBook book
 * refs) + the client's field set exactly (createdBy/createdBySlug ride the
 * caller-supplied display name — the site's presentation identity).
 */
enforceRoutes.post('/api/clubs/:clubId/polls', async (c) => {
  const body = await jsonBody(c);
  if (!body) return invalid(c, 'A JSON object body is required.');
  const type = body['type'] === 'nextBook' ? 'nextBook' : 'freeform';
  const question = String(body['question'] ?? '').trim();
  if (question.length === 0 || question.length > 200) {
    return invalid(c, 'Poll questions must be 1–200 characters.');
  }
  const rawOptions = body['options'];
  if (!Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > MAX_POLL_OPTIONS) {
    return invalid(c, `Polls need 2–${MAX_POLL_OPTIONS} options.`);
  }
  let options: JsValue[];
  if (type === 'nextBook') {
    const books: JsValue[] = [];
    for (const o of rawOptions) {
      const b = o as Record<string, unknown> | null;
      const title = typeof b?.['title'] === 'string' ? b['title'].trim() : '';
      if (!title || title.length > 200) {
        return invalid(c, 'Every next-book option needs a title (1–200 characters).');
      }
      books.push({
        title,
        author: typeof b?.['author'] === 'string' ? b['author'] : '',
        coverHref: typeof b?.['coverHref'] === 'string' ? b['coverHref'] : '',
      });
    }
    options = books;
  } else {
    const texts: JsValue[] = [];
    for (const o of rawOptions) {
      const text = typeof o === 'string' ? o.trim() : '';
      if (!text || text.length > 200) {
        return invalid(c, 'Every option needs text (1–200 characters).');
      }
      texts.push(text);
    }
    options = texts;
  }

  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'poll.create', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane, email } = gate.ctx;

  const displayName =
    typeof body['displayName'] === 'string' && body['displayName'].trim()
      ? body['displayName'].trim()
      : email;
  const created = await createFsDoc(
    sa,
    saToken,
    `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}/polls`,
    toFsFields({
      type,
      question,
      options,
      readId: typeof body['readId'] === 'string' ? body['readId'] : null,
      milestoneId: typeof body['milestoneId'] === 'string' ? body['milestoneId'] : null,
      milestonePosition:
        typeof body['milestonePosition'] === 'number' ? body['milestonePosition'] : null,
      status: 'open',
      createdBy: displayName,
      createdBySlug: slugifyName(displayName),
      createdAt: new Date(),
      closedAt: null,
    }),
  );
  if (!created.ok) return writeOutage(c, created.status);
  return c.json({ success: true, pollId: created.value });
});

/**
 * PUT /api/clubs/:clubId/polls/:pollId/status — club-reads.js setPollStatus:
 * open|closed, closedAt stamped on close / nulled on reopen.
 */
enforceRoutes.put('/api/clubs/:clubId/polls/:pollId/status', async (c) => {
  const body = await jsonBody(c);
  const status = body?.['status'];
  if (status !== 'open' && status !== 'closed') return invalid(c, 'Invalid status.');

  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'poll.setStatus', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const pollPath =
    `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}` +
    `/polls/${encodeURIComponent(c.req.param('pollId'))}`;

  const poll = await getFsDoc(sa, saToken, pollPath);
  if (!poll.ok) return writeOutage(c, poll.status);
  if (poll.value === null) return notFound(c, 'Poll');

  const patched = await patchFsDoc(
    sa,
    saToken,
    pollPath,
    toFsFields({ status, closedAt: status === 'closed' ? new Date() : null }),
    { fieldPaths: ['status', 'closedAt'], ifUpdateTime: poll.value.updateTime },
  );
  if (!patched.ok) return writeOutage(c, patched.status);
  return c.json({ success: true });
});

/**
 * DELETE /api/clubs/:clubId/polls/:pollId — club-reads.js deletePoll: votes
 * first, then the poll doc.
 */
enforceRoutes.delete('/api/clubs/:clubId/polls/:pollId', async (c) => {
  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'poll.delete', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const pollPath =
    `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}` +
    `/polls/${encodeURIComponent(c.req.param('pollId'))}`;

  const votes = await listFsDocIds(sa, saToken, `${pollPath}/votes`);
  if (!votes.ok) return writeOutage(c, votes.status);
  for (const id of votes.value) {
    const del = await deleteFsDoc(sa, saToken, `${pollPath}/votes/${encodeURIComponent(id)}`);
    if (!del.ok) return writeOutage(c, del.status);
  }
  const del = await deleteFsDoc(sa, saToken, pollPath);
  if (!del.ok) return writeOutage(c, del.status);
  return c.json({ success: true });
});

/* ── discussion moderation: someone ELSE'S comment / quote ─────────────────
 *
 * Added 2026-09-07 (W15-AB-ENFORCE) to close the `comment.modDelete` /
 * `quote.modDelete` gap — two actions that had a shadow gate and no route.
 *
 * ⚠️ MODERATION ONLY, and the route names say so. Deleting your OWN comment or
 * quote is a member-open write: it has no shadow action, no rules clause to
 * mirror (`club-reads.js` reports nothing for it) and no route here. A client
 * that put a self-delete on one of these paths would be asking the Worker to
 * refuse a member for doing something the rules allow.
 *
 * ⚠️ The rules on these two subcollections are SHAPE-ONLY, like members and
 * requests (§1: "shape-only (presentation roles)"), so — as with the mod-tier
 * member ops above — the gate here is the §6 matrix the shadow has been
 * measuring, not a rules mirror. There is no rules clause to mirror.
 */

/**
 * DELETE /api/clubs/:clubId/reads/:readId/comments/:commentId — club-reads.js
 * deleteComment with `opts.asModerator`: delete the comment doc, then take the
 * read's `commentCount` down by one. Capability: operateClub, island ON (a
 * bound manager of THIS club moderates it; moderator+ overrides everywhere).
 *
 * ⚠️ ONE DOCUMENTED DELTA from the browser path, and it is the third in this
 * file (see the module doc's list). The client bumps the counter with
 * Firestore's atomic `increment(-1)`; the REST mirror is a read-modify-write
 * under the updateTime precondition — the same instrument every other array
 * mutation here uses, and it is NOT a lost-update risk for that reason. Two
 * differences follow, both deliberate:
 *   · the count is FLOORED AT ZERO, where `increment(-1)` would happily write
 *     -1 and leave a club showing a negative comment count for ever;
 *   · a MISSING comment is a worded 404 here, where the client's `deleteDoc`
 *     succeeds on a document that is already gone and then decrements anyway.
 *     Two moderators clicking the same ✕ decrement twice on the browser path;
 *     here the second one is told the comment is already gone and the counter
 *     is left alone.
 */
enforceRoutes.delete('/api/clubs/:clubId/reads/:readId/comments/:commentId', async (c) => {
  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'comment.modDelete', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const readPath =
    `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}` +
    `/reads/${encodeURIComponent(c.req.param('readId'))}`;
  const commentPath = `${readPath}/comments/${encodeURIComponent(c.req.param('commentId'))}`;

  const comment = await getFsDoc(sa, saToken, commentPath);
  if (!comment.ok) return writeOutage(c, comment.status);
  if (comment.value === null) return notFound(c, 'Comment');

  const del = await deleteFsDoc(sa, saToken, commentPath);
  if (!del.ok) return writeOutage(c, del.status);

  const rmw = await readModifyWrite(sa, saToken, readPath, (doc) => {
    if (doc === null) return { noop: true }; // read gone: nothing to count
    const current = fsScalar(doc.fields['commentCount']);
    const count = typeof current === 'number' ? current : 0;
    const next = Math.max(0, count - 1);
    if (next === count) return { noop: true };
    return {
      patch: { fields: toFsFields({ commentCount: next }), fieldPaths: ['commentCount'] },
    };
  });
  const refusal = rmwResponse(c, rmw);
  if (refusal) return refusal;
  return c.json({ success: true });
});

/**
 * DELETE /api/clubs/:clubId/reads/:readId/quotes/:quoteId — club-reads.js
 * deleteQuote with `opts.asModerator`: one document, no counter (quotes are
 * not counted on the read doc). Capability: operateClub, island ON.
 */
enforceRoutes.delete('/api/clubs/:clubId/reads/:readId/quotes/:quoteId', async (c) => {
  const clubId = c.req.param('clubId');
  const gate = await runEnforceGate(c, 'quote.modDelete', clubId);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const quotePath =
    `${clubCollectionFor(lane)}/${encodeURIComponent(clubId)}` +
    `/reads/${encodeURIComponent(c.req.param('readId'))}` +
    `/quotes/${encodeURIComponent(c.req.param('quoteId'))}`;

  const quote = await getFsDoc(sa, saToken, quotePath);
  if (!quote.ok) return writeOutage(c, quote.status);
  if (quote.value === null) return notFound(c, 'Quote');

  const del = await deleteFsDoc(sa, saToken, quotePath);
  if (!del.ok) return writeOutage(c, del.status);
  return c.json({ success: true });
});

/* ── reader content notes: the 2026-08-17 delete SPLIT, as two routes ──────
 *
 * `user-warnings.js deleteUserWarning` is one function with two gates, and
 * `ACTION_GATES` has said so since the 2026-08-17 split (soak blocker 3): your
 * OWN note is `{kind:'signedIn'}`, anyone else's is `cap('operateClub', false)`
 * — site-wide, island OFF, because a content note is not a club surface.
 *
 * ⚠️ TWO ROUTES, NOT ONE, and the reason is `runEnforceGate`: it takes exactly
 * one action, runs exactly one gate and writes exactly ONE `ab_gate` line. A
 * single route deciding between the two actions would have to read the note to
 * learn who wrote it — which needs the service-account token the gate only
 * mints once it has passed — so it would gate twice and log twice, inflating
 * the very ledger the flip criterion is counted from.
 *
 * ⚠️ Neither route trusts the caller's claim about which one applies. The self
 * route VERIFIES `authorUid == uid` server-side (firestore.rules'
 * `warningAuthorIsRequester`), so naming it for somebody else's note is a
 * worded refusal, not a delete. The moderate route holds the capability floor.
 * Lying in either direction buys nothing.
 */

/** The §1e refusal for a note that is not the caller's to self-delete. */
function notYourNote(c: Ctx, unstamped: boolean): Response {
  return c.json(
    {
      error: 'not_author',
      needs: 'operateClub',
      detail: unstamped
        ? 'This note was added before removals were tied to an account, so nobody ' +
          'can remove it as its author — not even the person who wrote it. This ' +
          'needs the site moderator role. Ask a site moderator to take it down, or ' +
          'add the note again: a note added now is stamped with your account and ' +
          'becomes yours to remove.'
        : 'This content note was added by somebody else, so it cannot be removed ' +
          'from your own account. This needs the "operateClub" capability, which ' +
          'the moderator role (and above) holds. To get it, ask the site owner to ' +
          'grant your account that role from the estate admin page.',
    },
    403,
  );
}

/**
 * DELETE /api/warnings/:docId — remove YOUR OWN reader content note. Mirrors
 * `deleteUserWarning` on its `authored` arm, and firestore.rules'
 * `warningAuthorIsRequester()` (line 797) verbatim: the doc must carry an
 * `authorUid` and it must equal the caller's live uid.
 *
 * ⚠️ Gate `warning.selfDelete` is `{kind:'signedIn'}`, so `gateDecision`
 * answers before the estate-revoked arm is ever reached — a revoked household
 * member may still take down their own note. That is not an oversight to
 * "harden": it is exactly what the shadow has been measuring and exactly what
 * the rules allow today, and enforce must refuse precisely what shadow said it
 * would or the soak evidence stops meaning anything. Changing it is a floor
 * change, and floors are the owner's.
 *
 * ⚠️ An UNSTAMPED note (no `authorUid` at all — written by the old prod UI or
 * a legacy passphrase session) is refused here and is moderator-deletable
 * only. ROLES.md §1 records that as deliberate, and that both lanes were
 * measured EMPTY the day the rule shipped, so it stranded nothing.
 */
enforceRoutes.delete('/api/warnings/:docId', async (c) => {
  const gate = await runEnforceGate(c, 'warning.selfDelete', null);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane, uid } = gate.ctx;
  const notePath =
    `${userWarningsCollectionFor(lane)}/${encodeURIComponent(c.req.param('docId'))}`;

  const note = await getFsDoc(sa, saToken, notePath);
  if (!note.ok) return writeOutage(c, note.status);
  if (note.value === null) return notFound(c, 'Content note');

  const authorUid = fsString(note.value.fields, 'authorUid');
  if (authorUid === null) return notYourNote(c, true);
  if (authorUid !== uid) return notYourNote(c, false);

  const del = await deleteFsDoc(sa, saToken, notePath);
  if (!del.ok) return writeOutage(c, del.status);
  return c.json({ success: true });
});

/**
 * DELETE /api/warnings/:docId/moderate — take down ANYONE'S reader content
 * note. Mirrors `deleteUserWarning`'s moderator arm and firestore.rules'
 * `isSiteModerator() || isSiteAdmin()` half of `canDeleteUserWarning()`.
 *
 * Capability `operateClub` (moderator floor), island OFF — `ACTION_GATES` says
 * `cap('operateClub', false)` and it means it: a book's content notes are not
 * a club surface, so running a club confers nothing here. `runEnforceGate` is
 * called with a null clubId, so no roster is read at all.
 *
 * ⚠️ Unlike the self route, this one IS estate-checked (a capability rule
 * reaches the revoked arm), which is the whole point of the migration: a
 * revoked moderator whose `site_roles` doc still stands is refused.
 */
enforceRoutes.delete('/api/warnings/:docId/moderate', async (c) => {
  const gate = await runEnforceGate(c, 'warning.modDelete', null);
  if (!gate.ok) return gate.response;
  const { sa, saToken, lane } = gate.ctx;
  const notePath =
    `${userWarningsCollectionFor(lane)}/${encodeURIComponent(c.req.param('docId'))}`;

  const note = await getFsDoc(sa, saToken, notePath);
  if (!note.ok) return writeOutage(c, note.status);
  if (note.value === null) return notFound(c, 'Content note');

  const del = await deleteFsDoc(sa, saToken, notePath);
  if (!del.ok) return writeOutage(c, del.status);
  return c.json({ success: true });
});
