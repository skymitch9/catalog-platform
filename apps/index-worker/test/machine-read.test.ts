/**
 * The MACHINE READ surface (`/api/machine/*`, machine-route.ts) — exercised
 * through the REAL exported app, so MOUNTING ORDER is under test rather than
 * assumed: the machine routes must be reachable with no Firebase token at all,
 * and the human routes must still be blanketed in the same app object.
 *
 * ⚠️ Every test here uses `ENVIRONMENT: 'production'` and NO dev-bypass
 * identity, and stubs global fetch to 'unreachable'. That is the whole point:
 * if any of these requests were resolving a human identity or calling /seen,
 * these tests would fail rather than quietly pass on a member's credentials.
 *
 * The D1 fake honours the scope clause the search route issues, for the same
 * reason scope.test.ts's does — the SQL IS the scope, and a fake that ignored
 * it would prove nothing about what a machine caller can reach.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from '../src/index.js';
import { MACHINE_APPS, readTokenFor, readTokenNameFor } from '../src/env.js';
import { MACHINE_VISIBILITY } from '../src/machine-route.js';
import type { SearchRow } from '../src/search.js';

// --- Fake D1: honours WHERE title_fold / source IN / the ebook clause. ------

class FakeDB {
  constructor(private rows: SearchRow[] = []) {}

  prepare(sql: string) {
    const self = this;
    const make = (args: unknown[]) => ({
      async first() {
        return null;
      },
      async run() {
        return { success: true };
      },
      async all() {
        if (!sql.includes('FROM entry')) return { results: [] };
        let rows = self.rows;
        let scopeArgs = args;
        if (sql.includes('WHERE title_fold = ?')) {
          rows = rows.filter((r) => r.title_fold === String(args[0]));
          scopeArgs = args.slice(1);
        }
        if (sql.includes('source IN')) {
          let sources = scopeArgs.map(String);
          let excludeFormat: string | null = null;
          if (sql.includes('format != ?')) {
            excludeFormat = String(sources[sources.length - 1]);
            sources = sources.slice(0, -1);
          }
          rows = rows.filter((r) => sources.includes(r.source));
          if (excludeFormat !== null) rows = rows.filter((r) => r.format !== excludeFormat);
        }
        return { results: rows };
      },
    });
    return { bind: (...args: unknown[]) => make(args), ...make([]) };
  }

  async batch() {
    return [];
  }
}

let seq = 0;
function row(over: Partial<SearchRow> & { title: string }): SearchRow {
  seq += 1;
  const fold = over.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an)\s+/, '')
    .trim();
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
  } as SearchRow;
}

/** One title on every shelf the estate has, so a scope decision is visible. */
function estateRows(): SearchRow[] {
  return [
    row({ title: 'Mistborn', source: 'library', format: 'hardcover' }),
    row({ title: 'Mistborn', source: 'audiobook', format: 'audiobook' }),
    row({ title: 'Mistborn', source: 'game', format: 'boardgame', kind: 'base' }),
    // The gated ebook shelf rides the audiobook source with format 'ebook'.
    row({ title: 'Mistborn', source: 'audiobook', format: 'ebook' }),
    // The friend instance's shelf — no rows exist live today, but if one ever
    // does, a machine caller must not see it.
    row({ title: 'Mistborn', source: 'library2', format: 'hardcover' }),
  ];
}

const READ_TOKEN = 'machine-read-token-for-tests';
/**
 * padhard's own value. ⚠️ Deliberately a DIFFERENT string from `READ_TOKEN`:
 * the app is resolved from the value, so two apps sharing one value would make
 * the whole identification meaningless — and a test that used one value for
 * both would pass while proving nothing.
 */
const FRIEND_TOKEN = 'machine-read-token-for-padhard-tests';

/**
 * Production env with NO dev-bypass identity — a machine caller is
 * deliberately unable to become a person here.
 */
function machineEnv(db: FakeDB, over: Record<string, unknown> = {}) {
  return {
    DB: db as unknown as D1Database,
    ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: 'owner@example.com',
    ESTATE_AUTH_URL: 'https://auth.test',
    ESTATE_APP_TOKEN_INDEX: 'test-index-token',
    INDEX_READ_TOKEN_LIBRARY: READ_TOKEN,
    ...over,
  };
}

/** Global fetch must never be called on this surface — prove it, don't hope. */
function forbidFetch() {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  return { count: () => calls, restore: () => void (globalThis.fetch = original) };
}

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

// --- Mount order: reachable with no Firebase token; humans still blanketed. -

