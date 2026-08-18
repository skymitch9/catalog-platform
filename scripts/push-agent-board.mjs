#!/usr/bin/env node
/**
 * push-agent-board — publish the conductor's agent board to heygabi.ai.
 *
 * POSTs a JSON file to `POST /api/estate/ops/agent-board` on the estate auth
 * Worker, which stores it as ONE last-write-wins row and serves it back to
 * /status/agents (running agents, the event feed, the usage figures) and
 * /status/processing (the `processing` section). The contract the file must
 * satisfy is docs/info/agent-board-contract.md; custody of the bearer is
 * docs/access/agent-board.md.
 *
 *   node scripts/push-agent-board.mjs board.json
 *   node scripts/push-agent-board.mjs board.json --by "conductor@home-pc"
 *   node scripts/push-agent-board.mjs board.json --url https://auth.heygabi.ai
 *   node scripts/push-agent-board.mjs --check          # read the board back
 *
 * THE TOKEN, in the order it is looked for:
 *   1. $ESTATE_CONDUCTOR_TOKEN
 *   2. --token-file <path>
 *   3. docs/access/keys/estate-conductor-token.txt  (the default custody file,
 *      gitignored — see docs/access/keys/README.md)
 *
 * ⚠️ THE TOKEN IS NEVER PRINTED, not even partially, and never passed on a
 * command line by this script. A `--token` flag is deliberately absent: an
 * argument lands in shell history and in the process table, and the estate has
 * a standing incident on a secret that leaked through a log stream.
 *
 * ⚠️ THIS SCRIPT PUSHES WHAT IS ON DISK, exactly like a directory deploy. It
 * does not read git, does not know what a commit is, and will happily publish
 * a half-written board. Write the file, then push it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TOKEN_FILE = join(REPO_ROOT, 'docs', 'access', 'keys', 'estate-conductor-token.txt');
const DEFAULT_BASE_URL = 'https://auth.heygabi.ai';
const ROUTE = '/api/estate/ops/agent-board';

function die(message, hint) {
  // Every failure says what happened AND what to do — the estate's standing
  // rule, applied to a CLI: a bare stack trace is this script's version of a
  // bare HTTP status.
  console.error(`\n  ✖ ${message}`);
  if (hint) console.error(`    ${hint}`);
  console.error('');
  process.exit(1);
}

function parseArgs(argv) {
  const out = { file: null, by: null, baseUrl: DEFAULT_BASE_URL, tokenFile: DEFAULT_TOKEN_FILE, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') out.check = true;
    else if (a === '--by') out.by = argv[++i];
    else if (a === '--url') out.baseUrl = (argv[++i] || '').replace(/\/+$/, '');
    else if (a === '--token-file') out.tokenFile = argv[++i];
    else if (a === '--token') {
      die(
        'There is no --token flag, on purpose.',
        'A secret on a command line lands in shell history and the process table. ' +
          'Use $ESTATE_CONDUCTOR_TOKEN or --token-file.',
      );
    } else if (a.startsWith('--')) die(`Unknown option "${a}".`, 'Options: --check --by --url --token-file');
    else if (!out.file) out.file = a;
    else die(`Two board files given ("${out.file}" and "${a}") — this pushes exactly one.`);
  }
  return out;
}

/**
 * ⚠️ STRIPS A LEADING BOM. A board file written by a Windows editor (or by
 * PowerShell's `Out-File`, which defaults to UTF-8 WITH a BOM here) starts
 * with EF BB BF, and `JSON.parse` rejects it with "Unexpected token" — which
 * reads exactly like a syntax error in a file that is in fact perfect. Same
 * family as the secret-transport BOM in docs/access/discord-bot.md §7, met on
 * the data side instead of the credential side.
 */
function readJsonFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    die(`Could not read "${path}" (${err.code || err.message}).`, 'Pass the path to the board JSON file.');
  }
  const clean = text.replace(/^﻿/, '');
  try {
    JSON.parse(clean);
  } catch (err) {
    die(`"${path}" is not valid JSON: ${err.message}`, 'The Worker would refuse it too — fix it here first.');
  }
  return clean;
}

/**
 * ⚠️ THE ENV VAR WINS OVER THE FILE, deliberately. A rotation sets the Worker
 * and the file together; an OPERATOR debugging a rotation wants to try a value
 * without overwriting custody. Precedence in the direction that makes the
 * temporary thing temporary.
 */
function readToken(tokenFile) {
  const fromEnv = (process.env.ESTATE_CONDUCTOR_TOKEN || '').trim();
  if (fromEnv) return { token: fromEnv, source: '$ESTATE_CONDUCTOR_TOKEN' };
  let raw;
  try {
    raw = readFileSync(tokenFile, 'utf8');
  } catch {
    die(
      `No conductor token: $ESTATE_CONDUCTOR_TOKEN is unset and "${tokenFile}" does not exist.`,
      'Mint one with `openssl rand -hex 32`, store it on the Worker and in that file — ' +
        'the exact commands are in docs/access/agent-board.md §3.',
    );
  }
  const token = raw.replace(/^﻿/, '').trim();
  if (!token) die(`"${tokenFile}" is empty.`, 'See docs/access/agent-board.md §3.');
  return { token, source: tokenFile };
}

/** Turn a refusal into a sentence. The Worker already words its own bodies;
 *  this only makes sure a bare status can never be the whole message. */
function describeFailure(status, body) {
  if (body && body.detail) return `${body.detail}${body.fix ? `\n    Fix: ${body.fix}` : ''}`;
  if (status === 401) return 'The Worker refused the bearer, and said nothing more.';
  if (status === 403) return 'This account is not allowed to read the agent board.';
  if (status === 404) return 'That route does not exist on this Worker — is auth-worker deployed with the agent board?';
  return `The Worker answered HTTP ${status} with no explanation.`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = `${args.baseUrl}${ROUTE}`;

  if (args.check) {
    // ⚠️ The READ door is requireDevops(), not the bearer — so this branch is
    // expected to answer 401 from a script. It exists to prove the ROUTE is
    // live and answering the right refusal, which is the one thing a push
    // cannot tell you when it fails.
    const res = await fetch(url, { headers: { Accept: 'application/json' } }).catch((e) => {
      die(`Could not reach ${url} (${e.message}).`);
    });
    const body = await res.json().catch(() => null);
    console.log(`\n  GET ${url}\n  → HTTP ${res.status} ${body?.error ? `(${body.error})` : ''}`);
    console.log(
      res.status === 401
        ? '  ✔ The route is live and refuses an unauthenticated read, which is correct.\n'
        : `  ${describeFailure(res.status, body)}\n`,
    );
    return;
  }

  if (!args.file) {
    die('No board file given.', 'Usage: node scripts/push-agent-board.mjs <board.json> [--by "conductor@host"]');
  }

  const payload = readJsonFile(args.file);
  const { token, source } = readToken(args.tokenFile);
  const bytes = Buffer.byteLength(payload, 'utf8');

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(args.by ? { 'X-Estate-Pushed-By': args.by } : {}),
      },
      body: payload,
    });
  } catch (err) {
    die(`Could not reach ${url} (${err.message}).`, 'Nothing was pushed.');
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    die(`Push refused — HTTP ${res.status}.`, describeFailure(res.status, body));
  }

  // The token's SOURCE is named, never its value — knowing which of the two
  // places a working token came from is the whole diagnostic during a rotation.
  console.log(`\n  ✔ Pushed ${bytes} bytes to ${url}`);
  console.log(`    token from: ${source}`);
  console.log(`    stored at:  ${body?.pushed_at || '(the Worker did not say)'}`);
  console.log('    review:     https://heygabi.ai/status/agents\n');
}

main();
