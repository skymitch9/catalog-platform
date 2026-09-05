/**
 * estate-catalog.test.ts — THE CATALOG REGISTRY (0020), exercised against the
 * real exported `estateCatalogRoutes` with a small in-memory D1.
 *
 * Owner ask, 2026-09-05 15:50 Phoenix, confirmed 15:58. Design:
 * docs/info/catalog-registry.md. Survey: multi-library-survey-2026-09-05.md §4.
 *
 * ⚠️ THE HIGHEST-VALUE TEST IN THIS FILE IS THE ONE THAT READS THE MIGRATION.
 * The five seed rows exist in TWO places on purpose — `0020_estate_catalog.sql`
 * (the only one anything reads at runtime) and `SEED_CATALOGS` (which nothing
 * reads at runtime) — and the whole reason the second one is allowed to exist
 * is that this file asserts they agree. Delete that test and the array becomes
 * a second registry that drifts, which is finding F2 in a new costume.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  CATALOG_ID_RE,
  CONTENT_KINDS,
  HOLDINGS,
  REGISTRY_TABLE_MISSING,
  SEED_CATALOGS,
  estateCatalogRoutes,
  insertCatalog,
  isContentKind,
  isHolding,
  listCatalogs,
  registryTableMissing,
  toWire,
  type EstateCatalogRow,
} from '../src/estate-catalog.js';
import { CATALOG_KINDS } from '../src/catalog-names.js';
import { CATALOGS } from '../src/visibility.js';

// ---------------------------------------------------------------------------
// ⚠️ The same Workers-runtime shim app-check.test.ts, billing-routes.test.ts and
// estate-docs.test.ts carry, for the same reason: `crypto.subtle.timingSafeEqual`
// is a Cloudflare EXTENSION and does not exist in Node, so `tokenMatches()`
// throws a TypeError and Hono turns it into a bare 500 — every route assertion
// below would then pass or fail for a reason unrelated to the route. It restores
// the FUNCTION, not the guarantee (deliberately not constant-time; a test
// process has no attacker). If these tests ever start 500ing, this is why.
// ---------------------------------------------------------------------------
const webcrypto = (globalThis as unknown as { crypto: Crypto }).crypto;
if (typeof (webcrypto.subtle as { timingSafeEqual?: unknown }).timingSafeEqual !== 'function') {
  (webcrypto.subtle as unknown as Record<string, unknown>).timingSafeEqual = (
    a: ArrayBufferView,
    b: ArrayBufferView,
  ): boolean => {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (x.length !== y.length) return false;
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
    return diff === 0;
  };
}

const APP_TOKEN = 'index-token-value';

function row(over: Partial<EstateCatalogRow> = {}): EstateCatalogRow {
  return {
    id: 'library',
    push_source: 'library',
    kind: 'books',
    label: "Skylar's library",
    owner_name: 'Skylar',
    holding: 'physical',
    shared: 0,
    host: 'library.heygabi.ai',
    sort_order: 20,
    request_id: null,
    created_at: '2026-09-05T00:00:00.000Z',
    ...over,
  };
}

/** A D1 fake that understands exactly the statements the registry issues. */
class FakeDB {
  rows: EstateCatalogRow[] = [];
  missingTable = false;
  failInsert = false;

  prepare(sql: string) {
    const db = this;
    let args: unknown[] = [];
    const guard = () => {
      if (db.missingTable) throw new Error('D1_ERROR: no such table: estate_catalog');
    };
    const stmt = {
      bind(...a: unknown[]) {
        args = a;
        return stmt;
      },
      async all() {
        guard();
        return { results: [...db.rows].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)) };
      },
      async first() {
        guard();
        return db.rows.find((r) => r.id === args[0]) ?? null;
      },
      async run() {
        guard();
        if (db.failInsert) throw new Error('D1_ERROR: write refused');
        if (/INSERT INTO estate_catalog/.test(sql)) {
          const [id, push, kind, label, owner, holding, shared, host, requestId, createdAt] = args as (
            | string
            | number
            | null
          )[];
          if (!db.rows.some((r) => r.id === id)) {
            db.rows.push(
              row({
                id: id as string,
                push_source: (push ?? null) as string | null,
                kind: kind as string,
                label: label as string,
                owner_name: (owner ?? null) as string | null,
                holding: holding as string,
                shared: Number(shared),
                host: host as string,
                sort_order: 100,
                request_id: (requestId ?? null) as number | null,
                created_at: createdAt as string,
              }),
            );
          }
        }
        return { success: true };
      },
    };
    return stmt;
  }
  async batch() {
    return [];
  }
}