test('MOUNT ORDER: /api/machine/lookup is reachable with NO Firebase token (above the blanket)', async () => {
  const f = forbidFetch();
  try {
    const res = await app.request(
      '/api/machine/lookup?title=Mistborn',
      bearer(READ_TOKEN),
      machineEnv(new FakeDB(estateRows())),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.title_fold, 'mistborn');
    assert.ok(Array.isArray(body.matches));
    // Not one /seen call, and no identity resolution: this route never touches
    // the estate directory, so an estate outage cannot take it down.
    assert.equal(f.count(), 0, 'the machine route made no estate call');
  } finally {
    f.restore();
  }
});

test('MOUNT ORDER: /api/machine/search is reachable with NO Firebase token', async () => {
  const f = forbidFetch();
  try {
    const res = await app.request(
      '/api/machine/search?q=Mistborn',
      bearer(READ_TOKEN),
      machineEnv(new FakeDB(estateRows())),
    );
    assert.equal(res.status, 200);
    assert.equal(f.count(), 0);
  } finally {
    f.restore();
  }
});

test('MOUNT ORDER: the HUMAN routes are still blanketed — a machine token does NOT open /api/lookup', async () => {
  const f = forbidFetch();
  try {
    // The read token is a perfectly good credential one route up and means
    // nothing here: /api/lookup wants a Firebase ID token and says so.
    const res = await app.request('/api/lookup?title=Mistborn', bearer(READ_TOKEN), machineEnv(new FakeDB(estateRows())));
    assert.equal(res.status, 401);
    assert.equal((await res.json() as any).error, 'unauthenticated');
  } finally {
    f.restore();
  }
});

test('MOUNT ORDER: tokenless /api/lookup and /api/universe are unchanged (401 unauthenticated)', async () => {
  const db = new FakeDB(estateRows());
  const lookup = await app.request('/api/lookup?title=Mistborn', {}, machineEnv(db));
  assert.equal(lookup.status, 401);
  assert.equal((await lookup.json() as any).error, 'unauthenticated');
  const universe = await app.request('/api/universe/cosmere', {}, machineEnv(db));
  assert.equal(universe.status, 401);
});

test('MOUNT ORDER: /api/machine gets NO CORS headers — a browser can never call it', async () => {
  const res = await app.request(
    '/api/machine/lookup?title=Mistborn',
    { method: 'OPTIONS', headers: { Origin: 'https://heygabi.ai', 'Access-Control-Request-Method': 'GET' } },
    machineEnv(new FakeDB(estateRows())),
  );
  assert.equal(
    res.headers.get('access-control-allow-origin'),
    null,
    'the apex is allowed on /api/search and must NOT be allowed here',
  );
});

// --- The three refusals, each distinct. ------------------------------------

test('REFUSAL 1/3: no Authorization header → 401 machine_token_missing, worded', async () => {
  const res = await app.request('/api/machine/lookup?title=Mistborn', {}, machineEnv(new FakeDB()));
  assert.equal(res.status, 401);
  const body = (await res.json()) as any;
  assert.equal(body.error, 'machine_token_missing');
  // What happened / what it needs / how to get it — never a bare status.
  assert.match(body.detail, /no bearer credential was presented/);
  assert.match(body.needs, /Authorization: Bearer/);
  assert.ok(typeof body.how === 'string' && body.how.length > 0);
});

test('REFUSAL 2/3: wrong token → 401 machine_token_invalid, and NOT the missing-header answer', async () => {
  const res = await app.request('/api/machine/lookup?title=Mistborn', bearer('not-the-token'), machineEnv(new FakeDB()));
  assert.equal(res.status, 401);
  const body = (await res.json()) as any;
  assert.equal(body.error, 'machine_token_invalid');
  assert.notEqual(body.error, 'machine_token_missing');
  assert.match(body.detail, /not a machine read token/);
  assert.match(body.needs, /INDEX_READ_TOKEN/);
  assert.ok(typeof body.how === 'string' && body.how.length > 0);
});

test('REFUSAL 2/3: a PUSH token is not a READ token — the two credentials are separate', async () => {
  const res = await app.request(
    '/api/machine/lookup?title=Mistborn',
    bearer('push-token-value'),
    machineEnv(new FakeDB(), { INDEX_PUSH_TOKEN_LIBRARY: 'push-token-value' }),
  );
  assert.equal(res.status, 401);
  assert.equal((await res.json() as any).error, 'machine_token_invalid');
});

