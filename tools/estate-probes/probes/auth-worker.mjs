/**
 * auth.heygabi.ai (`apps/auth-worker`) — the unauthenticated edge of the
 * estate directory. Every assertion here is one of:
 *
 *   - a tokenless or garbage-token call to a gated route, expecting the
 *     `{ error: 'unauthenticated' }` / 401 shape every gate in this Worker
 *     shares (middleware/auth.ts: requireApprover, requireDevops; estate.ts's
 *     /me and /hello handlers) — verified by reading the source, not guessed;
 *   - a CORS preflight (OPTIONS, no bearer), checking which Origins the
 *     Worker admits — index.ts's adminCors()/meCors() mounts, read directly.
 *
 * Nothing here signs in, mints a token, or reaches a handler that would
 * write a row: every write-shaped route (`/estate/users`, `/estate/hello`)
 * is probed tokenless, and resolveIdentity() returns null before any
 * database call runs (estate.ts, docs.ts, middleware/auth.ts all check
 * `if (!identity) return 401` as their very first line).
 */

import { get, post, options, check, header } from '../lib/kit.mjs';
import { AUTH_ORIGIN, AUDIOBOOK_SITE_ORIGIN, APEX_ORIGIN, FOREIGN_ORIGIN, GARBAGE_BEARER } from '../lib/origins.mjs';

const AREA = 'auth';

function expectUnauthenticated(id, method, path, r) {
  const url = `${AUTH_ORIGIN}${path}`;
  if (!r.ok) {
    check(AREA, id, method, url, 'answers 401 { error: "unauthenticated" }', false, `request failed: ${r.error}`);
    return;
  }
  const ok = r.status === 401 && r.json?.error === 'unauthenticated';
  check(AREA, id, method, url, 'answers 401 { error: "unauthenticated" }', ok, `status=${r.status} body=${JSON.stringify(r.json)}`);
}

export async function probeAuthWorker() {
  // --- Tokenless 401s ---------------------------------------------------
  expectUnauthenticated('A1', 'GET', '/api/estate/me', await get(`${AUTH_ORIGIN}/api/estate/me`));
  expectUnauthenticated('A2', 'POST', '/api/estate/hello', await post(`${AUTH_ORIGIN}/api/estate/hello`));
  expectUnauthenticated('A3', 'GET', '/api/estate/docs/shelf-server', await get(`${AUTH_ORIGIN}/api/estate/docs/shelf-server`));
  expectUnauthenticated('A4', 'GET', '/api/estate/users', await get(`${AUTH_ORIGIN}/api/estate/users`));
  // Write-shaped route, tokenless — requireApprover() checks identity FIRST,
  // so this never reaches estate-db.ts's create path (docs.ts/estate.ts §gate).
  expectUnauthenticated('A5', 'POST', '/api/estate/users', await post(`${AUTH_ORIGIN}/api/estate/users`));

  // --- Garbage bearer tokens: verification fails, same 401 as tokenless ---
  expectUnauthenticated(
    'A6',
    'GET',
    '/api/estate/users',
    await get(`${AUTH_ORIGIN}/api/estate/users`, { headers: { Authorization: GARBAGE_BEARER } }),
  );
  expectUnauthenticated(
    'A7',
    'GET',
    '/api/estate/me',
    await get(`${AUTH_ORIGIN}/api/estate/me`, { headers: { Authorization: GARBAGE_BEARER } }),
  );

  // --- CORS: /hello shares /me's ME_ORIGINS (index.ts: meCors() on both) ---
  const helloUrl = `${AUTH_ORIGIN}/api/estate/hello`;
  const helloPre = await options(helloUrl, {
    headers: {
      Origin: AUDIOBOOK_SITE_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Authorization',
    },
  });
  if (!helloPre.ok) {
    check(AREA, 'A8', 'OPTIONS', helloUrl, `access-control-allow-origin === ${AUDIOBOOK_SITE_ORIGIN}`, false, `request failed: ${helloPre.error}`);
    check(AREA, 'A9', 'OPTIONS', helloUrl, 'access-control-allow-methods allows POST', false, `request failed: ${helloPre.error}`);
  } else {
    const acao = header(helloPre, 'access-control-allow-origin');
    check(AREA, 'A8', 'OPTIONS', helloUrl, `access-control-allow-origin === ${AUDIOBOOK_SITE_ORIGIN} (audiobook site is admitted, ME_ORIGINS)`, acao === AUDIOBOOK_SITE_ORIGIN, `ACAO=${acao}`);
    const acam = (header(helloPre, 'access-control-allow-methods') ?? '').toUpperCase();
    check(AREA, 'A9', 'OPTIONS', helloUrl, 'access-control-allow-methods includes POST', acam.includes('POST'), `ACAM=${acam}`);
  }

  const helloEvil = await options(helloUrl, {
    headers: { Origin: FOREIGN_ORIGIN, 'Access-Control-Request-Method': 'POST' },
  });
  if (!helloEvil.ok) {
    check(AREA, 'A10', 'OPTIONS', helloUrl, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, false, `request failed: ${helloEvil.error}`);
  } else {
    const acao = header(helloEvil, 'access-control-allow-origin');
    check(AREA, 'A10', 'OPTIONS', helloUrl, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, acao === null, `ACAO=${acao}`);
  }

  // --- CORS: the admin API (adminCors()) is apex-only, narrower than /me ---
  const usersUrl = `${AUTH_ORIGIN}/api/estate/users`;
  const usersApex = await options(usersUrl, {
    headers: { Origin: APEX_ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' },
  });
  if (!usersApex.ok) {
    check(AREA, 'A11', 'OPTIONS', usersUrl, `access-control-allow-origin === ${APEX_ORIGIN}`, false, `request failed: ${usersApex.error}`);
  } else {
    const acao = header(usersApex, 'access-control-allow-origin');
    check(AREA, 'A11', 'OPTIONS', usersUrl, `access-control-allow-origin === ${APEX_ORIGIN} (admin API, apex-only)`, acao === APEX_ORIGIN, `ACAO=${acao}`);
  }

  const usersEvil = await options(usersUrl, {
    headers: { Origin: FOREIGN_ORIGIN, 'Access-Control-Request-Method': 'GET' },
  });
  if (!usersEvil.ok) {
    check(AREA, 'A12', 'OPTIONS', usersUrl, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, false, `request failed: ${usersEvil.error}`);
  } else {
    const acao = header(usersEvil, 'access-control-allow-origin');
    check(AREA, 'A12', 'OPTIONS', usersUrl, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, acao === null, `ACAO=${acao}`);
  }
}
