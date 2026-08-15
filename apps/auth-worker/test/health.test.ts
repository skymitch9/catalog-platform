/**
 * GET /health — envelope normalization (estate item 5, 2026-08-14). Exercises
 * the real exported `estateRoutes` (not a reconstruction), with a minimal
 * fake D1 that answers `statusCounts`'s GROUP BY.
 */

import assert from 'node:assert/strict';
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
  const legacy = { ok: true, users: { pending: 0, approved: 10, revoked: 0, approvers: 1 } };
  assert.deepEqual(body.users, legacy.users);
  assert.deepEqual(body.detail, legacy);
});
