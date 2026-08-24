/**
 * index.heygabi.ai (`apps/index-worker`) — the shared cross-catalog index.
 *
 * `/api/search` is the ONE read the anonymous internet may use
 * (search-route.ts's header: an absent/invalid token resolves to the public
 * slice `{audiobook}`, never a 401) — so its probe asserts a 200 with the
 * public-slice shape, not a refusal. Everything else (`/api/universe/:name`,
 * `/api/lookup`, `/api/scan/shelf`) is mounted AFTER the
 * `requireEstateMember()` blanket in index.ts, so a tokenless call 401s
 * before reaching any handler — `/api/scan/shelf` in particular spends real
 * money per call (vision.ts), which is exactly why that gate matters most
 * there.
 *
 * `/api/machine/*` (added 2026-08-23) is the third case: a NAMED MACHINE READ
 * exception mounted above the blanket, taking a per-app `INDEX_READ_TOKEN_*`
 * bearer. This suite holds no credentials of any kind (README: nothing here
 * signs in, nothing reads a secret), so it probes the UNAUTHENTICATED shape
 * only — which is the half worth pinning anyway:
 *
 *   - ⚠️ **never a 404.** A 404 here would read as "not built" and send an
 *     operator hunting for a feature that exists and is merely unkeyed. That
 *     is the single assertion most likely to catch a botched mount.
 *   - ⚠️ **never a 500.** An unauthenticated caller must not reach anything
 *     that can throw.
 *   - a WORDED refusal (`error` + `detail` + `needs` + `how`), because the
 *     estate rule is that no caller ever sees a bare status.
 *
 * ⚠️ **Two refusals are BOTH correct here, and the probe accepts either while
 * naming which it got.** `401 machine_token_missing` once the owner has minted
 * `INDEX_READ_TOKEN_LIBRARY`; `503 machine_read_unconfigured` before that. The
 * Worker deploys before the secret exists, so a probe demanding only the 401
 * would fail for a correctly-deployed Worker in exactly the window where
 * somebody is watching it — and the 503 is the one that NAMES the missing
 * secret, so seeing it is information, not a failure. What is not tolerated
 * either way is a 404, a 500, or an unworded body.
 */

import { get, post, options, check, header } from '../lib/kit.mjs';
import { INDEX_ORIGIN, APEX_ORIGIN, FOREIGN_ORIGIN } from '../lib/origins.mjs';

const AREA = 'index';

function expectUnauthenticated(id, method, path, r) {
  const url = `${INDEX_ORIGIN}${path}`;
  if (!r.ok) {
    check(AREA, id, method, url, 'answers 401 { error: "unauthenticated" }', false, `request failed: ${r.error}`);
    return;
  }
  const ok = r.status === 401 && r.json?.error === 'unauthenticated';
  check(AREA, id, method, url, 'answers 401 { error: "unauthenticated" }', ok, `status=${r.status} body=${JSON.stringify(r.json)}`);
}

/**
 * A machine-read route, called with no credential: a WORDED refusal that is
 * neither 404 nor 500. Both live shapes are accepted and the one seen is
 * printed — see this file's header for why that is the honest assertion.
 */
const MACHINE_REFUSALS = {
  401: 'machine_token_missing',
  503: 'machine_read_unconfigured',
};

async function expectMachineRefusal(id, path) {
  const url = `${INDEX_ORIGIN}${path}`;
  const want = 'worded refusal: 401 machine_token_missing OR 503 machine_read_unconfigured — never 404/500';
  const r = await get(url);
  if (!r.ok) {
    check(AREA, id, 'GET', url, want, false, `request failed: ${r.error}`);
    return;
  }
  const expectedError = MACHINE_REFUSALS[r.status];
  // Every field a refusal owes a person: what happened, what it needs, how to
  // get it (`detail`/`needs`/`how`). A bare `{ error }` fails this.
  const worded =
    r.json !== null &&
    typeof r.json === 'object' &&
    r.json.error === expectedError &&
    typeof r.json.detail === 'string' &&
    r.json.detail.length > 0 &&
    r.json.needs !== undefined &&
    typeof r.json.how === 'string' &&
    r.json.how.length > 0;
  check(AREA, id, 'GET', url, want, expectedError !== undefined && worded, `status=${r.status} body=${JSON.stringify(r.json)?.slice(0, 300)}`);
}

