/**
 * Estate operations — POST /api/estate/ops/pipeline.
 *
 * The audiobook pipeline is really an ESTATE pipeline (it moves the ebooks
 * too, via sync_to_drive.py), so triggering it belongs on the estate's own
 * Operations surface instead of requiring a visit to the audiobook admin
 * page. This endpoint does not invent a new trigger mechanism — it writes
 * the SAME request document the audiobook admin panel already writes
 * (audiobook_catalog site/pipeline-status.js `requestRun()`), via this
 * Worker's service account instead of a token pasted into a browser's
 * localStorage. audiobook_catalog is untouched: its firestore.rules
 * `validPipelineRequest()` and app/tools/pipeline_watcher.py (the home
 * machine's poller) do not know or care which producer wrote the doc.
 *
 * The trigger contract, read from audiobook_catalog (read-only, not
 * modified here):
 *   - Collection `pipeline_requests` (prod; no lane suffix — the admin
 *     panel's client writes there unconditionally regardless of which lane
 *     served the page, and production is the lane that actually runs the
 *     pipeline on the home machine).
 *   - Firestore rules make the collection CREATE-ONLY and UNREADABLE
 *     (`allow read: if false`) — the shared secret inside a pending
 *     request must never be harvestable, which is also why this route
 *     never echoes the token back in its response.
 *   - Document shape, exactly what `validPipelineRequest()` requires:
 *       token         string, 16–200 chars — compared with `hmac.compare_digest`
 *                     against PIPELINE_TRIGGER_TOKEN in the watcher's .env
 *       requestedAt   ISO 8601 string — the watcher discards anything older
 *                     than PIPELINE_MAX_REQUEST_AGE_MIN (default 60 min)
 *       requestedBy   string, ≤80 chars — free text, shown in pipeline_runs
 *   - The watcher polls every ~3 minutes, applies a cooldown (default 10
 *     min) and a lock file, and deletes every request it looks at (valid or
 *     not) — so a request here is consumed at most once and never retried.
 *
 * Gating: requireDevops() since 0003 (owner order 2026-08-15: the devops
 * role drives the status page) — approvers still qualify implicitly,
 * CORS apex-only (mounted in index.ts, mirroring the site-roles mount) and
 * the Worker-wide per-IP rate limiter (RATE_LIMITER, mounted on /api/* in
 * index.ts). Both secrets this route needs are configuration, not identity,
 * so a missing one answers 503 with the fix — same idiom as site-roles.ts.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from './env.js';
import { requireDevops } from './middleware/auth.js';
import {
  firestoreRequest,
  mintAccessToken,
  parseServiceAccount,
  type ServiceAccount,
} from './firebase-sa.js';

/** Unconditionally prod — see the file header for why no lane suffix. */
export const PIPELINE_REQUESTS_COLLECTION = 'pipeline_requests';

/**
 * The request document, in Firestore REST typed-value shape — the exact
 * fields `validPipelineRequest()` checks. Pure, so the shape is testable
 * without a live service account or a network call.
 */
export function pipelineRequestFields(input: { token: string; requestedBy: string; nowIso: string }) {
  return {
    token: { stringValue: input.token },
    requestedAt: { stringValue: input.nowIso },
    requestedBy: { stringValue: input.requestedBy.slice(0, 80) },
  };
}

// ---------------------------------------------------------------------------
// Fine-grained manual step controls (owner ask 2026-08-16: "give us fine
// control over each part of the pipeline in case we need to do part way
// steps... make sure we cant break stuff"), plus the standalone shelf-server
// force-upload ("a button to force a full upload to the server... without
// the full pipeline"). Both ride the SAME pipeline_requests/watcher trigger
// contract the file header describes — this route writes the identical
// request document shape, just with one extra optional field (`step`) the
// home machine's watcher and audiobook_catalog's firestore.rules now
// understand. audiobook_catalog is still the source of truth for what each
// value means; see app/tools/pipeline_watcher.py's PIPELINE_STEP_CHOICES
// and scripts/sync_to_drive.py's STEP_INFO (this file's PIPELINE_STEPS
// below MUST mirror STEP_INFO's keys and "kind" classification exactly —
// no shared module between the two repos, same duplication story as
// backups.ts's KNOWN_BACKUP_PREFIXES comment).
// ---------------------------------------------------------------------------

