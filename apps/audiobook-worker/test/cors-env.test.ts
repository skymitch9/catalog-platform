/**
 * CORS locked to the audiobook origins (migration design §2's meCors
 * pattern) + the env parsers' fail-safe directions.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/index.js';
import {
  DEFAULT_SITE_ORIGINS,
  estateCheckMode,
  parseOwnerEmails,
  parseSiteOrigins,
} from '../src/env.js';
import type { Env } from '../src/env.js';

const AB = 'https://audiobooks.heygabi.ai';

function health(origin: string, env: Env = {}): Promise<Response> {
  return Promise.resolve(app.request('/api/health', { headers: { Origin: origin } }, env));
}

test('the audiobook origin is allowed by DEFAULT — correct before any var exists', async () => {
  const res = await health(AB);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), AB);
});

test('a foreign origin gets NO allow header — exact-origin, no wildcard, no reflection', async () => {
  for (const origin of ['https://evil.example', 'https://audiobooks.heygabi.ai.evil.example', 'http://audiobooks.heygabi.ai']) {
    const res = await health(origin);
    assert.equal(res.headers.get('access-control-allow-origin'), null, origin);
  }
});

test('OPTIONS preflight on /api/me is answered by the middleware, tokenless', async () => {
  const res = await app.request(
    '/api/me',
    {
      method: 'OPTIONS',
      headers: {
        Origin: AB,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    },
    {},
  );
  assert.equal(res.headers.get('access-control-allow-origin'), AB);
  assert.ok(res.headers.get('access-control-allow-headers')?.toLowerCase().includes('authorization'));
});

test('SITE_ORIGINS set → exactly that list (a dev origin joins via .dev.vars, not code)', async () => {
  const env: Env = { SITE_ORIGINS: 'http://localhost:8788' };
  const dev = await health('http://localhost:8788', env);
  assert.equal(dev.headers.get('access-control-allow-origin'), 'http://localhost:8788');
  const prod = await health(AB, env);
  assert.equal(prod.headers.get('access-control-allow-origin'), null);
});

test('parseSiteOrigins: unset → the production default; trailing slashes trimmed', () => {
  assert.deepEqual(parseSiteOrigins(undefined), DEFAULT_SITE_ORIGINS);
  assert.deepEqual(parseSiteOrigins('https://a.example/, https://b.example'), [
    'https://a.example',
    'https://b.example',
  ]);
  assert.deepEqual(parseSiteOrigins(''), []);
});

test('estateCheckMode: affirmative values only — a typo reads as off', () => {
  assert.equal(estateCheckMode('shadow'), 'shadow');
  assert.equal(estateCheckMode('enforce'), 'enforce');
  for (const raw of [undefined, '', 'off', 'Shadow', 'ENFORCE', 'on', 'true']) {
    assert.equal(estateCheckMode(raw), 'off', String(raw));
  }
});

test('parseOwnerEmails: comma-split, trimmed, lowercased — every consumer the same way', () => {
  assert.deepEqual(parseOwnerEmails(' A@Example.com , b@example.com,'), [
    'a@example.com',
    'b@example.com',
  ]);
  assert.deepEqual(parseOwnerEmails(undefined), []);
});

test('GET /api/health names the service and the current estate-check mode', async () => {
  const res = await app.request('/api/health', {}, { ESTATE_CHECK: 'shadow' });
  const body = (await res.json()) as { ok: boolean; service: string; estate_check: string };
  assert.equal(body.ok, true);
  assert.equal(body.service, 'audiobook-worker');
  assert.equal(body.estate_check, 'shadow');
});