export async function probeIndexWorker() {
  // --- /api/search: the anonymous carve-out (search-route.ts §4.5) -------
  const searchUrl = `${INDEX_ORIGIN}/api/search?q=test`;
  const search = await get(searchUrl);
  if (!search.ok) {
    check(AREA, 'I1', 'GET', searchUrl, 'answers 200 (public slice, no 401)', false, `request failed: ${search.error}`);
  } else {
    check(AREA, 'I1', 'GET', searchUrl, 'answers 200 (public slice, no 401)', search.status === 200, `status=${search.status} body=${JSON.stringify(search.json)?.slice(0, 200)}`);
    const body = search.json;
    const shapeOk =
      body !== null &&
      typeof body === 'object' &&
      typeof body.query === 'string' &&
      Array.isArray(body.scope) &&
      Array.isArray(body.books) &&
      Array.isArray(body.games) &&
      Array.isArray(body.universes);
    check(AREA, 'I2', 'GET', searchUrl, 'body shape { query, scope, books, games, universes }', shapeOk, JSON.stringify(body)?.slice(0, 300));
    if (shapeOk) {
      check(
        AREA,
        'I3',
        'GET',
        searchUrl,
        'anonymous scope === ["audiobook"] (§4.5 public slice)',
        JSON.stringify(body.scope) === '["audiobook"]',
        `scope=${JSON.stringify(body.scope)}`,
      );
    }
  }

  // --- Members-only routes, tokenless: 401 before any handler runs -------
  expectUnauthenticated('I4', 'GET', '/api/universe/cosmere', await get(`${INDEX_ORIGIN}/api/universe/cosmere`));
  expectUnauthenticated('I5', 'GET', '/api/lookup?title=test', await get(`${INDEX_ORIGIN}/api/lookup?title=test`));
  // POST with no body: requireEstateMember() runs before route validation,
  // so an empty/garbage body never reaches scan.ts's zod-shaped checks.
  expectUnauthenticated('I6', 'POST', '/api/scan/shelf', await post(`${INDEX_ORIGIN}/api/scan/shelf`, { headers: { 'Content-Type': 'application/json' }, body: '{}' }));

  // --- /api/machine/*: the machine read exception, unauthenticated -------
  await expectMachineRefusal('I9', '/api/machine/lookup?title=test');
  await expectMachineRefusal('I10', '/api/machine/search?q=test');

  // ⚠️ NO CORS on /api/machine — mounted ABOVE readCors() deliberately, so a
  // browser can never call it cross-origin even from the apex, which
  // /api/search DOES admit (I7). This asserts the mount stayed above it: a
  // well-meaning "add CORS to the new routes" edit is the regression.
  const machineApex = await options(`${INDEX_ORIGIN}/api/machine/lookup?title=test`, {
    headers: { Origin: APEX_ORIGIN, 'Access-Control-Request-Method': 'GET' },
  });
  if (!machineApex.ok) {
    check(AREA, 'I11', 'OPTIONS', `${INDEX_ORIGIN}/api/machine/lookup`, `no access-control-allow-origin, even for ${APEX_ORIGIN}`, false, `request failed: ${machineApex.error}`);
  } else {
    const acao = header(machineApex, 'access-control-allow-origin');
    check(AREA, 'I11', 'OPTIONS', `${INDEX_ORIGIN}/api/machine/lookup`, `no access-control-allow-origin, even for ${APEX_ORIGIN} (machine routes are not browser-callable)`, acao === null, `ACAO=${acao}`);
  }

  // --- CORS on /api/search (readCors(), mounted before the route) --------
  const searchApex = await options(searchUrl, { headers: { Origin: APEX_ORIGIN, 'Access-Control-Request-Method': 'GET' } });
  if (!searchApex.ok) {
    check(AREA, 'I7', 'OPTIONS', searchUrl, `access-control-allow-origin === ${APEX_ORIGIN}`, false, `request failed: ${searchApex.error}`);
  } else {
    const acao = header(searchApex, 'access-control-allow-origin');
    check(AREA, 'I7', 'OPTIONS', searchUrl, `access-control-allow-origin === ${APEX_ORIGIN} (READ_ORIGINS default)`, acao === APEX_ORIGIN, `ACAO=${acao}`);
  }
  const searchEvil = await options(searchUrl, { headers: { Origin: FOREIGN_ORIGIN, 'Access-Control-Request-Method': 'GET' } });
  if (!searchEvil.ok) {
    check(AREA, 'I8', 'OPTIONS', searchUrl, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, false, `request failed: ${searchEvil.error}`);
  } else {
    const acao = header(searchEvil, 'access-control-allow-origin');
    check(AREA, 'I8', 'OPTIONS', searchUrl, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, acao === null, `ACAO=${acao}`);
  }
}
