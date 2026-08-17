/**
 * The series registry — the owner's "I don't want duplicate series", pinned.
 *
 * Two halves, matching the build: the RESOLVER is pure and tested as such
 * (planSeries against maps, no database), and the ROUTES are exercised through
 * the REAL exported app — mounting order included, since "members-only, not
 * the anonymous carve-out" is a fact about where /api/series is mounted, and a
 * reconstruction of the app could not fail on it.
 *
 * The fake D1 honours exactly the SQL these paths issue, including
 * `WHERE source IN (…)` — the SQL IS the scope, and a fake that ignored it
 * would test nothing (scope.test.ts's own rule, applied again).
 *
 * ⚠️ Every test here fails on a BEHAVIOUR: a near miss silently merging, a
 * decision being re-asked, a private catalog's series names reaching someone
 * scoped out of it. None of them assert an implementation detail.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * ⚠️ `crypto.subtle.timingSafeEqual` is a WORKERS extension and does not exist
 * in Node, so push.ts's bearer check throws here and the push route has never
 * been exercisable by this suite. A plain byte comparison stands in — it is
 * scaffolding to reach the code under test, NOT a claim about the real check's
 * timing behaviour, which only the runtime can provide. (ESM hoists the
 * imports above this, which is harmless: push.ts reads `crypto.subtle` when a
 * request arrives, not when it loads.)
 */
if (typeof (crypto.subtle as { timingSafeEqual?: unknown }).timingSafeEqual !== 'function') {
  (crypto.subtle as unknown as { timingSafeEqual: (a: ArrayBufferView, b: ArrayBufferView) => boolean }).timingSafeEqual =
    (a: ArrayBufferView, b: ArrayBufferView) => {
      const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      return x.length === y.length && x.every((v, i) => v === y[i]);
    };
}

import { app } from '../src/index.js';
import { buildCanonIndex, seriesCanonIndex } from '../src/series-canon-data.js';
import { emptyRegistry, planSeries, seriesFoldOrNull, seriesNearKey, slugForFold } from '../src/series.js';
import { slugFoldRoundTrips } from '../src/series-route.js';

// ---------------------------------------------------------------------------
// 1. The resolver, pure.
// ---------------------------------------------------------------------------

const NO_CANON = new Map<string, string>();

function rows(...specs: [source: string, title: string, series: string | null][]) {
  return specs.map(([source, title, series]) => ({ source, title, series }));
}

test('EXACT fold equality merges: the owner\'s own example is one series, not two', () => {
  const plan = planSeries(
    emptyRegistry(),
    rows(
      ['audiobook', 'Words of Radiance', 'The Stormlight Archive'],
      ['library', 'Words of Radiance', 'Stormlight Archive'],
    ),
    NO_CANON,
  );

  const audio = plan.resolutions.get('The Stormlight Archive');
  const print = plan.resolutions.get('Stormlight Archive');
  assert.equal(audio?.slug, 'stormlight-archive');
  assert.equal(print?.slug, 'stormlight-archive');
  assert.equal(audio?.display, print?.display, 'both spellings must end up displaying the SAME string');
  assert.equal(plan.newSeries.length, 1, 'one registry entry, not two');
  assert.equal(plan.newPending.length, 0, 'an exact fold match is not a question for a human');
  assert.equal(plan.mergedSpellings, 1);
});

test('a NEAR miss is registered separately and QUEUED — never merged', () => {
  const plan = planSeries(
    emptyRegistry(),
    rows(
      ['audiobook', 'Going Home', 'The Survivalist'],
      ['audiobook', 'Surviving Home', 'The Survivalist Series'],
    ),
    NO_CANON,
  );

  const plain = plan.resolutions.get('The Survivalist');
  const decorated = plan.resolutions.get('The Survivalist Series');
  assert.notEqual(plain?.slug, decorated?.slug, 'near is NOT merged — that is the whole confirm-first rule');
  assert.equal(plan.newSeries.length, 2, 'both exist in their own right while the question is open');
  assert.equal(plan.newPending.length, 1);
  assert.equal(plan.newPending[0]?.candidate_fold, 'survivalist series');
  assert.equal(plan.newPending[0]?.closest_slug, 'survivalist');
  assert.deepEqual(plan.newPending[0]?.sample_titles, [{ source: 'audiobook', title: 'Surviving Home' }],
    'a queue row a human cannot decide from is a queue row nobody resolves');
});

