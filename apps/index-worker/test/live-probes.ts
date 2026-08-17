/**
 * The live probe suite — the index Worker as the estate's FIRST auth
 * consumer, exercised against REAL `wrangler dev` + LOCAL D1 (never remote).
 * Two phases:
 *
 *   A  real-auth mode, index alone — the §8.2 conformance probes (the first
 *      run of the module's probe fixture against a real consumer): tokenless
 *      401s on both read routes, garbage token 401, health open, the push
 *      machine route refusing tokenless. Credential-bound probes (#1, #4–#8)
 *      report `skipped` VISIBLY, per the module's own design.
 *
 *   B  dev-bypass identities against a REAL spawned auth Worker (its own
 *      local D1) — §9 step 3's exercise, plus the failure lanes: fresh
 *      sign-in lands pending (and appears in the directory as `seen:index` —
 *      the per-app bearer wiring proof), approval opens the door, revocation
 *      closes it within the TTL (cache aged by SQL, not by waiting 10 min),
 *      a standing member rides the stale cache through an auth outage, an
 *      unknown person is refused `estate_unreachable`, and OWNER_EMAILS
 *      break-glass works with the directory down.
 *
 * Run: `npm run probe` (index on 8788, auth Worker on 8799; kills by PID
 * tree, then sweeps both ports — wrangler leaks, the standing warning).
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runConformanceProbes, probesPassed } from '@platform/estate-auth';

const INDEX_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_DIR = join(INDEX_DIR, '..', 'auth-worker');
const INDEX_PERSIST = join(INDEX_DIR, '.wrangler', 'probe-state');
const AUTH_PERSIST = join(AUTH_DIR, '.wrangler', 'index-probe-state');

const INDEX_PORT = 8788;
const AUTH_PORT = 8799;
const INDEX_BASE = `http://127.0.0.1:${INDEX_PORT}`;
const AUTH_BASE = `http://127.0.0.1:${AUTH_PORT}`;

const OWNER = 'owner@example.com';
const APP_TOKEN = 'probe-token-index';
const PUSH_TOKEN = 'probe-push-game';

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

function startDev(cwd: string, port: number, vars: Record<string, string>, persist: string): ChildProcess {
  const args = [
    'wrangler',
    'dev',
    '--port',
    String(port),
    '--persist-to',
    persist,
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
  ];
  const child = spawn('npx', args, {
    cwd,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  return child;
}

function stopDev(child: ChildProcess | null): void {
  if (!child) return;
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

async function waitReady(base: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health`);
      await r.text();
      if (r.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`dev server at ${base} did not become ready in 90s`);
}

async function waitDown(base: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/api/health`);
      await new Promise((res) => setTimeout(res, 400));
    } catch {
      return;
    }
  }
}

async function api(
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const resp = await fetch(`${base}${path}`, {
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
  return { status: resp.status, body };
}

/**
 * Age every estate_cache row past the 10-minute TTL by editing the LOCAL D1
 * directly — the probe's substitute for waiting out the revocation delay.
 * Runs `wrangler d1 execute --file` (never --command: Windows shell
 * concatenation shreds SQL, the standing lesson) against the same persist
 * dir the dev server holds open; SQLite WAL makes the cross-process write
 * safe and the server sees it on its next query.
 */
