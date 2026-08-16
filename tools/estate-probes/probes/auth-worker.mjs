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

import { get, post, request, options, check, header } from '../lib/kit.mjs';
import {
  AUTH_ORIGIN,
  AUDIOBOOK_SITE_ORIGIN,
  APEX_ORIGIN,
  LIBRARY_ORIGIN,
  FOREIGN_ORIGIN,
  GARBAGE_BEARER,
} from '../lib/origins.mjs';

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

  // --- Phase 1 (sso-design.md §4.1): the /__/auth/* proxy is LIVE and is a
  // TRUE proxy — Firebase's own content, never this Worker's { error:
  // 'not_found' } 404 shape (which would mean the mount was shadowed or
  // missing). Content is Firebase's own and may change; the only thing
  // pinned here is "not our router's 404", the one failure mode that would
  // actually matter (§4.1: "mounted before the API routes so it can never
  // be shadowed").
  const proxyUrl = `${AUTH_ORIGIN}/__/auth/handler`;
  const proxyResp = await get(proxyUrl);
  if (!proxyResp.ok) {
    check(AREA, 'A13', 'GET', proxyUrl, 'proxies to Firebase — not this Worker\'s 404 shape', false, `request failed: ${proxyResp.error}`);
  } else {
    const isOurNotFound = proxyResp.json?.error === 'not_found';
    check(
      AREA,
      'A13',
      'GET',
      proxyUrl,
      'proxies to Firebase (status !== 404, body is not this Worker\'s { error: "not_found" })',
      proxyResp.status !== 404 && !isOurNotFound,
      `status=${proxyResp.status} body=${proxyResp.text.slice(0, 120)}`,
    );
  }

  // --- Phase 2 (sso-design.md §4.3): the session routes. All three sit
  // safely idle pre-owner-console-step (docs/access/estate-auth.md §6) —
  // what is probed here is the tokenless/no-cookie edge, exactly like every
  // other unauthenticated-edge assertion in this suite. The TOKEN_SIGNER_KEY
  // 503 path is NOT reachable from here: it requires a live session, which
  // requires a real ID token this suite deliberately holds none of (see the
  // README's "What is NOT covered" — same class as every signed-in path).
  const sessionUrl = `${AUTH_ORIGIN}/api/session`;
  const sessionResp = await post(sessionUrl);
  check(
    AREA,
    'A14',
    'POST',
    sessionUrl,
    'tokenless → 401 { error: "unauthenticated" } (the canonical verifier, same shape as /me)',
    sessionResp.ok && sessionResp.status === 401 && sessionResp.json?.error === 'unauthenticated',
    sessionResp.ok ? `status=${sessionResp.status} body=${JSON.stringify(sessionResp.json)}` : `request failed: ${sessionResp.error}`,
  );

  const sessionTokenUrl = `${AUTH_ORIGIN}/api/session/token`;
  const sessionTokenResp = await post(sessionTokenUrl);
  check(
    AREA,
    'A15',
    'POST',
    sessionTokenUrl,
    'no cookie → 401 { error: "no_session" }, never a 500',
    sessionTokenResp.ok && sessionTokenResp.status === 401 && sessionTokenResp.json?.error === 'no_session',
    sessionTokenResp.ok ? `status=${sessionTokenResp.status} body=${JSON.stringify(sessionTokenResp.json)}` : `request failed: ${sessionTokenResp.error}`,
  );

  const sessionTokenBogus = await post(sessionTokenUrl, { headers: { Cookie: 'estate_session=probe-nonexistent-id' } });
  check(
    AREA,
    'A16',
    'POST',
    sessionTokenUrl,
    'unknown cookie id → 401 { error: "no_session" }, never leaks whether an id ever existed',
    sessionTokenBogus.ok && sessionTokenBogus.status === 401 && sessionTokenBogus.json?.error === 'no_session',
    sessionTokenBogus.ok ? `status=${sessionTokenBogus.status} body=${JSON.stringify(sessionTokenBogus.json)}` : `request failed: ${sessionTokenBogus.error}`,
  );

  const sessionDeleteResp = await request('DELETE', sessionUrl);
  check(
    AREA,
    'A17',
    'DELETE',
    sessionUrl,
    'no cookie → 200 { ok: true }, idempotent sign-out',
    sessionDeleteResp.ok && sessionDeleteResp.status === 200 && sessionDeleteResp.json?.ok === true,
    sessionDeleteResp.ok ? `status=${sessionDeleteResp.status} body=${JSON.stringify(sessionDeleteResp.json)}` : `request failed: ${sessionDeleteResp.error}`,
  );

  // --- CORS: the session routes are CREDENTIALED (Access-Control-Allow-
  // Credentials: true) and admit all FOUR estate origins — proven here with
  // library.heygabi.ai, the one origin neither adminCors() nor meCors()
  // admits, so this also proves the session routes use their OWN list
  // (SESSION_ORIGINS) rather than accidentally inheriting one of those.
  const sessionPre = await options(sessionUrl, {
    headers: { Origin: LIBRARY_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization' },
  });
  if (!sessionPre.ok) {
    check(AREA, 'A18', 'OPTIONS', sessionUrl, `access-control-allow-origin === ${LIBRARY_ORIGIN}, allow-credentials === true`, false, `request failed: ${sessionPre.error}`);
  } else {
    const acao = header(sessionPre, 'access-control-allow-origin');
    const acac = header(sessionPre, 'access-control-allow-credentials');
    check(
      AREA,
      'A18',
      'OPTIONS',
      sessionUrl,
      `access-control-allow-origin === ${LIBRARY_ORIGIN} AND allow-credentials === true (credentialed, all four estate origins)`,
      acao === LIBRARY_ORIGIN && acac === 'true',
      `ACAO=${acao} ACAC=${acac}`,
    );
  }

  const sessionEvil = await options(sessionUrl, {
    headers: { Origin: FOREIGN_ORIGIN, 'Access-Control-Request-Method': 'POST' },
  });
  if (!sessionEvil.ok) {
    check(AREA, 'A19', 'OPTIONS', sessionUrl, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, false, `request failed: ${sessionEvil.error}`);
  } else {
    const acao = header(sessionEvil, 'access-control-allow-origin');
    check(AREA, 'A19', 'OPTIONS', sessionUrl, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, acao === null, `ACAO=${acao}`);
  }
}
