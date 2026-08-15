/**
 * The read-surface gate, exercised against the REAL exported app — mounting
 * order included (push before the blanket, health open, reads gated). The
 * estate directory is a stubbed global fetch; D1 is a minimal fake that
 * implements exactly what the routes touch. The §3.1 combination table
 * itself is pinned row-by-row in @platform/estate-auth's own tests — these
 * tests pin what the INDEX does with each verdict.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from '../src/index.js';

// --- Minimal fake D1: estate_cache reads/writes, empty entry results. -----

interface CacheRow {
  status: string;
  checked_at: string;
  firebase_uid: string | null;
  /** The 0003 column: canonical JSON array text, or null (pre-0003 row). */
  visibility: string | null;
}

class FakeDB {
  cache = new Map<string, CacheRow>();

  prepare(sql: string) {
    const self = this;
    const make = (args: unknown[]) => ({
      async first() {
        if (sql.includes('FROM estate_cache')) {
          const row = self.cache.get(String(args[0]));
          return row
            ? { status: row.status, checked_at: row.checked_at, visibility: row.visibility }
            : null;
        }
        return null;
      },
      async run() {
        if (sql.includes('INSERT INTO estate_cache')) {
          const [email, uid, status, checkedAt, visibility] = args as [
            string,
            string | null,
            string,
            string,
            string | null,
          ];
          const prev = self.cache.get(email);
          self.cache.set(email, {
            status,
            checked_at: checkedAt,
            visibility: visibility ?? null,
            firebase_uid: uid ?? prev?.firebase_uid ?? null,
          });
        }
        return { success: true };
      },
      async all() {
        return { results: [] };
      },
    });
    return {
      bind: (...args: unknown[]) => make(args),
      // health's GROUP BY runs unbound
      all: async () => ({ results: [] }),
      first: async () => null,
    };
  }

  async batch() {
    return [];
  }
}

/** All three catalogs as stored JSON — the household default. */
const FULL_VIS = '["audiobook","library","games"]';

// --- Env + fetch-stub helpers. --------------------------------------------

const OWNER = 'owner@example.com';

function baseEnv(db: FakeDB, over: Record<string, unknown> = {}) {
  return {
    DB: db as unknown as D1Database,
    ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: OWNER,
    ESTATE_AUTH_URL: 'https://auth.test',
    ESTATE_APP_TOKEN_INDEX: 'test-index-token',
    INDEX_PUSH_TOKEN_GAME: 'test-push-token',
    ...over,
  };
}

/** Dev-bypass identity — the canonical module's own mechanism, not a re-implementation. */
function devEnv(db: FakeDB, email: string, over: Record<string, unknown> = {}) {
  return baseEnv(db, { ENVIRONMENT: 'development', DEV_EMAIL: email, ...over });
}

interface FetchStub {
  calls: Array<{ url: string; body: unknown }>;
  restore(): void;
}

/** Replace global fetch (the /seen client uses it) for one test. */
function stubFetch(answer: { status?: number; body?: unknown } | 'unreachable'): FetchStub {
  const original = globalThis.fetch;
  const calls: FetchStub['calls'] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (answer === 'unreachable') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

const FRESH = () => new Date().toISOString();
const STALE = '2020-01-01T00:00:00.000Z';

// --- Tokenless: the blanket, and its named exceptions. --------------------

test('tokenless GET /api/lookup → 401 (blanket before the read routes)', async () => {
  const res = await app.request('/api/lookup?title=dune', {}, baseEnv(new FakeDB()));
  assert.equal(res.status, 401);
  assert.equal((await res.json() as any).error, 'unauthenticated');
});

test('tokenless GET /api/universe/:name → 401', async () => {
  const res = await app.request('/api/universe/dcc', {}, baseEnv(new FakeDB()));
  assert.equal(res.status, 401);
});

test('tokenless GET /api/health → 200, open by design', async () => {
  const res = await app.request('/api/health', {}, baseEnv(new FakeDB()));
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.ok, true);
});

// Envelope normalization (estate item 5, 2026-08-14): the new wrapper fields
// arrive AND the pre-existing `sources` field stays put at the top level —
// additive, so status.js keeps working unchanged either way.
test('GET /api/health answers the estate envelope with `sources` kept at the top level', async () => {
  const res = await app.request('/api/health', {}, baseEnv(new FakeDB()));
  const body = (await res.json()) as any;
  assert.equal(body.service, 'catalog-index');
  assert.equal(typeof body.time, 'string');
  assert.ok(!Number.isNaN(Date.parse(body.time)));
  assert.deepEqual(body.detail, { ok: true, sources: body.sources });
  assert.deepEqual(body.sources, { game: { rows: 0, pushed_at: null }, library: { rows: 0, pushed_at: null }, audiobook: { rows: 0, pushed_at: null } });
});

test('PUT /api/push/:source keeps its OWN bearer auth — wrong token answers push.ts 401, not the blanket', async () => {
  const res = await app.request(
    '/api/push/game',
    { method: 'PUT', headers: { Authorization: 'Bearer wrong' }, body: '[]' },
    baseEnv(new FakeDB()),
  );
  assert.equal(res.status, 401);
  // push.ts's body, proving the request reached the machine route and never
  // the estate blanket (which says 'unauthenticated').
  assert.equal((await res.json() as any).error, 'unauthorized');
});

test('FIREBASE_PROJECT_ID unset in production → 500 misconfigured, not 401', async () => {
  const res = await app.request(
    '/api/lookup?title=dune',
    {},
    baseEnv(new FakeDB(), { FIREBASE_PROJECT_ID: undefined }),
  );
  assert.equal(res.status, 500);
  assert.equal((await res.json() as any).error, 'misconfigured');
});

// --- The §3.1 verdicts, as the index answers them. ------------------------

