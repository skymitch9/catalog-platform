/**
 * catalogs.test.ts — `GET /api/catalogs`, the estate's republished catalog
 * REGISTRY, exercised through the REAL exported `app` (so mounting order is
 * under test too: it sits BEFORE the requireEstateMember() blanket, like
 * /api/search and for the same reason).
 *
 * Owner ask, 2026-09-05 15:50 Phoenix, confirmed 15:58. Design:
 * docs/info/catalog-registry.md. Survey: multi-library-survey-2026-09-05.md §4.
 *
 * 🔴 MOST OF THIS FILE IS ABOUT WHAT AN ANONYMOUS CALLER MUST **NOT** GET.
 * Owner decision 2026-09-05 16:14, asked and answered: **"yes name only"** —
 * labels reach the signed-out internet because the apex search box needs them
 * before sign-in, and nothing derived from a row on anybody's shelf does. The
 * happy path is three tests; the fences are the rest.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from '../src/index.js';
import {
  REGISTRY_TTL_MS,
  __resetRegistryCache,
  catalogWire,
  loadRegistry,
  parseRegistry,
  readCounts,
  type RegistryCatalog,
} from '../src/catalogs-route.js';
import { MACHINE_VISIBILITY } from '../src/machine-route.js';

const OWNER = 'owner@example.com';
const MEMBER = 'member@example.com';

/** The five the auth Worker's 0020 back-seeds, as they come off the wire. */
const REGISTRY: RegistryCatalog[] = [
  { id: 'audiobook', push_source: 'audiobook', kind: 'audio', label: 'Shared audiobooks', owner: null, holding: 'digital', shared: true, host: 'audiobooks.heygabi.ai' },
  { id: 'library', push_source: 'library', kind: 'books', label: "Skylar's library", owner: 'Skylar', holding: 'physical', shared: false, host: 'library.heygabi.ai' },
  { id: 'games', push_source: 'game', kind: 'games', label: "Skylar's board games", owner: 'Skylar', holding: 'physical', shared: false, host: 'boardgames.heygabi.ai' },
  { id: 'library2', push_source: 'library2', kind: 'books', label: "Samantha's library", owner: 'Samantha', holding: 'physical', shared: false, host: 'padhard.heygabi.ai' },
  { id: 'ebooks', push_source: null, kind: 'books', label: 'Shared ebooks', owner: null, holding: 'digital', shared: true, host: 'ebooks.heygabi.ai' },
];

/* ------------------------------------------------------------------ *
 * Fakes
 * ------------------------------------------------------------------ */

interface EntryRow {
  source: string;
  pushed_at: string;
}

class FakeDB {
  cache = new Map<string, { status: string; checked_at: string; visibility: string | null }>();
  /** Every count query this test run issued — the anonymous branch must be 0. */
  countQueries = 0;
  constructor(public entries: EntryRow[] = []) {}

  prepare(sql: string) {
    const self = this;
    const make = (args: unknown[]) => ({
      async first() {
        if (sql.includes('FROM estate_cache')) return self.cache.get(String(args[0])) ?? null;
        return null;
      },
      async run() {
        return { success: true };
      },
      async all() {
        if (sql.includes('COUNT(*)') && sql.includes('FROM entry')) {
          self.countQueries += 1;
          const by = new Map<string, { rows: number; pushed_at: string | null }>();
          for (const e of self.entries) {
            const cur = by.get(e.source) ?? { rows: 0, pushed_at: null };
            by.set(e.source, {
              rows: cur.rows + 1,
              pushed_at: cur.pushed_at && cur.pushed_at > e.pushed_at ? cur.pushed_at : e.pushed_at,
            });
          }
          return { results: [...by].map(([source, v]) => ({ source, ...v })) };
        }
        return { results: [] };
      },
    });
    return { bind: (...args: unknown[]) => make(args), ...make([]) };
  }
  async batch() {
    return [];
  }
}

function entries(): EntryRow[] {
  return [
    { source: 'audiobook', pushed_at: '2026-09-05T10:00:00.000Z' },
    { source: 'library', pushed_at: '2026-09-05T10:01:00.000Z' },
    { source: 'library', pushed_at: '2026-09-05T10:02:00.000Z' },
    { source: 'game', pushed_at: '2026-09-05T10:03:00.000Z' },
    { source: 'library2', pushed_at: '2026-09-05T23:03:19.602Z' },
    { source: 'library2', pushed_at: '2026-09-05T23:03:19.602Z' },
  ];
}

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

