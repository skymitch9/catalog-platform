/**
 * The live probe suite — design §14.1's test list, exercised against a REAL
 * `wrangler dev` + LOCAL D1 (never remote). Four phases, each its own dev
 * server spawn:
 *
 *   A  owner via dev bypass, EMPTY table  — the §4.3 property (OWNER_EMAILS
 *      works with no rows, no first-sign-in claim), the full admin
 *      lifecycle, /seen semantics (never changes status; revocation
 *      survives re-sign-in), decided_at/decided_by stamping
 *   B  real-auth mode (no bypass)         — the §8.2 conformance probes
 *      (tokenless 401s, garbage token, open health, machine route), /seen
 *      per-app bearers, CORS locked to the apex
 *   C  approved-but-not-approver via bypass — admin API 403
 *   D  complete stranger via bypass         — admin API 403, and the request
 *      creates no row
 *
 * Run: `npm run probe` (spawns on port 8799; kills its children by PID tree,
 * then sweeps port 8799 — wrangler leaks, CLAUDE.md's standing warning).
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runConformanceProbes, probesPassed } from '@platform/estate-auth';

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PERSIST = join(WORKER_DIR, '.wrangler', 'probe-state');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

const OWNER = 'owner@example.com';
const TOKENS = {
  library: 'probe-token-library',
  games: 'probe-token-games',
  index: 'probe-token-index',
};

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function sh(cmd: string): string {
  return execSync(cmd, { cwd: WORKER_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function startDev(vars: Record<string, string>): ChildProcess {
  const args = [
    'wrangler',
    'dev',
    '--port',
    String(PORT),
    '--persist-to',
    PERSIST,
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
  ];
  const child = spawn('npx', args, {
    cwd: WORKER_DIR,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  return child;
}

function stopDev(child: ChildProcess): void {
  try {
    if (process.platform === 'win32' && child.pid) {
      execSync(`taskkill /pid ${child.pid} /t /f`, { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    // Already gone is fine.
  }
}

async function waitReady(): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.status === 200) return;
      await r.text();
    } catch {
      // not up yet
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error('wrangler dev did not become ready in 90s');
}

async function waitDown(): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/api/health`);
      await new Promise((res) => setTimeout(res, 400));
    } catch {
      return;
    }
  }
}

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; origin?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.origin) headers['Origin'] = opts.origin;
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await resp.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: resp.status, body, headers: resp.headers };
}

const baseVars = {
  FIREBASE_PROJECT_ID: 'audiobook-catalog',
  OWNER_EMAILS: OWNER,
  ADMIN_ORIGINS: 'https://heygabi.ai',
  ME_ORIGINS: 'https://heygabi.ai,https://audiobooks.heygabi.ai',
  ESTATE_APP_TOKEN_LIBRARY: TOKENS.library,
  ESTATE_APP_TOKEN_GAMES: TOKENS.games,
  ESTATE_APP_TOKEN_INDEX: TOKENS.index,
};

async function phaseA(): Promise<void> {
  console.log('\n— Phase A: owner via dev bypass, EMPTY table —');
  const child = startDev({ ...baseVars, ENVIRONMENT: 'development', DEV_EMAIL: OWNER });
  try {
    await waitReady();

    // §4.3: OWNER_EMAILS works on an EMPTY table — no first-claim rule exists.
    let r = await api('GET', '/api/estate/users');
    check('A1 empty-table admin list answers 200 for OWNER_EMAILS', r.status === 200, `got ${r.status}`);
    check(
      'A2 the only row (if any) is the materialized owner, approver, origin manual',
      r.body.users.every(
        (u: any) => u.email === OWNER && u.is_approver === true && u.origin === 'manual' && u.status === 'approved',
      ),
      JSON.stringify(r.body.users),
    );

    // /seen creates pending, lowercases, records origin by app token.
    r = await api('POST', '/api/estate/seen', {
      token: TOKENS.library,
      body: { email: 'Bob@Example.COM', firebase_uid: 'uid-bob', display_name: 'Bob' },
    });
    check('A3 /seen creates pending', r.status === 200 && r.body.status === 'pending', JSON.stringify(r.body));
    check(
      'A3v pending /seen carries the public slice only — visibility ["audiobook"] (§4.5)',
      JSON.stringify(r.body.visibility) === '["audiobook"]',
      JSON.stringify(r.body.visibility),
    );

    r = await api('GET', '/api/estate/users');
    const bob = r.body.users.find((u: any) => u.email === 'bob@example.com');
    check('A4 email lowercased on write; origin seen:library', bob?.origin === 'seen:library', JSON.stringify(bob));
    check('A5 newcomer is NOT auto-approved', bob?.status === 'pending' && bob?.decided_at === null);

    // /seen refresh never changes status; nulls do not erase recorded facts.
    r = await api('POST', '/api/estate/seen', { token: TOKENS.games, body: { email: 'bob@example.com' } });
    check('A6 second /seen (games token) still pending, never upgrades', r.body.status === 'pending');
    r = await api('GET', '/api/estate/users');
    const bob2 = r.body.users.find((u: any) => u.email === 'bob@example.com');
    check(
      'A7 refresh kept uid/name (COALESCE), origin still the first door',
      bob2?.firebase_uid === 'uid-bob' && bob2?.display_name === 'Bob' && bob2?.origin === 'seen:library',
      JSON.stringify(bob2),
    );

    // Approve: stamps decided_at/decided_by with the ACTOR's row id.
    const ownerRow = r.body.users.find((u: any) => u.email === OWNER);
    r = await api('POST', `/api/estate/users/${bob2.id}/status`, { body: { status: 'approved' } });
    check('A8 approve answers the updated row', r.status === 200 && r.body.user.status === 'approved');
    check(
      'A9 decided_at stamped, decided_by = the approving actor',
      r.body.user.decided_at !== null && r.body.user.decided_by === ownerRow.id,
      JSON.stringify(r.body.user),
    );

    r = await api('POST', '/api/estate/seen', { token: TOKENS.index, body: { email: 'bob@example.com' } });
    check('A10 /seen now answers approved', r.body.status === 'approved');
    check(
      'A10v approval without narrowing grants ALL THREE (the 0002 defaults)',
      JSON.stringify(r.body.visibility) === '["audiobook","library","games"]',
      JSON.stringify(r.body.visibility),
    );

    // Revoke; revocation survives re-sign-in (§4.2 — rows never deleted).
    r = await api('POST', `/api/estate/users/${bob2.id}/status`, { body: { status: 'revoked' } });
    check('A11 revoke lands', r.body.user.status === 'revoked');
    r = await api('POST', '/api/estate/seen', {
      token: TOKENS.library,
      body: { email: 'bob@example.com', display_name: 'Bob Again' },
    });
    check('A12 a revoked person re-signing-in meets their revocation, not a fresh pending', r.body.status === 'revoked');
    check(
      'A12v revoked ⇒ visibility {} — revocation beats the public slice (§4.5)',
      JSON.stringify(r.body.visibility) === '[]',
      JSON.stringify(r.body.visibility),
    );

    // Promotion guard + the promotion path (owner decision #4: API, no redeploy).
    r = await api('POST', `/api/estate/users/${bob2.id}/approver`, { body: { is_approver: true } });
    check('A13 promoting a non-approved person is refused 409', r.status === 409, `got ${r.status}`);
    await api('POST', `/api/estate/users/${bob2.id}/status`, { body: { status: 'approved' } });
    r = await api('POST', `/api/estate/users/${bob2.id}/approver`, { body: { is_approver: true } });
    check('A14 approve-then-promote flips is_approver via the API', r.status === 200 && r.body.user.is_approver === true);

    // --- Visibility (§4.5): the admin surface, and /seen carrying the set ---
    check(
      'A19 admin rows speak visibility as an array, never raw vis_ flags',
      Array.isArray(r.body.user.visibility) && !('vis_audiobook' in r.body.user),
      JSON.stringify(r.body.user),
    );
    r = await api('POST', `/api/estate/users/${bob2.id}/visibility`, {
      body: { visibility: ['games', 'audiobook', 'games'] },
    });
    check(
      'A20 set visibility: dedupes, canonical order, stamps the decision',
      r.status === 200 &&
        JSON.stringify(r.body.user.visibility) === '["audiobook","games"]' &&
        r.body.user.decided_at !== null,
      JSON.stringify(r.body.user),
    );
    r = await api('POST', '/api/estate/seen', { token: TOKENS.library, body: { email: 'bob@example.com' } });
    check(
      'A21 /seen answers the narrowed set for an approved member',
      r.body.status === 'approved' && JSON.stringify(r.body.visibility) === '["audiobook","games"]',
      JSON.stringify(r.body),
    );
    r = await api('POST', `/api/estate/users/${bob2.id}/visibility`, { body: { visibility: [] } });
    check('A22 narrowing to {} is legal — approved may see nothing on estate surfaces', r.status === 200 && JSON.stringify(r.body.user.visibility) === '[]');
    r = await api('POST', '/api/estate/seen', { token: TOKENS.library, body: { email: 'bob@example.com' } });
    check('A23 /seen honours the empty set for the approved', JSON.stringify(r.body.visibility) === '[]');
    r = await api('POST', `/api/estate/users/${bob2.id}/visibility`, {
      body: { visibility: ['audiobook', 'library', 'games'] },
    });
    check('A24 re-widening restores all three', JSON.stringify(r.body.user.visibility) === '["audiobook","library","games"]');
    r = await api('POST', `/api/estate/users/${bob2.id}/visibility`, { body: { visibility: ['bookface'] } });
    check('A25 an unknown catalog name is refused 400', r.status === 400, `got ${r.status}`);
    r = await api('POST', `/api/estate/users/${bob2.id}/status`, {
      body: { status: 'revoked', visibility: ['audiobook'] },
    });
    check('A26 visibility with a revocation is refused 400 — revoked sees {} regardless', r.status === 400, `got ${r.status}`);

    // A second approved (but never approver) user for phase C — approved WITH
    // approval-time narrowing, the §4.5 one-call path.
    await api('POST', '/api/estate/seen', { token: TOKENS.library, body: { email: 'carol@example.com' } });
    r = await api('GET', '/api/estate/users');
    const carol = r.body.users.find((u: any) => u.email === 'carol@example.com');
    r = await api('POST', `/api/estate/users/${carol.id}/status`, {
      body: { status: 'approved', visibility: ['audiobook', 'library'] },
    });
    check(
      'A27 approval-time narrowing lands in one call',
      r.status === 200 && r.body.user.status === 'approved' && JSON.stringify(r.body.user.visibility) === '["audiobook","library"]',
      JSON.stringify(r.body.user),
    );

    // Bad inputs.
    r = await api('POST', `/api/estate/users/${bob2.id}/status`, { body: { status: 'pending' } });
    check('A15 status can only be approved|revoked — pending refused', r.status === 400);
    r = await api('POST', '/api/estate/users/999999/status', { body: { status: 'approved' } });
    check('A16 unknown id → 404', r.status === 404);
    r = await api('POST', '/api/estate/seen', { token: TOKENS.library, body: { email: 'x@y.z', extra: 1 } });
    check('A17 /seen body is strict — unknown keys refused', r.status === 400);

    // The owner's own /seen: computed approved (§4.3), row state untouched.
    r = await api('POST', '/api/estate/seen', { token: TOKENS.library, body: { email: OWNER } });
    check('A18 OWNER_EMAILS /seen answers approved regardless of table state', r.body.status === 'approved');
    check(
      'A18v OWNER_EMAILS sees all three, computed — break-glass cannot be narrowed into lockout',
      JSON.stringify(r.body.visibility) === '["audiobook","library","games"]',
      JSON.stringify(r.body.visibility),
    );

    // GET /estate/me: the owner's own answer, break-glass included.
    r = await api('GET', '/api/estate/me');
    check(
      'A28 /me for OWNER_EMAILS: approved + approver + all three, computed',
      r.status === 200 &&
        r.body.status === 'approved' &&
        r.body.is_approver === true &&
        JSON.stringify(r.body.visibility) === '["audiobook","library","games"]',
      JSON.stringify(r.body),
    );

    // --- Manual pre-seed by email (owner UI-first rule, 2026-08-14) ---
    r = await api('POST', '/api/estate/users', { body: { email: 'Newby@Example.COM' } });
    check(
      'A29 manual create: 201, pending, origin manual, email lowercased',
      r.status === 201 &&
        r.body.created === true &&
        r.body.user.email === 'newby@example.com' &&
        r.body.user.status === 'pending' &&
        r.body.user.origin === 'manual',
      JSON.stringify(r.body),
    );
    r = await api('POST', '/api/estate/users', { body: { email: 'newby@example.com' } });
    check(
      'A30 manual create is idempotent — existing row untouched, created:false',
      r.status === 200 && r.body.created === false && r.body.user.status === 'pending',
      JSON.stringify(r.body),
    );
    // Pre-seeding must never resurrect a revocation: bob is currently
    // approved (A14) — the create answers his row unchanged either way.
    r = await api('POST', '/api/estate/users', { body: { email: 'bob@example.com' } });
    check(
      'A31 manual create of an existing member changes nothing',
      r.status === 200 && r.body.created === false && r.body.user.status === 'approved',
      JSON.stringify(r.body),
    );
    r = await api('POST', '/api/estate/users', { body: { email: 'not-an-email' } });
    check('A32 malformed email refused 400', r.status === 400, `got ${r.status}`);
    r = await api('POST', '/api/estate/users', { body: { email: 'a@b.c', extra: 1 } });
    check('A33 create body is strict — unknown keys refused', r.status === 400, `got ${r.status}`);

    // --- Site-roles federation: without the FIREBASE_SERVICE_ACCOUNT secret
    // the endpoints say so (503 config error), and only AFTER the approver
    // gate has admitted the caller — never a silent failure, never a leak.
    r = await api('GET', '/api/estate/site-roles');
    check(
      'A34 site-roles GET without the secret → 503 service_account_unset',
      r.status === 503 && r.body.error === 'service_account_unset',
      JSON.stringify(r.body),
    );
    r = await api('POST', '/api/estate/site-roles', { body: { email: 'a@b.c', role: 'moderator' } });
    check(
      'A35 site-roles POST without the secret → 503 service_account_unset',
      r.status === 503 && r.body.error === 'service_account_unset',
      JSON.stringify(r.body),
    );

    // --- Operations: "run the audiobook pipeline now" — same 503-config-error
    // idiom as site-roles, and checked in the SAME order the route checks it
    // (PIPELINE_TRIGGER_TOKEN before the service account). Neither secret is
    // set in baseVars, so this NEVER reaches a real Firestore write — the
    // probe suite must not trigger a real pipeline run.
    r = await api('POST', '/api/estate/ops/pipeline', { body: {} });
    check(
      'A36 ops/pipeline without PIPELINE_TRIGGER_TOKEN → 503 pipeline_trigger_token_unset',
      r.status === 503 && r.body.error === 'pipeline_trigger_token_unset',
      JSON.stringify(r.body),
    );

    // --- The todo board (auth-locked 2026-08-15): an approver gets the
    // content, wrapped in { html }, and the fragment carries the CSS-only
    // filter markup the shim depends on.
    r = await api('GET', '/api/estate/todo');
    check(
      'A37 todo: an approver (owner via bypass) gets 200 with the board fragment',
      r.status === 200 && typeof r.body.html === 'string' && r.body.html.startsWith('<main>'),
      JSON.stringify(r.body).slice(0, 200),
    );
    check(
      "A37v todo: the fragment carries the six filter radios the shim's CSS depends on",
      ['f-all', 'f-audio', 'f-books', 'f-games', 'f-home', 'f-cross'].every((id) =>
        r.body.html.includes(`id="${id}"`),
      ),
    );
  } finally {
    stopDev(child);
    await waitDown();
  }
}

async function phaseB(): Promise<void> {
  console.log('\n— Phase B: real-auth mode — the §8.2 conformance probes —');
  const child = startDev({ ...baseVars, ENVIRONMENT: 'production' });
  try {
    await waitReady();

    const results = await runConformanceProbes({
      baseUrl: BASE,
      protectedRoutes: [
        { path: '/api/estate/users' },
        { path: '/api/estate/me' },
        { method: 'POST', path: '/api/estate/users/1/status' },
        { method: 'POST', path: '/api/estate/users/1/approver' },
        { method: 'POST', path: '/api/estate/users' },
        { path: '/api/estate/site-roles' },
        { method: 'POST', path: '/api/estate/site-roles' },
        { method: 'POST', path: '/api/estate/ops/pipeline' },
        { path: '/api/estate/todo' },
      ],
      openRoutes: [{ path: '/api/health' }],
      machineRoutes: [{ method: 'POST', path: '/api/estate/seen' }],
    });
    for (const p of results) console.log(`  [${p.outcome.padEnd(7)}] ${p.id} ${p.title}: ${p.detail}`);
    check('B1 conformance probes: no failures', probesPassed(results));
    check(
      'B2 the executable probes actually ran (2 and 3 not skipped)',
      results.find((p) => p.id === '8.2#2')?.outcome === 'pass' &&
        results.find((p) => p.id === '8.2#3')?.outcome === 'pass',
    );

    // /seen per-app bearers still work with the bypass off.
    let r = await api('POST', '/api/estate/seen', { token: TOKENS.index, body: { email: 'dave@example.com' } });
    check('B3 /seen with the index token, real-auth mode', r.status === 200 && r.body.status === 'pending');
    r = await api('GET', '/api/estate/users');
    check('B4 admin API tokenless → 401 in real-auth mode', r.status === 401);
    r = await api('POST', '/api/estate/seen', { token: 'wrong-token', body: { email: 'e@f.g' } });
    check('B5 /seen with an unknown bearer → 401', r.status === 401);

    // CORS: locked to the apex (owner decision #6).
    const pre = await fetch(`${BASE}/api/estate/users`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://heygabi.ai',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    await pre.text();
    check(
      'B6 preflight from the apex is allowed',
      pre.headers.get('access-control-allow-origin') === 'https://heygabi.ai',
      `ACAO=${pre.headers.get('access-control-allow-origin')}`,
    );
    const evil = await fetch(`${BASE}/api/estate/users`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
    });
    await evil.text();
    check('B7 preflight from anywhere else gets no ACAO', evil.headers.get('access-control-allow-origin') === null);

    // /me CORS: the ONE deliberately wider surface (ME_ORIGINS). The preflight
    // carries no token, so this also proves CORS answers before auth.
    const mePre = await fetch(`${BASE}/api/estate/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://audiobooks.heygabi.ai',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    await mePre.text();
    check(
      'B9 tokenless /me preflight from the audiobook site is allowed',
      mePre.headers.get('access-control-allow-origin') === 'https://audiobooks.heygabi.ai' &&
        (mePre.headers.get('access-control-allow-headers') ?? '').toLowerCase().includes('authorization'),
      `ACAO=${mePre.headers.get('access-control-allow-origin')} ACAH=${mePre.headers.get('access-control-allow-headers')}`,
    );
    const meEvil = await fetch(`${BASE}/api/estate/me`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
    });
    await meEvil.text();
    check('B10 /me preflight from anywhere else gets no ACAO', meEvil.headers.get('access-control-allow-origin') === null);
    // The widening is CONFINED to /me — the admin API refuses the site's origin.
    const adminFromSite = await fetch(`${BASE}/api/estate/users`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://audiobooks.heygabi.ai', 'Access-Control-Request-Method': 'GET' },
    });
    await adminFromSite.text();
    check(
      'B11 the audiobook origin is NOT admitted to the admin API',
      adminFromSite.headers.get('access-control-allow-origin') === null,
      `ACAO=${adminFromSite.headers.get('access-control-allow-origin')}`,
    );

    // Operations CORS: apex-only, same mount as the admin API (not ME_ORIGINS).
    const opsPre = await fetch(`${BASE}/api/estate/ops/pipeline`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://heygabi.ai',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    await opsPre.text();
    check(
      'B12 ops/pipeline preflight from the apex is allowed',
      opsPre.headers.get('access-control-allow-origin') === 'https://heygabi.ai',
      `ACAO=${opsPre.headers.get('access-control-allow-origin')}`,
    );
    const opsFromSite = await fetch(`${BASE}/api/estate/ops/pipeline`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://audiobooks.heygabi.ai', 'Access-Control-Request-Method': 'POST' },
    });
    await opsFromSite.text();
    check(
      'B13 the audiobook origin is NOT admitted to ops/pipeline either',
      opsFromSite.headers.get('access-control-allow-origin') === null,
      `ACAO=${opsFromSite.headers.get('access-control-allow-origin')}`,
    );

    // Todo board CORS: apex-only, same mount as the admin API — the shim
    // that calls this lives on heygabi.ai and nowhere else.
    const todoPre = await fetch(`${BASE}/api/estate/todo`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://heygabi.ai',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    await todoPre.text();
    check(
      'B14 todo preflight from the apex is allowed',
      todoPre.headers.get('access-control-allow-origin') === 'https://heygabi.ai',
      `ACAO=${todoPre.headers.get('access-control-allow-origin')}`,
    );
    const todoFromSite = await fetch(`${BASE}/api/estate/todo`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://audiobooks.heygabi.ai', 'Access-Control-Request-Method': 'GET' },
    });
    await todoFromSite.text();
    check(
      'B15 the audiobook origin is NOT admitted to the todo board either',
      todoFromSite.headers.get('access-control-allow-origin') === null,
      `ACAO=${todoFromSite.headers.get('access-control-allow-origin')}`,
    );
    r = await api('GET', '/api/estate/todo');
    check('B16 todo tokenless → 401 in real-auth mode', r.status === 401, `got ${r.status}`);

    r = await api('GET', '/api/health');
    check(
      'B8 health: counts only, no emails',
      r.status === 200 && r.body.ok === true && !JSON.stringify(r.body).includes('@'),
      JSON.stringify(r.body),
    );
  } finally {
    stopDev(child);
    await waitDown();
  }
}

async function phaseC(): Promise<void> {
  console.log('\n— Phase C: approved but NOT approver —');
  const child = startDev({ ...baseVars, ENVIRONMENT: 'development', DEV_EMAIL: 'carol@example.com' });
  try {
    await waitReady();
    let r = await api('GET', '/api/estate/users');
    check('C1 an approved non-approver is refused the admin API', r.status === 403, `got ${r.status}`);
    // /me answers the same person honestly: approved, not an approver, and
    // exactly the narrowed set A27 stored.
    r = await api('GET', '/api/estate/me');
    check(
      'C2 /me for an approved non-approver: status, flag and narrowed set',
      r.status === 200 &&
        r.body.status === 'approved' &&
        r.body.is_approver === false &&
        JSON.stringify(r.body.visibility) === '["audiobook","library"]',
      JSON.stringify(r.body),
    );
    // The new admin surfaces refuse a non-approver BEFORE anything else —
    // the approver gate outranks even the missing-secret 503.
    r = await api('POST', '/api/estate/users', { body: { email: 'x@y.z' } });
    check('C3 manual create refused for a non-approver', r.status === 403, `got ${r.status}`);
    r = await api('GET', '/api/estate/site-roles');
    check('C4 site-roles GET refused for a non-approver (403 beats 503)', r.status === 403, `got ${r.status}`);
    r = await api('POST', '/api/estate/ops/pipeline', { body: {} });
    check('C5 ops/pipeline refused for a non-approver (403 beats 503)', r.status === 403, `got ${r.status}`);
    r = await api('GET', '/api/estate/todo');
    check('C6 the todo board is refused for a non-approver — approved is not enough', r.status === 403, `got ${r.status}`);
  } finally {
    stopDev(child);
    await waitDown();
  }
}

async function phaseD(): Promise<void> {
  console.log('\n— Phase D: complete stranger —');
  const child = startDev({ ...baseVars, ENVIRONMENT: 'development', DEV_EMAIL: 'mallory@example.com' });
  try {
    await waitReady();
    let r = await api('GET', '/api/estate/users');
    check('D1 a stranger is refused the admin API — no first-to-knock', r.status === 403, `got ${r.status}`);
    r = await api('POST', '/api/estate/site-roles', { body: { email: 'x@y.z', role: 'admin' } });
    check('D4 a stranger cannot grant site roles', r.status === 403, `got ${r.status}`);
    r = await api('POST', '/api/estate/ops/pipeline', { body: {} });
    check('D5 a stranger cannot trigger the pipeline', r.status === 403, `got ${r.status}`);
    r = await api('GET', '/api/estate/todo');
    check('D6 a stranger cannot read the todo board', r.status === 403, `got ${r.status}`);
    // /me for someone the directory has never seen: a calm null, NEVER a 500 —
    // and (checked by D2 below) the ask itself enrols nobody.
    r = await api('GET', '/api/estate/me');
    check(
      'D3 /me for a stranger answers status null with the public slice',
      r.status === 200 &&
        r.body.status === null &&
        r.body.is_approver === false &&
        JSON.stringify(r.body.visibility) === '["audiobook"]',
      JSON.stringify(r.body),
    );
    // And being refused did not enrol them.
    const health = await api('GET', '/api/health');
    const total = health.body.users.pending + health.body.users.approved + health.body.users.revoked;
    // owner, bob, carol, dave, newby (A29's manual create) — A17's strict
    // refusal and B5's bad bearer created nothing, and neither did mallory's
    // refused admin calls (D1/D4).
    check('D2 the refused request created no row', total === 5, `total=${total} (want owner, bob, carol, dave, newby)`);
  } finally {
    stopDev(child);
    await waitDown();
  }
}

async function main(): Promise<void> {
  // Fresh local state every run: the probes' assertions count rows.
  rmSync(PERSIST, { recursive: true, force: true });
  mkdirSync(PERSIST, { recursive: true });
  console.log('applying migrations to fresh local D1…');
  sh(`npx wrangler d1 migrations apply estate_auth --local --persist-to "${PERSIST}"`);

  await phaseA();
  await phaseB();
  await phaseC();
  await phaseD();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Belt and braces: wrangler leaks dev servers (CLAUDE.md, measured 212
    // orphans once). The taskkill tree above should have got them; sweep
    // anything still holding our port.
    if (process.platform === 'win32') {
      try {
        const out = execSync(`netstat -ano | findstr :${PORT} | findstr LISTENING`, { encoding: 'utf8' });
        const pids = [...new Set(out.split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop()).filter(Boolean))];
        for (const pid of pids) execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore' });
      } catch {
        // findstr exits 1 when nothing listens — the good case.
      }
    }
  });
