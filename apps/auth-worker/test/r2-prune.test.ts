/**
 * Backup retention in the Worker — the posture, the pass, and the admin door.
 *
 * ⚠️ WHAT IS *NOT* TESTED HERE, ON PURPOSE: the retention DECISION. That lives
 * in `scripts/lib/backup-keys.mjs`'s `planRetention()`, is shared with
 * `scripts/prune-r2-backups.mjs`, and is tested once in
 * `scripts/test/backup-keys.test.mjs` — eleven cases including the split-
 * generation data-loss case. Re-asserting it here would be a second set of
 * tests for one function, which drifts exactly the way a second implementation
 * would. What this file covers is everything the Worker adds AROUND that
 * decision: the mode gate, the pagination, the never-throws contract, and the
 * refusals.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseR2PruneMode,
  runR2Prune,
  scheduledR2Prune,
  r2PruneRoutes,
  R2_PRUNE_KEEP,
  type PrunableBucket,
} from '../src/r2-prune.js';

// ---------------------------------------------------------------------------
// A bucket that remembers what it was asked
// ---------------------------------------------------------------------------

class FakeBucket implements PrunableBucket {
  deleted: string[] = [];
  listCalls: { prefix: string; cursor?: string }[] = [];
  listThrowsFor: string | null = null;
  deleteThrowsFor: string | null = null;
  /** prefix -> pages of keys, so pagination can be exercised honestly. */
  constructor(private pages: Record<string, string[][]> = {}) {}

  async list(options: { prefix: string; cursor?: string; limit?: number }) {
    this.listCalls.push({ prefix: options.prefix, cursor: options.cursor });
    if (this.listThrowsFor && options.prefix.startsWith(this.listThrowsFor)) {
      throw new Error('R2 said no');
    }
    const pages = this.pages[options.prefix] ?? [[]];
    const index = options.cursor ? Number(options.cursor) : 0;
    const page = pages[index] ?? [];
    const truncated = index < pages.length - 1;
    return {
      objects: page.map((key) => ({ key })),
      truncated,
      cursor: truncated ? String(index + 1) : undefined,
    };
  }

  async delete(key: string) {
    if (this.deleteThrowsFor && key.includes(this.deleteThrowsFor)) {
      throw new Error('delete refused');
    }
    this.deleted.push(key);
  }
}

