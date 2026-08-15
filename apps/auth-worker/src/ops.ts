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
 * Gating: requireApprover() (the same admin gate as /estate/site-roles),
 * CORS apex-only (mounted in index.ts, mirroring the site-roles mount) and
 * the Worker-wide per-IP rate limiter (RATE_LIMITER, mounted on /api/* in
 * index.ts). Both secrets this route needs are configuration, not identity,
 * so a missing one answers 503 with the fix — same idiom as site-roles.ts.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from './env.js';
import { requireApprover } from './middleware/auth.js';
import { firestoreRequest, mintAccessToken, parseServiceAccount } from './firebase-sa.js';

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

export const opsRoutes = new Hono<AppBindings>();

opsRoutes.post('/estate/ops/pipeline', requireApprover(), async (c) => {
  // Checked before the service account so the two missing-config cases are
  // distinguishable — a deployer fixing one secret should not have to guess
  // whether the other is also unset.
  const token = c.env.PIPELINE_TRIGGER_TOKEN;
  if (!token) {
    return c.json(
      { error: 'pipeline_trigger_token_unset', fix: 'wrangler secret put PIPELINE_TRIGGER_TOKEN' },
      503,
    );
  }

  const { sa, unset } = serviceAccountOrUnset(c);
  if (!sa) return unset!;

  const actor = c.get('actor');
  const nowIso = new Date().toISOString();
  const fields = pipelineRequestFields({
    token,
    requestedBy: `estate-ops:${actor.email}`,
    nowIso,
  });

  const accessToken = await mintAccessToken(sa);
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
