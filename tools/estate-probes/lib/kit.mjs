/**
 * Shared harness for the estate probe suite — the reporting half of
 * `apps/auth-worker/test/live-probes.ts`'s idiom (a named `check()`, printed
 * as it runs, counted, exit-coded), lifted out so every worker's probes share
 * one implementation instead of five near-copies.
 *
 * ⚠️ Unlike live-probes.ts, this file talks to PRODUCTION over the open
 * internet, never to a local `wrangler dev`. Every request this kit issues
 * must stay inside the read-only, unauthenticated-edge contract described in
 * `../README.md`: GET, OPTIONS, or a POST that is expected to be refused by
 * an auth gate before any handler runs. Nothing here mints a token, reads a
 * secret, or is allowed to print one.
 *
 * ## ⚠️ IT ALSO RUNS INSIDE A WORKER NOW — 2026-09-05
 *
 * `apps/auth-worker/src/estate-probes.ts` imports `lib/suite.mjs`, which
 * imports this file and every module in `probes/`, so the hourly cron and
 * `npm run probe:estate` run the SAME 145 assertions from one list. Nothing in
 * this tree was Node-specific to begin with — no `node:` import, no `process`,
 * no disk — so nothing had to be ported. Two things had to CHANGE, and both are
 * about a Worker isolate outliving one run:
 *
 * 1. **`resetRun()`.** `results`/`passed`/`failed` are module state. A CLI
 *    process starts fresh every time; a Worker isolate is reused across cron
 *    firings, so without a reset the second run would report 290 checks and the
 *    tenth 1,450 — climbing, plausible, and wrong.
 * 2. **`configure()`.** The 15 s per-request timeout is right for a laptop on
 *    hotel wifi and far too long for a scheduled handler with 145 requests to
 *    make; and `console.error` on every failure would fill `wrangler tail`. Both
 *    are now injectable, with the CLI's old behaviour as the default.
 *
 * ⚠️ Anything added here that touches disk, spawns a process or reads an env
 * var breaks the Worker half SILENTLY — the bundle builds and the cron throws
 * at runtime. The probe modules are pure `fetch` and must stay that way; a
 * probe that genuinely needs a local resource belongs in the CLI-only list in
 * `../README.md`, not in `probes/`.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

/** One row per assertion. Populated by check(), read by printTable(). */
export const results = [];
let passed = 0;
let failed = 0;
let timeoutMs = DEFAULT_TIMEOUT_MS;
let logLine = (line) => console.log(line);
let logFail = (line) => console.error(line);
/**
 * ⚠️ THE TRANSPORT IS INJECTABLE, AND IT HAD TO BECOME SO — MEASURED
 * 2026-09-06 01:19 UTC, on the very first cron run.
 *
 * A Cloudflare Worker **cannot fetch its own zone.** The hourly run inside
 * `estate-auth` got **HTTP 522** (connection timed out) from every single
 * `auth.heygabi.ai` URL — 35 failed of 142 — while all seven other areas
 * passed. The same suite from a laptop was 145/145 the same evening, and curl
 * against the same paths answered 200/401 throughout, so ⚠️ **this was an
 * artifact of WHERE the probe ran, never a fact about production** — precisely
 * the kind of false red that teaches people to ignore a row.
 *
 * The fix is a self service binding: the Worker passes a `fetchImpl` that sends
 * same-zone URLs through `env.SELF.fetch()` (a direct handler invocation, no
 * edge loop) and everything else through global `fetch`. The CLI passes
 * nothing and keeps global `fetch` for all of it.
 */
let fetchImpl = null;

/**
 * Clear the run state. ⚠️ REQUIRED BEFORE EVERY RUN IN A LONG-LIVED HOST, and
 * harmless in a fresh process. `suite.mjs` calls it; nothing else should need
 * to. `results` is emptied IN PLACE rather than reassigned, because it is a
 * `const` export that `run.mjs` and the audits already hold a reference to.
 */
export function resetRun() {
  results.length = 0;
  passed = 0;
  failed = 0;
}

/**
 * Per-run knobs, all optional; omitted keys keep their current value.
 *
 * @param {{timeoutMs?: number, log?: (line: string) => void,
 *          logFailure?: (line: string) => void,
 *          fetchImpl?: (url: string, init: object) => Promise<Response>}} opts
 */
