/**
 * estate-members.test.ts — `GET /api/estate/members`, exercised against the
 * REAL exported `estateMembersRoutes` with an in-memory D1.
 *
 * ⚠️ THE FAKE D1 IS BUILT TO BE ABLE TO FAIL. A fake that hands back
 * pre-filtered, pre-projected rows passes whatever the SQL says. This one:
 *   - holds FULL-WIDTH rows (flags, origin, timestamps, photo) for every status;
 *   - applies the approved-only filter ONLY if the SQL actually says so;
 *   - returns ONLY the columns the SELECT names (and every column for `*`).
 * So dropping the WHERE leaks pending/revoked rows, and widening the SELECT
 * leaks fields — both caught below.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estateMembersRoutes, sortRoster } from '../src/estate-members.js';
import worker from '../src/index.js';

// ---------------------------------------------------------------------------
// ⚠️ THE SAME WORKERS-RUNTIME SHIM billing-routes.test.ts carries:
// `crypto.subtle.timingSafeEqual` is a Cloudflare extension that Node lacks, so
// `tokenMatches()` would throw and Hono would answer a bare 500. This restores
// the FUNCTION, not the guarantee (not constant-time; a test has no attacker).
// ---------------------------------------------------------------------------
const webcrypto = (globalThis as unknown as { crypto: Crypto }).crypto;
if (typeof (webcrypto.subtle as { timingSafeEqual?: unknown }).timingSafeEqual !== 'function') {
  (webcrypto.subtle as unknown as Record<string, unknown>).timingSafeEqual = (
    a: ArrayBufferView,
    b: ArrayBufferView,
  ): boolean => {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (x.byteLength !== y.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < x.byteLength; i += 1) diff |= (x[i] as number) ^ (y[i] as number);
    return diff === 0;
  };
}

type FullRow = Record<string, unknown> & { id: number; email: string; status: string };

function full(id: number, email: string, display_name: string | null, status: string): FullRow {
  return {
    id,
    email,
    firebase_uid: `uid-${id}`,
    display_name,
    status,
    is_approver: id === 1 ? 1 : 0,
    is_devops: 0,
    dev_access: 0,
    origin: 'seen:library',
    note: 'private note',
    first_seen_at: '2026-08-01T00:00:00.000Z',
    last_seen_at: '2026-11-01T00:00:00.000Z',
    decided_at: '2026-08-02T00:00:00.000Z',
    decided_by: 1,
    photo_url: 'https://example.com/p.png',
    vis_library: 1,
  };
}

class FakeDB {
  sql: string[] = [];
  rows: FullRow[] = [
    full(1, 'owner@example.com', 'Owner', 'approved'),
    // ⚠️ Stored MIXED-CASE on purpose (a hand-edited row): the wire must lower-case it.
    full(2, 'Zed.Mixed@Example.COM', 'alice', 'approved'),
    full(3, 'bob@example.com', 'Bob', 'approved'),
    full(4, 'noname@example.com', null, 'approved'),
    full(5, 'pending@example.com', 'Aaron Pending', 'pending'),
    full(6, 'revoked@example.com', 'Abe Revoked', 'revoked'),
    // Same display name as #2, different case — tie broken by email.
    full(7, 'a.second@example.com', 'ALICE', 'approved'),
  ];

  prepare(sql: string) {
    const db = this;
    db.sql.push(sql);
    const stmt = {
      bind() {
        return stmt;
      },
      async all() {
        if (!/FROM estate_user/.test(sql)) return { results: [] };
        let rows = [...db.rows];
        if (/WHERE\s+status\s*=\s*'approved'/.test(sql)) rows = rows.filter((r) => r.status === 'approved');
        const cols = /SELECT\s+([\s\S]+?)\s+FROM/i.exec(sql)![1]!.split(',').map((c) => c.trim());
        const results = cols.includes('*')
          ? rows
          : rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
        return { results };
      },
      async first() {
        return null;
      },
      async run() {
        return { success: true };
      },
    };
    return stmt;
  }
}

const TOKENS = {
  ESTATE_APP_TOKEN_LIBRARY: 'library-token',
  ESTATE_APP_TOKEN_LIBRARY2: 'library2-token',
  ESTATE_APP_TOKEN_GAMES: 'games-token',
  ESTATE_APP_TOKEN_INDEX: 'index-token',
  ESTATE_APP_TOKEN_AUDIOBOOK: 'audiobook-token',
};

async function call(db: FakeDB, authorization: string | undefined, env: Record<string, unknown> = TOKENS) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  const res = await estateMembersRoutes.request('/estate/members', { headers }, {
    DB: db as unknown as D1Database,
    ...env,
  });
  return { res, body: (await res.json()) as any };
}

function assertRefusalWorded(body: any) {
  assert.equal(typeof body.error, 'string');
  assert.ok(typeof body.detail === 'string' && body.detail.length > 0, 'refusal must say what happened in words');
  assert.ok(typeof body.fix === 'string' && body.fix.length > 0, 'refusal must say how to fix it');
  assert.equal(body.members, undefined, 'a refusal must carry no roster');
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test('LIBRARY bearer → 200, approved rows only, exactly three fields, emails lower-cased', async () => {
  const db = new FakeDB();
  const { res, body } = await call(db, 'Bearer library-token');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(body), ['members']);

  const ids = body.members.map((m: any) => m.id);
  // Pending (#5) and revoked (#6) are present in the table and absent here.
  assert.ok(!ids.includes(5), 'a pending row must never be returned');
  assert.ok(!ids.includes(6), 'a revoked row must never be returned');
  assert.equal(body.members.length, 5);

  for (const m of body.members) {
    assert.deepEqual(Object.keys(m).sort(), ['display_name', 'email', 'id']);
    assert.equal(m.email, m.email.toLowerCase());
  }
  assert.ok(body.members.some((m: any) => m.email === 'zed.mixed@example.com'));
});

test('ordered by display name case-insensitively, then email; unnamed members last', async () => {
  const db = new FakeDB();
  const { body } = await call(db, 'Bearer library-token');
  assert.deepEqual(
    body.members.map((m: any) => [m.display_name, m.email]),
    [
      ['ALICE', 'a.second@example.com'],
      ['alice', 'zed.mixed@example.com'],
      ['Bob', 'bob@example.com'],
      ['Owner', 'owner@example.com'],
      [null, 'noname@example.com'],
    ],
  );
});

test('LIBRARY2 bearer → 200 too', async () => {
  const db = new FakeDB();
  const { res, body } = await call(db, 'Bearer library2-token');
  assert.equal(res.status, 200);
  assert.equal(body.members.length, 5);
});

test('only LIBRARY2 configured: its bearer works, a LIBRARY-shaped guess does not', async () => {
  const db = new FakeDB();
  const env = { ESTATE_APP_TOKEN_LIBRARY2: 'library2-token' };
  assert.equal((await call(db, 'Bearer library2-token', env)).res.status, 200);
  assert.equal((await call(db, 'Bearer library-token', env)).res.status, 401);
});

test('⚠️ the SQL names exactly three columns and filters to approved — never SELECT *', async () => {
  const db = new FakeDB();
  await call(db, 'Bearer library-token');
  const q = db.sql.find((s) => /FROM estate_user/.test(s));
  assert.ok(q, 'the roster query ran');
  assert.doesNotMatch(q!, /\*/);
  assert.match(q!, /SELECT id, email, display_name FROM estate_user WHERE status = 'approved'/);
});

