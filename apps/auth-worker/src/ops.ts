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
 * The 8 pipeline stages this route can trigger individually. `kind` is the
 * blast-radius classification the status page's UI uses to pick a
 * confirmation tier (admin.js's confirmBtn two-tap idiom, reused via
 * assets/estate-controls.js):
 *   read-only  — audit, detect: plain button, no confirmation.
 *   mutating   — sort, folders, upload: two-tap confirm.
 *   publishing — catalog, publish, link: two-tap confirm PLUS an explicit
 *                "this updates the live site" warning.
 *
 * ⚠️ `link` (STEP 11, added 2026-08-23) is classified `publishing` rather than
 * `mutating` for a reason none of the others share: it writes a DIFFERENT
 * APPLICATION's production D1 — the library catalogue's `audiobook_holding`
 * table, via that repo's backfill-audiobook-holdings.mjs. A button that
 * reaches into another app's live database earns the top confirmation tier.
 */
export const PIPELINE_STEPS = {
  audit: { label: 'Purchase audit', kind: 'read-only' },
  sort: { label: 'Sort books', kind: 'mutating' },
  detect: { label: 'Detect new books', kind: 'read-only' },
  folders: { label: 'Read Drive folders', kind: 'mutating' },
  upload: { label: 'Upload to Drive', kind: 'mutating' },
  catalog: { label: 'Rebuild catalog', kind: 'publishing' },
  publish: { label: 'Commit & deploy', kind: 'publishing' },
  link: { label: 'Link sibling catalogues', kind: 'publishing' },
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
 * to the 8 stage keys or FORCE_UPLOAD_STEP).
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
 * not under /step: it is NOT one of the 8 pipeline stages (no entry in
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

// ---------------------------------------------------------------------------
// Ingestion pause / resume (owner order 2026-08-18, verbatim: "give me a way
// to pause and start the process flow on the GABI dashboard. Tonight starting
// at 7pm I need all of this paused until midnight. So let me also set pause
// timers on the ui. I can say don't even check to start until x time.").
//
// ⚠️ THIS IS A STATE DOCUMENT, NOT A REQUEST DOCUMENT — the one place this
// pair of routes deliberately departs from everything above it in this file.
// The triggers above write into `pipeline_requests`, which is create-only,
// unreadable, consumed once and deleted; that shape is right for "do a thing
// now" and wrong for "and stay this way for five hours". A pause has to
// SURVIVE being read: the home machine consults it before every run, and this
// page has to be able to render what is currently true (an owner who cannot
// see that his 7pm pause landed has not been given a pause control, he has
// been given a button). So the control lives in its own single document that
// is read and merged, never queued.
//
// ⚠️ THE CONTRACT IS OWNED ELSEWHERE, AND WAS RECONCILED AGAINST THE READER
// BEFORE THIS SHIPPED (2026-08-18). The processor that obeys this document is
// audiobook_catalog's `app/core/ingest_control.py` — read directly, since the
// concurrent build had landed it in that repo's working tree but had not yet
// committed it or written its info doc. Two things came back different from
// the shape this route was first written to, and BOTH were changed here
// rather than there, per the brief's rule that their names win:
//
//   1. the document is `ingestion_control/state`, not `.../current`
//      (CONTROL_COLLECTION / CONTROL_DOC in that file; the /dev/ lane uses
//      `ingestion_control_dev`, which this apex-only page never touches);
//   2. their `paused` flag is an UNCONDITIONAL block — see the note below,
//      which is the more consequential of the two.
// The field names themselves matched exactly (paused, paused_until,
// dont_check_until, pause_windows[{from,until}], updated_by, updated_at).
//
// ⚠️ "PAUSE UNTIL" WRITES `paused: false`, DELIBERATELY, AND IT IS NOT A HALF
// SET FLAG. control_blocks_start() checks, in order: unreadable → paused ===
// true → paused_until in the future → inside a pause window. Step 2 never
// consults the timer, so writing BOTH would leave the flag true at midnight
// and the machine paused indefinitely — the exact opposite of "paused until
// midnight". A timed pause is therefore a timer with the flag OFF, and it
// expires by itself, which is what the owner asked for. "Pause now" is the
// flag with no timer; Resume clears everything.
// ---------------------------------------------------------------------------

/**
 * The control document — path pinned to audiobook_catalog's CONTROL_COLLECTION
 * + CONTROL_DOC. Prod collection unconditionally, same reasoning as
 * PIPELINE_REQUESTS_COLLECTION above: production is the lane that actually
 * ingests on the home machine, and a dev-lane pause that paused nothing would
 * be worse than no control at all.
 */
export const INGESTION_CONTROL_DOC = 'ingestion_control/state';

/**
 * The writable actions the status surfaces offer. `resume` is the one that must
 * always work: it clears every pause the others can set.
 *
 * ⚠️ `start_now` IS NOT A SYNONYM FOR `resume`, and the difference is one line
 * of the document (owner-approved fine control #2, 2026-08-18). Both clear
 * `paused` / `paused_until` / `dont_check_until`. **`resume` additionally drops
 * any `pause_window` currently in force**, because otherwise it re-pauses
 * seconds later and reads as "Resume did nothing". `start_now` leaves
 * `pause_windows` **completely untouched** — it is the inverse of the pause
 * card's levers, not a history eraser: the owner's standing quiet hours are a
 * schedule he set on purpose, and a "start now" that silently deleted tonight's
 * 7pm-to-midnight window would take a recurring instruction away to satisfy a
 * one-off one. Consequence, and it is stated on the button: inside a live
 * window `start_now` clears the ad-hoc pauses and the window still blocks the
 * start. That is the honest behaviour, not a bug.
 *
 * ⚠️ `requeue` and `priority_front` APPEND to a list the PROCESSOR consumes or
 * reads; they are not pauses and carry `book_ids`, never `until`. See
 * `nextIngestionControl` for the append rules and `audiobook_catalog`'s
 * `app/core/ingest_queue.py` for what each one does when it lands.
 */
export const INGESTION_ACTIONS = [
  'pause',
  'resume',
  'pause_until',
  'dont_check_until',
  'start_now',
  'requeue',
  'priority_front',
  'priority_front_clear',
] as const;
export type IngestionAction = (typeof INGESTION_ACTIONS)[number];

/**
 * ⚠️ MIRRORS `audiobook_catalog/app/core/ingest_control.py`'s `MAX_REQUEUE` /
 * `MAX_PRIORITY_FRONT` / `MAX_CONTROL_ENTRY_CHARS`. No shared module across the
 * two repos — the same duplication story as `PIPELINE_STEPS` above. The
 * processor caps defensively on read regardless of what this writes, so a drift
 * here costs entries silently dropped on the far side, not a crash; keeping the
 * numbers equal is what makes the dashboard's count and the processor's agree.
 */
export const MAX_CONTROL_LIST = 200;
export const MAX_CONTROL_ENTRY_CHARS = 200;

/**
 * Clean a `book_ids` array from a browser into the list the processor will
 * accept. Pure. Order preserved, duplicates dropped keeping the first — for
 * `priority_front` the order IS the instruction.
 */
export function cleanBookIds(raw: unknown): { ids: string[]; dropped: number } {
  if (!Array.isArray(raw)) return { ids: [], dropped: 0 };
  const ids: string[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      dropped++;
      continue;
    }
    const text = entry.trim();
    if (!text || text.length > MAX_CONTROL_ENTRY_CHARS) {
      dropped++;
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (ids.length >= MAX_CONTROL_LIST) {
      dropped++;
      continue;
    }
    ids.push(text);
  }
  return { ids, dropped };
}

export function isIngestionAction(value: unknown): value is IngestionAction {
  return typeof value === 'string' && (INGESTION_ACTIONS as readonly string[]).includes(value);
}

export interface IngestionWindow {
  from: string | null;
  until: string | null;
}

export interface IngestionControl {
  paused: boolean;
  paused_until: string | null;
  dont_check_until: string | null;
  pause_windows: IngestionWindow[];
  /** ⚠️ CONSUMED by the processor at its next run start, then removed by it.
   *  A non-empty list here means "not acted on yet"; empty means either nobody
   *  asked or the processor already did. The page must word it that way — it
   *  cannot tell the two apart from this field alone. */
  requeue: string[];
  /** ⚠️ NOT consumed. A standing preference until the dashboard clears it. */
  priority_front: string[];
  updated_by: string | null;
  updated_at: string | null;
}

type FsValue = Record<string, unknown>;

/** Decode the handful of Firestore REST typed values this document uses.
 *  Deliberately narrow — an unexpected type decodes to null rather than to
 *  something plausible, so a malformed field reads as "unset", never as a
 *  pause that is not really there. */
function fsValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return null;
  const o = v as FsValue;
  if ('nullValue' in o) return null;
  if (typeof o.stringValue === 'string') return o.stringValue;
  if (typeof o.booleanValue === 'boolean') return o.booleanValue;
  if (typeof o.timestampValue === 'string') return o.timestampValue;
  if (o.mapValue && typeof o.mapValue === 'object') {
    return fsMap((o.mapValue as { fields?: Record<string, unknown> }).fields ?? {});
  }
  if (o.arrayValue && typeof o.arrayValue === 'object') {
    const values = (o.arrayValue as { values?: unknown[] }).values ?? [];
    return values.map(fsValue);
  }
  return null;
}

