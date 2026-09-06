/**
 * GET /health — envelope normalization (estate item 5, 2026-08-14). Exercises
 * the real exported `estateRoutes` (not a reconstruction), with a minimal
 * fake D1 that answers `statusCounts`'s GROUP BY.
 */

import assert from 'node:assert/strict';
import { WORKER_VERSION } from '../src/estate.js';
import { test } from 'node:test';
import { estateRoutes } from '../src/estate.js';

class FakeDB {
  prepare(_sql: string) {
    return {
      bind: (..._args: unknown[]) => this.prepare(_sql),
      async all() {
        return {
          results: [
            { status: 'approved', n: 10, approvers: 1 },
            { status: 'pending', n: 0, approvers: 0 },
            { status: 'revoked', n: 0, approvers: 0 },
          ],
        };
      },
      async first() {
        return null;
      },
      async run() {
        return { success: true };
      },
    };
  }
  async batch() {
    return [];
  }
}

test('GET /health answers the estate envelope AND keeps `users` at the top level', async () => {
  const res = await estateRoutes.request('/health', {}, { DB: new FakeDB() as unknown as D1Database });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;

  assert.equal(body.ok, true);
  assert.equal(body.service, 'estate-auth');
  assert.equal(typeof body.time, 'string');
  assert.ok(!Number.isNaN(Date.parse(body.time)));

  // Additive transition: the pre-envelope shape survives unchanged at the
  // top level, and again verbatim under `detail`.
  // ⚠️ `version` added 2026-08-18: the Health page's Deployed-versions row for
  // this Worker sat permanently AMBER ("Healthy, but reports no version") —
  // the row saying it cannot name what is live, which is the one thing that
  // section exists to answer. It must appear in BOTH halves of the envelope,
  // because the page reads detail-first and falls back to the flat body.
  const legacy = { ok: true, version: WORKER_VERSION, users: { pending: 0, approved: 10, revoked: 0, approvers: 1 } };
  assert.equal(body.version, WORKER_VERSION);
  assert.deepEqual(body.users, legacy.users);

  // ⚠️ `detail` is legacy PLUS `estateProbes`, added 2026-09-05 with the hourly
  // probe cron. It is deliberately NOT spread into the flat top level: `legacy`
  // is spread there too, so adding it to `legacy` would widen the envelope every
  // consumer parses for a key one page reads. `detail` is where a Worker's own
  // business goes (docs/info/health-envelope.md).
  assert.deepEqual(body.detail, { ...legacy, estateProbes: null });
  // ⚠️ AND IT MUST NOT LEAK UPWARDS — this assertion is the guard on that.
  assert.equal('estateProbes' in body, false);
});

test('⚠️ detail.estateProbes is NULL when nothing has run, and null is not a zero', async () => {
  // The FakeDB above answers `first()` with null for every query, which is
  // exactly a Worker deployed ahead of migration 0021 or one whose first cron
  // has not fired yet. That Worker is HEALTHY, and the page is required to word
  // "no probe run has been recorded" rather than "0 of 145 passed" — opposite
  // sentences that a zero-filled placeholder would collapse into one.
  const res = await estateRoutes.request('/health', {}, { DB: new FakeDB() as unknown as D1Database });
  const body = (await res.json()) as any;
  assert.equal(body.ok, true, 'a Worker with no probe history is still healthy');
  assert.equal(body.detail.estateProbes, null);
});