function ageCache(): void {
  const sqlFile = join(INDEX_PERSIST, 'age-cache.sql');
  writeFileSync(sqlFile, "UPDATE estate_cache SET checked_at = '2020-01-01T00:00:00.000Z';\n");
  execSync(
    `npx wrangler d1 execute index_catalog --local --persist-to "${INDEX_PERSIST}" --file "${sqlFile}"`,
    { cwd: INDEX_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

const indexBaseVars = {
  FIREBASE_PROJECT_ID: 'audiobook-catalog',
  OWNER_EMAILS: OWNER,
  ESTATE_AUTH_URL: AUTH_BASE,
  ESTATE_APP_TOKEN_INDEX: APP_TOKEN,
  INDEX_PUSH_TOKEN_GAME: PUSH_TOKEN,
};

async function phaseA(): Promise<void> {
  console.log('\n— Phase A: real-auth mode — the §8.2 conformance probes, first real consumer —');
  const child = startDev(INDEX_DIR, INDEX_PORT, { ...indexBaseVars, ENVIRONMENT: 'production' }, INDEX_PERSIST);
  try {
    await waitReady(INDEX_BASE);

    const results = await runConformanceProbes({
      baseUrl: INDEX_BASE,
      protectedRoutes: [
        { path: '/api/lookup?title=dune' },
        { path: '/api/universe/dungeon-crawler-carl' },
      ],
      openRoutes: [{ path: '/api/health' }],
      machineRoutes: [{ method: 'PUT', path: '/api/push/game' }],
    });
    for (const p of results) console.log(`  [${p.outcome.padEnd(7)}] ${p.id} ${p.title}: ${p.detail}`);
    check('A1 conformance probes: no failures', probesPassed(results));
    check(
      'A2 the executable probes actually ran (#2 and #3 pass, not skipped)',
      results.find((p) => p.id === '8.2#2')?.outcome === 'pass' &&
        results.find((p) => p.id === '8.2#3')?.outcome === 'pass',
    );

    // Estate down + no cache + real-auth mode: the middleware never even
    // gets an identity to check, so tokenless is 401 — but a garbage token
    // must ALSO be 401 (verifier), never 503 (estate) — refusal order pinned.
    const r = await api(INDEX_BASE, 'GET', '/api/lookup?title=dune', { token: 'garbage' });
    check('A3 bad token refused as 401 BEFORE the estate is consulted', r.status === 401, `got ${r.status}`);
  } finally {
    stopDev(child);
    await waitDown(INDEX_BASE);
  }
}

async function phaseB(): Promise<void> {
  console.log('\n— Phase B: the estate protocol end-to-end against a real local auth Worker —');

  // The auth Worker: fresh local D1, dev-bypass owner for its admin API.
  execSync(`npx wrangler d1 migrations apply estate_auth --local --persist-to "${AUTH_PERSIST}"`, {
    cwd: AUTH_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let auth: ChildProcess | null = startDev(
    AUTH_DIR,
    AUTH_PORT,
    {
      ENVIRONMENT: 'development',
      DEV_EMAIL: OWNER,
      FIREBASE_PROJECT_ID: 'audiobook-catalog',
      OWNER_EMAILS: OWNER,
      ADMIN_ORIGINS: 'https://heygabi.ai',
      ESTATE_APP_TOKEN_INDEX: APP_TOKEN,
    },
    AUTH_PERSIST,
  );

  let index: ChildProcess | null = null;
  try {
    await waitReady(AUTH_BASE);

    // The index, signed in (dev bypass) as a complete stranger.
    index = startDev(
      INDEX_DIR,
      INDEX_PORT,
      { ...indexBaseVars, ENVIRONMENT: 'development', DEV_EMAIL: 'member@example.com' },
      INDEX_PERSIST,
    );
    await waitReady(INDEX_BASE);

    // Give lookup something to find — and prove the push lane is untouched.
    let r = await api(INDEX_BASE, 'PUT', '/api/push/game', {
      token: PUSH_TOKEN,
      body: [{ source_id: '104', title: 'Taverns & Dragons', format: 'boardgame', kind: 'base' }],
    });
    check('B1 push with its own per-source bearer still works, estate uninvolved', r.status === 200 && r.body.rows === 1, JSON.stringify(r.body));

    // Fresh sign-in: refused as pending, and queued estate-side by /seen.
    r = await api(INDEX_BASE, 'GET', '/api/lookup?title=taverns and dragons');
    check('B2 a fresh sign-in gets the pending answer, not data', r.status === 403 && r.body.error === 'estate_pending', JSON.stringify(r.body));

    let dir = await api(AUTH_BASE, 'GET', '/api/estate/users');
    const member = dir.body.users?.find((u: any) => u.email === 'member@example.com');
    check(
      "B3 /seen queued them in the directory with origin 'seen:index' — the per-app bearer wiring proof",
      member?.status === 'pending' && member?.origin === 'seen:index',
      JSON.stringify(member ?? dir.body),
    );

    // Approval opens the door — after the cache ages (the TTL is real).
    await api(AUTH_BASE, 'POST', `/api/estate/users/${member.id}/status`, { body: { status: 'approved' } });
    r = await api(INDEX_BASE, 'GET', '/api/lookup?title=taverns and dragons');
    check('B4 inside the TTL the cache still answers pending (the revocation delay, in both directions)', r.status === 403, `got ${r.status}`);
    ageCache();
    r = await api(INDEX_BASE, 'GET', '/api/lookup?title=taverns and dragons');
    check(
      'B5 approved + aged cache → results (and the pushed game matches)',
      r.status === 200 && r.body.matches?.length === 1 && r.body.matches[0].title === 'Taverns & Dragons',
      JSON.stringify(r.body),
    );

    // Revocation closes it within the TTL.
    await api(AUTH_BASE, 'POST', `/api/estate/users/${member.id}/status`, { body: { status: 'revoked' } });
    ageCache();
    r = await api(INDEX_BASE, 'GET', '/api/lookup?title=taverns and dragons');
    check('B6 revoked + aged cache → 403 estate_revoked', r.status === 403 && r.body.error === 'estate_revoked', JSON.stringify(r.body));

    // Re-approve, then take the estate DOWN: a standing member rides the
    // stale cache (§6 row 1 — open for the admitted).
    await api(AUTH_BASE, 'POST', `/api/estate/users/${member.id}/status`, { body: { status: 'approved' } });
    ageCache();
    r = await api(INDEX_BASE, 'GET', '/api/lookup?title=taverns and dragons');
    check('B7 re-approval restores access (the local cache holds approved again)', r.status === 200, `got ${r.status}`);

    stopDev(auth);
    auth = null;
    await waitDown(AUTH_BASE);

    ageCache();
    r = await api(INDEX_BASE, 'GET', '/api/lookup?title=taverns and dragons');
    check('B8 auth Worker DOWN: standing member still served on the stale cache', r.status === 200, `got ${r.status}`);

    // An unknown person during the outage: fail closed, NAMED.
    stopDev(index);
    index = null;
    await waitDown(INDEX_BASE);
    index = startDev(
      INDEX_DIR,
      INDEX_PORT,
      { ...indexBaseVars, ENVIRONMENT: 'development', DEV_EMAIL: 'ghost@example.com' },
      INDEX_PERSIST,
    );
    await waitReady(INDEX_BASE);
    r = await api(INDEX_BASE, 'GET', '/api/lookup?title=taverns and dragons');
    check(
      'B9 unknown person + estate down → 503 estate_unreachable (an outage is not a denial)',
      r.status === 503 && r.body.error === 'estate_unreachable',
      JSON.stringify(r.body),
    );

    // OWNER_EMAILS break-glass: served with the directory down and no cache.
    stopDev(index);
    index = null;
    await waitDown(INDEX_BASE);
    index = startDev(
      INDEX_DIR,
      INDEX_PORT,
      { ...indexBaseVars, ENVIRONMENT: 'development', DEV_EMAIL: OWNER },
      INDEX_PERSIST,
    );
    await waitReady(INDEX_BASE);
    r = await api(INDEX_BASE, 'GET', '/api/lookup?title=taverns and dragons');
    check('B10 OWNER_EMAILS break-glass works with the auth Worker stopped (§6 row 4)', r.status === 200, `got ${r.status}`);

    // --- The series registry (migration 0004), in the REAL runtime. ---------
    // Run as the owner because /api/series is SCOPED and the owner's set is
    // computed (§4.3) — this is about the registry, not about visibility,
    // which scope.test.ts pins separately. The value of doing it here is that
    // `wrangler dev` is a real Workers runtime over a real D1: the batch, the
    // OR IGNORE inserts and `crypto.subtle.timingSafeEqual` are all genuine.
    r = await api(INDEX_BASE, 'PUT', '/api/push/game', {
      token: PUSH_TOKEN,
      body: [
        { source_id: '104', title: 'Taverns & Dragons', format: 'boardgame', kind: 'base', series: 'The Tavern Chronicles' },
        { source_id: '105', title: 'Taverns & Dragons: Deeper', format: 'boardgame', kind: 'expansion', series: 'Tavern Chronicles' },
      ],
    });
    check(
      'B11 two spellings of one series fold to ONE registry entry at push time',
      r.status === 200 && r.body.series?.registered === 1 && r.body.series?.merged_spellings === 1,
      JSON.stringify(r.body),
    );

    r = await api(INDEX_BASE, 'GET', '/api/series');
    check(
      'B12 GET /api/series lists it once, with per-source counts',
      r.status === 200 &&
        r.body.series?.length === 1 &&
        r.body.series[0].slug === 'tavern-chronicles' &&
        r.body.series[0].sources?.game === 2,
      JSON.stringify(r.body),
    );

    r = await api(INDEX_BASE, 'GET', '/api/series/tavern-chronicles');
    check(
      'B13 GET /api/series/:slug groups by medium and carries the page fields',
      r.status === 200 &&
        r.body.media?.[0]?.medium === 'boardgame' &&
        r.body.media[0].entries.length === 2 &&
        'detail_url' in r.body.media[0].entries[0],
      JSON.stringify(r.body),
    );

    // A decorated spelling: folds DIFFERENTLY, so it must NOT merge.
    r = await api(INDEX_BASE, 'PUT', '/api/push/game', {
      token: PUSH_TOKEN,
      body: [
        { source_id: '104', title: 'Taverns & Dragons', format: 'boardgame', kind: 'base', series: 'The Tavern Chronicles' },
        { source_id: '106', title: 'Taverns & Dragons: Origins', format: 'boardgame', kind: 'base', series: 'The Tavern Chronicles Series' },
      ],
    });
    check(
      'B14 a near miss registers separately and QUEUES — it is never merged',
      r.status === 200 && r.body.series?.pending_added === 1,
      JSON.stringify(r.body),
    );

    r = await api(INDEX_BASE, 'GET', '/api/series/pending');
    check(
      'B15 the approver reads the queue, with the evidence needed to decide it',
      r.status === 200 &&
        r.body.open === 1 &&
        r.body.pending[0].closest_slug === 'tavern-chronicles' &&
        Array.isArray(r.body.pending[0].sample_titles),
      JSON.stringify(r.body),
    );
  } finally {
    stopDev(index);
    stopDev(auth);
    await waitDown(INDEX_BASE);
    await waitDown(AUTH_BASE);
  }
}

async function main(): Promise<void> {
  // Fresh local state every run: the probes' assertions count on it.
  rmSync(INDEX_PERSIST, { recursive: true, force: true });
  mkdirSync(INDEX_PERSIST, { recursive: true });
  rmSync(AUTH_PERSIST, { recursive: true, force: true });
  console.log('applying every index migration to fresh local D1…');
  execSync(`npx wrangler d1 migrations apply index_catalog --local --persist-to "${INDEX_PERSIST}"`, {
    cwd: INDEX_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await phaseA();
  await phaseB();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Belt and braces: wrangler leaks dev servers (the standing warning).
    // The taskkill trees above should have got them; sweep both ports.
    if (process.platform === 'win32') {
      for (const port of [INDEX_PORT, AUTH_PORT]) {
        try {
          const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
          const pids = [...new Set(out.split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop()).filter(Boolean))];
          for (const pid of pids) execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore' });
        } catch {
          // findstr exits 1 when nothing listens — the good case.
        }
      }
    }
  });