test('REFUSAL 3/3: NO machine read token set at all → worded 503 naming every secret, NEVER 404', async () => {
  const res = await app.request(
    '/api/machine/lookup?title=Mistborn',
    bearer(READ_TOKEN),
    machineEnv(new FakeDB(), { INDEX_READ_TOKEN_LIBRARY: undefined }),
  );
  // ⚠️ 404 would read as "not built" and send an operator hunting for a
  // feature that exists and is simply unkeyed.
  assert.notEqual(res.status, 404);
  assert.equal(res.status, 503);
  const body = (await res.json()) as any;
  assert.equal(body.error, 'machine_read_unconfigured');
  assert.match(body.detail, /built and deployed/);
  // ⚠️ EVERY configurable app is named, not just the first: an operator whose
  // instance is `library2` must be told the secret THEY need.
  assert.deepEqual(body.needs, ['INDEX_READ_TOKEN_LIBRARY', 'INDEX_READ_TOKEN_LIBRARY2']);
  assert.match(body.how, /wrangler secret put INDEX_READ_TOKEN_LIBRARY\b/);
  assert.match(body.how, /wrangler secret put INDEX_READ_TOKEN_LIBRARY2\b/);
  assert.match(body.how, /wrangler secret put INDEX_READ_TOKEN\b/);
});

// --- Two configured apps: the VALUE names the caller, and nothing else. -----

test('TWO APPS: each app is resolved from its own token VALUE — there is no `app` field to lie in', async () => {
  const db = new FakeDB(estateRows());
  const env = machineEnv(db, { INDEX_READ_TOKEN_LIBRARY2: FRIEND_TOKEN });

  // Both values are accepted, and neither is the other.
  for (const token of [READ_TOKEN, FRIEND_TOKEN]) {
    const res = await app.request('/api/machine/lookup?title=Mistborn', bearer(token), env);
    assert.equal(res.status, 200, 'both configured apps may read');
  }
  const wrong = await app.request('/api/machine/lookup?title=Mistborn', bearer('neither-value'), env);
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json() as any).error, 'machine_token_invalid');
});

