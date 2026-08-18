import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SESSION_ORIGINS,
  appTokenFor,
  parseAdminOrigins,
  parseOwnerEmails,
  parseSessionOrigins,
  type Env,
} from '../src/env.js';

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
    ESTATE_APP_TOKEN_AUDIOBOOK: 'ab',
    ESTATE_APP_TOKEN_LIBRARY2: 'lib2',
  } as unknown as Env;
  assert.equal(appTokenFor(env, 'library'), 'lib');
  assert.equal(appTokenFor(env, 'games'), 'games');
  assert.equal(appTokenFor(env, 'index'), 'idx');
  assert.equal(appTokenFor(env, 'audiobook'), 'ab');
  assert.equal(appTokenFor(env, 'library2'), 'lib2');
  assert.equal(appTokenFor({} as unknown as Env, 'library'), undefined);
  // The second library instance's token stays optional until its Worker env
  // is provisioned — unset means that door goes unanswered, never a crash.
  assert.equal(appTokenFor({} as unknown as Env, 'library2'), undefined);
});

// ---------------------------------------------------------------------------
// The session-origin allow-list. Added 2026-08-18 with Phase 3 adoption,
// because a surface missing from this list fails SILENTLY: its preflight
// comes back with no Access-Control-Allow-Origin, the browser refuses the
// call, and the page's bootstrap reads that as "no session" and stays quiet.
// A silent failure is exactly the kind that ships unnoticed, so the list is
// pinned rather than trusted.
// ---------------------------------------------------------------------------

test('parseSessionOrigins: unset falls back to the production estate origins, never to empty', () => {
  assert.deepEqual(parseSessionOrigins(undefined), DEFAULT_SESSION_ORIGINS);
  // Unset must NOT mean "allow nothing" — the routes are correct out of the
  // box, before any operator has ever set a var.
  assert.ok(parseSessionOrigins(undefined).length > 0);
});

test('parseSessionOrigins: every live estate surface is admitted, including the three added in Phase 3', () => {
  const allowed = parseSessionOrigins(undefined);
  for (const origin of [
    'https://heygabi.ai',
    'https://www.heygabi.ai',      // serves the apex with its own 200, not a redirect
    'https://audiobooks.heygabi.ai',
    'https://ebooks.heygabi.ai',   // the ebooks door — the owner's original complaint
    'https://library.heygabi.ai',
    'https://padhard.heygabi.ai',  // the library's friend instance, same bundle
    'https://boardgames.heygabi.ai',
  ]) {
    assert.ok(allowed.includes(origin), `${origin} must be able to call the session routes`);
  }
});

test('parseSessionOrigins: the list is exact-origin and admits nothing wider', () => {
  const allowed = parseSessionOrigins(undefined);
  // No wildcard, no bare registrable domain, no scheme-relative entry — a
  // credentialed CORS surface must never admit a pattern.
  assert.ok(!allowed.includes('*'));
  assert.ok(!allowed.some((o) => o.includes('*')));
  assert.ok(allowed.every((o) => o.startsWith('https://')));
  // A look-alike domain outside the estate must not match by suffix accident.
  assert.ok(!allowed.includes('https://heygabi.ai.evil.example'));
  assert.ok(!allowed.includes('http://heygabi.ai'));
});

test('parseSessionOrigins: an explicit var overrides the default entirely (dev can narrow it)', () => {
  assert.deepEqual(parseSessionOrigins('https://heygabi.ai'), ['https://heygabi.ai']);
  // An explicitly EMPTY var means "admit nothing", which is a legitimate
  // way to switch the feature off without a redeploy of the clients.
  assert.deepEqual(parseSessionOrigins(''), []);
});