test('a decision already taken is NEVER re-queued — "keep separate" is sticky across pushes', () => {
  const registry = emptyRegistry();
  registry.series.set('survivalist', { slug: 'survivalist', display_name: 'The Survivalist' });
  // The row stays in series_pending after resolution; loadRegistry feeds every
  // candidate_fold back here, resolved or not.
  const queued = new Set(['survivalist series']);
  const plan = planSeries(
    { ...registry, queued },
    rows(['audiobook', 'Surviving Home', 'The Survivalist Series']),
    NO_CANON,
  );
  assert.equal(plan.newPending.length, 0, 'a queue that re-asks an answered question is a queue nobody reads');
  assert.equal(plan.resolutions.get('The Survivalist Series')?.slug, 'survivalist-series');
});

test('a human alias overrules the fold: the absorbed spelling resolves to the surviving slug', () => {
  const registry = emptyRegistry();
  registry.series.set('survivalist', { slug: 'survivalist', display_name: 'The Survivalist' });
  registry.aliases.set('survivalist series', 'survivalist');

  const plan = planSeries(registry, rows(['audiobook', 'Surviving Home', 'The Survivalist Series']), NO_CANON);
  const resolved = plan.resolutions.get('The Survivalist Series');
  assert.equal(resolved?.slug, 'survivalist');
  assert.equal(resolved?.display, 'The Survivalist', 'the row displays the surviving spelling');
  assert.equal(plan.newSeries.length, 0, 'no ghost slug is created for an already-merged spelling');
});

test('the estate canon merges what a human already decided, with its provenance kept', () => {
  const plan = planSeries(
    emptyRegistry(),
    rows(
      ['library', 'Ascend Online', 'Ascend Online'],
      ['audiobook', 'Ascend Online', 'Ascend Online [publication order]'],
    ),
    seriesCanonIndex,
  );

  assert.equal(plan.resolutions.get('Ascend Online')?.slug, 'ascend-online');
  assert.equal(plan.resolutions.get('Ascend Online [publication order]')?.slug, 'ascend-online');
  assert.equal(plan.newPending.length, 0, 'the canon answered it; the queue must not ask again');
  assert.deepEqual(
    plan.newAliases.map((a) => [a.alias_fold, a.slug, a.decided_how]),
    [['ascend online publication order', 'ascend-online', 'canon']],
  );
});

test('the canon index drops folds the registry already merges on its own', () => {
  // "The Fae & Alchemy Series" -> "Fae & Alchemy" is a REAL canon fold (their
  // folds differ). A self-fold — one whose variant folds identically to its
  // canonical — would be a second mechanism for a match needing none.
  const index = buildCanonIndex({
    entries: [{ canonical: 'Stormlight Archive', variants: ['The Stormlight Archive', 'Stormlight Archive'] }],
  });
  assert.equal(index.size, 0, 'both variants fold to the canonical already');
  assert.ok(seriesCanonIndex.get('fae and alchemy series'), 'the real canon entry that does NOT self-fold is kept');
});

test('an unfoldable series name is refused, not registered under an empty key', () => {
  const plan = planSeries(emptyRegistry(), rows(['audiobook', '하츄핑 이야기', '하츄핑 마음 동화']), NO_CANON);
  assert.equal(plan.resolutions.get('하츄핑 마음 동화'), null);
  assert.equal(plan.newSeries.length, 0, 'an empty fold would make every such series the same series');
  assert.equal(plan.unfoldable, 1);
  assert.equal(seriesFoldOrNull('하츄핑 마음 동화'), null);
});

