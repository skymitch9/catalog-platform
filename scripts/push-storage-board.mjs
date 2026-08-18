#!/usr/bin/env node
/**
 * push-storage-board.mjs — measure every R2 bucket and merge a `storage`
 * section into the shared agent-board draft.
 *
 * Owner ask, 2026-08-18: a blob-storage panel on /status — objects, size, last
 * write and a monthly cost estimate, per bucket.
 *
 * ⚠️ IT FOLLOWS CONTRACT §9 AND YOU MUST NOT SHORTCUT IT. The board is ONE
 * last-write-wins row holding ONE JSON object, so a push carrying only this
 * section would DELETE `agents`, `events`, `usage` and `processing`. This
 * read-modify-writes `.local/agent-board.json` and then execs
 * `push-agent-board.mjs`, which is the one implementation of the POST and the
 * only code in the estate that opens the token custody file. Two scripts that
 * both knew the bearer ritual would be two places for the BOM incident to
 * happen again (docs/access/agent-board.md §3).
 *
 * ⚠️ IT DECLARES ITS SECTION. `X-Estate-Sections: storage` tells the Worker to
 * restamp `storage` and nothing else, so a run that measures identical sizes
 * still says "measured just now" — which is the honest reading for a
 * measurement, as opposed to a content diff. Every other section keeps its own
 * age. See agent-board-contract.md §9.
 *
 * ⚠️ WHY `wrangler r2 bucket info` AND NOT A LISTING. It is ONE call per bucket
 * against Cloudflare's own accounting, needs no API token (it uses this
 * machine's wrangler login), and costs nothing that scales with object count. A
 * listing would be O(objects) and would have to page. The price is that
 * `bucket_size` arrives as a rounded human string — parsed, approximated and
 * LABELLED as such in scripts/lib/storage-board.mjs.
 *
 * Usage:
 *   node scripts/push-storage-board.mjs --by "storage@home-pc"
 *   node scripts/push-storage-board.mjs --dry-run --print
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildStorageSection } from './lib/storage-board.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRAFT = path.join(ROOT, '.local', 'agent-board.json');
const WRANGLER_BIN = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

/**
 * One bucket's info, via wrangler.
 *
 * ⚠️ `wrangler` on Windows sometimes prints success and exits non-zero
 * (docs/access/agent-board.md §6), so the JSON is what is trusted, not the exit
 * code: if a JSON object can be found in stdout it is used regardless. A run
 * that both fails AND prints nothing parseable throws, and the caller turns
 * that into one row's error rather than a dead panel.
 */
async function bucketInfo(name) {
  let stdout = '';
  try {
    // ⚠️ NODE'S OWN BINARY RUNNING WRANGLER'S JS ENTRY, never `npx`. Node 20
    // refuses to execFile a Windows `.cmd` without `shell: true` (it answers
    // `spawn EINVAL`, measured 2026-08-18), and turning the shell on to work
    // around that would put a bucket name through cmd's quoting rules for no
    // benefit. Resolving the module skips both problems and pins the version
    // this repo installed rather than whatever npx decides to fetch.
    ({ stdout } = await execFileAsync(
      process.execPath,
      [WRANGLER_BIN, 'r2', 'bucket', 'info', name, '--json'],
      { cwd: path.join(ROOT, 'apps', 'auth-worker'), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    ));
  } catch (err) {
    stdout = err?.stdout || '';
    if (!stdout) throw new Error(err?.shortMessage || err?.message || 'wrangler produced no output');
  }
  // wrangler prints a banner and warnings before the JSON; take the last object.
  const start = stdout.lastIndexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in wrangler output');
  return JSON.parse(stdout.slice(start, end + 1));
}

async function main() {
  const section = await buildStorageSection(bucketInfo);

  if (has('--print')) console.log(JSON.stringify(section, null, 2));

  const measured = `${section.measured}/${section.of} buckets`;
  const size = Number.isFinite(section.total_bytes) ? `${(section.total_bytes / 1e9).toFixed(1)} GB` : 'size unknown';
  const cost = Number.isFinite(section.total_cost_usd_month) ? `$${section.total_cost_usd_month.toFixed(2)}/mo` : 'cost unknown';
  console.log(`[storage] ${measured} · ${size} · ${cost}`);
  for (const b of section.buckets.filter((x) => x.error)) console.log(`  [WARN] ${b.name}: ${b.error}`);

  if (has('--dry-run')) {
    console.log('[storage] --dry-run: nothing written, nothing pushed.');
    return 0;
  }

  // ── READ-MODIFY-WRITE the shared draft (contract §9) ──────────────────────
  fs.mkdirSync(path.dirname(DRAFT), { recursive: true });
  let board = {};
  if (fs.existsSync(DRAFT)) {
    // The BOM strip is not decoration: PowerShell's Out-File writes one and
    // JSON.parse rejects it with what looks like a syntax error in a perfect
    // file (docs/access/agent-board.md §8).
    const raw = fs.readFileSync(DRAFT, 'utf8').replace(/^﻿/, '');
    try {
      board = JSON.parse(raw);
    } catch (err) {
      // ⚠️ REFUSE rather than start a fresh board. Overwriting an unreadable
      // draft would delete every other pusher's section, and "you cannot
      // recover a section you did not write" — the read door is requireDevops()
      // so no script can fetch it back.
      console.error(`[storage] REFUSING: ${DRAFT} exists and is not readable JSON (${err.message}).`);
      console.error('  Fix or remove the draft by hand. Overwriting it would delete the other pushers’ sections.');
      return 1;
    }
    if (board === null || typeof board !== 'object' || Array.isArray(board)) {
      console.error(`[storage] REFUSING: ${DRAFT} is not a JSON object.`);
      return 1;
    }
  }
  board.storage = section;
  fs.writeFileSync(DRAFT, `${JSON.stringify(board, null, 2)}\n`, 'utf8');

  // ── Push the WHOLE draft through the one implementation of the POST ───────
  const by = valueOf('--by') || 'storage-board@home-pc';
  const args = [path.join(ROOT, 'scripts', 'push-agent-board.mjs'), DRAFT, '--by', by, '--sections', 'storage'];
  try {
    const { stdout } = await execFileAsync(process.execPath, args, { cwd: ROOT, timeout: 120_000 });
    process.stdout.write(stdout);
  } catch (err) {
    process.stdout.write(err?.stdout || '');
    process.stderr.write(err?.stderr || '');
    console.error('[storage] the push failed — the draft on disk is still correct, so a retry will send it.');
    return 1;
  }
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`[storage] ${err?.stack || err}`);
  process.exit(1);
});
