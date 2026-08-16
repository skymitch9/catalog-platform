import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PIPELINE_REQUESTS_COLLECTION,
  pipelineRequestFields,
  PIPELINE_STEPS,
  PIPELINE_STEP_KEYS,
  FORCE_UPLOAD_STEP,
  isPipelineStepKey,
  pipelineStepRequestFields,
  pipelineBusyReason,
} from '../src/ops.js';

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

// ---------------------------------------------------------------------------
// Fine-grained step controls (owner ask 2026-08-16) — PIPELINE_STEPS MUST
// mirror audiobook_catalog's scripts/sync_to_drive.py STEP_INFO exactly:
// same 7 keys, same "kind" classification, since that file's tests pin the
// same table independently (tests/test_pipeline_steps.py
// test_step_info_classification_matches_the_owner_brief). No shared module
// between the two repos, so both sides are pinned separately on purpose.
// ---------------------------------------------------------------------------

test('PIPELINE_STEPS: exactly the 7 pipeline_status stages, classified per the owner brief', () => {
  assert.deepEqual(PIPELINE_STEP_KEYS, ['audit', 'sort', 'detect', 'folders', 'upload', 'catalog', 'publish']);
  const kinds = Object.fromEntries(PIPELINE_STEP_KEYS.map((k) => [k, PIPELINE_STEPS[k].kind]));
  assert.deepEqual(kinds, {
    audit: 'read-only',
    sort: 'mutating',
    detect: 'read-only',
    folders: 'mutating',
    upload: 'mutating',
    catalog: 'publishing',
    publish: 'publishing',
  });
});

test('FORCE_UPLOAD_STEP is not a key in PIPELINE_STEPS — it is not a pipeline stage', () => {
  assert.equal(FORCE_UPLOAD_STEP, 'force-upload-server');
  assert.ok(!(FORCE_UPLOAD_STEP in PIPELINE_STEPS));
});

test('isPipelineStepKey: admits exactly the 7 keys, refuses everything else including the force-upload marker', () => {
  for (const key of PIPELINE_STEP_KEYS) assert.equal(isPipelineStepKey(key), true);
  assert.equal(isPipelineStepKey(FORCE_UPLOAD_STEP), false);
  assert.equal(isPipelineStepKey('bogus'), false);
  assert.equal(isPipelineStepKey(''), false);
  assert.equal(isPipelineStepKey(undefined), false);
  assert.equal(isPipelineStepKey(null), false);
  assert.equal(isPipelineStepKey(42), false);
});

test('pipelineStepRequestFields: same three base fields as pipelineRequestFields, plus step', () => {
  const fields = pipelineStepRequestFields({
    token: 'a'.repeat(32),
    requestedBy: 'estate-ops:owner@example.com',
    nowIso: '2026-08-16T12:00:00.000Z',
    step: 'upload',
  });
  assert.deepEqual(fields, {
    token: { stringValue: 'a'.repeat(32) },
    requestedAt: { stringValue: '2026-08-16T12:00:00.000Z' },
    requestedBy: { stringValue: 'estate-ops:owner@example.com' },
    step: { stringValue: 'upload' },
  });
});

test('pipelineStepRequestFields: accepts the force-upload marker as `step` too', () => {
  const fields = pipelineStepRequestFields({
    token: 'a'.repeat(32),
    requestedBy: 'estate-ops:owner@example.com',
    nowIso: '2026-08-16T12:00:00.000Z',
    step: FORCE_UPLOAD_STEP,
  });
  assert.equal(fields.step.stringValue, 'force-upload-server');
});

// ---------------------------------------------------------------------------
// pipelineBusyReason — the live interlock check against pipeline_status/
// current. Pure: fed a Firestore-REST-shaped document (or a missing/garbage
// one), never a network call.
// ---------------------------------------------------------------------------

function fsDoc(fields: Record<string, string>) {
  return { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: v }])) };
}

test('pipelineBusyReason: null/missing doc -> not busy (fails open)', () => {
  assert.equal(pipelineBusyReason(null), null);
  assert.equal(pipelineBusyReason(undefined), null);
  assert.equal(pipelineBusyReason({}), null);
  assert.equal(pipelineBusyReason({ fields: {} }), null);
});

test('pipelineBusyReason: a finished run (success/partial/failed/skipped) -> not busy', () => {
  for (const state of ['success', 'partial', 'failed', 'skipped']) {
    assert.equal(pipelineBusyReason(fsDoc({ state })), null, `state=${state} should not be busy`);
  }
});

test('pipelineBusyReason: running -> busy, names the trigger and start time', () => {
  const reason = pipelineBusyReason(
    fsDoc({ state: 'running', trigger: 'manual-step:upload', startedAt: '2026-08-16T10:00:00Z' }),
  );
  assert.ok(reason);
  assert.match(reason!, /running/);
  assert.match(reason!, /manual-step:upload/);
  assert.match(reason!, /2026-08-16T10:00:00Z/);
});

test('pipelineBusyReason: deferred and blocked are also busy', () => {
  assert.ok(pipelineBusyReason(fsDoc({ state: 'deferred', trigger: 'scheduled', updatedAt: 't' })));
  assert.ok(pipelineBusyReason(fsDoc({ state: 'blocked', trigger: 'manual', startedAt: 't' })));
});

test('pipelineBusyReason: missing trigger/timestamp fields still produce a reason, never throw', () => {
  const reason = pipelineBusyReason(fsDoc({ state: 'running' }));
  assert.ok(reason);
  assert.match(reason!, /unknown/); // trigger falls back to "unknown"
});