test('planning is DETERMINISTIC: the canonical display does not depend on snapshot order', () => {
  const forward = planSeries(
    emptyRegistry(),
    rows(['audiobook', 'A', 'The Stormlight Archive'], ['library', 'B', 'Stormlight Archive']),
    NO_CANON,
  );
  const backward = planSeries(
    emptyRegistry(),
    rows(['library', 'B', 'Stormlight Archive'], ['audiobook', 'A', 'The Stormlight Archive']),
    NO_CANON,
  );
  assert.equal(forward.newSeries[0]?.display_name, backward.newSeries[0]?.display_name,
    'first-writer-wins must mean something reproducible, or the backfill and the push disagree');
});

test('the near key is DISCOVERY only: it groups decorations, and never equals a merge', () => {
  assert.equal(seriesNearKey('Harry Potter (Full-Cast Editions)'), seriesNearKey('Harry Potter'));
  assert.equal(seriesNearKey('The Fae & Alchemy Series'), seriesNearKey('Fae & Alchemy'));
  assert.notEqual(seriesNearKey('Mistborn'), seriesNearKey('Skyward'));
});

test('slug and fold round-trip — the merge endpoint keys an alias on that bijection', () => {
  for (const fold of ['stormlight archive', 'fae and alchemy', 'survivalist series', 'dungeon crawler carl']) {
    assert.ok(slugFoldRoundTrips(fold), fold);
  }
  assert.equal(slugForFold('stormlight archive'), 'stormlight-archive');
});

// ---------------------------------------------------------------------------
// 2. A fake D1 that honours the SQL these routes actually issue.
// ---------------------------------------------------------------------------

interface EntryRecord {
  [column: string]: string | number | null;
}

interface PendingRecord {
  candidate_fold: string;
  candidate_display: string;
  candidate_slug: string;
  closest_slug: string;
  closest_display: string;
  near_key: string;
  sample_titles: string;
  sources: string;
  created_at: string;
  resolved_at: string | null;
  resolved_as: string | null;
  resolved_by: string | null;
}

class FakeDB {
  entries: EntryRecord[] = [];
  series = new Map<string, { slug: string; display_name: string; first_source: string }>();
  aliases = new Map<string, { alias_fold: string; slug: string; alias_display: string; decided_how: string }>();
  pending = new Map<string, PendingRecord>();
  cache = new Map<string, { status: string; checked_at: string; visibility: string | null }>();

  prepare(sql: string) {
    const self = this;
    const make = (args: unknown[]) => ({
      async first() {
        return self.first(sql, args);
      },
      async all() {
        return { results: self.select(sql, args) };
      },
      async run() {
        return self.run(sql, args);
      },
    });
    return { bind: (...args: unknown[]) => make(args), ...make([]) };
  }

  async batch(statements: { run(): Promise<unknown> }[]) {
    const out = [];
    for (const s of statements) out.push(await s.run());
    return out as never;
  }

  private first(sql: string, args: unknown[]): unknown {
    if (sql.includes('FROM estate_cache')) return this.cache.get(String(args[0])) ?? null;
    if (sql.includes('FROM series_pending WHERE candidate_fold')) return this.pending.get(String(args[0])) ?? null;
    if (sql.includes('FROM series WHERE slug')) return this.series.get(String(args[0])) ?? null;
    return null;
  }

  private select(sql: string, args: unknown[]): unknown[] {
    if (sql.startsWith('SELECT slug, display_name FROM series')) return [...this.series.values()];
    if (sql.startsWith('SELECT alias_fold, slug FROM series_alias')) return [...this.aliases.values()];
    if (sql.startsWith('SELECT candidate_fold FROM series_pending')) return [...this.pending.values()];
    if (sql.includes('FROM series_pending')) {
      const all = [...this.pending.values()];
      return sql.includes('resolved_at IS NULL') ? all.filter((p) => p.resolved_at === null) : all;
    }
    if (sql.includes('FROM entry')) {
      let rowsOut = this.entries;
      let scopeArgs = args;
      if (sql.includes('WHERE series_slug = ?')) {
        rowsOut = rowsOut.filter((r) => r.series_slug === String(args[0]));
        scopeArgs = args.slice(1);
      } else if (sql.includes('series_slug IS NOT NULL')) {
        rowsOut = rowsOut.filter((r) => r.series_slug !== null && r.series_slug !== undefined);
      }
      if (sql.includes('source IN')) {
        const sources = scopeArgs.map(String);
        rowsOut = rowsOut.filter((r) => sources.includes(String(r.source)));
      }
      return rowsOut;
    }
    return [];
  }