// ---------------------------------------------------------------------------
// Refusals — default-deny for every other app
// ---------------------------------------------------------------------------

test('⚠️ a VALID token of another estate app is refused — games, index, audiobook', async () => {
  for (const tok of ['games-token', 'index-token', 'audiobook-token']) {
    const db = new FakeDB();
    const { res, body } = await call(db, `Bearer ${tok}`);
    assert.equal(res.status, 401, `${tok} must not read the roster`);
    assert.equal(body.error, 'unauthorized');
    assertRefusalWorded(body);
    assert.equal(db.sql.length, 0, 'a refused caller must not reach the database');
  }
});

test('missing, garbled and non-Bearer authorization → 401 unauthorized, worded', async () => {
  for (const h of [undefined, 'Bearer nope', 'Bearer ', 'library-token', 'Basic library-token']) {
    const db = new FakeDB();
    const { res, body } = await call(db, h);
    assert.equal(res.status, 401, `authorization=${JSON.stringify(h)}`);
    assert.equal(body.error, 'unauthorized');
    assertRefusalWorded(body);
  }
});

test('neither library secret set → 503 app_tokens_unset that NAMES both secrets', async () => {
  const db = new FakeDB();
  const { res, body } = await call(db, 'Bearer library-token', {});
  assert.equal(res.status, 503);
  assert.equal(body.error, 'app_tokens_unset');
  assertRefusalWorded(body);
  assert.match(body.fix, /ESTATE_APP_TOKEN_LIBRARY\b/);
  assert.match(body.fix, /ESTATE_APP_TOKEN_LIBRARY2/);
});

