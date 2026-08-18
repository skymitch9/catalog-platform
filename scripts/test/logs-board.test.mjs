/**
 * logs-board.test.mjs — the pushed log tails behind "click into the health check".
 *
 * Two properties matter more than the rest and both are about NOT reading
 * things: the tail must not read a 12 MB file to keep 40 lines, and the section
 * must not be able to crowd the rest of the board out of its 256 KB.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  LOG_SOURCES,
  MAX_LINES,
  MAX_SECTION_BYTES,
  buildLogsSection,
  readSource,
  tailFile,
} from '../lib/logs-board.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-board-'));
const write = (name, text) => { const p = path.join(tmp, name); fs.writeFileSync(p, text); return p; };

test('tailFile: keeps the LAST lines, in order', () => {
  const p = write('small.log', Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'));
  const t = tailFile(p, 3);
  assert.deepEqual(t.lines, ['line 8', 'line 9', 'line 10']);
  assert.equal(t.truncated, true, 'more lines existed than were kept');
});

test('tailFile: a file shorter than the window is not truncated', () => {
  const p = write('tiny.log', 'only line');
  const t = tailFile(p, MAX_LINES);
  assert.deepEqual(t.lines, ['only line']);
  assert.equal(t.truncated, false);
});

test('tailFile: trailing blank lines are dropped, interior ones survive', () => {
  const p = write('blanks.log', 'a\n\nb\n\n\n');
  assert.deepEqual(tailFile(p, MAX_LINES).lines, ['a', '', 'b']);
});

test('tailFile: CRLF logs (this is a Windows machine) split correctly', () => {
  const p = write('crlf.log', 'one\r\ntwo\r\nthree\r\n');
  assert.deepEqual(tailFile(p, MAX_LINES).lines, ['one', 'two', 'three']);
});

test('⚠️ tailFile READS FROM THE END — it must not load the whole file', () => {
  // pipeline_8h.log was 12,238,463 bytes when this was written. Reading it to
  // keep forty lines would pull twelve megabytes every fifteen minutes.
  const big = path.join(tmp, 'big.log');
  const line = `${'x'.repeat(200)}\n`;
  const stream = fs.createWriteStream(big);
  for (let i = 0; i < 20_000; i++) stream.write(`${i} ${line}`);
  stream.end();
  return new Promise((resolve) => stream.on('finish', () => {
    const size = fs.statSync(big).size;
    assert.ok(size > 4_000_000, `fixture should be multi-MB, was ${size}`);

    // Prove it by ACCOUNTING: wrap readSync and add up the bytes requested.
    let bytesRead = 0;
    const spy = {
      statSync: fs.statSync.bind(fs),
      openSync: fs.openSync.bind(fs),
      closeSync: fs.closeSync.bind(fs),
      readSync: (fd, buf, off, len, pos) => { bytesRead += len; return fs.readSync(fd, buf, off, len, pos); },
    };
    const t = tailFile(big, MAX_LINES, 64 * 1024, spy);
    assert.equal(t.lines.length, MAX_LINES);
    assert.ok(bytesRead <= 64 * 1024, `read ${bytesRead} bytes; the window is 64 KB`);
    assert.ok(bytesRead < size / 50, 'read a tiny fraction of the file');
    // The last line of the file is the last line of the tail.
    assert.match(t.lines[t.lines.length - 1], /^19999 /);
    resolve();
  }));
});

test('⚠️ the first line of a windowed tail is DROPPED — a half line reads as corruption', () => {
  const p = write('frag.log', `${'a'.repeat(500)}\nsecond line\nthird line`);
  const t = tailFile(p, MAX_LINES, 64); // window smaller than the first line
  assert.ok(!t.lines.some((l) => /^a+$/.test(l) && l.length < 500), 'no fragment of the long line survives');
  assert.equal(t.lines[t.lines.length - 1], 'third line');
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

test('⚠️ A MISSING LOG IS NOT AN EMPTY LOG', () => {
  const block = readSource(
    { id: 'x', label: 'X', row: 'r', file: 'nope.log', note: 'n' },
    tmp, fs, (a, b) => path.join(a, b),
  );
  assert.deepEqual(block.lines, []);
  assert.match(block.error, /no log file at this path/);
  assert.match(block.error, /may never have run/);
  // The block survives with its identity, so the source cannot vanish.
  assert.equal(block.label, 'X');
  assert.equal(block.row, 'r');
});

test('readSource: a real log carries its own clock and size', () => {
  write('real.log', 'hello\nworld');
  const block = readSource(
    { id: 'r', label: 'R', row: null, file: 'real.log', note: '' },
    tmp, fs, (a, b) => path.join(a, b),
  );
  assert.deepEqual(block.lines, ['hello', 'world']);
  assert.equal(block.error, null);
  assert.ok(Number.isFinite(block.file_bytes));
  assert.ok(Number.isFinite(Date.parse(block.modified_at)), 'the tail must carry its age or it is a trap');
});

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

test('⚠️ THE SECTION IS BOUNDED, and an over-budget source loses its LINES, not its row', () => {
  const noisy = `${'z'.repeat(300)}\n`.repeat(200);
  write('a.log', noisy);
  write('b.log', noisy);
  write('c.log', noisy);
  const specs = ['a', 'b', 'c'].map((k) => ({ id: k, label: k.toUpperCase(), row: null, file: `${k}.log`, note: '' }));
  const s = buildLogsSection(tmp, specs, fs, (x, y) => path.join(x, y));

  assert.equal(s.sources.length, 3, 'every source keeps a row');
  assert.ok(s.used_bytes <= MAX_SECTION_BYTES, `used ${s.used_bytes} of ${MAX_SECTION_BYTES}`);
  const dropped = s.sources.filter((x) => x.dropped_for_size);
  assert.ok(dropped.length >= 1, 'with three noisy logs at least one must be trimmed');
  for (const d of dropped) {
    assert.deepEqual(d.lines, []);
    assert.match(d.error, /size budget/);
    assert.ok(d.label, 'a trimmed source still says what it is');
  }
});

test('buildLogsSection: a quiet estate fits comfortably and says its budget', () => {
  write('q.log', 'one\ntwo\nthree');
  const s = buildLogsSection(tmp, [{ id: 'q', label: 'Q', row: null, file: 'q.log', note: '' }], fs, (x, y) => path.join(x, y));
  assert.equal(s.sources[0].lines.length, 3);
  assert.equal(s.max_lines, MAX_LINES);
  assert.equal(s.budget_bytes, MAX_SECTION_BYTES);
  assert.ok(Number.isFinite(Date.parse(s.as_of)));
});

test('the default sources point at real jobs and name the row each explains', () => {
  assert.ok(LOG_SOURCES.length >= 3);
  for (const s of LOG_SOURCES) {
    assert.ok(s.id && s.label && s.file, `${s.id} needs id/label/file`);
    assert.ok(s.file.startsWith('output_files/'), 'logs live under output_files/ on the home machine');
    assert.ok(s.note, 'every source says what the job DOES, for a reader who does not know');
  }
  // ⚠️ The row mapping is what makes this "click into the health check" rather
  // than a log page bolted on the side.
  assert.ok(LOG_SOURCES.some((s) => s.row === 'pipe-audio'), 'the pipeline row must be able to show its log');
});
