/**
 * READ_ORIGINS — which PAGES may read `/api/*` from a browser (`readCors` in
 * src/index.ts), exercised through the REAL exported `app` so the CORS mount is
 * under test rather than assumed.
 *
 * ⚠️ THIS LIST IS ACCESS-INCREASING TO EDIT, AND THAT IS WHY IT HAS A TEST.
 * `https://padhard.heygabi.ai` was added on 2026-09-06 on the owner's explicit
 * "Yes" (00:5x Phoenix, item 3 of the sixteen); it had sat as an open ❓ in
 * docs/TODO.md since the 2026-09-05 multi-library survey precisely because
 * widening a CORS list is not a build's decision. A later sweep must not drop
 * it back out silently, and must not slip a sixth host in beside it silently
 * either — so the assertion is on the EXACT set, not on "padhard is present".
 *
 * ⚠️ `https://ebooks.heygabi.ai` was added LATER THE SAME DAY, on its own
 * explicit "1. Yes" (13:41 Phoenix) to the question *"ebooks.heygabi.ai into
 * the search Worker's allowed origins — yes or no?"*. It was deliberately left
 * out of the padhard change — the file said so in as many words — because he
 * had been asked about padhard only. ⚠️ Nothing on that host calls `/api/*`
 * today, so this entry is ahead of its consumer: the tests below prove the
 * Worker WOULD answer it, and no browser on ebooks has yet asked.
 *
 * ⚠️ The authority is `wrangler.toml`, which no runtime can import, so this
 * file PARSES it — the same shape as apps/auth-worker/test/backups.test.ts
 * parsing backup.yml. A value hard-coded here would drift from the deployed one
 * and the test would keep passing.
 *
 * ⚠️ What this does NOT test: what the index RETURNS. Widening this list widens
 * which pages may ask, never what a caller may see — visibility is decided
 * per-caller inside the Worker, and scope.test.ts / catalogs.test.ts own that.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app } from '../src/index.js';

const TOML = readFileSync(fileURLToPath(new URL('../wrangler.toml', import.meta.url)), 'utf8');

/** The deployed value, read off the file wrangler actually ships. */
function readOriginsFromToml(): string {
  const line = TOML.split(/\r?\n/).find((l) => l.trimStart().startsWith('READ_ORIGINS'));
  assert.ok(line, 'READ_ORIGINS must be set EXPLICITLY in wrangler.toml — when it was absent (2026-08-16) the code default applied, the apex alone, and both catalogs were CORS-blocked from the shared index');
  const m = /^\s*READ_ORIGINS\s*=\s*"([^"]*)"/.exec(line!);
  assert.ok(m, `READ_ORIGINS must be a plain double-quoted string: ${line}`);
  return m![1] ?? '';
}

const READ_ORIGINS = readOriginsFromToml();
const ORIGINS = READ_ORIGINS.split(',').map((s) => s.trim());

/** Enough env for `/api/catalogs`, which is anonymous-reachable by design. */
function anonEnv() {
  return {
    DB: { prepare: () => ({ bind: () => ({ async first() { return null; }, async all() { return { results: [] }; }, async run() { return { success: true }; } }) }) } as unknown as D1Database,
    ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    ESTATE_AUTH_URL: 'https://auth.test',
    READ_ORIGINS,
  };
}

async function preflight(path: string, origin: string) {
  return app.request(
    path,
    { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } },
    anonEnv(),
  );
}

test('⚠️ the deployed READ_ORIGINS is EXACTLY the six estate catalog hosts', () => {
  assert.deepEqual(ORIGINS, [
    'https://heygabi.ai',
    'https://library.heygabi.ai',
    'https://boardgames.heygabi.ai',
    'https://audiobooks.heygabi.ai',
    // ⚠️ Owner's explicit "Yes", 2026-09-06 00:5x Phoenix — Samantha's shelf
    // runs the SAME build as library.heygabi.ai, so it mounts <estate-search>
    // and could reach neither /api/catalogs nor /api/search from that host.
    'https://padhard.heygabi.ai',
    // ⚠️ Owner's explicit "1. Yes", 2026-09-06 13:41 Phoenix, asked as its own
    // question after the padhard widen deliberately left it out. Nothing on
    // that host calls the index yet — this is ahead of its consumer.
    'https://ebooks.heygabi.ai',
  ]);
});

test('⚠️ every entry is exact scheme+host — no wildcard, no trailing slash, no path', () => {
  // readCors does `allowed.includes(origin)` after trimming, and a browser
  // sends a bare scheme+host. Any of these would match nothing and fail SILENTLY
  // as "that site just cannot read the index".
  for (const o of ORIGINS) {
    assert.match(o, /^https:\/\/[a-z0-9.-]+$/, `${o} is not a bare https origin`);
    assert.ok(!o.includes('*'), `${o}: readCors has no wildcard support`);
    assert.ok(o.endsWith('.heygabi.ai') || o === 'https://heygabi.ai', `${o} is not an estate host — first-party only`);
  }
});

test('padhard gets the ACAO header on /api/catalogs — the thing the owner said yes to', async () => {
  const res = await preflight('/api/catalogs', 'https://padhard.heygabi.ai');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://padhard.heygabi.ai');
});

test('padhard gets it on /api/search too — the same mount serves both', async () => {
  const res = await preflight('/api/search?q=test', 'https://padhard.heygabi.ai');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://padhard.heygabi.ai');
});

test('ebooks gets the ACAO header on /api/catalogs — the thing the owner said "1. Yes" to', async () => {
  const res = await preflight('/api/catalogs', 'https://ebooks.heygabi.ai');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://ebooks.heygabi.ai');
});

test('ebooks gets it on /api/search too — the same mount serves both', async () => {
  const res = await preflight('/api/search?q=test', 'https://ebooks.heygabi.ai');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://ebooks.heygabi.ai');
});

test('every listed origin is echoed back, and only itself', async () => {
  for (const origin of ORIGINS) {
    const res = await preflight('/api/catalogs', origin);
    assert.equal(res.headers.get('access-control-allow-origin'), origin, `${origin} must be allowed`);
  }
});

test('🔴 AN ORIGIN THAT IS NOT ON THE LIST GETS NO ACAO HEADER AT ALL', async () => {
  for (const origin of [
    // ⚠️ `https://ebooks.heygabi.ai` used to sit here, as "an estate host,
    // deliberately not asked about yet". It was asked, and the answer was yes
    // (2026-09-06 13:41 Phoenix) — it now lives in the allowed set above.
    'https://evil.example.com',
    'https://ebooks.heygabi.ai.evil.example.com', // the newest entry gets the suffix trick too
    'http://ebooks.heygabi.ai', // wrong scheme, on the newest entry
    'https://heygabi.ai.evil.example.com', // a suffix trick — `includes` is exact, not a suffix match
    'http://heygabi.ai', // wrong scheme
    'https://heygabi.ai/', // trailing slash
  ]) {
    const res = await preflight('/api/catalogs', origin);
    assert.equal(res.headers.get('access-control-allow-origin'), null, `${origin} must NOT be allowed`);
  }
});
