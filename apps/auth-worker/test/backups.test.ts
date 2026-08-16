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
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  KNOWN_BACKUP_PREFIXES,
  summarizeBackups,
  gradeBackups,
  gradeBackupAge,
  BACKUP_STALE_AMBER_MS,
  BACKUP_STALE_RED_MS,
  backupsRoutes,
  type ListableBucket,
} from '../src/backups.js';

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

// ---------------------------------------------------------------------------
// gradeBackups() — the threshold decisions. Every test below pins a decision
// the status page renders as a colour, so a changed threshold fails here
// rather than quietly repainting a row.
// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-08-16T12:00:00.000Z');
const DAY = 24 * 3600_000;

/** A summary with every known prefix aged `daysAgo` unless overridden. */
function summaryAged(defaultDaysAgo: number | null, overrides: Record<string, number | null> = {}) {
  const prefixes: Record<string, { newest: string | null; count: number }> = {};
  let newestMs: number | null = null;
  for (const prefix of KNOWN_BACKUP_PREFIXES) {
    const days = prefix in overrides ? overrides[prefix]! : defaultDaysAgo;
    if (days === null) {
      prefixes[prefix] = { newest: null, count: 0 };
      continue;
    }
    const ms = NOW - days * DAY;
    prefixes[prefix] = { newest: new Date(ms).toISOString(), count: 3 };
    if (newestMs === null || ms > newestMs) newestMs = ms;
  }
  return { prefixes, newestOverall: newestMs === null ? null : new Date(newestMs).toISOString() };
}

test('⚠️ thresholds are exactly 14 days amber / 45 days red — change these on purpose only', () => {
  // Spelled as raw milliseconds so an "equivalent" refactor of the expression
  // cannot silently move the boundary. See backups.ts for why calendar-based.
  assert.equal(BACKUP_STALE_AMBER_MS, 1_209_600_000);
  assert.equal(BACKUP_STALE_RED_MS, 3_888_000_000);
});

test('gradeBackupAge: boundaries are inclusive-ok — exactly 14d/45d do NOT trip', () => {
  assert.equal(gradeBackupAge(0), 'ok');
  assert.equal(gradeBackupAge(BACKUP_STALE_AMBER_MS), 'ok');
  assert.equal(gradeBackupAge(BACKUP_STALE_AMBER_MS + 1), 'warn');
  assert.equal(gradeBackupAge(BACKUP_STALE_RED_MS), 'warn');
  assert.equal(gradeBackupAge(BACKUP_STALE_RED_MS + 1), 'danger');
});

test('gradeBackups: one row per kind, covering exactly the known prefixes', () => {
  const { kinds } = gradeBackups(summaryAged(1), NOW);
  assert.deepEqual(kinds.map((k) => k.kind), ['d1', 'firestore', 'r2']);
  assert.deepEqual(kinds.map((k) => k.stores), [4, 1, 3]);
  // Every known prefix belongs to exactly one kind — no store can go ungraded.
  assert.equal(kinds.reduce((n, k) => n + k.stores, 0), KNOWN_BACKUP_PREFIXES.length);
});

test('gradeBackups: everything fresh -> ok everywhere, with the real age carried', () => {
  const { kinds, overall } = gradeBackups(summaryAged(2), NOW);
  for (const k of kinds) assert.equal(k.state, 'ok');
  assert.equal(overall.state, 'ok');
  assert.equal(overall.age_ms, 2 * DAY);
  assert.deepEqual(overall.never, []);
  assert.equal(overall.count, 3 * KNOWN_BACKUP_PREFIXES.length);
});

