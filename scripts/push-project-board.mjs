#!/usr/bin/env node
/**
 * push-project-board — publish ONE project's card on /status/agents.
 *
 *   node <catalog-platform>/scripts/push-project-board.mjs <slug> <section.json> [--by label]
 *   node <catalog-platform>/scripts/push-project-board.mjs <slug> <section.json> --check
 *
 * Owner ask 2026-09-26: every project's agents, blockers, questions and
 * deliverables on one live page. Any repo's session calls this BY ABSOLUTE
 * PATH; it resolves everything it needs (the shared draft, the pusher, the
 * token custody file) relative to ITS OWN repo, never the caller's cwd.
 *
 * What it does: validates the slug and that the file is a JSON object, sets
 * `project_<slug>` in the shared draft (.local/agent-board.json — the same
 * read-modify-write every pusher uses, scripts/lib/board-draft.mjs), and execs
 * push-agent-board.mjs with `--sections project_<slug>`. The Worker changes a
 * project section ONLY on a push that declares it (contract §11), so this can
 * never roll back another project's card.
 *
 * ⚠️ THE TOKEN NEVER ENTERS THIS PROCESS. push-agent-board.mjs is the only
 * code that opens the custody file; this passes it the PATH. --check reports
 * whether that file exists and nothing about what is in it.
 *
 * The section's shape: docs/info/agent-board-contract.md §11.
 * When to push: docs/access/agent-board.md § Using it from another repo.
 */

import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeAndPush } from './lib/board-draft.mjs';
import { BOARD_MAX_BYTES, bytesOf, mergedBoard, parseSectionBody, sectionNameFor } from './lib/project-board.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TOKEN_FILE = join(REPO_ROOT, 'docs', 'access', 'keys', 'estate-conductor-token.txt');
const DRAFT = join(REPO_ROOT, '.local', 'agent-board.json');
const USAGE = 'Usage: node push-project-board.mjs <slug> <section.json> [--by label] [--check] [--token-file path]';

function die(message, hint) {
  console.error(`\n  ✖ ${message}`);
  if (hint) console.error(`    ${hint}`);
  console.error('');
  process.exit(1);
}

function parseArgs(argv) {
  const out = { slug: null, file: null, by: null, check: false, tokenFile: DEFAULT_TOKEN_FILE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') out.check = true;
    else if (a === '--by') out.by = argv[++i];
    else if (a === '--token-file') out.tokenFile = resolve(argv[++i] || '');
    else if (a === '--token') {
      die('There is no --token flag, on purpose.', 'A secret on a command line lands in shell history. Use the custody file.');
    } else if (a.startsWith('--')) die(`Unknown option "${a}".`, USAGE);
    else if (out.slug === null) out.slug = a;
    else if (out.file === null) out.file = a;
    else die(`Unexpected extra argument "${a}".`, USAGE);
  }
  if (out.slug === null || out.file === null) die('A slug and a section file are both required.', USAGE);
  return out;
}

/** The draft, read-only, for --check's size figure. Never written here. */
function readDraft() {
  if (!existsSync(DRAFT)) return { draft: {}, note: 'none yet — a real push would create it' };
  try {
    const d = JSON.parse(readFileSync(DRAFT, 'utf8').replace(/^﻿/, ''));
    if (d && typeof d === 'object' && !Array.isArray(d)) return { draft: d, note: DRAFT };
  } catch {
    /* worded below */
  }
  return { draft: {}, note: `${DRAFT} is unreadable — a real push would REFUSE until it is fixed by hand` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const named = sectionNameFor(args.slug);
  if (named.error) die(named.error);

  let text;
  try {
    text = readFileSync(resolve(args.file), 'utf8');
  } catch (err) {
    die(`Could not read "${args.file}" (${err.code || err.message}).`, 'Pass the path to the section JSON. Nothing was pushed.');
  }
  const parsed = parseSectionBody(text);
  if (parsed.error) die(parsed.error);

  const hasEnvToken = Boolean((process.env.ESTATE_CONDUCTOR_TOKEN || '').trim());
  const hasTokenFile = existsSync(args.tokenFile);

  if (args.check) {
    const { draft, note } = readDraft();
    const whole = bytesOf(mergedBoard(draft, named.name, parsed.body));
    const token = hasEnvToken
      ? '$ESTATE_CONDUCTOR_TOKEN is set'
      : hasTokenFile
        ? `custody file present (${args.tokenFile})`
        : `MISSING — ${args.tokenFile} does not exist, a real push would refuse`;
    console.log('\n  --check: nothing written, nothing sent.');
    console.log(`    section:        ${named.name}`);
    console.log(`    section bytes:  ${bytesOf(parsed.body)}`);
    console.log(`    payload bytes:  ${whole} of ${BOARD_MAX_BYTES} (the whole draft with this section set)`);
    console.log(`    draft:          ${note}`);
    console.log(`    token:          ${token}`);
    if (whole > BOARD_MAX_BYTES) console.log('    ⚠️ over the Worker limit — a real push would be refused (board_too_large).');
    console.log('');
    return;
  }

  if (!hasEnvToken && !hasTokenFile) {
    die(
      `No conductor token: $ESTATE_CONDUCTOR_TOKEN is unset and "${args.tokenFile}" does not exist. Nothing was pushed.`,
      'The custody file lives in the catalog-platform MAIN checkout (gitignored) — call this script by its absolute ' +
        'path there. See docs/access/agent-board.md.',
    );
  }

  const code = await mergeAndPush({
    root: REPO_ROOT,
    sections: { [named.name]: parsed.body },
    by: args.by || `${args.slug}@${hostname()}`,
    tokenFile: args.tokenFile,
  });
  process.exit(code);
}

main();
