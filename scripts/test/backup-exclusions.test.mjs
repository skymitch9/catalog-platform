/**
 * Per-bucket prefix exclusions — the pure half.
 *
 * ⚠️ What these guard is a DATA-ABSENCE bug: every rule in
 * `scripts/lib/backup-exclusions.mjs` removes real objects from every future
 * backup, so the tests pin (a) that the rule that exists is the one the owner
 * decided on, (b) that a rule which matched nothing still REPORTS itself — the
 * no-silent-caps rule — and (c) that the accounting is exact, because the log
 * line and the manifest both quote these numbers as fact.
 *
 * The end-to-end half (the real `backup-r2.mjs` writing a real dump directory
 * with no `transcripts/` in it) is `backup-r2-exclusions.test.mjs`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCLUDED_PREFIXES,
  applyExclusions,
  exclusionLogLines,
  exclusionsFor,
} from '../lib/backup-exclusions.mjs';

test('⚠️ the ONLY exclusion is ebooks-gated/transcripts/, and it names its reason', () => {
  assert.deepEqual(Object.keys(EXCLUDED_PREFIXES), ['ebooks-gated']);
  const rules = EXCLUDED_PREFIXES['ebooks-gated'];
  assert.equal(rules.length, 1);
  assert.equal(rules[0].prefix, 'transcripts/');
  // The reason travels with the rule into the run log and the manifest. A rule
  // that stops explaining itself is a silent cap wearing a comment.
  assert.match(rules[0].reason, /owner decision 2026-08-19/);
  assert.match(rules[0].reason, /backup-restore\.md/);
  assert.match(rules[0].detail, /THIRD copy|third copy/i);
});

test('a bucket with no rules is returned untouched — same array, nothing skipped', () => {
  const objects = [{ key: 'a.jpg', size: 1 }, { key: 'b.jpg', size: 2 }];
  const { kept, skipped } = applyExclusions('library-covers', objects);
  assert.deepEqual(kept, objects);
  assert.deepEqual(skipped, []);
  assert.deepEqual(exclusionsFor('library-covers'), []);
});

test('⚠️ packs and manifests are KEPT, transcripts are dropped — the whole decision, in one assertion', () => {
  const listing = [
    { key: 'ebooks.json', size: 100 },
    { key: 'audio_manifest.json', size: 7 },
    { key: 'text/_index.json.gz', size: 1_000 },
    { key: 'text/some-book.jsonl.gz', size: 2_000 },
    { key: 'transcripts/some-book.json.gz', size: 5_000_000 },
    { key: 'transcripts/another-book.json.gz', size: 3_000_000 },
  ];
  const { kept, skipped } = applyExclusions('ebooks-gated', listing);

  assert.deepEqual(
    kept.map((o) => o.key),
    ['ebooks.json', 'audio_manifest.json', 'text/_index.json.gz', 'text/some-book.jsonl.gz'],
  );
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].count, 2);
  assert.equal(skipped[0].bytes, 8_000_000);
});

test('⚠️ a rule that matched NOTHING still reports itself — 0 is a measurement, not silence', () => {
  // The real failure this catches: someone renames the prefix (`transcripts/`
  // -> `transcript/`) and the exclusion silently stops applying. A log line
  // reading `0 object(s)` next to a prefix that used to hold thousands is
  // visible; an absent line is not.
  const { kept, skipped } = applyExclusions('ebooks-gated', [{ key: 'ebooks.json', size: 100 }]);
  assert.equal(kept.length, 1);
  assert.equal(skipped.length, 1, 'an unmatched rule was omitted from the accounting');
  assert.equal(skipped[0].count, 0);
  assert.equal(skipped[0].bytes, 0);
});

test('a key that merely CONTAINS the prefix is not excluded — prefix match, not substring', () => {
  const { kept, skipped } = applyExclusions('ebooks-gated', [
    { key: 'text/transcripts/notes.gz', size: 10 },
    { key: 'transcripts-old/x.gz', size: 10 },
    { key: 'transcripts/x.gz', size: 10 },
  ]);
  assert.deepEqual(kept.map((o) => o.key), ['text/transcripts/notes.gz', 'transcripts-old/x.gz']);
  assert.equal(skipped[0].count, 1);
});

test('a listing entry with no size is counted but adds no bytes — never NaN in the log', () => {
  const { skipped } = applyExclusions('ebooks-gated', [{ key: 'transcripts/x.gz' }]);
  assert.equal(skipped[0].count, 1);
  assert.equal(skipped[0].bytes, 0);
});

test('the log line names the bucket, the prefix, the counts AND the reason', () => {
  const { skipped } = applyExclusions('ebooks-gated', [
    { key: 'transcripts/a.gz', size: 4 },
    { key: 'ebooks.json', size: 1 },
  ]);
  const lines = exclusionLogLines('ebooks-gated', skipped);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /ebooks-gated: SKIPPING prefix "transcripts\/"/);
  assert.match(lines[0], /1 object\(s\), 4 bytes NOT backed up/);
  assert.match(lines[0], /owner decision 2026-08-19/);
  assert.match(lines[0], /backup-restore\.md/);
});