test('TWO APPS: library2 resolves to MACHINE_VISIBILITY — the APP name does not open the `library2` SHELF', async () => {
  // ⚠️ The trap this pins: `library2` is BOTH an app name (env.ts MACHINE_APPS)
  // and a catalog name (estate-auth §4.5 / migration 0007). Resolving the first
  // must never grant the second — a machine caller sees an approved MEMBER's
  // slice, and `library2` is `DEFAULT 0` and hand-granted for people.
  const res = await app.request(
    '/api/machine/search?q=Mistborn',
    bearer(FRIEND_TOKEN),
    machineEnv(new FakeDB(estateRows()), { INDEX_READ_TOKEN_LIBRARY2: FRIEND_TOKEN }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.deepEqual(body.scope, [...MACHINE_VISIBILITY]);
  assert.ok(!body.scope.includes('library2'), 'the app name must not widen the scope');
  const sources = new Set(
    [...body.books.flatMap((b: any) => b.entries), ...body.games].map((r: any) => r.source),
  );
  assert.ok(!sources.has('library2'), 'padhard reading the index still cannot read padhard rows');
});

test('TWO APPS: one app configured and the other not is NOT `unconfigured` — the live pair is asked', async () => {
  // `library2` unset while `library` is set must behave exactly as it did
  // before the second app existed: a good library token reads, a made-up one
  // is `machine_token_invalid`, and nothing answers 503.
  const env = machineEnv(new FakeDB(estateRows()));
  const ok = await app.request('/api/machine/lookup?title=Mistborn', bearer(READ_TOKEN), env);
  assert.equal(ok.status, 200);
  const bad = await app.request('/api/machine/lookup?title=Mistborn', bearer(FRIEND_TOKEN), env);
  assert.equal(bad.status, 401);
  assert.equal((await bad.json() as any).error, 'machine_token_invalid');
});

test('TWO APPS: MACHINE_APPS is the one list, and every entry has a secret name and a reader', async () => {
  // A third app added to MACHINE_APPS without a field in Env + a case in
  // readTokenFor would compile (the switch is exhaustive) but silently never
  // be configurable. This asserts the three stay in step.
  assert.deepEqual([...MACHINE_APPS], ['library', 'library2']);
  const env = machineEnv(new FakeDB(), {
    INDEX_READ_TOKEN_LIBRARY: 'a',
    INDEX_READ_TOKEN_LIBRARY2: 'b',
  }) as unknown as Parameters<typeof readTokenFor>[0];
  for (const app_ of MACHINE_APPS) {
    assert.equal(readTokenNameFor(app_), `INDEX_READ_TOKEN_${app_.toUpperCase()}`);
    assert.ok(readTokenFor(env, app_), `${app_} must have a readable field on Env`);
  }
});

test('REFUSAL 3/3: unconfigured beats missing-header — a config fault is never reported as the caller’s', async () => {
  const res = await app.request(
    '/api/machine/lookup?title=Mistborn',
    {},
    machineEnv(new FakeDB(), { INDEX_READ_TOKEN_LIBRARY: undefined }),
  );
  assert.equal(res.status, 503);
  assert.equal((await res.json() as any).error, 'machine_read_unconfigured');
});

// --- Delegation: the same handler, resolved to an approved member's slice. --

test('DELEGATION /lookup: the SAME handler as the human route — unscoped, exact fold join', async () => {
  const f = forbidFetch();
  try {
    const res = await app.request(
      '/api/machine/lookup?title=Mistborn',
      bearer(READ_TOKEN),
      machineEnv(new FakeDB(estateRows())),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    // read.ts's envelope, verbatim — proof it is that handler and not a copy.
    assert.equal(body.query, 'Mistborn');
    assert.equal(body.title_fold, 'mistborn');
    // Unscoped by design (read.ts's owner call), so every shelf's row for this
    // exact title comes back — the machine gets what a member gets.
    assert.equal(body.matches.length, 5);
  } finally {
    f.restore();
  }
});

test('DELEGATION /lookup: the handler’s own refusals travel unchanged (unfoldable query → 422)', async () => {
  const res = await app.request('/api/machine/lookup?title=%EC%82%BC%EA%B5%AD', bearer(READ_TOKEN), machineEnv(new FakeDB()));
  assert.equal(res.status, 422);
  assert.equal((await res.json() as any).error, 'unfoldable_query');
});

test('DELEGATION /search: scoped to an APPROVED MEMBER’s set — private shelves in, library2 and ebooks out', async () => {
  const f = forbidFetch();
  try {
    const res = await app.request(
      '/api/machine/search?q=Mistborn',
      bearer(READ_TOKEN),
      machineEnv(new FakeDB(estateRows())),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    // The slice, on the wire, in canonical order.
    assert.deepEqual(body.scope, ['audiobook', 'library', 'games']);
    assert.deepEqual([...MACHINE_VISIBILITY], body.scope);

    // ⚠️ `books` are GROUPED by work (search.ts's BookHit) — the ROWS live in
    // `entries`. `games` are individual rows. Flattening both is what "every
    // row that reached the wire" actually means here.
    const seen = [...body.books.flatMap((b: any) => b.entries), ...body.games];
    const sources = new Set(seen.map((r: any) => r.source));
    assert.ok(sources.has('library'), 'the PRIVATE library shelf is the whole point of this surface');
    assert.ok(sources.has('game'));
    assert.ok(sources.has('audiobook'));
    // ⚠️ library2 is another household's shelf (DEFAULT 0, hand-granted).
    assert.ok(!sources.has('library2'), 'library2 must never reach a machine caller');
    // ⚠️ The gated ebook shelf — EBOOK_FORMAT's carve-out subtracts it in SQL
    // because `ebooks` is absent from MACHINE_VISIBILITY.
    assert.ok(!seen.some((r: any) => r.format === 'ebook'), 'ebook rows must not reach a machine caller');
    assert.equal(f.count(), 0);
  } finally {
    f.restore();
  }
});

test('DELEGATION /search: ?source=library narrows (the library ladder’s own call)', async () => {
  const res = await app.request(
    '/api/machine/search?q=Mistborn&source=library',
    bearer(READ_TOKEN),
    machineEnv(new FakeDB(estateRows())),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.deepEqual(body.scope, ['library']);
  const sources = new Set(
    [...body.books.flatMap((b: any) => b.entries), ...body.games].map((r: any) => r.source),
  );
  assert.deepEqual([...sources], ['library']);
});

test('DELEGATION /search: the handler’s own refusals travel unchanged (missing q → 400)', async () => {
  const res = await app.request('/api/machine/search', bearer(READ_TOKEN), machineEnv(new FakeDB()));
  assert.equal(res.status, 400);
  assert.equal((await res.json() as any).error, 'missing_query');
});

test('the machine slice is an APPROVED MEMBER’s, not the owner’s break-glass set', async () => {
  // §4.3: OWNER_EMAILS is the only caller that gets every catalog, computed.
  // A leaked machine token must not be worth more than a member's session.
  assert.deepEqual([...MACHINE_VISIBILITY], ['audiobook', 'library', 'games']);
  assert.ok(!MACHINE_VISIBILITY.includes('ebooks'));
  assert.ok(!MACHINE_VISIBILITY.includes('library2'));
});
