#!/usr/bin/env node
/**
 * push-processing-board — the home machine's half of the agent board.
 *
 * Owner, 2026-08-18, looking at the new /status/processing: *"processing
 * doesn't seem wired up yet"* — correct. The page, its renderer and the write
 * door all shipped that day; the PUSHER did not exist. This is it.
 *
 * It reads the ingestion pipeline's own artefacts on this machine, projects
 * them into the `processing` section of docs/info/agent-board-contract.md, and
 * publishes it. Read-only on every input: it never writes to
 * estate-training-data, never touches output_files/ingest_books.lock, and
 * never starts, stops or waits on the pipeline.
 *
 *   node scripts/push-processing-board.mjs --by "ingest-nightly@home-pc"
 *   node scripts/push-processing-board.mjs --dry-run --print   # build, push nothing
 *
 * ⚠️ IT DOES NOT PUSH. It writes the merged board to the canonical board file
 * and then execs scripts/push-agent-board.mjs, which is the one implementation
 * of the push and the ONLY thing that reads the token. Two scripts that both
 * knew how to send the bearer would be two places for the token ritual to go
 * wrong, and the ritual is the part with an incident behind it
 * (docs/access/agent-board.md §3). The token never enters this process.
 *
 * ⚠️ ONE ROW, LAST WRITE WINS — SO THIS MERGES, IT DOES NOT REPLACE. The board
 * is a single D1 row holding one JSON object; a push carrying only
 * `processing` would delete the conductor's `agents`, `events` and `usage`.
 * The canonical board file (--board-file, default .local/agent-board.json) is
 * the shared draft both pushers read-modify-write. This script rewrites
 * exactly one key of it and leaves every other byte alone.
 *
 * ⚠️ WHAT THAT STILL CANNOT DO: it cannot recover a section the conductor
 * pushed from some OTHER file. The read door is requireDevops(), so no script
 * can fetch the live board back. If /status/agents ever goes blank after a
 * processing push, the cause is a conductor push that bypassed the canonical
 * file — the fix is to write it there, not to change this script.
 *
 * ⚠️ SOFT-FAIL BY CONTRACT. This runs off the back of the 30-minute ingestion
 * task. A status push that could break, block or slow a transcription run
 * would be a status surface that costs more than it reports, so every failure
 * here is one warned line and a non-zero exit that the caller neutralises
 * (scripts/ingest_nightly.bat preserves the ingester's own exit code).
 */

import { execFile } from 'node:child_process';
import { existsSync, openSync, readFileSync, readSync, closeSync, statSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProcessingSection, MAX_HISTORY } from './lib/processing-board.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Both roots are overridable, because a fixture run must be able to point at
 *  a copy. The defaults are this machine's real paths — ingest_queue.py reads
 *  the same ESTATE_TRAINING_ROOT variable with the same default. */
const TRAINING_ROOT = process.env.ESTATE_TRAINING_ROOT || 'C:\\Users\\nbasl\\estate-training-data';
const CATALOG_ROOT =
  process.env.AUDIOBOOK_CATALOG_ROOT ||
  'C:\\Users\\nbasl\\OneDrive\\Documents\\vs-code-repos\\bookbuddy\\audiobook_catalog';

const STATE_PATH = join(TRAINING_ROOT, 'ingest_state.json');
const INDEX_PATH = join(TRAINING_ROOT, 'packs', '_index.json.gz');
const RECEIPTS_DIR = join(TRAINING_ROOT, 'receipts');
const CPU_LOG = join(TRAINING_ROOT, 'logs', 'cpu_ingest.log');
const NIGHTLY_LOG = join(CATALOG_ROOT, 'output_files', 'ingest_nightly.log');
const LOCK_PATH = join(CATALOG_ROOT, 'output_files', 'ingest_books.lock');

const DEFAULT_BOARD_FILE = join(REPO_ROOT, '.local', 'agent-board.json');
const PUSHER = join(REPO_ROOT, 'scripts', 'push-agent-board.mjs');

/** A push that hangs must not hold the ingestion task's shell open. */
const PUSH_TIMEOUT_MS = 60_000;
/** Logs are append-only and grow forever; only the tail is ever interesting
 *  for in-flight state, and 4 MB is thousands of runs' worth of OK lines. */
const MAX_LOG_BYTES = 4 * 1024 * 1024;

function warn(message, hint) {
  console.error(`  ✖ ${message}`);
  if (hint) console.error(`    ${hint}`);
}

/** The last `maxBytes` of a file, with a truncated leading line discarded so a
 *  half-line can never be parsed as a whole one. Missing file → ''. */
