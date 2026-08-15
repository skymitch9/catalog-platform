/**
 * Visibility-scoped search — §4.5 exercised through the REAL exported app
 * (mounting order included: /api/search sits BEFORE the blanket, lookup and
 * universe behind it). The estate directory is a stubbed global fetch; D1 is
 * a fake that honors exactly the SQL the scoped routes issue — including the
 * WHERE source IN scope clause, because the SQL IS the scope and a fake that
 * ignored it would test nothing.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from '../src/index.js';
import type { SearchRow } from '../src/search.js';

// --- Fake D1: estate_cache + a scope-honoring entry table. ------------------

interface CacheRow {
  status: string;
  checked_at: string;
  firebase_uid: string | null;
  visibility: string | null;
}

class FakeDB {
  cache = new Map<string, CacheRow>();
  constructor(private rows: SearchRow[] = []) {}

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
            string, string | null, string, string, string | null,
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
        if (!sql.includes('FROM entry')) return { results: [] };
        let rows = self.rows;
        let scopeArgs = args;
        if (sql.includes('WHERE title_fold = ?')) {
          rows = rows.filter((r) => r.title_fold === String(args[0]));
          scopeArgs = args.slice(1);
        } else if (sql.includes('WHERE universe = ?')) {
          rows = rows.filter((r) => r.universe === String(args[0]));
          scopeArgs = args.slice(1);
        }
        if (sql.includes('source IN')) {
          const sources = scopeArgs.map(String);
          rows = rows.filter((r) => sources.includes(r.source));
        }
        return { results: rows };
      },
    });
    return { bind: (...args: unknown[]) => make(args), ...make([]) };
  }

  async batch() { return []; }
}

// --- Rows: one universe spanning all three catalogs. ------------------------

let seq = 0;
function row(over: Partial<SearchRow> & { title: string }): SearchRow {
  seq += 1;
  const fold = over.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^(the|a|an)\s+/, '').trim();
  return {
    source: 'library',
    source_id: String(seq),
    creator: null,
    title_fold: fold === '' ? null : fold,
    work_fold: null,
    universe: null,
    series: null,
    series_index: null,
    year: null,
    publisher: null,
    format: 'hardcover',
    kind: null,
    parent_source_id: null,
    cover_url: null,
    detail_url: null,
    ...over,
  };
}

/** A universe from the REAL canonical list (universes-data.ts), because
 * /api/universe/:name resolves through it — an invented name would 404. */
const UNIVERSE = 'The Cosmere';
const QUERY = 'cosmere'; // matches every title below AND the universe name (alias)
function estateRows(): SearchRow[] {
  return [
    row({ title: 'Cosmere Chronicles', source: 'audiobook', format: 'audiobook', universe: UNIVERSE }),
    row({ title: 'Cosmere Chronicles', source: 'library', format: 'hardcover', universe: UNIVERSE }),
    row({ title: 'The Cosmere Atlas', source: 'library', format: 'hardcover', universe: UNIVERSE }),
    row({ title: 'Cosmere: The Board Game', source: 'game', format: 'boardgame', kind: 'base', universe: UNIVERSE }),
  ];
}

// --- Env + estate stub. -----------------------------------------------------

const OWNER = 'owner@example.com';

function prodEnv(db: FakeDB, over: Record<string, unknown> = {}) {
  return {
    DB: db as unknown as D1Database,
    ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: OWNER,
    ESTATE_AUTH_URL: 'https://auth.test',
    ESTATE_APP_TOKEN_INDEX: 'test-index-token',
    ...over,
  };
}

/** Dev-bypass identity — the canonical module's own mechanism. */
function memberEnv(db: FakeDB, email: string, over: Record<string, unknown> = {}) {
  return prodEnv(db, { ENVIRONMENT: 'development', DEV_EMAIL: email, ...over });
}

