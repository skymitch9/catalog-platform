/**
 * board-draft.mjs — read-modify-write the shared agent-board draft, then push.
 *
 * ⚠️ THIS EXISTS SO CONTRACT §9's RULE HAS ONE IMPLEMENTATION. The board is ONE
 * last-write-wins row holding ONE JSON object, so a push carrying only your
 * section DELETES everyone else's. Every pusher must therefore read
 * `.local/agent-board.json`, set its own key, and push the file WHOLE. That is
 * four lines of discipline, and four lines of discipline copied into three
 * scripts is three chances for one of them to drift — the exact failure mode
 * that makes the rule worth a module instead of a paragraph.
 *
 * ⚠️ AND YOU CANNOT RECOVER A SECTION YOU DID NOT WRITE. The read door is
 * `requireDevops()`, so no script can fetch the live board back to merge
 * against; the draft on disk is the only machine-readable copy there is. That
 * is why an unreadable draft is REFUSED here rather than replaced.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Merge `sections` into the draft and push the whole board.
 *
 * @param {object} o
 * @param {string} o.root      repo root
 * @param {object} o.sections  { [name]: value } — the sections THIS pusher owns
 * @param {string} o.by        X-Estate-Pushed-By
 * @returns {Promise<number>}  process exit code
 */
export async function mergeAndPush({ root, sections, by }) {
  const draft = path.join(root, '.local', 'agent-board.json');
  fs.mkdirSync(path.dirname(draft), { recursive: true });

  let board = {};
  if (fs.existsSync(draft)) {
    // ⚠️ The BOM strip is not decoration: PowerShell's Out-File writes one and
    // JSON.parse rejects it with what looks like a syntax error in a perfect
    // file (docs/access/agent-board.md §8).
    const raw = fs.readFileSync(draft, 'utf8').replace(/^﻿/, '');
    try {
      board = JSON.parse(raw);
    } catch (err) {
      console.error(`REFUSING: ${draft} exists and is not readable JSON (${err.message}).`);
      console.error('  Overwriting it would delete every other pusher’s section, and the read door is');
      console.error('  requireDevops() so nothing can fetch them back. Fix or move the file by hand.');
      return 1;
    }
    if (board === null || typeof board !== 'object' || Array.isArray(board)) {
      console.error(`REFUSING: ${draft} is not a JSON object.`);
      return 1;
    }
  }

  for (const [name, value] of Object.entries(sections)) board[name] = value;
  fs.writeFileSync(draft, `${JSON.stringify(board, null, 2)}\n`, 'utf8');

  // ⚠️ EXEC push-agent-board.mjs RATHER THAN POSTING HERE. It is the one
  // implementation of the POST and the only code in the estate that opens the
  // token custody file — two scripts that both knew the bearer ritual would be
  // two places for the BOM incident of docs/access/agent-board.md §3 to recur.
  // The token never enters this process, its argv, or its environment.
  const args = [
    path.join(root, 'scripts', 'push-agent-board.mjs'),
    draft,
    '--by', by,
    // Declaring the sections makes the Worker restamp exactly these and leave
    // every other section's age alone (contract §9).
    '--sections', Object.keys(sections).join(','),
  ];
  try {
    const { stdout } = await execFileAsync(process.execPath, args, { cwd: root, timeout: 120_000 });
    process.stdout.write(stdout);
    return 0;
  } catch (err) {
    process.stdout.write(err?.stdout || '');
    process.stderr.write(err?.stderr || '');
    console.error('The push failed — the draft on disk is still correct, so a retry will send it.');
    return 1;
  }
}