function readTail(path, maxBytes = MAX_LOG_BYTES) {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return '';
  }
  if (size <= maxBytes) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  }
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    readSync(fd, buf, 0, maxBytes, size - maxBytes);
    const text = buf.toString('utf8');
    const nl = text.indexOf('\n');
    return nl === -1 ? text : text.slice(nl + 1);
  } finally {
    closeSync(fd);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function readPackIndex(path) {
  try {
    return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'));
  } catch {
    return null;
  }
}

/** The newest receipt. Their names are UTC stamps (ingest-20260818T170003Z.json)
 *  so a lexical sort IS a chronological one — but mtime breaks the tie, because
 *  a name is a claim and a file's mtime is a fact. */
function readNewestReceipt(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  if (!names.length) return null;
  names.sort();
  return readJson(join(dir, names[names.length - 1]));
}

/**
 * The single-flight lock, READ AND NEVER ACQUIRED.
 *
 * ⚠️ Opening this file for writing would race the ingester for its own lock and
 * could stop a live transcription chain. It is opened read-only, and its
 * absence is reported as absence rather than guessed at.
 */
function readLock(path) {
  if (!existsSync(path)) return { present: false, heldSinceMs: null };
  let heldSinceMs = null;
  const body = readJson(path);
  if (body && typeof body.at === 'string') {
    const ms = Date.parse(body.at);
    if (Number.isFinite(ms)) heldSinceMs = ms;
  }
  if (heldSinceMs === null) {
    try {
      heldSinceMs = statSync(path).mtimeMs;
    } catch {
      heldSinceMs = null;
    }
  }
  return { present: true, heldSinceMs };
}

function parseArgs(argv) {
  const out = {
    by: 'ingest-pipeline@home-pc',
    boardFile: DEFAULT_BOARD_FILE,
    dryRun: false,
    print: false,
    maxHistory: MAX_HISTORY,
    url: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--print') out.print = true;
    else if (a === '--by') out.by = argv[++i];
    else if (a === '--board-file') out.boardFile = resolve(argv[++i]);
    else if (a === '--url') out.url = argv[++i];
    else if (a === '--max-history') out.maxHistory = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node scripts/push-processing-board.mjs [--by label] [--board-file path]\n' +
          '                                             [--dry-run] [--print] [--max-history N] [--url base]\n' +
          '\nBuilds the `processing` section from this machine\'s ingestion artefacts, merges it into\n' +
          'the canonical board file, and pushes the whole board with scripts/push-agent-board.mjs.\n',
      );
      process.exit(0);
    } else {
      warn(`Unknown option "${a}".`, 'Options: --by --board-file --dry-run --print --max-history --url');
      process.exit(1);
    }
  }
  return out;
}

function pushBoard(file, by, url) {
  return new Promise((resolvePromise) => {
    const args = [PUSHER, file, '--by', by];
    if (url) args.push('--url', url);
    execFile(process.execPath, args, { timeout: PUSH_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      resolvePromise(err ? 1 : 0);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const state = readJson(STATE_PATH);
  if (!state) {
    // ⚠️ NOT AN EMPTY BOARD. Pushing a processing section built from no state
    // would publish "0 packed, nothing queued" — the exact shape of a healthy
    // idle pipeline — when the truth is that the projection could not read its
    // input. Refusing leaves the previous push standing, and the page's own
    // freshness strip then reports it as ageing, which is the honest signal.
    warn(
      `Could not read ${STATE_PATH}.`,
      'Nothing was pushed — the last board stays up and ages visibly, which is better than ' +
        'publishing zeroes that look like an idle pipeline.',
    );
    return 1;
  }

  let stateReadAt;
  try {
    stateReadAt = new Date(statSync(STATE_PATH).mtimeMs).toISOString();
  } catch {
    stateReadAt = new Date().toISOString();
  }

  const section = buildProcessingSection({
    state,
    nightlyLog: readTail(NIGHTLY_LOG),
    cpuLog: readTail(CPU_LOG),
    packIndex: readPackIndex(INDEX_PATH),
    receipt: readNewestReceipt(RECEIPTS_DIR),
    lock: readLock(LOCK_PATH),
    stateReadAt,
    nowMs: Date.now(),
    maxHistory: args.maxHistory,
  });

  if (args.print) console.log(JSON.stringify(section, null, 2));

  // Merge, never replace — see this file's header.
  const board = (existsSync(args.boardFile) ? readJson(args.boardFile) : null) || {};
  if (!existsSync(args.boardFile)) {
    console.log(
      `  note: ${args.boardFile} did not exist, so this board carries only a processing section.\n` +
        '        Any agents/events/usage previously pushed from another file are replaced.',
    );
  }
  board.processing = section;

  mkdirSync(dirname(args.boardFile), { recursive: true });
  // Indented on purpose: this file is also the conductor's draft and gets read
  // and hand-edited. ⚠️ The bytes reported below are the INDENTED ones — the
  // Worker's 256 KB cap measures what is actually sent, and quoting a compact
  // size here would understate the real figure by a third.
  const text = `${JSON.stringify(board, null, 2)}\n`;
  writeFileSync(args.boardFile, text, 'utf8');

  // ⚠️ ASCII ONLY on this line. It is appended to output_files/processing_push.log
  // by a cmd shell whose codepage is not UTF-8, and a middot came back as "Â·"
  // when the batch tail was first exercised (measured 2026-08-18). A log nobody
  // can read is a log nobody reads.
  console.log(
    `  processing: ${section.in_flight.length} in flight | ${section.queue.length} queue lanes | ` +
      `${section.history.length} history rows | ${Buffer.byteLength(text, 'utf8')} board bytes`,
  );

  if (args.dryRun) {
    console.log(`  --dry-run: wrote ${args.boardFile} and pushed nothing.`);
    return 0;
  }
  return pushBoard(args.boardFile, args.by, args.url);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    warn(`push-processing-board crashed: ${err && err.message}`, 'Nothing was pushed; the ingestion run is unaffected.');
    process.exit(1);
  },
);