function stubSeen(answer: { status: string; visibility?: unknown } | 'unreachable') {
  const original = globalThis.fetch;
  const calls: unknown[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    if (answer === 'unreachable') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

const FRESH = () => new Date().toISOString();
const STALE = '2020-01-01T00:00:00.000Z';

async function search(env: Record<string, unknown>, q = QUERY, headers: Record<string, string> = {}) {
  const res = await app.request(`/api/search?q=${encodeURIComponent(q)}`, { headers }, env);
  assert.equal(res.status, 200);
  return (await res.json()) as any;
}

function sourcesIn(body: any): string[] {
  const s = new Set<string>();
  for (const b of body.books) for (const e of b.entries) s.add(e.source);
  for (const g of body.games) s.add(g.source);
  return [...s].sort();
}

// --- The anonymous rule. ----------------------------------------------------

test('anonymous search: absent token → the audiobook slice, and universe counts count only that slice', async () => {
  const body = await search(prodEnv(new FakeDB(estateRows())));
  assert.deepEqual(body.scope, ['audiobook']);
  assert.deepEqual(sourcesIn(body), ['audiobook']);
  assert.deepEqual(body.universes, [{ name: UNIVERSE, count: 1 }],
    'the ×4 universe is honestly ×1 inside the public slice');
});

test('anonymous search: an INVALID token is anonymous, never 401', async () => {
  const body = await search(prodEnv(new FakeDB(estateRows())), QUERY, {
    Authorization: 'Bearer not-a-jwt-at-all',
  });
  assert.deepEqual(body.scope, ['audiobook']);
  assert.deepEqual(sourcesIn(body), ['audiobook']);
});

test('pending member: /seen answers {audiobook} and it is applied verbatim — same view as the internet', async () => {
  const f = stubSeen({ status: 'pending', visibility: ['audiobook'] });
  try {
    const body = await search(memberEnv(new FakeDB(estateRows()), 'newcomer@example.com'));
    assert.deepEqual(body.scope, ['audiobook']);
    assert.deepEqual(sourcesIn(body), ['audiobook']);
  } finally {
    f.restore();
  }
});

test('revoked member: scope {} → empty results with the honest reason, a 200 not an error', async () => {
  const f = stubSeen({ status: 'revoked', visibility: [] });
  try {
    const body = await search(memberEnv(new FakeDB(estateRows()), 'gone@example.com'));
    assert.deepEqual(body.scope, []);
    assert.equal(body.books.length + body.games.length + body.universes.length, 0);
    assert.equal(body.reason, 'no_catalogs_visible');
  } finally {
    f.restore();
  }
});

// --- Member scoping. --------------------------------------------------------

test('a games-only member sees game rows only, and the universe count counts only game rows', async () => {
  const f = stubSeen({ status: 'approved', visibility: ['games'] });
  try {
    const body = await search(memberEnv(new FakeDB(estateRows()), 'gamer@example.com'));
    assert.deepEqual(body.scope, ['games']);
    assert.deepEqual(sourcesIn(body), ['game']);
    assert.equal(body.books.length, 0, 'no book tier at all — those rows never left the database');
    assert.deepEqual(body.universes, [{ name: UNIVERSE, count: 1 }],
      'not ×4: three of the four universe rows are out of scope');
  } finally {
    f.restore();
  }
});

test('a full-visibility member sees every catalog; the owner needs no directory at all', async () => {
  const f = stubSeen({ status: 'approved', visibility: ['audiobook', 'library', 'games'] });
  try {
    const body = await search(memberEnv(new FakeDB(estateRows()), 'member@example.com'));
    assert.deepEqual(body.scope, ['audiobook', 'library', 'games']);
    assert.deepEqual(sourcesIn(body), ['audiobook', 'game', 'library']);
    assert.deepEqual(body.universes, [{ name: UNIVERSE, count: 4 }]);
  } finally {
    f.restore();
  }

  // OWNER_EMAILS: all three computed, even with the estate unreachable (§4.3).
  const down = stubSeen('unreachable');
  try {
    const body = await search(memberEnv(new FakeDB(estateRows()), OWNER));
    assert.deepEqual(body.scope, ['audiobook', 'library', 'games']);
  } finally {
    down.restore();
  }
});

test('estate unreachable + valid token + NO cache → the public slice (fail closed, never open, never 503 here)', async () => {
  const f = stubSeen('unreachable');
  try {
    const body = await search(memberEnv(new FakeDB(estateRows()), 'member@example.com'));
    assert.deepEqual(body.scope, ['audiobook']);
    assert.deepEqual(sourcesIn(body), ['audiobook']);
  } finally {
    f.restore();
  }
});

// --- The cache carries visibility WITH status (§4.5's one-answer rule). -----

test('a fresh /seen answer lands visibility in estate_cache beside its status — one row, one age', async () => {
  const db = new FakeDB(estateRows());
  const f = stubSeen({ status: 'approved', visibility: ['games'] });
  try {
    await search(memberEnv(db, 'gamer@example.com'));
    const cached = db.cache.get('gamer@example.com');
    assert.equal(cached?.status, 'approved');
    assert.equal(cached?.visibility, '["games"]');
  } finally {
    f.restore();
  }
});

test('fresh cache WITH visibility scopes without any /seen call', async () => {
  const db = new FakeDB(estateRows());
  db.cache.set('gamer@example.com', {
    status: 'approved', checked_at: FRESH(), firebase_uid: null, visibility: '["games"]',
  });
  const f = stubSeen('unreachable'); // would fail loudly if consulted
  try {
    const body = await search(memberEnv(db, 'gamer@example.com'));
    assert.deepEqual(body.scope, ['games']);
    assert.equal(f.calls.length, 0, 'the cached pair answered alone');
  } finally {
    f.restore();
  }
});

test('AGED cache: the estate is asked again and the refreshed visibility replaces the cached one', async () => {
  const db = new FakeDB(estateRows());
  db.cache.set('member@example.com', {
    status: 'approved', checked_at: STALE, firebase_uid: null, visibility: '["games"]',
  });
  const f = stubSeen({ status: 'approved', visibility: ['audiobook', 'library', 'games'] });
  try {
    const body = await search(memberEnv(db, 'member@example.com'));
    assert.equal(f.calls.length, 1, 'stale cache means one /seen call');
    assert.deepEqual(body.scope, ['audiobook', 'library', 'games'], 'the re-widening took effect');
    assert.equal(db.cache.get('member@example.com')?.visibility, '["audiobook","library","games"]');
  } finally {
    f.restore();
  }
});

test('estate down + STALE cache: the cached visibility rides with its cached status — never recomputed wider', async () => {
  const db = new FakeDB(estateRows());
  db.cache.set('gamer@example.com', {
    status: 'approved', checked_at: STALE, firebase_uid: null, visibility: '["games"]',
  });
  const f = stubSeen('unreachable');
  try {
    const body = await search(memberEnv(db, 'gamer@example.com'));
    assert.equal(f.calls.length, 1, 'it TRIED to refresh before falling back');
    assert.deepEqual(body.scope, ['games'], 'stale pair kept whole');
  } finally {
    f.restore();
  }
});

test('a PRE-0003 cache row (fresh, visibility NULL) is healed by one /seen call rather than guessed at', async () => {
  const db = new FakeDB(estateRows());
  db.cache.set('member@example.com', {
    status: 'approved', checked_at: FRESH(), firebase_uid: null, visibility: null,
  });
  const f = stubSeen({ status: 'approved', visibility: ['audiobook', 'library', 'games'] });
  try {
    const body = await search(memberEnv(db, 'member@example.com'));
    assert.equal(f.calls.length, 1, 'fresh-but-half a cache does not short-circuit a scope decision');
    assert.deepEqual(body.scope, ['audiobook', 'library', 'games']);
    assert.equal(db.cache.get('member@example.com')?.visibility, '["audiobook","library","games"]');
  } finally {
    f.restore();
  }
});

// --- The scoped follow-up, and the untouched neighbors. ---------------------

test('/api/universe respects the member scope: a games-only member gets game rows only', async () => {
  const db = new FakeDB(estateRows());
  const f = stubSeen({ status: 'approved', visibility: ['games'] });
  try {
    const res = await app.request(
      `/api/universe/${encodeURIComponent(UNIVERSE)}`, {}, memberEnv(db, 'gamer@example.com'),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.deepEqual(body.scope, ['games']);
    assert.deepEqual(body.matches.map((m: any) => m.source), ['game'],
      'the library and audiobook shelves stay out of the room');
  } finally {
    f.restore();
  }
});

test('/api/universe carries `kind` on game rows — the accessories de-clutter (task 1) reads it client-side', async () => {
  const rows = [
    row({ title: 'Cosmere: The Board Game', source: 'game', format: 'boardgame', kind: 'base', universe: UNIVERSE }),
    row({ title: 'Cosmere: Art Print', source: 'game', format: 'boardgame', kind: 'accessory', universe: UNIVERSE }),
  ];
  const db = new FakeDB(rows);
  const f = stubSeen({ status: 'approved', visibility: ['games'] });
  try {
    const res = await app.request(
      `/api/universe/${encodeURIComponent(UNIVERSE)}`, {}, memberEnv(db, 'gamer@example.com'),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.deepEqual(body.matches.map((m: any) => m.kind).sort(), ['accessory', 'base'],
      'kind must be on the wire — the component groups accessories/promos into a collapsed subsection by it');
  } finally {
    f.restore();
  }
});

test('/api/universe stays members-only: anonymous → 401, unlike search', async () => {
  const res = await app.request(
    `/api/universe/${encodeURIComponent(UNIVERSE)}`, {}, prodEnv(new FakeDB(estateRows())),
  );
  assert.equal(res.status, 401);
});

test('/api/lookup stays members-only AND unscoped: tokenless 401; a games-only member still sees the book shelves', async () => {
  const anon = await app.request('/api/lookup?title=Cosmere%20Chronicles', {}, prodEnv(new FakeDB(estateRows())));
  assert.equal(anon.status, 401, 'the anonymous carve-out is search-only (§4.5)');

  const db = new FakeDB(estateRows());
  const f = stubSeen({ status: 'approved', visibility: ['games'] });
  try {
    const res = await app.request('/api/lookup?title=Cosmere%20Chronicles', {}, memberEnv(db, 'gamer@example.com'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.deepEqual([...new Set(body.matches.map((m: any) => m.source))].sort(), ['audiobook', 'library'],
      'lookup is membership-gated but deliberately unscoped — owner call, untouched');
  } finally {
    f.restore();
  }
});
