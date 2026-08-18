/**
 * logs-board.mjs — the `logs` section of the agent board.
 *
 * Owner ask, 2026-08-18, verbatim: *"also lets make it so i can see logs for
 * some of this stuff if they arent working by clicking into the health
 * checks."* A failing row on /status should be able to show you why, instead of
 * sending you to the machine.
 *
 * ⚠️ THIS IS THE DEFERRED "log ring buffer" ITEM, DONE THE ONLY WAY IT CAN BE
 * FOR HOME-MACHINE JOBS. Workers can be tailed through Cloudflare; a scheduled
 * task on a PC in the owner's house cannot be reached by anything. So the tail
 * is PUSHED on the same 15-minute cadence as everything else, and the page
 * stamps it — a log block whose age is not shown is worse than none, because it
 * invites you to debug this morning's problem with last night's output.
 *
 * ⚠️ TAILING MUST NOT READ THE FILE. `pipeline_8h.log` was 12,238,463 bytes when
 * this was written and grows all day; `readFileSync` then `slice(-40)` would
 * pull twelve megabytes into memory every quarter of an hour to keep forty
 * lines. `tailFile()` seeks to the end and reads backwards in one bounded
 * chunk. The cost of the whole section is therefore fixed, not proportional to
 * how long the estate has been running.
 *
 * ⚠️ THE 256 KB BOARD CAP IS SHARED, AND TRIMMING IS THE PUSHER'S JOB (contract
 * §9). This section is bounded twice over — per source and in total — because
 * it is the one part of the board whose input is written by something that does
 * not know the cap exists. A runaway log must cost its own tail, never the
 * `processing` history sitting beside it.
 */

import fs from 'node:fs';

/** Lines kept per source. Forty is about a screen — enough to see a stack or a
 *  retry loop, not so much that the page becomes a log viewer. */
export const MAX_LINES = 40;
/** Bytes read from the end of a file. 64 KB comfortably holds 40 long lines. */
export const TAIL_BYTES = 64 * 1024;
/**
 * Hard ceiling on the whole section, so it can never crowd out the rest of the
 * board. Sources past it lose their LINES with the reason SAID, not hidden.
 *
 * ⚠️ 24 KB IS ARITHMETIC, NOT A ROUND NUMBER. The board's cap is 256 KB for
 * EVERYTHING, and the other sections are not small: `processing.history` was
 * measured at 44,393 bytes for 158 rows (~280 bytes each) with MAX_HISTORY set
 * to 500, which the contract notes is ~140 KB at full stretch, and `storage`
 * costs ~4 KB. A full history plus storage plus a 48 KB log section would land
 * near 240 KB and start refusing pushes on a night that ingested well — the
 * failure landing on the section with the LEAST to do with the cause. At 24 KB
 * the worst case stays around 210 KB. Four sources × 40 lines of ordinary log
 * output is ~20 KB, so this is a real ceiling rather than a theoretical one.
 */
export const MAX_SECTION_BYTES = 24 * 1024;

/**
 * The home-machine jobs worth seeing when something is wrong, each tied to the
 * /status row it explains. `row` is the id on the Health page — that mapping is
 * what makes this "click into the health check" rather than "a log page".
 */
export const LOG_SOURCES = [
  {
    id: 'archive',
    label: 'Audiobook archive upload',
    row: 'storage-archive',
    file: 'output_files/audio_archive.log',
    note: 'Uploads audiobook masters to the estate-audio bucket.',
  },
  {
    id: 'ingest',
    label: 'Book ingestion (GABI knowledge)',
    row: 'pipe-ingest',
    file: 'output_files/ingest_nightly.log',
    note: 'Transcribes and packs books into GABI’s knowledge base.',
  },
  {
    id: 'processing-push',
    label: 'Processing board push',
    row: null,
    file: 'output_files/processing_push.log',
    note: 'Publishes the GABI Knowledge page’s data every 15 minutes.',
  },
  {
    id: 'pipeline',
    label: 'Audiobook sync pipeline',
    row: 'pipe-audio',
    file: 'output_files/pipeline_8h.log',
    note: 'The 8-hourly Drive sync, catalog rebuild and publish.',
  },
];