function env(db: FakeDB, over: Record<string, unknown> = {}) {
  return {
    DB: db as unknown as D1Database,
    ESTATE_APP_TOKEN_INDEX: APP_TOKEN,
    ...over,
  };
}

function get(db: FakeDB, token: string | null, over: Record<string, unknown> = {}) {
  return estateCatalogRoutes.request(
    '/estate/catalogs',
    (token ? { headers: { authorization: `Bearer ${token}` } } : {}) as never,
    env(db, over),
  );
}

/** The five back-seeded rows, as a fresh D1 would hold them after 0020. */
function seeded(): FakeDB {
  const db = new FakeDB();
  db.rows = SEED_CATALOGS.map((c) => row({ ...c, request_id: null, created_at: '2026-09-05T00:00:00.000Z' }));
  return db;
}

// ---------------------------------------------------------------------------
// 🔴 The migration and the mirrored seed must agree
// ---------------------------------------------------------------------------

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../migrations/0020_estate_catalog.sql', import.meta.url)),
  'utf8',
);

test('🔴 every SEED_CATALOGS row is in 0020, spelled the same, with the same owner and host', () => {
  // ⚠️ Read out of the SQL, not out of a second constant — the point is that the
  // FILE says it. Only the INSERT half is scanned: the header prose names most
  // of these words too, and matching prose would make the test pass on a
  // comment while the VALUES drifted.
  const insertAt = MIGRATION.indexOf('INSERT OR IGNORE INTO estate_catalog');
  assert.ok(insertAt > 0, '0020 must carry the back-seed');
  const values = MIGRATION.slice(insertAt);

  for (const c of SEED_CATALOGS) {
    assert.ok(values.includes(`'${c.id}'`), `0020 must seed the catalog id ${c.id}`);
    // SQLite escapes a literal apostrophe by doubling it.
    assert.ok(
      values.includes(`'${c.label.replace(/'/g, "''")}'`),
      `0020 must carry the label for ${c.id}: ${c.label}`,
    );
    assert.ok(values.includes(`'${c.host}'`), `0020 must carry the host for ${c.id}`);
    if (c.owner_name) assert.ok(values.includes(`'${c.owner_name}'`), `0020 must designate ${c.id}'s owner`);
  }
  assert.equal(SEED_CATALOGS.length, 5, 'five catalogs exist today (survey §4)');
});

test('🔴 the seed IS the owner’s confirmed ownership table, item by item', () => {
  const by = new Map(SEED_CATALOGS.map((c) => [c.id, c]));
  // Owner, 2026-09-05 15:58: "Yes that is correct."
  assert.deepEqual(
    [by.get('library')?.owner_name, by.get('library')?.holding, by.get('library')?.shared],
    ['Skylar', 'physical', 0],
  );
  assert.deepEqual(
    [by.get('library2')?.owner_name, by.get('library2')?.holding, by.get('library2')?.shared],
    ['Samantha', 'physical', 0],
  );
  assert.deepEqual(
    [by.get('games')?.owner_name, by.get('games')?.holding, by.get('games')?.shared],
    ['Skylar', 'physical', 0],
  );
  // 🔴 A SHARED DIGITAL POOL HAS NO OWNER, and `owner_name` is NULL rather than
  // a name or an empty string — the distinction the owner's rule draws.
  assert.deepEqual(
    [by.get('audiobook')?.owner_name, by.get('audiobook')?.holding, by.get('audiobook')?.shared],
    [null, 'digital', 1],
  );
  assert.deepEqual(
    [by.get('ebooks')?.owner_name, by.get('ebooks')?.holding, by.get('ebooks')?.shared],
    [null, 'digital', 1],
  );
  // ⚠️ Every physical catalog is designated. This is the assertion that would
  // have caught survey finding F3 — `game` named nobody's on every surface.
  for (const c of SEED_CATALOGS) {
    if (c.holding === 'physical') assert.ok(c.owner_name, `${c.id} is physical and must name its owner`);
    if (c.shared === 1) assert.equal(c.owner_name, null, `${c.id} is shared and must name nobody`);
  }
});