function memberEnv(db: FakeDB, email: string, over: Record<string, unknown> = {}) {
  return prodEnv(db, { ENVIRONMENT: 'development', DEV_EMAIL: email, ...over });
}

/**
 * One stub for BOTH upstream calls — the registry read and the /seen check —
 * routed by URL, because this route makes two different subrequests to the same
 * origin and a stub that answered them alike would test neither.
 */
function stubUpstream(opts: {
  registry?: RegistryCatalog[] | 'unreachable' | 'refused';
  seen?: { status: string; visibility?: unknown } | 'unreachable';
}) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/api/estate/catalogs')) {
      const r = opts.registry ?? REGISTRY;
      if (r === 'unreachable') throw new TypeError('fetch failed');
      if (r === 'refused') return new Response('{"error":"unauthorized"}', { status: 401 });
      return new Response(JSON.stringify({ ok: true, catalogs: r, count: r.length }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const seen = opts.seen ?? { status: 'approved', visibility: ['audiobook', 'library', 'games'] };
    if (seen === 'unreachable') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(seen), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

type WireCatalog = Record<string, unknown> & { id: string };
type Body = { ok?: boolean; catalogs: WireCatalog[]; counts: string; stale: boolean; fetched_at: string };

async function fetchCatalogs(env: Record<string, unknown>): Promise<{ res: Response; body: Body }> {
  const res = await app.request('/api/catalogs', {} as never, env);
  return { res, body: (await res.json()) as Body };
}

/* ------------------------------------------------------------------ *
 * 🔴 The anonymous answer — name only
 * ------------------------------------------------------------------ */

test('🔴 an ANONYMOUS caller gets every catalog’s NAME and OWNER, and no count anywhere', async () => {
  __resetRegistryCache();
  const db = new FakeDB(entries());
  const stub = stubUpstream({});
  try {
    const { res, body } = await fetchCatalogs(prodEnv(db));
    assert.equal(res.status, 200, 'the registry must answer the signed-out internet, never 401');
    assert.equal(body.counts, 'none');
    assert.deepEqual(body.catalogs.map((c) => c.id), ['audiobook', 'library', 'games', 'library2', 'ebooks']);

    // The labels the apex search box needs before anybody signs in.
    assert.equal(body.catalogs[1]?.label, "Skylar's library");
    assert.equal(body.catalogs[1]?.owner, 'Skylar');
    assert.equal(body.catalogs[3]?.label, "Samantha's library");
    assert.equal(body.catalogs[3]?.owner, 'Samantha');

    // 🔴 AND NOT ONE NUMBER. Owner, 16:14: "yes name only".
    for (const c of body.catalogs) {
      assert.ok(!('rows' in c), `${c.id} must carry no row count for the anonymous`);
      assert.ok(!('pushed_at' in c), `${c.id} must carry no freshness for the anonymous`);
    }
  } finally {
    stub.restore();
  }
});

test('🔴 the anonymous branch NEVER OPENS THE DATABASE — the rule is control flow, not a strip', async () => {
  __resetRegistryCache();
  const db = new FakeDB(entries());
  const stub = stubUpstream({});
  try {
    await fetchCatalogs(prodEnv(db));
    // ⚠️ This is the assertion that survives a careless edit. A future change
    // that computed counts and then filtered them out would still pass every
    // shape test above and would fail this one.
    assert.equal(db.countQueries, 0, 'an anonymous request must not read a single row count');
  } finally {
    stub.restore();
  }
});

test('⚠️ the anonymous answer carries HOSTS, which are public routed names and nothing private', async () => {
  __resetRegistryCache();
  const stub = stubUpstream({});
  try {
    const { body } = await fetchCatalogs(prodEnv(new FakeDB()));
    for (const c of body.catalogs) {
      assert.match(String(c.host), /^[a-z0-9.-]+\.heygabi\.ai$/, `${c.id}'s host must be a public estate name`);
    }
  } finally {
    stub.restore();
  }
});

/* ------------------------------------------------------------------ *
 * The member answer — counts, scoped to the member's own grants
 * ------------------------------------------------------------------ */

test('a MEMBER gets counts for the catalogs their own visibility admits, and only those', async () => {
  __resetRegistryCache();
  const db = new FakeDB(entries());
  // The default grant from migration 0002: {audiobook, library, games}. No
  // library2, no ebooks — which is every ordinary member today.
  const stub = stubUpstream({ seen: { status: 'approved', visibility: ['audiobook', 'library', 'games'] } });
  try {
    const { body } = await fetchCatalogs(memberEnv(db, MEMBER));
    assert.equal(body.counts, 'scoped');
    const by = new Map(body.catalogs.map((c) => [c.id, c]));
    assert.equal(by.get('library')?.rows, 2);
    assert.equal(by.get('library')?.pushed_at, '2026-09-05T10:02:00.000Z');
    assert.equal(by.get('games')?.rows, 1, 'the count is keyed on push_source `game`, not the id `games`');
    assert.equal(by.get('audiobook')?.rows, 1);

    // 🔴 SAMANTHA'S SHELF IS NAMED AND NEVER COUNTED for a member with no
    // vis_library2 grant. This is the fence the owner's rule turns on.
    assert.equal(by.get('library2')?.label, "Samantha's library");
    assert.ok(!('rows' in (by.get('library2') ?? {})), 'no count without the grant');
    assert.ok(!('pushed_at' in (by.get('library2') ?? {})), 'no freshness without the grant');
  } finally {
    stub.restore();
  }
});

test('a member WITH the library2 grant does get her counts — the grant is the whole difference', async () => {
  __resetRegistryCache();
  const db = new FakeDB(entries());
  const stub = stubUpstream({
    seen: { status: 'approved', visibility: ['audiobook', 'library', 'games', 'library2'] },
  });
  try {
    const { body } = await fetchCatalogs(memberEnv(db, MEMBER));
    const by = new Map(body.catalogs.map((c) => [c.id, c]));
    assert.equal(by.get('library2')?.rows, 2);
    assert.equal(by.get('library2')?.pushed_at, '2026-09-05T23:03:19.602Z');
  } finally {
    stub.restore();
  }
});

test('🔴 a REVOKED member is named the catalogs and counted none of them', async () => {
  __resetRegistryCache();
  const db = new FakeDB(entries());
  const stub = stubUpstream({ seen: { status: 'revoked', visibility: [] } });
  try {
    const { body } = await fetchCatalogs(memberEnv(db, MEMBER));
    // ⚠️ `scoped` with an EMPTY scope, not `none`. The two are different facts:
    // "we did not look" and "we looked and you may see nothing". Revocation
    // beats the public slice on the estate's own surfaces (§4.5).
    assert.equal(body.counts, 'scoped');
    for (const c of body.catalogs) assert.ok(!('rows' in c), `${c.id} must be uncounted for the revoked`);
  } finally {
    stub.restore();
  }
});

test('⚠️ `ebooks` is never given a count, even to a member who holds it', async () => {
  __resetRegistryCache();
  const db = new FakeDB(entries());
  const stub = stubUpstream({
    seen: { status: 'approved', visibility: ['audiobook', 'library', 'games', 'ebooks'] },
  });
  try {
    const { body } = await fetchCatalogs(memberEnv(db, MEMBER));
    const ebooks = body.catalogs.find((c) => c.id === 'ebooks');
    // It has no source of its own — ebook rows ride `audiobook` with
    // format='ebook' — so there is no honest per-catalog number and none is
    // invented. Reporting the audiobook total here would tell a member the
    // shared ebook shelf holds every audiobook in the house.
    assert.ok(!('rows' in (ebooks ?? {})));
    assert.equal(ebooks?.push_source, null);
  } finally {
    stub.restore();
  }
});

test('the OWNER, on break-glass standing, is counted everything', async () => {
  __resetRegistryCache();
  const db = new FakeDB(entries());
  const stub = stubUpstream({});
  try {
    const { body } = await fetchCatalogs(memberEnv(db, OWNER));
    const by = new Map(body.catalogs.map((c) => [c.id, c]));
    assert.equal(by.get('library2')?.rows, 2);
    assert.equal(by.get('games')?.rows, 1);
  } finally {
    stub.restore();
  }
});

/* ------------------------------------------------------------------ *
 * Caching — and the honest age
 * ------------------------------------------------------------------ */

test('the registry is fetched ONCE and served from memory inside the TTL', async () => {
  __resetRegistryCache();
  const stub = stubUpstream({});
  try {
    await fetchCatalogs(prodEnv(new FakeDB()));
    await fetchCatalogs(prodEnv(new FakeDB()));
    await fetchCatalogs(prodEnv(new FakeDB()));
    const registryCalls = stub.calls.filter((u) => u.includes('/api/estate/catalogs'));
    assert.equal(registryCalls.length, 1, 'three requests, one upstream read');
    assert.match(registryCalls[0] ?? '', /^https:\/\/auth\.test\/api\/estate\/catalogs$/);
  } finally {
    stub.restore();
  }
});

test('🔴 an unreachable directory serves the LAST GOOD copy and says it is stale', async () => {
  __resetRegistryCache();
  const warm = stubUpstream({});
  try {
    const first = await loadRegistry(prodEnv(new FakeDB()) as never);
    assert.equal(first.ok && first.stale, false);
  } finally {
    warm.restore();
  }

  const broken = stubUpstream({ registry: 'unreachable' });
  try {
    // Past the TTL, so a refresh is attempted and fails.
    const later = await loadRegistry(prodEnv(new FakeDB()) as never, Date.now() + REGISTRY_TTL_MS + 1);
    assert.ok(later.ok, 'names we already have are better than an outage page');
    assert.equal(later.ok && later.stale, true);
    assert.equal(later.ok && later.catalogs.length, 5);
    // ⚠️ THE STALE COPY KEEPS ITS OWN AGE. A failed refresh that re-stamped the
    // cache would make an unreachable directory look perpetually fresh — the
    // silent-staleness trap, exactly.
    assert.ok(later.ok && Date.now() - later.fetchedAt < REGISTRY_TTL_MS);
  } finally {
    broken.restore();
  }
});

test('🔴 no cache and no directory is a WORDED 503 — never an empty list', async () => {
  __resetRegistryCache();
  const stub = stubUpstream({ registry: 'unreachable' });
  try {
    const { res, body } = await fetchCatalogs(prodEnv(new FakeDB()));
    assert.equal(res.status, 503);
    const err = body as unknown as { error: string; detail: string; catalogs?: unknown };
    assert.equal(err.error, 'registry_unavailable');
    // A person must never see a bare status: it says what happened, that it is
    // not about them, and that there is nothing to sign in to.
    assert.match(err.detail, /outage on our side, not a permissions problem/);
    // ⚠️ `[]` WOULD SAY "THE ESTATE HAS NO CATALOGS", which is a confident false
    // statement of exactly the kind the owner's rule is about.
    assert.ok(!('catalogs' in err));
  } finally {
    stub.restore();
  }
});

test('an unwired Worker says it is OUR configuration, and names what is missing', async () => {
  __resetRegistryCache();
  const stub = stubUpstream({});
  try {
    const { res, body } = await fetchCatalogs(prodEnv(new FakeDB(), { ESTATE_APP_TOKEN_INDEX: undefined }));
    assert.equal(res.status, 503);
    const err = body as unknown as { error: string; detail: string; fix: string };
    assert.equal(err.error, 'registry_unconfigured');
    assert.match(err.detail, /not a decision about you/);
    assert.match(err.fix, /ESTATE_APP_TOKEN_INDEX/);
  } finally {
    stub.restore();
  }
});

test('a 401 from the directory does not become an empty registry', async () => {
  __resetRegistryCache();
  const stub = stubUpstream({ registry: 'refused' });
  try {
    const { res } = await fetchCatalogs(prodEnv(new FakeDB()));
    assert.equal(res.status, 503, 'a refused read is an outage to the caller, never "no catalogs"');
  } finally {
    stub.restore();
  }
});

/* ------------------------------------------------------------------ *
 * Cache headers
 * ------------------------------------------------------------------ */

test('🔴 a MEMBER answer is no-store and an anonymous one is cacheable — the safe asymmetry', async () => {
  __resetRegistryCache();
  const stubA = stubUpstream({});
  try {
    const anon = await app.request('/api/catalogs', {} as never, prodEnv(new FakeDB()));
    assert.match(anon.headers.get('cache-control') ?? '', /public, max-age=\d+/);
    // ⚠️ `Origin` is hono/cors's, appended to ours rather than replacing it —
    // measured, because a middleware that OVERWROTE Vary would silently delete
    // the header that states this answer depends on the caller's token.
    assert.match(anon.headers.get('vary') ?? '', /\bAuthorization\b/);
  } finally {
    stubA.restore();
  }

  const stubB = stubUpstream({});
  try {
    const member = await app.request('/api/catalogs', {} as never, memberEnv(new FakeDB(entries()), MEMBER));
    // Both answers live at the SAME URL, so a shared cache that stored the
    // member copy could hand another caller counts they hold no grant for.
    // `no-store` makes that impossible; the reverse costs a member their counts
    // and leaks nothing.
    assert.match(member.headers.get('cache-control') ?? '', /no-store/);
  } finally {
    stubB.restore();
  }
});

/* ------------------------------------------------------------------ *
 * The parser
 * ------------------------------------------------------------------ */

test('parseRegistry validates the eight fields and refuses a malformed entry outright', () => {
  assert.equal(parseRegistry({ catalogs: REGISTRY })?.length, 5);
  assert.equal(parseRegistry(null), null);
  assert.equal(parseRegistry({}), null);
  assert.equal(parseRegistry({ catalogs: 'nope' }), null);
  const bad = (over: Record<string, unknown>) => parseRegistry({ catalogs: [{ ...REGISTRY[1], ...over }] });
  assert.equal(bad({ id: '' }), null);
  assert.equal(bad({ label: 42 }), null);
  assert.equal(bad({ holding: 'paper' }), null, 'the holding vocabulary is closed');
  assert.equal(bad({ shared: 1 }), null, 'shared is a boolean on the wire, never 0/1');
  assert.equal(bad({ owner: 7 }), null);
  assert.equal(bad({ host: '' }), null);
  // ⚠️ A NULL OWNER AND A NULL PUSH SOURCE ARE VALID ANSWERS, not gaps: the
  // shared pools have no owner and `ebooks` has no source of its own.
  assert.equal(bad({ owner: null })?.length, 1);
  assert.equal(bad({ push_source: null })?.length, 1);
});

test('⚠️ an unknown FIELD rides through — an older index Worker must not truncate tomorrow’s registry', () => {
  const parsed = parseRegistry({ catalogs: [{ ...REGISTRY[1], theme: 'hearts' }] });
  assert.equal((parsed?.[0] as Record<string, unknown> | undefined)?.theme, 'hearts');
});

/* ------------------------------------------------------------------ *
 * The pure helpers
 * ------------------------------------------------------------------ */

test('catalogWire adds the count keys only in scope, and ABSENT is not null', () => {
  const counts = new Map([['library', { rows: 12, pushed_at: '2026-09-05T00:00:00.000Z' }]]);
  const lib = REGISTRY[1] as RegistryCatalog;
  const scoped = catalogWire(lib, { counts, visibility: ['library'] });
  assert.equal(scoped.rows, 12);
  const unscoped = catalogWire(lib, { counts, visibility: ['audiobook'] });
  // ⚠️ agent-board-contract.md's rule: a missing number is not zero — and it is
  // not null either. `rows: null` reads as "we looked and found nothing", which
  // a renderer prints as "0 items"; the key being ABSENT is the true statement.
  assert.ok(!('rows' in unscoped));
  assert.ok(!('pushed_at' in unscoped));
  // A source in scope with no rows pushed yet IS zero, and says so.
  const empty = catalogWire(lib, { counts: new Map(), visibility: ['library'] });
  assert.equal(empty.rows, 0);
  assert.equal(empty.pushed_at, null);
});

test('readCounts groups by entry.source, the same shape /api/health reads', async () => {
  const db = new FakeDB(entries());
  const counts = await readCounts(db as unknown as D1Database);
  assert.equal(counts.get('library')?.rows, 2);
  assert.equal(counts.get('library2')?.rows, 2);
  assert.equal(counts.get('game')?.rows, 1);
  assert.equal(counts.get('nothing'), undefined);
});

/* ------------------------------------------------------------------ *
 * The fences this build must not have moved
 * ------------------------------------------------------------------ */

test('🔴 MACHINE_VISIBILITY is UNTOUCHED — a registry must not auto-admit new catalogs', () => {
  // Survey §3.3: this array is a DELIBERATE default-deny, `library2` and
  // `ebooks` excluded on purpose. It is pinned in machine-read.test.ts too; the
  // assertion is repeated here because THIS build is the one that would have
  // been tempted to make it registry-driven.
  assert.deepEqual([...MACHINE_VISIBILITY], ['audiobook', 'library', 'games']);
});

test('⚠️ /api/catalogs is mounted ABOVE the members-only blanket, and /api/lookup is still below it', async () => {
  __resetRegistryCache();
  const stub = stubUpstream({});
  try {
    const open = await app.request('/api/catalogs', {} as never, prodEnv(new FakeDB()));
    assert.equal(open.status, 200);
    // The blanket is still a blanket: an anonymous lookup is refused, exactly
    // as it was before this route existed.
    const gated = await app.request('/api/lookup?title=x', {} as never, prodEnv(new FakeDB()));
    assert.equal(gated.status, 401);
  } finally {
    stub.restore();
  }
});