test('estate approved → 200, and the fresh answer is cached (default_grant grants nothing and proceeds)', async () => {
  const db = new FakeDB();
  const f = stubFetch({ body: { status: 'approved' } });
  try {
    const res = await app.request('/api/lookup?title=dune', {}, devEnv(db, 'Member@Example.COM'));
    assert.equal(res.status, 200);
    assert.equal(f.calls.length, 1, 'one /seen call');
    assert.ok(f.calls[0]!.url.endsWith('/api/estate/seen'));
    // Email lowercased before it travels or lands anywhere.
    assert.equal((f.calls[0]!.body as any).email, 'member@example.com');
    const cached = db.cache.get('member@example.com');
    assert.equal(cached?.status, 'approved');
  } finally {
    f.restore();
  }
});

test('fresh cache is used — no /seen call inside the TTL', async () => {
  const db = new FakeDB();
  db.cache.set('member@example.com', { status: 'approved', checked_at: FRESH(), firebase_uid: null, visibility: FULL_VIS });
  const f = stubFetch('unreachable'); // would fail loudly if called
  try {
    const res = await app.request('/api/lookup?title=dune', {}, devEnv(db, 'member@example.com'));
    assert.equal(res.status, 200);
    assert.equal(f.calls.length, 0, 'cache rode instead of a network call');
  } finally {
    f.restore();
  }
});

test('estate pending → 403 estate_pending, the request-screen answer', async () => {
  const f = stubFetch({ body: { status: 'pending' } });
  try {
    const res = await app.request('/api/lookup?title=dune', {}, devEnv(new FakeDB(), 'newcomer@example.com'));
    assert.equal(res.status, 403);
    const body = await res.json() as any;
    assert.equal(body.error, 'estate_pending');
    assert.match(body.detail, /awaiting approval/);
  } finally {
    f.restore();
  }
});

test('estate revoked → 403, always — even for OWNER_EMAILS (§3.1 row 1: computed, never stored)', async () => {
  const db = new FakeDB();
  db.cache.set(OWNER, { status: 'revoked', checked_at: FRESH(), firebase_uid: null, visibility: '[]' });
  const f = stubFetch('unreachable');
  try {
    const res = await app.request('/api/lookup?title=dune', {}, devEnv(db, OWNER));
    assert.equal(res.status, 403);
    assert.equal((await res.json() as any).error, 'estate_revoked');
  } finally {
    f.restore();
  }
});

test('estate unreachable, no cache, unknown person → 503 estate_unreachable (named, fail closed)', async () => {
  const f = stubFetch('unreachable');
  try {
    const res = await app.request('/api/lookup?title=dune', {}, devEnv(new FakeDB(), 'ghost@example.com'));
    assert.equal(res.status, 503);
    assert.equal((await res.json() as any).error, 'estate_unreachable');
  } finally {
    f.restore();
  }
});

test('estate unreachable, STALE approved cache → 200 (standing member served, §6 row 1)', async () => {
  const db = new FakeDB();
  db.cache.set('member@example.com', { status: 'approved', checked_at: STALE, firebase_uid: null, visibility: FULL_VIS });
  const f = stubFetch('unreachable');
  try {
    const res = await app.request('/api/lookup?title=dune', {}, devEnv(db, 'member@example.com'));
    assert.equal(res.status, 200);
    assert.equal(f.calls.length, 1, 'it TRIED to refresh before falling back');
  } finally {
    f.restore();
  }
});

test('estate unreachable, stale PENDING cache → still refused (no admission to stand on)', async () => {
  const db = new FakeDB();
  db.cache.set('newcomer@example.com', { status: 'pending', checked_at: STALE, firebase_uid: null, visibility: '["audiobook"]' });
  const f = stubFetch('unreachable');
  try {
    const res = await app.request('/api/lookup?title=dune', {}, devEnv(db, 'newcomer@example.com'));
    assert.equal(res.status, 403);
    assert.equal((await res.json() as any).error, 'estate_pending');
  } finally {
    f.restore();
  }
});

test('OWNER_EMAILS break-glass: estate unreachable, no cache → 200 (§6 row 4)', async () => {
  const f = stubFetch('unreachable');
  try {
    const res = await app.request('/api/lookup?title=dune', {}, devEnv(new FakeDB(), OWNER));
    assert.equal(res.status, 200);
  } finally {
    f.restore();
  }
});

test('a garbage /seen answer is a failure, not a status — unknown person refused', async () => {
  const f = stubFetch({ body: { status: 'superuser' } });
  try {
    const res = await app.request('/api/lookup?title=dune', {}, devEnv(new FakeDB(), 'ghost@example.com'));
    assert.equal(res.status, 503);
    assert.equal((await res.json() as any).error, 'estate_unreachable');
  } finally {
    f.restore();
  }
});

// --- Config errors are named as config errors. ----------------------------

test('ESTATE_APP_TOKEN_INDEX unset → 503 estate_config_unset for a member', async () => {
  const f = stubFetch('unreachable');
  try {
    const res = await app.request(
      '/api/lookup?title=dune',
      {},
      devEnv(new FakeDB(), 'member@example.com', { ESTATE_APP_TOKEN_INDEX: undefined }),
    );
    assert.equal(res.status, 503);
    const body = await res.json() as any;
    assert.equal(body.error, 'estate_config_unset');
    assert.match(body.fix, /ESTATE_APP_TOKEN_INDEX/);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test('ESTATE_AUTH_URL unset → owner still served (break-glass beats broken wiring)', async () => {
  const res = await app.request(
    '/api/lookup?title=dune',
    {},
    devEnv(new FakeDB(), OWNER, { ESTATE_AUTH_URL: undefined }),
  );
  assert.equal(res.status, 200);
});
