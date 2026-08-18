#!/usr/bin/env node
/**
 * push-logs-board.mjs — tail the home-machine job logs and merge a `logs`
 * section into the shared agent-board draft.
 *
 * Owner ask, 2026-08-18, verbatim: *"also lets make it so i can see logs for
 * some of this stuff if they arent working by clicking into the health
 * checks."*
 *
 * ⚠️ A Worker cannot reach a scheduled task on a PC in the owner's house, so
 * this is the only way those logs can appear on a status page at all. What it
 * publishes is a TAIL — the last 40 lines of each job's log, read from the END
 * of the file so a 12 MB pipeline log costs the same as a 4 KB one. The bounds
 * and their arithmetic live in scripts/lib/logs-board.mjs.
 *
 * ⚠️ THE LOGS ARE DEVOPS-GATED BY THE DOOR THEY GO THROUGH, not by anything
 * here. `GET /api/estate/ops/agent-board` is requireDevops(), so these lines
 * are visible only to a signed-in devops reader — which is what makes it
 * acceptable for them to carry book titles and local paths. ⚠️ If a future
 * change ever makes any part of this board public, this section is the FIRST
 * thing that must stop being pushed.
 *
 * Usage:
 *   node scripts/push-logs-board.mjs --by "logs@home-pc"
 *   node scripts/push-logs-board.mjs --dry-run --print
 *   node scripts/push-logs-board.mjs --root <audiobook_catalog dir>
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildLogsSection } from './lib/logs-board.mjs';
import { mergeAndPush } from './lib/board-draft.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

/**
 * Where the logs live.
 *
 * ⚠️ The audiobook repo is a SIBLING of this one and its location is not
 * guaranteed, so it is resolved rather than assumed, and a miss is reported in
 * words. `--root` overrides for a machine that keeps it somewhere else.
 */
function resolveLogRoot() {
  const explicit = valueOf('--root');
  if (explicit) return path.resolve(explicit);
  const guesses = [
    path.resolve(ROOT, '..', 'bookbuddy', 'audiobook_catalog'),
    path.resolve(ROOT, '..', 'audiobook_catalog'),
  ];
  for (const g of guesses) {
    if (fs.existsSync(path.join(g, 'output_files'))) return g;
  }
  return guesses[0];
}

async function main() {
  const logRoot = resolveLogRoot();
  if (!fs.existsSync(path.join(logRoot, 'output_files'))) {
    // ⚠️ Say WHERE it looked. "Could not find the logs" without a path is the
    // kind of message that costs twenty minutes.
    console.error(`[logs] no output_files/ under ${logRoot}`);
    console.error('  Pass --root <audiobook_catalog dir> if the repo lives somewhere else.');
    return 1;
  }

  const section = buildLogsSection(logRoot, undefined, fs, path.join);

  if (has('--print')) console.log(JSON.stringify(section, null, 2));
  const ok = section.sources.filter((s) => !s.error).length;
  console.log(`[logs] ${ok}/${section.sources.length} logs tailed · ${section.used_bytes} of ${section.budget_bytes} bytes`);
  for (const s of section.sources.filter((x) => x.error)) console.log(`  [WARN] ${s.id}: ${s.error}`);

  if (has('--dry-run')) {
    console.log('[logs] --dry-run: nothing written, nothing pushed.');
    return 0;
  }
  return mergeAndPush({ root: ROOT, sections: { logs: section }, by: valueOf('--by') || 'logs-board@home-pc' });
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`[logs] ${err?.stack || err}`);
  process.exit(1);
});
