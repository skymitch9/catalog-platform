import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appTokenFor, parseAdminOrigins, parseOwnerEmails, type Env } from '../src/env.js';

test('parseOwnerEmails lowercases, trims, drops empties', () => {
  assert.deepEqual(parseOwnerEmails(' A@B.C , x@y.z ,, '), ['a@b.c', 'x@y.z']);
  assert.deepEqual(parseOwnerEmails(undefined), []);
  assert.deepEqual(parseOwnerEmails(''), []);
});

// A single-entry list passing is not proof a MULTI-owner list works — the
// production var now carries two accounts (wrangler.toml, 2026-08-16: the
// owner's primary plus their second Google account, which owns the
// audiobook-catalog GCP project) and BOTH must come through as break-glass
// owners, independently trimmed/lowercased, order preserved, neither one
// swallowed by the other.
test('parseOwnerEmails: a two-account owner list keeps BOTH, each independently normalized', () => {
  const raw = '  Owner-Primary@Example.COM ,owner-second@EXAMPLE.com  ';
  const result = parseOwnerEmails(raw);
  assert.deepEqual(result, ['owner-primary@example.com', 'owner-second@example.com']);
  assert.equal(result.length, 2);
  assert.ok(result.includes('owner-primary@example.com'));
  assert.ok(result.includes('owner-second@example.com'));
});

test('parseAdminOrigins trims trailing slashes so origin matching is exact', () => {
  assert.deepEqual(parseAdminOrigins('https://heygabi.ai/, http://localhost:8080'), [
    'https://heygabi.ai',
    'http://localhost:8080',
  ]);
  assert.deepEqual(parseAdminOrigins(undefined), []);
});

test('appTokenFor maps each consumer to its own secret and nothing else', () => {
  const env = {
    ESTATE_APP_TOKEN_LIBRARY: 'lib',
    ESTATE_APP_TOKEN_GAMES: 'games',
    ESTATE_APP_TOKEN_INDEX: 'idx',
  } as unknown as Env;
  assert.equal(appTokenFor(env, 'library'), 'lib');
  assert.equal(appTokenFor(env, 'games'), 'games');
  assert.equal(appTokenFor(env, 'index'), 'idx');
  assert.equal(appTokenFor({} as unknown as Env, 'library'), undefined);
});
