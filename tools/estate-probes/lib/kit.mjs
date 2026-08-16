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
 */

const DEFAULT_TIMEOUT_MS = 15_000;

/** One row per assertion. Populated by check(), read by printTable(). */
export const results = [];
let passed = 0;
let failed = 0;

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
    console.log(`  ok  [${area}:${id}] ${method} ${endpoint} — ${assertion}`);
  } else {
    failed += 1;
    console.error(`FAIL  [${area}:${id}] ${method} ${endpoint} — ${assertion}${observed ? `\n        observed: ${observed}` : ''}`);
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
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
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
