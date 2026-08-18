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
 * ⚠️ THE FIXTURES ARE NOT INVENTED. They are the LIVE payload measured on
 * 2026-08-18: run 20260818T150021 out of pipeline_status/current, and the
 * heartbeat audiobooks.heygabi.ai was actually serving that minute.
 *
 * ⚠️ AND THAT PAYLOAD IS AMBER, ON PURPOSE. The first pass of this fix read the
 * identical counts (168 built, 168 published) as "nothing changed, so green".
 * It was the wrong lesson: the pipeline had gated its publish steps on
 * `uploaded_count > 0` and was silently skipping them, so the row had found a
 * REAL defect (since fixed at source). The owner's "no change is not a bug"
 * rule lives in the GREEN branch's WORDS — see the second test — and in the
 * greys below, which replace colours that were never measurements at all.
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

test('⚠️ THE READING THAT FOUND A REAL PIPELINE DEFECT stays AMBER', () => {
  // The live payload of 2026-08-18. The counts are identical (168 published,
  // 168 built) and it is STILL amber, deliberately: sync_to_drive.py gated its
  // publish steps on `uploaded_count > 0`, so this run built a manifest and
  // silently skipped publishing it. The row was right and the pipeline was
  // wrong. An earlier pass of this fix turned this green on the "nothing
  // changed" reasoning and would have hidden the defect the row had found.
  const v = verdict();
  assert.equal(v.state, 'warn');
  assert.match(v.detail, /built a NEWER manifest than the one published/);
  // The words must separate "nothing is missing YET" from "readers are missing
  // books", because the next action differs.
  assert.match(v.note, /no reader is missing a book yet/);
  assert.match(v.note, /the publish step did not land/);
  assert.match(v.note, /Do NOT soften this to green/);
});

test('⚠️ THE OWNER’S RULE: a run that DID publish and changed nothing is GREEN, and says so', () => {
  // The state the pipeline now reaches every run since the source fix: the
  // manifest published, and the shelf happened not to change. Green — and the
  // note has to SAY that, which is the sentence that was missing.
  const v = verdict({
    heartbeat: { ...LIVE_HEARTBEAT, generated_at: LIVE_QUIET_RUN.summary.ebookManifestAt },
  });
  assert.equal(v.state, 'ok');
  assert.match(v.detail, /published manifest is the one the last run built/);
  assert.match(v.note, /This run had nothing new to add, and that is green/);
  assert.match(v.note, /is not a warning/);
});

test('a run that published a real change is green without the no-change sentence', () => {
  const v = verdict({
    heartbeat: { ...LIVE_HEARTBEAT, generated_at: LIVE_QUIET_RUN.summary.ebookManifestAt, count: 170 },
    pipeStatus: { ...LIVE_QUIET_RUN, summary: { ...LIVE_QUIET_RUN.summary, ebookCount: 170, uploaded: 2 } },
  });
  assert.equal(v.state, 'ok');
  assert.doesNotMatch(v.note, /nothing new to add/);
});

test('⚠️ when the stamps differ AND the counts differ, the words say readers are missing books', () => {
  const v = verdict({
    pipeStatus: { ...LIVE_QUIET_RUN, summary: { ...LIVE_QUIET_RUN.summary, ebookCount: 170 } },
  });
  assert.equal(v.state, 'warn');
  assert.match(v.detail, /2 books apart/);
  assert.match(v.note, /readers are missing books/);
});

test('the missing-books wording counts singular/plural and both directions', () => {
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

test('⚠️ no recorded BUILD TIME on a producing run is GREY, never amber', () => {
  // The pre-2026-08-16 pipeline, or a run that never reached STEP 1b. Without
  // summary.ebookManifestAt there is nothing to compare the published heartbeat
  // against. The OLD code aged the heartbeat against the run's START TIME here
  // and painted amber — a guess dressed as a measurement, and the one false
  // alarm on this lane that was genuinely the page's own fault.
  const { ebookManifestAt, ...noStamp } = LIVE_QUIET_RUN.summary;
  const v = verdict({ pipeStatus: { ...LIVE_QUIET_RUN, summary: noStamp } });
  assert.equal(v.state, 'nodata');
  assert.match(v.detail, /cannot check it/);
  assert.match(v.note, /would be a guess/);
});

test('⚠️ a missing COUNT does not stop the stamp check — that check stands alone', () => {
  // Losing `ebookCount` costs the sharper wording, not the verdict: whether the
  // built manifest reached the site is answerable from the stamps by
  // themselves, and this row must not go quiet just because one field is gone.
  const { ebookCount, ...noCount } = LIVE_QUIET_RUN.summary;
  const stale = verdict({ pipeStatus: { ...LIVE_QUIET_RUN, summary: noCount } });
  assert.equal(stale.state, 'warn');
  const published = verdict({
    heartbeat: { ...LIVE_HEARTBEAT, generated_at: LIVE_QUIET_RUN.summary.ebookManifestAt },
    pipeStatus: { ...LIVE_QUIET_RUN, summary: noCount },
  });
  assert.equal(published.state, 'ok');
  // ...and with no count it cannot claim "nothing changed", so it does not.
  assert.match(published.note, /nothing new to add/, 'uploaded: 0 is what says this, not the count');
});

test('a run shape that skips the ebook step by design is GREEN, and says so', () => {
  const { ebookCount, ebookManifestAt, ...bare } = LIVE_QUIET_RUN.summary;
  const v = verdict({
    pipeStatus: { ...LIVE_QUIET_RUN, trigger: 'manual-rebuild', summary: bare },
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
  // ⚠️ A count of 0 is a NUMBER and must be JUDGED, not treated as a missing
  // field. An empty shelf that published correctly is green.
  const zero = verdict({
    heartbeat: { ...LIVE_HEARTBEAT, count: 0, generated_at: LIVE_QUIET_RUN.summary.ebookManifestAt },
    pipeStatus: { ...LIVE_QUIET_RUN, summary: { ...LIVE_QUIET_RUN.summary, ebookCount: 0 } },
  });
  assert.equal(zero.state, 'ok');
  assert.match(zero.detail, /0 ebooks published/);
});

test('prod lag is words, never a colour', () => {
  const v = verdict({
    heartbeat: { ...LIVE_HEARTBEAT, generated_at: LIVE_QUIET_RUN.summary.ebookManifestAt },
    prodStampMs: Date.parse('2026-08-10T00:00:00Z'),
  });
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