function fsMap(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) out[k] = fsValue(fields[k]);
  return out;
}

function asIsoOrNull(v: unknown): string | null {
  return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
}

/**
 * A Firestore REST document (or null / 404 shape) → the plain control object.
 * Pure, so every normalization below is testable without a live project.
 * A document that exists but is empty decodes to the same "nothing is
 * paused" shape as a fresh one, which is the safe reading: a control
 * surface must never invent a pause nobody set.
 */
export function decodeIngestionControl(doc: unknown): IngestionControl | null {
  const fields = (doc as { fields?: Record<string, unknown> } | null)?.fields;
  if (!fields) return null;
  const m = fsMap(fields);
  const rawWindows = Array.isArray(m.pause_windows) ? (m.pause_windows as unknown[]) : [];
  return {
    paused: m.paused === true,
    paused_until: asIsoOrNull(m.paused_until),
    dont_check_until: asIsoOrNull(m.dont_check_until),
    pause_windows: rawWindows
      .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
      .map((w) => ({ from: asIsoOrNull(w.from), until: asIsoOrNull(w.until) })),
    // Same narrow posture as every field above: an unexpected type reads as
    // "unset", never as something plausible. The processor writes these too
    // (it removes consumed requeue entries), so this decoder meets values this
    // Worker did not produce.
    requeue: cleanBookIds(m.requeue).ids,
    priority_front: cleanBookIds(m.priority_front).ids,
    updated_by: typeof m.updated_by === 'string' ? m.updated_by : null,
    updated_at: asIsoOrNull(m.updated_at),
  };
}

