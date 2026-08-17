/**
 * ⚠️ THE DORMANCY PIN — the one property this whole prebuild hangs on
 * (migration design §5 Phase 3, built during the Phase 1 soak): in 'off' and
 * 'shadow' modes EVERY Phase 3 write route answers 503 not_enabled and
 * touches NOTHING — no Firestore, no estate call, no token work. A route
 * that writes in shadow mode is the failure this gate exists to prevent.
 *
 * Mechanically pinned per route × per dormant mode, with a fetch stub that
 * THROWS on any network call — so "touched nothing" is enforced, not
 * asserted after the fact. Mutating the gate (letting shadow through) must
 * fail every one of these.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/index.js';
import { ENFORCE_ROUTES } from '../src/enforce-routes.js';
import { NOT_ENABLED } from '../src/enforce-gate.js';
import type { Env } from '../src/env.js';

function dormantEnv(mode: 'off' | 'shadow'): Env {
  return {
    // Deliberately a FULLY-CONFIGURED env (dev bypass identity, SA set,
    // estate wired): dormancy must hold because of the MODE, not because
    // something happened to be unconfigured.
    ENVIRONMENT: 'development',
    DEV_EMAIL: 'admin@example.com',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: 'admin@example.com',
    FIREBASE_SERVICE_ACCOUNT: '{"client_email":"x@x","private_key":"k","project_id":"p"}',
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP_TOKEN_AUDIOBOOK: 'ab-token',
    ESTATE_CHECK: mode,
  };
}

/** Any network call while dormant is an instant, attributable failure. */
function armTripwire() {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    throw new Error(`DORMANCY VIOLATION — network call while not enforcing: ${String(input)}`);
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

const samplePath = (path: string): string => path.replace(/:[A-Za-z]+/g, 'x');

for (const route of ENFORCE_ROUTES) {
  for (const mode of ['off', 'shadow'] as const) {
    test(`dormant (${mode}): ${route.method} ${route.path} → 503 not_enabled, zero network`, async () => {
      const tripwire = armTripwire();
      try {
        const res = await app.request(
          samplePath(route.path),
          {
            method: route.method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          },
          dormantEnv(mode),
        );
        assert.equal(res.status, 503);
        const body = (await res.json()) as { error?: string; detail?: string };
        assert.equal(body.error, 'not_enabled');
        // The §1e wording contract from the brief: the detail SAYS
        // enforcement has not begun, in words, never a bare status.
        assert.match(body.detail ?? '', /enforcement has not begun/);
        assert.deepEqual(tripwire.calls, []);
      } finally {
        tripwire.restore();
      }
    });
  }
}

test('the wording constant itself carries the §1e sentence (pinned once, verbatim)', () => {
  assert.equal(NOT_ENABLED.error, 'not_enabled');
  assert.match(NOT_ENABLED.detail, /enforcement has not begun/);
});

test('dormant (shadow): /api/health is NOT swallowed by the write gate', async () => {
  const tripwire = armTripwire();
  try {
    const res = await app.request('/api/health', {}, dormantEnv('shadow'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok?: boolean; estate_check?: string };
    assert.equal(body.ok, true);
    assert.equal(body.estate_check, 'shadow');
  } finally {
    tripwire.restore();
  }
});

test('dormant (shadow): /api/me is NOT swallowed by the write gate (401 for no token, not 503)', async () => {
  // Production env (no dev bypass), no Authorization header: /api/me's own
  // answer is 401 unauthenticated. If the dormancy middleware leaked onto
  // /api/me this would read 503 — the Phase 0–2 surface must stay live.
  const env: Env = { ...dormantEnv('shadow'), ENVIRONMENT: 'production', DEV_EMAIL: undefined };
  const tripwire = armTripwire();
  try {
    const res = await app.request('/api/me', {}, env);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'unauthenticated');
  } finally {
    tripwire.restore();
  }
});

test('enforce mode with a TYPO ("Enforce", "on") stays dormant — affirmative parse only', async () => {
  for (const typo of ['Enforce', 'on', 'true', 'ENFORCE ']) {
    const tripwire = armTripwire();
    try {
      const res = await app.request(
        '/api/reviews/x',
        { method: 'DELETE' },
        { ...dormantEnv('off'), ESTATE_CHECK: typo },
      );
      assert.equal(res.status, 503, `ESTATE_CHECK=${JSON.stringify(typo)} must stay dormant`);
      assert.deepEqual(tripwire.calls, []);
    } finally {
      tripwire.restore();
    }
  }
});