test('⚠️ the seed ids are the VISIBILITY vocabulary, and push_source carries the other one', () => {
  // Every catalog the estate can grant is in the registry, and nothing else is.
  assert.deepEqual(
    [...SEED_CATALOGS.map((c) => c.id)].sort(),
    [...CATALOGS].sort(),
    'the registry seeds exactly the catalogs visibility.ts knows',
  );
  // The one place the two vocabularies differ.
  assert.equal(SEED_CATALOGS.find((c) => c.id === 'games')?.push_source, 'game');
  assert.equal(SEED_CATALOGS.find((c) => c.id === 'library2')?.push_source, 'library2');
  // 🔴 NULL IS THE ANSWER FOR EBOOKS, NOT A GAP. Ebook rows ride the `audiobook`
  // source with format='ebook'; a reader that "filled this in" with 'ebooks'
  // would build a scope that matches nothing while looking like a working one.
  assert.equal(SEED_CATALOGS.find((c) => c.id === 'ebooks')?.push_source, null);
});

test('⚠️ CONTENT_KINDS is NOT catalog-names.ts CATALOG_KINDS, and the difference is deliberate', () => {
  // The provisioning kind (which runbook applies) has two values and never
  // names a catalog that exists. The content kind (what is on the shelf) needs
  // a third for the audio pool. Survey §1 flags confusing them as a trap.
  assert.deepEqual([...CATALOG_KINDS], ['books', 'games']);
  assert.deepEqual([...CONTENT_KINDS], ['books', 'games', 'audio']);
  assert.ok(!(CATALOG_KINDS as readonly string[]).includes('audio'));
  assert.equal(SEED_CATALOGS.find((c) => c.id === 'audiobook')?.kind, 'audio');
  // They overlap where it matters, which is what makes the /live write a copy.
  for (const k of CATALOG_KINDS) assert.ok(isContentKind(k));
});

test('the vocabularies are closed', () => {
  assert.deepEqual([...HOLDINGS], ['physical', 'digital']);
  assert.ok(isHolding('physical') && isHolding('digital'));
  assert.ok(!isHolding('Physical') && !isHolding('') && !isHolding(null));
  assert.ok(!isContentKind('book') && !isContentKind('Games'));
});

test('⚠️ a catalog id must be a name a `vis_<id>` COLUMN can be called', () => {
  for (const ok of ['library', 'library2', 'games2', 'ab']) assert.ok(CATALOG_ID_RE.test(ok), ok);
  // A hyphen is legal in a hostname and illegal here, which is why the id and
  // the subdomain are validated by different rules.
  for (const no of ['library-3', 'Library', 'library_3', '3library', 'a', '']) {
    assert.ok(!CATALOG_ID_RE.test(no), no);
  }
});

// ---------------------------------------------------------------------------
// The wire shape
// ---------------------------------------------------------------------------

test('toWire renames owner_name → owner and turns shared into a boolean', () => {
  assert.deepEqual(toWire(row()), {
    id: 'library',
    push_source: 'library',
    kind: 'books',
    label: "Skylar's library",
    owner: 'Skylar',
    holding: 'physical',
    shared: false,
    host: 'library.heygabi.ai',
  });
  assert.equal(toWire(row({ shared: 1, owner_name: null })).shared, true);
  assert.equal(toWire(row({ shared: 1, owner_name: null })).owner, null);
});

test('🔴 the wire carries NOTHING derived from a row on anybody’s shelf', () => {
  // Owner, 2026-09-05 16:14: "yes name only". The registry publishes that a
  // shelf EXISTS and whose it is — never what is on it. This asserts the shape
  // exhaustively, so a field added to the table cannot reach the wire by
  // accident.
  assert.deepEqual(Object.keys(toWire(row())).sort(), [
    'holding',
    'host',
    'id',
    'kind',
    'label',
    'owner',
    'push_source',
    'shared',
  ]);
  for (const forbidden of ['rows', 'pushed_at', 'count', 'titles', 'created_at', 'request_id', 'sort_order']) {
    assert.ok(!(forbidden in toWire(row())), `${forbidden} must never be on the registry wire`);
  }
});

// ---------------------------------------------------------------------------
// The route — an app-token door, and no new secret
// ---------------------------------------------------------------------------

test('GET /estate/catalogs answers the five, in order, to the index Worker’s own token', async () => {
  const res = await get(seeded(), APP_TOKEN);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; count: number; catalogs: { id: string }[]; source: string };
  assert.equal(body.ok, true);
  assert.equal(body.count, 5);
  assert.equal(body.source, 'estate-auth');
  // ⚠️ RENDER ORDER IS THE REGISTRY'S, not the array's insertion order and not
  // alphabetical: sort_order, then id.
  assert.deepEqual(
    body.catalogs.map((c) => c.id),
    ['audiobook', 'library', 'games', 'library2', 'ebooks'],
  );
});