/**
 * The 7 pipeline stages this route can trigger individually. `kind` is the
 * blast-radius classification the status page's UI uses to pick a
 * confirmation tier (admin.js's confirmBtn two-tap idiom, reused via
 * assets/estate-controls.js):
 *   read-only  — audit, detect: plain button, no confirmation.
 *   mutating   — sort, folders, upload: two-tap confirm.
 *   publishing — catalog, publish: two-tap confirm PLUS an explicit
 *                "this updates the live site" warning.
 */
export const PIPELINE_STEPS = {
  audit: { label: 'Purchase audit', kind: 'read-only' },
  sort: { label: 'Sort books', kind: 'mutating' },
  detect: { label: 'Detect new books', kind: 'read-only' },
  folders: { label: 'Read Drive folders', kind: 'mutating' },
  upload: { label: 'Upload to Drive', kind: 'mutating' },
  catalog: { label: 'Rebuild catalog', kind: 'publishing' },
  publish: { label: 'Commit & deploy', kind: 'publishing' },
} as const;

export type PipelineStepKey = keyof typeof PIPELINE_STEPS;
export const PIPELINE_STEP_KEYS = Object.keys(PIPELINE_STEPS) as PipelineStepKey[];

/**
 * The standalone shelf-server reconciliation marker — deliberately NOT a
 * key in PIPELINE_STEPS (it is not a pipeline stage; see
 * scripts/sync_to_server.py's module docstring on the audiobook_catalog
 * side). Recognized by the watcher as its own dispatch path.
 */
export const FORCE_UPLOAD_STEP = 'force-upload-server';

export function isPipelineStepKey(value: unknown): value is PipelineStepKey {
  return typeof value === 'string' && (PIPELINE_STEP_KEYS as string[]).includes(value);
}

/**
 * Same fields as pipelineRequestFields(), plus `step` — validated on the
 * audiobook_catalog side by firestore.rules' validPipelineStep() (bounded
 * to the 7 stage keys or FORCE_UPLOAD_STEP).
 */
export function pipelineStepRequestFields(input: {
  token: string;
  requestedBy: string;
  nowIso: string;
  step: string;
}) {
  return {
    ...pipelineRequestFields(input),
    step: { stringValue: input.step },
  };
}

/**
 * Minimal decode of the Firestore REST typed-value shape for the ONE field
 * this route needs off pipeline_status/current: a top-level string field.
 * Mirrors the spirit of the status page's own fsValue() client-side decoder
 * (sites/heygabi-home/public/status/status.js) without pulling in its full
 * generality — this route only ever reads `state`/`trigger`/`startedAt`/
 * `updatedAt`, all plain strings.
 */
function decodeStringField(doc: unknown, field: string): string | null {
  const fields = (doc as { fields?: Record<string, { stringValue?: string }> } | null)?.fields;
  const v = fields?.[field]?.stringValue;
  return typeof v === 'string' ? v : null;
}

/**
 * States meaning "a run is currently claiming the single-flight lock" — see
 * audiobook_catalog's app/core/pipeline_lock.py / app/pipeline_status.py:
 *   running  — an active run (scheduled or manual) is actually executing.
 *   deferred — the 8h scheduled trigger is waiting up to 2h for the lock.
 *   blocked  — the LAST attempt was refused because the lock was held.
 *              Treated as busy too: a fresh attempt seconds later would
 *              almost certainly be refused the identical way, and surfacing
 *              the same clear reason immediately beats a silent ~3-minute
 *              round trip through the watcher to discover the same thing.
 */
const PIPELINE_BUSY_STATES = new Set(['running', 'deferred', 'blocked']);

/**
 * Pure: given a decoded (or raw REST-shaped) pipeline_status/current
 * document, returns a human reason string when the pipeline is busy, or
 * null when it is free (including "no doc yet" / "unreadable shape" — this
 * function fails OPEN on ambiguity, see checkPipelineBusy()'s comment for
 * why that is the correct and safe default here).
 */
export function pipelineBusyReason(statusDoc: unknown): string | null {
  const state = decodeStringField(statusDoc, 'state');
  if (state === null || !PIPELINE_BUSY_STATES.has(state)) return null;
  const trigger = decodeStringField(statusDoc, 'trigger') ?? 'unknown';
  const since = decodeStringField(statusDoc, 'startedAt') ?? decodeStringField(statusDoc, 'updatedAt');
  const sinceText = since ? ` since ${since}` : '';
  return `The pipeline is currently ${state} (trigger=${trigger})${sinceText} — try again once it finishes. Watch the Pipeline row above.`;
}