/** The control object → Firestore REST typed fields. `null` is written as an
 *  explicit nullValue rather than omitted, so clearing a timer actually
 *  clears it instead of leaving the previous value in place. */
export function ingestionControlFields(control: IngestionControl) {
  return {
    paused: { booleanValue: control.paused },
    paused_until: control.paused_until
      ? { stringValue: control.paused_until }
      : { nullValue: null as null },
    dont_check_until: control.dont_check_until
      ? { stringValue: control.dont_check_until }
      : { nullValue: null as null },
    pause_windows: {
      arrayValue: {
        values: control.pause_windows.map((w) => ({
          mapValue: {
            fields: {
              from: w.from ? { stringValue: w.from } : { nullValue: null as null },
              until: w.until ? { stringValue: w.until } : { nullValue: null as null },
            },
          },
        })),
      },
    },
    requeue: {
      arrayValue: { values: control.requeue.map((id) => ({ stringValue: id })) },
    },
    priority_front: {
      arrayValue: { values: control.priority_front.map((id) => ({ stringValue: id })) },
    },
    updated_by: control.updated_by
      ? { stringValue: control.updated_by.slice(0, 120) }
      : { nullValue: null as null },
    updated_at: control.updated_at
      ? { stringValue: control.updated_at }
      : { nullValue: null as null },
  };
}

/** Order-sensitive list equality — for `priority_front` the order IS the
 *  instruction, so a reordering is a real change and must enter the mask. */
export function sameIdList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** An empty control — what a missing document means. */
export function emptyIngestionControl(): IngestionControl {
  return {
    paused: false,
    paused_until: null,
    dont_check_until: null,
    pause_windows: [],
    requeue: [],
    priority_front: [],
    updated_by: null,
    updated_at: null,
  };
}

/**
 * Compute the document to write. Pure: (current, action, until, actor, now)
 * → the next control, or an error string for the caller to turn into a 400.
 *
 * ⚠️ SELF-CLEARING IS PART OF EVERY WRITE, not a separate sweep (owner ask:
 * "past times self-clear on next write"). Any timer already in the past is
 * dropped here, so the document can never accumulate a museum of expired
 * pauses that a later reader has to reason about. It is done on WRITE and
 * never on read: a GET that mutated would make simply LOOKING at this page
 * change the machine's state, which is the kind of surprise a control
 * surface must not have.
 *
 * `resume` is deliberately total — it clears the flag, both timers, and any
 * window currently in force, because the one thing an owner must be able to
 * trust about a Resume button is that pressing it leaves nothing behind.
 */