  private run(sql: string, args: unknown[]): { success: true; meta: { changes: number } } {
    let changes = 0;
    if (sql.startsWith('INSERT OR IGNORE INTO series (')) {
      const [slug, display_name, first_source] = args as string[];
      if (slug && !this.series.has(slug)) {
        this.series.set(slug, { slug, display_name: display_name ?? '', first_source: first_source ?? '' });
        changes = 1;
      }
    } else if (sql.includes('INTO series_alias')) {
      const [alias_fold, slug, alias_display, decided_how] = args as string[];
      const replace = sql.startsWith('INSERT OR REPLACE');
      if (alias_fold && (replace || !this.aliases.has(alias_fold))) {
        this.aliases.set(alias_fold, {
          alias_fold,
          slug: slug ?? '',
          alias_display: alias_display ?? '',
          decided_how: decided_how ?? 'human',
        });
        changes = 1;
      }
    } else if (sql.startsWith('INSERT OR IGNORE INTO series_pending')) {
      const [candidate_fold, candidate_display, candidate_slug, closest_slug, closest_display, near_key, sample_titles, sources, created_at] =
        args as string[];
      if (candidate_fold && !this.pending.has(candidate_fold)) {
        this.pending.set(candidate_fold, {
          candidate_fold,
          candidate_display: candidate_display ?? '',
          candidate_slug: candidate_slug ?? '',
          closest_slug: closest_slug ?? '',
          closest_display: closest_display ?? '',
          near_key: near_key ?? '',
          sample_titles: sample_titles ?? '[]',
          sources: sources ?? '[]',
          created_at: created_at ?? '',
          resolved_at: null,
          resolved_as: null,
          resolved_by: null,
        });
        changes = 1;
      }
    } else if (sql.startsWith('UPDATE series_alias SET slug')) {
      const [to, from] = args as string[];
      for (const alias of this.aliases.values()) {
        if (alias.slug === from) {
          alias.slug = to ?? alias.slug;
          changes += 1;
        }
      }
    } else if (sql.startsWith('UPDATE entry SET series_slug')) {
      const [slug, display, from] = args as string[];
      for (const row of this.entries) {
        if (row.series_slug === from) {
          row.series_slug = slug ?? null;
          row.series = display ?? null;
          changes += 1;
        }
      }
    } else if (sql.startsWith('DELETE FROM series WHERE slug')) {
      changes = this.series.delete(String(args[0])) ? 1 : 0;
    } else if (sql.startsWith('UPDATE series_pending SET resolved_at')) {
      const [resolved_at, resolved_by, fold] = args as string[];
      const row = this.pending.get(String(fold));
      if (row) {
        row.resolved_at = resolved_at ?? null;
        row.resolved_by = resolved_by ?? null;
        row.resolved_as = sql.includes("'merged'") ? 'merged' : 'separate';
        changes = 1;
      }
    } else if (sql.startsWith('DELETE FROM entry WHERE source')) {
      const before = this.entries.length;
      this.entries = this.entries.filter((r) => r.source !== String(args[0]));
      changes = before - this.entries.length;
    } else if (sql.startsWith('INSERT INTO entry')) {
      // Column order read from the statement itself, so the fake cannot drift
      // from the real INSERT the way a hardcoded list would.
      const columns = (sql.match(/INSERT INTO entry \(([\s\S]*?)\)\s*VALUES/) ?? [])[1]
        ?.split(',')
        .map((c) => c.trim()) ?? [];
      const record: EntryRecord = {};
      columns.forEach((col, i) => {
        record[col] = (args[i] ?? null) as string | number | null;
      });
      this.entries.push(record);
      changes = 1;
    } else if (sql.includes('INSERT INTO estate_cache')) {
      const [email, , status, checkedAt, visibility] = args as string[];
      this.cache.set(String(email), {
        status: status ?? 'approved',
        checked_at: checkedAt ?? '',
        visibility: visibility ?? null,
      });
      changes = 1;
    }
    return { success: true, meta: { changes } };
  }
}

