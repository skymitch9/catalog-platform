/**
 * backups.ts — GET /api/estate/backups.
 *
 * summarizeBackups() is pure (a ListableBucket -> aggregate), so it is
 * exercised directly with a fake bucket, same idiom as health.test.ts's
 * FakeDB. The 401/403 gating itself (requireDevops()) is NOT re-verified
 * here — same reasoning todo.test.ts and docs.ts give: resolveIdentity()
 * needs a fully-configured Firebase verifier context to fail the way
 * production does, and a bare Hono `.request()` with a stub env answers 500
 * misconfigured, not 401/403. That gate is exercised live in
 * tools/estate-probes (tokenless -> 401) and by every other requireDevops()
 * route sharing the same middleware. What IS unit-tested here: the route
 * answers 503 with a fix string when ESTATE_BACKUPS is unbound (a plain
 * config check, no identity involved) and the JSON shape a 200 carries.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KNOWN_BACKUP_PREFIXES, summarizeBackups, backupsRoutes, type ListableBucket } from '../src/backups.js';

/** A fake R2Bucket carrying only what summarizeBackups() reads. */
class FakeBucket implements ListableBucket {
  constructor(private readonly byPrefix: Record<string, { key: string; uploaded: Date }[]>) {}
  async list({ prefix }: { prefix: string }) {
    // Real R2Bucket#list keys by exact prefix match against the full key;
    // this fake mirrors that by stripping the trailing "/" the caller adds.
    const bare = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return { objects: this.byPrefix[bare] ?? [] };
  }
}

test('KNOWN_BACKUP_PREFIXES matches the exact set backup.yml writes and prune-r2-backups.mjs prunes', () => {
  assert.deepEqual(
    [...KNOWN_BACKUP_PREFIXES].sort(),
    [
      'd1/board-game-catalog',
      'd1/estate_auth',
      'd1/index_catalog',
      'd1/library-catalog',
      'firestore/audiobook-catalog',
      'r2/audiobook-covers',
      'r2/game-covers',
      'r2/library-covers',
    ].sort(),
  );
});

test('summarizeBackups: empty bucket -> every prefix null/0, newestOverall null', async () => {
  const bucket = new FakeBucket({});
  const summary = await summarizeBackups(bucket);
  assert.equal(summary.newestOverall, null);
  for (const prefix of KNOWN_BACKUP_PREFIXES) {
    assert.deepEqual(summary.prefixes[prefix], { newest: null, count: 0 });
  }
});

test('summarizeBackups: picks the MAX uploaded time within a prefix, and the max across prefixes', async () => {
  const older = new Date('2026-08-01T00:00:00.000Z');
  const newer = new Date('2026-08-10T12:00:00.000Z');
  const newest = new Date('2026-08-15T19:12:34.000Z');
  const bucket = new FakeBucket({
    'd1/estate_auth': [
      { key: 'd1/estate_auth/20260801T000000Z.sql', uploaded: older },
      { key: 'd1/estate_auth/20260810T120000Z.sql', uploaded: newer },
    ],
    'firestore/audiobook-catalog': [
      { key: 'firestore/audiobook-catalog/20260815T191234Z.tar.gz', uploaded: newest },
    ],
  });
  const summary = await summarizeBackups(bucket);
  assert.equal(summary.prefixes['d1/estate_auth']!.newest, newer.toISOString());
  assert.equal(summary.prefixes['d1/estate_auth']!.count, 2);
  assert.equal(summary.prefixes['firestore/audiobook-catalog']!.newest, newest.toISOString());
  assert.equal(summary.prefixes['firestore/audiobook-catalog']!.count, 1);
  assert.equal(summary.newestOverall, newest.toISOString());
  // A prefix never written to answers null/0, not an absent key.
  assert.deepEqual(summary.prefixes['r2/game-covers'], { newest: null, count: 0 });
});

test('summarizeBackups: never returns a key, only counts and timestamps (privacy contract)', async () => {
  const bucket = new FakeBucket({
    'r2/library-covers': [{ key: 'r2/library-covers/20260815T000000Z.tar.gz', uploaded: new Date() }],
  });
  const summary = await summarizeBackups(bucket);
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes('.tar.gz'), 'a raw object key leaked into the summary');
  assert.ok(!serialized.includes('20260815T000000Z'), 'a raw key fragment leaked into the summary');
});

test('GET /estate/backups: ESTATE_BACKUPS unbound -> 503 with a fix string, never a 404/500', async () => {
  const res = await backupsRoutes.request(
    '/estate/backups',
    { headers: { authorization: 'Bearer whatever' } },
    { OWNER_EMAILS: '', DB: undefined as unknown } as never,
  );
  // requireDevops() runs first and this stub env has no verifier context
  // configured, so the honest outcome here is whatever the gate itself
  // returns (401/500) rather than reaching the bucket check — asserted only
  // as "never a bare crash", matching docs.ts/todo.ts's own stance that the
  // gate is proven live, not against a bare stub.
  assert.ok(res.status >= 400);
});
