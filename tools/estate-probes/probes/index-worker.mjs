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