export function nextIngestionControl(input: {
  current: IngestionControl | null;
  action: IngestionAction;
  until?: unknown;
  bookIds?: unknown;
  actor: string;
  nowMs: number;
}): { control: IngestionControl } | { error: string; detail: string } {
  const now = input.nowMs;
  const nowIso = new Date(now).toISOString();
  const base = input.current ?? emptyIngestionControl();

  // Self-clear: anything whose moment has passed is gone from this write on.
  const keptWindows = base.pause_windows.filter(
    (w) => w.until !== null && Date.parse(w.until) > now,
  );
  const keptPausedUntil =
    base.paused_until && Date.parse(base.paused_until) > now ? base.paused_until : null;
  const keptDontCheck =
    base.dont_check_until && Date.parse(base.dont_check_until) > now ? base.dont_check_until : null;

  const next: IngestionControl = {
    paused: base.paused,
    paused_until: keptPausedUntil,
    dont_check_until: keptDontCheck,
    pause_windows: keptWindows,
    // ⚠️ Carried through UNCHANGED by every pause/resume action. These lists
    // belong to a different conversation than the pause does, and a Resume that
    // quietly emptied the owner's priority list would be a control with a side
    // effect nobody could see.
    requeue: [...base.requeue],
    priority_front: [...base.priority_front],
    updated_by: input.actor,
    updated_at: nowIso,
  };

  // ── The two list actions ────────────────────────────────────────────────
  // They APPEND rather than replace, because two rows clicked a second apart
  // are two requests: a replace would make the second click silently cancel
  // the first, which is the opposite of what pressing two buttons means.
  if (input.action === 'requeue' || input.action === 'priority_front') {
    const { ids, dropped } = cleanBookIds(input.bookIds);
    if (!ids.length) {
      return {
        error: 'no_book_ids',
        detail:
          dropped > 0
            ? 'None of those book ids could be read. Pick the books again and retry.'
            : 'No books were named, so there is nothing to do.',
      };
    }
    const field = input.action === 'requeue' ? 'requeue' : 'priority_front';
    // ⚠️ Re-cleaned after the merge, not just concatenated: that is what dedupes
    // against what is ALREADY on the list and re-applies the cap, so clicking
    // the same row twice cannot grow the document without bound. An id already
    // present is a no-op that still reports success — the state the caller
    // asked for IS the state — and the route's response says how many landed so
    // a button that appears to do nothing has a sentence explaining why.
    const merged = cleanBookIds([...next[field], ...ids]);
    return { control: { ...next, [field]: merged.ids } };
  }

  if (input.action === 'priority_front_clear') {
    // ⚠️ Clears the PRIORITY list only, never `requeue`. A requeue is somebody's
    // outstanding retry request; sweeping it away while clearing an unrelated
    // preference would lose work with no trace.
    return { control: { ...next, priority_front: [] } };
  }

  if (input.action === 'start_now') {
    // The inverse of every pause lever — and NOT `resume`. See the comment on
    // INGESTION_ACTIONS: `pause_windows` is deliberately left exactly as it is,
    // expired entries aside (those were already dropped by the self-clear
    // above, which is bookkeeping, not a schedule change).
    next.paused = false;
    next.paused_until = null;
    next.dont_check_until = null;
    return { control: next };
  }

  if (input.action === 'pause') {
    next.paused = true;
    next.paused_until = null; // an indefinite pause has no end time by definition
    return { control: next };
  }

  if (input.action === 'resume') {
    next.paused = false;
    next.paused_until = null;
    next.dont_check_until = null;
    // A window in force would otherwise re-pause it seconds later, which
    // would read as "Resume did nothing".
    next.pause_windows = keptWindows.filter(
      (w) => w.from !== null && Date.parse(w.from) > now,
    );
    return { control: next };
  }

  // The two timed actions share their validation: a real ISO instant, in the
  // future. "In the past" is refused rather than silently accepted, because
  // the write would self-clear it on the spot and the owner would be looking
  // at a control that reported success and changed nothing.
  const until = typeof input.until === 'string' ? Date.parse(input.until) : NaN;
  if (!Number.isFinite(until)) {
    return {
      error: 'invalid_until',
      detail: 'That time could not be read. Pick a date and time and try again.',
    };
  }
  if (until <= now) {
    return {
      error: 'until_in_the_past',
      detail: 'That time has already passed — pick a time in the future.',
    };
  }
  const untilIso = new Date(until).toISOString();

  if (input.action === 'pause_until') {
    // Timer ON, flag OFF — see the section header. The flag is cleared
    // EXPLICITLY rather than left alone, because a "Pause until midnight"
    // pressed while an indefinite pause was already in force would otherwise
    // inherit that flag and never expire.
    next.paused = false;
    next.paused_until = untilIso;
    return { control: next };
  }

  next.dont_check_until = untilIso;
  return { control: next };
}