export function configure(opts = {}) {
  if (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) timeoutMs = opts.timeoutMs;
  if (typeof opts.log === 'function') logLine = opts.log;
  if (typeof opts.logFailure === 'function') logFail = opts.logFailure;
  if (typeof opts.fetchImpl === 'function') fetchImpl = opts.fetchImpl;
}

/** Restore the CLI defaults — used by tests so one run cannot leak into another. */
export function resetConfig() {
  timeoutMs = DEFAULT_TIMEOUT_MS;
  logLine = (line) => console.log(line);
  logFail = (line) => console.error(line);
  fetchImpl = null;
}

/**
 * Record one assertion and print it immediately (the live-probes.ts idiom:
 * see progress as the suite runs, not just at the end).
 *
 * @param area       short surface name, e.g. 'auth', 'index', 'library'
 * @param id         short stable id, e.g. 'A1', unique within `area`
 * @param method     HTTP method the probe used (or 'PARSE' for a body-shape
 *                   assertion that made no request of its own)
 * @param endpoint   the URL (or path) the assertion is about
 * @param assertion  human sentence describing what must be true
 * @param ok         boolean — did it hold
 * @param observed   what was actually seen, ALWAYS shown on failure
 */
export function check(area, id, method, endpoint, assertion, ok, observed = '') {
  const row = { area, id, method, endpoint, assertion, ok, observed };
  results.push(row);
  if (ok) {
    passed += 1;
    logLine(`  ok  [${area}:${id}] ${method} ${endpoint} — ${assertion}`);
  } else {
    failed += 1;
    logFail(`FAIL  [${area}:${id}] ${method} ${endpoint} — ${assertion}${observed ? `\n        observed: ${observed}` : ''}`);
  }
  return ok;
}

export function counts() {
  return { passed, failed };
}

/**
 * One HTTP request, tolerant of network failure — a timeout or DNS blip
 * becomes a FAILED check with the error as `observed`, never an uncaught
 * throw that kills the rest of the suite.
 */
export async function request(method, url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? timeoutMs);
  try {
    const send = fetchImpl ?? fetch;
    const resp = await send(url, {
      method,
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
      redirect: 'manual',
    });
    const text = await resp.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON — fine, e.g. the docs KV 404 or a non-JSON host. json stays null.
    }
    return { ok: true, status: resp.status, headers: resp.headers, text, json };
  } catch (err) {
    return { ok: false, status: 0, headers: new Headers(), text: '', json: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export const get = (url, opts) => request('GET', url, opts);
export const post = (url, opts) => request('POST', url, opts);
export const options = (url, opts) => request('OPTIONS', url, opts);

/** header() returns null both when absent and when the fetch itself failed. */
export function header(resp, name) {
  return resp.headers.get(name);
}

/** A compact PASS/FAIL table: endpoint, assertion, and observed value on failure. */
export function printTable() {
  const cols = [
    { key: 'status', label: 'STATUS', width: 6 },
    { key: 'area', label: 'AREA', width: 8 },
    { key: 'id', label: 'ID', width: 5 },
    { key: 'method', label: 'METHOD', width: 7 },
    { key: 'endpoint', label: 'ENDPOINT', width: 46 },
    { key: 'assertion', label: 'ASSERTION', width: 46 },
  ];
  const pad = (s, w) => (s.length > w ? `${s.slice(0, w - 1)}…` : s.padEnd(w));
  const header = cols.map((c) => pad(c.label, c.width)).join(' | ');
  console.log(`\n${header}`);
  console.log(cols.map((c) => '-'.repeat(c.width)).join('-|-'));
  for (const r of results) {
    const row = {
      status: r.ok ? 'PASS' : 'FAIL',
      area: r.area,
      id: r.id,
      method: r.method,
      endpoint: r.endpoint,
      assertion: r.assertion,
    };
    console.log(cols.map((c) => pad(String(row[c.key]), c.width)).join(' | '));
    if (!r.ok && r.observed) {
      console.log(`  observed: ${r.observed}`);
    }
  }
}
