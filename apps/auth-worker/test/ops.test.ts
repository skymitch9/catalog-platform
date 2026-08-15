import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PIPELINE_REQUESTS_COLLECTION, pipelineRequestFields } from '../src/ops.js';

// ---------------------------------------------------------------------------
// pipelineRequestFields — must match audiobook_catalog's own contract:
//   firestore.rules validPipelineRequest() (token 16–200 chars, requestedAt
//   a string, requestedBy a string ≤80 chars) and the shape
//   site/pipeline-status.js requestRun() writes via addDoc().
// ---------------------------------------------------------------------------

test('pipelineRequestFields: writes the same three keys the admin panel writes', () => {
  const fields = pipelineRequestFields({
    token: 'a'.repeat(32),
    requestedBy: 'estate-ops:owner@example.com',
    nowIso: '2026-08-15T12:00:00.000Z',
  });
  assert.deepEqual(fields, {
    token: { stringValue: 'a'.repeat(32) },
    requestedAt: { stringValue: '2026-08-15T12:00:00.000Z' },
    requestedBy: { stringValue: 'estate-ops:owner@example.com' },
  });
});

test('pipelineRequestFields: requestedBy is truncated to 80 chars — validPipelineRequest() refuses longer', () => {
  const long = 'estate-ops:' + 'x'.repeat(200) + '@example.com';
  const fields = pipelineRequestFields({ token: 'a'.repeat(20), requestedBy: long, nowIso: 'now' });
  assert.equal(fields.requestedBy.stringValue.length, 80);
  assert.equal(fields.requestedBy.stringValue, long.slice(0, 80));
});

test('pipelineRequestFields: requestedAt is passed through verbatim as an ISO string field', () => {
  const nowIso = new Date().toISOString();
  const fields = pipelineRequestFields({ token: 'x'.repeat(16), requestedBy: 'a', nowIso });
  assert.equal(fields.requestedAt.stringValue, nowIso);
  assert.ok(!Number.isNaN(Date.parse(fields.requestedAt.stringValue)));
});

test('PIPELINE_REQUESTS_COLLECTION: unconditionally prod, no lane suffix — matches the admin panel client', () => {
  assert.equal(PIPELINE_REQUESTS_COLLECTION, 'pipeline_requests');
});
