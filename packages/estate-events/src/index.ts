/**
 * @platform/estate-events — the ONE way an estate Worker reports a significant
 * event to the /status event ring.
 *
 * Owner, 2026-08-18, on clicking into a health check and finding a placeholder:
 * **"fix this."**
 *
 * ⚠️ THE THREE PROPERTIES THAT MATTER, and every one of them is about NOT
 * making things worse:
 *
 *   1. **It never throws.** A Worker reporting an error must not be able to
 *      turn that error into a second, worse one. Every failure path here ends
 *      in a swallowed promise — the ring going quiet is a bad day; a checkout
 *      route 500-ing because its logger could not reach D1 is an incident.
 *   2. **It never blocks the response.** Reporting rides `waitUntil()`, so the
 *      person waiting on the request does not pay for the noticeboard. Without
 *      an ExecutionContext it still fires, un-awaited, and the caller is told
 *      in the doc rather than silently getting synchronous behaviour.
 *   3. **It is for events worth a HUMAN'S attention.** Errors, refusals worth
 *      seeing, deploy markers. Not requests, not cache misses, not "ok". The
 *      ring is capped per Worker, so a chatty writer evicts its own history —
 *      and the row that mattered goes with it.
 *
 * ⚠️ IT IS NOT A REPLACEMENT FOR console.log. Workers Logs still has everything;
 * this is the handful of lines that should be in front of someone looking at a
 * red row on /status, after the fact, with no Cloudflare token in the browser.
 * Log normally AND report here when it matters.
 *
 * Usage, in a Worker that already holds ESTATE_CONDUCTOR_TOKEN:
 *
 *   import { reportEvent } from '@platform/estate-events';
 *
 *   reportEvent(c.executionCtx, {
 *     endpoint: c.env.ESTATE_AUTH_URL,          // https://auth.heygabi.ai
 *     token: c.env.ESTATE_CONDUCTOR_TOKEN,
 *     worker: 'catalog-index',
 *     level: 'error',
 *     message: 'push rejected: bad source',
 *     route: new URL(c.req.url).pathname,
 *     detail: String(err),
 *   });
 */

export const EVENT_LEVELS = ['error', 'warn', 'info', 'deploy'] as const;
export type EventLevel = (typeof EVENT_LEVELS)[number];

export interface ReportInput {
  /** Base origin of the auth Worker, e.g. https://auth.heygabi.ai */
  endpoint: string;
  /** The conductor bearer this Worker already holds. Absent = report nothing. */
  token?: string;
  worker: string;
  level: EventLevel;
  message: string;
  route?: string | null;
  request_id?: string | null;
  detail?: string | null;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** The minimal slice of ExecutionContext this needs — narrow so a fake in a
 *  test never has to implement more than waitUntil(). */
export interface WaitUntilCtx {
  waitUntil(promise: Promise<unknown>): void;
}

/** Build the body. Exported so tests can pin the shape without a network. */
export function buildEventBody(input: ReportInput): Record<string, unknown> {
  return {
    worker: input.worker,
    level: input.level,
    message: input.message,
    at: new Date().toISOString(),
    route: input.route ?? null,
    request_id: input.request_id ?? null,
    detail: input.detail ?? null,
  };
}

/**
 * Send one event. Returns the in-flight promise so a caller that genuinely
 * wants to await it can, but the normal path hands it to `waitUntil`.
 *
 * ⚠️ A MISSING TOKEN OR ENDPOINT IS A NO-OP, NOT A THROW. A Worker that has not
 * been given the secret yet must keep working exactly as before — this is
 * additive to every writer, and "ships dark until configured" is the estate's
 * standing idiom.
 */
export async function sendEvent(input: ReportInput): Promise<boolean> {
  const { endpoint, token } = input;
  if (!endpoint || !token) return false;
  const doFetch = input.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${endpoint.replace(/\/+$/, '')}/api/estate/ops/worker-events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildEventBody(input)),
    });
    return res.ok;
  } catch {
    // ⚠️ Swallowed on purpose. See property 1 in the header: the logger must
    // never be able to break the thing it is logging about.
    return false;
  }
}

/**
 * Fire-and-forget. THE normal entry point.
 *
 * ⚠️ Pass the ExecutionContext when you have one. Without it the request still
 * goes out un-awaited, which on Workers means it may be cancelled when the
 * response finishes — an event lost is acceptable; a response delayed for a
 * noticeboard is not.
 */
export function reportEvent(ctx: WaitUntilCtx | null | undefined, input: ReportInput): void {
  const p = sendEvent(input).catch(() => false);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
}
