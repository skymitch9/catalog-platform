/**
 * ebook-lane.test.mjs — the /status ebook row's verdict, pinned.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE THE ROW WAS WRONG THREE TIMES AND SHIPPED EACH
 * TIME. Every previous fix was reasoned about in a comment and verified by
 * looking at the page later; the owner reported the same false amber on
 * 2026-08-16 (twice) and again on 2026-08-18. The rule this pins is his,
 * verbatim (docs/TODO.md, "Status-page expansion" item 0):
 *
 *   "A completed run with zero changes needed is GREEN. Yellow/amber is
 *    reserved for a run that TRIED to apply a change and could not (or partial
 *    failure); red for a failed run. No change is not a bug unless a change was
 *    trying to come through."
 *
 * The first test below is not a fixture anybody invented: it is the LIVE
 * payload measured on 2026-08-18 (run 20260818T150021 and the heartbeat that
 * audiobooks.heygabi.ai was actually serving), and against the code as it
 * shipped that morning it renders AMBER. That is the bug, captured.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EBOOK_PRODUCING_TRIGGERS,
  ebookLaneVerdict,
  ebookRunKind,
} from '../../sites/heygabi-home/public/status/lib/ebook-lane.js';
import { formatAge } from '../../sites/heygabi-home/public/status/lib/core.js';

const NOW = Date.parse('2026-08-18T19:52:48Z');

/** Measured off https://audiobooks.heygabi.ai/dev/ebooks_status.json, 2026-08-18. */
const LIVE_HEARTBEAT = {
  generated_at: '2026-08-17T16:21:03.871226Z',
  count: 168,
  needs_human_cover_count: 0,
  note: 'freshness only — the shelf itself is gated',
};

/** Measured off pipeline_status/current the same minute — a QUIET run: trigger
 *  `scheduled`, every step `done`, `uploaded: 0`, and an ebook count that
 *  matches the published heartbeat exactly. Nothing changed and nothing failed. */
const LIVE_QUIET_RUN = {
  trigger: 'scheduled',
  state: 'success',
  startedAt: '2026-08-18T15:00:21.957279+00:00',
  finishedAt: '2026-08-18T15:01:39.990757+00:00',
  steps: [
    { key: 'audit', state: 'done', detail: '' },
    { key: 'sort', state: 'done', detail: '0 sorted, 0 companions filed' },
    { key: 'detect', state: 'done', detail: '12 to upload' },
    { key: 'folders', state: 'done', detail: '412 folders' },
    { key: 'upload', state: 'done', detail: '0 uploaded, 0 already there, 12 misplaced, 0 failed' },
    { key: 'catalog', state: 'done', detail: '' },
    { key: 'publish', state: 'done', detail: 'index 1246 rows (1078 audiobook + 168 ebook)' },
  ],
  summary: {
    ebookManifestAt: '2026-08-18T15:00:53.106407Z',
    ebookCount: 168,
    uploaded: 0,
    toUpload: 12,
    misplaced: 12,
    failed: 0,
  },
};

const verdict = (over = {}) =>
  ebookLaneVerdict({
    heartbeat: LIVE_HEARTBEAT,
    pipeStatus: LIVE_QUIET_RUN,
    prodStampMs: NaN,
    now: NOW,
    formatAge,
    ...over,
  });

// ---------------------------------------------------------------------------
// The owner's rule
// ---------------------------------------------------------------------------

test('⚠️ THE REGRESSION: a real quiet run — nothing to change — is GREEN', () => {
  // The exact live payload of 2026-08-18. The shipped code compared
  // summary.ebookManifestAt (15:00 today) against the heartbeat's generated_at
  // (16:21 yesterday), found them 22h apart, and painted amber saying "a
  // publish that did not land". Nothing had failed; STEP 5.8 simply never runs
  // when a run uploads nothing, so the heartbeat is not rewritten.
  const v = verdict();
  assert.equal(v.state, 'ok');
  assert.match(v.detail, /168 ebooks published/);
  assert.match(v.detail, /matches the 168 the last run built/);
  // And it must SAY why an older stamp is fine, or the next reader re-opens
  // this same bug from the timestamps printed on screen.
  assert.match(v.note, /found nothing to change/);
  assert.match(v.note, /expected quiet state/);
});

test('a run that DID publish a change is green the same way — the two are indistinguishable, and should be', () => {
  const v = verdict({
    heartbeat: { ...LIVE_HEARTBEAT, generated_at: '2026-08-18T15:00:53.106407Z', count: 170 },
    pipeStatus: { ...LIVE_QUIET_RUN, summary: { ...LIVE_QUIET_RUN.summary, ebookCount: 170, uploaded: 2 } },
  });
  assert.equal(v.state, 'ok');
  assert.match(v.detail, /170 ebooks published/);
});