/**
 * GET /api/estate/ops/ingestion — read the control document.
 *
 * Read through the WORKER rather than straight off the public Firestore REST
 * path the way the status page reads pipeline_status/current. Two reasons,
 * and the second is the load-bearing one: (1) this card is gated to devops
 * anyway, so there is nothing to gain from an anonymous read; (2) it means
 * this page never needs `allow read: if true` on the control collection, so
 * the audiobook_catalog side is free to keep the document closed like
 * pipeline_requests. Choosing the public path would have quietly imposed a
 * rules change on a repo this build is not allowed to touch.
 *
 * Answers 200 with `control: null` when the document does not exist — a
 * missing control is a real, ordinary state ("nobody has ever paused"), not
 * an error, and the card words it as such.
 */
opsRoutes.get('/estate/ops/ingestion', requireDevops(), async (c) => {
  const { sa, unset } = serviceAccountOrUnset(c);
  if (!sa) return unset!;

  const accessToken = await mintAccessToken(sa);
  let res: Response;
  try {
    res = await firestoreRequest(sa, accessToken, 'GET', INGESTION_CONTROL_DOC);
  } catch {
    return c.json({ error: 'firestore_unreachable' }, 502);
  }
  if (res.status === 404) {
    return c.json({ exists: false, control: null, now: new Date().toISOString(), doc: INGESTION_CONTROL_DOC });
  }
  if (!res.ok) return c.json({ error: 'firestore_error', status: res.status }, 502);

  const doc = await res.json().catch(() => null);
  const control = decodeIngestionControl(doc);
  return c.json({
    exists: control !== null,
    control,
    now: new Date().toISOString(),
    doc: INGESTION_CONTROL_DOC,
  });
});

/**
 * POST /api/estate/ops/ingestion — pause, resume, or set a timer.
 *
 * Same requireDevops() tier as every other control in this file, so the
 * refusal wording the status page already has for 401/403 covers this too.
 *
 * ⚠️ NO BUSY-CHECK, DELIBERATELY, unlike every route above. checkPipelineBusy()
 * exists to stop a caller QUEUEING a run that would be refused — but pausing
 * during a run is not a mistake, it is the single most likely moment someone
 * reaches for this control. And Resume must never be blocked by anything: a
 * control that can be set but not cleared is worse than no control.
 *
 * The write is a PATCH with an explicit updateMask (never a whole-document
 * PUT), so fields this route does not own — anything the home machine adds
 * later — survive untouched. `pause_windows` is in the mask ONLY when a
 * window actually expired and was dropped, so an ordinary pause/resume can
 * never clobber a window list written by the other side.
 */