// --- Env + estate stub, same shapes scope.test.ts uses. ---------------------

const OWNER = 'owner@example.com';

function prodEnv(db: FakeDB, over: Record<string, unknown> = {}) {
  return {
    DB: db as unknown as D1Database,
    ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: OWNER,
    ESTATE_AUTH_URL: 'https://auth.test',
    ESTATE_APP_TOKEN_INDEX: 'test-index-token',
    INDEX_PUSH_TOKEN_AUDIOBOOK: 'audio-token',
    INDEX_PUSH_TOKEN_LIBRARY: 'library-token',
    ...over,
  };
}

function memberEnv(db: FakeDB, email: string, over: Record<string, unknown> = {}) {
  return prodEnv(db, { ENVIRONMENT: 'development', DEV_EMAIL: email, ...over });
}

function stubSeen(answer: { status: string; visibility?: unknown }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  return { restore: () => void (globalThis.fetch = original) };
}

async function push(env: Record<string, unknown>, source: string, token: string, body: unknown) {
  return app.request(
    `/api/push/${source}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

const book = (title: string, series: string, over: Record<string, unknown> = {}) => ({
  source_id: title.toLowerCase().replace(/\W+/g, '-'),
  title,
  creator: 'Brandon Sanderson',
  series,
  format: 'audiobook',
  ...over,
});

// ---------------------------------------------------------------------------
// 3. Push-time resolution, through the real route.
// ---------------------------------------------------------------------------

test('two catalogs, two spellings, ONE series: the second push adopts the first\'s display', async () => {
  const db = new FakeDB();
  const env = prodEnv(db);

  const first = await push(env, 'audiobook', 'audio-token', [book('Words of Radiance', 'The Stormlight Archive')]);
  assert.equal(first.status, 200);

  const second = await push(env, 'library', 'library-token', [
    book('Words of Radiance', 'Stormlight Archive', { format: 'book' }),
  ]);
  assert.equal(second.status, 200);
  const body = (await second.json()) as any;
  assert.equal(body.series.registered, 0, 'the library push created no second series');
  assert.equal(body.series.merged_spellings, 1);

  const slugs = new Set(db.entries.map((e) => e.series_slug));
  assert.deepEqual([...slugs], ['stormlight-archive']);
  const displays = new Set(db.entries.map((e) => e.series));
  assert.deepEqual([...displays], ['The Stormlight Archive'],
    'the library row was REWRITTEN to the canonical spelling — that is what a non-slug-aware consumer sees');
});

test('a push whose series is a near miss lands a queue row and does NOT merge', async () => {
  const db = new FakeDB();
  const env = prodEnv(db);

  await push(env, 'audiobook', 'audio-token', [book('Going Home', 'The Survivalist')]);
  const res = await push(env, 'audiobook', 'audio-token', [
    book('Going Home', 'The Survivalist'),
    book('Surviving Home', 'The Survivalist Series'),
  ]);
  const body = (await res.json()) as any;

  assert.equal(body.series.pending_added, 1);
  assert.equal(db.pending.size, 1);
  const queued = [...db.pending.values()][0];
  assert.equal(queued?.candidate_slug, 'survivalist-series');
  assert.equal(queued?.closest_slug, 'survivalist');
  assert.equal(new Set(db.entries.map((e) => e.series_slug)).size, 2, 'still two series while the question is open');
});

test('an unfoldable series survives the push with its spelling and NO key', async () => {
  const db = new FakeDB();
  const res = await push(prodEnv(db), 'audiobook', 'audio-token', [
    { source_id: 'k1', title: '하츄핑 이야기', series: '하츄핑 마음 동화', format: 'audiobook' },
  ]);
  assert.equal(res.status, 200);
  assert.equal(db.entries[0]?.series, '하츄핑 마음 동화', 'the display is never destroyed');
  assert.equal(db.entries[0]?.series_slug, null, 'and it joins no registry entry');
});

// ---------------------------------------------------------------------------
// 4. The read surface — scoping, and the leak it must not have.
// ---------------------------------------------------------------------------

async function seedTwoCatalogs(db: FakeDB) {
  const env = prodEnv(db);
  await push(env, 'audiobook', 'audio-token', [
    book('Words of Radiance', 'The Stormlight Archive'),
    book('Oathbringer', 'The Stormlight Archive'),
  ]);
  await push(env, 'library', 'library-token', [
    book('Words of Radiance', 'Stormlight Archive', { format: 'book' }),
    book('The Hidden Almanac', 'A Private Shelf', { format: 'book' }),
  ]);
}

test('GET /api/series is SCOPED: a series only the library holds is invisible to an audiobook-only member', async () => {
  const db = new FakeDB();
  await seedTwoCatalogs(db);

  const f = stubSeen({ status: 'approved', visibility: ['audiobook'] });
  try {
    const res = await app.request('/api/series', {}, memberEnv(db, 'listener@example.com'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.deepEqual(body.series.map((s: any) => s.slug), ['stormlight-archive']);
    assert.deepEqual(body.series[0].sources, { audiobook: 2 }, 'the library copy is not counted either');
    assert.ok(
      !JSON.stringify(body).includes('A Private Shelf'),
      'listing the registry table instead of scoped rows would leak a private catalog\'s series NAMES',
    );
  } finally {
    f.restore();
  }
});

test('GET /api/series counts per source for a member who can see both shelves', async () => {
  const db = new FakeDB();
  await seedTwoCatalogs(db);

  const f = stubSeen({ status: 'approved', visibility: ['audiobook', 'library'] });
  try {
    const res = await app.request('/api/series', {}, memberEnv(db, 'member@example.com'));
    const body = (await res.json()) as any;
    const stormlight = body.series.find((s: any) => s.slug === 'stormlight-archive');
    assert.deepEqual(stormlight.sources, { audiobook: 2, library: 1 });
    assert.equal(stormlight.total, 3);
    assert.equal(stormlight.display_name, 'The Stormlight Archive');
  } finally {
    f.restore();
  }
});

test('GET /api/series is MEMBERS-ONLY: anonymous gets 401, unlike /api/search', async () => {
  const res = await app.request('/api/series', {}, prodEnv(new FakeDB()));
  assert.equal(res.status, 401, '§4.5\'s anonymous carve-out is search-only');
});

test('GET /api/series/:slug groups by medium and carries what a series page renders', async () => {
  const db = new FakeDB();
  await seedTwoCatalogs(db);

  const f = stubSeen({ status: 'approved', visibility: ['audiobook', 'library'] });
  try {
    const res = await app.request('/api/series/stormlight-archive', {}, memberEnv(db, 'member@example.com'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.deepEqual(body.media.map((m: any) => m.medium), ['audiobook', 'book']);
    const entry = body.media[0].entries[0];
    for (const field of ['source', 'title', 'series_index', 'cover_url', 'detail_url']) {
      assert.ok(field in entry, `the series page needs ${field}`);
    }
  } finally {
    f.restore();
  }
});

test('GET /api/series/:slug cannot confirm a series exists in a catalog you cannot see', async () => {
  const db = new FakeDB();
  await seedTwoCatalogs(db);

  const f = stubSeen({ status: 'approved', visibility: ['audiobook'] });
  try {
    const res = await app.request('/api/series/private-shelf', {}, memberEnv(db, 'listener@example.com'));
    assert.equal(res.status, 404, 'a 200-with-empty would confirm the slug is real');
    const body = (await res.json()) as any;
    assert.equal(body.error, 'unknown_series');
    assert.ok(!JSON.stringify(body).includes('A Private Shelf'));
  } finally {
    f.restore();
  }
});

// ---------------------------------------------------------------------------
// 5. The confirm queue.
// ---------------------------------------------------------------------------

async function seedNearMiss(db: FakeDB) {
  const env = prodEnv(db);
  await push(env, 'audiobook', 'audio-token', [
    book('Going Home', 'The Survivalist'),
    book('Surviving Home', 'The Survivalist Series'),
  ]);
}

test('the confirm queue is approver-gated, and the refusal says what it needs', async () => {
  const db = new FakeDB();
  await seedNearMiss(db);

  const f = stubSeen({ status: 'approved', visibility: ['audiobook'] });
  try {
    const res = await app.request('/api/series/pending', {}, memberEnv(db, 'member@example.com'));
    assert.equal(res.status, 403);
    const body = (await res.json()) as any;
    assert.equal(body.error, 'approver_only');
    assert.ok(body.needs && body.how, 'a refusal owes a person what it needs and how to get it, never a bare 403');
  } finally {
    f.restore();
  }

  const owner = await app.request('/api/series/pending', {}, memberEnv(db, OWNER));
  assert.equal(owner.status, 200);
  const body = (await owner.json()) as any;
  assert.equal(body.open, 1);
  assert.deepEqual(body.pending[0].sources, ['audiobook'], 'JSON columns come back parsed');
});

test('resolving MERGE repoints every row and makes the merge stick on the next push', async () => {
  const db = new FakeDB();
  await seedNearMiss(db);

  const res = await app.request(
    '/api/series/pending/survivalist%20series',
    { method: 'POST', body: JSON.stringify({ action: 'merge', into: 'survivalist' }) },
    memberEnv(db, OWNER),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.rows_repointed, 1);
  assert.equal(db.series.has('survivalist-series'), false, 'the absorbed slug is gone, not left as a ghost');
  assert.deepEqual([...new Set(db.entries.map((e) => e.series_slug))], ['survivalist']);

  // The point of the alias: the SOURCE keeps pushing its own spelling forever.
  await push(prodEnv(db), 'audiobook', 'audio-token', [
    book('Going Home', 'The Survivalist'),
    book('Surviving Home', 'The Survivalist Series'),
  ]);
  assert.deepEqual([...new Set(db.entries.map((e) => e.series_slug))], ['survivalist'],
    'a resolved merge must survive the next snapshot replace, or the human decided nothing');
  assert.deepEqual([...new Set(db.entries.map((e) => e.series))], ['The Survivalist']);
});

test('resolving SEPARATE moves nothing, and the queue never asks again', async () => {
  const db = new FakeDB();
  await seedNearMiss(db);

  const res = await app.request(
    '/api/series/pending/survivalist%20series',
    { method: 'POST', body: JSON.stringify({ action: 'separate' }) },
    memberEnv(db, OWNER),
  );
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).rows_repointed, 0);
  assert.equal(new Set(db.entries.map((e) => e.series_slug)).size, 2, 'both series stay');

  await push(prodEnv(db), 'audiobook', 'audio-token', [
    book('Going Home', 'The Survivalist'),
    book('Surviving Home', 'The Survivalist Series'),
  ]);
  const open = [...db.pending.values()].filter((p) => p.resolved_at === null);
  assert.equal(open.length, 0, 'the answered question must not come back');

  const second = await app.request(
    '/api/series/pending/survivalist%20series',
    { method: 'POST', body: JSON.stringify({ action: 'merge', into: 'survivalist' }) },
    memberEnv(db, OWNER),
  );
  assert.equal(second.status, 409, 'a decided row is not silently re-decidable');
});

test('a merge into an unrelated slug is refused with the two real choices', async () => {
  const db = new FakeDB();
  await seedNearMiss(db);
  const res = await app.request(
    '/api/series/pending/survivalist%20series',
    { method: 'POST', body: JSON.stringify({ action: 'merge', into: 'stormlight-archive' }) },
    memberEnv(db, OWNER),
  );
  assert.equal(res.status, 422);
  const body = (await res.json()) as any;
  assert.deepEqual(body.choices.sort(), ['survivalist', 'survivalist-series']);
});
