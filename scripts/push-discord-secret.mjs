#!/usr/bin/env node
/**
 * **PUSH ONE NAMED SECRET FROM `apps/discord-worker/.dev.vars` TO THE WORKER —
 * BOM-free, un-echoed, and the drop-box line blanked afterwards.**
 *
 * ## ⚠️ WHY THIS SCRIPT EXISTS AT ALL, AND IT IS A MEASURED INCIDENT
 *
 * `docs/access/agent-board.md` §3 and `docs/access/discord-bot.md` §7:
 *
 * > **NEVER PIPE A SECRET TO `wrangler secret put` ON WINDOWS.** A PowerShell
 * > pipe to a native process prepends an invisible UTF-8 byte-order-mark
 * > (`EF BB BF`); the stored credential is then wrong **while looking perfect
 * > everywhere a human can check it**, and the failure surfaces as a plain 401
 * > with a valid-looking key.
 *
 * That happened to THIS Worker's `ANTHROPIC_API_KEY_GABI` on 2026-08-18: GABI
 * heard every mention and answered none, and the tail said `401 invalid
 * x-api-key` on a key that was perfectly valid. ⚠️ The first "fix"
 * (`$OutputEncoding` + trim) was **measured not to work** and is revoked as
 * ritual — a string does not survive a PowerShell pipe to a native process here,
 * full stop.
 *
 * ⚠️ **This script is not a fourth attempt at that ritual; it side-steps the
 * shell that breaks it.** Node writes to the child's stdin as raw bytes — there
 * is no encoder in the path to add a BOM — which is the same property `cmd`'s
 * `<` redirect has and which PowerShell's `|` does not. To make that CHECKABLE
 * rather than merely claimed, the byte facts are printed before the push: the
 * length, and the first three bytes, which must not be `239 187 191`.
 *
 * ## What it does, in order
 *
 *   1. reads `apps/discord-worker/.dev.vars` and finds the ONE named line;
 *   2. prints byte facts about the value — never the value;
 *   3. `npx wrangler secret put <NAME>` with the raw bytes on stdin;
 *   4. on success, BLANKS that line in `.dev.vars` (`NAME=`), so the drop box
 *      does not keep a live credential lying about on disk;
 *   5. reminds you that an upload proves TRANSPORT, not correctness.
 *
 * ⚠️ **THE VALUE IS NEVER PRINTED, NEVER PASSED AS AN ARGV, AND NEVER PUT IN AN
 * ENV VAR** — argv and the environment are both readable from a process table.
 *
 * ## Usage
 *
 *   node scripts/push-discord-secret.mjs GROQ_API_KEY_GABI
 *   node scripts/push-discord-secret.mjs GROQ_API_KEY_GABI --keep   (do not blank)
 *   node scripts/push-discord-secret.mjs --list                     (names only)
 *
 * `.dev.vars` is gitignored (`.gitignore:21`) and this repo is PUBLIC. Nothing
 * here writes a value anywhere but the Worker.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const WORKER_DIR = resolve(REPO, 'apps/discord-worker');
const DROPBOX = resolve(WORKER_DIR, '.dev.vars');

/** The names this script will push. ⚠️ An ALLOWLIST, not "any line in the file":
 *  a typo must not push the wrong credential to the wrong name, and the estate's
 *  default-deny rule applies to a script that moves secrets more than to
 *  anything else. Add a name here in the same commit that adds it to
 *  `src/env.ts` and `wrangler.toml`'s secrets comment. */
const PUSHABLE = new Set([
  'ANTHROPIC_API_KEY_GABI',
  'GROQ_API_KEY_GABI',
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_PUBLIC_KEY',
  'POLL_SYNC_TOKEN',
  'ESTATE_APP_TOKEN_DISCORD',
  'ESTATE_APP_TOKEN_DISCORD_DOCS',
  'ESTATE_APP_TOKEN_BOOKS',
  'FIREBASE_SERVICE_ACCOUNT',
]);

const die = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const list = args.includes('--list');
const name = args.find((a) => !a.startsWith('--'));

if (!existsSync(DROPBOX)) {
  die(
    `No drop box at ${DROPBOX}.\n` +
      `  Create it and add one line:  ${name ?? '<NAME>'}=<the value>\n` +
      '  It is gitignored (.gitignore:21) and this repo is public — never commit it.',
  );
}

const raw = readFileSync(DROPBOX, 'utf8');
const lines = raw.split(/\r?\n/);

/** Which line index holds the var, or -1. Comments and blanks are skipped.
 *  ⚠️ Accepts BOTH `NAME=value` and the library-style `NAME = "value"` —
 *  measured 2026-09-01: the drop-box line was written in the second shape,
 *  the owner pasted his key into it, and the strict `NAME=` match reported
 *  "no line" while the key sat right there. */
function lineFor(varName) {
  const re = new RegExp(`^${varName}\\s*=`);
  return lines.findIndex((l) => {
    const t = l.trimStart();
    return !t.startsWith('#') && re.test(t);
  });
}

/** ⚠️ The value, un-quoted and un-trimmed-of-anything-but-the-line-ending.
 *  Surrounding quotes are stripped because a `.dev.vars` line may carry them;
 *  INTERNAL whitespace is left alone, because a secret is opaque and this script
 *  does not get to have opinions about its contents. */
