/**
 * The docs-backup ledger (2026-10-02) — how the off-Cloudflare mirror learns
 * the `docs/*` keys no workflow run logs. Until it existed the mirror printed
 * `NO complete generation` for all four docs stores on every cycle since
 * 2026-08-21 and mirrored none of them. lib/docs-backup-ledger.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { appendLedger, latestFromLedger, readLedger } from '../lib/docs-backup-ledger.mjs';

const SHA = (c) => c.repeat(64);
const entry = (key, c = 'a') => ({ key, bytes: 1234, sha256: SHA(c), written_at: '2026-10-02T10:00:00Z' });

const tmp = () => join(mkdtempSync(join(tmpdir(), 'ledger-')), 'sub', 'docs-backup-ledger.jsonl');

test('append then read round-trips, creating the directory', () => {
  const p = tmp();
  appendLedger(p, entry('docs/audiobook_catalog/2026-10-02T10-00-01Z.json.gz'));
  appendLedger(p, entry('docs/library_catalog/2026-10-02T10-00-03Z.json.gz', 'b'));
  const { entries, bad } = readLedger(p);
  assert.equal(bad, 0);
  assert.deepEqual(entries.map((e) => e.key), [
    'docs/audiobook_catalog/2026-10-02T10-00-01Z.json.gz',
    'docs/library_catalog/2026-10-02T10-00-03Z.json.gz',
  ]);
});

test('the ledger refuses a key that is not a docs backup', () => {
  const p = tmp();
  assert.throws(() => appendLedger(p, entry('d1/estate_auth/20261002T100000Z.sql')), /non-docs key/);
  assert.throws(() => appendLedger(p, entry('docs/../escape/x.json.gz')), /non-docs key/);
});

test('a missing ledger reads as empty, not as an error', () => {
  assert.deepEqual(readLedger(join(tmpdir(), 'no-such-dir-xyz', 'ledger.jsonl')), { entries: [], bad: 0 });
});

test('a torn or foreign line is skipped and counted, never fatal', () => {
  const p = tmp();
  appendLedger(p, entry('docs/catalog-platform/2026-10-02T10-00-00Z.json.gz'));
  appendFileSync(p, '{"key":"docs/catalog-platform/2026-10-03T10-0\n', 'utf8'); // torn write
  appendFileSync(p, `${JSON.stringify({ key: 'r2/game-covers/x.tar.gz', bytes: 1, sha256: SHA('c') })}\n`);
  appendFileSync(p, `${JSON.stringify({ key: 'docs/x/2026-10-02T10-00-00Z.json.gz', bytes: 0, sha256: SHA('c') })}\n`);
  const { entries, bad } = readLedger(p);
  assert.equal(entries.length, 1);
  assert.equal(bad, 3);
});

test('latestFromLedger picks the newest generation per docs store and ignores other kinds', () => {
  const entries = [
    entry('docs/audiobook_catalog/2026-10-01T10-00-01Z.json.gz', 'a'),
    entry('docs/audiobook_catalog/2026-10-02T10-00-01Z.json.gz', 'b'),
    entry('docs/board_game_catalog/2026-10-02T10-00-05Z.json.gz', 'c'),
  ];
  const found = latestFromLedger(
    ['d1/estate_auth', 'docs/audiobook_catalog', 'docs/board_game_catalog', 'docs/library_catalog'],
    entries,
  );
  assert.deepEqual([...found.keys()].sort(), ['docs/audiobook_catalog', 'docs/board_game_catalog']);
  const a = found.get('docs/audiobook_catalog');
  assert.deepEqual(a.keys, ['docs/audiobook_catalog/2026-10-02T10-00-01Z.json.gz']);
  assert.equal(a.stamp, '2026-10-02T10-00-01Z');
  assert.equal(a.sha256[a.keys[0]], SHA('b'));
  assert.equal(a.runId, 'ledger');
  // A store with no entry stays unsatisfied — the mirror names it.
  assert.equal(found.has('docs/library_catalog'), false);
});

test('a prefix match is exact to the store — docs/x does not claim docs/x2', () => {
  const found = latestFromLedger(['docs/x'], [entry('docs/x2/2026-10-02T10-00-00Z.json.gz')]);
  assert.equal(found.size, 0);
});

test('backup-docs.mjs ledgers only AFTER the put, and the mirror reads the same file', () => {
  const backup = readFileSync(new URL('../backup-docs.mjs', import.meta.url), 'utf8');
  const put = backup.indexOf("'r2', 'object', 'put'");
  const ledger = backup.indexOf('appendLedger(LEDGER_PATH');
  assert.ok(put > 0 && ledger > put, 'the ledger must be written after the upload, never before');
  assert.match(backup, /'\.local', 'docs-backup-ledger\.jsonl'/);

  const mirror = readFileSync(new URL('../mirror-estate-backups.mjs', import.meta.url), 'utf8');
  assert.match(mirror, /'\.local', 'docs-backup-ledger\.jsonl'/);
  assert.match(mirror, /sha256 mismatch against the docs ledger/);
});