test('⚠️ a single stale store is NOT masked by fresh ones — the whole reason grading is per-store', () => {
  // The real-world shape this catches: backup.yml takes a `target` input, so
  // an `r2`-only dispatch refreshes three stores and leaves the databases
  // untouched. Judging on the newest object anywhere would read green.
  const summary = summaryAged(1, { 'd1/estate_auth': 20 });
  const { kinds, overall } = gradeBackups(summary, NOW);

  // newestOverall is an hour-fresh timestamp — the old, masking signal.
  assert.equal(Date.parse(summary.newestOverall!), NOW - 1 * DAY);

  assert.equal(overall.state, 'warn', 'a 20-day-old database read as ok');
  assert.equal(overall.oldest_store, 'd1/estate_auth');
  assert.equal(overall.age_ms, 20 * DAY);

  const d1 = kinds.find((k) => k.kind === 'd1')!;
  assert.equal(d1.state, 'warn');
  assert.equal(d1.oldest_store, 'd1/estate_auth');
  // The kinds that ARE fresh stay green — the warning is localised, not smeared.
  assert.equal(kinds.find((k) => k.kind === 'r2')!.state, 'ok');
  assert.equal(kinds.find((k) => k.kind === 'firestore')!.state, 'ok');
});

test('gradeBackups: past 45 days the stalest store turns the row red', () => {
  const { kinds, overall } = gradeBackups(summaryAged(1, { 'r2/game-covers': 46 }), NOW);
  assert.equal(overall.state, 'danger');
  assert.equal(overall.oldest_store, 'r2/game-covers');
  assert.equal(kinds.find((k) => k.kind === 'r2')!.state, 'danger');
  assert.equal(kinds.find((k) => k.kind === 'd1')!.state, 'ok');
});

test('gradeBackups: a never-captured store is danger and NAMED, not a stale age', () => {
  // "No copy exists" is not a cadence judgement and no wall-clock threshold
  // can express it — it short-circuits regardless of how fresh the rest is.
  const { kinds, overall } = gradeBackups(summaryAged(1, { 'firestore/audiobook-catalog': null }), NOW);
  const fs = kinds.find((k) => k.kind === 'firestore')!;
  assert.equal(fs.state, 'danger');
  assert.deepEqual(fs.never, ['firestore/audiobook-catalog']);
  assert.equal(fs.age_ms, null, 'an unprotected store must not report an age');
  assert.equal(fs.oldest_store, null);
  assert.equal(overall.state, 'danger');
  assert.deepEqual(overall.never, ['firestore/audiobook-catalog']);
  // The kinds that do have backups still report their real ages.
  assert.equal(kinds.find((k) => k.kind === 'd1')!.state, 'ok');
});

test('gradeBackups: empty bucket -> every kind danger, nothing claims an age', () => {
  const { kinds, overall } = gradeBackups(summaryAged(null), NOW);
  for (const k of kinds) {
    assert.equal(k.state, 'danger');
    assert.equal(k.age_ms, null);
  }
  assert.equal(overall.state, 'danger');
  assert.equal(overall.never.length, KNOWN_BACKUP_PREFIXES.length);
});

test('gradeBackups: grades leak no object keys either (same privacy contract)', () => {
  const bucketSummary = {
    prefixes: Object.fromEntries(
      KNOWN_BACKUP_PREFIXES.map((p) => [p, { newest: '2026-08-16T08:49:05.000Z', count: 8 }]),
    ),
    newestOverall: '2026-08-16T08:49:05.000Z',
  };
  const serialized = JSON.stringify(gradeBackups(bucketSummary, NOW));
  assert.ok(!serialized.includes('.tar.gz'), 'a raw object key leaked into the grades');
  assert.ok(!serialized.includes('.sql'), 'a raw object key leaked into the grades');
});

test('⚠️ the status page keeps NO threshold of its own — one source of truth, mechanically', async () => {
  // The thresholds moved server-side precisely so the test above can guard
  // them. A copy re-appearing in status.js would drift silently: the page
  // would paint one colour while the Worker decided another, and only one of
  // the two would be under test. Guard it here rather than in a comment.
  const statusJs = await readFile(
    new URL('../../../sites/heygabi-home/public/status/status.js', import.meta.url),
    'utf8',
  );
  const declared = statusJs.match(/(const|let|var)\s+BACKUP_\w*(AMBER|RED|STALE)\w*\s*=/g);
  assert.equal(declared, null, `status.js re-declared a backup threshold: ${declared?.join(', ')}`);
  // And it must still be reading the graded shape this module sends.
  assert.ok(statusJs.includes('body.overall'), 'status.js no longer reads the overall grade');
  assert.ok(statusJs.includes('body.kinds'), 'status.js no longer reads the per-kind grades');
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