function valueOn(index) {
  const line = lines[index];
  // ⚠️ TRIM BEFORE the quote check. ` "value"` starts with a SPACE, so the
  // old order skipped the strip and would have pushed a literally-quoted
  // secret — wrong while looking perfect, the same failure family as the BOM.
  let v = line.slice(line.indexOf('=') + 1).trim();
  // Only a matched pair of surrounding quotes, and only one pair.
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v.trim();
}

if (list) {
  const found = lines
    .map((l) => l.trimStart())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => l.slice(0, l.indexOf('=')));
  console.log('\nNames present in apps/discord-worker/.dev.vars (values never shown):\n');
  for (const n of found) {
    const idx = lineFor(n);
    const filled = idx >= 0 && valueOn(idx).length > 0;
    const ok = PUSHABLE.has(n) ? '' : '   (not on the pushable allowlist)';
    console.log(`  ${filled ? '●' : '○'} ${n}${filled ? '' : '   (blank)'}${ok}`);
  }
  console.log('\n  ● = has a value   ○ = blank\n');
  process.exit(0);
}

if (!name) {
  die(
    'Which secret?  node scripts/push-discord-secret.mjs <NAME>\n' +
      `  Pushable: ${[...PUSHABLE].join(', ')}\n` +
      '  Or: node scripts/push-discord-secret.mjs --list',
  );
}

if (!PUSHABLE.has(name)) {
  die(
    `"${name}" is not on this script's allowlist, so it will not be pushed.\n` +
      `  Pushable: ${[...PUSHABLE].join(', ')}\n` +
      '  If this is a genuinely new secret, add it to PUSHABLE here in the same commit\n' +
      "  that adds it to apps/discord-worker/src/env.ts and wrangler.toml's secrets comment.",
  );
}

const index = lineFor(name);
if (index < 0) {
  die(
    `No line for ${name} in ${DROPBOX}.\n` +
      `  Add one:  ${name}=<the value>\n` +
      '  (paste it into the file — never onto a terminal line, where it lands in history)',
  );
}

const value = valueOn(index);
if (value.length === 0) {
  die(
    `${name} is present in ${DROPBOX} but BLANK.\n` +
      '  Either it was already pushed and blanked by this script, or the paste did not land.\n' +
      "  A secret cannot be read back out of Cloudflare — check `npx wrangler secret list` for the NAME,\n" +
      '  and if it is missing, paste the value again.',
  );
}

// ── Step 2: the byte facts, so a BOM is visible BEFORE it is stored ─────────
const bytes = Buffer.from(value, 'utf8');
const first3 = [bytes[0], bytes[1], bytes[2]];
console.log(`\n${name} → estate-discord`);
console.log(`  bytes: ${bytes.length}`);
console.log(`  first three: ${first3.join(' ')}   (a BOM would be 239 187 191)`);
console.log(`  last byte: ${bytes[bytes.length - 1]}   (10 or 13 would be a stray newline)`);
if (first3[0] === 239 && first3[1] === 187 && first3[2] === 191) {
  die(
    'THAT IS A BOM. The value in .dev.vars already starts with EF BB BF, so something\n' +
      '  wrote the file through PowerShell. Re-paste the value into .dev.vars with an editor\n' +
      '  (VS Code: "Save with encoding" → UTF-8, not UTF-8 with BOM) and run this again.\n' +
      '  See docs/access/agent-board.md §3.',
  );
}

// ── Step 3: the push. Raw bytes on stdin; nothing echoed, nothing on argv ───
console.log('\n  pushing (the value is written to wrangler\'s stdin and never printed)…\n');
const run = spawnSync('npx', ['wrangler', 'secret', 'put', name], {
  cwd: WORKER_DIR,
  input: bytes,
  // ⚠️ stdout/stderr are INHERITED so wrangler's own words reach the operator —
  // it prints the NAME and a success line, never the value.
  stdio: ['pipe', 'inherit', 'inherit'],
  shell: process.platform === 'win32',
});

if (run.error) die(`could not run wrangler: ${run.error.message}`);
if (run.status !== 0) {
  die(
    `wrangler exited ${run.status}. The value in .dev.vars has been LEFT ALONE so you can retry.\n` +
      '  If it says you are not logged in: npx wrangler login',
  );
}

// ── Step 4: blank the drop-box line ────────────────────────────────────────
if (keep) {
  console.log(`\n  --keep: the ${name} line in .dev.vars was left as it is.\n`);
} else {
  lines[index] = `${name}=`;
  // ⚠️ Written back with the file's own line ending and NO BOM, for the same
  // reason everything else here is: this file is read by wrangler dev too.
  writeFileSync(DROPBOX, lines.join(raw.includes('\r\n') ? '\r\n' : '\n'), 'utf8');
  console.log(`\n  ✔ ${name} pushed, and its line in .dev.vars is now blank.`);
}

// ── Step 5: the honest closing note ────────────────────────────────────────
console.log(
  '\n⚠️  An upload proves TRANSPORT, not correctness. Confirm the NAME appears:\n' +
    '      cd apps/discord-worker && npx wrangler secret list\n' +
    '    …and then prove the VALUE end to end — a name in that list is not a working key.\n' +
    (name === 'GROQ_API_KEY_GABI'
      ? '    For this one: set GABI_GROQ = "shadow" in wrangler.toml, deploy, @mention GABI, and watch\n' +
        '      npx wrangler tail estate-discord\n' +
        '    for a `gabi_groq_shadow` line. A BOM\'d key shows up there as reason "refused" with status 401.\n'
      : '') +
    '',
);