const stamps = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}/2026090${i}T090000Z.sql`);

const silent = () => {};

// ---------------------------------------------------------------------------
// The posture
// ---------------------------------------------------------------------------

test('parseR2PruneMode reads the three postures, case- and space-insensitively', () => {
  assert.equal(parseR2PruneMode('off'), 'off');
  assert.equal(parseR2PruneMode('shadow'), 'shadow');
  assert.equal(parseR2PruneMode('enforce'), 'enforce');
  assert.equal(parseR2PruneMode('  ENFORCE  '), 'enforce');
  assert.equal(parseR2PruneMode('Shadow'), 'shadow');
});

test('⚠️ anything unrecognised is `off`, NEVER `enforce` — a typo must not delete backups', () => {
  assert.equal(parseR2PruneMode(undefined), 'off');
  assert.equal(parseR2PruneMode(''), 'off');
  assert.equal(parseR2PruneMode('enforc'), 'off');
  assert.equal(parseR2PruneMode('true'), 'off');
  assert.equal(parseR2PruneMode('on'), 'off');
  assert.equal(parseR2PruneMode('1'), 'off');
});

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

test('⚠️ shadow PLANS and DELETES NOTHING — the whole safety model in one assertion', async () => {
  const bucket = new FakeBucket({ 'd1/estate_auth/': [stamps('d1/estate_auth', 5)] });
  const result = await runR2Prune(bucket, {
    mode: 'shadow',
    keep: 3,
    prefixes: ['d1/estate_auth'],
    log: silent,
  });

  assert.deepEqual(bucket.deleted, [], 'shadow deleted an object — this is the bug the posture exists to prevent');
  assert.equal(result.would_delete_total, 2);
  assert.equal(result.deleted_total, 0);
  assert.equal(result.prefixes[0]!.kept, 3);
  assert.equal(result.prefixes[0]!.generations, 5);
  // Newest kept, oldest dropped — the arithmetic itself is planRetention's and
  // is tested there; this only pins that the Worker did not reverse it.
  assert.deepEqual(result.prefixes[0]!.wouldDelete, [
    'd1/estate_auth/20260901T090000Z.sql',
    'd1/estate_auth/20260900T090000Z.sql',
  ]);
});

test('enforce deletes exactly the planned set, in plan order', async () => {
  const bucket = new FakeBucket({ 'd1/estate_auth/': [stamps('d1/estate_auth', 5)] });
  const result = await runR2Prune(bucket, {
    mode: 'enforce',
    keep: 3,
    prefixes: ['d1/estate_auth'],
    log: silent,
  });

  assert.deepEqual(bucket.deleted, result.prefixes[0]!.wouldDelete);
  assert.equal(result.deleted_total, 2);
  assert.equal(result.delete_errors, 0);
});

test('a prefix at or under depth deletes nothing, and is still reported', async () => {
  const bucket = new FakeBucket({ 'd1/estate_auth/': [stamps('d1/estate_auth', 2)] });
  const result = await runR2Prune(bucket, {
    mode: 'enforce',
    keep: 8,
    prefixes: ['d1/estate_auth'],
    log: silent,
  });
  assert.deepEqual(bucket.deleted, []);
  // ⚠️ The row exists. A prefix that planned nothing and a prefix that was never
  // examined must not look the same — the script's header makes the same point
  // about logging a zero-object prefix.
  assert.equal(result.prefixes.length, 1);
  assert.equal(result.prefixes[0]!.error, null);
});

test('⚠️ listing PAGINATES — the pass runs precisely when a prefix is over depth', async () => {
  const bucket = new FakeBucket({
    'r2/game-covers/': [
      stamps('r2/game-covers', 3),
      ['r2/game-covers/20260905T090000Z.tar.gz', 'r2/game-covers/20260906T090000Z.tar.gz'],
    ],
  });
  const result = await runR2Prune(bucket, {
    mode: 'shadow',
    keep: 4,
    prefixes: ['r2/game-covers'],
    log: silent,
  });

  assert.equal(bucket.listCalls.length, 2, 'the second page was never fetched');
  assert.equal(result.prefixes[0]!.generations, 5, 'both pages counted');
  // Without the cursor loop this would have seen 3 generations, kept all of
  // them, and planned nothing — quietly keeping the WRONG newest set.
  assert.equal(result.prefixes[0]!.wouldDelete.length, 1);
});

test('⚠️ a LISTING failure plans NOTHING for that prefix and does not stop the pass', async () => {
  const bucket = new FakeBucket({
    'd1/estate_auth/': [stamps('d1/estate_auth', 5)],
    'd1/index_catalog/': [stamps('d1/index_catalog', 5)],
  });
  bucket.listThrowsFor = 'd1/estate_auth';

  const result = await runR2Prune(bucket, {
    mode: 'enforce',
    keep: 3,
    prefixes: ['d1/estate_auth', 'd1/index_catalog'],
    log: silent,
  });

  const failed = result.prefixes[0]!;
  assert.match(failed.error!, /R2 said no/);
  assert.deepEqual(failed.wouldDelete, [], 'planned against a failed listing — this deletes real backups');
  assert.equal(failed.deleted, 0);
  assert.equal(result.listing_errors, 1);

  // The healthy prefix behind it was still processed: one bad prefix says
  // nothing about the next.
  assert.equal(result.prefixes[1]!.deleted, 2);
  assert.equal(bucket.deleted.length, 2);
});

test('a DELETE failure is recorded per key and the pass continues', async () => {
  const bucket = new FakeBucket({ 'd1/estate_auth/': [stamps('d1/estate_auth', 5)] });
  bucket.deleteThrowsFor = '20260901T090000Z';

  const result = await runR2Prune(bucket, {
    mode: 'enforce',
    keep: 3,
    prefixes: ['d1/estate_auth'],
    log: silent,
  });

  assert.equal(result.delete_errors, 1);
  assert.equal(result.deleted_total, 1, 'the other planned key was still deleted');
  assert.equal(result.prefixes[0]!.failed[0]!.key, 'd1/estate_auth/20260901T090000Z.sql');
  // ⚠️ Distinct from a listing error. `listing_errors` means "the plan is
  // untrusted"; `delete_errors` means "the plan was right and R2 refused".
  assert.equal(result.listing_errors, 0);
});

test('runR2Prune reports the mode and depth it actually used', async () => {
  const bucket = new FakeBucket({ 'd1/estate_auth/': [stamps('d1/estate_auth', 1)] });
  const result = await runR2Prune(bucket, { mode: 'shadow', prefixes: ['d1/estate_auth'], log: silent });
  assert.equal(result.mode, 'shadow');
  assert.equal(result.keep, R2_PRUNE_KEEP, 'the default depth is the shared constant, not a literal');
  assert.ok(!Number.isNaN(Date.parse(result.started_at)));
  assert.ok(!Number.isNaN(Date.parse(result.finished_at)));
});

// ---------------------------------------------------------------------------
// The cron wrapper
// ---------------------------------------------------------------------------

test('⚠️ `off` returns before the first list() — a dark posture costs nothing', async () => {
  const bucket = new FakeBucket({ 'd1/estate_auth/': [stamps('d1/estate_auth', 20)] });
  await scheduledR2Prune({ ESTATE_BACKUPS: bucket as unknown as R2Bucket, R2_PRUNE_MODE: 'off' });
  assert.deepEqual(bucket.listCalls, []);
  assert.deepEqual(bucket.deleted, []);
});

test('an absent binding does not throw out of the cron — it is logged and skipped', async () => {
  // ⚠️ A scheduled handler that rejects records a failed invocation and nothing
  // else. "Retention did not run" would then be a fact nobody learns until the
  // bucket has grown for weeks.
  await scheduledR2Prune({ R2_PRUNE_MODE: 'shadow' });
});

test('a listing that throws does not throw out of the cron', async () => {
  const bucket = new FakeBucket({ 'd1/estate_auth/': [[]] });
  bucket.listThrowsFor = '';
  await scheduledR2Prune({ ESTATE_BACKUPS: bucket as unknown as R2Bucket, R2_PRUNE_MODE: 'shadow' });
});

// ---------------------------------------------------------------------------
// The admin door — every refusal in WORDS, never a bare status
// ---------------------------------------------------------------------------

const OWNER = 'owner@example.com';

/** The dev-bypass identity the other route tests use: ENVIRONMENT=development. */
const devEnv = (extra: Record<string, unknown> = {}) => ({
  ENVIRONMENT: 'development',
  DEV_EMAIL: OWNER,
  OWNER_EMAILS: OWNER,
  DB: fakeDb(),
  ...extra,
});

/**
 * A D1 that answers `requireDevops()`'s one question — "is there a row for this
 * email?" — with an approved devops row.
 *
 * ⚠️ IT RETURNS A ROW RATHER THAN `null` ON PURPOSE. With no row the middleware
 * takes its `materializeOwnerRow()` branch, which INSERTs and then re-SELECTs;
 * a stub that answers null to both throws "materializeOwnerRow returned no
 * row" and every route test 500s. That is the middleware working correctly on a
 * fake, not a bug — and worth the comment, because the 500 looks exactly like a
 * broken handler. The GATE itself is not re-verified here: it is the same
 * shared middleware `backups.test.ts`, `facts.test.ts` and `estate-docs.test.ts`
 * all decline to re-test, plus `tools/estate-probes`' tokenless 401 rows.
 */
function fakeDb() {
  const row = {
    id: 1,
    email: OWNER,
    name: 'Owner',
    status: 'approved',
    is_approver: 1,
    is_devops: 1,
    firebase_uid: 'uid-owner',
  };
  const statement: Record<string, unknown> = {
    bind: () => statement,
    async first() {
      return row;
    },
    async all() {
      return { results: [row] };
    },
    async run() {
      return { success: true };
    },
  };
  return {
    prepare: () => statement,
    async batch() {
      return [];
    },
  };
}

test('the prune door refuses an unauthenticated caller in words, not a bare 401', async () => {
  const res = await r2PruneRoutes.request(
    '/estate/backups/prune',
    { method: 'POST' },
    // ⚠️ `FIREBASE_PROJECT_ID` must be present or `resolveIdentity()` throws and
    // the middleware answers a worded 500 `misconfigured` instead — a real
    // behaviour, but a different one, and asserting 401 without this line tests
    // the stub rather than the gate.
    {
      ENVIRONMENT: 'production',
      FIREBASE_PROJECT_ID: 'test-project',
      OWNER_EMAILS: OWNER,
      DB: devEnv().DB,
    } as never,
  );
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string; detail?: string };
  assert.equal(body.error, 'unauthenticated');
  assert.ok(body.detail && body.detail.length > 20, 'a person must never meet a bare status');
});

test('⚠️ an unbound bucket says WHICH binding is missing — "absent" is not "empty"', async () => {
  const res = await r2PruneRoutes.request(
    '/estate/backups/prune',
    { method: 'POST' },
    devEnv({ R2_PRUNE_MODE: 'shadow' }) as never,
  );
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: string; detail: string; fix: string };
  assert.equal(body.error, 'backups_bucket_unbound');
  assert.match(body.fix, /ESTATE_BACKUPS/);
  assert.match(body.detail, /nothing was deleted/i);
});

test('⚠️ dryRun DEFAULTS TO TRUE — a POST with no query plans and deletes nothing', async () => {
  const bucket = new FakeBucket({ 'd1/estate_auth/': [stamps('d1/estate_auth', 12)] });
  const res = await r2PruneRoutes.request(
    '/estate/backups/prune',
    { method: 'POST' },
    devEnv({ R2_PRUNE_MODE: 'shadow', ESTATE_BACKUPS: bucket }) as never,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { dry_run: boolean; posture: string; deleted_total: number };
  assert.equal(body.dry_run, true);
  assert.equal(body.posture, 'shadow');
  assert.equal(body.deleted_total, 0);
  assert.deepEqual(bucket.deleted, []);
});

test('⚠️ dryRun=0 is REFUSED while the posture is shadow — the gate, mechanically', async () => {
  const bucket = new FakeBucket({ 'd1/estate_auth/': [stamps('d1/estate_auth', 12)] });
  const res = await r2PruneRoutes.request(
    '/estate/backups/prune?dryRun=0',
    { method: 'POST' },
    devEnv({ R2_PRUNE_MODE: 'shadow', ESTATE_BACKUPS: bucket }) as never,
  );
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: string; detail: string; fix: string; mode: string };
  assert.equal(body.error, 'r2_prune_not_enforcing');
  assert.equal(body.mode, 'shadow');
  assert.match(body.detail, /nothing was deleted/i);
  assert.match(body.detail, /dryRun=1/);
  assert.match(body.fix, /R2_PRUNE_MODE/);
  assert.deepEqual(bucket.deleted, [], 'a refused request must not have listed-and-deleted first');
});

test('dryRun=0 with the posture at enforce does the real pass', async () => {
  const bucket = new FakeBucket({ 'd1/estate_auth/': [stamps('d1/estate_auth', 12)] });
  const res = await r2PruneRoutes.request(
    '/estate/backups/prune?dryRun=0',
    { method: 'POST' },
    devEnv({ R2_PRUNE_MODE: 'enforce', ESTATE_BACKUPS: bucket }) as never,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { dry_run: boolean; deleted_total: number };
  assert.equal(body.dry_run, false);
  assert.equal(body.deleted_total, 4, '12 generations, keep 8');
  assert.equal(bucket.deleted.length, 4);
});

test('⚠️ dryRun=1 is a dry run EVEN AT enforce — the narrower of the two always wins', async () => {
  const bucket = new FakeBucket({ 'd1/estate_auth/': [stamps('d1/estate_auth', 12)] });
  const res = await r2PruneRoutes.request(
    '/estate/backups/prune?dryRun=1',
    { method: 'POST' },
    devEnv({ R2_PRUNE_MODE: 'enforce', ESTATE_BACKUPS: bucket }) as never,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { dry_run: boolean; would_delete_total: number };
  assert.equal(body.dry_run, true);
  assert.equal(body.would_delete_total, 4);
  assert.deepEqual(bucket.deleted, []);
});