test('⚠️ a token this Worker does not know is a WORDED 401 that names no app', async () => {
  const res = await get(seeded(), 'not-the-token');
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string; detail: string };
  assert.equal(body.error, 'unauthorized');
  // A person must never see a bare status: it says what happened, and where a
  // person (as opposed to a Worker) reads the registry instead.
  assert.match(body.detail, /index\.heygabi\.ai\/api\/catalogs/);
  // ⚠️ AND IT LISTS NOTHING. A refusal is a fact about the value presented,
  // never a listing of what would have worked.
  assert.ok(!/ESTATE_APP_TOKEN_LIBRARY\b/.test(body.detail));
});

test('⚠️ NO token configured is a 503 config error, not a 401 — the two must never wear the same clothes', async () => {
  const res = await get(seeded(), APP_TOKEN, { ESTATE_APP_TOKEN_INDEX: undefined });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: string; fix: string };
  assert.equal(body.error, 'app_tokens_unset');
  assert.match(body.fix, /ESTATE_APP_TOKEN_INDEX/);
});

test('no bearer at all is a 401, never an anonymous listing', async () => {
  const res = await get(seeded(), null);
  assert.equal(res.status, 401);
});

test('🔴 a Worker ahead of its migration says so, with the command that fixes it', async () => {
  const db = seeded();
  db.missingTable = true;
  const res = await get(db, APP_TOKEN);
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: string; detail: string; fix: string };
  assert.equal(body.error, REGISTRY_TABLE_MISSING.error);
  assert.match(body.fix, /0020_estate_catalog\.sql/);
  // ⚠️ AND IT DOES NOT ANSWER AN EMPTY LIST. "The migration is not applied" and
  // "the estate has no catalogs" are different facts, and the second is a
  // confident false statement of exactly the kind the owner's rule is about.
  assert.ok(!('catalogs' in body));
});

test('⚠️ an unreadable database is a 502 that says it is an outage, not a permissions problem', async () => {
  const db = new FakeDB();
  db.prepare = () => {
    throw new Error('D1_ERROR: something else entirely');
  };
  const res = await get(db, APP_TOKEN);
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string; detail: string };
  assert.equal(body.error, 'registry_unreadable');
  assert.match(body.detail, /outage, not a permissions problem/);
  assert.match(body.detail, /not a statement that no catalogs exist/);
});

test('registryTableMissing recognises D1’s own wording and nothing else', () => {
  assert.ok(registryTableMissing(new Error('D1_ERROR: no such table: estate_catalog')));
  assert.ok(!registryTableMissing(new Error('D1_ERROR: database is locked')));
  assert.ok(!registryTableMissing(undefined));
});

// ---------------------------------------------------------------------------
// The provisioner's write
// ---------------------------------------------------------------------------

test('insertCatalog writes a row and says what it did', async () => {
  const db = new FakeDB();
  const res = await insertCatalog(db as unknown as D1Database, {
    id: 'library3',
    push_source: 'library3',
    kind: 'books',
    label: "Amber's library",
    owner_name: 'Amber',
    holding: 'physical',
    shared: false,
    host: 'amber.heygabi.ai',
    request_id: 7,
  });
  assert.equal(res.written, true);
  assert.equal((await listCatalogs(db as unknown as D1Database)).length, 1);
  // ⚠️ IT SAYS WHAT IT DID NOT DO. Publishing a name is not granting access, and
  // the answer refuses to let the two be confused.
  assert.match(res.detail, /vis_library3/);
});

test('🔴 insertCatalog NEVER THROWS — a failure is a worded answer, because /live already landed', async () => {
  const db = new FakeDB();
  db.failInsert = true;
  const res = await insertCatalog(db as unknown as D1Database, {
    id: 'library3',
    push_source: 'library3',
    kind: 'books',
    label: "Amber's library",
    owner_name: 'Amber',
    holding: 'physical',
    shared: false,
    host: 'amber.heygabi.ai',
    request_id: 7,
  });
  assert.equal(res.written, false);
  assert.equal(res.written === false ? res.reason : null, 'failed');
  assert.match(res.detail, /marked live/);
});

test('listCatalogs orders by sort_order then id, so a provisioned catalog lands last', async () => {
  const db = seeded();
  await insertCatalog(db as unknown as D1Database, {
    id: 'library3',
    push_source: 'library3',
    kind: 'books',
    label: "Amber's library",
    owner_name: 'Amber',
    holding: 'physical',
    shared: false,
    host: 'amber.heygabi.ai',
    request_id: 7,
  });
  const ids = (await listCatalogs(db as unknown as D1Database)).map((r) => r.id);
  assert.deepEqual(ids, ['audiobook', 'library', 'games', 'library2', 'ebooks', 'library3']);
});
