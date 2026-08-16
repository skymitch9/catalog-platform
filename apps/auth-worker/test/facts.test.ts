/**
 * facts.ts — GET/POST /api/estate/facts/:slug.
 *
 * validateFactsInput() is pure, so it is exercised directly and thoroughly —
 * same idiom as ops.test.ts's pipelineRequestFields() and backups.test.ts's
 * summarizeBackups(). The requireDevops() gate itself (401/403) is NOT
 * re-verified against a bare Hono stub here, for the same reason
 * backups.test.ts and docs.ts give: resolveIdentity() needs a fully
 * configured Firebase verifier context to answer 401/403 the way production
 * does; a stub env with no verifier config answers 500 misconfigured
 * instead, which would prove nothing about the real gate. That gate is
 * exercised live in tools/estate-probes (tokenless -> 401 + CORS) and is the
 * same shared middleware every other requireDevops() route already relies
 * on. What IS asserted below against the live route: KV-unbound answers a
 * non-2xx (never a bare crash) even before identity is resolved, mirroring
 * backups.test.ts's own honest scope.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACT_FIELDS, validateFactsInput, factsRoutes } from '../src/facts.js';

test('FACT_FIELDS: the exact five fields the form and §0 table both key on', () => {
  assert.deepEqual([...FACT_FIELDS].sort(), ['disk_free', 'hardware', 'library_size', 'notes', 'os'].sort());
});

test('validateFactsInput: a full, well-formed submission passes and defaults nothing away', () => {
  const result = validateFactsInput({
    hardware: 'Dell OptiPlex 7060, i5-8500, 16GB RAM',
    os: 'Ubuntu Server 24.04 LTS',
    disk_free: '612 GB free',
    library_size: '~310 GB',
    notes: 'Second NIC is flaky, use the onboard one.',
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.fields.hardware, 'Dell OptiPlex 7060, i5-8500, 16GB RAM');
    assert.equal(result.fields.notes, 'Second NIC is flaky, use the onboard one.');
  }
});

test('validateFactsInput: missing/null fields default to empty string, not an error', () => {
  const result = validateFactsInput({ hardware: 'a box', os: null });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.fields.hardware, 'a box');
    assert.equal(result.fields.os, '');
    assert.equal(result.fields.disk_free, '');
    assert.equal(result.fields.library_size, '');
    assert.equal(result.fields.notes, '');
  }
});

test('validateFactsInput: an empty object is legal (a "clear the form" submission)', () => {
  const result = validateFactsInput({});
  assert.ok(result.ok);
  if (result.ok) {
    for (const field of FACT_FIELDS) assert.equal(result.fields[field], '');
  }
});

test('validateFactsInput: refuses a non-object body (array, string, number, null)', () => {
  for (const bad of [null, [1, 2], 'nope', 42]) {
    const result = validateFactsInput(bad);
    assert.equal(result.ok, false);
  }
});

test('validateFactsInput: unknown top-level keys are refused (strict body, the /seen and /users precedent)', () => {
  const result = validateFactsInput({ hardware: 'a box', extra: 'not allowed' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /unknown field/);
});

test('validateFactsInput: a non-string field value is refused', () => {
  const result = validateFactsInput({ hardware: 12345 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /hardware must be a string/);
});

test('validateFactsInput: refuses a value over its field\'s max length', () => {
  const result = validateFactsInput({ hardware: 'x'.repeat(201) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /hardware exceeds 200 characters/);

  const okAtLimit = validateFactsInput({ hardware: 'x'.repeat(200) });
  assert.ok(okAtLimit.ok);
});

test('validateFactsInput: notes has its own, larger max length (2000)', () => {
  const tooLong = validateFactsInput({ notes: 'x'.repeat(2001) });
  assert.equal(tooLong.ok, false);
  const atLimit = validateFactsInput({ notes: 'x'.repeat(2000) });
  assert.ok(atLimit.ok);
});

test('validateFactsInput: refuses control characters', () => {
  const result = validateFactsInput({ hardware: 'a box\x07with a bell' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /control character/);
});

test('validateFactsInput: single-line fields refuse embedded newlines/carriage returns', () => {
  for (const field of ['hardware', 'os', 'disk_free', 'library_size'] as const) {
    const withNewline = validateFactsInput({ [field]: 'line one\nline two' });
    assert.equal(withNewline.ok, false, `${field} should refuse \\n`);
    const withCr = validateFactsInput({ [field]: 'line one\rline two' });
    assert.equal(withCr.ok, false, `${field} should refuse \\r`);
  }
});

test('validateFactsInput: notes MAY contain newlines — it is the one multi-line field', () => {
  const result = validateFactsInput({ notes: 'first line\nsecond line\nthird line' });
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.fields.notes, 'first line\nsecond line\nthird line');
});

test('GET /estate/facts/:slug: bad slug shape is refused before touching KV or identity', async () => {
  // A slug with an uppercase letter/path separator never reaches
  // requireDevops() meaningfully differently, but the route's own SLUG_RE
  // check runs first regardless — assert the route never 500s on a
  // malformed param.
  const res = await factsRoutes.request(
    '/estate/facts/Not-A-Valid-Slug!',
    { headers: { authorization: 'Bearer whatever' } },
    { OWNER_EMAILS: '', DB: undefined as unknown } as never,
  );
  assert.ok(res.status >= 400);
});

test('GET /estate/facts/shelf: no verifier context configured -> a non-2xx, never a bare crash', async () => {
  const res = await factsRoutes.request(
    '/estate/facts/shelf',
    { headers: { authorization: 'Bearer whatever' } },
    { OWNER_EMAILS: '', DB: undefined as unknown } as never,
  );
  assert.ok(res.status >= 400);
});

test('POST /estate/facts/shelf: no verifier context configured -> a non-2xx, never a bare crash', async () => {
  const res = await factsRoutes.request(
    '/estate/facts/shelf',
    {
      method: 'POST',
      headers: { authorization: 'Bearer whatever', 'content-type': 'application/json' },
      body: JSON.stringify({ hardware: 'a box' }),
    },
    { OWNER_EMAILS: '', DB: undefined as unknown } as never,
  );
  assert.ok(res.status >= 400);
});