test('⚠️ AMBER IS RESERVED: a change that exists but has not reached readers', () => {
  // The run built a manifest of 170; the site still publishes 168. THIS is "a
  // change was trying to come through and could not" — the only case amber is
  // for on this lane.
  const v = verdict({
    pipeStatus: { ...LIVE_QUIET_RUN, summary: { ...LIVE_QUIET_RUN.summary, ebookCount: 170 } },
  });
  assert.equal(v.state, 'warn');
  assert.match(v.detail, /2 books apart/);
  assert.match(v.note, /a run with nothing to change renders green/);
});

test('the amber wording counts singular/plural and both directions', () => {
  const up = verdict({ pipeStatus: { ...LIVE_QUIET_RUN, summary: { ...LIVE_QUIET_RUN.summary, ebookCount: 169 } } });
  assert.equal(up.state, 'warn');
  assert.match(up.detail, /1 book apart/);
  // A shelf that SHRANK below what was built is the same class of fact.
  const down = verdict({ pipeStatus: { ...LIVE_QUIET_RUN, summary: { ...LIVE_QUIET_RUN.summary, ebookCount: 160 } } });
  assert.equal(down.state, 'warn');
  assert.match(down.detail, /8 books apart/);
});

// ---------------------------------------------------------------------------
// Unknowns stay unknown — no colour invented, and never a zero
// ---------------------------------------------------------------------------

test('⚠️ no recorded ebook count on a producing run is GREY, never amber', () => {
  // The pre-2026-08-16 pipeline, or a run that did not reach STEP 1b. The old
  // code aged the heartbeat against the run's start time here and painted
  // amber — the same false alarm one branch over.
  const { ebookCount, ...noCount } = LIVE_QUIET_RUN.summary;
  const v = verdict({ pipeStatus: { ...LIVE_QUIET_RUN, summary: noCount } });
  assert.equal(v.state, 'nodata');
  assert.match(v.detail, /cannot check it/);
  assert.match(v.note, /would be a guess/);
});

test('a run shape that skips the ebook step by design is GREEN, and says so', () => {
  const { ebookCount, ...noCount } = LIVE_QUIET_RUN.summary;
  const v = verdict({
    pipeStatus: { ...LIVE_QUIET_RUN, trigger: 'manual-rebuild', summary: noCount },
  });
  assert.equal(v.state, 'ok');
  assert.match(v.detail, /rebuild-only run/);
});

test('an unreadable pipeline doc is GREY, not green and not a second red', () => {
  // renderPipelineAudioRow already reports the outage. Two red rows for one
  // dead Firestore reads as two outages; green would assert health this row
  // cannot see.
  const v = verdict({ pipeStatus: null });
  assert.equal(v.state, 'nodata');
  assert.match(v.detail, /cannot read the pipeline status doc/);
});

test('a heartbeat with a broken shape is RED — that is a fault in what this row reads', () => {
  assert.equal(verdict({ heartbeat: { count: 168 } }).state, 'danger');
  assert.equal(verdict({ heartbeat: { generated_at: LIVE_HEARTBEAT.generated_at } }).state, 'danger');
  // ⚠️ A count of 0 is a NUMBER and must be judged, not treated as missing.
  const zero = verdict({
    heartbeat: { ...LIVE_HEARTBEAT, count: 0 },
    pipeStatus: { ...LIVE_QUIET_RUN, summary: { ...LIVE_QUIET_RUN.summary, ebookCount: 0 } },
  });
  assert.equal(zero.state, 'ok');
});

test('prod lag is words, never a colour', () => {
  const v = verdict({ prodStampMs: Date.parse('2026-08-10T00:00:00Z') });
  assert.equal(v.state, 'ok');
  assert.match(v.note, /Prod is .* behind \/dev\//);
  assert.match(v.note, /never a colour here/);
});

// ---------------------------------------------------------------------------
// ebookRunKind — kept from the third fix, still the source of the WORDS
// ---------------------------------------------------------------------------

test('ebookRunKind: what the run DID beats what it WAS', () => {
  const skipped = ebookRunKind('scheduled', [
    { key: 'detect', state: 'done', detail: '0 to upload' },
    { key: 'publish', state: 'skipped' },
  ]);
  assert.equal(skipped.produces, false);
  assert.match(skipped.label, /nothing to publish/);
  assert.match(skipped.label, /0 to upload/);
});

test('ebookRunKind: an unrecognised trigger says NOTHING rather than guessing', () => {
  assert.equal(ebookRunKind('something-new-upstream', []).produces, null);
  assert.equal(ebookRunKind('', []).produces, null);
  assert.equal(ebookRunKind('manual-step:catalog', []).produces, false);
  for (const t of EBOOK_PRODUCING_TRIGGERS) assert.equal(ebookRunKind(t, []).produces, true);
});