/**
 * The last `maxLines` lines of a file, without reading the file.
 *
 * ⚠️ Reads at most `TAIL_BYTES` from the END. If the file is bigger, the first
 * line in the window is almost certainly a fragment, so it is DROPPED — a
 * half-line at the top of a log tail reads as corruption and sends people
 * hunting a parse error that does not exist.
 */
export function tailFile(filePath, maxLines = MAX_LINES, readBytes = TAIL_BYTES, fsImpl = fs) {
  const stat = fsImpl.statSync(filePath);
  const size = stat.size;
  const start = Math.max(0, size - readBytes);
  const length = size - start;

  let text = '';
  if (length > 0) {
    const buf = Buffer.alloc(length);
    const fd = fsImpl.openSync(filePath, 'r');
    try {
      fsImpl.readSync(fd, buf, 0, length, start);
    } finally {
      fsImpl.closeSync(fd);
    }
    text = buf.toString('utf8');
  }

  let lines = text.split(/\r?\n/);
  if (start > 0 && lines.length) lines.shift(); // the fragment
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

  const truncated = lines.length > maxLines || start > 0;
  return {
    lines: lines.slice(-maxLines),
    truncated,
    file_bytes: size,
    modified_at: stat.mtime.toISOString(),
  };
}

/**
 * One source -> one block. A source that cannot be read is a STATE with its own
 * words, never an empty array — "no lines" and "no such file" send a reader to
 * two different places.
 */
export function readSource(spec, rootDir, fsImpl = fs, pathJoin = (a, b) => `${a}/${b}`) {
  const full = pathJoin(rootDir, spec.file);
  const base = { id: spec.id, label: spec.label, row: spec.row ?? null, path: spec.file, note: spec.note ?? '' };
  try {
    const t = tailFile(full, MAX_LINES, TAIL_BYTES, fsImpl);
    return {
      ...base,
      lines: t.lines,
      truncated: t.truncated,
      file_bytes: t.file_bytes,
      modified_at: t.modified_at,
      error: null,
    };
  } catch (err) {
    const missing = err && (err.code === 'ENOENT');
    return {
      ...base,
      lines: [],
      truncated: false,
      file_bytes: null,
      modified_at: null,
      // ⚠️ A MISSING LOG IS NOT AN EMPTY LOG. "This job has never written a log
      // here" and "this job wrote nothing recently" have different fixes, and
      // the first usually means the job never ran at all.
      error: missing ? 'no log file at this path — the job may never have run' : String(err?.message || err).slice(0, 200),
    };
  }
}

/** Rough byte cost of a block once serialised. */
function blockBytes(block) {
  return Buffer.byteLength(JSON.stringify(block), 'utf8');
}

/**
 * The whole section, bounded.
 *
 * ⚠️ THE BUDGET IS SPENT IN LIST ORDER AND EXHAUSTION IS ANNOUNCED. A source
 * that does not fit keeps its block — label, path, note — and loses only its
 * LINES, with a sentence saying why. Dropping the block entirely would make a
 * source disappear from the page on a day when a different log happened to be
 * noisy, which is the worst possible time for something to go quiet.
 */
export function buildLogsSection(rootDir, sources = LOG_SOURCES, fsImpl = fs, pathJoin = (a, b) => `${a}/${b}`, nowIso = new Date().toISOString()) {
  const blocks = [];
  let spent = 0;
  for (const spec of sources) {
    const block = readSource(spec, rootDir, fsImpl, pathJoin);
    const cost = blockBytes(block);
    if (spent + cost > MAX_SECTION_BYTES) {
      blocks.push({
        ...block,
        lines: [],
        truncated: true,
        dropped_for_size: true,
        error: block.error ||
          `tail omitted to stay inside the board's size budget (${MAX_SECTION_BYTES} bytes for all logs) — ` +
          'read it on the home machine',
      });
      continue;
    }
    spent += cost;
    blocks.push(block);
  }
  return {
    sources: blocks,
    max_lines: MAX_LINES,
    budget_bytes: MAX_SECTION_BYTES,
    used_bytes: spent,
    as_of: nowIso,
    note: `Tails only — the last ${MAX_LINES} lines of each log, read from the end of the file.`,
  };
}