/**
 * Live busy-check against pipeline_status/current — a UX convenience, NOT
 * the safety mechanism. The real, unbypassable guarantee is
 * app/core/pipeline_lock.py's single-flight lock on the home machine
 * itself: every manual step, the full pipeline, and this route's write all
 * eventually funnel through it. This check only saves a caller the ~3
 * minute round trip of queuing a request the watcher would refuse anyway,
 * so it FAILS OPEN (returns null = "not known to be busy") on a missing
 * doc, an unreadable response, or a network error — an outage here must
 * never block a legitimate trigger, since the lock downstream still
 * protects correctness either way.
 */
async function checkPipelineBusy(sa: ServiceAccount, accessToken: string): Promise<string | null> {
  try {
    const res = await firestoreRequest(sa, accessToken, 'GET', 'pipeline_status/current');
    if (!res.ok) return null; // includes 404 (never run yet) — not busy
    const doc = await res.json();
    return pipelineBusyReason(doc);
  } catch {
    return null;
  }
}

/** 503-or-credentials for the Firebase service account — the site-roles idiom. */
function serviceAccountOrUnset(c: Context<AppBindings>) {
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

/** Shared missing-config check every /ops/pipeline* route needs, in the
 * same order (token before service account) so a deployer fixing one
 * secret never has to guess whether the other is also unset. */
function pipelineTriggerConfigOrUnset(c: Context<AppBindings>) {
  const token = c.env.PIPELINE_TRIGGER_TOKEN;
  if (!token) {
    return {
      token: null,
      sa: null,
      unset: c.json(
        { error: 'pipeline_trigger_token_unset', fix: 'wrangler secret put PIPELINE_TRIGGER_TOKEN' },
        503,
      ),
    };
  }
  const { sa, unset } = serviceAccountOrUnset(c);
  if (!sa) return { token, sa: null, unset: unset! };
  return { token, sa, unset: null };
}

export const opsRoutes = new Hono<AppBindings>();

opsRoutes.post('/estate/ops/pipeline', requireDevops(), async (c) => {
  const { token, sa, unset } = pipelineTriggerConfigOrUnset(c);
  if (!sa) return unset!;

  const accessToken = await mintAccessToken(sa);
  const busy = await checkPipelineBusy(sa, accessToken);
  if (busy) return c.json({ error: 'pipeline_busy', detail: busy }, 409);

  const actor = c.get('actor');
  const nowIso = new Date().toISOString();
  const fields = pipelineRequestFields({
    token: token!,
    requestedBy: `estate-ops:${actor.email}`,
    nowIso,
  });

  const res = await firestoreRequest(sa, accessToken, 'POST', PIPELINE_REQUESTS_COLLECTION, { fields });
  if (!res.ok) {
    return c.json({ error: 'firestore_error', status: res.status }, 502);
  }

  // The audit line: who requested a run, never the token. Same shape as the
  // site-roles grant/revoke lines.
  console.log(JSON.stringify({ evt: 'pipeline_run_requested', actor: actor.email, requestedAt: nowIso }));

  return c.json({
    requested: true,
    requestedAt: nowIso,
    detail:
      'Requested — the home machine checks every ~3 minutes, so it starts within ~3 min ' +
      '(or is skipped if a run is already going or the cooldown is active). Watch the ' +
      'Pipeline row on this page: pipeline_status/current flips to "running" on pickup.',
  });
});

/**
 * POST /api/estate/ops/pipeline/step — run ONE pipeline stage (owner ask
 * 2026-08-16). Same requireDevops() tier, same request-document mechanism
 * as the full-pipeline trigger above, with one extra field (`step`) the
 * home machine's watcher now understands (app/tools/pipeline_watcher.py).
 *
 * Dependency/interlock enforcement, in order:
 *   1. `step` must be one of the 7 known keys (400 otherwise) — never
 *      forwards an arbitrary string into the request document, even though
 *      firestore.rules would also reject it; failing fast here is a better
 *      error message than a silent watcher discard 3 minutes later.
 *   2. checkPipelineBusy() — see that function's comment: a real, live
 *      check (not just a UI hint) that answers 409 immediately when a run
 *      is already in flight, rather than letting the caller wait ~3 minutes
 *      to find out the watcher discarded the request. Fails OPEN on an
 *      unreadable status doc — the real safety net (the lock on the home
 *      machine) still holds regardless.
 * Ordering dependencies BEYOND "is anything else running" (e.g. "upload
 * needs detect first") are deliberately NOT enforced here: every step is
 * self-sufficient by construction (see sync_to_drive.py's _step_upload(),
 * which always re-runs detect internally) — the status page shows an
 * advisory hint using real published data, but nothing on this route
 * refuses a step for being "out of order", because doing so would be
 * enforcing an ordering that does not actually exist in the underlying code.
 */
opsRoutes.post('/estate/ops/pipeline/step', requireDevops(), async (c) => {
  const body = await c.req.json().catch(() => null);
  const step = (body as { step?: unknown } | null)?.step;
  if (!isPipelineStepKey(step)) {
    return c.json({ error: 'invalid_step', choices: PIPELINE_STEP_KEYS }, 400);
  }

  const { token, sa, unset } = pipelineTriggerConfigOrUnset(c);
  if (!sa) return unset!;

  const accessToken = await mintAccessToken(sa);
  const busy = await checkPipelineBusy(sa, accessToken);
  if (busy) return c.json({ error: 'pipeline_busy', detail: busy }, 409);

  const actor = c.get('actor');
  const nowIso = new Date().toISOString();
  const fields = pipelineStepRequestFields({
    token: token!,
    requestedBy: `estate-ops:${actor.email}`,
    nowIso,
    step,
  });

  const res = await firestoreRequest(sa, accessToken, 'POST', PIPELINE_REQUESTS_COLLECTION, { fields });
  if (!res.ok) {
    return c.json({ error: 'firestore_error', status: res.status }, 502);
  }

  // Audit trail — who requested WHICH step, when. Same shape/role as the
  // site-roles grant/revoke lines and the full-pipeline trigger above.
  console.log(
    JSON.stringify({ evt: 'pipeline_step_requested', actor: actor.email, step, requestedAt: nowIso }),
  );

  const label = PIPELINE_STEPS[step].label;
  return c.json({
    requested: true,
    step,
    requestedAt: nowIso,
    detail:
      `Requested step "${label}" — the home machine checks every ~3 minutes, so it starts ` +
      'within ~3 min (or is skipped if a run is already going or the cooldown is active). ' +
      'Watch the Pipeline row: pipeline_status/current flips to "running" on pickup.',
  });
});

/**
 * POST /api/estate/ops/pipeline/force-upload — the standalone shelf-server
 * reconciliation (owner ask 2026-08-16: "a button to force a full upload to
 * the server... without the full pipeline"). Deliberately its own route,
 * not under /step: it is NOT one of the 7 pipeline stages (no entry in
 * PIPELINE_STEPS) — see scripts/sync_to_server.py's module docstring on the
 * audiobook_catalog side for why.
 *
 * ⚠️ This route can only ever QUEUE the request — it has no way to know
 * from here whether the shelf server exists, is configured, or is
 * reachable (that is local state on the home machine). The honest result
 * (including "not configured yet — the box doesn't exist") is published by
 * sync_to_server.py to shelf_upload_status/current, which the status page's
 * "Shelf upload" row reads; this response only confirms the request queued.
 */
opsRoutes.post('/estate/ops/pipeline/force-upload', requireDevops(), async (c) => {
  const { token, sa, unset } = pipelineTriggerConfigOrUnset(c);
  if (!sa) return unset!;

  const accessToken = await mintAccessToken(sa);
  const busy = await checkPipelineBusy(sa, accessToken);
  if (busy) return c.json({ error: 'pipeline_busy', detail: busy }, 409);

  const actor = c.get('actor');
  const nowIso = new Date().toISOString();
  const fields = pipelineStepRequestFields({
    token: token!,
    requestedBy: `estate-ops:${actor.email}`,
    nowIso,
    step: FORCE_UPLOAD_STEP,
  });

  const res = await firestoreRequest(sa, accessToken, 'POST', PIPELINE_REQUESTS_COLLECTION, { fields });
  if (!res.ok) {
    return c.json({ error: 'firestore_error', status: res.status }, 502);
  }

  console.log(
    JSON.stringify({ evt: 'pipeline_force_upload_requested', actor: actor.email, requestedAt: nowIso }),
  );

  return c.json({
    requested: true,
    requestedAt: nowIso,
    detail:
      'Requested — the home machine will check whether the shelf server is configured and ' +
      'reachable and report honestly either way (it may not be built yet). Watch the "Shelf ' +
      'upload" row for the result; this only confirms the request was queued, not that ' +
      'anything moved.',
  });
});