test('⚠️ only OTHER apps’ secrets set is still "not configured" for the roster — not a 401', async () => {
  // GAMES/INDEX being set says nothing about whether a library could get in;
  // `identifyApp`'s anyConfigured would have called this a wrong token.
  const db = new FakeDB();
  const { res, body } = await call(db, 'Bearer games-token', {
    ESTATE_APP_TOKEN_GAMES: 'games-token',
    ESTATE_APP_TOKEN_INDEX: 'index-token',
  });
  assert.equal(res.status, 503);
  assert.equal(body.error, 'app_tokens_unset');
});

test('GAMES and LIBRARY both set, games token presented → 401 (the allowlist, not "any app")', async () => {
  const db = new FakeDB();
  const { res } = await call(db, 'Bearer games-token', {
    ESTATE_APP_TOKEN_GAMES: 'games-token',
    ESTATE_APP_TOKEN_LIBRARY: 'library-token',
  });
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// The sort, directly
// ---------------------------------------------------------------------------

test('sortRoster does not mutate its input, and a case-only name tie falls to email', () => {
  const input = [
    { id: 2, email: 'b@x', display_name: 'Same' },
    { id: 1, email: 'a@x', display_name: 'same' },
  ];
  const out = sortRoster(input);
  assert.deepEqual(out.map((m) => m.id), [1, 2]);
  assert.deepEqual(input.map((m) => m.id), [2, 1]);
});

// ---------------------------------------------------------------------------
// The COMPOSED Worker — the mount in index.ts, not just the sub-router
// ---------------------------------------------------------------------------

const noCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

test('the real Worker serves /api/estate/members (a worded 401, not a 404) and a library bearer gets 200', async () => {
  const db = new FakeDB();
  const env = { DB: db as unknown as D1Database, ...TOKENS } as never;
  const anon = await worker.fetch(new Request('https://auth.example/api/estate/members'), env, noCtx);
  assert.equal(anon.status, 401);
  assert.equal(((await anon.json()) as any).error, 'unauthorized');

  const ok = await worker.fetch(
    new Request('https://auth.example/api/estate/members', { headers: { authorization: 'Bearer library-token' } }),
    env,
    noCtx,
  );
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as any).members.length, 5);
});

test('⚠️ NO CORS: an apex-origin preflight and an apex-origin GET get no access-control-allow-origin', async () => {
  const db = new FakeDB();
  const env = { DB: db as unknown as D1Database, ...TOKENS, ADMIN_ORIGINS: 'https://heygabi.ai' } as never;
  const pre = await worker.fetch(
    new Request('https://auth.example/api/estate/members', {
      method: 'OPTIONS',
      headers: { origin: 'https://heygabi.ai', 'access-control-request-method': 'GET' },
    }),
    env,
    noCtx,
  );
  assert.equal(pre.headers.get('access-control-allow-origin'), null);

  const got = await worker.fetch(
    new Request('https://auth.example/api/estate/members', {
      headers: { origin: 'https://heygabi.ai', authorization: 'Bearer library-token' },
    }),
    env,
    noCtx,
  );
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('access-control-allow-origin'), null);
});