opsRoutes.post('/estate/ops/ingestion', requireDevops(), async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    action?: unknown;
    until?: unknown;
    book_ids?: unknown;
  } | null;
  const action = body?.action;
  if (!isIngestionAction(action)) {
    return c.json(
      { error: 'invalid_action', detail: 'Unknown control.', choices: INGESTION_ACTIONS },
      400,
    );
  }

  const { sa, unset } = serviceAccountOrUnset(c);
  if (!sa) return unset!;
  const accessToken = await mintAccessToken(sa);

  let current: IngestionControl | null = null;
  try {
    const readRes = await firestoreRequest(sa, accessToken, 'GET', INGESTION_CONTROL_DOC);
    if (readRes.ok) current = decodeIngestionControl(await readRes.json().catch(() => null));
    else if (readRes.status !== 404) {
      return c.json({ error: 'firestore_error', status: readRes.status }, 502);
    }
  } catch {
    return c.json({ error: 'firestore_unreachable' }, 502);
  }

  const actor = c.get('actor');
  const computed = nextIngestionControl({
    current,
    action,
    until: body?.until,
    bookIds: body?.book_ids,
    actor: `estate-ops:${actor.email}`,
    nowMs: Date.now(),
  });
  if ('error' in computed) return c.json(computed, 400);
  const control = computed.control;

  const windowsChanged =
    (current?.pause_windows.length ?? 0) !== control.pause_windows.length;
  const mask = ['paused', 'paused_until', 'dont_check_until', 'updated_by', 'updated_at'];
  if (windowsChanged) mask.push('pause_windows');
  // ⚠️ EACH LIST ENTERS THE MASK ONLY WHEN THIS WRITE CHANGES IT, exactly as
  // `pause_windows` does, and for a sharper version of the same reason. The
  // PROCESSOR writes `requeue` too — it removes the entries it has consumed —
  // so a pause that carried the whole document would re-add ids the home
  // machine had just finished acting on, and books would be re-queued forever
  // by a button nobody pressed. Comparing against `current` (what Firestore
  // actually held moments ago) rather than against a default is what makes
  // that check meaningful.
  if (!sameIdList(current?.requeue ?? [], control.requeue)) mask.push('requeue');
  if (!sameIdList(current?.priority_front ?? [], control.priority_front)) {
    mask.push('priority_front');
  }
  const query = mask.map((f) => `updateMask.fieldPaths=${f}`).join('&');

  const allFields = ingestionControlFields(control) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const f of mask) fields[f] = allFields[f];

  let writeRes: Response;
  try {
    writeRes = await firestoreRequest(sa, accessToken, 'PATCH', `${INGESTION_CONTROL_DOC}?${query}`, {
      fields,
    });
  } catch {
    return c.json({ error: 'firestore_unreachable' }, 502);
  }
  if (!writeRes.ok) return c.json({ error: 'firestore_error', status: writeRes.status }, 502);

  // The audit line — who paused what, when. Same shape and role as the
  // pipeline_step_requested / role-grant lines.
  console.log(
    JSON.stringify({
      evt: 'ingestion_control_set',
      actor: actor.email,
      action,
      paused: control.paused,
      paused_until: control.paused_until,
      dont_check_until: control.dont_check_until,
      // The ids, not just the counts: this line is the only record of WHICH
      // book somebody asked to retry, and a count cannot be traced back.
      requeue: control.requeue,
      priority_front: control.priority_front,
      at: control.updated_at,
    }),
  );

  return c.json({
    ok: true,
    action,
    control,
    doc: INGESTION_CONTROL_DOC,
    detail: ingestionActionDetail(action, control),
  });
});

/**
 * The one sentence the page shows after a write. ⚠️ EVERY LIST ACTION SAYS
 * "NOT YET DONE", because that is the truth: this Worker wrote a line in a
 * document, and the home machine acts on it at the top of its next run. A
 * control that reported "re-queued" the instant the write returned would be
 * claiming an outcome it has no way to observe — the same silent-optimism
 * failure the /status pages exist to end.
 */
export function ingestionActionDetail(action: IngestionAction, control: IngestionControl): string {
  switch (action) {
    case 'requeue':
      return (
        `${control.requeue.length} book${control.requeue.length === 1 ? '' : 's'} now queued for retry. ` +
        'Nothing has been retried yet — the home machine applies the list at the start of its next ' +
        'run (it checks every 30 minutes) and clears each id as it acts on it. A book that already ' +
        'succeeded is left alone, and an id it does not recognise is dropped and logged.'
      );
    case 'priority_front':
      return (
        `${control.priority_front.length} entr${control.priority_front.length === 1 ? 'y' : 'ies'} at the front of the queue. ` +
        'This is a standing preference, not a one-off: it stays until you clear it. It changes what ' +
        'gets asked FIRST and waives no guard — the window, the pause, the GPU and CPU guards and the ' +
        'deadline all still apply.'
      );
    case 'priority_front_clear':
      return 'The priority list is empty. The queue goes back to its ordinary tier order. Any pending retry requests were left alone.';
    case 'start_now':
      return (
        'Cleared the pause, the pause timer and the don’t-check timer. Scheduled quiet hours were ' +
        'deliberately NOT touched — if one is in force right now it still blocks the start, and the ' +
        'card above says so. Ingestion is allowed to start, which is not the same as starting: the ' +
        'home machine checks every 30 minutes and the machine guards still apply.'
      );
    default:
      return 'Saved. The home machine reads this document before every book.';
  }
}
